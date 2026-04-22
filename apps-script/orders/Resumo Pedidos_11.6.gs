// ============================================================================
// 🏆 SCRIPT PEDIDOS DE COMPRA - V11.6 (WORKSPACE 30MIN, EARLY STOP POR DATA)
// ============================================================================

// ============================================================================
// 🎮 0. PAINEL DE CONTROLE
// ============================================================================

var OPCOES_PEDIDOS = {
  empresasAlvo: ["SF"], 
  itensPorPagina: 100,        // Máximo permitido pelo Omie
  mesesRetroagir: 12,         // Quantos meses para trás a partir de hoje
  limitePaginasInuteis: 3     // Páginas consecutivas fora do período antes de parar
};

// ============================================================================
// ⚙️ 1. CONFIGURAÇÕES TÉCNICAS
// ============================================================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_PEDIDOS = {
  url: "https://app.omie.com.br/api/v1/produtos/pedidocompra/",
  metodo: "PesquisarPedCompra",
  nomePlanilha: "ResumoPedidosCompleto",
  cor: "#FF6D00",
  headers: [
    "Empresa", "nCodPed","cNumero","cCodCateg","cEtapa","dIncData","cIncHora",
    "nCodFor","cCodIntFor","cContato","cCodParc","nQtdeParc",
    "dDtPrevisao","nCodCC","nCodIntCC","nCodCompr","nCodProj",
    "cCodIntPed","cNumPedido","cContrato","cObs","cObsInt",
    "nTotalPedido","cCodStatus","cDescStatus","cRecebido",
    "dDataRecebimento","dDtFaturamento","cNumeroNF",
    "nCodItem","nCodProd","cCodIntProd","cProduto","cDescricao",
    "cUnidade","nQtde","nValUnit","nValTot","nDesconto",
    "nFrete","nSeguro","nDespesas","Loc Estoque",
    "cEAN","cNCM","nQtdeRec","nPesoBruto","nPesoLiq",
    "cCodIntItem","nValMerc","nValorCofins","nValorIcms",
    "nValorIpi","nValorPis","nValorSt"
  ]
};

// ============================================================================
// 🧹 UTILITÁRIO: LIMPAR ESTADO
// ============================================================================

function limparEstadoSalvo() {
  limparMemoriaSegura('PED_');
  limparGatilhosSafe();
  Logger.log("✅ Estado limpo!");
}

// ============================================================================
// 🚀 2. LANÇADOR (AUTO LIMPA + RESET + START)
// ============================================================================

function executarImportacaoPedidosTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // Proteção de Lock Externo
  if (props.getProperty('PED_PROCESSANDO') === 'TRUE' && props.getProperty('LOCK_PED_EXTERNO') === 'TRUE') {
     Logger.log('⚠️ Importação Pedidos já está rodando. Ignorando.');
     return 0;
  }
  
  if (props.getProperty('PED_PROCESSANDO') !== 'TRUE') {
    Logger.log("🟢 0. Limpando estado anterior...");
    limparEstadoSalvo();

    Logger.log("🟢 1. LANÇADOR: Iniciando V11.6...");

    // Calcula data de corte
    var dtIni = new Date();
    dtIni.setMonth(dtIni.getMonth() - OPCOES_PEDIDOS.mesesRetroagir);
    
    // Prepara a aba oficial
    var sheet = ss.getSheetByName(CONFIG_PEDIDOS.nomePlanilha);
    if (!sheet) sheet = ss.insertSheet(CONFIG_PEDIDOS.nomePlanilha);
    
    sheet.clear(); 
    
    sheet.getRange(1, 1, 1, CONFIG_PEDIDOS.headers.length)
         .setValues([CONFIG_PEDIDOS.headers])
         .setFontWeight("bold")
         .setBackground(CONFIG_PEDIDOS.cor)
         .setFontColor("white");
    sheet.setFrozenRows(1);
    SpreadsheetApp.flush();

    // Salva Estado Inicial
    props.setProperties({
      'PED_TARGET_EMPS':  JSON.stringify(OPCOES_PEDIDOS.empresasAlvo),
      'PED_ITENS_PAG':    OPCOES_PEDIDOS.itensPorPagina.toString(),
      'PED_PROCESSANDO':  'TRUE',
      'PED_IDX_EMP':      '0',
      'PED_IDX_PAG':      '1',
      'PED_TOTAL_REGS':   '0',
      'PED_PAG_INUTEIS':  '0',
      'PED_DT_INI_TS':    dtIni.getTime().toString()
    });

    Logger.log("🟢 2. LANÇADOR: Planilha resetada. Data de corte: " + dtIni.toLocaleDateString() + ". Iniciando Motor...");
  }
  
  return motorProcessamentoPedidos();
}

// ============================================================================
// ⚙️ 3. MOTOR (28 MINUTOS — WORKSPACE)
// ============================================================================

function motorProcessamentoPedidos() {
  limparGatilhosSafe(); 
  
  var horaInicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId();
  var sheetName = CONFIG_PEDIDOS.nomePlanilha;
  
  var props = PropertiesService.getScriptProperties();
  var estado = props.getProperties();
  
  props.setProperty('PED_PROCESSANDO', 'TRUE');
  
  var eIdx                = parseInt(estado['PED_IDX_EMP']     || "0");
  var pIdx                = parseInt(estado['PED_IDX_PAG']     || "1");
  var itensPorPagina      = parseInt(estado['PED_ITENS_PAG']   || "100");
  var paginasInuteis      = parseInt(estado['PED_PAG_INUTEIS'] || "0");
  var tsInicio            = parseFloat(estado['PED_DT_INI_TS'] || "0");
  var listaEmpresas       = JSON.parse(estado['PED_TARGET_EMPS'] || '[]');
  var totalImportadoGeral = parseInt(estado['PED_TOTAL_REGS']  || "0");

  var precisaAgendar = false;

  for (var e = eIdx; e < listaEmpresas.length; e++) {
    var sigla = listaEmpresas[e];
    if (e > eIdx) { pIdx = 1; paginasInuteis = 0; }
    
    var empresa = EMPRESAS_OMIE[sigla];
    if (!empresa) { continue; }

    var continuarPaginacao = true;
    var bufferLinhas = [];

    while (continuarPaginacao) {

      // 28 minutos — limite seguro para Workspace (30min máximo)
      if ((new Date().getTime() - horaInicio) > 1680000) { 
        if (bufferLinhas.length > 0) appendDirectToSheet(ssId, sheetName, bufferLinhas);
        
        Logger.log("⏳ TEMPO ESGOTADO! Checkpoint na pág " + pIdx + " | Total: " + totalImportadoGeral);
        props.setProperties({ 
          'PED_IDX_EMP':     e.toString(), 
          'PED_IDX_PAG':     pIdx.toString(),
          'PED_PAG_INUTEIS': paginasInuteis.toString(),
          'PED_PROCESSANDO': 'TRUE',
          'PED_TOTAL_REGS':  totalImportadoGeral.toString()
        });
        precisaAgendar = true;
        continuarPaginacao = false;
        break;
      }

      Logger.log("   ⬇️ " + sigla + " | Pág " + pIdx + " | Total: " + totalImportadoGeral + " | PágInuteis: " + paginasInuteis);

      try {
        var payload = {
          "call": CONFIG_PEDIDOS.metodo,
          "app_key": empresa.appKey, 
          "app_secret": empresa.appSecret, 
          "param": [{
            "nPagina": pIdx,
            "nRegsPorPagina": itensPorPagina,
            "lExibirPedidosPendentes": "S",
            "lExibirPedidosFaturados": "S",
            "lExibirPedidosCancelados": "S",
            "lExibirPedidosRecebidos": "S",
            "lExibirPedidosEncerrados": "S"
          }]
        };

        var data = fetchOmieSmart(CONFIG_PEDIDOS.url, payload);

        if (data.faultstring) {
          if (data.faultstring.indexOf("N\u00e3o existem") > -1) {
             Logger.log("   ✅ Fim dos registros para " + sigla);
             continuarPaginacao = false; 
             break;
          }
          throw new Error(data.faultstring);
        }

        var pedidos = data.pedidos_pesquisa || [];
        var ehUltimaPagina = (pedidos.length < itensPorPagina);
        var linhasFiltradas = [];
        var encontrouRecente = false;

        // Filtra por data de corte
        for (var i = 0; i < pedidos.length; i++) {
          var ped = pedidos[i];
          var dtStr = ped.cabecalho_consulta.dIncData;
          if (dtStr) {
            var partes = dtStr.split('/');
            var dataPed = new Date(partes[2], partes[1]-1, partes[0]).getTime();
            if (dataPed >= tsInicio) {
              encontrouRecente = true;
              var itens = parseUnicoPedido(ped, sigla);
              linhasFiltradas = linhasFiltradas.concat(itens);
            }
          }
        }

        // Controla páginas sem dados no período
        if (encontrouRecente) { 
          paginasInuteis = 0; 
        } else { 
          paginasInuteis++; 
        }
        props.setProperty('PED_PAG_INUTEIS', paginasInuteis.toString());

        // Early stop — X páginas consecutivas fora do período
        if (paginasInuteis >= OPCOES_PEDIDOS.limitePaginasInuteis) {
          Logger.log("🛑 EARLY STOP: " + paginasInuteis + " páginas fora do período. Encerrando " + sigla + ".");
          if (bufferLinhas.length > 0) appendDirectToSheet(ssId, sheetName, bufferLinhas);
          bufferLinhas = [];
          continuarPaginacao = false;
          break;
        }

        if (linhasFiltradas.length > 0) {
          bufferLinhas = bufferLinhas.concat(linhasFiltradas);
          totalImportadoGeral += linhasFiltradas.length;
        }

        // Pausa entre chamadas para não estourar bandwidth
        Utilities.sleep(1500);

        // Grava quando buffer enche ou é última página
        if (bufferLinhas.length >= 200 || (ehUltimaPagina && bufferLinhas.length > 0)) {
          Logger.log("      💾 Gravando " + bufferLinhas.length + " linhas...");
          appendDirectToSheet(ssId, sheetName, bufferLinhas);
          bufferLinhas = [];
          props.setProperty('PED_TOTAL_REGS', totalImportadoGeral.toString());
        }

        if (ehUltimaPagina) { 
          Logger.log("   ✅ Última página de " + sigla + " atingida.");
          continuarPaginacao = false; 
        } else { 
          pIdx++; 
        }

      } catch (err) {
        if (bufferLinhas.length > 0) { 
          appendDirectToSheet(ssId, sheetName, bufferLinhas); 
          bufferLinhas = []; 
        }
        var m = err.message;
        Logger.log("   ⚠️ Erro: " + m);

        if (m.indexOf("Bandwidth") > -1) {
          Logger.log("      Bandwidth exceeded. Pausando 10s...");
          Utilities.sleep(10000);

        } else if (m.indexOf("HTTP 500") > -1 || m.indexOf("timed out") > -1) {
          Logger.log("      Falha API. Tentando de novo em 5s...");
          Utilities.sleep(5000);

        } else if (m.indexOf("N\u00e3o existem") > -1) {
          continuarPaginacao = false; 

        } else if (m.indexOf("403") > -1) { 
          Logger.log("      🚫 Bloqueio 403. Pulando empresa.");
          continuarPaginacao = false; 
          break; 

        } else { 
          Logger.log("      Erro desconhecido. Pulando página.");
          pIdx++;
        }
      }
    } 

    // Garante gravação do buffer restante ao terminar empresa
    if (bufferLinhas.length > 0) {
       appendDirectToSheet(ssId, sheetName, bufferLinhas);
       bufferLinhas = [];
       props.setProperty('PED_TOTAL_REGS', totalImportadoGeral.toString());
    }

    if (precisaAgendar) break;
    pIdx = 1;
    paginasInuteis = 0;
  } 

  if (precisaAgendar) {
    Logger.log("🔄 Agendando retomada automática em 30s...");
    ScriptApp.newTrigger('motorProcessamentoPedidos').timeBased().after(30 * 1000).create();
    return 0;

  } else {
    limparMemoriaSegura('PED_');
    limparGatilhosSafe();
    
    var sheet = ss.getSheetByName(sheetName);
    if (sheet) {
      if (totalImportadoGeral === 0 && sheet.getLastRow() > 1) {
        totalImportadoGeral = sheet.getLastRow() - 1;
      }
      var colStatus = CONFIG_PEDIDOS.headers.length + 1;
      var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM HH:mm");
      sheet.getRange(1, colStatus)
           .setValue("Atualizado: " + agora)
           .setBackground("#D9EAD3")
           .setFontWeight("bold");
    }
    
    Logger.log("🏆 IMPORTAÇÃO CONCLUÍDA! Total de linhas: " + totalImportadoGeral);
    return totalImportadoGeral;
  }
}

// ============================================================================
// 🛠️ FUNÇÕES DE SUPORTE
// ============================================================================

function parseUnicoPedido(p, sigla) {
  var dados = []; 
  var cab   = p.cabecalho_consulta || {}; 
  var prods = p.produtos_consulta  || [];
  if (prods.length === 0) {
    dados.push(montarLinha(sigla, cab, {})); 
  } else {
    for (var j = 0; j < prods.length; j++) dados.push(montarLinha(sigla, cab, prods[j])); 
  }
  return dados;
}

function montarLinha(sigla, cab, prod) {
  var toNum = function(v) { return parseFloat(v || 0); };
  return [
    sigla,
    cab.nCodPed||"", cab.cNumero||"", cab.cCodCateg||"", cab.cEtapa||"",
    cab.dIncData||"", cab.cIncHora||"", cab.nCodFor||"", cab.cCodIntFor||"",
    cab.cContato||"", cab.cCodParc||"", toNum(cab.nQtdeParc), cab.dDtPrevisao||"",
    cab.nCodCC||"", cab.nCodIntCC||"", cab.nCodCompr||"", cab.nCodProj||"",
    cab.cCodIntPed||"", cab.cNumPedido||"", cab.cContrato||"",
    cab.cObs||"", cab.cObsInt||"", toNum(cab.nTotalPedido),
    cab.cCodStatus||"", cab.cDescStatus||"", cab.cRecebido||"",
    cab.dDataRecebimento||"", cab.dDtFaturamento||"", cab.cNumeroNF||"", 
    prod.nCodItem||"", prod.nCodProd||"", prod.cCodIntProd||"",
    prod.cProduto||"", prod.cDescricao||"", prod.cUnidade||"",
    toNum(prod.nQtde), toNum(prod.nValUnit), toNum(prod.nValTot), toNum(prod.nDesconto),
    toNum(prod.nFrete), toNum(prod.nSeguro), toNum(prod.nDespesas),
    prod.codigo_local_estoque||"", prod.cEAN||"", prod.cNCM||"",
    toNum(prod.nQtdeRec), toNum(prod.nPesoBruto), toNum(prod.nPesoLiq),
    prod.cCodIntItem||"", toNum(prod.nValMerc), toNum(prod.nValorCofins),
    toNum(prod.nValorIcms), toNum(prod.nValorIpi), toNum(prod.nValorPis), toNum(prod.nValorSt)
  ];
}

function fetchOmieSmart(url, payload) {
  var tentativas = 0;
  while (tentativas < 4) {
    try {
      var opt = { 
        "method": "post", 
        "contentType": "application/json", 
        "payload": JSON.stringify(payload), 
        "muteHttpExceptions": true,
        "deadline": 25
      };
      var resp = UrlFetchApp.fetch(url, opt);
      var code = resp.getResponseCode();
      var body = resp.getContentText();
      
      if (code === 200) return JSON.parse(body);
      
      Logger.log("fetchOmieSmart HTTP " + code + ": " + body.substring(0, 200));
      if (code >= 500) throw new Error("HTTP 500: " + body.substring(0, 200));
      return JSON.parse(body);
      
    } catch (e) {
      tentativas++; 
      if (tentativas === 4) throw e; 
      Utilities.sleep(Math.pow(2, tentativas) * 1000);
    }
  }
}

function appendDirectToSheet(ssId, sheetName, values) {
  var t = 0; 
  while (t < 3) { 
    try { 
      Sheets.Spreadsheets.Values.append(
        {values: values}, ssId, sheetName + "!A1", 
        {valueInputOption: "USER_ENTERED"}
      ); 
      return; 
    } catch (e) { 
      t++; 
      Logger.log("⚠️ Erro Append (" + t + "): " + e.message);
      Utilities.sleep(2000 * t); 
      if (t === 3) throw e; 
    }
  }
}

function limparGatilhosSafe() { 
  try { 
    var triggers = ScriptApp.getProjectTriggers(); 
    for (var i = 0; i < triggers.length; i++) {
      if (triggers[i].getHandlerFunction() === 'motorProcessamentoPedidos') {
        ScriptApp.deleteTrigger(triggers[i]);
      }
    }
  } catch(e) { 
    Logger.log("⚠️ Erro ao limpar gatilhos: " + e.message); 
  }
}

function limparMemoriaSegura(prefixo) {
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys();
  for (var k of keys) {
    if (k.indexOf(prefixo) === 0) props.deleteProperty(k);
  }
}
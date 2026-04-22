// ============================================================================
// 🏆 SCRIPT RECEBIMENTO NFe - V8.1 (COMPATÍVEL ORQUESTRADOR V3)
// 1. Return Count: Retorna total de recebimentos importados.
// 2. Lock: Proteção contra execução duplicada (REC_PROCESSANDO).
// 3. Estratégia: Temp Sheet + Commit Final (Mantida).
// ============================================================================

// ============================================================================
// 🎮 0. PAINEL DE CONTROLE
// ============================================================================

var OPCOES_REC = {
  empresasAlvo: ["SF"], 
  diasRetroagir: 365
};

// ============================================================================
// ⚙️ 1. CONFIGURAÇÕES TÉCNICAS
// ============================================================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_REC = {
  url: "https://app.omie.com.br/api/v1/produtos/recebimentonfe/",
  metodo: "ListarRecebimentos",
  nomePlanilha: "RecebimentoNFe",
  cor: "#8E44AD",
  headers: [
    "Empresa", "ID Receb", "Chave NFe", "ID Forn", "Razão Social", "Nome Fantasia", 
    "CNPJ/CPF", "Num NFe", "Série", "Modelo", "Emissão", 
    "Valor NFe", "Natureza Op", "Etapa", "Faturado", "Dt Fat", 
    "Recebido", "Dt Rec", "Autorizado", "Cancelada", "Bloqueado", 
    "Denegado", "Operação", "Dt Inc", "Hr Inc", "User Inc", 
    "Dt Alt", "Hr Alt", "User Alt", "Total NFe", "Total Prod", 
    "Vlr Frete", "Vlr Desc", "Vlr Seguro", "Outras Desp", "Vlr ICMS", 
    "ICMS ST", "Vlr IPI", "Vlr PIS", "Vlr COFINS", "Cod Parc", 
    "Qtd Parc", "Categ Compra", "ID Conta", "Dt Reg", "ID Proj", 
    "ID Pedido", "Num Pedido", "ID Item Ped", "Tem Vínculo"
  ]
};

// ============================================================================
// 🚀 2. LANÇADOR (START)
// ============================================================================

function executarImportacaoRecebimentoTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // Proteção de Lock Externo
  if (props.getProperty('REC_PROCESSANDO') === 'TRUE' && props.getProperty('LOCK_REC_EXTERNO') === 'TRUE') {
     Logger.log('⚠️ Importação Recebimento já está rodando. Ignorando.');
     return 0;
  }
  
  if (props.getProperty('REC_PROCESSANDO') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando Recebimento NFe V8.1...");
    
    // 🛡️ LIMPEZA SEGURA: Apaga apenas REC_*
    limparMemoriaSegura('REC_');
    limparGatilhos(); 
    
    props.setProperty('REC_TARGET_EMPS', JSON.stringify(OPCOES_REC.empresasAlvo));
    
    var hoje = new Date();
    var dtIni = new Date();
    dtIni.setDate(hoje.getDate() - OPCOES_REC.diasRetroagir);
    
    var strDtIni = Utilities.formatDate(dtIni, "America/Sao_Paulo", "dd/MM/yyyy");
    var strDtFim = Utilities.formatDate(hoje, "America/Sao_Paulo", "dd/MM/yyyy");
    
    props.setProperty('REC_DT_INI', strDtIni);
    props.setProperty('REC_DT_FIM', strDtFim);
    
    // Limpa Temp
    var nomeSheetTemp = "TEMP_" + CONFIG_REC.nomePlanilha;
    var tOld = ss.getSheetByName(nomeSheetTemp);
    if (tOld) { try { ss.deleteSheet(tOld); } catch(e){} }

    Logger.log("🟢 2. LANÇADOR: Transferindo para o Motor...");
    SpreadsheetApp.flush();
  }
  
  // 🔥 CHAMA O MOTOR
  return motorProcessamentoRecebimento();
}

// ============================================================================
// ⚙️ 3. MOTOR (COM CONTADOR)
// ============================================================================

function motorProcessamentoRecebimento() {
  Logger.log("⚙️ 3. MOTOR: Ligado!");
  
  var horaInicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId(); 
  var props = PropertiesService.getScriptProperties();
  var estado = props.getProperties();
  
  // Define Lock Interno
  props.setProperty('REC_PROCESSANDO', 'TRUE');
  
  var processando = (estado['REC_PROCESSANDO'] === 'TRUE');
  var eIdx = parseInt(estado['REC_IDX_EMP'] || "0");
  var pIdx = parseInt(estado['REC_IDX_PAG'] || "1");
  
  // Recupera total acumulado
  var totalImportadoGeral = parseInt(estado['REC_TOTAL_REGS'] || "0");
  
  var listaEmpresas = JSON.parse(estado['REC_TARGET_EMPS'] || '["SF"]');
  var dataInicial = estado['REC_DT_INI'] || Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy");
  var dataFinal = estado['REC_DT_FIM'] || Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy");

  if (!processando) {
    var nomeSheetTemp = "TEMP_" + CONFIG_REC.nomePlanilha;
    var sheetTemp = ss.getSheetByName(nomeSheetTemp);
    if (!sheetTemp) {
      sheetTemp = ss.insertSheet(nomeSheetTemp);
      sheetTemp.hideSheet(); 
      escreverViaApiSafe(ssId, nomeSheetTemp + "!A1", [CONFIG_REC.headers]);
    }
  } else {
    Logger.log("🔄 MOTOR: Retomando (Emp " + eIdx + ", Pág " + pIdx + ")");
  }

  var precisaAgendar = false;
  var nomeSheetTemp = "TEMP_" + CONFIG_REC.nomePlanilha;

  for (var e = eIdx; e < listaEmpresas.length; e++) {
    var sigla = listaEmpresas[e];
    if (e > eIdx) pIdx = 1;
    
    var empresa = EMPRESAS_OMIE[sigla];
    if (!empresa) { continue; }

    var continuarPaginacao = true;
    var bufferLinhas = []; 

    while (continuarPaginacao) {
      if ((new Date().getTime() - horaInicio) > 270000) { 
        if (bufferLinhas.length > 0) appendViaApiSafe(ssId, nomeSheetTemp + "!A1", bufferLinhas);
        
        Logger.log("⏳ MOTOR: Tempo esgotado. Agendando...");
        props.setProperties({ 
            'REC_IDX_EMP': e.toString(), 
            'REC_IDX_PAG': pIdx.toString(), 
            'REC_PROCESSANDO': 'TRUE',
            'REC_TOTAL_REGS': totalImportadoGeral.toString()
        });
        precisaAgendar = true;
        continuarPaginacao = false;
        break;
      }

      Logger.log("   ⬇️ REC | " + sigla + " | Pág " + pIdx);

      try {
        var payload = {
          "call": CONFIG_REC.metodo,
          "app_key": empresa.appKey, 
          "app_secret": empresa.appSecret, 
          "param": [{
            "nPagina": pIdx,
            "nRegistrosPorPagina": 100,
            "cExibirDetalhes": "S", 
            "dtEmissaoDe": dataInicial,
            "dtEmissaoAte": dataFinal
          }]
        };

        var data = fetchOmieSmart(CONFIG_REC.url, payload);

        if (data.faultstring) {
          if (data.faultstring.indexOf("N\u00e3o existem") > -1) {
             continuarPaginacao = false; break;
          }
          throw new Error(data.faultstring);
        }

        var docs = data.recebimentos || [];
        var qtdRecebida = docs.length;
        if (qtdRecebida === 100) continuarPaginacao = true; 
        else continuarPaginacao = false;
        
        var linhas = parseRecebimentos(docs); 
        var linhasComSigla = linhas.map(l => [sigla].concat(l)); 

        if (linhasComSigla.length > 0) {
            bufferLinhas = bufferLinhas.concat(linhasComSigla);
            totalImportadoGeral += linhasComSigla.length; // Soma ao total
        }

        if (bufferLinhas.length >= 500) {
           appendViaApiSafe(ssId, nomeSheetTemp + "!A1", bufferLinhas);
           bufferLinhas = [];
           // Salva parcial
           props.setProperty('REC_TOTAL_REGS', totalImportadoGeral.toString());
        }

        pIdx++;

      } catch (err) {
        if (bufferLinhas.length > 0) { appendViaApiSafe(ssId, nomeSheetTemp + "!A1", bufferLinhas); bufferLinhas = []; }
        var m = err.message;
        if (m.indexOf("N\u00e3o existem") > -1) { continuarPaginacao = false; } 
        else if (m.indexOf("timed out") > -1) {
           props.setProperties({ 'REC_IDX_EMP': e.toString(), 'REC_IDX_PAG': pIdx.toString(), 'REC_PROCESSANDO': 'TRUE', 'REC_TOTAL_REGS': totalImportadoGeral.toString() });
           precisaAgendar = true; continuarPaginacao = false; break;
        } else { 
           Logger.log("      ⚠️ Erro ignorado: " + m); continuarPaginacao = false; break; 
        }
      }
    } 

    if (bufferLinhas.length > 0) { appendViaApiSafe(ssId, nomeSheetTemp + "!A1", bufferLinhas); bufferLinhas = []; }
    if (precisaAgendar) break;
    pIdx = 1;
  } 

  if (precisaAgendar) {
    ScriptApp.newTrigger('motorProcessamentoRecebimento').timeBased().after(100).create();
    return 0; // Ainda rodando

  } else {
    Logger.log("💾 MOTOR: Finalizando e salvando...");
    var sheetTemp = ss.getSheetByName(nomeSheetTemp);
    
    // Se o contador estiver zerado mas tiver dados na Temp, tenta recuperar o count da Temp
    if (totalImportadoGeral === 0 && sheetTemp && sheetTemp.getLastRow() > 1) {
        totalImportadoGeral = sheetTemp.getLastRow() - 1;
    }

    if (sheetTemp) commitarDadosSolidoRec(ss, CONFIG_REC, sheetTemp);
    
    // 🛡️ LIMPEZA SEGURA FINAL
    limparMemoriaSegura('REC_');
    limparGatilhos();
    Logger.log("🏆 CONCLUÍDO! Total: " + totalImportadoGeral);
    
    return totalImportadoGeral;
  }
}

// ============================================================================
// 🛠️ PARSING
// ============================================================================

function parseRecebimentos(lista) {
  var dados = [];
  for (var i = 0; i < lista.length; i++) {
    var r = lista[i];
    var c = r.cabec || {}; var ic = r.infoCadastro || {}; var ia = r.infoAdicionais || {}; var t = r.totais || {};
    var nIdP = "", cNumP = "", nIdItP = "", temV = "NÃO";
    if (r.itensRecebimento && r.itensRecebimento.length > 0) {
      var itC = r.itensRecebimento[0].itensCabec || {};
      if (itC.nIdPedido) { nIdP = itC.nIdPedido; cNumP = itC.cNumPedido || itC.cNumero || ""; nIdItP = itC.nIdItPedido; temV = "SIM"; }
    }
    dados.push([
      c.nIdReceb||"", c.cChaveNfe||"", c.nIdFornecedor||"", c.cRazaoSocial||"", c.cNome||"", 
      c.cCNPJ_CPF||"", c.cNumeroNFe||"", c.cSerieNFe||"", c.cModeloNFe||"", c.dEmissaoNFe||"", 
      parseFloat(c.nValorNFe||0), c.cNaturezaOperacao||"", c.cEtapa||"", ic.cFaturado||"", ic.dFat||"", 
      ic.cRecebido||"", ic.dRec||"", ic.cAutorizado||"", ic.cCancelada||"", ic.cBloqueado||"", 
      ic.cDenegado||"", ic.cOperacao||"", ic.dInc||"", ic.hInc||"", ic.cUsuarioInc||"", 
      ic.dAlt||"", ic.hAlt||"", ic.cUsuarioAlt||"", parseFloat(t.vTotalNFe||0), parseFloat(t.vTotalProdutos||0), 
      parseFloat(t.vFrete||0), parseFloat(t.vDesconto||0), parseFloat(t.vSeguro||0), parseFloat(t.vOutrasDespesas||0), parseFloat(t.vICMS||0), 
      parseFloat(t.vICMSST||0), parseFloat(t.vIPI||0), parseFloat(t.vPIS||0), parseFloat(t.vCOFINS||0), 
      (r.parcelas && r.parcelas.cCodParcela)||"", (r.parcelas && r.parcelas.nQtdParcela)||0, 
      ia.cCategCompra||"", ia.nIdConta||"", ia.dRegistro||"", ia.nIdProjeto||"", 
      nIdP, cNumP, nIdItP, temV
    ]);
  }
  return dados;
}

// ============================================================================
// 🧱 COMUNICAÇÃO
// ============================================================================

function commitarDadosSolidoRec(ss, config, sheetTemp) {
  var nomeOficial = config.nomePlanilha;
  var sheetOficial = ss.getSheetByName(nomeOficial);
  if (!sheetOficial) sheetOficial = ss.insertSheet(nomeOficial);
  
  try {
    var rangeTemp = sheetTemp.getDataRange();
    var values = rangeTemp.getValues();
    
    if (values.length > 1) { 
      try { sheetOficial.clear(); } catch(e) {}
      var sucesso = false; var t = 0;
      while (t < 3 && !sucesso) {
        try { sheetOficial.getRange(1, 1, values.length, values[0].length).setValues(values); sucesso = true; }
        catch(e) { t++; Utilities.sleep(3000); }
      }
      if (!sucesso) throw new Error("Timeout escrita.");

      sheetOficial.getRange(1, 1, 1, values[0].length).setFontWeight("bold").setBackground(config.cor).setFontColor("white");
      sheetOficial.setFrozenRows(1);
      try { sheetOficial.getRange(2, 12, values.length-1, 1).setNumberFormat("#,##0.00"); } catch(e){}
      
      SpreadsheetApp.flush(); 
      try { ss.deleteSheet(sheetTemp); } catch(e) {}
    } else { try { ss.deleteSheet(sheetTemp); } catch(e){} }
  } catch (e) { Logger.log("❌ ERRO COMMIT: " + e.message); }
}

function fetchOmieSmart(url, payload) {
  var tentativas = 0;
  while (tentativas < 4) {
    try {
      var opt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
      var resp = UrlFetchApp.fetch(url, opt);
      if (resp.getResponseCode() === 200) return JSON.parse(resp.getContentText());
      if (resp.getResponseCode() >= 500) throw new Error("HTTP 500");
      return JSON.parse(resp.getContentText());
    } catch (e) { tentativas++; if (tentativas === 4) throw e; Utilities.sleep(Math.pow(2, tentativas) * 1000); }
  }
}

function appendViaApiSafe(ssId, range, values) {
  var t = 0; while (t < 3) { try { Sheets.Spreadsheets.Values.append({ values: values }, ssId, range, { valueInputOption: "USER_ENTERED" }); return; } catch (e) { t++; Utilities.sleep(1000 * t); } }
}

function escreverViaApiSafe(ssId, range, values) {
  try { Sheets.Spreadsheets.Values.update({ values: values }, ssId, range, { valueInputOption: "USER_ENTERED" }); } catch (e) {}
}

function limparGatilhos() { 
  var t = ScriptApp.getProjectTriggers(); 
  for(var i=0; i<t.length; i++) if(t[i].getHandlerFunction() === 'motorProcessamentoRecebimento') ScriptApp.deleteTrigger(t[i]); 
}

// 🔥 LIMPEZA SEGURA
function limparMemoriaSegura(prefixo) {
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys();
  for (var k of keys) {
    if (k.indexOf(prefixo) === 0) props.deleteProperty(k);
  }
}
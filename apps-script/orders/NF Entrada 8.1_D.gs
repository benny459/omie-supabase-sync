// ============================================================================
// 🏆 SCRIPT NFE ENTRADA - V8.1 (COMPATÍVEL ORQUESTRADOR V3)
// 1. Return Count: Retorna total de notas importadas.
// 2. Lock: Proteção contra execução duplicada (NFE_PROCESSANDO).
// 3. Estratégia: Temp Sheet + Commit Final (Mantida).
// ============================================================================

// ============================================================================
// 🎮 0. PAINEL DE CONTROLE
// ============================================================================

var OPCOES_NFE = {
  empresasAlvo: ["SF"], 
  mesesRetroagir: 24
};

// ============================================================================
// ⚙️ 1. CONFIGURAÇÕES TÉCNICAS
// ============================================================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_NFE = {
  url: "https://app.omie.com.br/api/v1/contador/xml/",
  metodo: "ListarDocumentos",
  nomePlanilha: "NFe_Entrada",
  cor: "#16A085",
  headers: ["Empresa", "Número", "Série", "Chave Acesso", "Emissão", "Hora", "Valor", "Status", "ID NF", "ID Pedido", "ID Receb", "Pedido XML"]
};

// ============================================================================
// 🚀 2. LANÇADOR (START)
// ============================================================================

function executarImportacaoNFeTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // Proteção de Lock Externo
  if (props.getProperty('NFE_PROCESSANDO') === 'TRUE' && props.getProperty('LOCK_NFE_EXTERNO') === 'TRUE') {
     Logger.log('⚠️ Importação NFe já está rodando. Ignorando.');
     return 0;
  }
  
  if (props.getProperty('NFE_PROCESSANDO') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando NFe V8.1 (Smart)...");
    
    // 🛡️ LIMPEZA SEGURA: Apaga apenas NFE_*
    limparMemoriaSegura('NFE_');
    limparGatilhos(); 
    
    props.setProperty('NFE_TARGET_EMPS', JSON.stringify(OPCOES_NFE.empresasAlvo));
    
    var hoje = new Date();
    var dtIni = new Date();
    dtIni.setMonth(hoje.getMonth() - OPCOES_NFE.mesesRetroagir);
    
    var strDtIni = Utilities.formatDate(dtIni, "America/Sao_Paulo", "dd/MM/yyyy");
    var strDtFim = Utilities.formatDate(hoje, "America/Sao_Paulo", "dd/MM/yyyy");
    
    props.setProperty('NFE_DT_INI', strDtIni);
    props.setProperty('NFE_DT_FIM', strDtFim);
    
    var nomeSheetTemp = "TEMP_" + CONFIG_NFE.nomePlanilha;
    var tOld = ss.getSheetByName(nomeSheetTemp);
    if (tOld) { try { ss.deleteSheet(tOld); } catch(e){} }

    Logger.log("🟢 2. LANÇADOR: Transferindo para o Motor...");
    SpreadsheetApp.flush();
  }
  
  // 🔥 CHAMA O MOTOR
  return motorProcessamentoNFe();
}

// ============================================================================
// ⚙️ 3. MOTOR (COM CONTADOR)
// ============================================================================

function motorProcessamentoNFe() {
  Logger.log("⚙️ 3. MOTOR: Ligado!");
  
  var horaInicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId(); 
  var props = PropertiesService.getScriptProperties();
  var estado = props.getProperties();
  
  // Define Lock Interno
  props.setProperty('NFE_PROCESSANDO', 'TRUE');
  
  var processando = (estado['NFE_PROCESSANDO'] === 'TRUE');
  var eIdx = parseInt(estado['NFE_IDX_EMP'] || "0");
  var pIdx = parseInt(estado['NFE_IDX_PAG'] || "1");
  
  // Recupera total acumulado
  var totalImportadoGeral = parseInt(estado['NFE_TOTAL_REGS'] || "0");
  
  var listaEmpresas = JSON.parse(estado['NFE_TARGET_EMPS'] || '["SF"]');
  var dataInicial = estado['NFE_DT_INI'] || Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy");
  var dataFinal = estado['NFE_DT_FIM'] || Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy");

  if (!processando) {
    var nomeSheetTemp = "TEMP_" + CONFIG_NFE.nomePlanilha;
    var sheetTemp = ss.getSheetByName(nomeSheetTemp);
    if (!sheetTemp) {
      sheetTemp = ss.insertSheet(nomeSheetTemp);
      sheetTemp.hideSheet(); 
      escreverViaApiSafe(ssId, nomeSheetTemp + "!A1", [CONFIG_NFE.headers]);
    }
  } else {
    Logger.log("🔄 MOTOR: Retomando (Emp " + eIdx + ", Pág " + pIdx + ")");
  }

  var precisaAgendar = false;
  var nomeSheetTemp = "TEMP_" + CONFIG_NFE.nomePlanilha;

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
            'NFE_IDX_EMP': e.toString(), 
            'NFE_IDX_PAG': pIdx.toString(), 
            'NFE_PROCESSANDO': 'TRUE',
            'NFE_TOTAL_REGS': totalImportadoGeral.toString()
        });
        precisaAgendar = true;
        continuarPaginacao = false;
        break;
      }

      Logger.log("   ⬇️ NFe | " + sigla + " | Pág " + pIdx + " (" + dataInicial + " - " + dataFinal + ")");

      try {
        var payload = {
          "call": CONFIG_NFE.metodo,
          "app_key": empresa.appKey, 
          "app_secret": empresa.appSecret, 
          "param": [{
            "nPagina": pIdx,
            "nRegPorPagina": 100, 
            "cModelo": "55",
            "cOperacao": "0",
            "dEmiInicial": dataInicial,
            "dEmiFinal": dataFinal
          }]
        };

        var data = fetchOmieSmart(CONFIG_NFE.url, payload);

        if (data.faultstring) {
          if (data.faultstring.indexOf("N\u00e3o existem") > -1) {
             continuarPaginacao = false; break;
          }
          throw new Error(data.faultstring);
        }

        var docs = data.documentosEncontrados || [];
        var qtdRecebida = docs.length;
        if (qtdRecebida === 100) continuarPaginacao = true; 
        else continuarPaginacao = false;
        
        var linhas = parseNFe(data, sigla);
        if (linhas.length > 0) {
            bufferLinhas = bufferLinhas.concat(linhas);
            totalImportadoGeral += linhas.length; // Soma ao total
        }

        if (bufferLinhas.length >= 500) {
           appendViaApiSafe(ssId, nomeSheetTemp + "!A1", bufferLinhas);
           bufferLinhas = [];
           // Salva parcial
           props.setProperty('NFE_TOTAL_REGS', totalImportadoGeral.toString());
        }

        pIdx++; 

      } catch (err) {
        if (bufferLinhas.length > 0) { appendViaApiSafe(ssId, nomeSheetTemp + "!A1", bufferLinhas); bufferLinhas = []; }
        var m = err.message;
        
        if (m.indexOf("N\u00e3o existem") > -1) { continuarPaginacao = false; break; } 
        else if (m.indexOf("timed out") > -1) {
           props.setProperties({ 'NFE_IDX_EMP': e.toString(), 'NFE_IDX_PAG': pIdx.toString(), 'NFE_PROCESSANDO': 'TRUE', 'NFE_TOTAL_REGS': totalImportadoGeral.toString() });
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
    ScriptApp.newTrigger('motorProcessamentoNFe').timeBased().after(100).create();
    return 0; // Ainda rodando

  } else {
    Logger.log("💾 MOTOR: Finalizando e salvando...");
    var sheetTemp = ss.getSheetByName(nomeSheetTemp);
    
    // Recupera contagem real da temp caso o contador tenha se perdido (segurança)
    if (totalImportadoGeral === 0 && sheetTemp && sheetTemp.getLastRow() > 1) {
        totalImportadoGeral = sheetTemp.getLastRow() - 1;
    }

    if (sheetTemp) commitarDadosSolidoNFe(ss, CONFIG_NFE, sheetTemp);
    
    // 🛡️ LIMPEZA SEGURA FINAL
    limparMemoriaSegura('NFE_');
    limparGatilhos();
    Logger.log("🏆 CONCLUÍDO! Total: " + totalImportadoGeral);
    
    return totalImportadoGeral;
  }
}

// ============================================================================
// 🛠️ PARSING
// ============================================================================

function parseNFe(data, sigla) {
  var l = []; var docs = data.documentosEncontrados || [];
  for (var i = 0; i < docs.length; i++) {
    var d = docs[i]; var pedidoXML = extrairPedidoDoXml(d.cXml);
    l.push([sigla, d.nNumero||"", d.cSerie||"", d.nChave||"", d.dEmissao||"", d.hEmissao||"", parseFloat(d.nValor||0), d.cStatus||"", d.nIdNF||"", d.nIdPedido||"", d.nIdReceb||"", pedidoXML]);
  }
  return l;
}

function extrairPedidoDoXml(xml) {
  if (!xml) return "";
  xml = xml.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
  var match = xml.match(/<xPed>(\d+)<\/xPed>/);
  if (match && match[1]) return match[1];
  return "";
}

// ============================================================================
// 🧱 COMUNICAÇÃO
// ============================================================================

function commitarDadosSolidoNFe(ss, config, sheetTemp) {
  var nomeOficial = config.nomePlanilha;
  var sheetOficial = ss.getSheetByName(nomeOficial);
  if (!sheetOficial) sheetOficial = ss.insertSheet(nomeOficial);
  
  try {
    var rangeTemp = sheetTemp.getDataRange();
    var values = rangeTemp.getValues();
    
    if (values.length > 1) { 
      try { sheetOficial.clear(); } catch(e) {}
      
      var sucessoEscrita = false; var tentativas = 0;
      while (tentativas < 3 && !sucessoEscrita) {
        try { sheetOficial.getRange(1, 1, values.length, values[0].length).setValues(values); sucessoEscrita = true; }
        catch(e) { tentativas++; Utilities.sleep(3000); }
      }
      if (!sucessoEscrita) throw new Error("Timeout escrita.");

      sheetOficial.getRange(1, 1, 1, config.headers.length).setFontWeight("bold").setBackground(config.cor).setFontColor("white");
      sheetOficial.setFrozenRows(1);
      try { sheetOficial.getRange(2, 7, values.length-1, 1).setNumberFormat("#,##0.00"); } catch(e){}
      try { sheetOficial.getRange(2, 2, values.length-1, 3).setNumberFormat("@"); } catch(e){}

      escreverStatusNFe(sheetOficial, "Sucesso. " + (values.length-1) + " notas.", "ok");
      SpreadsheetApp.flush(); 
      try { ss.deleteSheet(sheetTemp); } catch(e) {}
    } else {
      escreverStatusNFe(sheetOficial, "Conexão OK. Sem notas.", "aviso");
      try { ss.deleteSheet(sheetTemp); } catch(e){}
    }
  } catch (e) { Logger.log("❌ ERRO COMMIT: " + e.message); }
}

function escreverStatusNFe(sheet, msg, tipo) { 
  if (!sheet) return; 
  var icone = "✅"; var corFundo = "#D9EAD3"; var corTexto = "#155724"; 
  if (tipo === "erro") { icone = "❌"; corFundo = "#F4CCCC"; corTexto = "#721C24"; }
  else if (tipo === "aviso") { icone = "⚠️"; corFundo = "#FFF2CC"; corTexto = "#856404"; }
  
  var horario = new Date().toLocaleTimeString("pt-BR", {hour: '2-digit', minute:'2-digit', second:'2-digit'});
  var textoFinal = icone + " " + horario + "\n" + msg;

  var celula = sheet.getRange("Z1"); 
  celula.setValue(textoFinal).setBackground(corFundo).setFontColor(corTexto).setFontWeight("bold")
        .setWrap(true).setVerticalAlignment("middle").setHorizontalAlignment("center");
  try { sheet.setColumnWidth(26, 200); } catch(e){}
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
  try { Sheets.Spreadsheets.Values.update({ values: values }, ssId, range, { valueInputOption: "USER_ENTERED" }); } catch (e) { Utilities.sleep(1000); try { Sheets.Spreadsheets.Values.update({ values: values }, ssId, range, { valueInputOption: "USER_ENTERED" }); } catch(e){} }
}

function limparGatilhos() { 
  var t = ScriptApp.getProjectTriggers(); 
  for(var i=0; i<t.length; i++) if(t[i].getHandlerFunction() === 'motorProcessamentoNFe') ScriptApp.deleteTrigger(t[i]); 
}

// 🔥 LIMPEZA SEGURA (ESSENCIAL)
function limparMemoriaSegura(prefixo) {
  var props = PropertiesService.getScriptProperties();
  var keys = props.getKeys();
  for (var k of keys) {
    if (k.indexOf(prefixo) === 0) props.deleteProperty(k);
  }
}
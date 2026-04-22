// ============================================================================
// ⚙️ SCRIPT AUXILIARES COMPRAS - V3.1 (COMPATÍVEL ORQUESTRADOR)
// 1. Return Count: Retorna SOMA de todos os registros importados.
// 2. Lock: Proteção contra execução duplicada (LOCK_AUX).
// 3. Estratégia: Loop de Tarefas (Etapas + FormasPgto).
// ============================================================================

// ============================================================================
// ⚙️ 1. CONFIGURAÇÕES
// ============================================================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" }
};

var CADASTROS_AUXILIARES = [
  {
    key: "EtapasFaturamento",
    url: "https://app.omie.com.br/api/v1/produtos/etapafat/",
    metodo: "ListarEtapasFaturamento",
    nomePlanilha: "EtapasFaturamento",
    cor: "#FF5630",
    temArrayAninhado: true,
    campoAninhado: "etapas",
    headers: ["Empresa", "Cód Operação", "Desc Operação", "Cód Etapa", "Desc Padrão", "Desc Etapa", "Inativo"]
  },
  {
    key: "FormasPagamento",
    url: "https://app.omie.com.br/api/v1/produtos/formaspagvendas/",
    metodo: "ListarFormasPagVendas",
    nomePlanilha: "FormasPagamento",
    cor: "#0052CC",
    temArrayAninhado: false,
    headers: ["Empresa", "Código", "Descrição", "Nº Parcelas"]
  }
];

// ============================================================================
// 🚀 2. LANÇADOR
// ============================================================================

function executarImportacaoCadastrosAuxiliaresTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // Proteção de Lock Externo
  if (props.getProperty('LOCK_AUX') === 'TRUE' && props.getProperty('AUX_PROCESSANDO') !== 'TRUE') {
     Logger.log('⚠️ Importação Auxiliares já está rodando. Ignorando.');
     return 0;
  }
  
  // Se não estiver processando internamente, inicia limpeza
  if (props.getProperty('AUX_PROCESSANDO') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando limpeza geral...");
    
    // Limpa apenas variáveis deste script
    const chavesLimpar = ['AUX_PROCESSANDO', 'AUX_IDX_TAREFA', 'AUX_IDX_EMP', 'AUX_IDX_PAG', 'AUX_TOTAL_REGS'];
    chavesLimpar.forEach(k => props.deleteProperty(k));
    
    limparGatilhos(); 
    props.setProperty('LOCK_AUX', 'TRUE');
    
    // Limpa abas temporárias
    for (var i = 0; i < CADASTROS_AUXILIARES.length; i++) {
      var nomeSheetTemp = "TEMP_" + CADASTROS_AUXILIARES[i].nomePlanilha;
      var tOld = ss.getSheetByName(nomeSheetTemp);
      if (tOld) { try { ss.deleteSheet(tOld); } catch(e){} }
    }
  }

  // 🔥 CHAMA O MOTOR
  return motorProcessamentoCadastros();
}

// ============================================================================
// ⚙️ 3. MOTOR (PROCESSAMENTO COM RETOMADA + CONTADOR)
// ============================================================================

function motorProcessamentoCadastros() {
  Logger.log("⚙️ 3. MOTOR: Ligado!");
  
  var horaInicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId(); 
  var props = PropertiesService.getScriptProperties();
  
  // Garante lock
  props.setProperty('LOCK_AUX', 'TRUE');
  
  var estado = props.getProperties();
  var processando = (estado['AUX_PROCESSANDO'] === 'TRUE');
  
  var tIdx = parseInt(estado['AUX_IDX_TAREFA'] || "0"); 
  var eIdx = parseInt(estado['AUX_IDX_EMP'] || "0");    
  var pIdx = parseInt(estado['AUX_IDX_PAG'] || "1");    
  
  // Recupera total acumulado de execuções parciais
  var totalImportadoGeral = parseInt(estado['AUX_TOTAL_REGS'] || "0");

  if (!processando) {
    props.setProperty('AUX_PROCESSANDO', 'TRUE');
  } else {
    Logger.log("🔄 MOTOR: Retomando Tarefa " + tIdx + ", Emp " + eIdx + ", Pág " + pIdx);
  }

  var listaEmpresas = ["SF"]; 
  var precisaAgendar = false;

  // === LOOP TAREFAS ===
  for (var t = tIdx; t < CADASTROS_AUXILIARES.length; t++) {
    var config = CADASTROS_AUXILIARES[t];
    var nomeSheetTemp = "TEMP_" + config.nomePlanilha;

    if (t > tIdx) { eIdx = 0; pIdx = 1; }

    var sheetTemp = ss.getSheetByName(nomeSheetTemp);
    if (!sheetTemp) {
      sheetTemp = ss.insertSheet(nomeSheetTemp);
      sheetTemp.hideSheet(); 
      escreverViaApiSafe(ssId, nomeSheetTemp + "!A1", [config.headers]);
    }

    // === LOOP EMPRESAS ===
    for (var e = eIdx; e < listaEmpresas.length; e++) {
      var sigla = listaEmpresas[e];
      if (e > eIdx) pIdx = 1;
      
      var empresa = EMPRESAS_OMIE[sigla];
      var totalPaginas = 1;
      var bufferLinhas = []; 

      // === LOOP PÁGINAS ===
      do {
        if ((new Date().getTime() - horaInicio) > 270000) { 
          if (bufferLinhas.length > 0) appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas);
          
          Logger.log("⏳ MOTOR: Tempo esgotado na tarefa " + config.nomePlanilha + ". Agendando...");
          props.setProperties({ 
            'AUX_IDX_TAREFA': t.toString(),
            'AUX_IDX_EMP': e.toString(), 
            'AUX_IDX_PAG': pIdx.toString(), 
            'AUX_PROCESSANDO': 'TRUE',
            'AUX_TOTAL_REGS': totalImportadoGeral.toString()
          });
          precisaAgendar = true;
          break;
        }

        Logger.log("   ⬇️ " + config.nomePlanilha + " | " + sigla + " | Pág " + pIdx);

        try {
          var payload = {
            "call": config.metodo,
            "app_key": empresa.appKey, 
            "app_secret": empresa.appSecret,
            "param": [{ "pagina": pIdx, "registros_por_pagina": 100 }]
          };

          var data = fetchOmieSmart(config.url, payload);

          if (data.faultstring) {
            if (data.faultstring.indexOf("N\u00e3o existem") > -1) break; 
            throw new Error(data.faultstring);
          }

          totalPaginas = data.total_de_paginas || 1;
          var linhas = parseAuxiliarGenerico(data, sigla, config);
          
          if (linhas.length > 0) bufferLinhas = bufferLinhas.concat(linhas);

          if (bufferLinhas.length >= 500) {
             appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas);
             bufferLinhas = [];
          }

          pIdx++;

        } catch (err) {
          if (bufferLinhas.length > 0) { appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas); bufferLinhas = []; }
          var m = err.message;
          if (m.indexOf("N\u00e3o existem") > -1) break;
          else if (m.indexOf("403") > -1) { Logger.log("      🚫 Bloqueio 403. Pulando empresa."); break; }
          else if (m.indexOf("timed out") > -1) {
             Logger.log("      ⏳ Google Busy. Pausando.");
             props.setProperties({ 'AUX_IDX_TAREFA': t.toString(), 'AUX_IDX_EMP': e.toString(), 'AUX_IDX_PAG': pIdx.toString(), 'AUX_PROCESSANDO': 'TRUE', 'AUX_TOTAL_REGS': totalImportadoGeral.toString() });
             precisaAgendar = true;
             break;
          }
          else { Logger.log("      ⚠️ Erro ignorado: " + m); break; }
        }
      } while (pIdx <= totalPaginas);

      if (bufferLinhas.length > 0) {
         appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas);
         bufferLinhas = [];
      }

      if (precisaAgendar) break;
      pIdx = 1;
    } 

    if (precisaAgendar) break;

    // === COMMIT ===
    Logger.log("💾 MOTOR: Finalizando tarefa " + config.nomePlanilha);
    var qtdComitada = commitarDadosSolidoDinamico(ss, config, sheetTemp);
    totalImportadoGeral += qtdComitada; // Soma ao totalizador geral
    
    // Salva parcial para não perder se o script cair no sleep abaixo
    props.setProperty('AUX_TOTAL_REGS', totalImportadoGeral.toString());
    
    SpreadsheetApp.flush();
    Utilities.sleep(2000);
    
    eIdx = 0; 
    pIdx = 1;
  } 

  if (precisaAgendar) {
    ScriptApp.newTrigger('motorProcessamentoCadastros').timeBased().after(100).create();
    return 0; // Ainda não acabou, retorna 0 pro orquestrador (que vai esperar o lock)

  } else {
    // Limpeza Final
    const chavesLimpar = ['AUX_PROCESSANDO', 'AUX_IDX_TAREFA', 'AUX_IDX_EMP', 'AUX_IDX_PAG', 'AUX_TOTAL_REGS', 'LOCK_AUX'];
    chavesLimpar.forEach(k => props.deleteProperty(k));
    
    limparGatilhos();
    Logger.log("🏆 TODAS AS TAREFAS CONCLUÍDAS! Total: " + totalImportadoGeral);
    // ss.toast("Cadastros Atualizados!", "✅", 5);
    
    return totalImportadoGeral; // ✅ Retorna a soma de todas as tabelas
  }
}

// ============================================================================
// 🛠️ PARSING
// ============================================================================

function parseAuxiliarGenerico(data, sigla, config) {
  var l = [];
  var registros = data.cadastros || []; 
  
  for (var i = 0; i < registros.length; i++) {
    var r = registros[i];
    
    if (config.temArrayAninhado && config.campoAninhado) {
      var filhos = r[config.campoAninhado] || [];
      if (filhos.length > 0) {
        for (var j = 0; j < filhos.length; j++) {
          var f = filhos[j];
          l.push([
            sigla, r.cCodOperacao || "", r.cDescOperacao || "",
            f.cCodigo || "", f.cDescrPadrao || "", f.cDescricao || "", f.cInativo || ""
          ]);
        }
      } else {
        l.push([sigla, r.cCodOperacao || "", r.cDescOperacao || "", "", "", "", ""]);
      }
    } else {
      l.push([ sigla, r.cCodigo || "", r.cDescricao || "", r.nNumeroParcelas || "" ]);
    }
  }
  return l;
}

// ============================================================================
// 🧱 COMMIT BLINDADO (COM RETORNO DE QTD)
// ============================================================================

function commitarDadosSolidoDinamico(ss, config, sheetTemp) {
  var nomeOficial = config.nomePlanilha;
  var sheetOficial = ss.getSheetByName(nomeOficial);
  if (!sheetOficial) sheetOficial = ss.insertSheet(nomeOficial);
  
  var qtdRegistros = 0;
  
  try {
    var rangeTemp = sheetTemp.getDataRange();
    var values = rangeTemp.getValues();
    
    if (values.length > 1) { 
      qtdRegistros = values.length - 1; // Desconta cabeçalho
      
      try { sheetOficial.clear(); } catch(e) { Logger.log("⚠️ Falha leve ao limpar: " + e.message); }
      
      var sucessoEscrita = false;
      var tentativas = 0;
      while (tentativas < 3 && !sucessoEscrita) {
        try {
          sheetOficial.getRange(1, 1, values.length, values[0].length).setValues(values);
          sucessoEscrita = true;
        } catch(e) {
          tentativas++;
          Utilities.sleep(3000);
        }
      }
      
      if (!sucessoEscrita) throw new Error("Google Timeout ao escrever dados na aba oficial.");

      sheetOficial.getRange(1, 1, 1, config.headers.length)
        .setFontWeight("bold").setBackground(config.cor).setFontColor("white");
      sheetOficial.setFrozenRows(1);
      
      var colunaStatus = values[0].length + 1;
      escreverStatusDinamico(sheetOficial, "Sucesso. " + qtdRegistros + " registros.", "ok", colunaStatus);
      
      SpreadsheetApp.flush(); 
      try { ss.deleteSheet(sheetTemp); } catch(e) {}
    } else {
      escreverStatusDinamico(sheetOficial, "Conexão OK. Vazio.", "aviso", config.headers.length + 1);
      try { ss.deleteSheet(sheetTemp); } catch(e){}
    }
  } catch (e) { 
    Logger.log("❌ ERRO COMMIT: " + e.message); 
    try { escreverStatusDinamico(sheetOficial, "Erro: " + e.message, "erro", config.headers.length + 1); } catch(x){}
  }
  
  return qtdRegistros;
}

function escreverStatusDinamico(sheet, msg, tipo, targetCol) { 
  if (!sheet) return; 
  
  var icone = "✅";
  var corFundo = "#D9EAD3"; 
  var corTexto = "#155724"; 
  
  if (tipo === "erro") { icone = "❌"; corFundo = "#F4CCCC"; corTexto = "#721C24"; }
  else if (tipo === "aviso") { icone = "⚠️"; corFundo = "#FFF2CC"; corTexto = "#856404"; }
  
  var horario = new Date().toLocaleTimeString("pt-BR", {hour: '2-digit', minute:'2-digit', second:'2-digit'});
  var textoFinal = icone + " " + horario + "\n" + msg;

  if (!targetCol) targetCol = sheet.getLastColumn() + 1;

  sheet.getRange(1, targetCol).setValue("Status").setBackground("#EFEFEF").setFontColor("#000").setFontWeight("bold");
  sheet.getRange(1, targetCol).setValue(textoFinal)
       .setBackground(corFundo).setFontColor(corTexto).setFontWeight("bold")
       .setWrap(true).setVerticalAlignment("middle").setHorizontalAlignment("center");
  
  try { sheet.setColumnWidth(targetCol, 180); } catch(e){}
}

function fetchOmieSmart(url, payload) {
  var tentativas = 0;
  while (tentativas < 4) {
    try {
      var opt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
      var resp = UrlFetchApp.fetch(url, opt);
      var code = resp.getResponseCode();
      if (code === 200) return JSON.parse(resp.getContentText());
      if (code >= 500 || code === 429) throw new Error("HTTP " + code);
      return JSON.parse(resp.getContentText());
    } catch (e) {
      tentativas++;
      if (tentativas === 4) throw e;
      Utilities.sleep(Math.pow(2, tentativas) * 1000);
    }
  }
}

function appendViaApiSafe(ssId, sheetName, values) {
  var t = 0;
  while (t < 3) {
    try { Sheets.Spreadsheets.Values.append({ values: values }, ssId, sheetName, { valueInputOption: "USER_ENTERED" }); return; }
    catch (e) { t++; Utilities.sleep(1000 * t); if (t === 3) throw e; }
  }
}

function escreverViaApiSafe(ssId, range, values) {
  try { Sheets.Spreadsheets.Values.update({ values: values }, ssId, range, { valueInputOption: "USER_ENTERED" }); }
  catch (e) { Utilities.sleep(1000); try { Sheets.Spreadsheets.Values.update({ values: values }, ssId, range, { valueInputOption: "USER_ENTERED" }); } catch(e){} }
}

function limparGatilhos() { 
  var t = ScriptApp.getProjectTriggers(); 
  for(var i=0; i<t.length; i++) if(t[i].getHandlerFunction() === 'motorProcessamentoCadastros') ScriptApp.deleteTrigger(t[i]); 
}
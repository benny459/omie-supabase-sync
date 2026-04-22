// ============================================================================
// 🛒 SCRIPT PRODUTOS COMPRAS - V3.1 (COMPATÍVEL ORQUESTRADOR)
// 1. Return Count: Retorna total de produtos importados para o Orquestrador.
// 2. Lock: Proteção contra execução duplicada (LOCK_PRODUTOS_COMPRAS).
// 3. Estratégia: Temp Sheet + Commit Final (Mantida).
// ============================================================================

// ============================================================================
// ⚙️ 1. CONFIGURAÇÕES GERAIS
// ============================================================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_PRODUTOS = {
  url: "https://app.omie.com.br/api/v1/geral/produtos/",
  metodo: "ListarProdutos", // Método Completo
  nomePlanilha: "Produtos",
  cor: "#FF6D00",
  headers: ["Empresa", "ID Omie", "Cód. Integração", "SKU (Cód)", "Descrição", "Valor Unit.", "Unidade", "NCM", "EAN", "Marca", "Peso Liq", "Cód. Família"]
};

// ============================================================================
// 🚀 2. LANÇADOR
// ============================================================================

function executarImportacaoProdutosTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // Proteção de Lock para o Orquestrador
  if (props.getProperty('LOCK_PRODUTOS_COMPRAS') === 'TRUE' && props.getProperty('PRD_PROCESSANDO') !== 'TRUE') {
     Logger.log('⚠️ Importação de Produtos Compras já está rodando (Lock Externo). Ignorando.');
     return 0;
  }
  
  // Se não estiver processando internamente, inicia do zero
  if (props.getProperty('PRD_PROCESSANDO') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando limpeza...");
    
    // Limpa memória e gatilhos (exceto Locks do Orquestrador se existirem, mas aqui limpamos tudo para garantir reset)
    // CUIDADO: deleteAllProperties apaga locks de outras rotinas se estiverem rodando em paralelo.
    // Melhor apagar apenas as chaves deste script.
    const chavesLimpar = ['PRD_PROCESSANDO', 'PRD_IDX_EMP', 'PRD_IDX_PAG'];
    chavesLimpar.forEach(k => props.deleteProperty(k));
    
    limparGatilhos(); 
    
    // Define Lock
    props.setProperty('LOCK_PRODUTOS_COMPRAS', 'TRUE');

    // Limpa aba temporária se existir
    var nomeSheetTemp = "TEMP_" + CONFIG_PRODUTOS.nomePlanilha;
    var tOld = ss.getSheetByName(nomeSheetTemp);
    if (tOld) { try { ss.deleteSheet(tOld); } catch(e){} }

    Logger.log("🟢 2. LANÇADOR: Transferindo para o Motor...");
    SpreadsheetApp.flush();
  }

  // 🔥 CHAMA O MOTOR E RETORNA O TOTAL
  return motorProcessamentoProdutos();
}

// ============================================================================
// ⚙️ 3. MOTOR (AUTOMÁTICO)
// ============================================================================

function motorProcessamentoProdutos() {
  if (typeof CONFIG_PRODUTOS === 'undefined') {
    Logger.log("❌ ERRO: Configurações ausentes."); return 0;
  }

  Logger.log("⚙️ 3. MOTOR: Ligado!");
  
  var horaInicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId(); 
  var props = PropertiesService.getScriptProperties();
  
  // Garante lock
  props.setProperty('LOCK_PRODUTOS_COMPRAS', 'TRUE');

  var estado = props.getProperties();
  var processando = (estado['PRD_PROCESSANDO'] === 'TRUE');
  
  var eIdx = parseInt(estado['PRD_IDX_EMP'] || "0");
  var pIdx = parseInt(estado['PRD_IDX_PAG'] || "1");
  
  // 🆕 CONTADOR (não temos como saber o total exato se houver paginação interrompida, 
  // mas vamos retornar o total FINAL quando fizer o commit)
  var totalImportadoFinal = 0;

  // Preparação Inicial
  if (!processando) {
    props.setProperty('PRD_PROCESSANDO', 'TRUE');
    
    // Cria Temp nova
    var nomeSheetTemp = "TEMP_" + CONFIG_PRODUTOS.nomePlanilha;
    var sheetTemp = ss.getSheetByName(nomeSheetTemp);
    if (!sheetTemp) {
      sheetTemp = ss.insertSheet(nomeSheetTemp);
      sheetTemp.hideSheet(); 
      escreverViaApiSafe(ssId, nomeSheetTemp + "!A1", [CONFIG_PRODUTOS.headers]);
    }
  } else {
    Logger.log("🔄 MOTOR: Retomando (Pág " + pIdx + ")...");
  }

  // 🎯 RESTRITO APENAS PARA SF (Conforme seu script original)
  var listaEmpresas = ["SF"]; 
  
  var precisaAgendar = false;
  var nomeSheetTemp = "TEMP_" + CONFIG_PRODUTOS.nomePlanilha;

  // === LOOP EMPRESAS ===
  for (var e = eIdx; e < listaEmpresas.length; e++) {
    var sigla = listaEmpresas[e];
    if (e > eIdx) pIdx = 1;
    
    var empresa = EMPRESAS_OMIE[sigla];
    var totalPaginas = 1;
    var bufferLinhas = []; 

    // === LOOP PÁGINAS ===
    do {
      // ⏳ Check de Tempo (4m 30s)
      if ((new Date().getTime() - horaInicio) > 270000) { 
        if (bufferLinhas.length > 0) appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas);
        Logger.log("⏳ MOTOR: Tempo esgotado. Agendando...");
        props.setProperties({ 
          'PRD_IDX_EMP': e.toString(), 
          'PRD_IDX_PAG': pIdx.toString(), 
          'PRD_PROCESSANDO': 'TRUE' 
        });
        precisaAgendar = true;
        break;
      }

      Logger.log("   ⬇️ " + sigla + " | Pág " + pIdx);

      try {
        var payload = {
          "call": CONFIG_PRODUTOS.metodo,
          "app_key": empresa.appKey, 
          "app_secret": empresa.appSecret,
          "param": [{ "pagina": pIdx, "registros_por_pagina": 50, "apenas_importado_api": "N", "filtrar_apenas_omiepdv": "N" }]
        };

        var data = fetchOmieSmart(CONFIG_PRODUTOS.url, payload);

        if (data.faultstring) {
          if (data.faultstring.indexOf("N\u00e3o existem") > -1) break; 
          throw new Error(data.faultstring);
        }

        totalPaginas = data.total_de_paginas || 1;
        var linhas = parseProdutosCompleto(data, sigla);
        
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
        else if (m.indexOf("403") > -1 || m.indexOf("Forbidden") > -1) { Logger.log("      🚫 Pular " + sigla + " (403)"); break; }
        else if (m.indexOf("timed out") > -1) {
           Logger.log("      ⏳ Google Busy. Pausando.");
           props.setProperties({ 'PRD_IDX_EMP': e.toString(), 'PRD_IDX_PAG': pIdx.toString(), 'PRD_PROCESSANDO': 'TRUE' });
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

  if (precisaAgendar) {
    limparGatilhos();
    ScriptApp.newTrigger('motorProcessamentoProdutos').timeBased().after(100).create();
    // ss.toast("Recarregando...", "⏳", 5);
    
    // Retorna 0 provisoriamente, pois ainda não acabou.
    // O Orquestrador V3 se for esperto pode interpretar 0 como "ainda rodando" se tivesse status,
    // mas no nosso modelo simples, ele vai receber 0.
    // DICA: No menu, configure min: 0 para esta etapa se ela costuma paginar muito,
    // ou aceite que ele vai tentar de novo (mas como tem lock interno, ele retoma).
    return 0; 

  } else {
    // === COMMIT ===
    Logger.log("💾 MOTOR: Finalizando...");
    var sheetTemp = ss.getSheetByName(nomeSheetTemp);
    
    if (sheetTemp) {
      // Conta quantos registros tem na Temp antes de comitar (menos cabeçalho)
      totalImportadoFinal = Math.max(0, sheetTemp.getLastRow() - 1);
      commitarDadosSolido(ss, CONFIG_PRODUTOS, sheetTemp);
    }
    
    // Limpa variáveis de controle
    const chavesLimpar = ['PRD_PROCESSANDO', 'PRD_IDX_EMP', 'PRD_IDX_PAG', 'LOCK_PRODUTOS_COMPRAS'];
    chavesLimpar.forEach(k => props.deleteProperty(k));
    
    limparGatilhos();
    Logger.log("🏆 SUCESSO SF! Total: " + totalImportadoFinal);
    // ss.toast("SF Atualizada!", "✅", 5);
    
    return totalImportadoFinal; // ✅ Retorna o total real para o Orquestrador
  }
}

// ============================================================================
// 🛠️ FUNÇÕES AUXILIARES
// ============================================================================

function parseProdutosCompleto(data, sigla) {
  var l = [];
  var produtos = data.produto_servico_cadastro || [];
  for (var i = 0; i < produtos.length; i++) {
    var p = produtos[i];
    l.push([
      sigla, p.codigo || "", p.codigo_produto_integracao || "", p.codigo_produto || "", 
      p.descricao || "", parseFloat(p.valor_unitario || 0), p.unidade || "", 
      p.ncm || "", p.ean || "", p.marca || "", parseFloat(p.peso_liq || 0), p.codigo_familia || ""
    ]);
  }
  return l;
}

function commitarDadosSolido(ss, config, sheetTemp) {
  var nomeOficial = config.nomePlanilha;
  var sheetOficial = ss.getSheetByName(nomeOficial);
  if (!sheetOficial) sheetOficial = ss.insertSheet(nomeOficial);
  
  try {
    var rangeTemp = sheetTemp.getDataRange();
    var values = rangeTemp.getValues();
    
    if (values.length > 1) { 
      sheetOficial.clear();
      sheetOficial.getRange(1, 1, values.length, values[0].length).setValues(values);
      sheetOficial.getRange(1, 1, 1, config.headers.length).setFontWeight("bold").setBackground(config.cor).setFontColor("white");
      sheetOficial.setFrozenRows(1);
      try { sheetOficial.getRange(2, 6, values.length-1, 1).setNumberFormat("#,##0.00"); } catch(e){}
      
      escreverStatusProdutos(sheetOficial, "Sucesso. Importados: " + (values.length-1) + " regs.", "ok");
      
      SpreadsheetApp.flush(); 
      try { ss.deleteSheet(sheetTemp); } catch(e) {}
    } else {
      escreverStatusProdutos(sheetOficial, "Conexão OK. Sem dados novos.", "aviso");
      try { ss.deleteSheet(sheetTemp); } catch(e){}
    }
  } catch (e) { 
    Logger.log("❌ ERRO COMMIT: " + e.message); 
    escreverStatusProdutos(sheetOficial, "Erro: " + e.message, "erro"); 
  }
}

// ✅ FUNÇÃO DE STATUS RENOMEADA E CORRIGIDA PARA N1
function escreverStatusProdutos(sheet, msg, tipo) { 
  if (!sheet) return; 
  
  var icone = "✅";
  var corFundo = "#D9EAD3"; 
  var corTexto = "#155724"; 
  
  if (tipo === "erro") {
    icone = "❌";
    corFundo = "#F4CCCC"; 
    corTexto = "#721C24";
  } else if (tipo === "aviso") {
    icone = "⚠️";
    corFundo = "#FFF2CC"; 
    corTexto = "#856404";
  }
  
  var horario = new Date().toLocaleTimeString("pt-BR", {hour: '2-digit', minute:'2-digit', second:'2-digit'});
  var textoFinal = icone + " " + horario + "\n" + msg;

  var celula = sheet.getRange("N1");
  celula.setValue(textoFinal)
        .setBackground(corFundo)
        .setFontColor(corTexto)
        .setFontWeight("bold")
        .setWrap(true)
        .setVerticalAlignment("middle")
        .setHorizontalAlignment("center");
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
  for(var i=0; i<t.length; i++) if(t[i].getHandlerFunction() === 'motorProcessamentoProdutos') ScriptApp.deleteTrigger(t[i]); 
}
// ============================================================================
// 🏆 SCRIPT PRODUTOS - V13.0 (COMPATÍVEL ORQUESTRADOR V3)
// 1. Return Count: Retorna total de produtos para o Orquestrador.
// 2. Lock: Proteção contra execução duplicada.
// 3. Estratégia: ListarProdutosResumido com TODOS os filtros abertos.
// ============================================================================

// --- 1. CONFIGURAÇÕES ---
var EMPRESAS = {
  "SF": { key: "823997176002", secret: "4bfd2504503d076365ec4dee298b37eb" },
  "CD": { key: "823989509343", secret: "9739cf05832ae7079bd46eabd4a51877" },
  "WW": { key: "954169379163", secret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5" }
};

var CONFIG_PROD = {
  url: "https://app.omie.com.br/api/v1/geral/produtos/",
  metodo: "ListarProdutosResumido",
  aba: "Produtos",
  arrayJson: "produto_servico_resumido",
  header: ["Empresa", "ID Omie", "Cód Produto", "Cód Integração", "Descrição", "Valor Unitário", "NCM", "EAN"]
};

// --- 2. EXECUÇÃO ---
function executarImportacaoProdutosSimples() {
  var horaInicio = new Date().getTime(); 
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  
  // 🆕 CONTADOR GERAL PARA O ORQUESTRADOR
  var totalRegistrosGeral = 0;

  // Proteção de Lock
  if (props.getProperty('LOCK_PRODUTOS') === 'TRUE') {
    Logger.log('⚠️ Importação de Produtos já está rodando. Ignorando chamada.');
    return 0;
  }

  try {
    props.setProperty('LOCK_PRODUTOS', 'TRUE');
    
    var sheet = ss.getSheetByName(CONFIG_PROD.aba);
    if (!sheet) sheet = ss.insertSheet(CONFIG_PROD.aba);
    
    var listaEmpresas = ["SF", "CD", "WW"]; 
    Logger.log("🚀 Iniciando Produtos V13.0...");
    
    var dadosParaGravar = []; 
    
    // Loop pelas Empresas
    for (var i = 0; i < listaEmpresas.length; i++) {
      var sigla = listaEmpresas[i];
      var credenciais = EMPRESAS[sigla];
      var dadosEmpresa = baixarProdutosDaEmpresa(sigla, credenciais);
      
      if (dadosEmpresa.length > 0) {
        dadosParaGravar = dadosParaGravar.concat(dadosEmpresa);
      }
    }
    
    // --- GRAVAÇÃO ---
    if (dadosParaGravar.length > 0) {
      sheet.clear(); 
      
      // 1. CABEÇALHOS
      sheet.getRange(1, 1, 1, CONFIG_PROD.header.length)
           .setValues([CONFIG_PROD.header])
           .setFontWeight("bold")
           .setBackground("#FF9900")
           .setFontColor("white");

      // 2. DADOS
      sheet.getRange(2, 1, dadosParaGravar.length, dadosParaGravar[0].length).setValues(dadosParaGravar);
      sheet.getRange(2, 6, dadosParaGravar.length, 1).setNumberFormat("#,##0.00");
      sheet.setFrozenRows(1);
      
      // Atualiza contador
      totalRegistrosGeral = dadosParaGravar.length;
      
      // 3. LOG FINAL ✅
      gravarLogAZ1(sheet, "SUCESSO", totalRegistrosGeral, horaInicio, "Carga total concluída");
           
    } else {
      gravarLogAZ1(sheet, "SUCESSO", 0, horaInicio, "Nenhum produto retornado da API");
    }

    // ss.toast("Produtos Atualizados!", "✅");

  } catch (e) {
    var sheetErro = ss.getSheetByName(CONFIG_PROD.aba);
    if (sheetErro) gravarLogAZ1(sheetErro, "ERRO", 0, horaInicio, e.message);
    Logger.log("Erro Produtos: " + e.message);
  } finally {
    props.deleteProperty('LOCK_PRODUTOS');
  }

  // 🆕 RETORNO OBRIGATÓRIO PARA O ORQUESTRADOR
  return totalRegistrosGeral;
}

// --- 3. DOWNLOADER ---
function baixarProdutosDaEmpresa(sigla, credenciais) {
  var pIdx = 1;
  var continuar = true;
  var linhas = [];
  
  while (continuar) {
    try {
      var payload = {
        "call": CONFIG_PROD.metodo,
        "app_key": credenciais.key,
        "app_secret": credenciais.secret,
        "param": [{ "pagina": pIdx, "registros_por_pagina": 100, "apenas_importado_api": "N", "filtrar_apenas_omiepdv": "N" }]
      };
      
      var options = { "method": "POST", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
      var resp = UrlFetchApp.fetch(CONFIG_PROD.url, options);
      var codigo = resp.getResponseCode();
      var texto = resp.getContentText();

      if (codigo === 200) {
        var json = JSON.parse(texto);
        var listaApi = json[CONFIG_PROD.arrayJson] || [];
        if (listaApi.length === 0) { continuar = false; } else {
          for (var k = 0; k < listaApi.length; k++) {
            var p = listaApi[k];
            linhas.push([sigla, p.codigo_produto||"", p.codigo||"", p.codigo_produto_integracao||"", p.descricao||"", parseFloat(p.valor_unitario||0), p.ncm||"", p.ean||""]);
          }
          if (listaApi.length < 100) continuar = false; else pIdx++; 
        }
      } else {
        if (codigo === 500 && texto.indexOf("filtrar_apenas_omiepdv") > -1) { return baixarProdutosFallback(sigla, credenciais); }
        continuar = false; 
      }
    } catch (e) { continuar = false; }
  }
  return linhas;
}

// --- 4. FALLBACK ---
function baixarProdutosFallback(sigla, credenciais) {
  var pIdx = 1;
  var linhas = [];
  while (true) {
    var payload = { "call": CONFIG_PROD.metodo, "app_key": credenciais.key, "app_secret": credenciais.secret, "param": [{ "pagina": pIdx, "registros_por_pagina": 100, "apenas_importado_api": "N" }] };
    var resp = UrlFetchApp.fetch(CONFIG_PROD.url, { "method": "POST", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true });
    if (resp.getResponseCode() === 200) {
       var json = JSON.parse(resp.getContentText());
       var listaApi = json[CONFIG_PROD.arrayJson] || [];
       if (listaApi.length === 0) break;
       for (var k = 0; k < listaApi.length; k++) {
          var p = listaApi[k];
          linhas.push([sigla, p.codigo_produto||"", p.codigo||"", p.codigo_produto_integracao||"", p.descricao||"", parseFloat(p.valor_unitario||0), p.ncm||"", p.ean||""]);
       }
       if (listaApi.length < 100) break; else pIdx++;
    } else { break; }
  }
  return linhas;
}

/**
 * Grava o carimbo consolidado na célula AZ1 conforme padrão solicitado
 */
function gravarLogAZ1(sheet, status, registros, tempoInicio, erroMsg) {
  var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM HH:mm");
  var tempoGasto = Math.floor((new Date().getTime() - tempoInicio) / 1000);
  var icone = status === "SUCESSO" ? "✅" : (status === "RETOMADA" ? "⏳" : "❌");
  
  var textoFinal = icone + " " + status + " | " + agora + " | " + registros + " reg | " + tempoGasto + "s";
  if (erroMsg && status === "ERRO") textoFinal += " | Erro: " + erroMsg;
  else if (erroMsg) textoFinal += " | Obs: " + erroMsg;

  var range = sheet.getRange("AZ1");
  range.setValue(textoFinal);
  
  var cor = status === "SUCESSO" ? "#d9ead3" : (status === "RETOMADA" ? "#fff2cc" : "#f4cccc");
  range.setBackground(cor).setFontColor("black").setFontWeight("bold");
  Logger.log(textoFinal);
}
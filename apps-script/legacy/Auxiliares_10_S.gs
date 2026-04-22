// ============================================================================
// 🏆 SCRIPT AUXILIARES - V10.0 (COMPATÍVEL ORQUESTRADOR V3)
// 1. Return Count: Retorna SOMA de registros (Categorias + Formas Pgto).
// 2. Lock: Proteção contra execução duplicada.
// 3. Log AZ1 individual por aba mantido.
// ============================================================================

// --- 1. CONFIGURAÇÕES ---
var EMPRESAS = {
  "SF": { key: "823997176002", secret: "4bfd2504503d076365ec4dee298b37eb" },
  "CD": { key: "823989509343", secret: "9739cf05832ae7079bd46eabd4a51877" },
  "WW": { key: "954169379163", secret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5" }
};

var TAREFAS = {
  "FormasPagamento": {
    url: "https://app.omie.com.br/api/v1/produtos/formaspagvendas/",
    metodo: "ListarFormasPagVendas",
    aba: "FormasPagamento",
    arrayJson: "cadastros",
    header: ["Empresa", "Código", "Descrição", "Nº Parcelas"]
  },
  "Categorias": {
    url: "https://app.omie.com.br/api/v1/geral/categorias/",
    metodo: "ListarCategorias",
    aba: "Categorias",
    arrayJson: "categoria_cadastro",
    header: ["Empresa", "Código", "Descrição", "Conta Receita", "Conta Despesa"]
  }
};

// --- 2. EXECUÇÃO ---
function executarImportacaoSimples() {
  var horaInicioTotal = new Date().getTime(); 
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var listaEmpresas = ["SF", "CD", "WW"]; 
  
  // 🆕 CONTADOR GERAL PARA O ORQUESTRADOR
  var totalRegistrosGeral = 0;

  // Proteção de Lock
  if (props.getProperty('LOCK_AUXILIARES') === 'TRUE') {
    Logger.log('⚠️ Auxiliares já está rodando. Ignorando chamada.');
    return 0;
  }
  
  try {
    props.setProperty('LOCK_AUXILIARES', 'TRUE');
    Logger.log("🚀 Iniciando Auxiliares V10.0...");

    for (var chaveTask in TAREFAS) {
      var config = TAREFAS[chaveTask];
      Logger.log("👉 Processando: " + config.aba);
      
      var dadosParaGravar = []; 
      var sheet = ss.getSheetByName(config.aba) || ss.insertSheet(config.aba);
      var horaInicioTask = new Date().getTime(); // Cronômetro individual da aba
      
      try {
        for (var i = 0; i < listaEmpresas.length; i++) {
          var sigla = listaEmpresas[i];
          var credenciais = EMPRESAS[sigla];
          
          var dadosEmpresa = baixarTudoDaEmpresa(sigla, credenciais, config);
          
          if (dadosEmpresa.length > 0) {
            dadosParaGravar = dadosParaGravar.concat(dadosEmpresa);
          }
        }
        
        // --- GRAVAÇÃO ---
        if (dadosParaGravar.length > 0) {
          sheet.clear(); 
          
          // 1. CABEÇALHOS
          sheet.getRange(1, 1, 1, config.header.length)
               .setValues([config.header])
               .setFontWeight("bold")
               .setBackground("#E0E0E0")
               .setFontColor("black");

          // 2. DADOS
          sheet.getRange(2, 1, dadosParaGravar.length, dadosParaGravar[0].length)
               .setValues(dadosParaGravar);
          
          sheet.setFrozenRows(1);

          // Soma ao total geral para o Orquestrador
          totalRegistrosGeral += dadosParaGravar.length;

          // 3. LOG AZ1 DA ABA
          gravarLogAZ1(sheet, "SUCESSO", dadosParaGravar.length, horaInicioTask, "Carga Completa OK");
               
        } else {
          gravarLogAZ1(sheet, "SUCESSO", 0, horaInicioTask, "Nenhum dado retornado (Tabela Vazia?)");
        }
      } catch (e) {
        gravarLogAZ1(sheet, "ERRO", 0, horaInicioTask, e.message);
        Logger.log("❌ Erro em " + config.aba + ": " + e.message);
      }
    }
    
    // ss.toast("Importação Auxiliares Concluída!", "✅");

  } catch (e) {
    Logger.log("❌ Erro Geral Auxiliares: " + e.message);
  } finally {
    props.deleteProperty('LOCK_AUXILIARES');
  }

  // 🆕 RETORNO OBRIGATÓRIO PARA O ORQUESTRADOR
  return totalRegistrosGeral;
}

// --- 3. FUNÇÃO DE DOWNLOAD ---
function baixarTudoDaEmpresa(sigla, credenciais, config) {
  var pIdx = 1;
  var continuar = true;
  var linhas = [];
  
  while (continuar) {
    try {
      var payload = {
        "call": config.metodo,
        "app_key": credenciais.key,
        "app_secret": credenciais.secret,
        "param": [{ "pagina": pIdx, "registros_por_pagina": 100 }]
      };
      
      var options = { "method": "POST", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
      var resp = UrlFetchApp.fetch(config.url, options);
      var codigo = resp.getResponseCode();

      if (codigo === 200) {
        var json = JSON.parse(resp.getContentText());
        var listaApi = json[config.arrayJson] || [];
        
        if (listaApi.length === 0) {
          continuar = false; 
        } else {
          for (var k = 0; k < listaApi.length; k++) {
            linhas.push(parseLinha(config.aba, sigla, listaApi[k]));
          }
          if (listaApi.length < 100) continuar = false;
          else pIdx++; 
        }
      } else {
        continuar = false; 
      }
    } catch (e) { continuar = false; }
  }
  return linhas;
}

// --- 4. MAPA DE CAMPOS ---
function parseLinha(tipo, sigla, item) {
  if (tipo === "FormasPagamento") {
    return [sigla, item.cCodigo, item.cDescricao, item.nNumeroParcelas];
  } 
  else if (tipo === "Categorias") {
    var conta = item.dados_contabeis || {};
    return [sigla, item.codigo, item.descricao, conta.conta_receita, conta.conta_despesa];
  }
  return [];
}

/**
 * Grava o carimbo consolidado na célula AZ1
 */
function gravarLogAZ1(sheet, status, registros, tempoInicio, erroMsg) {
  var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM HH:mm");
  var tempoGasto = Math.floor((new Date().getTime() - tempoInicio) / 1000);
  var icone = status === "SUCESSO" ? "✅" : (status === "RETOMADA" ? "⏳" : "❌");
  
  var textoFinal = icone + " " + status + " | " + agora + " | " + registros + " reg | " + tempoGasto + "s";
  if (erroMsg) textoFinal += " | Obs: " + erroMsg;

  var range = sheet.getRange("AZ1");
  range.setValue(textoFinal);
  
  var cor = status === "SUCESSO" ? "#d9ead3" : (status === "RETOMADA" ? "#fff2cc" : "#f4cccc");
  range.setBackground(cor).setFontColor("black").setFontWeight("bold");
}
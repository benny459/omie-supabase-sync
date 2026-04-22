// ========================================
// IMPORTAÇÃO PROJETOS - SEM CONFIG GLOBAL
// ========================================

// ========================================
// FUNÇÃO AUXILIAR: RETRY (LOCAL)
// ========================================
function fetchProjetosComRetry(url, options, pagina) {
  var maxRetries = 4;
  var baseDelay = 2000;
  
  for (var tentativa = 1; tentativa <= maxRetries; tentativa++) {
    try {
      Logger.log("  🔄 Tentativa " + tentativa + "/" + maxRetries + " (página " + pagina + ")");
      
      var response = UrlFetchApp.fetch(url, options);
      var httpCode = response.getResponseCode();
      
      if (httpCode === 200) {
        if (tentativa > 1) {
          Logger.log("  ✅ Sucesso após " + tentativa + " tentativas");
        }
        return {success: true, response: response};
      }
      
      Logger.log("  ⚠️ HTTP " + httpCode + " na tentativa " + tentativa);
      
      if (tentativa < maxRetries) {
        var espera = baseDelay * tentativa;
        Logger.log("  ⏳ Aguardando " + (espera/1000) + "s...");
        Utilities.sleep(espera);
      }
      
    } catch (erro) {
      Logger.log("  ❌ Exceção: " + erro.message);
      
      if (tentativa < maxRetries) {
        var espera = baseDelay * tentativa;
        Utilities.sleep(espera);
      }
    }
  }
  
  return {success: false, error: "Falhou após " + maxRetries + " tentativas"};
}

// ========================================
// IMPORTAÇÃO COMPLETA - HARDCODED "Projetos"
// ========================================
function importarTodosProjetosOMIE() {
  Logger.clear();
  var horaInicio = new Date().getTime();
  
  // ⚠️ HARDCODED - Não depende de variável global
  var NOME_ABA = "Projetos";
  var APP_KEY = "823997176002";
  var APP_SECRET = "4bfd2504503d076365ec4dee298b37eb";
  var API_URL = "https://app.omie.com.br/api/v1/geral/projetos/";
  
  Logger.log("╔═══════════════════════════════════════════════════════╗");
  Logger.log("║   IMPORTAÇÃO - PROJETOS OMIE                          ║");
  Logger.log("║   Aba destino: '" + NOME_ABA + "'                     ║");
  Logger.log("╚═══════════════════════════════════════════════════════╝\n");
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOME_ABA);
  
  if (!sheet) {
    Logger.log("❌ ERRO: Aba '" + NOME_ABA + "' não encontrada!");
    Logger.log("   Execute: criarPlanilhaProjetos()");
    return;
  }
  
  Logger.log("✅ Aba encontrada: '" + sheet.getName() + "'\n");

  // ETAPA 1: LIMPAR
  Logger.log("[ETAPA 1/3] Limpando aba '" + NOME_ABA + "'...");
  var lastRow = sheet.getLastRow();
  Logger.log("  • Linhas antes: " + lastRow);
  
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, 10).clearContent();
  }
  
  Logger.log("  ✅ Limpeza concluída\n");

  // ETAPA 2: BUSCAR E INSERIR
  Logger.log("[ETAPA 2/3] Importando da API...");
  
  var pagina = 1;
  var totalPaginas = 1;
  var totalImportados = 0;
  var temSucesso = true;
  var erroMsg = "";
  var errosConsecutivos = 0;
  var MAX_ERROS_CONSECUTIVOS = 3;
  
  do {
    var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
    if (tempoDecorrido > 300) {
      Logger.log("  ⏱️ Timeout atingido");
      erroMsg = "Timeout";
      temSucesso = false;
      break;
    }
    
    if (pagina > 100) {
      Logger.log("  ⚠️ Limite de páginas");
      break;
    }
    
    if (errosConsecutivos >= MAX_ERROS_CONSECUTIVOS) {
      Logger.log("  ❌ Máximo de erros consecutivos");
      erroMsg = "Erros consecutivos";
      temSucesso = false;
      break;
    }
    
    var payload = {
      "call": "ListarProjetos",
      "app_key": APP_KEY,
      "app_secret": APP_SECRET,
      "param": [{"pagina": pagina, "registros_por_pagina": 50}]
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    
    var resultado = fetchProjetosComRetry(API_URL, options, pagina);
    
    if (!resultado.success) {
      Logger.log("  ❌ Falha página " + pagina);
      erroMsg = resultado.error;
      errosConsecutivos++;
      
      if (errosConsecutivos < MAX_ERROS_CONSECUTIVOS) {
        pagina++;
        Utilities.sleep(2000);
        continue;
      } else {
        temSucesso = false;
        break;
      }
    }
    
    errosConsecutivos = 0;
    
    try {
      var data = JSON.parse(resultado.response.getContentText());
      
      if (!data || !data.cadastro) {
        Logger.log("  ❌ Resposta inválida");
        erroMsg = "Resposta inválida";
        temSucesso = false;
        break;
      }
      
      totalPaginas = data.total_de_paginas || 1;
      var projetos = data.cadastro;
      
      if (projetos.length === 0) {
        Logger.log("  ℹ️ Fim dos registros");
        break;
      }
      
      var linhaInicio = sheet.getLastRow() + 1;
      var dadosPagina = [];
      
      for (var i = 0; i < projetos.length; i++) {
        var p = projetos[i];
        var info = p.info || {};
        
        dadosPagina.push([
          String(p.codigo || ""),
          String(p.codInt || ""),
          p.nome || "",
          p.inativo || "",
          info.data_inc || "",
          info.hora_inc || "",
          info.user_inc || "",
          info.data_alt || "",
          info.hora_alt || "",
          info.user_alt || ""
        ]);
      }
      
      sheet.getRange(linhaInicio, 1, dadosPagina.length, 10).setValues(dadosPagina);
      totalImportados += dadosPagina.length;
      
      if (pagina % 5 === 0 || pagina === totalPaginas) {
        Logger.log("  📄 Página " + pagina + "/" + totalPaginas + " | Total: " + totalImportados);
      }
      
      pagina++;
      Utilities.sleep(200);
      
    } catch (erro) {
      Logger.log("  ❌ Erro: " + erro.message);
      erroMsg = erro.message;
      errosConsecutivos++;
      
      if (errosConsecutivos < MAX_ERROS_CONSECUTIVOS) {
        pagina++;
        continue;
      } else {
        temSucesso = false;
        break;
      }
    }
    
  } while (pagina <= totalPaginas);
  
  Logger.log("  ✅ Importação concluída\n");

  // ETAPA 3: RESULTADO
  var tempoTotal = ((new Date().getTime() - horaInicio) / 1000).toFixed(2);
  
  Logger.log("[ETAPA 3/3] Resultado:");
  Logger.log("  Status: " + (temSucesso ? "✅ SUCESSO" : "❌ ERRO"));
  Logger.log("  Projetos: " + totalImportados);
  Logger.log("  Tempo: " + tempoTotal + "s");
  
  // TIMESTAMP NA K1 DA ABA PROJETOS (NÃO CONTASPAGAR!)
  var timezone = ss.getSpreadsheetTimeZone();
  var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
  
  if (temSucesso && totalImportados > 0) {
    sheet.getRange("K1")
      .setValue("✅ SUCESSO - " + timestamp + " | " + totalImportados + " projetos | " + tempoTotal + "s")
      .setBackground("#D9EAD3")
      .setFontColor("#155724")
      .setFontWeight("bold");
  } else {
    sheet.getRange("K1")
      .setValue("❌ ERRO - " + timestamp + " | " + erroMsg)
      .setBackground("#F4CCCC")
      .setFontColor("#721C24")
      .setFontWeight("bold");
  }
  
  SpreadsheetApp.flush();
  
  Logger.log("\n✅ Timestamp gravado em K1 da aba '" + NOME_ABA + "'");
  Logger.log("🎯 Finalizado!");
}

// ========================================
// CRIAR PLANILHA - HARDCODED
// ========================================
function criarPlanilhaProjetos() {
  var NOME_ABA = "Projetos";
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOME_ABA);
  
  if (sheet) {
    Logger.log("⚠️ Aba '" + NOME_ABA + "' já existe!");
    return;
  }
  
  sheet = ss.insertSheet(NOME_ABA);
  
  var cabecalho = ["codigo", "codInt", "nome", "inativo", "data_inc", "hora_inc", "user_inc", "data_alt", "hora_alt", "user_alt"];
  
  sheet.getRange(1, 1, 1, 10).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, 10)
    .setFontWeight("bold")
    .setBackground("#4285F4")
    .setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.getRange("A:B").setNumberFormat("@");
  sheet.autoResizeColumns(1, 10);
  
  Logger.log("✅ Aba '" + NOME_ABA + "' criada!");
}

// ========================================
// REFRESH TOTAL - HARDCODED
// ========================================
function refreshTotalProjetos() {
  Logger.clear();
  
  var NOME_ABA = "Projetos";
  
  Logger.log("╔═══════════════════════════════════════════════════════╗");
  Logger.log("║   REFRESH TOTAL - PROJETOS                            ║");
  Logger.log("║   Deletando aba: '" + NOME_ABA + "'                   ║");
  Logger.log("╚═══════════════════════════════════════════════════════╝\n");
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(NOME_ABA);
    
    if (sheet) {
      Logger.log("✅ Aba '" + NOME_ABA + "' encontrada");
      Logger.log("🗑️ Deletando...");
      ss.deleteSheet(sheet);
      SpreadsheetApp.flush();
      Utilities.sleep(1000);
      Logger.log("✅ Aba deletada\n");
    } else {
      Logger.log("ℹ️ Aba não existe\n");
    }
    
    Logger.log("Recriando aba '" + NOME_ABA + "'...");
    sheet = ss.insertSheet(NOME_ABA);
    
    var cabecalho = ["codigo", "codInt", "nome", "inativo", "data_inc", "hora_inc", "user_inc", "data_alt", "hora_alt", "user_alt"];
    
    sheet.getRange(1, 1, 1, 10).setValues([cabecalho]);
    sheet.getRange(1, 1, 1, 10)
      .setFontWeight("bold")
      .setBackground("#4285F4")
      .setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    sheet.getRange("A:B").setNumberFormat("@");
    sheet.autoResizeColumns(1, 10);
    
    SpreadsheetApp.flush();
    Logger.log("✅ Aba recriada\n");
    
    Logger.log("Importando dados...\n");
    importarTodosProjetosOMIE();
    
    Logger.log("\n╔═══════════════════════════════════════════════════════╗");
    Logger.log("║   REFRESH CONCLUÍDO!                                  ║");
    Logger.log("╚═══════════════════════════════════════════════════════╝");
    
  } catch (erro) {
    Logger.log("❌ ERRO: " + erro.message);
  }
}

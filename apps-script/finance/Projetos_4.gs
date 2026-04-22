// ========================================
// CONFIGURAÇÕES_ver4
// ========================================

var CONFIG = {
  appKey: "823997176002",
  appSecret: "4bfd2504503d076365ec4dee298b37eb",
  url: "https://app.omie.com.br/api/v1/geral/projetos/",
  nomePlanilha: "Projetos",
  maxRetries: 3,        // Tentar 3 vezes antes de desistir
  retryDelay: 2000      // 2 segundos entre tentativas
};

// ========================================
// FUNÇÃO AUXILIAR: FAZER REQUISIÇÃO COM RETRY
// ========================================

function fetchComRetry(url, options, pagina, maxTentativas) {
  maxTentativas = maxTentativas || CONFIG.maxRetries;
  
  for (var tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      Logger.log("  🔄 Tentativa " + tentativa + "/" + maxTentativas + " (página " + pagina + ")");
      
      var response = UrlFetchApp.fetch(url, options);
      var httpCode = response.getResponseCode();
      
      if (httpCode === 200) {
        Logger.log("  ✅ Sucesso na tentativa " + tentativa);
        return {success: true, response: response};
      }
      
      // HTTP 500 ou outro erro
      Logger.log("  ⚠️ HTTP " + httpCode + " na tentativa " + tentativa);
      
      // Se não é a última tentativa, aguardar antes de tentar novamente
      if (tentativa < maxTentativas) {
        var espera = CONFIG.retryDelay * tentativa; // Aumenta o tempo a cada tentativa
        Logger.log("  ⏳ Aguardando " + (espera/1000) + "s antes de tentar novamente...");
        Utilities.sleep(espera);
      }
      
    } catch (erro) {
      Logger.log("  ❌ Exceção na tentativa " + tentativa + ": " + erro.message);
      
      if (tentativa < maxTentativas) {
        var espera = CONFIG.retryDelay * tentativa;
        Logger.log("  ⏳ Aguardando " + (espera/1000) + "s antes de tentar novamente...");
        Utilities.sleep(espera);
      }
    }
  }
  
  // Se chegou aqui, todas as tentativas falharam
  return {success: false, error: "Falhou após " + maxTentativas + " tentativas"};
}

// ========================================
// IMPORTAÇÃO COMPLETA - VERSÃO COM RETRY
// ========================================

function importarTodosProjetosOMIE() {
  Logger.clear();
  var horaInicio = new Date().getTime();
  
  Logger.log("╔═══════════════════════════════════════════════════════╗");
  Logger.log("║   IMPORTAÇÃO COMPLETA - PROJETOS OMIE                 ║");
  Logger.log("║   Início: " + new Date().toLocaleString('pt-BR') + "      ║");
  Logger.log("║   Com retry automático ativado                        ║");
  Logger.log("╚═══════════════════════════════════════════════════════╝\n");
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.nomePlanilha);
  
  if (!sheet) {
    Logger.log("❌ ERRO: Planilha não encontrada!");
    return;
  }

  // ETAPA 1: LIMPAR
  Logger.log("[ETAPA 1/3] Limpando planilha...");
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
  var MAX_ERROS_CONSECUTIVOS = 5;
  
  do {
    // Verificar tempo
    var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
    if (tempoDecorrido > 330) {
      Logger.log("  ⏱️ Timeout atingido");
      erroMsg = "Timeout após " + tempoDecorrido.toFixed(0) + "s";
      temSucesso = false;
      break;
    }
    
    if (pagina > 100) {
      Logger.log("  ⚠️ Limite de 100 páginas atingido");
      break;
    }
    
    if (errosConsecutivos >= MAX_ERROS_CONSECUTIVOS) {
      Logger.log("  ❌ Máximo de erros consecutivos atingido (" + MAX_ERROS_CONSECUTIVOS + ")");
      erroMsg = "Máximo de erros consecutivos";
      temSucesso = false;
      break;
    }
    
    var payload = {
      "call": "ListarProjetos",
      "app_key": CONFIG.appKey,
      "app_secret": CONFIG.appSecret,
      "param": [{
        "pagina": pagina,
        "registros_por_pagina": 50  // REDUZIDO para 50 para evitar 500
      }]
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };
    
    // USAR FETCH COM RETRY
    var resultado = fetchComRetry(CONFIG.url, options, pagina, CONFIG.maxRetries);
    
    if (!resultado.success) {
      Logger.log("  ❌ Falha na página " + pagina + ": " + resultado.error);
      erroMsg = resultado.error + " (página " + pagina + ")";
      errosConsecutivos++;
      
      // Tentar pular para próxima página
      if (errosConsecutivos < MAX_ERROS_CONSECUTIVOS) {
        Logger.log("  ⏭️ Pulando para próxima página...");
        pagina++;
        continue;
      } else {
        temSucesso = false;
        break;
      }
    }
    
    // Reset contador de erros se teve sucesso
    errosConsecutivos = 0;
    
    try {
      var data = JSON.parse(resultado.response.getContentText());
      
      if (!data || !data.cadastro) {
        Logger.log("  ❌ Resposta inválida na página " + pagina);
        Logger.log("  📋 Resposta: " + resultado.response.getContentText().substring(0, 200));
        erroMsg = "Resposta inválida na página " + pagina;
        temSucesso = false;
        break;
      }
      
      totalPaginas = data.total_de_paginas || 1;
      var projetos = data.cadastro;
      
      if (projetos.length === 0) {
        Logger.log("  ℹ️ Fim dos registros na página " + pagina);
        break;
      }
      
      // Inserir esta página AGORA
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
      
      // Log a cada 5 páginas (mais frequente)
      if (pagina % 5 === 0 || pagina === totalPaginas) {
        Logger.log("  📄 Página " + pagina + "/" + totalPaginas + " | Total: " + totalImportados);
      }
      
      pagina++;
      Utilities.sleep(150); // Pausa maior entre páginas
      
    } catch (erro) {
      Logger.log("  ❌ Erro ao processar página " + pagina + ": " + erro.message);
      erroMsg = "Erro: " + erro.message;
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
  
  Logger.log("  ✅ Importação de dados concluída\n");

  // ETAPA 3: RESULTADO
  var tempoTotal = ((new Date().getTime() - horaInicio) / 1000).toFixed(2);
  var linhasFinais = sheet.getLastRow() - 1;
  
  Logger.log("[ETAPA 3/3] Finalizando...\n");
  
  Logger.log("╔═══════════════════════════════════════════════════════╗");
  Logger.log("║   RESULTADO FINAL                                     ║");
  Logger.log("╠═══════════════════════════════════════════════════════╣");
  
  if (temSucesso && totalImportados > 0) {
    Logger.log("║   Status: ✅ SUCESSO                                  ║");
    Logger.log("║   Projetos: " + totalImportados + "                                    ║");
    Logger.log("║   Páginas: " + (pagina - 1) + "                                      ║");
    Logger.log("║   Linhas: " + linhasFinais + "                                     ║");
  } else if (!temSucesso && totalImportados > 0) {
    Logger.log("║   Status: ⚠️ PARCIAL                                  ║");
    Logger.log("║   Mensagem: " + erroMsg + "                           ║");
    Logger.log("║   Importados: " + totalImportados + "                             ║");
  } else {
    Logger.log("║   Status: ❌ ERRO                                     ║");
    Logger.log("║   Mensagem: " + erroMsg + "                           ║");
    Logger.log("║   Parcial: " + totalImportados + "                                ║");
  }
  
  Logger.log("║   Tempo: " + tempoTotal + "s                                   ║");
  Logger.log("║   Término: " + new Date().toLocaleString('pt-BR') + "       ║");
  Logger.log("╚═══════════════════════════════════════════════════════╝");
  
  // TIMESTAMP NA K1
  // TIMESTAMP NA K1 - USA TIMEZONE DO SCRIPT
var timezone = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();
var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");

  var msgK1 = "";
  
  if (temSucesso && totalImportados > 0) {
    msgK1 = "✅ SUCESSO - " + timestamp + " | " + totalImportados + " projetos | " + tempoTotal + "s";
    sheet.getRange("K1").setBackground("#D9EAD3").setFontColor("#155724");
  } else if (!temSucesso && totalImportados > 0) {
    msgK1 = "⚠️ PARCIAL - " + timestamp + " | " + totalImportados + " projetos | " + erroMsg;
    sheet.getRange("K1").setBackground("#FFF3CD").setFontColor("#856404");
  } else {
    msgK1 = "❌ ERRO - " + timestamp + " | " + erroMsg + " | Parcial: " + totalImportados;
    sheet.getRange("K1").setBackground("#F4CCCC").setFontColor("#721C24");
  }
  
  sheet.getRange("K1").setValue(msgK1);
  sheet.getRange("K1").setFontWeight("bold");
  SpreadsheetApp.flush();
  
  Logger.log("\n✅ Timestamp gravado na célula K1");
  Logger.log("🎯 Processo finalizado!");
}

// ========================================
// CRIAR PLANILHA
// ========================================

function criarPlanilhaProjetos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG.nomePlanilha);
  
  if (sheet) {
    Logger.log("⚠️ Planilha já existe!");
    return;
  }
  
  sheet = ss.insertSheet(CONFIG.nomePlanilha);
  
  var cabecalho = ["codigo", "codInt", "nome", "inativo", "data_inc", "hora_inc", "user_inc", "data_alt", "hora_alt", "user_alt"];
  
  sheet.getRange(1, 1, 1, 10).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, 10).setFontWeight("bold");
  sheet.getRange(1, 1, 1, 10).setBackground("#4285F4");
  sheet.getRange(1, 1, 1, 10).setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 10);
  
  Logger.log("✅ Planilha criada!");
}
// ========================================
// 🔄 REFRESH TOTAL - APENAS PROJETOS
// ========================================
function refreshTotalProjetos() {
  Logger.clear();
  Logger.log("╔═══════════════════════════════════════════════════════╗");
  Logger.log("║   REFRESH TOTAL - PROJETOS OMIE                       ║");
  Logger.log("║   ATENÇÃO: Vai deletar e recriar ABA 'Projetos'      ║");
  Logger.log("╚═══════════════════════════════════════════════════════╝\n");
  
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    
    // ⚠️ HARDCODED - NOME FIXO "Projetos"
    var NOME_ABA_PROJETOS = "Projetos";
    
    Logger.log("🔍 Procurando aba com nome EXATO: '" + NOME_ABA_PROJETOS + "'");
    
    var sheet = ss.getSheetByName(NOME_ABA_PROJETOS);
    
    // PASSO 1: DELETAR ABA
    if (sheet) {
      Logger.log("✅ Aba '" + NOME_ABA_PROJETOS + "' ENCONTRADA");
      Logger.log("⚠️ DELETANDO aba '" + NOME_ABA_PROJETOS + "'...");
      
      ss.deleteSheet(sheet);
      SpreadsheetApp.flush();
      Utilities.sleep(1000);
      
      Logger.log("✅ Aba '" + NOME_ABA_PROJETOS + "' DELETADA com sucesso\n");
    } else {
      Logger.log("ℹ️ Aba '" + NOME_ABA_PROJETOS + "' não existe (será criada)\n");
    }
    
    // PASSO 2: RECRIAR ABA
    Logger.log("[PASSO 2/3] Recriando aba '" + NOME_ABA_PROJETOS + "'...");
    
    sheet = ss.insertSheet(NOME_ABA_PROJETOS);
    
    var cabecalho = [
      "codigo", "codInt", "nome", "inativo", 
      "data_inc", "hora_inc", "user_inc", 
      "data_alt", "hora_alt", "user_alt"
    ];
    
    sheet.getRange(1, 1, 1, 10).setValues([cabecalho]);
    sheet.getRange(1, 1, 1, 10)
      .setFontWeight("bold")
      .setBackground("#4285F4")
      .setFontColor("#FFFFFF")
      .setHorizontalAlignment("center");
    
    sheet.setFrozenRows(1);
    sheet.getRange("A:B").setNumberFormat("@");  // Colunas de código como texto
    sheet.autoResizeColumns(1, 10);
    
    SpreadsheetApp.flush();
    Logger.log("✅ Aba '" + NOME_ABA_PROJETOS + "' recriada com cabeçalhos\n");
    
    // PASSO 3: IMPORTAR DADOS
    Logger.log("[PASSO 3/3] Importando dados da API...\n");
    Logger.log("=" .repeat(60) + "\n");
    
    // Chama a função de importação
    importarTodosProjetosOMIE();
    
    Logger.log("\n" + "=".repeat(60));
    Logger.log("╔═══════════════════════════════════════════════════════╗");
    Logger.log("║   REFRESH TOTAL CONCLUÍDO!                            ║");
    Logger.log("║   Aba 'Projetos' recriada e dados importados         ║");
    Logger.log("╚═══════════════════════════════════════════════════════╝");
    
  } catch (erro) {
    Logger.log("\n❌ ERRO DURANTE REFRESH: " + erro.message);
    Logger.log("   Stack: " + erro.stack);
    
    // Tenta criar aba básica se deu erro
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      var sheet = ss.getSheetByName("Projetos");
      
      if (!sheet) {
        Logger.log("\n⚠️ Tentando criar aba básica de emergência...");
        
        sheet = ss.insertSheet("Projetos");
        var cabecalho = ["codigo", "codInt", "nome", "inativo", "data_inc", "hora_inc", "user_inc", "data_alt", "hora_alt", "user_alt"];
        
        sheet.getRange(1, 1, 1, 10).setValues([cabecalho]);
        sheet.getRange(1, 1, 1, 10)
          .setFontWeight("bold")
          .setBackground("#4285F4")
          .setFontColor("#FFFFFF");
        
        sheet.setFrozenRows(1);
        SpreadsheetApp.flush();
        
        Logger.log("✅ Aba básica criada. Execute importarTodosProjetosOMIE() manualmente.");
      }
    } catch (e) {
      Logger.log("❌ Falha ao criar aba de emergência: " + e.message);
    }
  }
}


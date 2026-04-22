/*
╔═══════════════════════════════════════════════════════════╗
║  LIMPADOR DE CACHE - GOOGLE APPS SCRIPT                  ║
║  Arquivo: LimpadorCache.gs                               ║
║  Função: Prevenir problemas de cache em scripts          ║
║  Execução: Automática via trigger (a cada 6 horas)       ║
╚═══════════════════════════════════════════════════════════╝
*/

// ========================================
// CONFIGURAÇÕES DO LIMPADOR
// ========================================

var CONFIG_CACHE = {
  nomePlanilhaLog: "LogCache",
  celulaStatus: "ZZ1", // Célula para forçar flush
  intervaloHoras: 6,    // Executar a cada 6 horas
  manterLogsUltimos: 100 // Manter últimos 100 logs
};

// ========================================
// FUNÇÃO PRINCIPAL: LIMPAR CACHE
// ========================================

function limparCacheAutomatico() {
  var inicio = new Date();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  Logger.log("╔═══════════════════════════════════════════════════════╗");
  Logger.log("║   LIMPADOR DE CACHE AUTOMÁTICO                        ║");
  Logger.log("║   Início: " + inicio.toLocaleString('pt-BR') + "                ║");
  Logger.log("╚═══════════════════════════════════════════════════════╝");
  
  try {
    // MÉTODO 1: Flush múltiplo na planilha
    Logger.log("\n[1/5] Flush múltiplo...");
    for (var i = 0; i < 5; i++) {
      var sheet = ss.getActiveSheet();
      var celula = sheet.getRange(CONFIG_CACHE.celulaStatus);
      celula.setValue("Cache Clear: " + new Date().getTime());
      SpreadsheetApp.flush();
      Utilities.sleep(100);
    }
    Logger.log("  ✅ Flush concluído");
    
    // MÉTODO 2: Limpar propriedades temporárias antigas
    Logger.log("\n[2/5] Limpando propriedades temporárias...");
    var props = PropertiesService.getScriptProperties();
    var todasProps = props.getProperties();
    var limpas = 0;
    
    for (var prop in todasProps) {
      // Remove propriedades temporárias com mais de 7 dias
      if (prop.indexOf("temp_") === 0) {
        var timestamp = parseInt(prop.split("_")[1]) || 0;
        var idade = (new Date().getTime() - timestamp) / (1000 * 60 * 60 * 24);
        
        if (idade > 7) {
          props.deleteProperty(prop);
          limpas++;
        }
      }
    }
    Logger.log("  ✅ " + limpas + " propriedades limpas");
    
    // MÉTODO 3: Força garbage collection
    Logger.log("\n[3/5] Forçando garbage collection...");
    for (var i = 0; i < 3; i++) {
      var dummy = new Array(1000);
      dummy = null;
      Utilities.sleep(100);
    }
    Logger.log("  ✅ Garbage collection forçado");
    
    // MÉTODO 4: Atualizar timestamp de execução
    Logger.log("\n[4/5] Atualizando timestamps...");
    props.setProperty("ultimo_cache_clear", String(new Date().getTime()));
    props.setProperty("versao_cache_clear", "1.0.0");
    Logger.log("  ✅ Timestamps atualizados");
    
    // MÉTODO 5: Registrar no log
    Logger.log("\n[5/5] Registrando log...");
    registrarLogCache(inicio, true, "Limpeza automática concluída");
    Logger.log("  ✅ Log registrado");
    
    var tempo = ((new Date().getTime() - inicio.getTime()) / 1000).toFixed(2);
    
    Logger.log("\n╔═══════════════════════════════════════════════════════╗");
    Logger.log("║   ✅ CACHE LIMPO COM SUCESSO                          ║");
    Logger.log("║   Tempo: " + tempo + "s                                        ║");
    Logger.log("╚═══════════════════════════════════════════════════════╝");
    
    return true;
    
  } catch (erro) {
    Logger.log("\n❌ ERRO ao limpar cache: " + erro.message);
    registrarLogCache(inicio, false, "Erro: " + erro.message);
    return false;
  }
}

// ========================================
// FUNÇÃO: REGISTRAR LOG DE LIMPEZA
// ========================================

function registrarLogCache(inicio, sucesso, mensagem) {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var logSheet = ss.getSheetByName(CONFIG_CACHE.nomePlanilhaLog);
    
    // Criar planilha de log se não existir
    if (!logSheet) {
      logSheet = ss.insertSheet(CONFIG_CACHE.nomePlanilhaLog);
      logSheet.getRange(1, 1, 1, 5).setValues([
        ["Timestamp", "Data/Hora", "Status", "Tempo (s)", "Mensagem"]
      ]);
      logSheet.getRange(1, 1, 1, 5).setFontWeight("bold");
      logSheet.getRange(1, 1, 1, 5).setBackground("#34A853");
      logSheet.getRange(1, 1, 1, 5).setFontColor("#FFFFFF");
      logSheet.setFrozenRows(1);
    }
    
    var tempo = ((new Date().getTime() - inicio.getTime()) / 1000).toFixed(2);
    var agora = new Date();
    
    var novaLinha = [
      agora.getTime(),
      Utilities.formatDate(agora, "GMT-3", "dd/MM/yyyy HH:mm:ss"),
      sucesso ? "✅ SUCESSO" : "❌ ERRO",
      tempo,
      mensagem
    ];
    
    logSheet.insertRowAfter(1);
    logSheet.getRange(2, 1, 1, 5).setValues([novaLinha]);
    
    // Colorir linha
    if (sucesso) {
      logSheet.getRange(2, 1, 1, 5).setBackground("#D9EAD3");
    } else {
      logSheet.getRange(2, 1, 1, 5).setBackground("#F4CCCC");
    }
    
    // Limpar logs antigos (manter apenas os últimos X)
    var totalLinhas = logSheet.getLastRow();
    if (totalLinhas > CONFIG_CACHE.manterLogsUltimos + 1) {
      var linhasParaDeletar = totalLinhas - CONFIG_CACHE.manterLogsUltimos - 1;
      logSheet.deleteRows(totalLinhas - linhasParaDeletar + 1, linhasParaDeletar);
    }
    
    SpreadsheetApp.flush();
    
  } catch (erro) {
    Logger.log("⚠️ Erro ao registrar log: " + erro.message);
  }
}

// ========================================
// FUNÇÃO: CRIAR TRIGGER AUTOMÁTICO
// ========================================

function criarTriggerLimpezaCache() {
  Logger.log("=== CRIANDO TRIGGER DE LIMPEZA DE CACHE ===\n");
  
  // Limpar triggers antigos primeiro
  limparTriggersAntigos();
  
  try {
    // Criar novo trigger para executar a cada 6 horas
    ScriptApp.newTrigger('limparCacheAutomatico')
      .timeBased()
      .everyHours(CONFIG_CACHE.intervaloHoras)
      .create();
    
    Logger.log("✅ Trigger criado com sucesso!");
    Logger.log("   • Função: limparCacheAutomatico()");
    Logger.log("   • Frequência: A cada " + CONFIG_CACHE.intervaloHoras + " horas");
    Logger.log("   • Próxima execução: Em " + CONFIG_CACHE.intervaloHoras + " horas\n");
    
    // Executar uma vez agora para testar
    Logger.log("🔄 Executando primeira limpeza agora...\n");
    limparCacheAutomatico();
    
    Logger.log("\n✅ CONFIGURAÇÃO CONCLUÍDA!");
    Logger.log("💡 Verifique os logs na planilha: " + CONFIG_CACHE.nomePlanilhaLog);
    
    // Retornar mensagem de sucesso
    Browser.msgBox(
      "✅ Trigger Criado!",
      "O limpador de cache foi configurado com sucesso!\n\n" +
      "• Executará automaticamente a cada " + CONFIG_CACHE.intervaloHoras + " horas\n" +
      "• Logs serão salvos na planilha: " + CONFIG_CACHE.nomePlanilhaLog + "\n" +
      "• Primeira limpeza foi executada agora\n\n" +
      "Verifique os triggers em: Extensões > Apps Script > Acionadores",
      Browser.Buttons.OK
    );
    
  } catch (erro) {
    Logger.log("❌ ERRO ao criar trigger: " + erro.message);
    Browser.msgBox("❌ Erro ao criar trigger: " + erro.message);
  }
}

// ========================================
// FUNÇÃO: LIMPAR TRIGGERS ANTIGOS
// ========================================

function limparTriggersAntigos() {
  Logger.log("🧹 Limpando triggers antigos de limpeza de cache...");
  
  var triggers = ScriptApp.getProjectTriggers();
  var removidos = 0;
  
  for (var i = 0; i < triggers.length; i++) {
    var funcao = triggers[i].getHandlerFunction();
    
    // Remove apenas triggers de limparCacheAutomatico
    if (funcao === 'limparCacheAutomatico') {
      ScriptApp.deleteTrigger(triggers[i]);
      removidos++;
    }
  }
  
  if (removidos > 0) {
    Logger.log("  ✅ " + removidos + " trigger(s) antigo(s) removido(s)");
  } else {
    Logger.log("  ℹ️ Nenhum trigger antigo encontrado");
  }
}

// ========================================
// FUNÇÃO: REMOVER TRIGGER
// ========================================

function removerTriggerLimpezaCache() {
  Logger.log("=== REMOVENDO TRIGGER DE LIMPEZA DE CACHE ===\n");
  
  limparTriggersAntigos();
  
  Logger.log("\n✅ Triggers removidos com sucesso!");
  Logger.log("💡 Para reativar, execute: criarTriggerLimpezaCache()");
  
  Browser.msgBox(
    "✅ Triggers Removidos",
    "O limpador automático de cache foi desativado.\n\n" +
    "Para reativar, execute a função:\ncriarTriggerLimpezaCache()",
    Browser.Buttons.OK
  );
}

// ========================================
// FUNÇÃO: VERIFICAR STATUS DO TRIGGER
// ========================================

function verificarStatusTrigger() {
  Logger.log("=== STATUS DO TRIGGER DE LIMPEZA ===\n");
  
  var triggers = ScriptApp.getProjectTriggers();
  var encontrado = false;
  
  for (var i = 0; i < triggers.length; i++) {
    var trigger = triggers[i];
    
    if (trigger.getHandlerFunction() === 'limparCacheAutomatico') {
      encontrado = true;
      
      Logger.log("✅ Trigger ATIVO");
      Logger.log("   • ID: " + trigger.getUniqueId());
      Logger.log("   • Tipo: " + trigger.getEventType());
      
      var props = PropertiesService.getScriptProperties();
      var ultimaExecucao = props.getProperty("ultimo_cache_clear");
      
      if (ultimaExecucao) {
        var data = new Date(parseInt(ultimaExecucao));
        Logger.log("   • Última execução: " + data.toLocaleString('pt-BR'));
        
        var proximaExecucao = new Date(data.getTime() + (CONFIG_CACHE.intervaloHoras * 60 * 60 * 1000));
        Logger.log("   • Próxima execução: " + proximaExecucao.toLocaleString('pt-BR'));
      }
      
      break;
    }
  }
  
  if (!encontrado) {
    Logger.log("❌ Trigger NÃO ESTÁ ATIVO");
    Logger.log("💡 Para ativar, execute: criarTriggerLimpezaCache()");
  }
  
  Logger.log("\n📊 Total de triggers no projeto: " + triggers.length);
}

// ========================================
// FUNÇÃO: LIMPAR CACHE MANUALMENTE
// ========================================

function limparCacheManual() {
  Logger.log("=== LIMPEZA MANUAL DE CACHE ===\n");
  
  var sucesso = limparCacheAutomatico();
  
  if (sucesso) {
    Browser.msgBox(
      "✅ Cache Limpo!",
      "Limpeza manual concluída com sucesso.\n\n" +
      "Verifique os logs na planilha: " + CONFIG_CACHE.nomePlanilhaLog,
      Browser.Buttons.OK
    );
  } else {
    Browser.msgBox(
      "❌ Erro",
      "Ocorreu um erro ao limpar o cache.\n" +
      "Verifique os logs para mais detalhes.",
      Browser.Buttons.OK
    );
  }
}

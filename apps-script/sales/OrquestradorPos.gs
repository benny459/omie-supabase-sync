// ════════════════════════════════════════════════════════════════════════════
// 🔄 ORQUESTRADOR PÓS-IMPORT — Sheets → SmartSuite → Webex
//
// Roda DEPOIS que o GitHub Actions terminou de popular o Supabase e o
// SheetsMirror atualizou as abas de dados. Este script cuida de:
//   1. Garantir que o Sheets está fresco (rodar mirrorTudo)
//   2. Rodar a Consolidação PV+OS (transformação local)
//   3. Sincronizar com SmartSuite (Sales Avulsos + Projetos Ativos)
//   4. Enviar relatório Webex com o resumo da execução
//
// ⚙️ DEPENDÊNCIAS (tem que estar no mesmo projeto Apps Script):
//   • SupabaseClient.gs     — pra supaSelect usado no Webex report
//   • SheetsMirror.gs       — pra mirrorTudo()
//   • Consolidação_V10.2_D.gs       — criarConsolidacaoPVOS()
//   • Sales_avulsos_3.13.gs         — sincronizarEInserir()
//   • Expor_Projects.gs             — sincronizarProjetosAtivos()
//
// ⚠️ IMPORTANTE:
//   • DELETE o arquivo Menu_3.0.gs antigo — ele vai conflitar com o onOpen
//     e suas funções de importação Omie agora vivem no GitHub Actions.
//   • As credenciais do Webex ficam em ScriptProperties. Execute
//     setupWebexCredenciais() uma vez antes de usar.
//
// 🎯 USO:
//   1. Cole este arquivo no Apps Script (novo arquivo "OrquestradorPos")
//   2. Apague o Menu_3.0.gs antigo
//   3. Execute setupWebexCredenciais() uma vez (menu dropdown → Run)
//   4. Execute iniciarPosImport() manualmente pra testar a cadeia inteira
//   5. Quando estiver OK, execute criarTriggerPosImport() pra agendar
//      a execução diária automática às 01:00 BRT
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎮 CONFIG
// ========================================

// Sequência de funções a executar (em ordem). Cada step é isolado:
// se uma falhar, as próximas continuam rodando (como GHA com continue-on-error).
var ETAPAS_POS_IMPORT = [
  { nome: "1️⃣  Mirror Supabase → Sheets",    fn: function() { return mirrorTudo(); } },
  { nome: "2️⃣  Consolidação PV + OS",         fn: function() { return criarConsolidacaoPVOS(); } },
  { nome: "3️⃣  SmartSuite — Sales Avulsos",   fn: function() { return sincronizarEInserir(); } },
  { nome: "4️⃣  SmartSuite — Projetos Ativos", fn: function() { return sincronizarProjetosAtivos(); } }
];

// ========================================
// 🍔 MENU (substitui o Menu_3.0 antigo)
// ========================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 Pós-Import')
    .addItem('▶️  Rodar cadeia completa', 'iniciarPosImport')
    .addSeparator()
    .addItem('1. Só Mirror Supabase → Sheets', 'mirrorTudo')
    .addItem('2. Só Consolidação PV + OS',     'criarConsolidacaoPVOS')
    .addItem('3. Só SmartSuite Sales',          'sincronizarEInserir')
    .addItem('4. Só SmartSuite Projetos',       'sincronizarProjetosAtivos')
    .addItem('5. Só Webex Report',              'enviarResumoPosImportManual')
    .addSeparator()
    .addItem('⏰ Criar trigger diário (01:00 BRT)', 'criarTriggerPosImport')
    .addItem('🗑️  Remover trigger',                  'removerTriggerPosImport')
    .addSeparator()
    .addItem('🔐 Setup Webex credenciais (1x)',     'setupWebexCredenciais')
    .addToUi();
}

// ========================================
// 🔐 SETUP CREDENCIAIS WEBEX (rodar 1x)
// ========================================
function setupWebexCredenciais() {
  var props = PropertiesService.getScriptProperties();
  // Valores extraídos do seu Menu_3.0.gs original:
  props.setProperty('WEBEX_TOKEN',   'MTRjZjFkODgtN2JiOS00OTljLWI4NzQtMjY3NTE0MmIzZWI1YmM1NTk1MTctMWVl_P0A1_f71b3b0c-41aa-4432-a8ec-0fba0a4e36ad');
  props.setProperty('WEBEX_ROOM_ID', 'Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vNDE5NmYyYjAtMDAxOS0xMWYxLThhZTktZDUwZjlkMjk2NTg4');
  Logger.log('✅ Credenciais Webex salvas em ScriptProperties');
  Logger.log('   Agora você pode APAGAR os valores hardcoded acima se quiser.');
}

function _getWebexCfg_() {
  var props = PropertiesService.getScriptProperties();
  return {
    url: 'https://webexapis.com/v1/messages',
    token: props.getProperty('WEBEX_TOKEN'),
    roomId: props.getProperty('WEBEX_ROOM_ID')
  };
}

// ========================================
// 🚀 ORQUESTRADOR PRINCIPAL
// ========================================
/**
 * Executa a cadeia pós-import inteira (mirror → consolidação → SmartSuite → Webex).
 * Chamável manualmente OU via trigger time-based.
 */
function iniciarPosImport() {
  var inicio = new Date().getTime();
  Logger.log('🚀 Iniciando Orquestrador Pós-Import...');

  var stats = [];

  for (var i = 0; i < ETAPAS_POS_IMPORT.length; i++) {
    var etapa = ETAPAS_POS_IMPORT[i];
    stats.push(_runStep_(etapa.nome, etapa.fn));
  }

  var totalSeg = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log('🏁 Cadeia concluída em ' + totalSeg + 's');

  // Sempre tenta enviar Webex, mesmo se algum step falhou
  try {
    enviarResumoPosImport(stats, totalSeg);
  } catch (err) {
    Logger.log('❌ Webex report falhou: ' + err.message);
  }

  return stats;
}

/**
 * Executa 1 step capturando erros e medindo tempo.
 * Retorna { etapa, status, msg, segundos, hora }.
 */
function _runStep_(nome, fn) {
  var inicio = new Date().getTime();
  var status = 'SUCESSO';
  var msg = '';
  var resultado = null;

  Logger.log('▶️  ' + nome);

  try {
    resultado = fn();
    // Se a função retornou um número, é contagem de registros
    if (typeof resultado === 'number') {
      msg = resultado + ' reg';
    } else if (resultado && typeof resultado === 'object') {
      // Pra mirrorTudo que retorna array de strings
      if (Array.isArray(resultado)) {
        msg = resultado.length + ' módulos';
      } else {
        msg = JSON.stringify(resultado).substring(0, 60);
      }
    } else {
      msg = 'OK';
    }
  } catch (err) {
    status = 'ERRO';
    msg = (err.message || String(err)).substring(0, 80);
    Logger.log('❌ ' + nome + ': ' + msg);
  }

  var segundos = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log('   ' + (status === 'SUCESSO' ? '✅' : '❌') + ' ' + nome + ' (' + segundos + 's | ' + msg + ')');

  return {
    etapa: nome,
    status: status,
    msg: msg,
    segundos: segundos,
    hora: Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'HH:mm')
  };
}

// ========================================
// 📡 WEBEX REPORT
// ========================================
/**
 * Versão para chamar manualmente do menu (sem stats da cadeia).
 * Só manda status atual do Supabase sync_state.
 */
function enviarResumoPosImportManual() {
  enviarResumoPosImport([], 0);
}

/**
 * Monta e envia o relatório Webex.
 * @param {Array} stats - Array de { etapa, status, msg, segundos, hora } da cadeia atual
 * @param {Number} totalSeg - Tempo total da cadeia em segundos
 */
function enviarResumoPosImport(stats, totalSeg) {
  stats = stats || [];
  totalSeg = totalSeg || 0;

  var cfg = _getWebexCfg_();
  if (!cfg.token || !cfg.roomId) {
    throw new Error('Credenciais Webex não configuradas. Execute setupWebexCredenciais() primeiro.');
  }

  // Lê sync_state do Supabase pra ter dados atualizados dos imports do GHA
  var importsSupa = [];
  try {
    importsSupa = supaSelect('sales', 'sync_state', 'select=*&order=modulo');
  } catch (err) {
    Logger.log('⚠️  Falha lendo sync_state: ' + err.message);
  }

  var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM HH:mm');
  var totalMin = totalSeg > 0 ? (totalSeg / 60).toFixed(1) + ' min' : '—';

  // ── Montagem do markdown ──
  var msg = '### 🤖 Relatório Sales Orders — ' + agora + '\n\n';

  // ── Seção 1: imports GHA (do Supabase sync_state) ──
  if (importsSupa.length > 0) {
    msg += '**📥 Imports GHA (Omie → Supabase):**\n\n';
    msg += '| Módulo | Status | Rows | Última sync |\n';
    msg += '|---|---|---|---|\n';

    // Agrupa por módulo base (remove sufixo empresa pra contar total)
    var totalPorModulo = {};
    importsSupa.forEach(function(s) {
      var base = s.modulo.replace(/_(SF|CD|WW)$/, '');
      if (!totalPorModulo[base]) {
        totalPorModulo[base] = { total: 0, status: 'SUCESSO', ultimaSync: '', erros: 0 };
      }
      totalPorModulo[base].total += (s.total_registros || 0);
      if (s.ultima_execucao_status !== 'SUCESSO') {
        totalPorModulo[base].status = 'ERRO';
        totalPorModulo[base].erros++;
      }
      if (s.last_sync_at && s.last_sync_at > totalPorModulo[base].ultimaSync) {
        totalPorModulo[base].ultimaSync = s.last_sync_at;
      }
    });

    Object.keys(totalPorModulo).sort().forEach(function(k) {
      var m = totalPorModulo[k];
      var icon = m.status === 'SUCESSO' ? '🟢' : '🔴';
      var lastSync = m.ultimaSync ? m.ultimaSync.substring(11, 16) : '—';
      var nomeBonito = k.replace(/_/g, ' ');
      msg += '| ' + nomeBonito + ' | ' + icon + ' | ' + m.total + ' | ' + lastSync + ' UTC |\n';
    });
    msg += '\n';
  } else {
    msg += '⚠️  *Não consegui ler sync_state do Supabase*\n\n';
  }

  // ── Seção 2: cadeia pós-import (stats locais) ──
  if (stats.length > 0) {
    msg += '**🔄 Cadeia Pós-Import (Apps Script):**\n\n';
    msg += '| Etapa | Status | Tempo | Hora | Obs |\n';
    msg += '|---|---|---|---|---|\n';

    stats.forEach(function(s) {
      var icon = s.status === 'SUCESSO' ? '🟢' : '🔴';
      var nomeCurto = s.etapa.replace(/^[0-9]️⃣\s+/, '');
      msg += '| ' + nomeCurto + ' | ' + icon + ' | ' + s.segundos + 's | ' + s.hora + ' | ' + s.msg + ' |\n';
    });
    msg += '\n**Tempo total da cadeia:** ' + totalMin + '\n';
  }

  // ── Alerta de falha ──
  var temErro = stats.some(function(s) { return s.status === 'ERRO'; });
  if (temErro) {
    msg += '\n🚨 **Atenção:** há falhas na cadeia pós-import. Verificar Apps Script.\n';
  }

  // ── POST pro Webex ──
  var payload = { roomId: cfg.roomId, markdown: msg };
  var options = {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + cfg.token,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(cfg.url, options);
  var code = resp.getResponseCode();
  if (code >= 200 && code < 300) {
    Logger.log('✅ Webex enviado (HTTP ' + code + ')');
    return { ok: true };
  } else {
    throw new Error('Webex HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
  }
}

// ========================================
// ⏰ TRIGGER DIÁRIO
// ========================================
/**
 * Cria trigger que roda iniciarPosImport() todo dia às 01:00 BRT.
 * Isso dá ~45 min após o GHA master começar (00:15) — tempo suficiente pra
 * os imports terminarem e o mirrorTudo ter rodado algumas vezes.
 */
function criarTriggerPosImport() {
  removerTriggerPosImport();
  ScriptApp.newTrigger('iniciarPosImport')
    .timeBased()
    .atHour(1)           // 01:00 no timezone do Sheets
    .nearMinute(0)
    .everyDays(1)
    .create();
  Logger.log('✅ Trigger criado: iniciarPosImport diário às 01:00 (timezone do Sheets)');
  Logger.log('   Verifique em: Menu lateral → Triggers (⏰)');
}

function removerTriggerPosImport() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  triggers.forEach(function(t) {
    if (t.getHandlerFunction() === 'iniciarPosImport') {
      ScriptApp.deleteTrigger(t);
      count++;
    }
  });
  Logger.log('🗑️  Removidos ' + count + ' trigger(s) de iniciarPosImport');
}

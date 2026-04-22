// ════════════════════════════════════════════════════════════════════════════
// 🔄 ORQUESTRADOR PÓS-IMPORT — FINANCE
// Sheets → Flows → SmartSuite → Webex
//
// ⚠️ ESTE ARQUIVO VAI NO PROJETO APPS SCRIPT DA PLANILHA FINANCE
//
// Roda DEPOIS que o GHA terminou de popular o Supabase e o SheetsMirror
// atualizou as abas de dados. Cuida de:
//   1. Mirror Supabase → Sheets (garante dados frescos)
//   2. Atualizar Pagar Flow (consolidação)
//   3. Atualizar Receber Flow (consolidação)
//   4. Sincronizar Clientes → SmartSuite
//   5. Enviar relatório Webex
//
// ⚙️ DEPENDÊNCIAS (mesmo projeto Apps Script):
//   • SupabaseClient.gs        — pra supaSelect no Webex report
//   • SheetsMirror_Finance.gs  — pra mirrorTudo()
//   • Update_Flow.gs           — atualizarPagarFlow(), atualizarReceberFlow()
//   • Smart_clientes.gs        — sincronizarClientes()
//
// ⚠️ IMPORTANTE: DELETE o Menu.gs antigo (conflita com onOpen)
// ════════════════════════════════════════════════════════════════════════════

var ETAPAS_POS_IMPORT = [
  { nome: "1️⃣  Mirror Supabase → Sheets",     fn: function() { return mirrorTudo(); } },
  { nome: "2️⃣  Atualizar Pagar Flow",          fn: function() { return atualizarPagarFlow(); } },
  { nome: "3️⃣  Atualizar Receber Flow",        fn: function() { return atualizarReceberFlow(); } },
  { nome: "4️⃣  SmartSuite — Clientes",         fn: function() { return sincronizarClientes(); } }
];

// ========================================
// 🍔 MENU
// ========================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 Pós-Import Finance')
    .addItem('▶️  Rodar cadeia completa', 'iniciarPosImport')
    .addSeparator()
    .addItem('1. Só Mirror Supabase → Sheets', 'mirrorTudo')
    .addItem('2. Só Pagar Flow', 'atualizarPagarFlow')
    .addItem('3. Só Receber Flow', 'atualizarReceberFlow')
    .addItem('4. Só SmartSuite Clientes', 'sincronizarClientes')
    .addItem('5. Só Webex Report', 'enviarResumoPosImportManual')
    .addSeparator()
    .addItem('📊 Atualizar Dashboard', 'atualizarDashboard')
    .addItem('🪞 Mirror tabela individual...', 'menuMirrorIndividual_')
    .addSeparator()
    .addItem('⏰ Criar trigger diário (02:00 BRT)', 'criarTriggerPosImport')
    .addItem('🗑️  Remover trigger', 'removerTriggerPosImport')
    .addSeparator()
    .addItem('🔐 Setup Webex credenciais (1x)', 'setupWebexCredenciais')
    .addToUi();
}

function menuMirrorIndividual_() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    'Mirror Individual',
    'Digite o nome da tabela:\nContasPagar, ContasReceber, PesquisaTitulos, ExtratosCC,\nClientes, Categorias, Projetos, ContasCorrentes, LancamentosCC, Bancos',
    ui.ButtonSet.OK_CANCEL
  );
  if (resp.getSelectedButton() === ui.Button.OK && resp.getResponseText().trim()) {
    try { mirrorTabela_(resp.getResponseText().trim()); }
    catch(e) { ui.alert('Erro: ' + e.message); }
  }
}

// ========================================
// 🔐 SETUP WEBEX
// ========================================
function setupWebexCredenciais() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('WEBEX_TOKEN',   'MTRjZjFkODgtN2JiOS00OTljLWI4NzQtMjY3NTE0MmIzZWI1YmM1NTk1MTctMWVl_P0A1_f71b3b0c-41aa-4432-a8ec-0fba0a4e36ad');
  props.setProperty('WEBEX_ROOM_ID', 'Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vNDE5NmYyYjAtMDAxOS0xMWYxLThhZTktZDUwZjlkMjk2NTg4');
  Logger.log('✅ Credenciais Webex salvas');
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
function iniciarPosImport() {
  var inicio = new Date().getTime();
  Logger.log('🚀 Iniciando Orquestrador Pós-Import FINANCE...');

  var stats = [];
  for (var i = 0; i < ETAPAS_POS_IMPORT.length; i++) {
    stats.push(_runStep_(ETAPAS_POS_IMPORT[i].nome, ETAPAS_POS_IMPORT[i].fn));
  }

  var totalSeg = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log('🏁 Cadeia Finance concluída em ' + totalSeg + 's');

  try { enviarResumoPosImport(stats, totalSeg); }
  catch (err) { Logger.log('❌ Webex falhou: ' + err.message); }

  return stats;
}

function _runStep_(nome, fn) {
  var inicio = new Date().getTime();
  var status = 'SUCESSO', msg = '';
  Logger.log('▶️  ' + nome);
  try {
    var resultado = fn();
    if (typeof resultado === 'number') msg = resultado + ' reg';
    else if (Array.isArray(resultado)) msg = resultado.length + ' módulos';
    else msg = 'OK';
  } catch (err) {
    status = 'ERRO';
    msg = (err.message || String(err)).substring(0, 80);
    Logger.log('❌ ' + nome + ': ' + msg);
  }
  var segundos = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log('   ' + (status === 'SUCESSO' ? '✅' : '❌') + ' ' + nome + ' (' + segundos + 's | ' + msg + ')');
  return { etapa: nome, status: status, msg: msg, segundos: segundos,
           hora: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'HH:mm') };
}

// ========================================
// 📡 WEBEX REPORT
// ========================================
function enviarResumoPosImportManual() { enviarResumoPosImport([], 0); }

function enviarResumoPosImport(stats, totalSeg) {
  stats = stats || []; totalSeg = totalSeg || 0;
  var cfg = _getWebexCfg_();
  if (!cfg.token || !cfg.roomId) throw new Error('Execute setupWebexCredenciais()');

  var importsSupa = [];
  try { importsSupa = supaSelect('sales', 'sync_state', 'select=*&order=modulo'); } catch(e) {}

  var financeImports = importsSupa.filter(function(s) {
    return s.modulo && (s.modulo.indexOf('contas_pagar')>=0 || s.modulo.indexOf('contas_receber')>=0 ||
      s.modulo.indexOf('pesquisa_titulos')>=0 || s.modulo.indexOf('extratos_cc')>=0 ||
      s.modulo.indexOf('clientes')>=0 || s.modulo.indexOf('categorias')>=0 ||
      s.modulo.indexOf('projetos')>=0 || s.modulo.indexOf('lancamentos_cc')>=0);
  });

  var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM HH:mm');
  var msg = '### 💵 Relatório Finance — ' + agora + '\n\n';

  if (financeImports.length > 0) {
    msg += '**📥 Imports GHA:**\n| Módulo | Status | Rows | Sync |\n|---|---|---|---|\n';
    financeImports.forEach(function(s) {
      var icon = s.ultima_execucao_status === 'SUCESSO' ? '🟢' : '🔴';
      var sync = s.last_sync_at ? s.last_sync_at.substring(11, 16) : '—';
      msg += '| ' + (s.modulo||'').replace(/_/g,' ') + ' | ' + icon + ' | ' + (s.total_registros||0) + ' | ' + sync + ' UTC |\n';
    });
    msg += '\n';
  }

  if (stats.length > 0) {
    msg += '**🔄 Pós-Import:**\n| Etapa | Status | Tempo | Obs |\n|---|---|---|---|\n';
    stats.forEach(function(s) {
      msg += '| ' + s.etapa.replace(/^[0-9]️⃣\s+/,'') + ' | ' + (s.status==='SUCESSO'?'🟢':'🔴') + ' | ' + s.segundos + 's | ' + s.msg + ' |\n';
    });
    msg += '\n**Tempo total:** ' + (totalSeg > 0 ? (totalSeg/60).toFixed(1) + ' min' : '—') + '\n';
  }

  if (stats.some(function(s){return s.status==='ERRO'})) msg += '\n🚨 **Falhas detectadas.**\n';

  var resp = UrlFetchApp.fetch(cfg.url, {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    payload: JSON.stringify({ roomId: cfg.roomId, markdown: msg }),
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) Logger.log('✅ Webex enviado');
  else throw new Error('Webex HTTP ' + resp.getResponseCode());
}

// ========================================
// ⏰ TRIGGER
// ========================================
function criarTriggerPosImport() {
  removerTriggerPosImport();
  ScriptApp.newTrigger('iniciarPosImport').timeBased().atHour(2).nearMinute(0).everyDays(1).create();
  Logger.log('✅ Trigger: iniciarPosImport Finance diário às 02:00 BRT');
}

function removerTriggerPosImport() {
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === 'iniciarPosImport') ScriptApp.deleteTrigger(t);
  });
}

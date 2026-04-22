// ════════════════════════════════════════════════════════════════════════════
// 🔄 ORQUESTRADOR PÓS-IMPORT — ORDERS (Compras)
// Sheets → Compilação → SmartSuite → Webex
//
// ⚠️ ESTE ARQUIVO VAI NO PROJETO APPS SCRIPT DA PLANILHA DE ORDERS/COMPRAS
//
// Roda DEPOIS que o GitHub Actions terminou de popular o Supabase e o
// SheetsMirror atualizou as abas de dados. Este script cuida de:
//   1. Garantir que o Sheets está fresco (rodar mirrorTudo)
//   2. Compilar Pedidos de Compra (transformer)
//   3. Consolidar Dados (Painel de Resultados)
//   4. Sincronizar SmartSuite (Master + Projetos + V2 + Completa)
//   5. Gerar Relatório Analista
//   6. Enviar relatório Webex
//
// ⚙️ DEPENDÊNCIAS (mesmo projeto Apps Script):
//   • SupabaseClient.gs          — pra supaSelect no Webex report
//   • SheetsMirror_Orders.gs     — pra mirrorTudo()
//   • Pedidos Parciais_3_D.gs    — compilarPedidosCompra()
//   • Painel de Resultados_7.4_D.gs — consolidarDados()
//   • Smart_PC_7.32_D.gs        — executarSincronizacaoMaster()
//   • Smart_Projetos_8.4_D.gs   — sincronizarGERAL_ProjetosAtivos()
//   • Smart_av_report2_D.gs     — executarSincronizacaoV2()
//   • Smart_AV_7.13.gs          — executarSincronizacaoEConsolidacaoCompleta()
//   • _Resultado_Projeto_AJ_D.gs — gerarRelatorioAnalista()
//
// ⚠️ IMPORTANTE:
//   • DELETE o Menu_3.2.gs antigo (conflita com onOpen)
//   • As credenciais Webex ficam em ScriptProperties
//   • Execute setupWebexCredenciais() 1x antes de usar
//
// 🎯 USO:
//   1. Cole este arquivo no Apps Script da planilha Orders
//   2. Apague o Menu_3.2.gs antigo
//   3. Execute setupWebexCredenciais() 1x
//   4. Execute iniciarPosImport() manualmente pra testar
//   5. Quando OK, execute criarTriggerPosImport() pra agendar
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎮 CONFIG
// ========================================

var ETAPAS_POS_IMPORT = [
  { nome: "1️⃣  Mirror Supabase → Sheets",          fn: function() { return mirrorTudo(); } },
  { nome: "2️⃣  Compilar Pedidos de Compra",         fn: function() { return compilarPedidosCompra(); } },
  { nome: "3️⃣  Consolidar Dados (Painel)",          fn: function() { return consolidarDados(); } },
  { nome: "4️⃣  SmartSuite — Sync Master",           fn: function() { return executarSincronizacaoMaster(); } },
  { nome: "5️⃣  SmartSuite — Projetos Ativos",       fn: function() { return sincronizarGERAL_ProjetosAtivos(); } },
  { nome: "6️⃣  SmartSuite — Sync V2",               fn: function() { return executarSincronizacaoV2(); } },
  { nome: "7️⃣  SmartSuite — Sync Completa",         fn: function() { return executarSincronizacaoEConsolidacaoCompleta(); } },
  { nome: "8️⃣  Relatório Analista",                  fn: function() { return gerarRelatorioAnalista(); } }
];

// ========================================
// 🍔 MENU
// ========================================
function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('🔄 Pós-Import Orders')
    .addItem('▶️  Rodar cadeia completa', 'iniciarPosImport')
    .addSeparator()
    .addItem('1. Só Mirror Supabase → Sheets', 'mirrorTudo')
    .addItem('2. Só Compilar Pedidos', 'compilarPedidosCompra')
    .addItem('3. Só Consolidar Dados', 'consolidarDados')
    .addItem('4. Só SmartSuite Master', 'executarSincronizacaoMaster')
    .addItem('5. Só SmartSuite Projetos', 'sincronizarGERAL_ProjetosAtivos')
    .addItem('6. Só SmartSuite V2', 'executarSincronizacaoV2')
    .addItem('7. Só SmartSuite Completa', 'executarSincronizacaoEConsolidacaoCompleta')
    .addItem('8. Só Relatório Analista', 'gerarRelatorioAnalista')
    .addItem('9. Só Webex Report', 'enviarResumoPosImportManual')
    .addSeparator()
    .addItem('⏰ Criar trigger diário (01:30 BRT)', 'criarTriggerPosImport')
    .addItem('🗑️  Remover trigger', 'removerTriggerPosImport')
    .addSeparator()
    .addItem('🔐 Setup Webex credenciais (1x)', 'setupWebexCredenciais')
    .addToUi();
}

// ========================================
// 🔐 SETUP CREDENCIAIS WEBEX
// ========================================
function setupWebexCredenciais() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('WEBEX_TOKEN',   'MTRjZjFkODgtN2JiOS00OTljLWI4NzQtMjY3NTE0MmIzZWI1YmM1NTk1MTctMWVl_P0A1_f71b3b0c-41aa-4432-a8ec-0fba0a4e36ad');
  props.setProperty('WEBEX_ROOM_ID', 'Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vNDE5NmYyYjAtMDAxOS0xMWYxLThhZTktZDUwZjlkMjk2NTg4');
  Logger.log('✅ Credenciais Webex salvas em ScriptProperties');
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
  Logger.log('🚀 Iniciando Orquestrador Pós-Import ORDERS...');

  var stats = [];

  for (var i = 0; i < ETAPAS_POS_IMPORT.length; i++) {
    var etapa = ETAPAS_POS_IMPORT[i];
    stats.push(_runStep_(etapa.nome, etapa.fn));
  }

  var totalSeg = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log('🏁 Cadeia Orders concluída em ' + totalSeg + 's');

  try {
    enviarResumoPosImport(stats, totalSeg);
  } catch (err) {
    Logger.log('❌ Webex report falhou: ' + err.message);
  }

  return stats;
}

function _runStep_(nome, fn) {
  var inicio = new Date().getTime();
  var status = 'SUCESSO';
  var msg = '';

  Logger.log('▶️  ' + nome);

  try {
    var resultado = fn();
    if (typeof resultado === 'number') {
      msg = resultado + ' reg';
    } else if (resultado && typeof resultado === 'object') {
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
    hora: Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'HH:mm')
  };
}

// ========================================
// 📡 WEBEX REPORT
// ========================================
function enviarResumoPosImportManual() {
  enviarResumoPosImport([], 0);
}

function enviarResumoPosImport(stats, totalSeg) {
  stats = stats || [];
  totalSeg = totalSeg || 0;

  var cfg = _getWebexCfg_();
  if (!cfg.token || !cfg.roomId) {
    throw new Error('Credenciais Webex não configuradas. Execute setupWebexCredenciais().');
  }

  // Lê sync_state do Supabase
  var importsSupa = [];
  try {
    importsSupa = supaSelect('sales', 'sync_state', 'select=*&order=modulo');
  } catch (err) {
    Logger.log('⚠️  Falha lendo sync_state: ' + err.message);
  }

  var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM HH:mm');
  var totalMin = totalSeg > 0 ? (totalSeg / 60).toFixed(1) + ' min' : '—';

  var msg = '### 🛒 Relatório Orders (Compras) — ' + agora + '\n\n';

  // Imports GHA (filtra só Orders)
  var ordersImports = importsSupa.filter(function(s) {
    return s.modulo && (
      s.modulo.indexOf('nfe_entrada') >= 0 ||
      s.modulo.indexOf('recebimento_nfe') >= 0 ||
      s.modulo.indexOf('pedidos_compra') >= 0 ||
      s.modulo.indexOf('produtos_compras') >= 0 ||
      s.modulo.indexOf('etapas_faturamento') >= 0 ||
      s.modulo.indexOf('formas_pag') >= 0 ||
      s.modulo.indexOf('familias') >= 0 ||
      s.modulo.indexOf('produto_fornecedor') >= 0 ||
      s.modulo.indexOf('unidades') >= 0
    );
  });

  if (ordersImports.length > 0) {
    msg += '**📥 Imports GHA (Omie → Supabase):**\n\n';
    msg += '| Módulo | Status | Rows | Última sync |\n';
    msg += '|---|---|---|---|\n';

    ordersImports.forEach(function(s) {
      var icon = s.ultima_execucao_status === 'SUCESSO' ? '🟢' : '🔴';
      var lastSync = s.last_sync_at ? s.last_sync_at.substring(11, 16) : '—';
      var nome = (s.modulo || '').replace(/_/g, ' ');
      msg += '| ' + nome + ' | ' + icon + ' | ' + (s.total_registros || 0) + ' | ' + lastSync + ' UTC |\n';
    });
    msg += '\n';
  }

  // Cadeia pós-import
  if (stats.length > 0) {
    msg += '**🔄 Cadeia Pós-Import (Apps Script):**\n\n';
    msg += '| Etapa | Status | Tempo | Hora | Obs |\n';
    msg += '|---|---|---|---|---|\n';

    stats.forEach(function(s) {
      var icon = s.status === 'SUCESSO' ? '🟢' : '🔴';
      var nome = s.etapa.replace(/^[0-9]️⃣\s+/, '');
      msg += '| ' + nome + ' | ' + icon + ' | ' + s.segundos + 's | ' + s.hora + ' | ' + s.msg + ' |\n';
    });
    msg += '\n**Tempo total:** ' + totalMin + '\n';
  }

  var temErro = stats.some(function(s) { return s.status === 'ERRO'; });
  if (temErro) {
    msg += '\n🚨 **Atenção:** há falhas na cadeia pós-import Orders.\n';
  }

  var payload = { roomId: cfg.roomId, markdown: msg };
  var options = {
    method: 'post',
    headers: { 'Authorization': 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  var resp = UrlFetchApp.fetch(cfg.url, options);
  if (resp.getResponseCode() >= 200 && resp.getResponseCode() < 300) {
    Logger.log('✅ Webex enviado');
    return { ok: true };
  } else {
    throw new Error('Webex HTTP ' + resp.getResponseCode());
  }
}

// ========================================
// ⏰ TRIGGER DIÁRIO
// ========================================
function criarTriggerPosImport() {
  removerTriggerPosImport();
  ScriptApp.newTrigger('iniciarPosImport')
    .timeBased()
    .atHour(1)
    .nearMinute(30)
    .everyDays(1)
    .create();
  Logger.log('✅ Trigger criado: iniciarPosImport Orders diário às 01:30 BRT');
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
  Logger.log('🗑️  Removidos ' + count + ' trigger(s)');
}

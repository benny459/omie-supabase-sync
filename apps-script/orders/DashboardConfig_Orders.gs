// ════════════════════════════════════════════════════════════════════════════
// 📊 DASHBOARD — ORDERS ONLY
// Mostra APENAS módulos Orders no Dashboard desta planilha.
// DEPENDÊNCIA: SupabaseClient.gs + SheetsMirror_Orders.gs
// ════════════════════════════════════════════════════════════════════════════

var ORDERS_MODULOS = [
  'nfe_entrada', 'recebimento_nfe', 'pedidos_compra', 'produtos_compras',
  'etapas_faturamento', 'formas_pagamento_vendas', 'familias_produtos',
  'produto_fornecedor', 'unidades', 'formas_pagamento_compras'
];

function _isOrdersModulo_(mod) {
  return ORDERS_MODULOS.some(function(s) { return mod.indexOf(s) >= 0; });
}

/** Mapeia módulo do sync_state → chave do MIRROR_CFG */
function _mirrorKeyForModulo_(modulo) {
  if (!modulo) return null;
  var mod = String(modulo).replace(/_(SF|CD|WW)$/i, '');
  if (typeof MIRROR_CFG === 'undefined') return null;
  for (var key in MIRROR_CFG) {
    if (MIRROR_CFG[key] && MIRROR_CFG[key].tabela === mod) return key;
  }
  return null;
}

/** Timestamp do último mirror de um módulo, em BRT */
function _ultimoMirrorBRT_(modulo) {
  var key = _mirrorKeyForModulo_(modulo);
  if (!key) return '—';
  var ts = PropertiesService.getScriptProperties().getProperty('MIRROR_TS_' + key);
  if (!ts) return '—';
  try { return Utilities.formatDate(new Date(ts), 'America/Sao_Paulo', 'dd/MM HH:mm'); }
  catch(e) { return String(ts).substring(0, 16); }
}

// ════════════════════════════════════════════════════════════════════════════
// 🚀 GitHub Actions + sync_state
// ════════════════════════════════════════════════════════════════════════════

var GH_REPO = 'benny459/omie-supabase-sync';

function setGitHubToken(token) {
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', (token || '').trim());
  Logger.log('✅ GITHUB_TOKEN salvo');
}

function _maxSyncStateOrders_(ordersData) {
  var maxTs = null, count = 0, totalRegs = 0, okCount = 0;
  ordersData.forEach(function(s) {
    if (s.last_sync_at) {
      var ts = new Date(s.last_sync_at);
      if (!maxTs || ts > maxTs) maxTs = ts;
    }
    count++;
    totalRegs += (s.total_registros || 0);
    if (s.ultima_execucao_status === 'SUCESSO') okCount++;
  });
  return { maxTs: maxTs, count: count, totalRegs: totalRegs, okCount: okCount };
}

function _ultimoRunWorkflow_(workflowFile) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return { status: 'sem_token' };
  try {
    var url = 'https://api.github.com/repos/' + GH_REPO +
              '/actions/workflows/' + workflowFile + '/runs?per_page=1';
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'token ' + token,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code !== 200) return { status: 'http_' + code };
    var data = JSON.parse(resp.getContentText());
    var run = (data.workflow_runs || [])[0];
    if (!run) return { status: 'sem_runs' };
    var created = new Date(run.created_at);
    var updated = new Date(run.updated_at);
    return {
      status: 'ok',
      conclusion: run.conclusion,
      runStatus: run.status,
      created_at: created,
      duracao_s: Math.max(0, (updated - created) / 1000),
      event: run.event,
      html_url: run.html_url
    };
  } catch(e) {
    return { status: 'excecao', msg: e.message };
  }
}

function _iconConclusion_(c, runStatus) {
  if (runStatus === 'in_progress') return '🔄';
  if (runStatus === 'queued') return '⏸️';
  if (c === 'success') return '✅';
  if (c === 'failure') return '❌';
  if (c === 'cancelled') return '⏹️';
  return '⏳';
}

function _formatDur_(s) {
  if (!s || s < 0) return '—';
  if (s < 60) return Math.round(s) + 's';
  var m = Math.floor(s / 60), r = Math.round(s % 60);
  return m + 'm ' + r + 's';
}

function testarGitHubToken() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) { Logger.log('❌ Nenhum GITHUB_TOKEN salvo.'); return; }
  Logger.log('🔑 Token: ' + token.length + ' chars, prefixo ' + token.substring(0,4) + '...');
  Logger.log('📦 Repo: ' + GH_REPO);
  ['/user', '/repos/' + GH_REPO, '/repos/' + GH_REPO + '/actions/workflows'].forEach(function(path, i) {
    var r = UrlFetchApp.fetch('https://api.github.com' + path, {
      method: 'get',
      headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
      muteHttpExceptions: true
    });
    Logger.log('Teste ' + (i+1) + ' (' + path + '): HTTP ' + r.getResponseCode());
    if (r.getResponseCode() !== 200) Logger.log('   → ' + r.getContentText().substring(0, 200));
  });
}

// ════════════════════════════════════════════════════════════════════════════
// 📊 DASHBOARD PRINCIPAL
// ════════════════════════════════════════════════════════════════════════════

function atualizarDashboard() {
  var inicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var syncData = [];
  try {
    // Importante: schema "orders" (não "sales")
    syncData = supaSelect('orders', 'sync_state', 'select=*&order=modulo');
  } catch (err) {
    // Fallback: sync_state pode estar em outro schema — tenta sales
    try {
      syncData = supaSelect('sales', 'sync_state', 'select=*&order=modulo');
    } catch(e2) {
      Logger.log('⚠️ Dashboard: falha lendo sync_state: ' + err.message);
      return;
    }
  }

  var ordersData = syncData.filter(function(s) { return s.modulo && _isOrdersModulo_(s.modulo); });

  var sheet = ss.getSheetByName('📊 Dashboard') || ss.insertSheet('📊 Dashboard');
  sheet.clear();

  var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  sheet.getRange('A1').setValue('📊 Dashboard Orders — ' + agora).setFontSize(14).setFontWeight('bold');

  // 🚀 BLOCO DE EXECUÇÃO
  sheet.getRange('A3').setValue('🚀 Execução — Orders').setFontSize(12).setFontWeight('bold');
  sheet.getRange(4, 1, 1, 4).setValues([['Fonte', 'Último run', 'Status', 'Detalhe']])
    .setFontWeight('bold').setBackground('#6A1B9A').setFontColor('white');  // roxo (cor Orders)

  var execRows = [];
  var mx = _maxSyncStateOrders_(ordersData);
  var mxWhen = mx.maxTs ? Utilities.formatDate(mx.maxTs, 'America/Sao_Paulo', 'dd/MM HH:mm') : '—';
  var mxStatus = (mx.okCount === mx.count && mx.count > 0)
    ? '✅ ' + mx.okCount + '/' + mx.count + ' OK'
    : '⚠️ ' + mx.okCount + '/' + mx.count + ' OK';
  execRows.push(['📊 Supabase sync_state', mxWhen, mxStatus,
                 mx.totalRegs.toLocaleString('pt-BR') + ' rows totais']);

  ['master_orders_diaria.yml', 'master_orders_semanal.yml'].forEach(function(wfFile) {
    var label = '🚀 GitHub ' + wfFile.replace('.yml','').replace('master_','').replace(/_/g,' ');
    var r = _ultimoRunWorkflow_(wfFile);
    if (r.status === 'ok') {
      var when = Utilities.formatDate(r.created_at, 'America/Sao_Paulo', 'dd/MM HH:mm');
      var st = _iconConclusion_(r.conclusion, r.runStatus) + ' ' +
               (r.runStatus === 'completed' ? (r.conclusion || '?') : r.runStatus);
      execRows.push([label, when, st, _formatDur_(r.duracao_s) + ' · ' + (r.event || '')]);
    } else if (r.status === 'sem_token') {
      execRows.push([label, '—', '🔑 sem token', 'Rode setGitHubToken("...")']);
    } else {
      execRows.push([label, '—', '⚠️ ' + r.status, r.msg || '']);
    }
  });
  sheet.getRange(5, 1, execRows.length, 4).setValues(execRows);
  var execStatusRange = sheet.getRange(5, 3, execRows.length, 1);

  // 📦 TABELAS ORDERS
  var rowIdx = 5 + execRows.length + 2;
  sheet.getRange(rowIdx, 1).setValue('📦 Tabelas Orders no Supabase').setFontSize(12).setFontWeight('bold');
  rowIdx++;
  sheet.getRange(rowIdx, 1, 1, 2).setValues([['Tabela', 'Total Rows']])
    .setFontWeight('bold').setBackground('#6A1B9A').setFontColor('white');
  rowIdx++;
  var tabelaStartRow = rowIdx;
  ORDERS_MODULOS.forEach(function(t) {
    try {
      var c = supaSelect('orders', t, 'select=count');
      var count = c.length > 0 ? (c[0].count || 0) : 0;
      sheet.getRange(rowIdx, 1, 1, 2).setValues([['orders.' + t, count]]);
    } catch (e) {
      sheet.getRange(rowIdx, 1, 1, 2).setValues([['orders.' + t, '?']]);
    }
    rowIdx++;
  });
  sheet.getRange(tabelaStartRow, 2, ORDERS_MODULOS.length, 1).setNumberFormat('#,##0');

  // 🔄 ÚLTIMA SINCRONIZAÇÃO
  rowIdx += 2;
  sheet.getRange(rowIdx, 1).setValue('🔄 Última Sincronização — Orders').setFontSize(12).setFontWeight('bold');
  rowIdx++;
  var headerSync = ['Módulo', 'Empresa', 'Status', 'Modo', 'Total Rows', 'Duração', 'Último Mirror'];
  sheet.getRange(rowIdx, 1, 1, headerSync.length).setValues([headerSync])
    .setFontWeight('bold').setBackground('#6A1B9A').setFontColor('white');
  rowIdx++;

  if (ordersData.length > 0) {
    var rows = ordersData.map(function(s) {
      var statusIcon = s.ultima_execucao_status === 'SUCESSO' ? '✅' : '❌';
      return [
        (s.modulo || '').replace(/_/g, ' '),
        s.empresa || '',
        statusIcon + ' ' + (s.ultima_execucao_status || ''),
        s.modo || '—',
        s.total_registros || 0,
        s.duracao_segundos ? s.duracao_segundos + 's' : '—',
        _ultimoMirrorBRT_(s.modulo)
      ];
    });
    sheet.getRange(rowIdx, 1, rows.length, headerSync.length).setValues(rows);
    sheet.getRange(rowIdx, 5, rows.length, 1).setNumberFormat('#,##0');

    var statusRange = sheet.getRange(rowIdx, 3, rows.length, 1);
    sheet.setConditionalFormatRules([
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('SUCESSO').setBackground('#d9ead3').setRanges([statusRange, execStatusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('success').setBackground('#d9ead3').setRanges([execStatusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('ERRO').setBackground('#f4cccc').setRanges([statusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('failure').setBackground('#f4cccc').setRanges([execStatusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('in_progress').setBackground('#cfe2f3').setRanges([execStatusRange]).build(),
      SpreadsheetApp.newConditionalFormatRule().whenTextContains('cancelled').setBackground('#fff2cc').setRanges([execStatusRange]).build()
    ]);
  }

  sheet.setFrozenRows(0);
  sheet.setColumnWidth(1, 220);
  sheet.setColumnWidth(2, 110);
  sheet.setColumnWidth(3, 150);
  sheet.setColumnWidth(4, 220);
  sheet.setColumnWidth(7, 130);  // Último Mirror

  var tempo = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log('📊 Dashboard Orders atualizado em ' + tempo + 's (' + ordersData.length + ' módulos)');
}

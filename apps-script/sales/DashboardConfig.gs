// ════════════════════════════════════════════════════════════════════════════
// 📊 DASHBOARD — SALES ONLY
// Mostra APENAS módulos Sales no Dashboard desta planilha.
// DEPENDÊNCIA: SupabaseClient.gs
// ════════════════════════════════════════════════════════════════════════════

var SALES_MODULOS = [
  'itens_vendidos', 'etapas_pedidos', 'pedidos_venda',
  'ordens_servico', 'contratos_servico', 'produtos',
  'formas_pagamento', 'categorias'
];

function _isSalesModulo_(mod) {
  return SALES_MODULOS.some(function(s) { return mod.indexOf(s) >= 0; });
}

/**
 * Dado o nome do módulo do sync_state (ex: "itens_vendidos" ou "itens_vendidos_SF"),
 * retorna a chave correspondente no MIRROR_CFG do SheetsMirror.gs (ex: "ItensVendidos").
 * Usado pra buscar o timestamp do último mirror em ScriptProperties.
 */
function _mirrorKeyForModulo_(modulo) {
  if (!modulo) return null;
  var mod = String(modulo).replace(/_(SF|CD|WW)$/i, '');
  if (typeof MIRROR_CFG === 'undefined') return null;
  for (var key in MIRROR_CFG) {
    if (MIRROR_CFG[key] && MIRROR_CFG[key].tabela === mod) return key;
  }
  return null;
}

/** Lê o timestamp do último mirror pra um módulo e formata BRT. */
function _ultimoMirrorBRT_(modulo) {
  var key = _mirrorKeyForModulo_(modulo);
  if (!key) return '—';
  var ts = PropertiesService.getScriptProperties().getProperty('MIRROR_TS_' + key);
  if (!ts) return '—';
  try {
    return Utilities.formatDate(new Date(ts), 'America/Sao_Paulo', 'dd/MM HH:mm');
  } catch(e) {
    return String(ts).substring(0, 16);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// 🚀 BLOCO DE EXECUÇÃO — sync_state + GitHub Actions
// ════════════════════════════════════════════════════════════════════════════

var GH_REPO = 'benny459/omie-supabase-sync';

/**
 * Configure UMA VEZ executando `setGitHubToken('ghp_xxx')` no editor Apps Script.
 * Rode `setGitHubToken` passando o mesmo PAT que você usa no painel web.
 */
function setGitHubToken(token) {
  PropertiesService.getScriptProperties().setProperty('GITHUB_TOKEN', (token || '').trim());
  Logger.log('✅ GITHUB_TOKEN salvo nas ScriptProperties');
}

// ⚠️ ═══════════════════════════════════════════════════════════════════════════
// ⚠️ FUNÇÃO TEMPORÁRIA — RODAR 1X E DEPOIS APAGAR
// ⚠️ Após executar esta função uma vez, APAGUE o bloco abaixo pra não deixar
// ⚠️ o token exposto no código fonte. O token já fica seguro em ScriptProperties.
// ⚠️ ═══════════════════════════════════════════════════════════════════════════
function configurarMeuToken() {
  // ⚠️ COLE SEU TOKEN AQUI, RODE UMA VEZ, DEPOIS APAGUE.
  // NÃO commite o token — use ScriptProperties via setGitHubToken().
  setGitHubToken("COLE_SEU_TOKEN_AQUI");
}

/** Calcula o máximo de last_sync_at dos módulos Sales (indica "quando o GitHub Actions atualizou pela última vez"). */
function _maxSyncStateSales_(salesData) {
  var maxTs = null, count = 0, totalRegs = 0, okCount = 0;
  salesData.forEach(function(s) {
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

/** Consulta a API GitHub pra pegar o último run de um workflow. */
function _ultimoRunWorkflow_(workflowFile) {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) return { status: 'sem_token' };
  try {
    var url = 'https://api.github.com/repos/' + GH_REPO +
              '/actions/workflows/' + workflowFile + '/runs?per_page=1';
    var resp = UrlFetchApp.fetch(url, {
      method: 'get',
      headers: {
        'Authorization': 'token ' + token,  // "token" funciona pra classic PATs; Bearer pra fine-grained
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      muteHttpExceptions: true
    });
    var code = resp.getResponseCode();
    if (code !== 200) {
      // Grava body do erro em ScriptProperties pra debug posterior
      var body = resp.getContentText().substring(0, 300);
      PropertiesService.getScriptProperties()
        .setProperty('GITHUB_LAST_ERROR', 'HTTP ' + code + ' | ' + workflowFile + ' | ' + body);
      return { status: 'http_' + code };
    }
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

/**
 * Função de diagnóstico. Rode no editor Apps Script e veja o Logger.
 * Testa o token atual + reporta qual é o problema exato.
 */
function testarGitHubToken() {
  var token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (!token) { Logger.log('❌ Nenhum GITHUB_TOKEN salvo. Rode setGitHubToken("ghp_xxx") primeiro.'); return; }
  Logger.log('🔑 Token presente. Tamanho: ' + token.length + ' chars. Prefixo: ' + token.substring(0,4) + '...');
  Logger.log('📦 Repo configurado: ' + GH_REPO);

  // Teste 1: /user (qualquer token válido retorna 200 aqui)
  var r1 = UrlFetchApp.fetch('https://api.github.com/user', {
    method: 'get',
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  Logger.log('Teste 1 (GET /user): HTTP ' + r1.getResponseCode());
  if (r1.getResponseCode() === 200) {
    var u = JSON.parse(r1.getContentText());
    Logger.log('   → Usuário autenticado: ' + u.login);
  } else {
    Logger.log('   → Body: ' + r1.getContentText().substring(0, 200));
  }

  // Teste 2: /repos/{repo} (valida acesso ao repo específico)
  var r2 = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO, {
    method: 'get',
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  Logger.log('Teste 2 (GET /repos/' + GH_REPO + '): HTTP ' + r2.getResponseCode());
  if (r2.getResponseCode() !== 200) {
    Logger.log('   → Body: ' + r2.getContentText().substring(0, 200));
  }

  // Teste 3: /actions/workflows (valida escopo Actions Read)
  var r3 = UrlFetchApp.fetch('https://api.github.com/repos/' + GH_REPO + '/actions/workflows', {
    method: 'get',
    headers: { 'Authorization': 'token ' + token, 'Accept': 'application/vnd.github+json' },
    muteHttpExceptions: true
  });
  Logger.log('Teste 3 (Actions/workflows): HTTP ' + r3.getResponseCode());
  if (r3.getResponseCode() === 200) {
    var wfs = JSON.parse(r3.getContentText());
    Logger.log('   → ✅ ' + wfs.total_count + ' workflows vis\u00edveis');
  } else {
    Logger.log('   → Body: ' + r3.getContentText().substring(0, 200));
    Logger.log('   → DICA: token precisa do escopo "repo" (classic) ou "Actions: Read" (fine-grained)');
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

function atualizarDashboard() {
  var inicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var syncData = [];
  try {
    syncData = supaSelect('sales', 'sync_state', 'select=*&order=modulo');
  } catch (err) {
    Logger.log('⚠️ Dashboard: falha lendo sync_state: ' + err.message);
    return;
  }

  // Filtra SÓ módulos Sales
  var salesData = syncData.filter(function(s) { return s.modulo && _isSalesModulo_(s.modulo); });

  var sheet = ss.getSheetByName('📊 Dashboard') || ss.insertSheet('📊 Dashboard');
  sheet.clear();

  var agora = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy HH:mm');
  sheet.getRange('A1').setValue('📊 Dashboard Sales — ' + agora).setFontSize(14).setFontWeight('bold');

  // ───────────────────────────────────────────────────────────────
  // 🚀 BLOCO DE EXECUÇÃO — sync_state (Supabase) + GitHub Actions
  // ───────────────────────────────────────────────────────────────
  sheet.getRange('A3').setValue('🚀 Execução — Sales').setFontSize(12).setFontWeight('bold');
  var execHeader = ['Fonte', 'Último run', 'Status', 'Detalhe'];
  sheet.getRange(4, 1, 1, 4).setValues([execHeader])
    .setFontWeight('bold').setBackground('#0052CC').setFontColor('white');

  var execRows = [];

  // Fonte 1: sync_state do Supabase (MAX last_sync_at dos módulos Sales)
  var mx = _maxSyncStateSales_(salesData);
  var mxWhen = mx.maxTs
    ? Utilities.formatDate(mx.maxTs, 'America/Sao_Paulo', 'dd/MM HH:mm')
    : '—';
  var mxStatus = (mx.okCount === mx.count && mx.count > 0)
    ? '✅ ' + mx.okCount + '/' + mx.count + ' OK'
    : '⚠️ ' + mx.okCount + '/' + mx.count + ' OK';
  execRows.push(['📊 Supabase sync_state', mxWhen, mxStatus,
                 mx.totalRegs.toLocaleString('pt-BR') + ' rows totais']);

  // Fonte 2: GitHub Actions (Sales Diária e Semanal)
  ['master_sales_diaria.yml', 'master_sales_semanal.yml'].forEach(function(wfFile) {
    var label = '🚀 GitHub ' + wfFile.replace('.yml','').replace('master_','').replace(/_/g,' ');
    var r = _ultimoRunWorkflow_(wfFile);
    if (r.status === 'ok') {
      var when = Utilities.formatDate(r.created_at, 'America/Sao_Paulo', 'dd/MM HH:mm');
      var st = _iconConclusion_(r.conclusion, r.runStatus) + ' ' +
               (r.runStatus === 'completed' ? (r.conclusion || '?') : r.runStatus);
      execRows.push([label, when, st, _formatDur_(r.duracao_s) + ' · ' + (r.event || '')]);
    } else if (r.status === 'sem_token') {
      execRows.push([label, '—', '🔑 sem token',
                     'Configure: setGitHubToken("ghp_xxx")']);
    } else {
      execRows.push([label, '—', '⚠️ ' + r.status, r.msg || '']);
    }
  });

  sheet.getRange(5, 1, execRows.length, 4).setValues(execRows);
  // Formatação condicional do Status (coluna 3)
  var execStatusRange = sheet.getRange(5, 3, execRows.length, 1);

  // Tabelas Sales no Supabase (deslocado pra baixo)
  var rowIdx = 5 + execRows.length + 2;
  sheet.getRange(rowIdx, 1).setValue('📦 Tabelas Sales no Supabase').setFontSize(12).setFontWeight('bold');
  rowIdx++;
  var headerTab = ['Tabela', 'Total Rows'];
  sheet.getRange(rowIdx, 1, 1, 2).setValues([headerTab]).setFontWeight('bold').setBackground('#0052CC').setFontColor('white');
  rowIdx++;

  var tabelaStartRow = rowIdx;
  SALES_MODULOS.forEach(function(t) {
    try {
      var c = supaSelect('sales', t, 'select=count');
      var count = c.length > 0 ? (c[0].count || 0) : 0;
      sheet.getRange(rowIdx, 1, 1, 2).setValues([['sales.' + t, count]]);
    } catch (e) {
      sheet.getRange(rowIdx, 1, 1, 2).setValues([['sales.' + t, '?']]);
    }
    rowIdx++;
  });
  sheet.getRange(tabelaStartRow, 2, SALES_MODULOS.length, 1).setNumberFormat('#,##0');

  // Sync State — só Sales
  rowIdx += 2;
  sheet.getRange(rowIdx, 1).setValue('🔄 Última Sincronização — Sales').setFontSize(12).setFontWeight('bold');
  rowIdx++;

  var headerSync = ['Módulo', 'Empresa', 'Status', 'Modo', 'Total Rows', 'Duração', 'Último Mirror'];
  sheet.getRange(rowIdx, 1, 1, headerSync.length).setValues([headerSync])
    .setFontWeight('bold').setBackground('#0052CC').setFontColor('white');
  rowIdx++;

  if (salesData.length > 0) {
    var rows = salesData.map(function(s) {
      var statusIcon = s.ultima_execucao_status === 'SUCESSO' ? '✅' : '❌';
      var modo = s.modo || '—';
      return [
        (s.modulo || '').replace(/_/g, ' '),
        s.empresa || '',
        statusIcon + ' ' + (s.ultima_execucao_status || ''),
        modo,
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
  sheet.setColumnWidth(1, 220);  // Tabela / Fonte
  sheet.setColumnWidth(2, 110);  // Último run / Total
  sheet.setColumnWidth(3, 150);  // Status
  sheet.setColumnWidth(4, 220);  // Detalhe
  sheet.setColumnWidth(7, 130);  // Último Mirror

  var tempo = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log('📊 Dashboard Sales atualizado em ' + tempo + 's (' + salesData.length + ' módulos)');
}

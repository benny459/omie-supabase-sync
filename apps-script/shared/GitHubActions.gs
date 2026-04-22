// ════════════════════════════════════════════════════════════════════════════
// 🎮 GITHUB ACTIONS — Controle de workflows direto do Sheets
//
// Permite:
//   • Disparar workflows (Master Diária / Semanal) com 1 clique
//   • Ver horários atuais das execuções
//   • Mudar horários (cron) sem sair do Sheets
//   • Ver status dos últimos runs
//
// DEPENDÊNCIA:
//   • GitHub Personal Access Token (PAT) com scopes: repo, workflow
//     Gerar em: https://github.com/settings/tokens/new
//     Selecionar: repo (Full control) + workflow
//
// SETUP:
//   1. Cole este arquivo no Apps Script (novo "GitHubActions")
//   2. Rode setupGitHubToken() → cole seu PAT quando pedir
//   3. Use o menu "🔄 Pós-Import" → seção GitHub Actions
// ════════════════════════════════════════════════════════════════════════════

var GH_REPO = 'benny459/omie-supabase-sync';
var GH_API = 'https://api.github.com';

// ========================================
// 🔐 SETUP (rodar 1x)
// ========================================
function setupGitHubToken() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.prompt(
    '🔐 GitHub Token',
    'Cole seu Personal Access Token (PAT).\n\n' +
    'Gerar em: github.com/settings/tokens/new\n' +
    'Scopes necessários: repo + workflow\n\n' +
    'O token fica salvo nas ScriptProperties (seguro):',
    ui.ButtonSet.OK_CANCEL
  );

  if (resp.getSelectedButton() !== ui.Button.OK || !resp.getResponseText().trim()) {
    ui.alert('❌ Cancelado. Token não foi salvo.');
    return;
  }

  PropertiesService.getScriptProperties().setProperty('GITHUB_PAT', resp.getResponseText().trim());
  ui.alert('✅ Token GitHub salvo com sucesso!');
}

function _ghToken_() {
  var t = PropertiesService.getScriptProperties().getProperty('GITHUB_PAT');
  if (!t) throw new Error('Token GitHub não configurado. Execute setupGitHubToken() primeiro.');
  return t;
}

function _ghFetch_(endpoint, method, payload) {
  var url = GH_API + endpoint;
  var options = {
    method: method || 'get',
    headers: {
      'Authorization': 'Bearer ' + _ghToken_(),
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'OmieSheets/1.0'
    },
    muteHttpExceptions: true
  };
  if (payload) {
    options.contentType = 'application/json';
    options.payload = JSON.stringify(payload);
  }
  var resp = UrlFetchApp.fetch(url, options);
  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('GitHub API HTTP ' + code + ': ' + resp.getContentText().substring(0, 200));
  }
  return code === 204 ? {} : JSON.parse(resp.getContentText());
}

// ========================================
// 🚀 DISPARAR WORKFLOWS
// ========================================

function dispararMasterDiaria() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '🚀 Disparar Master Diária',
    'Vai iniciar: Etapas → ItensVendidos → PedidosVenda → Serviços\n\n' +
    'Empresa: SF\nDemora ~20-30 min.\n\nConfirma?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  try {
    _ghFetch_('/repos/' + GH_REPO + '/actions/workflows/master_sales_diaria.yml/dispatches', 'post', {
      ref: 'main',
      inputs: { empresas: 'SF', forcar_full: 'false' }
    });
    ui.alert('✅ Master Diária disparada!\n\nAcompanhe em:\ngithub.com/' + GH_REPO + '/actions');
  } catch (e) {
    ui.alert('❌ Erro: ' + e.message);
  }
}

function dispararMasterSemanal() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '🚀 Disparar Master Semanal',
    'Vai iniciar: Produtos → Auxiliares (FormasPag + Categorias)\n\n' +
    'Empresas: SF, CD, WW\nDemora ~5-10 min.\n\nConfirma?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  try {
    _ghFetch_('/repos/' + GH_REPO + '/actions/workflows/master_sales_semanal.yml/dispatches', 'post', {
      ref: 'main',
      inputs: { empresas: 'SF,CD,WW' }
    });
    ui.alert('✅ Master Semanal disparada!\n\nAcompanhe em:\ngithub.com/' + GH_REPO + '/actions');
  } catch (e) {
    ui.alert('❌ Erro: ' + e.message);
  }
}

function dispararMasterDiariaFull() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    '🔃 Disparar Master Diária (FULL)',
    '⚠️ Vai ignorar o sync_state e reimportar TUDO desde 01/01/2025.\n' +
    'Usar só quando precisar reconstruir os dados.\n\nConfirma?',
    ui.ButtonSet.YES_NO
  );
  if (resp !== ui.Button.YES) return;

  try {
    _ghFetch_('/repos/' + GH_REPO + '/actions/workflows/master_sales_diaria.yml/dispatches', 'post', {
      ref: 'main',
      inputs: { empresas: 'SF', forcar_full: 'true' }
    });
    ui.alert('✅ Master Diária FULL disparada!');
  } catch (e) {
    ui.alert('❌ Erro: ' + e.message);
  }
}

// ========================================
// 📊 VER STATUS DOS RUNS
// ========================================

function verStatusRuns() {
  try {
    var data = _ghFetch_('/repos/' + GH_REPO + '/actions/runs?per_page=10&branch=main');
    var runs = data.workflow_runs || [];

    if (runs.length === 0) {
      SpreadsheetApp.getUi().alert('Nenhum run encontrado.');
      return;
    }

    var msg = '📊 Últimos 10 Runs:\n\n';
    runs.forEach(function(r) {
      var icon = r.conclusion === 'success' ? '✅' :
                 r.conclusion === 'failure' ? '❌' :
                 r.status === 'in_progress' ? '🔄' : '⏳';
      var nome = r.name.replace('Import ', '').replace('(Omie → Supabase)', '').trim();
      var dt = '';
      try {
        dt = Utilities.formatDate(new Date(r.created_at), 'America/Sao_Paulo', 'dd/MM HH:mm');
      } catch(e) { dt = r.created_at.substring(0, 16); }

      msg += icon + ' ' + nome + ' | ' + dt + ' | ' + (r.run_started_at ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 1000) + 's' : '—') + '\n';
    });

    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ Erro: ' + e.message);
  }
}

// ========================================
// ⏰ VER E MUDAR HORÁRIOS
// ========================================

function verHorarios() {
  try {
    var diaria = _lerCronDoWorkflow_('master_sales_diaria.yml');
    var semanal = _lerCronDoWorkflow_('master_sales_semanal.yml');

    var msg = '⏰ Horários Atuais (GitHub Actions):\n\n';
    msg += '🚀 Master Diária:\n';
    msg += '   Cron: ' + diaria.cron + '\n';
    msg += '   BRT: ' + _cronParaBRT_(diaria.cron) + '\n\n';
    msg += '🚀 Master Semanal:\n';
    msg += '   Cron: ' + semanal.cron + '\n';
    msg += '   BRT: ' + _cronParaBRT_(semanal.cron) + '\n\n';
    msg += '💡 Use o menu pra mudar qualquer horário.';

    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    SpreadsheetApp.getUi().alert('❌ Erro: ' + e.message);
  }
}

function mudarHorarioDiaria() {
  _mudarHorarioWorkflow_('master_sales_diaria.yml', 'Master Diária', 'Todo dia');
}

function mudarHorarioSemanal() {
  _mudarHorarioWorkflow_('master_sales_semanal.yml', 'Master Semanal', 'Domingo');
}

function _mudarHorarioWorkflow_(yamlFile, nome, freq) {
  var ui = SpreadsheetApp.getUi();

  var atual = _lerCronDoWorkflow_(yamlFile);
  var horaAtual = _cronParaBRT_(atual.cron);

  var resp = ui.prompt(
    '⏰ Mudar Horário — ' + nome,
    'Frequência: ' + freq + '\n' +
    'Horário atual: ' + horaAtual + ' (BRT)\n\n' +
    'Digite o novo horário em BRT (formato HH:MM):\n' +
    'Exemplos: 00:15, 06:00, 23:30',
    ui.ButtonSet.OK_CANCEL
  );

  if (resp.getSelectedButton() !== ui.Button.OK) return;

  var input = resp.getResponseText().trim();
  var match = input.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) {
    ui.alert('❌ Formato inválido. Use HH:MM (ex: 06:00)');
    return;
  }

  var horaBRT = parseInt(match[1]);
  var minutoBRT = parseInt(match[2]);
  var horaUTC = (horaBRT + 3) % 24;

  // Monta novo cron preservando o dia da semana do original
  var partes = atual.cron.split(' ');
  var novoCron = minutoBRT + ' ' + horaUTC + ' ' + partes[2] + ' ' + partes[3] + ' ' + partes[4];

  // Atualiza no GitHub
  var novoConteudo = atual.conteudo.replace(
    /cron:\s*"[^"]*"/,
    'cron: "' + novoCron + '"'
  );

  _atualizarArquivoGitHub_(
    '.github/workflows/' + yamlFile,
    novoConteudo,
    atual.sha,
    'chore: mudar horário ' + nome + ' para ' + input + ' BRT (via Sheets)'
  );

  ui.alert('✅ Horário atualizado!\n\n' + nome + ': ' + input + ' BRT\n(Cron UTC: ' + novoCron + ')');
}

// ========================================
// 🛠️ HELPERS GITHUB
// ========================================

function _lerCronDoWorkflow_(yamlFile) {
  var data = _ghFetch_('/repos/' + GH_REPO + '/contents/.github/workflows/' + yamlFile);
  var conteudo = Utilities.newBlob(Utilities.base64Decode(data.content)).getDataAsString();
  var match = conteudo.match(/cron:\s*"([^"]*)"/);
  return {
    cron: match ? match[1] : '???',
    conteudo: conteudo,
    sha: data.sha
  };
}

function _atualizarArquivoGitHub_(path, novoConteudo, sha, mensagem) {
  _ghFetch_('/repos/' + GH_REPO + '/contents/' + path, 'put', {
    message: mensagem,
    content: Utilities.base64Encode(Utilities.newBlob(novoConteudo).getBytes()),
    sha: sha
  });
}

function _cronParaBRT_(cron) {
  var partes = cron.split(' ');
  var minUTC = parseInt(partes[0]);
  var horaUTC = parseInt(partes[1]);
  var horaBRT = (horaUTC - 3 + 24) % 24;
  var dia = partes[4];
  var diaNome = {'*': 'Todo dia', '0': 'Domingo', '1': 'Segunda', '2': 'Terça',
                 '3': 'Quarta', '4': 'Quinta', '5': 'Sexta', '6': 'Sábado'};
  var diaStr = diaNome[dia] || dia;
  return String(horaBRT).padStart(2, '0') + ':' + String(minUTC).padStart(2, '0') + ' (' + diaStr + ')';
}

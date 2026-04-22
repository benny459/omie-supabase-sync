// ════════════════════════════════════════════════════════════════════════════
// ⏰ TRIGGERS COM HORÁRIO FIXO EM BRASÍLIA (BRT) + UI INTERATIVA
//
// Funcionalidades:
//   1. criarTriggersBRT(func, [horas])     — core: cria triggers em hora BRT
//   2. configurarHorariosUI(func)          — UI interativa: prompt pra 2 horas
//   3. Atalhos prontos (configSales..., etc)
//   4. listarTriggersBRT()                 — ver o que tá agendado
//   5. removerTriggersDe(func)             — limpar
//
// Salva os últimos horários escolhidos em ScriptProperties (CONFIG_<func>)
// pra já vir preenchido da próxima vez. Rode a função de config sempre
// que quiser mudar os horários — substituí os triggers anteriores.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Converte uma hora BRT (0-23) na hora equivalente do fuso do projeto.
 * Ex: se projeto está em GMT-4 (Amazonas) e quero 18:00 BRT,
 *     retorna 17 (porque 17h GMT-4 = 18h BRT).
 */
function _horaBRT_para_projeto_(horaBRT) {
  var agora = new Date();
  var horaBRT_agora = parseInt(Utilities.formatDate(agora, 'America/Sao_Paulo', 'H'), 10);
  var horaProj_agora = parseInt(Utilities.formatDate(agora, Session.getScriptTimeZone(), 'H'), 10);
  var diff = horaProj_agora - horaBRT_agora;
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  var resultado = horaBRT + diff;
  while (resultado < 0) resultado += 24;
  while (resultado >= 24) resultado -= 24;
  return resultado;
}

/**
 * CORE: cria triggers pra uma função em N horários fixos BRT.
 * Remove triggers antigos da mesma função antes.
 */
function criarTriggersBRT(funcNome, horasBRT) {
  var removidos = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === funcNome) {
      ScriptApp.deleteTrigger(t);
      removidos++;
    }
  });
  if (removidos > 0) Logger.log('🗑️ Removidos ' + removidos + ' trigger(s) antigos de ' + funcNome);

  var fuso = Session.getScriptTimeZone();
  horasBRT.forEach(function(horaBRT) {
    var horaProj = _horaBRT_para_projeto_(horaBRT);
    ScriptApp.newTrigger(funcNome)
      .timeBased()
      .atHour(horaProj)
      .nearMinute(0)
      .everyDays(1)
      .create();
    var etiqBRT  = (horaBRT  < 10 ? '0' : '') + horaBRT  + ':00 BRT';
    var etiqProj = (horaProj < 10 ? '0' : '') + horaProj + ':00 (' + fuso + ')';
    Logger.log('✅ ' + funcNome + ' @ ' + etiqBRT + ' (= ' + etiqProj + ')');
  });
  Logger.log('🏁 Total: ' + horasBRT.length + ' trigger(s) pra ' + funcNome);
}

// ════════════════════════════════════════════════════════════════════════════
// 🎛 UI INTERATIVA — prompt pra 2 horários (manhã + tarde)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Abre dialog interativo pedindo 2 horários em BRT (manhã + tarde)
 * e cria os triggers. Guarda última config em ScriptProperties.
 *
 * Chamado pelo menu ou diretamente pelas funções configurar...()
 */
function configurarHorariosUI(funcNome) {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var chave = 'HORARIOS_' + funcNome;

  // Recupera config anterior (se houver)
  var anterior = props.getProperty(chave) || '';
  var dicaManha = anterior ? 'atual: ' + anterior.split(',')[0] + ':00' : 'ex: 6';
  var dicaTarde = anterior ? 'atual: ' + (anterior.split(',')[1] || '?') + ':00' : 'ex: 18';

  // Pede hora manhã
  var r1 = ui.prompt(
    '⏰ Horário da MANHÃ (BRT)',
    'Digite a hora (0-23) pra rodar ' + funcNome + ' de manhã.\n(' + dicaManha + ')\n\nDeixe VAZIO e OK pra pular este horário.',
    ui.ButtonSet.OK_CANCEL
  );
  if (r1.getSelectedButton() !== ui.Button.OK) { Logger.log('Cancelado'); return; }
  var strManha = r1.getResponseText().trim();

  // Pede hora tarde
  var r2 = ui.prompt(
    '⏰ Horário da TARDE (BRT)',
    'Digite a hora (0-23) pra rodar ' + funcNome + ' à tarde/noite.\n(' + dicaTarde + ')\n\nDeixe VAZIO e OK pra pular este horário.',
    ui.ButtonSet.OK_CANCEL
  );
  if (r2.getSelectedButton() !== ui.Button.OK) { Logger.log('Cancelado'); return; }
  var strTarde = r2.getResponseText().trim();

  // Monta lista
  var horas = [];
  var erros = [];
  [strManha, strTarde].forEach(function(s, idx) {
    if (!s) return; // vazio = pula
    var h = parseInt(s, 10);
    if (isNaN(h) || h < 0 || h > 23) {
      erros.push((idx === 0 ? 'Manhã' : 'Tarde') + ' inválido: "' + s + '"');
    } else {
      horas.push(h);
    }
  });

  if (erros.length > 0) {
    ui.alert('❌ Erro de entrada', erros.join('\n') + '\n\nNão foi alterado nada.', ui.ButtonSet.OK);
    return;
  }
  if (horas.length === 0) {
    var ok = ui.alert('Remover todos os triggers?',
      'Nenhum horário foi fornecido. Isso vai REMOVER todos os triggers de ' + funcNome + '. Confirma?',
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
  }

  // Aplica
  criarTriggersBRT(funcNome, horas);
  props.setProperty(chave, horas.join(','));

  // Confirmação visual
  var msg = horas.length === 0
    ? '🗑️ Todos os triggers de ' + funcNome + ' foram removidos.'
    : '✅ Triggers configurados:\n\n' + horas.map(function(h) {
        return '• ' + (h<10?'0':'') + h + ':00 BRT';
      }).join('\n') + '\n\nFunção: ' + funcNome;
  ui.alert('Concluído', msg, ui.ButtonSet.OK);
}

// ════════════════════════════════════════════════════════════════════════════
// 🎯 ATALHOS — uma função por planilha. Rode a que for da SUA planilha.
// ════════════════════════════════════════════════════════════════════════════

/**
 * SALES — abre prompt pra configurar horários do orquestrador completo.
 * Rode esta função sempre que quiser AJUSTAR os horários.
 */
function configurarHorariosSales() {
  configurarHorariosUI('iniciarPosImport');
}

/**
 * ORDERS — mesmo que Sales mas pra este projeto.
 */
function configurarHorariosOrders() {
  configurarHorariosUI('iniciarPosImport');
}

/**
 * FINANCE — mesmo que Sales mas pra este projeto.
 */
function configurarHorariosFinance() {
  configurarHorariosUI('iniciarPosImport');
}

// ════════════════════════════════════════════════════════════════════════════
// 🔍 UTILITÁRIOS — listar e limpar
// ════════════════════════════════════════════════════════════════════════════

/**
 * Lista todos os triggers com hora convertida pra BRT (fácil de conferir).
 */
function listarTriggersBRT() {
  var fuso = Session.getScriptTimeZone();
  Logger.log('📍 Fuso do projeto: ' + fuso);
  var triggers = ScriptApp.getProjectTriggers();
  if (triggers.length === 0) { Logger.log('(nenhum trigger cadastrado)'); return; }

  var agora = new Date();
  var horaBRT_agora = parseInt(Utilities.formatDate(agora, 'America/Sao_Paulo', 'H'), 10);
  var horaProj_agora = parseInt(Utilities.formatDate(agora, fuso, 'H'), 10);
  var offset = horaProj_agora - horaBRT_agora;
  if (offset > 12) offset -= 24;
  if (offset < -12) offset += 24;

  Logger.log('');
  triggers.forEach(function(t, i) {
    Logger.log((i + 1) + '. ' + t.getHandlerFunction() + ' · acionador de tempo');
  });
  Logger.log('');
  Logger.log('⚠️ O Apps Script não expõe o horário exato via API.');
  Logger.log('   Confira visualmente em ⏰ Acionadores (coluna esquerda).');
  Logger.log('   Hora registrada é em ' + fuso + ' = (hora BRT + ' + offset + ')');
}

/** Remove TODOS os triggers de uma função. */
function removerTriggersDe(funcNome) {
  var n = 0;
  ScriptApp.getProjectTriggers().forEach(function(t) {
    if (t.getHandlerFunction() === funcNome) {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  Logger.log('🗑️ Removidos ' + n + ' trigger(s) de ' + funcNome);
}

/** Remove triggers do orquestrador (iniciarPosImport) desta planilha. */
function removerTriggersOrquestrador() {
  removerTriggersDe('iniciarPosImport');
}

// ════════════════════════════════════════════════════════════════════════════
// 🍎 MENU CUSTOMIZADO — adiciona item na planilha pra fácil acesso
// ════════════════════════════════════════════════════════════════════════════

/**
 * Se chamado em onOpen, adiciona um menu "⏰ Agendamento" na planilha
 * pra você acessar sem abrir o Apps Script.
 * Cole `onOpen() { adicionarMenuAgendamento(); }` ou combine com seu onOpen existente.
 */
function adicionarMenuAgendamento() {
  SpreadsheetApp.getUi()
    .createMenu('⏰ Agendamento')
    .addItem('🔧 Configurar horários (manhã + tarde)', 'configurarHorariosSales')
    .addSeparator()
    .addItem('📋 Listar triggers', 'listarTriggersBRT')
    .addItem('🗑️ Remover todos do orquestrador', 'removerTriggersOrquestrador')
    .addToUi();
}

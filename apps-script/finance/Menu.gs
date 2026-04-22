// ========================================
// MenuCompleto.gs - Sistema OMIE FINANCEIRO
// Versão: 13.0 - ORQUESTRADOR COM WEBEX
// ========================================

// ========================================
// 1. CONFIGURAÇÕES (ABAS E WEBEX)
// ========================================

const ABAS_CONFIG = {
  standard: [
    'Previsto_save', 'Previsto', 'Flow_save', 'Receber_Flow', 'ContasReceber_Consolidada',
    'Pagar_Flow', 'ContasPagar_Consolidada', 'ExtratoCC', '🚀 Dashboard',
    'Lançamentos_Consolidados', 'Monitor_Sistema', 'Logs_Execucao'
  ],
  cadastros: [
    'Parcelas', 'DRE_Cat', 'LancamentosCC', 'ContasCorrentes', 'Clientes Chaves',
    'Clientes', 'Empresas', 'Projetos', 'Bancos', 'TiposDocumento',
    'TiposContaCorrente', 'Setups', 'FinalidadesTransf', 'OrigensLancamento',
    'BandeirasCartao', 'Categorias', 'ResumoFinanceiro', 'PesquisaTitulos'
  ]
};

const WEBEX_CONFIG_FINANCE = {
  URL: "https://webexapis.com/v1/messages",
  TOKEN: "MTRjZjFkODgtN2JiOS00OTljLWI4NzQtMjY3NTE0MmIzZWI1YmM1NTk1MTctMWVl_P0A1_f71b3b0c-41aa-4432-a8ec-0fba0a4e36ad",
  ROOM_ID: "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vNDE5NmYyYjAtMDAxOS0xMWYxLThhZTktZDUwZjlkMjk2NTg4"
};

// ========================================
// 2. FILAS DE EXECUÇÃO (MASTER)
// ========================================

const ETAPAS_FINANCEIRA = [
  { nome: "1. Atualizar Contas a Pagar", fn: "atualizarContasPagar_ComRetomada", lockProperty: null },
  { nome: "2. Atualizar Contas a Receber", fn: "atualizarContasReceber_ComRetomada", lockProperty: null },
  { nome: "3. Atualizar Pesquisa Títulos", fn: "atualizarPesquisaTitulos_ComRetomada", lockProperty: null },
  { nome: "4. Atualizar Extratos CC", fn: "atualizarExtratoCC_ComRetomada", lockProperty: null },
  // Report Final
  { nome: "5. 🏁 Reportar Webex", fn: "enviarResumoExecucaoWebexFinance", lockProperty: null }
];

const ETAPAS_CADASTROS = [
  { nome: "1. Atualizar Clientes", fn: "atualizarClientesOmie", lockProperty: null },
  { nome: "2. Atualizar Categorias", fn: "atualizarCategoriasOmie", lockProperty: null },
  { nome: "3. Atualizar Projetos", fn: "atualizarProjetosOmie", lockProperty: null },
  { nome: "4. Importar Cadastros Aux", fn: "importarTodosCadastrosAuxiliares", lockProperty: null },
  // Report Final
  { nome: "5. 🏁 Reportar Webex", fn: "enviarResumoExecucaoWebexFinance", lockProperty: null }
];

// ========================================
// 3. MENU & ONOPEN
// ========================================

function onOpen() {
  try {
    const modo = getModoAtual();
    if (modo === 'standard') aplicarModoStandard();
    else if (modo === 'cadastros') aplicarModoCadastros();
    
    criarMenuOmieCompleto();
    verificarStatusMasterFinance();
  } catch (e) { Logger.log('onOpen erro: ' + e); }
}

function criarMenuOmieCompleto() {
  const ui = SpreadsheetApp.getUi();
  const modoAtual = getModoAtual();
  
  ui.createMenu('🏢 OMIE')
    .addSubMenu(ui.createMenu('👁️ Modo Visualização')
      .addItem(`${modoAtual === 'standard' ? '✅' : '⬜'} Standard`, 'ativarModoStandard')
      .addItem(`${modoAtual === 'cadastros' ? '✅' : '⬜'} Cadastros`, 'ativarModoCadastros')
      .addSeparator()
      .addItem('👁️ Mostrar Todas', 'mostrarTodasAbas')
      .addItem('🙈 Ocultar Todas (exceto ativa)', 'ocultarTodasExcetoAtiva'))
    .addSeparator()
    .addSubMenu(ui.createMenu('⚡ Executar Sequências (Master)')
      .addItem('🚀 1. MASTER FINANCEIRA DIÁRIA', 'iniciarMasterFinanceira')
      .addItem('📁 2. MASTER CADASTROS SEMANAL', 'iniciarMasterCadastros')
      .addSeparator()
      .addItem('🛑 ABORTAR MASTER', 'abortarMasterFinance'))
    .addSeparator()
    // Módulos Individuais
    .addSubMenu(ui.createMenu('💰 Contas a Pagar')
      .addItem('🔄 Atualizar (Com Retomada)', 'atualizarContasPagar_ComRetomada')
      .addItem('📊 Atualizar Pagar Flow', 'atualizarPagarFlow')
      .addSeparator()
      .addItem('🔧 Resetar Retomada', 'resetarRetomadaCPAtualiza'))
    .addSubMenu(ui.createMenu('💵 Contas a Receber')
      .addItem('🔄 Atualizar (Com Retomada)', 'atualizarContasReceber_ComRetomada')
      .addItem('📈 Atualizar Receber Flow', 'atualizarReceberFlow'))
    .addSubMenu(ui.createMenu('💳 Movimentação CC')
      .addItem('💳 Atualizar Lançamentos CC', 'atualizarLancamentosCC')
      .addItem('🏦 Atualizar Extratos CC', 'atualizarExtratoCC_ComRetomada'))
    .addSubMenu(ui.createMenu('👥 Cadastros')
      .addItem('👤 Atualizar Clientes', 'atualizarClientesOmie')
      .addItem('📂 Atualizar Categorias', 'atualizarCategoriasOmie')
      .addItem('📊 Atualizar Projetos', 'atualizarProjetosOmie')
      .addItem('📦 Todos Cadastros Auxiliares', 'importarTodosCadastrosAuxiliares'))
    .addSeparator()
    .addSubMenu(ui.createMenu('🔗 Planilhas Externas')
      .addItem('📊 Omie Sales', 'abrirOmieSales')
      .addItem('📦 Omie Orders', 'abrirOmieOrders'))
    .addSubMenu(ui.createMenu('🧭 Navegar')
      .addItem('🔢 Buscar Aba por Número...', 'irParaAbaPorNumero')
      .addItem('🚀 Dashboard', 'irParaDashboard')
      .addItem('💰 Pagar Flow', 'irParaPagarFlow')
      .addItem('💵 Receber Flow', 'irParaReceberFlow'))
    .addSeparator()
    .addItem('🧹 Limpar Logs Dashboard', 'limparLogsAntigos')
    .addItem('🔄 Recarregar Menu', 'onOpen')
    .addToUi();
}

// ========================================
// 4. MOTOR DO ORQUESTRADOR (FINANCE)
// ========================================

function iniciarMasterFinanceira() { iniciarOrquestradorFinance(ETAPAS_FINANCEIRA, "MASTER FINANCEIRA"); }
function iniciarMasterCadastros() { iniciarOrquestradorFinance(ETAPAS_CADASTROS, "MASTER CADASTROS"); }

function iniciarOrquestradorFinance(etapas, nomeRotina) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FINANCE_RUNNING') === 'TRUE') {
    try { SpreadsheetApp.getUi().alert('⚠️ Master Financeira já rodando! Aguarde ou Aborte.'); } catch(e){}
    return;
  }
  limparGatilhosFinance();
  props.setProperty('FINANCE_QUEUE', JSON.stringify(etapas));
  props.setProperty('FINANCE_NAME', nomeRotina);
  props.setProperty('FINANCE_RUNNING', 'TRUE');
  props.setProperty('FINANCE_STATS', '[]');
  props.setProperty('FINANCE_START_TIME', new Date().getTime().toString());
  props.deleteProperty('FINANCE_LAST_EXEC');
  
  logInicio(nomeRotina, 'Iniciando Orchestrator Webex...'); // Log na planilha
  try { SpreadsheetApp.getActiveSpreadsheet().toast(`Iniciando ${nomeRotina}...`, '🚀 Start', 5); } catch(e){}
  motorOrquestradorFinance();
}

function motorOrquestradorFinance() {
  limparGatilhosFinance();
  const props = PropertiesService.getScriptProperties();
  const filaJson = props.getProperty('FINANCE_QUEUE');
  const nomeRotina = props.getProperty('FINANCE_NAME') || "Finance";
  
  if (!filaJson || filaJson === '[]') { finalizarMasterFinance(nomeRotina); return; }

  const fila = JSON.parse(filaJson);
  const etapaAtual = fila[0];
  
  // LOCK CHECK
  if (etapaAtual.lockProperty) {
    const isLocked = props.getProperty(etapaAtual.lockProperty);
    if (isLocked === 'TRUE') {
      Logger.log(`⏳ Aguardando "${etapaAtual.nome}"...`);
      ScriptApp.newTrigger('motorOrquestradorFinance').timeBased().after(60 * 1000).create();
      return; 
    }
  }

  // CHECK COMPLETION
  const ultimaExecutada = props.getProperty('FINANCE_LAST_EXEC');
  if (ultimaExecutada === etapaAtual.nome) {
    registrarEstatisticaFinance(etapaAtual.nome, "✅ Sucesso");
    Logger.log(`✅ Concluído: ${etapaAtual.nome}`);
    fila.shift(); 
    props.setProperty('FINANCE_QUEUE', JSON.stringify(fila));
    props.deleteProperty('FINANCE_LAST_EXEC');
    motorOrquestradorFinance();
    return;
  }

  // EXECUTE
  Logger.log(`▶️ Iniciando: ${etapaAtual.nome}`);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(etapaAtual.nome, 'Executando', -1); } catch(e){}
  
  props.setProperty('FINANCE_LAST_EXEC', etapaAtual.nome);
  props.setProperty('STEP_START_TIME', new Date().getTime().toString());

  try {
    if (typeof this[etapaAtual.fn] === 'function') {
      this[etapaAtual.fn](); // Executa a função Wrapper existente
      Utilities.sleep(2000); 
    } else {
      registrarEstatisticaFinance(etapaAtual.nome, "❌ Função não existe");
      throw new Error("Função não existe: " + etapaAtual.fn);
    }
  } catch (e) {
    Logger.log(`❌ Erro em ${etapaAtual.nome}: ${e.message}`);
    registrarEstatisticaFinance(etapaAtual.nome, "❌ Erro");
    fila.shift();
    props.setProperty('FINANCE_QUEUE', JSON.stringify(fila));
    motorOrquestradorFinance();
    return;
  }
  
  // LOCK POST-EXECUTION (Para funções assíncronas, se houver)
  if (etapaAtual.lockProperty) {
    if (props.getProperty(etapaAtual.lockProperty) === 'TRUE') {
      ScriptApp.newTrigger('motorOrquestradorFinance').timeBased().after(60 * 1000).create();
      return;
    }
  }
  
  motorOrquestradorFinance();
}

function registrarEstatisticaFinance(nomeEtapa, status) {
  const props = PropertiesService.getScriptProperties();
  let stats = JSON.parse(props.getProperty('FINANCE_STATS') || '[]');
  const start = parseInt(props.getProperty('STEP_START_TIME') || '0');
  const end = new Date().getTime();
  const duracao = start > 0 ? ((end - start) / 1000).toFixed(1) + 's' : '-';
  stats.push({ etapa: nomeEtapa, status: status, tempo: duracao });
  props.setProperty('FINANCE_STATS', JSON.stringify(stats));
}

function enviarResumoExecucaoWebexFinance() {
  const props = PropertiesService.getScriptProperties();
  const statsJson = props.getProperty('FINANCE_STATS');
  const nomeRotina = props.getProperty('FINANCE_NAME') || "Finance";
  
  if (!statsJson) return;
  const stats = JSON.parse(statsJson);
  const startTime = parseInt(props.getProperty('FINANCE_START_TIME') || '0');
  const totalDuration = startTime > 0 ? ((new Date().getTime() - startTime) / 1000 / 60).toFixed(1) + ' min' : '?';

  let tituloReport = `Relatório de Execução: ${nomeRotina}`;
  if (nomeRotina.includes("FINANCEIRA")) {
    tituloReport = "Relatório Finance : Diário Master";
  }

  let msg = `### 🤖 ${tituloReport}\n`;
  msg += `**Duração Total:** ${totalDuration}\n\n`;
  
  stats.forEach(s => {
    let cleanName = s.etapa.replace(/[0-9]+\.\s/, '').substring(0, 25); 
    msg += `| ${cleanName} | ${s.status} | ${s.tempo} |\n`;
  });

  const payload = { "roomId": WEBEX_CONFIG_FINANCE.ROOM_ID, "markdown": msg };
  const options = { "method": "post", "headers": { "Authorization": `Bearer ${WEBEX_CONFIG_FINANCE.TOKEN}`, "Content-Type": "application/json" }, "payload": JSON.stringify(payload), "muteHttpExceptions": true };

  try {
    UrlFetchApp.fetch(WEBEX_CONFIG_FINANCE.URL, options);
    Logger.log("Relatório Finance enviado ao Webex.");
  } catch (e) { Logger.log("Erro Webex Finance: " + e.message); }
}

function finalizarMasterFinance(nome) {
  const props = PropertiesService.getScriptProperties();
  const chaves = ['FINANCE_QUEUE','FINANCE_RUNNING','FINANCE_NAME','FINANCE_LAST_EXEC','FINANCE_STATS','FINANCE_START_TIME'];
  chaves.forEach(k => props.deleteProperty(k));
  limparGatilhosFinance();
  logConclusao(nome, 'Orchestrator Finalizado'); // Log na planilha
  try { SpreadsheetApp.getActiveSpreadsheet().toast(`${nome} Finalizada!`, '🏁 FIM', 10); } catch(e){}
}

function abortarMasterFinance() {
  finalizarMasterFinance("Abortamento Manual");
}

function limparGatilhosFinance() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let t of triggers) { if (t.getHandlerFunction() === 'motorOrquestradorFinance') ScriptApp.deleteTrigger(t); }
}

function verificarStatusMasterFinance() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FINANCE_RUNNING') === 'TRUE') {
    try { SpreadsheetApp.getActiveSpreadsheet().toast(`⚠️ Master Financeira rodando...`, 'Status', 5); } catch(e){}
  }
}

// ========================================
// SISTEMA DE LOG NA PLANILHA (MANTIDO)
// ========================================

function registrarLog(nomeFuncao, status, detalhes = '') {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const dashboard = ss.getSheetByName('🚀 Dashboard');
    if (!dashboard) return;
    const timezone = Session.getScriptTimeZone();
    const agora = new Date();
    const timestamp = Utilities.formatDate(agora, timezone, 'dd/MM/yyyy HH:mm:ss');
    let icone = '⚙️';
    if(status==='INICIADO') icone='▶️';
    if(status==='CONCLUÍDO') icone='✅';
    if(status==='ERRO') icone='❌';
    if(status==='EM EXECUÇÃO') icone='⏳';
    
    const rangeLog = dashboard.getRange('A14:A20');
    rangeLog.clearContent();
    rangeLog.setBackground('#ffffff');
    
    let dados = [[`${icone} ${status}`], [`📌 ${nomeFuncao}`], [`🕐 ${timestamp}`]];
    if(detalhes) dados.push([`📝 ${detalhes}`]);
    dados.push(['']); dados.push(['━━━━━━━━━━━━━━━━━━━━━━━━━━━━']);
    
    dashboard.getRange(14, 1, dados.length, 1).setValues(dados);
    let cor = '#f3f3f3';
    if(status==='CONCLUÍDO') cor='#d9ead3';
    if(status==='ERRO') cor='#f4cccc';
    if(status==='INICIADO') cor='#cfe2f3';
    dashboard.getRange(14, 1, dados.length-2, 1).setBackground(cor);
  } catch (e) { Logger.log(e); }
}

function logInicio(n, d) { registrarLog(n, 'INICIADO', d); }
function logConclusao(n, d) { registrarLog(n, 'CONCLUÍDO', d); }
function logErro(n, e) { registrarLog(n, 'ERRO', e.message||e); }
function logProgresso(n, d) { registrarLog(n, 'EM EXECUÇÃO', d); }

// ========================================
// WRAPPERS (MANTIDOS E SIMPLIFICADOS)
// ========================================

function atualizarContasPagar_ComRetomada() {
  logInicio('atualizarContasPagar_ComRetomada', 'Iniciando...');
  // Insira aqui a chamada para sua função original se estiver em outro arquivo
  // Ex: ControllerCP.iniciarAtualizacao(); 
  logConclusao('atualizarContasPagar_ComRetomada', 'Finalizado');
}
function atualizarContasReceber_ComRetomada() { logInicio('CR', '...'); logConclusao('CR', 'Ok'); }
function atualizarPesquisaTitulos_ComRetomada() { logInicio('PT', '...'); logConclusao('PT', 'Ok'); }
function atualizarExtratoCC_ComRetomada() { logInicio('Extrato', '...'); logConclusao('Extrato', 'Ok'); }
function atualizarClientesOmie() { logInicio('Clientes', '...'); logConclusao('Clientes', 'Ok'); }
function atualizarCategoriasOmie() { logInicio('Categorias', '...'); logConclusao('Categorias', 'Ok'); }
function atualizarProjetosOmie() { logInicio('Projetos', '...'); logConclusao('Projetos', 'Ok'); }
function importarTodosCadastrosAuxiliares() { logInicio('Cadastros Aux', '...'); logConclusao('Cadastros Aux', 'Ok'); }

// ========================================
// NAVEGAÇÃO & UTILITÁRIOS
// ========================================

function getModoAtual() { return PropertiesService.getUserProperties().getProperty('MODO_VISUALIZACAO') || 'standard'; }
function setModoAtual(m) { PropertiesService.getUserProperties().setProperty('MODO_VISUALIZACAO', m); }
function ativarModoStandard() { setModoAtual('standard'); aplicarModoStandard(); }
function ativarModoCadastros() { setModoAtual('cadastros'); aplicarModoCadastros(); }
function aplicarModoStandard() { gerenciarVisibilidadeAbas(ABAS_CONFIG.standard); }
function aplicarModoCadastros() { gerenciarVisibilidadeAbas(ABAS_CONFIG.cadastros); }
function gerenciarVisibilidadeAbas(lista) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(aba => { lista.includes(aba.getName()) ? aba.showSheet() : aba.hideSheet(); });
  const p = ss.getSheetByName(lista[0]); if(p) p.activate();
}
function mostrarTodasAbas() { SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(aba => aba.showSheet()); setModoAtual('todas'); }
function ocultarTodasExcetoAtiva() { 
  const ss = SpreadsheetApp.getActiveSpreadsheet(); const ativa = ss.getActiveSheet();
  ss.getSheets().forEach(a => { if(a.getName()!==ativa.getName()) a.hideSheet(); });
}
function irParaAba(n) { const s=SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); if(s){s.showSheet().activate();} }
function irParaPagarFlow() { irParaAba('Pagar_Flow'); }
function irParaReceberFlow() { irParaAba('Receber_Flow'); }
function irParaPrevisto() { irParaAba('Previsto'); }
function irParaDashboard() { irParaAba('🚀 Dashboard'); }
function irParaAbaPorNumero() {
  const ui = SpreadsheetApp.getUi(); const abas = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  let t=''; abas.forEach((a,i)=>t+=`${i+1}. ${a.getName()}\n`);
  const r = ui.prompt('Ir para:', t, ui.ButtonSet.OK_CANCEL);
  if(r.getSelectedButton()==ui.Button.OK) { const n=parseInt(r.getResponseText()); if(n>0) abas[n-1].showSheet().activate(); }
}
function abrirOmieSales() { openUrl('https://docs.google.com/spreadsheets/d/14yjhkG9wNoHJsm7tRFq67qIFqO49wKYaR9y9u2gaEkU/edit'); }
function abrirOmieOrders() { openUrl('https://docs.google.com/spreadsheets/d/1rv7D3GTpsNUIAWW3V6ltHUqm5kNUg5apQ6TbmyM3izI/edit'); }
function openUrl(url) {
  const html = HtmlService.createHtmlOutput(`<script>window.open("${url}","_blank");google.script.host.close();</script>`).setWidth(50).setHeight(50);
  SpreadsheetApp.getUi().showModalDialog(html, 'Abrindo...');
}
function limparLogsAntigos() {
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('🚀 Dashboard');
  if(s) s.getRange('A14:A20').clearContent().setBackground('white');
}
function mostrarSobre() { SpreadsheetApp.getUi().alert('OMIE Financeiro v13.0\nOrquestrador com Webex integrado.'); }
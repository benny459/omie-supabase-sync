// ========================================
// MenuCompras.gs - Sistema OMIE COMPRAS
// Versão: 3.2 - ORQUESTRADOR MASTER (WORKSPACE 30MIN + AUTO ABORT)
// ========================================

// ========================================
// 1. CONFIGURAÇÃO DE ABAS E WEBEX
// ========================================

const ABAS_COMPRAS_CONFIG = {
  standard: [
    'Painel de Resultados', 'Resultados_projetos', 'Compras_consolidado',
    'NF_Consolidado', 'Smart_Consolidada', 'Pedidos Parciais'
  ],
  auxiliares: [
    'Consolidação_Pedidos', '🚀 Dashboard', 'Produtos', 'Fornecedores',
    'Categorias', 'ContasCorrentes', 'Empresas', 'Projetos', 'Bancos',
    'TiposDocumento', 'OrigemPedido', 'EtapasFaturamento', 'FormasPagamento',
    'FamiliasProdutos', 'ProdutoFornecedor', 'Unidades', 'PedidosCompra',
    'NFe_Entrada', 'RecebimentoNFe', 'ResumoPedidosCompleto', 'SmartSuite_Raw', 'Logs_Compras'
  ]
};

const WEBEX_CONFIG_MENU = {
  URL: "https://webexapis.com/v1/messages",
  TOKEN: "MTRjZjFkODgtN2JiOS00OTljLWI4NzQtMjY3NTE0MmIzZWI1YmM1NTk1MTctMWVl_P0A1_f71b3b0c-41aa-4432-a8ec-0fba0a4e36ad",
  ROOM_ID: "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vNDE5NmYyYjAtMDAxOS0xMWYxLThhZTktZDUwZjlkMjk2NTg4"
};

// ========================================
// 2. CONFIGURAÇÃO DA FILA MASTER
// ========================================

const ETAPAS_MASTER_DIARIA = [
  { 
    nome: "1. Importar NF-e Turbo", 
    fn: "executarImportacaoNFeTurbo", 
    lockProperty: "NFE_PROCESSANDO", 
    validacao: { min: 10, max: 100000 }, 
    maxRetries: 3 
  },
  { 
    nome: "2. Importar Recebimento Turbo", 
    fn: "executarImportacaoRecebimentoTurbo", 
    lockProperty: "REC_PROCESSANDO", 
    validacao: { min: 10, max: 100000 }, 
    maxRetries: 3 
  },
  { 
    nome: "3. Importar Pedidos Turbo", 
    fn: "executarImportacaoPedidosTurbo", 
    lockProperty: "PED_PROCESSANDO", 
    validacao: { min: 10, max: 100000 }, 
    maxRetries: 3 
  },
  { 
    nome: "4. Compilar Pedidos Compra", 
    fn: "compilarPedidosCompra", 
    lockProperty: "LOCK_COMPILAR", 
    validacao: { min: 0, max: 50000 }, 
    maxRetries: 1 
  },
  { 
    nome: "5. Consolidar Dados (Painel)", 
    fn: "consolidarDados", 
    lockProperty: "LOCK_CONSOLIDAR", 
    validacao: { min: 10, max: 50000 }, 
    maxRetries: 1 
  },
  { 
    nome: "6. Sync Master (Fin + Painel)", 
    fn: "executarSincronizacaoMaster", 
    lockProperty: "LOCK_SYNC_MASTER", 
    validacao: { min: 0, max: 50000 },
    maxRetries: 1 
  },
  { 
    nome: "7. Sync Projetos Ativos", 
    fn: "sincronizarGERAL_ProjetosAtivos", 
    lockProperty: "LOCK_SYNC_PROJETOS", 
    validacao: { min: 0, max: 50000 }, 
    maxRetries: 1 
  },
  { 
    nome: "8. Sync V2 (Painel + NF)", 
    fn: "executarSincronizacaoV2", 
    lockProperty: "LOCK_SYNC_V2", 
    validacao: { min: 0, max: 50000 }, 
    maxRetries: 1 
  },
  { 
    nome: "9. Sync Completa (Smart Consolidada)", 
    fn: "executarSincronizacaoEConsolidacaoCompleta", 
    lockProperty: "LOCK_SYNC_COMPLETA", 
    validacao: { min: 0, max: 50000 }, 
    maxRetries: 1 
  },
  { 
    nome: "10. Gerar Relatório Analista", 
    fn: "gerarRelatorioAnalista", 
    lockProperty: null, 
    validacao: null, 
    maxRetries: 0 
  },
  { 
    nome: "11. 🏁 Reportar Webex", 
    fn: "enviarResumoExecucaoWebex", 
    lockProperty: null, 
    validacao: null, 
    maxRetries: 0 
  }
];

const ETAPAS_MASTER_SEMANAL = [
  { 
    nome: "1. Importar Produtos Turbo", 
    fn: "executarImportacaoProdutosTurbo", 
    lockProperty: "LOCK_PRODUTOS_COMPRAS", 
    validacao: { min: 50, max: 50000 }, 
    maxRetries: 2 
  },
  { 
    nome: "2. Importar Cadastros Aux", 
    fn: "executarImportacaoCadastrosAuxiliaresTurbo", 
    lockProperty: "LOCK_AUX", 
    validacao: { min: 10, max: 10000 }, 
    maxRetries: 2 
  },
  { 
    nome: "3. Importar Turbo Geral", 
    fn: "executarImportacaoTurbo", 
    lockProperty: "LOCK_GERAL", 
    validacao: { min: 10, max: 50000 }, 
    maxRetries: 1 
  },
  { 
    nome: "4. 🏁 Reportar Webex", 
    fn: "enviarResumoExecucaoWebex", 
    lockProperty: null, 
    validacao: null, 
    maxRetries: 0 
  }
];

// ========================================
// 3. MENU & ONOPEN
// ========================================

function onOpen() {
  try {
    let modo = getModoAtualCompras();
    if (!['standard', 'auxiliares', 'todas'].includes(modo)) { modo = 'standard'; setModoAtualCompras(modo); }
    if (modo === 'standard') aplicarModoStandardCompras();
    else if (modo === 'auxiliares') aplicarModoAuxiliaresCompras();
    else if (modo === 'todas') mostrarTodasAbasCompras();
    
    criarMenuCompras();
    verificarStatusMaster();
  } catch (e) { Logger.log('onOpen erro: ' + e); }
}

function criarMenuCompras() {
  const ui = SpreadsheetApp.getUi();
  const modo = getModoAtualCompras();
  
  ui.createMenu('🛒 COMPRAS 3.2')
    .addItem('⚡ 1. MASTER DIÁRIA (Smart)', 'iniciarMasterDiaria')
    .addItem('🚀 2. MASTER SEMANAL (Smart)', 'iniciarMasterSemanal')
    .addSeparator()
    .addItem('🛑 ABORTAR/LIMPAR MASTER', 'abortarMaster')
    .addSeparator()
    .addSubMenu(ui.createMenu('📅 Execuções Individuais')
      .addItem('1. Importar NF-e Turbo', 'executarImportacaoNFeTurbo')
      .addItem('2. Importar Recebimento Turbo', 'executarImportacaoRecebimentoTurbo')
      .addItem('3. Importar Pedidos Turbo', 'executarImportacaoPedidosTurbo')
      .addItem('4. Compilar Pedidos', 'compilarPedidosCompra')
      .addItem('5. Consolidar Dados', 'consolidarDados')
      .addItem('6. Sincronização Master', 'executarSincronizacaoMaster')
      .addItem('7. Sincronizar Projetos Ativos', 'sincronizarGERAL_ProjetosAtivos')
      .addItem('8. Sincronização V2', 'executarSincronizacaoV2')
      .addItem('9. Sincronização Completa', 'executarSincronizacaoEConsolidacaoCompleta')
      .addItem('10. Gerar Relatório Analista', 'gerarRelatorioAnalista'))
    .addSeparator()
    .addSubMenu(ui.createMenu('👁️ Visualização')
      .addItem((modo==='standard'?'✅ ':'')+'Standard', 'ativarModoStandardCompras')
      .addItem((modo==='auxiliares'?'✅ ':'')+'Auxiliares', 'ativarModoAuxiliaresCompras')
      .addItem('Mostrar Todas', 'mostrarTodasAbasCompras'))
    .addToUi();
}

// ========================================
// 4. MOTOR DO ORQUESTRADOR INTELIGENTE
// ========================================

function iniciarMasterDiaria() { iniciarOrquestrador(ETAPAS_MASTER_DIARIA, "MASTER DIÁRIA"); }
function iniciarMasterSemanal() { iniciarOrquestrador(ETAPAS_MASTER_SEMANAL, "MASTER SEMANAL"); }

function iniciarOrquestrador(etapas, nomeRotina) {
  const props = PropertiesService.getScriptProperties();

  // ✅ CORREÇÃO 1: Sempre aborta e limpa tudo antes de iniciar
  // Garante que locks, triggers e filas de qualquer execução paralela sejam zerados
  Logger.log(`🧹 Limpando estado anterior antes de iniciar ${nomeRotina}...`);
  abortarMaster();
  Utilities.sleep(2000); // Pausa para garantir que o abort completou

  limparGatilhosMestre();

  // RESET COMPLETO
  props.setProperty('MASTER_QUEUE', JSON.stringify(etapas));
  props.setProperty('MASTER_NAME', nomeRotina);
  props.setProperty('MASTER_RUNNING', 'TRUE');
  props.setProperty('MASTER_STATS', '[]'); 
  props.setProperty('MASTER_START_TIME', new Date().getTime().toString());
  props.deleteProperty('MASTER_LAST_EXEC');
  props.deleteProperty('CURRENT_RETRIES');
  
  SpreadsheetApp.getActiveSpreadsheet().toast(`Iniciando ${nomeRotina} com Validação...`, '🚀 Start', 5);
  motorOrquestrador();
}

function motorOrquestrador() {
  limparGatilhosMestre();
  const props = PropertiesService.getScriptProperties();
  const filaJson = props.getProperty('MASTER_QUEUE');
  const nomeRotina = props.getProperty('MASTER_NAME') || "Master";
  
  if (!filaJson || filaJson === '[]') { finalizarMaster(nomeRotina); return; }

  let fila = JSON.parse(filaJson);
  let etapaAtual = fila[0];
  let tentativasAtuais = parseInt(props.getProperty('CURRENT_RETRIES') || '0');

  const retryTag = tentativasAtuais > 0 ? ` (Tentativa ${tentativasAtuais + 1})` : "";
  Logger.log(`▶️ [Orquestrador] INICIO: ${etapaAtual.nome}${retryTag}`);
  props.setProperty('STEP_START_TIME', new Date().getTime().toString());
  
  // 🛡️ VERIFICAÇÃO DE CADEADO E QUEBRA
  if (etapaAtual.lockProperty && props.getProperty(etapaAtual.lockProperty) === 'TRUE') {
    if (tentativasAtuais > 0) {
      Logger.log(`🔓 [Retry] Quebrando cadeado travado de ${etapaAtual.nome} para forçar execução.`);
      props.deleteProperty(etapaAtual.lockProperty);
    } else {
      // ✅ CORREÇÃO 2: 25min para aproveitar limite Workspace (30min máximo)
      Logger.log(`⏳ Lock detectado em ${etapaAtual.nome}. Aguardando 25min (Workspace)...`);
      ScriptApp.newTrigger('motorOrquestrador').timeBased().after(25 * 60 * 1000).create();
      return;
    }
  }

  let sucesso = false;
  let mensagemResultado = "";
  let totalRegistros = 0;

  try {
    if (typeof this[etapaAtual.fn] === 'function') {
      
      totalRegistros = this[etapaAtual.fn](); 
      if (totalRegistros === undefined || totalRegistros === null) totalRegistros = 0;

      if (etapaAtual.validacao) {
        if (typeof totalRegistros === 'number' && totalRegistros >= etapaAtual.validacao.min && totalRegistros <= etapaAtual.validacao.max) {
          sucesso = true;
          mensagemResultado = `✅ OK (${totalRegistros} reg)`;
        } else {
          throw new Error(`Volumetria inválida: ${totalRegistros} (Meta: ${etapaAtual.validacao.min}-${etapaAtual.validacao.max})`);
        }
      } else {
        sucesso = true;
        mensagemResultado = `✅ OK`;
      }

    } else {
      throw new Error(`Função ${etapaAtual.fn} não existe.`);
    }

  } catch (e) {
    mensagemResultado = `❌ Erro: ${e.message}`;
    Logger.log(mensagemResultado);
  }

  // --- DECISÃO: PRÓXIMO PASSO ---

  if (sucesso) {
    registrarEstatistica(etapaAtual.nome, mensagemResultado, tentativasAtuais);
    
    props.deleteProperty('CURRENT_RETRIES'); 
    if (etapaAtual.lockProperty) props.deleteProperty(etapaAtual.lockProperty);

    fila.shift();
    props.setProperty('MASTER_QUEUE', JSON.stringify(fila));
    
    Utilities.sleep(1000); 
    motorOrquestrador();

  } else {
    const maxRetries = etapaAtual.maxRetries || 0;

    if (tentativasAtuais < maxRetries) {
      tentativasAtuais++;
      props.setProperty('CURRENT_RETRIES', tentativasAtuais.toString());
      Logger.log(`🔄 Agendando Retentativa ${tentativasAtuais}/${maxRetries} para ${etapaAtual.nome}`);
      
      // ✅ CORREÇÃO 2: Retry também usa 25min para Workspace
      ScriptApp.newTrigger('motorOrquestrador').timeBased().after(25 * 60 * 1000).create();

    } else {
      Logger.log(`💀 FALHA DEFINITIVA em ${etapaAtual.nome}. Pulando para a próxima etapa...`);
      
      registrarEstatistica(etapaAtual.nome, `🔴 FALHA (PULADO): ${mensagemResultado}`, tentativasAtuais);
      
      props.deleteProperty('CURRENT_RETRIES');
      if (etapaAtual.lockProperty) props.deleteProperty(etapaAtual.lockProperty);

      fila.shift(); 
      props.setProperty('MASTER_QUEUE', JSON.stringify(fila)); 
      
      motorOrquestrador(); 
    }
  }
}

// ========================================
// 5. SISTEMA DE ESTATÍSTICAS
// ========================================

function registrarEstatistica(nomeEtapa, status, tentativas) {
  const props = PropertiesService.getScriptProperties();
  let stats = JSON.parse(props.getProperty('MASTER_STATS') || '[]');
  
  const start = parseInt(props.getProperty('STEP_START_TIME') || '0');
  const duracao = start > 0 ? ((new Date().getTime() - start) / 1000).toFixed(1) + 's' : '-';
  const hora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm");
  const execucoes = (tentativas || 0) + 1;
  
  stats.push({ 
    etapa: nomeEtapa, 
    status: status, 
    tempo: duracao,
    hora: hora,
    tentativas: execucoes
  });
  
  props.setProperty('MASTER_STATS', JSON.stringify(stats));
}

// ========================================
// 6. RELATÓRIO WEBEX
// ========================================

function enviarResumoExecucaoWebex() {
  const props = PropertiesService.getScriptProperties();
  const statsJson = props.getProperty('MASTER_STATS');
  const nomeRotina = props.getProperty('MASTER_NAME') || "Master";
  
  if (!statsJson) return;
  const stats = JSON.parse(statsJson);
  
  const startTime = parseInt(props.getProperty('MASTER_START_TIME') || '0');
  const totalDuration = startTime > 0 ? ((new Date().getTime() - startTime) / 1000 / 60).toFixed(1) + ' min' : '?';

  let tituloReport = `Relatório Omie Orders 3.2: ${nomeRotina}`;
  if (nomeRotina.includes("DIÁRIA")) tituloReport = "🤖 Relatório Omie Orders: Diário Master";

  let msg = `### ${tituloReport}\n`;
  msg += `**Duração Total:** ${totalDuration}\n\n`;
  
  let temErroFatal = false;

  stats.forEach(s => {
    let cleanName = s.etapa.replace(/[0-9]+\.\s/, '').substring(0, 22); 
    
    let icon = "🟢";
    if (s.status.includes("FALHA") || s.status.includes("Erro")) { icon = "🔴"; temErroFatal = true; }
    else if (s.status.includes("Retentando")) icon = "⚠️";

    let cleanStatus = s.status.replace("Volumetria inválida:", "Vol.").substring(0, 25);
    cleanStatus = cleanStatus.replace("✅ OK", "OK");

    let contadorStr = "";
    if (s.tentativas && s.tentativas > 1) contadorStr = ` **(${s.tentativas}x)**`;

    msg += `| ${cleanName} | ${icon} ${cleanStatus}${contadorStr} | ${s.tempo} | ${s.hora} |\n`;
  });

  if (temErroFatal) msg += `\n🚨 **ATENÇÃO:** Processo finalizado com falhas críticas.\n`;

  const payload = { "roomId": WEBEX_CONFIG_MENU.ROOM_ID, "markdown": msg };
  const options = { 
    "method": "post", 
    "headers": { 
      "Authorization": `Bearer ${WEBEX_CONFIG_MENU.TOKEN}`, 
      "Content-Type": "application/json" 
    }, 
    "payload": JSON.stringify(payload), 
    "muteHttpExceptions": true 
  };

  try { 
    UrlFetchApp.fetch(WEBEX_CONFIG_MENU.URL, options); 
  } catch (e) { 
    Logger.log("Erro ao enviar Webex: " + e.message); 
  }
}

// ========================================
// 7. CONTROLE DO MASTER
// ========================================

function finalizarMaster(nome) {
  const props = PropertiesService.getScriptProperties();
  const chaves = [
    'MASTER_QUEUE', 'MASTER_RUNNING', 'MASTER_NAME', 
    'MASTER_LAST_EXEC', 'MASTER_STATS', 'MASTER_START_TIME', 
    'CURRENT_RETRIES'
  ];
  chaves.forEach(k => props.deleteProperty(k));
  limparGatilhosMestre();
  Logger.log(`🏁 ${nome} FINALIZADA.`);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(`Fim: ${nome}`, '🏁', 10); } catch(e){}
}

function abortarMaster() {
  const props = PropertiesService.getScriptProperties();
  const cadeados = [
    "NFE_PROCESSANDO", "REC_PROCESSANDO", "PED_PROCESSANDO", "PROD_PROCESSANDO", 
    "LOCK_COMPILAR", "LOCK_CONSOLIDAR", 
    "LOCK_SYNC_MASTER", "LOCK_SYNC_PROJETOS", "LOCK_SYNC_V2", "LOCK_SYNC_COMPLETA", 
    "LOCK_AUX", "LOCK_GERAL"
  ];
  cadeados.forEach(c => props.deleteProperty(c));
  finalizarMaster("Abortamento Manual");
}

function limparGatilhosMestre() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let t of triggers) { 
    if (t.getHandlerFunction() === 'motorOrquestrador') ScriptApp.deleteTrigger(t); 
  }
}

function verificarStatusMaster() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('MASTER_RUNNING') === 'TRUE') {
    const nome = props.getProperty('MASTER_NAME');
    try { SpreadsheetApp.getActiveSpreadsheet().toast(`⚠️ ${nome} está rodando.`, 'Status', 5); } catch(e){}
  }
}

// ========================================
// 8. NAVEGAÇÃO
// ========================================

function getModoAtualCompras() { return PropertiesService.getUserProperties().getProperty('MODO_VISUALIZACAO_COMPRAS') || 'standard'; }
function setModoAtualCompras(modo) { PropertiesService.getUserProperties().setProperty('MODO_VISUALIZACAO_COMPRAS', modo); }
function ativarModoStandardCompras() { setModoAtualCompras('standard'); aplicarModoStandardCompras(); }
function ativarModoAuxiliaresCompras() { setModoAtualCompras('auxiliares'); aplicarModoAuxiliaresCompras(); }
function aplicarModoStandardCompras() { gerenciarVisibilidadeAbas(ABAS_COMPRAS_CONFIG.standard); }
function aplicarModoAuxiliaresCompras() { gerenciarVisibilidadeAbas(ABAS_COMPRAS_CONFIG.auxiliares); }

function gerenciarVisibilidadeAbas(lista) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(aba => { lista.includes(aba.getName()) ? aba.showSheet() : aba.hideSheet(); });
  const p = ss.getSheetByName(lista[0]); 
  if (p) p.activate();
}

function mostrarTodasAbasCompras() { 
  SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(aba => aba.showSheet()); 
  setModoAtualCompras('todas'); 
}

function irParaAbaCompras(n) { 
  const s = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(n); 
  if (s) { s.showSheet().activate(); } 
}
function irParaSmartConsolidada() { irParaAbaCompras('Smart_Consolidada'); }
function irParaComprasConsolidado() { irParaAbaCompras('Compras_consolidado'); }
function irParaPedidosCompra() { irParaAbaCompras('PedidosCompra'); }
function irParaLogsCompras() { irParaAbaCompras('Logs_Compras'); }

// ========================================
// 9. UTILITÁRIOS DE EMERGÊNCIA
// ========================================

function resetMasterRunning() {
  const props = PropertiesService.getScriptProperties();
  props.setProperty('MASTER_RUNNING', 'FALSE');
  props.deleteProperty('MASTER_NAME');
  props.deleteProperty('MASTER_START_TIME');
  Logger.log('✅ MASTER_RUNNING resetado com sucesso.');
}
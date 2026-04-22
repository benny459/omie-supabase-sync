// ========================================
// MenuVendas.gs - Sistema OMIE VENDAS
// Versão: 3.1 - ORQUESTRADOR INTELIGENTE (REPORT LIMPO + CONTADOR TENTATIVAS)
// ========================================

// ========================================
// 1. CONFIGURAÇÃO DE ABAS E WEBEX
// ========================================
const ABAS_VENDAS_CONFIG = {
  standard: ['Consolidação_PV_OS', 'Exportação Sales Smart', 'Logs_Vendas'],
  auxiliares: ['EtapasPedidos', 'ItensVendidos', 'OrdensServico', 'PedidosVenda', 'Produtos', 'LocaisEstoque', 'Categorias', 'cadastros']
};

const WEBEX_CONFIG_VENDAS = {
  URL: "https://webexapis.com/v1/messages",
  TOKEN: "MTRjZjFkODgtN2JiOS00OTljLWI4NzQtMjY3NTE0MmIzZWI1YmM1NTk1MTctMWVl_P0A1_f71b3b0c-41aa-4432-a8ec-0fba0a4e36ad",
  ROOM_ID: "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vNDE5NmYyYjAtMDAxOS0xMWYxLThhZTktZDUwZjlkMjk2NTg4"
};

// ========================================
// 2. CONFIGURAÇÃO DA FILA MASTER (VENDAS)
// ========================================
const ETAPAS_VENDAS_DIARIA = [
  { 
    nome: "1. Carga Completa Etapas", 
    fn: "executarCargaCompletaEtapas", 
    lockProperty: "LOCK_CARGA_ETAPAS",
    validacao: { min: 3000, max: 5000 }, 
    maxRetries: 3 
  },
  { 
    nome: "2. Imp. Itens Vendidos Turbo", 
    fn: "executarImportacaoItensVendidosTurbo", 
    lockProperty: "LOCK_ITENS_TURBO", 
    validacao: { min: 600, max: 1500 }, 
    maxRetries: 3 
  }, 
  { 
    nome: "3. Imp. Serviços Turbo", 
    fn: "executarImportacaoServicosTurbo", 
    lockProperty: "LOCK_SERVICOS_TURBO",
    validacao: { min: 600, max: 1200 }, 
    maxRetries: 3
  },
  { 
    nome: "4. Imp. Pedidos Venda Turbo", 
    fn: "executarImportacaoPedidosVendaTurbo", 
    lockProperty: "LOCK_PEDIDOS_TURBO",
    validacao: { min: 150, max: 500 }, 
    maxRetries: 3
  },
  { 
    nome: "5. Consolidar PV + OS", 
    fn: "criarConsolidacaoPVOS", 
    lockProperty: "LOCK_CONSOLIDACAO",
    validacao: { min: 1000, max: 2000 }, 
    maxRetries: 1 
  },
  { 
    nome: "6. Sincronizar Sales Smart", 
    fn: "sincronizarEInserir", 
    lockProperty: "LOCK_SYNC_SMART",
    validacao: { min: 0, max: 500 }, 
    maxRetries: 1 
  },
  { 
    nome: "7. Sincronizar Projetos Ativos", 
    fn: "sincronizarProjetosAtivos", 
    lockProperty: "LOCK_SYNC_PROJETOS",
    validacao: { min: 0, max: 500 }, 
    maxRetries: 1 
  },
  { 
    nome: "8. 🏁 Reportar Webex", 
    fn: "enviarResumoExecucaoWebexVendas", 
    lockProperty: null,
    validacao: null,
    maxRetries: 0
  }
];

const ETAPAS_VENDAS_SEMANAL = [
  { nome: "1. Imp. Produtos Simples", fn: "executarImportacaoProdutosSimples", lockProperty: "LOCK_PRODUTOS", validacao: { min: 7000, max: 12000 }, maxRetries: 2 },
  { nome: "2. Imp. Cadastros Gerais", fn: "executarImportacaoSimples", lockProperty: "LOCK_AUXILIARES", validacao: { min: 0, max: 5000 }, maxRetries: 2 },
  { nome: "3. 🏁 Reportar Webex", fn: "enviarResumoExecucaoWebexVendas", lockProperty: null, validacao: null, maxRetries: 0 }
];

// ========================================
// 3. MENU & ONOPEN
// ========================================
function onOpen() { criarMenuVendas(); }

function criarMenuVendas() {
  const ui = SpreadsheetApp.getUi();
  let modo = 'standard';
  try { modo = getModoAtualVendas(); } catch (e) {}
  
  ui.createMenu('💰 VENDAS 3.0')
    .addItem('⚡ 1. MASTER DIÁRIA (Smart)', 'iniciarMasterDiariaVendas')
    .addItem('🚀 2. MASTER SEMANAL (Smart)', 'iniciarMasterSemanalVendas')
    .addSeparator()
    .addItem('🛑 ABORTAR VENDAS', 'abortarMasterVendas')
    .addSeparator()
    .addSubMenu(ui.createMenu('🛠️ Execuções Individuais')
      .addItem('1. Carga Etapas', 'executarCargaCompletaEtapas')
      .addItem('2. Itens Vendidos', 'executarImportacaoItensVendidosTurbo')
      .addItem('3. Serviços (OS)', 'executarImportacaoServicosTurbo')
      .addItem('4. Pedidos Venda', 'executarImportacaoPedidosVendaTurbo')
      .addItem('5. Consolidar PV+OS', 'criarConsolidacaoPVOS')
      .addItem('6. Sync Sales Smart', 'sincronizarEInserir')
      .addItem('7. Sync Projetos Ativos', 'sincronizarProjetosAtivos'))
    .addToUi();
}

// ========================================
// 4. MOTOR DO ORQUESTRADOR INTELIGENTE
// ========================================
function iniciarMasterDiariaVendas() { iniciarOrquestradorVendas(ETAPAS_VENDAS_DIARIA, "MASTER DIÁRIA VENDAS"); }
function iniciarMasterSemanalVendas() { iniciarOrquestradorVendas(ETAPAS_VENDAS_SEMANAL, "MASTER SEMANAL VENDAS"); }

function iniciarOrquestradorVendas(etapas, nomeRotina) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('VENDAS_RUNNING') === 'TRUE') {
    SpreadsheetApp.getUi().alert('⚠️ A Master de Vendas já está rodando! Aguarde ou aborte.');
    return;
  }
  limparGatilhosVendas();
  
  // RESET COMPLETO
  props.setProperty('VENDAS_QUEUE', JSON.stringify(etapas));
  props.setProperty('VENDAS_NAME', nomeRotina);
  props.setProperty('VENDAS_RUNNING', 'TRUE');
  props.setProperty('VENDAS_STATS', '[]'); 
  props.setProperty('VENDAS_START_TIME', new Date().getTime().toString());
  props.deleteProperty('VENDAS_LAST_EXEC');
  props.deleteProperty('CURRENT_RETRIES'); 
  
  SpreadsheetApp.getActiveSpreadsheet().toast(`Iniciando ${nomeRotina} com Validação...`, '🚀 Start', 5);
  motorOrquestradorVendas();
}

function motorOrquestradorVendas() {
  limparGatilhosVendas();
  const props = PropertiesService.getScriptProperties();
  const filaJson = props.getProperty('VENDAS_QUEUE');
  const nomeRotina = props.getProperty('VENDAS_NAME') || "Vendas";
  
  if (!filaJson || filaJson === '[]') { finalizarMasterVendas(nomeRotina); return; }

  let fila = JSON.parse(filaJson);
  let etapaAtual = fila[0];
  let tentativasAtuais = parseInt(props.getProperty('CURRENT_RETRIES') || '0');

  const retryTag = tentativasAtuais > 0 ? ` (Tentativa ${tentativasAtuais + 1})` : "";
  Logger.log(`▶️ [Orquestrador] INICIO: ${etapaAtual.nome}${retryTag}`);
  props.setProperty('STEP_START_TIME', new Date().getTime().toString());
  
  // 🛡️ 1. VERIFICAÇÃO DE CADEADO (COM CORREÇÃO ANTI-LOOP)
  if (etapaAtual.lockProperty && props.getProperty(etapaAtual.lockProperty) === 'TRUE') {
     
     // SE FOR RETENTATIVA, QUEBRA O CADEADO ANTERIOR E SEGUE
     if (tentativasAtuais > 0) {
        Logger.log(`🔓 [Retry] Quebrando cadeado travado de ${etapaAtual.nome} para forçar execução.`);
        props.deleteProperty(etapaAtual.lockProperty);
     } else {
        // SE FOR A PRIMEIRA VEZ, RESPEITA O CADEADO (pode ser outra rotina rodando)
        Logger.log(`⏳ Lock detectado em ${etapaAtual.nome}. Aguardando 1min...`);
        ScriptApp.newTrigger('motorOrquestradorVendas').timeBased().after(60 * 1000).create();
        return;
     }
  }

  let sucesso = false;
  let mensagemResultado = "";
  let totalRegistros = 0;

  try {
    if (typeof this[etapaAtual.fn] === 'function') {
      
      // EXECUTA A FUNÇÃO
      totalRegistros = this[etapaAtual.fn](); 
      if (totalRegistros === undefined || totalRegistros === null) totalRegistros = 0;

      // VALIDAÇÃO DE RANGE
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
    // 1. SUCESSO: SALVA, LIMPA E AVANÇA
    registrarEstatisticaVendas(etapaAtual.nome, mensagemResultado, tentativasAtuais);
    
    props.deleteProperty('CURRENT_RETRIES'); 
    if(etapaAtual.lockProperty) props.deleteProperty(etapaAtual.lockProperty); // Garante limpeza

    fila.shift(); // Remove a tarefa feita
    props.setProperty('VENDAS_QUEUE', JSON.stringify(fila));
    
    Utilities.sleep(1000); 
    motorOrquestradorVendas(); // Próxima!

  } else {
    // 2. FALHA DETECTADA
    const maxRetries = etapaAtual.maxRetries || 0;

    if (tentativasAtuais < maxRetries) {
      // --> AINDA TEM TENTATIVAS (RETRY)
      tentativasAtuais++;
      props.setProperty('CURRENT_RETRIES', tentativasAtuais.toString());
      Logger.log(`🔄 Agendando Retentativa ${tentativasAtuais}/${maxRetries} para ${etapaAtual.nome}`);
      
      // Agenda para daqui a 1 min
      ScriptApp.newTrigger('motorOrquestradorVendas').timeBased().after(60 * 1000).create();

    } else {
      // --> ESGOTOU TENTATIVAS (SKIP / PULAR)
      Logger.log(`💀 FALHA DEFINITIVA em ${etapaAtual.nome}. Pulando para a próxima etapa...`);
      
      // Registra o erro no relatório final, mas não para o processo
      registrarEstatisticaVendas(etapaAtual.nome, `🔴 FALHA (PULADO): ${mensagemResultado}`, tentativasAtuais);
      
      // Limpezas necessárias para não travar a próxima
      props.deleteProperty('CURRENT_RETRIES');
      if(etapaAtual.lockProperty) props.deleteProperty(etapaAtual.lockProperty);

      fila.shift(); // Remove a tarefa problemática da fila
      props.setProperty('VENDAS_QUEUE', JSON.stringify(fila)); // Salva a fila sem ela
      
      // ⏭️ AVANÇA PARA A PRÓXIMA FUNÇÃO IMEDIATAMENTE
      motorOrquestradorVendas(); 
    }
  }
}

// === SISTEMA DE ESTATÍSTICAS ===
// 🆕 Agora aceita 'tentativas' como parâmetro
function registrarEstatisticaVendas(nomeEtapa, status, tentativas) {
  const props = PropertiesService.getScriptProperties();
  let stats = JSON.parse(props.getProperty('VENDAS_STATS') || '[]');
  
  const start = parseInt(props.getProperty('STEP_START_TIME') || '0');
  const duracao = start > 0 ? ((new Date().getTime() - start) / 1000).toFixed(1) + 's' : '-';
  const hora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "HH:mm");
  
  // Salva número real de execuções (0 retries = 1 execução)
  const execucoes = (tentativas || 0) + 1;

  stats.push({
    etapa: nomeEtapa,
    status: status,
    tempo: duracao,
    hora: hora,
    tentativas: execucoes // Salva para o relatório usar
  });
  
  props.setProperty('VENDAS_STATS', JSON.stringify(stats));
}

// === RELATÓRIO WEBEX LIMPO E COM CONTADOR ===
function enviarResumoExecucaoWebexVendas() {
  const props = PropertiesService.getScriptProperties();
  const statsJson = props.getProperty('VENDAS_STATS');
  const nomeRotina = props.getProperty('VENDAS_NAME') || "Vendas";
  
  if (!statsJson) return;
  const stats = JSON.parse(statsJson);
  
  const startTime = parseInt(props.getProperty('VENDAS_START_TIME') || '0');
  const totalDuration = startTime > 0 ? ((new Date().getTime() - startTime) / 1000 / 60).toFixed(1) + ' min' : '?';

  let tituloReport = `Relatório Vendas 3.1: ${nomeRotina}`;
  if (nomeRotina.includes("DIÁRIA")) tituloReport = "🤖 Relatório Sales Orders: Diário Master";

  let msg = `### ${tituloReport}\n`;
  msg += `**Duração Total:** ${totalDuration}\n\n`;
  
  // 🗑️ CABEÇALHO REMOVIDO CONFORME SOLICITADO
  // Apenas listagem limpa

  let temErroFatal = false;

  stats.forEach(s => {
    let cleanName = s.etapa.replace(/[0-9]+\.\s/, '').substring(0, 22); 
    
    // Iconografia
    let icon = "🟢";
    if (s.status.includes("FALHA") || s.status.includes("Erro")) { icon = "🔴"; temErroFatal = true; }
    else if (s.status.includes("Retentando")) icon = "⚠️";
    
    // Limpeza de texto status
    let cleanStatus = s.status.replace("Volumetria inválida:", "Vol.").substring(0, 25);
    cleanStatus = cleanStatus.replace("✅ OK", "OK");

    // 🆕 LÓGICA DO CONTADOR DE TENTATIVAS
    // Se tentou mais de 1 vez, mostra (2x), (3x)...
    let contadorStr = "";
    if (s.tentativas && s.tentativas > 1) {
      contadorStr = ` **(${s.tentativas}x)**`;
    }

    msg += `| ${cleanName} | ${icon} ${cleanStatus}${contadorStr} | ${s.tempo} | ${s.hora} |\n`;
  });

  if (temErroFatal) {
    msg += `\n🚨 **ATENÇÃO:** Processo abortado por falha crítica.\n`;
  }

  const payload = { "roomId": WEBEX_CONFIG_VENDAS.ROOM_ID, "markdown": msg };
  const options = { "method": "post", "headers": { "Authorization": `Bearer ${WEBEX_CONFIG_VENDAS.TOKEN}`, "Content-Type": "application/json" }, "payload": JSON.stringify(payload), "muteHttpExceptions": true };

  try { UrlFetchApp.fetch(WEBEX_CONFIG_VENDAS.URL, options); } catch (e) { Logger.log("Erro Webex: " + e.message); }
}

function finalizarMasterVendas(nome) {
  const props = PropertiesService.getScriptProperties();
  const chaves = ['VENDAS_QUEUE','VENDAS_RUNNING','VENDAS_NAME','VENDAS_LAST_EXEC', 'VENDAS_STATS', 'VENDAS_START_TIME', 'CURRENT_RETRIES'];
  chaves.forEach(k => props.deleteProperty(k));
  limparGatilhosVendas();
  SpreadsheetApp.getActiveSpreadsheet().toast(`${nome} Finalizada!`, '🏁 FIM', 10);
}

function abortarMasterVendas() {
  const props = PropertiesService.getScriptProperties();
  const cadeados = ["LOCK_CARGA_ETAPAS", "LOCK_ITENS_TURBO", "LOCK_SERVICOS_TURBO", "LOCK_PEDIDOS_TURBO", "LOCK_CONSOLIDACAO", "LOCK_SYNC_SMART", "LOCK_SYNC_PROJETOS", "LOCK_PRODUTOS", "LOCK_AUXILIARES"];
  cadeados.forEach(c => props.deleteProperty(c));
  finalizarMasterVendas("Abortamento Manual");
}

function limparGatilhosVendas() {
  const triggers = ScriptApp.getProjectTriggers();
  for (let t of triggers) {
    if (t.getHandlerFunction() === 'motorOrquestradorVendas') ScriptApp.deleteTrigger(t);
  }
}

// ========================================
// 5. VISUALIZAÇÃO & UTILITÁRIOS
// ========================================
function getModoAtualVendas() { return PropertiesService.getUserProperties().getProperty('MODO_VISUALIZACAO_VENDAS') || 'standard'; }
function setModoAtualVendas(modo) { PropertiesService.getUserProperties().setProperty('MODO_VISUALIZACAO_VENDAS', modo); }
function ativarModoStandardVendas() { setModoAtualVendas('standard'); aplicarModoStandardVendas(); }
function ativarModoAuxiliaresVendas() { setModoAtualVendas('auxiliares'); aplicarModoAuxiliaresVendas(); }
function aplicarModoStandardVendas() { gerenciarVisibilidadeAbas(ABAS_VENDAS_CONFIG.standard); }
function aplicarModoAuxiliaresVendas() { gerenciarVisibilidadeAbas(ABAS_VENDAS_CONFIG.auxiliares); }
function gerenciarVisibilidadeAbas(lista) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.getSheets().forEach(aba => { lista.includes(aba.getName()) ? aba.showSheet() : aba.hideSheet(); });
  const p = ss.getSheetByName(lista[0]); if(p) p.activate();
}
function mostrarTodasAbasVendas() { SpreadsheetApp.getActiveSpreadsheet().getSheets().forEach(aba => aba.showSheet()); setModoAtualVendas('todas'); }
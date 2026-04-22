/**
 * ════════════════════════════════════════════════════════════════
 * SCRIPT MESTRE: PROJETOS ATIVOS - V8.4 (COMPATÍVEL V3)
 * 1. Return Count: Retorna total de registros atualizados.
 * 2. Lock: Proteção contra execução duplicada (LOCK_SYNC_PROJETOS).
 * 3. Base V8.3 mantida (Correção de Campos Vazios).
 * ════════════════════════════════════════════════════════════════
 */

// ========================================
// 1. CONFIGURAÇÃO GERAL
// ========================================

const PA_API_CONFIG = {
  BASE_URL: 'https://app.smartsuite.com/api/v1',
  ACCOUNT_ID: 'snm19hn6',
  TABLE_ID: '696d3c3d35b1839e1b2a274f', 
  API_TOKEN: 'b64bd1cca64432c1a36f1e5e861fa7fe0aea1320'
};

// --- MÓDULO 1: DADOS FINANCEIROS ---
const PA_CONF_FIN = {
  NOME_ABA: 'Compras_consolidado',
  FIELDS: {
    PC_NUMERO: 's670dc5f17',
    PC_FORNECEDOR: 'scc1a2eacd',
    PC_CUSTO: 'sad280e350',
    PC_COND_PAGTO: 's4c2a39858',
    PC_PREVISAO: 'sa1a68de1b',
    PC_CATEGORIA: 's108b3f279' 
  },
  COLS: { 
    PC_NUMERO: 2,     // C
    PREVISAO: 4,      // E
    CUSTO: 24,        // Y
    FORNECEDOR: 26,   // AA
    CATEGORIA: 32,    // AG
    COND_PAGTO: 34    // AI
  }
};

// --- MÓDULO 2: PAINEL DE RESULTADOS ---
const PA_CONF_PAINEL = {
  NOME_ABA: 'Painel de Resultados', 
  FIELDS: {
    PC_NUMERO: 's670dc5f17',       
    STATUS_PC: 's96e0b892e',       
    STATUS_FORN: 's7d92bld',
    DT_EMISSAO: 's1866928ef',
    DT_RECEB: 'syzle95a',
    NF_NUMERO: 'sb51b79ee5',
    AUDITORIA: 'sbab94f35e',
    DT_CRIACAO: 'sffec62653',      
    DT_LIMITE: 's394a485bc',     
    PRAZO_ENTREGA: 'scf0fb3a7a',
    RC_CUSTO_TOTAL: 'sf13db4835', 
    PC_CUSTO_TOTAL: 's19a6102e0'
  },
  COLS: {
    PC_NUMERO: 15,     // P
    DT_CRIACAO: 17,    // R  
    DT_LIMITE: 18,     // S
    PRAZO_ENTREGA: 19, // T
    STATUS_PC: 24,     // Y  
    STATUS_FORN: 25,   // Z
    DT_EMISSAO: 26,    // AA
    DT_RECEB: 27,      // AB
    NF_NUMERO: 28,     // AC
    RC_CUSTO_TOTAL: 38, // AM
    PC_CUSTO_TOTAL: 40, // AO
    AUDITORIA: 49      // AX
  }
};

// ========================================
// 2. MAPEAMENTOS 
// ========================================

const MAPA_CATEGORIA_PA = {}; 

const MAPA_PAGAMENTO_PA = {
  '1': 'TEGrp', 'A VISTA': 'F7IlJ', 'À VISTA': 'F7IlJ', '1 PARCELA': 'lcfGd',
  '2 PARCELAS': 'PAkEz', '3 PARCELAS': 'y0zJs', '4 PARCELAS': 'ismbP', '5 PARCELAS': 'idzLp',
  '6 PARCELAS': 'ibAgQ', '10 PARCELAS': 't805I', '12 PARCELAS': 'YqnMr', '36 PARCELAS': 'wyy95',
  '45/60/90': 'McFMr', 'INFORMAR O NÚMERO DE PARCELAS': 'UcN6D', 'PARA 1 DIA': 'Sa7tc',
  'PARA 3 DIAS': 'qiZsZ', 'PARA 4 DIAS': '42ZPl', 'PARA 5 DIAS': 'boPKN', 'PARA 7 DIAS': 'LKMQL',
  'PARA 8 DIAS': 'QfmSJ', 'PARA 9 DIAS': 'lcsMo', 'PARA 10 DIAS': 'PB4BC', 'PARA 11 DIAS': 'LbNTV',
  'PARA 12 DIAS': 'A2Uvu', 'PARA 14 DIAS': 'KVPWY', 'PARA 15 DIAS': 'qEYST', 'PARA 17 DIAS': 'SyKgD',
  'PARA 20 DIAS': 'OGiKD', 'PARA 21 DIAS': 'pXW0B', 'PARA 23 DIAS': 'xiu1d', 'PARA 24 DIAS': 'vmws5',
  'PARA 25 DIAS': 'BnIoU', 'PARA 26 DIAS': 'bgiGx', 'PARA 28 DIAS': '8rvUJ', 'PARA 29 DIAS': 'Yo3sG',
  'PARA 30 DIAS (C)': 'MGTty', 'PARA 31 DIAS': 'tC1OI', 'PARA 35 DIAS': '1LmUz', 'PARA 36 DIAS': 'kKft2',
  'PARA 39 DIAS': 'cjbtw', 'PARA 42 DIAS': 'N5UvP', 'PARA 45 DIAS': 'TWKK0', 'PARA 50 DIAS': 'qakMs',
  '1/15 (C)': 'iOMAr', 'PARA 60 DIAS': 'jnbyj', 'PARA 8 DIAS (C)': 'Mx0Mu', 'PARA 13 DIAS': '1SB7B',
  'PARA 90 DIAS': 'j4uXD', 'PARA 29 DIAS (C)': 'w7p3A', '25/35/42': 'Bwphm', 'PARA 2 DIAS (C)': 'KVvDw',
  'PARA 4 DIAS (C)': 'IJVxr', 'PARA 365 DIAS': 'phQoo', '35/50': 'xFMB3', 'A VISTA/14/21': '9Qqfi',
  '5/15': '5iu7v', 'PARA 16 DIAS (C)': '34XVV', '25/40': 'Nnq6m', '21/45': 'minKO', '45/60': 'mCSOm',
  '21/28/42': 'qktNy', '28/45/56': '1UE8O', '28/35/42/49': 'YY8c4', '39/60/90': 'jsmK6', '28/42/56': 't1k4I',
  '45/60/75': 'LpJCl', '01/07/2026': 'TtHVS', 'A VISTA/60': 'D9HOb', '30/60': 'iIaNN', '28/35/42': 'ec9Uj',
  '28/56': 'KYcXX', '20/40 (C)': 'dwkmT', '28/35': 'tv8gM', '30/45': '4QVHr', '28/56 (C)': 'EkMpi',
  '30/60/90': 't07mZ', '28/42': 'hFVl3', '30/60/90/120': 'j7D1W', 'A VISTA/15': 'mVrPq', 'A VISTA/30': 'OLLrj',
  'A VISTA/30/60': 'l291L', 'A VISTA/30/60/90': 'o5wfN', 'A VISTA/30/60/90/120/150': 'R1zGk', '15/45/75': 'pSt44',
  '28/56/84/112': '3ERFU', 'A VISTA/30/60/90 (C)': '1ItDj', 'A VISTA/30/60/90/120': 'DwsRo', '21/42': 'YxGC4',
  '15/30/45': 'HmhbW', '28/56/84': 'yghdd', '30/60/90/120 (C)': '0y5GG', 'PARA 31 DIAS (C)': '1PRty',
  '20/40': '7zYZY', '21/28': 'pHLH5', 'A VISTA/30 (C)': 'gz1B7', '1/30/60': 'SL2lk', 'A VISTA/28': '5tQFN',
  'A VISTA/15/30': '0KJn3', '20/40/60 (C)': 'EFLAZ', '15/30': 't4SkH', '20/40/60': 'gxX6v', '15/45': 'kQ9qa',
  '30/60/90/120/150/180': '0rW0u', '30/60/90/120/150': 'dE2hV', 'PARA 30 DIAS': 'WKuQF', '30/45/60': 'joHt7',
  'PARA 19 DIAS': 'kFGnd', 'A VISTA/30/60 (C)': 'yvgX8', 'A VISTA/21': '4ZX0k', '20/50/80': 'Op7yG',
  '15/30 (C)': '4KET8', 'A VISTA/7': 'MxEOW', 'PARA 33 DIAS': 'dauj8', 'PARA 18 DIAS': '67SrS',
  'PARA 65 DIAS': 'bbqKm', 'PARA 32 DIAS': 'rA2SR', 'PARA 1 DIAS': 'K0ned', 'PARA 2 DIAS': 'WFJwW',
  'PARA 6 DIAS': '466vr', 'PARA 16 DIAS': '0pSd2', 'PARA 27 DIAS': 'UY2jU', 'A VISTA/10': 'ojaDn',
  'PARA 47 DIAS': 'Q9euf', 'A VISTA/15 (C)': 'tuuBc', '20/45': 'uquHb', 'A VISTA/28/56': 'P7rXH',
  '1/20': 'GxHel', 'PARA 55 DIAS': '8rq9o', '15/35': 'PO2Lh', '28/56/84/112/140/168': 'HjmlC',
  'PARA 24 DIAS (C)': 'pQWQh', 'PARA 26 DIAS (C)': 'lGc6e', 'A VISTA/15/30 (C)': 'sjJnk',
  'A VISTA/15/45': 'NPwsd', 'PARA 65 DIAS (C)': 'tUrNe', 'A VISTA/28/42/56': 'ENtrh', '1/30': 'he81X',
  'PARA 12 DIAS (C)': 'j7gR8', '15/45 (C)': 'po9bi', '25/42/56': 'euH5P', '10/40': 'QX1FN',
  'PARA 18 DIAS (C)': 'my8z3', 'PARA 19 DIAS (C)': 'k4oq1', 'PARA 22 DIAS': 'g2Lae', 'PARA 23 DIAS (C)': '5hOgZ',
  'A VISTA/5': 'qHan6', '7/21': 'YmkFF', '40/60': 'VNPBj', '1/28': 'a1qx1', 'PARA 63 DIAS': 'WcakV',
  'PARA 32 DIAS (C)': 'J0pPi', 'PARA 27 DIAS (C)': 'NKH6D', '7/35': 'TiDec', '14/28/35': 'i2Rbo',
  '20/50': 'GC9Nl', '1/15': 'Jy7ys', '7/30': 'q0MyQ'
};

const MAPA_STATUS_PC_PA = {
  'REQUISIÇÃO': '6GKKZ', 'REQUISICAO': '6GKKZ',
  'PEDIDO DE COMPRA': 'u9sUX',
  'APROVAÇÃO': 'iYgTt', 'APROVACAO': 'iYgTt'
};

const MAPA_STATUS_FORN_PA = {
  'FATURADO PELO FORNECEDOR': 'XPWlp',
  'RECEBIDO': 'AtWQZ',
  'CONFERIDO': 'yr7tf'
};

// ========================================
// 3. FUNÇÕES PÚBLICAS (ATUALIZADA)
// ========================================

function sincronizarGERAL_ProjetosAtivos() {
  const hInicioRelogio = new Date().getTime(); 
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 🆕 CONTADOR PARA O ORQUESTRADOR
  let totalAtualizadosGeral = 0;

  // Proteção de Lock
  if (props.getProperty('LOCK_SYNC_PROJETOS') === 'TRUE') {
    Logger.log('⚠️ Sync Projetos Ativos já está rodando. Ignorando chamada.');
    return 0;
  }

  try {
    props.setProperty('LOCK_SYNC_PROJETOS', 'TRUE');
    Logger.log('🌟 INICIANDO SYNC PROJETOS ATIVOS V8.4...');
    
    // Módulo 1 (Compras/Financeiro)
    const qtdFin = sincronizarFinanceiro_PA();
    
    // Módulo 2 (Painel)
    const qtdPainel = sincronizarPainelCompleto_PA();
    
    totalAtualizadosGeral = qtdFin + qtdPainel;
    
    Logger.log('🏁 SYNC PROJETOS CONCLUÍDO. Atualizados: ' + totalAtualizadosGeral);
    // ss.toast('Sync Projetos OK: ' + totalAtualizadosGeral, 'Sucesso');

  } catch (e) {
    Logger.log('❌ Erro Sync Projetos: ' + e.message);
    // Retorna 0 para o orquestrador saber que falhou
    totalAtualizadosGeral = 0;
  } finally {
    props.deleteProperty('LOCK_SYNC_PROJETOS');
  }

  // 🆕 RETORNO OBRIGATÓRIO PARA O ORQUESTRADOR
  return totalAtualizadosGeral;
}

function sincronizarFinanceiro_PA() {
  return executarSyncFinanceiroPA(['CUSTO', 'FORNECEDOR', 'PAGAMENTO', 'DATA', 'CATEGORIA']);
}

// ========================================
// 4. MOTOR MÓDULO 1: FINANCEIRO
// ========================================

function executarSyncFinanceiroPA(campos) {
  Logger.log('\n🔵 [MÓDULO 1] SYNC FINANCEIRO (PA)');
  
  const dados = lerComprasConsolidadoPA();
  const listaPCs = Object.keys(dados);
  if (listaPCs.length === 0) return 0;

  const mapaSmart = buscarSmartSuitePA(); 
  let cont = 0;

  listaPCs.forEach(pc => {
    if (!mapaSmart[pc]) return;
    const origem = dados[pc];
    const destino = mapaSmart[pc];
    const payload = {};
    let mudou = false;

    // 1. Fornecedor
    if (campos.includes('FORNECEDOR')) {
      if (!saoIguaisRobusto(origem.fornecedor, destino.fornecedor)) {
        payload[PA_CONF_FIN.FIELDS.PC_FORNECEDOR] = origem.fornecedor;
        mudou = true;
      }
    }
    // 2. Custo
    if (campos.includes('CUSTO')) {
      if (Math.abs(origem.custo - destino.custo) > 0.01) {
        payload[PA_CONF_FIN.FIELDS.PC_CUSTO] = origem.custo;
        mudou = true;
      }
    }
    // 3. Pagamento
    if (campos.includes('PAGAMENTO')) {
      const idMap = MAPA_PAGAMENTO_PA[origem.condPagto];
      const idSmart = destino.condPagto;
      if (idMap && idMap !== idSmart) {
        payload[PA_CONF_FIN.FIELDS.PC_COND_PAGTO] = idMap;
        mudou = true;
      }
    }
    // 4. Data
    if (campos.includes('DATA')) {
      const d1 = formatarDataISO(origem.previsao);
      const d2 = destino.previsao;
      if (d1 && d1 !== d2) {
        payload[PA_CONF_FIN.FIELDS.PC_PREVISAO] = { "to_date": { "date": d1 + 'T00:00:00Z', "include_time": false }, "from_date": null };
        mudou = true;
      }
    }
    // 5. Categoria
    if (campos.includes('CATEGORIA') && origem.categoria) {
      const catNormalizada = normalizarValor(origem.categoria);
      let valorParaEnviar = MAPA_CATEGORIA_PA[catNormalizada] || origem.categoria;
      
      if (valorParaEnviar !== destino.categoria) {
          payload[PA_CONF_FIN.FIELDS.PC_CATEGORIA] = valorParaEnviar; 
          mudou = true;
      }
    }

    if (mudou) {
      if (enviarPatchPA(destino.systemId, payload)) {
        cont++;
        Logger.log('   ✅ [Fin] Atualizado PC ' + pc);
      }
    }
  });
  Logger.log('   📊 Financeiro atualizado: ' + cont);
  return cont;
}

// ========================================
// 5. MOTOR MÓDULO 2: PAINEL COMPLETO
// ========================================

function sincronizarPainelCompleto_PA() {
  Logger.log('\n🟣 [MÓDULO 2] SYNC PAINEL COMPLETO (PA)');
  
  const dados = lerPainelResultadosPA();
  const listaPCs = Object.keys(dados);
  if (listaPCs.length === 0) return 0;

  const mapaSmart = buscarSmartSuitePA();
  let cont = 0;

  listaPCs.forEach(pc => {
    if (!mapaSmart[pc]) return;
    const origem = dados[pc];
    const destino = mapaSmart[pc];
    const payload = {};
    let mudou = false;
    let motivos = []; 

    // --- CORREÇÃO: STATUS PC ---
    const statusPcTexto = normalizarValor(origem.statusPC);
    const idStatusPc = MAPA_STATUS_PC_PA[statusPcTexto];
    
    // Se achamos um ID no mapa E ele for diferente do Smart (mesmo que Smart seja null)
    if (idStatusPc) {
      if (idStatusPc !== destino.statusPC) {
        payload[PA_CONF_PAINEL.FIELDS.STATUS_PC] = idStatusPc;
        mudou = true; motivos.push(`StatusPC`);
      }
    } else if (statusPcTexto !== "") {
      Logger.log(`⚠️ Status '${statusPcTexto}' no PC ${pc} não encontrado no MAPA_STATUS_PC_PA.`);
    }

    // --- STATUS FORN ---
    const statusFornTexto = normalizarValor(origem.statusForn);
    const idStatusForn = MAPA_STATUS_FORN_PA[statusFornTexto];
    if (idStatusForn && idStatusForn !== destino.statusForn) {
      payload[PA_CONF_PAINEL.FIELDS.STATUS_FORN] = idStatusForn;
      mudou = true; motivos.push(`StatusForn`);
    }
    
    // --- DATAS E NF ---
    const dtEmissao = formatarDataISO(origem.dtEmissao);
    if (dtEmissao && dtEmissao !== destino.dtEmissao) {
      payload[PA_CONF_PAINEL.FIELDS.DT_EMISSAO] = { "date": dtEmissao + 'T00:00:00Z', "include_time": false };
      mudou = true; motivos.push(`DtEmissao`);
    }
    const dtReceb = formatarDataISO(origem.dtReceb);
    if (dtReceb && dtReceb !== destino.dtReceb) {
      payload[PA_CONF_PAINEL.FIELDS.DT_RECEB] = { "date": dtReceb + 'T00:00:00Z', "include_time": false };
      mudou = true; motivos.push(`DtReceb`);
    }
    
    // --- CORREÇÃO: DATA DE CRIAÇÃO ---
    const dtCriacao = formatarDataISO(origem.dtCriacao);
    if (dtCriacao && dtCriacao !== destino.dtCriacao) {
      payload[PA_CONF_PAINEL.FIELDS.DT_CRIACAO] = { "date": dtCriacao + 'T00:00:00Z', "include_time": false };
      mudou = true; motivos.push(`DtCriacao`);
    } else if (origem.dtCriacao && !dtCriacao) {
      Logger.log(`⚠️ Erro data criação PC ${pc}: Valor '${origem.dtCriacao}' inválido.`);
    }

    // --- OUTROS ---
    const nfOrigemStr = String(origem.nfNumero || '').trim().replace(/\D/g, ''); 
    const nfOrigemNum = nfOrigemStr ? parseInt(nfOrigemStr) : null;
    const nfSmartStr = String(destino.nfNumero || '').trim();
    if (String(nfOrigemNum || '') !== nfSmartStr && nfOrigemNum !== null) {
         payload[PA_CONF_PAINEL.FIELDS.NF_NUMERO] = nfOrigemNum;
         mudou = true; motivos.push(`NF`);
    }
    
    const audOrigemLimpa = normalizarTextoLongo(origem.auditoria);
    const audSmartLimpa = normalizarTextoLongo(destino.auditoria);
    if (audOrigemLimpa !== audSmartLimpa) {
      if (audOrigemLimpa !== "") {
         payload[PA_CONF_PAINEL.FIELDS.AUDITORIA] = origem.auditoria;
         mudou = true; motivos.push(`Audit`);
      }
    }

    const dtLimite = formatarDataISO(origem.dtLimite);
    if (dtLimite && dtLimite !== destino.dtLimite) {
      payload[PA_CONF_PAINEL.FIELDS.DT_LIMITE] = { "date": dtLimite + 'T00:00:00Z', "include_time": false };
      mudou = true; motivos.push(`DtLimite`);
    }
    
    if (!saoIguaisRobusto(origem.prazo, destino.prazo)) {
      if (origem.prazo !== "" && origem.prazo !== null) {
          payload[PA_CONF_PAINEL.FIELDS.PRAZO_ENTREGA] = parseInt(origem.prazo);
          mudou = true; motivos.push(`Prazo`);
      }
    }

    // --- CUSTOS TOTAIS ---
    if (Math.abs(parseFloat(origem.rcCusto || 0) - parseFloat(destino.rcCusto || 0)) > 0.01) {
        payload[PA_CONF_PAINEL.FIELDS.RC_CUSTO_TOTAL] = parseFloat(origem.rcCusto);
        mudou = true; motivos.push(`RC.Custo`);
    }
    if (Math.abs(parseFloat(origem.pcCusto || 0) - parseFloat(destino.pcCusto || 0)) > 0.01) {
        payload[PA_CONF_PAINEL.FIELDS.PC_CUSTO_TOTAL] = parseFloat(origem.pcCusto);
        mudou = true; motivos.push(`PC.Custo`);
    }

    if (mudou) {
      if (enviarPatchPA(destino.systemId, payload)) {
        cont++;
        Logger.log(`   ✅ [Painel] Atualizado PC ${pc} | Mudou: ${motivos.join(', ')}`);
      }
    }
  });
  Logger.log('   📊 Painel atualizado: ' + cont);
  return cont;
}

// ========================================
// 6. LEITURAS DAS PLANILHAS
// ========================================

function lerComprasConsolidadoPA() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PA_CONF_FIN.NOME_ABA);
  if (!sheet) return {};
  const dados = sheet.getDataRange().getValues();
  const agrupado = {};

  for (let i = 1; i < dados.length; i++) {
    const pc = String(dados[i][PA_CONF_FIN.COLS.PC_NUMERO] || '').trim();
    if (!pc) continue;
    
    const custo = parseFloat(dados[i][PA_CONF_FIN.COLS.CUSTO]);
    const forn = String(dados[i][PA_CONF_FIN.COLS.FORNECEDOR] || '').trim();
    const pag = String(dados[i][PA_CONF_FIN.COLS.COND_PAGTO] || '').trim().toUpperCase();
    const data = dados[i][PA_CONF_FIN.COLS.PREVISAO];
    const cat = String(dados[i][PA_CONF_FIN.COLS.CATEGORIA] || '').trim().toUpperCase();

    if (!agrupado[pc]) agrupado[pc] = { custo: 0, fornecedor: '', condPagto: '', previsao: null, categoria: '' };
    
    if (!isNaN(custo)) agrupado[pc].custo += custo;
    if (forn) agrupado[pc].fornecedor = forn;
    if (!agrupado[pc].condPagto && pag) agrupado[pc].condPagto = pag;
    if (!agrupado[pc].previsao && data) agrupado[pc].previsao = data;
    if (!agrupado[pc].categoria && cat) agrupado[pc].categoria = cat;
  }
  return agrupado;
}

function lerPainelResultadosPA() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(PA_CONF_PAINEL.NOME_ABA);
  if (!sheet) return {}; 
  
  const dados = sheet.getDataRange().getValues();
  const mapa = {}; 

  for (let i = 1; i < dados.length; i++) {
    const pc = String(dados[i][PA_CONF_PAINEL.COLS.PC_NUMERO] || '').trim(); 
    if (!pc) continue;

    mapa[pc] = {
      statusPC: dados[i][PA_CONF_PAINEL.COLS.STATUS_PC],   
      statusForn: dados[i][PA_CONF_PAINEL.COLS.STATUS_FORN],
      dtEmissao: dados[i][PA_CONF_PAINEL.COLS.DT_EMISSAO],
      dtReceb: dados[i][PA_CONF_PAINEL.COLS.DT_RECEB],
      nfNumero: dados[i][PA_CONF_PAINEL.COLS.NF_NUMERO],
      auditoria: dados[i][PA_CONF_PAINEL.COLS.AUDITORIA],
      dtCriacao: dados[i][PA_CONF_PAINEL.COLS.DT_CRIACAO], 
      dtLimite: dados[i][PA_CONF_PAINEL.COLS.DT_LIMITE],   
      prazo: dados[i][PA_CONF_PAINEL.COLS.PRAZO_ENTREGA],
      rcCusto: dados[i][PA_CONF_PAINEL.COLS.RC_CUSTO_TOTAL],
      pcCusto: dados[i][PA_CONF_PAINEL.COLS.PC_CUSTO_TOTAL]
    };
  }
  return mapa;
}

// ========================================
// 7. INTEGRAÇÃO SMARTSUITE
// ========================================

function buscarSmartSuitePA() {
  const mapa = {};
  const url = PA_API_CONFIG.BASE_URL + '/applications/' + PA_API_CONFIG.TABLE_ID + '/records/list/';
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Authorization': 'Token ' + PA_API_CONFIG.API_TOKEN,
        'Content-Type': 'application/json',
        'Account-Id': PA_API_CONFIG.ACCOUNT_ID
      },
      payload: JSON.stringify({ offset: 0, limit: 2500 }),
      muteHttpExceptions: true
    });
    const items = JSON.parse(response.getContentText()).items || [];
    items.forEach(r => {
      let valPC = extrairValorSimples(r[PA_CONF_FIN.FIELDS.PC_NUMERO]).trim();
      if (valPC) {
        mapa[valPC] = {
          systemId: r.id,
          custo: r[PA_CONF_FIN.FIELDS.PC_CUSTO] ? parseFloat(r[PA_CONF_FIN.FIELDS.PC_CUSTO]) : 0,
          fornecedor: extrairValorSimples(r[PA_CONF_FIN.FIELDS.PC_FORNECEDOR]).trim(),
          condPagto: extrairIdStatus(r[PA_CONF_FIN.FIELDS.PC_COND_PAGTO]),
          previsao: formatarDataSmart(r[PA_CONF_FIN.FIELDS.PC_PREVISAO]),
          categoria: extrairIdStatus(r[PA_CONF_FIN.FIELDS.PC_CATEGORIA]),
          
          statusPC: extrairIdStatus(r[PA_CONF_PAINEL.FIELDS.STATUS_PC]),
          statusForn: extrairIdStatus(r[PA_CONF_PAINEL.FIELDS.STATUS_FORN]),
          dtEmissao: formatarDataSmart(r[PA_CONF_PAINEL.FIELDS.DT_EMISSAO]),
          dtReceb: formatarDataSmart(r[PA_CONF_PAINEL.FIELDS.DT_RECEB]),
          nfNumero: extrairValorSimples(r[PA_CONF_PAINEL.FIELDS.NF_NUMERO]).trim(),
          auditoria: extrairValorSimples(r[PA_CONF_PAINEL.FIELDS.AUDITORIA]).trim(),
          dtCriacao: formatarDataSmart(r[PA_CONF_PAINEL.FIELDS.DT_CRIACAO]),
          dtLimite: formatarDataSmart(r[PA_CONF_PAINEL.FIELDS.DT_LIMITE]),
          prazo: r[PA_CONF_PAINEL.FIELDS.PRAZO_ENTREGA],
          rcCusto: r[PA_CONF_PAINEL.FIELDS.RC_CUSTO_TOTAL],
          pcCusto: r[PA_CONF_PAINEL.FIELDS.PC_CUSTO_TOTAL]
        };
      }
    });
  } catch (e) { Logger.log('❌ Erro busca Smart: ' + e.message); }
  return mapa;
}

function enviarPatchPA(id, payload) {
  const url = PA_API_CONFIG.BASE_URL + '/applications/' + PA_API_CONFIG.TABLE_ID + '/records/' + id + '/';
  try {
    UrlFetchApp.fetch(url, {
      method: 'patch',
      headers: { 'Authorization': 'Token ' + PA_API_CONFIG.API_TOKEN, 'Content-Type': 'application/json', 'Account-Id': PA_API_CONFIG.ACCOUNT_ID },
      payload: JSON.stringify(payload)
    });
    return true;
  } catch (e) { return false; }
}

// ========================================
// 8. HELPERS E VALIDORES
// ========================================

function extrairIdStatus(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor) && valor.length > 0) return valor[0];
  if (typeof valor === 'object' && valor.value) return valor.value;
  return '';
}

function extrairValorSimples(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number') return String(valor);
  if (typeof valor === 'object') {
    if (valor.title) return valor.title;
    return ''; 
  }
  return String(valor);
}

function normalizarValor(val) {
  if (val === null || val === undefined || val === "") return "";
  return String(val).trim().toUpperCase();
}

function normalizarTextoLongo(val) {
  if (!val) return "";
  return String(val).replace(/\s+/g, ' ').trim().toUpperCase();
}

function saoIguaisRobusto(v1, v2) {
  return normalizarValor(v1) === normalizarValor(v2);
}

function formatarDataISO(valor) {
  if (!valor) return '';
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  const s = String(valor).trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}/.test(s)) {
      var parts = s.split('/');
      var dia = parts[0].padStart(2, '0');
      var mes = parts[1].padStart(2, '0');
      var ano = parts[2];
      return ano + '-' + mes + '-' + dia;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return ''; 
}

function formatarDataSmart(obj) {
  if (!obj) return '';
  if (obj.to_date && obj.to_date.date) return obj.to_date.date.substring(0, 10);
  if (obj.date) return obj.date.substring(0, 10);
  if (typeof obj === 'string') return obj.substring(0, 10);
  return '';
}
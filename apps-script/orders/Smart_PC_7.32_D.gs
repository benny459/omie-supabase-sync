/**
 * ════════════════════════════════════════════════════════════════
 * SCRIPT MESTRE: SYNC SMART SUITE (V2) - V7.32 (COMPATÍVEL V3)
 * 1. Return Count: Retorna total de registros atualizados.
 * 2. Lock: Proteção contra execução duplicada (LOCK_SYNC_V2).
 * 3. Base V7.31 mantida (Novo Campo Projetos + NF + Financeiro).
 * ════════════════════════════════════════════════════════════════
 */

const CONFIG_SMART_V2 = {
  BASE_URL: 'https://app.smartsuite.com/api/v1',
  ACCOUNT_ID: 'snm19hn6',
  TABLE_ID: '679bd37761f688f6107fde60', 
  API_TOKEN: 'b64bd1cca64432c1a36f1e5e861fa7fe0aea1320'
};

// ========================================
// 1. CONFIGURAÇÃO: COMPRAS
// ========================================
const CONF_COMPRAS = {
  NOME_ABA: 'Compras_consolidado',
  FIELDS: {
    PC_NUMERO: 'title',            
    PC_FORNECEDOR: 'scc1a2eacd',   
    PC_CUSTO: 'sad280e350',        
    PC_COND_PAGTO: 's58ad3b921',   
    PC_PREVISAO: 's0b34685a6',     
    PC_CATEGORIA: 'sb6b748982',    
    STATUS_PC: 'sc8d058bcc',       
    PC_PROJETO: 'sa3ba17aff',      
    DT_EMISSAO: 's6krs1wy',        
    DT_CRIACAO: 'first_created',   
    DT_LIMITE: 's0b34685a6',       
    PRAZO_ENTREGA: 'scf0fb3a7a'    
  },
  COLS: { 
    PC_NUMERO: 2,      // C
    DT_LIMITE: 4,      // E 
    CUSTO: 24,         // Y
    FORNECEDOR: 26,    // AA
    STATUS_PC: 27,     // AB
    PROJETO: 29,       // AD
    CATEGORIA: 32,     // AG
    COND_PAGTO: 34,    // AI
    DT_EMISSAO: 17     // R
  }
};

// ========================================
// 2. CONFIGURAÇÃO: NF
// ========================================
const CONF_NF = {
  NOME_ABA: 'NF_Consolidado',
  FIELDS: {
    PC_NUMERO: 'title',            
    STATUS_FORN: 'sc40d1040b',     
    DT_EMISSAO_NF: 's412680e66',   
    DT_RECEB: 's987a3e9ab',        
    NF_NUMERO: 'sa6772185e',       
    AUDITORIA: 's88a2e1990'        
  },
  COLS: {
    PC_NUMERO: 49,     // AX 
    STATUS_FORN: 50,   // AY
    DT_EMISSAO_NF: 10, // K
    DT_RECEB: 17,      // R
    NF_NUMERO: 7,      // H
    AUDITORIA: 49      // (Verificar se é AX ou AZ)
  }
};

// ========================================
// 3. MAPEAMENTOS
// ========================================

const MAPA_STATUS_PC_V2 = {
  'REQUISIÇÃO': 'tQypY', 'REQUISICAO': 'tQypY',
  'PEDIDO DE COMPRA': 'i1QNp',
  'APROVAÇÃO': '5vNYd', 'APROVACAO': '5vNYd'
};

const MAPA_PAGAMENTO_V2 = {
  '0': 'dm4bD', 'A VISTA': 'EvC9x', 'À VISTA': 'EvC9x', '1. À VISTA': 'EvC9x',
  '1 PARCELA': 'tZfqV', '2 PARCELAS': 'mjW92', '3 PARCELAS': 'jGigO', '3X': 'jGigO',
  '4 PARCELAS': 'TW4fJ', '5 PARCELAS': 'W1dAT', '6 PARCELAS': 'pKlTQ',
  '10 PARCELAS': 'tf3QG', '12 PARCELAS': 'IzUd4', '36 PARCELAS': 'jpiSc',
  '45/60/90': 'lfftO', 'INFORMAR O NÚMERO DE PARCELAS': 'e84Gz',
  'PARA 1 DIA': 'TeQrr', 'PARA 1 DIAS': 'TeQrr', 'PARA 3 DIAS': '1h9jD',
  'PARA 4 DIAS': 'LSgh1', 'PARA 5 DIAS': '3goTm', 'PARA 7 DIAS': 'JpmD0',
  'PARA 8 DIAS': 'ctErb', 'PARA 9 DIAS': 'DMmmA', 'PARA 10 DIAS': 'x5sXq',
  'PARA 11 DIAS': 'E1aS1', 'PARA 12 DIAS': 'F1Bd4', 'PARA 14 DIAS': 'tyGbg',
  'PARA 15 DIAS': 'L2XNE', 'PARA 17 DIAS': 'TWg2H', 'PARA 20 DIAS': 'yBx6A',
  'PARA 21 DIAS': 'JINLj', 'PARA 23 DIAS': '9CWck', 'PARA 24 DIAS': 'F6nwe',
  'PARA 25 DIAS': 'VUbkM', 'PARA 26 DIAS': '5xYrx', 'PARA 28 DIAS': 'RiFAV',
  'PARA 29 DIAS': 'Xw7Vq', 'PARA 30 DIAS (C)': 'fGxcp', 'PARA 31 DIAS': '9WOS2',
  'PARA 35 DIAS': 'crGIG', 'PARA 36 DIAS': 'UozUp', 'PARA 39 DIAS': 'HfgC1',
  'PARA 42 DIAS': 'vLtBx', 'PARA 45 DIAS': 'FMrz5', 'PARA 50 DIAS': 'gMby3',
  '1/15 (C)': 'A2H3g', 'PARA 60 DIAS': '1zOtv', 'PARA 8 DIAS (C)': 'X2LDk',
  'PARA 13 DIAS': 'T995b', 'PARA 90 DIAS': 'rAHBJ', 'PARA 29 DIAS (C)': 'XNcLW',
  '25/35/42': 'DODHv', 'PARA 2 DIAS (C)': 'BaimR', 'PARA 2 DIAS': 'Aq2cf',
  'PARA 4 DIAS (C)': 'kGlpR', 'PARA 365 DIAS': 'ZQ6q0', '35/50': 'mESDE',
  'A VISTA/14/21': 'IZMI0', '5/15': 'tWCqj', 'PARA 16 DIAS (C)': '5UX2W', 'PARA 16 DIAS': 'gFn38',
  '25/40': 'KvEXm', '21/45': 'ccSTn', '45/60': 'I9gvu', '21/28/42': '2SYjy',
  '28/45/56': 'levwH', '28/35/42/49': 'M4orZ', '39/60/90': 'inYLz',
  '28/42/56': 'BYZZd', '45/60/75': 'V0ESS', '01/07/2026': 'oQaal',
  'A VISTA/60': 'CxHxj', '30/60': 'sKnht', '28/35/42': 'GyzmE',
  '28/56': 'YHhyi', '20/40 (C)': 'NBL7P', '28/35': 'QMFoS', '30/45': 'N7FVk',
  '28/56 (C)': 'BfxYG', '30/60/90': 'jcqhd', '28/42': '9sILy', '30/60/90/120': 'JkVcU',
  'A VISTA/15': 'eMeT1', 'A VISTA/30': 'DwIJo', 'A VISTA/30/60': 'xrPe9',
  'A VISTA/30/60/90': 'BCmyN', 'A VISTA/30/60/90/120/150': 'mmL1z', '15/45/75': 'nJEje',
  '28/56/84/112': 'aSKXf', 'A VISTA/30/60/90 (C)': '7gsCU', 'A VISTA/30/60/90/120': 'b8pc6',
  '21/42': 'nks6U', '15/30/45': 'S9jmi', '28/56/84': '5KJR3', '30/60/90/120 (C)': '9z493',
  'PARA 31 DIAS (C)': 'F5HYD', '20/40': 'Oo8f1', '21/28': 'u1LEa',
  'A VISTA/30 (C)': 'Pupwi', '1/30/60': 'sv0tv', 'A VISTA/28': 'OnYIj',
  'A VISTA/15/30': 'O61YO', '20/40/60 (C)': 'RO7gR', '15/30': 'zLdNT',
  '20/40/60': 'WaVgx', '15/45': 'pBIDw', '30/60/90/120/150/180': 'qrTxB',
  '30/60/90/120/150': 'rZbx7', 'PARA 30 DIAS': 'wCp1e', '30/45/60': 'ZItQ7',
  'PARA 19 DIAS': 'CTYoQ', 'A VISTA/30/60 (C)': '3QR5J', 'A VISTA/21': 'Lzjru',
  '20/50/80': '9TgzK', '15/30 (C)': 'JW5Zy', 'A VISTA/7': '0bXpu', 'PARA 33 DIAS': 'uilWC',
  'PARA 18 DIAS': '4GDqW', 'PARA 65 DIAS': '7VdRv', 'PARA 32 DIAS': 'YGrxh',
  'PARA 6 DIAS': 'nNnDm', 'PARA 27 DIAS': 'FzGHr', 'A VISTA/10': 'EUUom',
  'PARA 47 DIAS': 'Sr7tl', 'A VISTA/15 (C)': 'Tu4Sg', '20/45': 'cy839',
  'A VISTA/28/56': 'wqIfQ', '1/20': 'A8YSD', 'PARA 55 DIAS': 'HPS5x',
  '15/35': 'Ygjex', '28/56/84/112/140/168': 'A7J6X', 'PARA 24 DIAS (C)': 'Agl6I',
  'PARA 26 DIAS (C)': 'rxdcL', 'A VISTA/15/30 (C)': 'a5Ciu', 'A VISTA/15/45': 'yuHXa',
  'PARA 65 DIAS (C)': 'LgqdF', 'A VISTA/28/42/56': 'asR9o', '1/30': 'y3C8O',
  'PARA 12 DIAS (C)': 'j6V3l', '15/45 (C)': 'eumuu', '25/42/56': 'IfAVR',
  '10/40': 'YE4XZ', 'PARA 18 DIAS (C)': 'U0gS3', 'PARA 19 DIAS (C)': 'oG7kH',
  'PARA 22 DIAS': 'pgjEB', 'PARA 23 DIAS (C)': 'E5T7D', 'A VISTA/5': '7CCPV',
  '7/21': 'sBEC2', '40/60': '414DR', '1/28': 'sOb9F', 'PARA 63 DIAS': 'zoEjM',
  'PARA 32 DIAS (C)': '0pD7T', 'PARA 27 DIAS (C)': 'tBNLB', '7/35': 'cS52O',
  '14/28/35': 'WVhWm', '20/50': 'Awk1L', '1/15': 'ileSB', '7/30': '8xmEn'
};

const MAPA_STATUS_FORN_V2 = {
  'FATURADO PELO FORNECEDOR': 'Qv5au', 'RECEBIDO': 'wKm3E', 'CONFERIDO': '77c9B'
};

// ========================================
// 4. FUNÇÕES PÚBLICAS (ATUALIZADA)
// ========================================

function executarSincronizacaoV2() {
  const hInicioRelogio = new Date().getTime(); 
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 🆕 CONTADOR PARA O ORQUESTRADOR
  let totalAtualizadosGeral = 0;

  // Proteção de Lock
  if (props.getProperty('LOCK_SYNC_V2') === 'TRUE') {
    Logger.log('⚠️ Sync V2 já está rodando. Ignorando chamada.');
    return 0;
  }

  try {
    props.setProperty('LOCK_SYNC_V2', 'TRUE');
    Logger.log('🌟 INICIANDO SYNC V2 (V7.32)...');
    
    // Módulo 1 (Compras)
    const qtdCompras = sincronizarComprasV2();
    
    // Módulo 2 (NF)
    const qtdNF = sincronizarNFsV2();
    
    totalAtualizadosGeral = qtdCompras + qtdNF;
    
    Logger.log('🏁 SYNC V2 CONCLUÍDO. Atualizados: ' + totalAtualizadosGeral);
    // ss.toast('Sync V2 OK: ' + totalAtualizadosGeral, 'Sucesso');

  } catch (e) {
    Logger.log('❌ Erro Sync V2: ' + e.message);
    // Retorna 0 para o orquestrador saber que falhou
    totalAtualizadosGeral = 0;
  } finally {
    props.deleteProperty('LOCK_SYNC_V2');
  }

  // 🆕 RETORNO OBRIGATÓRIO PARA O ORQUESTRADOR
  return totalAtualizadosGeral;
}

// ========================================
// 5. MOTOR MÓDULO 1: COMPRAS CONSOLIDADO
// ========================================
function sincronizarComprasV2() {
  Logger.log('\n🔵 [MÓDULO 1] COMPRAS CONSOLIDADO');
  
  const dados = lerComprasV2();
  const listaPCs = Object.keys(dados);
  if (listaPCs.length === 0) return 0;

  const mapaSmart = buscarSmartSuiteV2(); 
  let cont = 0;
  let logCount = 0;

  listaPCs.forEach(pc => {
    if (!mapaSmart[pc]) return;
    const origem = dados[pc];
    const destino = mapaSmart[pc];
    const payload = {};
    let mudou = false;
    let motivos = []; 

    // 1. Financeiro
    if (!saoIguaisRobustoV2(origem.fornecedor, destino.fornecedor)) {
      payload[CONF_COMPRAS.FIELDS.PC_FORNECEDOR] = origem.fornecedor; 
      mudou = true; motivos.push('Forn');
    }
    if (Math.abs(origem.custo - destino.custo) > 0.01) {
      payload[CONF_COMPRAS.FIELDS.PC_CUSTO] = origem.custo; 
      mudou = true; motivos.push('Custo');
    }
    
    // 2. Pagamento
    const txtPag = normalizarValorV2(origem.condPagto);
    const idMapPag = MAPA_PAGAMENTO_V2[txtPag];
    if (idMapPag && idMapPag !== destino.condPagto) {
      payload[CONF_COMPRAS.FIELDS.PC_COND_PAGTO] = idMapPag; 
      mudou = true; motivos.push('Pagto');
    }

    // 3. Categoria
    if (normalizarValorV2(origem.categoria) !== normalizarValorV2(destino.categoria)) {
      payload[CONF_COMPRAS.FIELDS.PC_CATEGORIA] = origem.categoria; 
      mudou = true; motivos.push('Cat');
    }

    // 4. Status PC
    const statusTxt = normalizarValorV2(origem.statusPC);
    const idStatus = MAPA_STATUS_PC_V2[statusTxt];
    if (idStatus && idStatus !== destino.statusPC) {
      payload[CONF_COMPRAS.FIELDS.STATUS_PC] = idStatus; 
      mudou = true; motivos.push(`StatusPC`);
    }
    
    // ✅ 5. Projetos (Novo)
    if (normalizarValorV2(origem.projeto) !== normalizarValorV2(destino.projeto)) {
      payload[CONF_COMPRAS.FIELDS.PC_PROJETO] = origem.projeto;
      mudou = true; motivos.push(`Proj`);
    }

    // 6. Data Limite
    const dLimite = formatarDataISOV2(origem.dtLimite);
    if (dLimite && dLimite !== destino.dtLimite) {
      payload[CONF_COMPRAS.FIELDS.PC_PREVISAO] = { "to_date": { "date": dLimite + 'T00:00:00Z', "include_time": false }, "from_date": null };
      mudou = true; motivos.push(`DtLimite`);
    }

    // 7. Data Emissão PEDIDO
    const dEmissao = formatarDataISOV2(origem.dtEmissao);
    if (dEmissao && dEmissao !== destino.dtEmissao) {
      payload[CONF_COMPRAS.FIELDS.DT_EMISSAO] = { "date": dEmissao + 'T00:00:00Z', "include_time": false };
      mudou = true; motivos.push(`DtEmissao`);
    }

    // 8. Prazo
    if (origem.dtLimite instanceof Date && origem.dtEmissao instanceof Date) {
      const diffTime = origem.dtLimite - origem.dtEmissao;
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
      const prazoSmart = (destino.prazoEntrega === null || destino.prazoEntrega === undefined) ? null : parseInt(destino.prazoEntrega, 10);

      if (!isNaN(diffDays) && diffDays !== prazoSmart) {
         payload[CONF_COMPRAS.FIELDS.PRAZO_ENTREGA] = diffDays; 
         mudou = true; motivos.push('Prazo');
      }
    }

    if (mudou) {
      if (enviarPatchV2(destino.systemId, payload)) {
        cont++;
        if (logCount < 5) {
            Logger.log(`⚠️ PC ${pc} UPD: ${motivos.join(' | ')}`);
            logCount++;
        }
      }
    }
  });
  
  if (cont > 0) Logger.log(`... e mais ${cont - logCount} registros.`);
  Logger.log('   📊 Compras atualizado: ' + cont);
  return cont;
}

// ========================================
// 6. MOTOR MÓDULO 2: NF CONSOLIDADO
// ========================================
function sincronizarNFsV2() {
  Logger.log('\n🟣 [MÓDULO 2] NF CONSOLIDADO');
  
  const dados = lerNFV2();
  const listaPCs = Object.keys(dados);
  if (listaPCs.length === 0) return 0;
  
  const mapaSmart = buscarSmartSuiteV2();
  let cont = 0;

  listaPCs.forEach(pc => {
    if (!mapaSmart[pc]) return;
    const origem = dados[pc];
    const destino = mapaSmart[pc];
    const payload = {};
    let mudou = false;
    let motivos = [];

    // Status Fornecedor
    const sForn = MAPA_STATUS_FORN_V2[normalizarValorV2(origem.statusForn)];
    if (sForn && sForn !== destino.statusForn) { 
        payload[CONF_NF.FIELDS.STATUS_FORN] = sForn; mudou = true; motivos.push('StForn');
    }

    // Data Emissão NF
    const dEmissaoNF = formatarDataISOV2(origem.dtEmissaoNF);
    if (dEmissaoNF && dEmissaoNF !== destino.dtEmissaoNF) { 
        payload[CONF_NF.FIELDS.DT_EMISSAO_NF] = { "date": dEmissaoNF + 'T00:00:00Z', "include_time": false }; 
        mudou = true; motivos.push(`DtEmissaoNF: [${dEmissaoNF}]`);
    }

    // Data Recebimento
    const dReceb = formatarDataISOV2(origem.dtReceb);
    if (dReceb && dReceb !== destino.dtReceb) { 
        payload[CONF_NF.FIELDS.DT_RECEB] = { "date": dReceb + 'T00:00:00Z', "include_time": false }; 
        mudou = true; motivos.push('DtReceb');
    }

    // NF
    const nfNum = origem.nfNumero ? parseInt(String(origem.nfNumero).replace(/\D/g, '')) : null;
    if (nfNum && String(nfNum) !== String(destino.nfNumero)) { 
        payload[CONF_NF.FIELDS.NF_NUMERO] = nfNum; mudou = true; motivos.push('NF');
    }
    const audTxt = String(origem.auditoria || '').trim();
    if (audTxt !== "" && audTxt !== String(destino.auditoria || '').trim()) { 
        payload[CONF_NF.FIELDS.AUDITORIA] = audTxt; mudou = true; motivos.push('Aud');
    }

    if (mudou) {
      if (enviarPatchV2(destino.systemId, payload)) {
        cont++;
        Logger.log(`   ✅ [NF] Atualizado PC ${pc} | ${motivos.join(' | ')}`);
      }
    }
  });
  Logger.log('   📊 NFs atualizadas: ' + cont);
  return cont;
}

// ========================================
// 7. LEITURAS DAS PLANILHAS
// ========================================

function lerComprasV2() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONF_COMPRAS.NOME_ABA);
  if (!sheet) return {};
  const dados = sheet.getDataRange().getValues();
  const agrupado = {};
  for (let i = 1; i < dados.length; i++) {
    const pc = String(dados[i][CONF_COMPRAS.COLS.PC_NUMERO] || '').trim();
    if (!pc) continue;
    
    if (!agrupado[pc]) agrupado[pc] = { 
      custo: 0, fornecedor: '', condPagto: '', 
      dtLimite: null, dtEmissao: null, 
      categoria: '', statusPC: '', projeto: '' 
    };
    
    const custo = parseFloat(dados[i][CONF_COMPRAS.COLS.CUSTO]);
    if (!isNaN(custo)) agrupado[pc].custo += custo;
    
    agrupado[pc].fornecedor = String(dados[i][CONF_COMPRAS.COLS.FORNECEDOR] || '').trim() || agrupado[pc].fornecedor;
    agrupado[pc].condPagto = String(dados[i][CONF_COMPRAS.COLS.COND_PAGTO] || '').trim().toUpperCase() || agrupado[pc].condPagto;
    agrupado[pc].dtLimite = dados[i][CONF_COMPRAS.COLS.DT_LIMITE] || agrupado[pc].dtLimite;
    agrupado[pc].categoria = String(dados[i][CONF_COMPRAS.COLS.CATEGORIA] || '').trim().toUpperCase() || agrupado[pc].categoria;
    agrupado[pc].statusPC = String(dados[i][CONF_COMPRAS.COLS.STATUS_PC] || '').trim().toUpperCase() || agrupado[pc].statusPC;
    agrupado[pc].dtEmissao = dados[i][CONF_COMPRAS.COLS.DT_EMISSAO] || agrupado[pc].dtEmissao;
    // ✅ Leitura do Projeto (AD)
    agrupado[pc].projeto = String(dados[i][CONF_COMPRAS.COLS.PROJETO] || '').trim();
  }
  return agrupado;
}

function lerNFV2() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONF_NF.NOME_ABA);
  if (!sheet) return {}; 
  const dados = sheet.getDataRange().getValues();
  const mapa = {}; 
  for (let i = 1; i < dados.length; i++) {
    const pc = String(dados[i][CONF_NF.COLS.PC_NUMERO] || '').trim(); 
    if (!pc) continue;
    mapa[pc] = {
      statusForn: dados[i][CONF_NF.COLS.STATUS_FORN],
      dtEmissaoNF: dados[i][CONF_NF.COLS.DT_EMISSAO_NF], 
      dtReceb: dados[i][CONF_NF.COLS.DT_RECEB],
      nfNumero: dados[i][CONF_NF.COLS.NF_NUMERO], 
      auditoria: dados[i][CONF_NF.COLS.AUDITORIA]
    };
  }
  return mapa;
}

// ========================================
// 8. INTEGRAÇÃO SMARTSUITE
// ========================================

function buscarSmartSuiteV2() {
  const mapa = {};
  try {
    const res = UrlFetchApp.fetch(`${CONFIG_SMART_V2.BASE_URL}/applications/${CONFIG_SMART_V2.TABLE_ID}/records/list/`, {
      method: 'post', headers: { 'Authorization': 'Token ' + CONFIG_SMART_V2.API_TOKEN, 'Content-Type': 'application/json', 'Account-Id': CONFIG_SMART_V2.ACCOUNT_ID },
      payload: JSON.stringify({ offset: 0, limit: 2500 }), muteHttpExceptions: true
    });
    const items = JSON.parse(res.getContentText()).items || [];
    items.forEach(r => {
      let valPC = extrairValorSimplesV2(r[CONF_COMPRAS.FIELDS.PC_NUMERO]).trim();
      if (valPC) {
        mapa[valPC] = {
          systemId: r.id,
          // Módulo 1
          custo: r[CONF_COMPRAS.FIELDS.PC_CUSTO] ? parseFloat(r[CONF_COMPRAS.FIELDS.PC_CUSTO]) : 0,
          fornecedor: extrairValorSimplesV2(r[CONF_COMPRAS.FIELDS.PC_FORNECEDOR]).trim(),
          condPagto: extrairIdStatusV2(r[CONF_COMPRAS.FIELDS.PC_COND_PAGTO]),
          dtLimite: formatarDataSmartV2(r[CONF_COMPRAS.FIELDS.PC_PREVISAO]),
          dtEmissao: formatarDataSmartV2(r[CONF_COMPRAS.FIELDS.DT_EMISSAO]), 
          categoria: extrairValorSimplesV2(r[CONF_COMPRAS.FIELDS.PC_CATEGORIA]),
          statusPC: extrairIdStatusV2(r[CONF_COMPRAS.FIELDS.STATUS_PC]), 
          prazoEntrega: r[CONF_COMPRAS.FIELDS.PRAZO_ENTREGA],
          // ✅ Leitura do Projeto do Smart
          projeto: extrairValorSimplesV2(r[CONF_COMPRAS.FIELDS.PC_PROJETO]).trim(),
          
          // Módulo 2
          statusForn: extrairIdStatusV2(r[CONF_NF.FIELDS.STATUS_FORN]),
          dtEmissaoNF: formatarDataSmartV2(r[CONF_NF.FIELDS.DT_EMISSAO_NF]),
          dtReceb: formatarDataSmartV2(r[CONF_NF.FIELDS.DT_RECEB]),
          nfNumero: extrairValorSimplesV2(r[CONF_NF.FIELDS.NF_NUMERO]).trim(), 
          auditoria: extrairValorSimplesV2(r[CONF_NF.FIELDS.AUDITORIA]).trim(),
        };
      }
    });
  } catch (e) { Logger.log('❌ Erro busca Smart: ' + e.message); }
  return mapa;
}

function enviarPatchV2(id, payload) {
  try {
    UrlFetchApp.fetch(`${CONFIG_SMART_V2.BASE_URL}/applications/${CONFIG_SMART_V2.TABLE_ID}/records/${id}/`, {
      method: 'patch', headers: { 'Authorization': 'Token ' + CONFIG_SMART_V2.API_TOKEN, 'Content-Type': 'application/json', 'Account-Id': CONFIG_SMART_V2.ACCOUNT_ID },
      payload: JSON.stringify(payload)
    });
    return true;
  } catch (e) { return false; }
}

// Helpers
function extrairIdStatusV2(v) { if (!v) return ''; if (typeof v==='string') return v; if (Array.isArray(v) && v.length>0) return v[0]; if (typeof v==='object' && v.value) return v.value; return ''; }
function extrairValorSimplesV2(v) { if (v==null) return ''; if (typeof v==='string') return v; if (typeof v==='number') return String(v); if (typeof v==='object' && v.title) return v.title; return String(v); }
function normalizarValorV2(v) { return v ? String(v).trim().toUpperCase() : ""; }
function saoIguaisRobustoV2(v1, v2) { return normalizarValorV2(v1) === normalizarValorV2(v2); }
function formatarDataISOV2(v) { if (!v) return ''; if (v instanceof Date) return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd'); const s = String(v).trim(); if (/^\d{2}\/\d{2}\/\d{4}/.test(s)) { var p = s.split('/'); return p[2] + '-' + p[1] + '-' + p[0]; } return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.substring(0, 10) : ''; }
function formatarDataSmartV2(o) { if (!o) return ''; if (o.to_date && o.to_date.date) return o.to_date.date.substring(0, 10); if (o.date) return o.date.substring(0, 10); return typeof o==='string' ? o.substring(0, 10) : ''; }
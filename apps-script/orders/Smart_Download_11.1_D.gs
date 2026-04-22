/**
 * ════════════════════════════════════════════════════════════════
 * SCRIPT SMARTSUITE -> GOOGLE SHEETS (V11.1 - COMPATÍVEL ORQUESTRADOR V3)
 * 1. Return Count: Retorna total de linhas consolidadas.
 * 2. Lock: Proteção contra execução duplicada (LOCK_SYNC_COMPLETA).
 * 3. Base V11.0 mantida (Novo Campo: 'Posição adicional').
 * ════════════════════════════════════════════════════════════════
 */

const CONFIG = {
  BASE_URL: 'https://app.smartsuite.com/api/v1',
  ACCOUNT_ID: 'snm19hn6',
  TOKEN_PADRAO: 'b64bd1cca64432c1a36f1e5e861fa7fe0aea1320',
  TABLES: {
    AVULSOS: { ID: '679bd2d153f70a63197fde64', NOME: 'Smart_Avulsos' },
    PROJETOS: { ID: '696d3c3d35b1839e1b2a274f', NOME: 'Smart_Projetos_Ativos' }, 
    PCS: { ID: '679bd37761f688f6107fde60', NOME: 'Smart_PCs' }
  }
};

// ==========================================================================
// 1. MAPEAMENTO DE COLUNAS
// ==========================================================================
// ID do novo campo de texto
const ID_POSICAO = 'sb9bb1d2fe'; 

const ESTRUTURA_COLUNAS = {
  AVULSOS: [
    ['title', 'V.PV / OS'], 
    ['first_created', 'Criado pela primeira vez em'], 
    ['last_updated', 'Atualizado pela última vez'], 
    ['s6ebca6d00', 'V.Tipo_Omie'], 
    ['s8c48f1c4b', 'V.Projeto_Omie'], 
    ['s53aefb05c', 'V.Cliente_Omie'], 
    ['s0b49dd159', 'V.Previsão Limite_Omie'], 
    ['s626230a23', 'V.Valor_Omie'], 
    ['s9ee9213bb', 'V.Etapa Venda_Omie'], 
    ['s242fb18ba', 'V.Nova Previsão de Serviço'], 
    ['s4b87bk9', 'V.Nova Previsão de Materiais'], 
    ['s28f2347ed', 'V.Data de Faturamento'], 
    ['s03423faaf', 'V.NF saida'], 
    ['s3d4aaf144', 'RC.Numero'], 
    ['s66b865956', 'RC.Custo'], 
    ['s670dc5f17', 'PC.Numero'], 
    ['sad280e350', 'PC.Custo'], 
    ['scc1a2eacd', 'PC.Fornecedor'], 
    ['s4c2a39858', 'PC.Cond. Pagamento'], 
    ['scf0fb3a7a', 'PC.Prazo de entrega'], 
    ['sce8327bbb', 'PC.Aprovação'], 
    ['s96e0b892e', 'PC.Status'], 
    ['s8dfb4a40b', 'PC.Aprovado por:'], 
    ['s98eb6904f', 'PC.Data de Aprovação'], 
    ['scdff03d9d', 'PC.Valor Aprovado'], 
    ['sc91f74641', 'RC.Custo total'], 
    ['sjio0fft', 'PC.Custo total'],
    ['s7d92bld', 'MT.Status de Fornecimento'],
    ['s394a485bc', 'PC.Aprovar até:'],
    [ID_POSICAO, 'Posição adicional'] // NOVO CAMPO
  ],
  
  PROJETOS: [
    ['title', 'V.PV / OS'], 
    ['first_created', 'Criado pela primeira vez em'], 
    ['last_updated', 'Atualizado pela última vez'], 
    ['s8c48f1c4b', 'V.Projeto_Omie'], 
    ['s53aefb05c', 'V.Cliente_Omie'], 
    ['s0b49dd159', 'V.Previsão Limite_Omie'], 
    ['s626230a23', 'V.Valor_Omie'], 
    ['s9ee9213bb', 'V.Etapa Venda_Omie'], 
    ['s28f2347ed', 'V.Data de Faturamento'], 
    ['s03423faaf', 'V.NF saida'], 
    ['s3d4aaf144', 'RC.Numero'], 
    ['s66b865956', 'RC.Custo'], 
    ['s670dc5f17', 'PC.Numero'], 
    ['sad280e350', 'PC.Custo'], 
    ['scc1a2eacd', 'PC.Fornecedor'], 
    ['s4c2a39858', 'PC.Cond. Pagamento'], 
    ['scf0fb3a7a', 'PC.Prazo de entrega'], 
    ['sce8327bbb', 'PC.Aprovação'], 
    ['s96e0b892e', 'PC.Status'], 
    ['s8dfb4a40b', 'PC.Aprovado por:'], 
    ['s98eb6904f', 'PC.Data de Aprovação'], 
    ['scdff03d9d', 'PC.Valor Aprovado'], 
    ['sf13db4835', 'RC.Custo total'], 
    ['s19a6102e0', 'PC.Custo total'],
    ['s7d92bld', 'MT.Status de Fornecimento'],
    ['s394a485bc', 'PC.Aprovar até:'],
    [ID_POSICAO, 'Posição adicional'] // NOVO CAMPO
  ],
  
  PCS: [
    ['title', 'PC.Numero'], 
    ['sa3ba17aff', 'V.Projeto_Omie'], 
    ['sd7f83f00f', 'V.Cliente_Omie'], 
    ['s0b49dd159', 'V.Previsão Limite_Omie'], 
    ['sad280e350', 'PC.Custo'], 
    ['scc1a2eacd', 'PC.Fornecedor'], 
    ['s58ad3b921', 'PC.Cond. Pagamento'], 
    ['sce8327bbb', 'PC.Aprovação'], 
    ['sc8d058bcc', 'PC.Status'], 
    ['s8dfb4a40b', 'PC.Aprovado por:'], 
    ['s98eb6904f', 'PC.Data de Aprovação'], 
    ['s0efb96120', 'PC.Valor Aprovado'],
    ['ssc40d1040b', 'MT.Status de Fornecimento']
  ]
};

const HEADERS_CONSOLIDADO = [
  'V.PV / OS', 'Criado pela primeira vez em', 'Atualizado pela última vez', 'V.Tipo_Omie', 
  'V.Projeto_Omie', 'V.Cliente_Omie', 'V.Previsão Limite_Omie', 'V.Valor_Omie', 'V.Etapa Venda_Omie', 
  'V.Nova Previsão de Serviço', 'V.Nova Previsão de Materiais', 'V.Data de Faturamento', 'V.NF saida', 
  'RC.Numero', 'RC.Custo', 'PC.Numero', 'PC.Custo', 'PC.Fornecedor', 
  'PC.Cond. Pagamento', 'PC.Prazo de entrega', 'PC.Aprovação', 'PC.Status', 'PC.Aprovado por:', 
  'PC.Data de Aprovação', 'PC.Valor Aprovado', 'RC.Custo total', 'PC.Custo total', 'Fonte',
  'MT.Status de Fornecimento',
  'PC.Aprovar até:',
  'Posição adicional' // ÚLTIMA COLUNA
];

function executarSincronizacaoEConsolidacaoCompleta() {
  const t0 = new Date();
  const props = PropertiesService.getScriptProperties();
  
  // 🆕 CONTADOR
  let totalConsolidado = 0;

  // Proteção de Lock
  if (props.getProperty('LOCK_SYNC_COMPLETA') === 'TRUE') {
    console.log('⚠️ Sincronização Completa já está rodando. Ignorando chamada.');
    return 0;
  }

  try {
    props.setProperty('LOCK_SYNC_COMPLETA', 'TRUE');
    
    console.log("🚀 INICIANDO V11.1 (COM POSIÇÃO ADICIONAL)");
    props.setProperty('SMARTSUITE_API_TOKEN', CONFIG.TOKEN_PADRAO);
    PREPARAR_CABECALHOS();

    const chaves = Object.keys(CONFIG.TABLES);
    for (let i = 0; i < chaves.length; i++) {
      const key = chaves[i];
      try {
        console.log(`\n[${i + 1}/4] SINCRONIZANDO: ${CONFIG.TABLES[key].NOME}`);
        const qtd = sincronizarPorSlugs(CONFIG.TABLES[key], ESTRUTURA_COLUNAS[key]);
        console.log(`   ✅ Sincronizado: ${qtd} linhas`);
        SpreadsheetApp.flush(); 
        Utilities.sleep(1500); 
      } catch (e) { console.error(`   ❌ ERRO: ${e.message}`); }
    }

    console.log("\n[4/4] GERANDO CONSOLIDADO...");
    totalConsolidado = gerarConsolidado();
    
    console.log(`   ✅ SUCESSO FINAL: ${totalConsolidado} linhas consolidadas.`);
    console.log(`🏁 FIM TOTAL (${((new Date() - t0)/1000).toFixed(1)}s)`);

  } catch (e) {
    console.error(`❌ Erro Geral Sync Completa: ${e.message}`);
    // Retorna 0 para o orquestrador saber que falhou
    totalConsolidado = 0;
  } finally {
    props.deleteProperty('LOCK_SYNC_COMPLETA');
  }

  // 🆕 RETORNO OBRIGATÓRIO PARA O ORQUESTRADOR
  return totalConsolidado;
}

function normalizeValue(val, slug, statusMap, fullRecord) {
  if (slug === 'first_created' || slug === 'last_updated') {
    if (val && val.on) return formatarDataString(val.on);
    if (slug === 'first_created' && fullRecord.created_on) return formatarDataString(fullRecord.created_on);
    if (slug === 'last_updated' && fullRecord.updated_on) return formatarDataString(fullRecord.updated_on);
    return '';
  }
  if (val === null || val === undefined) return '';

  function extrairProfundo(obj) {
    if (obj === null || obj === undefined) return '';
    if (typeof obj !== 'object') return obj; 
    if ('date' in obj) return obj.date ? formatarDataString(obj.date) : '';
    if (obj.from_date && obj.from_date.date) return formatarDataString(obj.from_date.date);
    if (obj.to_date && obj.to_date.date) return formatarDataString(obj.to_date.date);
    if (obj.full_name && typeof obj.full_name === 'object' && obj.full_name.sys_root) return obj.full_name.sys_root;
    if (obj.full_name && typeof obj.full_name === 'string') return obj.full_name;
    if (obj.first_name) return `${obj.first_name} ${obj.last_name || ''}`.trim();
    if (obj.name) return obj.name;
    if (obj.email) return obj.email;
    if (obj.title) return obj.title;
    if (obj.label) return obj.label;
    if (obj.value !== undefined) return (typeof obj.value === 'object') ? extrairProfundo(obj.value) : obj.value;
    const valores = Object.values(obj);
    for (const v of valores) { if (typeof v === 'string' && v.length > 0) return v; }
    return ''; 
  }

  if (Array.isArray(val)) {
    const itens = val.map(v => extrairProfundo(v)).filter(v => v !== '');
    return [...new Set(itens)].join(', ');
  }
  
  let finalVal = extrairProfundo(val);
  if (statusMap[slug] && statusMap[slug][finalVal]) finalVal = statusMap[slug][finalVal];
  if (typeof finalVal === 'string' && /^-?\d+(\.\d+)?$/.test(finalVal)) return parseFloat(finalVal);
  return finalVal;
}

function formatarDataString(dataIso) {
  if (!dataIso || typeof dataIso !== 'string') return '';
  const partes = dataIso.split('T')[0].split('-');
  if (partes.length === 3) return `${partes[2]}/${partes[1]}/${partes[0]}`;
  return '';
}

function PREPARAR_CABECALHOS() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(CONFIG.TABLES).forEach(key => {
    const info = CONFIG.TABLES[key];
    const map = ESTRUTURA_COLUNAS[key];
    const headers = map.map(m => m[1]); 
    let sheet = ss.getSheetByName(info.NOME);
    if (!sheet) sheet = ss.insertSheet(info.NOME);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold').setBackground('#4285f4').setFontColor('#ffffff');
  });
  let sheetCons = ss.getSheetByName('Smart_Consolidada');
  if (!sheetCons) sheetCons = ss.insertSheet('Smart_Consolidada');
  sheetCons.getRange(1, 1, 1, HEADERS_CONSOLIDADO.length).setValues([HEADERS_CONSOLIDADO]).setFontWeight('bold').setBackground('#34a853').setFontColor('#ffffff');
  SpreadsheetApp.flush();
}

function sincronizarPorSlugs(tabInfo, mapeamento) {
  const tInicio = new Date();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(tabInfo.NOME);
  const meta = fetchTableFields(tabInfo.ID);
  const data = fetchAllRecords(tabInfo.ID);
  const slugs = mapeamento.map(m => m[0]);
  
  const rows = data.map(rec => {
    return slugs.map(slug => normalizeValue(rec[slug], slug, meta.statusOptionMap, rec));
  });

  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getMaxRows() - 1, mapeamento.length).clearContent();
    SpreadsheetApp.flush(); 
  }

  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
    SpreadsheetApp.flush(); 
    try { aplicarFormatacaoFina(sheet, slugs, mapeamento); } catch(e) {}
  }
  
  const duracao = ((new Date() - tInicio) / 1000).toFixed(0) + 's';
  marcarStatusFinal(sheet, "SUCESSO", rows.length, duracao);
  return rows.length;
}

function gerarConsolidado() {
  const tInicio = new Date();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheetCons = ss.getSheetByName('Smart_Consolidada');
  const finalData = [];
  
  ['AVULSOS', 'PROJETOS', 'PCS'].forEach(key => {
    const sh = ss.getSheetByName(CONFIG.TABLES[key].NOME);
    if (!sh || sh.getLastRow() < 2) return;
    
    const values = sh.getDataRange().getValues();
    const headersIndividuais = values[0];
    const idxMap = {};
    headersIndividuais.forEach((h, i) => {
      const chaveLimpa = String(h).toLowerCase().replace(/\s+/g, '').trim();
      idxMap[chaveLimpa] = i;
    });
    
    for (let i = 1; i < values.length; i++) {
      finalData.push(HEADERS_CONSOLIDADO.map(h => {
        if (h === 'Fonte') return key;
        const alvoLimpo = String(h).toLowerCase().replace(/\s+/g, '').trim();
        const indexNaAba = idxMap[alvoLimpo];
        return (indexNaAba !== undefined) ? values[i][indexNaAba] : '';
      }));
    }
  });

  if (sheetCons.getLastRow() > 1) {
    sheetCons.getRange(2, 1, sheetCons.getMaxRows() - 1, HEADERS_CONSOLIDADO.length).clearContent();
    SpreadsheetApp.flush();
  }

  if (finalData.length > 0) {
    sheetCons.getRange(2, 1, finalData.length, HEADERS_CONSOLIDADO.length).setValues(finalData);
    SpreadsheetApp.flush();
    try { aplicarFormatacaoFina(sheetCons, HEADERS_CONSOLIDADO.map(()=>''), HEADERS_CONSOLIDADO.map(h=>['',h])); } catch (e) {}
  }
  
  const duracao = ((new Date() - tInicio) / 1000).toFixed(0) + 's';
  marcarStatusFinal(sheetCons, "SUCESSO", finalData.length, duracao);
  return finalData.length;
}

function aplicarFormatacaoFina(sheet, slugs, mapeamento) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const colunasReais = sheet.getLastColumn();
  for (let i = 0; i < colunasReais; i++) {
     const valHeader = sheet.getRange(1, i+1).getValue();
     const nome = String(valHeader);
     const range = sheet.getRange(2, i + 1, lastRow - 1, 1);
     if ((nome.includes('Valor') || nome.includes('Custo')) && !nome.includes('Numero')) range.setNumberFormat('#,##0.00');
     else if (nome.includes('Data') || nome.includes('em') || nome.includes('até:')) range.setNumberFormat('@');
     else range.setNumberFormat('@');
  }
}

function fetchTableFields(tableId) {
  const resp = UrlFetchApp.fetch(`${CONFIG.BASE_URL}/applications/${tableId}`, { method: 'get', headers: { 'Authorization': `Token ${CONFIG.TOKEN_PADRAO}`, 'Account-Id': CONFIG.ACCOUNT_ID } });
  const obj = JSON.parse(resp.getContentText());
  let statusOptionMap = {};
  if (obj.structure) {
    obj.structure.forEach(c => {
      const opts = c.options || c.choices;
      if (opts) {
        statusOptionMap[c.slug] = {};
        opts.forEach(o => statusOptionMap[c.slug][o.id || o.value] = o.label || o.value);
      }
    });
  }
  return { statusOptionMap };
}

function fetchAllRecords(tableId) {
  let all = [], offset = 0, total = 1;
  while (all.length < total) {
    const opts = { method: 'post', headers: { 'Authorization': `Token ${CONFIG.TOKEN_PADRAO}`, 'Account-Id': CONFIG.ACCOUNT_ID, 'Content-Type': 'application/json' }, payload: JSON.stringify({ offset, limit: 500, hydrated: true }), muteHttpExceptions: true };
    const resp = JSON.parse(UrlFetchApp.fetch(`${CONFIG.BASE_URL}/applications/${tableId}/records/list/`, opts).getContentText());
    all.push(...resp.items);
    total = resp.total;
    offset += 500;
    console.log(`      ⬇️ Lote: ${all.length}/${total}`);
    Utilities.sleep(500); 
  }
  return all;
}

function marcarStatusFinal(sheet, st, qt, duracao) {
  const agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM HH:mm');
  const mensagem = `✅ ${st} | ${agora} | ${qt} reg | ${duracao} | Obs: Carga concluída`;
  sheet.getRange('AZ1').setValue(mensagem).setBackground('#d9ead3').setFontWeight('bold');
}
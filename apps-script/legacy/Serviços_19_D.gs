/**
 * ════════════════════════════════════════════════════════════════
 * SCRIPT SYNC: PROJETOS (MULTI-REGISTROS)
 * VERSÃO: 2.0 - ATUALIZA DUPLICADOS
 * ════════════════════════════════════════════════════════════════
 */

const CONFIG_PROJ = {
  BASE_URL: 'https://app.smartsuite.com/api/v1',
  ACCOUNT_ID: 'snm19hn6',
  TABLE_ID: '679bd2ed42367e0b273b4374', 
  API_TOKEN: 'b64bd1cca64432c1a36f1e5e861fa7fe0aea1320',
  
  NOME_ABA: 'Consolidação_PV_OS',
  
  FIELDS: {
    TITLE: 'title',               
    VALOR: 's626230a23',          
    PREVISAO: 's0b49dd159',       
    CLIENTE: 'selpz0jh',          
    DT_FAT: 's3213d1e4f',         
    ETAPA: 's720ba30c0',          
    NF_SAIDA: 'sdde4e3858',       
    PROJETO: 's768050894'         
  },
  
  COLS: {
    VALOR: 2,       // C 
    PREVISAO: 4,    // E 
    COD_PVOS: 5,    // F 
    CLIENTE: 6,     // G 
    DT_FAT: 7,      // H 
    PROJETO: 8,     // I 
    ETAPA: 10,      // K 
    NF_SAIDA: 11    // L 
  }
};

const MAPA_ETAPA_PROJ = {
  'AGENDADO PARA': 'dc487211-51c1-4de6-b3e0-62bdf3e7ac72',
  'COMPRAS APROVADAS': 'e2b32dc3-7bff-4dae-a5e9-441ee8f8c0a8',
  'ENTREGA': '6fd00e36-831a-4c27-a214-9430b787a84f',
  'FATURADO': 'c7407ec5-c11c-4204-a819-ac8b92be42d6',
  'FATURAR': 'cba4c027-133c-478c-ab25-4249076f4d4b',
  'ORDEM DE SERVIÇO': '24e9e4e8-2d3b-4a93-9234-cabadee2fbf9',
  'PROPOSTA': '0f93155c-5be7-40b3-898e-cf4c0df8fe80',
  'SOLICITAÇÃO DE COMPRA': 'dca9b93c-14ad-44f6-91b6-d3ccbae04e1f',
  'ORDEM DE SERVICO': '24e9e4e8-2d3b-4a93-9234-cabadee2fbf9',
  'SOLICITACAO DE COMPRA': 'dca9b93c-14ad-44f6-91b6-d3ccbae04e1f',
  'SOLICITACAO COMPRA': 'dca9b93c-14ad-44f6-91b6-d3ccbae04e1f',
  'PEDIDO DE VENDA': 'dca9b93c-14ad-44f6-91b6-d3ccbae04e1f'
};

// ========================================
// FUNÇÃO PRINCIPAL
// ========================================

function sincronizarTabelaProjetos() {
  const hInicio = new Date();
  Logger.log('🚀 INICIANDO SYNC PROJETOS (MULTI-REGISTROS)...');
  
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PROJ.NOME_ABA);
  if (!sheet) { Logger.log('❌ Aba não encontrada'); return; }
  const dados = sheet.getDataRange().getValues();
  
  // 🔍 AQUI MUDOU: O Mapa agora guarda LISTAS de registros
  const mapaSmart = buscarSmartSuiteProjetos();
  
  let atualizados = 0;
  
  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const chave = String(linha[CONFIG_PROJ.COLS.COD_PVOS] || '').trim();
    
    // Se não existir essa chave no mapa, pula
    if (!chave || !mapaSmart[chave]) continue;
    
    // 🔄 AQUI MUDOU: Pegamos a LISTA de destinos e rodamos o loop para cada um
    const listaDestinos = mapaSmart[chave];
    
    listaDestinos.forEach(destino => {
      const payload = {};
      let mudou = false;

      // 1. VALOR
      const valorOrigem = parseFloat(linha[CONFIG_PROJ.COLS.VALOR]);
      const valorDestino = destino.valor ? parseFloat(destino.valor) : 0;
      if (!isNaN(valorOrigem) && Math.abs(valorOrigem - valorDestino) > 0.01) {
        payload[CONFIG_PROJ.FIELDS.VALOR] = valorOrigem;
        mudou = true;
      }

      // 2. PREVISÃO
      const prevOrigem = formatarDataISO(linha[CONFIG_PROJ.COLS.PREVISAO]);
      const prevDestino = formatarDataSmart(destino.previsao);
      if (prevOrigem && prevOrigem !== prevDestino) {
        payload[CONFIG_PROJ.FIELDS.PREVISAO] = { "to_date": { "date": prevOrigem + 'T00:00:00Z', "include_time": false }, "from_date": null };
        mudou = true;
      }

      // 3. DATA FATURAMENTO
      const fatOrigem = formatarDataISO(linha[CONFIG_PROJ.COLS.DT_FAT]);
      const fatDestino = formatarDataSmart(destino.dtFat);
      if (fatOrigem && fatOrigem !== fatDestino) {
        payload[CONFIG_PROJ.FIELDS.DT_FAT] = { "date": fatOrigem + 'T00:00:00Z', "include_time": false };
        mudou = true;
      }

      // 4. NF SAÍDA
      const nfOrigem = linha[CONFIG_PROJ.COLS.NF_SAIDA];
      const nfDestino = destino.nfSaida;
      if (String(nfOrigem) !== '' && String(nfOrigem) !== String(nfDestino || '')) {
        payload[CONFIG_PROJ.FIELDS.NF_SAIDA] = nfOrigem;
        mudou = true;
      }

      // 5. CLIENTE
      const clienteTexto = String(linha[CONFIG_PROJ.COLS.CLIENTE] || '').trim();
      const clienteSmart = String(destino.cliente || '').trim();
      if (clienteTexto !== clienteSmart) {
        payload[CONFIG_PROJ.FIELDS.CLIENTE] = clienteTexto;
        mudou = true;
      }

      // 6. PROJETO
      const projTexto = String(linha[CONFIG_PROJ.COLS.PROJETO] || '').trim();
      const projSmart = String(destino.projeto || '').trim();
      if (projTexto !== projSmart) {
        payload[CONFIG_PROJ.FIELDS.PROJETO] = projTexto;
        mudou = true;
      }

      // 7. ETAPA
      const etapaTexto = String(linha[CONFIG_PROJ.COLS.ETAPA] || '').toUpperCase().trim();
      const idEtapa = MAPA_ETAPA_PROJ[etapaTexto];
      let idDestinoEtapa = '';
      if (Array.isArray(destino.etapa) && destino.etapa.length > 0) idDestinoEtapa = destino.etapa[0];
      else if (typeof destino.etapa === 'string') idDestinoEtapa = destino.etapa;
      
      if (idEtapa && idEtapa !== idDestinoEtapa) {
        payload[CONFIG_PROJ.FIELDS.ETAPA] = idEtapa;
        mudou = true;
      }

      if (mudou) {
        enviarUpdateProj(destino.sysId, payload);
        atualizados++;
        Logger.log('✅ Atualizado: ' + chave + ' (ID: ' + destino.sysId + ')');
      }
    });
  }
  
  const hFim = new Date();
  const tempo = Math.round((hFim.getTime() - hInicio.getTime()) / 1000);
  Logger.log('🏁 FIM. Atualizações enviadas: ' + atualizados + ' | Tempo: ' + tempo + 's');
  SpreadsheetApp.getActiveSpreadsheet().toast('Sync Concluído. Itens atualizados: ' + atualizados);
}

// --- AUXILIARES ---

function buscarSmartSuiteProjetos() {
  const url = CONFIG_PROJ.BASE_URL + '/applications/' + CONFIG_PROJ.TABLE_ID + '/records/list/';
  try {
    const res = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { 'Authorization': 'Token ' + CONFIG_PROJ.API_TOKEN, 'Account-Id': CONFIG_PROJ.ACCOUNT_ID, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ offset: 0, limit: 2000 })
    });
    
    const items = JSON.parse(res.getContentText()).items || [];
    const mapa = {};
    
    items.forEach(r => {
      // Se não existe a lista para esse título, cria
      if (!mapa[r.title]) {
        mapa[r.title] = [];
      }
      
      // Adiciona o registro na lista (Array)
      mapa[r.title].push({
        sysId: r.id,
        valor: r[CONFIG_PROJ.FIELDS.VALOR],
        previsao: r[CONFIG_PROJ.FIELDS.PREVISAO],
        cliente: r[CONFIG_PROJ.FIELDS.CLIENTE],
        dtFat: r[CONFIG_PROJ.FIELDS.DT_FAT],
        etapa: r[CONFIG_PROJ.FIELDS.ETAPA],
        nfSaida: r[CONFIG_PROJ.FIELDS.NF_SAIDA],
        projeto: r[CONFIG_PROJ.FIELDS.PROJETO]
      });
    });
    return mapa;
  } catch (e) { Logger.log('Erro busca: ' + e); return {}; }
}

function enviarUpdateProj(id, payload) {
  const url = CONFIG_PROJ.BASE_URL + '/applications/' + CONFIG_PROJ.TABLE_ID + '/records/' + id + '/';
  try {
    UrlFetchApp.fetch(url, {
      method: 'patch',
      headers: { 'Authorization': 'Token ' + CONFIG_PROJ.API_TOKEN, 'Account-Id': CONFIG_PROJ.ACCOUNT_ID, 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload)
    });
  } catch (e) { Logger.log('Erro update: ' + e); }
}

function formatarDataISO(valor) {
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  return '';
}

function formatarDataSmart(campo) {
  if (!campo) return '';
  if (campo.to_date && campo.to_date.date) return campo.to_date.date.substring(0, 10);
  if (campo.date) return campo.date.substring(0, 10);
  if (typeof campo === 'string') return campo.substring(0, 10);
  return '';
}
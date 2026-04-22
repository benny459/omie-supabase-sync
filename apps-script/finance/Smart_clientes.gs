/**
 * ════════════════════════════════════════════════════════════════
 * SCRIPT: SYNC CLIENTES V4.0 (TURBO - BATCH REQUESTS)
 * OBJETIVO: Alta performance usando fetchAll (Processamento em Lotes)
 * ════════════════════════════════════════════════════════════════
 */

const CONFIG_CLIENTES = {
  BASE_URL: 'https://app.smartsuite.com/api/v1',
  ACCOUNT_ID: 'snm19hn6',
  TABLE_ID: '697798af32401aadbe51a97f', 
  API_TOKEN: 'b64bd1cca64432c1a36f1e5e861fa7fe0aea1320',
  BATCH_SIZE: 30 // Envia 30 requisições simultâneas (Seguro e Rápido)
};

const MAPA_CLIENTES = {
  NOME_ABA: 'Clientes',
  FIELDS: { CHAVE_BUSCA: 'title', CAMPO_AD: 's93dd1c7f8' },
  COLS: { COL_E: 4, COL_AD: 29 }
};

function sincronizarClientes() {
  const hInicio = new Date();
  Logger.log('🚀 INICIANDO SYNC V4.0 (TURBO)');

  // 1. LEITURA RÁPIDA (Memória)
  const dadosPlanilha = lerPlanilhaClientes();
  const dadosSmart = buscarSmartSuiteClientes();
  const chaves = Object.keys(dadosPlanilha);

  if (chaves.length === 0) { Logger.log('⚠️ Planilha vazia.'); return; }
  Logger.log(`📂 Analisando ${chaves.length} clientes na memória...`);

  // 2. PREPARAR A FILA (Sem chamadas de API aqui)
  const filaUpdates = [];
  const filaCreates = [];
  let ignorados = 0;

  chaves.forEach(chave => {
    const origem = dadosPlanilha[chave];
    const destino = dadosSmart[chave];

    if (destino) {
      // Comparação rápida
      if (normalizarTexto(origem.valorAD) !== normalizarTexto(destino.valorAD)) {
        // Adiciona à fila de UPDATE
        filaUpdates.push({
          id: destino.systemId,
          nome: origem.nomeReal,
          payload: { [MAPA_CLIENTES.FIELDS.CAMPO_AD]: origem.valorAD }
        });
      } else {
        ignorados++;
      }
    } else {
      // Adiciona à fila de CREATE
      filaCreates.push({
        nome: origem.nomeReal,
        payload: {
          'title': origem.nomeReal,
          [MAPA_CLIENTES.FIELDS.CAMPO_AD]: origem.valorAD
        }
      });
    }
  });

  Logger.log(`📊 ANÁLISE CONCLUÍDA:`);
  Logger.log(`   ✅ Iguais (Ignorados): ${ignorados}`);
  Logger.log(`   🔄 Updates necessários: ${filaUpdates.length}`);
  Logger.log(`   ✨ Novos a criar: ${filaCreates.length}`);

  // 3. EXECUTAR EM LOTES (O Pulo do Gato)
  let totalUpd = 0;
  let totalNew = 0;

  if (filaUpdates.length > 0) {
    totalUpd = processarLotes(filaUpdates, 'PATCH');
  }

  if (filaCreates.length > 0) {
    totalNew = processarLotes(filaCreates, 'POST');
  }

  const hFim = new Date();
  const tempo = ((hFim.getTime() - hInicio.getTime()) / 1000).toFixed(1);
  Logger.log(`🏁 FIM: ${tempo}s total.`);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(`Sync: ${totalUpd} Upd, ${totalNew} New`, 'Concluído'); } catch(e){}
}

// ========================================
// MOTOR TURBO (UrlFetchApp.fetchAll)
// ========================================

function processarLotes(listaItens, metodo) {
  Logger.log(`⚙️ Iniciando processamento ${metodo} de ${listaItens.length} itens...`);
  let sucessos = 0;
  
  // Divide a lista em blocos (chunks)
  for (let i = 0; i < listaItens.length; i += CONFIG_CLIENTES.BATCH_SIZE) {
    const lote = listaItens.slice(i, i + CONFIG_CLIENTES.BATCH_SIZE);
    const requisicoes = [];

    // Monta as requisições do lote
    lote.forEach(item => {
      let url = `${CONFIG_CLIENTES.BASE_URL}/applications/${CONFIG_CLIENTES.TABLE_ID}/records/`;
      if (metodo === 'PATCH') url += `${item.id}/`;

      requisicoes.push({
        url: url,
        method: metodo,
        headers: { 
          'Authorization': 'Token ' + CONFIG_CLIENTES.API_TOKEN, 
          'Content-Type': 'application/json', 
          'Account-Id': CONFIG_CLIENTES.ACCOUNT_ID 
        },
        payload: JSON.stringify(item.payload),
        muteHttpExceptions: true
      });
    });

    // DISPARA O LOTE PARALELO (Aqui está a velocidade)
    try {
      const respostas = UrlFetchApp.fetchAll(requisicoes);
      
      respostas.forEach((res, idx) => {
        if (res.getResponseCode() < 300) {
          sucessos++;
        } else {
          Logger.log(`❌ Erro em "${lote[idx].nome}": ${res.getContentText()}`);
        }
      });
      
      Logger.log(`   COMBIO: Processados ${Math.min(i + CONFIG_CLIENTES.BATCH_SIZE, listaItens.length)}/${listaItens.length}`);
      
      // Pequena pausa entre lotes para não estourar limite da API (Rate Limit)
      Utilities.sleep(500); 

    } catch (e) {
      Logger.log(`❌ Erro Crítico no Lote ${i}: ` + e.message);
    }
  }
  return sucessos;
}

// ========================================
// LEITURA E HELPERS (IGUAL AO ANTERIOR)
// ========================================

function lerPlanilhaClientes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MAPA_CLIENTES.NOME_ABA);
  if (!sheet) return {};
  const dados = sheet.getDataRange().getValues();
  const mapa = {};
  for (let i = 1; i < dados.length; i++) {
    const nomeReal = String(dados[i][MAPA_CLIENTES.COLS.COL_E] || '').trim();
    if (nomeReal) {
      const chave = gerarChaveBusca(nomeReal);
      if (!mapa[chave]) {
        mapa[chave] = { nomeReal: nomeReal, valorAD: String(dados[i][MAPA_CLIENTES.COLS.COL_AD] || '') };
      }
    }
  }
  return mapa;
}

function buscarSmartSuiteClientes() {
  const mapa = {};
  // Nota: Se tiver mais de 5.000 clientes, precisará de paginação. 
  // Para 3.500 funciona direto.
  const url = `${CONFIG_CLIENTES.BASE_URL}/applications/${CONFIG_CLIENTES.TABLE_ID}/records/list/`;
  try {
    const response = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: { 'Authorization': 'Token ' + CONFIG_CLIENTES.API_TOKEN, 'Content-Type': 'application/json', 'Account-Id': CONFIG_CLIENTES.ACCOUNT_ID },
      payload: JSON.stringify({ offset: 0, limit: 5000 }),
      muteHttpExceptions: true
    });
    const items = JSON.parse(response.getContentText()).items || [];
    items.forEach(r => {
      const nomeReal = String(r.title || '').trim();
      if (nomeReal) {
        mapa[gerarChaveBusca(nomeReal)] = { systemId: r.id, valorAD: String(r[MAPA_CLIENTES.FIELDS.CAMPO_AD] || '') };
      }
    });
  } catch (e) { Logger.log('❌ Erro busca Smart: ' + e.message); }
  return mapa;
}

function gerarChaveBusca(txt) { return txt ? String(txt).replace(/&amp;/g, '&').trim().toUpperCase() : ""; }
function normalizarTexto(val) { return val ? String(val).trim().toUpperCase() : ""; }
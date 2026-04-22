// ════════════════════════════════════════════════════════════════════════════
// 🔬 DEBUG — tenta inserir PV no SmartSuite e mostra resposta EXATA da API
// Rode `debugTentarInserirPV('PV1712')` (troque o PV se quiser)
// ════════════════════════════════════════════════════════════════════════════

function debugTentarInserirPV_PV1712() { return debugTentarInserirPV('PV1712'); }
function debugTentarInserirPV_PV1713() { return debugTentarInserirPV('PV1713'); }
function debugTentarInserirPV_PV1714() { return debugTentarInserirPV('PV1714'); }
function debugTentarInserirPV_PV1715() { return debugTentarInserirPV('PV1715'); }

function debugTentarInserirPV(alvo) {
  Logger.log('🔬 Tentando inserir ' + alvo + ' no SmartSuite com logs verbosos');
  Logger.log('═══════════════════════════════════════════════════════════');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_IMPORTACAO.NOME_ABA);
  const dados = sheet.getDataRange().getValues();

  // Acha o PV
  let cand = null;
  for (let i = 1; i < dados.length; i++) {
    const cod = String(dados[i][CONFIG_IMPORTACAO.COLUNAS_SHEETS.COD_PVOS] || '').trim().toUpperCase();
    if (cod !== alvo.toUpperCase()) continue;

    const linha = dados[i];
    cand = {
      title: cod,
      projeto: String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.PROJETO] || '').trim().toUpperCase(),
      cliente: String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CLIENTE] || '').trim().toUpperCase(),
      previsao: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.PREVISAO],
      valor: parseFloat(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.VALOR_TOTAL]) || 0,
      etapaVenda: String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.ETAPA_VENDA] || '').trim(),
      tipoVenda: String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.TIPO_VENDA] || '').trim(),
      campoDataH: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CAMPO_DATA_H],
      campoL: String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CAMPO_L] || '').trim().toUpperCase(),
      dataEmissao: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.DATA_EMISSAO]
    };
    break;
  }

  if (!cand) { Logger.log('❌ ' + alvo + ' não achado na planilha'); return; }

  Logger.log('📄 Dados do candidato:');
  Logger.log(JSON.stringify(cand, null, 2));
  Logger.log('');

  // Monta payload EXATAMENTE como o script faz em inserirNovos
  const payload = {};
  payload[CONFIG_IMPORTACAO.CAMPOS.TITLE] = cand.title;
  payload[CONFIG_IMPORTACAO.CAMPOS.PROJETO_TEXTO] = cand.projeto;
  payload[CONFIG_IMPORTACAO.CAMPOS.CLIENTE] = cand.cliente;
  payload[CONFIG_IMPORTACAO.CAMPOS.VALOR] = cand.valor;

  // Datas com wrapper "to_date" (previsão)
  const dataPrev = _toIso_(cand.previsao);
  if (dataPrev) payload[CONFIG_IMPORTACAO.CAMPOS.PREVISAO] = {
    "to_date": { "date": dataPrev + 'T00:00:00Z', "include_time": false }
  };

  // Data emissão (formato diferente - só "date" direto)
  const dataEmissao = _toIso_(cand.dataEmissao);
  if (dataEmissao) payload[CONFIG_IMPORTACAO.CAMPOS.DT_EMISSAO] = {
    "date": dataEmissao + 'T00:00:00Z', "include_time": false
  };

  // Etapa e Tipo de Venda (mapeamento pra IDs)
  const etapaKey = cand.etapaVenda.toLowerCase();
  const tipoKey  = cand.tipoVenda.toLowerCase();
  if (MAPEAMENTO_ETAPA_VENDA[etapaKey]) payload[CONFIG_IMPORTACAO.CAMPOS.ETAPA_VENDA] = MAPEAMENTO_ETAPA_VENDA[etapaKey];
  if (MAPEAMENTO_TIPO_VENDA[tipoKey])   payload[CONFIG_IMPORTACAO.CAMPOS.TIPO_VENDA]  = MAPEAMENTO_TIPO_VENDA[tipoKey];

  Logger.log('📤 Payload que será enviado pra API:');
  Logger.log(JSON.stringify(payload, null, 2));
  Logger.log('');

  // POST verboso
  const url = CONFIG_IMPORTACAO.BASE_URL + '/applications/' + CONFIG_IMPORTACAO.TABLE_ID + '/records/';
  Logger.log('🌐 POST → ' + url);
  Logger.log('');

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'Authorization': 'Token ' + CONFIG_IMPORTACAO.API_TOKEN,
      'Account-Id': CONFIG_IMPORTACAO.ACCOUNT_ID,
      'Content-Type': 'application/json'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  const body = res.getContentText();

  Logger.log('📥 RESPOSTA DA API:');
  Logger.log('   HTTP: ' + code);
  Logger.log('   Body: ' + body.substring(0, 1500));
  Logger.log('');

  if (code >= 200 && code < 300) {
    Logger.log('✅ SUCESSO! O PV foi criado no SmartSuite agora.');
    Logger.log('   Verifique o app Sales Avulsos pra confirmar.');
  } else {
    Logger.log('❌ FALHA na criação. Analise o body acima pra entender o motivo.');
    Logger.log('   Erros comuns:');
    Logger.log('   • 400: payload inválido (campo obrigatório faltando, valor mal formatado)');
    Logger.log('   • 401: token expirado');
    Logger.log('   • 403: sem permissão');
    Logger.log('   • 429: rate limit');
    Logger.log('   • 500: erro interno SmartSuite');
  }
}

function _toIso_(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return Utilities.formatDate(valor, 'America/Sao_Paulo', 'yyyy-MM-dd');
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
}

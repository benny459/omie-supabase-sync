// ════════════════════════════════════════════════════════════════════════════
// 🔬 DEBUG DATAS v2 — pega candidatos que EXISTEM nos dois lados
// ════════════════════════════════════════════════════════════════════════════

function debugComparacaoDatas() {
  Logger.log('🔬 DEBUG v2 — comparando datas Sheet vs SmartSuite');
  Logger.log('═══════════════════════════════════════════════');

  // 1) Busca TODOS do Smart
  var smart = buscarTodosRegistrosSmartSuite();
  var mapa = {};
  smart.forEach(function(r) { if (!mapa[r.title]) mapa[r.title] = r; });
  Logger.log('📦 Registros no Smart: ' + smart.length);

  // 2) Pega candidatos da planilha que TAMBÉM EXISTEM no Smart
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_IMPORTACAO.NOME_ABA);
  var dados = sheet.getDataRange().getValues();
  var amostras = [];
  // Pega especificamente PV1706, PV1704, PV1537 (vi no log que estavam atualizando)
  var alvos = ['PV1706', 'PV1704', 'PV1537', 'OS4097', 'OS3907'];

  for (var i = 1; i < dados.length && amostras.length < 5; i++) {
    var linha = dados[i];
    var cod = String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.COD_PVOS] || '').trim().toUpperCase();
    if (alvos.indexOf(cod) >= 0 && mapa[cod]) {
      amostras.push({
        title: cod,
        prev: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.PREVISAO],
        dataH: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CAMPO_DATA_H],
        dataEmissao: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.DATA_EMISSAO]
      });
    }
  }

  // Fallback: se nenhum dos alvos existe, pega 3 quaisquer que estejam nos dois
  if (amostras.length === 0) {
    Logger.log('⚠️ Nenhum dos alvos encontrado, pegando 3 aleatórios que existem nos 2 lados');
    for (var i = 1; i < dados.length && amostras.length < 3; i++) {
      var linha = dados[i];
      var cod = String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.COD_PVOS] || '').trim().toUpperCase();
      var proj = String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.PROJETO] || '').trim().toUpperCase();
      if (cod && mapa[cod] && CONFIG_IMPORTACAO.PROJETOS_PERMITIDOS.indexOf(proj) >= 0) {
        amostras.push({
          title: cod,
          prev: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.PREVISAO],
          dataH: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CAMPO_DATA_H],
          dataEmissao: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.DATA_EMISSAO]
        });
      }
    }
  }

  Logger.log('📄 Analisando: ' + amostras.map(function(a){return a.title;}).join(', '));
  Logger.log('');

  // 3) Compara lado a lado — mostra o que vem CRU da API Smart
  amostras.forEach(function(a) {
    var s = mapa[a.title];
    Logger.log('─── ' + a.title + ' ───');

    // BUSCA RAW do Smart (antes do processamento)
    var rawSmart = buscarRawSmart(a.title);

    ['prev', 'dataH', 'dataEmissao'].forEach(function(campo) {
      var smartField = campo === 'prev' ? 'previsao'
                     : campo === 'dataH' ? 'campoDataH'
                     : 'dataEmissaoSmart';
      var rawSmartField = campo === 'prev' ? CONFIG_IMPORTACAO.CAMPOS.PREVISAO
                        : campo === 'dataH' ? CONFIG_IMPORTACAO.CAMPOS.CAMPO_DATA_H
                        : CONFIG_IMPORTACAO.CAMPOS.DT_EMISSAO;

      var valSheet = a[campo];
      var valSmartProcessado = s[smartField];
      var valSmartRaw = rawSmart ? JSON.stringify(rawSmart[rawSmartField]) : '—';

      var isoAntigoSheet = _antigoConverterParaISO(valSheet);
      var isoNovoSheet = _novoConverterParaISO(valSheet);
      var isoNovoSmart = _novoFormatarDataSmart(valSmartProcessado);

      var bateAntigo = isoAntigoSheet === valSmartProcessado ? '✅' : '❌';
      var bateNovo   = isoNovoSheet   === isoNovoSmart       ? '✅' : '❌';

      Logger.log('  📅 ' + campo + ':');
      Logger.log('    Sheet (raw)      : ' + valSheet);
      Logger.log('    Sheet ISO antigo : ' + isoAntigoSheet);
      Logger.log('    Sheet ISO novo   : ' + isoNovoSheet);
      Logger.log('    Smart (raw API)  : ' + valSmartRaw);
      Logger.log('    Smart (processado): ' + valSmartProcessado);
      Logger.log('    Smart ISO novo   : ' + isoNovoSmart);
      Logger.log('    ANTIGO match?    : ' + bateAntigo);
      Logger.log('    NOVO match?      : ' + bateNovo);
    });
    Logger.log('');
  });

  Logger.log('═══════════════════════════════════════════════');
}

/** Busca UM registro específico sem processar (vê os dados crus da API). */
function buscarRawSmart(titleBuscado) {
  var url = CONFIG_IMPORTACAO.BASE_URL + '/applications/' + CONFIG_IMPORTACAO.TABLE_ID + '/records/list/';
  try {
    var res = UrlFetchApp.fetch(url, {
      method: 'post',
      headers: {
        'Authorization': 'Token ' + CONFIG_IMPORTACAO.API_TOKEN,
        'Account-Id': CONFIG_IMPORTACAO.ACCOUNT_ID,
        'Content-Type': 'application/json'
      },
      payload: JSON.stringify({
        filter: { operator: 'and', fields: [{ field: 'title', comparison: 'is', value: titleBuscado }] },
        limit: 1
      }),
      muteHttpExceptions: true
    });
    var json = JSON.parse(res.getContentText());
    return json.items && json.items[0] ? json.items[0] : null;
  } catch(e) { return null; }
}

// Versões de conversão pra teste
function _antigoConverterParaISO(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  var s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
}

function _novoConverterParaISO(valor) {
  if (!valor) return '';
  if (valor instanceof Date) {
    if (isNaN(valor.getTime())) return '';
    return Utilities.formatDate(valor, 'UTC', 'yyyy-MM-dd');
  }
  var s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  var mBR = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (mBR) {
    var dia = mBR[1].length === 1 ? '0' + mBR[1] : mBR[1];
    var mes = mBR[2].length === 1 ? '0' + mBR[2] : mBR[2];
    var ano = mBR[3].length === 2 ? '20' + mBR[3] : mBR[3];
    return ano + '-' + mes + '-' + dia;
  }
  try {
    var d = new Date(s);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  } catch(e) {}
  return '';
}

function _novoFormatarDataSmart(valStr) {
  if (!valStr) return '';
  try {
    var d = new Date(valStr);
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, 'UTC', 'yyyy-MM-dd');
  } catch(e) {}
  if (/^\d{4}-\d{2}-\d{2}/.test(valStr)) return valStr.substring(0, 10);
  return '';
}

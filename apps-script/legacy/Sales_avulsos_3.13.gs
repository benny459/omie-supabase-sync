/**
 * ════════════════════════════════════════════════════════════════
 * SCRIPT SYNC: VENDAS AVULSAS
 * VERSÃO: 3.13 (COMPATÍVEL ORQUESTRADOR V3)
 * 1. Return Count: Retorna total de candidatos processados.
 * 2. Proteção de Lock e Timestamp AZ1.
 * ════════════════════════════════════════════════════════════════
 */

// ========================================
// 1. CONFIGURAÇÃO
// ========================================

const CONFIG_IMPORTACAO = {
  BASE_URL: 'https://app.smartsuite.com/api/v1',
  ACCOUNT_ID: 'snm19hn6',
  TABLE_ID: '679bd2d153f70a63197fde64', 
  API_TOKEN: 'b64bd1cca64432c1a36f1e5e861fa7fe0aea1320',
  
  NOME_ABA: 'Consolidação_PV_OS',
  PROJETOS_PERMITIDOS: ['40_VS', '41_VP'],
  DIAS_FILTRO_INSERCAO: 90,
  
  CAMPOS: {
    TITLE: 'title',
    // IDs GERAIS
    VALOR: 's626230a23',          
    PREVISAO: 's0b49dd159',
    CLIENTE: 's53aefb05c',        
    PROJETO_TEXTO: 's8c48f1c4b',  
    ETAPA_VENDA: 's9ee9213bb',    
    TIPO_VENDA: 's6ebca6d00',     
    CAMPO_DATA_H: 's28f2347ed',   
    CAMPO_L: 's03423faaf',
    DT_EMISSAO: 'se991fa1b6'
  },
  
  COLUNAS_SHEETS: {
    COD_PVOS: 5,          // F 
    VALOR_TOTAL: 2,       // C
    DATA_EMISSAO: 3,      // D 
    PREVISAO: 4,          // E
    CLIENTE: 6,           // G
    CAMPO_DATA_H: 7,      // H
    PROJETO: 8,           // I
    ETAPA_VENDA: 10,      // K
    CAMPO_L: 11,          // L
    TIPO_VENDA: 12        // M
  }
};

// ========================================
// 2. MAPEAMENTOS
// ========================================

const MAPEAMENTO_ETAPA_VENDA = {
  'proposta': 'sHD3g',
  'ordem de serviço': 'D4x8W',
  'ordem de servico': 'D4x8W',
  'solicitação de compra': 'IcJOQ',
  'solicitacao de compra': 'IcJOQ',
  'solicitacao compra': 'IcJOQ',
  'pedido de venda': 'IcJOQ',
  'compras aprovadas': 'rkiQR', 
  'compras aprovada': 'rkiQR', 
  'em execução': 'rkiQR',
  'em execucao': 'rkiQR',
  'agendado para': 'wtl9C',
  'faturar': 'E873C',
  'faturado': 'VHoUD',
  'entrega': 'hextD'
};

const MAPEAMENTO_TIPO_VENDA = {
  'mercantil': 'zv0Tl',
  'mix': 'z9d2k',
  'serviços': '9WGl7',
  'servicos': '9WGl7'
};

// ========================================
// 3. FUNÇÃO PRINCIPAL (ATUALIZADA V3)
// ========================================

function sincronizarEInserir() {
  const hInicioRelogio = new Date().getTime(); 
  const props = PropertiesService.getScriptProperties();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_IMPORTACAO.NOME_ABA);
  
  // 🆕 CONTADOR PARA O ORQUESTRADOR
  let totalCandidatosProcessados = 0;

  // Proteção de Lock
  if (props.getProperty('LOCK_SYNC_SMART') === 'TRUE') {
    Logger.log('⚠️ Sync SmartSuite já está rodando. Ignorando chamada.');
    return 0; 
  }

  try {
    props.setProperty('LOCK_SYNC_SMART', 'TRUE');
    Logger.log('🚀 INICIANDO SYNC V3.13 (Smart Orchestrator Ready)');
    
    Logger.log('[1/4] 🔍 Buscando SmartSuite...');
    const registrosSmart = buscarTodosRegistrosSmartSuite();
    Logger.log(`    ✅ Registros em memória: ${registrosSmart.length}`);
    const mapaSmart = agruparPorTitle(registrosSmart); 
    
    Logger.log('[2/4] 📄 Lendo Planilha...');
    const candidatos = processarCandidatosSheets();
    
    // 🆕 DEFINE O CONTADOR DE RETORNO (Registros Lidos)
    totalCandidatosProcessados = candidatos.length;
    Logger.log(`    ✅ Candidatos na planilha: ${totalCandidatosProcessados}`);

    Logger.log('[3/4] 🔄 Comparando dados...');
    const camposParaAtualizar = ['CLIENTE', 'PROJETO', 'PREVISAO', 'VALOR', 'ETAPA', 'TIPO', 'DATA_H', 'CAMPO_L', 'DT_EMISSAO'];
    const resSync = atualizarRegistros(candidatos, mapaSmart, camposParaAtualizar);
    
    Logger.log('[4/4] ➕ Verificando Novos...');
    const resInsert = inserirNovos(candidatos, mapaSmart);
    
    // ✅ GRAVAÇÃO DO LOG CONSOLIDADO EM AZ1
    const totalAcoes = (resSync.atualizados || 0) + (resInsert.inseridos || 0);
    const msgAZ1 = `Sync: ${resSync.atualizados} upd / ${resInsert.inseridos} novos / ${totalCandidatosProcessados} lidos`;
    gravarLogAZ1(sheet, "SUCESSO", totalAcoes, hInicioRelogio, msgAZ1);
    
    if (resSync.atualizados > 0 || resInsert.inseridos > 0) {
      escreverTimestampN1(new Date());
    }
    
    const msg = `✅ Processados: ${totalCandidatosProcessados} | Atualizados: ${resSync.atualizados} | Novos: ${resInsert.inseridos}`;
    Logger.log('🏁 ' + msg);
    // SpreadsheetApp.getActiveSpreadsheet().toast(msg, 'Sync Concluído');

  } catch (e) {
    Logger.log('❌ Erro: ' + e.message);
    if (sheet) gravarLogAZ1(sheet, "ERRO", 0, hInicioRelogio, e.message);
    // Em caso de erro, retornamos 0 para o orquestrador saber que falhou (se houver range configurado)
    totalCandidatosProcessados = 0;
  } finally {
    props.deleteProperty('LOCK_SYNC_SMART');
  }

  // 🆕 RETORNO OBRIGATÓRIO PARA O ORQUESTRADOR
  return totalCandidatosProcessados;
}

/**
 * Função Mestre de Log AZ1
 */
function gravarLogAZ1(sheet, status, registros, tempoInicio, erroMsg) {
  if (!sheet) return;
  var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM HH:mm");
  var tempoGasto = Math.floor((new Date().getTime() - tempoInicio) / 1000);
  var icone = status === "SUCESSO" ? "✅" : "❌";
  
  var textoFinal = icone + " " + status + " | " + agora + " | " + registros + " ações | " + tempoGasto + "s";
  if (erroMsg) textoFinal += " | Obs: " + erroMsg;

  var range = sheet.getRange("AZ1");
  range.setValue(textoFinal);
  
  var cor = status === "SUCESSO" ? "#d9ead3" : "#f4cccc";
  range.setBackground(cor).setFontColor("black").setFontWeight("bold");
}

// ========================================
// 4. LÓGICA DE NEGÓCIO (MANTIDA INTEGRALMENTE)
// ========================================

function processarCandidatosSheets() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_IMPORTACAO.NOME_ABA);
  if (!sheet) throw new Error('Aba não encontrada');
  
  const dados = sheet.getDataRange().getValues();
  const candidatos = [];
  
  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const codPVOS = normalizarTexto(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.COD_PVOS]);
    const projeto = normalizarTexto(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.PROJETO]);
    
    if (!codPVOS || !CONFIG_IMPORTACAO.PROJETOS_PERMITIDOS.includes(projeto)) continue;
    
    const etapaRaw = String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.ETAPA_VENDA] || '').trim();
    const tipoRaw = String(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.TIPO_VENDA] || '').trim();

    candidatos.push({
      title: codPVOS,
      projeto: projeto,
      cliente: normalizarTexto(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CLIENTE]),
      previsao: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.PREVISAO], 
      valor: normalizarNumero(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.VALOR_TOTAL]),
      etapaVenda: etapaRaw,
      etapaVendaKey: etapaRaw.toLowerCase(),
      tipoVenda: tipoRaw,
      tipoVendaKey: tipoRaw.toLowerCase(),
      campoDataH: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CAMPO_DATA_H],
      campoL: normalizarTexto(linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.CAMPO_L]),
      dataEmissao: linha[CONFIG_IMPORTACAO.COLUNAS_SHEETS.DATA_EMISSAO]
    });
  }
  return candidatos;
}

function atualizarRegistros(candidatos, mapaSmart, campos) {
  let atualizados = 0;
  let ignorados = 0;
  let erros = 0;
  
  candidatos.forEach(cand => {
    if (!mapaSmart[cand.title]) return;
    
    const listaDestinos = mapaSmart[cand.title];
    
    listaDestinos.forEach(smartReg => {
      const payload = {};
      let mudou = false;
      const mudancas = [];
      
      // 1. CLIENTE
      if (campos.includes('CLIENTE') && !saoTextosIguais(cand.cliente, smartReg.cliente)) {
        payload[CONFIG_IMPORTACAO.CAMPOS.CLIENTE] = cand.cliente;
        mudancas.push('Cliente');
        mudou = true;
      }
      
      // 2. PROJETO
      if (campos.includes('PROJETO') && !saoTextosIguais(cand.projeto, smartReg.projeto)) {
        payload[CONFIG_IMPORTACAO.CAMPOS.PROJETO_TEXTO] = cand.projeto;
        mudancas.push('Projeto');
        mudou = true;
      }
      
      // 3. VALOR
      if (campos.includes('VALOR') && !saoNumerosIguais(cand.valor, smartReg.valor)) {
        payload[CONFIG_IMPORTACAO.CAMPOS.VALOR] = cand.valor;
        mudancas.push('Valor');
        mudou = true;
      }
      
      // 4. PREVISÃO
      const dataPrevCand = converterParaISO(cand.previsao);
      const dataPrevSmart = smartReg.previsao;
      if (campos.includes('PREVISAO') && dataPrevCand && dataPrevCand !== dataPrevSmart) {
        payload[CONFIG_IMPORTACAO.CAMPOS.PREVISAO] = { "to_date": { "date": dataPrevCand + 'T00:00:00Z', "include_time": false }, "from_date": null };
        mudancas.push('Previsão');
        mudou = true;
      }
      
      // 5. ETAPA
      if (campos.includes('ETAPA') && cand.etapaVenda) {
        const idEtapaSheet = MAPEAMENTO_ETAPA_VENDA[cand.etapaVendaKey];
        const idEtapaSmart = smartReg.etapaVenda;
        
        if (idEtapaSheet) {
          if (idEtapaSheet !== idEtapaSmart) {
            payload[CONFIG_IMPORTACAO.CAMPOS.ETAPA_VENDA] = idEtapaSheet;
            mudancas.push('Etapa');
            mudou = true;
          }
        }
      }

      // 6. TIPO DE VENDA
      if (campos.includes('TIPO') && cand.tipoVenda) {
        const idTipoSheet = MAPEAMENTO_TIPO_VENDA[cand.tipoVendaKey];
        const idTipoSmart = smartReg.tipoVenda;
        if (idTipoSheet && idTipoSheet !== idTipoSmart) {
          payload[CONFIG_IMPORTACAO.CAMPOS.TIPO_VENDA] = idTipoSheet;
          mudancas.push('Tipo');
          mudou = true;
        }
      }
      
      // 7. CAMPO H
      const dataHCand = converterParaISO(cand.campoDataH);
      const dataHSmart = smartReg.campoDataH;
      if (campos.includes('DATA_H') && dataHCand && dataHCand !== dataHSmart) {
        payload[CONFIG_IMPORTACAO.CAMPOS.CAMPO_DATA_H] = { "date": dataHCand + 'T00:00:00Z', "include_time": false };
        mudancas.push('Data H');
        mudou = true;
      }
      
      // 8. CAMPO L
      if (campos.includes('CAMPO_L') && !saoTextosIguais(cand.campoL, smartReg.campoL)) {
        payload[CONFIG_IMPORTACAO.CAMPOS.CAMPO_L] = cand.campoL;
        mudancas.push('Campo L');
        mudou = true;
      }

      // 9. DATA EMISSÃO
      const dataEmissaoCand = converterParaISO(cand.dataEmissao);
      const dataEmissaoSmart = smartReg.dataEmissaoSmart;
      if (campos.includes('DT_EMISSAO') && dataEmissaoCand && dataEmissaoCand !== dataEmissaoSmart) {
        payload[CONFIG_IMPORTACAO.CAMPOS.DT_EMISSAO] = { "date": dataEmissaoCand + 'T00:00:00Z', "include_time": false };
        mudancas.push('Dt. Emissão');
        mudou = true;
      }

      if (mudou) {
        if (enviarRequest(smartReg.id, 'PATCH', payload)) {
          atualizados++;
          Logger.log(`✅ Atualizado ${cand.title}: ${mudancas.join(', ')}`);
        } else { erros++; }
      } else {
        ignorados++;
      }
    });
  });
  return { atualizados, ignorados, erros };
}

function inserirNovos(candidatos, mapaSmart) {
  let inseridos = 0;
  let erros = 0;
  const hoje = new Date();
  const dataCorte = new Date(hoje.getTime() - (CONFIG_IMPORTACAO.DIAS_FILTRO_INSERCAO * 24 * 60 * 60 * 1000));
  const inseridosNestaRodada = new Set();
  
  candidatos.forEach(cand => {
    if (mapaSmart[cand.title] || inseridosNestaRodada.has(cand.title)) return;
    
    const dtEmissaoObj = new Date(cand.dataEmissao);
    if (dtEmissaoObj < dataCorte) return;
    
    const payload = {};
    payload[CONFIG_IMPORTACAO.CAMPOS.TITLE] = cand.title;
    payload[CONFIG_IMPORTACAO.CAMPOS.PROJETO_TEXTO] = cand.projeto; 
    payload[CONFIG_IMPORTACAO.CAMPOS.CLIENTE] = cand.cliente; 
    payload[CONFIG_IMPORTACAO.CAMPOS.VALOR] = cand.valor;
    
    const dataPrev = converterParaISO(cand.previsao);
    if (dataPrev) payload[CONFIG_IMPORTACAO.CAMPOS.PREVISAO] = { "to_date": { "date": dataPrev + 'T00:00:00Z', "include_time": false } };
    
    const dataEmissao = converterParaISO(cand.dataEmissao);
    if (dataEmissao) payload[CONFIG_IMPORTACAO.CAMPOS.DT_EMISSAO] = { "date": dataEmissao + 'T00:00:00Z', "include_time": false };
    
    if (cand.etapaVendaKey && MAPEAMENTO_ETAPA_VENDA[cand.etapaVendaKey]) {
      payload[CONFIG_IMPORTACAO.CAMPOS.ETAPA_VENDA] = MAPEAMENTO_ETAPA_VENDA[cand.etapaVendaKey];
    }
    if (cand.tipoVendaKey && MAPEAMENTO_TIPO_VENDA[cand.tipoVendaKey]) {
      payload[CONFIG_IMPORTACAO.CAMPOS.TIPO_VENDA] = MAPEAMENTO_TIPO_VENDA[cand.tipoVendaKey];
    }
    
    if (enviarRequest(null, 'POST', payload)) {
      inseridos++;
      inseridosNestaRodada.add(cand.title);
      Logger.log(`➕ Inserido: ${cand.title}`);
    } else { erros++; }
  });
  
  return { inseridos, erros };
}

// ========================================
// 5. AUXILIARES E API (MANTIDAS INTEGRALMENTE)
// ========================================

function buscarTodosRegistrosSmartSuite() {
  const url = CONFIG_IMPORTACAO.BASE_URL + '/applications/' + CONFIG_IMPORTACAO.TABLE_ID + '/records/list/';
  let todosItens = [];
  let offset = 0;
  let temMais = true;
  const LIMIT = 2000; 

  while (temMais) {
    try {
      const payload = JSON.stringify({ 
        offset: offset, 
        limit: LIMIT,
        sort: [{ field: "first_created", direction: "desc" }] 
      });
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        headers: { 'Authorization': 'Token ' + CONFIG_IMPORTACAO.API_TOKEN, 'Account-Id': CONFIG_IMPORTACAO.ACCOUNT_ID, 'Content-Type': 'application/json' },
        payload: payload,
        muteHttpExceptions: true
      });
      const json = JSON.parse(res.getContentText());
      const items = json.items || [];
      if (items.length > 0) {
        todosItens = todosItens.concat(items);
        offset += items.length;
        if (items.length < LIMIT) temMais = false;
      } else { temMais = false; }
    } catch (e) { temMais = false; }
  }

  return todosItens.map(r => ({
    id: r.id,
    title: normalizarTexto(r.title),
    cliente: normalizarTexto(extrairValorSimples(r[CONFIG_IMPORTACAO.CAMPOS.CLIENTE])),
    projeto: normalizarTexto(extrairValorSimples(r[CONFIG_IMPORTACAO.CAMPOS.PROJETO_TEXTO])),
    valor: r[CONFIG_IMPORTACAO.CAMPOS.VALOR] ? parseFloat(r[CONFIG_IMPORTACAO.CAMPOS.VALOR]) : 0,
    previsao: formatarDataSmart(r[CONFIG_IMPORTACAO.CAMPOS.PREVISAO]),
    etapaVenda: extrairIdStatus(r[CONFIG_IMPORTACAO.CAMPOS.ETAPA_VENDA]),
    tipoVenda: extrairIdStatus(r[CONFIG_IMPORTACAO.CAMPOS.TIPO_VENDA]),
    campoDataH: formatarDataSmart(r[CONFIG_IMPORTACAO.CAMPOS.CAMPO_DATA_H]),
    campoL: normalizarTexto(extrairValorSimples(r[CONFIG_IMPORTACAO.CAMPOS.CAMPO_L])),
    dataEmissaoSmart: formatarDataSmart(r[CONFIG_IMPORTACAO.CAMPOS.DT_EMISSAO])
  }));
}

function saoTextosIguais(t1, t2) {
  return String(t1 || '').trim().toUpperCase() === String(t2 || '').trim().toUpperCase();
}

function saoNumerosIguais(n1, n2) {
  return Math.abs(parseFloat(n1 || 0) - parseFloat(n2 || 0)) < 0.01;
}

function converterParaISO(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
}

function extrairIdStatus(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor) && valor.length > 0) return valor[0];
  if (typeof valor === 'object') {
     if (valor.hasOwnProperty('value')) return valor.value;
     return '';
  }
  return '';
}

function extrairValorSimples(valor) {
  if (valor === null || valor === undefined) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'number') return String(valor);
  if (typeof valor === 'object') {
    if (valor.hasOwnProperty('title')) return valor.title || '';
    return ''; 
  }
  return String(valor);
}

function agruparPorTitle(registros) {
  const mapa = {};
  registros.forEach(r => {
    if (!mapa[r.title]) mapa[r.title] = [];
    mapa[r.title].push(r);
  });
  return mapa;
}

function enviarRequest(recordId, metodo, payload) {
  let url = CONFIG_IMPORTACAO.BASE_URL + '/applications/' + CONFIG_IMPORTACAO.TABLE_ID + '/records/';
  if (recordId) url += recordId + '/';
  try {
    const res = UrlFetchApp.fetch(url, {
      method: metodo,
      headers: { 'Authorization': 'Token ' + CONFIG_IMPORTACAO.API_TOKEN, 'Account-Id': CONFIG_IMPORTACAO.ACCOUNT_ID, 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) return true;
    return false;
  } catch (e) { return false; }
}

function writingTimestampN1(dataHora) { try { SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_IMPORTACAO.NOME_ABA).getRange('N1').setValue(Utilities.formatDate(dataHora, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')); } catch(e) {} }
function normalizarTexto(val) { return String(val || '').trim().toUpperCase(); }
function normalizarNumero(val) { const n = parseFloat(val); return isNaN(n) ? 0 : n; }
function normalizarData(val) { return converterParaISO(val); }
function formatarDataSmart(obj) {
  if (!obj) return '';
  if (obj.to_date && obj.to_date.date) return obj.to_date.date.substring(0, 10);
  if (obj.date) return obj.date.substring(0, 10);
  if (typeof obj === 'string') return obj.substring(0, 10);
  return '';
}
function escreverTimestampN1(data) { writingTimestampN1(data); }
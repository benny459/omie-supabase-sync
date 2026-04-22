/**
 * ════════════════════════════════════════════════════════════════
 * SCRIPT SYNC: PROJETOS ATIVOS (NOVA TABELA)
 * ID TABELA: 696d3c3d35b1839e1b2a274f
 * VERSÃO: 1.5 (COMPATÍVEL ORQUESTRADOR V3)
 * 1. Return Count: Retorna total de candidatos processados.
 * 2. Proteção Lock e Correção de Configuração API.
 * ════════════════════════════════════════════════════════════════
 */

// ========================================
// 1. CONFIGURAÇÃO
// ========================================

const CONFIG_PROJETOS_ATIVOS = {
  BASE_URL: 'https://app.smartsuite.com/api/v1',
  ACCOUNT_ID: 'snm19hn6',
  TABLE_ID: '696d3c3d35b1839e1b2a274f', 
  API_TOKEN: 'b64bd1cca64432c1a36f1e5e861fa7fe0aea1320',
  
  NOME_ABA: 'Consolidação_PV_OS',
  DIAS_FILTRO_INSERCAO: 90,
  
  CAMPOS: {
    TITLE: 'title',
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

const MAPA_ETAPA_PROJETOS = {
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

const MAPA_TIPO_PROJETOS = {
  'mercantil': 'zv0Tl',
  'mix': 'z9d2k',
  'serviços': '9WGl7',
  'servicos': '9WGl7'
};

// ========================================
// 3. FUNÇÃO PRINCIPAL (ATUALIZADA V3)
// ========================================

function sincronizarProjetosAtivos() {
  const hInicioRelogio = new Date().getTime(); 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG_PROJETOS_ATIVOS.NOME_ABA);
  const props = PropertiesService.getScriptProperties();
  
  // 🆕 CONTADOR PARA O ORQUESTRADOR
  let totalCandidatosProcessados = 0;

  // Proteção de Lock
  if (props.getProperty('LOCK_SYNC_PROJETOS') === 'TRUE') {
    Logger.log('⚠️ Sync Projetos já está rodando. Ignorando chamada.');
    return 0;
  }

  try {
    props.setProperty('LOCK_SYNC_PROJETOS', 'TRUE');
    Logger.log('🚀 INICIANDO SYNC: PROJETOS ATIVOS V1.5');
    
    Logger.log('[1/4] 🔍 Buscando SmartSuite...');
    const registrosSmart = buscarSmartProjetosAtivos();
    const mapaSmart = agruparPorTitle(registrosSmart); 
    
    Logger.log('[2/4] 📄 Lendo Planilha (Filtrando "PJ")...');
    const candidatos = processarPlanilhaProjetos();
    
    // 🆕 DEFINE O CONTADOR DE RETORNO
    totalCandidatosProcessados = candidatos.length;
    
    Logger.log('[3/4] 🔄 Comparando dados...');
    const camposParaAtualizar = ['CLIENTE', 'PROJETO', 'PREVISAO', 'VALOR', 'ETAPA', 'TIPO', 'DATA_H', 'CAMPO_L', 'DT_EMISSAO'];
    const resSync = atualizarProjetosAtivos(candidatos, mapaSmart, camposParaAtualizar);
    
    Logger.log('[4/4] ➕ Verificando Novos...');
    const resInsert = inserirNovosProjetos(candidatos, mapaSmart);
    
    // ✅ GRAVAÇÃO DO LOG CONSOLIDADO EM AZ1
    const totalAcoes = (resSync.atualizados || 0) + (resInsert.inseridos || 0);
    const msgAZ1 = `PJ Sync: ${resSync.atualizados} upd / ${resInsert.inseridos} novos / ${totalCandidatosProcessados} lidos`;
    
    gravarLogAZ1(sheet, "SUCESSO", totalAcoes, hInicioRelogio, msgAZ1);
    
    if (resSync.atualizados > 0 || resInsert.inseridos > 0) {
      escreverTimestampN1(new Date());
    }
    
    const msg = `✅ Processados: ${totalCandidatosProcessados} | Atualizados: ${resSync.atualizados} | Novos: ${resInsert.inseridos}`;
    // ss.toast(msg, 'Concluído - Projetos Ativos');

  } catch (e) {
    Logger.log('❌ Erro: ' + e.message);
    if (sheet) gravarLogAZ1(sheet, "ERRO", 0, hInicioRelogio, e.message);
    // Zera contador em caso de erro para o orquestrador saber
    totalCandidatosProcessados = 0;
  } finally {
    props.deleteProperty('LOCK_SYNC_PROJETOS');
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
// 4. LÓGICA DE NEGÓCIO
// ========================================

function processarPlanilhaProjetos() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PROJETOS_ATIVOS.NOME_ABA);
  if (!sheet) throw new Error('Aba não encontrada');
  
  const dados = sheet.getDataRange().getValues();
  const candidatos = [];
  
  for (let i = 1; i < dados.length; i++) {
    const linha = dados[i];
    const codPVOS = normalizarTexto(linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.COD_PVOS]);
    const projeto = normalizarTexto(linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.PROJETO]);
    
    if (!codPVOS || !projeto.includes('PJ')) continue;
    
    const etapaRaw = String(linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.ETAPA_VENDA] || '').trim();
    const tipoRaw = String(linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.TIPO_VENDA] || '').trim();

    candidatos.push({
      title: codPVOS,
      projeto: projeto,
      cliente: normalizarTexto(linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.CLIENTE]),
      previsao: linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.PREVISAO], 
      valor: normalizarNumero(linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.VALOR_TOTAL]),
      etapaVenda: etapaRaw,
      etapaVendaKey: etapaRaw.toLowerCase(),
      tipoVenda: tipoRaw,
      tipoVendaKey: tipoRaw.toLowerCase(),
      campoDataH: linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.CAMPO_DATA_H],
      campoL: normalizarTexto(linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.CAMPO_L]),
      dataEmissao: linha[CONFIG_PROJETOS_ATIVOS.COLUNAS_SHEETS.DATA_EMISSAO]
    });
  }
  return candidatos;
}

function atualizarProjetosAtivos(candidatos, mapaSmart, campos) {
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
      
      if (campos.includes('CLIENTE') && !saoTextosIguais(cand.cliente, smartReg.cliente)) {
        payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.CLIENTE] = cand.cliente;
        mudancas.push('Cliente'); mudou = true;
      }
      if (campos.includes('PROJETO') && !saoTextosIguais(cand.projeto, smartReg.projeto)) {
        payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.PROJETO_TEXTO] = cand.projeto;
        mudancas.push('Projeto'); mudou = true;
      }
      if (campos.includes('VALOR') && !saoNumerosIguais(cand.valor, smartReg.valor)) {
        payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.VALOR] = cand.valor;
        mudancas.push('Valor'); mudou = true;
      }
      const dataPrevCand = converterParaISO(cand.previsao);
      if (campos.includes('PREVISAO') && dataPrevCand && dataPrevCand !== smartReg.previsao) {
        payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.PREVISAO] = { "to_date": { "date": dataPrevCand + 'T00:00:00Z', "include_time": false }, "from_date": null };
        mudancas.push('Previsão'); mudou = true;
      }
      if (campos.includes('ETAPA') && cand.etapaVenda) {
        const idEtapaSheet = MAPA_ETAPA_PROJETOS[cand.etapaVendaKey];
        if (idEtapaSheet && idEtapaSheet !== smartReg.etapaVenda) {
          payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.ETAPA_VENDA] = idEtapaSheet;
          mudancas.push('Etapa'); mudou = true;
        }
      }
      if (campos.includes('TIPO') && cand.tipoVenda) {
        const idTipoSheet = MAPA_TIPO_PROJETOS[cand.tipoVendaKey];
        if (idTipoSheet && idTipoSheet !== smartReg.tipoVenda) {
          payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.TIPO_VENDA] = idTipoSheet;
          mudancas.push('Tipo'); mudou = true;
        }
      }
      const dataHCand = converterParaISO(cand.campoDataH);
      if (campos.includes('DATA_H') && dataHCand && dataHCand !== smartReg.campoDataH) {
        payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.CAMPO_DATA_H] = { "date": dataHCand + 'T00:00:00Z', "include_time": false };
        mudancas.push('Data H'); mudou = true;
      }
      if (campos.includes('CAMPO_L') && !saoTextosIguais(cand.campoL, smartReg.campoL)) {
        payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.CAMPO_L] = cand.campoL;
        mudancas.push('Campo L'); mudou = true;
      }
      const dataEmissaoCand = converterParaISO(cand.dataEmissao);
      if (campos.includes('DT_EMISSAO') && dataEmissaoCand && dataEmissaoCand !== smartReg.dataEmissaoSmart) {
        payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.DT_EMISSAO] = { "date": dataEmissaoCand + 'T00:00:00Z', "include_time": false };
        mudancas.push('Dt. Emissão'); mudou = true;
      }

      if (mudou) {
        if (enviarRequestProjetos(smartReg.id, 'PATCH', payload)) {
          atualizados++;
          Logger.log(`✅ Atualizado ${cand.title}: ${mudancas.join(', ')}`);
        } else { erros++; }
      } else { ignorados++; }
    });
  });
  return { atualizados, ignorados, erros };
}

function inserirNovosProjetos(candidatos, mapaSmart) {
  let inseridos = 0;
  let erros = 0;
  const hoje = new Date();
  const dataCorte = new Date(hoje.getTime() - (CONFIG_PROJETOS_ATIVOS.DIAS_FILTRO_INSERCAO * 24 * 60 * 60 * 1000));
  const inseridosNestaRodada = new Set();
  
  candidatos.forEach(cand => {
    if (mapaSmart[cand.title] || inseridosNestaRodada.has(cand.title)) return;
    const dtEmissaoObj = new Date(cand.dataEmissao);
    if (dtEmissaoObj < dataCorte) return;
    
    const payload = {};
    payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.TITLE] = cand.title;
    payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.PROJETO_TEXTO] = cand.projeto; 
    payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.CLIENTE] = cand.cliente; 
    payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.VALOR] = cand.valor;
    
    const dataPrev = converterParaISO(cand.previsao);
    if (dataPrev) payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.PREVISAO] = { "to_date": { "date": dataPrev + 'T00:00:00Z', "include_time": false } };
    
    const dataEmissao = converterParaISO(cand.dataEmissao);
    if (dataEmissao) payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.DT_EMISSAO] = { "date": dataEmissao + 'T00:00:00Z', "include_time": false };
    
    if (cand.etapaVendaKey && MAPA_ETAPA_PROJETOS[cand.etapaVendaKey]) {
      payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.ETAPA_VENDA] = MAPA_ETAPA_PROJETOS[cand.etapaVendaKey];
    }
    if (cand.tipoVendaKey && MAPA_TIPO_PROJETOS[cand.tipoVendaKey]) {
      payload[CONFIG_PROJETOS_ATIVOS.CAMPOS.TIPO_VENDA] = MAPA_TIPO_PROJETOS[cand.tipoVendaKey];
    }
    
    if (enviarRequestProjetos(null, 'POST', payload)) {
      inseridos++;
      inseridosNestaRodada.add(cand.title);
      Logger.log(`➕ Inserido: ${cand.title}`);
    } else { erros++; }
  });
  return { inseridos, erros };
}

// ========================================
// 5. AUXILIARES E API
// ========================================

function buscarSmartProjetosAtivos() {
  const url = CONFIG_PROJETOS_ATIVOS.BASE_URL + '/applications/' + CONFIG_PROJETOS_ATIVOS.TABLE_ID + '/records/list/';
  let todosItens = [];
  let offset = 0;
  let temMais = true;
  const LIMIT = 2000; 

  while (temMais) {
    try {
      const payload = JSON.stringify({ offset: offset, limit: LIMIT, sort: [{ field: "first_created", direction: "desc" }] });
      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        headers: { 'Authorization': 'Token ' + CONFIG_PROJETOS_ATIVOS.API_TOKEN, 'Account-Id': CONFIG_PROJETOS_ATIVOS.ACCOUNT_ID, 'Content-Type': 'application/json' },
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
    cliente: normalizarTexto(extrairValorSimples(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.CLIENTE])),
    projeto: normalizarTexto(extrairValorSimples(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.PROJETO_TEXTO])),
    valor: r[CONFIG_PROJETOS_ATIVOS.CAMPOS.VALOR] ? parseFloat(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.VALOR]) : 0,
    previsao: formatarDataSmart(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.PREVISAO]),
    etapaVenda: extrairIdStatus(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.ETAPA_VENDA]),
    tipoVenda: extrairIdStatus(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.TIPO_VENDA]), 
    campoDataH: formatarDataSmart(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.CAMPO_DATA_H]),
    campoL: normalizarTexto(extrairValorSimples(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.CAMPO_L])),
    dataEmissaoSmart: formatarDataSmart(r[CONFIG_PROJETOS_ATIVOS.CAMPOS.DT_EMISSAO])
  }));
}

function saoTextosIguais(t1, t2) { return String(t1 || '').trim().toUpperCase() === String(t2 || '').trim().toUpperCase(); }
function saoNumerosIguais(n1, n2) { return Math.abs(parseFloat(n1 || 0) - parseFloat(n2 || 0)) < 0.01; }
function converterParaISO(valor) {
  if (!valor) return '';
  if (valor instanceof Date) return Utilities.formatDate(valor, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const s = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.substring(0, 10);
  return '';
}
function extrairIdStatus(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') return valor;
  if (Array.isArray(valor) && valor.length > 0) return valor[0];
  if (typeof valor === 'object' && valor.value) return valor.value;
  return '';
}
function extrairValorSimples(valor) {
  if (!valor) return '';
  if (typeof valor === 'string') return valor;
  if (typeof valor === 'object') return valor.title || '';
  return String(valor);
}
function agruparPorTitle(registros) {
  const mapa = {};
  registros.forEach(r => { if (!mapa[r.title]) mapa[r.title] = []; mapa[r.title].push(r); });
  return mapa;
}
function enviarRequestProjetos(recordId, metodo, payload) {
  let url = CONFIG_PROJETOS_ATIVOS.BASE_URL + '/applications/' + CONFIG_PROJETOS_ATIVOS.TABLE_ID + '/records/';
  if (recordId) url += recordId + '/';
  try {
    const res = UrlFetchApp.fetch(url, {
      method: metodo,
      headers: { 'Authorization': 'Token ' + CONFIG_PROJETOS_ATIVOS.API_TOKEN, 'Account-Id': CONFIG_PROJETOS_ATIVOS.ACCOUNT_ID, 'Content-Type': 'application/json' },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
    return (res.getResponseCode() >= 200 && res.getResponseCode() < 300);
  } catch (e) { return false; }
}
function writingTimestampN1(dataHora) { try { SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PROJETOS_ATIVOS.NOME_ABA).getRange('N1').setValue(Utilities.formatDate(dataHora, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss')); } catch(e) {} }
function normalizarTexto(val) { return String(val || '').trim().toUpperCase(); }
function normalizarNumero(val) { const n = parseFloat(val); return isNaN(n) ? 0 : n; }
function formatarDataSmart(obj) {
  if (!obj) return '';
  if (obj.to_date && obj.to_date.date) return obj.to_date.date.substring(0, 10);
  if (obj.date) return obj.date.substring(0, 10);
  if (typeof obj === 'string') return obj.substring(0, 10);
  return '';
}
function escreverTimestampN1(data) { writingTimestampN1(data); }
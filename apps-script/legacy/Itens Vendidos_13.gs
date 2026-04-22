// ════════════════════════════════════════════════════════════════════════════
// 🏆 SCRIPT ITENS VENDIDOS - V13.2 (RETRY 429 AGRESSIVO + THROTTLE PROATIVO)
// 1. Return Count: Retorna volumetria para o Orquestrador validar.
// 2. Filtra data DIRETO NA API para velocidade máxima.
// 3. Gerenciamento de CADEADO para execução sequencial.
// 4. 🆕 Retry de até 5 tentativas:
//      - HTTP 429: backoff LINEAR longo (20s, 40s, 60s, 80s)
//      - HTTP 5xx: backoff EXPONENCIAL curto (3s, 6s, 12s, 24s)
// 5. 🆕 Throttle proativo de 1s entre chamadas bem-sucedidas.
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎮 1. PAINEL DE CONTROLE
// ========================================
var OPCOES_IV = {
  empresasAlvo: ["SF"],
  dataInicioFixa: "01/01/2025",
  itensPorPagina: 30
};

// ========================================
// ⚙️ 2. CONFIGURAÇÕES TÉCNICAS
// ========================================
var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_IV = {
  url: "https://app.omie.com.br/api/v1/produtos/pedido/",
  metodo: "ListarPedidos",
  nomePlanilha: "ItensVendidos",
  cor: "#0052CC",
  headers: [
    "Empresa", "Cód Pedido", "Num Pedido", "Data Previsão", "Cód Cliente",
    "Etapa", "Cód Parcela", "Simples Nac", "Cód Item Int",
    "Cód Item", "Cód Produto", "Cód Prod Omie", "Descrição",
    "Unidade", "Quantidade", "Vlr Unit", "Vlr Total", "NCM",
    "Tipo Desc", "Vlr Desc", "Perc Desc", "COFINS ST",
    "PIS ST", "ICMS Origem", "ICMS ST", "Dt Inc",
    "Hr Inc", "Dt Alt", "Hr Alt"
  ],
  // 🆕 Configurações de retry e throttle
  maxTentativas: 5,
  backoff429Ms: 20000,          // 429: 20s, 40s, 60s, 80s (linear — Omie exige pausa longa)
  backoff5xxMs: 3000,           // 5xx: 3s, 6s, 12s, 24s (exponencial — erro temporário)
  pausaEntreChamadasMs: 1000    // pausa fixa entre cada chamada p/ não estourar rate limit
};

// ========================================
// 🚀 3. LANÇADOR
// ========================================
function executarImportacaoItensVendidosTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // Verifica se é uma nova execução ou retomada
  if (props.getProperty('LOCK_ITENS_TURBO') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando Itens Vendidos V13.2...");

    props.setProperty('LOCK_ITENS_TURBO', 'TRUE');

    const chavesLixo = ['IV_IDX_EMP', 'IV_IDX_PAG', 'IV_NEXT_ROW', 'IV_TARGET_EMPS', 'IV_DT_FILTRO'];
    chavesLixo.forEach(function(k) { props.deleteProperty(k); });

    limparGatilhosSafeIV();

    props.setProperty('IV_TARGET_EMPS', JSON.stringify(OPCOES_IV.empresasAlvo));
    props.setProperty('IV_ITENS_PAG', OPCOES_IV.itensPorPagina.toString());
    props.setProperty('IV_DT_FILTRO', OPCOES_IV.dataInicioFixa);

    var sheet = ss.getSheetByName(CONFIG_IV.nomePlanilha) || ss.insertSheet(CONFIG_IV.nomePlanilha);
    var maxRow = sheet.getMaxRows();
    if (maxRow > 1) sheet.getRange(2, 1, maxRow-1, CONFIG_IV.headers.length).clearContent();

    sheet.getRange(1, 1, 1, CONFIG_IV.headers.length).setValues([CONFIG_IV.headers])
      .setFontWeight("bold").setBackground(CONFIG_IV.cor).setFontColor("white");
    sheet.setFrozenRows(1);

    props.setProperty('IV_NEXT_ROW', "2");
    SpreadsheetApp.flush();
  } else {
    Logger.log("🟡 1. LANÇADOR: Retomando Itens Vendidos...");
  }

  // 👇 RETORNA O RESULTADO PARA O ORQUESTRADOR
  return motorProcessamentoItensVendidos();
}

// ========================================
// 🔁 3.5 FETCH COM RETRY (5 tentativas, backoff diferenciado por tipo de erro)
// ========================================
function fetchComRetryIV(url, options) {
  var ultimaResp = null;
  var ultimoErro = null;

  for (var tentativa = 1; tentativa <= CONFIG_IV.maxTentativas; tentativa++) {
    try {
      var resp = UrlFetchApp.fetch(url, options);
      var code = resp.getResponseCode();

      // Sucesso
      if (code === 200) {
        if (tentativa > 1) {
          Logger.log("   ✅ Retry sucesso na tentativa " + tentativa);
        }
        return resp;
      }

      // 429 (rate limit) → backoff LINEAR longo (Omie é rígida)
      if (code === 429) {
        ultimaResp = resp;
        if (tentativa < CONFIG_IV.maxTentativas) {
          var esperaMs = CONFIG_IV.backoff429Ms * tentativa; // 20s, 40s, 60s, 80s
          Logger.log("   ⚠️ HTTP 429 Too Many Requests (tent. " + tentativa + "/" + CONFIG_IV.maxTentativas + ") → aguardando " + (esperaMs/1000) + "s...");
          Utilities.sleep(esperaMs);
          continue;
        }
      } else if (code >= 500) {
        // 5xx → backoff EXPONENCIAL (erro temporário de servidor)
        ultimaResp = resp;
        if (tentativa < CONFIG_IV.maxTentativas) {
          var esperaMs = CONFIG_IV.backoff5xxMs * Math.pow(2, tentativa - 1); // 3s, 6s, 12s, 24s
          Logger.log("   ⚠️ HTTP " + code + " (tent. " + tentativa + "/" + CONFIG_IV.maxTentativas + ") → aguardando " + (esperaMs/1000) + "s...");
          Utilities.sleep(esperaMs);
          continue;
        }
      } else {
        // Outros códigos (4xx exceto 429) → não vale retentar
        return resp;
      }
    } catch (err) {
      ultimoErro = err;
      if (tentativa < CONFIG_IV.maxTentativas) {
        var esperaMs = CONFIG_IV.backoff5xxMs * Math.pow(2, tentativa - 1);
        Logger.log("   ⚠️ Exceção (tent. " + tentativa + "/" + CONFIG_IV.maxTentativas + "): " + err.message + " → aguardando " + (esperaMs/1000) + "s...");
        Utilities.sleep(esperaMs);
        continue;
      }
    }
  }

  // Esgotou tentativas
  if (ultimaResp) return ultimaResp;
  throw ultimoErro || new Error("Falha após " + CONFIG_IV.maxTentativas + " tentativas");
}

// ========================================
// ⚙️ 4. MOTOR (FILTRO SERVER-SIDE + LOCK + COUNTER + RETRY + THROTTLE)
// ========================================
function motorProcessamentoItensVendidos() {
  Logger.log("⚙️ 3. MOTOR: Ligado!");
  var horaInicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId();
  var sheet = ss.getSheetByName(CONFIG_IV.nomePlanilha);
  var props = PropertiesService.getScriptProperties();

  props.setProperty('LOCK_ITENS_TURBO', 'TRUE');

  var eIdx = parseInt(props.getProperty('IV_IDX_EMP') || "0");
  var pIdx = parseInt(props.getProperty('IV_IDX_PAG') || "1");
  var itensPorPagina = parseInt(props.getProperty('IV_ITENS_PAG') || "10");
  var dtFiltroAPI = props.getProperty('IV_DT_FILTRO') || "01/01/2024";
  var listaEmpresas = JSON.parse(props.getProperty('IV_TARGET_EMPS') || '[]');
  var nextRow = parseInt(props.getProperty('IV_NEXT_ROW') || "2");
  var precisaAgendar = false;

  // 🆕 CONTADOR
  var totalRegistrosCiclo = 0;

  try {
    for (var e = eIdx; e < listaEmpresas.length; e++) {
      var sigla = listaEmpresas[e];
      if (e > eIdx) { pIdx = 1; nextRow = obterUltimaLinhaRealIV(ssId, CONFIG_IV.nomePlanilha) + 1; }
      var empresa = EMPRESAS_OMIE[sigla];
      if (!empresa) continue;

      var continuarPaginacao = true;
      while (continuarPaginacao) {
        if ((new Date().getTime() - horaInicio) > 260000) {
          props.setProperties({'IV_IDX_EMP': e.toString(), 'IV_IDX_PAG': pIdx.toString(), 'IV_NEXT_ROW': nextRow.toString()});
          precisaAgendar = true; continuarPaginacao = false; break;
        }

        Logger.log("   ⬇️ " + sigla + " | Pág " + pIdx + " | L" + nextRow);

        var payload = {
          "call": CONFIG_IV.metodo,
          "app_key": empresa.appKey,
          "app_secret": empresa.appSecret,
          "param": [{ "pagina": pIdx, "registros_por_pagina": itensPorPagina, "apenas_importado_api": "N", "filtrar_por_data_de": dtFiltroAPI }]
        };

        // 🆕 Chamada com retry
        var resp = fetchComRetryIV(CONFIG_IV.url, {
          "method": "post",
          "contentType": "application/json",
          "payload": JSON.stringify(payload),
          "muteHttpExceptions": true
        });

        if (resp.getResponseCode() === 200) {
          var listaPedidos = JSON.parse(resp.getContentText()).pedido_venda_produto || [];
          if (listaPedidos.length === 0) { continuarPaginacao = false; break; }

          var linhasParaGravar = [];
          for (var i = 0; i < listaPedidos.length; i++) {
             var itens = parseItensVendaInterno(listaPedidos[i], sigla);
             if (itens.length > 0) linhasParaGravar = linhasParaGravar.concat(itens);
          }

          if (linhasParaGravar.length > 0) {
             escreverLoteIV(ssId, CONFIG_IV.nomePlanilha, nextRow, linhasParaGravar);
             nextRow += linhasParaGravar.length;
             totalRegistrosCiclo += linhasParaGravar.length; // 🆕 SOMA
             props.setProperty('IV_NEXT_ROW', nextRow.toString());
          }
          if (listaPedidos.length < itensPorPagina) continuarPaginacao = false;
          pIdx++;

          // 🆕 Throttle proativo: pausa entre chamadas p/ não estourar rate limit da Omie
          if (continuarPaginacao) Utilities.sleep(CONFIG_IV.pausaEntreChamadasMs);
        } else {
           // Erro mesmo após retries: aborta este loop e registra
           Logger.log("❌ Erro API persistente após retries: " + resp.getResponseCode() + " | " + resp.getContentText().substring(0, 200));
           continuarPaginacao = false; break;
        }
      }
      if (precisaAgendar) break;
      pIdx = 1;
    }

    if (precisaAgendar) {
      limparGatilhosSafeIV();
      ScriptApp.newTrigger('motorProcessamentoItensVendidos').timeBased().after(60 * 1000).create();
      gravarLogAZ1(sheet, "RETOMADA", nextRow - 2, horaInicio, "Aguardando próxima pág");
    } else {
      props.deleteProperty('LOCK_ITENS_TURBO');
      limparGatilhosSafeIV();
      gravarLogAZ1(sheet, "SUCESSO", nextRow - 2, horaInicio, "Importação concluída");
    }

  } catch (err) {
    gravarLogAZ1(sheet, "ERRO", nextRow - 2, horaInicio, err.message);
    // Em caso de erro, o Orquestrador captura via retorno 0 + Range > 0.
  }

  // 🆕 RETORNA PARA ORQUESTRADOR
  return totalRegistrosCiclo;
}

// ========================================
// 🛠️ AUXILIARES
// ========================================

function gravarLogAZ1(sheet, status, registros, tempoInicio, erroMsg) {
  if (!sheet) return;
  var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM HH:mm");
  var tempoGasto = Math.floor((new Date().getTime() - tempoInicio) / 1000);
  var icone = status === "SUCESSO" ? "✅" : (status === "RETOMADA" ? "⏳" : "❌");

  var textoFinal = icone + " " + status + " | " + agora + " | " + registros + " reg | " + tempoGasto + "s";
  if (erroMsg) textoFinal += " | Obs: " + erroMsg;

  var range = sheet.getRange("AZ1");
  range.setValue(textoFinal);

  var cor = status === "SUCESSO" ? "#d9ead3" : (status === "RETOMADA" ? "#fff2cc" : "#f4cccc");
  range.setBackground(cor).setFontColor("black").setFontWeight("bold");
}

function parseItensVendaInterno(pedido, sigla) {
  var linhas = [], cab = pedido.cabecalho || {}, info = pedido.infoCadastro || {}, itens = pedido.det || [];
  for (var i = 0; i < itens.length; i++) {
    var it = itens[i], prod = it.produto || {}, imp = it.imposto || {}, ide = it.ide || {};
    linhas.push([sigla, cab.codigo_pedido || "", cab.numero_pedido || "", cab.data_previsao || "", cab.codigo_cliente || "", cab.etapa || "", cab.codigo_parcela || "", ide.simples_nacional || "", ide.codigo_item_integracao || "", ide.codigo_item || "", prod.codigo_produto || "", prod.codigo || "", prod.descricao || "", prod.unidade || "", parseFloat(prod.quantidade || 0), parseFloat(prod.valor_unitario || 0), parseFloat(prod.valor_total || 0), prod.ncm || "", prod.tipo_desconto || "", parseFloat(prod.valor_desconto || 0), parseFloat(prod.percentual_desconto || 0), imp.cofins_situacao_tributaria || "", imp.pis_situacao_tributaria || "", imp.icms_origem || "", imp.icms_situacao_tributaria || "", info.dInc || "", info.hInc || "", info.dAlt || "", info.hAlt || ""]);
  }
  return linhas;
}

function escreverLoteIV(ssId, sn, start, values) {
  var rangeA1 = sn + "!A" + start + ":" + (values[0].length > 26 ? "A" + String.fromCharCode(64 + (values[0].length - 26)) : String.fromCharCode(64 + values[0].length)) + (start + values.length - 1);
  Sheets.Spreadsheets.Values.update({range: rangeA1, values: values}, ssId, rangeA1, {valueInputOption: "USER_ENTERED"});
}

function obterUltimaLinhaRealIV(ssId, sn) { try{var r=Sheets.Spreadsheets.Values.get(ssId,sn+"!A:A"); return r.values?r.values.length:1}catch(e){return 1}}

function limparGatilhosSafeIV() {
  var t = ScriptApp.getProjectTriggers();
  for(var i=0; i<t.length; i++) if(t[i].getHandlerFunction()==='motorProcessamentoItensVendidos') ScriptApp.deleteTrigger(t[i]);
}

// =============================
// ⚙️ CONTAS A PAGAR - COM SHEETS API (ULTRA-RÁPIDO)
// Mantém TODOS os nomes de funções originais
// =============================

var MESES_API_ATRAS = 24;      // 📡 janela para a API (emissão) — apanha contratos antigos
var MESES_API_FRENTE = 6;      // 📡 janela para a API (emissão)
var MESES_VENC_ATRAS = 6;      // ✅ filtro LOCAL por vencimento — para trás
var MESES_VENC_FRENTE = 6;     // ✅ filtro LOCAL por vencimento — para a frente

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_CP = {
  url: "https://app.omie.com.br/api/v1/financas/contapagar/",
  nomePlanilha: "ContasPagar",
  spreadsheetId: "",
  registrosPorPagina: 500,
  delayEntrePaginas: 300,
  maxTempoExecucao: 270000,
  maxRetries: 4,
  baseWaitTime: 2,
  batchInsertSize: 2000
};

// =============================
// 🔧 SHEETS API - HELPERS
// =============================

function obterSpreadsheetIdCP() {
  if (!CONFIG_CP.spreadsheetId) {
    CONFIG_CP.spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  }
  return CONFIG_CP.spreadsheetId;
}

function limparPlanilhaCompletaAPI(sheet) {
  Logger.log("🧹 Limpando planilha (Sheets API)...");
  DashboardLogger.log("", "", "🧹 LIMPEZA", "", "", "Limpando dados anteriores");
  try {
    var spreadsheetId = obterSpreadsheetIdCP();
    var range = CONFIG_CP.nomePlanilha + "!A2:AN";
    Sheets.Spreadsheets.Values.clear({}, spreadsheetId, range);
    Logger.log("✅ Planilha limpa (Sheets API)");
  } catch (e) {
    Logger.log("⚠️ Erro ao limpar: " + e.message);
  }
}

function inserirDadosLoteAPI(dados) {
  if (!dados || dados.length === 0) return true;
  try {
    var spreadsheetId = obterSpreadsheetIdCP();
    var rangeCheck = CONFIG_CP.nomePlanilha + "!A:A";
    var resultCheck = Sheets.Spreadsheets.Values.get(spreadsheetId, rangeCheck);
    var ultimaLinha = resultCheck.values ? resultCheck.values.length : 1;
    var range = CONFIG_CP.nomePlanilha + "!A" + (ultimaLinha + 1);
    var resource = { values: dados };
    Sheets.Spreadsheets.Values.append(resource, spreadsheetId, range, { valueInputOption: "RAW" });
    Logger.log("📝 Inseridos " + dados.length + " registros (Sheets API)");
    DashboardLogger.log("", "", "💾 GRAVAÇÃO", "", dados.length, "Lote inserido");
    return true;
  } catch (e) {
    Logger.log("❌ Erro ao inserir (Sheets API): " + e.message);
    DashboardLogger.log("", "", "❌ ERRO", "", "", "Falha na inserção");
    return false;
  }
}

function aplicarFormatacaoDatasCP(sheet) {
  try {
    var colunasDatas = [5, 6, 13, 14];
    for (var col = 0; col < colunasDatas.length; col++) {
      sheet.getRange(2, colunasDatas[col], sheet.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy");
    }
  } catch (e) {
    Logger.log("⚠️ Formatação datas ignorada: " + e.message);
  }
}

// =============================
// 🔒 LOCK DE EXECUÇÃO
// =============================

function adquirirLockExecucao() {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(5000);
    return true;
  } catch (e) {
    Logger.log("⚠️ Outra execução em andamento. Abortando.");
    return false;
  }
}

function liberarLockExecucao() {
  try { LockService.getScriptLock().releaseLock(); } catch (e) {}
}

// =============================
// 📊 SISTEMA DE LOG (DASHBOARD)
// =============================

var DashboardLogger = {
  sheet: null,
  currentRow: 14,
  timezone: null,
  startTime: null,
  buffer: [],

  init: function() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      this.sheet = ss.getSheetByName("🚀 Dashboard");
      if (!this.sheet) this.sheet = ss.insertSheet("🚀 Dashboard", 0);
      this.timezone = ss.getSpreadsheetTimeZone();
      this.startTime = new Date();
      this.currentRow = 14;
      this.buffer = [];
      if (this.sheet.getLastRow() >= 14) {
        this.sheet.getRange(14, 1, 82, 8).clearContent().clearFormat();
      }
      var header = [["⏰ TIMESTAMP", "📊 EMPRESA", "📄 PÁGINA", "📌 STATUS", "🔄 TENTATIVA", "📦 REGISTROS", "⏱️ TEMPO", "💬 MENSAGEM"]];
      this.sheet.getRange(13, 1, 1, 8).setValues(header)
        .setFontWeight("bold").setBackground("#4285F4").setFontColor("#FFFFFF");
      SpreadsheetApp.flush();
      Logger.log("✅ Dashboard Logger inicializado");
      return true;
    } catch (e) {
      Logger.log("⚠️ Dashboard falhou: " + e.message);
      this.sheet = null;
      return false;
    }
  },

  log: function(empresa, pagina, status, tentativa, registros, mensagem) {
    if (!this.sheet || this.currentRow > 95) return;
    try {
      var agora = new Date();
      var timestamp = Utilities.formatDate(agora, this.timezone, "HH:mm:ss");
      var tempoDecorrido = Math.round((agora.getTime() - this.startTime.getTime()) / 1000) + "s";
      var row = [timestamp, empresa || "-", pagina || "-", status, tentativa || "-", registros || "-", tempoDecorrido, mensagem || ""];
      this.sheet.getRange(this.currentRow, 1, 1, 8).setValues([row]);
      var color = "#FFFFFF";
      if (status.indexOf("✅") >= 0) color = "#D9EAD3";
      else if (status.indexOf("⚠️") >= 0) color = "#FFF4C3";
      else if (status.indexOf("❌") >= 0) color = "#F4CCCC";
      else if (status.indexOf("🔄") >= 0) color = "#E3F2FD";
      else if (status.indexOf("⏹️") >= 0) color = "#E8D5F5";
      this.sheet.getRange(this.currentRow, 1, 1, 8).setBackground(color);
      this.currentRow++;
      if (this.currentRow % 5 === 0) SpreadsheetApp.flush();
      Logger.log(timestamp + " | " + status + " | " + mensagem);
    } catch (e) {
      Logger.log("⚠️ Log ignorado: " + e.message);
      this.sheet = null;
    }
  },

  forceFlush: function() { if (this.sheet) { try { SpreadsheetApp.flush(); } catch (e) {} } },
  logInicio: function(msg) { this.log("", "", "🚀 INÍCIO", "", "", msg); },
  logFim: function(total, sucesso) {
    this.log("", "", sucesso ? "✅ CONCLUÍDO" : "❌ ERRO", "", total, "Finalizado");
    this.forceFlush();
  }
};

// =============================
// 🔄 RETRY
// =============================

function RetryFetch(url, params) {
  this.url = url;
  this.params = params || {};
  this.maxRetries = CONFIG_CP.maxRetries;
  this.baseWaitTime = CONFIG_CP.baseWaitTime;
  this.params.muteHttpExceptions = true;

  this.fetch = function(empresa, pagina) {
    for (var attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        var response = UrlFetchApp.fetch(this.url, this.params);
        var statusCode = response.getResponseCode();
        if (statusCode === 200) {
          if (attempt > 0) DashboardLogger.log(empresa, pagina, "✅ SUCESSO", attempt + 1, "", "OK após retry");
          return { success: true, response: response };
        }
        var shouldRetry = [500, 502, 503, 504, 429].indexOf(statusCode) > -1;
        if (!shouldRetry || attempt === this.maxRetries) {
          DashboardLogger.log(empresa, pagina, "❌ ERRO", attempt + 1, "", "HTTP " + statusCode);
          return { success: false, error: "HTTP " + statusCode };
        }
        var waitTime = Math.min(this.baseWaitTime * Math.pow(2, attempt) + Math.random() * 2, 30);
        DashboardLogger.log(empresa, pagina, "⚠️ RETRY", attempt + 1, "", "Aguardando " + waitTime.toFixed(1) + "s");
        Utilities.sleep(waitTime * 1000);
      } catch (erro) {
        if (attempt === this.maxRetries) {
          DashboardLogger.log(empresa, pagina, "❌ ERRO", attempt + 1, "", erro.message);
          return { success: false, error: erro.message };
        }
        Utilities.sleep(Math.min(this.baseWaitTime * Math.pow(2, attempt), 30) * 1000);
      }
    }
    return { success: false, error: "Tentativas excedidas" };
  };
}

// =============================
// FUNÇÕES AUXILIARES
// =============================

function calcularPeriodoVencimento() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = ss.getSpreadsheetTimeZone();
  var hoje = new Date();

  // 📡 Período largo para API (por emissão — apanha contratos antigos como Marcelo)
  var apiInicio = new Date(hoje.getFullYear(), hoje.getMonth() - MESES_API_ATRAS, 1);
  var apiFim    = new Date(hoje.getFullYear(), hoje.getMonth() + MESES_API_FRENTE + 1, 0);

  // ✅ Período restrito para filtro LOCAL (por vencimento)
  var vencInicio = new Date(hoje.getFullYear(), hoje.getMonth() - MESES_VENC_ATRAS, 1);
  var vencFim    = new Date(hoje.getFullYear(), hoje.getMonth() + MESES_VENC_FRENTE + 1, 0);

  var apiInicioStr  = Utilities.formatDate(apiInicio,  timezone, "dd/MM/yyyy");
  var apiFimStr     = Utilities.formatDate(apiFim,     timezone, "dd/MM/yyyy");
  var vencInicioStr = Utilities.formatDate(vencInicio, timezone, "dd/MM/yyyy");
  var vencFimStr    = Utilities.formatDate(vencFim,    timezone, "dd/MM/yyyy");

  Logger.log("📡 PERÍODO API (emissão): " + apiInicioStr + " → " + apiFimStr);
  Logger.log("✅ PERÍODO VENC (local):  " + vencInicioStr + " → " + vencFimStr);
  DashboardLogger.log("", "", "📡 API", "", "", apiInicioStr + " a " + apiFimStr);
  DashboardLogger.log("", "", "✅ VENCIMENTO", "", "", vencInicioStr + " a " + vencFimStr);

  return {
    inicio:     apiInicioStr,   // enviado à API (emissão)
    fim:        apiFimStr,      // enviado à API (emissão)
    vencInicio: vencInicio,     // filtro local por vencimento
    vencFim:    vencFim         // filtro local + early exit
  };
}

function escreverStatus(sheet, mensagem, ehSucesso) {
  if (!sheet) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var timezone = ss.getSpreadsheetTimeZone();
    var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
    sheet.getRange("AO1")
      .setValue((ehSucesso ? "✅ SUCESSO" : "❌ ERRO") + " - " + timestamp + ": " + mensagem)
      .setFontWeight("bold")
      .setBackground(ehSucesso ? "#D9EAD3" : "#F4CCCC")
      .setFontColor(ehSucesso ? "#155724" : "#721C24");
  } catch (e) { Logger.log("⚠️ Status ignorado"); }
}

function limparPlanilhaCompleta(sheet) { limparPlanilhaCompletaAPI(sheet); }
function inserirDadosLote(sheet, dados) { return inserirDadosLoteAPI(dados); }

// =============================
// BUSCAR CONTAS
// =============================

function buscarContasPagarEmpresa(empresa, periodoVencimento) {
  Logger.log("\n📊 Processando: " + empresa.nome);
  DashboardLogger.log(empresa.nome, "", "🔵 INÍCIO", "", "", "Iniciando busca");

  var todasContas = [];
  var pagina = 1;
  var totalPaginas = 1;
  var totalProcessados = 0;
  var totalFiltrados = 0;

  do {
    var payload = {
      "call": "ListarContasPagar",
      "app_key": empresa.appKey,
      "app_secret": empresa.appSecret,
      "param": [{
        "pagina": pagina,
        "registros_por_pagina": CONFIG_CP.registrosPorPagina,
        "apenas_importado_api": "N",
        "ordenar_por": "DATA_VENCIMENTO",
        "filtrar_por_data_de": periodoVencimento.inicio,
        "filtrar_por_data_ate": periodoVencimento.fim
      }]
    };

    var options = {
      "method": "post",
      "headers": {"User-Agent": "Google-Apps-Script/Omie-CP"},
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    DashboardLogger.log(empresa.nome, pagina + "/" + totalPaginas, "🔄 BUSCANDO", "1", "", "Requisitando API");

    var retryFetch = new RetryFetch(CONFIG_CP.url, options);
    var result = retryFetch.fetch(empresa.nome, pagina + "/" + totalPaginas);

    if (!result.success) {
      Logger.log("❌ Falha: " + result.error);
      DashboardLogger.log(empresa.nome, pagina, "❌ FALHA", "", "", "Interrompendo");
      break;
    }

    try {
      var data = JSON.parse(result.response.getContentText());
      totalPaginas = data.total_de_paginas || 1;
      var contas = data.conta_pagar_cadastro || [];
      var paginaTemContaNoRange = false;

      for (var i = 0; i < contas.length; i++) {
        var c = contas[i];

        // ✅ FILTRO LOCAL: aceita apenas vencimentos dentro do range restrito
        if (c.data_vencimento) {
          var partes = c.data_vencimento.split("/");
          if (partes.length === 3) {
            var dataVenc = new Date(parseInt(partes[2]), parseInt(partes[1]) - 1, parseInt(partes[0]));
            if (dataVenc < periodoVencimento.vencInicio || dataVenc > periodoVencimento.vencFim) {
              totalFiltrados++;
              continue;
            }
          }
        }

        paginaTemContaNoRange = true;
        var info = c.info || {};
        var categorias = Array.isArray(c.categorias) ? c.categorias.map(function(cat) { return cat.codigo_categoria || ""; }).join("; ") : "";

        todasContas.push([
          empresa.nome, String(c.codigo_lancamento_omie || ""), String(c.codigo_lancamento_integracao || ""),
          String(c.codigo_cliente_fornecedor || ""), c.data_vencimento || "", c.data_previsao || "",
          c.valor_documento || "", c.valor_pago || "", c.codigo_categoria || "", categorias,
          c.id_conta_corrente || "", c.numero_documento_fiscal || "", c.data_emissao || "",
          c.data_entrada || "", c.codigo_projeto || "", c.numero_pedido || "", c.numero_documento || "",
          c.numero_parcela || "", c.chave_nfe || "", c.status_titulo || "", c.id_origem || "",
          c.observacao || "", c.valor_pis || "", c.retem_pis || "", c.valor_cofins || "",
          c.retem_cofins || "", c.valor_csll || "", c.retem_csll || "", c.valor_ir || "",
          c.retem_ir || "", c.valor_iss || "", c.retem_iss || "", c.valor_inss || "",
          c.retem_inss || "", info.dInc || "", info.hInc || "", info.uInc || "",
          info.dAlt || "", info.hAlt || "", info.uAlt || ""
        ]);
        totalProcessados++;
      }

      // ✅ EARLY EXIT: para quando todos os vencimentos da página já passaram do vencFim
      var ultimaConta = contas[contas.length - 1];
      if (ultimaConta && ultimaConta.data_vencimento && !paginaTemContaNoRange) {
        var partesUlt = ultimaConta.data_vencimento.split("/");
        if (partesUlt.length === 3) {
          var dataUltVenc = new Date(parseInt(partesUlt[2]), parseInt(partesUlt[1]) - 1, parseInt(partesUlt[0]));
          if (dataUltVenc > periodoVencimento.vencFim) {
            DashboardLogger.log(empresa.nome, pagina + "/" + totalPaginas, "⏹️ EARLY EXIT", "", totalProcessados, "Vencimentos além do range — parando");
            Logger.log("⏹️ Early exit em página " + pagina + " — venc além de " + ultimaConta.data_vencimento);
            break;
          }
        }
      }

      DashboardLogger.log(empresa.nome, pagina + "/" + totalPaginas, "✅ SUCESSO", "1", totalProcessados, "Aceites: " + totalProcessados + " | Filtrados: " + totalFiltrados);

      pagina++;
      if (pagina <= totalPaginas) Utilities.sleep(CONFIG_CP.delayEntrePaginas);

    } catch (erro) {
      Logger.log("❌ Erro: " + erro.message);
      DashboardLogger.log(empresa.nome, pagina, "❌ ERRO", "", "", "Erro JSON");
      break;
    }

  } while (pagina <= totalPaginas);

  Logger.log("✅ " + empresa.nome + " — Aceites: " + totalProcessados + " | Filtrados: " + totalFiltrados);
  DashboardLogger.log(empresa.nome, "", "✅ COMPLETO", "", totalProcessados, "Filtrados: " + totalFiltrados);
  return todasContas;
}

// =============================
// ✅ FUNÇÃO PRINCIPAL (NOME ORIGINAL)
// =============================

function atualizarContasPagar_Simples() {
  if (!adquirirLockExecucao()) {
    Logger.log("❌ Abortado: outra execução em andamento");
    return;
  }

  var horaInicio = new Date().getTime();

  try {
    Logger.log("╔═══════════════════════════════════════╗");
    Logger.log("║ 🚀 CONTAS A PAGAR - SHEETS API        ║");
    Logger.log("╚═══════════════════════════════════════╝\n");

    DashboardLogger.init();
    DashboardLogger.logInicio("Iniciando atualização (Sheets API)");

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CP.nomePlanilha);

    if (!sheet) {
      Logger.log("❌ Execute primeiro: criarPlanilhaContasPagar()");
      DashboardLogger.log("", "", "❌ ERRO", "", "", "Planilha não encontrada");
      liberarLockExecucao();
      return;
    }

    CONFIG_CP.spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();

    var periodoVencimento = calcularPeriodoVencimento();
    limparPlanilhaCompleta(sheet);

    var todosDados = [];
    var empresas = Object.keys(EMPRESAS_OMIE);

    for (var i = 0; i < empresas.length; i++) {
      var contasEmpresa = buscarContasPagarEmpresa(EMPRESAS_OMIE[empresas[i]], periodoVencimento);
      for (var j = 0; j < contasEmpresa.length; j++) {
        todosDados.push(contasEmpresa[j]);
      }
      if (todosDados.length >= CONFIG_CP.batchInsertSize) {
        inserirDadosLote(sheet, todosDados);
        todosDados = [];
      }
    }

    if (todosDados.length > 0) {
      inserirDadosLote(sheet, todosDados);
    }

    aplicarFormatacaoDatasCP(sheet);

    var totalLinhas = 0;
    try {
      var spreadsheetId = obterSpreadsheetIdCP();
      var rangeCheck = CONFIG_CP.nomePlanilha + "!A:A";
      var resultCheck = Sheets.Spreadsheets.Values.get(spreadsheetId, rangeCheck);
      totalLinhas = resultCheck.values ? resultCheck.values.length - 1 : 0;
    } catch (e) {
      totalLinhas = sheet.getLastRow() - 1;
    }

    var tempoTotal = Math.round((new Date().getTime() - horaInicio) / 1000);
    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

    Logger.log("\n✅ CONCLUÍDO: " + totalLinhas + " registros em " + tempoTotal + "s");
    Logger.log("🚀 Velocidade: " + Math.round(totalLinhas / tempoTotal) + " registros/s");

    DashboardLogger.logFim(totalLinhas, true);
    escreverStatus(sheet, totalLinhas + " registros | Venc: " +
      Utilities.formatDate(periodoVencimento.vencInicio, tz, "dd/MM/yyyy") + " a " +
      Utilities.formatDate(periodoVencimento.vencFim, tz, "dd/MM/yyyy") + " | " + tempoTotal + "s", true);

  } catch (erro) {
    Logger.log("❌ Erro: " + erro.message);
    DashboardLogger.log("", "", "❌ ERRO", "", "", erro.message);
    DashboardLogger.logFim(0, false);
    try {
      var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CP.nomePlanilha);
      if (sheet) escreverStatus(sheet, "Erro: " + erro.message, false);
    } catch (e) {}
  } finally {
    liberarLockExecucao();
  }
}

// =============================
// ✅ CRIAR PLANILHA (NOME ORIGINAL)
// =============================

function criarPlanilhaContasPagar() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_CP.nomePlanilha);

  if (sheet) {
    var ui = SpreadsheetApp.getUi();
    var resp = ui.alert("Planilha existe. Deletar?", ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    ss.deleteSheet(sheet);
    SpreadsheetApp.flush();
    Utilities.sleep(1000);
  }

  sheet = ss.insertSheet(CONFIG_CP.nomePlanilha);
  CONFIG_CP.spreadsheetId = ss.getId();

  var cabecalho = [
    "empresa", "codigo_lancamento_omie", "codigo_lancamento_integracao", "codigo_cliente_fornecedor",
    "data_vencimento", "data_previsao", "valor_documento", "valor_pago", "codigo_categoria", "categorias_rateio",
    "id_conta_corrente", "numero_documento_fiscal", "data_emissao", "data_entrada", "codigo_projeto",
    "numero_pedido", "numero_documento", "numero_parcela", "chave_nfe", "status_titulo", "id_origem", "observacao",
    "valor_pis", "retem_pis", "valor_cofins", "retem_cofins", "valor_csll", "retem_csll", "valor_ir", "retem_ir",
    "valor_iss", "retem_iss", "valor_inss", "retem_inss", "info_dInc", "info_hInc", "info_uInc",
    "info_dAlt", "info_hAlt", "info_uAlt"
  ];

  sheet.getRange(1, 1, 1, 40).setValues([cabecalho])
    .setFontWeight("bold").setBackground("#57BB8A").setFontColor("#FFFFFF").setHorizontalAlignment("center");
  sheet.getRange(1, 41).setValue("Status").setFontWeight("bold").setBackground("#17A2B8").setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.getRange("B:B").setNumberFormat("@");
  sheet.autoResizeColumns(1, 41);
  SpreadsheetApp.flush();

  Logger.log("✅ Planilha '" + CONFIG_CP.nomePlanilha + "' criada!");
  ss.toast("Planilha criada!", "✅", 3);
}

// =============================
// ✅ TRIGGER (NOME ORIGINAL)
// =============================

function criarTriggerDiario() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'atualizarContasPagar_Simples') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('atualizarContasPagar_Simples').timeBased().everyDays(1).atHour(9).create();
  Logger.log("✅ Trigger diário criado para 9h");
}

// =============================
// ✅ REFRESH TOTAL (NOME ORIGINAL)
// =============================

function refreshTotalContasPagar() {
  Logger.clear();
  Logger.log("╔═══════════════════════════════════════════════════════╗");
  Logger.log("║   REFRESH TOTAL - CONTAS A PAGAR (SHEETS API)        ║");
  Logger.log("╚═══════════════════════════════════════════════════════╝\n");

  if (!adquirirLockExecucao()) {
    Logger.log("❌ Outra execução em andamento. Aguarde.");
    return;
  }

  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(CONFIG_CP.nomePlanilha);

    if (sheet) {
      Logger.log("[PASSO 1/3] Deletando aba '" + CONFIG_CP.nomePlanilha + "'...");
      ss.deleteSheet(sheet);
      SpreadsheetApp.flush();
      Utilities.sleep(1000);
      Logger.log("  ✅ Aba deletada\n");
    } else {
      Logger.log("[PASSO 1/3] Aba não existe (primeira execução)\n");
    }

    Logger.log("[PASSO 2/3] Recriando aba...");
    sheet = ss.insertSheet(CONFIG_CP.nomePlanilha);
    CONFIG_CP.spreadsheetId = ss.getId();

    var cabecalho = [
      "empresa", "codigo_lancamento_omie", "codigo_lancamento_integracao", "codigo_cliente_fornecedor",
      "data_vencimento", "data_previsao", "valor_documento", "valor_pago", "codigo_categoria", "categorias_rateio",
      "id_conta_corrente", "numero_documento_fiscal", "data_emissao", "data_entrada", "codigo_projeto",
      "numero_pedido", "numero_documento", "numero_parcela", "chave_nfe", "status_titulo", "id_origem", "observacao",
      "valor_pis", "retem_pis", "valor_cofins", "retem_cofins", "valor_csll", "retem_csll", "valor_ir", "retem_ir",
      "valor_iss", "retem_iss", "valor_inss", "retem_inss", "info_dInc", "info_hInc", "info_uInc",
      "info_dAlt", "info_hAlt", "info_uAlt"
    ];

    sheet.getRange(1, 1, 1, 40).setValues([cabecalho])
      .setFontWeight("bold").setBackground("#57BB8A").setFontColor("#FFFFFF").setHorizontalAlignment("center");
    sheet.getRange(1, 41).setValue("Status").setFontWeight("bold").setBackground("#17A2B8").setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    sheet.getRange("B:B").setNumberFormat("@");
    sheet.autoResizeColumns(1, 41);
    SpreadsheetApp.flush();
    Logger.log("  ✅ Aba recriada\n");

    Logger.log("[PASSO 3/3] Importando dados...\n");
    liberarLockExecucao();
    atualizarContasPagar_Simples();

    Logger.log("\n╔═══════════════════════════════════════════════════════╗");
    Logger.log("║   REFRESH TOTAL CONCLUÍDO!                            ║");
    Logger.log("╚═══════════════════════════════════════════════════════╝");

  } catch (erro) {
    Logger.log("\n❌ ERRO DURANTE REFRESH: " + erro.message);
    liberarLockExecucao();
    try {
      if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CP.nomePlanilha)) criarPlanilhaContasPagar();
    } catch (e) {
      Logger.log("❌ Falha ao criar aba de emergência: " + e.message);
    }
  }
}

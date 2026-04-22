// ========================================
// ⚙️ CONTAS A RECEBER - COM SHEETS API (ULTRA-RÁPIDO)
// Mantém TODOS os nomes de funções originais
// ========================================

var MESES_API_ATRAS_CR = 24;     // 📡 janela para a API (emissão) — apanha contratos antigos
var MESES_API_FRENTE_CR = 12;    // 📡 janela para a API (emissão)
var MESES_VENC_ATRAS_CR = 6;     // ✅ filtro LOCAL por vencimento — para trás
var MESES_VENC_FRENTE_CR = 12;   // ✅ filtro LOCAL por vencimento — para a frente

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_CR = {
  url: "https://app.omie.com.br/api/v1/financas/contareceber/",
  nomePlanilha: "ContasReceber",
  spreadsheetId: "",
  registrosPorPagina: 500,     // ✅ aumentado de 100→500
  delayEntrePaginas: 300,      // ✅ reduzido de 1000→300ms
  maxTempoExecucao: 270000,
  maxRetries: 4,
  baseWaitTime: 2,
  dashboardSheet: "🚀 Dashboard",
  logStartRow: 100,
  batchInsertSize: 2000
};

// ========================================
// 🔧 SHEETS API - HELPERS
// ========================================

function obterSpreadsheetIdCR() {
  if (!CONFIG_CR.spreadsheetId) {
    CONFIG_CR.spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();
  }
  return CONFIG_CR.spreadsheetId;
}

function limparPlanilhaCompletaCRAPI(sheet) {
  Logger.log("🧹 Limpando planilha completa (Sheets API)...");
  DashboardLoggerCR.log("", "", "🧹 LIMPEZA", "", "", "Limpando dados anteriores...");
  try {
    var spreadsheetId = obterSpreadsheetIdCR();
    var range = CONFIG_CR.nomePlanilha + "!A2:AQ";
    Sheets.Spreadsheets.Values.clear({}, spreadsheetId, range);
    Logger.log("✅ Planilha limpa (Sheets API)");
  } catch (e) {
    Logger.log("⚠️ Erro ao limpar: " + e.message);
  }
}

function inserirDadosLoteCRAPI(dados) {
  if (!dados || dados.length === 0) return true;
  try {
    Logger.log("📝 Inserindo " + dados.length + " registros (Sheets API)...");
    DashboardLoggerCR.log("", "", "💾 GRAVAÇÃO", "", dados.length, "Inserindo lote (Sheets API)");
    var spreadsheetId = obterSpreadsheetIdCR();
    var rangeCheck = CONFIG_CR.nomePlanilha + "!A:A";
    var resultCheck = Sheets.Spreadsheets.Values.get(spreadsheetId, rangeCheck);
    var ultimaLinha = resultCheck.values ? resultCheck.values.length : 1;
    var range = CONFIG_CR.nomePlanilha + "!A" + (ultimaLinha + 1);
    var resource = { values: dados };
    Sheets.Spreadsheets.Values.append(resource, spreadsheetId, range, { valueInputOption: "RAW" });
    Logger.log("✅ Inseridos " + dados.length + " registros (Sheets API)");
    return true;
  } catch (e) {
    Logger.log("❌ Erro ao inserir (Sheets API): " + e.message);
    DashboardLoggerCR.log("", "", "❌ ERRO", "", "", "Erro ao inserir: " + e.message);
    return false;
  }
}

function aplicarFormatacaoDatasCR(sheet) {
  try {
    var colunasDatas = [5, 6, 16];
    for (var col = 0; col < colunasDatas.length; col++) {
      sheet.getRange(2, colunasDatas[col], sheet.getMaxRows() - 1, 1).setNumberFormat("dd/mm/yyyy");
    }
  } catch (e) {
    Logger.log("⚠️ Formatação datas ignorada: " + e.message);
  }
}

function limparPlanilhaCompletaCR(sheet) { limparPlanilhaCompletaCRAPI(sheet); }
function inserirDadosLoteCR(sheet, dados) { return inserirDadosLoteCRAPI(dados); }

// ========================================
// 📊 SISTEMA DE LOG EM TEMPO REAL (A100)
// ========================================

var DashboardLoggerCR = {
  sheet: null,
  currentRow: CONFIG_CR.logStartRow,
  timezone: null,
  startTime: null,

  init: function() {
    try {
      var ss = SpreadsheetApp.getActiveSpreadsheet();
      this.sheet = ss.getSheetByName(CONFIG_CR.dashboardSheet);
      this.timezone = ss.getSpreadsheetTimeZone();
      this.startTime = new Date();
      if (!this.sheet) {
        Logger.log("⚠️ Aba '" + CONFIG_CR.dashboardSheet + "' não encontrada. Criando...");
        this.sheet = ss.insertSheet(CONFIG_CR.dashboardSheet, 0);
      }
      var maxRows = this.sheet.getMaxRows();
      var maxCols = this.sheet.getMaxColumns();
      if (maxRows >= CONFIG_CR.logStartRow) {
        var linhasParaLimpar = maxRows - CONFIG_CR.logStartRow + 1;
        this.sheet.getRange(CONFIG_CR.logStartRow, 1, linhasParaLimpar, maxCols)
          .clearContent().clearFormat().setBackground("#FFFFFF");
      }
      this.currentRow = CONFIG_CR.logStartRow;
      this.writeHeader();
      Logger.log("✅ Dashboard Logger CR inicializado");
      Logger.log("   📍 Logs começam em: A" + CONFIG_CR.logStartRow);
      Logger.log("   🕐 Timezone: " + this.timezone);
    } catch (e) {
      Logger.log("⚠️ Erro ao inicializar Dashboard Logger CR: " + e.message);
      this.sheet = null;
    }
  },

  writeHeader: function() {
    if (!this.sheet) return;
    var header = [["⏰ TIMESTAMP", "📊 EMPRESA", "📄 PÁGINA", "📌 STATUS", "🔄 TENTATIVA", "📦 REGISTROS", "⏱️ TEMPO", "💬 MENSAGEM"]];
    this.sheet.getRange(this.currentRow - 1, 1, 1, 8).setValues(header)
      .setFontWeight("bold").setBackground("#FF9800").setFontColor("#FFFFFF").setHorizontalAlignment("center");
    SpreadsheetApp.flush();
  },

  log: function(empresa, pagina, status, tentativa, registros, mensagem) {
    if (!this.sheet) return;
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
      SpreadsheetApp.flush();
      Logger.log(timestamp + " | " + status + " | " + mensagem);
    } catch (e) {
      Logger.log("⚠️ Erro ao escrever log: " + e.message);
    }
  },

  logInicio: function(mensagem) { this.log("", "", "🚀 INÍCIO CR", "", "", mensagem); },
  logFim: function(totalRegistros, sucesso) {
    this.log("", "", sucesso ? "✅ CONCLUÍDO CR" : "❌ ERRO CR", "", totalRegistros, "Processamento finalizado");
  }
};

// ========================================
// 🔄 CLASSE DE RETRY
// ========================================

function RetryFetchCR(url, params, maxRetries) {
  this.url = url;
  this.params = params || {};
  this.maxRetries = maxRetries || CONFIG_CR.maxRetries;
  this.baseWaitTime = CONFIG_CR.baseWaitTime;
  if (!this.params.muteHttpExceptions) this.params.muteHttpExceptions = true;

  this.fetch = function(empresa, pagina) {
    for (var attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        var response = UrlFetchApp.fetch(this.url, this.params);
        var statusCode = response.getResponseCode();
        if (statusCode === 200) {
          if (attempt > 0) DashboardLoggerCR.log(empresa, pagina, "✅ SUCESSO", attempt + 1, "", "OK após " + attempt + " tentativas");
          return { success: true, response: response };
        }
        var shouldRetry = [500, 502, 503, 504, 429].indexOf(statusCode) > -1;
        if (!shouldRetry || attempt === this.maxRetries) {
          var errorMsg = "HTTP " + statusCode + " - " + response.getContentText().substring(0, 200);
          DashboardLoggerCR.log(empresa, pagina, "❌ ERRO", attempt + 1, "", errorMsg);
          return { success: false, error: errorMsg, statusCode: statusCode };
        }
        var waitTime = Math.min(this.baseWaitTime * Math.pow(2, attempt) + Math.random() * 2, 30);
        DashboardLoggerCR.log(empresa, pagina, "⚠️ RETRY", attempt + 1, "", "Aguardando " + waitTime.toFixed(1) + "s");
        Utilities.sleep(waitTime * 1000);
      } catch (erro) {
        if (attempt === this.maxRetries) {
          DashboardLoggerCR.log(empresa, pagina, "❌ ERRO", attempt + 1, "", erro.message);
          return { success: false, error: erro.message };
        }
        Utilities.sleep(Math.min(this.baseWaitTime * Math.pow(2, attempt), 30) * 1000);
      }
    }
    return { success: false, error: "Número máximo de tentativas excedido" };
  };
}

// ========================================
// FUNÇÕES AUXILIARES
// ========================================

function calcularPeriodoVencimentoCR() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var timezone = ss.getSpreadsheetTimeZone();
  var hoje = new Date();

  // 📡 Período largo para API (por emissão — apanha contratos antigos)
  var apiInicio = new Date(hoje.getFullYear(), hoje.getMonth() - MESES_API_ATRAS_CR, 1);
  var apiFim    = new Date(hoje.getFullYear(), hoje.getMonth() + MESES_API_FRENTE_CR + 1, 0);

  // ✅ Período restrito para filtro LOCAL (por vencimento)
  var vencInicio = new Date(hoje.getFullYear(), hoje.getMonth() - MESES_VENC_ATRAS_CR, 1);
  var vencFim    = new Date(hoje.getFullYear(), hoje.getMonth() + MESES_VENC_FRENTE_CR + 1, 0);

  var apiInicioStr  = Utilities.formatDate(apiInicio,  timezone, "dd/MM/yyyy");
  var apiFimStr     = Utilities.formatDate(apiFim,     timezone, "dd/MM/yyyy");
  var vencInicioStr = Utilities.formatDate(vencInicio, timezone, "dd/MM/yyyy");
  var vencFimStr    = Utilities.formatDate(vencFim,    timezone, "dd/MM/yyyy");

  Logger.log("\n" + "=".repeat(60));
  Logger.log("📅 PERÍODO DE VENCIMENTO (RECEBER)");
  Logger.log("=".repeat(60));
  Logger.log("📡 API (emissão): " + apiInicioStr + " → " + apiFimStr);
  Logger.log("✅ VENC (local):  " + vencInicioStr + " → " + vencFimStr);
  Logger.log("=".repeat(60) + "\n");

  DashboardLoggerCR.log("", "", "📡 API", "", "", apiInicioStr + " a " + apiFimStr);
  DashboardLoggerCR.log("", "", "✅ VENCIMENTO", "", "", vencInicioStr + " a " + vencFimStr);

  return {
    inicio:     apiInicioStr,   // enviado à API (emissão)
    fim:        apiFimStr,      // enviado à API (emissão)
    vencInicio: vencInicio,     // filtro local por vencimento
    vencFim:    vencFim         // filtro local + early exit
  };
}

function escreverStatusCR(sheet, mensagem, ehSucesso) {
  if (!sheet) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var timezone = ss.getSpreadsheetTimeZone();
    var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
    var celulaStatus = sheet.getRange("AR1");
    celulaStatus.setValue((ehSucesso ? "✅ SUCESSO" : "❌ ERRO") + " - " + timestamp + ": " + mensagem)
      .setFontWeight("bold")
      .setBackground(ehSucesso ? "#D9EAD3" : "#F4CCCC")
      .setFontColor(ehSucesso ? "#155724" : "#721C24");
  } catch (e) {
    Logger.log("⚠️ Erro ao escrever status: " + e.message);
  }
}

// ========================================
// BUSCAR CONTAS
// ========================================

function buscarContasReceberEmpresa(empresa, periodoVencimento) {
  Logger.log("\n📊 Processando empresa: " + empresa.nome);
  DashboardLoggerCR.log(empresa.nome, "", "🔵 INÍCIO", "", "", "Iniciando busca de contas a receber");

  var todasContas = [];
  var pagina = 1;
  var totalPaginas = 1;
  var totalProcessados = 0;
  var totalFiltrados = 0;

  do {
    var payload = {
      "call": "ListarContasReceber",
      "app_key": empresa.appKey,
      "app_secret": empresa.appSecret,
      "param": [{
        "pagina": pagina,
        "registros_por_pagina": CONFIG_CR.registrosPorPagina,
        "apenas_importado_api": "N",
        "ordenar_por": "DATA_VENCIMENTO",
        "filtrar_por_data_de": periodoVencimento.inicio,
        "filtrar_por_data_ate": periodoVencimento.fim
      }]
    };

    var options = {
      "method": "post",
      "headers": {"User-Agent": "Google-Apps-Script/Omie-CR-Retry"},
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    DashboardLoggerCR.log(empresa.nome, pagina + "/" + totalPaginas, "🔄 BUSCANDO", "1", "", "Requisitando dados da API Omie...");

    var retryFetch = new RetryFetchCR(CONFIG_CR.url, options);
    var result = retryFetch.fetch(empresa.nome, pagina + "/" + totalPaginas);

    if (!result.success) {
      Logger.log("❌ Falha após tentativas: " + result.error);
      DashboardLoggerCR.log(empresa.nome, pagina, "❌ FALHA", "", "", "Interrompendo empresa");
      break;
    }

    try {
      var data = JSON.parse(result.response.getContentText());
      totalPaginas = data.total_de_paginas || 1;
      var contas = data.conta_receber_cadastro || [];
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
        var boleto = c.boleto || {};
        var categorias = Array.isArray(c.categorias) ?
          c.categorias.map(function(cat) { return cat.codigo_categoria || ""; }).join("; ") : "";

        todasContas.push([
          empresa.nome, String(c.codigo_lancamento_omie || ""),
          String(c.codigo_lancamento_integracao || ""),
          String(c.codigo_cliente_fornecedor || ""), c.data_vencimento || "",
          c.data_previsao || "", c.valor_documento || "", c.codigo_categoria || "",
          categorias, c.id_conta_corrente || "", c.numero_documento || "",
          c.numero_parcela || "", c.numero_documento_fiscal || "",
          c.numero_pedido || "", c.chave_nfe || "", c.data_emissao || "",
          c.id_origem || "", c.codigo_projeto || "", c.codigo_vendedor || "",
          c.status_titulo || "", c.observacao || "", c.valor_pis || "",
          c.retem_pis || "", c.valor_cofins || "", c.retem_cofins || "",
          c.valor_csll || "", c.retem_csll || "", c.valor_ir || "",
          c.retem_ir || "", c.valor_iss || "", c.retem_iss || "",
          c.valor_inss || "", c.retem_inss || "", boleto.cGerado || "",
          boleto.dDtEmBol || "", boleto.cNumBoleto || "", boleto.cNumBancario || "",
          info.dInc || "", info.hInc || "", info.uInc || "",
          info.dAlt || "", info.hAlt || "", info.uAlt || ""
        ]);
        totalProcessados++;
      }

      // ✅ EARLY EXIT: para quando todos os vencimentos da página passaram do vencFim
      var ultimaConta = contas[contas.length - 1];
      if (ultimaConta && ultimaConta.data_vencimento && !paginaTemContaNoRange) {
        var partesUlt = ultimaConta.data_vencimento.split("/");
        if (partesUlt.length === 3) {
          var dataUltVenc = new Date(parseInt(partesUlt[2]), parseInt(partesUlt[1]) - 1, parseInt(partesUlt[0]));
          if (dataUltVenc > periodoVencimento.vencFim) {
            DashboardLoggerCR.log(empresa.nome, pagina + "/" + totalPaginas, "⏹️ EARLY EXIT", "", totalProcessados, "Vencimentos além do range — parando");
            Logger.log("⏹️ Early exit em página " + pagina + " — venc além de " + ultimaConta.data_vencimento);
            break;
          }
        }
      }

      DashboardLoggerCR.log(empresa.nome, pagina + "/" + totalPaginas, "✅ SUCESSO", "1",
        totalProcessados, "Aceites: " + totalProcessados + " | Filtrados: " + totalFiltrados);

      Logger.log("  ✅ Pág " + pagina + "/" + totalPaginas +
        " | Aceites: " + totalProcessados + " | Filtrados: " + totalFiltrados);

      pagina++;
      if (pagina <= totalPaginas) Utilities.sleep(CONFIG_CR.delayEntrePaginas);

    } catch (erro) {
      Logger.log("❌ Erro ao processar resposta: " + erro.message);
      DashboardLoggerCR.log(empresa.nome, pagina, "❌ ERRO", "", "", "Erro ao processar JSON: " + erro.message);
      break;
    }

  } while (pagina <= totalPaginas);

  Logger.log("✅ " + empresa.nome + " — Aceites: " + totalProcessados + " | Filtrados: " + totalFiltrados);
  DashboardLoggerCR.log(empresa.nome, "", "✅ COMPLETO", "", totalProcessados, "Filtrados: " + totalFiltrados);
  return todasContas;
}

// ========================================
// ✅ FUNÇÃO PRINCIPAL (NOME ORIGINAL)
// ========================================

function atualizarContasReceber_Simples() {
  var horaInicio = new Date().getTime();

  Logger.log("╔═══════════════════════════════════════╗");
  Logger.log("║ 🚀 CONTAS A RECEBER - SHEETS API      ║");
  Logger.log("╚═══════════════════════════════════════╝\n");

  DashboardLoggerCR.init();
  DashboardLoggerCR.logInicio("Iniciando atualização completa (Sheets API)");

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CR.nomePlanilha);

  if (!sheet) {
    Logger.log("❌ Execute primeiro: criarPlanilhaContasReceber()");
    DashboardLoggerCR.log("", "", "❌ ERRO", "", "", "Planilha não encontrada");
    return;
  }

  CONFIG_CR.spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();

  try {
    var periodoVencimento = calcularPeriodoVencimentoCR();
    limparPlanilhaCompletaCR(sheet);

    var todosDados = [];
    var empresas = Object.keys(EMPRESAS_OMIE);

    for (var i = 0; i < empresas.length; i++) {
      var siglaEmpresa = empresas[i];
      var empresaObj = EMPRESAS_OMIE[siglaEmpresa];
      var contasEmpresa = buscarContasReceberEmpresa(empresaObj, periodoVencimento);

      Logger.log("📊 " + siglaEmpresa + ": " + contasEmpresa.length + " registros aceites");

      for (var j = 0; j < contasEmpresa.length; j++) {
        todosDados.push(contasEmpresa[j]);
        if (todosDados.length >= CONFIG_CR.batchInsertSize) {
          Logger.log("📦 Inserindo lote de " + todosDados.length + " registros...");
          if (!inserirDadosLoteCR(sheet, todosDados)) Logger.log("❌ Falha ao inserir lote");
          todosDados = [];
        }
      }

      Logger.log("✅ " + siglaEmpresa + " completo. Array atual: " + todosDados.length + " registros");
    }

    if (todosDados.length > 0) {
      Logger.log("📦 Inserindo lote final de " + todosDados.length + " registros...");
      inserirDadosLoteCR(sheet, todosDados);
    }

    aplicarFormatacaoDatasCR(sheet);

    var totalLinhas = 0;
    try {
      var spreadsheetId = obterSpreadsheetIdCR();
      var rangeCheck = CONFIG_CR.nomePlanilha + "!A:A";
      var resultCheck = Sheets.Spreadsheets.Values.get(spreadsheetId, rangeCheck);
      totalLinhas = resultCheck.values ? resultCheck.values.length - 1 : 0;
    } catch (e) {
      totalLinhas = sheet.getLastRow() - 1;
    }

    var tempoTotal = Math.round((new Date().getTime() - horaInicio) / 1000);
    var tz = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone();

    Logger.log("\n✅ CONCLUÍDO: " + totalLinhas + " registros em " + tempoTotal + "s");
    Logger.log("🚀 Velocidade: " + Math.round(totalLinhas / tempoTotal) + " registros/s (Sheets API)");

    DashboardLoggerCR.logFim(totalLinhas, true);
    escreverStatusCR(sheet, totalLinhas + " registros | Venc: " +
      Utilities.formatDate(periodoVencimento.vencInicio, tz, "dd/MM/yyyy") + " a " +
      Utilities.formatDate(periodoVencimento.vencFim, tz, "dd/MM/yyyy") + " | " + tempoTotal + "s", true);

  } catch (erro) {
    Logger.log("❌ Erro: " + erro.message);
    Logger.log(erro.stack);
    DashboardLoggerCR.log("", "", "❌ ERRO GERAL", "", "", erro.message);
    DashboardLoggerCR.logFim(0, false);
    escreverStatusCR(sheet, "Erro: " + erro.message, false);
  }
}

// ========================================
// TIMESTAMP INCREMENTAL
// ========================================

function salvarTimestampIncrementalCR() {
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var agora = new Date();
    var unixTime = agora.getTime();
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var timezone = ss.getSpreadsheetTimeZone();
    var timestampBrasil = Utilities.formatDate(agora, timezone, "dd/MM/yyyy HH:mm:ss");
    scriptProps.setProperty('CR_Incremental_UnixTime', String(unixTime));
    scriptProps.setProperty('CR_Incremental_Display', timestampBrasil);
    Logger.log("💾 Timestamp incremental CR salvo: " + timestampBrasil);
    return unixTime;
  } catch (e) {
    Logger.log("⚠️ Erro ao salvar timestamp: " + e.message);
    return null;
  }
}

function obterTimestampIncrementalCR() {
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var unixTime = scriptProps.getProperty('CR_Incremental_UnixTime');
    var display = scriptProps.getProperty('CR_Incremental_Display');
    if (unixTime) {
      Logger.log("📅 Última sync incremental CR: " + display);
      return parseInt(unixTime);
    } else {
      Logger.log("📅 Primeira sync incremental CR (sem timestamp anterior)");
      return null;
    }
  } catch (e) {
    Logger.log("⚠️ Erro ao obter timestamp: " + e.message);
    return null;
  }
}

function resetarTimestampIncrementalCR() {
  var scriptProps = PropertiesService.getScriptProperties();
  scriptProps.deleteProperty('CR_Incremental_UnixTime');
  scriptProps.deleteProperty('CR_Incremental_Display');
  Logger.log("🧹 Timestamp incremental CR resetado");
}

function contaNovaOuAlteradaDepoisCR(conta, unixTimeUltimaSync) {
  if (!unixTimeUltimaSync) return true;
  var info = conta.info || {};
  var dataAlt = info.dAlt || "";
  var horaAlt = info.hAlt || "";
  var dataInc = info.dInc || "";
  var horaInc = info.hInc || "";

  try {
    var unixAlt = null;
    if (dataAlt) {
      var partesDataAlt = dataAlt.split("/");
      var partesHoraAlt = (horaAlt || "00:00:00").split(":");
      if (partesDataAlt.length === 3) {
        var dataAltObj = new Date(
          parseInt(partesDataAlt[2]), parseInt(partesDataAlt[1]) - 1, parseInt(partesDataAlt[0]),
          parseInt(partesHoraAlt[0] || 0), parseInt(partesHoraAlt[1] || 0), parseInt(partesHoraAlt[2] || 0)
        );
        var offsetLocal = dataAltObj.getTimezoneOffset();
        var offsetBrasil = 180;
        unixAlt = dataAltObj.getTime() - ((offsetLocal - offsetBrasil) * 60 * 1000);
      }
    }

    var unixInc = null;
    if (dataInc) {
      var partesDataInc = dataInc.split("/");
      var partesHoraInc = (horaInc || "00:00:00").split(":");
      if (partesDataInc.length === 3) {
        var dataIncObj = new Date(
          parseInt(partesDataInc[2]), parseInt(partesDataInc[1]) - 1, parseInt(partesDataInc[0]),
          parseInt(partesHoraInc[0] || 0), parseInt(partesHoraInc[1] || 0), parseInt(partesHoraInc[2] || 0)
        );
        var offsetLocal2 = dataIncObj.getTimezoneOffset();
        var offsetBrasil2 = 180;
        unixInc = dataIncObj.getTime() - ((offsetLocal2 - offsetBrasil2) * 60 * 1000);
      }
    }

    return ((unixAlt && unixAlt > unixTimeUltimaSync) || (unixInc && unixInc > unixTimeUltimaSync));
  } catch (e) {
    Logger.log("⚠️ Erro ao comparar datas da conta " + conta.codigo_lancamento_omie + ": " + e.message);
    return true;
  }
}

// ========================================
// ✅ ATUALIZAÇÃO INCREMENTAL (NOME ORIGINAL)
// ========================================

function atualizarContasReceber_Incremental() {
  var horaInicio = new Date().getTime();

  Logger.log("\n" + "=".repeat(60));
  Logger.log("=== ATUALIZAÇÃO INCREMENTAL CR (SHEETS API) ===");
  Logger.log("=".repeat(60));

  DashboardLoggerCR.init();
  DashboardLoggerCR.logInicio("Iniciando atualização incremental (Sheets API)");

  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CR.nomePlanilha);

  if (!sheet) {
    Logger.log("❌ Planilha não encontrada");
    DashboardLoggerCR.log("", "", "❌ ERRO", "", "", "Planilha não encontrada");
    return;
  }

  CONFIG_CR.spreadsheetId = SpreadsheetApp.getActiveSpreadsheet().getId();

  try {
    var unixTimeUltimaSync = obterTimestampIncrementalCR();
    var periodoVencimento = calcularPeriodoVencimentoCR();

    Logger.log("📥 Carregando índice da planilha (Sheets API)...");
    DashboardLoggerCR.log("", "", "📥 ÍNDICE", "", "", "Carregando dados existentes...");

    var spreadsheetId = obterSpreadsheetIdCR();
    var range = CONFIG_CR.nomePlanilha + "!A2:B";
    var result = Sheets.Spreadsheets.Values.get(spreadsheetId, range);
    var dados = result.values || [];

    var mapaIndice = new Map();
    for (var i = 0; i < dados.length; i++) {
      var emp = String(dados[i][0] || "").trim();
      var codigo = String(dados[i][1] || "").trim();
      if (emp && codigo) mapaIndice.set(emp + "|" + codigo, i + 2);
    }

    Logger.log("✅ Índice carregado: " + mapaIndice.size + " registros");
    DashboardLoggerCR.log("", "", "✅ ÍNDICE", "", mapaIndice.size, "Índice carregado (Sheets API)");

    var empresas = Object.keys(EMPRESAS_OMIE);
    var novos = 0, atualizados = 0, ignorados = 0;

    for (var e = 0; e < empresas.length; e++) {
      var sigla = empresas[e];
      var empresa = EMPRESAS_OMIE[sigla];

      Logger.log("\n📊 Processando empresa: " + sigla);
      DashboardLoggerCR.log(sigla, "", "🔵 INÍCIO", "", "", "Iniciando processamento");

      var pagina = 1, totalPaginas = 1;

      do {
        var payload = {
          "call": "ListarContasReceber",
          "app_key": empresa.appKey,
          "app_secret": empresa.appSecret,
          "param": [{
            "pagina": pagina,
            "registros_por_pagina": CONFIG_CR.registrosPorPagina,
            "apenas_importado_api": "N",
            "ordenar_por": "DATA_VENCIMENTO",
            "filtrar_por_data_de": periodoVencimento.inicio,
            "filtrar_por_data_ate": periodoVencimento.fim
          }]
        };

        var options = {
          "method": "post",
          "headers": {"User-Agent": "Google-Apps-Script/Omie-CR-Incr"},
          "contentType": "application/json",
          "payload": JSON.stringify(payload),
          "muteHttpExceptions": true
        };

        DashboardLoggerCR.log(sigla, pagina + "/" + totalPaginas, "🔄 BUSCANDO", "1", "", "Requisitando dados da API...");

        var retryFetch = new RetryFetchCR(CONFIG_CR.url, options);
        var result = retryFetch.fetch(sigla, pagina + "/" + totalPaginas);

        if (!result.success) {
          Logger.log("❌ Falha após tentativas: " + result.error);
          DashboardLoggerCR.log(sigla, pagina, "❌ FALHA", "", "", "Interrompendo empresa");
          break;
        }

        try {
          var data = JSON.parse(result.response.getContentText());
          totalPaginas = data.total_de_paginas || 1;
          var contas = data.conta_receber_cadastro || [];
          var paginaTemContaNoRange = false;

          for (var i = 0; i < contas.length; i++) {
            var c = contas[i];
            var codigoStr = String(c.codigo_lancamento_omie || "").trim();
            if (!codigoStr) continue;

            // ✅ FILTRO LOCAL por vencimento (incremental também filtra)
            if (c.data_vencimento) {
              var partesV = c.data_vencimento.split("/");
              if (partesV.length === 3) {
                var dVenc = new Date(parseInt(partesV[2]), parseInt(partesV[1]) - 1, parseInt(partesV[0]));
                if (dVenc < periodoVencimento.vencInicio || dVenc > periodoVencimento.vencFim) continue;
              }
            }

            paginaTemContaNoRange = true;

            if (!contaNovaOuAlteradaDepoisCR(c, unixTimeUltimaSync)) {
              ignorados++;
              continue;
            }

            var info = c.info || {};
            var boleto = c.boleto || {};
            var categorias = Array.isArray(c.categorias) ?
              c.categorias.map(function(cat) { return cat.codigo_categoria || ""; }).join("; ") : "";

            var row = [
              sigla, String(c.codigo_lancamento_omie || ""),
              String(c.codigo_lancamento_integracao || ""),
              String(c.codigo_cliente_fornecedor || ""), c.data_vencimento || "",
              c.data_previsao || "", c.valor_documento || "", c.codigo_categoria || "",
              categorias, c.id_conta_corrente || "", c.numero_documento || "",
              c.numero_parcela || "", c.numero_documento_fiscal || "",
              c.numero_pedido || "", c.chave_nfe || "", c.data_emissao || "",
              c.id_origem || "", c.codigo_projeto || "", c.codigo_vendedor || "",
              c.status_titulo || "", c.observacao || "", c.valor_pis || "",
              c.retem_pis || "", c.valor_cofins || "", c.retem_cofins || "",
              c.valor_csll || "", c.retem_csll || "", c.valor_ir || "",
              c.retem_ir || "", c.valor_iss || "", c.retem_iss || "",
              c.valor_inss || "", c.retem_inss || "", boleto.cGerado || "",
              boleto.dDtEmBol || "", boleto.cNumBoleto || "", boleto.cNumBancario || "",
              info.dInc || "", info.hInc || "", info.uInc || "",
              info.dAlt || "", info.hAlt || "", info.uAlt || ""
            ];

            var chaveUnica = sigla + "|" + codigoStr;

            if (mapaIndice.has(chaveUnica)) {
              var linha = mapaIndice.get(chaveUnica);
              var sheetObj = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CR.nomePlanilha);
              sheetObj.getRange(linha, 1, 1, 43).setValues([row]);
              atualizados++;
            } else {
              var resource = { values: [row] };
              var rangeAppend = CONFIG_CR.nomePlanilha + "!A2";
              Sheets.Spreadsheets.Values.append(resource, spreadsheetId, rangeAppend, { valueInputOption: "RAW" });
              novos++;
            }
          }

          // ✅ EARLY EXIT no incremental também
          var ultimaConta = contas[contas.length - 1];
          if (ultimaConta && ultimaConta.data_vencimento && !paginaTemContaNoRange) {
            var partesUlt = ultimaConta.data_vencimento.split("/");
            if (partesUlt.length === 3) {
              var dataUltVenc = new Date(parseInt(partesUlt[2]), parseInt(partesUlt[1]) - 1, parseInt(partesUlt[0]));
              if (dataUltVenc > periodoVencimento.vencFim) {
                DashboardLoggerCR.log(sigla, pagina + "/" + totalPaginas, "⏹️ EARLY EXIT", "", "", "Parando — venc além do range");
                Logger.log("⏹️ Early exit incremental em página " + pagina);
                break;
              }
            }
          }

          DashboardLoggerCR.log(sigla, pagina + "/" + totalPaginas, "✅ PROCESSADO", "1",
            contas.length, "N:" + novos + " A:" + atualizados + " I:" + ignorados);

          Logger.log("  Pág " + pagina + "/" + totalPaginas +
            " | Novos: " + novos + " | Atual: " + atualizados + " | Ignor: " + ignorados);

          pagina++;
          if (pagina <= totalPaginas) Utilities.sleep(CONFIG_CR.delayEntrePaginas);

        } catch (erro) {
          Logger.log("❌ Erro ao processar: " + erro.message);
          DashboardLoggerCR.log(sigla, pagina, "❌ ERRO", "", "", "Erro ao processar JSON: " + erro.message);
          break;
        }

      } while (pagina <= totalPaginas);

      Logger.log("✅ " + sigla + " completo");
      DashboardLoggerCR.log(sigla, "", "✅ COMPLETO", "", "", "Empresa finalizada");
    }

    salvarTimestampIncrementalCR();

    var tempoTotal = Math.round((new Date().getTime() - horaInicio) / 1000);

    Logger.log("\n" + "=".repeat(60));
    Logger.log("=== ATUALIZAÇÃO INCREMENTAL CR CONCLUÍDA ===");
    Logger.log("=".repeat(60));
    Logger.log("🆕 Novos: " + novos);
    Logger.log("🔄 Atualizados: " + atualizados);
    Logger.log("⏭️  Ignorados: " + ignorados);
    Logger.log("⏱️  Tempo: " + tempoTotal + "s");
    Logger.log("=".repeat(60) + "\n");

    DashboardLoggerCR.logFim(novos + atualizados, true);
    escreverStatusCR(sheet,
      "Incremental OK. Novos: " + novos + ", Atual: " + atualizados + ", Ignor: " + ignorados + " | " + tempoTotal + "s",
      true);

  } catch (erro) {
    Logger.log("❌ Erro geral: " + erro.message);
    Logger.log(erro.stack);
    DashboardLoggerCR.log("", "", "❌ ERRO GERAL", "", "", erro.message);
    DashboardLoggerCR.logFim(0, false);
    escreverStatusCR(sheet, "Erro incremental: " + erro.message, false);
  }
}

// ========================================
// ✅ GESTÃO (NOMES ORIGINAIS)
// ========================================

function criarPlanilhaContasReceber() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_CR.nomePlanilha);

  if (sheet) {
    var ui = SpreadsheetApp.getUi();
    var resp = ui.alert("Planilha existe. Deletar?", ui.ButtonSet.YES_NO);
    if (resp !== ui.Button.YES) return;
    ss.deleteSheet(sheet);
    SpreadsheetApp.flush();
    Utilities.sleep(1000);
  }

  sheet = ss.insertSheet(CONFIG_CR.nomePlanilha);
  CONFIG_CR.spreadsheetId = ss.getId();

  var cabecalho = [
    "empresa", "codigo_lancamento_omie", "codigo_lancamento_integracao",
    "codigo_cliente_fornecedor", "data_vencimento", "data_previsao",
    "valor_documento", "codigo_categoria", "categorias_rateio",
    "id_conta_corrente", "numero_documento", "numero_parcela",
    "numero_documento_fiscal", "numero_pedido", "chave_nfe",
    "data_emissao", "id_origem", "codigo_projeto", "codigo_vendedor",
    "status_titulo", "observacao", "valor_pis", "retem_pis",
    "valor_cofins", "retem_cofins", "valor_csll", "retem_csll",
    "valor_ir", "retem_ir", "valor_iss", "retem_iss",
    "valor_inss", "retem_inss", "boleto_cGerado", "boleto_dDtEmBol",
    "boleto_cNumBoleto", "boleto_cNumBancario", "info_dInc", "info_hInc",
    "info_uInc", "info_dAlt", "info_hAlt", "info_uAlt"
  ];

  sheet.getRange(1, 1, 1, 43).setValues([cabecalho])
    .setFontWeight("bold").setBackground("#57BB8A").setFontColor("#FFFFFF").setHorizontalAlignment("center");
  sheet.getRange(1, 44).setValue("Status").setFontWeight("bold").setBackground("#17A2B8").setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.getRange("B:B").setNumberFormat("@");
  sheet.autoResizeColumns(1, 44);
  SpreadsheetApp.flush();

  Logger.log("✅ Planilha ContasReceber criada!");
  ss.toast("Planilha criada!", "✅", 3);
}

function criarTriggerDiarioCR() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'atualizarContasReceber_Simples') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  ScriptApp.newTrigger('atualizarContasReceber_Simples').timeBased().everyDays(1).atHour(9).create();
  Logger.log("✅ Trigger diário CR criado para 9h");
}

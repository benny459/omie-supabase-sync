// ========================================
// CONFIGURAÇÕES - TODAS AS EMPRESAS
// ========================================

var EMPRESAS_OMIE = {
  "SF": {
    appKey: "823997176002",
    appSecret: "4bfd2504503d076365ec4dee298b37eb",
    nome: "SF"
  },
  "CD": {
    appKey: "823989509343",
    appSecret: "9739cf05832ae7079bd46eabd4a51877",
    nome: "CD"
  },
  "WW": {
    appKey: "954169379163",
    appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5",
    nome: "WW"
  }
};

var CONFIG_PESQUISA_TITULOS_CONSOLIDADO = {
  url: "https://app.omie.com.br/api/v1/financas/pesquisartitulos/",
  nomePlanilha: "PesquisaTitulos",
  maxPaginas: 1000,
  paginasPorExecucao: 50,
  paginasSemMudancaParaParar: 99, // ← NOVO: Early stop após N páginas sem alterações
  dataEmissaoInicio: "01/06/2025",
  dataEmissaoFim: "31/12/2025",
  tentativasRetry: 3,
  delayEntreRetry: 10,
  delayAposErroTotal: 5
};


// ========================================
// FUNÇÕES AUXILIARES MELHORADAS
// ========================================

// Função para escrever stamp de status com TIMEZONE AUTOMÁTICO (BK1 confirmado)
function escreverStatusStampPT(sheet, mensagem, ehSucesso) {
  var timezone = Session.getScriptTimeZone(); // ← AUTOMÁTICO: GMT+3 (Turquia) ou GMT-3 (Brasil)
  var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
  var statusTexto = ehSucesso ? "✅ SUCESSO" : "❌ ERRO";
  var mensagemCompleta = statusTexto + " - " + timestamp + ": " + mensagem;
  var celulaStatus = sheet.getRange("BK1");
  celulaStatus.setValue(mensagemCompleta);
  celulaStatus.setFontWeight("bold");
  if (ehSucesso) {
    celulaStatus.setBackground("#D9EAD3").setFontColor("#155724");
  } else {
    celulaStatus.setBackground("#F4CCCC").setFontColor("#721C24");
  }
  Logger.log("📝 Stamp BK1 (" + timezone + "): " + mensagemCompleta);
}

// Nova: Salvar timestamp da última sincronização
function salvarTimestampUltimaSyncPT() {
  var scriptProps = PropertiesService.getScriptProperties();
  var timezone = Session.getScriptTimeZone();
  var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
  scriptProps.setProperty('PT_UltimaSync_Timestamp', timestamp);
  scriptProps.setProperty('PT_UltimaSync_Timezone', timezone);
  Logger.log("💾 Timestamp salvo (" + timezone + "): " + timestamp);
  return timestamp;
}

// Nova: Obter timestamp da última sincronização
function obterTimestampUltimaSyncPT() {
  var scriptProps = PropertiesService.getScriptProperties();
  var timestamp = scriptProps.getProperty('PT_UltimaSync_Timestamp');
  var timezone = scriptProps.getProperty('PT_UltimaSync_Timezone') || Session.getScriptTimeZone();
  if (timestamp) {
    Logger.log("📅 Última sync (" + timezone + "): " + timestamp);
  } else {
    Logger.log("📅 Primeira execução - sem timestamp anterior");
  }
  return timestamp;
}

// Nova: Comparar se título foi modificado após última sync
function tituloModificadoAposUltimaSync(titulo, timestampUltimaSync) {
  if (!timestampUltimaSync) return true; // Primeira execução
  
  var info = titulo.info || {};
  var dataAlt = info.dAlt || "";
  var horaAlt = info.hAlt || "";
  
  if (!dataAlt) return true; // Sem data de alteração
  
  try {
    // Converter timestamp última sync
    var partesTimestamp = timestampUltimaSync.split(" ");
    var partesData = partesTimestamp[0].split("/");
    var partesHora = partesTimestamp[1].split(":");
    var dataUltimaSync = new Date(
      parseInt(partesData[2]),
      parseInt(partesData[1]) - 1,
      parseInt(partesData[0]),
      parseInt(partesHora[0]),
      parseInt(partesHora[1]),
      parseInt(partesHora[2])
    );
    
    // Converter data alteração título
    var partesDataAlt = dataAlt.split("/");
    var partesHoraAlt = (horaAlt || "00:00:00").split(":");
    var dataAltTitulo = new Date(
      parseInt(partesDataAlt[2]),
      parseInt(partesDataAlt[1]) - 1,
      parseInt(partesDataAlt[0]),
      parseInt(partesHoraAlt[0] || 0),
      parseInt(partesHoraAlt[1] || 0),
      parseInt(partesHoraAlt[2] || 0)
    );
    
    return dataAltTitulo > dataUltimaSync;
  } catch (e) {
    Logger.log("⚠️ Erro ao comparar datas: " + e.message);
    return true; // Em caso de erro, considerar modificado
  }
}

function verificarTempoExecucaoPT(horaInicio, limiteSegundos) {
  limiteSegundos = limiteSegundos || 280;
  var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
  if (tempoDecorrido > limiteSegundos) {
    Logger.log("⏱️ Tempo limite: " + tempoDecorrido.toFixed(2) + "s");
    return false;
  }
  return true;
}

function limparPlanilhaCompletaPT(sheet) {
  var lastRow = sheet.getLastRow();
  var maxRows = sheet.getMaxRows();
  var lastCol = sheet.getLastColumn();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    Logger.log("✓ Limpo: " + (lastRow - 1) + " linhas");
  }
  if (maxRows > 100) {
    var linhasParaDeletar = maxRows - 100;
    if (linhasParaDeletar > 0) {
      sheet.deleteRows(101, linhasParaDeletar);
      Logger.log("✓ Deletadas " + linhasParaDeletar + " vazias");
    }
  }
  sheet.getRange("A:B").setNumberFormat("@");
  Logger.log("✓ Cols A e B TEXTO");
}

function carregarIndicePorBatchesPT(sheet) {
  var lastRow = sheet.getLastRow();
  var mapa = new Map();
  if (lastRow <= 1) {
    Logger.log("ℹ️ Planilha vazia");
    return mapa;
  }
  var BATCH_SIZE = 10000; // ← AUMENTADO: 5000 → 10000
  var inicio = 2;
  Logger.log("📥 Carregando índice de " + (lastRow - 1) + " registros...");
  while (inicio <= lastRow) {
    var fim = Math.min(inicio + BATCH_SIZE - 1, lastRow);
    var numLinhas = fim - inicio + 1;
    try {
      var dados = sheet.getRange(inicio, 1, numLinhas, 2).getValues();
      for (var i = 0; i < dados.length; i++) {
        var empresa = String(dados[i][0] || "").trim();
        var codigo = String(dados[i][1] || "").trim();
        if (empresa && codigo) {
          var chave = empresa + "|" + codigo;
          mapa.set(chave, inicio + i);
        }
      }
      Logger.log("  ✓ Batch " + inicio + "-" + fim);
      inicio = fim + 1;
      if (inicio <= lastRow) {
        Utilities.sleep(30); // ← REDUZIDO: 50ms → 30ms
      }
    } catch (e) {
      Logger.log("❌ Erro batch: " + e.message);
      break;
    }
  }
  Logger.log("✅ Índice: " + mapa.size + " únicos");
  return mapa;
}

function inserirDadosComRetryPT(sheet, dados) {
  if (!dados || dados.length === 0) {
    return true;
  }
  var MAX_TENTATIVAS = 3;
  var tentativa = 0;
  while (tentativa < MAX_TENTATIVAS) {
    try {
      Logger.log("📝 Inserindo " + dados.length + " (tent " + (tentativa + 1) + ")");
      var primeiraLinha = sheet.getLastRow() + 1;
      sheet.getRange(primeiraLinha, 1, dados.length, 62).setValues(dados);
      SpreadsheetApp.flush();
      Logger.log("✅ Inserido");
      return true;
    } catch (e) {
      tentativa++;
      Logger.log("❌ Erro inserção (tent " + tentativa + "): " + e.message);
      if (tentativa < MAX_TENTATIVAS) {
        Utilities.sleep(1000 * tentativa);
      } else {
        Logger.log("❌ CRÍTICO: Falha após " + MAX_TENTATIVAS + " tentativas");
        salvarDadosPerdidosPT(dados);
        return false;
      }
    }
  }
  return false;
}

function salvarDadosPerdidosPT(dados) {
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var timestamp = new Date().getTime();
    var chave = 'DadosPerdidos_PT_' + timestamp;
    var dadosJson = JSON.stringify(dados);
    var CHUNK_SIZE = 8000;
    var numChunks = Math.ceil(dadosJson.length / CHUNK_SIZE);
    for (var i = 0; i < numChunks; i++) {
      var chunk = dadosJson.substring(i * CHUNK_SIZE, Math.min((i + 1) * CHUNK_SIZE, dadosJson.length));
      scriptProps.setProperty(chave + '_chunk_' + i, chunk);
    }
    scriptProps.setProperty(chave + '_numChunks', String(numChunks));
    scriptProps.setProperty(chave + '_timestamp', new Date().toISOString());
    Logger.log("💾 Salvo: " + chave);
    Logger.log("💡 Use listarDadosPerdidosPT() e recuperarDadosPerdidosPT()");
  } catch (e) {
    Logger.log("❌ Erro salvar: " + e.message);
  }
}

function validarIntegridadeDadosPT(sheet, empresas) {
  Logger.log("\n=== VALIDAÇÃO ===");
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log("⚠️ Vazia");
    return;
  }
  var dados = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var contagem = {};
  var codigosUnicos = new Map();
  var duplicatas = 0;
  for (var i = 0; i < empresas.length; i++) {
    contagem[empresas[i]] = 0;
  }
  for (var i = 0; i < dados.length; i++) {
    var empresa = String(dados[i][0] || "").trim();
    var codigo = String(dados[i][1] || "").trim();
    if (contagem.hasOwnProperty(empresa)) {
      contagem[empresa]++;
    }
    if (empresa && codigo) {
      var chave = empresa + "|" + codigo;
      if (codigosUnicos.has(chave)) {
        duplicatas++;
      } else {
        codigosUnicos.set(chave, true);
      }
    }
  }
  Logger.log("\n📊 Por empresa:");
  for (var emp in contagem) {
    Logger.log("  " + emp + ": " + contagem[emp]);
  }
  Logger.log("\nResumo: Total " + (lastRow - 1) + ", Únicos " + codigosUnicos.size + ", Dups " + duplicatas);
  if (duplicatas > 0) Logger.log("⚠️ " + duplicatas + " dups!");
  else Logger.log("✅ Sem dups");
}


// ========================================
// FUNÇÕES DE IMPORTAÇÃO POR LOTE
// ========================================

// SF
function recriarBasePesquisaTitulos_Parte1() {
  importarPesquisaTitulosPorLote("SF", 1, 50);
}

function recriarBasePesquisaTitulos_Parte2() {
  importarPesquisaTitulosPorLote("SF", 51, 100);
}

function recriarBasePesquisaTitulos_Parte3() {
  importarPesquisaTitulosPorLote("SF", 101, 150);
}

function recriarBasePesquisaTitulos_Parte4() {
  importarPesquisaTitulosPorLote("SF", 151, 200);
}

// CD
function recriarBasePesquisaTitulos_Parte5() {
  importarPesquisaTitulosPorLote("CD", 1, 50);
}

function recriarBasePesquisaTitulos_Parte6() {
  importarPesquisaTitulosPorLote("CD", 51, 100);
}

// WW
function recriarBasePesquisaTitulos_Parte7() {
  importarPesquisaTitulosPorLote("WW", 1, 50);
}

function recriarBasePesquisaTitulos_Parte8() {
  importarPesquisaTitulosPorLote("WW", 51, 100);
}


// ========================================
// FUNÇÃO CORE: IMPORTAR POR LOTE
// ========================================

function importarPesquisaTitulosPorLote(siglaEmpresa, paginaInicial, paginaFinal) {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    Logger.log("💡 Execute: criarPlanilhaPesquisaTitulos()");
    return;
  }
  if (!EMPRESAS_OMIE[siglaEmpresa]) {
    Logger.log("❌ Empresa '" + siglaEmpresa + "' não encontrada!");
    return;
  }
  var sucesso = true;
  var erroDetalhe = "";
  var totalImportados = 0;
  try {
    var empresa = EMPRESAS_OMIE[siglaEmpresa];
    Logger.log("=== IMPORTANDO TÍTULOS - " + siglaEmpresa + " ===");
    Logger.log("Páginas " + paginaInicial + " a " + paginaFinal);
    if (paginaInicial === 1 && siglaEmpresa === "SF") {
      limparPlanilhaCompletaPT(sheet);
    } else {
      sheet.getRange("A:B").setNumberFormat("@");
    }
    var pagina = paginaInicial;
    var dadosAcumulados = [];
    var errosConsecutivos = 0;
    var MAX_ERROS = 3;
    do {
      if (pagina > paginaFinal) {
        Logger.log("Atingido limite da faixa (página " + paginaFinal + ")");
        break;
      }
      if (!verificarTempoExecucaoPT(horaInicio, 280)) {
        Logger.log("⏱️ Tempo limite. Total: " + totalImportados);
        break;
      }
      var payload = {
        "call": "PesquisarLancamentos",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{ 
          "nPagina": pagina,
          "nRegPorPagina": 100,
          "lDadosCad": true
        }]
      };
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
      };
      try {
        var response = UrlFetchApp.fetch(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.url, options);
        var httpCode = response.getResponseCode();
        if (httpCode !== 200) {
          Logger.log("❌ HTTP " + httpCode + " p" + pagina);
          errosConsecutivos++;
          if (errosConsecutivos >= MAX_ERROS) {
            sucesso = false;
            erroDetalhe = "Max erros HTTP " + siglaEmpresa;
            break;
          }
          Utilities.sleep(2000);
          continue;
        }
        var data = JSON.parse(response.getContentText());
        if (!data || data.faultstring) {
          Logger.log("❌ Erro API: " + (data.faultstring || "desconhecido"));
          errosConsecutivos++;
          continue;
        }
        var titulos = data.titulosEncontrados || [];
        if (titulos.length === 0) {
          Logger.log("✓ Fim p" + pagina);
          break;
        }
        errosConsecutivos = 0;
        for (var i = 0; i < titulos.length; i++) {
          var t = titulos[i].cabecTitulo || {};
          var info = t.info || {};
          var resumo = titulos[i].resumo || {};
          var categorias = Array.isArray(t.aCodCateg) ? t.aCodCateg.map(function(cat) { 
            return cat.cCodCateg || ""; 
          }).join(", ") : "";
          var row = [
            siglaEmpresa, String(t.nCodTitulo || ""), t.cCodIntTitulo || "", t.cNumTitulo || "",
            t.dDtEmissao || "", t.dDtVenc || "", t.dDtPrevisao || "",
            t.dDtPagamento || "", t.nCodCliente || "", t.cCPFCNPJCliente || "",
            t.nCodCtr || "", t.cNumCtr || "", t.nCodOS || "", t.cNumOS || "",
            t.nCodCC || "", t.cStatus || "", t.cNatureza || "", t.cTipo || "",
            t.cOperacao || "", t.cNumDocFiscal || "", t.cCodCateg || "",
            categorias, t.cNumParcela || "", t.nValorTitulo || "",
            t.nValorPIS || "", t.cRetPIS || "", t.nValorCOFINS || "",
            t.cRetCOFINS || "", t.nValorCSLL || "", t.cRetCSLL || "",
            t.nValorIR || "", t.cRetIR || "", t.nValorISS || "",
            t.cRetISS || "", t.nValorINSS || "", t.cRetINSS || "",
            t.observacao || "", t.cCodProjeto || "", t.cCodVendedor || "",
            t.nCodComprador || "", t.cCodigoBarras || "", t.cNSU || "",
            t.nCodNF || "", t.dDtRegistro || "", t.cNumBoleto || "",
            t.cChaveNFe || "", t.cOrigem || "", t.nCodTitRepet || "",
            t.dDtCanc || "", resumo.cLiquidado || "", resumo.nValPago || "",
            resumo.nValAberto || "", resumo.nDesconto || "", resumo.nJuros || "",
            resumo.nMulta || "", resumo.nValLiquido || "", info.dInc || "",
            info.hInc || "", info.uInc || "", info.dAlt || "",
            info.hAlt || "", info.uAlt || ""
          ];
          dadosAcumulados.push(row);
          totalImportados++;
        }
        if (pagina % 10 === 0) {
          Logger.log(siglaEmpresa + " - P" + pagina + "/" + paginaFinal + " | Total: " + totalImportados);
        }
        pagina++;
        if (dadosAcumulados.length >= 1000) { // ← AUMENTADO: 500 → 1000
          if (!inserirDadosComRetryPT(sheet, dadosAcumulados)) {
            sucesso = false;
            erroDetalhe = "Falha lote " + siglaEmpresa;
          }
          dadosAcumulados = [];
        }
        Utilities.sleep(50); // ← REDUZIDO: 100ms → 50ms
      } catch (erro) {
        Logger.log("❌ Erro p" + pagina + ": " + erro.message);
        errosConsecutivos++;
        if (errosConsecutivos >= MAX_ERROS) {
          sucesso = false;
          erroDetalhe = "Max erros API " + siglaEmpresa;
          break;
        }
        Utilities.sleep(2000);
      }
    } while (pagina <= paginaFinal);
    if (dadosAcumulados.length > 0) {
      if (!inserirDadosComRetryPT(sheet, dadosAcumulados)) {
        sucesso = false;
        erroDetalhe = "Falha lote final";
      }
    }
    Logger.log("=== ✅ LOTE FINALIZADO - " + siglaEmpresa + " ===");
    Logger.log("Total: " + totalImportados);
    Logger.log("Linhas: " + (sheet.getLastRow() - 1));
    var tempoTotal = Math.round((new Date().getTime() - horaInicio) / 1000);
    Logger.log("⏱️ Tempo: " + tempoTotal + "s");
    var empresasList = Object.keys(EMPRESAS_OMIE);
    validarIntegridadeDadosPT(sheet, empresasList);
    if (sucesso) {
      escreverStatusStampPT(sheet, "Lote " + siglaEmpresa + " (" + paginaInicial + "-" + paginaFinal + ") OK. Total: " + totalImportados, true);
    } else {
      escreverStatusStampPT(sheet, "Falha lote " + siglaEmpresa + " (" + paginaInicial + "-" + paginaFinal + "): " + erroDetalhe + ". Total: " + totalImportados, false);
    }
  } catch (erroGeral) {
    Logger.log("❌ Erro geral lote " + siglaEmpresa + ": " + erroGeral.message);
    escreverStatusStampPT(sheet, "Erro geral lote " + siglaEmpresa + ": " + erroGeral.message, false);
  }
}


// ========================================
// FUNÇÃO: ATUALIZAÇÃO OTIMIZADA COM RETOMADA E EARLY STOP
// ========================================

function atualizarPesquisaTitulos_ComRetomada() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    return;
  }
  var sucesso = true;
  var erroDetalhe = "";
  var novos = 0;
  var atualizados = 0;
  var ignorados = 0;
  var errosConsecutivos = 0;
  var paginasProcessadas = 0;
  
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var dataEmissaoInicio = CONFIG_PESQUISA_TITULOS_CONSOLIDADO.dataEmissaoInicio;
    var dataEmissaoFim = CONFIG_PESQUISA_TITULOS_CONSOLIDADO.dataEmissaoFim;
    var empresaAtual = scriptProps.getProperty('PTAtualiza_empresaAtual') || 'SF';
    var paginaAtual = parseInt(scriptProps.getProperty('PTAtualiza_paginaAtual') || '1');
    novos = parseInt(scriptProps.getProperty('PTAtualiza_novos') || '0');
    atualizados = parseInt(scriptProps.getProperty('PTAtualiza_atualizados') || '0');
    ignorados = parseInt(scriptProps.getProperty('PTAtualiza_ignorados') || '0');
    errosConsecutivos = parseInt(scriptProps.getProperty('PTAtualiza_errosConsecutivos') || '0');
    paginasProcessadas = parseInt(scriptProps.getProperty('PTAtualiza_paginasProcessadas') || '0');
    
    var isNovaExecucao = (paginaAtual === 1 && empresaAtual === 'SF');
    
    if (isNovaExecucao) {
      Logger.log("=== SINCRONIZAÇÃO OTIMIZADA PT ===");
      Logger.log("Período: " + dataEmissaoInicio + " a " + dataEmissaoFim);
    } else {
      Logger.log("=== RETOMADA PT ===");
      Logger.log("Empresa: " + empresaAtual + " | Página: " + paginaAtual);
      Logger.log("Novos: " + novos + " | Atual: " + atualizados + " | Ignor: " + ignorados);
    }
    
    // Obter timestamp da última sincronização
    var timestampUltimaSync = obterTimestampUltimaSyncPT();
    
    sheet.getRange("A:B").setNumberFormat("@");
    var mapaCodigosLinhas = carregarIndicePorBatchesPT(sheet);
    
    var empresas = Object.keys(EMPRESAS_OMIE);
    var empresaStartIndex = empresas.indexOf(empresaAtual);
    
    if (empresaStartIndex === -1) {
      Logger.log("❌ Empresa inválida");
      limparEstadoRetomadaPTAtualiza();
      return;
    }
    
    var dadosNovos = [];
    var MAX_TEMPO_EXECUCAO = 270000;
    
    for (var e = empresaStartIndex; e < empresas.length; e++) {
      var sigla = empresas[e];
      var empresa = EMPRESAS_OMIE[sigla];
      Logger.log("\n📊 Sincronizando: " + sigla);
      
      var tempoDecorrido = (new Date().getTime() - horaInicio);
      if (tempoDecorrido > MAX_TEMPO_EXECUCAO) {
        Logger.log("⏱️ Limite tempo. Salvando...");
        scriptProps.setProperty('PTAtualiza_empresaAtual', sigla);
        scriptProps.setProperty('PTAtualiza_paginaAtual', String(paginaAtual));
        scriptProps.setProperty('PTAtualiza_novos', String(novos));
        scriptProps.setProperty('PTAtualiza_atualizados', String(atualizados));
        scriptProps.setProperty('PTAtualiza_ignorados', String(ignorados));
        scriptProps.setProperty('PTAtualiza_errosConsecutivos', String(errosConsecutivos));
        scriptProps.setProperty('PTAtualiza_paginasProcessadas', String(paginasProcessadas));
        criarTriggerRetomadaPTAtualiza(1);
        Logger.log("🔄 Trigger 1 min");
        return;
      }
      
      var startPage = (sigla === empresaAtual) ? paginaAtual : 1;
      var pagina = startPage;
      var totalPaginas = 1;
      var paginasSemMudanca = 0; // ← NOVO: Contador early stop
      var MAX_PAGINAS_SEM_MUDANCA = CONFIG_PESQUISA_TITULOS_CONSOLIDADO.paginasSemMudancaParaParar;
      
      do {
        tempoDecorrido = (new Date().getTime() - horaInicio);
        if (tempoDecorrido > MAX_TEMPO_EXECUCAO) {
          Logger.log("⏱️ Limite tempo");
          scriptProps.setProperty('PTAtualiza_empresaAtual', sigla);
          scriptProps.setProperty('PTAtualiza_paginaAtual', String(pagina));
          scriptProps.setProperty('PTAtualiza_novos', String(novos));
          scriptProps.setProperty('PTAtualiza_atualizados', String(atualizados));
          scriptProps.setProperty('PTAtualiza_ignorados', String(ignorados));
          scriptProps.setProperty('PTAtualiza_errosConsecutivos', String(errosConsecutivos));
          scriptProps.setProperty('PTAtualiza_paginasProcessadas', String(paginasProcessadas));
          criarTriggerRetomadaPTAtualiza(1);
          return;
        }
        
        // ← EARLY STOP: Parar se muitas páginas sem mudanças
        if (paginasSemMudanca >= MAX_PAGINAS_SEM_MUDANCA) {
          Logger.log("🛑 Early Stop: " + paginasSemMudanca + " páginas sem mudanças");
          Logger.log("💡 Restante provavelmente não mudou");
          break;
        }
        
        var payload = {
          "call": "PesquisarLancamentos",
          "app_key": empresa.appKey,
          "app_secret": empresa.appSecret,
          "param": [{ 
            "nPagina": pagina,
            "nRegPorPagina": 100,
            "lDadosCad": true,
            "dDtEmisDe": dataEmissaoInicio,
            "dDtEmisAte": dataEmissaoFim
          }]
        };
        
        var options = {
          "method": "post",
          "contentType": "application/json",
          "payload": JSON.stringify(payload),
          "muteHttpExceptions": true
        };
        
        var tentativas = 0;
        var maxTentativas = CONFIG_PESQUISA_TITULOS_CONSOLIDADO.tentativasRetry;
        var delayBase = CONFIG_PESQUISA_TITULOS_CONSOLIDADO.delayEntreRetry;
        var fetchSucesso = false;
        var data = null;
        
        while (tentativas < maxTentativas && !fetchSucesso) {
          try {
            var response = UrlFetchApp.fetch(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.url, options);
            var responseCode = response.getResponseCode();
            if (responseCode === 200) {
              data = JSON.parse(response.getContentText());
              fetchSucesso = true;
              errosConsecutivos = 0;
            } else if (responseCode === 500) {
              tentativas++;
              Logger.log("⚠️ Erro 500 - " + sigla + " p" + pagina + " (tent " + tentativas + "/" + maxTentativas + ")");
              if (tentativas < maxTentativas) {
                Utilities.sleep(tentativas * delayBase * 1000);
              }
            } else {
              Logger.log("❌ HTTP " + responseCode + " p" + pagina);
              errosConsecutivos++;
              break;
            }
          } catch (erro) {
            tentativas++;
            Logger.log("⚠️ Exceção: " + erro.message + " (tent " + tentativas + "/" + maxTentativas + ")");
            if (tentativas < maxTentativas) {
              Utilities.sleep(tentativas * delayBase * 1000);
            }
          }
        }
        
        if (!fetchSucesso) {
          errosConsecutivos++;
          Logger.log("❌ Falha após " + maxTentativas + " tentativas");
          if (errosConsecutivos >= 3) {
            Logger.log("🛑 Muitos erros. Pausando " + CONFIG_PESQUISA_TITULOS_CONSOLIDADO.delayAposErroTotal + " min...");
            scriptProps.setProperty('PTAtualiza_empresaAtual', sigla);
            scriptProps.setProperty('PTAtualiza_paginaAtual', String(pagina));
            scriptProps.setProperty('PTAtualiza_novos', String(novos));
            scriptProps.setProperty('PTAtualiza_atualizados', String(atualizados));
            scriptProps.setProperty('PTAtualiza_ignorados', String(ignorados));
            scriptProps.setProperty('PTAtualiza_errosConsecutivos', String(errosConsecutivos));
            scriptProps.setProperty('PTAtualiza_paginasProcessadas', String(paginasProcessadas));
            criarTriggerRetomadaPTAtualiza(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.delayAposErroTotal);
            return;
          }
          pagina++;
          continue;
        }
        
        if (!data) break;
        
        totalPaginas = data.nTotPaginas || 1;
        var titulos = data.titulosEncontrados || [];
        
        if (titulos.length === 0) break;
        
        var mudancasNestaPagina = 0; // ← NOVO: Contador de mudanças na página
        
        for (var i = 0; i < titulos.length; i++) {
          var t = titulos[i].cabecTitulo || {};
          var codigoStr = String(t.nCodTitulo || "").trim();
          if (!codigoStr) continue;
          
          var chaveUnica = sigla + "|" + codigoStr;
          
          // ← NOVO: Verificar se título foi modificado
          var foiModificado = tituloModificadoAposUltimaSync(t, timestampUltimaSync);
          
          if (mapaCodigosLinhas.has(chaveUnica)) {
            // Título já existe
            if (foiModificado) {
              // Atualizar apenas se foi modificado
              var info = t.info || {};
              var resumo = titulos[i].resumo || {};
              var categorias = Array.isArray(t.aCodCateg) ? t.aCodCateg.map(function(cat) { 
                return cat.cCodCateg || ""; 
              }).join(", ") : "";
              var row = [
                sigla, String(t.nCodTitulo || ""), t.cCodIntTitulo || "", t.cNumTitulo || "",
                t.dDtEmissao || "", t.dDtVenc || "", t.dDtPrevisao || "",
                t.dDtPagamento || "", t.nCodCliente || "", t.cCPFCNPJCliente || "",
                t.nCodCtr || "", t.cNumCtr || "", t.nCodOS || "", t.cNumOS || "",
                t.nCodCC || "", t.cStatus || "", t.cNatureza || "", t.cTipo || "",
                t.cOperacao || "", t.cNumDocFiscal || "", t.cCodCateg || "",
                categorias, t.cNumParcela || "", t.nValorTitulo || "",
                t.nValorPIS || "", t.cRetPIS || "", t.nValorCOFINS || "",
                t.cRetCOFINS || "", t.nValorCSLL || "", t.cRetCSLL || "",
                t.nValorIR || "", t.cRetIR || "", t.nValorISS || "",
                t.cRetISS || "", t.nValorINSS || "", t.cRetINSS || "",
                t.observacao || "", t.cCodProjeto || "", t.cCodVendedor || "",
                t.nCodComprador || "", t.cCodigoBarras || "", t.cNSU || "",
                t.nCodNF || "", t.dDtRegistro || "", t.cNumBoleto || "",
                t.cChaveNFe || "", t.cOrigem || "", t.nCodTitRepet || "",
                t.dDtCanc || "", resumo.cLiquidado || "", resumo.nValPago || "",
                resumo.nValAberto || "", resumo.nDesconto || "", resumo.nJuros || "",
                resumo.nMulta || "", resumo.nValLiquido || "", info.dInc || "",
                info.hInc || "", info.uInc || "", info.dAlt || "",
                info.hAlt || "", info.uAlt || ""
              ];
              var linha = mapaCodigosLinhas.get(chaveUnica);
              sheet.getRange(linha, 1, 1, 62).setValues([row]);
              atualizados++;
              mudancasNestaPagina++;
            } else {
              ignorados++;
            }
          } else {
            // Título novo - sempre adicionar
            var info = t.info || {};
            var resumo = titulos[i].resumo || {};
            var categorias = Array.isArray(t.aCodCateg) ? t.aCodCateg.map(function(cat) { 
              return cat.cCodCateg || ""; 
            }).join(", ") : "";
            var row = [
              sigla, String(t.nCodTitulo || ""), t.cCodIntTitulo || "", t.cNumTitulo || "",
              t.dDtEmissao || "", t.dDtVenc || "", t.dDtPrevisao || "",
              t.dDtPagamento || "", t.nCodCliente || "", t.cCPFCNPJCliente || "",
              t.nCodCtr || "", t.cNumCtr || "", t.nCodOS || "", t.cNumOS || "",
              t.nCodCC || "", t.cStatus || "", t.cNatureza || "", t.cTipo || "",
              t.cOperacao || "", t.cNumDocFiscal || "", t.cCodCateg || "",
              categorias, t.cNumParcela || "", t.nValorTitulo || "",
              t.nValorPIS || "", t.cRetPIS || "", t.nValorCOFINS || "",
              t.cRetCOFINS || "", t.nValorCSLL || "", t.cRetCSLL || "",
              t.nValorIR || "", t.cRetIR || "", t.nValorISS || "",
              t.cRetISS || "", t.nValorINSS || "", t.cRetINSS || "",
              t.observacao || "", t.cCodProjeto || "", t.cCodVendedor || "",
              t.nCodComprador || "", t.cCodigoBarras || "", t.cNSU || "",
              t.nCodNF || "", t.dDtRegistro || "", t.cNumBoleto || "",
              t.cChaveNFe || "", t.cOrigem || "", t.nCodTitRepet || "",
              t.dDtCanc || "", resumo.cLiquidado || "", resumo.nValPago || "",
              resumo.nValAberto || "", resumo.nDesconto || "", resumo.nJuros || "",
              resumo.nMulta || "", resumo.nValLiquido || "", info.dInc || "",
              info.hInc || "", info.uInc || "", info.dAlt || "",
              info.hAlt || "", info.uAlt || ""
            ];
            dadosNovos.push(row);
            novos++;
            mudancasNestaPagina++;
          }
        }
        
        // ← NOVO: Controlar páginas sem mudanças
        if (mudancasNestaPagina === 0) {
          paginasSemMudanca++;
        } else {
          paginasSemMudanca = 0; // Reset se houver mudanças
        }
        
        if (dadosNovos.length >= 1000) { // ← AUMENTADO: 500 → 1000
          Logger.log("📝 Inserindo lote " + dadosNovos.length + "...");
          if (!inserirDadosComRetryPT(sheet, dadosNovos)) {
            sucesso = false;
            erroDetalhe = "Falha lote " + sigla;
          }
          dadosNovos = [];
        }
        
        Logger.log("P" + pagina + "/" + totalPaginas + 
                  " - Novos: " + novos + 
                  " | Atual: " + atualizados + 
                  " | Ignor: " + ignorados +
                  " | SemMud: " + paginasSemMudanca);
        
        paginasProcessadas++;
        pagina++;
        Utilities.sleep(500); // ← REDUZIDO: 1000ms → 500ms
        
      } while (pagina <= totalPaginas);
      
      Logger.log("✅ " + sigla + " completo");
      paginaAtual = 1;
    }
    
    if (dadosNovos.length > 0) {
      Logger.log("\n📝 Inserindo lote final...");
      if (!inserirDadosComRetryPT(sheet, dadosNovos)) {
        sucesso = false;
        erroDetalhe = "Falha lote final";
      }
    }
    
    Logger.log("\n=== ✅ SYNC COMPLETA ===");
    Logger.log("🆕 Novos: " + novos);
    Logger.log("🔄 Atual: " + atualizados);
    Logger.log("⏭️  Ignor: " + ignorados);
    Logger.log("📄 Páginas: " + paginasProcessadas);
    Logger.log("📊 Total: " + (sheet.getLastRow() - 1));
    
    limparEstadoRetomadaPTAtualiza();
    removerTriggersRetomadaPTAtualiza();
    
    var empresasList = Object.keys(EMPRESAS_OMIE);
    validarIntegridadeDadosPT(sheet, empresasList);
    
    // Salvar timestamp desta sync
    if (sucesso) {
      salvarTimestampUltimaSyncPT();
      escreverStatusStampPT(sheet, 
        "Sync OK. Novos: " + novos + 
        ", Atual: " + atualizados + 
        ", Ignor: " + ignorados + 
        ", Páginas: " + paginasProcessadas + 
        ", Total: " + (sheet.getLastRow() - 1), 
        true);
    } else {
      escreverStatusStampPT(sheet, 
        "Falha sync: " + erroDetalhe + 
        ". Novos: " + novos + 
        ", Atual: " + atualizados, 
        false);
    }
    
  } catch (erroGeral) {
    Logger.log("❌ Erro geral: " + erroGeral.message);
    escreverStatusStampPT(sheet, "Erro geral sync: " + erroGeral.message, false);
  }
}


// ========================================
// FUNÇÕES DE GERENCIAMENTO - ATUALIZAÇÃO
// ========================================

function criarTriggerRetomadaPTAtualiza(delayMinutos) {
  removerTriggersRetomadaPTAtualiza();
  var proximaExecucao = new Date();
  proximaExecucao.setMinutes(proximaExecucao.getMinutes() + delayMinutos);
  ScriptApp.newTrigger('atualizarPesquisaTitulos_ComRetomada')
    .timeBased()
    .at(proximaExecucao)
    .create();
  Logger.log("✅ Trigger: " + proximaExecucao);
}

function removerTriggersRetomadaPTAtualiza() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'atualizarPesquisaTitulos_ComRetomada') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function limparEstadoRetomadaPTAtualiza() {
  var scriptProps = PropertiesService.getScriptProperties();
  scriptProps.deleteProperty('PTAtualiza_empresaAtual');
  scriptProps.deleteProperty('PTAtualiza_paginaAtual');
  scriptProps.deleteProperty('PTAtualiza_novos');
  scriptProps.deleteProperty('PTAtualiza_atualizados');
  scriptProps.deleteProperty('PTAtualiza_ignorados');
  scriptProps.deleteProperty('PTAtualiza_errosConsecutivos');
  scriptProps.deleteProperty('PTAtualiza_paginasProcessadas');
  Logger.log("🧹 Estado PT limpo");
}

function resetarRetomadaPTAtualiza() {
  limparEstadoRetomadaPTAtualiza();
  removerTriggersRetomadaPTAtualiza();
  Logger.log("✅ Reset PT");
}

function criarTriggerDiarioPT() {
  removerTriggerDiarioPT();
  ScriptApp.newTrigger('atualizarPesquisaTitulos_ComRetomada')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
  Logger.log("✅ Trigger diário 9h");
}

function removerTriggerDiarioPT() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var trigger = triggers[i];
    if (trigger.getHandlerFunction() === 'atualizarPesquisaTitulos_ComRetomada' &&
        trigger.getEventType() === ScriptApp.EventType.CLOCK) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log("🗑️ Trigger diário removido");
    }
  }
}


// ========================================
// FUNÇÕES DE DUPLICADOS E RECUPERAÇÃO
// ========================================

function listarIntervalosParaDeletarDuplicadosPT() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    return;
  }
  Logger.log("=== 🔍 IDENTIFICANDO DUPLICADOS ===");
  var lastRow = sheet.getLastRow();
  if (lastRow <= 1) {
    Logger.log("Planilha vazia.");
    escreverStatusStampPT(sheet, "Planilha vazia - sem duplicados.", true);
    return;
  }
  var dados = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
  var codigosVistos = {};
  var linhasDuplicadas = [];
  for (var i = 0; i < dados.length; i++) {
    var empresa = String(dados[i][0] || "").trim();
    var codigo = String(dados[i][1] || "").trim();
    if (!empresa || !codigo) continue;
    var chaveUnica = empresa + "|" + codigo;
    if (codigosVistos[chaveUnica]) {
      linhasDuplicadas.push(i + 2);
    } else {
      codigosVistos[chaveUnica] = i + 2;
    }
  }
  if (linhasDuplicadas.length === 0) {
    Logger.log("✅ NENHUM DUPLICADO!");
    escreverStatusStampPT(sheet, "Nenhum duplicado encontrado.", true);
    return;
  }
  linhasDuplicadas.sort(function(a, b) { return a - b; });
  var intervalos = [];
  var inicio = linhasDuplicadas[0];
  var fim = linhasDuplicadas[0];
  for (var i = 1; i < linhasDuplicadas.length; i++) {
    if (linhasDuplicadas[i] === fim + 1) {
      fim = linhasDuplicadas[i];
    } else {
      intervalos.push({inicio: inicio, fim: fim});
      inicio = linhasDuplicadas[i];
      fim = linhasDuplicadas[i];
    }
  }
  intervalos.push({inicio: inicio, fim: fim});
  Logger.log("\n❌ DUPLICADOS: " + linhasDuplicadas.length);
  Logger.log("Intervalos: " + intervalos.length);
  var textoIntervalos = "";
  for (var i = 0; i < intervalos.length; i++) {
    var intervalo = intervalos[i];
    textoIntervalos += (intervalo.inicio === intervalo.fim) ? intervalo.inicio + ", " : intervalo.inicio + "-" + intervalo.fim + ", ";
  }
  Logger.log("\n📋 COPIE ISTO: " + textoIntervalos.slice(0, -2));
  escreverStatusStampPT(sheet, "Duplicados: " + linhasDuplicadas.length + ". Ver logs.", false);
}

function listarDadosPerdidosPT() {
  var scriptProps = PropertiesService.getScriptProperties();
  var todasProps = scriptProps.getProperties();
  var dadosPerdidos = [];
  for (var prop in todasProps) {
    if (prop.indexOf('DadosPerdidos_PT_') === 0 && prop.indexOf('_chunk_') === -1 && prop.indexOf('_numChunks') === -1 && prop.indexOf('_timestamp') === -1) {
      dadosPerdidos.push(prop);
    }
  }
  if (dadosPerdidos.length === 0) {
    Logger.log("✅ Nenhum dado perdido");
    return;
  }
  Logger.log("=== 📦 DADOS PERDIDOS ===");
  for (var i = 0; i < dadosPerdidos.length; i++) {
    var timestamp = scriptProps.getProperty(dadosPerdidos[i] + '_timestamp') || 'Desconhecido';
    var numChunks = scriptProps.getProperty(dadosPerdidos[i] + '_numChunks') || '?';
    Logger.log((i + 1) + ". " + dadosPerdidos[i]);
    Logger.log("   Timestamp: " + timestamp);
    Logger.log("   Chunks: " + numChunks);
  }
  Logger.log("\n💡 Use recuperarDadosPerdidosPT('chave')");
}

function recuperarDadosPerdidosPT(chave) {
  var scriptProps = PropertiesService.getScriptProperties();
  var numChunks = parseInt(scriptProps.getProperty(chave + '_numChunks') || '0');
  if (numChunks === 0) {
    Logger.log("❌ Chave não encontrada");
    return;
  }
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada");
    return;
  }
  var sucesso = true;
  var erroDetalhe = "";
  Logger.log("=== 📥 RECUPERANDO DADOS ===");
  Logger.log("Chave: " + chave);
  Logger.log("Chunks: " + numChunks);
  var dadosJson = '';
  for (var i = 0; i < numChunks; i++) {
    var chunk = scriptProps.getProperty(chave + '_chunk_' + i);
    if (chunk) {
      dadosJson += chunk;
    }
  }
  try {
    var dados = JSON.parse(dadosJson);
    Logger.log("✓ Dados recuperados: " + dados.length + " registros");
    if (!inserirDadosComRetryPT(sheet, dados)) {
      sucesso = false;
      erroDetalhe = "Falha inserção recuperação";
    }
    for (var i = 0; i < numChunks; i++) {
      scriptProps.deleteProperty(chave + '_chunk_' + i);
    }
    scriptProps.deleteProperty(chave + '_numChunks');
    scriptProps.deleteProperty(chave + '_timestamp');
    Logger.log("✅ Dados recuperados e salvos!");
    if (sucesso) {
      escreverStatusStampPT(sheet, "Dados perdidos recuperados. Chave: " + chave + ", Registros: " + dados.length, true);
    } else {
      escreverStatusStampPT(sheet, "Falha recuperação (chave " + chave + "): " + erroDetalhe + ". Registros: " + dados.length, false);
    }
  } catch (e) {
    Logger.log("❌ Erro recuperar: " + e.message);
    escreverStatusStampPT(sheet, "Erro recuperação (chave " + chave + "): " + e.message, false);
  }
}


// ========================================
// FUNÇÃO: CRIAR PLANILHA
// ========================================

function criarPlanilhaPesquisaTitulos() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.nomePlanilha);
  if (sheet) {
    Logger.log("⚠️ Deletando planilha existente...");
    ss.deleteSheet(sheet);
    SpreadsheetApp.flush();
    Utilities.sleep(3000);
  }
  Logger.log("Criando nova planilha...");
  sheet = ss.insertSheet(CONFIG_PESQUISA_TITULOS_CONSOLIDADO.nomePlanilha);
  var cabecalho = [
    "empresa", "cod_titulo", "cod_int_titulo", "num_titulo", "dt_emissao", "dt_vencimento",
    "dt_previsao", "dt_pagamento", "cod_cliente", "cpf_cnpj_cliente",
    "cod_contrato", "num_contrato", "cod_os", "num_os", "cod_conta_corrente",
    "status", "natureza", "tipo_doc", "operacao", "num_doc_fiscal",
    "cod_categoria", "categorias_rateio", "num_parcela", "valor_titulo",
    "valor_pis", "ret_pis", "valor_cofins", "ret_cofins", "valor_csll", "ret_csll",
    "valor_ir", "ret_ir", "valor_iss", "ret_iss", "valor_inss", "ret_inss",
    "observacao", "cod_projeto", "cod_vendedor", "cod_comprador", "codigo_barras",
    "nsu", "cod_nf", "dt_registro", "num_boleto", "chave_nfe", "origem",
    "cod_tit_repetido", "dt_cancelamento", "liquidado", "val_pago", "val_aberto",
    "desconto", "juros", "multa", "val_liquido",
    "info_dInc", "info_hInc", "info_uInc", "info_dAlt", "info_hAlt", "info_uAlt"
  ];
  Logger.log("Total de colunas: " + cabecalho.length);
  sheet.getRange(1, 1, 1, 62).setValues([cabecalho]);
  SpreadsheetApp.flush();
  var headerRange = sheet.getRange(1, 1, 1, 62);
  headerRange.setFontWeight("bold");
  headerRange.setBackground("#9C27B0");
  headerRange.setFontColor("#FFFFFF");
  SpreadsheetApp.flush();
  sheet.getRange(1, 63).setValue("Status Atualização");
  sheet.getRange(1, 63).setFontWeight("bold");
  sheet.getRange(1, 63).setBackground("#17A2B8");
  sheet.getRange(1, 63).setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.getRange("A:B").setNumberFormat("@");
  sheet.getRange("A:A").setBackground("#E1BEE7");
  sheet.getRange("A1").setBackground("#9C27B0");
  sheet.autoResizeColumns(1, 63);
  SpreadsheetApp.flush();
  Logger.log("✅ Planilha criada: " + CONFIG_PESQUISA_TITULOS_CONSOLIDADO.nomePlanilha + " (com col BK para status)");
  Logger.log("✅ Colunas: 62 dados + status em BK");
  escreverStatusStampPT(sheet, "Planilha criada com sucesso.", true);
}

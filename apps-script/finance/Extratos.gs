// ========================================
// CONFIGURAÇÕES - TODAS AS EMPRESAS
// ========================================


var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};


var CONFIG_EXTRATO_CC_CONSOLIDADO = {
  url: "https://app.omie.com.br/api/v1/financas/extrato/",
  urlContasCorrentes: "https://app.omie.com.br/api/v1/geral/contacorrente/",
  nomePlanilha: "ExtratoCC",
  diasParaBuscar: 7,
  contasSemMudancaParaParar: 50,
  contasCorrentesBuscar: {}
};



// ========================================
// FUNÇÕES AUXILIARES
// ========================================


function escreverStatusStampExtrato(sheet, mensagem, ehSucesso) {
  var timezone = Session.getScriptTimeZone(); // Automático
  var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
  var statusTexto = ehSucesso ? "✅ SUCESSO" : "❌ ERRO";
  var mensagemCompleta = statusTexto + " - " + timestamp + ": " + mensagem;
  var celulaStatus = sheet.getRange("AG1");
  celulaStatus.setValue(mensagemCompleta);
  celulaStatus.setFontWeight("bold");
  if (ehSucesso) {
    celulaStatus.setBackground("#D9EAD3").setFontColor("#155724");
  } else {
    celulaStatus.setBackground("#F4CCCC").setFontColor("#721C24");
  }
  Logger.log("📝 Stamp AG1 (" + timezone + "): " + mensagemCompleta);
}


// ⭐ CORRIGIDO: Salvar timestamp Unix (UTC universal)
function salvarTimestampUltimaSyncExtrato() {
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var agora = new Date();
    var unixTime = agora.getTime(); // UTC universal
    var timestampBrasil = Utilities.formatDate(agora, "America/Sao_Paulo", "dd/MM/yyyy HH:mm:ss");
    
    scriptProps.setProperty('Extrato_UltimaSync_UnixTime', String(unixTime));
    scriptProps.setProperty('Extrato_UltimaSync_Display', timestampBrasil);
    
    Logger.log("💾 Timestamp salvo (Unix UTC): " + unixTime + " | Display (Brasil): " + timestampBrasil);
    return unixTime;
  } catch (e) {
    Logger.log("⚠️ Erro ao salvar timestamp: " + e.message);
    return null;
  }
}


// ⭐ CORRIGIDO: Obter timestamp Unix
function obterTimestampUltimaSyncExtrato() {
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var unixTime = scriptProps.getProperty('Extrato_UltimaSync_UnixTime');
    var display = scriptProps.getProperty('Extrato_UltimaSync_Display');
    
    if (unixTime) {
      Logger.log("📅 Última sync: " + display + " (Unix UTC: " + unixTime + ")");
      return parseInt(unixTime);
    } else {
      Logger.log("📅 Primeira execução - sem timestamp anterior");
      return null;
    }
  } catch (e) {
    Logger.log("⚠️ Erro ao obter timestamp: " + e.message);
    return null;
  }
}


function resetarTimestampExtrato() {
  var scriptProps = PropertiesService.getScriptProperties();
  scriptProps.deleteProperty('Extrato_UltimaSync_UnixTime');
  scriptProps.deleteProperty('Extrato_UltimaSync_Display');
  Logger.log("🧹 Timestamp resetado");
}


// ⭐ CORRIGIDO: Comparação com ajuste UTC-3 (Brasil)
function movimentoModificadoAposUltimaSync(movimento, unixTimeUltimaSync) {
  if (!unixTimeUltimaSync) return true;
  
  var dataInclusao = movimento.cDataInclusao || "";
  var horaInclusao = movimento.cHoraInclusao || "";
  
  if (!dataInclusao) return true;
  
  try {
    var partesDataInc = dataInclusao.split("/");
    var partesHoraInc = (horaInclusao || "00:00:00").split(":");
    
    if (partesDataInc.length === 3) {
      // Criar data assumindo horário de Brasília
      var dataIncObj = new Date(
        parseInt(partesDataInc[2]), 
        parseInt(partesDataInc[1]) - 1, 
        parseInt(partesDataInc[0]),
        parseInt(partesHoraInc[0] || 0), 
        parseInt(partesHoraInc[1] || 0), 
        parseInt(partesHoraInc[2] || 0)
      );
      
      // ⭐ AJUSTAR para UTC (compensar diferença de fuso)
      var offsetLocal = dataIncObj.getTimezoneOffset(); // Em minutos
      var offsetBrasil = 180; // UTC-3 = +180 minutos
      var ajusteFuso = (offsetLocal - offsetBrasil) * 60 * 1000; // Converter para ms
      var unixInc = dataIncObj.getTime() - ajusteFuso;
      
      return unixInc > unixTimeUltimaSync;
    }
    
    return true;
  } catch (e) {
    Logger.log("⚠️ Erro ao comparar datas: " + e.message);
    return true;
  }
}


function verificarTempoExecucaoExtrato(horaInicio) {
  var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
  var limiteSegundos = 300;
  if (tempoDecorrido > limiteSegundos) {
    Logger.log("⏱️ Tempo limite: " + tempoDecorrido.toFixed(2) + "s");
    return false;
  }
  return true;
}


function limparPlanilhaCompletaExtrato(sheet) {
  var lastRow = sheet.getLastRow();
  var maxRows = sheet.getMaxRows();
  var lastCol = sheet.getLastColumn();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    Logger.log("✓ Limpo " + (lastRow - 1) + " linhas");
  }
  if (maxRows > 100) {
    var linhasParaDeletar = maxRows - 100;
    if (linhasParaDeletar > 0) {
      sheet.deleteRows(101, linhasParaDeletar);
      Logger.log("✓ Deletadas " + linhasParaDeletar + " vazias");
    }
  }
  sheet.getRange("A:B").setNumberFormat("@");
  Logger.log("✓ Cols A-B TEXTO");
}


function obterListaContasCorrentes(siglaEmpresa) {
  var empresa = EMPRESAS_OMIE[siglaEmpresa];
  var payload = {
    "call": "ListarContasCorrentes",
    "app_key": empresa.appKey,
    "app_secret": empresa.appSecret,
    "param": [{ 
      "pagina": 1, 
      "registros_por_pagina": 500 
    }]
  };
  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };
  try {
    var response = UrlFetchApp.fetch(CONFIG_EXTRATO_CC_CONSOLIDADO.urlContasCorrentes, options);
    var data = JSON.parse(response.getContentText());
    var contas = data.ListarContasCorrentes || [];
    var listaContas = [];
    for (var i = 0; i < contas.length; i++) {
      listaContas.push({
        nCodCC: contas[i].nCodCC,
        descricao: contas[i].descricao
      });
    }
    return listaContas;
  } catch (e) {
    Logger.log("❌ Erro buscar contas " + siglaEmpresa + ": " + e.message);
    return [];
  }
}



// ========================================
// FUNÇÃO 1: IMPORTAR EXTRATO (SIMPLES)
// ========================================


function importarExtratoCC() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_EXTRATO_CC_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    Logger.log("💡 Execute: criarPlanilhaExtratoCC()");
    return;
  }
  var diasBusca = CONFIG_EXTRATO_CC_CONSOLIDADO.diasParaBuscar;
  Logger.log("=== IMPORTANDO EXTRATO - " + diasBusca + " DIAS ===");
  limparPlanilhaCompletaExtrato(sheet);
  var dataFim = new Date();
  var dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - diasBusca);
  var dataInicioStr = Utilities.formatDate(dataInicio, "America/Sao_Paulo", "dd/MM/yyyy");
  var dataFimStr = Utilities.formatDate(dataFim, "America/Sao_Paulo", "dd/MM/yyyy");
  Logger.log("Período: " + dataInicioStr + " até " + dataFimStr);
  var empresas = Object.keys(EMPRESAS_OMIE);
  var totalMovimentosGeral = 0;
  var dadosAcumulados = [];
  for (var e = 0; e < empresas.length; e++) {
    var sigla = empresas[e];
    var empresa = EMPRESAS_OMIE[sigla];
    Logger.log("\n📊 Processando: " + sigla);
    if (!verificarTempoExecucaoExtrato(horaInicio)) {
      Logger.log("⏱️ Tempo limite. Total: " + totalMovimentosGeral);
      break;
    }
    var contasParaBuscar = CONFIG_EXTRATO_CC_CONSOLIDADO.contasCorrentesBuscar[sigla] || [];
    if (contasParaBuscar.length === 0) {
      Logger.log("Buscando todas as contas de " + sigla + "...");
      var todasContas = obterListaContasCorrentes(sigla);
      for (var i = 0; i < todasContas.length; i++) {
        contasParaBuscar.push(todasContas[i].nCodCC);
      }
      Logger.log("Encontradas " + contasParaBuscar.length + " contas");
    }
    var totalMovimentosEmpresa = 0;
    for (var c = 0; c < contasParaBuscar.length; c++) {
      var nCodCC = contasParaBuscar[c];
      if (!verificarTempoExecucaoExtrato(horaInicio)) {
        Logger.log("⏱️ Tempo limite");
        break;
      }
      var payload = {
        "call": "ListarExtrato",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{ 
          "nCodCC": nCodCC,
          "dPeriodoInicial": dataInicioStr,
          "dPeriodoFinal": dataFimStr,
          "cExibirApenasSaldo": "N"
        }]
      };
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload)
      };
      try {
        var response = UrlFetchApp.fetch(CONFIG_EXTRATO_CC_CONSOLIDADO.url, options);
        var data = JSON.parse(response.getContentText());
        if (!data) continue;
        var movimentos = data.listaMovimentos || [];
        for (var i = 0; i < movimentos.length; i++) {
          var m = movimentos[i];
          var row = [
            sigla, nCodCC, data.cDescricao || "", data.nCodBanco || "",
            data.nCodAgencia || "", data.nNumConta || "", m.nCodLancamento || "",
            m.nCodLancRelac || "", m.cSituacao || "", m.dDataLancamento || "",
            m.cDesCliente || "", m.nCodCliente || "", m.cRazCliente || "",
            m.cDocCliente || "", m.cTipoDocumento || "", m.cNumero || "",
            m.nValorDocumento || "", m.nSaldo || "", m.cCodCategoria || "",
            m.cDesCategoria || "", m.cDocumentoFiscal || "", m.cParcela || "",
            m.cNossoNumero || "", m.cOrigem || "", m.cVendedor || "",
            m.cProjeto || "", m.cObservacoes || "", m.cDataInclusao || "",
            m.cHoraInclusao || "", m.cNatureza || "", m.cBloqueado || "",
            m.dDataConciliacao || ""
          ];
          dadosAcumulados.push(row);
          totalMovimentosEmpresa++;
        }
        if (dadosAcumulados.length >= 1000) {
          Logger.log("📝 Inserindo lote " + dadosAcumulados.length + "...");
          sheet.getRange(sheet.getLastRow() + 1, 1, dadosAcumulados.length, 32).setValues(dadosAcumulados);
          SpreadsheetApp.flush();
          dadosAcumulados = [];
        }
      } catch (erro) {
        Logger.log("❌ Erro conta " + nCodCC + ": " + erro.message);
        continue;
      }
    }
    Logger.log("✅ " + sigla + ": " + totalMovimentosEmpresa);
    totalMovimentosGeral += totalMovimentosEmpresa;
    if (e < empresas.length - 1) {
      Utilities.sleep(1000);
    }
  }
  if (dadosAcumulados.length > 0) {
    Logger.log("\n📝 Inserindo lote final " + dadosAcumulados.length + "...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosAcumulados.length, 32).setValues(dadosAcumulados);
    SpreadsheetApp.flush();
  }
  Logger.log("\n=== ✅ FINALIZADO ===");
  Logger.log("Total: " + totalMovimentosGeral);
  Logger.log("Linhas: " + (sheet.getLastRow() - 1));
  escreverStatusStampExtrato(sheet, "Importação completa. Total: " + totalMovimentosGeral, true);
}



// ========================================
// FUNÇÃO 2: IMPORTAR COM RETOMADA
// ========================================


function importarExtratoCC_ComRetomada() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_EXTRATO_CC_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    return;
  }
  var scriptProps = PropertiesService.getScriptProperties();
  var diasBusca = CONFIG_EXTRATO_CC_CONSOLIDADO.diasParaBuscar;
  var empresaAtual = scriptProps.getProperty('Extrato_empresaAtual') || 'SF';
  var contaAtualIndex = parseInt(scriptProps.getProperty('Extrato_contaAtualIndex') || '0');
  var totalMovimentos = parseInt(scriptProps.getProperty('Extrato_totalMovimentos') || '0');
  var isNovaExecucao = (contaAtualIndex === 0 && empresaAtual === 'SF');
  if (isNovaExecucao) {
    Logger.log("=== INICIANDO IMPORTAÇÃO COMPLETA ===");
    limparPlanilhaCompletaExtrato(sheet);
  } else {
    Logger.log("=== RETOMANDO ===");
    Logger.log("Empresa: " + empresaAtual + " | Conta: " + contaAtualIndex);
    Logger.log("Total: " + totalMovimentos);
  }
  var dataFim = new Date();
  var dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - diasBusca);
  var dataInicioStr = Utilities.formatDate(dataInicio, "America/Sao_Paulo", "dd/MM/yyyy");
  var dataFimStr = Utilities.formatDate(dataFim, "America/Sao_Paulo", "dd/MM/yyyy");
  Logger.log("Período: " + dataInicioStr + " até " + dataFimStr);
  var empresas = Object.keys(EMPRESAS_OMIE);
  var empresaStartIndex = empresas.indexOf(empresaAtual);
  if (empresaStartIndex === -1) {
    Logger.log("❌ Empresa inválida");
    limparEstadoRetomadaExtrato();
    return;
  }
  var dadosAcumulados = [];
  var MAX_TEMPO_EXECUCAO = 270000;
  for (var e = empresaStartIndex; e < empresas.length; e++) {
    var sigla = empresas[e];
    var empresa = EMPRESAS_OMIE[sigla];
    Logger.log("\n📊 Processando: " + sigla);
    var tempoDecorrido = (new Date().getTime() - horaInicio);
    if (tempoDecorrido > MAX_TEMPO_EXECUCAO) {
      Logger.log("⏱️ Limite tempo. Salvando...");
      scriptProps.setProperty('Extrato_empresaAtual', sigla);
      scriptProps.setProperty('Extrato_contaAtualIndex', String(contaAtualIndex));
      scriptProps.setProperty('Extrato_totalMovimentos', String(totalMovimentos));
      criarTriggerRetomadaExtrato();
      Logger.log("🔄 Trigger 1 min");
      return;
    }
    var contasParaBuscar = CONFIG_EXTRATO_CC_CONSOLIDADO.contasCorrentesBuscar[sigla] || [];
    if (contasParaBuscar.length === 0) {
      var todasContas = obterListaContasCorrentes(sigla);
      for (var i = 0; i < todasContas.length; i++) {
        contasParaBuscar.push(todasContas[i].nCodCC);
      }
    }
    var startIndex = (sigla === empresaAtual) ? contaAtualIndex : 0;
    for (var c = startIndex; c < contasParaBuscar.length; c++) {
      var nCodCC = contasParaBuscar[c];
      tempoDecorrido = (new Date().getTime() - horaInicio);
      if (tempoDecorrido > MAX_TEMPO_EXECUCAO) {
        Logger.log("⏱️ Limite tempo");
        scriptProps.setProperty('Extrato_empresaAtual', sigla);
        scriptProps.setProperty('Extrato_contaAtualIndex', String(c));
        scriptProps.setProperty('Extrato_totalMovimentos', String(totalMovimentos));
        criarTriggerRetomadaExtrato();
        return;
      }
      var payload = {
        "call": "ListarExtrato",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{ 
          "nCodCC": nCodCC,
          "dPeriodoInicial": dataInicioStr,
          "dPeriodoFinal": dataFimStr,
          "cExibirApenasSaldo": "N"
        }]
      };
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload)
      };
      try {
        var response = UrlFetchApp.fetch(CONFIG_EXTRATO_CC_CONSOLIDADO.url, options);
        var data = JSON.parse(response.getContentText());
        if (!data) continue;
        var movimentos = data.listaMovimentos || [];
        for (var i = 0; i < movimentos.length; i++) {
          var m = movimentos[i];
          var row = [
            sigla, nCodCC, data.cDescricao || "", data.nCodBanco || "",
            data.nCodAgencia || "", data.nNumConta || "", m.nCodLancamento || "",
            m.nCodLancRelac || "", m.cSituacao || "", m.dDataLancamento || "",
            m.cDesCliente || "", m.nCodCliente || "", m.cRazCliente || "",
            m.cDocCliente || "", m.cTipoDocumento || "", m.cNumero || "",
            m.nValorDocumento || "", m.nSaldo || "", m.cCodCategoria || "",
            m.cDesCategoria || "", m.cDocumentoFiscal || "", m.cParcela || "",
            m.cNossoNumero || "", m.cOrigem || "", m.cVendedor || "",
            m.cProjeto || "", m.cObservacoes || "", m.cDataInclusao || "",
            m.cHoraInclusao || "", m.cNatureza || "", m.cBloqueado || "",
            m.dDataConciliacao || ""
          ];
          dadosAcumulados.push(row);
          totalMovimentos++;
        }
        if (dadosAcumulados.length >= 1000) {
          Logger.log("📝 Inserindo lote " + dadosAcumulados.length + "...");
          sheet.getRange(sheet.getLastRow() + 1, 1, dadosAcumulados.length, 32).setValues(dadosAcumulados);
          SpreadsheetApp.flush();
          dadosAcumulados = [];
        }
      } catch (erro) {
        Logger.log("❌ Erro: " + erro.message);
        continue;
      }
    }
    Logger.log("✅ " + sigla + " ok");
    contaAtualIndex = 0;
  }
  if (dadosAcumulados.length > 0) {
    Logger.log("\n📝 Inserindo lote final...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosAcumulados.length, 32).setValues(dadosAcumulados);
    SpreadsheetApp.flush();
  }
  Logger.log("\n=== ✅ COMPLETO ===");
  Logger.log("Total: " + totalMovimentos);
  limparEstadoRetomadaExtrato();
  removerTriggersRetomadaExtrato();
  escreverStatusStampExtrato(sheet, "Importação completa. Total: " + totalMovimentos, true);
}



// ========================================
// FUNÇÃO 3: ATUALIZAR COM EARLY STOP
// ========================================


function atualizarExtratoCC_ComRetomada() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_EXTRATO_CC_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    return;
  }
  var scriptProps = PropertiesService.getScriptProperties();
  var diasBusca = CONFIG_EXTRATO_CC_CONSOLIDADO.diasParaBuscar;
  var empresaAtual = scriptProps.getProperty('ExtratoAtualiza_empresaAtual') || 'SF';
  var contaAtualIndex = parseInt(scriptProps.getProperty('ExtratoAtualiza_contaAtualIndex') || '0');
  var novos = parseInt(scriptProps.getProperty('ExtratoAtualiza_novos') || '0');
  var atualizados = parseInt(scriptProps.getProperty('ExtratoAtualiza_atualizados') || '0');
  var ignorados = parseInt(scriptProps.getProperty('ExtratoAtualiza_ignorados') || '0');
  var isNovaExecucao = (contaAtualIndex === 0 && empresaAtual === 'SF');
  if (isNovaExecucao) {
    Logger.log("=== ATUALIZAÇÃO INTELIGENTE ===");
  } else {
    Logger.log("=== RETOMANDO ===");
    Logger.log("Empresa: " + empresaAtual + " | Conta: " + contaAtualIndex);
    Logger.log("Novos: " + novos + " | Atual: " + atualizados + " | Ignor: " + ignorados);
  }
  
  // Obter timestamp da última sync (Unix time UTC)
  var unixTimeUltimaSync = obterTimestampUltimaSyncExtrato();
  
  sheet.getRange("A:B").setNumberFormat("@");
  var lastRow = sheet.getLastRow();
  var mapaCodigosLinhas = new Map();
  if (lastRow > 1) {
    Logger.log("📥 Carregando índice...");
    var dados = sheet.getRange(2, 1, lastRow - 1, 7).getValues();
    for (var i = 0; i < dados.length; i++) {
      var empresa = String(dados[i][0] || "").trim();
      var codConta = String(dados[i][1] || "").trim();
      var codLancamento = String(dados[i][6] || "").trim();
      if (empresa && codConta && codLancamento) {
        var chave = empresa + "|" + codConta + "|" + codLancamento;
        mapaCodigosLinhas.set(chave, i + 2);
      }
    }
    Logger.log("✅ " + mapaCodigosLinhas.size + " movimentos existentes");
  }
  var dataFim = new Date();
  var dataInicio = new Date();
  dataInicio.setDate(dataInicio.getDate() - diasBusca);
  var dataInicioStr = Utilities.formatDate(dataInicio, "America/Sao_Paulo", "dd/MM/yyyy");
  var dataFimStr = Utilities.formatDate(dataFim, "America/Sao_Paulo", "dd/MM/yyyy");
  Logger.log("Período: " + dataInicioStr + " até " + dataFimStr);
  var empresas = Object.keys(EMPRESAS_OMIE);
  var empresaStartIndex = empresas.indexOf(empresaAtual);
  if (empresaStartIndex === -1) {
    Logger.log("❌ Empresa inválida");
    limparEstadoRetomadaExtratoAtualiza();
    return;
  }
  var dadosNovos = [];
  var MAX_TEMPO_EXECUCAO = 270000;
  
  for (var e = empresaStartIndex; e < empresas.length; e++) {
    var sigla = empresas[e];
    var empresa = EMPRESAS_OMIE[sigla];
    Logger.log("\n📊 Sync: " + sigla);
    var tempoDecorrido = (new Date().getTime() - horaInicio);
    if (tempoDecorrido > MAX_TEMPO_EXECUCAO) {
      Logger.log("⏱️ Limite tempo. Salvando...");
      scriptProps.setProperty('ExtratoAtualiza_empresaAtual', sigla);
      scriptProps.setProperty('ExtratoAtualiza_contaAtualIndex', String(contaAtualIndex));
      scriptProps.setProperty('ExtratoAtualiza_novos', String(novos));
      scriptProps.setProperty('ExtratoAtualiza_atualizados', String(atualizados));
      scriptProps.setProperty('ExtratoAtualiza_ignorados', String(ignorados));
      criarTriggerRetomadaExtratoAtualiza();
      Logger.log("🔄 Trigger 1 min");
      return;
    }
    var contasParaBuscar = CONFIG_EXTRATO_CC_CONSOLIDADO.contasCorrentesBuscar[sigla] || [];
    if (contasParaBuscar.length === 0) {
      var todasContas = obterListaContasCorrentes(sigla);
      for (var i = 0; i < todasContas.length; i++) {
        contasParaBuscar.push(todasContas[i].nCodCC);
      }
    }
    var startIndex = (sigla === empresaAtual) ? contaAtualIndex : 0;
    var contasSemMudanca = 0;
    var MAX_CONTAS_SEM_MUDANCA = CONFIG_EXTRATO_CC_CONSOLIDADO.contasSemMudancaParaParar;
    
    for (var c = startIndex; c < contasParaBuscar.length; c++) {
      var nCodCC = contasParaBuscar[c];
      tempoDecorrido = (new Date().getTime() - horaInicio);
      if (tempoDecorrido > MAX_TEMPO_EXECUCAO) {
        Logger.log("⏱️ Limite tempo");
        scriptProps.setProperty('ExtratoAtualiza_empresaAtual', sigla);
        scriptProps.setProperty('ExtratoAtualiza_contaAtualIndex', String(c));
        scriptProps.setProperty('ExtratoAtualiza_novos', String(novos));
        scriptProps.setProperty('ExtratoAtualiza_atualizados', String(atualizados));
        scriptProps.setProperty('ExtratoAtualiza_ignorados', String(ignorados));
        criarTriggerRetomadaExtratoAtualiza();
        return;
      }
      
      if (contasSemMudanca >= MAX_CONTAS_SEM_MUDANCA) {
        Logger.log("🛑 Early Stop: " + contasSemMudanca + " contas sem mudanças");
        break;
      }
      
      var payload = {
        "call": "ListarExtrato",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{ 
          "nCodCC": nCodCC,
          "dPeriodoInicial": dataInicioStr,
          "dPeriodoFinal": dataFimStr,
          "cExibirApenasSaldo": "N"
        }]
      };
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload)
      };
      try {
        var response = UrlFetchApp.fetch(CONFIG_EXTRATO_CC_CONSOLIDADO.url, options);
        var data = JSON.parse(response.getContentText());
        if (!data) continue;
        var movimentos = data.listaMovimentos || [];
        var mudancasNestaConta = 0;
        
        for (var i = 0; i < movimentos.length; i++) {
          var m = movimentos[i];
          var codContaStr = String(nCodCC).trim();
          var codLancStr = String(m.nCodLancamento || "").trim();
          if (!codLancStr) continue;
          var chave = sigla + "|" + codContaStr + "|" + codLancStr;
          
          // ⭐ Verificar se foi modificado (com ajuste UTC)
          var foiModificado = movimentoModificadoAposUltimaSync(m, unixTimeUltimaSync);
          
          var row = [
            sigla, nCodCC, data.cDescricao || "", data.nCodBanco || "",
            data.nCodAgencia || "", data.nNumConta || "", m.nCodLancamento || "",
            m.nCodLancRelac || "", m.cSituacao || "", m.dDataLancamento || "",
            m.cDesCliente || "", m.nCodCliente || "", m.cRazCliente || "",
            m.cDocCliente || "", m.cTipoDocumento || "", m.cNumero || "",
            m.nValorDocumento || "", m.nSaldo || "", m.cCodCategoria || "",
            m.cDesCategoria || "", m.cDocumentoFiscal || "", m.cParcela || "",
            m.cNossoNumero || "", m.cOrigem || "", m.cVendedor || "",
            m.cProjeto || "", m.cObservacoes || "", m.cDataInclusao || "",
            m.cHoraInclusao || "", m.cNatureza || "", m.cBloqueado || "",
            m.dDataConciliacao || ""
          ];
          
          if (mapaCodigosLinhas.has(chave)) {
            if (foiModificado) {
              var linha = mapaCodigosLinhas.get(chave);
              sheet.getRange(linha, 1, 1, 32).setValues([row]);
              atualizados++;
              mudancasNestaConta++;
            } else {
              ignorados++;
            }
          } else {
            dadosNovos.push(row);
            novos++;
            mudancasNestaConta++;
          }
        }
        
        if (mudancasNestaConta === 0) {
          contasSemMudanca++;
        } else {
          contasSemMudanca = 0;
        }
        
        if (dadosNovos.length >= 1000) {
          Logger.log("📝 Inserindo lote " + dadosNovos.length + "...");
          sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, 32).setValues(dadosNovos);
          SpreadsheetApp.flush();
          dadosNovos = [];
        }
      } catch (erro) {
        Logger.log("❌ Erro: " + erro.message);
        continue;
      }
    }
    Logger.log("✅ " + sigla + " - Novos: " + novos + " | Atual: " + atualizados + " | Ignor: " + ignorados);
    contaAtualIndex = 0;
  }
  if (dadosNovos.length > 0) {
    Logger.log("\n📝 Inserindo lote final...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, 32).setValues(dadosNovos);
    SpreadsheetApp.flush();
  }
  Logger.log("\n=== ✅ COMPLETO ===");
  Logger.log("🆕 Novos: " + novos);
  Logger.log("🔄 Atual: " + atualizados);
  Logger.log("⏭️  Ignor: " + ignorados);
  Logger.log("📊 Total: " + (sheet.getLastRow() - 1));
  limparEstadoRetomadaExtratoAtualiza();
  removerTriggersRetomadaExtratoAtualiza();
  
  // Salvar timestamp
  salvarTimestampUltimaSyncExtrato();
  escreverStatusStampExtrato(sheet, 
    "Atualização " + diasBusca + " dias OK. Novos: " + novos + 
    ", Atual: " + atualizados + 
    ", Ignor: " + ignorados + 
    ", Total: " + (sheet.getLastRow() - 1), 
    true);
}



// ========================================
// FUNÇÕES DE GERENCIAMENTO
// ========================================


function criarTriggerRetomadaExtrato() {
  removerTriggersRetomadaExtrato();
  var proximaExecucao = new Date();
  proximaExecucao.setMinutes(proximaExecucao.getMinutes() + 1);
  ScriptApp.newTrigger('importarExtratoCC_ComRetomada').timeBased().at(proximaExecucao).create();
  Logger.log("✅ Trigger: " + proximaExecucao);
}


function removerTriggersRetomadaExtrato() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'importarExtratoCC_ComRetomada') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}


function limparEstadoRetomadaExtrato() {
  var scriptProps = PropertiesService.getScriptProperties();
  scriptProps.deleteProperty('Extrato_empresaAtual');
  scriptProps.deleteProperty('Extrato_contaAtualIndex');
  scriptProps.deleteProperty('Extrato_totalMovimentos');
  Logger.log("🧹 Estado limpo");
}


function resetarRetomadaExtrato() {
  limparEstadoRetomadaExtrato();
  removerTriggersRetomadaExtrato();
  Logger.log("✅ Reset");
}


function criarTriggerRetomadaExtratoAtualiza() {
  removerTriggersRetomadaExtratoAtualiza();
  var proximaExecucao = new Date();
  proximaExecucao.setMinutes(proximaExecucao.getMinutes() + 1);
  ScriptApp.newTrigger('atualizarExtratoCC_ComRetomada').timeBased().at(proximaExecucao).create();
  Logger.log("✅ Trigger: " + proximaExecucao);
}


function removerTriggersRetomadaExtratoAtualiza() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'atualizarExtratoCC_ComRetomada') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}


function limparEstadoRetomadaExtratoAtualiza() {
  var scriptProps = PropertiesService.getScriptProperties();
  scriptProps.deleteProperty('ExtratoAtualiza_empresaAtual');
  scriptProps.deleteProperty('ExtratoAtualiza_contaAtualIndex');
  scriptProps.deleteProperty('ExtratoAtualiza_novos');
  scriptProps.deleteProperty('ExtratoAtualiza_atualizados');
  scriptProps.deleteProperty('ExtratoAtualiza_ignorados');
  Logger.log("🧹 Estado limpo");
}


function resetarRetomadaExtratoAtualiza() {
  limparEstadoRetomadaExtratoAtualiza();
  removerTriggersRetomadaExtratoAtualiza();
  Logger.log("✅ Reset");
}



// ========================================
// FUNÇÃO: CRIAR PLANILHA
// ========================================


function criarPlanilhaExtratoCC() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_EXTRATO_CC_CONSOLIDADO.nomePlanilha);
  if (sheet) {
    Logger.log("⚠️ Deletando existente...");
    ss.deleteSheet(sheet);
  }
  sheet = ss.insertSheet(CONFIG_EXTRATO_CC_CONSOLIDADO.nomePlanilha);
  var cabecalho = [
    "empresa", "cod_conta_corrente", "desc_conta", "cod_banco", "cod_agencia", "num_conta",
    "cod_lancamento", "cod_lanc_relacionado", "situacao", "data_lancamento",
    "cliente_fornecedor_fantasia", "cod_cliente_fornecedor", "cliente_fornecedor_razao",
    "cliente_fornecedor_doc", "tipo_documento", "numero_documento", "valor_documento",
    "saldo", "cod_categoria", "desc_categoria", "documento_fiscal", "parcela",
    "nosso_numero", "origem", "vendedor", "projeto", "observacoes",
    "data_inclusao", "hora_inclusao", "natureza", "bloqueado", "data_conciliacao"
  ];
  sheet.getRange(1, 1, 1, 32).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, 32).setFontWeight("bold");
  sheet.getRange(1, 1, 1, 32).setBackground("#4285F4");
  sheet.getRange(1, 1, 1, 32).setFontColor("#FFFFFF");
  sheet.getRange(1, 33).setValue("Status Atualização");
  sheet.getRange(1, 33).setFontWeight("bold");
  sheet.getRange(1, 33).setBackground("#17A2B8");
  sheet.getRange(1, 33).setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 33);
  sheet.getRange("A:B").setNumberFormat("@");
  sheet.getRange("A:A").setBackground("#D0E1F9");
  sheet.getRange("A1").setBackground("#4285F4");
  Logger.log("✅ Planilha criada: " + CONFIG_EXTRATO_CC_CONSOLIDADO.nomePlanilha + " (com col AG)");
  escreverStatusStampExtrato(sheet, "Planilha criada com sucesso.", true);
}

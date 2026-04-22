// ========================================
// CONFIGURAÇÕES - PESQUISA DE TÍTULOS
// ========================================

var CONFIG_PESQUISA_TITULOS = {
  appKey: "823997176002",
  appSecret: "4bfd2504503d076365ec4dee298b37eb",
  url: "https://app.omie.com.br/api/v1/financas/pesquisartitulos/",
  nomePlanilha: "PesquisaTitulos_SF",
  maxPaginas: 1000,
  paginasPorExecucao: 50,
  
  // ⚙️ CONFIGURAÇÃO: DEFINA AQUI O PERÍODO DE EMISSÃO
  dataEmissaoInicio: "01/01/2025",  // Data inicial de emissão (formato DD/MM/YYYY)
  dataEmissaoFim: "31/12/2026",     // Data final de emissão (formato DD/MM/YYYY)
  
  // ⚙️ CONFIGURAÇÃO: RETRY EM CASO DE ERRO 500
  tentativasRetry: 3,           // Número de tentativas por página
  delayEntreRetry: 10,          // Segundos entre tentativas (10s, 20s, 30s...)
  delayAposErroTotal: 5         // MINUTOS para aguardar antes de retomar após falha total
};

// ========================================
// FUNÇÃO AUXILIAR: VERIFICAR TEMPO
// ========================================

function verificarTempoExecucaoPT_SF(horaInicio) {
  var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
  var limiteSegundos = 280;
  
  if (tempoDecorrido > limiteSegundos) {
    Logger.log("Atingido limite de tempo de execução (" + tempoDecorrido + "s). Parando importação.");
    return false;
  }
  return true;
}

// ========================================
// FUNÇÃO AUXILIAR: LIMPAR PLANILHA
// ========================================

function limparPlanilhaCompletaPT_SF(sheet) {
  var lastRow = sheet.getLastRow();
  var maxRows = sheet.getMaxRows();
  var lastCol = sheet.getLastColumn();
  
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    Logger.log("Conteúdo limpo de " + (lastRow - 1) + " linhas.");
  }
  
  if (maxRows > 100) {
    var linhasParaDeletar = maxRows - 100;
    if (linhasParaDeletar > 0) {
      sheet.deleteRows(101, linhasParaDeletar);
      Logger.log("Deletadas " + linhasParaDeletar + " linhas vazias extras.");
    }
  }
  
  sheet.getRange("A:A").setNumberFormat("@");
  Logger.log("Coluna A formatada como TEXTO.");
  Logger.log("Planilha limpa. Linhas totais: " + sheet.getMaxRows());
}

// ========================================
// FUNÇÃO 1: RECRIAR BASE - PACOTES
// ========================================

function recriarBasePesquisaTitulos_Pacote1_SF() {
  importarPesquisaTitulosPorLote_SF(1, 50);
}

function recriarBasePesquisaTitulos_Pacote2_SF() {
  importarPesquisaTitulosPorLote_SF(51, 100);
}

function recriarBasePesquisaTitulos_Pacote3_SF() {
  importarPesquisaTitulosPorLote_SF(101, 150);
}

function recriarBasePesquisaTitulos_Pacote4_SF() {
  importarPesquisaTitulosPorLote_SF(151, 200);
}

function recriarBasePesquisaTitulos_Pacote5_SF() {
  importarPesquisaTitulosPorLote_SF(201, 250);
}

function recriarBasePesquisaTitulos_Pacote6_SF() {
  importarPesquisaTitulosPorLote_SF(251, 300);
}

function recriarBasePesquisaTitulos_Pacote7_SF() {
  importarPesquisaTitulosPorLote_SF(301, 350);
}

function recriarBasePesquisaTitulos_Pacote8_SF() {
  importarPesquisaTitulosPorLote_SF(351, 400);
}

function recriarBasePesquisaTitulos_Pacote9_SF() {
  importarPesquisaTitulosPorLote_SF(401, 450);
}

function recriarBasePesquisaTitulos_Pacote10_SF() {
  importarPesquisaTitulosPorLote_SF(451, 500);
}

function recriarBasePesquisaTitulos_Pacote11_SF() {
  importarPesquisaTitulosPorLote_SF(501, 550);
}

function recriarBasePesquisaTitulos_Pacote12_SF() {
  importarPesquisaTitulosPorLote_SF(551, 600);
}

function recriarBasePesquisaTitulos_Pacote13_SF() {
  importarPesquisaTitulosPorLote_SF(601, 650);
}

function recriarBasePesquisaTitulos_Pacote14_SF() {
  importarPesquisaTitulosPorLote_SF(651, 700);
}

// ========================================
// FUNÇÃO CORE: IMPORTAR POR LOTE
// ========================================

function importarPesquisaTitulosPorLote_SF(paginaInicial, paginaFinal) {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PESQUISA_TITULOS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    return;
  }

  Logger.log("=== IMPORTANDO TÍTULOS - PÁGINAS " + paginaInicial + " A " + paginaFinal + " ===");
  Logger.log("Pacote de ~5.000 registros");
  
  if (paginaInicial === 1) {
    limparPlanilhaCompletaPT_SF(sheet);
  } else {
    sheet.getRange("A:A").setNumberFormat("@");
  }

  var pagina = paginaInicial;
  var totalImportados = 0;
  var paginasProcessadas = 0;
  var dadosAcumulados = [];
  
  do {
    if (pagina > paginaFinal) {
      Logger.log("Atingido limite da faixa (página " + paginaFinal + "). Parando.");
      break;
    }
    
    if (!verificarTempoExecucaoPT_SF(horaInicio)) {
      Logger.log("⏱️ Tempo limite atingido. Importados: " + totalImportados + " | Última página: " + (pagina - 1));
      Logger.log("▶️ Execute o próximo pacote para continuar");
      break;
    }
    
    var payload = {
      "call": "PesquisarLancamentos",
      "app_key": CONFIG_PESQUISA_TITULOS.appKey,
      "app_secret": CONFIG_PESQUISA_TITULOS.appSecret,
      "param": [{ 
        "nPagina": pagina,
        "nRegPorPagina": 100,
        "lDadosCad": true
      }]
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload)
    };

    try {
      var response = UrlFetchApp.fetch(CONFIG_PESQUISA_TITULOS.url, options);
      var data = JSON.parse(response.getContentText());
      
      if (!data || typeof data !== 'object') {
        Logger.log("Erro: Resposta inválida na página " + pagina);
        break;
      }
      
      var titulos = data.titulosEncontrados || [];
      
      if (titulos.length === 0) {
        Logger.log("Nenhum título na página " + pagina + ". Finalizando.");
        break;
      }
      
      for (var i = 0; i < titulos.length; i++) {
        var t = titulos[i].cabecTitulo || {};
        var info = t.info || {};
        var resumo = titulos[i].resumo || {};
        var categorias = Array.isArray(t.aCodCateg) ? t.aCodCateg.map(function(cat) { 
          return cat.cCodCateg || ""; 
        }).join(", ") : "";
        
        var row = [
          t.nCodTitulo || "", t.cCodIntTitulo || "", t.cNumTitulo || "",
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
        Logger.log("Página " + pagina + "/" + paginaFinal + " | Total acumulado: " + totalImportados);
      }
      
      paginasProcessadas++;
      pagina++;
      
      if (dadosAcumulados.length >= 500) {
        sheet.getRange(sheet.getLastRow() + 1, 1, dadosAcumulados.length, dadosAcumulados[0].length).setValues(dadosAcumulados);
        dadosAcumulados = [];
      }
      
    } catch (e) {
      Logger.log("ERRO na página " + pagina + ": " + e.message);
      break;
    }
    
  } while (pagina <= paginaFinal);
  
  if (dadosAcumulados.length > 0) {
    Logger.log("Inserindo lote final de " + dadosAcumulados.length + " registros...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosAcumulados.length, dadosAcumulados[0].length).setValues(dadosAcumulados);
  }
  
  Logger.log("=== ✅ PACOTE FINALIZADO ===");
  Logger.log("Total importado neste pacote: " + totalImportados);
  Logger.log("Páginas processadas: " + paginasProcessadas);
  Logger.log("Linhas totais na planilha: " + (sheet.getLastRow() - 1));
  
  var tempoTotal = Math.round((new Date().getTime() - horaInicio) / 1000);
  Logger.log("⏱️ Tempo de execução: " + tempoTotal + " segundos");
}

// ========================================
// FUNÇÃO 2: ATUALIZAÇÃO COM RETOMADA AUTOMÁTICA
// ========================================

function atualizarPesquisaTitulos_ComRetomada_SF() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PESQUISA_TITULOS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    return;
  }

  var scriptProps = PropertiesService.getScriptProperties();
  var dataEmissaoInicio = CONFIG_PESQUISA_TITULOS.dataEmissaoInicio;
  var dataEmissaoFim = CONFIG_PESQUISA_TITULOS.dataEmissaoFim;
  
  var paginaAtual = parseInt(scriptProps.getProperty('PT_paginaAtual') || '1');
  var totalPaginas = parseInt(scriptProps.getProperty('PT_totalPaginas') || '1');
  var novos = parseInt(scriptProps.getProperty('PT_novos') || '0');
  var atualizados = parseInt(scriptProps.getProperty('PT_atualizados') || '0');
  var errosConsecutivos = parseInt(scriptProps.getProperty('PT_errosConsecutivos') || '0');
  
  Logger.log("=== RETOMANDO ATUALIZAÇÃO - PÁGINA " + paginaAtual + " ===");
  Logger.log("Período de emissão: " + dataEmissaoInicio + " a " + dataEmissaoFim);
  Logger.log("Progresso anterior: Novos=" + novos + " | Atualizados=" + atualizados);
  if (errosConsecutivos > 0) {
    Logger.log("⚠️ Erros consecutivos detectados: " + errosConsecutivos);
  }
  
  sheet.getRange("A:A").setNumberFormat("@");
  
  var lastRow = sheet.getLastRow();
  var mapaCodigosLinhas = new Map();
  
  if (lastRow > 1) {
    var codigos = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < codigos.length; i++) {
      var codigo = codigos[i][0];
      if (codigo !== "" && codigo !== null && codigo !== undefined) {
        mapaCodigosLinhas.set(String(codigo).trim(), i + 2);
      }
    }
  }

  var dadosNovos = [];
  var MAX_TEMPO_EXECUCAO = 270000;
  
  do {
    var tempoDecorrido = (new Date().getTime() - horaInicio);
    
    if (tempoDecorrido > MAX_TEMPO_EXECUCAO) {
      Logger.log("⏱️ Limite de tempo atingido. Salvando progresso...");
      
      scriptProps.setProperty('PT_paginaAtual', String(paginaAtual));
      scriptProps.setProperty('PT_totalPaginas', String(totalPaginas));
      scriptProps.setProperty('PT_novos', String(novos));
      scriptProps.setProperty('PT_atualizados', String(atualizados));
      scriptProps.setProperty('PT_errosConsecutivos', String(errosConsecutivos));
      
      criarTriggerRetomadaPT_SF(1);
      
      Logger.log("🔄 Trigger criado para retomar em 1 minuto.");
      Logger.log("📊 Progresso salvo: Página " + paginaAtual + "/" + totalPaginas);
      return;
    }
    
    var payload = {
      "call": "PesquisarLancamentos",
      "app_key": CONFIG_PESQUISA_TITULOS.appKey,
      "app_secret": CONFIG_PESQUISA_TITULOS.appSecret,
      "param": [{ 
        "nPagina": paginaAtual,
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

    // Sistema de Retry
    var tentativas = 0;
    var maxTentativas = CONFIG_PESQUISA_TITULOS.tentativasRetry;
    var delayBase = CONFIG_PESQUISA_TITULOS.delayEntreRetry;
    var sucesso = false;
    var data = null;
    
    while (tentativas < maxTentativas && !sucesso) {
      try {
        var response = UrlFetchApp.fetch(CONFIG_PESQUISA_TITULOS.url, options);
        var responseCode = response.getResponseCode();
        
        if (responseCode === 200) {
          data = JSON.parse(response.getContentText());
          sucesso = true;
          errosConsecutivos = 0;
        } else if (responseCode === 500) {
          tentativas++;
          Logger.log("⚠️ Erro 500 na página " + paginaAtual + " (tentativa " + tentativas + "/" + maxTentativas + ")");
          
          if (tentativas < maxTentativas) {
            var delaySegundos = tentativas * delayBase;
            Logger.log("⏳ Aguardando " + delaySegundos + " segundos antes de retentar...");
            Utilities.sleep(delaySegundos * 1000);
          }
        } else {
          Logger.log("ERRO HTTP " + responseCode + ": " + response.getContentText());
          break;
        }
        
      } catch (e) {
        tentativas++;
        Logger.log("⚠️ Exceção na página " + paginaAtual + ": " + e.message + " (tentativa " + tentativas + "/" + maxTentativas + ")");
        
        if (tentativas < maxTentativas) {
          var delaySegundos = tentativas * delayBase;
          Logger.log("⏳ Aguardando " + delaySegundos + " segundos antes de retentar...");
          Utilities.sleep(delaySegundos * 1000);
        }
      }
    }
    
    if (!sucesso) {
      errosConsecutivos++;
      Logger.log("❌ Falha após " + maxTentativas + " tentativas na página " + paginaAtual);
      Logger.log("📊 Erros consecutivos: " + errosConsecutivos);
      
      if (errosConsecutivos >= 3) {
        Logger.log("🛑 Muitos erros consecutivos. Pausando por " + CONFIG_PESQUISA_TITULOS.delayAposErroTotal + " minutos...");
        
        scriptProps.setProperty('PT_paginaAtual', String(paginaAtual));
        scriptProps.setProperty('PT_totalPaginas', String(totalPaginas));
        scriptProps.setProperty('PT_novos', String(novos));
        scriptProps.setProperty('PT_atualizados', String(atualizados));
        scriptProps.setProperty('PT_errosConsecutivos', String(errosConsecutivos));
        
        criarTriggerRetomadaPT_SF(CONFIG_PESQUISA_TITULOS.delayAposErroTotal);
        
        Logger.log("🔄 Trigger criado para retomar em " + CONFIG_PESQUISA_TITULOS.delayAposErroTotal + " minutos.");
        return;
      }
      
      paginaAtual++;
      continue;
    }
    
    if (!data) break;
    
    totalPaginas = data.nTotPaginas || 1;
    var titulos = data.titulosEncontrados || [];
    
    if (titulos.length === 0) break;
    
    for (var i = 0; i < titulos.length; i++) {
      var t = titulos[i].cabecTitulo || {};
      var info = t.info || {};
      var resumo = titulos[i].resumo || {};
      var categorias = Array.isArray(t.aCodCateg) ? t.aCodCateg.map(function(cat) { 
        return cat.cCodCateg || ""; 
      }).join(", ") : "";
      
      var row = [
        t.nCodTitulo || "", t.cCodIntTitulo || "", t.cNumTitulo || "",
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
      
      var codigoStr = String(t.nCodTitulo || "").trim();
      if (!codigoStr) continue;
      
      if (mapaCodigosLinhas.has(codigoStr)) {
        var linha = mapaCodigosLinhas.get(codigoStr);
        sheet.getRange(linha, 1, 1, row.length).setValues([row]);
        atualizados++;
      } else {
        dadosNovos.push(row);
        novos++;
      }
    }
    
    Logger.log("Página " + paginaAtual + "/" + totalPaginas + " - Novos: " + novos + " | Atualizados: " + atualizados);
    paginaAtual++;
    
    Utilities.sleep(1000);
    
  } while (paginaAtual <= totalPaginas);

  if (dadosNovos.length > 0) {
    Logger.log("Inserindo " + dadosNovos.length + " novos títulos...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, dadosNovos[0].length).setValues(dadosNovos);
  }

  if (paginaAtual > totalPaginas) {
    Logger.log("=== ✅ ATUALIZAÇÃO COMPLETA ===");
    Logger.log("🆕 Novos: " + novos);
    Logger.log("🔄 Atualizados: " + atualizados);
    Logger.log("📊 Total: " + (sheet.getLastRow() - 1));
    
    limparEstadoRetomadaPT_SF();
    removerTriggersRetomadaPT_SF();
  }
}

// ========================================
// FUNÇÕES DE SUPORTE À RETOMADA
// ========================================

function criarTriggerRetomadaPT_SF(delayMinutos) {
  removerTriggersRetomadaPT_SF();
  
  var proximaExecucao = new Date();
  proximaExecucao.setMinutes(proximaExecucao.getMinutes() + delayMinutos);
  
  ScriptApp.newTrigger('atualizarPesquisaTitulos_ComRetomada_SF')
    .timeBased()
    .at(proximaExecucao)
    .create();
  
  Logger.log("✅ Trigger criado para: " + proximaExecucao);
}

function removerTriggersRetomadaPT_SF() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'atualizarPesquisaTitulos_ComRetomada_SF') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

function limparEstadoRetomadaPT_SF() {
  var scriptProps = PropertiesService.getScriptProperties();
  scriptProps.deleteProperty('PT_paginaAtual');
  scriptProps.deleteProperty('PT_totalPaginas');
  scriptProps.deleteProperty('PT_novos');
  scriptProps.deleteProperty('PT_atualizados');
  scriptProps.deleteProperty('PT_errosConsecutivos');
  Logger.log("🧹 Estado de retomada limpo.");
}

function resetarRetomadaPT_SF() {
  limparEstadoRetomadaPT_SF();
  removerTriggersRetomadaPT_SF();
  Logger.log("✅ Retomada resetada completamente.");
}

// ========================================
// CRIAR TRIGGER DIÁRIO
// ========================================

function criarTriggerDiarioPT_SF() {
  removerTriggerDiarioPT_SF();
  
  ScriptApp.newTrigger('atualizarPesquisaTitulos_ComRetomada_SF')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
  
  Logger.log("✅ Trigger diário criado para Pesquisa de Títulos às 9h");
}

function removerTriggerDiarioPT_SF() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    var trigger = triggers[i];
    if (trigger.getHandlerFunction() === 'atualizarPesquisaTitulos_ComRetomada_SF' &&
        trigger.getEventType() === ScriptApp.EventType.CLOCK) {
      ScriptApp.deleteTrigger(trigger);
      Logger.log("🗑️ Trigger diário removido");
    }
  }
}

// ========================================
// FUNÇÃO 3: LISTAR DUPLICADOS
// ========================================

function listarIntervalosParaDeletarDuplicadosPT_SF() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PESQUISA_TITULOS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    return;
  }

  Logger.log("=== IDENTIFICANDO DUPLICADOS ===");
  
  var lastRow = sheet.getLastRow();
  
  if (lastRow <= 1) {
    Logger.log("Planilha vazia.");
    return;
  }

  var codigos = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var codigosVistos = {};
  var linhasDuplicadas = [];
  
  for (var i = 0; i < codigos.length; i++) {
    var codigo = String(codigos[i][0] || "").trim();
    
    if (!codigo) continue;
    
    if (codigosVistos[codigo]) {
      linhasDuplicadas.push(i + 2);
    } else {
      codigosVistos[codigo] = i + 2;
    }
  }
  
  if (linhasDuplicadas.length === 0) {
    Logger.log("✅ NENHUM DUPLICADO ENCONTRADO!");
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
  
  Logger.log("\n=== ❌ DUPLICADOS ENCONTRADOS ===");
  Logger.log("Total: " + linhasDuplicadas.length);
  Logger.log("Intervalos: " + intervalos.length);
  
  var textoIntervalos = "";
  
  for (var i = 0; i < intervalos.length; i++) {
    var intervalo = intervalos[i];
    if (intervalo.inicio === intervalo.fim) {
      textoIntervalos += intervalo.inicio + ", ";
    } else {
      textoIntervalos += intervalo.inicio + "-" + intervalo.fim + ", ";
    }
  }
  
  textoIntervalos = textoIntervalos.slice(0, -2);
  Logger.log("\n📋 COPIE ISTO: " + textoIntervalos);
}

// ========================================
// FUNÇÃO 4: CRIAR PLANILHA REFERÊNCIA
// ========================================

function criarPlanilhaReferenciaDuplicadosPT_SF() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PESQUISA_TITULOS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    return;
  }

  var lastRow = sheet.getLastRow();
  
  if (lastRow <= 1) {
    Logger.log("Planilha vazia.");
    return;
  }

  var codigos = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  var codigosVistos = {};
  var linhasDuplicadas = [];
  
  for (var i = 0; i < codigos.length; i++) {
    var codigo = String(codigos[i][0] || "").trim();
    if (!codigo) continue;
    
    if (codigosVistos[codigo]) {
      linhasDuplicadas.push(i + 2);
    } else {
      codigosVistos[codigo] = i + 2;
    }
  }
  
  if (linhasDuplicadas.length === 0) {
    Logger.log("Nenhum duplicado.");
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
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var refSheet = ss.getSheetByName("Duplicados_PT_Ref");
  
  if (refSheet) {
    ss.deleteSheet(refSheet);
  }
  
  refSheet = ss.insertSheet("Duplicados_PT_Ref");
  
  refSheet.getRange(1, 1, 1, 4).setValues([["Intervalo #", "Linha Início", "Linha Fim", "Total Linhas"]]);
  refSheet.getRange(1, 1, 1, 4).setFontWeight("bold");
  refSheet.getRange(1, 1, 1, 4).setBackground("#9C27B0");
  refSheet.getRange(1, 1, 1, 4).setFontColor("#FFFFFF");
  
  var dados = [];
  for (var i = 0; i < intervalos.length; i++) {
    var intervalo = intervalos[i];
    dados.push([
      i + 1,
      intervalo.inicio,
      intervalo.fim,
      intervalo.fim - intervalo.inicio + 1
    ]);
  }
  
  refSheet.getRange(2, 1, dados.length, 4).setValues(dados);
  refSheet.autoResizeColumns(1, 4);
  refSheet.setFrozenRows(1);
  
  refSheet.getRange(dados.length + 3, 1).setValue("TOTAL:");
  refSheet.getRange(dados.length + 3, 2).setValue(linhasDuplicadas.length);
  refSheet.getRange(dados.length + 3, 1, 1, 2).setFontWeight("bold");
  
  Logger.log("✅ Planilha criada: 'Duplicados_PT_Ref'");
}

// ========================================
// FUNÇÃO 5: CRIAR PLANILHA
// ========================================

function criarPlanilhaPesquisaTitulos_SF() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_PESQUISA_TITULOS.nomePlanilha);
  
  if (sheet) {
    Logger.log("AVISO: Planilha já existe!");
    return;
  }
  
  sheet = ss.insertSheet(CONFIG_PESQUISA_TITULOS.nomePlanilha);
  
  var cabecalho = [
    "cod_titulo", "cod_int_titulo", "num_titulo", "dt_emissao", "dt_vencimento",
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
  
  sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, cabecalho.length).setFontWeight("bold");
  sheet.getRange(1, 1, 1, cabecalho.length).setBackground("#9C27B0");
  sheet.getRange(1, 1, 1, cabecalho.length).setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, cabecalho.length);
  sheet.getRange("A:A").setNumberFormat("@");
  
  Logger.log("Planilha criada com sucesso!");
}

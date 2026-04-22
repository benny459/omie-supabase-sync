// ========================================
// CONFIGURAÇÕES - TODAS AS EMPRESAS
// ========================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_LANC_CC_CONSOLIDADO = {
  url: "https://app.omie.com.br/api/v1/financas/contacorrentelancamentos/",
  nomePlanilha: "LancamentosCC",
  maxPaginas: 1000,
  registrosPorPagina: 100,
  paginasPorExecucao: 100,
  paginasSemMudancaParaParar: 50,
  diasParaBuscar: 60,
  delayEntrePaginas: 1000
};

// ========================================
// FUNÇÕES AUXILIARES
// ========================================

function escreverStatusStamp(sheet, mensagem, ehSucesso) {
  if (!sheet) return;
  try {
    var timestamp = Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy HH:mm:ss");
    var statusTexto = ehSucesso ? "✅ SUCESSO" : "❌ ERRO";
    var mensagemCompleta = statusTexto + " - " + timestamp + ": " + mensagem;
    var celulaStatus = sheet.getRange("AE1");
    celulaStatus.setValue(mensagemCompleta).setFontWeight("bold");
    if (ehSucesso) {
      celulaStatus.setBackground("#D9EAD3").setFontColor("#155724");
    } else {
      celulaStatus.setBackground("#F4CCCC").setFontColor("#721C24");
    }
  } catch (e) {
    Logger.log("⚠️ Erro ao escrever status: " + e.message);
  }
}

// ⭐ CORRIGIDO: Salvar timestamp Unix (UTC universal)
function salvarTimestampUltimaSyncLancCC() {
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var agora = new Date();
    var unixTime = agora.getTime();
    var timestampBrasil = Utilities.formatDate(agora, "America/Sao_Paulo", "dd/MM/yyyy HH:mm:ss");
    
    scriptProps.setProperty('LancCC_UltimaSync_UnixTime', String(unixTime));
    scriptProps.setProperty('LancCC_UltimaSync_Display', timestampBrasil);
    
    Logger.log("💾 Timestamp salvo (Unix): " + unixTime + " | Display: " + timestampBrasil);
    return unixTime;
  } catch (e) {
    Logger.log("⚠️ Erro ao salvar timestamp: " + e.message);
    return null;
  }
}

// ⭐ CORRIGIDO: Obter timestamp Unix
function obterTimestampUltimaSyncLancCC() {
  try {
    var scriptProps = PropertiesService.getScriptProperties();
    var unixTime = scriptProps.getProperty('LancCC_UltimaSync_UnixTime');
    var display = scriptProps.getProperty('LancCC_UltimaSync_Display');
    
    if (unixTime) {
      Logger.log("📅 Última sync: " + display + " (Unix: " + unixTime + ")");
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

function resetarTimestampLancCC() {
  var scriptProps = PropertiesService.getScriptProperties();
  scriptProps.deleteProperty('LancCC_UltimaSync_UnixTime');
  scriptProps.deleteProperty('LancCC_UltimaSync_Display');
  Logger.log("🧹 Timestamp resetado");
}

// ⭐ CORRIGIDO: Comparação com ajuste UTC
function lancamentoModificadoAposUltimaSync(lancamento, unixTimeUltimaSync) {
  if (!unixTimeUltimaSync) return true;
  
  var info = lancamento.info || {};
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
        var ajusteFuso = (offsetLocal - offsetBrasil) * 60 * 1000;
        unixAlt = dataAltObj.getTime() - ajusteFuso;
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
        var offsetLocal = dataIncObj.getTimezoneOffset();
        var offsetBrasil = 180;
        var ajusteFuso = (offsetLocal - offsetBrasil) * 60 * 1000;
        unixInc = dataIncObj.getTime() - ajusteFuso;
      }
    }
    
    return ((unixAlt && unixAlt > unixTimeUltimaSync) || (unixInc && unixInc > unixTimeUltimaSync));
  } catch (e) {
    Logger.log("⚠️ Erro ao comparar datas: " + e.message);
    return true;
  }
}

function verificarTempoExecucaoLancCC(horaInicio, limiteSegundos) {
  limiteSegundos = limiteSegundos || 300;
  var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
  if (tempoDecorrido > limiteSegundos) {
    Logger.log("⏱️ Tempo limite: " + tempoDecorrido.toFixed(2) + "s");
    return false;
  }
  return true;
}

function limparPlanilhaCompletaLancCC(sheet) {
  Logger.log("🧹 Limpando planilha completa...");
  var lastRow = sheet.getMaxRows();
  var lastCol = sheet.getMaxColumns();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, lastCol).clear();
  SpreadsheetApp.flush();
  Logger.log("✅ Planilha limpa");
}

function carregarIndicePorBatchesLancCC(sheet) {
  var lastRow = sheet.getLastRow();
  var mapa = new Map();
  if (lastRow <= 1) return mapa;
  
  var BATCH_SIZE = 5000;
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
        if (empresa && codigo) mapa.set(empresa + "|" + codigo, inicio + i);
      }
      Logger.log("  ✓ Batch " + inicio + "-" + fim);
      inicio = fim + 1;
      if (inicio <= lastRow) Utilities.sleep(50);
    } catch (e) {
      Logger.log("❌ Batch erro: " + e.message);
      break;
    }
  }
  Logger.log("✅ Índice carregado: " + mapa.size + " únicos");
  return mapa;
}

// ⭐ CORRIGIDO: Inserção em lotes otimizada
function inserirDadosComRetryLancCC(sheet, dados) {
  if (!dados || dados.length === 0) return true;
  try {
    Logger.log("📝 Inserindo " + dados.length + " registros...");
    var primeiraLinha = sheet.getLastRow() + 1;
    sheet.getRange(primeiraLinha, 1, dados.length, 30).setValues(dados);
    SpreadsheetApp.flush();
    Logger.log("✅ Inserido");
    return true;
  } catch (e) {
    Logger.log("❌ Erro ao inserir: " + e.message);
    return false;
  }
}

function extrairCategorias(detalhes) {
  if (Array.isArray(detalhes.aCodCateg) && detalhes.aCodCateg.length > 0) {
    return detalhes.aCodCateg.map(function(r) { return r.cCodCateg || ""; }).join(', ');
  }
  return detalhes.cCodCateg || "";
}

// ========================================
// RECRIAÇÃO COMPLETA
// ========================================

function recriaBaseCompletaLancamentosCC() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_LANC_CC_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    return;
  }
  
  var sucesso = true;
  var totalGeral = 0;
  
  try {
    Logger.log("=== RECRIAÇÃO COMPLETA ===");
    limparPlanilhaCompletaLancCC(sheet);
    
    var dadosConsolidados = [];
    var empresas = Object.keys(EMPRESAS_OMIE);
    
    for (var e = 0; e < empresas.length; e++) {
      var sigla = empresas[e];
      var empresa = EMPRESAS_OMIE[sigla];
      
      Logger.log("\n📊 Processando: " + sigla);
      
      var pagina = 1;
      var totalPaginas = 1;
      var totalEmpresa = 0;
      
      do {
        if (!verificarTempoExecucaoLancCC(horaInicio, 300)) break;
        
        var payload = {
          "call": "ListarLancCC",
          "app_key": empresa.appKey,
          "app_secret": empresa.appSecret,
          "param": [{ 
            "nPagina": pagina, 
            "nRegPorPagina": CONFIG_LANC_CC_CONSOLIDADO.registrosPorPagina
          }]
        };
        
        var options = {
          "method": "post",
          "contentType": "application/json",
          "payload": JSON.stringify(payload),
          "muteHttpExceptions": true
        };
        
        try {
          var response = UrlFetchApp.fetch(CONFIG_LANC_CC_CONSOLIDADO.url, options);
          if (response.getResponseCode() !== 200) {
            Logger.log("❌ HTTP " + response.getResponseCode());
            break;
          }
          
          var data = JSON.parse(response.getContentText());
          if (!data || data.faultstring) {
            Logger.log("❌ Erro API: " + (data.faultstring || "desconhecido"));
            break;
          }
          
          totalPaginas = data.nTotPaginas || 1;
          var lancamentos = data.listaLancamentos || [];
          if (lancamentos.length === 0) break;
          
          for (var i = 0; i < lancamentos.length; i++) {
            var l = lancamentos[i];
            var cabecalho = l.cabecalho || {};
            var detalhes = l.detalhes || {};
            var diversos = l.diversos || {};
            var info = l.info || {};
            var categorias = extrairCategorias(detalhes);
            
            dadosConsolidados.push([
              sigla, String(l.nCodLanc || ""), String(l.cCodIntLanc || ""), String(l.nCodAgrup || ""),
              String(cabecalho.nCodCC || ""), cabecalho.dDtLanc || "", cabecalho.nValorLanc || "",
              categorias, detalhes.cTipo || "", detalhes.cNumDoc || "",
              String(detalhes.nCodCliente || ""), String(detalhes.nCodProjeto || ""), detalhes.cObs || "",
              diversos.cOrigem || "", diversos.dDtConc || "", diversos.cHrConc || "",
              diversos.cUsConc || "", String(diversos.nCodVendedor || ""), String(diversos.nCodComprador || ""),
              diversos.cNatureza || "", diversos.cIdentLanc || "", String(diversos.nCodLancCP || ""),
              String(diversos.nCodLancCR || ""), info.dInc || "", info.hInc || "", info.uInc || "",
              info.dAlt || "", info.hAlt || "", info.uAlt || "", info.cImpAPI || ""
            ]);
            totalEmpresa++;
          }
          
          Logger.log("  P" + pagina + "/" + totalPaginas + " | Total: " + totalEmpresa);
          
          // ⭐ CORRIGIDO: Inserir em lotes de 500
          if (dadosConsolidados.length >= 500) {
            inserirDadosComRetryLancCC(sheet, dadosConsolidados);
            dadosConsolidados = [];
          }
          
          pagina++;
          Utilities.sleep(CONFIG_LANC_CC_CONSOLIDADO.delayEntrePaginas);
          
        } catch (erro) {
          Logger.log("❌ Erro: " + erro.message);
          break;
        }
      } while (pagina <= totalPaginas);
      
      Logger.log("✅ " + sigla + ": " + totalEmpresa + " registros");
      totalGeral += totalEmpresa;
    }
    
    // Inserir restante
    if (dadosConsolidados.length > 0) {
      inserirDadosComRetryLancCC(sheet, dadosConsolidados);
    }
    
    Logger.log("\n✅ COMPLETO: " + totalGeral + " registros");
    escreverStatusStamp(sheet, "Recriação OK. Total: " + totalGeral, true);
    
  } catch (erro) {
    Logger.log("❌ Erro geral: " + erro.message);
    escreverStatusStamp(sheet, "Erro: " + erro.message, false);
  }
}

// ========================================
// ATUALIZAÇÃO INCREMENTAL OTIMIZADA
// ========================================

function atualizarLancamentosCC() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_LANC_CC_CONSOLIDADO.nomePlanilha);
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    return;
  }
  
  var sucesso = true;
  var novosTotal = 0;
  var atualizadosTotal = 0;
  var ignoradosTotal = 0;
  
  try {
    var diasBusca = CONFIG_LANC_CC_CONSOLIDADO.diasParaBuscar;
    Logger.log("=== ATUALIZAÇÃO OTIMIZADA - " + diasBusca + " DIAS ===");
    
    var unixTimeUltimaSync = obterTimestampUltimaSyncLancCC();
    var mapaCodigosLinhas = carregarIndicePorBatchesLancCC(sheet);
    
    var dataInicio = new Date();
    dataInicio.setDate(dataInicio.getDate() - diasBusca);
    var dataInicioStr = Utilities.formatDate(dataInicio, "America/Sao_Paulo", "dd/MM/yyyy");
    var dataFimStr = Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy");
    
    Logger.log("Período: " + dataInicioStr + " até " + dataFimStr);
    
    var dadosNovos = [];
    var empresas = Object.keys(EMPRESAS_OMIE);
    
    for (var e = 0; e < empresas.length; e++) {
      var sigla = empresas[e];
      var empresa = EMPRESAS_OMIE[sigla];
      
      Logger.log("\n📊 Sync: " + sigla);
      
      var pagina = 1;
      var totalPaginas = 1;
      var novosEmpresa = 0;
      var atualizadosEmpresa = 0;
      var ignoradosEmpresa = 0;
      var paginasSemMudanca = 0;
      
      do {
        if (!verificarTempoExecucaoLancCC(horaInicio, 300)) break;
        if (paginasSemMudanca >= CONFIG_LANC_CC_CONSOLIDADO.paginasSemMudancaParaParar) {
          Logger.log("🛑 Early stop: " + paginasSemMudanca + " páginas sem mudanças");
          break;
        }
        
        var payload = {
          "call": "ListarLancCC",
          "app_key": empresa.appKey,
          "app_secret": empresa.appSecret,
          "param": [{ 
            "nPagina": pagina,
            "nRegPorPagina": CONFIG_LANC_CC_CONSOLIDADO.registrosPorPagina,
            "dDtAltDe": dataInicioStr,
            "dDtAltAte": dataFimStr
          }]
        };
        
        var options = {
          "method": "post",
          "contentType": "application/json",
          "payload": JSON.stringify(payload),
          "muteHttpExceptions": true
        };
        
        try {
          var response = UrlFetchApp.fetch(CONFIG_LANC_CC_CONSOLIDADO.url, options);
          if (response.getResponseCode() !== 200) {
            Logger.log("❌ HTTP " + response.getResponseCode());
            break;
          }
          
          var data = JSON.parse(response.getContentText());
          if (!data || data.faultstring) {
            Logger.log("❌ Erro API: " + (data.faultstring || "desconhecido"));
            break;
          }
          
          totalPaginas = data.nTotPaginas || 1;
          var lancamentos = data.listaLancamentos || [];
          if (lancamentos.length === 0) break;
          
          var mudancasNestaPagina = 0;
          
          for (var i = 0; i < lancamentos.length; i++) {
            var l = lancamentos[i];
            var codigoStr = String(l.nCodLanc || "").trim();
            if (!codigoStr) continue;
            
            var foiModificado = lancamentoModificadoAposUltimaSync(l, unixTimeUltimaSync);
            var chaveUnica = sigla + "|" + codigoStr;
            
            var cabecalho = l.cabecalho || {};
            var detalhes = l.detalhes || {};
            var diversos = l.diversos || {};
            var info = l.info || {};
            var categorias = extrairCategorias(detalhes);
            
            var row = [
              sigla, String(l.nCodLanc || ""), String(l.cCodIntLanc || ""), String(l.nCodAgrup || ""),
              String(cabecalho.nCodCC || ""), cabecalho.dDtLanc || "", cabecalho.nValorLanc || "",
              categorias, detalhes.cTipo || "", detalhes.cNumDoc || "",
              String(detalhes.nCodCliente || ""), String(detalhes.nCodProjeto || ""), detalhes.cObs || "",
              diversos.cOrigem || "", diversos.dDtConc || "", diversos.cHrConc || "",
              diversos.cUsConc || "", String(diversos.nCodVendedor || ""), String(diversos.nCodComprador || ""),
              diversos.cNatureza || "", diversos.cIdentLanc || "", String(diversos.nCodLancCP || ""),
              String(diversos.nCodLancCR || ""), info.dInc || "", info.hInc || "", info.uInc || "",
              info.dAlt || "", info.hAlt || "", info.uAlt || "", info.cImpAPI || ""
            ];
            
            if (mapaCodigosLinhas.has(chaveUnica)) {
              if (foiModificado) {
                var linha = mapaCodigosLinhas.get(chaveUnica);
                sheet.getRange(linha, 1, 1, 30).setValues([row]);
                atualizadosEmpresa++;
                atualizadosTotal++;
                mudancasNestaPagina++;
              } else {
                ignoradosEmpresa++;
                ignoradosTotal++;
              }
            } else {
              dadosNovos.push(row);
              novosEmpresa++;
              novosTotal++;
              mudancasNestaPagina++;
            }
          }
          
          if (mudancasNestaPagina === 0) paginasSemMudanca++;
          else paginasSemMudanca = 0;
          
          Logger.log("  P" + pagina + "/" + totalPaginas + 
                    " | Novos: " + novosEmpresa + 
                    " | Atual: " + atualizadosEmpresa + 
                    " | Ignor: " + ignoradosEmpresa);
          
          // ⭐ Inserir em lotes de 500
          if (dadosNovos.length >= 500) {
            inserirDadosComRetryLancCC(sheet, dadosNovos);
            dadosNovos = [];
          }
          
          pagina++;
          Utilities.sleep(CONFIG_LANC_CC_CONSOLIDADO.delayEntrePaginas);
          
        } catch (erro) {
          Logger.log("❌ Erro: " + erro.message);
          break;
        }
      } while (pagina <= totalPaginas);
      
      Logger.log("✅ " + sigla + " - Novos: " + novosEmpresa + " | Atual: " + atualizadosEmpresa + " | Ignor: " + ignoradosEmpresa);
    }
    
    // Inserir restante
    if (dadosNovos.length > 0) {
      inserirDadosComRetryLancCC(sheet, dadosNovos);
    }
    
    Logger.log("\n✅ FINALIZADO");
    Logger.log("🆕 Novos: " + novosTotal);
    Logger.log("🔄 Atual: " + atualizadosTotal);
    Logger.log("⏭️ Ignor: " + ignoradosTotal);
    
    salvarTimestampUltimaSyncLancCC();
    escreverStatusStamp(sheet, 
      "Atualização OK. Novos: " + novosTotal + ", Atual: " + atualizadosTotal + ", Ignor: " + ignoradosTotal,
      true);
    
  } catch (erro) {
    Logger.log("❌ Erro geral: " + erro.message);
    escreverStatusStamp(sheet, "Erro: " + erro.message, false);
  }
}

// ========================================
// CRIAR PLANILHA
// ========================================

function criarPlanilhaLancamentosCC() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_LANC_CC_CONSOLIDADO.nomePlanilha);
  if (sheet) ss.deleteSheet(sheet);
  sheet = ss.insertSheet(CONFIG_LANC_CC_CONSOLIDADO.nomePlanilha);
  
  var cabecalho = [
    "empresa", "nCodLanc", "cCodIntLanc", "nCodAgrup", "cab_nCodCC", "cab_dDtLanc", "cab_nValorLanc",
    "det_cCodCateg", "det_cTipo", "det_cNumDoc", "det_nCodCliente", "det_nCodProjeto", "det_cObs",
    "div_cOrigem", "div_dDtConc", "div_cHrConc", "div_cUsConc", "div_nCodVendedor", "div_nCodComprador",
    "div_cNatureza", "div_cIdentLanc", "div_nCodLancCP", "div_nCodLancCR",
    "info_dInc", "info_hInc", "info_uInc", "info_dAlt", "info_hAlt", "info_uAlt", "info_cImpAPI"
  ];
  
  sheet.getRange(1, 1, 1, 30).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, 30).setFontWeight("bold").setBackground("#DB4437").setFontColor("#FFFFFF");
  sheet.getRange(1, 31).setValue("Status").setFontWeight("bold").setBackground("#17A2B8").setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.getRange("B:B").setNumberFormat("@");
  sheet.autoResizeColumns(1, 31);
  
  Logger.log("✅ Planilha criada!");
  escreverStatusStamp(sheet, "Planilha criada com sucesso.", true);
}



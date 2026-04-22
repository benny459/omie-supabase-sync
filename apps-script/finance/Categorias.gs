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

var CONFIG_CATEGORIAS_CONSOLIDADO = {
  url: "https://app.omie.com.br/api/v1/geral/categorias/",
  nomePlanilha: "Categorias",
  maxPaginas: 1000
};


// ========================================
// FUNÇÕES AUXILIARES
// ========================================

function escreverStatusStampCategorias(sheet, mensagem, ehSucesso) {
  var timezone = Session.getScriptTimeZone();
  var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
  var statusTexto = ehSucesso ? "✅ SUCESSO" : "❌ ERRO";
  var mensagemCompleta = statusTexto + " - " + timestamp + ": " + mensagem;
  var celulaStatus = sheet.getRange("AA1");
  celulaStatus.setValue(mensagemCompleta);
  celulaStatus.setFontWeight("bold");
  if (ehSucesso) {
    celulaStatus.setBackground("#D9EAD3").setFontColor("#155724");
  } else {
    celulaStatus.setBackground("#F4CCCC").setFontColor("#721C24");
  }
  Logger.log("📝 Stamp AA1 (" + timezone + "): " + mensagemCompleta);
}

function verificarTempoExecucaoCategorias(horaInicio, limiteSegundos) {
  limiteSegundos = limiteSegundos || 330;
  var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
  if (tempoDecorrido > limiteSegundos) {
    Logger.log("⏱️ Tempo limite: " + tempoDecorrido.toFixed(2) + "s");
    return false;
  }
  return true;
}

// ⭐ MUDANÇA 1: Limpar APENAS A-W (preserva X-Y)
function limparPlanilhaCompletaCategorias(sheet) {
  var lastRow = sheet.getLastRow();
  var maxRows = sheet.getMaxRows();
  
  if (lastRow > 1) {
    // ⭐ LIMPA APENAS COLUNAS 1-23 (A-W) - PRESERVA X-Y
    sheet.getRange(2, 1, lastRow - 1, 23).clearContent();
    Logger.log("✓ Limpo: " + (lastRow - 1) + " linhas (A-W)");
    Logger.log("🔒 Preservado: X-Y");
  }
  
  // NÃO deleta linhas (preserva fórmulas X-Y)
  
  sheet.getRange("B:B").setNumberFormat("@");
  Logger.log("✓ Col B TEXTO");
}

// ⭐ MUDANÇA 2: Inserir sempre começando na linha 2
var PROXIMA_LINHA_DISPONIVEL = 2; // Global para rastrear próxima linha

function inserirDadosComRetryCategorias(sheet, dados) {
  if (!dados || dados.length === 0) {
    return true;
  }
  var MAX_TENTATIVAS = 3;
  var tentativa = 0;
  
  while (tentativa < MAX_TENTATIVAS) {
    try {
      Logger.log("📝 Inserindo " + dados.length + " na linha " + PROXIMA_LINHA_DISPONIVEL + " (tent " + (tentativa + 1) + ")");
      
      // ⭐ USA VARIÁVEL GLOBAL (não getLastRow)
      sheet.getRange(PROXIMA_LINHA_DISPONIVEL, 1, dados.length, 23).setValues(dados);
      SpreadsheetApp.flush();
      
      // ⭐ ATUALIZA próxima linha
      PROXIMA_LINHA_DISPONIVEL += dados.length;
      
      Logger.log("✅ Inserido");
      return true;
    } catch (e) {
      tentativa++;
      Logger.log("❌ Erro inserção (tent " + tentativa + "): " + e.message);
      if (tentativa < MAX_TENTATIVAS) {
        Utilities.sleep(1000 * tentativa);
      } else {
        Logger.log("❌ CRÍTICO: Falha após " + MAX_TENTATIVAS + " tentativas");
        return false;
      }
    }
  }
  return false;
}

function validarIntegridadeDadosCategorias(sheet, empresas) {
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
// FUNÇÃO: RECRIAR BASE COMPLETA
// ========================================

function recriaBaseCompletaCategoriasOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CATEGORIAS_CONSOLIDADO.nomePlanilha);
  
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    Logger.log("💡 Execute: criarPlanilhaCategorias()");
    return;
  }
  
  var sucesso = true;
  var erroDetalhe = "";
  var totalGeral = 0;
  
  try {
    Logger.log("=== RECRIAÇÃO COMPLETA - CATEGORIAS ===");
    Logger.log("⚠️ ATENÇÃO: Pode levar vários minutos!");
    
    // ⭐ RESET variável global
    PROXIMA_LINHA_DISPONIVEL = 2;
    
    limparPlanilhaCompletaCategorias(sheet);
    
    var dadosConsolidados = [];
    var empresas = Object.keys(EMPRESAS_OMIE);
    
    for (var e = 0; e < empresas.length; e++) {
      var sigla = empresas[e];
      var empresa = EMPRESAS_OMIE[sigla];
      Logger.log("\n📊 Processando: " + sigla);
      
      var pagina = 1;
      var totalPaginas = 1;
      var totalEmpresa = 0;
      var errosConsecutivos = 0;
      var MAX_ERROS = 3;
      
      do {
        if (!verificarTempoExecucaoCategorias(horaInicio, 330)) {
          Logger.log("⏱️ Tempo limite. Total: " + totalGeral);
          break;
        }
        
        var payload = {
          "call": "ListarCategorias",
          "app_key": empresa.appKey,
          "app_secret": empresa.appSecret,
          "param": [{ "pagina": pagina, "registros_por_pagina": 100 }]
        };
        
        var options = {
          "method": "post",
          "contentType": "application/json",
          "payload": JSON.stringify(payload),
          "muteHttpExceptions": true
        };
        
        try {
          var response = UrlFetchApp.fetch(CONFIG_CATEGORIAS_CONSOLIDADO.url, options);
          var httpCode = response.getResponseCode();
          
          if (httpCode !== 200) {
            Logger.log("❌ HTTP " + httpCode + " p" + pagina);
            errosConsecutivos++;
            if (errosConsecutivos >= MAX_ERROS) {
              sucesso = false;
              erroDetalhe = "Max erros HTTP " + sigla;
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
          
          totalPaginas = data.total_de_paginas || 1;
          var categorias = data.categoria_cadastro || [];
          
          if (categorias.length === 0) {
            Logger.log("✓ Fim p" + pagina);
            break;
          }
          
          errosConsecutivos = 0;
          
          for (var i = 0; i < categorias.length; i++) {
            var c = categorias[i];
            var dadosDRE = c.dadosDRE || {};
            
            var row = [
              sigla, String(c.codigo || ""), c.descricao || "", c.descricao_padrao || "",
              c.tipo_categoria || "", c.conta_inativa || "", c.definida_pelo_usuario || "",
              c.id_conta_contabil || "", c.tag_conta_contabil || "", c.conta_despesa || "",
              c.conta_receita || "", c.nao_exibir || "", c.natureza || "",
              c.totalizadora || "", c.transferencia || "", c.codigo_dre || "",
              c.categoria_superior || "", dadosDRE.codigoDRE || "", dadosDRE.descricaoDRE || "",
              dadosDRE.naoExibirDRE || "", dadosDRE.nivelDRE || "", dadosDRE.sinalDRE || "",
              dadosDRE.totalizaDRE || ""
            ];
            
            dadosConsolidados.push(row);
            totalEmpresa++;
          }
          
          Logger.log("P" + pagina + "/" + totalPaginas + " - Total: " + totalEmpresa);
          pagina++;
          
          if (dadosConsolidados.length >= 1000) {
            if (!inserirDadosComRetryCategorias(sheet, dadosConsolidados)) {
              sucesso = false;
              erroDetalhe = "Falha lote " + sigla;
            }
            dadosConsolidados = [];
          }
          
          Utilities.sleep(100);
          
        } catch (erro) {
          Logger.log("❌ Erro p" + pagina + ": " + erro.message);
          errosConsecutivos++;
          if (errosConsecutivos >= MAX_ERROS) {
            sucesso = false;
            erroDetalhe = "Max erros API " + sigla;
            break;
          }
          Utilities.sleep(2000);
        }
      } while (pagina <= totalPaginas);
      
      if (!sucesso) break;
      
      Logger.log("✅ " + sigla + " completo: " + totalEmpresa);
      totalGeral += totalEmpresa;
      
      if (e < empresas.length - 1) {
        Utilities.sleep(1000);
      }
    }
    
    if (dadosConsolidados.length > 0) {
      if (!inserirDadosComRetryCategorias(sheet, dadosConsolidados)) {
        sucesso = false;
        erroDetalhe = "Falha lote final";
      }
    }
    
    Logger.log("\n=== ✅ FINALIZADO ===");
    Logger.log("Total: " + totalGeral);
    Logger.log("Linhas: " + (PROXIMA_LINHA_DISPONIVEL - 2));
    
    var empresasList = Object.keys(EMPRESAS_OMIE);
    validarIntegridadeDadosCategorias(sheet, empresasList);
    
    if (sucesso) {
      escreverStatusStampCategorias(sheet, "Recriação completa OK. Total: " + totalGeral, true);
    } else {
      escreverStatusStampCategorias(sheet, "Falha recriação: " + erroDetalhe + ". Total: " + totalGeral, false);
    }
    
  } catch (erroGeral) {
    Logger.log("❌ Erro geral: " + erroGeral.message);
    escreverStatusStampCategorias(sheet, "Erro geral recriação: " + erroGeral.message, false);
  }
}


// ========================================
// CRIAR PLANILHA
// ========================================

function criarPlanilhaCategorias() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_CATEGORIAS_CONSOLIDADO.nomePlanilha);
  
  if (sheet) {
    Logger.log("⚠️ Planilha já existe. Deletando...");
    ss.deleteSheet(sheet);
  }
  
  sheet = ss.insertSheet(CONFIG_CATEGORIAS_CONSOLIDADO.nomePlanilha);
  
  var cabecalho = [
    "empresa", "codigo", "descricao", "descricao_padrao", "tipo_categoria", "conta_inativa",
    "definida_pelo_usuario", "id_conta_contabil", "tag_conta_contabil", "conta_despesa",
    "conta_receita", "nao_exibir", "natureza", "totalizadora", "transferencia",
    "codigo_dre", "categoria_superior", "dre_codigoDRE", "dre_descricaoDRE",
    "dre_naoExibirDRE", "dre_nivelDRE", "dre_sinalDRE", "dre_totalizaDRE"
  ];
  
  sheet.getRange(1, 1, 1, 23).setValues([cabecalho])
    .setFontWeight("bold")
    .setBackground("#EA4335")
    .setFontColor("#FFFFFF");
  
  sheet.getRange(1, 27)
    .setValue("Status Atualização")
    .setFontWeight("bold")
    .setBackground("#17A2B8")
    .setFontColor("#FFFFFF");
  
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 27);
  sheet.getRange("B:B").setNumberFormat("@");
  sheet.getRange("A:A").setBackground("#FFEBEE");
  sheet.getRange("A1").setBackground("#EA4335");
  
  Logger.log("✅ Planilha criada!");
  escreverStatusStampCategorias(sheet, "Planilha criada com sucesso.", true);
}
// ========================================
// 🔍 FUNÇÃO DEBUG: TESTAR API OMIE
// ========================================

function debugTestarAPICategoriasOmie() {
  Logger.log("═".repeat(60));
  Logger.log("🔍 DIAGNÓSTICO DA API OMIE - CATEGORIAS");
  Logger.log("═".repeat(60));
  
  var empresas = {
    "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb" },
    "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877" },
    "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5" }
  };
  
  var url = "https://app.omie.com.br/api/v1/geral/categorias/";
  var resultadoGeral = {
    total: 0,
    sucessos: 0,
    erros: 0,
    detalhes: []
  };
  
  // Testar cada empresa
  for (var sigla in empresas) {
    Logger.log("\n" + "─".repeat(60));
    Logger.log("📊 Testando empresa: " + sigla);
    Logger.log("─".repeat(60));
    
    var empresa = empresas[sigla];
    var tentativas = [
      { delay: 0,    nome: "Imediato" },
      { delay: 2000, nome: "2 segundos" },
      { delay: 5000, nome: "5 segundos" },
      { delay: 10000, nome: "10 segundos" }
    ];
    
    var empresaSucesso = false;
    
    for (var t = 0; t < tentativas.length; t++) {
      var tentativa = tentativas[t];
      
      // Delay antes da tentativa (exceto primeira)
      if (tentativa.delay > 0) {
        Logger.log("\n⏳ Aguardando " + tentativa.nome + "...");
        Utilities.sleep(tentativa.delay);
      }
      
      Logger.log("🔄 Tentativa " + (t + 1) + "/" + tentativas.length + " (" + tentativa.nome + ")");
      
      var payload = {
        "call": "ListarCategorias",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{"pagina": 1, "registros_por_pagina": 5}]
      };
      
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
      };
      
      try {
        var inicio = new Date().getTime();
        var response = UrlFetchApp.fetch(url, options);
        var tempoResposta = new Date().getTime() - inicio;
        var httpCode = response.getResponseCode();
        
        Logger.log("  📡 HTTP Status: " + httpCode);
        Logger.log("  ⏱️ Tempo resposta: " + tempoResposta + "ms");
        
        resultadoGeral.total++;
        
        if (httpCode === 200) {
          try {
            var data = JSON.parse(response.getContentText());
            var totalPaginas = data.total_de_paginas || 0;
            var registros = data.categoria_cadastro ? data.categoria_cadastro.length : 0;
            
            Logger.log("  ✅ SUCESSO!");
            Logger.log("  📄 Total páginas: " + totalPaginas);
            Logger.log("  📝 Registros recebidos: " + registros);
            
            resultadoGeral.sucessos++;
            resultadoGeral.detalhes.push({
              empresa: sigla,
              tentativa: t + 1,
              delay: tentativa.nome,
              status: "✅ SUCESSO",
              tempo: tempoResposta + "ms"
            });
            
            empresaSucesso = true;
            break; // Sucesso - pula para próxima empresa
            
          } catch (parseError) {
            Logger.log("  ❌ Erro ao parsear JSON: " + parseError.message);
            resultadoGeral.erros++;
          }
          
        } else {
          Logger.log("  ❌ ERRO - HTTP " + httpCode);
          Logger.log("  📄 Resposta: " + response.getContentText().substring(0, 200));
          
          resultadoGeral.erros++;
          resultadoGeral.detalhes.push({
            empresa: sigla,
            tentativa: t + 1,
            delay: tentativa.nome,
            status: "❌ HTTP " + httpCode,
            tempo: tempoResposta + "ms"
          });
        }
        
      } catch (erro) {
        Logger.log("  ❌ ERRO CRÍTICO: " + erro.message);
        resultadoGeral.erros++;
        resultadoGeral.detalhes.push({
          empresa: sigla,
          tentativa: t + 1,
          delay: tentativa.nome,
          status: "❌ " + erro.message,
          tempo: "N/A"
        });
      }
    }
    
    // Resumo da empresa
    if (empresaSucesso) {
      Logger.log("\n✅ " + sigla + ": API funcionando");
    } else {
      Logger.log("\n❌ " + sigla + ": API FORA após todas tentativas");
    }
  }
  
  // ========================================
  // DIAGNÓSTICO FINAL
  // ========================================
  
  Logger.log("\n" + "═".repeat(60));
  Logger.log("📊 DIAGNÓSTICO FINAL");
  Logger.log("═".repeat(60));
  
  Logger.log("\n📈 Estatísticas:");
  Logger.log("  Total tentativas: " + resultadoGeral.total);
  Logger.log("  ✅ Sucessos: " + resultadoGeral.sucessos);
  Logger.log("  ❌ Erros: " + resultadoGeral.erros);
  Logger.log("  📊 Taxa sucesso: " + Math.round((resultadoGeral.sucessos / resultadoGeral.total) * 100) + "%");
  
  Logger.log("\n📋 Detalhes por tentativa:");
  for (var i = 0; i < resultadoGeral.detalhes.length; i++) {
    var d = resultadoGeral.detalhes[i];
    Logger.log("  " + d.empresa + " - Tent " + d.tentativa + " (" + d.delay + "): " + d.status + " [" + d.tempo + "]");
  }
  
  // ========================================
  // RECOMENDAÇÃO
  // ========================================
  
  Logger.log("\n" + "═".repeat(60));
  Logger.log("💡 RECOMENDAÇÃO");
  Logger.log("═".repeat(60));
  
  var taxaSucesso = (resultadoGeral.sucessos / resultadoGeral.total) * 100;
  
  if (taxaSucesso === 100) {
    Logger.log("✅ API ESTÁ OK!");
    Logger.log("   → Pode executar recriaBaseCompletaCategoriasOmie() normalmente");
    
  } else if (taxaSucesso >= 50) {
    Logger.log("⚠️ API INSTÁVEL (mas funcional com retry)");
    Logger.log("   → Execute recriaBaseCompletaCategoriasOmie()");
    Logger.log("   → O script já tem retry automático");
    Logger.log("   → Pode ter alguns HTTP 500 mas vai completar");
    
  } else if (taxaSucesso > 0) {
    Logger.log("⚠️ API COM PROBLEMAS SÉRIOS");
    Logger.log("   → Aguarde 15-30 minutos");
    Logger.log("   → Execute este debug novamente");
    Logger.log("   → Se melhorar, tente recriaBaseCompletaCategoriasOmie()");
    
  } else {
    Logger.log("❌ API COMPLETAMENTE FORA DO AR");
    Logger.log("   → NÃO execute recriaBaseCompletaCategoriasOmie() agora");
    Logger.log("   → Aguarde pelo menos 1 hora");
    Logger.log("   → Verifique status em app.omie.com.br");
    Logger.log("   → Entre em contato com suporte Omie");
  }
  
  Logger.log("\n" + "═".repeat(60));
  Logger.log("✅ Diagnóstico concluído!");
  Logger.log("═".repeat(60));
}

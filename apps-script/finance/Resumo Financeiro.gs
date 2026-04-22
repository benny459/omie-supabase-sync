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

var NOME_PLANILHA_CONSOLIDADA = "ResumoFinanceiro";

// ========================================
// FUNÇÃO 1: OBTER RESUMO CONSOLIDADO
// ========================================

function obterResumoFinanceiroConsolidado() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOME_PLANILHA_CONSOLIDADA);
  
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    Logger.log("💡 Execute: criarPlanilhaResumoConsolidada()");
    return;
  }

  var hoje = new Date();
  var dataStr = Utilities.formatDate(hoje, Session.getScriptTimeZone(), "dd/MM/yyyy");
  
  Logger.log("=== 📊 OBTENDO RESUMO CONSOLIDADO ===");
  Logger.log("Data: " + dataStr);
  
  // Limpa dados anteriores
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
    Logger.log("🧹 Limpou " + (lastRow - 1) + " linhas");
  }
  
  var dadosConsolidados = [];
  var empresas = Object.keys(EMPRESAS_OMIE);
  
  // Processa cada empresa
  for (var e = 0; e < empresas.length; e++) {
    var sigla = empresas[e];
    var empresa = EMPRESAS_OMIE[sigla];
    
    Logger.log("\n📊 Processando: " + sigla);
    
    var payload = {
      "call": "ObterResumoFinancas",
      "app_key": empresa.appKey,
      "app_secret": empresa.appSecret,
      "param": [{ 
        "dDia": dataStr,
        "lApenasResumo": false,
        "lExibirCategoria": true
      }]
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      var response = UrlFetchApp.fetch("https://app.omie.com.br/api/v1/financas/resumo/", options);
      var data = JSON.parse(response.getContentText());
      
      if (!data) {
        Logger.log("⚠️ Sem dados para " + sigla);
        continue;
      }
      
      var cc = data.contaCorrente || {};
      var cp = data.contaPagar || {};
      var cr = data.contaReceber || {};
      var fc = data.fluxoCaixa || {};
      
      // RESUMO GERAL
      dadosConsolidados.push([
        sigla,              // ← COLUNA EMPRESA
        dataStr,
        "RESUMO_GERAL",
        "", "", "",
        Number(cc.vTotal || 0),
        Number(cc.vLimiteCredito || 0),
        Number(cp.nTotal || 0),
        Number(cp.vTotal || 0),
        Number(cp.vAtraso || 0),
        Number(cr.nTotal || 0),
        Number(cr.vTotal || 0),
        Number(cr.vAtraso || 0),
        Number(fc.vPagar || 0),
        Number(fc.vReceber || 0),
        Number(fc.vSaldo || 0),
        "", "", 0, "", "", 0
      ]);
      
      // CP POR CATEGORIA
      var cpCategorias = data.contaPagarCategoria || [];
      for (var i = 0; i < cpCategorias.length; i++) {
        var cat = cpCategorias[i];
        dadosConsolidados.push([
          sigla,              // ← COLUNA EMPRESA
          dataStr,
          "CP_CATEGORIA",
          String(cat.cCodCateg || ""),
          String(cat.cDescCateg || ""),
          "",
          0, 0,
          Number(cat.nTotal || 0),
          Number(cat.vTotal || 0),
          0, 0, 0, 0, 0, 0, 0,
          "", "", 0, "", "", 0
        ]);
      }
      
      // CR POR CATEGORIA
      var crCategorias = data.contaReceberCategoria || [];
      for (var i = 0; i < crCategorias.length; i++) {
        var cat = crCategorias[i];
        dadosConsolidados.push([
          sigla,              // ← COLUNA EMPRESA
          dataStr,
          "CR_CATEGORIA",
          String(cat.cCodCateg || ""),
          String(cat.cDescCateg || ""),
          "",
          0, 0, 0, 0, 0,
          Number(cat.nTotal || 0),
          Number(cat.vTotal || 0),
          0, 0, 0, 0,
          "", "", 0, "", "", 0
        ]);
      }
      
      // CP EM ATRASO
      var cpAtraso = data.contaPagarAtraso || [];
      for (var i = 0; i < cpAtraso.length; i++) {
        var atr = cpAtraso[i];
        dadosConsolidados.push([
          sigla,              // ← COLUNA EMPRESA
          dataStr,
          "CP_ATRASO",
          String(atr.cCodCateg || ""),
          String(atr.cDescCateg || ""),
          String(atr.nIdTitulo || ""),
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          String(atr.nIdCliente || ""),
          String(atr.cNomeCliente || ""),
          Number(atr.vDoc || 0),
          String(atr.dVencimento || ""),
          String(atr.dEmissao || ""),
          Number(atr.nDiasAtraso || 0)
        ]);
      }
      
      // CR EM ATRASO
      var crAtraso = data.contaReceberAtraso || [];
      for (var i = 0; i < crAtraso.length; i++) {
        var atr = crAtraso[i];
        dadosConsolidados.push([
          sigla,              // ← COLUNA EMPRESA
          dataStr,
          "CR_ATRASO",
          String(atr.cCodCateg || ""),
          String(atr.cDescCateg || ""),
          String(atr.nIdTitulo || ""),
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          String(atr.nIdCliente || ""),
          String(atr.cNomeCliente || ""),
          Number(atr.vDoc || 0),
          String(atr.dVencimento || ""),
          String(atr.dEmissao || ""),
          Number(atr.nDiasAtraso || 0)
        ]);
      }
      
      Logger.log("✅ " + sigla + " processado");
      
      // Pausa entre empresas
      if (e < empresas.length - 1) {
        Utilities.sleep(1000);
      }
      
    } catch (erro) {
      Logger.log("❌ Erro em " + sigla + ": " + erro.message);
      continue;
    }
  }
  
  // INSERE TODOS OS DADOS
  if (dadosConsolidados.length > 0) {
    Logger.log("\n📝 Inserindo " + dadosConsolidados.length + " linhas...");
    sheet.getRange(2, 1, dadosConsolidados.length, 23).setValues(dadosConsolidados);
    SpreadsheetApp.flush();
    Logger.log("✅ Dados inseridos!");
  }
  
  Logger.log("\n✅ CONSOLIDAÇÃO CONCLUÍDA");
  Logger.log("📊 Total de registros: " + dadosConsolidados.length);
  Logger.log("🏢 Empresas processadas: " + empresas.join(", "));
}

// ========================================
// FUNÇÃO 2: HISTÓRICO CONSOLIDADO
// ========================================

function obterResumoHistoricoConsolidado(dias) {
  dias = dias || 30;
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOME_PLANILHA_CONSOLIDADA);
  
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    return;
  }

  Logger.log("=== 📅 HISTÓRICO CONSOLIDADO - " + dias + " DIAS ===");
  
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  
  var dadosAcumulados = [];
  var empresas = Object.keys(EMPRESAS_OMIE);
  
  for (var d = 0; d < dias; d++) {
    var data = new Date();
    data.setDate(data.getDate() - d);
    var dataStr = Utilities.formatDate(data, Session.getScriptTimeZone(), "dd/MM/yyyy");
    
    if (d % 10 === 0) {
      Logger.log("📅 Processando: " + dataStr);
    }
    
    // Processa cada empresa para esta data
    for (var e = 0; e < empresas.length; e++) {
      var sigla = empresas[e];
      var empresa = EMPRESAS_OMIE[sigla];
      
      var payload = {
        "call": "ObterResumoFinancas",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{ 
          "dDia": dataStr,
          "lApenasResumo": true,
          "lExibirCategoria": false
        }]
      };
      
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload),
        "muteHttpExceptions": true
      };

      try {
        var response = UrlFetchApp.fetch("https://app.omie.com.br/api/v1/financas/resumo/", options);
        var resData = JSON.parse(response.getContentText());
        
        if (!resData) continue;
        
        var cc = resData.contaCorrente || {};
        var cp = resData.contaPagar || {};
        var cr = resData.contaReceber || {};
        var fc = resData.fluxoCaixa || {};
        
        dadosAcumulados.push([
          sigla,              // ← COLUNA EMPRESA
          dataStr,
          "RESUMO_GERAL",
          "", "", "",
          Number(cc.vTotal || 0),
          Number(cc.vLimiteCredito || 0),
          Number(cp.nTotal || 0),
          Number(cp.vTotal || 0),
          Number(cp.vAtraso || 0),
          Number(cr.nTotal || 0),
          Number(cr.vTotal || 0),
          Number(cr.vAtraso || 0),
          Number(fc.vPagar || 0),
          Number(fc.vReceber || 0),
          Number(fc.vSaldo || 0),
          "", "", 0, "", "", 0
        ]);
        
        Utilities.sleep(200);
        
      } catch (e) {
        continue;
      }
    }
  }
  
  if (dadosAcumulados.length > 0) {
    sheet.getRange(2, 1, dadosAcumulados.length, 23).setValues(dadosAcumulados);
    SpreadsheetApp.flush();
  }
  
  Logger.log("\n✅ HISTÓRICO CONCLUÍDO");
  Logger.log("📊 Registros: " + dadosAcumulados.length);
}

// ========================================
// FUNÇÃO 3: CRIAR PLANILHA CONSOLIDADA
// ========================================

function criarPlanilhaResumoConsolidada() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(NOME_PLANILHA_CONSOLIDADA);
  
  if (sheet) {
    Logger.log("⚠️ Deletando planilha existente...");
    ss.deleteSheet(sheet);
  }
  
  sheet = ss.insertSheet(NOME_PLANILHA_CONSOLIDADA);
  
  var cabecalho = [
    "empresa",          // ← NOVA COLUNA
    "data",
    "tipo_registro",
    "cod_categoria",
    "desc_categoria",
    "id_titulo",
    "cc_saldo_total",
    "cc_limite_credito",
    "cp_qtd_titulos",
    "cp_valor_total",
    "cp_valor_atraso",
    "cr_qtd_titulos",
    "cr_valor_total",
    "cr_valor_atraso",
    "fluxo_pagar",
    "fluxo_receber",
    "fluxo_saldo",
    "id_cliente",
    "nome_cliente",
    "valor_doc",
    "dt_vencimento",
    "dt_emissao",
    "dias_atraso"
  ];
  
  sheet.getRange(1, 1, 1, 23).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, 23).setFontWeight("bold");
  sheet.getRange(1, 1, 1, 23).setBackground("#009688");
  sheet.getRange(1, 1, 1, 23).setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 23);
  
  // Destaca a coluna empresa
  sheet.getRange("A:A").setBackground("#E0F2F1");
  sheet.getRange("A1").setBackground("#009688");
  
  Logger.log("✅ Planilha consolidada criada: " + NOME_PLANILHA_CONSOLIDADA);
  Logger.log("📊 Total de colunas: 23 (incluindo coluna 'empresa')");
}

// ========================================
// FUNÇÃO DEBUG
// ========================================

function debugResumoConsolidado() {
  var empresas = Object.keys(EMPRESAS_OMIE);
  
  Logger.log("=== 🔍 DEBUG CONSOLIDADO ===");
  Logger.log("Empresas configuradas: " + empresas.join(", "));
  
  var hoje = new Date();
  var dataStr = Utilities.formatDate(hoje, Session.getScriptTimeZone(), "dd/MM/yyyy");
  
  for (var i = 0; i < empresas.length; i++) {
    var sigla = empresas[i];
    var empresa = EMPRESAS_OMIE[sigla];
    
    Logger.log("\n📊 Testando: " + sigla);
    Logger.log("App Key: " + empresa.appKey);
    
    var payload = {
      "call": "ObterResumoFinancas",
      "app_key": empresa.appKey,
      "app_secret": empresa.appSecret,
      "param": [{ 
        "dDia": dataStr,
        "lApenasResumo": true,
        "lExibirCategoria": false
      }]
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      var response = UrlFetchApp.fetch("https://app.omie.com.br/api/v1/financas/resumo/", options);
      var data = JSON.parse(response.getContentText());
      
      if (data && data.contaCorrente) {
        Logger.log("✅ " + sigla + " - Saldo: R$ " + (data.contaCorrente.vTotal || 0));
      } else {
        Logger.log("⚠️ " + sigla + " - Sem dados");
      }
      
    } catch (e) {
      Logger.log("❌ " + sigla + " - Erro: " + e.message);
    }
    
    if (i < empresas.length - 1) {
      Utilities.sleep(1000);
    }
  }
}

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

var CONFIG_CONTAS_CORRENTES_CONSOLIDADO = {
  url: "https://app.omie.com.br/api/v1/geral/contacorrente/",
  nomePlanilha: "ContasCorrentes",
  maxPaginas: 1000
};

// ========================================
// FUNÇÃO AUXILIAR: VERIFICAR TEMPO
// ========================================

function verificarTempoExecucaoContasCorrentes(horaInicio) {
  var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
  var limiteSegundos = 330;
  
  if (tempoDecorrido > limiteSegundos) {
    Logger.log("Atingido limite de tempo de execução (" + tempoDecorrido + "s). Parando importação.");
    return false;
  }
  return true;
}

// ========================================
// FUNÇÃO AUXILIAR: LIMPAR PLANILHA
// ========================================

function limparPlanilhaCompletaContasCorrentes(sheet) {
  var lastRow = sheet.getLastRow();
  var maxRows = sheet.getMaxRows();
  var lastCol = sheet.getMaxColumns();
  
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
  
  sheet.getRange("B:B").setNumberFormat("@"); // Código agora é coluna B
  Logger.log("Coluna B (código) formatada como TEXTO.");
  Logger.log("Planilha limpa. Linhas totais: " + sheet.getMaxRows());
}

// ========================================
// FUNÇÃO 1: RECRIAR BASE COMPLETA CONSOLIDADA
// ========================================

function recriaBaseCompletaContasCorrentesOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    Logger.log("💡 Execute: criarPlanilhaContasCorrentes()");
    return;
  }

  Logger.log("=== RECRIAÇÃO COMPLETA - CONTAS CORRENTES CONSOLIDADAS ===");
  Logger.log("Linhas antes da limpeza: " + sheet.getLastRow());

  limparPlanilhaCompletaContasCorrentes(sheet);

  var dadosConsolidados = [];
  var empresas = Object.keys(EMPRESAS_OMIE);
  var totalGeral = 0;
  
  // Processa cada empresa
  for (var e = 0; e < empresas.length; e++) {
    var sigla = empresas[e];
    var empresa = EMPRESAS_OMIE[sigla];
    
    Logger.log("\n📊 Processando empresa: " + sigla);
    
    var pagina = 1;
    var totalPaginas = 1;
    var totalEmpresa = 0;
    
    do {
      if (!verificarTempoExecucaoContasCorrentes(horaInicio)) {
        Logger.log("⏱️ Tempo limite. Total importado: " + totalGeral);
        break;
      }
      
      var payload = {
        "call": "ListarContasCorrentes",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{ 
          "pagina": pagina, 
          "registros_por_pagina": 100 
        }]
      };
      
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload)
      };

      try {
        var response = UrlFetchApp.fetch(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.url, options);
        var data = JSON.parse(response.getContentText());
        
        if (!data || typeof data !== 'object') {
          Logger.log("⚠️ Resposta inválida na página " + pagina);
          break;
        }
        
        totalPaginas = data.total_de_paginas || 1;
        var contas = data.ListarContasCorrentes || [];
        
        if (contas.length === 0) {
          Logger.log("Fim das contas correntes na página " + pagina);
          break;
        }
        
        for (var i = 0; i < contas.length; i++) {
          var c = contas[i];
          
          var row = [
            sigla,              // ← COLUNA EMPRESA
            c.nCodCC || "",
            c.cCodCCInt || "",
            c.descricao || "",
            c.tipo_conta_corrente || "",
            c.codigo_banco || "",
            c.codigo_agencia || "",
            c.numero_conta_corrente || "",
            c.saldo_inicial || "",
            c.saldo_data || "",
            c.valor_limite || "",
            c.inativo || "",
            c.observacao || "",
            c.nome_gerente || "",
            c.telefone || "",
            c.email || "",
            c.data_inc || "",
            c.hora_inc || "",
            c.user_inc || "",
            c.data_alt || "",
            c.hora_alt || "",
            c.user_alt || ""
          ];
          
          dadosConsolidados.push(row);
          totalEmpresa++;
        }
        
        Logger.log("Página " + pagina + "/" + totalPaginas + " - Total: " + totalEmpresa);
        pagina++;
        
      } catch (erro) {
        Logger.log("❌ Erro na página " + pagina + ": " + erro.message);
        break;
      }
      
    } while (pagina <= totalPaginas);
    
    Logger.log("✅ " + sigla + " completo: " + totalEmpresa + " contas correntes");
    totalGeral += totalEmpresa;
    
    // Pausa entre empresas
    if (e < empresas.length - 1) {
      Utilities.sleep(1000);
    }
  }
  
  // Insere todos os dados
  if (dadosConsolidados.length > 0) {
    Logger.log("\n📝 Inserindo " + dadosConsolidados.length + " contas correntes...");
    sheet.getRange(2, 1, dadosConsolidados.length, 22).setValues(dadosConsolidados);
    SpreadsheetApp.flush();
  }
  
  Logger.log("\n=== ✅ IMPORTAÇÃO FINALIZADA ===");
  Logger.log("Total consolidado: " + totalGeral + " contas correntes");
  Logger.log("Linhas na planilha: " + sheet.getLastRow());
}

// ========================================
// FUNÇÃO 2: IMPORTAR APENAS NOVAS
// ========================================

function importarNovasContasCorrentesOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    return;
  }
  
  Logger.log("=== IMPORTAÇÃO DE NOVAS CONTAS CORRENTES ===");
  
  sheet.getRange("B:B").setNumberFormat("@");
  
  var lastRow = sheet.getLastRow();
  var codigosExistentesSet = new Set();
  
  if (lastRow > 1) {
    // Cria chave única: empresa+codigo
    var dados = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < dados.length; i++) {
      var empresa = String(dados[i][0]).trim();
      var codigo = String(dados[i][1]).trim();
      if (empresa && codigo) {
        codigosExistentesSet.add(empresa + "|" + codigo);
      }
    }
    Logger.log("Registros únicos existentes: " + codigosExistentesSet.size);
  }

  var dadosNovos = [];
  var empresas = Object.keys(EMPRESAS_OMIE);
  var novosTotal = 0;
  var ignoradosTotal = 0;
  
  for (var e = 0; e < empresas.length; e++) {
    var sigla = empresas[e];
    var empresa = EMPRESAS_OMIE[sigla];
    
    Logger.log("\n📊 Processando: " + sigla);
    
    var pagina = 1;
    var totalPaginas = 1;
    var novosEmpresa = 0;
    var ignoradosEmpresa = 0;
    
    do {
      if (!verificarTempoExecucaoContasCorrentes(horaInicio)) {
        Logger.log("⏱️ Tempo limite. Novos: " + novosTotal);
        break;
      }
      
      var payload = {
        "call": "ListarContasCorrentes",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{ 
          "pagina": pagina, 
          "registros_por_pagina": 100 
        }]
      };
      
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload)
      };

      try {
        var response = UrlFetchApp.fetch(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.url, options);
        var data = JSON.parse(response.getContentText());
        
        if (!data) break;
        
        totalPaginas = data.total_de_paginas || 1;
        var contas = data.ListarContasCorrentes || [];
        
        if (contas.length === 0) break;
        
        for (var i = 0; i < contas.length; i++) {
          var c = contas[i];
          var codigoStr = String(c.nCodCC || "").trim();
          
          if (!codigoStr) continue;
          
          var chaveUnica = sigla + "|" + codigoStr;
          
          if (codigosExistentesSet.has(chaveUnica)) {
            ignoradosEmpresa++;
            continue;
          }
          
          var row = [
            sigla, c.nCodCC || "", c.cCodCCInt || "", c.descricao || "",
            c.tipo_conta_corrente || "", c.codigo_banco || "", c.codigo_agencia || "",
            c.numero_conta_corrente || "", c.saldo_inicial || "", c.saldo_data || "",
            c.valor_limite || "", c.inativo || "", c.observacao || "",
            c.nome_gerente || "", c.telefone || "", c.email || "",
            c.data_inc || "", c.hora_inc || "", c.user_inc || "",
            c.data_alt || "", c.hora_alt || "", c.user_alt || ""
          ];
          
          dadosNovos.push(row);
          codigosExistentesSet.add(chaveUnica);
          novosEmpresa++;
        }
        
        Logger.log("Página " + pagina + "/" + totalPaginas + " - Novos: " + novosEmpresa + " | Ignorados: " + ignoradosEmpresa);
        pagina++;
        
      } catch (erro) {
        Logger.log("❌ Erro: " + erro.message);
        break;
      }
      
    } while (pagina <= totalPaginas);
    
    Logger.log("✅ " + sigla + " - Novos: " + novosEmpresa + " | Ignorados: " + ignoradosEmpresa);
    novosTotal += novosEmpresa;
    ignoradosTotal += ignoradosEmpresa;
    
    if (e < empresas.length - 1) {
      Utilities.sleep(1000);
    }
  }

  if (dadosNovos.length > 0) {
    Logger.log("\n📝 Inserindo " + dadosNovos.length + " novas contas correntes...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, 22).setValues(dadosNovos);
    SpreadsheetApp.flush();
  } else {
    Logger.log("\nℹ️ Nenhuma conta corrente nova para inserir.");
  }

  Logger.log("\n=== ✅ FINALIZADO ===");
  Logger.log("Novos: " + novosTotal + " | Ignorados: " + ignoradosTotal);
}

// ========================================
// FUNÇÃO 3: ATUALIZAR E ADICIONAR
// ========================================

function atualizarContasCorrentesOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    return;
  }
  
  Logger.log("=== SINCRONIZAÇÃO DE CONTAS CORRENTES ===");
  
  sheet.getRange("B:B").setNumberFormat("@");
  
  var lastRow = sheet.getLastRow();
  var mapaCodigosLinhas = new Map();
  
  if (lastRow > 1) {
    var dados = sheet.getRange(2, 1, lastRow - 1, 2).getValues();
    for (var i = 0; i < dados.length; i++) {
      var empresa = String(dados[i][0]).trim();
      var codigo = String(dados[i][1]).trim();
      if (empresa && codigo) {
        var chaveUnica = empresa + "|" + codigo;
        mapaCodigosLinhas.set(chaveUnica, i + 2);
      }
    }
    Logger.log("Registros existentes: " + mapaCodigosLinhas.size);
  }

  var dadosNovos = [];
  var empresas = Object.keys(EMPRESAS_OMIE);
  var novosTotal = 0;
  var atualizadosTotal = 0;
  
  for (var e = 0; e < empresas.length; e++) {
    var sigla = empresas[e];
    var empresa = EMPRESAS_OMIE[sigla];
    
    Logger.log("\n📊 Sincronizando: " + sigla);
    
    var pagina = 1;
    var totalPaginas = 1;
    var novosEmpresa = 0;
    var atualizadosEmpresa = 0;
    
    do {
      if (!verificarTempoExecucaoContasCorrentes(horaInicio)) {
        Logger.log("⏱️ Tempo limite");
        break;
      }
      
      var payload = {
        "call": "ListarContasCorrentes",
        "app_key": empresa.appKey,
        "app_secret": empresa.appSecret,
        "param": [{ 
          "pagina": pagina, 
          "registros_por_pagina": 100 
        }]
      };
      
      var options = {
        "method": "post",
        "contentType": "application/json",
        "payload": JSON.stringify(payload)
      };

      try {
        var response = UrlFetchApp.fetch(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.url, options);
        var data = JSON.parse(response.getContentText());
        
        if (!data) break;
        
        totalPaginas = data.total_de_paginas || 1;
        var contas = data.ListarContasCorrentes || [];
        
        if (contas.length === 0) break;
        
        for (var i = 0; i < contas.length; i++) {
          var c = contas[i];
          
          var row = [
            sigla, c.nCodCC || "", c.cCodCCInt || "", c.descricao || "",
            c.tipo_conta_corrente || "", c.codigo_banco || "", c.codigo_agencia || "",
            c.numero_conta_corrente || "", c.saldo_inicial || "", c.saldo_data || "",
            c.valor_limite || "", c.inativo || "", c.observacao || "",
            c.nome_gerente || "", c.telefone || "", c.email || "",
            c.data_inc || "", c.hora_inc || "", c.user_inc || "",
            c.data_alt || "", c.hora_alt || "", c.user_alt || ""
          ];
          
          var codigoStr = String(c.nCodCC || "").trim();
          if (!codigoStr) continue;
          
          var chaveUnica = sigla + "|" + codigoStr;
          
          if (mapaCodigosLinhas.has(chaveUnica)) {
            var linha = mapaCodigosLinhas.get(chaveUnica);
            sheet.getRange(linha, 1, 1, 22).setValues([row]);
            atualizadosEmpresa++;
          } else {
            dadosNovos.push(row);
            novosEmpresa++;
          }
        }
        
        Logger.log("Página " + pagina + "/" + totalPaginas + " - Novos: " + novosEmpresa + " | Atualizados: " + atualizadosEmpresa);
        pagina++;
        
      } catch (erro) {
        Logger.log("❌ Erro: " + erro.message);
        break;
      }
      
    } while (pagina <= totalPaginas);
    
    Logger.log("✅ " + sigla + " - Novos: " + novosEmpresa + " | Atualizados: " + atualizadosEmpresa);
    novosTotal += novosEmpresa;
    atualizadosTotal += atualizadosEmpresa;
    
    if (e < empresas.length - 1) {
      Utilities.sleep(1000);
    }
  }

  if (dadosNovos.length > 0) {
    Logger.log("\n📝 Inserindo " + dadosNovos.length + " novas contas correntes...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, 22).setValues(dadosNovos);
    SpreadsheetApp.flush();
  }

  Logger.log("\n=== ✅ FINALIZADO ===");
  Logger.log("Novos: " + novosTotal + " | Atualizados: " + atualizadosTotal);
}

// ========================================
// FUNÇÃO: CRIAR PLANILHA
// ========================================

function criarPlanilhaContasCorrentes() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.nomePlanilha);
  
  if (sheet) {
    Logger.log("⚠️ Planilha já existe. Deletando...");
    ss.deleteSheet(sheet);
  }
  
  sheet = ss.insertSheet(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.nomePlanilha);
  
  var cabecalho = [
    "empresa",          // ← NOVA COLUNA
    "nCodCC", "cCodCCInt", "descricao", "tipo_conta_corrente", "codigo_banco",
    "codigo_agencia", "numero_conta_corrente", "saldo_inicial", "saldo_data",
    "valor_limite", "inativo", "observacao", "nome_gerente", "telefone", "email",
    "data_inc", "hora_inc", "user_inc", "data_alt", "hora_alt", "user_alt"
  ];
  
  sheet.getRange(1, 1, 1, 22).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, 22).setFontWeight("bold");
  sheet.getRange(1, 1, 1, 22).setBackground("#F4B400");
  sheet.getRange(1, 1, 1, 22).setFontColor("#000000");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, 22);
  
  sheet.getRange("B:B").setNumberFormat("@");
  sheet.getRange("A:A").setBackground("#FFF9E6");
  sheet.getRange("A1").setBackground("#F4B400");
  
  Logger.log("✅ Planilha consolidada criada: " + CONFIG_CONTAS_CORRENTES_CONSOLIDADO.nomePlanilha);
  Logger.log("📊 Total de colunas: 22 (incluindo 'empresa')");
}

// ========================================
// FUNÇÃO DE DEBUG
// ========================================

function debugComparacaoContasCorrentes() {
  Logger.log("=== DEBUG: CONTAS CORRENTES CONSOLIDADO ===");
  
  var empresas = Object.keys(EMPRESAS_OMIE);
  
  for (var e = 0; e < empresas.length; e++) {
    var sigla = empresas[e];
    var empresa = EMPRESAS_OMIE[sigla];
    
    Logger.log("\n📊 Testando: " + sigla);
    
    var payload = {
      "call": "ListarContasCorrentes",
      "app_key": empresa.appKey,
      "app_secret": empresa.appSecret,
      "param": [{ "pagina": 1, "registros_por_pagina": 5 }]
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload)
    };
    
    try {
      var response = UrlFetchApp.fetch(CONFIG_CONTAS_CORRENTES_CONSOLIDADO.url, options);
      var data = JSON.parse(response.getContentText());
      var contas = data.ListarContasCorrentes || [];
      
      Logger.log("✅ " + sigla + " - Primeiras 5 contas correntes:");
      for (var i = 0; i < Math.min(5, contas.length); i++) {
        var c = contas[i];
        Logger.log("  " + (i+1) + ". [" + c.nCodCC + "] " + (c.descricao || "").substring(0, 40) + " | Banco: " + (c.codigo_banco || ""));
      }
      
    } catch (erro) {
      Logger.log("❌ " + sigla + " - Erro: " + erro.message);
    }
    
    if (e < empresas.length - 1) {
      Utilities.sleep(1000);
    }
  }
  
  Logger.log("\n=== FIM DO DEBUG ===");
}

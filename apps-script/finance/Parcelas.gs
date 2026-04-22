// ========================================
// CONFIGURAÇÕES GERAIS - PARCELAS OMIE
// ========================================

var CONFIG_PARCELAS = {
  appKey: "823997176002",
  appSecret: "4bfd2504503d076365ec4dee298b37eb",
  url: "https://app.omie.com.br/api/v1/geral/parcelas/",
  nomePlanilha: "Parcelas",
  maxPaginas: 1000
};

// ========================================
// FUNÇÃO AUXILIAR: VERIFICAR TEMPO
// ========================================

function verificarTempoExecucaoParcelas(horaInicio) {
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

function limparPlanilhaCompletaParcelas(sheet) {
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
  
  // CRÍTICO: Formata coluna A como TEXTO para evitar conversão automática
  sheet.getRange("A:A").setNumberFormat("@");
  Logger.log("Coluna A formatada como TEXTO.");
  
  Logger.log("Planilha limpa. Linhas totais: " + sheet.getMaxRows());
}

// ========================================
// FUNÇÃO 1: RECRIAR BASE COMPLETA
// ========================================

function recriaBaseCompletaParcelasOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PARCELAS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha '" + CONFIG_PARCELAS.nomePlanilha + "' não encontrada! Execute primeiro: criarPlanilhaParcelas()");
    return;
  }

  Logger.log("=== INICIANDO RECRIAÇÃO COMPLETA DA BASE DE PARCELAS ===");
  Logger.log("Linhas antes da limpeza: " + sheet.getLastRow());

  limparPlanilhaCompletaParcelas(sheet);

  var pagina = 1; 
  var totalPaginas = 1;
  var totalImportados = 0;
  var paginasProcessadas = 0;
  var dadosAcumulados = [];
  
  do {
    if (paginasProcessadas >= CONFIG_PARCELAS.maxPaginas) {
      Logger.log("AVISO: Atingido limite máximo de páginas.");
      break;
    }
    
    if (!verificarTempoExecucaoParcelas(horaInicio)) {
      Logger.log("Importação interrompida por tempo. Importados: " + totalImportados);
      return;
    }
    
    var payload = {
      "call": "ListarParcelas",
      "app_key": CONFIG_PARCELAS.appKey,
      "app_secret": CONFIG_PARCELAS.appSecret,
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
      var response = UrlFetchApp.fetch(CONFIG_PARCELAS.url, options);
      var data = JSON.parse(response.getContentText());
      
      if (!data || typeof data !== 'object') {
        Logger.log("Erro: Resposta inválida na página " + pagina);
        break;
      }
      
      totalPaginas = data.total_de_paginas || 1;
      var parcelas = data.cadastros || [];
      
      if (parcelas.length === 0) {
        Logger.log("Nenhuma parcela na página " + pagina + ". Finalizando.");
        break;
      }
      
      for (var i = 0; i < parcelas.length; i++) {
        var p = parcelas[i];
        
        var row = [
          p.nCodigo || "",
          p.cDescricao || "",
          p.nParcelas || ""
        ];
        
        dadosAcumulados.push(row);
        totalImportados++;
      }
      
      Logger.log("Página " + pagina + "/" + totalPaginas + " - Parcelas: " + parcelas.length + " | Total: " + totalImportados);
      paginasProcessadas++;
      pagina++;
      
    } catch (e) {
      Logger.log("ERRO na página " + pagina + ": " + e.message);
      break;
    }
    
  } while (pagina <= totalPaginas && paginasProcessadas < CONFIG_PARCELAS.maxPaginas);
  
  if (dadosAcumulados.length > 0) {
    Logger.log("Inserindo " + dadosAcumulados.length + " parcelas...");
    sheet.getRange(2, 1, dadosAcumulados.length, dadosAcumulados[0].length).setValues(dadosAcumulados);
  }
  
  Logger.log("=== IMPORTAÇÃO FINALIZADA ===");
  Logger.log("Total importado: " + totalImportados);
  Logger.log("Linhas finais (com cabeçalho): " + sheet.getLastRow());
}

// ========================================
// FUNÇÃO 2: IMPORTAR APENAS NOVOS
// ========================================

function importarNovasParcelasOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PARCELAS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    return;
  }
  
  Logger.log("=== INICIANDO IMPORTAÇÃO DE NOVAS PARCELAS ===");
  
  // Garante formato TEXTO na coluna A
  sheet.getRange("A:A").setNumberFormat("@");
  
  var lastRow = sheet.getLastRow();
  var codigosExistentesSet = new Set();
  
  if (lastRow > 1) {
    var todosOsCodigos = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    
    for (var i = 0; i < todosOsCodigos.length; i++) {
      var codigo = todosOsCodigos[i];
      if (codigo !== "" && codigo !== null && codigo !== undefined) {
        codigosExistentesSet.add(String(codigo).trim());
      }
    }
    
    Logger.log("Parcelas ÚNICAS existentes: " + codigosExistentesSet.size);
  }

  var pagina = 1;
  var totalPaginas = 1;
  var novosInseridos = 0;
  var paginasProcessadas = 0;
  var ignorados = 0;
  var dadosNovos = [];
  
  do {
    if (paginasProcessadas >= CONFIG_PARCELAS.maxPaginas) {
      Logger.log("AVISO: Limite de páginas atingido.");
      break;
    }
    
    if (!verificarTempoExecucaoParcelas(horaInicio)) {
      Logger.log("Tempo limite. Novos: " + novosInseridos);
      return;
    }
    
    var payload = {
      "call": "ListarParcelas",
      "app_key": CONFIG_PARCELAS.appKey,
      "app_secret": CONFIG_PARCELAS.appSecret,
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
      var response = UrlFetchApp.fetch(CONFIG_PARCELAS.url, options);
      var data = JSON.parse(response.getContentText());
      
      if (!data || typeof data !== 'object') {
        Logger.log("Erro: Resposta inválida na página " + pagina);
        break;
      }
      
      totalPaginas = data.total_de_paginas || 1;
      var parcelas = data.cadastros || [];
      
      if (parcelas.length === 0) {
        Logger.log("Nenhuma parcela na página " + pagina + ". Finalizando.");
        break;
      }
      
      for (var i = 0; i < parcelas.length; i++) {
        var p = parcelas[i];
        var codigoStr = String(p.nCodigo || "").trim();
        
        if (!codigoStr) continue;
        
        if (codigosExistentesSet.has(codigoStr)) {
          ignorados++;
          continue;
        }
        
        var row = [
          p.nCodigo || "",
          p.cDescricao || "",
          p.nParcelas || ""
        ];
        
        dadosNovos.push(row);
        codigosExistentesSet.add(codigoStr);
        novosInseridos++;
      }
      
      Logger.log("Página " + pagina + "/" + totalPaginas + " - Novos: " + novosInseridos + " | Ignorados: " + ignorados);
      paginasProcessadas++;
      pagina++;
      
    } catch (e) {
      Logger.log("ERRO na página " + pagina + ": " + e.message);
      break;
    }
    
  } while (pagina <= totalPaginas && paginasProcessadas < CONFIG_PARCELAS.maxPaginas);

  if (dadosNovos.length > 0) {
    Logger.log("Inserindo " + dadosNovos.length + " novas parcelas...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, dadosNovos[0].length).setValues(dadosNovos);
  } else {
    Logger.log("NENHUMA parcela nova para inserir.");
  }

  Logger.log("=== IMPORTAÇÃO FINALIZADA ===");
  Logger.log("Novas: " + novosInseridos + " | Ignoradas (já existiam): " + ignorados);
}

// ========================================
// FUNÇÃO 3: ATUALIZAR E ADICIONAR
// ========================================

function atualizarParcelasOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PARCELAS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha não encontrada!");
    return;
  }
  
  Logger.log("=== INICIANDO SINCRONIZAÇÃO DE PARCELAS ===");
  
  // Garante formato TEXTO na coluna A
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
    Logger.log("Parcelas ÚNICAS existentes: " + mapaCodigosLinhas.size);
  }

  var pagina = 1;
  var totalPaginas = 1;
  var novosInseridos = 0;
  var atualizados = 0;
  var paginasProcessadas = 0;
  var dadosNovos = [];
  
  do {
    if (paginasProcessadas >= CONFIG_PARCELAS.maxPaginas) {
      Logger.log("AVISO: Limite de páginas atingido.");
      break;
    }
    
    if (!verificarTempoExecucaoParcelas(horaInicio)) {
      Logger.log("Tempo limite. Novos: " + novosInseridos + " | Atualizados: " + atualizados);
      return;
    }
    
    var payload = {
      "call": "ListarParcelas",
      "app_key": CONFIG_PARCELAS.appKey,
      "app_secret": CONFIG_PARCELAS.appSecret,
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
      var response = UrlFetchApp.fetch(CONFIG_PARCELAS.url, options);
      var data = JSON.parse(response.getContentText());
      
      if (!data || typeof data !== 'object') {
        Logger.log("Erro: Resposta inválida na página " + pagina);
        break;
      }
      
      totalPaginas = data.total_de_paginas || 1;
      var parcelas = data.cadastros || [];
      
      if (parcelas.length === 0) {
        Logger.log("Nenhuma parcela na página " + pagina + ". Finalizando.");
        break;
      }
      
      for (var i = 0; i < parcelas.length; i++) {
        var p = parcelas[i];
        
        var row = [
          p.nCodigo || "",
          p.cDescricao || "",
          p.nParcelas || ""
        ];
        
        var codigoStr = String(p.nCodigo || "").trim();
        
        if (!codigoStr) continue;
        
        if (mapaCodigosLinhas.has(codigoStr)) {
          var linha = mapaCodigosLinhas.get(codigoStr);
          sheet.getRange(linha, 1, 1, row.length).setValues([row]);
          atualizados++;
        } else {
          dadosNovos.push(row);
          novosInseridos++;
        }
      }
      
      Logger.log("Página " + pagina + "/" + totalPaginas + " - Novos: " + novosInseridos + " | Atualizados: " + atualizados);
      paginasProcessadas++;
      pagina++;
      
    } catch (e) {
      Logger.log("ERRO na página " + pagina + ": " + e.message);
      break;
    }
    
  } while (pagina <= totalPaginas && paginasProcessadas < CONFIG_PARCELAS.maxPaginas);

  if (dadosNovos.length > 0) {
    Logger.log("Inserindo " + dadosNovos.length + " novas parcelas...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, dadosNovos[0].length).setValues(dadosNovos);
  }

  Logger.log("=== SINCRONIZAÇÃO FINALIZADA ===");
  Logger.log("Novos: " + novosInseridos + " | Atualizados: " + atualizados);
}

// ========================================
// FUNÇÃO AUXILIAR: CRIAR CABEÇALHO
// ========================================

function criarPlanilhaParcelas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_PARCELAS.nomePlanilha);
  
  if (sheet) {
    Logger.log("AVISO: Planilha já existe!");
    return;
  }
  
  sheet = ss.insertSheet(CONFIG_PARCELAS.nomePlanilha);
  
  var cabecalho = [
    "nCodigo",
    "cDescricao",
    "nParcelas"
  ];
  
  sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, cabecalho.length).setFontWeight("bold");
  sheet.getRange(1, 1, 1, cabecalho.length).setBackground("#FBBC04");
  sheet.getRange(1, 1, 1, cabecalho.length).setFontColor("#000000");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, cabecalho.length);
  
  // CRÍTICO: Formata coluna A como TEXTO
  sheet.getRange("A:A").setNumberFormat("@");
  
  Logger.log("Planilha criada com sucesso!");
}

// ========================================
// FUNÇÃO DE DEBUG
// ========================================

function debugComparacaoParcelas() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Parcelas");
  var lastRow = sheet.getLastRow();
  
  Logger.log("=== DEBUG: COMPARAÇÃO DE CÓDIGOS PARCELAS ===");
  
  if (lastRow > 1) {
    var codigosPlanilha = sheet.getRange(2, 1, Math.min(10, lastRow - 1), 1).getValues().flat();
    
    Logger.log("--- PRIMEIROS 10 CÓDIGOS NA PLANILHA (RAW) ---");
    for (var i = 0; i < codigosPlanilha.length; i++) {
      var codigo = codigosPlanilha[i];
      var tipo = typeof codigo;
      Logger.log("Linha " + (i+2) + ": [" + tipo + "] '" + codigo + "'");
    }
  }
  
  Logger.log("\n--- PRIMEIROS 10 CÓDIGOS DA API ---");
  
  var payload = {
    "call": "ListarParcelas",
    "app_key": "823997176002",
    "app_secret": "4bfd2504503d076365ec4dee298b37eb",
    "param": [{ "pagina": 1, "registros_por_pagina": 10 }]
  };
  
  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload)
  };
  
  try {
    var response = UrlFetchApp.fetch("https://app.omie.com.br/api/v1/geral/parcelas/", options);
    var data = JSON.parse(response.getContentText());
    var parcelas = data.cadastros || [];
    
    for (var i = 0; i < Math.min(10, parcelas.length); i++) {
      var p = parcelas[i];
      var codigo = p.nCodigo;
      var tipo = typeof codigo;
      Logger.log("API " + (i+1) + ": [" + tipo + "] '" + codigo + "' | Descrição: " + (p.cDescricao || "").substring(0, 30) + " | Parcelas: " + p.nParcelas);
    }
    
  } catch (e) {
    Logger.log("ERRO ao buscar da API: " + e.message);
  }
  
  Logger.log("\n=== FIM DO DEBUG ===");
}

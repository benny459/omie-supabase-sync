// ========================================
// CONFIGURAÇÕES GERAIS - EMPRESAS OMIE
// ========================================

var CONFIG_EMPRESAS = {
  appKey: "823997176002",
  appSecret: "4bfd2504503d076365ec4dee298b37eb",
  url: "https://app.omie.com.br/api/v1/geral/empresas/",
  nomePlanilha: "Empresas",
  maxPaginas: 1000  // Proteção contra loop infinito
};

// ========================================
// FUNÇÃO AUXILIAR: VERIFICAR TEMPO
// ========================================
// Previne timeout do Google Apps Script (limite de 6 minutos)

function verificarTempoExecucaoEmpresas(horaInicio) {
  var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000; // em segundos
  var limiteSegundos = 330; // 5 minutos e 30 segundos (margem de segurança)
  
  if (tempoDecorrido > limiteSegundos) {
    Logger.log("Atingido limite de tempo de execução (" + tempoDecorrido + "s). Parando importação.");
    return false;
  }
  return true;
}

// ========================================
// FUNÇÃO AUXILIAR: LIMPAR PLANILHA COMPLETA
// ========================================
// Garante que a planilha está completamente limpa antes de importar

function limparPlanilhaCompletaEmpresas(sheet) {
  var lastRow = sheet.getMaxRows();
  var lastCol = sheet.getMaxColumns();
  
  // Se houver mais de 1 linha (cabeçalho), limpa tudo abaixo do cabeçalho
  if (lastRow > 1) {
    // Método 1: Limpa o conteúdo
    sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
    
    // Método 2: Remove linhas extras (mantém apenas cabeçalho + 1 linha)
    if (lastRow > 2) {
      sheet.deleteRows(2, lastRow - 1);
    }
  }
  
  Logger.log("Planilha limpa. Linhas totais agora: " + sheet.getMaxRows());
}

// ========================================
// FUNÇÃO 1: RECRIAR BASE COMPLETA
// ========================================
// Apaga todos os registros existentes e importa tudo do zero
// Use para: primeira importação ou quando precisar resetar completamente os dados

function recriaBaseCompletaEmpresasOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_EMPRESAS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha '" + CONFIG_EMPRESAS.nomePlanilha + "' não encontrada! Execute primeiro: criarPlanilhaEmpresas()");
    return;
  }

  Logger.log("=== INICIANDO RECRIAÇÃO COMPLETA DA BASE DE EMPRESAS ===");
  Logger.log("Linhas antes da limpeza: " + sheet.getLastRow());

  // Limpa completamente a planilha (método robusto)
  limparPlanilhaCompletaEmpresas(sheet);

  var pagina = 1; 
  var totalPaginas = 1;
  var totalImportados = 0;
  var paginasProcessadas = 0;
  
  // Array para acumular dados e fazer inserção em lote
  var dadosAcumulados = [];
  
  do {
    // PROTEÇÃO 1: Limite máximo de páginas
    if (paginasProcessadas >= CONFIG_EMPRESAS.maxPaginas) {
      Logger.log("AVISO: Atingido limite máximo de " + CONFIG_EMPRESAS.maxPaginas + " páginas. Parando importação.");
      break;
    }
    
    // PROTEÇÃO 2: Verificar tempo de execução
    if (!verificarTempoExecucaoEmpresas(horaInicio)) {
      Logger.log("Importação interrompida por limite de tempo. Importados: " + totalImportados + " empresas");
      return;
    }
    
    var payload = {
      "call": "ListarEmpresas",
      "app_key": CONFIG_EMPRESAS.appKey,
      "app_secret": CONFIG_EMPRESAS.appSecret,
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
      var response = UrlFetchApp.fetch(CONFIG_EMPRESAS.url, options);
      var data = JSON.parse(response.getContentText());
      
      // PROTEÇÃO 3: Validar resposta da API
      if (!data || typeof data !== 'object') {
        Logger.log("Erro: Resposta inválida da API na página " + pagina);
        break;
      }
      
      totalPaginas = data.total_de_paginas || 1;
      var empresas = data.empresas_cadastro || [];
      
      // PROTEÇÃO 4: Se não há empresas, parar
      if (empresas.length === 0) {
        Logger.log("Nenhuma empresa encontrada na página " + pagina + ". Finalizando.");
        break;
      }
      
      // Acumula dados desta página
      for (var i = 0; i < empresas.length; i++) {
        var e = empresas[i];
        
        var row = [
          e.codigo_empresa || "",
          e.codigo_empresa_integracao || "",
          e.cnpj || "",
          e.razao_social || "",
          e.nome_fantasia || "",
          e.endereco || "",
          e.endereco_numero || "",
          e.complemento || "",
          e.bairro || "",
          e.cidade || "",
          e.estado || "",
          e.cep || "",
          e.telefone1_ddd || "",
          e.telefone1_numero || "",
          e.telefone2_ddd || "",
          e.telefone2_numero || "",
          e.email || "",
          e.website || "",
          e.inscricao_estadual || "",
          e.inscricao_municipal || "",
          e.cnae || "",
          e.regime_tributario || "",
          e.optante_simples_nacional || "",
          e.inativa || "",
          e.gera_nfe || "",
          e.gera_nfse || "",
          e.inclusao_data || "",
          e.inclusao_hora || "",
          e.alteracao_data || "",
          e.alteracao_hora || ""
        ];
        
        dadosAcumulados.push(row);
        totalImportados++;
      }
      
      Logger.log("Página " + pagina + " de " + totalPaginas + " processada. Empresas nesta página: " + empresas.length);
      paginasProcessadas++;
      pagina++;
      
    } catch (e) {
      Logger.log("Erro na página " + pagina + ": " + e.message);
      Logger.log("Empresas importadas até o erro: " + totalImportados);
      break;
    }
    
  } while (pagina <= totalPaginas && paginasProcessadas < CONFIG_EMPRESAS.maxPaginas);
  
  // Insere todos os dados de uma vez (muito mais eficiente)
  if (dadosAcumulados.length > 0) {
    Logger.log("Inserindo " + dadosAcumulados.length + " empresas na planilha...");
    sheet.getRange(2, 1, dadosAcumulados.length, dadosAcumulados[0].length).setValues(dadosAcumulados);
  }
  
  Logger.log("=== IMPORTAÇÃO COMPLETA FINALIZADA ===");
  Logger.log("Total de empresas importadas: " + totalImportados);
  Logger.log("Páginas processadas: " + paginasProcessadas);
  Logger.log("Linhas finais na planilha (incluindo cabeçalho): " + sheet.getLastRow());
}

// ========================================
// FUNÇÃO 2: IMPORTAR APENAS NOVOS
// ========================================
// Adiciona apenas empresas que ainda não existem na planilha
// Use para: quando você tem certeza que não houve alterações nas empresas existentes

function importarNovasEmpresasOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_EMPRESAS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha '" + CONFIG_EMPRESAS.nomePlanilha + "' não encontrada! Execute primeiro: criarPlanilhaEmpresas()");
    return;
  }
  
  Logger.log("=== INICIANDO IMPORTAÇÃO DE NOVAS EMPRESAS ===");
  
  var lastRow = sheet.getLastRow();

  // Obtém códigos existentes na planilha - FILTRANDO VALORES VAZIOS
  var codigosExistentes = [];
  if (lastRow > 1) {
    var todosOsCodigos = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
    
    // Filtra apenas valores não vazios e converte tudo para string para comparação consistente
    codigosExistentes = todosOsCodigos
      .filter(function(codigo) { 
        return codigo !== "" && codigo !== null && codigo !== undefined; 
      })
      .map(function(codigo) { 
        return String(codigo); // Converte para string para comparação consistente
      });
    
    Logger.log("Empresas existentes na planilha (não vazias): " + codigosExistentes.length);
  }

  var pagina = 1;
  var totalPaginas = 1;
  var novosInseridos = 0;
  var paginasProcessadas = 0;
  var dadosNovos = [];
  
  do {
    // PROTEÇÃO 1: Limite máximo de páginas
    if (paginasProcessadas >= CONFIG_EMPRESAS.maxPaginas) {
      Logger.log("AVISO: Atingido limite máximo de " + CONFIG_EMPRESAS.maxPaginas + " páginas. Parando importação.");
      break;
    }
    
    // PROTEÇÃO 2: Verificar tempo de execução
    if (!verificarTempoExecucaoEmpresas(horaInicio)) {
      Logger.log("Importação interrompida por limite de tempo. Novas empresas: " + novosInseridos);
      return;
    }
    
    var payload = {
      "call": "ListarEmpresas",
      "app_key": CONFIG_EMPRESAS.appKey,
      "app_secret": CONFIG_EMPRESAS.appSecret,
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
      var response = UrlFetchApp.fetch(CONFIG_EMPRESAS.url, options);
      var data = JSON.parse(response.getContentText());
      
      // PROTEÇÃO 3: Validar resposta da API
      if (!data || typeof data !== 'object') {
        Logger.log("Erro: Resposta inválida da API na página " + pagina);
        break;
      }
      
      totalPaginas = data.total_de_paginas || 1;
      var empresas = data.empresas_cadastro || [];
      
      // PROTEÇÃO 4: Se não há empresas, parar
      if (empresas.length === 0) {
        Logger.log("Nenhuma empresa encontrada na página " + pagina + ". Finalizando.");
        break;
      }
      
      for (var i = 0; i < empresas.length; i++) {
        var e = empresas[i];
        
        // Converte o código para string para comparação consistente
        var codigoEmpresa = String(e.codigo_empresa || "");
        
        // Verifica se a empresa já existe - COMPARAÇÃO CORRIGIDA
        if (codigoEmpresa && codigosExistentes.indexOf(codigoEmpresa) !== -1) {
          continue; // Pula empresas que já existem
        }
        
        var row = [
          e.codigo_empresa || "",
          e.codigo_empresa_integracao || "",
          e.cnpj || "",
          e.razao_social || "",
          e.nome_fantasia || "",
          e.endereco || "",
          e.endereco_numero || "",
          e.complemento || "",
          e.bairro || "",
          e.cidade || "",
          e.estado || "",
          e.cep || "",
          e.telefone1_ddd || "",
          e.telefone1_numero || "",
          e.telefone2_ddd || "",
          e.telefone2_numero || "",
          e.email || "",
          e.website || "",
          e.inscricao_estadual || "",
          e.inscricao_municipal || "",
          e.cnae || "",
          e.regime_tributario || "",
          e.optante_simples_nacional || "",
          e.inativa || "",
          e.gera_nfe || "",
          e.gera_nfse || "",
          e.inclusao_data || "",
          e.inclusao_hora || "",
          e.alteracao_data || "",
          e.alteracao_hora || ""
        ];
        
        dadosNovos.push(row);
        codigosExistentes.push(codigoEmpresa); // Adiciona à lista de existentes
        novosInseridos++;
      }
      
      Logger.log("Página " + pagina + " de " + totalPaginas + " processada. Novas encontradas até agora: " + novosInseridos);
      paginasProcessadas++;
      pagina++;
      
    } catch (e) {
      Logger.log("Erro na página " + pagina + ": " + e.message);
      Logger.log("Novas empresas até o erro: " + novosInseridos);
      break;
    }
    
  } while (pagina <= totalPaginas && paginasProcessadas < CONFIG_EMPRESAS.maxPaginas);

  // Insere todos os novos dados de uma vez
  if (dadosNovos.length > 0) {
    Logger.log("Inserindo " + dadosNovos.length + " novas empresas na planilha...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, dadosNovos[0].length).setValues(dadosNovos);
  } else {
    Logger.log("Nenhuma empresa nova para inserir.");
  }

  Logger.log("=== IMPORTAÇÃO INCREMENTAL FINALIZADA ===");
  Logger.log("Novas empresas adicionadas: " + novosInseridos);
  Logger.log("Páginas processadas: " + paginasProcessadas);
}

// ========================================
// FUNÇÃO 3: ATUALIZAR E ADICIONAR
// ========================================
// Atualiza empresas existentes e adiciona novas
// Use para: sincronização diária/regular dos dados

function atualizarEmpresasOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_EMPRESAS.nomePlanilha);
  
  if (!sheet) {
    Logger.log("ERRO: Planilha '" + CONFIG_EMPRESAS.nomePlanilha + "' não encontrada! Execute primeiro: criarPlanilhaEmpresas()");
    return;
  }
  
  Logger.log("=== INICIANDO SINCRONIZAÇÃO DE EMPRESAS ===");
  
  var lastRow = sheet.getLastRow();

  // Cria um mapa de códigos existentes com suas linhas - FILTRANDO VALORES VAZIOS
  var mapaCodigosLinhas = {};
  if (lastRow > 1) {
    var codigos = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < codigos.length; i++) {
      var codigo = codigos[i][0];
      // Apenas adiciona ao mapa se o código não for vazio
      if (codigo !== "" && codigo !== null && codigo !== undefined) {
        mapaCodigosLinhas[String(codigo)] = i + 2; // Converte para string e guarda a linha
      }
    }
    Logger.log("Empresas existentes na planilha (não vazias): " + Object.keys(mapaCodigosLinhas).length);
  }

  var pagina = 1;
  var totalPaginas = 1;
  var novosInseridos = 0;
  var atualizados = 0;
  var paginasProcessadas = 0;
  var dadosNovos = [];
  
  do {
    // PROTEÇÃO 1: Limite máximo de páginas
    if (paginasProcessadas >= CONFIG_EMPRESAS.maxPaginas) {
      Logger.log("AVISO: Atingido limite máximo de " + CONFIG_EMPRESAS.maxPaginas + " páginas. Parando sincronização.");
      break;
    }
    
    // PROTEÇÃO 2: Verificar tempo de execução
    if (!verificarTempoExecucaoEmpresas(horaInicio)) {
      Logger.log("Sincronização interrompida por limite de tempo. Novas: " + novosInseridos + " | Atualizadas: " + atualizados);
      return;
    }
    
    var payload = {
      "call": "ListarEmpresas",
      "app_key": CONFIG_EMPRESAS.appKey,
      "app_secret": CONFIG_EMPRESAS.appSecret,
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
      var response = UrlFetchApp.fetch(CONFIG_EMPRESAS.url, options);
      var data = JSON.parse(response.getContentText());
      
      // PROTEÇÃO 3: Validar resposta da API
      if (!data || typeof data !== 'object') {
        Logger.log("Erro: Resposta inválida da API na página " + pagina);
        break;
      }
      
      totalPaginas = data.total_de_paginas || 1;
      var empresas = data.empresas_cadastro || [];
      
      // PROTEÇÃO 4: Se não há empresas, parar
      if (empresas.length === 0) {
        Logger.log("Nenhuma empresa encontrada na página " + pagina + ". Finalizando.");
        break;
      }
      
      for (var i = 0; i < empresas.length; i++) {
        var e = empresas[i];
        
        var row = [
          e.codigo_empresa || "",
          e.codigo_empresa_integracao || "",
          e.cnpj || "",
          e.razao_social || "",
          e.nome_fantasia || "",
          e.endereco || "",
          e.endereco_numero || "",
          e.complemento || "",
          e.bairro || "",
          e.cidade || "",
          e.estado || "",
          e.cep || "",
          e.telefone1_ddd || "",
          e.telefone1_numero || "",
          e.telefone2_ddd || "",
          e.telefone2_numero || "",
          e.email || "",
          e.website || "",
          e.inscricao_estadual || "",
          e.inscricao_municipal || "",
          e.cnae || "",
          e.regime_tributario || "",
          e.optante_simples_nacional || "",
          e.inativa || "",
          e.gera_nfe || "",
          e.gera_nfse || "",
          e.inclusao_data || "",
          e.inclusao_hora || "",
          e.alteracao_data || "",
          e.alteracao_hora || ""
        ];
        
        // Converte o código para string para comparação consistente
        var codigoEmpresa = String(e.codigo_empresa || "");
        
        // Verifica se a empresa já existe - COMPARAÇÃO CORRIGIDA
        if (codigoEmpresa && mapaCodigosLinhas[codigoEmpresa]) {
          // ATUALIZA o registro existente
          var linha = mapaCodigosLinhas[codigoEmpresa];
          sheet.getRange(linha, 1, 1, row.length).setValues([row]);
          atualizados++;
        } else if (codigoEmpresa) {
          // Acumula para adicionar novas em lote (só se tiver código válido)
          dadosNovos.push(row);
          novosInseridos++;
        }
      }
      
      Logger.log("Página " + pagina + " de " + totalPaginas + " processada. Novas: " + novosInseridos + " | Atualizadas: " + atualizados);
      paginasProcessadas++;
      pagina++;
      
    } catch (e) {
      Logger.log("Erro na página " + pagina + ": " + e.message);
      Logger.log("Status até o erro - Novas: " + novosInseridos + " | Atualizadas: " + atualizados);
      break;
    }
    
  } while (pagina <= totalPaginas && paginasProcessadas < CONFIG_EMPRESAS.maxPaginas);

  // Insere todos os novos dados de uma vez
  if (dadosNovos.length > 0) {
    Logger.log("Inserindo " + dadosNovos.length + " novas empresas na planilha...");
    sheet.getRange(sheet.getLastRow() + 1, 1, dadosNovos.length, dadosNovos[0].length).setValues(dadosNovos);
  }

  Logger.log("=== SINCRONIZAÇÃO FINALIZADA ===");
  Logger.log("Novas empresas: " + novosInseridos);
  Logger.log("Empresas atualizadas: " + atualizados);
  Logger.log("Páginas processadas: " + paginasProcessadas);
}

// ========================================
// FUNÇÃO AUXILIAR: CRIAR CABEÇALHO
// ========================================
// Cria automaticamente a planilha com o cabeçalho correto

function criarPlanilhaEmpresas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(CONFIG_EMPRESAS.nomePlanilha);
  
  if (sheet) {
    Logger.log("AVISO: Planilha '" + CONFIG_EMPRESAS.nomePlanilha + "' já existe!");
    Logger.log("Se deseja recriá-la, delete manualmente e execute esta função novamente.");
    return;
  }
  
  sheet = ss.insertSheet(CONFIG_EMPRESAS.nomePlanilha);
  
  var cabecalho = [
    "codigo_empresa",
    "codigo_empresa_integracao",
    "cnpj",
    "razao_social",
    "nome_fantasia",
    "endereco",
    "endereco_numero",
    "complemento",
    "bairro",
    "cidade",
    "estado",
    "cep",
    "telefone1_ddd",
    "telefone1_numero",
    "telefone2_ddd",
    "telefone2_numero",
    "email",
    "website",
    "inscricao_estadual",
    "inscricao_municipal",
    "cnae",
    "regime_tributario",
    "optante_simples_nacional",
    "inativa",
    "gera_nfe",
    "gera_nfse",
    "inclusao_data",
    "inclusao_hora",
    "alteracao_data",
    "alteracao_hora"
  ];
  
  sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
  sheet.getRange(1, 1, 1, cabecalho.length).setFontWeight("bold");
  sheet.getRange(1, 1, 1, cabecalho.length).setBackground("#34A853");
  sheet.getRange(1, 1, 1, cabecalho.length).setFontColor("#FFFFFF");
  sheet.setFrozenRows(1);
  sheet.autoResizeColumns(1, cabecalho.length);
  
  Logger.log("Planilha '" + CONFIG_EMPRESAS.nomePlanilha + "' criada com sucesso!");
  Logger.log("Próximo passo: Execute a função recriaBaseCompletaEmpresasOmie()");
}

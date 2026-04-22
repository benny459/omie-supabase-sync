// ========================================
// CONFIGURAÇÕES - CADASTROS AUXILIARES (FINAL)
// ========================================

var CONFIG_CADASTROS_AUX = {
  appKey: "823997176002",
  appSecret: "4bfd2504503d076365ec4dee298b37eb",
  
  cadastros: {
    bandeiras: {
      url: "https://app.omie.com.br/api/v1/geral/bandeiracartao/",
      call: "ListarBandeiras",
      planilha: "BandeirasCartao",
      campos: ["cCodigo", "cDescricao"],    
      responseField: "listaBandeira",
      usaPaginacao: true
    },
    origens: {
      url: "https://app.omie.com.br/api/v1/geral/origemlancamento/",
      call: "ListarOrigem",
      planilha: "OrigensLancamento",
      campos: ["codigo", "descricao"],
      responseField: "origem",
      usaPaginacao: false,
      paramCustom: { codigo: "" }
    },
    finalidades: {
      url: "https://app.omie.com.br/api/v1/geral/finaltransf/",
      call: "ListarFinalTransf",
      planilha: "FinalidadesTransf",
      campos: ["banco", "codigo", "descricao"],
      responseField: "cadastros",
      usaPaginacao: false,
      paramCustom: { filtrarPorBanco: "" }
    },
    dre: {
      url: "https://app.omie.com.br/api/v1/geral/dre/",
      call: "ListarCadastroDRE",
      planilha: "DRE",
      campos: ["codigoDRE", "descricaoDRE"],
      responseField: "dreLista",
      usaPaginacao: false,
      paramCustom: { apenasContasAtivas: "N" }
    },
    tiposcc: {
      url: "https://app.omie.com.br/api/v1/geral/tipocc/",
      call: "ListarTiposCC",
      planilha: "TiposContaCorrente",
      campos: ["codigo", "descricao"],
      responseField: "listaTiposCC",
      usaPaginacao: false,
      paramCustom: { codigo: "" }
    },
    tiposdoc: {
      url: "https://app.omie.com.br/api/v1/geral/tiposdoc/",
      call: "PesquisarTipoDocumento",
      planilha: "TiposDocumento",
      campos: ["codigo", "descricao"],
      responseField: "tipo_documento_cadastro",
      usaPaginacao: false,
      paramCustom: { codigo: "" }
    },
    bancos: {
      url: "https://app.omie.com.br/api/v1/geral/bancos/",
      call: "ListarBancos",
      planilha: "Bancos",
      campos: ["codigo", "nome", "tipo"],
      responseField: "fin_banco_cadastro",
      usaPaginacao: true,
      paramNome: { pagina: "pagina", registros: "registros_por_pagina" }
    }
  }
};

// ========================================
// FUNÇÃO DEBUG: TESTAR UM CADASTRO
// ========================================

function debugCadastroAuxiliar(tipoCadastro) {
  var config = CONFIG_CADASTROS_AUX.cadastros[tipoCadastro];
  
  if (!config) {
    Logger.log("❌ Tipo inválido! Opções: " + Object.keys(CONFIG_CADASTROS_AUX.cadastros).join(", "));
    return;
  }
  
  Logger.log("=== 🔍 DEBUG: " + tipoCadastro.toUpperCase() + " ===");
  Logger.log("URL: " + config.url);
  Logger.log("Call: " + config.call);
  Logger.log("Usa paginação: " + (config.usaPaginacao ? "SIM" : "NÃO"));
  
  var param = config.paramCustom || {};
  
  if (config.usaPaginacao) {
    var nomesPaginacao = config.paramNome || { pagina: "nPagina", registros: "nRegPorPagina" };
    param[nomesPaginacao.pagina] = 1;
    param[nomesPaginacao.registros] = 5;
  }
  
  var payload = {
    "call": config.call,
    "app_key": CONFIG_CADASTROS_AUX.appKey,
    "app_secret": CONFIG_CADASTROS_AUX.appSecret,
    "param": [param]
  };
  
  var options = {
    "method": "post",
    "contentType": "application/json",
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  try {
    Logger.log("⏳ Consultando...");
    Logger.log("Payload: " + JSON.stringify(param, null, 2));
    
    var response = UrlFetchApp.fetch(config.url, options);
    var data = JSON.parse(response.getContentText());
    
    Logger.log("\n📦 RESPOSTA:");
    Logger.log(JSON.stringify(data, null, 2));
    
    var registros = data[config.responseField] || [];
    Logger.log("\n📊 Registros encontrados: " + (Array.isArray(registros) ? registros.length : "0"));
    
    if (Array.isArray(registros) && registros.length > 0) {
      Logger.log("\n📋 PRIMEIRO REGISTRO:");
      Logger.log(JSON.stringify(registros[0], null, 2));
      
      Logger.log("\n✅ CAMPOS DISPONÍVEIS:");
      Object.keys(registros[0]).forEach(function(campo) {
        Logger.log("  - " + campo + ": " + typeof registros[0][campo]);
      });
    }
    
  } catch (e) {
    Logger.log("❌ ERRO: " + e.message);
  }
}

// ========================================
// ATALHOS DEBUG
// ========================================

function debugBandeiras() { debugCadastroAuxiliar("bandeiras"); }
function debugOrigens() { debugCadastroAuxiliar("origens"); }
function debugFinalidades() { debugCadastroAuxiliar("finalidades"); }
function debugDRE() { debugCadastroAuxiliar("dre"); }
function debugTiposCC() { debugCadastroAuxiliar("tiposcc"); }
function debugTiposDoc() { debugCadastroAuxiliar("tiposdoc"); }
function debugBancos() { debugCadastroAuxiliar("bancos"); }

// ========================================
// FUNÇÃO CORE: IMPORTAR CADASTRO
// ========================================

function importarCadastroAuxiliar(tipoCadastro) {
  var config = CONFIG_CADASTROS_AUX.cadastros[tipoCadastro];
  
  if (!config) {
    Logger.log("❌ Tipo inválido!");
    return;
  }
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(config.planilha);
  
  if (!sheet) {
    Logger.log("❌ Planilha '" + config.planilha + "' não encontrada!");
    Logger.log("Execute: criarTodasPlanilhasCadastros()");
    return;
  }

  Logger.log("=== 📥 IMPORTANDO: " + tipoCadastro.toUpperCase() + " ===");
  
  var todosRegistros = [];
  var pagina = 1;
  
  do {
    var param = {};
    
    // Copia parâmetros customizados
    if (config.paramCustom) {
      for (var key in config.paramCustom) {
        param[key] = config.paramCustom[key];
      }
    }
    
    if (config.usaPaginacao) {
      var nomesPaginacao = config.paramNome || { pagina: "nPagina", registros: "nRegPorPagina" };
      param[nomesPaginacao.pagina] = pagina;
      param[nomesPaginacao.registros] = 500;
    }
    
    var payload = {
      "call": config.call,
      "app_key": CONFIG_CADASTROS_AUX.appKey,
      "app_secret": CONFIG_CADASTROS_AUX.appSecret,
      "param": [param]
    };
    
    var options = {
      "method": "post",
      "contentType": "application/json",
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    try {
      var response = UrlFetchApp.fetch(config.url, options);
      var data = JSON.parse(response.getContentText());
      
      if (data.faultstring || data.status === "error") {
        Logger.log("❌ Erro API: " + (data.faultstring || data.message));
        break;
      }
      
      var registros = data[config.responseField] || [];
      
      if (!Array.isArray(registros) || registros.length === 0) break;
      
      todosRegistros = todosRegistros.concat(registros);
      
      if (pagina % 5 === 0) {
        Logger.log("📄 Página " + pagina + " | Total: " + todosRegistros.length);
      }
      
      if (!config.usaPaginacao) break;
      
      pagina++;
      
      if (registros.length < 500) break;
      
    } catch (e) {
      Logger.log("❌ ERRO: " + e.message);
      break;
    }
    
  } while (config.usaPaginacao);
  
  if (todosRegistros.length === 0) {
    Logger.log("⚠️ Nenhum registro encontrado");
    return;
  }
  
  // Limpa dados anteriores
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).clearContent();
  }
  
  // Prepara dados
  var dadosParaInserir = [];
  
  for (var i = 0; i < todosRegistros.length; i++) {
    var reg = todosRegistros[i];
    var linha = [];
    
    for (var j = 0; j < config.campos.length; j++) {
      var campo = config.campos[j];
      var valor = reg[campo] || "";
      linha.push(String(valor));
    }
    
    dadosParaInserir.push(linha);
  }
  
  // Insere dados
  if (dadosParaInserir.length > 0) {
    sheet.getRange(2, 1, dadosParaInserir.length, config.campos.length).setValues(dadosParaInserir);
    SpreadsheetApp.flush();
  }
  
  Logger.log("✅ Importados: " + dadosParaInserir.length + " registros");
}

// ========================================
// ATALHOS INDIVIDUAIS
// ========================================

function importarBandeiras() { importarCadastroAuxiliar("bandeiras"); }
function importarOrigens() { importarCadastroAuxiliar("origens"); }
function importarFinalidades() { importarCadastroAuxiliar("finalidades"); }
function importarDRE() { importarCadastroAuxiliar("dre"); }
function importarTiposCC() { importarCadastroAuxiliar("tiposcc"); }
function importarTiposDoc() { importarCadastroAuxiliar("tiposdoc"); }
function importarBancos() { importarCadastroAuxiliar("bancos"); }

// ========================================
// FUNÇÃO: IMPORTAR TODOS DE UMA VEZ
// ========================================

function importarTodosCadastrosAuxiliares() {
  Logger.log("=== 🚀 IMPORTANDO TODOS OS CADASTROS ===\n");
  
  var tipos = Object.keys(CONFIG_CADASTROS_AUX.cadastros);
  var sucesso = 0;
  var erros = 0;
  
  for (var i = 0; i < tipos.length; i++) {
    var tipo = tipos[i];
    try {
      importarCadastroAuxiliar(tipo);
      sucesso++;
    } catch (e) {
      Logger.log("❌ Erro em " + tipo + ": " + e.message);
      erros++;
    }
    Logger.log("");
  }
  
  Logger.log("\n=== ✅ FINALIZADO ===");
  Logger.log("Sucesso: " + sucesso + "/" + tipos.length);
  if (erros > 0) {
    Logger.log("Erros: " + erros);
  }
}

// ========================================
// FUNÇÃO: CRIAR TODAS AS PLANILHAS
// ========================================

function criarTodasPlanilhasCadastros() {
  Logger.log("=== 📋 CRIANDO PLANILHAS ===\n");
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tipos = Object.keys(CONFIG_CADASTROS_AUX.cadastros);
  var criadas = 0;
  
  for (var i = 0; i < tipos.length; i++) {
    var tipo = tipos[i];
    var config = CONFIG_CADASTROS_AUX.cadastros[tipo];
    
    var sheet = ss.getSheetByName(config.planilha);
    
    if (sheet) {
      Logger.log("⚠️ '" + config.planilha + "' já existe");
      continue;
    }
    
    sheet = ss.insertSheet(config.planilha);
    
    var cabecalho = config.campos;
    
    sheet.getRange(1, 1, 1, cabecalho.length).setValues([cabecalho]);
    sheet.getRange(1, 1, 1, cabecalho.length).setFontWeight("bold");
    sheet.getRange(1, 1, 1, cabecalho.length).setBackground("#607D8B");
    sheet.getRange(1, 1, 1, cabecalho.length).setFontColor("#FFFFFF");
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, cabecalho.length);
    
    Logger.log("✅ Criada: " + config.planilha);
    criadas++;
  }
  
  Logger.log("\n✅ CONCLUÍDO! Criadas: " + criadas + "/" + tipos.length);
}

// ========================================
// FUNÇÃO: VERIFICAR STATUS
// ========================================

function verificarStatusCadastros() {
  Logger.log("=== 📊 STATUS DOS CADASTROS ===\n");
  
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tipos = Object.keys(CONFIG_CADASTROS_AUX.cadastros);
  var totalRegistros = 0;
  
  for (var i = 0; i < tipos.length; i++) {
    var tipo = tipos[i];
    var config = CONFIG_CADASTROS_AUX.cadastros[tipo];
    var sheet = ss.getSheetByName(config.planilha);
    
    if (!sheet) {
      Logger.log("❌ " + config.planilha + ": Planilha não existe");
    } else {
      var registros = sheet.getLastRow() - 1;
      if (registros > 0) {
        Logger.log("✅ " + config.planilha + ": " + registros + " registros");
        totalRegistros += registros;
      } else {
        Logger.log("⚠️ " + config.planilha + ": Vazia");
      }
    }
  }
  
  Logger.log("\n📊 TOTAL GERAL: " + totalRegistros + " registros");
}

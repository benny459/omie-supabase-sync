// ========================================
// CONFIGURAÇÕES - TODAS AS EMPRESAS
// ========================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_CLIENTES_CONSOLIDADO = {
  url: "https://app.omie.com.br/api/v1/geral/clientes/",
  nomePlanilha: "Clientes",
  maxPaginas: 1000
};

// ========================================
// TIMESTAMP UTC-SAFE (CORRIGIDO)
// ========================================

function escreverStatusStampClientes(sheet, mensagem, ehSucesso) {
  var timezone = Session.getScriptTimeZone();
  var timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
  var statusTexto = ehSucesso ? "✅ SUCESSO" : "❌ ERRO";
  var mensagemCompleta = statusTexto + " - " + timestamp + ": " + mensagem;
  var celulaStatus = sheet.getRange("AN1");
  celulaStatus.setValue(mensagemCompleta);
  celulaStatus.setFontWeight("bold");
  if (ehSucesso) {
    celulaStatus.setBackground("#D9EAD3").setFontColor("#155724");
  } else {
    celulaStatus.setBackground("#F4CCCC").setFontColor("#721C24");
  }
  Logger.log("📝 Stamp: " + mensagemCompleta);
}

// ✅ CORRIGIDO: Salvar Unix timestamp (UTC universal)
function salvarTimestampUltimaSyncClientes() {
  var scriptProps = PropertiesService.getScriptProperties();
  var agora = new Date();
  var unixTime = agora.getTime(); // Milissegundos desde 1970 UTC
  scriptProps.setProperty('Clientes_UltimaSync_Unix', unixTime.toString());
  
  var timezone = Session.getScriptTimeZone();
  var displayTime = Utilities.formatDate(agora, timezone, "dd/MM/yyyy HH:mm:ss");
  Logger.log("💾 Timestamp salvo: " + displayTime + " (Unix: " + unixTime + ")");
  return unixTime;
}

// ✅ CORRIGIDO: Obter Unix timestamp
function obterTimestampUltimaSyncClientes() {
  var scriptProps = PropertiesService.getScriptProperties();
  var unixTime = scriptProps.getProperty('Clientes_UltimaSync_Unix');
  if (unixTime) {
    var data = new Date(parseInt(unixTime));
    var timezone = Session.getScriptTimeZone();
    var displayTime = Utilities.formatDate(data, timezone, "dd/MM/yyyy HH:mm:ss");
    Logger.log("📅 Última sync: " + displayTime);
    return parseInt(unixTime);
  }
  Logger.log("📅 Primeira execução - sem timestamp anterior");
  return null;
}

// ✅ CORRIGIDO: Comparação UTC-safe
function clienteModificadoAposUltimaSync(cliente, timestampUltimaSync) {
  if (!timestampUltimaSync) return true; // Primeira execução
  
  var info = cliente.info || {};
  var dataAlt = info.dAlt || "";
  var horaAlt = info.hAlt || "";
  
  if (!dataAlt) return true; // Sem data de alteração = considerar modificado
  
  // Converter data Omie (sempre GMT-3 Brasil) para Unix timestamp
  // Formato: "09/12/2025" + "14:30:00"
  var partesData = dataAlt.split("/");
  var partesHora = (horaAlt || "00:00:00").split(":");
  
  // Criar Date em UTC e ajustar para GMT-3 (Brasil)
  var dataAltCliente = Date.UTC(
    parseInt(partesData[2]),      // ano
    parseInt(partesData[1]) - 1,  // mês (0-based)
    parseInt(partesData[0]),      // dia
    parseInt(partesHora[0] || 0), // hora
    parseInt(partesHora[1] || 0), // minuto
    parseInt(partesHora[2] || 0)  // segundo
  );
  
  // Ajustar de UTC para GMT-3 (adicionar 3 horas em milissegundos)
  dataAltCliente = dataAltCliente + (3 * 60 * 60 * 1000);
  
  // Comparar timestamps Unix (ambos em UTC agora)
  return dataAltCliente > timestampUltimaSync;
}

// ========================================
// FUNÇÕES AUXILIARES
// ========================================

function verificarTempoExecucaoClientes(horaInicio, limiteSegundos) {
  limiteSegundos = limiteSegundos || 330;
  var tempoDecorrido = (new Date().getTime() - horaInicio) / 1000;
  if (tempoDecorrido > limiteSegundos) {
    Logger.log("⏱️ Tempo limite: " + tempoDecorrido.toFixed(2) + "s");
    return false;
  }
  return true;
}

function limparPlanilhaCompletaClientes(sheet) {
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
  sheet.getRange("B:B").setNumberFormat("@");
  Logger.log("✓ Col B TEXTO");
}

function carregarIndicePorBatchesClientes(sheet) {
  var lastRow = sheet.getLastRow();
  var mapa = new Map();
  if (lastRow <= 1) return mapa;
  
  var BATCH_SIZE = 10000;
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
      if (inicio <= lastRow) Utilities.sleep(30);
    } catch (e) {
      Logger.log("❌ Erro batch: " + e.message);
      break;
    }
  }
  Logger.log("✅ Índice: " + mapa.size + " únicos");
  return mapa;
}

function inserirDadosComRetryClientes(sheet, dados) {
  if (!dados || dados.length === 0) return true;
  
  var MAX_TENTATIVAS = 3;
  var tentativa = 0;
  
  while (tentativa < MAX_TENTATIVAS) {
    try {
      Logger.log("📝 Inserindo " + dados.length + " (tent " + (tentativa + 1) + ")");
      var primeiraLinha = sheet.getLastRow() + 1;
      sheet.getRange(primeiraLinha, 1, dados.length, 39).setValues(dados);
      SpreadsheetApp.flush();
      Logger.log("✅ Inserido");
      return true;
    } catch (e) {
      tentativa++;
      Logger.log("❌ Erro inserção (tent " + tentativa + "): " + e.message);
      if (tentativa < MAX_TENTATIVAS) {
        Utilities.sleep(1000 * tentativa);
      } else {
        return false;
      }
    }
  }
  return false;
}

function validarIntegridadeDadosClientes(sheet, empresas) {
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
  
  for (var i = 0; i < empresas.length; i++) contagem[empresas[i]] = 0;
  
  for (var i = 0; i < dados.length; i++) {
    var empresa = String(dados[i][0] || "").trim();
    var codigo = String(dados[i][1] || "").trim();
    if (contagem.hasOwnProperty(empresa)) contagem[empresa]++;
    if (empresa && codigo) {
      var chave = empresa + "|" + codigo;
      if (codigosUnicos.has(chave)) duplicatas++;
      else codigosUnicos.set(chave, true);
    }
  }
  
  Logger.log("\n📊 Por empresa:");
  for (var emp in contagem) Logger.log("  " + emp + ": " + contagem[emp]);
  Logger.log("\nResumo: Total " + (lastRow - 1) + ", Únicos " + codigosUnicos.size);
  if (duplicatas > 0) Logger.log("⚠️ " + duplicatas + " dups!");
  else Logger.log("✅ Sem dups");
}

// ========================================
// ✅ ATUALIZAR CLIENTES (CORRIGIDO)
// ========================================

function atualizarClientesOmie() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CLIENTES_CONSOLIDADO.nomePlanilha);
  
  if (!sheet) {
    Logger.log("❌ Planilha não encontrada!");
    return;
  }
  
  var sucesso = true;
  var erroDetalhe = "";
  var novosTotal = 0;
  var atualizadosTotal = 0;
  var ignoradosTotal = 0;
  
  try {
    Logger.log("=== SINCRONIZAÇÃO CLIENTES ===");
    
    var timestampUltimaSync = obterTimestampUltimaSyncClientes();
    
    sheet.getRange("B:B").setNumberFormat("@");
    var mapaCodigosLinhas = carregarIndicePorBatchesClientes(sheet);
    var dadosNovos = [];
    var empresas = Object.keys(EMPRESAS_OMIE);
    
    for (var e = 0; e < empresas.length; e++) {
      var sigla = empresas[e];
      var empresa = EMPRESAS_OMIE[sigla];
      Logger.log("\n📊 Sincronizando: " + sigla);
      
      var pagina = 1;
      var totalPaginas = 1;
      var novosEmpresa = 0;
      var atualizadosEmpresa = 0;
      var ignoradosEmpresa = 0;
      
      do {
        if (!verificarTempoExecucaoClientes(horaInicio, 330)) {
          Logger.log("⏱️ Tempo limite");
          break;
        }
        
        var payload = {
          "call": "ListarClientes",
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
          "payload": JSON.stringify(payload),
          "muteHttpExceptions": true
        };
        
        try {
          var response = UrlFetchApp.fetch(CONFIG_CLIENTES_CONSOLIDADO.url, options);
          var httpCode = response.getResponseCode();
          
          if (httpCode !== 200) {
            Logger.log("❌ HTTP " + httpCode + " p" + pagina);
            pagina++;
            Utilities.sleep(2000);
            continue;
          }
          
          var data = JSON.parse(response.getContentText());
          
          if (!data || data.faultstring) {
            Logger.log("❌ Erro API: " + (data.faultstring || "desconhecido"));
            pagina++;
            continue;
          }
          
          totalPaginas = data.total_de_paginas || 1;
          var clientes = data.clientes_cadastro || [];
          
          if (clientes.length === 0) break;
          
          for (var i = 0; i < clientes.length; i++) {
            var c = clientes[i];
            var codigoStr = String(c.codigo_cliente_omie || "").trim();
            if (!codigoStr) continue;
            
            var chaveUnica = sigla + "|" + codigoStr;
            var info = c.info || {};
            var tags = Array.isArray(c.tags) ? c.tags.map(function(t) { return t.tag || t; }).join(", ") : "";
            var row = [
              sigla, String(c.codigo_cliente_omie || ""), String(c.codigo_cliente_integracao || ""),
              c.razao_social || "", c.nome_fantasia || "", c.cnpj_cpf || "",
              c.contato || "", c.endereco || "", c.endereco_numero || "",
              c.complemento || "", c.bairro || "", c.cidade || "",
              c.estado || "", c.cep || "", c.telefone1_ddd || "",
              c.telefone1_numero || "", c.telefone2_ddd || "", c.telefone2_numero || "",
              c.fax_ddd || "", c.fax_numero || "", c.email || "",
              c.homepage || "", c.inscricao_estadual || "", c.inscricao_municipal || "",
              c.inscricao_suframa || "", c.pessoa_fisica || "", c.optante_simples_nacional || "",
              c.contribuinte || "", c.produtor_rural || "", c.inativo || "",
              c.importado_api || "", c.cidade_ibge || "", tags,
              info.dInc || "", info.hInc || "", info.uInc || "",
              info.dAlt || "", info.hAlt || "", info.uAlt || ""
            ];
            
            if (mapaCodigosLinhas.has(chaveUnica)) {
              // Cliente existe - verificar se foi modificado
              var foiModificado = clienteModificadoAposUltimaSync(c, timestampUltimaSync);
              if (foiModificado) {
                var linha = mapaCodigosLinhas.get(chaveUnica);
                sheet.getRange(linha, 1, 1, 39).setValues([row]);
                atualizadosEmpresa++;
              } else {
                ignoradosEmpresa++;
              }
            } else {
              // Cliente novo
              dadosNovos.push(row);
              novosEmpresa++;
            }
          }
          
          Logger.log("P" + pagina + "/" + totalPaginas + 
                    " - Novos: " + novosEmpresa + 
                    " | Atual: " + atualizadosEmpresa + 
                    " | Ignor: " + ignoradosEmpresa);
          
          pagina++;
          Utilities.sleep(50);
          
        } catch (erro) {
          Logger.log("❌ Erro p" + pagina + ": " + erro.message);
          pagina++;
          Utilities.sleep(2000);
        }
        
      } while (pagina <= totalPaginas); // ✅ CORRIGIDO: Varre TODAS as páginas
      
      Logger.log("✅ " + sigla + " - Novos: " + novosEmpresa + 
                " | Atual: " + atualizadosEmpresa + 
                " | Ignor: " + ignoradosEmpresa);
      
      novosTotal += novosEmpresa;
      atualizadosTotal += atualizadosEmpresa;
      ignoradosTotal += ignoradosEmpresa;
      
      if (e < empresas.length - 1) Utilities.sleep(500);
    }
    
    // Inserir novos
    if (dadosNovos.length > 0) {
      if (!inserirDadosComRetryClientes(sheet, dadosNovos)) {
        sucesso = false;
        erroDetalhe = "Falha lote final";
      }
    }
    
    Logger.log("\n=== ✅ FINALIZADO ===");
    Logger.log("🆕 Novos: " + novosTotal);
    Logger.log("🔄 Atual: " + atualizadosTotal);
    Logger.log("⏭️  Ignor: " + ignoradosTotal);
    Logger.log("📊 Total: " + (sheet.getLastRow() - 1));
    
    validarIntegridadeDadosClientes(sheet, Object.keys(EMPRESAS_OMIE));
    
    if (sucesso) {
      salvarTimestampUltimaSyncClientes();
      escreverStatusStampClientes(sheet, 
        "Sync completa. Novos: " + novosTotal + 
        ", Atual: " + atualizadosTotal + 
        ", Ignor: " + ignoradosTotal, 
        true);
    } else {
      escreverStatusStampClientes(sheet, 
        "Falha sync: " + erroDetalhe, 
        false);
    }
    
  } catch (erroGeral) {
    Logger.log("❌ Erro geral: " + erroGeral.message);
    escreverStatusStampClientes(sheet, "Erro geral: " + erroGeral.message, false);
  }
}
/**
 * FUNÇÃO DE TESTE - Extrai dados completos de 1 cliente da API Omie
 * e exibe no Logger. Não altera nenhuma planilha.
 * Execute pelo menu: Executar > testarCamposCliente
 */
function testarCamposCliente() {
  // Usa a primeira empresa configurada como teste (SF)
  var empresa = EMPRESAS_OMIE["SF"]; // Mude para "CD" ou "WW" se preferir

  var url = "https://app.omie.com.br/api/v1/geral/clientes/";

  var payload = {
    call: "ListarClientes",
    app_key: empresa.appKey,
    app_secret: empresa.appSecret,
    param: [{
      pagina: 1,
      registros_por_pagina: 1,  // Apenas 1 cliente para inspecionar
      apenas_importado_api: "N",
      exibir_caracteristicas: "S"
    }]
  };

  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var data = JSON.parse(response.getContentText());

    if (data.faultstring) {
      Logger.log("❌ ERRO DA API: " + data.faultstring);
      return;
    }

    var clientes = data.clientes_cadastro;
    if (!clientes || clientes.length === 0) {
      Logger.log("⚠️ Nenhum cliente retornado.");
      return;
    }

    var c = clientes[0];

    Logger.log("========== CAMPOS RETORNADOS PELA API OMIE ==========");
    Logger.log("🏢 Razão Social:     " + c.razao_social);
    Logger.log("🏷️ Nome Fantasia:    " + c.nome_fantasia);
    Logger.log("📄 CNPJ/CPF:         " + c.cnpj_cpf);
    Logger.log("📧 Email:            " + c.email);
    Logger.log("📱 Telefone:         " + (c.telefone1_ddd || "") + " " + (c.telefone1_numero || ""));
    Logger.log("🏙️ Cidade:           " + c.cidade);
    Logger.log("🗺️ Estado (UF):      " + c.estado);
    Logger.log("📮 CEP:              " + c.cep);
    Logger.log("📍 Endereço:         " + c.endereco + ", " + c.endereco_numero);
    Logger.log("🏘️ Bairro:           " + c.bairro);
    Logger.log("🌎 País:             " + c.pais);
    Logger.log("🔢 Insc. Estadual:   " + c.inscricao_estadual);
    Logger.log("🔢 Insc. Municipal:  " + c.inscricao_municipal);
    Logger.log("🏦 Contato:          " + c.contato);
    Logger.log("📊 Código CNAE:      " + c.cnae);
    Logger.log("👤 Vendedor (cód):   " + c.codigo_vendedor);
    Logger.log("🆔 Cód. Omie:        " + c.codigo_cliente_omie);
    Logger.log("🔗 Cód. Integração:  " + c.codigo_cliente_integracao);
    Logger.log("📅 Inativo:          " + c.inativo);
    Logger.log("🏷️ Tags:             " + JSON.stringify(c.tags));

    Logger.log("\n--- OBJETO COMPLETO (raw JSON) ---");
    Logger.log(JSON.stringify(c, null, 2));

  } catch (e) {
    Logger.log("❌ Exceção: " + e.toString());
  }
}


// Manter as outras funções (recriaBaseCompletaClientesOmie, importarNovosClientesOmie) sem alterações

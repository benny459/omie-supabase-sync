// ========================================
// 1. CONFIGURAÇÕES GERAIS
// ========================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_CONTAS_PAGAR_CONSOLIDADO = {
  url: "https://app.omie.com.br/api/v1/financas/contapagar/",
  nomePlanilha: "ContasPagar",
  maxPaginas: 1000,
  paginasPorExecucao: 100,
  diasParaAtraso: 30,
  dataVencimentoInicio: "01/01/2025",
  dataVencimentoFim: "31/12/2027",
  tentativasRetry: 3,
  delayEntreRetry: 20,
  delayAposErroTotal: 10
};

var WEBEX_CONFIG_SEQ = {
  URL: "https://webexapis.com/v1/messages",
  TOKEN: "MTRjZjFkODgtN2JiOS00OTljLWI4NzQtMjY3NTE0MmIzZWI1YmM1NTk1MTctMWVl_P0A1_f71b3b0c-41aa-4432-a8ec-0fba0a4e36ad",
  ROOM_ID: "Y2lzY29zcGFyazovL3VybjpURUFNOnVzLXdlc3QtMl9yL1JPT00vNDE5NmYyYjAtMDAxOS0xMWYxLThhZTktZDUwZjlkMjk2NTg4"
};

// [NOVO] Configuração do BigQuery
var BIGQUERY_CONFIG = {
  projectId: 'dashboard-gerencial-489115',
  datasetId: 'meus_dados',
  // Lista de abas para sincronizar no final da rotina financeira
  abas: ['Pagar_Flow', 'Receber_Flow', 'Lançamentos_Consolidados', 'ContasPagar_Consolidada', 'ContasReceber_Consolidada']
};


// ========================================
// 2. FUNÇÃO SEQUENCIAL FINANCEIRA (COM WEBEX + BIGQUERY)
// ========================================

function executarSequenciaFinanceira() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  var stats = []; 
  var horaInicioTotal = new Date().getTime();
  const TITULO_RELATORIO = "Relatório Finance : Diário Master";

  try {
    // Limpeza de Estado
    limparEstadoRetomadaCPAtualiza();
    removerTriggersRetomadaCPAtualiza();
    try { limparEstadoRetomadaCRAtualiza(); removerTriggersRetomadaCRAtualiza(); } catch (e) {}
    try { limparEstadoRetomadaExtratoAtualiza(); removerTriggersRetomadaExtratoAtualiza(); } catch (e) {}
    
    // Definição das Etapas
    const funcoes = [
      { nome: "atualizarContasPagar_Simples", fn: atualizarContasPagar_Simples, aguardar: true },
      { nome: "atualizarContasReceber_Simples", fn: atualizarContasReceber_Simples, aguardar: true },
      { nome: "atualizarExtratoCC_ComRetomada", fn: atualizarExtratoCC_ComRetomada, aguardar: true },
      { nome: "atualizarPagarFlow", fn: atualizarPagarFlow, aguardar: false },
      { nome: "atualizarReceberFlow", fn: atualizarReceberFlow, aguardar: false },
      { nome: "atualizarLancamentosCC", fn: atualizarLancamentosCC, aguardar: false },
      { nome: "copiarFormatacaoContasPagar", fn: copiarFormatacaoContasPagar, aguardar: false },
      // [NOVO] Adicionado BigQuery como etapa final oficial
      { nome: "☁️ Enviar p/ BigQuery", fn: enviarParaBigQuery, aguardar: false }
    ];
    
    // Loop de Execução
    for (let i = 0; i < funcoes.length; i++) {
      const percentual = Math.round(((i + 1) / funcoes.length) * 100);
      ss.toast(funcoes[i].nome + '...', `⏳ ${percentual}%`, -1);
      
      Logger.log(`\n=== EXECUTANDO: ${funcoes[i].nome} ===`);
      const tIni = new Date().getTime();
      
      try {
        funcoes[i].fn();
        const tempo = ((new Date().getTime() - tIni) / 1000).toFixed(1);
        Logger.log(`✅ Sucesso (${tempo}s)`);
        stats.push({ etapa: funcoes[i].nome, status: "✅ Sucesso", tempo: tempo + "s" });
      } catch (e) {
        const tempo = ((new Date().getTime() - tIni) / 1000).toFixed(1);
        stats.push({ etapa: funcoes[i].nome, status: "❌ Erro", tempo: tempo + "s" });
        Logger.log(`❌ ERRO: ${e.message}`);
        enviarRelatorioWebexInterno(stats, horaInicioTotal, "❌ Falha na Execução", TITULO_RELATORIO);
        throw e;
      }
      
      SpreadsheetApp.flush();
      
      // Verificação de Retomada Automática
      if (funcoes[i].aguardar) {
        Utilities.sleep(10000); // Pausa para estabilizar
        const triggers = ScriptApp.getProjectTriggers();
        const pendente = triggers.some(t => t.getHandlerFunction() === funcoes[i].nome);
        
        if (pendente) {
          stats.push({ etapa: "Verificação Retomada", status: "⏳ Pausado", tempo: "-" });
          enviarRelatorioWebexInterno(stats, horaInicioTotal, "⚠️ Sequência Pausada (Retomada)", TITULO_RELATORIO);
          return;
        }
      }
    }
    
    Logger.log("\n✅ SEQUÊNCIA FINANCEIRA FINALIZADA");
    ss.toast("Finalizado com Sucesso!", "🏁", 5);
    enviarRelatorioWebexInterno(stats, horaInicioTotal, "✅ Concluído com Sucesso", TITULO_RELATORIO);
    
  } catch (erro) {
    Logger.log("❌ ERRO FATAL: " + erro.stack);
    // Webex de erro já enviado dentro do catch do loop se falhar lá
    if (stats.length === 0 || stats[stats.length-1].status !== "❌ Erro") {
        enviarRelatorioWebexInterno(stats, horaInicioTotal, "❌ Erro Crítico: " + erro.message, TITULO_RELATORIO);
    }
    throw erro;
  }
}


// ========================================
// 3. FUNÇÃO SEQUENCIAL CADASTROS (COM WEBEX)
// ========================================

function executarSequenciaCadastros() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  var stats = []; 
  var horaInicioTotal = new Date().getTime();
  const TITULO_RELATORIO = "Relatório Cadastros : Sequência Master";

  try {
    const funcoes = [
      { nome: "atualizarClientesOmie", fn: atualizarClientesOmie, aguardar: false },
      { nome: "recriaBaseCompletaCategoriasOmie", fn: recriaBaseCompletaCategoriasOmie, aguardar: false },
      { nome: "importarTodosCadastrosAuxiliares", fn: importarTodosCadastrosAuxiliares, aguardar: false },
      { nome: "atualizarPesquisaTitulos_ComRetomada", fn: atualizarPesquisaTitulos_ComRetomada, aguardar: false },
      { nome: "importarTodosProjetosOMIE", fn: importarTodosProjetosOMIE, aguardar: false }
    ];
    
    for (let i = 0; i < funcoes.length; i++) {
      const percentual = Math.round(((i + 1) / funcoes.length) * 100);
      ss.toast(funcoes[i].nome + '...', `⏳ ${percentual}%`, -1);
      Logger.log(`\n=== EXECUTANDO: ${funcoes[i].nome} ===`);
      
      const tIni = new Date().getTime();
      try {
        funcoes[i].fn();
        const tempo = ((new Date().getTime() - tIni) / 1000).toFixed(1);
        Logger.log(`✅ Sucesso (${tempo}s)`);
        stats.push({ etapa: funcoes[i].nome, status: "✅ Sucesso", tempo: tempo + "s" });
      } catch (e) {
        const tempo = ((new Date().getTime() - tIni) / 1000).toFixed(1);
        stats.push({ etapa: funcoes[i].nome, status: "❌ Erro", tempo: tempo + "s" });
        Logger.log(`❌ ERRO: ${e.message}`);
        enviarRelatorioWebexInterno(stats, horaInicioTotal, "❌ Falha na Execução", TITULO_RELATORIO);
        throw e;
      }
      SpreadsheetApp.flush();
      if (i < funcoes.length - 1) Utilities.sleep(3000);
    }
    
    Logger.log("\n✅ SEQUÊNCIA CADASTROS FINALIZADA");
    ss.toast("Finalizado com Sucesso!", "🏁", 5);
    enviarRelatorioWebexInterno(stats, horaInicioTotal, "✅ Concluído com Sucesso", TITULO_RELATORIO);

  } catch (erro) {
    Logger.log("❌ ERRO FATAL: " + erro.stack);
    if (stats.length === 0 || stats[stats.length-1].status !== "❌ Erro") {
        enviarRelatorioWebexInterno(stats, horaInicioTotal, "❌ Erro Crítico: " + erro.message, TITULO_RELATORIO);
    }
    throw erro;
  }
}


// ========================================
// 4. FUNÇÃO AUXILIAR DE ENVIO WEBEX
// ========================================

function enviarRelatorioWebexInterno(stats, startTime, statusGeral, titulo) {
  try {
    const totalDuration = ((new Date().getTime() - startTime) / 1000 / 60).toFixed(1) + ' min';
    
    let msg = `### 🤖 ${titulo}\n`;
    msg += `**Status:** ${statusGeral}\n`;
    msg += `**Duração:** ${totalDuration}\n\n`;
    
    stats.forEach(s => {
      let cleanName = s.etapa
        .replace('atualizar', '')
        .replace('importarTodos', '')
        .replace('recriaBaseCompleta', 'Recria ')
        .replace('_Simples', '')
        .replace('_ComRetomada', '')
        .replace('copiarFormatacao', 'Format ')
        .replace('Omie', '')
        .replace('Enviar p/ BigQuery', 'BigQuery Sync')
        .substring(0, 25);
      msg += `| ${cleanName} | ${s.status} | ${s.tempo} |\n`;
    });

    const payload = { "roomId": WEBEX_CONFIG_SEQ.ROOM_ID, "markdown": msg };
    const options = {
      "method": "post",
      "headers": { "Authorization": `Bearer ${WEBEX_CONFIG_SEQ.TOKEN}`, "Content-Type": "application/json" },
      "payload": JSON.stringify(payload),
      "muteHttpExceptions": true
    };

    UrlFetchApp.fetch(WEBEX_CONFIG_SEQ.URL, options);
    Logger.log("📧 Relatório Webex enviado.");
  } catch (e) {
    Logger.log("❌ Erro ao enviar Webex: " + e.message);
  }
}


// ========================================
// 5. LÓGICA CORE - CONTAS A PAGAR (COM RETOMADA)
// ========================================

function atualizarContasPagar_ComRetomada() {
  var horaInicio = new Date().getTime();
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_CONTAS_PAGAR_CONSOLIDADO.nomePlanilha);
  if (!sheet) return;
  
  var props = PropertiesService.getScriptProperties();
  var dias = CONFIG_CONTAS_PAGAR_CONSOLIDADO.diasParaAtraso;
  var datas = calcularDatasAtraso(dias);
  
  var empresaAtual = props.getProperty('CPAtualiza_empresaAtual') || 'SF';
  var paginaAtual = parseInt(props.getProperty('CPAtualiza_paginaAtual') || '1');
  var novos = parseInt(props.getProperty('CPAtualiza_novos') || '0');
  var atualizados = parseInt(props.getProperty('CPAtualiza_atualizados') || '0');
  var erroCons = parseInt(props.getProperty('CPAtualiza_errosConsecutivos') || '0');
  
  sheet.getRange("B:B").setNumberFormat("@");
  var mapaIndex = carregarIndicePorBatchesCP(sheet);
  var empresas = Object.keys(EMPRESAS_OMIE);
  var idxEmpresa = empresas.indexOf(empresaAtual);
  if (idxEmpresa === -1) { limparEstadoRetomadaCPAtualiza(); return; }
  
  var dadosBuffer = [];
  var MAX_TIME = 270000; // 4.5 min
  
  for (var e = idxEmpresa; e < empresas.length; e++) {
    var sigla = empresas[e];
    var emp = EMPRESAS_OMIE[sigla];
    var p = (sigla === empresaAtual) ? paginaAtual : 1;
    var totalP = 1;
    
    do {
      if ((new Date().getTime() - horaInicio) > MAX_TIME) {
        salvarEstadoCP(sigla, p, novos, atualizados, erroCons);
        criarTriggerRetomadaCPAtualiza(1);
        return;
      }
      
      var res = fetchOmieCP(emp, p, datas.inicio, datas.fim);
      if (!res.sucesso) {
        erroCons++;
        if (erroCons >= 3) {
          salvarEstadoCP(sigla, p, novos, atualizados, erroCons);
          criarTriggerRetomadaCPAtualiza(CONFIG_CONTAS_PAGAR_CONSOLIDADO.delayAposErroTotal);
          return;
        }
        p++; continue;
      }
      erroCons = 0;
      totalP = res.total_de_paginas;
      
      var lista = res.conta_pagar_cadastro || [];
      for (var i = 0; i < lista.length; i++) {
        var item = lista[i];
        if (item.data_vencimento < CONFIG_CONTAS_PAGAR_CONSOLIDADO.dataVencimentoInicio) continue;
        
        var row = montarLinhaCP(item, sigla);
        var chave = sigla + "|" + String(item.codigo_lancamento_omie);
        
        if (mapaIndex.has(chave)) {
          sheet.getRange(mapaIndex.get(chave), 1, 1, 40).setValues([row]);
          atualizados++;
        } else {
          dadosBuffer.push(row);
          novos++;
        }
      }
      
      if (dadosBuffer.length >= 500) {
        inserirDadosComRetryCP(sheet, dadosBuffer);
        dadosBuffer = [];
      }
      p++;
    } while (p <= totalP);
    paginaAtual = 1;
  }
  
  if (dadosBuffer.length > 0) inserirDadosComRetryCP(sheet, dadosBuffer);
  
  limparEstadoRetomadaCPAtualiza();
  removerTriggersRetomadaCPAtualiza();
  escreverStatusStamp(sheet, `Sync Ok. Novos: ${novos}, Atual: ${atualizados}`, true);
}

function fetchOmieCP(empresa, pag, dataDe, dataAte) {
  var payload = {
    "call": "ListarContasPagar",
    "app_key": empresa.appKey,
    "app_secret": empresa.appSecret,
    "param": [{"pagina": pag, "registros_por_pagina": 100, "filtrar_por_data_de": dataDe, "filtrar_por_data_ate": dataAte}]
  };
  try {
    var resp = UrlFetchApp.fetch(CONFIG_CONTAS_PAGAR_CONSOLIDADO.url, {
      method: "post", contentType: "application/json", payload: JSON.stringify(payload), muteHttpExceptions: true
    });
    if (resp.getResponseCode() === 200) {
      var json = JSON.parse(resp.getContentText());
      json.sucesso = true;
      return json;
    }
  } catch (e) {}
  return { sucesso: false };
}

function montarLinhaCP(c, sigla) {
  var cats = Array.isArray(c.categorias) ? c.categorias.map(function(x){return x.codigo_categoria}).join(",") : "";
  var i = c.info || {};
  return [
    sigla, String(c.codigo_lancamento_omie||""), String(c.codigo_lancamento_integracao||""), String(c.codigo_cliente_fornecedor||""),
    c.data_vencimento, c.data_previsao, c.valor_documento, c.valor_pago,
    c.codigo_categoria, cats, c.id_conta_corrente,
    c.numero_documento_fiscal, c.data_emissao, c.data_entrada, c.codigo_projeto,
    c.numero_pedido, c.numero_documento, c.numero_parcela, c.chave_nfe,
    c.status_titulo, c.id_origem, c.observacao,
    c.valor_pis, c.retem_pis, c.valor_cofins, c.retem_cofins,
    c.valor_csll, c.retem_csll, c.valor_ir, c.retem_ir,
    c.valor_iss, c.retem_iss, c.valor_inss, c.retem_inss,
    i.dInc, i.hInc, i.uInc, i.dAlt, i.hAlt, i.uAlt
  ];
}

function salvarEstadoCP(emp, pag, n, a, e) {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('CPAtualiza_empresaAtual', emp);
  p.setProperty('CPAtualiza_paginaAtual', String(pag));
  p.setProperty('CPAtualiza_novos', String(n));
  p.setProperty('CPAtualiza_atualizados', String(a));
  p.setProperty('CPAtualiza_errosConsecutivos', String(e));
}


// ========================================
// 6. FUNÇÕES AUXILIARES, TRIGGERS E FORMAT
// ========================================

function copiarFormatacaoContasPagar() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheetOrigem = ss.getSheetByName("ContasPagar");
    var sheetTarget = ss.getSheetByName("ContasPagar_Consolidada");
    if (!sheetOrigem || !sheetTarget) return;
    
    Utilities.sleep(2000); SpreadsheetApp.flush();
    var lastRow = sheetOrigem.getLastRow();
    if (lastRow < 1) return;
    
    sheetOrigem.getRange(1, 1, lastRow, 40).copyTo(
      sheetTarget.getRange(1, 1, Math.max(lastRow, sheetTarget.getLastRow()), 40), 
      {formatOnly: true}
    );
    for(var c=1; c<=40; c++) sheetTarget.setColumnWidth(c, sheetOrigem.getColumnWidth(c));
    SpreadsheetApp.flush();
  } catch (e) { Logger.log("Format Error: " + e.message); }
}

function calcularDatasAtraso(dias) {
  var h = new Date(); var ini = new Date(h.getTime() - (dias*86400000));
  var f = "dd/MM/yyyy"; var tz = Session.getScriptTimeZone();
  return { inicio: Utilities.formatDate(ini, tz, f), fim: Utilities.formatDate(h, tz, f) };
}

function carregarIndicePorBatchesCP(sheet) {
  var last = sheet.getLastRow(); var map = new Map();
  if (last <= 1) return map;
  var batch = 5000; var ini = 2;
  while (ini <= last) {
    var fim = Math.min(ini + batch - 1, last);
    var vals = sheet.getRange(ini, 1, fim-ini+1, 2).getValues();
    for (var i=0; i<vals.length; i++) if(vals[i][0] && vals[i][1]) map.set(String(vals[i][0]).trim()+"|"+String(vals[i][1]).trim(), ini+i);
    ini = fim+1;
  }
  return map;
}

function inserirDadosComRetryCP(sheet, dados) {
  if (!dados || !dados.length) return true;
  try {
    sheet.getRange(sheet.getLastRow()+1, 1, dados.length, 40).setValues(dados);
    SpreadsheetApp.flush();
    return true;
  } catch (e) {
    salvarDadosPerdidosCP(dados);
    return false;
  }
}

function salvarDadosPerdidosCP(d) {
  try {
    var p = PropertiesService.getScriptProperties(); var k = 'DadosPerdidos_CP_' + new Date().getTime();
    var j = JSON.stringify(d); var c = Math.ceil(j.length/8000);
    for(var i=0;i<c;i++) p.setProperty(k+'_chunk_'+i, j.substring(i*8000, (i+1)*8000));
    p.setProperty(k+'_numChunks', String(c));
  } catch(e){}
}

function escreverStatusStamp(sheet, msg, success) {
  var r = sheet.getRange("AO1");
  r.setValue((success?"✅":"❌") + " " + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM HH:mm") + ": " + msg);
  r.setBackground(success?"#D9EAD3":"#F4CCCC");
}

// Gerenciadores de Estado
function criarTriggerRetomadaCPAtualiza(m) { removerTriggersRetomadaCPAtualiza(); ScriptApp.newTrigger('atualizarContasPagar_ComRetomada').timeBased().after(m*60*1000).create(); }
function removerTriggersRetomadaCPAtualiza() { var t=ScriptApp.getProjectTriggers(); for(var i=0;i<t.length;i++) if(t[i].getHandlerFunction()==='atualizarContasPagar_ComRetomada') ScriptApp.deleteTrigger(t[i]); }
function limparEstadoRetomadaCPAtualiza() { var p=PropertiesService.getScriptProperties(); ['empresaAtual','paginaAtual','novos','atualizados','errosConsecutivos'].forEach(k=>p.deleteProperty('CPAtualiza_'+k)); }

// Placeholders para evitar erros de referência
function limparEstadoRetomadaCRAtualiza(){} 
function removerTriggersRetomadaCRAtualiza(){}
function limparEstadoRetomadaExtratoAtualiza(){}
function removerTriggersRetomadaExtratoAtualiza(){}
function criarPlanilhaContasPagar(){ Logger.log("Criar via Menu."); }
function diagnosticarEstadoRetomada(){ Logger.log("Diagnóstico via Menu."); }
function listarDadosPerdidosCP(){ Logger.log("Listar via Menu."); }
function recuperarDadosPerdidosCP(k){ Logger.log("Recuperar via Menu."); }
function resetarRetomadaCPAtualiza(){ limparEstadoRetomadaCPAtualiza(); removerTriggersRetomadaCPAtualiza(); }

// ========================================
// 7. [NOVO] INTEGRAÇÃO BIGQUERY TURBO (API SHEETS)
// ========================================

function enviarParaBigQuery() {
  const projectId = BIGQUERY_CONFIG.projectId; 
  const datasetId = BIGQUERY_CONFIG.datasetId;
  const abasParaSincronizar = BIGQUERY_CONFIG.abas;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ssId = ss.getId();

  abasParaSincronizar.forEach(function(nomeDaAba) {
    // 1. LEITURA RÁPIDA (API SHEETS)
    let values;
    try {
      const range = Sheets.Spreadsheets.Values.get(ssId, nomeDaAba);
      values = range.values;
    } catch (e) {
      Logger.log('AVISO: Aba não encontrada ou vazia: ' + nomeDaAba);
      return;
    }

    if (!values || values.length < 2) return;

    const data = values;

    // 2. TRATAMENTO DE CABEÇALHOS
    let headers = data[0].map(h => (h ? h.toString().trim() : ""));
    let counts = {};

    headers = headers.map(function(h, index) {
      let cleanName = h ? h.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_]/g, "_") : `coluna_${index}`;
      if (counts[cleanName]) {
        counts[cleanName]++;
        cleanName = `${cleanName}_${counts[cleanName]}`;
      } else {
        counts[cleanName] = 1;
      }
      return cleanName;
    });

    // 3. PREPARAÇÃO CSV
    let tableId = nomeDaAba.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
                           .replace(/\s+/g, "_")
                           .replace(/[^a-zA-Z0-9_]/g, "");

    const rows = data.slice(1);
    let csvContent = headers.join(",") + "\n"; 

    const csvRows = rows.map(row => 
      row.map(cell => {
        if (cell === null || cell === undefined) return "";
        let stringCell = cell.toString();
        stringCell = stringCell.replace(/"/g, "'"); 
        if (stringCell.search(/("|,|\n)/g) >= 0) {
          stringCell = `"${stringCell}"`;
        }
        return stringCell;
      }).join(",")
    ).join("\n");

    csvContent += csvRows;

    const blob = Utilities.newBlob(csvContent, 'application/octet-stream');

    // 4. ENVIO BIGQUERY
    const job = {
      configuration: {
        load: {
          destinationTable: {
            projectId: projectId,
            datasetId: datasetId,
            tableId: tableId
          },
          skipLeadingRows: 1, 
          writeDisposition: 'WRITE_TRUNCATE', 
          sourceFormat: 'CSV',
          autodetect: true, 
          maxBadRecords: 50, 
          ignoreUnknownValues: true,
          // [ADICIONADO] Permite que o esquema seja atualizado se houver colunas novas
          schemaUpdateOptions: ['ALLOW_FIELD_ADDITION']
        }
      }
    };

    try {
      BigQuery.Jobs.insert(job, projectId, blob);
      Logger.log('🚀 TURBO SENT: ' + tableId);
    } catch (e) {
      Logger.log('ERRO CRÍTICO na aba ' + nomeDaAba + ': ' + e.toString());
      throw new Error("Erro no BigQuery (" + nomeDaAba + "): " + e.message); // Lança erro para o Webex pegar
    }
  });
}
// ============================================================================
// 🛒 SCRIPT IMPORTAÇÃO TURBO COMPRAS - V3.1 (COMPATÍVEL ORQUESTRADOR)
// 1. Return Count: Retorna SOMA de todas as tarefas importadas.
// 2. Lock: Proteção contra execução duplicada (LOCK_GERAL).
// 3. Estratégia: 4 Tarefas Sequenciais (Famílias, Fornecedores, Unidades, Formas).
// ============================================================================

// ============================================================================
// ⚙️ 1. CONFIGURAÇÕES
// ============================================================================

var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_COMPRAS = {
  tarefas: [
    {
      key: "FamiliasProdutos",
      url: "https://app.omie.com.br/api/v1/geral/familias/",
      metodo: "PesquisarFamilias",
      nomePlanilha: "FamiliasProdutos",
      cor: "#FF5630",
      headers: ["Empresa","Código","Nome Família","Cod Int"]
    },
    {
      key: "ProdutoFornecedor",
      url: "https://app.omie.com.br/api/v1/estoque/produtofornecedor/",
      metodo: "ListarProdutoFornecedor",
      nomePlanilha: "ProdutoFornecedor",
      cor: "#0052CC",
      headers: ["Empresa","Cód Forn","CNPJ","Fantasia","Razão","Cód Int Prod","Cód Prod","Descrição","Preço","Unid"]
    },
    {
      key: "Unidades",
      url: "https://app.omie.com.br/api/v1/geral/unidade/",
      metodo: "ListarUnidades",
      nomePlanilha: "Unidades",
      cor: "#FFAB00",
      headers: ["Empresa","Sigla","Descrição"]
    },
    {
      key: "FormasPagCompras",
      url: "https://app.omie.com.br/api/v1/produtos/formaspagcompras/",
      metodo: "ListarFormasPagCompras",
      nomePlanilha: "FormasPagCompras",
      cor: "#36B37E",
      headers: ["Empresa","Código","Descrição","Num Parcelas","Cod Forma Pag"]
    }
  ]
};

// ============================================================================
// 🚀 2. LANÇADOR
// ============================================================================

function executarImportacaoTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();

  // Proteção de Lock Externo
  if (props.getProperty('LOCK_GERAL') === 'TRUE' && props.getProperty('CPS_PROCESSANDO') !== 'TRUE') {
     Logger.log('⚠️ Importação Turbo Compras já está rodando. Ignorando.');
     return 0;
  }
  
  // Se não estiver processando internamente, inicia limpeza
  if (props.getProperty('CPS_PROCESSANDO') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando limpeza geral...");
    
    // Limpa apenas variáveis deste script
    const chavesLimpar = ['CPS_PROCESSANDO', 'IDX_TAREFA', 'IDX_EMP', 'IDX_PAG', 'CPS_TOTAL_REGS'];
    chavesLimpar.forEach(k => props.deleteProperty(k));
    
    limparGatilhos(); 
    props.setProperty('LOCK_GERAL', 'TRUE');
    
    // Limpa abas temporárias
    for (var i = 0; i < CONFIG_COMPRAS.tarefas.length; i++) {
      var nomeSheetTemp = "TEMP_" + CONFIG_COMPRAS.tarefas[i].nomePlanilha;
      var tOld = ss.getSheetByName(nomeSheetTemp);
      if (tOld) { try { ss.deleteSheet(tOld); } catch(e){} }
    }
  }

  // 🔥 CHAMA O MOTOR
  return motorProcessamentoCompras();
}

// ============================================================================
// ⚙️ 3. MOTOR (PROCESSAMENTO COM RETOMADA + CONTADOR)
// ============================================================================

function motorProcessamentoCompras() {
  Logger.log("⚙️ 3. MOTOR: Ligado!");
  
  var horaInicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId(); 
  var props = PropertiesService.getScriptProperties();
  
  // Garante lock
  props.setProperty('LOCK_GERAL', 'TRUE');
  
  var estado = props.getProperties();
  var processando = (estado['CPS_PROCESSANDO'] === 'TRUE');
  
  var tIdx = parseInt(estado['IDX_TAREFA'] || "0"); 
  var eIdx = parseInt(estado['IDX_EMP'] || "0");    
  var pIdx = parseInt(estado['IDX_PAG'] || "1");    
  
  // Recupera total acumulado
  var totalImportadoGeral = parseInt(estado['CPS_TOTAL_REGS'] || "0");

  if (!processando) {
    props.setProperty('CPS_PROCESSANDO', 'TRUE');
  } else {
    Logger.log("🔄 MOTOR: Retomando Tarefa " + tIdx + ", Emp " + eIdx + ", Pág " + pIdx);
  }

  var listaEmpresas = ["SF"]; 
  var precisaAgendar = false;

  // === LOOP TAREFAS ===
  for (var t = tIdx; t < CONFIG_COMPRAS.tarefas.length; t++) {
    var config = CONFIG_COMPRAS.tarefas[t];
    var nomeSheetTemp = "TEMP_" + config.nomePlanilha;

    if (t > tIdx) { eIdx = 0; pIdx = 1; }

    var sheetTemp = ss.getSheetByName(nomeSheetTemp);
    if (!sheetTemp) {
      sheetTemp = ss.insertSheet(nomeSheetTemp);
      sheetTemp.hideSheet(); 
      escreverViaApiSafe(ssId, nomeSheetTemp + "!A1", [config.headers]);
    }

    // === LOOP EMPRESAS ===
    for (var e = eIdx; e < listaEmpresas.length; e++) {
      var sigla = listaEmpresas[e];
      if (e > eIdx) pIdx = 1;
      
      var empresa = EMPRESAS_OMIE[sigla];
      var totalPaginas = 1;
      var bufferLinhas = []; 

      // === LOOP PÁGINAS ===
      do {
        if ((new Date().getTime() - horaInicio) > 270000) { 
          if (bufferLinhas.length > 0) appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas);
          
          Logger.log("⏳ MOTOR: Tempo esgotado na tarefa " + config.nomePlanilha + ". Agendando...");
          props.setProperties({ 
            'IDX_TAREFA': t.toString(),
            'IDX_EMP': e.toString(), 
            'IDX_PAG': pIdx.toString(), 
            'CPS_PROCESSANDO': 'TRUE',
            'CPS_TOTAL_REGS': totalImportadoGeral.toString()
          });
          precisaAgendar = true;
          break;
        }

        Logger.log("   ⬇️ " + config.nomePlanilha + " | " + sigla + " | Pág " + pIdx);

        try {
          var par = [];
          if(config.key === "FamiliasProdutos") par = [{"pagina": pIdx}];
          else if(config.key === "Unidades") par = [{"codigo": ""}];
          else par = [{"pagina": pIdx, "registros_por_pagina": 100}];

          var payload = { 
            "call": config.metodo, 
            "app_key": empresa.appKey, 
            "app_secret": empresa.appSecret, 
            "param": par 
          };

          var data = fetchOmieSmart(config.url, payload);

          if (data.faultstring) {
            if (data.faultstring.indexOf("N\u00e3o existem") > -1) break; 
            throw new Error(data.faultstring);
          }

          if (config.key === "Unidades") totalPaginas = 1;
          else totalPaginas = data.total_de_paginas || data.nTotalPaginas || 1;
          
          var linhas = parseDadosCompras(config.key, data, sigla);
          if (linhas.length > 0) bufferLinhas = bufferLinhas.concat(linhas);

          if (bufferLinhas.length >= 500) {
             appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas);
             bufferLinhas = [];
          }

          pIdx++;

        } catch (err) {
          if (bufferLinhas.length > 0) { appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas); bufferLinhas = []; }
          var m = err.message;
          if (m.indexOf("N\u00e3o existem") > -1) break;
          else if (m.indexOf("403") > -1) { Logger.log("      🚫 Bloqueio 403. Pulando."); break; }
          else if (m.indexOf("timed out") > -1) {
             Logger.log("      ⏳ Google Busy. Pausando.");
             props.setProperties({ 'IDX_TAREFA': t.toString(), 'IDX_EMP': e.toString(), 'IDX_PAG': pIdx.toString(), 'CPS_PROCESSANDO': 'TRUE', 'CPS_TOTAL_REGS': totalImportadoGeral.toString() });
             precisaAgendar = true;
             break;
          }
          else { Logger.log("      ⚠️ Erro ignorado: " + m); break; }
        }
      } while (pIdx <= totalPaginas);

      if (bufferLinhas.length > 0) {
         appendViaApiSafe(ssId, nomeSheetTemp, bufferLinhas);
         bufferLinhas = [];
      }

      if (precisaAgendar) break;
      pIdx = 1;
    } 

    if (precisaAgendar) break;

    // === COMMIT ===
    Logger.log("💾 MOTOR: Finalizando tarefa " + config.nomePlanilha);
    var qtdComitada = commitarDadosSolidoDinamico(ss, config, sheetTemp);
    totalImportadoGeral += qtdComitada; 
    
    // Salva parcial
    props.setProperty('CPS_TOTAL_REGS', totalImportadoGeral.toString());
    
    // Se for FormasPagCompras, calcula prazo médio
    if (config.key === "FormasPagCompras") {
       var sheetOficial = ss.getSheetByName(config.nomePlanilha);
       if(sheetOficial) calcularPrazoMedio(sheetOficial);
    }
    
    SpreadsheetApp.flush();
    Utilities.sleep(2000); 
    
    eIdx = 0; 
    pIdx = 1;
  } 

  if (precisaAgendar) {
    ScriptApp.newTrigger('motorProcessamentoCompras').timeBased().after(100).create();
    return 0; // Ainda rodando

  } else {
    // Limpeza Final
    const chavesLimpar = ['CPS_PROCESSANDO', 'IDX_TAREFA', 'IDX_EMP', 'IDX_PAG', 'CPS_TOTAL_REGS', 'LOCK_GERAL'];
    chavesLimpar.forEach(k => props.deleteProperty(k));
    
    limparGatilhos();
    Logger.log("🏆 TODAS AS TAREFAS DE COMPRAS CONCLUÍDAS! Total: " + totalImportadoGeral);
    // ss.toast("Compras Atualizadas!", "✅", 5);
    
    return totalImportadoGeral; // ✅ Retorna a soma total
  }
}

// ============================================================================
// 🛠️ PARSING
// ============================================================================

function parseDadosCompras(tarefa, data, sigla) {
  var l = [];
  
  if (tarefa === "FamiliasProdutos") {
    var r = data.famCadastro || [];
    for(var i=0; i<r.length; i++) l.push([sigla, r[i].codigo||"", r[i].nomeFamilia||"", r[i].codInt||""]);
  }
  else if (tarefa === "Unidades") {
    var r = data.unidade_cadastro || [];
    for(var i=0; i<r.length; i++) l.push([sigla, r[i].cCodigo||"", r[i].cDescricao||""]);
  }
  else if (tarefa === "FormasPagCompras") {
    var r = data.cadastros || [];
    for(var i=0; i<r.length; i++) l.push([sigla, r[i].cCodigo||"", r[i].cDescricao||"", r[i].nNumeroParcelas||"", r[i].nCodFormaPag||""]);
  }
  else if (tarefa === "ProdutoFornecedor") {
    var cads = data.cadastros || [];
    for(var i=0; i<cads.length; i++) {
      var c = cads[i]; var ps = c.produtos || [];
      if (ps.length > 0) {
        for(var j=0; j<ps.length; j++) l.push([sigla, c.nCodForn||"", c.cCpfCnpj||"", c.cNomeFantasia||"", c.cRazaoSocial||"", ps[j].nCodIntProd||"", ps[j].cCodigo||"", ps[j].cDescricao||"", parseFloat(ps[j].nPreco||0), ps[j].cUnidade||""]);
      } else {
        l.push([sigla, c.nCodForn||"", c.cCpfCnpj||"", c.cNomeFantasia||"", c.cRazaoSocial||"", "", "", "", 0, ""]);
      }
    }
  }
  return l;
}

// ============================================================================
// 🧱 COMMIT BLINDADO (COM RETORNO QTD)
// ============================================================================

function commitarDadosSolidoDinamico(ss, config, sheetTemp) {
  var nomeOficial = config.nomePlanilha;
  var sheetOficial = ss.getSheetByName(nomeOficial);
  if (!sheetOficial) sheetOficial = ss.insertSheet(nomeOficial);
  
  var qtdRegistros = 0;
  
  try {
    var rangeTemp = sheetTemp.getDataRange();
    var values = rangeTemp.getValues();
    
    if (values.length > 1) { 
      qtdRegistros = values.length - 1; // Desconta cabeçalho
      
      try { sheetOficial.clear(); } catch(e) { Logger.log("⚠️ Falha leve limpar: " + e.message); }
      
      var sucessoEscrita = false;
      var tentativas = 0;
      while (tentativas < 3 && !sucessoEscrita) {
        try {
          sheetOficial.getRange(1, 1, values.length, values[0].length).setValues(values);
          sucessoEscrita = true;
        } catch(e) {
          tentativas++;
          Logger.log("⚠️ Erro escrita (" + tentativas + "/3): " + e.message);
          Utilities.sleep(3000);
        }
      }
      if (!sucessoEscrita) throw new Error("Timeout ao escrever na aba oficial.");

      sheetOficial.getRange(1, 1, 1, config.headers.length)
        .setFontWeight("bold").setBackground(config.cor).setFontColor("white");
      sheetOficial.setFrozenRows(1);
      
      escreverStatusCompras(sheetOficial, "Sucesso. " + qtdRegistros + " registros.", "ok");
      
      SpreadsheetApp.flush(); 
      try { ss.deleteSheet(sheetTemp); } catch(e) {}
    } else {
      escreverStatusCompras(sheetOficial, "Conexão OK. Vazio.", "aviso");
      try { ss.deleteSheet(sheetTemp); } catch(e){}
    }
  } catch (e) { 
    Logger.log("❌ ERRO COMMIT: " + e.message); 
    escreverStatusCompras(sheetOficial, "Erro: " + e.message, "erro");
  }
  
  return qtdRegistros;
}

// ✅ Função de Status N1 Exclusiva para Compras
function escreverStatusCompras(sheet, msg, tipo) { 
  if (!sheet) return; 
  var icone = "✅"; var corFundo = "#D9EAD3"; var corTexto = "#155724"; 
  if (tipo === "erro") { icone = "❌"; corFundo = "#F4CCCC"; corTexto = "#721C24"; }
  else if (tipo === "aviso") { icone = "⚠️"; corFundo = "#FFF2CC"; corTexto = "#856404"; }
  
  var horario = new Date().toLocaleTimeString("pt-BR", {hour: '2-digit', minute:'2-digit', second:'2-digit'});
  var textoFinal = icone + " " + horario + "\n" + msg;

  var celula = sheet.getRange("N1");
  celula.setValue(textoFinal)
        .setBackground(corFundo).setFontColor(corTexto).setFontWeight("bold")
        .setWrap(true).setVerticalAlignment("middle").setHorizontalAlignment("center");
}

function fetchOmieSmart(url, payload) {
  var tentativas = 0;
  while (tentativas < 4) {
    try {
      var opt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
      var resp = UrlFetchApp.fetch(url, opt);
      var code = resp.getResponseCode();
      if (code === 200) return JSON.parse(resp.getContentText());
      if (code >= 500 || code === 429) throw new Error("HTTP " + code);
      return JSON.parse(resp.getContentText());
    } catch (e) {
      tentativas++;
      if (tentativas === 4) throw e;
      Utilities.sleep(Math.pow(2, tentativas) * 1000);
    }
  }
}

function appendViaApiSafe(ssId, sheetName, values) {
  var t = 0;
  while (t < 3) {
    try { Sheets.Spreadsheets.Values.append({ values: values }, ssId, sheetName, { valueInputOption: "USER_ENTERED" }); return; }
    catch (e) { t++; Utilities.sleep(1000 * t); if (t === 3) throw e; }
  }
}

function escreverViaApiSafe(ssId, range, values) {
  try { Sheets.Spreadsheets.Values.update({ values: values }, ssId, range, { valueInputOption: "USER_ENTERED" }); }
  catch (e) { Utilities.sleep(1000); try { Sheets.Spreadsheets.Values.update({ values: values }, ssId, range, { valueInputOption: "USER_ENTERED" }); } catch(e){} }
}

function limparGatilhos() { 
  var t = ScriptApp.getProjectTriggers(); 
  for(var i=0; i<t.length; i++) if(t[i].getHandlerFunction() === 'motorProcessamentoCompras') ScriptApp.deleteTrigger(t[i]); 
}

function calcularPrazoMedio(sheet) { 
  var last = sheet.getLastRow(); 
  if(last<=1) return; 
  // Cria cabeçalho na col G se não tiver
  sheet.getRange("G1").setValue("Prazo Médio").setBackground("green").setFontColor("white").setFontWeight("bold"); 
  var d = sheet.getRange(2,3,last-1,1).getValues(); 
  var r = d.map(x => [calcPz(String(x[0]))]); 
  sheet.getRange(2,7,r.length,1).setValues(r); 
}

function calcPz(d) { 
  d=d.toLowerCase(); 
  if(!d||d.startsWith("a vista")) return 0; 
  var n=d.match(/\d+/g); 
  if(!n) return 0; 
  var v=n.map(Number); 
  if(d.startsWith("para")) return v[0]; 
  if(d.includes("parcela")) return Math.round((v[0]+1)/2); 
  if(d.startsWith("a vista/")) v.unshift(0); 
  return Math.round(v.reduce((a,b)=>a+b,0)/v.length); 
}
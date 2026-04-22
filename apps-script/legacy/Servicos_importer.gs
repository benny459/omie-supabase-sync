// ════════════════════════════════════════════════════════════════════════════
// 🏆 SCRIPT SERVIÇOS - V19.0 (COMPATÍVEL ORQUESTRADOR V3)
// 1. Return Count: Retorna número de registros para o Orquestrador validar.
// 2. Correção de Loop: Máximo de 3 tentativas por página.
// 3. Estratégia: Time Traveler (Saltos) preservada para Ordens de Serviço.
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎮 1. PAINEL DE CONTROLE
// ========================================
var OPCOES_SERV = {
  empresasAlvo: ["SF"], 
  dataInicioFixa: "01/01/2025", 
  tamanhoSalto: 50,
  itensPorPagina: 30 
};

// ========================================
// ⚙️ 2. CONFIGURAÇÕES
// ========================================
var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_SERV = {
  tarefas: ["OrdensServico", "ContratosServico"],
  "OrdensServico": {
    url: "https://app.omie.com.br/api/v1/servicos/os/",
    metodo: "ListarOS",
    nomePlanilha: "OrdensServico",
    cor: "#00B8D9",
    headers: ["Empresa", "Cód OS", "Seq Item", "Num OS", "Cód Cli", "Previsão", "Valor Total", "Etapa", "Categ", "Proj", "Conta", "Parc", "Qtd Parc", "Faturada", "Cancelada", "Dt Inc", "Dt Fat", "Cód Serv", "Desc Serv", "Qtd", "Vlr Unit", "Trib Serv", "Ret ISS", "Aliq ISS", "Vlr ISS", "Ret INSS", "Vlr INSS", "Cód Vend", "Num Recibo"]
  },
  "ContratosServico": {
    url: "https://app.omie.com.br/api/v1/servicos/contrato/",
    metodo: "ListarContratos",
    nomePlanilha: "ContratosServico",
    cor: "#6554C0",
    headers: ["Empresa", "Cód Ctr", "Num Ctr", "Cód Cli", "Situação", "Vig Início", "Vig Fim", "Tipo Fat", "Dia Fat", "Vlr Tot Mês", "Categ", "Conta", "Proj", "Seq", "Cód Serv", "Qtd", "Vlr Unit", "Vlr Total", "LC116", "Cód Mun", "Desc Completa", "Aliq ISS", "Vlr ISS", "Ret ISS"]
  }
};

// ========================================
// 🚀 3. LANÇADOR
// ========================================
function executarImportacaoServicosTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  
  // Verifica se é uma retomada (Orquestrador chamou novamente, mas já estava rodando?)
  // Se LOCK estiver true, assume que é continuação. Se não, limpa tudo.
  if (props.getProperty('LOCK_SERVICOS_TURBO') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando Serviços V19.0...");
    props.setProperty('LOCK_SERVICOS_TURBO', 'TRUE');
    
    const chavesLixo = ['SERV_TARGET_EMPS', 'SERV_DT_INI_TS', 'SERV_IDX_TASK', 'SERV_IDX_EMP', 'SERV_IDX_PAG', 'SERV_MODE', 'SERV_NEXT_ROW'];
    chavesLixo.forEach(function(k) { props.deleteProperty(k); });
    
    limparGatilhosSafeServ(); 
    props.setProperty('SERV_TARGET_EMPS', JSON.stringify(OPCOES_SERV.empresasAlvo));
    
    var tsInicio = parseDataOmieServ(OPCOES_SERV.dataInicioFixa);
    props.setProperty('SERV_DT_INI_TS', tsInicio.toString());
    
    for (var i = 0; i < CONFIG_SERV.tarefas.length; i++) {
      var config = CONFIG_SERV[CONFIG_SERV.tarefas[i]];
      var sheet = ss.getSheetByName(config.nomePlanilha) || ss.insertSheet(config.nomePlanilha);
      var maxRow = sheet.getMaxRows();
      if (maxRow > 1) sheet.getRange(2, 1, maxRow-1, config.headers.length).clearContent();
      sheet.getRange(1, 1, 1, config.headers.length).setValues([config.headers]).setFontWeight("bold").setBackground(config.cor).setFontColor("white");
      sheet.setFrozenRows(1);
    }
    
    props.setProperty('SERV_NEXT_ROW', "2");
    SpreadsheetApp.flush();
  } else {
    Logger.log("🟡 1. LANÇADOR: Retomando execução anterior...");
  }

  // 👇 RETORNA O RESULTADO DO MOTOR PARA O ORQUESTRADOR
  return motorProcessamentoServicos();
}

// ========================================
// ⚙️ 4. MOTOR (SISTEMA ANTI-LOOP + AZ1 + COUNTER)
// ========================================
function motorProcessamentoServicos() {
  Logger.log("⚙️ 3. MOTOR: Ligado!");
  var horaInicioRelogio = new Date().getTime(); 
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId(); 
  var props = PropertiesService.getScriptProperties();
  
  props.setProperty('LOCK_SERVICOS_TURBO', 'TRUE');

  var tIdx = parseInt(props.getProperty('SERV_IDX_TASK') || "0");
  var eIdx = parseInt(props.getProperty('SERV_IDX_EMP') || "0");
  var pIdx = parseInt(props.getProperty('SERV_IDX_PAG') || "1");
  var modoBusca = props.getProperty('SERV_MODE') || "SALTANDO"; 
  var tsInicio = parseFloat(props.getProperty('SERV_DT_INI_TS'));
  var listaTarefas = CONFIG_SERV.tarefas;
  var listaEmpresas = JSON.parse(props.getProperty('SERV_TARGET_EMPS') || '[]');
  var nextRow = parseInt(props.getProperty('SERV_NEXT_ROW') || "2");
  
  var precisaAgendar = false;
  var errosConsecutivos = 0;
  
  // 🆕 VARIÁVEL DE CONTAGEM PARA O ORQUESTRADOR
  var totalRegistrosCiclo = 0;

  try {
    for (var t = tIdx; t < listaTarefas.length; t++) {
      var taskKey = listaTarefas[t];
      var configTask = CONFIG_SERV[taskKey];
      var sheet = ss.getSheetByName(configTask.nomePlanilha);
      
      if (taskKey !== "OrdensServico") modoBusca = "LENDO";

      if (t > tIdx) { 
        eIdx = 0; pIdx = 1; 
        modoBusca = (taskKey === "OrdensServico" ? "SALTANDO" : "LENDO"); 
        nextRow = 2; 
      }

      for (var e = eIdx; e < listaEmpresas.length; e++) {
        var sigla = listaEmpresas[e];
        if (e > eIdx) { pIdx = 1; modoBusca = (taskKey === "OrdensServico" ? "SALTANDO" : "LENDO"); }
        var empresa = EMPRESAS_OMIE[sigla];
        if (!empresa) continue;

        var continuarPaginacao = true;
        while (continuarPaginacao) {
          if ((new Date().getTime() - horaInicioRelogio) > 260000) { 
            Logger.log("⏳ MOTOR: Tempo limite. Agendando...");
            props.setProperties({'SERV_IDX_TASK': t.toString(), 'SERV_IDX_EMP': e.toString(), 'SERV_IDX_PAG': pIdx.toString(), 'SERV_NEXT_ROW': nextRow.toString(), 'SERV_MODE': modoBusca});
            precisaAgendar = true; break;
          }

          Logger.log("   ⬇️ " + sigla + " | Pág " + pIdx + " | " + modoBusca);

          var payload = {"call": configTask.metodo, "app_key": empresa.appKey, "app_secret": empresa.appSecret, "param": [{ "pagina": pIdx, "registros_por_pagina": OPCOES_SERV.itensPorPagina, "apenas_importado_api": "N" }]};
          var options = {"method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true};
          var resp = UrlFetchApp.fetch(configTask.url, options);
          var codigo = resp.getResponseCode();
          
          if (codigo === 200) {
            errosConsecutivos = 0; 
            var data = JSON.parse(resp.getContentText());
            var registros = (taskKey === "OrdensServico") ? (data.osCadastro || []) : (data.contratoCadastro || []);
            
            if (registros.length === 0) { continuarPaginacao = false; break; }

            if (modoBusca === "SALTANDO") {
              var dtUlt = parseDataOmieServ(registros[registros.length - 1].InfoCadastro.dDtInc);
              if (dtUlt < tsInicio) {
                pIdx += OPCOES_SERV.tamanhoSalto;
              } else { 
                pIdx = Math.max(1, pIdx - OPCOES_SERV.tamanhoSalto); 
                modoBusca = "LENDO"; 
              }
            } else {
              var linhas = parseServicos(taskKey, registros, sigla, tsInicio);
              if (linhas.length > 0) { 
                escreverLoteServ(ssId, configTask.nomePlanilha, nextRow, linhas); 
                nextRow += linhas.length;
                totalRegistrosCiclo += linhas.length; // 🆕 SOMA AO CONTADOR
                props.setProperty('SERV_NEXT_ROW', nextRow.toString()); 
              }
              if (registros.length < OPCOES_SERV.itensPorPagina) {
                continuarPaginacao = false;
              } else {
                pIdx++;
              }
            }
          } else {
            errosConsecutivos++;
            Logger.log("      ⚠️ Erro Omie (Status " + codigo + ") na Pág " + pIdx + ". Tentativa " + errosConsecutivos + "/3");
            if (errosConsecutivos >= 3) { continuarPaginacao = false; break; }
            Utilities.sleep(4000);
          }
        } 
        if (precisaAgendar) break;
        pIdx = 1; modoBusca = "SALTANDO";
      } 
      if (precisaAgendar) {
        gravarLogAZ1(sheet, "RETOMADA", nextRow - 2, horaInicioRelogio, "Tempo excedido na " + taskKey);
        break;
      } else {
        gravarLogAZ1(sheet, "SUCESSO", nextRow - 2, horaInicioRelogio, taskKey + " Finalizada");
      }
    } 

    if (precisaAgendar) {
      limparGatilhosSafeServ();
      ScriptApp.newTrigger('motorProcessamentoServicos').timeBased().after(60 * 1000).create();
    } else {
      props.deleteProperty('LOCK_SERVICOS_TURBO'); 
      const finalClean = ['SERV_TARGET_EMPS', 'SERV_DT_INI_TS', 'SERV_IDX_TASK', 'SERV_IDX_EMP', 'SERV_IDX_PAG', 'SERV_MODE', 'SERV_NEXT_ROW'];
      finalClean.forEach(function(k) { props.deleteProperty(k); });
      limparGatilhosSafeServ();
      Logger.log("🏆 Serviços CONCLUÍDO!");
    }
  } catch (err) {
    Logger.log("❌ Erro Crítico: " + err.message);
    var currentSheet = ss.getSheetByName(CONFIG_SERV[listaTarefas[tIdx]].nomePlanilha);
    if (currentSheet) gravarLogAZ1(currentSheet, "ERRO", nextRow - 2, horaInicioRelogio, err.message);
  }

  // 🆕 RETORNA PARA O ORQUESTRADOR
  // Se for 0, o Orquestrador pode reclamar se houver Range.
  // Se for parcial (agendou trigger), retorna o que fez neste ciclo.
  return totalRegistrosCiclo; 
}

/**
 * Função Mestre de Log AZ1
 */
function gravarLogAZ1(sheet, status, registros, tempoInicio, erroMsg) {
  if (!sheet) return;
  var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM HH:mm");
  var tempoGasto = Math.floor((new Date().getTime() - tempoInicio) / 1000);
  var icone = status === "SUCESSO" ? "✅" : (status === "RETOMADA" ? "⏳" : "❌");
  
  var textoFinal = icone + " " + status + " | " + agora + " | " + registros + " reg | " + tempoGasto + "s";
  if (erroMsg) textoFinal += " | Obs: " + erroMsg;

  var range = sheet.getRange("AZ1");
  range.setValue(textoFinal);
  
  var cor = status === "SUCESSO" ? "#d9ead3" : (status === "RETOMADA" ? "#fff2cc" : "#f4cccc");
  range.setBackground(cor).setFontColor("black").setFontWeight("bold");
}

// ========================================
// 🛠️ AUXILIARES
// ========================================
function parseDataOmieServ(s) { if(!s) return 0; var p=s.split('/'); return new Date(p[2],p[1]-1,p[0]).getTime(); }

function parseServicos(taskKey, lista, sigla, tsInicio) {
  var dados = [];
  for (var i = 0; i < lista.length; i++) {
    var item = lista[i];
    if (taskKey === "OrdensServico") {
      var info = item.InfoCadastro||{};
      if (tsInicio && parseDataOmieServ(info.dDtInc) < tsInicio) continue;
      var s = item.ServicosPrestados||[], cab = item.Cabecalho||{}, add = item.InformacoesAdicionais||{};
      if (s.length === 0) dados.push(montarLinhaOS(sigla, cab, info, add, {}));
      else for (var j=0; j<s.length; j++) dados.push(montarLinhaOS(sigla, cab, info, add, s[j]));
    } else {
      var cab = item.cabecalho||{}, add = item.infAdic||{}, it = item.itensContrato||[];
      if (it.length === 0) dados.push(montarLinhaCtr(sigla, cab, add, {}));
      else for (var j=0; j<it.length; j++) dados.push(montarLinhaCtr(sigla, cab, add, it[j]));
    }
  }
  return dados;
}

function montarLinhaOS(sigla, cab, info, add, s) {
  var imp = s.impostos || {};
  return [sigla, String(cab.nCodOS||""), s.nSeqItem||"", cab.cNumOS||"", String(cab.nCodCli||""), cab.dDtPrevisao||"", parseFloat(cab.nValorTotal||0), cab.cEtapa||"", add.cCodCateg||"", String(add.nCodProj||""), String(add.nCodCC||""), cab.cCodParc||"", cab.nQtdeParc||"", info.cFaturada||"", info.cCancelada||"", info.dDtInc||"", info.dDtFat||"", String(s.nCodServico||""), s.cDescServ||"", parseFloat(s.nQtde||0), parseFloat(s.nValUnit||0), s.cTribServ||"", s.cRetemISS||"", parseFloat(imp.nAliqISS||0), parseFloat(imp.nValorISS||0), imp.cRetemINSS||"", parseFloat(imp.nValorINSS||0), String(cab.nCodVend||""), add.cNumRecibo||""];
}

function montarLinhaCtr(sigla, cab, add, it) {
  var c = it.itemCabecalho||{}, d = it.itemDescrServ||{}, i = it.itemImpostos||{};
  return [sigla, String(cab.nCodCtr||""), cab.cNumCtr||"", String(cab.nCodCli||""), cab.cCodSit||"", cab.dVigInicial||"", cab.dVigFinal||"", cab.cTipoFat||"", cab.nDiaFat||"", parseFloat(cab.nValTotMes||0), add.cCodCateg||"", String(add.nCodCC||""), String(add.nCodProj||""), c.seq||"", String(c.codServico||""), parseFloat(c.quant||0), parseFloat(c.valorUnit||0), parseFloat(c.valorTotal||0), c.codLC116||"", c.codServMunic||"", d.descrCompleta||"", parseFloat(i.aliqISS||0), parseFloat(i.valorISS||0), i.retISS||""];
}

function escreverLoteServ(ssId, sn, start, values) {
  var lastCol = values[0].length > 26 ? "A" + String.fromCharCode(64 + (values[0].length - 26)) : String.fromCharCode(64 + values[0].length);
  var rangeA1 = sn + "!A" + start + ":" + lastCol + (start + values.length - 1);
  Sheets.Spreadsheets.Values.update({range: rangeA1, values: values}, ssId, rangeA1, {valueInputOption: "USER_ENTERED"});
}

function limparGatilhosSafeServ() { 
  var t = ScriptApp.getProjectTriggers();
  for(var i=0; i<t.length; i++) if(t[i].getHandlerFunction()==='motorProcessamentoServicos') ScriptApp.deleteTrigger(t[i]);
}
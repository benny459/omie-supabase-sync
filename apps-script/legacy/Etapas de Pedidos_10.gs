// ════════════════════════════════════════════════════════════════════════════
// 🏆 SCRIPT ETAPAS DE PEDIDOS - V10.0 (COMPATÍVEL ORQUESTRADOR V3)
// 1. Return Count: Retorna volumetria para o Orquestrador validar.
// 2. Uso de LOCK_CARGA_ETAPAS para o Orquestrador.
// 3. Estratégia de Saltos e Tratamento de Erro 500 preservados.
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎮 1. PAINEL DE CONTROLE
// ========================================
var OPCOES_ETAPAS = {
  empresasAlvo: ["SF"], 
  dataInicioFixa: "01/01/2024", 
  itensPorPagina: 100,
  tamanhoSalto: 10 
};

// ========================================
// ⚙️ 2. CONFIGURAÇÕES TÉCNICAS
// ========================================
var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

// ========================================
// 🚀 3. LANÇADOR
// ========================================
function executarCargaCompletaEtapas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName("EtapasPedidos");
  var props = PropertiesService.getScriptProperties();
  
  // Verifica se é uma retomada ou nova execução
  if (props.getProperty('LOCK_CARGA_ETAPAS') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando Etapas V10.0 (Smart)...");
    
    props.setProperty('LOCK_CARGA_ETAPAS', 'TRUE');
    
    const chavesLixo = ['ETAPA_TARGET_EMPS', 'ETAPA_DT_INI_TS', 'ETAPA_NEXT_ROW', 'ETAPA_IDX_EMP', 'ETAPA_IDX_PAG', 'ETAPA_MODE'];
    chavesLixo.forEach(function(k) { props.deleteProperty(k); });
    
    limparGatilhosSafe(); 
    
    props.setProperty('ETAPA_TARGET_EMPS', JSON.stringify(OPCOES_ETAPAS.empresasAlvo));
    
    var strDtIni = OPCOES_ETAPAS.dataInicioFixa;
    var parts = strDtIni.split('/');
    var tsInicio = new Date(parts[2], parts[1]-1, parts[0]).getTime();
    props.setProperty('ETAPA_DT_INI_TS', tsInicio.toString());
    
    if (!sheet) {
      sheet = ss.insertSheet("EtapasPedidos");
    } 
    
    var maxRow = sheet.getMaxRows();
    if (maxRow > 1) {
      sheet.getRange("A2:AH" + maxRow).clearContent();
    }
    criarCabecalhoEtapas(sheet);
    
    props.setProperty('ETAPA_NEXT_ROW', "2");
    props.setProperty('ETAPA_MODE', "SALTANDO"); 
    
    SpreadsheetApp.flush();
  } else {
    Logger.log("🟡 1. LANÇADOR: Retomando Etapas...");
  }

  // 👇 RETORNA O RESULTADO DO MOTOR
  return motorProcessamentoEtapas();
}

function criarCabecalhoEtapas(sheet) {
  var headers = ["empresa", "nCodPed", "cCodIntPed", "cNumero", "cEtapa", "dDtEtapa", "cHrEtapa", "cUsEtapa", "cFaturado", "dDtFat", "cHrFat", "cAutorizado", "cDenegado", "cChaveNFE", "cNumNFE", "cSerieNFE", "dDtSaida", "cHrSaida", "cAmbiente", "cCancelado", "dDtCanc", "cHrCanc", "cUsCanc", "cDevolvido", "dDtDev", "cHrDev", "cUsDev", "info_dInc", "info_hInc", "info_uInc", "info_dAlt", "info_hAlt", "info_uAlt", "cImpAPI"];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold").setBackground("#4a86e8").setFontColor("white");
  sheet.setFrozenRows(1);
}

// ========================================
// ⚙️ 4. MOTOR (REVISADO ANTI-ERRO FINAL + COUNTER)
// ========================================
function motorProcessamentoEtapas() {
  Logger.log("⚙️ 3. MOTOR: Ligado!");
  
  var horaInicioRelogio = new Date().getTime(); 
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId();
  var sheet = ss.getSheetByName("EtapasPedidos");
  var props = PropertiesService.getScriptProperties();
  
  props.setProperty('LOCK_CARGA_ETAPAS', 'TRUE');

  var eIdx = parseInt(props.getProperty('ETAPA_IDX_EMP') || "0");
  var pagina = parseInt(props.getProperty('ETAPA_IDX_PAG') || "1");
  var modoBusca = props.getProperty('ETAPA_MODE') || "SALTANDO";
  var tsInicio = parseFloat(props.getProperty('ETAPA_DT_INI_TS'));
  var listaEmpresas = JSON.parse(props.getProperty('ETAPA_TARGET_EMPS') || '[]');
  var nextRow = parseInt(props.getProperty('ETAPA_NEXT_ROW') || "2");
  
  var precisaAgendar = false;
  var erroFinalDetectado = "";
  
  // 🆕 CONTADOR DE REGISTROS
  var totalRegistrosCiclo = 0;

  try {
    for (var e = eIdx; e < listaEmpresas.length; e++) {
      var sigla = listaEmpresas[e];
      if (e > eIdx) { pagina = 1; modoBusca = "SALTANDO"; }
      var empresa = EMPRESAS_OMIE[sigla];
      if (!empresa) continue;

      var continuarPaginacao = true;
      var errosConsecutivos = 0;

      while (continuarPaginacao) {
        if ((new Date().getTime() - horaInicioRelogio) > 260000) { 
          props.setProperties({ 
              'ETAPA_IDX_EMP': e.toString(), 'ETAPA_IDX_PAG': pagina.toString(),
              'ETAPA_NEXT_ROW': nextRow.toString(), 'ETAPA_MODE': modoBusca
          });
          precisaAgendar = true; break;
        }

        var labelModo = (modoBusca === "SALTANDO") ? " ⏩ SALTANDO" : " 🚶 LENDO";
        Logger.log("   ⬇️ " + sigla + " | Pág " + pagina + labelModo + " | L" + nextRow);

        try {
          var payload = {
            "call": "ListarEtapasPedido",
            "app_key": empresa.appKey, 
            "app_secret": empresa.appSecret, 
            "param": [{"nPagina": pagina, "nRegPorPagina": OPCOES_ETAPAS.itensPorPagina}]
          };
          
          var data = fetchOmieSmart(payload);

          if (!data || !data.etapasPedido || data.etapasPedido.length === 0) {
             continuarPaginacao = false; 
             break; 
          }
          
          errosConsecutivos = 0;
          var etapas = data.etapasPedido;

          if (modoBusca === "SALTANDO") {
             var ultimaEtapa = etapas[etapas.length - 1];
             var dtUltima = 0;
             if (ultimaEtapa.info && ultimaEtapa.info.dInc) {
                var p = ultimaEtapa.info.dInc.split('/');
                dtUltima = new Date(p[2], p[1]-1, p[0]).getTime();
             }

             if (dtUltima < tsInicio) {
                pagina += OPCOES_ETAPAS.tamanhoSalto;
             } else {
                pagina = Math.max(1, pagina - OPCOES_ETAPAS.tamanhoSalto);
                modoBusca = "LENDO";
             }
          } 
          else {
             var linhasParaGravar = [];
             for (var i = 0; i < etapas.length; i++) {
               var etp = etapas[i];
               if (etp.info && etp.info.dInc) {
                  var d = etp.info.dInc.split('/');
                  if (new Date(d[2], d[1]-1, d[0]).getTime() >= tsInicio) {
                     linhasParaGravar.push(formatarLinhaEtapa(sigla, etp));
                  }
               }
             }
             if (linhasParaGravar.length > 0) {
                escreverLoteExato(ssId, "EtapasPedidos", nextRow, linhasParaGravar);
                nextRow += linhasParaGravar.length; 
                totalRegistrosCiclo += linhasParaGravar.length; // 🆕 SOMA
                props.setProperty('ETAPA_NEXT_ROW', nextRow.toString());
             }
             pagina++;
          }
          Utilities.sleep(150);

        } catch (err) {
          // 🛡️ TRATAMENTO INTELIGENTE DO ERRO 500 (FIM DE REGISTROS)
          if (err.message.indexOf("HTTP 500") > -1) {
             if (nextRow > 2) {
               Logger.log("   🏁 Omie 500 na pág " + pagina + ": Interpretado como Fim dos Dados.");
               continuarPaginacao = false;
               break;
             } else {
               errosConsecutivos++;
               if (errosConsecutivos >= 3) { throw new Error("Falha persistente na Omie"); }
               Utilities.sleep(5000);
             }
          } else {
             throw err; // Outros erros interrompem para o catch principal
          }
        }
      } 
      if (precisaAgendar) break;
      pagina = 1; modoBusca = "SALTANDO";
    } 

    if (precisaAgendar) {
      limparGatilhosSafe(); 
      ScriptApp.newTrigger('motorProcessamentoEtapas').timeBased().after(60 * 1000).create();
      gravarLogAZ1(sheet, "RETOMADA", nextRow - 2, horaInicioRelogio, "Pausa para próxima pág");
    } else {
      props.deleteProperty('LOCK_CARGA_ETAPAS'); 
      const finalClean = ['ETAPA_TARGET_EMPS', 'ETAPA_DT_INI_TS', 'ETAPA_NEXT_ROW', 'ETAPA_IDX_EMP', 'ETAPA_IDX_PAG', 'ETAPA_MODE'];
      finalClean.forEach(function(k) { props.deleteProperty(k); });
      limparGatilhosSafe();
      gravarLogAZ1(sheet, "SUCESSO", nextRow - 2, horaInicioRelogio, "Finalizado com sucesso");
      Logger.log("🏆 CONCLUÍDO!");
    }

  } catch (err) {
    Logger.log("❌ Erro: " + err.message);
    if (sheet) gravarLogAZ1(sheet, "ERRO", nextRow - 2, horaInicioRelogio, err.message);
  }

  // 🆕 RETORNA PARA ORQUESTRADOR
  return totalRegistrosCiclo; 
}

/**
 * Grava o carimbo consolidado na célula AZ1
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

function formatarLinhaEtapa(sigla, etapa) {
  var fat = etapa.faturamento || {}, canc = etapa.cancelamento || {}, dev = etapa.devolucao || {}, info = etapa.info || {};
  return [sigla, etapa.nCodPed || "", etapa.cCodIntPed || "", etapa.cNumero || "", etapa.cEtapa || "", etapa.dDtEtapa || "", etapa.cHrEtapa || "", etapa.cUsEtapa || "", fat.cFaturado || "", fat.dDtFat || "", fat.cHrFat || "", fat.cAutorizado || "", fat.cDenegado || "", fat.cChaveNFE || "", fat.cNumNFE || "", fat.cSerieNFE || "", fat.dDtSaida || "", fat.cHrSaida || "", fat.cAmbiente || "", canc.cCancelado || "", canc.dDtCanc || "", canc.cHrCanc || "", canc.cUsCanc || "", dev.cDevolvido || "", dev.dDtDev || "", dev.cHrDev || "", dev.cUsDev || "", info.dInc || "", info.hInc || "", info.uInc || "", info.dAlt || "", info.hAlt || "", info.uAlt || "", etapa.cImpAPI || ""];
}

function escreverLoteExato(ssId, sheetName, startRow, values) {
  var rangeA1 = sheetName + "!A" + startRow + ":AH" + (startRow + values.length - 1);
  Sheets.Spreadsheets.Values.update({range: rangeA1, values: values}, ssId, rangeA1, {valueInputOption: "USER_ENTERED"});
}

function fetchOmieSmart(payload) {
  var tentativas = 0;
  while (tentativas < 4) {
    try {
      var opt = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
      var resp = UrlFetchApp.fetch("https://app.omie.com.br/api/v1/produtos/pedidoetapas/", opt);
      if (resp.getResponseCode() === 200) return JSON.parse(resp.getContentText());
      throw new Error("HTTP " + resp.getResponseCode());
    } catch (e) {
      tentativas++;
      if (tentativas === 4) throw e;
      Utilities.sleep(1000 * tentativas);
    }
  }
}

function limparGatilhosSafe() { 
  var t = ScriptApp.getProjectTriggers(); 
  for(var i=0; i<t.length; i++) if (t[i].getHandlerFunction() === 'motorProcessamentoEtapas') ScriptApp.deleteTrigger(t[i]);
}
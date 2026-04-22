// ════════════════════════════════════════════════════════════════════════════
// 🏆 SCRIPT PEDIDOS VENDA - V20.0 (COMPATÍVEL ORQUESTRADOR V3)
// 1. Return Count: Retorna volumetria para o Orquestrador validar range/retry.
// 2. Correção de Loop: Máximo de 3 tentativas por página.
// 3. Estratégia: Time Traveler (Saltos) e Log AZ1 mantidos.
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎮 1. PAINEL DE CONTROLE
// ========================================
var OPCOES_PV = {
  empresasAlvo: ["SF"], 
  dataInicioFixa: "01/01/2025",
  tamanhoSalto: 5,
  itensPorPagina: 50 
};

// ========================================
// ⚙️ 2. CONFIGURAÇÕES TÉCNICAS
// ========================================
var EMPRESAS_OMIE = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_PV = {
  url: "https://app.omie.com.br/api/v1/produtos/pedido/",
  metodo: "ListarPedidos",
  nomePlanilha: "PedidosVenda",
  cor: "#4285F4",
  headers: [
    "Empresa", "Cód Pedido", "Cód Pedido Int", "Num Pedido", "Cód Cliente", 
    "Previsão", "Etapa", "Cód Parcela", "Qtd Parcelas", "Origem", 
    "Vlr Total", "Qtd Itens", "Vlr Mercadorias", "Vlr Desconto", "Vlr Frete", 
    "Vlr ICMS", "Vlr PIS", "Vlr COFINS", "Base ICMS ST", "Vlr ICMS ST", 
    "Vlr IPI", "Cód Transp", "Modalidade", "Volumes", "Peso Bruto", 
    "Peso Liq", "Cód Categoria", "Cód Conta", "Num Ped Cliente", "Contato", 
    "Consumidor Final", "Email", "Cód Vendedor", "Cód Projeto", "Dados Adic NF", 
    "Dt Inc", "Hr Inc", "User Inc", "Dt Alt", "Hr Alt", "User Alt"
  ]
};

// ========================================
// 🚀 3. LANÇADOR
// ========================================
function executarImportacaoPedidosVendaTurbo() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  
  // Verifica se é uma nova execução ou retomada
  if (props.getProperty('LOCK_PEDIDOS_TURBO') !== 'TRUE') {
    Logger.log("🟢 1. LANÇADOR: Iniciando Pedidos Venda V20.0...");
    props.setProperty('LOCK_PEDIDOS_TURBO', 'TRUE');
    
    const chavesLixo = ['PV_TARGET_EMPS', 'PV_ITENS_PAG', 'PV_DT_INI_TS', 'PV_IDX_EMP', 'PV_IDX_PAG', 'PV_MODE', 'PV_NEXT_ROW'];
    chavesLixo.forEach(function(k) { props.deleteProperty(k); });
    
    limparGatilhosSafePV(); 
    
    props.setProperty('PV_TARGET_EMPS', JSON.stringify(OPCOES_PV.empresasAlvo));
    props.setProperty('PV_ITENS_PAG', OPCOES_PV.itensPorPagina.toString());
    
    var strDtIni = OPCOES_PV.dataInicioFixa;
    var parts = strDtIni.split('/');
    var tsInicio = new Date(parts[2], parts[1]-1, parts[0]).getTime();
    props.setProperty('PV_DT_INI_TS', tsInicio.toString());
    
    var sheet = ss.getSheetByName(CONFIG_PV.nomePlanilha) || ss.insertSheet(CONFIG_PV.nomePlanilha);
    var maxRow = sheet.getMaxRows();
    if (maxRow > 1) sheet.getRange(2, 1, maxRow-1, CONFIG_PV.headers.length).clearContent();
    
    sheet.getRange(1, 1, 1, CONFIG_PV.headers.length).setValues([CONFIG_PV.headers])
      .setFontWeight("bold").setBackground(CONFIG_PV.cor).setFontColor("white");
    
    sheet.setFrozenRows(1);
    props.setProperty('PV_NEXT_ROW', "2");
    
    SpreadsheetApp.flush();
  } else {
    Logger.log("🟡 1. LANÇADOR: Retomando execução anterior...");
  }

  // 👇 RETORNA O RESULTADO DO MOTOR PARA O ORQUESTRADOR
  return motorProcessamentoPV();
}

// ========================================
// ⚙️ 4. MOTOR (SISTEMA ANTI-LOOP + AZ1 + COUNTER)
// ========================================
function motorProcessamentoPV() {
  Logger.log("⚙️ 3. MOTOR: Ligado!");
  
  var horaInicioRelogio = new Date().getTime(); 
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var ssId = ss.getId(); 
  var sheet = ss.getSheetByName(CONFIG_PV.nomePlanilha);
  var props = PropertiesService.getScriptProperties();
  
  props.setProperty('LOCK_PEDIDOS_TURBO', 'TRUE');

  var eIdx = parseInt(props.getProperty('PV_IDX_EMP') || "0");
  var pIdx = parseInt(props.getProperty('PV_IDX_PAG') || "1");
  var modoBusca = props.getProperty('PV_MODE') || "SALTANDO"; 
  var itensPorPagina = parseInt(props.getProperty('PV_ITENS_PAG') || "50");
  var tsInicio = parseFloat(props.getProperty('PV_DT_INI_TS'));
  var listaEmpresas = JSON.parse(props.getProperty('PV_TARGET_EMPS') || '[]');
  var nextRow = parseInt(props.getProperty('PV_NEXT_ROW') || "2");
  
  var precisaAgendar = false;
  var errosConsecutivos = 0;
  
  // 🆕 CONTADOR PARA O ORQUESTRADOR
  var totalRegistrosCiclo = 0;

  try {
    for (var e = eIdx; e < listaEmpresas.length; e++) {
      var sigla = listaEmpresas[e];
      if (e > eIdx) { pIdx = 1; modoBusca = "SALTANDO"; nextRow = obterUltimaLinhaRealPV(ssId, CONFIG_PV.nomePlanilha) + 1; }
      
      var empresa = EMPRESAS_OMIE[sigla];
      if (!empresa) continue;

      var continuarPaginacao = true;

      while (continuarPaginacao) {
        if ((new Date().getTime() - horaInicioRelogio) > 260000) { 
          props.setProperties({ 'PV_IDX_EMP': e.toString(), 'PV_IDX_PAG': pIdx.toString(), 'PV_NEXT_ROW': nextRow.toString(), 'PV_MODE': modoBusca });
          precisaAgendar = true; break;
        }

        Logger.log("   ⬇️ " + sigla + " | Pág " + pIdx + " | " + modoBusca);

        var payload = {
          "call": CONFIG_PV.metodo,
          "app_key": empresa.appKey, "app_secret": empresa.appSecret, 
          "param": [{ "pagina": pIdx, "registros_por_pagina": itensPorPagina, "apenas_importado_api": "N" }]
        };

        var options = { "method": "post", "contentType": "application/json", "payload": JSON.stringify(payload), "muteHttpExceptions": true };
        var resp = UrlFetchApp.fetch(CONFIG_PV.url, options);
        var codigo = resp.getResponseCode();

        if (codigo === 200) {
          errosConsecutivos = 0; 
          var data = JSON.parse(resp.getContentText());
          var listaPedidos = data.pedido_venda_produto || [];

          if (listaPedidos.length === 0) { continuarPaginacao = false; break; }

          if (modoBusca === "SALTANDO") {
             var ultimo = listaPedidos[listaPedidos.length - 1];
             var dtUltimo = parseDataOmiePV(ultimo.infoCadastro.dInc);
             if (dtUltimo < tsInicio) { pIdx += OPCOES_PV.tamanhoSalto; } 
             else { pIdx = Math.max(1, pIdx - OPCOES_PV.tamanhoSalto); modoBusca = "LENDO"; }
          } 
          else {
             var linhasParaGravar = [];
             for (var i = 0; i < listaPedidos.length; i++) {
                var ped = listaPedidos[i];
                if (parseDataOmiePV(ped.infoCadastro.dInc) >= tsInicio) { linhasParaGravar.push(montarLinhaPV(sigla, ped)); }
             }
             if (linhasParaGravar.length > 0) {
                escreverLotePV(ssId, CONFIG_PV.nomePlanilha, nextRow, linhasParaGravar);
                nextRow += linhasParaGravar.length;
                totalRegistrosCiclo += linhasParaGravar.length; // 🆕 SOMA AO CONTADOR
                props.setProperty('PV_NEXT_ROW', nextRow.toString());
             }
             if (listaPedidos.length < itensPorPagina) { continuarPaginacao = false; } 
             else { pIdx++; }
          }
        } else {
          errosConsecutivos++;
          if (errosConsecutivos >= 3) { continuarPaginacao = false; break; }
          Utilities.sleep(4000);
        }
      } 
      if (precisaAgendar) break;
      pIdx = 1; modoBusca = "SALTANDO";
    } 

    if (precisaAgendar) {
      limparGatilhosSafePV();
      ScriptApp.newTrigger('motorProcessamentoPV').timeBased().after(60 * 1000).create();
      gravarLogAZ1(sheet, "RETOMADA", nextRow - 2, horaInicioRelogio, "Agendado pág " + pIdx);
    } else {
      props.deleteProperty('LOCK_PEDIDOS_TURBO');
      const chavesLimpar = ['PV_TARGET_EMPS', 'PV_ITENS_PAG', 'PV_DT_INI_TS', 'PV_IDX_EMP', 'PV_IDX_PAG', 'PV_MODE', 'PV_NEXT_ROW'];
      chavesLimpar.forEach(function(k) { props.deleteProperty(k); });
      limparGatilhosSafePV();
      gravarLogAZ1(sheet, "SUCESSO", nextRow - 2, horaInicioRelogio, "Carga concluída");
    }

  } catch (err) {
    if (sheet) gravarLogAZ1(sheet, "ERRO", nextRow - 2, horaInicioRelogio, err.message);
  }

  // 🆕 RETORNA PARA O ORQUESTRADOR
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
function parseDataOmiePV(str) { if (!str) return 0; var p = str.split('/'); return new Date(p[2], p[1]-1, p[0]).getTime(); }

function montarLinhaPV(sigla, p) {
  var cab = p.cabecalho || {}, info = p.infoCadastro || {}, total = p.total_pedido || {}, frete = p.frete || {}, add = p.informacoes_adicionais || {};
  return [sigla, cab.codigo_pedido || "", cab.codigo_pedido_integracao || "", cab.numero_pedido || "", cab.codigo_cliente || "", cab.data_previsao || "", cab.etapa || "", cab.codigo_parcela || "", cab.qtde_parcelas || "", cab.origem_pedido || "", parseFloat(total.valor_total_pedido || 0), parseFloat(total.quantidade_itens || 0), parseFloat(total.valor_mercadorias || 0), parseFloat(total.valor_desconto || 0), parseFloat(total.valor_frete || 0), parseFloat(total.valor_icms || 0), parseFloat(total.valor_pis || 0), parseFloat(total.valor_cofins || 0), parseFloat(total.base_icms_st || 0), parseFloat(total.valor_icms_st || 0), parseFloat(total.valor_ipi || 0), frete.codigo_transportadora || "", frete.modalidade || "", frete.quantidade_volumes || "", frete.peso_bruto || "", frete.peso_liquido || "", add.codigo_categoria || "", add.codigo_conta_corrente || "", add.numero_pedido_cliente || "", add.contato || "", add.consumidor_final || "", add.enviar_email || "", add.codVend || "", add.codProj || "", add.dados_adicionais_nf || "", info.dInc || "", info.hInc || "", info.uInc || "", info.dAlt || "", info.hAlt || "", info.uAlt || ""];
}

function escreverLotePV(ssId, sn, start, values) {
  var lastCol = values[0].length > 26 ? "A" + String.fromCharCode(64 + (values[0].length - 26)) : String.fromCharCode(64 + values[0].length);
  var rangeA1 = sn + "!A" + start + ":" + lastCol + (start + values.length - 1);
  Sheets.Spreadsheets.Values.update({range: rangeA1, values: values}, ssId, rangeA1, {valueInputOption: "USER_ENTERED"});
}

function obterUltimaLinhaRealPV(ssId, sn) { try{var r=Sheets.Spreadsheets.Values.get(ssId,sn+"!A:A"); return r.values?r.values.length:1}catch(e){return 1}}

function limparGatilhosSafePV() { 
  var t = ScriptApp.getProjectTriggers();
  for(var i=0; i<t.length; i++) if(t[i].getHandlerFunction()==='motorProcessamentoPV') ScriptApp.deleteTrigger(t[i]);
}
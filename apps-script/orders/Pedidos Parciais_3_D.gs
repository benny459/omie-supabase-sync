/**
 * ════════════════════════════════════════════════════════════════
 * 📊 SCRIPT COMPILAR PEDIDOS PARCIAIS - V3.1 (CORRIGIDO)
 * 1. Return Count: Retorna total de pedidos únicos.
 * 2. Mapeamento: Flag Parcial agora em BU (índice 72).
 * 3. Lock: Proteção contra execução duplicada (LOCK_COMPILAR).
 * ════════════════════════════════════════════════════════════════
 */

var CONFIG_PEDIDOS_PARCIAIS = {
  idPlanilhaOrigem: "1lodGkIBxO1es8fYcNmvKY-7M8Jft1wUDa2FX3RSM3rg",
  abaOrigem: "ContasPagar_Consolidada",
  abaDestino: "Pedidos Parciais",
  corCabecalho: "#6D4C41",
  colunasProtegidas: [4, 5] // D e E (fórmulas ARRAYFORMULA)
};

// ========================================
// ⭐ FUNÇÃO PRINCIPAL (CORRIGIDA)
// ========================================

function compilarPedidosCompra() {
  var horaInicio = new Date().getTime();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  
  // 🆕 CONTADOR PARA O ORQUESTRADOR
  var totalPedidosUnicos = 0;

  // Proteção de Lock
  if (props.getProperty('LOCK_COMPILAR') === 'TRUE') {
    Logger.log('⚠️ Compilação de Pedidos já está rodando. Ignorando chamada.');
    return 0;
  }

  try {
    props.setProperty('LOCK_COMPILAR', 'TRUE');
    
    Logger.log("🚀 Iniciando Compilação (Origem: Coluna BU)...");
    
    // Criar ou obter aba de destino
    var abaDestino = ss.getSheetByName(CONFIG_PEDIDOS_PARCIAIS.abaDestino);
    var abaExistia = true;
    
    if (!abaDestino) {
      abaDestino = ss.insertSheet(CONFIG_PEDIDOS_PARCIAIS.abaDestino);
      abaExistia = false;
    } 
    
    // Limpar dados anteriores (Colunas A, B e C)
    if (abaExistia) {
      limparDadosAnterioresAC(abaDestino);
    }
    
    // Configurar cabeçalhos se a aba for nova
    if (!abaExistia) {
      var cabecalhos = [["Pedido de Compra", "Valor", "Fornecedor"]];
      abaDestino.getRange(1, 1, 1, 3).setValues(cabecalhos);
      abaDestino.getRange(1, 1, 1, 3)
        .setFontWeight("bold")
        .setBackground(CONFIG_PEDIDOS_PARCIAIS.corCabecalho)
        .setFontColor("#FFFFFF")
        .setHorizontalAlignment("center");
      abaDestino.setFrozenRows(1);
    }
    
    // Acessar planilha origem externa
    var ssOrigem = SpreadsheetApp.openById(CONFIG_PEDIDOS_PARCIAIS.idPlanilhaOrigem);
    var sheetOrigem = ssOrigem.getSheetByName(CONFIG_PEDIDOS_PARCIAIS.abaOrigem);
    
    if (!sheetOrigem) throw new Error("Aba origem não encontrada na planilha externa!");
    
    var ultimaLinhaOrigem = sheetOrigem.getLastRow();
    if (ultimaLinhaOrigem < 2) {
      escreverTimestampPedidosParciais(abaDestino, true, "Origem vazia", 0);
      return 0;
    }
    
    // Buscar dados (Puxamos até a coluna 85 para cobrir BU e outras colunas necessárias)
    var dadosOrigem = sheetOrigem.getRange(2, 1, ultimaLinhaOrigem - 1, 85).getValues();
    
    var mapaPedidos = {}; 
    var duplicatasEliminadas = 0;
    
    for (var i = 0; i < dadosOrigem.length; i++) {
      var linha = dadosOrigem[i];
      
      // --- MAPEAMENTO DE COLUNAS ---
      var flagParcial = linha[72]; // 🟢 Coluna BU (índice 72)
      var pedido      = linha[15]; // Coluna P (índice 15)
      var valor       = linha[6];  // Coluna G (índice 6)
      var fornecedor  = linha[41]; // Coluna AP (índice 41)
      
      if (flagParcial === "S" && pedido && pedido !== "") {
        var pedidoStr = String(pedido);
        var valorNum = isNaN(valor) ? 0 : Number(valor);
        
        if (!mapaPedidos[pedidoStr]) {
          mapaPedidos[pedidoStr] = { valor: valorNum, fornecedor: fornecedor || "" };
        } else {
          mapaPedidos[pedidoStr].valor += valorNum;
          duplicatasEliminadas++;
        }
      }
    }
    
    var pedidosUnicosKeys = Object.keys(mapaPedidos);
    var dadosParaEscrever = [];
    
    for (var j = 0; j < pedidosUnicosKeys.length; j++) {
      var pKey = pedidosUnicosKeys[j];
      var dadosObj = mapaPedidos[pKey];
      dadosParaEscrever.push([ pKey, dadosObj.valor, dadosObj.fornecedor ]);
    }
    
    // Ordenar por número de pedido
    dadosParaEscrever.sort(function(a, b) { return (Number(a[0]) || 0) - (Number(b[0]) || 0); });
    
    // Escrever resultados
    if (dadosParaEscrever.length > 0) {
      abaDestino.getRange(2, 1, dadosParaEscrever.length, 3).setValues(dadosParaEscrever);
      
      // Formatação
      abaDestino.getRange(2, 2, dadosParaEscrever.length, 1).setNumberFormat("R$ #,##0.00");
      abaDestino.getRange(2, 1, dadosParaEscrever.length, 1).setNumberFormat("0");
      
      // Ajuste de colunas
      try {
        abaDestino.setColumnWidth(1, 150); 
        abaDestino.setColumnWidth(2, 120); 
        abaDestino.setColumnWidth(3, 250); 
      } catch(e){}
      
      limparLinhasVaziasExtras(abaDestino, dadosParaEscrever.length + 1);
      totalPedidosUnicos = dadosParaEscrever.length;
    }
    
    var tempoTotal = (new Date().getTime() - horaInicio) / 1000;
    escreverTimestampPedidosParciais(abaDestino, true, 
      "Tempo: " + Math.round(tempoTotal) + "s | Filtro BU: S",
      totalPedidosUnicos);
    
  } catch (erro) {
    Logger.log("❌ ERRO: " + erro.message);
    if (abaDestino) escreverTimestampPedidosParciais(abaDestino, false, erro.message);
    totalPedidosUnicos = 0;
  } finally {
    props.deleteProperty('LOCK_COMPILAR');
  }

  return totalPedidosUnicos;
}

// ========================================
// ⭐ FUNÇÕES AUXILIARES
// ========================================

function escreverTimestampPedidosParciais(sheet, sucesso, mensagem, totalRegistros) {
  var timestamp = Utilities.formatDate(new Date(), "America/Sao_Paulo", "dd/MM/yyyy HH:mm:ss");
  var statusTexto = sucesso ? "✅ SUCESSO" : "❌ ERRO";
  var mensagemCompleta = statusTexto + " - " + timestamp;
  if (totalRegistros !== undefined) mensagemCompleta += ": " + totalRegistros + " pedidos";
  if (mensagem) mensagemCompleta += " | " + mensagem;
  
  var celulaStatus = sheet.getRange(1, 9); // I1
  celulaStatus.setValue(mensagemCompleta).setFontWeight("bold").setWrap(true);
  celulaStatus.setBackground(sucesso ? "#D9EAD3" : "#F4CCCC").setFontColor(sucesso ? "#155724" : "#721C24");
  sheet.autoResizeColumn(9);
}

function limparDadosAnterioresAC(sheet) {
  var ultimaLinha = sheet.getLastRow();
  if (ultimaLinha > 1) {
    sheet.getRange(2, 1, ultimaLinha - 1, 3).clearContent();
  }
}

function limparLinhasVaziasExtras(sheet, ultimaLinhaComDados) {
  var maxRows = sheet.getMaxRows();
  var linhasMinimas = Math.max(ultimaLinhaComDados + 10, 20);
  if (maxRows > linhasMinimas) {
    sheet.deleteRows(linhasMinimas + 1, maxRows - linhasMinimas);
  }
}

function statusPedidosParciais() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG_PEDIDOS_PARCIAIS.abaDestino);
  if (!sheet) return Logger.log("Aba não existe.");
  Logger.log("Total de pedidos na aba: " + (sheet.getLastRow() - 1));
}
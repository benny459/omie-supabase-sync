// ========================================
// FUNÇÃO 1: ATUALIZAR PAGAR FLOW
// ========================================

function atualizarPagarFlow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var inicioTotal = new Date().getTime();
  
  // ========================================
  // ⚙️ CONFIGURAÇÕES - AJUSTE AQUI
  // ========================================
  var MESES_ANTES = 3;   // 👈 Altere aqui: quantos meses para TRÁS buscar
  var MESES_DEPOIS = 6;  // 👈 Altere aqui: quantos meses para FRENTE buscar
  // ========================================
  
  ss.toast('Iniciando atualização...', 'Pagar Flow', -1);
  
  var abaOrigem = ss.getSheetByName("ContasPagar_Consolidada");
  var abaDestino = ss.getSheetByName("Pagar_Flow");
  
  if (!abaOrigem || !abaDestino) {
    ss.toast('Erro: Verifique se as abas existem.', 'Erro', 5);
    return;
  }
  
  // ✅ REMOVER FILTROS DO DESTINO (CRÍTICO!)
  var filtroDestino = abaDestino.getFilter();
  if (filtroDestino) {
    filtroDestino.remove();
    Logger.log("Filtro removido da aba Pagar_Flow");
  }
  
  var ultimaLinhaOrigem = abaOrigem.getLastRow();
  if (ultimaLinhaOrigem < 2) {
    ss.toast('Não há dados para copiar.', 'Aviso', 5);
    return;
  }
  
  // ========================================
  // ⚡ LIMPEZA RÁPIDA PRÉ-COLAGEM
  // ✅ PROTEGE COLUNA Y (25) - NÃO APAGA!
  // ========================================
  ss.toast('Limpando dados antigos (preservando col Y)...', 'Pagar Flow', -1);
  var inicioLimpeza = new Date().getTime();
  
  var ultimaLinhaDestino = abaDestino.getLastRow();
  if (ultimaLinhaDestino >= 6) {
    if (ultimaLinhaDestino > 5) {
      // ✅ Limpa A até X (1-24) - PRESERVA Y (25)
      abaDestino.getRange(6, 1, ultimaLinhaDestino - 5, 24).clear();
      Logger.log("Limpadas colunas A-X (preservando Y com fórmula)");
    }
  }
  
  var tempoLimpeza = (new Date().getTime() - inicioLimpeza) / 1000;
  Logger.log("Limpeza rápida: " + tempoLimpeza + "s (Y preservada)");
  SpreadsheetApp.flush();
  
  // ========================================
  // MAPEAMENTO COLUNAS - 23 colunas (22 originais + CE)
  // ========================================
  var colunasOriginaisOrigem = ['B', 'T', 'F', 'E', 'AP', 'BA', 'AV', 'BB', 'G', 'A', 'L', 'R', 'AI', 'BR', 'BS', 'BQ', 'BI', 'P', 'BD', 'BT', 'BC', 'BU'];
  var colunasNovas = ['CE']; // ✅ Mudança: apenas CE (vai para coluna W)
  var colunasOrigem = colunasOriginaisOrigem.concat(colunasNovas);
  
  var numColunas = colunasOrigem.length;
  var posicoesColunas = colunasOrigem.map(letra => abaOrigem.getRange(letra + '1').getColumn());
  var minCol = Math.min(...posicoesColunas);
  var maxCol = Math.max(...posicoesColunas);
  
  Logger.log("Mapeamento: " + numColunas + " colunas (22 antigas + CE → W)");
  Logger.log("Coluna Y (25) com fórmula será PRESERVADA");
  Logger.log("Período configurado: " + MESES_ANTES + " meses atrás até " + MESES_DEPOIS + " meses à frente");
  
  // ========================================
  // READ ÚNICO otimizado
  // ========================================
  var inicioRead = new Date().getTime();
  var dadosColA = abaOrigem.getRange(2, 1, ultimaLinhaOrigem - 1, 1).getValues();
  
  var ultimaLinhaReal = 1;
  for (var i = dadosColA.length - 1; i >= 0; i--) {
    if (String(dadosColA[i][0] || "").trim() !== "") {
      ultimaLinhaReal = i + 2;
      break;
    }
  }
  Logger.log("Última linha real detectada na origem: " + ultimaLinhaReal);
  
  var numRows = ultimaLinhaReal - 1;
  var numColsTotal = maxCol - minCol + 1;
  var dadosFull = abaOrigem.getRange(2, minCol, numRows, numColsTotal).getValues();
  var tempoRead = (new Date().getTime() - inicioRead) / 1000;
  Logger.log("Read único: " + numRows + " linhas x " + numColsTotal + " cols (" + tempoRead + "s)");
  
  // ========================================
  // FILTROS COM PERÍODO CONFIGURÁVEL
  // ========================================
  var inicioFiltro = new Date().getTime();
  
  var hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  
  // ✅ PERÍODO CONFIGURÁVEL
  var dataMin = new Date(hoje);
  dataMin.setMonth(dataMin.getMonth() - MESES_ANTES);
  
  var dataMax = new Date(hoje);
  dataMax.setMonth(dataMax.getMonth() + MESES_DEPOIS);
  
  Logger.log("Filtro de data: " + dataMin.toLocaleDateString('pt-BR') + " até " + dataMax.toLocaleDateString('pt-BR'));
  
  var idxColA = posicoesColunas[9] - minCol;
  var idxColF = posicoesColunas[2] - minCol;
  
  var linhasValidas = [];
  for (var k = 0; k < dadosFull.length; k++) {
    var empresaValor = String(dadosFull[k][idxColA] || "").trim();
    if (empresaValor === "") continue;
    
    var dataValor = dadosFull[k][idxColF];
    if (dataValor) {
      var data = new Date(dataValor);
      data.setHours(0, 0, 0, 0);
      
      if (data < dataMin || data > dataMax) {
        continue;
      }
    }
    
    linhasValidas.push(k);
  }
  
  var tempoFiltro = (new Date().getTime() - inicioFiltro) / 1000;
  Logger.log("Filtro col A + data (F): " + linhasValidas.length + " válidas de " + numRows + " (" + tempoFiltro + "s)");
  
  if (linhasValidas.length === 0) {
    ss.toast('Nenhuma linha válida no intervalo de ' + MESES_ANTES + ' meses atrás até ' + MESES_DEPOIS + ' meses à frente.', 'Aviso', 5);
    return;
  }
  
  // ========================================
  // TRANSPOSE
  // ========================================
  var inicioTrans = new Date().getTime();
  var indicesColunas = posicoesColunas.map(pos => pos - minCol);
  var dadosTranspostos = linhasValidas.map(rowIdx => 
    indicesColunas.map(colIdx => dadosFull[rowIdx][colIdx] || "")
  );
  var tempoTrans = (new Date().getTime() - inicioTrans) / 1000;
  Logger.log("Transposição: " + tempoTrans + "s para " + linhasValidas.length + " linhas");
  
  // ========================================
  // WRITE - Cola A até W (23 colunas)
  // ✅ NÃO TOCA NA COLUNA Y (25)
  // ========================================
  ss.toast('Colando ' + linhasValidas.length + ' linhas (preservando Y)...', 'Pagar Flow', -1);
  var inicioWrite = new Date().getTime();
  if (dadosTranspostos.length > 0) {
    abaDestino.getRange(6, 1, dadosTranspostos.length, numColunas).setValues(dadosTranspostos);
  }
  SpreadsheetApp.flush();
  var tempoWrite = (new Date().getTime() - inicioWrite) / 1000;
  Logger.log("Write: " + tempoWrite + "s (colunas A-W)");
  
  // ========================================
  // ⚡ LIMPEZA PÓS-COLAGEM - APENAS COLUNA X
  // ✅ NÃO TOCA NA COLUNA Y (25)!
  // ========================================
  ss.toast('Limpando coluna X (preservando Y)...', 'Pagar Flow', -1);
  var inicioLimpezaX = new Date().getTime();
  
  var ultimaLinhaColada = 6 + dadosTranspostos.length - 1;
  var linhasParaLimparX = Math.max(ultimaLinhaColada + 500, 1000);
  
  if (linhasParaLimparX >= 6) {
    // ✅ Limpa APENAS coluna X (24) - NÃO TOCA EM Y (25)
    abaDestino.getRange(6, 24, linhasParaLimparX - 5, 1).clearContent();
  }
  
  var tempoLimpezaX = (new Date().getTime() - inicioLimpezaX) / 1000;
  SpreadsheetApp.flush();
  Logger.log("Limpeza pós-colagem: Col X (24) limpa | Y (25) preservada (" + tempoLimpezaX + "s)");
  
  // ========================================
  // ⭐ TIMESTAMP EM E1
  // ========================================
  var timezone = Session.getScriptTimeZone();
  var agora = new Date();
  var dataHoraFormatada = Utilities.formatDate(agora, timezone, "dd/MM/yyyy HH:mm:ss");
  var celulaTimestamp = abaDestino.getRange("E1");
  
  celulaTimestamp.setValue("Última atualização: " + dataHoraFormatada);
  celulaTimestamp.setFontWeight("bold");
  celulaTimestamp.setFontColor("#FFFFFF");
  celulaTimestamp.setBackground("#4A86E8");
  
  Logger.log("⏰ Timestamp gravado em E1: " + dataHoraFormatada);
  
  // ========================================
  // RESUMO FINAL
  // ========================================
  var tempoTotal = (new Date().getTime() - inicioTotal) / 1000;
  
  var mensagem = '✓ ' + dadosTranspostos.length + ' linhas copiadas (' + tempoTotal.toFixed(1) + 's)!\n' +
                 'Período: -' + MESES_ANTES + 'm até +' + MESES_DEPOIS + 'm\n' +
                 '✓ Coluna Y preservada';
  
  ss.toast(mensagem, 'Pagar Flow', 5);
  
  Logger.log("========== RESUMO PAGAR FLOW ==========");
  Logger.log("Total: " + tempoTotal + "s");
  Logger.log("Linhas válidas: " + dadosTranspostos.length);
  Logger.log("Período: " + MESES_ANTES + " meses atrás até " + MESES_DEPOIS + " meses à frente");
  Logger.log("Limpeza inicial: " + tempoLimpeza + "s (A-X preserva Y)");
  Logger.log("Limpeza final: X limpa, Y preservada (" + tempoLimpezaX + "s)");
  Logger.log("✓ Coluna Y (25) com fórmula PRESERVADA");
  Logger.log("⏰ Timestamp: " + dataHoraFormatada);
  Logger.log("=======================================");
}


// ========================================
// FUNÇÃO 2: ATUALIZAR RECEBER FLOW
// ========================================

function atualizarReceberFlow() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var inicioTotal = new Date().getTime();
  
  ss.toast('Iniciando atualização...', 'Receber Flow', -1);
  
  var abaOrigem = ss.getSheetByName("ContasReceber_Consolidada");
  var abaDestino = ss.getSheetByName("Receber_Flow");
  
  if (!abaOrigem || !abaDestino) {
    ss.toast('Erro: Verifique se as abas existem.', 'Erro', 5);
    return;
  }
  
  // ✅ REMOVER FILTROS DO DESTINO (ANTES DE LIMPAR!)
  var filtroDestino = abaDestino.getFilter();
  if (filtroDestino) {
    filtroDestino.remove();
    Logger.log("✓ Filtro removido da aba Receber_Flow");
  }
  
  var ultimaLinhaOrigem = abaOrigem.getLastRow();
  if (ultimaLinhaOrigem < 2) {
    ss.toast('Não há dados para copiar.', 'Aviso', 5);
    return;
  }
  
  // ============================================
  // LIMPEZA PRÉ-COLAGEM (A-P, preserva Q)
  // ============================================
  ss.toast('Limpando dados antigos (A-P)...', 'Receber Flow', -1);
  var ultimaLinhaDestino = Math.max(abaDestino.getLastRow(), 10000);
  
  Logger.log("🧹 Limpando A-P, linhas 6 até " + ultimaLinhaDestino);
  
  if (ultimaLinhaDestino >= 6) {
    var rangeLimpeza = abaDestino.getRange(6, 1, ultimaLinhaDestino - 5, 16); // A-P (16 cols)
    rangeLimpeza.clearContent();
    rangeLimpeza.clearFormat();
    rangeLimpeza.clearDataValidations();
    Logger.log("✓ Limpeza aplicada: " + (ultimaLinhaDestino - 5) + " linhas x 16 cols");
  }
  SpreadsheetApp.flush();
  Utilities.sleep(500);
  
  // ============================================
  // MAPEAMENTO: 15 colunas origem → 15 colunas destino (A-O)
  // Coluna P destino = vazia (limpeza)
  // Coluna Q destino = fórmula (preservada)
  // ============================================
  var colunasOrigem = ['B', 'T', 'F', 'E', 'AS', 'BP', 'AW', 'BO', 'G', 'A', 'M', 'L', 'M', 'K', 'AY'];
  //             dest:  A    B    C    D    E     F     G     H    I    J    K    L    M    N    O
  
  var numColunas = colunasOrigem.length; // 15
  var posicoesColunas = colunasOrigem.map(letra => abaOrigem.getRange(letra + '1').getColumn());
  var minCol = Math.min(...posicoesColunas);
  var maxCol = Math.max(...posicoesColunas);
  
  Logger.log("Mapeamento: " + numColunas + " colunas (A-O destino)");
  Logger.log("✅ Nova coluna N ← K (origem)");
  Logger.log("✅ Coluna O ← AY (origem)");
  Logger.log("✅ Coluna P = vazia (limpeza)");
  Logger.log("✅ Coluna Q = fórmula (preservada)");
  
  // READ otimizado
  var inicioRead = new Date().getTime();
  var dadosColA = abaOrigem.getRange(2, 1, ultimaLinhaOrigem - 1, 1).getValues();
  var ultimaLinhaReal = 1;
  for (var i = dadosColA.length - 1; i >= 0; i--) {
    if (String(dadosColA[i][0] || "").trim() !== "") {
      ultimaLinhaReal = i + 2;
      break;
    }
  }
  Logger.log("📥 Última linha real: " + ultimaLinhaReal);
  
  var numRows = ultimaLinhaReal - 1;
  var numColsTotal = maxCol - minCol + 1;
  var dadosFull = abaOrigem.getRange(2, minCol, numRows, numColsTotal).getValues();
  var tempoRead = (new Date().getTime() - inicioRead) / 1000;
  Logger.log("📥 Read: " + numRows + " linhas x " + numColsTotal + " cols (" + tempoRead + "s)");
  
  // Filtro: empresa preenchida + status != "CANCELADO"
  var inicioFiltro = new Date().getTime();
  var idxColA = posicoesColunas[9] - minCol;  // empresa (A origem)
  var idxColT = posicoesColunas[1] - minCol;  // status (T origem)
  var linhasValidas = [];
  var canceladosIgnorados = 0;
  
  for (var k = 0; k < dadosFull.length; k++) {
    var empresa = String(dadosFull[k][idxColA] || "").trim();
    var status = String(dadosFull[k][idxColT] || "").trim().toUpperCase();
    
    if (empresa !== "" && status !== "CANCELADO") {
      linhasValidas.push(k);
    } else if (status === "CANCELADO") {
      canceladosIgnorados++;
    }
  }
  
  var tempoFiltro = (new Date().getTime() - inicioFiltro) / 1000;
  Logger.log("🔍 Filtro: " + linhasValidas.length + " válidas | " + canceladosIgnorados + " cancelados (" + tempoFiltro + "s)");
  
  if (linhasValidas.length === 0) {
    ss.toast('Nenhuma linha válida.', 'Aviso', 5);
    return;
  }
  
  // Transpose
  var inicioTrans = new Date().getTime();
  var indicesColunas = posicoesColunas.map(pos => pos - minCol);
  var dadosTranspostos = linhasValidas.map(rowIdx => 
    indicesColunas.map(colIdx => dadosFull[rowIdx][colIdx] || "")
  );
  var tempoTrans = (new Date().getTime() - inicioTrans) / 1000;
  Logger.log("🔄 Transpose: " + tempoTrans + "s");
  
  // Adiciona coluna P vazia (16ª coluna)
  for (var i = 0; i < dadosTranspostos.length; i++) {
    dadosTranspostos[i].push(""); // Coluna P vazia
  }
  
  // ============================================
  // WRITE: A-P (16 colunas), preserva Q (17)
  // ============================================
  ss.toast('Colando ' + linhasValidas.length + ' linhas (preservando Q)...', 'Receber Flow', -1);
  var inicioWrite = new Date().getTime();
  
  if (dadosTranspostos.length > 0) {
    abaDestino.getRange(6, 1, dadosTranspostos.length, 16).setValues(dadosTranspostos);
    Logger.log("✅ Dados colados em A6:P" + (6 + dadosTranspostos.length - 1));
  }
  SpreadsheetApp.flush();
  var tempoWrite = (new Date().getTime() - inicioWrite) / 1000;
  Logger.log("📝 Write: " + tempoWrite + "s");
  
  // ============================================
  // LIMPEZA PÓS-COLAGEM: Coluna P (16)
  // ✅ NÃO TOCA EM Q (17)
  // ============================================
  ss.toast('Limpando coluna P (preservando Q)...', 'Receber Flow', -1);
  var inicioLimpezaP = new Date().getTime();
  
  var ultimaLinhaColada = 6 + dadosTranspostos.length - 1;
  var linhasParaLimparP = Math.max(ultimaLinhaColada + 1000, 10000);
  
  if (linhasParaLimparP >= 6) {
    abaDestino.getRange(6, 16, linhasParaLimparP - 5, 1).clearContent();
    Logger.log("🧹 Col P limpa | Q preservada");
  }
  
  var tempoLimpezaP = (new Date().getTime() - inicioLimpezaP) / 1000;
  SpreadsheetApp.flush();
  
  // ========================================
  // ⭐ TIMESTAMP EM E1
  // ========================================
  var timezone = Session.getScriptTimeZone();
  var agora = new Date();
  var dataHoraFormatada = Utilities.formatDate(agora, timezone, "dd/MM/yyyy HH:mm:ss");
  var celulaTimestamp = abaDestino.getRange("E1");
  
  celulaTimestamp.setValue("Última atualização: " + dataHoraFormatada);
  celulaTimestamp.setFontWeight("bold");
  celulaTimestamp.setFontColor("#FFFFFF");
  celulaTimestamp.setBackground("#4A86E8");
  
  Logger.log("⏰ Timestamp gravado em E1: " + dataHoraFormatada);
  
  // Resumo
  var tempoTotal = (new Date().getTime() - inicioTotal) / 1000;
  var mensagem = '✓ ' + dadosTranspostos.length + ' linhas copiadas (' + tempoTotal.toFixed(1) + 's)!\n' +
                 '✅ Nova col N ← K | O ← AY\n' +
                 '✅ Col Q preservada';
  
  ss.toast(mensagem, 'Receber Flow', 5);
  
  Logger.log("========== RESUMO RECEBER FLOW ==========");
  Logger.log("Total: " + tempoTotal + "s");
  Logger.log("Válidas: " + dadosTranspostos.length);
  Logger.log("Cancelados: " + canceladosIgnorados);
  Logger.log("✅ Filtro removido antes da limpeza");
  Logger.log("✅ Coluna N ← K (origem)");
  Logger.log("✅ Coluna O ← AY (origem)");
  Logger.log("✅ Coluna P limpeza");
  Logger.log("✅ Coluna Q (fórmula) preservada");
  Logger.log("⏰ Timestamp: " + dataHoraFormatada);
  Logger.log("=========================================");
}

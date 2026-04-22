// Função 1: Copiar de Pagar_Flow para Flow_save (colunas A até X, valores + formato)
// ✅ SEQUÊNCIA CORRIGIDA: Remove filtros → Limpa destino → Copia dados
function copiarPagarFlow() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var abaOrigem = planilha.getSheetByName('Pagar_Flow');
  var abaDestino = planilha.getSheetByName('Flow_save');
  
  if (!abaOrigem) {
    planilha.toast('Aba "Pagar_Flow" não encontrada!', '⚠️ Erro', 5);
    return;
  }
  if (!abaDestino) {
    planilha.toast('Aba "Flow_save" não encontrada!', '⚠️ Erro', 5);
    return;
  }

  // ✅ PASSO 1: REMOVER FILTROS DA ORIGEM (crítico!)
  var filtroOrigem = abaOrigem.getFilter();
  if (filtroOrigem) {
    filtroOrigem.remove();
    Logger.log("Pagar_Flow: Filtro removido da ORIGEM");
  }

  // ✅ PASSO 2: REMOVER FILTROS DO DESTINO (crítico!)
  var filtroDestino = abaDestino.getFilter();
  if (filtroDestino) {
    filtroDestino.remove();
    Logger.log("Flow_save: Filtro removido do DESTINO");
  }
  
  SpreadsheetApp.flush(); // Garante que filtros foram removidos

  // ✅ PASSO 3: LIMPAR COMPLETAMENTE O DESTINO
  planilha.toast('Limpando Flow_save...', '🧹 Pagar Flow', -1);
  abaDestino.clear();
  SpreadsheetApp.flush();
  Logger.log("Flow_save: Destino completamente limpo");

  // ✅ PASSO 4: LER DADOS DA ORIGEM
  var dadosOrigem = abaOrigem.getDataRange();
  var numColunasOrigem = dadosOrigem.getNumColumns();
  var numLinhasOrigem = dadosOrigem.getNumRows();
  
  Logger.log("Pagar_Flow: Lendo " + numLinhasOrigem + " linhas x " + numColunasOrigem + " colunas (A-X)");

  // ✅ PASSO 5: COPIAR VALORES (sem fórmulas)
  planilha.toast('Copiando valores...', '📋 Pagar Flow', -1);
  dadosOrigem.copyTo(abaDestino.getRange(1, 1), {contentsOnly: true});
  SpreadsheetApp.flush();

  // ✅ PASSO 6: COPIAR FORMATAÇÃO
  planilha.toast('Copiando formatação...', '🎨 Pagar Flow', -1);
  dadosOrigem.copyTo(abaDestino.getRange(1, 1), {formatOnly: true});
  SpreadsheetApp.flush();

  // ✅ PASSO 7: COPIAR LARGURAS DE COLUNA
  for (var col = 1; col <= numColunasOrigem; col++) {
    var larguraOrigem = abaOrigem.getColumnWidth(col);
    abaDestino.setColumnWidth(col, larguraOrigem);
  }
  SpreadsheetApp.flush();

  // ✅ PASSO 8: TIMESTAMP DE BACKUP
  var dataHoraAtual = new Date();
  var celulaTimestamp = abaDestino.getRange('A1');
  celulaTimestamp.setValue('Último backup Pagar: ' + Utilities.formatDate(dataHoraAtual, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'));
  celulaTimestamp.setFontColor('#FFFFFF');
  
  planilha.toast('Data/Hora: ' + Utilities.formatDate(dataHoraAtual, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'), '✅ Pagar_Flow copiado (' + numColunasOrigem + ' cols)', 5);
  Logger.log("Pagar_Flow: Backup concluído - " + numLinhasOrigem + " linhas x " + numColunasOrigem + " colunas");
}


// Função 2: Copiar de Receber_Flow para Flow_save a partir da coluna AB (valores + formato)
// ✅ SEQUÊNCIA CORRIGIDA: Remove filtros → Limpa destino → Copia dados
function copiarReceberFlow() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var abaOrigem = planilha.getSheetByName('Receber_Flow');
  var abaDestino = planilha.getSheetByName('Flow_save');
  
  if (!abaOrigem) {
    planilha.toast('Aba "Receber_Flow" não encontrada!', '⚠️ Erro', 5);
    return;
  }
  if (!abaDestino) {
    planilha.toast('Aba "Flow_save" não encontrada!', '⚠️ Erro', 5);
    return;
  }

  // ✅ PASSO 1: REMOVER FILTROS DA ORIGEM (crítico!)
  var filtroOrigem = abaOrigem.getFilter();
  if (filtroOrigem) {
    filtroOrigem.remove();
    Logger.log("Receber_Flow: Filtro removido da ORIGEM");
  }

  // ✅ PASSO 2: REMOVER FILTROS DO DESTINO (crítico!)
  var filtroDestino = abaDestino.getFilter();
  if (filtroDestino) {
    filtroDestino.remove();
    Logger.log("Flow_save: Filtro removido do DESTINO");
  }
  
  SpreadsheetApp.flush(); // Garante que filtros foram removidos

  // ✅ PASSO 3: LER DADOS DA ORIGEM
  var dadosOrigem = abaOrigem.getDataRange();
  var numColunasOrigem = dadosOrigem.getNumColumns();
  var numLinhasOrigem = dadosOrigem.getNumRows();
  
  Logger.log("Receber_Flow: Lendo " + numLinhasOrigem + " linhas x " + numColunasOrigem + " colunas (A-U)");

  // ✅ PASSO 4: LIMPAR ÁREA DE DESTINO (a partir da coluna AB = 28)
  planilha.toast('Limpando área Receber em Flow_save...', '🧹 Receber Flow', -1);
  var ultimaColuna = abaDestino.getMaxColumns();
  var ultimaLinha = abaDestino.getMaxRows();
  
  if (ultimaColuna >= 28) {
    // Limpa desde AB até o fim, ou até cobrir todas as colunas da origem
    var colunasParaLimpar = Math.max(numColunasOrigem, ultimaColuna - 27);
    abaDestino.getRange(1, 28, ultimaLinha, colunasParaLimpar).clear();
    SpreadsheetApp.flush();
    Logger.log("Flow_save: Limpou " + colunasParaLimpar + " colunas a partir de AB (col 28)");
  }

  // ✅ PASSO 5: COPIAR VALORES (sem fórmulas) a partir da coluna AB
  planilha.toast('Copiando valores...', '📋 Receber Flow', -1);
  dadosOrigem.copyTo(abaDestino.getRange(1, 28), {contentsOnly: true});
  SpreadsheetApp.flush();

  // ✅ PASSO 6: COPIAR FORMATAÇÃO
  planilha.toast('Copiando formatação...', '🎨 Receber Flow', -1);
  dadosOrigem.copyTo(abaDestino.getRange(1, 28), {formatOnly: true});
  SpreadsheetApp.flush();

  // ✅ PASSO 7: COPIAR LARGURAS DE COLUNA
  for (var col = 1; col <= numColunasOrigem; col++) {
    var larguraOrigem = abaOrigem.getColumnWidth(col);
    abaDestino.setColumnWidth(col + 27, larguraOrigem); // +27 porque começa em AB (col 28)
  }
  SpreadsheetApp.flush();

  // ✅ PASSO 8: TIMESTAMP DE BACKUP
  var dataHoraAtual = new Date();
  var celulaTimestamp = abaDestino.getRange('AB1');
  celulaTimestamp.setValue('Último backup Receber: ' + Utilities.formatDate(dataHoraAtual, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'));
  celulaTimestamp.setFontColor('#FFFFFF');
  
  planilha.toast('Data/Hora: ' + Utilities.formatDate(dataHoraAtual, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'), '✅ Receber_Flow copiado (' + numColunasOrigem + ' cols)', 5);
  Logger.log("Receber_Flow: Backup concluído - " + numLinhasOrigem + " linhas x " + numColunasOrigem + " colunas");
}


// Função 3: Copiar de Previsto para Previsto_save (valores + formato, preservando gráficos)
// ✅ SEQUÊNCIA CORRIGIDA: Remove filtros → Limpa destino → Copia dados
function copiarPrevisto() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();
  var abaOrigem = planilha.getSheetByName('Previsto');
  var abaDestino = planilha.getSheetByName('Previsto_save');
  
  if (!abaOrigem) {
    planilha.toast('Aba "Previsto" não encontrada!', '⚠️ Erro', 5);
    return;
  }
  if (!abaDestino) {
    planilha.toast('Aba "Previsto_save" não encontrada!', '⚠️ Erro', 5);
    return;
  }

  // ✅ PASSO 1: REMOVER FILTROS DA ORIGEM (crítico!)
  var filtroOrigem = abaOrigem.getFilter();
  if (filtroOrigem) {
    filtroOrigem.remove();
    Logger.log("Previsto: Filtro removido da ORIGEM");
  }

  // ✅ PASSO 2: REMOVER FILTROS DO DESTINO (crítico!)
  var filtroDestino = abaDestino.getFilter();
  if (filtroDestino) {
    filtroDestino.remove();
    Logger.log("Previsto_save: Filtro removido do DESTINO");
  }
  
  SpreadsheetApp.flush(); // Garante que filtros foram removidos

  // ✅ PASSO 3: LIMPAR DESTINO (apenas conteúdo/formatação, preserva gráficos)
  planilha.toast('Limpando Previsto_save...', '🧹 Previsto', -1);
  var ultimaLinha = abaDestino.getMaxRows();
  var ultimaColuna = abaDestino.getMaxColumns();
  abaDestino.getRange(1, 1, ultimaLinha, ultimaColuna).clear();
  SpreadsheetApp.flush();
  Logger.log("Previsto_save: Destino limpo (gráficos preservados)");

  // ✅ PASSO 4: LER DADOS DA ORIGEM
  var dadosOrigem = abaOrigem.getDataRange();
  var numColunasOrigem = dadosOrigem.getNumColumns();
  var numLinhasOrigem = dadosOrigem.getNumRows();
  
  Logger.log("Previsto: Lendo " + numLinhasOrigem + " linhas x " + numColunasOrigem + " colunas");

  // ✅ PASSO 5: COPIAR VALORES (sem fórmulas)
  planilha.toast('Copiando valores...', '📋 Previsto', -1);
  dadosOrigem.copyTo(abaDestino.getRange(1, 1), {contentsOnly: true});
  SpreadsheetApp.flush();

  // ✅ PASSO 6: COPIAR FORMATAÇÃO
  planilha.toast('Copiando formatação...', '🎨 Previsto', -1);
  dadosOrigem.copyTo(abaDestino.getRange(1, 1), {formatOnly: true});
  SpreadsheetApp.flush();

  // ✅ PASSO 7: COPIAR LARGURAS DE COLUNA
  for (var col = 1; col <= numColunasOrigem; col++) {
    var larguraOrigem = abaOrigem.getColumnWidth(col);
    abaDestino.setColumnWidth(col, larguraOrigem);
  }
  SpreadsheetApp.flush();

  // ✅ PASSO 8: TIMESTAMP DE BACKUP
  var dataHoraAtual = new Date();
  var celulaTimestamp = abaDestino.getRange('A1');
  celulaTimestamp.setValue('Último backup Previsto: ' + Utilities.formatDate(dataHoraAtual, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'));
  celulaTimestamp.setFontColor('#FFFFFF');
  
  planilha.toast('Data/Hora: ' + Utilities.formatDate(dataHoraAtual, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'), '✅ Previsto copiado', 5);
  Logger.log("Previsto: Backup concluído - " + numLinhasOrigem + " linhas x " + numColunasOrigem + " colunas");
}


// Função mestre: Executar backup completo (Pagar + Receber + Previsto)
function copiarTodosFlows() {
  var planilha = SpreadsheetApp.getActiveSpreadsheet();

  planilha.toast('Iniciando backup completo...', '🔄 Backup Total', -1);

  try {
    // 1. Copiar Pagar_Flow
    planilha.toast('1/3 - Copiando Pagar_Flow...', '🔄 Backup Total', -1);
    copiarPagarFlow();
    Utilities.sleep(1500);

    // 2. Copiar Receber_Flow
    planilha.toast('2/3 - Copiando Receber_Flow...', '🔄 Backup Total', -1);
    copiarReceberFlow();
    Utilities.sleep(1500);

    // 3. Copiar Previsto
    planilha.toast('3/3 - Copiando Previsto...', '🔄 Backup Total', -1);
    copiarPrevisto();

    // Conclusão
    var dataHoraAtual = new Date();
    planilha.toast(
      'Backup completo finalizado em: ' +
        Utilities.formatDate(dataHoraAtual, Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm:ss'),
      '✅ Backup Total Concluído',
      8
    );
    Logger.log("=== BACKUP COMPLETO FINALIZADO ===");
    
  } catch (erro) {
    planilha.toast('Erro durante backup: ' + erro.toString(), '❌ Erro', 10);
    Logger.log('ERRO em copiarTodosFlows: ' + erro.toString());
  }
}

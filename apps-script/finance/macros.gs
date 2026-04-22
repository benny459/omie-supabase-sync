// 1. Limpa os campos de critérios no topo
function Macro_PagarFlowFilter() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Lista mantida, adicione novas células se tiver criado mais campos de filtro
  var celulasParaLimpar = [
    'A1', 'B1', 'C1', 'D1', 'E1', 'G1', 'I1', 
    'B2', 'C2', 'B3', 'C3', 'B4', 'C4', 'B5', 'C5'
  ];
  
  celulasParaLimpar.forEach(function(celula) {
    var range = sheet.getRange(celula);
    if (!range.isPartOfMerge()) { // Evita erro em células mescladas
      range.clearContent();
    }
  });
}

// 2. Remove filtros visuais (Pagar)
function RemoveFiltrosVisuais_pagar() {
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var filtro = sheet.getFilter();
  if (filtro) {
    filtro.remove();
    Logger.log("Filtro removido.");
  }
};

// 3. Aplica o filtro cobrindo o novo tamanho (A5:Z)
function FilterPagar() {
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var ultimaLinha = sheet.getLastRow();
  
  // Remove se já existir para evitar erro ao criar novo
  if (sheet.getFilter()) {
    sheet.getFilter().remove();
  }
  
  // Aplica o filtro da linha 5 até a última, da coluna A até Z (26)
  if (ultimaLinha > 5) {
    sheet.getRange(5, 1, ultimaLinha - 4, 26).createFilter();
  }
};

// 4. Reseta o filtro e aponta para Z5 (Data de Hoje)
function Resetfilterpagar() {
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var filtro = sheet.getFilter();
  
  // Remove o filtro atual
  if (filtro) {
    filtro.remove();
  }
  
  var ultimaLinha = sheet.getLastRow();
  
  // Recria o filtro no intervalo atualizado A5:Z
  if (ultimaLinha > 5) {
    sheet.getRange(5, 1, ultimaLinha - 4, 26).createFilter();
  }
  
  // 🎯 Conforme solicitado: Aponta para Z5
  sheet.getRange('Z5').activate();
  Logger.log("Filtro resetado e cursor em Z5.");
};

// 5. Remove filtro (Receber) - Adequado para o novo tamanho se necessário
function Removefilter_receber() {
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  var filtro = sheet.getFilter();
  if (filtro) {
    filtro.remove();
  }
};

// 6. Navegação rápida para o campo de data hoje
function Hoje_pagar() {
  var sheet = SpreadsheetApp.getActive().getActiveSheet();
  // Centraliza o foco na célula Z5
  sheet.getRange('Z5').activate();
};
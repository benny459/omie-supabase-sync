function limparFiltros() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName("Receber_Flow");

  const slicers = sh.getSlicers();
  if (!slicers || slicers.length === 0) {
    ss.toast("Nenhum segmentador (slicer) encontrado na aba 'Receber_Flow'.");
    return;
  }

  let limpos = 0;
  slicers.forEach(s => {
    try {
      const col = s.getColumnPosition();         // coluna (1-index) que o slicer filtra
      if (col != null) {
        s.setColumnFilterCriteria(col, null);    // null => resetar para “Todos”
        limpos++;
      }
    } catch (e) {
      console.warn(`Falha ao limpar slicer '${s.getTitle && s.getTitle()}' — ${e}`);
    }
  });

  ss.toast(`Filtros limpos em ${limpos} segmentadores ✅`);
}

function analisarEspacoPlanilha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var totalCelulas = 0;
  var totalUsadas = 0;
  
  Logger.log("╔═══════════════════════════════════════════════════════════════╗");
  Logger.log("║         ANÁLISE COMPLETA DE USO DE CÉLULAS                    ║");
  Logger.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  // Tabela de abas
  Logger.log("┌─────────────────────────┬────────────┬─────────────┬──────────────────┬──────────────────┐");
  Logger.log("│ ABA                     │ LINHAS     │ COLUNAS     │ CÉLULAS TOTAIS   │ CÉLULAS USADAS   │");
  Logger.log("├─────────────────────────┼────────────┼─────────────┼──────────────────┼──────────────────┤");
  
  var dadosAbas = [];
  
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var nome = sheet.getName();
    var lastRow = sheet.getLastRow();
    var maxRows = sheet.getMaxRows();
    var lastCol = sheet.getLastColumn();
    var maxCols = sheet.getMaxColumns();
    var celulasAba = maxRows * maxCols;
    var celulasUsadasAba = lastRow * lastCol;
    
    totalCelulas += celulasAba;
    totalUsadas += celulasUsadasAba;
    
    dadosAbas.push({
      nome: nome,
      maxRows: maxRows,
      maxCols: maxCols,
      lastRow: lastRow,
      lastCol: lastCol,
      celulas: celulasAba,
      usadas: celulasUsadasAba
    });
    
    // Formatar nome da aba (max 23 chars)
    var nomeFormatado = nome.length > 23 ? nome.substring(0, 20) + "..." : nome;
    while (nomeFormatado.length < 23) nomeFormatado += " ";
    
    // Formatar números
    var linhasStr = maxRows.toLocaleString();
    while (linhasStr.length < 10) linhasStr = " " + linhasStr;
    
    var colsStr = maxCols.toLocaleString();
    while (colsStr.length < 11) colsStr = " " + colsStr;
    
    var celulasStr = celulasAba.toLocaleString();
    while (celulasStr.length < 16) celulasStr = " " + celulasStr;
    
    var usadasStr = celulasUsadasAba.toLocaleString();
    while (usadasStr.length < 16) usadasStr = " " + usadasStr;
    
    Logger.log("│ " + nomeFormatado + " │" + linhasStr + " │" + colsStr + " │" + celulasStr + " │" + usadasStr + " │");
  }
  
  Logger.log("└─────────────────────────┴────────────┴─────────────┴──────────────────┴──────────────────┘\n");
  
  // Resumo
  var limite = 10000000;
  var disponivel = limite - totalCelulas;
  var percentualUsado = (totalCelulas / limite * 100).toFixed(2);
  var percentualReal = (totalUsadas / limite * 100).toFixed(2);
  var desperdicio = totalCelulas - totalUsadas;
  var percentualDesperdicio = (desperdicio / totalCelulas * 100).toFixed(2);
  
  Logger.log("╔═══════════════════════════════════════════════════════════════╗");
  Logger.log("║                    📊 RESUMO GERAL                            ║");
  Logger.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  Logger.log("📦 CÉLULAS ALOCADAS:     " + totalCelulas.toLocaleString() + " células");
  Logger.log("✅ CÉLULAS USADAS:       " + totalUsadas.toLocaleString() + " células");
  Logger.log("🗑️  CÉLULAS VAZIAS:       " + desperdicio.toLocaleString() + " células (" + percentualDesperdicio + "%)");
  Logger.log("");
  Logger.log("🎯 LIMITE GOOGLE:        10.000.000 células");
  Logger.log("📊 USO ATUAL:            " + percentualUsado + "%");
  Logger.log("📊 USO REAL:             " + percentualReal + "%");
  Logger.log("");
  
  if (disponivel > 0) {
    Logger.log("✅ ESPAÇO DISPONÍVEL:    " + disponivel.toLocaleString() + " células");
    var linhas258x30 = 258 * 30;
    if (disponivel >= linhas258x30) {
      Logger.log("✅ Cabe os 258 novos registros (precisam " + linhas258x30.toLocaleString() + " células)");
    } else {
      Logger.log("❌ NÃO cabe os 258 novos (precisam " + linhas258x30.toLocaleString() + ", faltam " + (linhas258x30 - disponivel).toLocaleString() + ")");
    }
  } else {
    Logger.log("❌ ACIMA DO LIMITE:      " + Math.abs(disponivel).toLocaleString() + " células");
  }
  
  Logger.log("");
  Logger.log("╔═══════════════════════════════════════════════════════════════╗");
  Logger.log("║                 🔧 RECOMENDAÇÕES                              ║");
  Logger.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  // Ordenar abas por desperdício
  dadosAbas.sort(function(a, b) {
    return (b.celulas - b.usadas) - (a.celulas - a.usadas);
  });
  
  Logger.log("🎯 Abas com MAIS ESPAÇO DESPERDIÇADO (maiores candidatas para limpeza):\n");
  
  for (var i = 0; i < Math.min(5, dadosAbas.length); i++) {
    var aba = dadosAbas[i];
    var desperdicioAba = aba.celulas - aba.usadas;
    var percDespAba = (desperdicioAba / aba.celulas * 100).toFixed(1);
    
    Logger.log((i + 1) + ". " + aba.nome);
    Logger.log("   📦 Alocadas: " + aba.celulas.toLocaleString() + 
               " | ✅ Usadas: " + aba.usadas.toLocaleString() + 
               " | 🗑️ Vazias: " + desperdicioAba.toLocaleString() + " (" + percDespAba + "%)");
    
    var linhasVazias = aba.maxRows - aba.lastRow;
    var colunasVazias = aba.maxCols - aba.lastCol;
    
    if (linhasVazias > 100) {
      Logger.log("   ⚠️ Pode deletar ~" + (linhasVazias - 100).toLocaleString() + " linhas vazias");
    }
    if (colunasVazias > 5) {
      Logger.log("   ⚠️ Pode deletar ~" + (colunasVazias - 5).toLocaleString() + " colunas vazias");
    }
    Logger.log("");
  }
  
  Logger.log("💡 Execute: limparEspacoVazioTodasAbas() para liberar espaço automaticamente");
  
  Logger.log("\n" + "=".repeat(67));
}

// Função de limpeza (incluída também)
function limparEspacoVazioTodasAbas() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  
  Logger.log("╔═══════════════════════════════════════════════════════════════╗");
  Logger.log("║            🧹 LIMPANDO ESPAÇO VAZIO                           ║");
  Logger.log("╚═══════════════════════════════════════════════════════════════╝\n");
  
  var totalLinhasDeletadas = 0;
  var totalColunasDeletadas = 0;
  
  for (var i = 0; i < sheets.length; i++) {
    var sheet = sheets[i];
    var nome = sheet.getName();
    
    Logger.log("📋 Aba: " + nome);
    
    var lastRow = sheet.getLastRow();
    var maxRows = sheet.getMaxRows();
    var lastCol = sheet.getLastColumn();
    var maxCols = sheet.getMaxColumns();
    
    Logger.log("   Antes: " + maxRows + " linhas × " + maxCols + " colunas = " + (maxRows * maxCols).toLocaleString() + " células");
    
    var linhasDeletadas = 0;
    var colunasDeletadas = 0;
    
    // Deletar linhas vazias (deixar 100 de buffer)
    if (maxRows > lastRow + 100) {
      var linhasParaDeletar = maxRows - lastRow - 100;
      try {
        sheet.deleteRows(lastRow + 101, linhasParaDeletar);
        linhasDeletadas = linhasParaDeletar;
        totalLinhasDeletadas += linhasParaDeletar;
        Logger.log("   ✅ Deletadas " + linhasParaDeletar.toLocaleString() + " linhas vazias");
      } catch (e) {
        Logger.log("   ⚠️ Erro ao deletar linhas: " + e.message);
      }
    }
    
    // Deletar colunas vazias (deixar 5 de buffer)
    if (maxCols > lastCol + 5) {
      var colunasParaDeletar = maxCols - lastCol - 5;
      try {
        sheet.deleteColumns(lastCol + 6, colunasParaDeletar);
        colunasDeletadas = colunasParaDeletar;
        totalColunasDeletadas += colunasParaDeletar;
        Logger.log("   ✅ Deletadas " + colunasParaDeletar.toLocaleString() + " colunas vazias");
      } catch (e) {
        Logger.log("   ⚠️ Erro ao deletar colunas: " + e.message);
      }
    }
    
    var maxRowsDepois = sheet.getMaxRows();
    var maxColsDepois = sheet.getMaxColumns();
    var celulasLiberadas = (maxRows * maxCols) - (maxRowsDepois * maxColsDepois);
    
    if (celulasLiberadas > 0) {
      Logger.log("   Depois: " + maxRowsDepois + " linhas × " + maxColsDepois + " colunas = " + (maxRowsDepois * maxColsDepois).toLocaleString() + " células");
      Logger.log("   💾 Liberadas: " + celulasLiberadas.toLocaleString() + " células");
    } else {
      Logger.log("   ℹ️ Nada para limpar nesta aba");
    }
    
    Logger.log("");
    Utilities.sleep(500);
  }
  
  Logger.log("╔═══════════════════════════════════════════════════════════════╗");
  Logger.log("║               ✅ LIMPEZA CONCLUÍDA                            ║");
  Logger.log("╚═══════════════════════════════════════════════════════════════╝\n");
  Logger.log("📊 Total deletado:");
  Logger.log("   🗑️ Linhas: " + totalLinhasDeletadas.toLocaleString());
  Logger.log("   🗑️ Colunas: " + totalColunasDeletadas.toLocaleString());
  Logger.log("\n💡 Execute analisarEspacoPlanilha() novamente para ver o resultado!");
}

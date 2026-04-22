function criarTabelaDinamicaCompleta() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let abaDestino = ss.getSheetByName("Novas P&R");
  
  // Cria a aba se não existir
  if (!abaDestino) {
    abaDestino = ss.insertSheet("Novas P&R");
  }
  
  // ⭐ Encontra a próxima linha disponível (com 5 linhas de espaçamento)
  const ultimaLinhaUsada = abaDestino.getLastRow();
  const proximaLinha = ultimaLinhaUsada === 0 ? 1 : ultimaLinhaUsada + 6;
  
  Logger.log("📍 Inserindo tabela na linha: " + proximaLinha);
  
  // ========== CONTAS A PAGAR ==========
  const abaContasPagar = ss.getSheetByName("ContasPagar_Consolidada");
  const dadosContasPagar = processarContasPagar(abaContasPagar);
  
  // ========== CONTAS A RECEBER ==========
  const abaContasReceber = ss.getSheetByName("ContasReceber_Consolidada");
  const dadosContasReceber = processarContasReceber(abaContasReceber);
  
  // ========== ESCREVE CONTAS A PAGAR (Colunas A-E) ==========
  escreverDados(abaDestino, dadosContasPagar, proximaLinha, 1, "CONTAS A PAGAR");
  
  // ========== ESCREVE CONTAS A RECEBER (Colunas H-L) ==========
  escreverDados(abaDestino, dadosContasReceber, proximaLinha, 8, "CONTAS A RECEBER");
}


// Processa dados de Contas a Pagar
function processarContasPagar(abaOrigem) {
  const dados = abaOrigem.getDataRange().getValues();
  
  // Colunas: AI=35, BA=53, AP=42, G=7, E=5
  const colCriacao = 34; // AI
  const colCategoria = 52; // BA
  const colNome = 41; // AP
  const colValor = 6; // G
  const colVencimento = 4; // E
  
  return processarDados(dados, colCriacao, colVencimento, colCategoria, colNome, colValor);
}


// Processa dados de Contas a Receber
function processarContasReceber(abaOrigem) {
  const dados = abaOrigem.getDataRange().getValues();
  
  // Colunas: AL=38, E=5, BP=68, AS=45, G=7
  const colCriacao = 37; // AL
  const colVencimento = 4; // E
  const colCategoria = 67; // BP
  const colNome = 44; // AS
  const colValor = 6; // G
  
  return processarDados(dados, colCriacao, colVencimento, colCategoria, colNome, colValor);
}


// Função genérica para processar dados
function processarDados(dados, colCriacao, colVencimento, colCategoria, colNome, colValor) {
  const hoje = new Date();
  const mesAtual = hoje.getMonth();
  const anoAtual = hoje.getFullYear();
  
  const dadosPorCategoria = {};
  
  for (let i = 1; i < dados.length; i++) {
    const dataCriacao = new Date(dados[i][colCriacao]);
    const dataVencimento = new Date(dados[i][colVencimento]);
    
    // Verifica se criação e vencimento são do mês atual
    if (dataCriacao.getMonth() === mesAtual && 
        dataCriacao.getFullYear() === anoAtual &&
        dataVencimento.getMonth() === mesAtual && 
        dataVencimento.getFullYear() === anoAtual) {
      
      const categoria = dados[i][colCategoria] || "Sem Categoria";
      const nome = dados[i][colNome] || "Sem Nome";
      const valor = parseFloat(dados[i][colValor]) || 0;
      
      if (!dadosPorCategoria[categoria]) {
        dadosPorCategoria[categoria] = [];
      }
      
      dadosPorCategoria[categoria].push({
        criacao: dataCriacao,
        nome: nome,
        valor: valor,
        vencimento: dataVencimento
      });
    }
  }
  
  return dadosPorCategoria;
}


// ⭐ MODIFICADO: Escreve dados na planilha COM TIMESTAMP e suporte para múltiplas tabelas
function escreverDados(abaDestino, dadosPorCategoria, linhaInicial, colunaInicial, titulo) {
  // ⭐ Cria timestamp usando timezone automático
  const timezone = Session.getScriptTimeZone();
  const timestamp = Utilities.formatDate(new Date(), timezone, "dd/MM/yyyy HH:mm:ss");
  const timestampTexto = "Gerado em: " + timestamp;
  
  // ⭐ Linha do timestamp (antes do cabeçalho)
  const resultado = [[timestampTexto, "", "", "", ""]];
  
  // Linha do cabeçalho principal
  resultado.push([titulo, "Data Criação", "Nome", "Valor", "Vencimento"]);
  
  // Ordena categorias alfabeticamente
  const categoriasOrdenadas = Object.keys(dadosPorCategoria).sort();
  
  for (const categoria of categoriasOrdenadas) {
    // Adiciona o cabeçalho da categoria
    resultado.push([categoria, "", "", "", ""]);
    
    let subtotal = 0;
    
    // Adiciona os itens da categoria
    for (const item of dadosPorCategoria[categoria]) {
      resultado.push([
        "  " + item.nome,
        item.criacao,
        item.nome,
        item.valor,
        item.vencimento
      ]);
      subtotal += item.valor;
    }
    
    // Adiciona linha de subtotal
    resultado.push([
      "Subtotal " + categoria,
      "",
      "",
      subtotal,
      ""
    ]);
    
    // Linha em branco para separação
    resultado.push(["", "", "", "", ""]);
  }
  
  // Calcula total geral
  let totalGeral = 0;
  for (const categoria in dadosPorCategoria) {
    for (const item of dadosPorCategoria[categoria]) {
      totalGeral += item.valor;
    }
  }
  
  // Adiciona total geral
  resultado.push(["TOTAL GERAL", "", "", totalGeral, ""]);
  
  // Escreve na aba destino
  if (resultado.length > 2) { // Mudado de > 1 para > 2 (conta timestamp + header)
    const numLinhas = resultado.length;
    const numColunas = resultado[0].length;
    
    abaDestino.getRange(linhaInicial, colunaInicial, numLinhas, numColunas).setValues(resultado);
    
    // ⭐ Formata linha de TIMESTAMP
    abaDestino.getRange(linhaInicial, colunaInicial, 1, numColunas)
      .setFontWeight("bold")
      .setFontStyle("italic")
      .setBackground("#EFEFEF")
      .setFontColor("#666666")
      .setFontSize(9)
      .setHorizontalAlignment("left");
    
    // ⭐ Formata o cabeçalho principal (agora na linha linhaInicial + 1)
    abaDestino.getRange(linhaInicial + 1, colunaInicial, 1, numColunas)
      .setFontWeight("bold")
      .setBackground(colunaInicial === 1 ? "#4A86E8" : "#38761D") // Azul para Pagar, Verde para Receber
      .setFontColor("#FFFFFF")
      .setFontSize(11);
    
    // Formata as linhas de categoria e subtotais (ajustado +1 por causa do timestamp)
    let linhaAtual = linhaInicial + 2; // Era 2, agora é linhaInicial + 2
    for (const categoria of categoriasOrdenadas) {
      // Formata cabeçalho da categoria
      abaDestino.getRange(linhaAtual, colunaInicial, 1, numColunas)
        .setFontWeight("bold")
        .setBackground("#D9D9D9")
        .setFontSize(10);
      
      const numItens = dadosPorCategoria[categoria].length;
      linhaAtual += numItens + 1;
      
      // Formata linha de subtotal
      abaDestino.getRange(linhaAtual, colunaInicial, 1, numColunas)
        .setFontWeight("bold")
        .setBackground("#F3F3F3")
        .setFontStyle("italic");
      
      linhaAtual += 2;
    }
    
    // Formata linha de total geral
    abaDestino.getRange(linhaInicial + numLinhas - 1, colunaInicial, 1, numColunas)
      .setFontWeight("bold")
      .setBackground(colunaInicial === 1 ? "#CC0000" : "#0B5394") // Vermelho para Pagar, Azul escuro para Receber
      .setFontColor("#FFFFFF")
      .setFontSize(11);
    
    // Formata colunas de valores como moeda (ajustado +1)
    abaDestino.getRange(linhaInicial + 2, colunaInicial + 3, numLinhas - 2, 1)
      .setNumberFormat("R$ #,##0.00");
    
    // Formata colunas de datas (ajustado +1)
    abaDestino.getRange(linhaInicial + 2, colunaInicial + 1, numLinhas - 2, 1)
      .setNumberFormat("dd/MM/yyyy");
    abaDestino.getRange(linhaInicial + 2, colunaInicial + 4, numLinhas - 2, 1)
      .setNumberFormat("dd/MM/yyyy");
    
    // Ajusta largura das colunas
    for (let i = 0; i < numColunas; i++) {
      abaDestino.autoResizeColumn(colunaInicial + i);
    }
    
    Logger.log("✅ " + titulo + " escrito em " + numLinhas + " linhas (linha " + linhaInicial + ")");
    
  } else {
    abaDestino.getRange(linhaInicial, colunaInicial).setValue("Nenhum dado encontrado em " + timestamp);
    Logger.log("⚠️ " + titulo + ": sem dados");
  }
}

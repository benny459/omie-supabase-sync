/**
 * ════════════════════════════════════════════════════════════════
 * SCRIPT CONSOLIDAÇÃO PV + OS - V10.5 (MAPEAMENTO DINÂMICO COLUNA M)
 * 1. PV: Q(Vlr), Z(Emissão), D(Prev), AH(Cli), AL(Proj), AJ(Cat), AN(Etapa), AQ(NF), AP(Fat), AV(Tipo)
 * 2. OS: G(Vlr), P(Emissão), F(Prev), AC(Cli), AG(Proj), AF(Cat), AH(Etapa), AQ(NF), Q(Fat), AP(Tipo)
 * ════════════════════════════════════════════════════════════════
 */

function criarConsolidacaoPVOS() {
  var horaInicio = new Date().getTime(); 
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const props = PropertiesService.getScriptProperties();
  
  let totalRegistrosConsolidados = 0;

  if (props.getProperty('LOCK_CONSOLIDACAO') === 'TRUE') {
    Logger.log('⚠️ Consolidação já está rodando. Ignorando chamada.');
    return 0;
  }

  try {
    props.setProperty('LOCK_CONSOLIDACAO', 'TRUE');
    
    let abaResultado = ss.getSheetByName('Consolidação_PV_OS');
    let abaExistia = true;
    
    if (!abaResultado) {
      abaResultado = ss.insertSheet('Consolidação_PV_OS');
      abaExistia = false;
    }

    if (!abaExistia) {
      const cabecalhos = ['PV/OS', 'Tipo', 'Valor Total', 'Data de Emissão', 'Previsão', 'Cod. PV OS', 'Cliente', 'Data de Faturamento', 'Projeto', 'Categoria', 'Etapa', 'NF', 'Tipo de Venda'];
      abaResultado.getRange(1, 1, 1, cabecalhos.length).setValues([cabecalhos]);
      abaResultado.getRange(1, 1, 1, 13).setFontWeight('bold').setBackground('#4A86E8').setFontColor('#FFFFFF');
    } else {
      const ultimaLinha = abaResultado.getLastRow();
      if (ultimaLinha > 1) {
        abaResultado.getRange(2, 1, ultimaLinha - 1, abaResultado.getLastColumn()).clear();
      }
    }
    
    const dadosConsolidados = consolidarDados(ss);
    
    if (dadosConsolidados.length > 0) {
      abaResultado.getRange(2, 1, dadosConsolidados.length, 13).setValues(dadosConsolidados);
      totalRegistrosConsolidados = dadosConsolidados.length;
      formatarAbaConsolidacao(abaResultado);
      gravarLogAZ1(abaResultado, "SUCESSO", totalRegistrosConsolidados, horaInicio, "Consolidação concluída");
    } else {
      gravarLogAZ1(abaResultado, "SUCESSO", 0, horaInicio, "Nenhum dado encontrado para consolidar");
    }

  } catch (e) {
    if (ss.getSheetByName('Consolidação_PV_OS')) {
        gravarLogAZ1(ss.getSheetByName('Consolidação_PV_OS'), "ERRO", 0, horaInicio, e.message);
    }
    Logger.log("Erro na consolidação: " + e.message);
  } finally {
    props.deleteProperty('LOCK_CONSOLIDACAO');
  }
  
  return totalRegistrosConsolidados;
}

function consolidarDados(ss) {
  const pvSheet = ss.getSheetByName('PV_consolidado') || ss.getSheetByName('PedidosVenda');
  const osSheet = ss.getSheetByName('OS_consolidado') || ss.getSheetByName('OrdensServico');
  
  if (!pvSheet || !osSheet) return [];
  
  const dadosConsolidados = [];
  
  // --- PV (MAPEAMENTO ATUALIZADO) ---
  if (pvSheet.getLastRow() > 1) {
    const pvData = pvSheet.getDataRange().getValues();
    const pvMap = {};
    for (let i = 1; i < pvData.length; i++) {
        const pvNumero = pvData[i][2]; // Coluna C (Índice 2)
        if (pvNumero) {
            const chave = String(pvNumero);
            if (!pvMap[chave]) {
                pvMap[chave] = { 
                    valorTotal: 0, 
                    dataEmissao: pvData[i][25], // Coluna Z (Índice 25)
                    previsao: pvData[i][3],     // Coluna D (Índice 3)
                    cliente: pvData[i][33],      // Coluna AH (Índice 33)
                    faturamento: pvData[i][41],  // Coluna AP (Índice 41)
                    projeto: pvData[i][37],      // Coluna AL (Índice 37)
                    categoria: pvData[i][35],    // Coluna AJ (Índice 35)
                    etapa: pvData[i][39],        // Coluna AN (Índice 39)
                    nf: pvData[i][42],           // Coluna AQ (Índice 42)
                    tipoVenda: pvData[i][47]     // Coluna AV (Índice 47) - NOVO!
                };
            }
            pvMap[chave].valorTotal += Number(pvData[i][16] || 0); // Coluna Q (Índice 16)
        }
    }
    Object.keys(pvMap).forEach(num => {
        const p = pvMap[num];
        // Destino Coluna M (índice 12 do array abaixo) recebe p.tipoVenda
        dadosConsolidados.push([num, 'PV', p.valorTotal, p.dataEmissao, p.previsao, 'PV'+num, p.cliente, p.faturamento, p.projeto, p.categoria, p.etapa, p.nf, p.tipoVenda]);
    });
  }
  
  // --- OS (MAPEAMENTO ATUALIZADO) ---
  if (osSheet.getLastRow() > 1) {
      const osData = osSheet.getDataRange().getValues();
      const osMap = {};
      for (let i = 1; i < osData.length; i++) {
        const osNumero = osData[i][3]; // Coluna D (Índice 3)
        if (osNumero) {
          const chave = String(osNumero);
          if (!osMap[chave]) {
            osMap[chave] = { 
                valorTotal: Number(osData[i][6] || 0), // Coluna G (Índice 6)
                dataEmissao: osData[i][15],            // Coluna P (Índice 15)
                previsao: osData[i][5],               // Coluna F (Índice 5)
                cliente: osData[i][28],               // Coluna AC (Índice 28)
                faturamento: osData[i][16],            // Coluna Q (Índice 16)
                projeto: osData[i][32],               // Coluna AG (Índice 32)
                categoria: osData[i][31],             // Coluna AF (Índice 31)
                etapa: osData[i][33],                 // Coluna AH (Índice 33)
                nf: osData[i][42],                    // Coluna AQ (Índice 42)
                tipoVenda: osData[i][41]              // Coluna AP (Índice 41) - NOVO!
            };
          }
        }
      }
      
      Object.keys(osMap).forEach(num => {
        const o = osMap[num];
        // Destino Coluna M (índice 12 do array abaixo) recebe o.tipoVenda
        dadosConsolidados.push([num, 'OS', o.valorTotal, o.dataEmissao, o.previsao, 'OS'+num, o.cliente, o.faturamento, o.projeto, o.categoria, o.etapa, o.nf, o.tipoVenda]);
      });
  }
  
  return dadosConsolidados.sort((a, b) => {
      const dateA = new Date(a[3] || 0);
      const dateB = new Date(b[3] || 0);
      return dateB - dateA;
  });
}

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

function formatarAbaConsolidacao(aba) {
  const ultimaLinha = aba.getLastRow();
  if (ultimaLinha < 2) return;
  aba.getRange(2, 3, ultimaLinha - 1, 1).setNumberFormat('R$ #,##0.00');
  aba.getRange(2, 4, ultimaLinha - 1, 2).setNumberFormat('dd/mm/yyyy');
  aba.getRange(2, 8, ultimaLinha - 1, 1).setNumberFormat('dd/mm/yyyy');
  aba.setColumnWidth(7, 250); 
  aba.setColumnWidth(14, 400); 
  aba.setFrozenRows(1);
  aplicarFormatacaoTipo(aba, ultimaLinha);
}

function aplicarFormatacaoTipo(aba, ultimaLinha) {
  const range = aba.getRange(2, 2, ultimaLinha - 1, 1);
  const rulePV = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('PV').setBackground('#C9DAF8').setRanges([range]).build();
  const ruleOS = SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo('OS').setBackground('#B7E1CD').setRanges([range]).build();
  aba.setConditionalFormatRules([rulePV, ruleOS]);
}
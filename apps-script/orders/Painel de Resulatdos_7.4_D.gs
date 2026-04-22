/**
 * ============================================================
 * CONSOLIDACAO DE PEDIDOS - v7.4 (CORREÇÃO COLUNA R & MAPEAMENTO)
 * ============================================================
 * 1. Ajuste no mapeamento de Compras (Coluna R / Índice 17).
 * 2. Lógica de acumulação de metadados para IDs duplicados.
 * 3. Compatibilidade com Orquestrador V3.
 */

// --- CONFIGURAÇÃO DE DATA ---
var CONFIG_FILTRO = {
  dataInicio: '2024-01-01' 
};

var CONFIG_CONSOLIDACAO = {
  abaResultado: 'Painel de Resultados',
  abasOrigem: {
    smart: 'Smart_Consolidada',
    compras: 'Compras_consolidado',
    nf: 'NF_Consolidado',
    parciais: 'Pedidos Parciais'
  },
  corCabecalho: '#4A86E8'
};

var CONFIG_TIMESTAMP = {
  coluna: 58, // BF
  linha: 1,
  timezone: "Europe/Lisbon",
  formato: "dd/MM/yyyy HH:mm:ss",
  bgSucesso: "#D9EAD3",
  bgErro: "#F4CCCC"
};

var CONFIG_FINANCEIRO = {
  spreadsheetId: '1lodGkIBxO1es8fYcNmvKY-7M8Jft1wUDa2FX3RSM3rg',
  sheetReceber: 'ContasReceber_Consolidada',
  sheetPagar: 'ContasPagar_Consolidada', 
  colBusca_BS: 71, 
  colData_F: 6,    
  colValor_G: 7,   
  colParcela_L: 12,
  colStatus_O: 15, 
  colValor_AY: 51  
};

var CONFIG_VENDAS = {
  spreadsheetId: '14yjhkG9wNoHJsm7tRFq67qIFqO49wKYaR9y9u2gaEkU',
  sheetBaseOmie: 'Consolidação_PV_OS',
  sheetPVConsolidado: 'PV_consolidado',
  sheetOSConsolidado: 'OS_consolidado'
};

// ============================================================================
// 🚀 FUNÇÃO PRINCIPAL
// ============================================================================

function consolidarDados() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var abaResultado = ss.getSheetByName(CONFIG_CONSOLIDACAO.abaResultado) || ss.insertSheet(CONFIG_CONSOLIDACAO.abaResultado);
  
  var totalLinhasGeradas = 0;

  if (props.getProperty('LOCK_CONSOLIDAR') === 'TRUE') {
    Logger.log('⚠️ Consolidação já está rodando. Ignorando chamada.');
    return 0;
  }

  try {
    props.setProperty('LOCK_CONSOLIDAR', 'TRUE');
    Logger.log("🚀 Iniciando Consolidação v7.4...");

    var historicoRC = carregarHistoricoRC(abaResultado);
    var cabecalhos = getCabecalhosConsolidacaoPedidos();
    var larguraTotal = cabecalhos.length; 
    
    preservarCabecalhosELimparDados(abaResultado, larguraTotal, cabecalhos);
    
    totalLinhasGeradas = processarConsolidacaoV74(ss, abaResultado, larguraTotal, historicoRC);
    
    escreverTimestamp(abaResultado, true, "v7.4 Consolidado OK", totalLinhasGeradas);
    Logger.log("✅ Consolidação Concluída. Linhas: " + totalLinhasGeradas);

  } catch (e) {
    escreverTimestamp(abaResultado, false, "Erro: " + e.message, 0);
    Logger.log("❌ Erro Consolidação: " + e.stack);
    totalLinhasGeradas = 0;
  } finally {
    props.deleteProperty('LOCK_CONSOLIDAR');
  }

  return totalLinhasGeradas;
}

// ============================================================================
// 🧱 LÓGICA DE NEGÓCIO
// ============================================================================

function processarConsolidacaoV74(ss, abaResultado, largura, historicoRC) {
  var dataCorte = new Date(CONFIG_FILTRO.dataInicio);
  dataCorte.setHours(0, 0, 0, 0);
  var hoje = new Date(); 
  var isPrimeiraExecucao = (Object.keys(historicoRC).length === 0);

  // Carregar Dados das Abas
  var smartSheet = ss.getSheetByName(CONFIG_CONSOLIDACAO.abasOrigem.smart);
  var comprasSheet = ss.getSheetByName(CONFIG_CONSOLIDACAO.abasOrigem.compras);
  if (!smartSheet || !comprasSheet) throw new Error("Abas Smart ou Compras não encontradas.");
  
  var smartData = smartSheet.getDataRange().getValues();
  var comprasData = comprasSheet.getDataRange().getValues();
  
  // Vendas Omie (Externo)
  var ssVendas = SpreadsheetApp.openById(CONFIG_VENDAS.spreadsheetId);
  var baseOmieRaw = ssVendas.getSheetByName(CONFIG_VENDAS.sheetBaseOmie).getDataRange().getValues();
  
  var mapaBaseOmie = {}; 
  var listaChavesOmie = [];
  for(var i = 1; i < baseOmieRaw.length; i++) {
    var id = String(baseOmieRaw[i][5] || '').trim();
    if(id) {
      listaChavesOmie.push(id);
      mapaBaseOmie[id] = {
        data: baseOmieRaw[i][3], // Coluna D (E na planilha física)
        previsao: baseOmieRaw[i][4], 
        projeto: baseOmieRaw[i][8], 
        cliente: baseOmieRaw[i][6], 
        status: baseOmieRaw[i][10], 
        nfOmieRaw: String(baseOmieRaw[i][11] || ''), 
        dataFat: baseOmieRaw[i][7]
      };
    }
  }

  var mapFinanceiroCompleto = carregarMapaFinanceiroMultiplasParcelas(); 
  var mapVendasSoma = carregarMapaVendasTotalizadoOmie();
  var mapParciais = carregarMapaPedidosParciais(ss);
  var mapContasPagar = carregarMapaContasPagar(); 

  // --- 🛠️ CORREÇÃO DO MAPEAMENTO DE COMPRAS (COLUNA R) ---
  var comprasMap = {};
  for (var i = 1; i < comprasData.length; i++) {
    var pcK = String(comprasData[i][2] || '').trim(); // Coluna C
    if (pcK) {
      if (!comprasMap[pcK]) {
        comprasMap[pcK] = { 
          pcCustoOmie: 0, fp: "", st: "", stF: "", 
          dataEmissao_AN: "", dataReceb_AO: "", nfFornecedor: "", 
          categoriaCompra: "", projetoCompra: "", 
          dataPrevisaoCompra: "", dataCriacaoCompra: "" 
        };
      }
      // Acumula Custo (Coluna Y / Índice 24)
      comprasMap[pcK].pcCustoOmie += parseNumberBr(comprasData[i][24]); 

      // Preenche dados apenas se a célula não estiver vazia (evita sobrescrever com vázio)
      if (comprasData[i][17]) comprasMap[pcK].dataCriacaoCompra = comprasData[i][17]; // Coluna R
      if (comprasData[i][4])  comprasMap[pcK].dataPrevisaoCompra = comprasData[i][4];  // Coluna E
      if (comprasData[i][34]) comprasMap[pcK].fp = comprasData[i][34]; // AI
      if (comprasData[i][27]) comprasMap[pcK].st = comprasData[i][27]; // AB
      if (comprasData[i][38]) comprasMap[pcK].stF = comprasData[i][38]; // AM
      if (comprasData[i][39]) comprasMap[pcK].dataEmissao_AN = comprasData[i][39];
      if (comprasData[i][40]) comprasMap[pcK].dataReceb_AO = comprasData[i][40];
      if (comprasData[i][36]) comprasMap[pcK].nfFornecedor = comprasData[i][36]; // AK
      if (comprasData[i][32]) comprasMap[pcK].categoriaCompra = comprasData[i][32]; // AG
      if (comprasData[i][29]) comprasMap[pcK].projetoCompra = comprasData[i][29]; // AD
    }
  }

  var smartRawGrouped = {};
  for(var s = 1; s < smartData.length; s++) {
    var pvos = String(smartData[s][0]).trim();
    if(!pvos || pvos === "PV/OS") continue;
    if(!smartRawGrouped[pvos]) smartRawGrouped[pvos] = [];
    smartRawGrouped[pvos].push(smartData[s]);
  }

  var chavesMestras = [...new Set([...listaChavesOmie, ...Object.keys(smartRawGrouped)])];
  var bufferTemp = [];
  var contadorPorPV = {};

  chavesMestras.forEach(function(chave) {
    var rowOmie = mapaBaseOmie[chave] || null;
    var rawRowsSmart = smartRawGrouped[chave] || [];

    var passarNoFiltro = false;
    if (rowOmie && rowOmie.data) {
      var dataItem = parseDataSegura(rowOmie.data);
      if (dataItem) {
        dataItem.setHours(0,0,0,0);
        if (dataItem.getTime() >= dataCorte.getTime()) passarNoFiltro = true;
      }
    }
    if (!passarNoFiltro) return; 

    var smartUnicoList = [];
    var rcsCobertosPorPC = new Set();
    var linhasComPC = [];
    var linhasSoRC = [];

    rawRowsSmart.forEach(function(r) {
      var pcId = String(r[15] || '').trim();
      var rcId = String(r[13] || '').trim();
      if (pcId) {
        if (rcId) rcsCobertosPorPC.add(rcId);
        linhasComPC.push({ r: r, pc: pcId, rc: rcId });
      } else if (rcId) {
        linhasSoRC.push({ r: r, pc: "", rc: rcId });
      }
    });

    var pcJaProcessado = new Set();
    linhasComPC.forEach(function(item) {
      if (!pcJaProcessado.has(item.pc)) {
        var custoRC_Linha = 0, custoPC_Smart_Linha = 0;
        rawRowsSmart.forEach(subR => {
             if(String(subR[15]||'').trim() === item.pc) {
                 custoRC_Linha += parseNumberBr(subR[14]); 
                 custoPC_Smart_Linha += parseNumberBr(subR[16]);
             }
        });
        smartUnicoList.push({ row: item.r, pc: item.pc, rc: item.rc, custoRC: custoRC_Linha, custoPCSmart: custoPC_Smart_Linha });
        pcJaProcessado.add(item.pc);
      }
    });

    var rcJaProcessado = new Set();
    linhasSoRC.forEach(function(item) {
      if (!rcsCobertosPorPC.has(item.rc) && !rcJaProcessado.has(item.rc)) {
        var custoRC_Linha = 0;
         rawRowsSmart.forEach(subR => {
             if(String(subR[13]||'').trim() === item.rc && !String(subR[15]||'').trim()) {
                 custoRC_Linha += parseNumberBr(subR[14]);
             }
        });
        smartUnicoList.push({ row: item.r, pc: "", rc: item.rc, custoRC: custoRC_Linha, custoPCSmart: 0 });
        rcJaProcessado.add(item.rc);
      }
    });
    
    var totalRC_Smart_PV = 0, totalPC_Smart_PV = 0, totalPC_Omie_PV = 0, totalPC_Adotado_PV = 0;

    smartUnicoList.forEach(obj => {
        totalRC_Smart_PV += obj.custoRC; 
        totalPC_Smart_PV += obj.custoPCSmart;
        var pK = obj.pc;
        var custoOmieItem = (pK && comprasMap[pK]) ? comprasMap[pK].pcCustoOmie : 0;
        var custoParcialItem = parseNumberBr(mapParciais[pK] || 0);
        totalPC_Omie_PV += custoOmieItem;
        if (Math.abs(custoParcialItem) > 0.001) totalPC_Adotado_PV += custoParcialItem;
        else totalPC_Adotado_PV += custoOmieItem;
    });

    var listaNFs = [];
    if (rowOmie && rowOmie.nfOmieRaw) listaNFs = rowOmie.nfOmieRaw.split(',').map(s => s.trim()).filter(s => s !== "");
    if(listaNFs.length === 0 && smartUnicoList.length === 0 && rowOmie) listaNFs = [""];

    var maxLinhas = Math.max(smartUnicoList.length, listaNFs.length);
    if(maxLinhas === 0) maxLinhas = 1;

    for(var i = 0; i < maxLinhas; i++) {
        var objSmart = smartUnicoList[i] || null;
        var rSmart = objSmart ? objSmart.row : null;
        var nfUnica = listaNFs[i] || "";

        var parcelasFinanceiro = [];
        if (nfUnica && mapFinanceiroCompleto[nfUnica]) parcelasFinanceiro = mapFinanceiroCompleto[nfUnica]; 
        else parcelasFinanceiro = [{ parcela: "", status: "", valorG: "", dataF: "", valorAY: nfUnica ? "Não Localizado!" : "" }];

        parcelasFinanceiro.forEach(function(dadoFin) {
            
            var pcKey = objSmart ? objSmart.pc : "";
            var dC = comprasMap[pcKey] || {};
            
            var dataPrevCompra = parseDataSegura(dC.dataPrevisaoCompra);
            var dataCriacaoPC  = parseDataSegura(dC.dataCriacaoCompra); // 🎯 AQUI É O PREENCHIMENTO DA COLUNA R
            var dataPrevOmie   = (rowOmie && rowOmie.previsao) ? parseDataSegura(rowOmie.previsao) : null;
            var dataCriacaoOmie = (rowOmie && rowOmie.data) ? parseDataSegura(rowOmie.data) : null;

            // Cálculos de Prazos
            var prazoEntregaDias = ""; 
            var dataLimiteAprov = "";  
            var diasDecorridos = "";   
            var diasRcVsCriacao = ""; 
            
            if (dataPrevCompra instanceof Date && dataCriacaoPC instanceof Date) {
                prazoEntregaDias = Math.round((dataPrevCompra - dataCriacaoPC) / (1000 * 60 * 60 * 24));
            }

            if (dataPrevOmie instanceof Date && prazoEntregaDias !== "") {
                var novaData = new Date(dataPrevOmie.getTime());
                novaData.setDate(novaData.getDate() - prazoEntregaDias - 5);
                dataLimiteAprov = novaData;
            }

            if (dataCriacaoPC instanceof Date && dataCriacaoOmie instanceof Date) {
                diasDecorridos = Math.round((dataCriacaoPC - dataCriacaoOmie) / (1000 * 60 * 60 * 24));
            }

            // Histórico RC (Coluna AZ)
            var rcAtual = objSmart ? String(objSmart.rc).trim() : "";
            var dataEntradaRC = "";
            var dataEntradaRC_Obj = null;
            
            if (rcAtual !== "") {
              if (!isPrimeiraExecucao && historicoRC.hasOwnProperty(rcAtual)) {
                  dataEntradaRC = historicoRC[rcAtual]; 
              } else if (!isPrimeiraExecucao) {
                  dataEntradaRC = Utilities.formatDate(hoje, CONFIG_TIMESTAMP.timezone, "dd/MM/yyyy"); 
              }
              dataEntradaRC_Obj = parseDataSegura(dataEntradaRC);
            }

            if (dataEntradaRC_Obj instanceof Date && dataCriacaoOmie instanceof Date) {
                diasRcVsCriacao = Math.round((dataEntradaRC_Obj - dataCriacaoOmie) / (1000 * 60 * 60 * 24));
            }

            // Lógica Financeira e Auditoria
            var valorS_Omie = dC.pcCustoOmie || 0;
            var valSmartY = rSmart ? parseNumberBr(rSmart[24]) : 0; 
            var valorContasPagar = ""; 
            if (dC.nfFornecedor && pcKey) {
                var nfSemZeros = String(dC.nfFornecedor).replace(/^0+/, '');
                var chaveBuscaPagar = nfSemZeros + String(pcKey).trim();
                if (mapContasPagar[chaveBuscaPagar]) valorContasPagar = mapContasPagar[chaveBuscaPagar];
            }

            var auditCompra = "";
            var vPagar = Number(valorContasPagar) || 0;
            if (dC.nfFornecedor) {
              if (Math.abs(vPagar - valorS_Omie) < 0.01) auditCompra = "✅ OK";
              else auditCompra = "⚠️ Atenção";
            }

            var statusAE = ""; 
            if (Math.abs(valSmartY) > 0.001) {
                 statusAE = (Math.abs(valSmartY - valorS_Omie) < 0.01) ? "✅ Validado" : "🚫 Irregular";
            }
            
            var statusOriginalSmart = rSmart ? rSmart[20] : "";
            var valMargem = "";
            var projetoOmie = rowOmie ? String(rowOmie.projeto).toUpperCase() : "";
            var valorVenda = mapVendasSoma[chave] || 0;
            if (totalPC_Adotado_PV !== 0 && valorVenda !== 0 && (projetoOmie === "41_VP" || projetoOmie === "40_VS")) {
                valMargem = 1 - (totalPC_Adotado_PV / valorVenda);
            }

            var statusMargem = "";
            if (valMargem !== "") {
                if (valMargem <= 0) statusMargem = "🚨 Margem Negativa!!";
                else if (valMargem <= 0.3) statusMargem = "⚠️ Margem Baixa";
                else if (valMargem <= 0.5) statusMargem = "✅ Boa Margem!";
                else statusMargem = "💎 Margem Excepcional";
            }

            // Resumo Audit
            var resumoAudit = "";
            if (pcKey) {
                var apv = (statusOriginalSmart === "Aprovado!") ? "✅" : "🚫";
                var rcOk = (totalPC_Adotado_PV <= totalRC_Smart_PV + 0.01) ? "✅" : "🚫";
                var cvOk = (Math.abs(valorS_Omie - valSmartY) < 0.01) ? "✅" : "🚫";
                var fnOk = (Math.abs(vPagar - valSmartY) < 0.01) ? "✅" : "🚫";
                resumoAudit = "APV "+apv+", RC "+rcOk+", CV "+cvOk+", FN "+fnOk;
            }

            var statusComp = (rowOmie && (smartUnicoList.length > 0)) ? "Ambas" : (rowOmie ? "Só Omie" : "Só Smart");

            bufferTemp.push({
                pv: chave,
                linha: [
                    "", // A - Sinalizador
                    rowOmie ? chave : "", 
                    (smartUnicoList.length > 0) ? chave : "", 
                    statusComp, 
                    rowOmie ? rowOmie.data : "", rowOmie ? rowOmie.previsao : "", 
                    rowOmie ? rowOmie.projeto : "", rowOmie ? rowOmie.cliente : "",
                    rowOmie ? rowOmie.status : "", nfUnica, rowOmie ? rowOmie.dataFat : "",
                    rSmart ? rSmart[4] : "", rSmart ? rSmart[7] : 0, mapVendasSoma[chave] || 0,
                    objSmart ? objSmart.rc : "", 
                    pcKey, // P

                    // Q, R, S, T
                    dataPrevCompra,    
                    dataCriacaoPC, // 🎯 Aqui a Data de Criação do PC (Coluna R)
                    dataLimiteAprov,   
                    prazoEntregaDias,  

                    objSmart ? objSmart.custoRC : 0, objSmart ? objSmart.custoPCSmart : 0, 
                    valorS_Omie, valSmartY, 
                    dC.st || '', dC.stF || '',
                    dC.dataEmissao_AN || '', dC.dataReceb_AO || '',
                    dC.nfFornecedor || '', valorContasPagar, auditCompra,
                    dC.categoriaCompra || '', dC.projetoCompra || '',
                    parseNumberBr(mapParciais[pcKey] || 0), statusAE, statusOriginalSmart, 
                    dC.fp || '', rSmart ? rSmart[27] : "", 
                    totalRC_Smart_PV, totalPC_Smart_PV, totalPC_Omie_PV, totalPC_Adotado_PV, 
                    dadoFin.parcela, dadoFin.status, dadoFin.valorG, dadoFin.dataF, dadoFin.valorAY,
                    valMargem, statusMargem, resumoAudit,
                    diasDecorridos, // AU
                    "", "", "", "", "", // Colunas extras
                    dataEntradaRC,  // AZ
                    diasRcVsCriacao // BA
                ]
            });
            contadorPorPV[chave] = (contadorPorPV[chave] || 0) + 1;
        });
    }
  });

  var acompanhamento = {};
  var finalOut = bufferTemp.map(function(item) {
    acompanhamento[item.pv] = (acompanhamento[item.pv] || 0) + 1;
    var status = contadorPorPV[item.pv] > 1 ? "Duplicado [" + acompanhamento[item.pv] + "/" + contadorPorPV[item.pv] + "]" : "Único";
    item.linha[0] = status;
    return item.linha;
  });

  if (finalOut.length > 0) {
    abaResultado.getRange(2, 1, finalOut.length, largura).setValues(finalOut);
  }
  return finalOut.length;
}

// ============================================================================
// 🛠️ FUNÇÕES AUXILIARES (MANTIDAS/OTIMIZADAS)
// ============================================================================

function parseNumberBr(valor) {
  if (typeof valor === 'number') return valor;
  if (!valor) return 0;
  var limpo = String(valor).replace("R$", "").trim();
  if (limpo.indexOf(',') > -1 && limpo.indexOf('.') > -1) limpo = limpo.replace(/\./g, '').replace(',', '.');
  else if (limpo.indexOf(',') > -1) limpo = limpo.replace(',', '.');
  var num = parseFloat(limpo);
  return isNaN(num) ? 0 : num;
}

function parseDataSegura(valor) {
  if (!valor) return null;
  if (valor instanceof Date) return valor;
  var partes = String(valor).split('/');
  if (partes.length === 3) {
    var d = new Date(parseInt(partes[2], 10), parseInt(partes[1], 10) - 1, parseInt(partes[0], 10));
    return isNaN(d.getTime()) ? null : d;
  }
  var d2 = new Date(valor);
  return isNaN(d2.getTime()) ? null : d2;
}

function carregarHistoricoRC(sheet) {
  var historico = {};
  try {
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return historico;
    var colRC = 14; // O
    var colDataEntrada = 51; // AZ
    var dados = sheet.getRange(2, 1, lastRow - 1, sheet.getLastColumn()).getValues();
    for (var i = 0; i < dados.length; i++) {
      var rc = String(dados[i][colRC]).trim();
      var data = dados[i][colDataEntrada];
      if (rc && data) historico[rc] = data;
    }
  } catch(e) { Logger.log("Aviso: Falha ao ler histórico RC."); }
  return historico;
}

function getCabecalhosConsolidacaoPedidos() {
  return [
    'Sinalizador Duplicidade', 'PV/OS Omie', 'PV/OS Smart', 'Comparação',
    'Data Criação (Omie)', 'Previsão (Omie)', 'Projeto (Omie)', 'PV Cliente (Omie)',
    'Status Venda (Omie)', 'NF (Omie)', 'Data Fat. (Omie)',
    'Projeto (Smart)', 'Valor PV/OS (Smart)', 'Valor PV/OS (Omie)',
    'Requisição de Compras', 'Pedido de Compra',
    'Previsão Compra (Col E)', 'Data Criação PC (Col R)', 'Data Limite Aprovação', 'Prazo Entrega (Dias)',
    'RC Custo (Smart)', 'PC Custo (Smart)', 'PC Custo Omie (S)',
    'Smart (Col Y) (Busca P)', 
    'Status de Compra', 'Status de Fornecedor',
    'Data emissao', 'Data Recebimento',
    'NF Fornecedor (Busca AK)', 'Valor Pagar (Busca CP)', 'Auditoria Compra (Y vs S)',
    'Categoria Compra', 'Projeto Compra',
    'PC Parcial (Z)', 
    'Validação (T vs S)', 'Aprovação (Smart)',    
    'Forma Pagamento (Omie)', 'Fonte',
    'RC Total - Smart', 'PC Total - Smart', 'PC Total - Omie', 'Valor Total (Adotado)',
    'Parcela (Col L)', 'Status Fin. (Col O)', 'Valor Título (Col G)', 'Data Previsão (Col F)', 'Valor Recebível (Col AY)',
    'Margem % (AQ)', 'Status Margem (AR)', 'Resumo Audit (AS)',
    'Dias Decorridos (R - E)', 'Vazio1', 'Vazio2', 'Vazio3', 'Vazio4', 'Vazio5', 'Data Entrada RC', 'Dias (RC - Criação)'
  ];
}

function preservarCabecalhosELimparDados(sheet, largura, cabecalhosPadrao) {
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, largura).clearContent();
  if (lastRow < 1 || sheet.getRange(1, 1).getValue() === "") {
    sheet.clear(); 
    sheet.getRange(1, 1, 1, largura).setValues([cabecalhosPadrao])
         .setFontWeight('bold').setBackground(CONFIG_CONSOLIDACAO.corCabecalho).setFontColor('#FFFFFF').setHorizontalAlignment('center');
    sheet.setFrozenRows(1);
  }
}

// Mapas Financeiros e Vendas (Sem alteração de lógica)
function carregarMapaContasPagar() { try { var ssFin = SpreadsheetApp.openById(CONFIG_FINANCEIRO.spreadsheetId); var sheet = ssFin.getSheetByName(CONFIG_FINANCEIRO.sheetPagar); if (!sheet) return {}; var data = sheet.getDataRange().getValues(); var map = {}; for (var i = 1; i < data.length; i++) { var rawNF = String(data[i][11]).trim(); var rawPedido = String(data[i][15]).trim(); var valor = parseNumberBr(data[i][6]); if (rawNF || rawPedido) { var chave = rawNF.replace(/^0+/, '') + rawPedido; map[chave] = (map[chave] || 0) + valor; } } return map; } catch(e) { return {}; } }
function carregarMapaFinanceiroMultiplasParcelas() { try { var ssFin = SpreadsheetApp.openById(CONFIG_FINANCEIRO.spreadsheetId); var data = ssFin.getSheetByName(CONFIG_FINANCEIRO.sheetReceber).getDataRange().getValues(); var map = {}; for (var i = 1; i < data.length; i++) { var nf = String(data[i][CONFIG_FINANCEIRO.colBusca_BS - 1]).trim(); if (nf) { if (!map[nf]) map[nf] = []; map[nf].push({ parcela: data[i][CONFIG_FINANCEIRO.colParcela_L - 1], status: data[i][CONFIG_FINANCEIRO.colStatus_O - 1], dataF: data[i][CONFIG_FINANCEIRO.colData_F - 1], valorG: data[i][CONFIG_FINANCEIRO.colValor_G - 1], valorAY: data[i][CONFIG_FINANCEIRO.colValor_AY - 1] }); } } return map; } catch(e) { return {}; } }
function carregarMapaVendasTotalizadoOmie() { try { var ssExt = SpreadsheetApp.openById(CONFIG_VENDAS.spreadsheetId); var map = {}; var sheets = [{n: CONFIG_VENDAS.sheetPVConsolidado, c: 45, v: 16}, {n: CONFIG_VENDAS.sheetOSConsolidado, c: 39, v: 6}]; sheets.forEach(s => { var sh = ssExt.getSheetByName(s.n); if(sh) { var d = sh.getDataRange().getValues(); for(var i=1; i<d.length; i++) { var id = String(d[i][s.c]).trim(); if(id) map[id] = (map[id]||0) + Number(d[i][s.v]||0); } } }); return map; } catch(e) { return {}; } }
function carregarMapaPedidosParciais(ss) { var aba = ss.getSheetByName(CONFIG_CONSOLIDACAO.abasOrigem.parciais); if(!aba) return {}; var d = aba.getDataRange().getValues(); var map = {}; for(var i=1; i<d.length; i++) { String(d[i][0]).split(',').forEach(p => { if(p.trim()) map[p.trim()] = d[i][1]; }); } return map; }
function escreverTimestamp(sheet, sucesso, msg, total) { var ts = Utilities.formatDate(new Date(), CONFIG_TIMESTAMP.timezone, CONFIG_TIMESTAMP.formato); sheet.getRange(CONFIG_TIMESTAMP.linha, CONFIG_TIMESTAMP.coluna).setValue(ts + " | " + (total||0) + " linhas | " + msg).setBackground(sucesso ? CONFIG_TIMESTAMP.bgSucesso : CONFIG_TIMESTAMP.bgErro); }
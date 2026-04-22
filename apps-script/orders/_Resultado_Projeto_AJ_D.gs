/**
 * ============================
 * RESULTADOS_PROJETOS (DO ZERO) - AGRUPADO POR PROJETO
 * ============================
 * Fonte: Consolidação_Pedidos
 * Saída: Resultados_projetos
 *
 * Ajustes aplicados:
 * - Coluna A: Filtra apenas projetos da col O que começam com "PJ"
 * - Coluna B: PV/OS (col A) vinculados aos projetos filtrados
 * - Coluna C: Requisições agora vem da col G (não mais E)
 * - Coluna D: PCs Aprovados agora vem da col H (não mais F), filtro col R = "Aprovado!"
 * - Coluna E: PCs Não Aprovados agora vem da col H, filtro col R = "Não Aprovado"
 * - Coluna F: Soma da col I (não mais G)
 * - Coluna G: Soma da col J com filtro "Aprovado!" em R
 * - Coluna H: Soma das colunas J + Q com filtro "Aprovado!" em R ⭐ ATUALIZADO
 * - Coluna I: Soma da col J com filtro "Não Aprovado" em R
 * - Colunas J e K: Mantidas (Financeiro)
 */

const CONFIG_RESULTADOS = {
  sheetFonte: 'Consolidação_Pedidos',
  sheetDestino: 'Resultados_projetos',

  financeiroSpreadsheetId: '1lodGkIBxO1es8fYcNmvKY-7M8Jft1wUDa2FX3RSM3rg',
  lancamentosSheet: 'Lançamentos_Consolidados',
  contasReceberSheet: 'ContasReceber_Consolidada'
};

// ---------- Cabeçalho ----------
function getCabecalhosResultadosProjetos() {
  return [
    'Projeto',                         // A
    'PV/OS (do projeto)',              // B
    'Requisições de Compras',          // C (agora col G)
    'PCs Aprovados',                   // D (agora col H)
    'PCs Não Aprovados',               // E (agora col H)
    'Soma RC Custo (I)',               // F (agora col I)
    'Soma PC Custo Aprovados (J)',     // G (agora col J)
    'Soma Total Aprovados (J+Q)',      // H (agora col J + Q) ⭐
    'Soma PC Custo Não Aprovados (J)', // I (agora col J)
    'Recebidos (Lançamentos)',         // J
    'A Receber (Contas a Receber)'     // K
  ];
}

// ---------- Utils ----------
function asText(v) {
  return (v === null || v === undefined) ? '' : String(v).trim();
}
function asNumber(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}
function addToSet(setObj, value) {
  if (!value) return;
  setObj.add(value);
}
function joinSet(setObj) {
  return Array.from(setObj).join(', ');
}
function colToIndex(colLetters) {
  const s = colLetters.toUpperCase();
  let n = 0;
  for (let i = 0; i < s.length; i++) n = n * 26 + (s.charCodeAt(i) - 64);
  return n - 1;
}

// ============================
// FINANCEIRO: mapas por Projeto
// ============================

function carregarRecebidosLancamentosPorProjeto() {
  const ssFin = SpreadsheetApp.openById(CONFIG_RESULTADOS.financeiroSpreadsheetId);
  const sh = ssFin.getSheetByName(CONFIG_RESULTADOS.lancamentosSheet);
  if (!sh) throw new Error('Aba não encontrada (Financeiro): ' + CONFIG_RESULTADOS.lancamentosSheet);

  const values = sh.getDataRange().getValues();

  const idxT = colToIndex('T');
  const idxAP = colToIndex('AP');
  const idxG = colToIndex('G');

  const map = {};
  for (let i = 1; i < values.length; i++) {
    const tipo = asText(values[i][idxT]);
    if (tipo !== 'R') continue;

    const projeto = asText(values[i][idxAP]);
    if (!projeto) continue;

    const valor = asNumber(values[i][idxG]);
    map[projeto] = (map[projeto] || 0) + valor;
  }
  return map;
}

function carregarAReceberPorProjeto() {
  const ssFin = SpreadsheetApp.openById(CONFIG_RESULTADOS.financeiroSpreadsheetId);
  const sh = ssFin.getSheetByName(CONFIG_RESULTADOS.contasReceberSheet);
  if (!sh) throw new Error('Aba não encontrada (Financeiro): ' + CONFIG_RESULTADOS.contasReceberSheet);

  const values = sh.getDataRange().getValues();

  const idxBO = colToIndex('BO');
  const idxG = colToIndex('G');
  const idxAY = colToIndex('AY');

  const map = {};
  for (let i = 1; i < values.length; i++) {
    const status = asText(values[i][idxAY]);
    if (status === 'Recebido') continue;

    const projeto = asText(values[i][idxBO]);
    if (!projeto) continue;

    const valor = asNumber(values[i][idxG]);
    map[projeto] = (map[projeto] || 0) + valor;
  }
  return map;
}

// ============================
// DESTINO
// ============================

function prepararDestinoResultados(destino) {
  destino.clear();

  const headers = getCabecalhosResultadosProjetos();
  destino.getRange(1, 1, 1, headers.length).setValues([headers]);
  destino.setFrozenRows(1);

  destino.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold')
    .setBackground('#4A86E8')
    .setFontColor('#FFFFFF')
    .setHorizontalAlignment('center');
}

function formatarDestinoResultados(destino, ultimaLinha) {
  if (ultimaLinha < 2) return;

  // Moeda: F até K (6 colunas: F,G,H,I,J,K)
  destino.getRange(2, 6, ultimaLinha - 1, 6).setNumberFormat('R$ #,##0.00');

  // Larguras (opcional)
  destino.setColumnWidth(1, 240);
  destino.setColumnWidth(2, 280);
  destino.setColumnWidth(3, 350);
  destino.setColumnWidth(4, 350);
  destino.setColumnWidth(5, 350);
}

// ============================
// PRINCIPAL
// ============================

function construirResultadosProjetos() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const fonte = ss.getSheetByName(CONFIG_RESULTADOS.sheetFonte);
  if (!fonte) throw new Error('Aba fonte não encontrada: ' + CONFIG_RESULTADOS.sheetFonte);

  const destino = ss.getSheetByName(CONFIG_RESULTADOS.sheetDestino) || ss.insertSheet(CONFIG_RESULTADOS.sheetDestino);

  const data = fonte.getDataRange().getValues();
  prepararDestinoResultados(destino);
  if (data.length <= 1) return;

  // Financeiro 1x
  const recebidosLanc = carregarRecebidosLancamentosPorProjeto();
  const aReceber = carregarAReceberPorProjeto();

  // ⭐ ÍNDICES
  const idxPVOS = colToIndex('A');         // PV/OS
  const idxProjetoOrigem = colToIndex('O'); // Projeto agora vem da col O
  const idxReq = colToIndex('G');          // Requisição agora col G
  const idxPC = colToIndex('H');           // Pedido de Compra agora col H
  const idxRCCusto = colToIndex('I');      // RC Custo agora col I
  const idxPCCusto = colToIndex('J');      // PC Custo agora col J
  const idxPCParcial = colToIndex('Q');    // ⭐ NOVO: PC Parcial col Q
  const idxAprov = colToIndex('R');        // Aprovação agora col R

  // Agrupa por Projeto (apenas projetos que começam com "PJ")
  const grupos = {}; // projeto -> agregados

  for (let i = 1; i < data.length; i++) {
    const row = data[i];

    const projeto = asText(row[idxProjetoOrigem]);
    
    // ⭐ FILTRO: Apenas projetos que começam com "PJ"
    if (!projeto || !projeto.startsWith('PJ')) continue;

    if (!grupos[projeto]) {
      grupos[projeto] = {
        projeto,
        pvos: new Set(),
        reqs: new Set(),
        pcsAprov: new Set(),
        pcsNaoAprov: new Set(),

        somaRCCusto: 0,           // Col I
        somaPCCustoAprov: 0,      // Col J (aprovados)
        somaTotalAprov: 0,        // Col J + Q (aprovados) ⭐
        somaPCCustoNaoAprov: 0    // Col J (não aprovados)
      };
    }

    const pvos = asText(row[idxPVOS]);
    const req = asText(row[idxReq]);
    const pc = asText(row[idxPC]);
    const statusAprov = asText(row[idxAprov]);

    const rcCusto = asNumber(row[idxRCCusto]);      // Col I
    const pcCusto = asNumber(row[idxPCCusto]);      // Col J
    const pcParcial = asNumber(row[idxPCParcial]);  // ⭐ Col Q

    addToSet(grupos[projeto].pvos, pvos);
    addToSet(grupos[projeto].reqs, req);

    // Soma RC custo sempre (por projeto) - col I
    grupos[projeto].somaRCCusto += rcCusto;

    // Classificação por status (somente se PC preenchido)
    if (pc) {
      if (statusAprov === 'Aprovado!') {
        addToSet(grupos[projeto].pcsAprov, pc);
        grupos[projeto].somaPCCustoAprov += pcCusto;           // Col J
        grupos[projeto].somaTotalAprov += (pcCusto + pcParcial); // ⭐ Col J + Q
      } else if (statusAprov === 'Não Aprovado') {
        addToSet(grupos[projeto].pcsNaoAprov, pc);
        grupos[projeto].somaPCCustoNaoAprov += pcCusto; // Col J
      }
    }
  }

  // Saída ordenada por Projeto
  const projetos = Object.keys(grupos).sort((a, b) => a.localeCompare(b));

  const out = projetos.map(projeto => {
    const g = grupos[projeto];
    return [
      g.projeto,                      // A
      joinSet(g.pvos),                // B
      joinSet(g.reqs),                // C (agora col G)
      joinSet(g.pcsAprov),            // D (agora col H)
      joinSet(g.pcsNaoAprov),         // E (agora col H)
      g.somaRCCusto,                  // F (agora col I)
      g.somaPCCustoAprov,             // G (agora col J)
      g.somaTotalAprov,               // H (agora col J + Q) ⭐
      g.somaPCCustoNaoAprov,          // I (agora col J)
      (recebidosLanc[g.projeto] || 0),// J
      (aReceber[g.projeto] || 0)      // K
    ];
  });

  if (out.length) {
    destino.getRange(2, 1, out.length, 11).setValues(out);
  }

  formatarDestinoResultados(destino, out.length + 1);
}

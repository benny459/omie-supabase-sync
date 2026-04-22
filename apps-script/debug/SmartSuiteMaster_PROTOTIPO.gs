// ════════════════════════════════════════════════════════════════════════════
// 🔗 SMARTSUITE MASTER — PROTÓTIPO (só layout, dados fake)
// ────────────────────────────────────────────────────────────────────────────
// PROPÓSITO: validar o LAYOUT da aba antes de eu implementar o populador real.
//
// COMO USAR:
//   1. Abra a planilha SALES no Google Sheets
//   2. Extensões → Apps Script
//   3. Cole este arquivo como novo script (SmartSuiteMaster_PROTOTIPO.gs)
//   4. Execute a função `criarPrototipoSmartSuiteMaster()`
//   5. Confira a nova aba "🔗 SmartSuite Master" na planilha
//   6. Se o layout estiver bom, me avise que aprovo e eu implemento o populador real
//   7. Se quiser ajustes (colunas a mais/menos, renomear, reordenar), me diga antes
//
// ⚠ NÃO LÊ DADOS REAIS — as linhas são MOCK pra você validar o visual.
// ════════════════════════════════════════════════════════════════════════════

function criarPrototipoSmartSuiteMaster() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('🔗 SmartSuite Master');
  if (sheet) {
    // Limpa se já existir (pra poder rodar várias vezes enquanto ajusta)
    sheet.clear();
    sheet.clearConditionalFormatRules();
  } else {
    sheet = ss.insertSheet('🔗 SmartSuite Master');
  }

  // ── 1. TÍTULO + INFO ──────────────────────────────────────────────────────
  sheet.getRange('A1').setValue('🔗 SmartSuite Master — Tabela Unificada').setFontSize(14).setFontWeight('bold');
  sheet.getRange('A2').setValue('PROTÓTIPO (dados fake) — Roteia cada documento para 1 dos 4 apps SmartSuite')
    .setFontStyle('italic').setFontColor('#666');

  // ── 2. CABEÇALHO ──────────────────────────────────────────────────────────
  // 24 colunas, agrupadas em blocos coloridos (identidade / sales / orders / finance / smartsuite / validação)
  var header = [
    // Identidade (A-G) — azul escuro
    'tipo_doc', 'id_doc', 'data_referencia', 'cliente_nome', 'cliente_cnpj', 'valor_total', 'status',
    // Sales (H-K) — azul claro
    'sales_numero_pedido', 'sales_codigo_projeto', 'sales_etapa', 'sales_valor_bruto',
    // Orders (L-O) — roxo
    'orders_numero_pc', 'orders_fornecedor', 'orders_nfe_chave', 'orders_valor_nf',
    // Finance (P-R) — amarelo
    'finance_cr_aberto', 'finance_cp_aberto', 'finance_saldo_cliente',
    // SmartSuite (S-V) — verde
    'solucao_smartsuite', 'smartsuite_app_id', 'smartsuite_status', 'smartsuite_last_sync',
    // Validação (W-X) — vermelho/cinza
    'inconsistencia', 'origem_dados'
  ];
  sheet.getRange(4, 1, 1, header.length).setValues([header]).setFontWeight('bold').setFontColor('white').setFontSize(9);

  // Cores de fundo por bloco
  sheet.getRange(4, 1, 1, 7).setBackground('#0D47A1');   // A-G identidade (azul escuro)
  sheet.getRange(4, 8, 1, 4).setBackground('#1976D2');   // H-K sales (azul médio)
  sheet.getRange(4, 12, 1, 4).setBackground('#6A1B9A');  // L-O orders (roxo)
  sheet.getRange(4, 16, 1, 3).setBackground('#F57F17');  // P-R finance (amarelo escuro)
  sheet.getRange(4, 19, 1, 4).setBackground('#2E7D32');  // S-V smartsuite (verde)
  sheet.getRange(4, 23, 1, 2).setBackground('#6D6D6D');  // W-X validação (cinza)

  // ── 3. LINHAS MOCK (5 exemplos, 1 por tipo + 1 com inconsistência) ────────
  var hoje = Utilities.formatDate(new Date(), 'America/Sao_Paulo', 'dd/MM/yyyy');
  var ago5min = Utilities.formatDate(new Date(Date.now() - 5 * 60000), 'America/Sao_Paulo', 'dd/MM HH:mm');

  var mock = [
    // PV com projeto → vai pra Projetos Ativos
    ['PV', '12345', hoje, 'Acme Indústria Ltda', '11.222.333/0001-44', 15000.00, 'Faturado',
     '12345', 'PROJ-2025-045', '60 - Entregue', 15000.00,
     '', '', '', '',
     0, 0, 15000.00,
     'Projetos Ativos', '696d3c3d35b1839e1b2a274f', '✅ Sincronizado', ago5min,
     '', 'Sales + Finance'],

    // OS sem projeto → vai pra Sales Avulsos
    ['OS', 'OS-678', hoje, 'Beta Serviços SA', '22.333.444/0001-55', 3200.00, 'Em execução',
     '', '', '20 - Em andamento', 3200.00,
     '', '', '', '',
     3200.00, 0, 3200.00,
     'Sales Avulsos', '679bd2d153f70a63197fde64', '⏳ Pendente', '',
     '', 'Sales + Finance'],

    // PC com divergência → PC V2 + inconsistência
    ['PC', 'PC-999', hoje, 'Gamma Suprimentos', '33.444.555/0001-66', 8750.00, 'Recebido',
     '', '', '', '',
     'PC-999', 'Gamma Suprimentos', '3312...abcd', 8750.00,
     0, 8900.00, -8900.00,
     'PC V2', '679bd37761f688f6107fde60', '❌ Erro', '',
     '⚠️ Valor NF (8750) ≠ Valor CP (8900)', 'Orders + Finance'],

    // Contrato com projeto → Projetos Ativos
    ['Contrato', 'CT-2025-012', hoje, 'Delta Engenharia', '44.555.666/0001-77', 120000.00, 'Ativo',
     'CT-2025-012', 'PROJ-2025-045', '30 - Vigente', 120000.00,
     '', '', '', '',
     40000.00, 0, 40000.00,
     'Projetos Ativos', '696d3c3d35b1839e1b2a274f', '✅ Sincronizado', ago5min,
     '', 'Sales + Finance'],

    // Cliente consolidado → app Clientes
    ['Cliente', 'CLI-0042', hoje, 'Épsilon Tecnologia ME', '55.666.777/0001-88', 0.00, '',
     '', '', '', '',
     '', '', '', '',
     12500.00, 0, 12500.00,
     'Clientes', '697798af32401aadbe51a97f', '✅ Sincronizado', ago5min,
     '', 'Finance']
  ];

  sheet.getRange(5, 1, mock.length, mock[0].length).setValues(mock);

  // ── 4. FORMATAÇÃO ─────────────────────────────────────────────────────────
  // Valores monetários: F (6), K (11), O (15), P (16), Q (17), R (18)
  [6, 11, 15, 16, 17, 18].forEach(function(col) {
    sheet.getRange(5, col, mock.length, 1).setNumberFormat('R$ #,##0.00');
  });

  // Header da data
  sheet.getRange(5, 3, mock.length, 1).setHorizontalAlignment('center');

  // Larguras das colunas
  sheet.setColumnWidth(1, 80);    // tipo_doc
  sheet.setColumnWidth(2, 110);   // id_doc
  sheet.setColumnWidth(3, 95);    // data_referencia
  sheet.setColumnWidth(4, 200);   // cliente_nome
  sheet.setColumnWidth(5, 140);   // cliente_cnpj
  sheet.setColumnWidth(6, 110);   // valor_total
  sheet.setColumnWidth(7, 100);   // status
  sheet.setColumnWidth(9, 140);   // sales_codigo_projeto
  sheet.setColumnWidth(19, 150);  // solucao_smartsuite
  sheet.setColumnWidth(20, 220);  // smartsuite_app_id
  sheet.setColumnWidth(21, 140);  // smartsuite_status
  sheet.setColumnWidth(22, 110);  // smartsuite_last_sync
  sheet.setColumnWidth(23, 280);  // inconsistencia
  sheet.setColumnWidth(24, 160);  // origem_dados

  // Congelar cabeçalho
  sheet.setFrozenRows(4);
  sheet.setFrozenColumns(2);

  // ── 5. FORMATAÇÃO CONDICIONAL ─────────────────────────────────────────────
  // Status SmartSuite (coluna U = 21)
  var statusRange = sheet.getRange(5, 21, mock.length, 1);
  // Inconsistência (coluna W = 23)
  var inconsRange = sheet.getRange(5, 23, mock.length, 1);

  sheet.setConditionalFormatRules([
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('✅').setBackground('#d9ead3').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('❌').setBackground('#f4cccc').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('⏳').setBackground('#fff2cc').setRanges([statusRange]).build(),
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextContains('⚠️').setBackground('#fce5cd').setRanges([inconsRange]).build()
  ]);

  // ── 6. LEGENDA (abaixo dos dados) ─────────────────────────────────────────
  var legendaRow = 5 + mock.length + 2;
  sheet.getRange(legendaRow, 1).setValue('📖 Legenda das Soluções SmartSuite').setFontWeight('bold');
  var legenda = [
    ['Sales Avulsos / PC Master', '679bd2d153f70a63197fde64', 'PV/OS sem projeto'],
    ['Projetos Ativos', '696d3c3d35b1839e1b2a274f', 'Documentos com codigo_projeto preenchido'],
    ['PC V2', '679bd37761f688f6107fde60', 'Pedidos de Compra'],
    ['Clientes', '697798af32401aadbe51a97f', 'Consolidação por cliente']
  ];
  sheet.getRange(legendaRow + 1, 1, 1, 3)
    .setValues([['App SmartSuite', 'App ID', 'Quando recebe dados']])
    .setFontWeight('bold').setBackground('#e0e0e0');
  sheet.getRange(legendaRow + 2, 1, legenda.length, 3).setValues(legenda);

  // ── 7. REGRA DE ROTEAMENTO (explicação) ───────────────────────────────────
  var regraRow = legendaRow + legenda.length + 4;
  sheet.getRange(regraRow, 1).setValue('⚙️ Regra de Roteamento (coluna solucao_smartsuite)').setFontWeight('bold');
  sheet.getRange(regraRow + 1, 1).setValue('1. SE tipo_doc = "Cliente"            → Clientes');
  sheet.getRange(regraRow + 2, 1).setValue('2. SENÃO SE codigo_projeto preenchido → Projetos Ativos');
  sheet.getRange(regraRow + 3, 1).setValue('3. SENÃO SE tipo_doc = "PC"           → PC V2');
  sheet.getRange(regraRow + 4, 1).setValue('4. SENÃO                              → Sales Avulsos / PC Master');

  SpreadsheetApp.getActive().toast('Protótipo criado! Revise a aba "🔗 SmartSuite Master".', '✅ OK', 5);
}

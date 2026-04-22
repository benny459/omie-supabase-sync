// ════════════════════════════════════════════════════════════════════════════
// 🪞 SHEETS MIRROR — ORDERS (Compras)
// Supabase → Google Sheets (read-only)
//
// ⚠️ ESTE ARQUIVO VAI NO PROJETO APPS SCRIPT DA PLANILHA DE ORDERS/COMPRAS
//    (NÃO na planilha de Sales!)
//
// DEPENDÊNCIA: SupabaseClient.gs no mesmo projeto (copiar da pasta supabase_migration)
//              + supaSetupCredenciais() rodado 1x neste projeto
//
// TABELAS ESPELHADAS (schema: orders):
//   1. NFe_Entrada          → orders.nfe_entrada
//   2. RecebimentoNFe       → orders.recebimento_nfe
//   3. PedidosCompra        → orders.pedidos_compra (ResumoPedidosCompleto)
//   4. Produtos             → orders.produtos_compras
//   5. EtapasFaturamento    → orders.etapas_faturamento
//   6. FormasPagVendas      → orders.formas_pagamento_vendas
//   7. FamiliasProdutos     → orders.familias_produtos
//   8. ProdutoFornecedor    → orders.produto_fornecedor
//   9. Unidades             → orders.unidades
//   10. FormasPagCompras    → orders.formas_pagamento_compras
// ════════════════════════════════════════════════════════════════════════════

var MIRROR_CFG = {

  "NFe_Entrada": {
    schema: "orders",
    tabela: "nfe_entrada",
    abaSheets: "NFe_Entrada",
    corHeader: "#16A085",
    headers: ["Empresa", "Número", "Série", "Chave Acesso", "Emissão", "Hora", "Valor", "Status", "ID NF", "ID Pedido", "ID Receb", "Pedido XML"],
    rowMapper: function(r) {
      return [
        r.empresa||"", r.numero||"", r.serie||"", r.chave_acesso||"",
        r.emissao||"", r.hora||"", r.valor!=null?r.valor:0, r.status||"",
        r.id_nf||"", r.id_pedido||"", r.id_receb||"", r.pedido_xml||""
      ];
    },
    query: "select=*&order=empresa,id_nf"
  },

  "RecebimentoNFe": {
    schema: "orders",
    tabela: "recebimento_nfe",
    abaSheets: "RecebimentoNFe",
    corHeader: "#8E44AD",
    headers: [
      "Empresa", "ID Receb", "Chave NFe", "ID Forn", "Razão Social", "Nome Fantasia",
      "CNPJ/CPF", "Num NFe", "Série", "Modelo", "Emissão",
      "Valor NFe", "Natureza Op", "Etapa", "Faturado", "Dt Fat",
      "Recebido", "Dt Rec", "Autorizado", "Cancelada", "Bloqueado",
      "Denegado", "Operação", "Dt Inc", "Hr Inc", "User Inc",
      "Dt Alt", "Hr Alt", "User Alt", "Total NFe", "Total Prod",
      "Vlr Frete", "Vlr Desc", "Vlr Seguro", "Outras Desp", "Vlr ICMS",
      "ICMS ST", "Vlr IPI", "Vlr PIS", "Vlr COFINS", "Cod Parc",
      "Qtd Parc", "Categ Compra", "ID Conta", "Dt Reg", "ID Proj",
      "ID Pedido", "Num Pedido", "ID Item Ped", "Tem Vínculo"
    ],
    rowMapper: function(r) {
      return [
        r.empresa||"", r.id_receb||"", r.chave_nfe||"", r.id_fornecedor||"",
        r.razao_social||"", r.nome_fantasia||"", r.cnpj_cpf||"",
        r.num_nfe||"", r.serie||"", r.modelo||"", r.emissao||"",
        r.valor_nfe!=null?r.valor_nfe:0, r.natureza_operacao||"", r.etapa||"",
        r.faturado||"", r.dt_fat||"", r.recebido||"", r.dt_rec||"",
        r.autorizado||"", r.cancelada||"", r.bloqueado||"", r.denegado||"",
        r.operacao||"", r.dt_inc||"", r.hr_inc||"", r.user_inc||"",
        r.dt_alt||"", r.hr_alt||"", r.user_alt||"",
        r.total_nfe!=null?r.total_nfe:0, r.total_produtos!=null?r.total_produtos:0,
        r.vlr_frete!=null?r.vlr_frete:0, r.vlr_desconto!=null?r.vlr_desconto:0,
        r.vlr_seguro!=null?r.vlr_seguro:0, r.outras_despesas!=null?r.outras_despesas:0,
        r.vlr_icms!=null?r.vlr_icms:0, r.icms_st!=null?r.icms_st:0,
        r.vlr_ipi!=null?r.vlr_ipi:0, r.vlr_pis!=null?r.vlr_pis:0,
        r.vlr_cofins!=null?r.vlr_cofins:0,
        r.cod_parcela||"", r.qtd_parcela!=null?r.qtd_parcela:"",
        r.categ_compra||"", r.id_conta||"", r.dt_registro||"", r.id_projeto||"",
        r.id_pedido||"", r.num_pedido||"", r.id_item_pedido||"", r.tem_vinculo||""
      ];
    },
    query: "select=*&order=empresa,id_receb"
  },

  "ResumoPedidosCompleto": {
    schema: "orders",
    tabela: "pedidos_compra",
    abaSheets: "ResumoPedidosCompleto",
    corHeader: "#FF6D00",
    headers: [
      "Empresa", "nCodPed","cNumero","cCodCateg","cEtapa","dIncData","cIncHora",
      "nCodFor","cCodIntFor","cContato","cCodParc","nQtdeParc",
      "dDtPrevisao","nCodCC","nCodIntCC","nCodCompr","nCodProj",
      "cCodIntPed","cNumPedido","cContrato","cObs","cObsInt",
      "nTotalPedido","cCodStatus","cDescStatus","cRecebido",
      "dDataRecebimento","dDtFaturamento","cNumeroNF",
      "nCodItem","nCodProd","cCodIntProd","cProduto","cDescricao",
      "cUnidade","nQtde","nValUnit","nValTot","nDesconto",
      "nFrete","nSeguro","nDespesas","Loc Estoque",
      "cEAN","cNCM","nQtdeRec","nPesoBruto","nPesoLiq",
      "cCodIntItem","nValMerc","nValorCofins","nValorIcms",
      "nValorIpi","nValorPis","nValorSt"
    ],
    rowMapper: function(r) {
      return [
        r.empresa||"", r.ncod_ped||"", r.cnumero||"", r.ccod_categ||"",
        r.cetapa||"", r.dinc_data||"", r.cinc_hora||"",
        r.ncod_for||"", r.ccod_int_for||"", r.ccontato||"",
        r.ccod_parc||"", r.nqtde_parc!=null?r.nqtde_parc:"",
        r.ddt_previsao||"", r.ncod_cc||"", r.ncod_int_cc||"",
        r.ncod_compr||"", r.ncod_proj||"",
        r.ccod_int_ped||"", r.cnum_pedido||"", r.ccontrato||"",
        r.cobs||"", r.cobs_int||"",
        r.ntotal_pedido!=null?r.ntotal_pedido:0,
        r.ccod_status||"", r.cdesc_status||"", r.crecebido||"",
        r.ddata_recebimento||"", r.ddt_faturamento||"", r.cnumero_nf||"",
        r.ncod_item||"", r.ncod_prod||"", r.ccod_int_prod||"",
        r.cproduto||"", r.cdescricao||"", r.cunidade||"",
        r.nqtde!=null?r.nqtde:0, r.nval_unit!=null?r.nval_unit:0,
        r.nval_tot!=null?r.nval_tot:0, r.ndesconto!=null?r.ndesconto:0,
        r.nfrete!=null?r.nfrete:0, r.nseguro!=null?r.nseguro:0,
        r.ndespesas!=null?r.ndespesas:0, r.loc_estoque||"",
        r.cean||"", r.cncm||"", r.nqtde_rec!=null?r.nqtde_rec:0,
        r.npeso_bruto!=null?r.npeso_bruto:0, r.npeso_liq!=null?r.npeso_liq:0,
        r.ccod_int_item||"", r.nval_merc!=null?r.nval_merc:0,
        r.nvalor_cofins!=null?r.nvalor_cofins:0, r.nvalor_icms!=null?r.nvalor_icms:0,
        r.nvalor_ipi!=null?r.nvalor_ipi:0, r.nvalor_pis!=null?r.nvalor_pis:0,
        r.nvalor_st!=null?r.nvalor_st:0
      ];
    },
    query: "select=*&order=empresa,ncod_ped,ncod_item"
  },

  "Produtos": {
    schema: "orders",
    tabela: "produtos_compras",
    abaSheets: "Produtos",
    corHeader: "#FF9900",
    headers: ["Empresa", "ID Omie", "Cód Integração", "SKU", "Descrição", "Vlr Unit", "Unidade", "NCM", "EAN", "Marca", "Peso Liq", "Cód Família"],
    rowMapper: function(r) {
      return [
        r.empresa||"", r.id_omie||"", r.codigo_integracao||"", r.sku||"",
        r.descricao||"", r.valor_unitario!=null?r.valor_unitario:0,
        r.unidade||"", r.ncm||"", r.ean||"", r.marca||"",
        r.peso_liq!=null?r.peso_liq:0, r.codigo_familia||""
      ];
    },
    query: "select=*&order=empresa,id_omie"
  },

  "EtapasFaturamento": {
    schema: "orders", tabela: "etapas_faturamento", abaSheets: "EtapasFaturamento", corHeader: "#E0E0E0",
    headers: ["Empresa", "Cód Operação", "Desc Operação", "Cód Etapa", "Desc Padrão", "Desc Etapa", "Inativo"],
    rowMapper: function(r) { return [r.empresa||"", r.cod_operacao||"", r.desc_operacao||"", r.cod_etapa||"", r.desc_padrao||"", r.desc_etapa||"", r.inativo||""]; },
    query: "select=*&order=empresa,cod_operacao,cod_etapa"
  },

  "FormasPagamento": {
    schema: "orders", tabela: "formas_pagamento_vendas", abaSheets: "FormasPagamento", corHeader: "#E0E0E0",
    headers: ["Empresa", "Código", "Descrição", "Nº Parcelas"],
    rowMapper: function(r) { return [r.empresa||"", r.codigo||"", r.descricao||"", r.num_parcelas!=null?r.num_parcelas:""]; },
    query: "select=*&order=empresa,codigo"
  },

  "FamiliasProdutos": {
    schema: "orders", tabela: "familias_produtos", abaSheets: "FamiliasProdutos", corHeader: "#E0E0E0",
    headers: ["Empresa", "Código", "Nome Família", "Cód Int"],
    rowMapper: function(r) { return [r.empresa||"", r.codigo||"", r.nome_familia||"", r.cod_int||""]; },
    query: "select=*&order=empresa,codigo"
  },

  "ProdutoFornecedor": {
    schema: "orders", tabela: "produto_fornecedor", abaSheets: "ProdutoFornecedor", corHeader: "#E0E0E0",
    headers: ["Empresa", "Cód Forn", "CNPJ", "Fantasia", "Razão", "Cód Int Prod", "Cód Prod", "Descrição", "Preço", "Unidade"],
    rowMapper: function(r) { return [r.empresa||"", r.cod_forn||"", r.cnpj||"", r.fantasia||"", r.razao||"", r.cod_int_prod||"", r.cod_prod||"", r.descricao||"", r.preco!=null?r.preco:0, r.unidade||""]; },
    query: "select=*&order=empresa,cod_forn,cod_prod"
  },

  "Unidades": {
    schema: "orders", tabela: "unidades", abaSheets: "Unidades", corHeader: "#E0E0E0",
    headers: ["Empresa", "Sigla", "Descrição"],
    rowMapper: function(r) { return [r.empresa||"", r.sigla||"", r.descricao||""]; },
    query: "select=*&order=empresa,sigla"
  },

  "FormasPagCompras": {
    schema: "orders", tabela: "formas_pagamento_compras", abaSheets: "FormasPagCompras", corHeader: "#E0E0E0",
    headers: ["Empresa", "Código", "Descrição", "Nº Parcelas", "Cód Forma Pag"],
    rowMapper: function(r) { return [r.empresa||"", r.codigo||"", r.descricao||"", r.num_parcelas!=null?r.num_parcelas:"", r.cod_forma_pag||""]; },
    query: "select=*&order=empresa,codigo"
  }
};

// ========================================
// 🔐 SETUP DO TOKEN DO WEBHOOK (rodar 1x)
// ========================================
function setupMirrorToken() {
  var props = PropertiesService.getScriptProperties();
  var TOKEN = "5e7bc8216d354466fc65ac34aef09d67c6475f59ceaec20bd05258788f1fd99d";
  props.setProperty('MIRROR_WEBHOOK_TOKEN', TOKEN);
  Logger.log("✅ MIRROR_WEBHOOK_TOKEN salvo em ScriptProperties");
}

// ========================================
// 🌐 WEBHOOK doPost — disparado pelo GitHub Actions após import
// ========================================
function doPost(e) {
  var inicio = new Date().getTime();
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return _jsonResponse_({ ok: false, error: "empty body" });
    }
    var data;
    try { data = JSON.parse(e.postData.contents); }
    catch (err) { return _jsonResponse_({ ok: false, error: "invalid JSON" }); }

    var tokenEsperado = PropertiesService.getScriptProperties().getProperty('MIRROR_WEBHOOK_TOKEN');
    if (!tokenEsperado) return _jsonResponse_({ ok: false, error: "no token configured" });
    if (!data.token || data.token !== tokenEsperado) return _jsonResponse_({ ok: false, error: "unauthorized" });

    var cfgName = data.cfgName || "TUDO";

    // "TUDO"/"ALL" → mirrorTudo completo
    if (cfgName === "TUDO" || cfgName === "ALL") {
      var resultados = mirrorTudo();  // já chama atualizarDashboard no final
      return _jsonResponse_({ ok: true, cfgName: "TUDO",
                              resultados: resultados,
                              webhook_ms: new Date().getTime() - inicio });
    }

    if (!MIRROR_CFG[cfgName]) return _jsonResponse_({ ok: false, error: "unknown cfgName: " + cfgName });

    var resultado = mirrorTabela_(cfgName);
    try { atualizarDashboard(); }
    catch(e) { Logger.log("⚠️ Dashboard (pós-webhook): " + e.message); }
    return _jsonResponse_({ ok: true, cfgName: cfgName,
                            linhas: resultado.linhas, segundos: resultado.segundos,
                            webhook_ms: new Date().getTime() - inicio });
  } catch (err) {
    return _jsonResponse_({ ok: false, error: err.message });
  }
}

function doGet(e) {
  return _jsonResponse_({
    ok: true,
    service: "Sheets Mirror Orders",
    modulos: Object.keys(MIRROR_CFG),
    info: "POST com { token, cfgName } para acionar. cfgName='TUDO' roda mirrorTudo."
  });
}

function _jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// 🚀 FUNÇÕES PÚBLICAS — UMA POR TABELA
// Cada uma chama mirrorTabela_ + atualizarDashboard via wrapper.
// ========================================
function mirrorNfeEntrada()           { return _finalizarMirror_(mirrorTabela_("NFe_Entrada")); }
function mirrorRecebimentoNfe()       { return _finalizarMirror_(mirrorTabela_("RecebimentoNFe")); }
function mirrorResumoPedidos()        { return _finalizarMirror_(mirrorTabela_("ResumoPedidosCompleto")); }
function mirrorProdutos()             { return _finalizarMirror_(mirrorTabela_("Produtos")); }
function mirrorEtapasFaturamento()    { return _finalizarMirror_(mirrorTabela_("EtapasFaturamento")); }
function mirrorFormasPagamento()      { return _finalizarMirror_(mirrorTabela_("FormasPagamento")); }
function mirrorFamiliasProdutos()     { return _finalizarMirror_(mirrorTabela_("FamiliasProdutos")); }
function mirrorProdutoFornecedor()    { return _finalizarMirror_(mirrorTabela_("ProdutoFornecedor")); }
function mirrorUnidades()             { return _finalizarMirror_(mirrorTabela_("Unidades")); }
function mirrorFormasPagCompras()     { return _finalizarMirror_(mirrorTabela_("FormasPagCompras")); }

/** Wrapper que dispara atualização do Dashboard após qualquer mirror individual. */
function _finalizarMirror_(r) {
  try { atualizarDashboard(); }
  catch(e) { Logger.log("⚠️ Dashboard (pós-mirror individual): " + e.message); }
  return r;
}

/**
 * 🧠 SMART MIRROR: skipa tabelas sem mudanças comparando
 * sync_state.last_sync_at (remoto) vs MIRROR_TS_<nome> (local).
 */
function mirrorTudo() {
  var resultados = [];

  var syncMap = {};
  try {
    var syncData = supaSelect('sales', 'sync_state', 'select=modulo,last_sync_at&order=modulo');
    syncData.forEach(function(s) { syncMap[s.modulo] = s.last_sync_at || ''; });
  } catch(e) { Logger.log("⚠️ Falha lendo sync_state: " + e.message); }

  var props = PropertiesService.getScriptProperties();
  var totalSkipped = 0;

  Object.keys(MIRROR_CFG).forEach(function(nome) {
    var cfg = MIRROR_CFG[nome];
    var syncKey = cfg.tabela;
    var lastSyncRemote = '';
    Object.keys(syncMap).forEach(function(mod) {
      if (mod.indexOf(syncKey) >= 0 && syncMap[mod] > lastSyncRemote) {
        lastSyncRemote = syncMap[mod];
      }
    });
    var lastMirrorLocal = props.getProperty('MIRROR_TS_' + nome) || '';

    if (lastSyncRemote && lastMirrorLocal && lastSyncRemote <= lastMirrorLocal) {
      Logger.log("⏭️ " + nome + ": sem mudanças (sync=" + lastSyncRemote.substring(0,19) + " ≤ mirror=" + lastMirrorLocal.substring(0,19) + ")");
      resultados.push(nome + ": skip");
      totalSkipped++;
      return;
    }

    try {
      var r = mirrorTabela_(nome);
      resultados.push(nome + ": " + r.linhas + " (" + r.segundos + "s)");
    } catch (err) {
      Logger.log("❌ " + nome + ": " + err.message);
      resultados.push(nome + ": ERRO");
    }
  });

  if (totalSkipped > 0) {
    Logger.log("⏭️ " + totalSkipped + " abas skipadas (sem mudanças)");
  }
  Logger.log("🏁 Mirror Orders: " + resultados.join(" | "));

  try { atualizarDashboard(); } catch(e) { Logger.log("⚠️ Dashboard: " + e.message); }

  return resultados;
}

// ========================================
// ⏰ TRIGGERS
// ========================================
function criarTriggerMirror() {
  removerTriggersMirror();
  ScriptApp.newTrigger('mirrorTudo')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log("✅ Trigger criado: mirrorTudo Orders a cada 1 hora (smart mirror skipa quando não ha mudancas)");
}

function removerTriggersMirror() {
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'mirrorTudo') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
}

// ========================================
// 🛠️ IMPLEMENTAÇÃO INTERNA
// ========================================
function mirrorTabela_(nomeCfg) {
  var cfg = MIRROR_CFG[nomeCfg];
  if (!cfg) throw new Error("Config não encontrada: " + nomeCfg);

  var inicio = new Date().getTime();
  Logger.log("🪞 Mirror " + nomeCfg + " (" + cfg.schema + "." + cfg.tabela + " → '" + cfg.abaSheets + "')");

  var rows = supaSelectAllPaginated(cfg.schema, cfg.tabela, cfg.query, 1000);
  Logger.log("   📥 Lidas " + rows.length + " linhas do Supabase");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(cfg.abaSheets);
  if (!sheet) {
    sheet = ss.insertSheet(cfg.abaSheets);
    Logger.log("   ➕ Aba '" + cfg.abaSheets + "' criada");
  }

  var numCols = cfg.headers.length;
  var maxRow = sheet.getMaxRows();
  if (maxRow > 1) sheet.getRange(2, 1, maxRow - 1, numCols).clearContent();

  sheet.getRange(1, 1, 1, numCols)
    .setValues([cfg.headers])
    .setFontWeight("bold")
    .setBackground(cfg.corHeader)
    .setFontColor("white");
  sheet.setFrozenRows(1);

  if (rows.length === 0) {
    Logger.log("   📭 Supabase vazio — só cabeçalho");
    return { linhas: 0, segundos: Math.floor((new Date().getTime() - inicio) / 1000) };
  }

  var matriz = rows.map(cfg.rowMapper);
  sheet.getRange(2, 1, matriz.length, numCols).setValues(matriz);
  SpreadsheetApp.flush();

  var tempo = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log("   ✅ " + matriz.length + " linhas escritas em " + tempo + "s");

  // Grava timestamp do último mirror por tabela (consumido pelo Dashboard)
  try {
    PropertiesService.getScriptProperties()
      .setProperty('MIRROR_TS_' + nomeCfg, new Date().toISOString());
  } catch(e) { Logger.log("⚠️ MIRROR_TS: " + e.message); }

  return { linhas: matriz.length, segundos: tempo };
}

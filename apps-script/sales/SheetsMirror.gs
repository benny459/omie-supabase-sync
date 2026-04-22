// ════════════════════════════════════════════════════════════════════════════
// 🪞 SHEETS MIRROR v2.0 — Supabase → Google Sheets (multi-tabela)
//
// Lê tabelas do Supabase e reescreve as abas correspondentes no Sheets.
// Acionado por trigger time-based do Apps Script (15 min) OU manualmente
// (função por aba pra testes individuais).
//
// TABELAS SUPORTADAS (MIRROR_CFG):
//   - ItensVendidos    → sales.itens_vendidos
//   - EtapasPedidos    → sales.etapas_pedidos
//   - PedidosVenda     → sales.pedidos_venda
//   - Produtos         → sales.produtos
//   - FormasPagamento  → sales.formas_pagamento
//   - Categorias       → sales.categorias
//
// DEPENDÊNCIA: SupabaseClient.gs no mesmo projeto
//              + supaSetupCredenciais() rodado 1x
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎮 CONFIG DAS TABELAS
// ========================================
var MIRROR_CFG = {

  // ───────────────────────────────────────
  "ItensVendidos": {
    schema: "sales",
    tabela: "itens_vendidos",
    abaSheets: "ItensVendidos",
    corHeader: "#0052CC",
    headers: [
      "Empresa", "Cód Pedido", "Num Pedido", "Data Previsão", "Cód Cliente",
      "Etapa", "Cód Parcela", "Simples Nac", "Cód Item Int",
      "Cód Item", "Cód Produto", "Cód Prod Omie", "Descrição",
      "Unidade", "Quantidade", "Vlr Unit", "Vlr Total", "NCM",
      "Tipo Desc", "Vlr Desc", "Perc Desc", "COFINS ST",
      "PIS ST", "ICMS Origem", "ICMS ST", "Dt Inc",
      "Hr Inc", "Dt Alt", "Hr Alt"
    ],
    rowMapper: function(r) {
      return [
        r.empresa || "", r.codigo_pedido || "", r.numero_pedido || "",
        r.data_previsao || "", r.codigo_cliente || "", r.etapa || "",
        r.codigo_parcela || "", r.simples_nacional || "", r.codigo_item_integracao || "",
        r.codigo_item || "", r.codigo_produto || "", r.codigo_prod_omie || "",
        r.descricao || "", r.unidade || "",
        r.quantidade != null ? r.quantidade : 0,
        r.valor_unitario != null ? r.valor_unitario : 0,
        r.valor_total != null ? r.valor_total : 0,
        r.ncm || "", r.tipo_desconto || "",
        r.valor_desconto != null ? r.valor_desconto : 0,
        r.percentual_desconto != null ? r.percentual_desconto : 0,
        r.cofins_st || "", r.pis_st || "", r.icms_origem || "", r.icms_st || "",
        r.d_inc || "", r.h_inc || "", r.d_alt || "", r.h_alt || ""
      ];
    },
    query: "select=*&order=empresa,codigo_pedido,codigo_item"
  },

  // ───────────────────────────────────────
  "EtapasPedidos": {
    schema: "sales",
    tabela: "etapas_pedidos",
    abaSheets: "EtapasPedidos",
    corHeader: "#4a86e8",
    headers: [
      "empresa", "nCodPed", "cCodIntPed", "cNumero", "cEtapa", "dDtEtapa",
      "cHrEtapa", "cUsEtapa", "cFaturado", "dDtFat", "cHrFat", "cAutorizado",
      "cDenegado", "cChaveNFE", "cNumNFE", "cSerieNFE", "dDtSaida", "cHrSaida",
      "cAmbiente", "cCancelado", "dDtCanc", "cHrCanc", "cUsCanc", "cDevolvido",
      "dDtDev", "cHrDev", "cUsDev", "info_dInc", "info_hInc", "info_uInc",
      "info_dAlt", "info_hAlt", "info_uAlt", "cImpAPI"
    ],
    rowMapper: function(r) {
      return [
        r.empresa || "", r.codigo_pedido || "", r.cod_int_pedido || "",
        r.numero || "", r.etapa || "", r.dt_etapa || "", r.hr_etapa || "",
        r.user_etapa || "", r.faturado || "", r.dt_fat || "", r.hr_fat || "",
        r.autorizado || "", r.denegado || "", r.chave_nfe || "", r.num_nfe || "",
        r.serie_nfe || "", r.dt_saida || "", r.hr_saida || "", r.ambiente || "",
        r.cancelado || "", r.dt_canc || "", r.hr_canc || "", r.user_canc || "",
        r.devolvido || "", r.dt_dev || "", r.hr_dev || "", r.user_dev || "",
        r.d_inc || "", r.h_inc || "", r.u_inc || "",
        r.d_alt || "", r.h_alt || "", r.u_alt || "", r.imp_api || ""
      ];
    },
    query: "select=*&order=empresa,codigo_pedido"
  },

  // ───────────────────────────────────────
  "PedidosVenda": {
    schema: "sales",
    tabela: "pedidos_venda",
    abaSheets: "PedidosVenda",
    corHeader: "#4285F4",
    headers: [
      "Empresa", "Cód Pedido", "Cód Pedido Int", "Num Pedido", "Cód Cliente",
      "Previsão", "Etapa", "Cód Parcela", "Qtd Parcelas", "Origem",
      "Vlr Total", "Qtd Itens", "Vlr Mercadorias", "Vlr Desconto", "Vlr Frete",
      "Vlr ICMS", "Vlr PIS", "Vlr COFINS", "Base ICMS ST", "Vlr ICMS ST",
      "Vlr IPI", "Cód Transp", "Modalidade", "Volumes", "Peso Bruto",
      "Peso Liq", "Cód Categoria", "Cód Conta", "Num Ped Cliente", "Contato",
      "Consumidor Final", "Email", "Cód Vendedor", "Cód Projeto", "Dados Adic NF",
      "Dt Inc", "Hr Inc", "User Inc", "Dt Alt", "Hr Alt", "User Alt"
    ],
    rowMapper: function(r) {
      return [
        r.empresa || "", r.codigo_pedido || "", r.cod_pedido_integracao || "",
        r.numero_pedido || "", r.codigo_cliente || "", r.data_previsao || "",
        r.etapa || "", r.codigo_parcela || "",
        r.qtde_parcelas != null ? r.qtde_parcelas : "",
        r.origem_pedido || "",
        r.valor_total != null ? r.valor_total : 0,
        r.quantidade_itens != null ? r.quantidade_itens : 0,
        r.valor_mercadorias != null ? r.valor_mercadorias : 0,
        r.valor_desconto != null ? r.valor_desconto : 0,
        r.valor_frete != null ? r.valor_frete : 0,
        r.valor_icms != null ? r.valor_icms : 0,
        r.valor_pis != null ? r.valor_pis : 0,
        r.valor_cofins != null ? r.valor_cofins : 0,
        r.base_icms_st != null ? r.base_icms_st : 0,
        r.valor_icms_st != null ? r.valor_icms_st : 0,
        r.valor_ipi != null ? r.valor_ipi : 0,
        r.cod_transportadora || "", r.modalidade || "", r.volumes || "",
        r.peso_bruto || "", r.peso_liquido || "",
        r.codigo_categoria || "", r.codigo_conta || "", r.num_pedido_cliente || "",
        r.contato || "", r.consumidor_final || "", r.email || "",
        r.codigo_vendedor || "", r.codigo_projeto || "", r.dados_adicionais_nf || "",
        r.d_inc || "", r.h_inc || "", r.u_inc || "",
        r.d_alt || "", r.h_alt || "", r.u_alt || ""
      ];
    },
    query: "select=*&order=empresa,codigo_pedido"
  },

  // ───────────────────────────────────────
  "Produtos": {
    schema: "sales",
    tabela: "produtos",
    abaSheets: "Produtos",
    corHeader: "#FF9900",
    headers: ["Empresa", "ID Omie", "Cód Produto", "Cód Integração", "Descrição", "Valor Unitário", "NCM", "EAN"],
    rowMapper: function(r) {
      return [
        r.empresa || "",
        r.id_omie || "",
        r.codigo_produto || "",
        r.codigo_integracao || "",
        r.descricao || "",
        r.valor_unitario != null ? r.valor_unitario : 0,
        r.ncm || "",
        r.ean || ""
      ];
    },
    query: "select=*&order=empresa,id_omie"
  },

  // ───────────────────────────────────────
  "FormasPagamento": {
    schema: "sales",
    tabela: "formas_pagamento",
    abaSheets: "FormasPagamento",
    corHeader: "#E0E0E0",
    headers: ["Empresa", "Código", "Descrição", "Nº Parcelas"],
    rowMapper: function(r) {
      return [
        r.empresa || "",
        r.codigo || "",
        r.descricao || "",
        r.num_parcelas != null ? r.num_parcelas : ""
      ];
    },
    query: "select=*&order=empresa,codigo"
  },

  // ───────────────────────────────────────
  "Categorias": {
    schema: "sales",
    tabela: "categorias",
    abaSheets: "Categorias",
    corHeader: "#E0E0E0",
    headers: ["Empresa", "Código", "Descrição", "Conta Receita", "Conta Despesa"],
    rowMapper: function(r) {
      return [
        r.empresa || "",
        r.codigo || "",
        r.descricao || "",
        r.conta_receita || "",
        r.conta_despesa || ""
      ];
    },
    query: "select=*&order=empresa,codigo"
  },

  // ───────────────────────────────────────
  "OrdensServico": {
    schema: "sales",
    tabela: "ordens_servico",
    abaSheets: "OrdensServico",
    corHeader: "#00B8D9",
    headers: [
      "Empresa", "Cód OS", "Seq Item", "Num OS", "Cód Cli", "Previsão",
      "Valor Total", "Etapa", "Categ", "Proj", "Conta", "Parc", "Qtd Parc",
      "Faturada", "Cancelada", "Dt Inc", "Dt Fat",
      "Cód Serv", "Desc Serv", "Qtd", "Vlr Unit",
      "Trib Serv", "Ret ISS", "Aliq ISS", "Vlr ISS", "Ret INSS", "Vlr INSS",
      "Cód Vend", "Num Recibo"
    ],
    rowMapper: function(r) {
      return [
        r.empresa || "", r.codigo_os || "",
        r.seq_item != null ? r.seq_item : "",
        r.numero_os || "", r.codigo_cliente || "", r.dt_previsao || "",
        r.valor_total != null ? r.valor_total : 0,
        r.etapa || "", r.codigo_categoria || "", r.codigo_projeto || "",
        r.codigo_cc || "", r.codigo_parcela || "", r.qtd_parcelas || "",
        r.faturada || "", r.cancelada || "", r.d_inc || "", r.dt_fat || "",
        r.codigo_servico || "", r.descricao_servico || "",
        r.quantidade != null ? r.quantidade : 0,
        r.valor_unitario != null ? r.valor_unitario : 0,
        r.trib_servico || "", r.retem_iss || "",
        r.aliq_iss != null ? r.aliq_iss : 0,
        r.valor_iss != null ? r.valor_iss : 0,
        r.retem_inss || "",
        r.valor_inss != null ? r.valor_inss : 0,
        r.codigo_vendedor || "", r.num_recibo || ""
      ];
    },
    query: "select=*&order=empresa,codigo_os,seq_item"
  },

  // ───────────────────────────────────────
  "ContratosServico": {
    schema: "sales",
    tabela: "contratos_servico",
    abaSheets: "ContratosServico",
    corHeader: "#6554C0",
    headers: [
      "Empresa", "Cód Ctr", "Num Ctr", "Cód Cli", "Situação",
      "Vig Início", "Vig Fim", "Tipo Fat", "Dia Fat", "Vlr Tot Mês",
      "Categ", "Conta", "Proj",
      "Seq", "Cód Serv", "Qtd", "Vlr Unit", "Vlr Total",
      "LC116", "Cód Mun", "Desc Completa", "Aliq ISS", "Vlr ISS", "Ret ISS"
    ],
    rowMapper: function(r) {
      return [
        r.empresa || "", r.codigo_contrato || "", r.numero_contrato || "",
        r.codigo_cliente || "", r.situacao || "",
        r.vig_inicial || "", r.vig_final || "", r.tipo_faturamento || "",
        r.dia_faturamento || "",
        r.vlr_tot_mes != null ? r.vlr_tot_mes : 0,
        r.codigo_categoria || "", r.codigo_cc || "", r.codigo_projeto || "",
        r.seq != null ? r.seq : "",
        r.codigo_servico || "",
        r.quantidade != null ? r.quantidade : 0,
        r.valor_unitario != null ? r.valor_unitario : 0,
        r.valor_total != null ? r.valor_total : 0,
        r.cod_lc116 || "", r.cod_serv_munic || "", r.descricao_completa || "",
        r.aliq_iss != null ? r.aliq_iss : 0,
        r.valor_iss != null ? r.valor_iss : 0,
        r.retem_iss || ""
      ];
    },
    query: "select=*&order=empresa,codigo_contrato,seq"
  }

};

// ========================================
// 🔐 SETUP DO TOKEN (rodar 1x)
// ========================================
function setupMirrorToken() {
  var props = PropertiesService.getScriptProperties();
  var TOKEN = "5e7bc8216d354466fc65ac34aef09d67c6475f59ceaec20bd05258788f1fd99d";
  props.setProperty('MIRROR_WEBHOOK_TOKEN', TOKEN);
  Logger.log("✅ MIRROR_WEBHOOK_TOKEN salvo em ScriptProperties");
}

// ========================================
// 🌐 WEBHOOK (doPost) — tentativa caso Workspace libere
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

    var cfgName = data.cfgName || "ItensVendidos";

    // cfgName especial "TUDO" / "ALL" → roda mirrorTudo completo
    if (cfgName === "TUDO" || cfgName === "ALL") {
      var resultados = mirrorTudo();  // já chama atualizarDashboard no final
      return _jsonResponse_({ ok: true, cfgName: "TUDO",
                              resultados: resultados,
                              webhook_ms: new Date().getTime() - inicio });
    }

    if (!MIRROR_CFG[cfgName]) return _jsonResponse_({ ok: false, error: "unknown cfgName: " + cfgName });

    var resultado = mirrorTabela_(cfgName);
    // Atualiza Dashboard após webhook também
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
    service: "Sheets Mirror v2.0",
    modulos: Object.keys(MIRROR_CFG),
    info: "POST com { token, cfgName } para acionar mirror"
  });
}

function _jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ========================================
// 🚀 FUNÇÕES PÚBLICAS — UMA POR TABELA
// Cada uma chama mirrorTabela_ e depois atualiza o Dashboard
// via wrapper _finalizarMirror_ — assim qualquer função de mirror
// (individual, mirrorTudo ou webhook doPost) sempre atualiza A1 do Dashboard.
// ========================================
function mirrorItensVendidos()    { return _finalizarMirror_(mirrorTabela_("ItensVendidos"));    }
function mirrorEtapasPedidos()    { return _finalizarMirror_(mirrorTabela_("EtapasPedidos"));    }
function mirrorPedidosVenda()     { return _finalizarMirror_(mirrorTabela_("PedidosVenda"));     }
function mirrorProdutos()         { return _finalizarMirror_(mirrorTabela_("Produtos"));         }
function mirrorFormasPagamento()  { return _finalizarMirror_(mirrorTabela_("FormasPagamento"));  }
function mirrorCategorias()       { return _finalizarMirror_(mirrorTabela_("Categorias"));       }
function mirrorOrdensServico()    { return _finalizarMirror_(mirrorTabela_("OrdensServico"));    }
function mirrorContratosServico() { return _finalizarMirror_(mirrorTabela_("ContratosServico")); }

/** Wrapper que dispara atualização do Dashboard após qualquer mirror individual. */
function _finalizarMirror_(r) {
  try { atualizarDashboard(); }
  catch(e) { Logger.log("⚠️ Dashboard (pós-mirror individual): " + e.message); }
  return r;
}

/**
 * Espelha TODAS as tabelas configuradas. Usada pelo trigger time-based.
 *
 * 🧠 SMART MIRROR: compara sync_state.last_sync_at (timestamp do último import Python)
 * com MIRROR_TS local (timestamp do último mirror feito aqui).
 * Se local >= remoto, SKIPA a tabela (não há mudanças).
 */
function mirrorTudo() {
  var resultados = [];

  // 1) Lê sync_state 1x do Supabase (schema 'sales' por convenção — é global)
  var syncMap = {};
  try {
    var syncData = supaSelect('sales', 'sync_state', 'select=modulo,last_sync_at&order=modulo');
    syncData.forEach(function(s) { syncMap[s.modulo] = s.last_sync_at || ''; });
  } catch(e) { Logger.log("⚠️ Falha lendo sync_state: " + e.message); }

  var props = PropertiesService.getScriptProperties();
  var totalSkipped = 0;

  Object.keys(MIRROR_CFG).forEach(function(nome) {
    var cfg = MIRROR_CFG[nome];
    var syncKey = cfg.tabela; // ex: "itens_vendidos"
    var lastSyncRemote = '';
    // Procura qualquer módulo que contenha o nome da tabela (ex: itens_vendidos_SF)
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
      // MIRROR_TS já é gravado dentro de mirrorTabela_() no fim
    } catch (err) {
      Logger.log("❌ " + nome + ": " + err.message);
      resultados.push(nome + ": ERRO");
    }
  });

  if (totalSkipped > 0) {
    Logger.log("⏭️ " + totalSkipped + " abas skipadas (sem mudanças)");
  }
  Logger.log("🏁 Mirror Sales: " + resultados.join(" | "));

  // Atualiza Dashboard automaticamente
  try { atualizarDashboard(); } catch(e) { Logger.log("⚠️ Dashboard: " + e.message); }

  return resultados;
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
    atualizarLogAZ1_(sheet, "SUCESSO", 0, inicio, "Mirror (vazio)");
    return { linhas: 0, segundos: Math.floor((new Date().getTime() - inicio) / 1000) };
  }

  var matriz = rows.map(cfg.rowMapper);
  sheet.getRange(2, 1, matriz.length, numCols).setValues(matriz);
  SpreadsheetApp.flush();

  var tempo = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log("   ✅ " + matriz.length + " linhas escritas em " + tempo + "s");
  atualizarLogAZ1_(sheet, "SUCESSO", matriz.length, inicio, "Mirror do Supabase");

  // Grava timestamp do último mirror por tabela (consumido pelo Dashboard)
  try {
    PropertiesService.getScriptProperties()
      .setProperty('MIRROR_TS_' + nomeCfg, new Date().toISOString());
  } catch(e) { Logger.log("⚠️ MIRROR_TS: " + e.message); }

  return { linhas: matriz.length, segundos: tempo };
}

function atualizarLogAZ1_(sheet, status, linhas, tempoInicio, msg) {
  try {
    var agora = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM HH:mm");
    var tempo = Math.floor((new Date().getTime() - tempoInicio) / 1000);
    var icone = status === "SUCESSO" ? "✅" : "❌";
    var texto = icone + " " + status + " | " + agora + " | " + linhas + " linhas | " + tempo + "s | " + msg;
    var cor = status === "SUCESSO" ? "#d9ead3" : "#f4cccc";
    sheet.getRange("AZ1")
      .setValue(texto)
      .setBackground(cor)
      .setFontColor("black")
      .setFontWeight("bold");
  } catch (e) {}
}

// ========================================
// ⏰ TRIGGERS (criar/remover via UI do Apps Script é mais fácil, mas aqui também dá)
// ========================================
function criarTriggerMirror() {
  removerTriggersMirror();
  ScriptApp.newTrigger('mirrorTudo')
    .timeBased()
    .everyHours(1)
    .create();
  Logger.log("✅ Trigger criado: mirrorTudo a cada 1 hora (smart mirror skipa quando não ha mudancas)");
}

function removerTriggersMirror() {
  var triggers = ScriptApp.getProjectTriggers();
  var count = 0;
  for (var i = 0; i < triggers.length; i++) {
    var fn = triggers[i].getHandlerFunction();
    if (fn === 'mirrorItensVendidos' || fn === 'mirrorTudo' ||
        fn === 'mirrorEtapasPedidos' || fn === 'mirrorPedidosVenda' ||
        fn === 'mirrorProdutos' || fn === 'mirrorFormasPagamento' ||
        fn === 'mirrorCategorias') {
      ScriptApp.deleteTrigger(triggers[i]);
      count++;
    }
  }
  Logger.log("🗑️ Removidos " + count + " trigger(s) de mirror");
}

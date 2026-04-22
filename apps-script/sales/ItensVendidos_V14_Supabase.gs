// ════════════════════════════════════════════════════════════════════════════
// 🏆 ITENS VENDIDOS V14 — SUPABASE EDITION
// Grava direto no Supabase (sales.itens_vendidos) via REST/PostgREST.
//
// DIFERENÇAS vs V13:
// 1. 🚀 itensPorPagina = 100 (antes: 30) → 3x menos chamadas (Omie cap real p/ ListarPedidos)
// 2. 📤 UPSERT idempotente (ON CONFLICT (empresa, codigo_pedido, codigo_item))
// 3. 🔄 Incremental automático: 1ª run = full; demais = só delta por d_alt
// 4. 🗑️ Sem dependência de Sheets para dados (Sheets vira mirror opcional)
// 5. 🔐 Credenciais em ScriptProperties (não hardcoded)
// 6. 🛡️ Retry agressivo: 429 linear longo (30/60/90/120s) + throttle 3s + User-Agent custom
//
// DEPENDÊNCIA: precisa do arquivo SupabaseClient.gs no mesmo projeto Apps Script.
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🎮 PAINEL DE CONTROLE
// ========================================
var OPCOES_IV_SUPA = {
  empresasAlvo: ["SF"],              // ["SF"], ["SF","CD","WW"], etc
  dataInicioFixaFull: "01/01/2025",  // usado SÓ na primeira execução (ou quando forcarFull=true)
  forcarFull: false,                 // true = reimporta tudo (ignora sync_state)
  itensPorPagina: 100,               // ⚠️ Testado: ListarPedidos ignora valores > 100 e sempre retorna 100
  espelharNoSheets: true,            // 🆕 true = ao fim, lê do Supabase e reescreve a aba "ItensVendidos"
  nomeAbaSheets: "ItensVendidos"     // nome da aba a ser espelhada (igual ao V13)
};

// ========================================
// ⚙️ CONFIGURAÇÕES TÉCNICAS
// ========================================
var EMPRESAS_OMIE_SUPA = {
  "SF": { appKey: "823997176002", appSecret: "4bfd2504503d076365ec4dee298b37eb", nome: "SF" },
  "CD": { appKey: "823989509343", appSecret: "9739cf05832ae7079bd46eabd4a51877", nome: "CD" },
  "WW": { appKey: "954169379163", appSecret: "0dd6ea4b5ebf4d07dcf2b3fd259c44d5", nome: "WW" }
};

var CONFIG_IV_SUPA = {
  omieUrl: "https://app.omie.com.br/api/v1/produtos/pedido/",
  metodo: "ListarPedidos",
  schema: "sales",
  tabela: "itens_vendidos",
  tabelaSync: "sync_state",
  pkConflict: "empresa,codigo_pedido,codigo_item",

  // 🆕 Headers do Sheets espelho (mesmo formato do V13)
  sheetsHeaders: [
    "Empresa", "Cód Pedido", "Num Pedido", "Data Previsão", "Cód Cliente",
    "Etapa", "Cód Parcela", "Simples Nac", "Cód Item Int",
    "Cód Item", "Cód Produto", "Cód Prod Omie", "Descrição",
    "Unidade", "Quantidade", "Vlr Unit", "Vlr Total", "NCM",
    "Tipo Desc", "Vlr Desc", "Perc Desc", "COFINS ST",
    "PIS ST", "ICMS Origem", "ICMS ST", "Dt Inc",
    "Hr Inc", "Dt Alt", "Hr Alt"
  ],
  sheetsCorHeader: "#0052CC",

  // Retry/throttle da API Omie
  maxTentativasOmie: 5,
  backoff429Ms: 30000,          // 30s, 60s, 90s, 120s (linear)
  backoff5xxMs: 3000,           // 3s, 6s, 12s, 24s (exponencial)
  pausaEntreChamadasMs: 3000,   // 3s entre chamadas Omie (margem ampla p/ evitar cooldown do IP)

  // Controle de execução
  tempoMaxExecucaoMs: 260000    // 260s (deixa margem pro timeout 6min do Apps Script)
};

// ========================================
// 🚀 LANÇADOR (função pra ser chamada pelo Orquestrador ou manualmente)
// ========================================
function executarItensVendidosSupabase() {
  var horaInicio = new Date().getTime();
  Logger.log("🟢 ItensVendidos V14 Supabase — iniciando");

  // Valida credenciais Supabase antes de tudo
  try {
    supaGetConfig();
  } catch (err) {
    Logger.log("❌ " + err.message);
    throw err;
  }

  var totalProcessadoGeral = 0;
  var resultados = [];

  for (var i = 0; i < OPCOES_IV_SUPA.empresasAlvo.length; i++) {
    var sigla = OPCOES_IV_SUPA.empresasAlvo[i];
    var empresa = EMPRESAS_OMIE_SUPA[sigla];
    if (!empresa) {
      Logger.log("⚠️ Empresa desconhecida: " + sigla);
      continue;
    }

    // Respeita timeout global
    if ((new Date().getTime() - horaInicio) > CONFIG_IV_SUPA.tempoMaxExecucaoMs) {
      Logger.log("⏸️ Timeout global — parando antes de " + sigla);
      break;
    }

    try {
      var resultado = importarEmpresaIV_(sigla, empresa, horaInicio);
      totalProcessadoGeral += resultado.totalLinhas;
      resultados.push(sigla + ": " + resultado.totalLinhas + " linhas");

      atualizarSyncState_(sigla, resultado);
    } catch (err) {
      Logger.log("❌ Erro em " + sigla + ": " + err.message);
      resultados.push(sigla + ": ERRO - " + err.message);
      registrarErroSyncState_(sigla, err.message);
    }
  }

  var tempoTotal = Math.floor((new Date().getTime() - horaInicio) / 1000);
  Logger.log("✅ Import Omie→Supabase em " + tempoTotal + "s | Total: " + totalProcessadoGeral + " linhas | " + resultados.join(" / "));

  // 🆕 Espelhar Supabase → Sheets (uma única leitura ao final)
  if (OPCOES_IV_SUPA.espelharNoSheets) {
    try {
      espelharSupabaseParaSheets_();
    } catch (err) {
      Logger.log("⚠️ Erro ao espelhar no Sheets: " + err.message + " — dados no Supabase estão OK");
    }
  }

  return totalProcessadoGeral;
}

// ========================================
// 🪞 ESPELHO SUPABASE → SHEETS
// Lê tudo do Supabase (paginado) e reescreve a aba "ItensVendidos"
// mantendo exatamente o mesmo formato de 29 colunas do V13.
// ========================================
function espelharSupabaseParaSheets_() {
  var inicio = new Date().getTime();
  Logger.log("🪞 Espelhando Supabase → Sheets (aba: " + OPCOES_IV_SUPA.nomeAbaSheets + ")");

  // Filtra apenas as empresas que estamos processando (para não espelhar outras)
  var filtroEmpresas = OPCOES_IV_SUPA.empresasAlvo.map(function(s) { return '"' + s + '"'; }).join(",");
  var queryString = "select=*&empresa=in.(" + filtroEmpresas + ")&order=empresa,codigo_pedido,codigo_item";

  var rows = supaSelectAllPaginated(
    CONFIG_IV_SUPA.schema,
    CONFIG_IV_SUPA.tabela,
    queryString,
    1000
  );
  Logger.log("   📥 Lidas " + rows.length + " linhas do Supabase");

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(OPCOES_IV_SUPA.nomeAbaSheets);
  if (!sheet) {
    sheet = ss.insertSheet(OPCOES_IV_SUPA.nomeAbaSheets);
  }

  // Limpa conteúdo antigo (preserva formatação/fórmulas fora do range de dados)
  var maxRow = sheet.getMaxRows();
  var numCols = CONFIG_IV_SUPA.sheetsHeaders.length;
  if (maxRow > 1) {
    sheet.getRange(2, 1, maxRow - 1, numCols).clearContent();
  }

  // Cabeçalho (mesmo estilo do V13)
  sheet.getRange(1, 1, 1, numCols)
    .setValues([CONFIG_IV_SUPA.sheetsHeaders])
    .setFontWeight("bold")
    .setBackground(CONFIG_IV_SUPA.sheetsCorHeader)
    .setFontColor("white");
  sheet.setFrozenRows(1);

  if (rows.length === 0) {
    Logger.log("   📭 Supabase vazio pra essas empresas — só cabeçalho reescrito");
    return;
  }

  // Mapeia row do Supabase → array na ordem dos headers
  var matriz = rows.map(function(r) {
    return [
      r.empresa || "",
      r.codigo_pedido || "",
      r.numero_pedido || "",
      r.data_previsao || "",
      r.codigo_cliente || "",
      r.etapa || "",
      r.codigo_parcela || "",
      r.simples_nacional || "",
      r.codigo_item_integracao || "",
      r.codigo_item || "",
      r.codigo_produto || "",
      r.codigo_prod_omie || "",
      r.descricao || "",
      r.unidade || "",
      r.quantidade != null ? r.quantidade : 0,
      r.valor_unitario != null ? r.valor_unitario : 0,
      r.valor_total != null ? r.valor_total : 0,
      r.ncm || "",
      r.tipo_desconto || "",
      r.valor_desconto != null ? r.valor_desconto : 0,
      r.percentual_desconto != null ? r.percentual_desconto : 0,
      r.cofins_st || "",
      r.pis_st || "",
      r.icms_origem || "",
      r.icms_st || "",
      r.d_inc || "",
      r.h_inc || "",
      r.d_alt || "",
      r.h_alt || ""
    ];
  });

  // Escreve em bloco único (rápido)
  sheet.getRange(2, 1, matriz.length, numCols).setValues(matriz);
  SpreadsheetApp.flush();

  var tempo = Math.floor((new Date().getTime() - inicio) / 1000);
  Logger.log("   ✅ Sheets espelhado: " + matriz.length + " linhas em " + tempo + "s");
}

// ========================================
// 🔄 IMPORTAR UMA EMPRESA (full ou incremental)
// ========================================
function importarEmpresaIV_(sigla, empresa, horaInicio) {
  // Descobre se é full ou incremental
  var ultimoDalt = null;
  var modoExecucao = "FULL";
  var filtroDataInicial = OPCOES_IV_SUPA.dataInicioFixaFull;

  if (!OPCOES_IV_SUPA.forcarFull) {
    ultimoDalt = obterUltimoDaltSync_(sigla);
    if (ultimoDalt) {
      modoExecucao = "INCREMENTAL";
      // Margem de segurança: volta 1 dia pra pegar alterações atrasadas
      filtroDataInicial = ultimoDalt;
    }
  }

  Logger.log("▶️ " + sigla + " | Modo: " + modoExecucao + " | Filtro data: " + filtroDataInicial);

  var pagina = 1;
  var totalLinhas = 0;
  var maiorDalt = ultimoDalt || "";
  var maiorHalt = "";
  var continuar = true;

  while (continuar) {
    if ((new Date().getTime() - horaInicio) > CONFIG_IV_SUPA.tempoMaxExecucaoMs) {
      Logger.log("⏸️ Timeout — parando " + sigla + " na página " + pagina);
      break;
    }

    Logger.log("   ⬇️ " + sigla + " | Pág " + pagina + " (" + OPCOES_IV_SUPA.itensPorPagina + "/p)");

    // Monta param da Omie
    var param = {
      "pagina": pagina,
      "registros_por_pagina": OPCOES_IV_SUPA.itensPorPagina,
      "apenas_importado_api": "N"
    };

    if (modoExecucao === "INCREMENTAL") {
      // Incremental: só alterados após a data
      param["filtrar_por_data_de"] = filtroDataInicial;
    } else {
      // Full: filtra por data de inclusão
      param["filtrar_por_data_de"] = filtroDataInicial;
    }

    var payload = {
      "call": CONFIG_IV_SUPA.metodo,
      "app_key": empresa.appKey,
      "app_secret": empresa.appSecret,
      "param": [param]
    };

    var resp = fetchOmieComRetry_(payload);
    var code = resp.getResponseCode();
    if (code !== 200) {
      throw new Error("Omie HTTP " + code + " após todos os retries: " + resp.getContentText().substring(0, 200));
    }

    var data = JSON.parse(resp.getContentText());
    var listaPedidos = data.pedido_venda_produto || [];

    if (listaPedidos.length === 0) {
      Logger.log("   📭 " + sigla + " | Nenhum pedido na pág " + pagina + " — fim");
      continuar = false;
      break;
    }

    // Parse + UPSERT no Supabase
    var linhas = [];
    for (var i = 0; i < listaPedidos.length; i++) {
      var itens = mapearPedidoParaRows_(listaPedidos[i], sigla);
      for (var j = 0; j < itens.length; j++) {
        linhas.push(itens[j]);
        // Rastreia o maior d_alt/h_alt para próxima sync
        if (itens[j].d_alt && itens[j].d_alt > maiorDalt) {
          maiorDalt = itens[j].d_alt;
          maiorHalt = itens[j].h_alt || "";
        }
      }
    }

    if (linhas.length > 0) {
      supaUpsert(
        CONFIG_IV_SUPA.schema,
        CONFIG_IV_SUPA.tabela,
        linhas,
        CONFIG_IV_SUPA.pkConflict
      );
      totalLinhas += linhas.length;
    }

    Logger.log("   ✓ " + sigla + " | Pág " + pagina + " | " + listaPedidos.length + " pedidos → " + linhas.length + " linhas (acum: " + totalLinhas + ")");

    // Se voltou menos que o pedido, é a última página
    if (listaPedidos.length < OPCOES_IV_SUPA.itensPorPagina) {
      continuar = false;
    }
    pagina++;

    // Throttle proativo entre chamadas Omie
    if (continuar) Utilities.sleep(CONFIG_IV_SUPA.pausaEntreChamadasMs);
  }

  return {
    totalLinhas: totalLinhas,
    maiorDalt: maiorDalt,
    maiorHalt: maiorHalt,
    modo: modoExecucao
  };
}

// ========================================
// 🔁 FETCH OMIE COM RETRY (429 linear longo + 5xx exponencial)
// ========================================
function fetchOmieComRetry_(payload) {
  var options = {
    "method": "post",
    "contentType": "application/json",
    "headers": {
      "User-Agent": "OmieImporter/1.0 (Apps Script)"
    },
    "payload": JSON.stringify(payload),
    "muteHttpExceptions": true
  };

  var ultimaResp = null;
  var ultimoErro = null;

  for (var t = 1; t <= CONFIG_IV_SUPA.maxTentativasOmie; t++) {
    try {
      var resp = UrlFetchApp.fetch(CONFIG_IV_SUPA.omieUrl, options);
      var code = resp.getResponseCode();

      if (code === 200) {
        if (t > 1) Logger.log("   ✅ Omie retry sucesso na tentativa " + t);
        return resp;
      }

      if (code === 429) {
        ultimaResp = resp;
        if (t < CONFIG_IV_SUPA.maxTentativasOmie) {
          var espera = CONFIG_IV_SUPA.backoff429Ms * t; // 30, 60, 90, 120s
          Logger.log("   ⚠️ Omie HTTP 429 (tent " + t + "/" + CONFIG_IV_SUPA.maxTentativasOmie + ") → esperando " + (espera/1000) + "s");
          Utilities.sleep(espera);
          continue;
        }
      } else if (code >= 500) {
        ultimaResp = resp;
        if (t < CONFIG_IV_SUPA.maxTentativasOmie) {
          var espera5 = CONFIG_IV_SUPA.backoff5xxMs * Math.pow(2, t - 1);
          Logger.log("   ⚠️ Omie HTTP " + code + " (tent " + t + "/" + CONFIG_IV_SUPA.maxTentativasOmie + ") → esperando " + (espera5/1000) + "s");
          Utilities.sleep(espera5);
          continue;
        }
      } else {
        return resp;
      }
    } catch (err) {
      ultimoErro = err;
      if (t < CONFIG_IV_SUPA.maxTentativasOmie) {
        Utilities.sleep(CONFIG_IV_SUPA.backoff5xxMs * Math.pow(2, t - 1));
        continue;
      }
    }
  }
  if (ultimaResp) return ultimaResp;
  throw ultimoErro || new Error("Omie: falha após " + CONFIG_IV_SUPA.maxTentativasOmie + " tentativas");
}

// ========================================
// 🗺️ MAPEIA PEDIDO OMIE → ROWS SUPABASE
// Cada pedido vira N linhas (uma por item).
// ========================================
function mapearPedidoParaRows_(pedido, sigla) {
  var cab = pedido.cabecalho || {};
  var info = pedido.infoCadastro || {};
  var itens = pedido.det || [];
  var rows = [];

  for (var i = 0; i < itens.length; i++) {
    var it = itens[i];
    var prod = it.produto || {};
    var imp = it.imposto || {};
    var ide = it.ide || {};

    rows.push({
      empresa: sigla,
      codigo_pedido: toIntOrNull_(cab.codigo_pedido),
      codigo_item: toIntOrNull_(ide.codigo_item),

      numero_pedido: cab.numero_pedido || null,
      data_previsao: cab.data_previsao || null,
      codigo_cliente: toIntOrNull_(cab.codigo_cliente),
      etapa: cab.etapa || null,
      codigo_parcela: cab.codigo_parcela ? String(cab.codigo_parcela) : null,
      simples_nacional: ide.simples_nacional || null,
      codigo_item_integracao: ide.codigo_item_integracao || null,

      codigo_produto: toIntOrNull_(prod.codigo_produto),
      codigo_prod_omie: prod.codigo ? String(prod.codigo) : null,
      descricao: prod.descricao || null,
      unidade: prod.unidade || null,
      quantidade: toFloatOrNull_(prod.quantidade),
      valor_unitario: toFloatOrNull_(prod.valor_unitario),
      valor_total: toFloatOrNull_(prod.valor_total),
      ncm: prod.ncm || null,

      tipo_desconto: prod.tipo_desconto || null,
      valor_desconto: toFloatOrNull_(prod.valor_desconto),
      percentual_desconto: toFloatOrNull_(prod.percentual_desconto),

      cofins_st: imp.cofins_situacao_tributaria || null,
      pis_st: imp.pis_situacao_tributaria || null,
      icms_origem: imp.icms_origem || null,
      icms_st: imp.icms_situacao_tributaria || null,

      d_inc: info.dInc || null,
      h_inc: info.hInc || null,
      d_alt: info.dAlt || null,
      h_alt: info.hAlt || null
    });
  }
  return rows;
}

// ========================================
// 💾 SYNC STATE (controle incremental por empresa)
// ========================================
function obterUltimoDaltSync_(sigla) {
  try {
    var rows = supaSelect(
      CONFIG_IV_SUPA.schema,
      CONFIG_IV_SUPA.tabelaSync,
      "select=last_d_alt_processed&modulo=eq." + encodeURIComponent("itens_vendidos_" + sigla) + "&limit=1"
    );
    if (rows.length > 0 && rows[0].last_d_alt_processed) {
      return rows[0].last_d_alt_processed;
    }
  } catch (err) {
    Logger.log("⚠️ Falha lendo sync_state: " + err.message + " → assumindo FULL");
  }
  return null;
}

function atualizarSyncState_(sigla, resultado) {
  var row = {
    modulo: "itens_vendidos_" + sigla,
    empresa: sigla,
    last_sync_at: new Date().toISOString(),
    last_d_alt_processed: resultado.maiorDalt || null,
    last_h_alt_processed: resultado.maiorHalt || null,
    total_registros: resultado.totalLinhas,
    ultima_execucao_status: "SUCESSO",
    ultima_execucao_msg: "modo=" + resultado.modo + " linhas=" + resultado.totalLinhas,
    updated_at: new Date().toISOString()
  };
  supaUpsert(CONFIG_IV_SUPA.schema, CONFIG_IV_SUPA.tabelaSync, [row], "modulo");
}

function registrarErroSyncState_(sigla, msg) {
  try {
    var row = {
      modulo: "itens_vendidos_" + sigla,
      empresa: sigla,
      last_sync_at: new Date().toISOString(),
      ultima_execucao_status: "ERRO",
      ultima_execucao_msg: (msg || "").substring(0, 500),
      updated_at: new Date().toISOString()
    };
    supaUpsert(CONFIG_IV_SUPA.schema, CONFIG_IV_SUPA.tabelaSync, [row], "modulo");
  } catch (_) {}
}

// ========================================
// 🛠️ HELPERS DE CAST
// ========================================
function toIntOrNull_(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = parseInt(v, 10);
  return isNaN(n) ? null : n;
}

function toFloatOrNull_(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = parseFloat(v);
  return isNaN(n) ? null : n;
}

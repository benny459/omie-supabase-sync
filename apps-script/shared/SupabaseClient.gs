// ════════════════════════════════════════════════════════════════════════════
// 🔌 SUPABASE CLIENT — Helper reutilizável para Apps Script → Supabase
//
// USO:
//  1. Cole este arquivo no seu projeto Apps Script (como um .gs novo)
//  2. Configure as credenciais UMA VEZ executando supaSetupCredenciais()
//  3. Use supaUpsert(), supaSelect(), supaSelectAllPaginated() nos seus scripts
//
// SEGURANÇA: credenciais ficam em PropertiesService (equivalente a env vars).
// ════════════════════════════════════════════════════════════════════════════

// ========================================
// 🔐 CONFIG INICIAL (rodar 1x manualmente)
// ========================================
function supaSetupCredenciais() {
  var props = PropertiesService.getScriptProperties();
  props.setProperty('SUPABASE_URL', 'https://zodflkfdnjhtwcjutbjl.supabase.co');
  props.setProperty('SUPABASE_SERVICE_ROLE_KEY', 'COLE_A_SERVICE_ROLE_KEY_AQUI');
  Logger.log("✅ Credenciais Supabase salvas em ScriptProperties");
  Logger.log("   Agora substitua 'COLE_A_SERVICE_ROLE_KEY_AQUI' pela sua key real e rode novamente.");
}

function supaGetConfig() {
  var props = PropertiesService.getScriptProperties();
  var url = props.getProperty('SUPABASE_URL');
  var key = props.getProperty('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key || key === 'COLE_A_SERVICE_ROLE_KEY_AQUI') {
    throw new Error("Credenciais Supabase não configuradas. Execute supaSetupCredenciais() uma vez.");
  }
  return { url: url, key: key };
}

// ========================================
// ⚙️ CONFIG DO CLIENT
// ========================================
var SUPA_CFG = {
  maxTentativas: 4,
  backoffBaseMs: 2000,
  maxRowsPorUpsert: 500,
  timeoutMs: 55000
};

// ========================================
// 🔁 FETCH INTERNO COM RETRY
// ========================================
function supaFetchComRetry_(url, options) {
  var ultimaResp = null;
  var ultimoErro = null;

  for (var t = 1; t <= SUPA_CFG.maxTentativas; t++) {
    try {
      var resp = UrlFetchApp.fetch(url, options);
      var code = resp.getResponseCode();

      if (code >= 200 && code < 300) {
        if (t > 1) Logger.log("   ✅ Supabase retry sucesso na tentativa " + t);
        return resp;
      }

      if (code === 429 || code >= 500) {
        ultimaResp = resp;
        if (t < SUPA_CFG.maxTentativas) {
          var espera = SUPA_CFG.backoffBaseMs * Math.pow(2, t - 1);
          Logger.log("   ⚠️ Supabase HTTP " + code + " (tent " + t + "/" + SUPA_CFG.maxTentativas + ") → esperando " + (espera/1000) + "s");
          Utilities.sleep(espera);
          continue;
        }
      } else {
        return resp;
      }
    } catch (err) {
      ultimoErro = err;
      if (t < SUPA_CFG.maxTentativas) {
        Utilities.sleep(SUPA_CFG.backoffBaseMs * t);
        continue;
      }
    }
  }
  if (ultimaResp) return ultimaResp;
  throw ultimoErro || new Error("Supabase: falha após " + SUPA_CFG.maxTentativas + " tentativas");
}

// ========================================
// 📤 UPSERT — insert ou update em massa
// ========================================
function supaUpsert(schema, table, records, onConflict) {
  if (!records || records.length === 0) return { inseridos: 0, atualizados: 0 };
  var cfg = supaGetConfig();

  var totalProcessados = 0;
  var chunks = supaChunk_(records, SUPA_CFG.maxRowsPorUpsert);

  for (var c = 0; c < chunks.length; c++) {
    var chunk = chunks[c];
    var url = cfg.url + "/rest/v1/" + encodeURIComponent(table);
    if (onConflict) url += "?on_conflict=" + encodeURIComponent(onConflict);

    var headers = {
      "apikey": cfg.key,
      "Authorization": "Bearer " + cfg.key,
      "Content-Type": "application/json",
      "Prefer": "resolution=merge-duplicates,return=minimal",
      "Content-Profile": schema,
      "Accept-Profile": schema
    };

    var resp = supaFetchComRetry_(url, {
      method: "post",
      headers: headers,
      payload: JSON.stringify(chunk),
      muteHttpExceptions: true
    });

    var code = resp.getResponseCode();
    if (code < 200 || code >= 300) {
      var body = resp.getContentText().substring(0, 400);
      throw new Error("Supabase UPSERT falhou HTTP " + code + " | " + body);
    }
    totalProcessados += chunk.length;
    Logger.log("   📤 Supabase UPSERT: " + chunk.length + " rows → " + schema + "." + table + " (lote " + (c+1) + "/" + chunks.length + ")");
  }
  return { total: totalProcessados };
}

// ========================================
// 📥 SELECT — query simples via PostgREST
// ========================================
function supaSelect(schema, table, queryString) {
  var cfg = supaGetConfig();
  var url = cfg.url + "/rest/v1/" + encodeURIComponent(table);
  if (queryString) url += "?" + queryString;

  var headers = {
    "apikey": cfg.key,
    "Authorization": "Bearer " + cfg.key,
    "Accept": "application/json",
    "Accept-Profile": schema
  };

  var resp = supaFetchComRetry_(url, {
    method: "get",
    headers: headers,
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Supabase SELECT falhou HTTP " + code + " | " + resp.getContentText().substring(0, 400));
  }
  return JSON.parse(resp.getContentText());
}

// ========================================
// 📥 SELECT ALL (paginado) — lê TODAS as linhas
// ========================================
function supaSelectAllPaginated(schema, table, queryString, pageSize) {
  pageSize = pageSize || 1000;
  var todos = [];
  var offset = 0;
  var continuar = true;

  while (continuar) {
    var qs = (queryString ? queryString + "&" : "") + "limit=" + pageSize + "&offset=" + offset;
    var pagina = supaSelect(schema, table, qs);
    todos = todos.concat(pagina);

    if (pagina.length < pageSize) {
      continuar = false;
    } else {
      offset += pageSize;
    }
    if (offset > 5000000) {
      Logger.log("⚠️ supaSelectAllPaginated: abortando em 5M linhas (safety cap)");
      break;
    }
  }
  return todos;
}

// ========================================
// 🗑️ DELETE — remove por filtro
// ========================================
function supaDelete(schema, table, queryString) {
  var cfg = supaGetConfig();
  var url = cfg.url + "/rest/v1/" + encodeURIComponent(table);
  if (queryString) url += "?" + queryString;

  var headers = {
    "apikey": cfg.key,
    "Authorization": "Bearer " + cfg.key,
    "Prefer": "return=minimal",
    "Content-Profile": schema,
    "Accept-Profile": schema
  };

  var resp = supaFetchComRetry_(url, {
    method: "delete",
    headers: headers,
    muteHttpExceptions: true
  });

  var code = resp.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error("Supabase DELETE falhou HTTP " + code + " | " + resp.getContentText().substring(0, 400));
  }
  return true;
}

// ========================================
// 🔢 COUNT — retorna número de linhas
// ========================================
function supaCount(schema, table, queryString) {
  var cfg = supaGetConfig();
  var url = cfg.url + "/rest/v1/" + encodeURIComponent(table) + "?select=*";
  if (queryString) url += "&" + queryString;

  var headers = {
    "apikey": cfg.key,
    "Authorization": "Bearer " + cfg.key,
    "Prefer": "count=exact",
    "Range": "0-0",
    "Accept-Profile": schema
  };

  var resp = supaFetchComRetry_(url, {
    method: "get",
    headers: headers,
    muteHttpExceptions: true
  });

  var contentRange = resp.getHeaders()["content-range"] || resp.getHeaders()["Content-Range"];
  if (contentRange) {
    var m = contentRange.match(/\/(\d+)$/);
    if (m) return parseInt(m[1], 10);
  }
  return -1;
}

// ========================================
// 🧪 TESTE DE CONEXÃO
// ========================================
function supaTestarConexao() {
  try {
    var cfg = supaGetConfig();
    Logger.log("🔌 Testando Supabase em " + cfg.url);

    var rows = supaSelect('sales', 'itens_vendidos', 'select=empresa&limit=1');
    Logger.log("✅ Conexão OK (schema sales). Retornou " + rows.length + " linha(s).");

    try {
      var rowsOrders = supaSelect('orders', 'nfe_entrada', 'select=empresa&limit=1');
      Logger.log("✅ Conexão OK (schema orders). Retornou " + rowsOrders.length + " linha(s).");
    } catch (e) {
      Logger.log("ℹ️ Schema orders não acessível (pode não existir ainda): " + e.message);
    }

    return { ok: true };
  } catch (err) {
    Logger.log("❌ Erro: " + err.message);
    return { ok: false, erro: err.message };
  }
}

// ========================================
// 🛠️ HELPER: divide array em chunks
// ========================================
function supaChunk_(arr, size) {
  var chunks = [];
  for (var i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

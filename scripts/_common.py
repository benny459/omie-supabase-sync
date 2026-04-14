#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🔧 COMMON — Utilitários compartilhados entre todos os importers Omie → Supabase
─────────────────────────────────────────────────────────────────────────────
Módulo base que todos os scripts `import_*.py` importam.

Centraliza:
  - Config via env vars (credenciais Supabase, Omie por empresa)
  - HTTP helpers com retry (429 agressivo + 5xx exponencial)
  - Helpers de cast (to_int, to_float)
  - Supabase UPSERT/SELECT via PostgREST
  - Sync state read/write
  - Fetch paginado genérico da Omie

Nada de pip install: só stdlib.
═════════════════════════════════════════════════════════════════════════════
"""
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

# ══════════════════════════════════════════════════════════════════════════
# 🎮 CONFIG
# ══════════════════════════════════════════════════════════════════════════

def env(name: str, default: str = None, required: bool = False) -> str:
    v = os.environ.get(name, default)
    if required and not v:
        print(f"❌ Variável de ambiente obrigatória não definida: {name}")
        sys.exit(2)
    return v

SUPABASE_URL = env("SUPABASE_URL", required=True).rstrip("/")
SUPABASE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", required=True)

EMPRESAS_ALVO = [s.strip() for s in env("EMPRESAS_ALVO", "SF").split(",") if s.strip()]
PAUSA_ENTRE_CHAMADAS = int(env("PAUSA_ENTRE_CHAMADAS", "2"))
MAX_TENTATIVAS_OMIE = 5
SUPABASE_BATCH_SIZE = 500

# Credenciais Omie por empresa
def _creds_empresa(sigla: str):
    key = env(f"OMIE_APP_KEY_{sigla}")
    secret = env(f"OMIE_APP_SECRET_{sigla}")
    if not key or not secret:
        return None
    return {"app_key": key, "app_secret": secret}

EMPRESAS_OMIE = {sigla: _creds_empresa(sigla) for sigla in ["SF", "CD", "WW"]}

# ══════════════════════════════════════════════════════════════════════════
# 🛠️ HTTP HELPERS
# ══════════════════════════════════════════════════════════════════════════

def http_request(url, method, headers, body=None, timeout=60):
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})

def http_post_json(url, data, headers, timeout=60):
    payload = json.dumps(data).encode("utf-8")
    return http_request(url, "POST", headers, payload, timeout)

def http_get(url, headers, timeout=30):
    return http_request(url, "GET", headers, None, timeout)

# ══════════════════════════════════════════════════════════════════════════
# 🔁 OMIE FETCH COM RETRY (429 agressivo + 5xx exponencial)
# ══════════════════════════════════════════════════════════════════════════

def fetch_omie(url: str, call: str, sigla: str, param: dict):
    """Chamada genérica na API Omie com retry. Retorna dict ou lança exceção."""
    creds = EMPRESAS_OMIE.get(sigla)
    if not creds:
        raise RuntimeError(f"Credenciais Omie ausentes pra {sigla}")

    payload = {
        "call": call,
        "app_key": creds["app_key"],
        "app_secret": creds["app_secret"],
        "param": [param],
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "OmieImporter-GHA/1.0",
    }

    for t in range(1, MAX_TENTATIVAS_OMIE + 1):
        code, body, _ = http_post_json(url, payload, headers)
        if code == 200:
            if t > 1:
                print(f"   ✅ Omie retry sucesso (tent {t})")
            return json.loads(body.decode("utf-8"))

        text = body[:300].decode("utf-8", errors="replace")

        # 500 "Não existem registros para a página [X]" = paginação normal chegou ao fim
        if code == 500 and "ao existem registros para a p" in text:
            return {"_empty_page": True}

        if code == 429:
            espera = 20 * t  # 20, 40, 60, 80s
            print(f"   ⚠️ Omie 429 (tent {t}/{MAX_TENTATIVAS_OMIE}) → esperando {espera}s", flush=True)
            time.sleep(espera)
            continue
        if code >= 500:
            espera = 3 * (2 ** (t - 1))
            print(f"   ⚠️ Omie HTTP {code} (tent {t}/{MAX_TENTATIVAS_OMIE}) → {espera}s | {text[:100]}", flush=True)
            time.sleep(espera)
            continue

        raise RuntimeError(f"Omie HTTP {code}: {text}")

    raise RuntimeError(f"Omie falhou após {MAX_TENTATIVAS_OMIE} tentativas")

def fetch_omie_paginated(url: str, call: str, sigla: str, list_field: str,
                          page_size: int = 100, extra_param: dict = None,
                          page_key: str = "pagina", size_key: str = "registros_por_pagina",
                          label: str = "items"):
    """
    Fetch paginado genérico. Retorna list de todos os items da API.

    - url: URL completa do endpoint Omie
    - call: nome do método (ex: "ListarPedidos")
    - sigla: empresa (SF, CD, WW)
    - list_field: nome do campo no response que contém a array (ex: "pedido_venda_produto")
    - page_size: registros por página (Omie limita a 100 em muitos endpoints)
    - extra_param: dict com params extras (filtros, etc)
    - page_key/size_key: nome dos params de paginação (alguns endpoints usam "nPagina"/"nRegPorPagina")
    - label: rótulo pra log
    """
    all_items = []
    pagina = 1
    while True:
        param = {page_key: pagina, size_key: page_size}
        if extra_param:
            param.update(extra_param)

        print(f"   ⬇️  {sigla} | {label} pág {pagina} ({page_size}/p)...", end=" ", flush=True)
        data = fetch_omie(url, call, sigla, param)

        if data.get("_empty_page"):
            print("fim (Omie 500 = sem registros).")
            break

        items = data.get(list_field) or []
        if not items:
            print("vazio, fim.")
            break

        all_items.extend(items)
        tot_pag = data.get("total_de_paginas", "?")
        tot_reg = data.get("total_de_registros", "?")
        print(f"{len(items)} registros (acum: {len(all_items)} | {pagina}/{tot_pag} pág, {tot_reg} total API)")

        if len(items) < page_size:
            break
        pagina += 1
        time.sleep(PAUSA_ENTRE_CHAMADAS)

    return all_items

# ══════════════════════════════════════════════════════════════════════════
# 🔄 FETCH + UPSERT STREAMING (pra tabelas grandes)
# UPSERTa cada batch de páginas imediatamente — se der timeout, salva progresso
# ══════════════════════════════════════════════════════════════════════════

def fetch_and_upsert_streaming(
    url: str, call: str, sigla: str, list_field: str,
    schema: str, table: str, pk: str, mapper_fn,
    page_size: int = 100, extra_param: dict = None,
    page_key: str = "pagina", size_key: str = "registros_por_pagina",
    max_seconds: int = 7000,  # ~2h
    upsert_every: int = 500,  # UPSERTa a cada N rows
    label: str = "items"
):
    """
    Fetch paginado + UPSERT em batches. Salva progresso mesmo se interrompido.

    Returns: (total_rows, completed: bool, pages_fetched: int)
    """
    start = time.time()
    pagina = 1
    total_rows = 0
    pages_fetched = 0
    buffer = []
    completed = False

    while True:
        elapsed = time.time() - start
        if elapsed > max_seconds:
            print(f"\n   ⏸️ Limite de tempo ({int(max_seconds)}s / {int(max_seconds/60)}min) atingido na pág {pagina}.")
            print(f"   Salvando {len(buffer)} rows pendentes...")
            if buffer:
                supa_upsert(schema, table, buffer, pk)
                total_rows += len(buffer)
                buffer = []
            break

        param = {page_key: pagina, size_key: page_size}
        if extra_param:
            param.update(extra_param)

        print(f"   ⬇️  {sigla} | {label} pág {pagina} ({page_size}/p)...", end=" ", flush=True)
        data = fetch_omie(url, call, sigla, param)

        if data.get("_empty_page"):
            print("fim (Omie 500 = sem registros).")
            completed = True
            break

        items = data.get(list_field) or []
        if not items:
            print("vazio, fim.")
            completed = True
            break

        rows = [mapper_fn(item, sigla) for item in items]
        rows = [r for r in rows if r]  # remove None
        buffer.extend(rows)
        pages_fetched += 1

        tot_pag = data.get("total_de_paginas") or data.get("nTotPaginas") or "?"
        tot_reg = data.get("total_de_registros") or data.get("nTotRegistros") or "?"
        print(f"{len(items)} items → buffer {len(buffer)} (pág {pagina}/{tot_pag}, {tot_reg} total)")

        # UPSERT quando buffer atinge o threshold
        if len(buffer) >= upsert_every:
            print(f"   📤 UPSERT batch: {len(buffer)} rows → {schema}.{table}")
            supa_upsert(schema, table, buffer, pk)
            total_rows += len(buffer)
            buffer = []

        if len(items) < page_size:
            completed = True
            break
        pagina += 1
        time.sleep(PAUSA_ENTRE_CHAMADAS)

    # Flush remaining buffer
    if buffer:
        print(f"   📤 UPSERT final: {len(buffer)} rows → {schema}.{table}")
        supa_upsert(schema, table, buffer, pk)
        total_rows += len(buffer)

    elapsed = int(time.time() - start)
    status = "COMPLETO" if completed else f"PARCIAL (parou na pág {pagina})"
    print(f"   {'✅' if completed else '⏸️'} {sigla} {label}: {total_rows} rows em {elapsed}s — {status}")

    return total_rows, completed, pages_fetched

# ══════════════════════════════════════════════════════════════════════════
# 🗺️ HELPERS DE CAST
# ══════════════════════════════════════════════════════════════════════════

def to_int(v):
    if v is None or v == "":
        return None
    try:
        return int(v)
    except (ValueError, TypeError):
        return None

def to_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (ValueError, TypeError):
        return None

def to_str_or_none(v):
    if v is None or v == "":
        return None
    return str(v)

# ══════════════════════════════════════════════════════════════════════════
# 📥📤 SUPABASE CLIENTS
# ══════════════════════════════════════════════════════════════════════════

def supa_headers(schema: str, extra: dict = None):
    h = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Accept-Profile": schema,
        "Content-Profile": schema,
    }
    if extra:
        h.update(extra)
    return h

def supa_upsert(schema: str, table: str, records: list, on_conflict: str):
    if not records:
        return 0
    base_url = f"{SUPABASE_URL}/rest/v1/{table}?on_conflict={urllib.parse.quote(on_conflict)}"
    headers = supa_headers(schema, {"Prefer": "resolution=merge-duplicates,return=minimal"})

    total = 0
    for i in range(0, len(records), SUPABASE_BATCH_SIZE):
        chunk = records[i:i + SUPABASE_BATCH_SIZE]
        code, body, _ = http_post_json(base_url, chunk, headers)
        if code < 200 or code >= 300:
            raise RuntimeError(f"Supabase UPSERT HTTP {code}: {body[:500].decode('utf-8', errors='replace')}")
        total += len(chunk)
    return total

def supa_select(schema: str, table: str, query: str):
    url = f"{SUPABASE_URL}/rest/v1/{table}?{query}"
    code, body, _ = http_get(url, supa_headers(schema))
    if code < 200 or code >= 300:
        raise RuntimeError(f"Supabase SELECT HTTP {code}: {body[:300].decode('utf-8', errors='replace')}")
    return json.loads(body.decode("utf-8"))

# ══════════════════════════════════════════════════════════════════════════
# 💾 SYNC STATE
# ══════════════════════════════════════════════════════════════════════════

SYNC_TABLE = "sync_state"
SYNC_SCHEMA = "sales"

def get_last_d_alt(modulo: str):
    try:
        rows = supa_select(
            SYNC_SCHEMA,
            SYNC_TABLE,
            f"select=last_d_alt_processed&modulo=eq.{urllib.parse.quote(modulo)}&limit=1"
        )
        if rows and rows[0].get("last_d_alt_processed"):
            return rows[0]["last_d_alt_processed"]
    except Exception as e:
        print(f"   ⚠️ Falha lendo sync_state: {e}")
    return None

def count_rows(schema: str, table: str, empresa: str = None):
    """Conta rows numa tabela, opcionalmente filtrando por empresa."""
    try:
        q = "select=empresa&limit=1"
        if empresa:
            q += f"&empresa=eq.{urllib.parse.quote(empresa)}"
        url = f"{SUPABASE_URL}/rest/v1/{table}?{q}"
        headers = supa_headers(schema)
        headers["Prefer"] = "count=exact"
        headers["Range"] = "0-0"
        _, _, resp_headers = http_request(url, "GET", headers)
        cr = resp_headers.get("content-range") or resp_headers.get("Content-Range") or ""
        m = cr.split("/")
        return int(m[1]) if len(m) > 1 and m[1].isdigit() else 0
    except Exception:
        return -1

def upsert_with_tracking(schema: str, table: str, records: list,
                          on_conflict: str, empresa: str = None):
    """UPSERT com tracking de inserted vs updated.
    Retorna (total_upserted, rows_inserted, rows_updated, count_before, count_after)."""
    if not records:
        return 0, 0, 0, 0, 0
    count_before = count_rows(schema, table, empresa)
    total = supa_upsert(schema, table, records, on_conflict)
    count_after = count_rows(schema, table, empresa)
    inserted = max(0, count_after - count_before) if count_before >= 0 and count_after >= 0 else 0
    updated = max(0, total - inserted)
    return total, inserted, updated, count_before, count_after

def update_sync_state(modulo: str, empresa: str, total_linhas: int,
                      maior_d_alt: str = None, maior_h_alt: str = None,
                      modo: str = "FULL", status: str = "SUCESSO", erro: str = None,
                      rows_inserted: int = 0, rows_updated: int = 0,
                      rows_before: int = 0, duracao_segundos: int = 0):
    row = {
        "modulo": modulo,
        "empresa": empresa,
        "last_sync_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_registros": total_linhas,
        "ultima_execucao_status": status,
        "ultima_execucao_msg": erro if erro else f"modo={modo} linhas={total_linhas}",
        "modo": modo,
        "rows_inserted": rows_inserted,
        "rows_updated": rows_updated,
        "rows_before": rows_before,
        "duracao_segundos": duracao_segundos,
    }
    if maior_d_alt:
        row["last_d_alt_processed"] = maior_d_alt
    if maior_h_alt:
        row["last_h_alt_processed"] = maior_h_alt
    supa_upsert(SYNC_SCHEMA, SYNC_TABLE, [row], "modulo")

# ══════════════════════════════════════════════════════════════════════════
# 🪞 TRIGGER SHEETS MIRROR (opcional, via Web App Apps Script)
# ══════════════════════════════════════════════════════════════════════════

def trigger_sheets_mirror(cfg_name: str):
    """Chama o webhook do Apps Script pra mirror de uma tabela específica.
    Skipa silenciosamente se não configurado ou falhar (o mirror time-based cobre)."""
    url = env("SHEETS_MIRROR_URL", "")
    token = env("SHEETS_MIRROR_TOKEN", "")
    if not url or not token:
        print(f"\nℹ️  Sheets mirror via webhook skipado (time-based trigger no Apps Script cobre a cada 15min)")
        return

    print(f"\n🪞 Disparando mirror: {cfg_name}")
    try:
        code, body, _ = http_post_json(url, {"token": token, "cfgName": cfg_name},
                                        {"User-Agent": "OmieGHA/1.0"}, timeout=300)
        txt = body[:300].decode("utf-8", errors="replace") if body else ""
        if code < 200 or code >= 300:
            print(f"   ⚠️  Mirror HTTP {code} | {txt[:150]}")
            return
        resp = json.loads(txt)
        if resp.get("ok"):
            print(f"   ✅ Mirror OK: {resp.get('linhas')} linhas em {resp.get('segundos')}s")
        else:
            print(f"   ⚠️  Mirror falhou: {resp.get('error')}")
    except Exception as e:
        print(f"   ⚠️  Mirror exceção: {e}")

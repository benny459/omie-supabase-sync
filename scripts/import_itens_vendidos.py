#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🏆 IMPORT ITENS VENDIDOS — Omie → Supabase
─────────────────────────────────────────────────────────────────────────────
Roda em GitHub Actions (ou local). Mesma lógica do Apps Script V14:
  - Fetch paginado da Omie (100/página, throttle, retry 429/5xx)
  - UPSERT idempotente em sales.itens_vendidos (ON CONFLICT empresa+pedido+item)
  - Lê sync_state para decidir FULL vs INCREMENTAL
  - Atualiza sync_state ao final

VARIÁVEIS DE AMBIENTE (obrigatórias):
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
  OMIE_APP_KEY_SF, OMIE_APP_SECRET_SF
  OMIE_APP_KEY_CD, OMIE_APP_SECRET_CD  (opcional)
  OMIE_APP_KEY_WW, OMIE_APP_SECRET_WW  (opcional)

OPCIONAIS:
  EMPRESAS_ALVO          default "SF"          (CSV: "SF,CD,WW")
  DATA_INICIO_FULL       default "01/01/2025"
  FORCAR_FULL            default "false"       ("true" para ignorar sync_state)
  ITENS_POR_PAGINA       default "100"         (max real do endpoint)
  PAUSA_ENTRE_CHAMADAS   default "2"           (segundos)

USO LOCAL:
    export SUPABASE_URL=https://...
    export SUPABASE_SERVICE_ROLE_KEY=eyJ...
    export OMIE_APP_KEY_SF=...
    export OMIE_APP_SECRET_SF=...
    python3 scripts/import_itens_vendidos.py

USO EM GITHUB ACTIONS:
    Secrets definidos no repo → workflow exporta como env → script roda.

Pré-requisitos: Python 3.9+ (só stdlib, nada de pip install)
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
# 🎮 CONFIG (lê de env vars, com defaults sensatos)
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
DATA_INICIO_FULL = env("DATA_INICIO_FULL", "01/01/2025")
FORCAR_FULL = env("FORCAR_FULL", "false").lower() == "true"
ITENS_POR_PAGINA = int(env("ITENS_POR_PAGINA", "100"))
PAUSA_ENTRE_CHAMADAS = int(env("PAUSA_ENTRE_CHAMADAS", "2"))
MAX_TENTATIVAS_OMIE = 5

OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/"

# Credenciais Omie por empresa (lidas das env vars OMIE_APP_KEY_{sigla})
def _creds_empresa(sigla: str):
    key = env(f"OMIE_APP_KEY_{sigla}")
    secret = env(f"OMIE_APP_SECRET_{sigla}")
    if not key or not secret:
        return None
    return {"app_key": key, "app_secret": secret}

EMPRESAS_OMIE = {sigla: _creds_empresa(sigla) for sigla in ["SF", "CD", "WW"]}

# Supabase
SUPABASE_SCHEMA = "sales"
SUPABASE_TABLE = "itens_vendidos"
SUPABASE_SYNC_TABLE = "sync_state"
SUPABASE_BATCH_SIZE = 500

# ══════════════════════════════════════════════════════════════════════════
# 🛠️ HTTP HELPERS (só stdlib)
# ══════════════════════════════════════════════════════════════════════════

def http_request(url: str, method: str, headers: dict, body: bytes = None, timeout: int = 60):
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, resp.read(), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read(), dict(e.headers or {})

def http_post_json(url: str, data, headers: dict, timeout: int = 60):
    payload = json.dumps(data).encode("utf-8")
    return http_request(url, "POST", headers, payload, timeout)

def http_get(url: str, headers: dict, timeout: int = 30):
    return http_request(url, "GET", headers, None, timeout)

# ══════════════════════════════════════════════════════════════════════════
# 🔁 OMIE FETCH COM RETRY
# ══════════════════════════════════════════════════════════════════════════

def fetch_omie_page(sigla: str, pagina: int, filtro_data: str):
    creds = EMPRESAS_OMIE.get(sigla)
    if not creds:
        raise RuntimeError(f"Credenciais Omie ausentes pra {sigla} — defina OMIE_APP_KEY_{sigla} e OMIE_APP_SECRET_{sigla}")

    payload = {
        "call": "ListarPedidos",
        "app_key": creds["app_key"],
        "app_secret": creds["app_secret"],
        "param": [{
            "pagina": pagina,
            "registros_por_pagina": ITENS_POR_PAGINA,
            "apenas_importado_api": "N",
            "filtrar_por_data_de": filtro_data,
        }]
    }
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "OmieImporter-GHA/1.0",
    }

    for t in range(1, MAX_TENTATIVAS_OMIE + 1):
        code, body, _ = http_post_json(OMIE_URL, payload, headers)
        if code == 200:
            if t > 1:
                print(f"   ✅ Omie retry sucesso (tent {t})")
            return json.loads(body.decode("utf-8"))

        text_preview = body[:300].decode("utf-8", errors="replace")

        # Omie às vezes retorna 500 com "Não existem registros para a página [X]"
        # Isso é NORMAL na paginação — significa "fim" — não é erro.
        if code == 500 and "ao existem registros para a p" in text_preview:
            return {"pedido_venda_produto": []}

        if code == 429:
            espera = 20 * t
            print(f"   ⚠️ Omie HTTP 429 (tent {t}/{MAX_TENTATIVAS_OMIE}) → esperando {espera}s", flush=True)
            time.sleep(espera)
            continue
        if code >= 500:
            espera = 3 * (2 ** (t - 1))
            print(f"   ⚠️ Omie HTTP {code} (tent {t}/{MAX_TENTATIVAS_OMIE}) → esperando {espera}s | {text_preview[:100]}", flush=True)
            time.sleep(espera)
            continue
        raise RuntimeError(f"Omie HTTP {code}: {text_preview}")
    raise RuntimeError(f"Omie falhou após {MAX_TENTATIVAS_OMIE} tentativas")

# ══════════════════════════════════════════════════════════════════════════
# 🗺️ MAPEAMENTO OMIE → SUPABASE
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

def map_pedido_to_rows(pedido: dict, sigla: str):
    cab = pedido.get("cabecalho") or {}
    info = pedido.get("infoCadastro") or {}
    itens = pedido.get("det") or []
    rows = []
    for it in itens:
        prod = it.get("produto") or {}
        imp = it.get("imposto") or {}
        ide = it.get("ide") or {}

        rows.append({
            "empresa": sigla,
            "codigo_pedido": to_int(cab.get("codigo_pedido")),
            "codigo_item": to_int(ide.get("codigo_item")),

            "numero_pedido": cab.get("numero_pedido") or None,
            "data_previsao": cab.get("data_previsao") or None,
            "codigo_cliente": to_int(cab.get("codigo_cliente")),
            "etapa": cab.get("etapa") or None,
            "codigo_parcela": str(cab.get("codigo_parcela")) if cab.get("codigo_parcela") else None,
            "simples_nacional": ide.get("simples_nacional") or None,
            "codigo_item_integracao": ide.get("codigo_item_integracao") or None,

            "codigo_produto": to_int(prod.get("codigo_produto")),
            "codigo_prod_omie": str(prod.get("codigo")) if prod.get("codigo") else None,
            "descricao": prod.get("descricao") or None,
            "unidade": prod.get("unidade") or None,
            "quantidade": to_float(prod.get("quantidade")),
            "valor_unitario": to_float(prod.get("valor_unitario")),
            "valor_total": to_float(prod.get("valor_total")),
            "ncm": prod.get("ncm") or None,

            "tipo_desconto": prod.get("tipo_desconto") or None,
            "valor_desconto": to_float(prod.get("valor_desconto")),
            "percentual_desconto": to_float(prod.get("percentual_desconto")),

            "cofins_st": imp.get("cofins_situacao_tributaria") or None,
            "pis_st": imp.get("pis_situacao_tributaria") or None,
            "icms_origem": imp.get("icms_origem") or None,
            "icms_st": imp.get("icms_situacao_tributaria") or None,

            "d_inc": info.get("dInc") or None,
            "h_inc": info.get("hInc") or None,
            "d_alt": info.get("dAlt") or None,
            "h_alt": info.get("hAlt") or None,
        })
    return rows

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

def obter_ultimo_dalt(sigla: str):
    try:
        rows = supa_select(
            SUPABASE_SCHEMA,
            SUPABASE_SYNC_TABLE,
            f"select=last_d_alt_processed&modulo=eq.{urllib.parse.quote('itens_vendidos_' + sigla)}&limit=1"
        )
        if rows and rows[0].get("last_d_alt_processed"):
            return rows[0]["last_d_alt_processed"]
    except Exception as e:
        print(f"   ⚠️ Falha lendo sync_state: {e} → assumindo FULL")
    return None

def atualizar_sync_state(sigla: str, resultado: dict, status: str = "SUCESSO", erro: str = None):
    row = {
        "modulo": f"itens_vendidos_{sigla}",
        "empresa": sigla,
        "last_sync_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "total_registros": resultado.get("total_linhas", 0),
        "ultima_execucao_status": status,
        "ultima_execucao_msg": erro if erro else f"modo={resultado.get('modo','')} pedidos={resultado.get('total_pedidos',0)} linhas={resultado.get('total_linhas',0)}",
    }
    if resultado.get("maior_d_alt"):
        row["last_d_alt_processed"] = resultado["maior_d_alt"]
        row["last_h_alt_processed"] = resultado.get("maior_h_alt") or None
    supa_upsert(SUPABASE_SCHEMA, SUPABASE_SYNC_TABLE, [row], "modulo")

# ══════════════════════════════════════════════════════════════════════════
# 🚀 IMPORT POR EMPRESA
# ══════════════════════════════════════════════════════════════════════════

def importar_empresa(sigla: str):
    inicio = time.time()

    # Decide FULL vs INCREMENTAL
    ultimo_dalt = None
    modo = "FULL"
    filtro_data = DATA_INICIO_FULL
    if not FORCAR_FULL:
        ultimo_dalt = obter_ultimo_dalt(sigla)
        if ultimo_dalt:
            modo = "INCREMENTAL"
            filtro_data = ultimo_dalt

    print(f"\n▶️  {sigla} | Modo: {modo} | Filtro data: {filtro_data}")

    pagina = 1
    total_linhas = 0
    total_pedidos = 0
    maior_d_alt = ultimo_dalt or ""
    maior_h_alt = ""

    while True:
        print(f"   ⬇️  {sigla} | Pág {pagina} ({ITENS_POR_PAGINA}/p)...", end=" ", flush=True)
        data = fetch_omie_page(sigla, pagina, filtro_data)
        pedidos = data.get("pedido_venda_produto") or []

        if not pedidos:
            print("vazio, fim.")
            break

        rows = []
        for p in pedidos:
            rows.extend(map_pedido_to_rows(p, sigla))

        for r in rows:
            if r.get("d_alt") and r["d_alt"] > maior_d_alt:
                maior_d_alt = r["d_alt"]
                maior_h_alt = r.get("h_alt") or ""

        n_upsert = supa_upsert(SUPABASE_SCHEMA, SUPABASE_TABLE, rows, "empresa,codigo_pedido,codigo_item")
        total_linhas += n_upsert
        total_pedidos += len(pedidos)

        tot_pag_api = data.get("total_de_paginas", "?")
        tot_reg_api = data.get("total_de_registros", "?")
        print(f"{len(pedidos)} pedidos → {n_upsert} linhas | acum: {total_linhas} ({pagina}/{tot_pag_api} pág, {tot_reg_api} total API)")

        if len(pedidos) < ITENS_POR_PAGINA:
            break
        pagina += 1
        time.sleep(PAUSA_ENTRE_CHAMADAS)

    resultado = {
        "total_linhas": total_linhas,
        "total_pedidos": total_pedidos,
        "maior_d_alt": maior_d_alt,
        "maior_h_alt": maior_h_alt,
        "modo": modo,
        "segundos": int(time.time() - inicio),
    }

    atualizar_sync_state(sigla, resultado, "SUCESSO")

    print(f"   ✅ {sigla} concluído em {resultado['segundos']}s | {total_pedidos} pedidos → {total_linhas} linhas")
    return resultado

# ══════════════════════════════════════════════════════════════════════════
# 🎯 MAIN
# ══════════════════════════════════════════════════════════════════════════

def main():
    print("═══════════════════════════════════════════════════════════════")
    print("🏆 Import Itens Vendidos — Omie → Supabase")
    print("═══════════════════════════════════════════════════════════════")
    print(f"🎯 Empresas: {', '.join(EMPRESAS_ALVO)}")
    print(f"📅 Data início (FULL): {DATA_INICIO_FULL}")
    print(f"🔁 Forçar FULL: {FORCAR_FULL}")
    print(f"📡 Supabase: {SUPABASE_URL}")
    print(f"🗂  Destino: {SUPABASE_SCHEMA}.{SUPABASE_TABLE}")

    inicio_geral = time.time()
    resultados = []
    houve_erro = False

    for sigla in EMPRESAS_ALVO:
        if sigla not in EMPRESAS_OMIE or EMPRESAS_OMIE[sigla] is None:
            print(f"\n⚠️ {sigla}: credenciais não configuradas — pulando")
            continue
        try:
            r = importar_empresa(sigla)
            resultados.append({"empresa": sigla, **r})
        except Exception as e:
            houve_erro = True
            print(f"\n❌ Erro em {sigla}: {e}")
            try:
                atualizar_sync_state(sigla, {"total_linhas": 0, "total_pedidos": 0, "modo": "ERRO"}, "ERRO", str(e)[:500])
            except Exception:
                pass
            resultados.append({"empresa": sigla, "erro": str(e)})

    elapsed = int(time.time() - inicio_geral)
    print()
    print("═══════════════════════════════════════════════════════════════")
    print(f"✅ GERAL concluído em {elapsed}s")
    for r in resultados:
        if "erro" in r:
            print(f"   ❌ {r['empresa']}: {r['erro']}")
        else:
            print(f"   ✅ {r['empresa']}: {r['total_pedidos']} pedidos → {r['total_linhas']} linhas ({r['modo']}, {r['segundos']}s)")
    print("═══════════════════════════════════════════════════════════════")

    # Exit code != 0 se qualquer empresa deu erro (GitHub Actions marca o run como falho)
    if houve_erro:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n⚠️ Interrompido pelo usuário")
        sys.exit(130)

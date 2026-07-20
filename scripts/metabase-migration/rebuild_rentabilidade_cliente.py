#!/usr/bin/env python3
"""
Cria/recria o dashboard "Rentabilidade por Cliente" no Metabase Hetzner v0.61.
Spec: docs/obsidian/Service/Metabase/RENTABILIDADE-03-metabase.md
Fonte: bi.v_rentabilidade_cliente (omie-data, populada pelo cron sync-custo-cliente).

Idempotente: se já existir dashboard com mesmo nome, deleta antes de recriar.

Uso:
    HETZNER_MB_URL=https://metabase.waterworks.com.br \\
    HETZNER_SESSION=<session_token> \\
    python3 rebuild_rentabilidade_cliente.py
"""

import json
import os
import socket
import time
import urllib.error
import urllib.request
import uuid

OMIE_DB_ID = 2  # "Omie (Finance + Sales)" — mesma DB que tem bi.v_rentabilidade_cliente
COLLECTION_NAME = "Análise Financeira"
DASHBOARD_NAME = "Rentabilidade por Cliente"


def http(method, url, token=None, body=None, timeout=60, retries=2):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Metabase-Session"] = token
    data = json.dumps(body).encode() if body is not None else None
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, data=data, method=method, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as r:
                b = r.read()
                return json.loads(b.decode()) if b else {}
        except urllib.error.HTTPError as e:
            err = e.read().decode(errors="replace") if hasattr(e, "read") else ""
            raise RuntimeError(f"HTTP {e.code} on {method} {url}: {err[:500]}")
        except (urllib.error.URLError, TimeoutError, ConnectionError, socket.timeout, OSError) as e:
            last = e
            if attempt < retries:
                time.sleep(3 * (attempt + 1))
    raise last


def tag(name, kind="date", display=None):
    return {
        "id": str(uuid.uuid4()),
        "name": name,
        "display-name": display or name,
        "type": kind,
        "default": None,
        "required": False,
    }


# Filtros comuns (todos aplicáveis via WHERE ... [[AND ...]]):
FILTROS_SQL = """
  WHERE 1=1
    [[AND periodo_mes >= {{mes_inicio}}]]
    [[AND periodo_mes <= {{mes_fim}}]]
    [[AND tipo_venda IN ({{tipo_venda}})]]
    [[AND codigo_projeto = {{codigo_projeto}}]]
    [[AND technician_nome IN ({{tecnico}})]]
""".strip()

FILTROS_TAGS = ["mes_inicio", "mes_fim", "tipo_venda", "codigo_projeto", "tecnico"]


CARDS = [
    # 1. KPI Faturamento
    {
        "name": "KPI · Faturamento",
        "display": "scalar",
        "sql": f"""SELECT COALESCE(SUM(faturamento), 0)::numeric(14,2) AS faturamento
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL};""",
        "tags": FILTROS_TAGS,
        "row": 0, "col": 0, "size_x": 6, "size_y": 3,
    },
    # 2. KPI Custo Técnico + Despesas
    {
        "name": "KPI · Custo Técnico + Despesas",
        "display": "scalar",
        "sql": f"""SELECT COALESCE(SUM(despesas + COALESCE(custo_mao_obra, 0)), 0)::numeric(14,2) AS custo_tec_desp
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL};""",
        "tags": FILTROS_TAGS,
        "row": 0, "col": 6, "size_x": 6, "size_y": 3,
    },
    # 3. KPI Compras
    {
        "name": "KPI · Compras (atribuídas)",
        "display": "scalar",
        "sql": f"""SELECT COALESCE(SUM(total_compras), 0)::numeric(14,2) AS compras
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL}
  AND codigo_cliente > 0;""",
        "tags": FILTROS_TAGS,
        "row": 0, "col": 12, "size_x": 6, "size_y": 3,
    },
    # 4. KPI Rentabilidade (com margem %)
    {
        "name": "KPI · Rentabilidade",
        "display": "scalar",
        "sql": f"""SELECT COALESCE(SUM(rentabilidade), 0)::numeric(14,2) AS rentabilidade
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL};""",
        "tags": FILTROS_TAGS,
        "row": 0, "col": 18, "size_x": 6, "size_y": 3,
    },
    # 5. Tabela detalhe por cliente (com margem)
    {
        "name": "Detalhe por Cliente",
        "display": "table",
        "sql": f"""SELECT
  cliente_nome AS "Cliente",
  tipo_venda AS "Tipo",
  SUM(faturamento)::numeric(14,2) AS "Faturamento",
  SUM(COALESCE(custo_mao_obra,0))::numeric(14,2) AS "Custo Técnico",
  SUM(despesas)::numeric(14,2) AS "Despesas",
  SUM(total_compras)::numeric(14,2) AS "Compras",
  SUM(rentabilidade)::numeric(14,2) AS "Rentabilidade",
  CASE WHEN SUM(faturamento) > 0
       THEN ROUND(SUM(rentabilidade) / SUM(faturamento) * 100, 1)
  END AS "Margem %"
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL}
GROUP BY 1, 2
ORDER BY SUM(rentabilidade) DESC NULLS LAST
LIMIT 200;""",
        "tags": FILTROS_TAGS,
        "row": 3, "col": 0, "size_x": 24, "size_y": 10,
    },
    # 6. Top clientes com prejuízo (espelho card 173)
    {
        "name": "Top Clientes com Prejuízo",
        "display": "table",
        "sql": f"""SELECT
  cliente_nome AS "Cliente",
  tipo_venda AS "Tipo",
  SUM(faturamento)::numeric(14,2) AS "Faturamento",
  SUM(rentabilidade)::numeric(14,2) AS "Prejuízo",
  CASE WHEN SUM(faturamento) > 0
       THEN ROUND(SUM(rentabilidade) / SUM(faturamento) * 100, 1)
  END AS "Margem %"
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL}
GROUP BY 1, 2
HAVING SUM(rentabilidade) < 0
ORDER BY SUM(rentabilidade) ASC
LIMIT 30;""",
        "tags": FILTROS_TAGS,
        "row": 13, "col": 0, "size_x": 12, "size_y": 8,
    },
    # 7. Rentabilidade por tipo de venda
    {
        "name": "Rentabilidade por Tipo de Venda",
        "display": "bar",
        "sql": f"""SELECT
  tipo_venda AS "Tipo",
  SUM(faturamento)::numeric(14,2) AS "Faturamento",
  SUM(rentabilidade)::numeric(14,2) AS "Rentabilidade"
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL}
GROUP BY 1
ORDER BY SUM(rentabilidade) DESC NULLS LAST;""",
        "tags": FILTROS_TAGS,
        "row": 13, "col": 12, "size_x": 12, "size_y": 8,
    },
    # 8. Ranking de margem % (divergente — via table + conditional formatting)
    {
        "name": "Ranking de Margem % (top 30)",
        "display": "bar",
        "sql": f"""SELECT
  cliente_nome AS "Cliente",
  CASE WHEN SUM(faturamento) > 0
       THEN ROUND(SUM(rentabilidade) / SUM(faturamento) * 100, 1)
       ELSE 0
  END AS "Margem %"
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL}
GROUP BY 1
HAVING SUM(faturamento) > 0
ORDER BY "Margem %" DESC
LIMIT 30;""",
        "tags": FILTROS_TAGS,
        "row": 21, "col": 0, "size_x": 12, "size_y": 8,
    },
    # 9. Tendência mês a mês (série temporal)
    {
        "name": "Tendência de Rentabilidade Mensal",
        "display": "line",
        "sql": f"""SELECT
  periodo_mes AS "Mês",
  SUM(faturamento)::numeric(14,2) AS "Faturamento",
  SUM(rentabilidade)::numeric(14,2) AS "Rentabilidade"
FROM bi.v_rentabilidade_cliente
{FILTROS_SQL}
GROUP BY 1
ORDER BY 1;""",
        "tags": FILTROS_TAGS,
        "row": 21, "col": 12, "size_x": 12, "size_y": 8,
    },
    # 10. Clientes órfãos (sem link) — bonus card
    {
        "name": "⚠️ Buckets não-atribuídos (COMPARTILHADAS / AVULSO_NAO_VINC / sem link)",
        "display": "table",
        "sql": """SELECT
  cliente_nome AS "Bucket",
  SUM(total_compras)::numeric(14,2) AS "Compras",
  SUM(despesas)::numeric(14,2) AS "Despesas",
  SUM(COALESCE(custo_mao_obra,0))::numeric(14,2) AS "Custo Técnico",
  (SUM(total_compras) + SUM(despesas) + SUM(COALESCE(custo_mao_obra,0)))::numeric(14,2) AS "Custo Não Atribuído"
FROM bi.v_rentabilidade_cliente
WHERE codigo_cliente < 0 OR codigo_cliente IS NULL
GROUP BY 1
HAVING (SUM(total_compras) + SUM(despesas) + SUM(COALESCE(custo_mao_obra,0))) > 0
ORDER BY "Custo Não Atribuído" DESC;""",
        "tags": [],
        "row": 29, "col": 0, "size_x": 24, "size_y": 6,
    },
]


def build_tags_map(names):
    kinds = {
        "mes_inicio": "date",
        "mes_fim": "date",
        "tipo_venda": "text",
        "codigo_projeto": "text",
        "tecnico": "text",
    }
    displays = {
        "mes_inicio": "Mês início",
        "mes_fim": "Mês fim",
        "tipo_venda": "Tipo de venda",
        "codigo_projeto": "Projeto",
        "tecnico": "Técnico",
    }
    return {n: tag(n, kinds[n], displays[n]) for n in names}


def ensure_collection(base, session, name):
    lst = http("GET", f"{base}/api/collection", session)
    for c in lst:
        if c.get("name") == name:
            return c["id"]
    return http("POST", f"{base}/api/collection", session,
                body={"name": name, "color": "#88BF4D", "parent_id": None})["id"]


def delete_existing_dashboard(base, session, name, coll_id):
    """Idempotente: apaga dashboard com mesmo nome (arquiva)."""
    lst = http("GET", f"{base}/api/dashboard", session)
    for d in lst:
        if d.get("name") == name and not d.get("archived", False):
            print(f"  arquivando dashboard existente id={d['id']}")
            http("PUT", f"{base}/api/dashboard/{d['id']}", session, body={"archived": True})


def delete_existing_cards(base, session, prefix, coll_id):
    """Arquiva cards com nome começando com prefix na collection."""
    lst = http("GET", f"{base}/api/card", session)
    for c in lst:
        if c.get("name","").startswith(prefix) and c.get("collection_id") == coll_id and not c.get("archived", False):
            http("PUT", f"{base}/api/card/{c['id']}", session, body={"archived": True})


CARD_PREFIX = "Rent · "


def main():
    base = os.environ["HETZNER_MB_URL"].rstrip("/")
    session = os.environ["HETZNER_SESSION"]

    coll_id = ensure_collection(base, session, COLLECTION_NAME)
    print(f"collection '{COLLECTION_NAME}': id={coll_id}")

    delete_existing_dashboard(base, session, DASHBOARD_NAME, coll_id)
    delete_existing_cards(base, session, CARD_PREFIX, coll_id)

    # Create cards
    card_ids = []
    for i, c in enumerate(CARDS, 1):
        tags_map = build_tags_map(c["tags"])
        parameters = []
        for name, tag_obj in tags_map.items():
            if tag_obj["type"] == "date":
                param_type = "date/month-year"
                section = "date"
            elif name in ("tipo_venda", "tecnico"):
                param_type = "string/="
                section = "string"
            else:
                param_type = "string/="
                section = "string"
            parameters.append({
                "id": tag_obj["id"],
                "type": param_type,
                "target": ["variable", ["template-tag", name]],
                "name": tag_obj["display-name"],
                "slug": name,
            })
        body = {
            "name": f"{CARD_PREFIX}{c['name']}",
            "display": c["display"],
            "database_id": OMIE_DB_ID,
            "dataset_query": {
                "database": OMIE_DB_ID,
                "type": "native",
                "native": {"query": c["sql"], "template-tags": tags_map},
            },
            "visualization_settings": c.get("viz_settings", {}),
            "parameters": parameters,
            "collection_id": coll_id,
        }
        try:
            r = http("POST", f"{base}/api/card", session, body=body)
            card_ids.append(r["id"])
            print(f"  card {i} '{c['name']}' → id={r['id']}")
        except RuntimeError as e:
            print(f"  card {i} FAILED: {e}")
            card_ids.append(None)

    # Create dashboard
    dash = http("POST", f"{base}/api/dashboard", session, body={
        "name": DASHBOARD_NAME,
        "description": "Consolidação Faturamento × Compras × Custo Técnico × Despesas por cliente. Fonte: bi.v_rentabilidade_cliente. Cron sync-custo-cliente popula custos do WW main (allka-01 daily 06:15 SP).",
        "collection_id": coll_id,
    })
    dash_id = dash["id"]
    print(f"dashboard '{DASHBOARD_NAME}' → id={dash_id}")

    # Dashboard-level parameters
    param_ids = {n: str(uuid.uuid4())[:8] for n in FILTROS_TAGS}
    dash_params = [
        {"id": param_ids["mes_inicio"], "name": "Mês início", "slug": "mes_inicio", "type": "date/month-year", "sectionId": "date"},
        {"id": param_ids["mes_fim"], "name": "Mês fim", "slug": "mes_fim", "type": "date/month-year", "sectionId": "date"},
        {"id": param_ids["tipo_venda"], "name": "Tipo de venda", "slug": "tipo_venda", "type": "string/=", "sectionId": "string"},
        {"id": param_ids["codigo_projeto"], "name": "Projeto", "slug": "codigo_projeto", "type": "string/=", "sectionId": "string"},
        {"id": param_ids["tecnico"], "name": "Técnico", "slug": "tecnico", "type": "string/=", "sectionId": "string"},
    ]
    http("PUT", f"{base}/api/dashboard/{dash_id}", session, body={"parameters": dash_params})

    # Dashcards with parameter mappings
    dashcards = []
    for i, (c, cid) in enumerate(zip(CARDS, card_ids)):
        if cid is None:
            continue
        pmaps = []
        for tag_name in c["tags"]:
            pmaps.append({
                "parameter_id": param_ids[tag_name],
                "card_id": cid,
                "target": ["variable", ["template-tag", tag_name]],
            })
        dashcards.append({
            "id": -(i + 1),
            "card_id": cid,
            "row": c["row"], "col": c["col"],
            "size_x": c["size_x"], "size_y": c["size_y"],
            "series": [],
            "visualization_settings": {},
            "parameter_mappings": pmaps,
        })

    http("PUT", f"{base}/api/dashboard/{dash_id}/cards", session,
         body={"cards": dashcards, "tabs": []})
    print(f"placed {len(dashcards)} dashcards")
    print(f"\ndashboard URL: {base}/dashboard/{dash_id}")


if __name__ == "__main__":
    main()

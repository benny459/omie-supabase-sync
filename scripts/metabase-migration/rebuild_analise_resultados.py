#!/usr/bin/env python3
"""
Recreate the "Análise de Resultados" dashboard (8 cards) on Hetzner v0.61.
Spec source: docs/obsidian/Service/Sources/metabase-analise-resultados.md

Usage:
    HETZNER_MB_URL=... HETZNER_SESSION=... python3 rebuild_analise_resultados.py
"""

import json
import os
import socket
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

OMIE_DB_ID = 2  # WaterWorks Omie Finance+Sales on Hetzner v0.61
COLLECTION_NAME = "Análise Financeira"


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
            err_body = e.read().decode(errors="replace") if hasattr(e, "read") else ""
            raise RuntimeError(f"HTTP {e.code} on {method} {url}: {err_body[:400]}")
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


CARDS = [
    {
        "name": "KPIs do Mês",
        "display": "table",
        "sql": """WITH parametros AS (SELECT {{mes_ref}}::date AS mes_ref),
mov_mes AS (
  SELECT
    SUM(CASE WHEN natureza='R' AND situacao='Conciliado'
             AND des_categoria NOT ILIKE '%Transfer%'
             AND des_categoria NOT ILIKE '%Obten%Empr%' THEN valor ELSE 0 END) receita_mes,
    SUM(CASE WHEN natureza='P' AND situacao='Conciliado'
             AND des_categoria NOT ILIKE '%Transfer%'
             AND des_categoria NOT ILIKE 'Empr%SAFE'
             AND des_categoria NOT ILIKE 'Empr%CDG'
             AND des_categoria NOT ILIKE 'Empr%WaterWorks' THEN valor ELSE 0 END) saida_mes
  FROM finance.v_extratos_consolidado
  WHERE data BETWEEN (SELECT mes_ref FROM parametros)
                 AND (SELECT (mes_ref + INTERVAL '1 month - 1 day')::date FROM parametros)
),
saldo_atual AS (
  SELECT SUM(saldo_fim)::numeric(14,2) saldo_hoje
  FROM (
    SELECT DISTINCT ON (cod_conta_corrente) cod_conta_corrente, saldo saldo_fim
    FROM finance.extratos_cc
    WHERE data_lancamento_d <= (SELECT (mes_ref + INTERVAL '1 month - 1 day')::date FROM parametros)
    ORDER BY cod_conta_corrente, data_lancamento_d DESC, cod_lancamento DESC
  ) x
)
SELECT
  m.receita_mes::numeric(14,2)     "Receita mês (R$)",
  m.saida_mes::numeric(14,2)       "Saídas mês (R$)",
  (m.receita_mes + m.saida_mes)::numeric(14,2) "Fluxo líquido (R$)",
  s.saldo_hoje                     "Saldo consolidado (R$)"
FROM mov_mes m, saldo_atual s;""",
        "tags": ["mes_ref"],
        "row": 0, "col": 0, "size_x": 24, "size_y": 4,
    },
    {
        "name": "Cash Flow Mensal por Grupo",
        "display": "bar",
        "sql": """WITH mov AS (
  SELECT
    date_trunc('month', data)::date mes,
    CASE
      WHEN natureza='R' AND des_categoria ILIKE 'Clientes -%' THEN '01_receita_clientes'
      WHEN natureza='R' AND (des_categoria ILIKE '%Projetos%' OR des_categoria='Receita BOT e SW') THEN '02_receita_projetos'
      WHEN natureza='R' AND des_categoria = 'Adiantamento de Clientes' THEN '03_adto_clientes'
      WHEN natureza='R' AND des_categoria NOT ILIKE '%Transfer%' AND des_categoria NOT ILIKE '%Obten%Empr%' THEN '04_outras_entradas'
      WHEN natureza='P' AND des_categoria = 'Antecipação / Distribuição de Lucro' THEN '10_retirada_socio'
      WHEN natureza='P' AND des_categoria IN ('Serviços Prestados PJ','Empréstimo') THEN '11_folha_PJ'
      WHEN natureza='P' AND des_categoria IN ('Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição','Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário') THEN '12_folha_CLT'
      WHEN natureza='P' AND des_categoria IN ('Mercadorias para Revenda','Compras de Materia Prima','Insumos','Frete','Compras Material em Garantia','Custo dos Serviços Prestados') THEN '13_COGS'
      WHEN natureza='P' AND des_categoria = 'Simples Nacional (DAS)' THEN '14_DAS_corrente'
      WHEN natureza='P' AND des_categoria IN ('Parcelamento Impostos','Parcelamento de Impostos') THEN '15_divida_tributaria'
      WHEN natureza='P' AND des_categoria IN ('Locação de Veículos','Pedágio','Estacionamento','Multas','Locação','Combustível') THEN '16_frota'
      WHEN natureza='P' AND des_categoria IN ('Combustível por Km','Outros Meios de Transporte','Reserva de Hotel') THEN '16_frota'
      WHEN natureza='P' AND des_categoria IN ('Despesa Extra com Refeição') THEN '12_folha_CLT'
      WHEN natureza='P' AND des_categoria IN ('Ferramentas de trabalho','Correios') THEN '19_outras_saidas'
      WHEN natureza='P' AND des_categoria = 'Locação de Sistemas' THEN '18_admin_fixo'
      WHEN natureza='P' AND des_categoria IN ('Consultoria Jurídica','Advogados','Acordos Homologados','Acordos Homologados Trabalhistas') THEN '17_juridico'
      WHEN natureza='P' AND des_categoria IN ('Contabilidade','Aluguel','Água','Luz','Telefone','Internet','Telefonia','Condomínio') THEN '18_admin_fixo'
      WHEN natureza='P' AND des_categoria NOT ILIKE '%Transfer%' AND des_categoria NOT ILIKE 'Empr%SAFE' AND des_categoria NOT ILIKE 'Empr%CDG' AND des_categoria NOT ILIKE 'Empr%WaterWorks' THEN '19_outras_saidas'
      ELSE NULL END grupo,
    valor
  FROM finance.v_extratos_consolidado
  WHERE data >= CURRENT_DATE - ({{janela_meses}}||' months')::interval
    AND situacao='Conciliado'
)
SELECT mes, grupo, SUM(valor)::numeric(14,2) valor
FROM mov WHERE grupo IS NOT NULL
GROUP BY 1,2 ORDER BY 1,2;""",
        "tags": ["janela_meses"],
        "row": 4, "col": 0, "size_x": 24, "size_y": 8,
        "viz_settings": {
            "graph.dimensions": ["mes", "grupo"],
            "graph.metrics": ["valor"],
            "stackable.stack_type": "stacked",
        },
    },
    {
        "name": "Break-even Dinâmico (rolling 3m)",
        "display": "table",
        "sql": """WITH periodo AS (
  SELECT
    ({{mes_ref}}::date - INTERVAL '2 months')::date ini,
    (({{mes_ref}}::date + INTERVAL '1 month - 1 day'))::date fim
),
mov AS (
  SELECT valor, natureza, des_categoria, fonte
  FROM finance.v_extratos_consolidado, periodo
  WHERE data BETWEEN periodo.ini AND periodo.fim
    AND situacao = 'Conciliado'
    AND des_categoria NOT ILIKE '%Transfer%'
    AND des_categoria NOT ILIKE '%Obten%Empr%'
    AND des_categoria NOT ILIKE 'Empr%SAFE'
    AND des_categoria NOT ILIKE 'Empr%CDG'
    AND des_categoria NOT ILIKE 'Empr%WaterWorks'
),
totais AS (
  SELECT
    SUM(CASE WHEN natureza='R' THEN valor ELSE 0 END)/3.0 receita_mes,
    SUM(CASE WHEN natureza='P' AND fonte != 'cs_import' AND des_categoria IN (
      'Antecipação / Distribuição de Lucro',
      'Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição',
      'Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário',
      'Simples Nacional (DAS)','Parcelamento Impostos','Parcelamento de Impostos',
      'Locação de Veículos','Pedágio','Estacionamento','Multas','Locação','Combustível',
      'Consultoria Jurídica','Advogados','Acordos Homologados','Acordos Homologados Trabalhistas',
      'Contabilidade','Aluguel','Água','Luz','Telefone','Internet','Telefonia','Condomínio'
    ) THEN -valor ELSE 0 END)/3.0 fixo_mes,
    SUM(CASE WHEN natureza='P' AND (
      fonte = 'cs_import'
      OR des_categoria IN ('Mercadorias para Revenda','Compras de Materia Prima','Insumos','Frete',
                        'Compras Material em Garantia','Custo dos Serviços Prestados',
                        'Serviços Prestados PJ','Empréstimo',
                        'Devoluções de Vendas de Mercadoria','Devoluções de Vendas de Serviços Prestados',
                        'Adiantamento a Fornecedores')
      OR (des_categoria IS NOT NULL AND des_categoria NOT IN (
        'Antecipação / Distribuição de Lucro',
        'Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição',
        'Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário',
        'Simples Nacional (DAS)','Parcelamento Impostos','Parcelamento de Impostos',
        'Locação de Veículos','Pedágio','Estacionamento','Multas','Locação','Combustível',
        'Consultoria Jurídica','Advogados','Acordos Homologados','Acordos Homologados Trabalhistas',
        'Contabilidade','Aluguel','Água','Luz','Telefone','Internet','Telefonia','Condomínio'
      ))
    ) THEN -valor ELSE 0 END)/3.0 variavel_mes
  FROM mov
)
SELECT
  receita_mes::numeric(14,2) "Receita média (3m)",
  fixo_mes::numeric(14,2) "Custo Fixo (R$/mês)",
  variavel_mes::numeric(14,2) "Custo Variável (R$/mês)",
  (variavel_mes/NULLIF(receita_mes,0)*100)::numeric(5,1) "% Variável",
  (fixo_mes / NULLIF(1 - variavel_mes/NULLIF(receita_mes,0), 0))::numeric(14,2) "Break-even (R$/mês)",
  (receita_mes - fixo_mes / NULLIF(1 - variavel_mes/NULLIF(receita_mes,0), 0))::numeric(14,2) "Folga (R$/mês)"
FROM totais;""",
        "tags": ["mes_ref"],
        "row": 12, "col": 0, "size_x": 12, "size_y": 6,
    },
    {
        "name": "Folha Total como % da Receita (rolling 3m)",
        "display": "combo",
        "sql": """WITH meses AS (
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '11 months')::date,
    CURRENT_DATE::date,
    '1 month'
  )::date mes
),
mov AS (
  SELECT
    date_trunc('month', data)::date mes,
    SUM(CASE WHEN natureza='R'
             AND des_categoria NOT ILIKE '%Transfer%'
             AND des_categoria NOT ILIKE '%Obten%Empr%' THEN valor ELSE 0 END) receita,
    SUM(CASE WHEN natureza='P' AND des_categoria = 'Antecipação / Distribuição de Lucro'
             THEN -valor ELSE 0 END) retirada,
    SUM(CASE WHEN natureza='P' AND des_categoria IN ('Serviços Prestados PJ','Empréstimo')
             THEN -valor ELSE 0 END) folha_pj,
    SUM(CASE WHEN natureza='P' AND des_categoria IN ('Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição','Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário')
             THEN -valor ELSE 0 END) folha_clt
  FROM finance.v_extratos_consolidado
  WHERE situacao='Conciliado'
    AND data >= CURRENT_DATE - INTERVAL '12 months'
  GROUP BY 1
)
SELECT
  m.mes,
  COALESCE(mov.receita,0)::numeric(14,2)  receita,
  COALESCE(mov.retirada,0)::numeric(14,2) retirada_benny,
  COALESCE(mov.folha_pj,0)::numeric(14,2) folha_pj,
  COALESCE(mov.folha_clt,0)::numeric(14,2) folha_clt,
  (COALESCE(mov.retirada,0) + COALESCE(mov.folha_pj,0) + COALESCE(mov.folha_clt,0))::numeric(14,2) folha_total,
  ROUND(
    (COALESCE(mov.retirada,0) + COALESCE(mov.folha_pj,0) + COALESCE(mov.folha_clt,0))
    / NULLIF(mov.receita,0) * 100, 1
  ) pct_receita
FROM meses m LEFT JOIN mov USING (mes)
ORDER BY m.mes;""",
        "tags": [],
        "row": 12, "col": 12, "size_x": 12, "size_y": 6,
    },
    {
        "name": "Aging AR e AP",
        "display": "bar",
        "sql": """WITH abertos AS (
  SELECT
    natureza,
    COALESCE(t.val_aberto, t.valor_titulo - COALESCE(t.val_pago,0)) val_aberto,
    COALESCE(pv.dt_previsao_nova, t.dt_previsao_d, t.dt_vencimento_d) dt_alvo
  FROM finance.pesquisa_titulos t
  LEFT JOIN finance.previsao_override pv ON pv.cod_titulo = t.cod_titulo
  WHERE (t.dt_cancelamento IS NULL OR t.dt_cancelamento='')
    AND (t.liquidado IS NULL OR t.liquidado != 'S')
    AND COALESCE(t.val_aberto, t.valor_titulo - COALESCE(t.val_pago,0)) > 0
    AND (t.dt_vencimento_d IS NULL OR t.dt_vencimento_d >= DATE '2025-01-01')
)
SELECT
  natureza "Tipo",
  CASE
    WHEN dt_alvo IS NULL THEN '00 · sem_data'
    WHEN dt_alvo < CURRENT_DATE - 30 THEN '01 · Vencido 30+ dias'
    WHEN dt_alvo < CURRENT_DATE      THEN '02 · Vencido até 30d'
    WHEN dt_alvo <= CURRENT_DATE + 30 THEN '03 · Vence 30d'
    WHEN dt_alvo <= CURRENT_DATE + 60 THEN '04 · Vence 60d'
    WHEN dt_alvo <= CURRENT_DATE + 90 THEN '05 · Vence 90d'
    WHEN dt_alvo <= (CURRENT_DATE + INTERVAL '6 months')::date THEN '06 · Vence 6m'
    ELSE '07 · +6m' END bucket,
  SUM(val_aberto)::numeric(14,2) valor,
  COUNT(*) n_titulos
FROM abertos
WHERE natureza IN ('R','P')
GROUP BY 1,2 ORDER BY 1,2;""",
        "tags": [],
        "row": 18, "col": 0, "size_x": 12, "size_y": 6,
        "viz_settings": {"graph.dimensions": ["bucket", "Tipo"], "graph.metrics": ["valor"]},
    },
    {
        "name": "MRR Contratado × Faturado (top gaps)",
        "display": "table",
        "sql": """WITH contratos_ativos AS (
  SELECT
    codigo_contrato, numero_contrato, codigo_cliente, situacao,
    SUM(vlr_tot_mes) vlr_mes_contrato
  FROM sales.contratos_servico
  WHERE (vig_final = '' OR vig_final IS NULL
         OR to_date(vig_final,'DD/MM/YYYY') > CURRENT_DATE)
  GROUP BY 1,2,3,4
),
os_fat_3m AS (
  SELECT numero_contrato, (SUM(valor_total)/3.0) fat_mes_medio
  FROM sales.ordens_servico
  WHERE dt_fat_d >= CURRENT_DATE - INTERVAL '3 months'
    AND (cancelada IS NULL OR cancelada IN ('','N'))
  GROUP BY 1
)
SELECT
  c.numero_contrato "Contrato",
  cli.razao_social "Cliente",
  c.situacao,
  c.vlr_mes_contrato::numeric(12,2) "Contratado (R$/mês)",
  COALESCE(os.fat_mes_medio,0)::numeric(12,2) "Faturado 3m médio",
  (c.vlr_mes_contrato - COALESCE(os.fat_mes_medio,0))::numeric(12,2) "Gap R$",
  CASE WHEN c.vlr_mes_contrato > 0
    THEN ROUND(((c.vlr_mes_contrato - COALESCE(os.fat_mes_medio,0))/c.vlr_mes_contrato)*100,1)
    ELSE NULL END "Gap %"
FROM contratos_ativos c
LEFT JOIN os_fat_3m os ON os.numero_contrato = c.numero_contrato
LEFT JOIN finance.clientes cli ON cli.codigo_cliente_omie = c.codigo_cliente::bigint
WHERE c.vlr_mes_contrato > 500
  AND (c.vlr_mes_contrato - COALESCE(os.fat_mes_medio,0)) > 0
ORDER BY 6 DESC
LIMIT 30;""",
        "tags": [],
        "row": 18, "col": 12, "size_x": 12, "size_y": 6,
    },
    {
        "name": "Delta Inexplicado Diário",
        "display": "table",
        "sql": """WITH saldos_diarios AS (
  SELECT
    data_lancamento_d dia, cod_conta_corrente, descricao_cc, saldo, cod_lancamento,
    ROW_NUMBER() OVER (
      PARTITION BY cod_conta_corrente, data_lancamento_d
      ORDER BY cod_lancamento DESC
    ) rn
  FROM finance.extratos_cc
  WHERE data_lancamento_d >= CURRENT_DATE - INTERVAL '6 months'
),
saldo_por_dia AS (
  SELECT dia, SUM(saldo) saldo_consolidado
  FROM saldos_diarios WHERE rn=1
  GROUP BY dia
),
mov_por_dia AS (
  SELECT
    data_lancamento_d dia,
    SUM(CASE WHEN situacao='Conciliado' THEN valor_documento ELSE 0 END) conciliado,
    SUM(CASE WHEN situacao='Previsto'   THEN valor_documento ELSE 0 END) previsto,
    SUM(CASE WHEN situacao='Não conciliado' THEN valor_documento ELSE 0 END) nao_conc
  FROM finance.extratos_cc
  WHERE data_lancamento_d >= CURRENT_DATE - INTERVAL '6 months'
  GROUP BY 1
),
delta_calc AS (
  SELECT
    s.dia,
    s.saldo_consolidado,
    (s.saldo_consolidado - LAG(s.saldo_consolidado) OVER (ORDER BY s.dia)) AS delta_real,
    m.conciliado, m.previsto, m.nao_conc,
    (
      (s.saldo_consolidado - LAG(s.saldo_consolidado) OVER (ORDER BY s.dia))
      - m.conciliado - COALESCE(m.previsto,0)
    ) AS delta_inexplicado
  FROM saldo_por_dia s LEFT JOIN mov_por_dia m ON s.dia = m.dia
)
SELECT
  dia,
  saldo_consolidado::numeric(14,2) "Saldo fim dia",
  delta_real::numeric(14,2)       "Δ Real",
  conciliado::numeric(14,2)       "Δ Conciliado",
  previsto::numeric(14,2)         "Δ Previsto",
  nao_conc::numeric(14,2)         "Δ Não Conc",
  delta_inexplicado::numeric(14,2) "Δ INEXPLICADO"
FROM delta_calc
WHERE ABS(COALESCE(delta_inexplicado, 0)) > 1000
ORDER BY ABS(delta_inexplicado) DESC NULLS LAST
LIMIT 50;""",
        "tags": [],
        "row": 24, "col": 0, "size_x": 24, "size_y": 8,
    },
    {
        "name": "Pareto Outras Saídas (top 30)",
        "display": "row",
        "sql": """WITH grandes AS (
  SELECT unnest(ARRAY[
    'Antecipação / Distribuição de Lucro',
    'Serviços Prestados PJ','Empréstimo',
    'Salários','Adiantamento','Pró-Labore','Assistência Médica','Vale Refeição','Vale Transporte','Rescisões','Contratação de M.O','INSS','FGTS','Adiantamento Salário',
    'Mercadorias para Revenda','Compras de Materia Prima','Insumos','Frete','Compras Material em Garantia','Custo dos Serviços Prestados',
    'Simples Nacional (DAS)','Parcelamento Impostos','Parcelamento de Impostos',
    'Locação de Veículos','Pedágio','Estacionamento','Multas','Locação','Combustível',
    'Consultoria Jurídica','Advogados','Acordos Homologados','Acordos Homologados Trabalhistas',
    'Contabilidade','Aluguel','Água','Luz','Telefone','Internet','Telefonia','Condomínio',
    'Devoluções de Vendas de Mercadoria','Devoluções de Vendas de Serviços Prestados',
    'Adiantamento a Fornecedores',
    'Entrada de Transferência','Saída de Transferência',
    'Empréstimo para SAFE','Empréstimo para CDG','Empréstimo para WaterWorks',
    'Obtenção de Empréstimo (SAFE)','Obtenção de Empréstimo'
  ]) c
)
SELECT
  COALESCE(NULLIF(des_categoria,''),'(sem_categoria)') "Categoria",
  COUNT(*) "Lançamentos",
  SUM(-valor)::numeric(14,2) "Total 6m (R$)",
  (SUM(-valor)/6.0)::numeric(12,2) "Média R$/mês"
FROM finance.v_extratos_consolidado
WHERE data >= CURRENT_DATE - INTERVAL '6 months'
  AND situacao = 'Conciliado'
  AND natureza='P'
  AND COALESCE(NULLIF(des_categoria,''),'(sem_categoria)') NOT IN (SELECT c FROM grandes)
GROUP BY 1
ORDER BY 3 DESC
LIMIT 30;""",
        "tags": [],
        "row": 32, "col": 0, "size_x": 24, "size_y": 8,
    },
]


def build_tags(names):
    kinds = {"mes_ref": "date", "janela_meses": "number"}
    displays = {"mes_ref": "Mês de referência", "janela_meses": "Janela (meses)"}
    return {n: tag(n, kinds.get(n, "text"), displays.get(n)) for n in names}


def ensure_collection(base, session, name):
    lst = http("GET", f"{base}/api/collection", session)
    for c in lst:
        if c.get("name") == name:
            return c["id"]
    return http("POST", f"{base}/api/collection", session,
                body={"name": name, "color": "#88BF4D", "parent_id": None})["id"]


def main():
    base = os.environ["HETZNER_MB_URL"].rstrip("/")
    session = os.environ["HETZNER_SESSION"]

    coll_id = ensure_collection(base, session, COLLECTION_NAME)
    print(f"collection '{COLLECTION_NAME}': id={coll_id}")

    # Create 8 cards
    card_ids = []
    for i, c in enumerate(CARDS, 1):
        tags = build_tags(c["tags"])
        parameters = []
        for name, tag_obj in tags.items():
            param_type = "date/month-year" if tag_obj["type"] == "date" else "number/="
            parameters.append({
                "id": tag_obj["id"],
                "type": param_type,
                "target": ["variable", ["template-tag", name]],
                "name": tag_obj["display-name"],
                "slug": name,
            })
        body = {
            "name": f"Análise {i} — {c['name']}",
            "display": c["display"],
            "database_id": OMIE_DB_ID,
            "dataset_query": {
                "database": OMIE_DB_ID,
                "type": "native",
                "native": {"query": c["sql"], "template-tags": tags},
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
        "name": "Análise de Resultados",
        "description": "Análise financeira WW/SafeWater — 8 cards, fonte: v_extratos_consolidado. Ver docs/obsidian/Service/Sources/metabase-analise-resultados.md",
        "collection_id": coll_id,
    })
    dash_id = dash["id"]
    print(f"dashboard 'Análise de Resultados' → id={dash_id}")

    # Add dashboard-level parameters (mes_ref, janela_meses)
    mes_ref_id = str(uuid.uuid4())[:8]
    janela_id = str(uuid.uuid4())[:8]
    dash_params = [
        {"id": mes_ref_id, "name": "Mês de referência", "slug": "mes_ref",
         "type": "date/month-year", "sectionId": "date"},
        {"id": janela_id, "name": "Janela (meses)", "slug": "janela_meses",
         "type": "number/=", "sectionId": "number", "default": [12]},
    ]
    http("PUT", f"{base}/api/dashboard/{dash_id}", session, body={"parameters": dash_params})

    # Build dashcards with parameter mappings
    dashcards = []
    for i, (c, cid) in enumerate(zip(CARDS, card_ids)):
        if cid is None:
            continue
        pmaps = []
        for tag_name in c["tags"]:
            param_id = mes_ref_id if tag_name == "mes_ref" else janela_id
            pmaps.append({
                "parameter_id": param_id,
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
    print(f"placed {len(dashcards)} dashcards with param mappings")
    print(f"dashboard URL: {base}/dashboard/{dash_id}")


if __name__ == "__main__":
    main()

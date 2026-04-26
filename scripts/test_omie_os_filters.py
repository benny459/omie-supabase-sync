#!/usr/bin/env python3
"""
Teste empírico de filtros no endpoint Omie ListarOS.

Tenta chamar o endpoint com diferentes combinações de filtros e relata
quantas OS retornam em cada caso. Roda na empresa SF (a maior).

Não escreve nada no Supabase — só lê.
"""
import json
import os
import sys
import time

import urllib.request
import urllib.error

EMPRESA = "SF"
APP_KEY = os.environ.get(f"OMIE_APP_KEY_{EMPRESA}", "")
APP_SECRET = os.environ.get(f"OMIE_APP_SECRET_{EMPRESA}", "")
URL = "https://app.omie.com.br/api/v1/servicos/os/"
CALL = "ListarOS"

if not APP_KEY or not APP_SECRET:
    print(f"❌ Credenciais OMIE_APP_KEY_{EMPRESA}/OMIE_APP_SECRET_{EMPRESA} não configuradas")
    sys.exit(1)


def chamar(param: dict, label: str):
    """Chama Omie com param dado e retorna (total_listado, total_pagina_1, etapas_distintas)."""
    payload = {
        "call": CALL,
        "app_key": APP_KEY,
        "app_secret": APP_SECRET,
        "param": [param],
    }
    inicio = time.time()
    req = urllib.request.Request(
        URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
    )
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        print(f"   ❌ HTTP {e.code}: {body}")
        return None
    except Exception as e:
        print(f"   ❌ Erro: {e}")
        return None
    dur = time.time() - inicio

    if "faultstring" in data:
        print(f"   ❌ Omie fault: {data.get('faultstring','')[:200]}")
        return None

    total_de_registros = data.get("nTotRegistros") or data.get("total_de_registros") or 0
    total_de_paginas = data.get("nTotPaginas") or data.get("total_de_paginas") or 0
    items = data.get("osCadastro") or []

    etapas = {}
    for it in items:
        cab = it.get("Cabecalho") or it.get("cabecalho") or {}
        ident = it.get("Identificacao") or it.get("identificacao") or {}
        et = cab.get("cEtapa") or ident.get("cEtapa") or "?"
        etapas[et] = etapas.get(et, 0) + 1

    print(f"   ⏱  {dur:.1f}s | nTotRegistros={total_de_registros} | nTotPaginas={total_de_paginas} | nesta_pag={len(items)}")
    if etapas:
        print(f"   📊 Etapas nesta pág: {etapas}")
    return {"total": total_de_registros, "paginas": total_de_paginas, "items": len(items), "etapas": etapas, "dur": dur}


print("=" * 70)
print(f"🧪 TESTE Omie ListarOS — empresa {EMPRESA}")
print("=" * 70)

# Baseline — config atual do importador
print("\n[A] Baseline (config atual: page_size=200, apenas_importado_api=N)")
r_a = chamar({
    "nPagina": 1, "nRegPorPagina": 200,
    "apenas_importado_api": "N",
}, "baseline")

# Filtro empírico 1: cEtapa específica
print("\n[B] Tentar filtro cEtapa='10' (ativas)")
r_b = chamar({
    "nPagina": 1, "nRegPorPagina": 200,
    "apenas_importado_api": "N",
    "cEtapa": "10",
}, "etapa10")

# Filtro empírico 2: dDtPrevisaoInicial (data range)
print("\n[C] Tentar dDtPrevisaoInicial='01/01/2025'")
r_c = chamar({
    "nPagina": 1, "nRegPorPagina": 200,
    "apenas_importado_api": "N",
    "dDtPrevisaoInicial": "01/01/2025",
    "dDtPrevisaoFinal": "31/12/2026",
}, "dt_previsao")

# Filtro empírico 3: dDtAtualizacaoInicial (alteração)
print("\n[D] Tentar dDtAtualizacaoInicial='01/01/2026'")
r_d = chamar({
    "nPagina": 1, "nRegPorPagina": 200,
    "apenas_importado_api": "N",
    "dDtAtualizacaoInicial": "01/01/2026",
    "dDtAtualizacaoFinal": "31/12/2026",
}, "dt_alt")

# Filtro empírico 4: dDtFatInicial
print("\n[E] Tentar dDtFatInicial='01/01/2026'")
r_e = chamar({
    "nPagina": 1, "nRegPorPagina": 200,
    "apenas_importado_api": "N",
    "dDtFatInicial": "01/01/2026",
    "dDtFatFinal": "31/12/2026",
}, "dt_fat")

# Filtro empírico 5: page_size 500
print("\n[F] page_size=500 (ver se aceita)")
r_f = chamar({
    "nPagina": 1, "nRegPorPagina": 500,
    "apenas_importado_api": "N",
}, "page500")

print("\n" + "=" * 70)
print("📋 RESUMO")
print("=" * 70)
labels = [("A baseline 200", r_a), ("B cEtapa=10", r_b), ("C dDtPrevisao", r_c),
          ("D dDtAtualizacao", r_d), ("E dDtFat", r_e), ("F page_size=500", r_f)]
for label, r in labels:
    if r:
        print(f"  {label:<25} total={r['total']:>6} | itens_nesta_pag={r['items']:>3} | {r['dur']:.1f}s")
    else:
        print(f"  {label:<25} ❌ ERRO ou rejeitado")
print("=" * 70)
print("\n💡 Filtros que reduziram o total = aceitos pela API.")
print("   Filtros que retornaram o mesmo total (ou erro) = ignorados/rejeitados.")

#!/usr/bin/env python3
"""
Teste empírico de filtros no endpoint Omie PesquisarPedCompra.

Testa quais filtros de data/etapa funcionam pra implementar sync incremental.
Roda na empresa SF. Read-only — não escreve no Supabase.
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
URL = "https://app.omie.com.br/api/v1/produtos/pedidocompra/"
CALL = "PesquisarPedCompra"

if not APP_KEY or not APP_SECRET:
    print(f"❌ Credenciais OMIE_APP_KEY_{EMPRESA}/OMIE_APP_SECRET_{EMPRESA} ausentes")
    sys.exit(1)


BASE_PARAM = {
    "nPagina": 1,
    "nRegsPorPagina": 50,
    "lExibirPedidosPendentes":   "S",
    "lExibirPedidosFaturados":   "S",
    "lExibirPedidosCancelados":  "S",
    "lExibirPedidosRecebidos":   "S",
    "lExibirPedidosEncerrados":  "S",
}


def chamar(extra: dict, label: str):
    param = {**BASE_PARAM, **extra}
    payload = {
        "call": CALL,
        "app_key": APP_KEY,
        "app_secret": APP_SECRET,
        "param": [param],
    }
    inicio = time.time()
    try:
        req = urllib.request.Request(
            URL, data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")[:300]
        try:
            parsed = json.loads(body)
            fs = parsed.get("faultstring", "")[:200]
        except Exception:
            fs = body[:200]
        dur = time.time() - inicio
        print(f"   ❌ HTTP {e.code} em {dur:.1f}s: {fs}")
        # "Não existem registros" = filtro foi aceito mas zerou — ainda é informação útil
        if "ão existem" in fs:
            print(f"      ⤷ filtro ACEITO (zerou resultado)")
            return {"total": 0, "items": 0, "filtro_aceito": True, "dur": dur}
        return None
    except Exception as e:
        print(f"   ❌ Erro: {e}")
        return None
    dur = time.time() - inicio

    if isinstance(data, dict) and "faultstring" in data:
        print(f"   ❌ Omie fault: {data.get('faultstring','')[:200]}")
        return None

    items = data.get("pedidos_pesquisa") or []
    tot_reg = data.get("total_de_registros") or data.get("nTotRegistros") or "?"
    tot_pag = data.get("total_de_paginas") or data.get("nTotPaginas") or "?"

    print(f"   ✅ {dur:.1f}s | total_reg={tot_reg} | total_pag={tot_pag} | nesta_pag={len(items)}")
    return {"total": tot_reg, "paginas": tot_pag, "items": len(items), "dur": dur}


print("=" * 70)
print(f"🧪 TESTE Omie PesquisarPedCompra — empresa {EMPRESA}")
print("=" * 70)
print(f"Hoje: {time.strftime('%d/%m/%Y')}")

print("\n[A] Baseline (config atual: page_size=50, sem filtros)")
r_a = chamar({}, "baseline")

print("\n[B] page_size=500 (testar limite)")
r_b = chamar({"nRegsPorPagina": 500}, "p500")

print("\n[C] dDtEmissaoDe='01/04/2026' (filtro emissão últimos 30d)")
r_c = chamar({"dDtEmissaoDe": "01/04/2026", "dDtEmissaoAte": "31/12/2026"}, "emissao")

print("\n[D] dDtPrevisaoDe='01/04/2026'")
r_d = chamar({"dDtPrevisaoDe": "01/04/2026", "dDtPrevisaoAte": "31/12/2026"}, "previsao")

print("\n[E] dDtAlteracaoDe='01/04/2026' (alteração — ideal pra incremental)")
r_e = chamar({"dDtAlteracaoDe": "01/04/2026", "dDtAlteracaoAte": "31/12/2026"}, "alteracao")

print("\n[F] dDtFaturamentoDe='01/04/2026'")
r_f = chamar({"dDtFaturamentoDe": "01/04/2026", "dDtFaturamentoAte": "31/12/2026"}, "fat")

print("\n[G] cFiltrarApenasNaoFaturados='S' (só PCs em aberto)")
r_g = chamar({"cFiltrarApenasNaoFaturados": "S"}, "nao_fat")

print("\n[H] cEtapa='10' (filtra etapa específica)")
r_h = chamar({"cEtapa": "10"}, "etapa10")

print("\n" + "=" * 70)
print("📋 RESUMO — comparar com baseline pra saber o que filtrou de verdade")
print("=" * 70)
labels = [
    ("A baseline page_size=50",  r_a),
    ("B page_size=500",          r_b),
    ("C dDtEmissao",             r_c),
    ("D dDtPrevisao",            r_d),
    ("E dDtAlteracao",           r_e),
    ("F dDtFaturamento",         r_f),
    ("G NaoFaturados",           r_g),
    ("H cEtapa=10",              r_h),
]
for label, r in labels:
    if r is None:
        print(f"  {label:<28} ❌ ERRO ou rejeitado")
    else:
        tot = r.get("total", "?")
        items = r.get("items", "?")
        dur = r.get("dur", 0)
        aceito = " (filtro aceito, zerou)" if r.get("filtro_aceito") else ""
        print(f"  {label:<28} total={tot:>5} | itens={items:>3} | {dur:.1f}s{aceito}")
print("=" * 70)
print("\n💡 Filtros com 'total' diferente do baseline = aceitos pela API.")
print("   Filtros com mesmo total = ignorados silenciosamente.")

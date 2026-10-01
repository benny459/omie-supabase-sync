#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🛒 CADASTROS DE COMPRAS — Omie → Supabase (SÓ LEITURA no Omie)
─────────────────────────────────────────────────────────────────────────────
Alimenta o módulo Compras do painel com o que o espelho ainda não tinha:
  · departamentos  (geral/departamentos  · ListarDepartamentos)
  · compradores    (tenta os endpoints conhecidos; o que falhar só é logado)
  · empresa        (geral/empresas · ListarEmpresas) — cabeçalho do PDF do pedido
E confere se o espelho de pedidos de compra está completo: compara o total de
pedidos que o Omie informa (PesquisarPedCompra, todas as situações) com o que
existe em orders.pedidos_compra, por empresa.

Grava por RPC (orders.compras_gravar_cadastro) porque o schema compras não é
exposto no PostgREST. Nenhuma chamada de escrita ao Omie.
═════════════════════════════════════════════════════════════════════════════
"""
import json
import sys

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, SUPABASE_URL,
    fetch_omie, fetch_omie_paginated, http_post_json, supa_headers,
)


def rpc(nome: str, args: dict):
    code, body, _ = http_post_json(f"{SUPABASE_URL}/rest/v1/rpc/{nome}", args, supa_headers("orders"))
    if code < 200 or code >= 300:
        raise RuntimeError(f"RPC {nome} HTTP {code}: {body[:300].decode('utf-8', errors='replace')}")
    return json.loads(body.decode("utf-8") or "null")


def departamentos(sigla: str) -> int:
    itens = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/geral/departamentos/", call="ListarDepartamentos",
        sigla=sigla, list_field="departamentos", page_size=100, label="Departamentos")
    rows = [{"codigo": str(d.get("codigo") or ""), "descricao": d.get("descricao") or "",
             "inativo": d.get("inativo") or "N"} for d in itens]
    return rpc("compras_gravar_cadastro", {"p_tipo": "departamentos", "p_empresa": sigla, "p_rows": rows})


# O endpoint de compradores não está documentado de forma estável — tenta os
# conhecidos e usa o primeiro que responder com lista.
COMPRADORES = [
    ("https://app.omie.com.br/api/v1/estoque/comprador/", "ListarCompradores", "cadastros"),
    ("https://app.omie.com.br/api/v1/estoque/comprador/", "ListarCompradores", "compradores"),
    ("https://app.omie.com.br/api/v1/produtos/comprador/", "ListarCompradores", "cadastros"),
]


def compradores(sigla: str) -> int:
    for url, call, campo in COMPRADORES:
        try:
            itens = fetch_omie_paginated(url=url, call=call, sigla=sigla, list_field=campo,
                                         page_size=50, label="Compradores")
        except Exception as e:  # endpoint/método inexistente: tenta o próximo
            print(f"   ↪︎ {url.split('/v1/')[1]}{call}: {str(e)[:120]}")
            continue
        if not itens:
            continue
        print(f"   🔎 campos do comprador: {sorted(itens[0].keys())}")
        rows = []
        for c in itens:
            cod = c.get("codigo") or c.get("nCodigo") or c.get("codigo_comprador") or c.get("nCodCompr")
            nome = c.get("nome") or c.get("cNome") or c.get("descricao") or c.get("cDescricao")
            if cod and nome:
                rows.append({"codigo": str(cod), "nome": nome})
        return rpc("compras_gravar_cadastro", {"p_tipo": "compradores", "p_empresa": sigla, "p_rows": rows})
    print(f"   ⚠️ {sigla}: nenhum endpoint de compradores respondeu — nomes ficam pelo approvals.comprador")
    return 0


def empresa(sigla: str) -> int:
    data = fetch_omie("https://app.omie.com.br/api/v1/geral/empresas/", "ListarEmpresas", sigla,
                      {"pagina": 1, "registros_por_pagina": 10})
    itens = data.get("empresas_cadastro") or []
    if not itens:
        print(f"   ⚠️ {sigla}: ListarEmpresas sem empresas_cadastro ({list(data.keys())})")
        return 0
    return rpc("compras_gravar_cadastro", {"p_tipo": "empresas", "p_empresa": sigla, "p_rows": itens[:1]})


def total_pcs_omie(sigla: str):
    data = fetch_omie("https://app.omie.com.br/api/v1/produtos/pedidocompra/", "PesquisarPedCompra", sigla, {
        "nPagina": 1, "nRegsPorPagina": 1,
        "lExibirPedidosPendentes": "S", "lExibirPedidosFaturados": "S", "lExibirPedidosCancelados": "S",
        "lExibirPedidosRecebidos": "S", "lExibirPedidosEncerrados": "S",
    })
    if data.get("_empty_page"):
        return 0
    for k in ("nTotalRegistros", "nTotRegistros", "total_de_registros"):
        if data.get(k) is not None:
            return int(data[k])
    print(f"   ⚠️ {sigla}: total não informado ({[k for k in data.keys() if k != 'pedidos_pesquisa']})")
    return None


def main():
    espelho = rpc("compras_contagem_espelho", {}) or {}
    falhas = []
    print(f"🎯 Empresas: {', '.join(EMPRESAS_ALVO)}")
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"⏭️  {sigla}: sem credenciais Omie")
            continue
        print(f"\n▶️  {sigla}")
        for nome, fn in (("departamentos", departamentos), ("compradores", compradores), ("empresa", empresa)):
            try:
                print(f"   ✅ {nome}: {fn(sigla)} gravado(s)")
            except Exception as e:
                falhas.append(f"{sigla}/{nome}")
                print(f"   ❌ {nome}: {e}")
        try:
            tot = total_pcs_omie(sigla)
            no_espelho = (espelho.get(sigla) or {}).get("pedidos", 0)
            marca = "OK" if tot is not None and tot == no_espelho else "DIFERENTE"
            print(f"   📊 pedidos de compra — Omie: {tot} | espelho: {no_espelho} → {marca} "
                  f"({(espelho.get(sigla) or {}).get('min')} → {(espelho.get(sigla) or {}).get('max')})")
        except Exception as e:
            falhas.append(f"{sigla}/total")
            print(f"   ❌ total Omie: {e}")
    print("\n🏁 cadastros de compras" + (f" | FALHAS: {', '.join(falhas)}" if falhas else " OK"))


if __name__ == "__main__":
    main()

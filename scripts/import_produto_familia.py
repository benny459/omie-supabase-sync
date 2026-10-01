#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
📦 IMPORT FAMÍLIA DO PRODUTO — Omie → Supabase (só leitura)
Endpoint: /geral/produtos/ListarProdutos (o Resumido não traz família)
Tabela:   orders.produto_familia (empresa, id_omie, codigo_familia, descricao_familia)
Uso:      Estoque v2 — lista organizada por família e escopo da janela de inventário.
Roda junto com o import de produtos (mesmo workflow).
═════════════════════════════════════════════════════════════════════════════
"""
import html
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE,
    fetch_omie_paginated, supa_upsert, update_sync_state, to_int,
)

OMIE_URL = "https://app.omie.com.br/api/v1/geral/produtos/"


def _txt(v):
    if not v:
        return None
    return html.unescape(html.unescape(str(v))).strip() or None


def importar_empresa(sigla: str) -> int:
    inicio = time.time()
    print(f"\n▶️  {sigla} | Família dos produtos")
    items = fetch_omie_paginated(
        url=OMIE_URL, call="ListarProdutos", sigla=sigla,
        list_field="produto_servico_cadastro", page_size=50,
        extra_param={"apenas_importado_api": "N", "filtrar_apenas_omiepdv": "N"},
        label="Produtos (família)",
    )
    rows = []
    for p in items or []:
        idp = to_int(p.get("codigo_produto"))
        if not idp:
            continue
        rows.append({
            "empresa": sigla, "id_omie": idp,
            "codigo_familia": to_int(p.get("codigo_familia")) or None,
            "descricao_familia": _txt(p.get("descricao_familia")),
        })
    n = supa_upsert("orders", "produto_familia", rows, "empresa,id_omie") if rows else 0
    com = sum(1 for r in rows if r["descricao_familia"])
    elapsed = int(time.time() - inicio)
    update_sync_state(f"produto_familia_{sigla}", sigla, n, modo="FULL", duracao_segundos=elapsed)
    print(f"   ✅ {sigla}: {len(rows)} produtos ({com} com família) em {elapsed}s")
    return n


def main():
    erro = False
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"⚠️ {sigla}: credenciais não configuradas — pulando")
            continue
        try:
            importar_empresa(sigla)
        except Exception as e:
            erro = True
            print(f"❌ Erro em {sigla}: {e}")
    if erro:
        sys.exit(1)


if __name__ == "__main__":
    main()

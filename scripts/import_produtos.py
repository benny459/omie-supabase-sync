#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🏆 IMPORT PRODUTOS — Omie → Supabase
Endpoint: /geral/produtos/ListarProdutosResumido
Tabela:   sales.produtos
Freq:     Semanal
Volume:   7.000-12.000 registros
═════════════════════════════════════════════════════════════════════════════
"""
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror
)

OMIE_URL = "https://app.omie.com.br/api/v1/geral/produtos/"
SCHEMA = "sales"
TABELA = "produtos"
PK = "empresa,id_omie"

def map_produto_to_row(p: dict, sigla: str):
    return {
        "empresa": sigla,
        "id_omie": to_int(p.get("codigo_produto")),
        "codigo_produto": str(p.get("codigo")) if p.get("codigo") else None,
        "codigo_integracao": p.get("codigo_produto_integracao") or None,
        "descricao": p.get("descricao") or None,
        "valor_unitario": to_float(p.get("valor_unitario")),
        "ncm": p.get("ncm") or None,
        "ean": p.get("ean") or None,
    }

def importar_empresa(sigla: str):
    inicio = time.time()
    print(f"\n▶️  {sigla} | Produtos | FULL (catálogo semanal)")

    # Fallback: se o parâmetro filtrar_apenas_omiepdv não for aceito, tenta sem
    extra = {
        "apenas_importado_api": "N",
        "filtrar_apenas_omiepdv": "N",
    }

    try:
        items = fetch_omie_paginated(
            url=OMIE_URL, call="ListarProdutosResumido", sigla=sigla,
            list_field="produto_servico_resumido", page_size=100,
            extra_param=extra, label="Produtos",
        )
    except RuntimeError as e:
        if "filtrar_apenas_omiepdv" in str(e):
            print("   ⚠️ Fallback sem filtrar_apenas_omiepdv")
            items = fetch_omie_paginated(
                url=OMIE_URL, call="ListarProdutosResumido", sigla=sigla,
                list_field="produto_servico_resumido", page_size=100,
                extra_param={"apenas_importado_api": "N"}, label="Produtos",
            )
        else:
            raise

    if not items:
        print(f"   📭 {sigla}: nenhum registro")
        update_sync_state(f"produtos_{sigla}", sigla, 0, modo="FULL")
        return 0

    rows = [map_produto_to_row(p, sigla) for p in items]
    rows = [r for r in rows if r["id_omie"]]

    n = supa_upsert(SCHEMA, TABELA, rows, PK)
    elapsed = int(time.time() - inicio)
    update_sync_state(f"produtos_{sigla}", sigla, n, modo="FULL", duracao_segundos=elapsed)

    print(f"   ✅ {sigla}: {len(items)} items → {n} rows em {elapsed}s")
    return n

def main():
    print("═══════════════════════════════════════════════════════════════")
    print("🏆 Import Produtos — Omie → Supabase")
    print("═══════════════════════════════════════════════════════════════")
    print(f"🎯 Empresas: {', '.join(EMPRESAS_ALVO)}")

    inicio_geral = time.time()
    total = 0
    houve_erro = False

    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"⚠️ {sigla}: credenciais não configuradas — pulando")
            continue
        try:
            total += importar_empresa(sigla)
        except Exception as e:
            houve_erro = True
            print(f"❌ Erro em {sigla}: {e}")
            try:
                update_sync_state(f"produtos_{sigla}", sigla, 0, modo="ERRO",
                                  status="ERRO", erro=str(e)[:500])
            except Exception:
                pass

    elapsed = int(time.time() - inicio_geral)
    print()
    print("═══════════════════════════════════════════════════════════════")
    print(f"✅ GERAL concluído em {elapsed}s | Total: {total} rows")
    print("═══════════════════════════════════════════════════════════════")

    trigger_sheets_mirror("Produtos")

    if houve_erro:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n⚠️ Interrompido")
        sys.exit(130)

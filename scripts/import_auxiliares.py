#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🏆 IMPORT AUXILIARES — Omie → Supabase
Dois endpoints em um só script:
  1. /produtos/formaspagvendas/ListarFormasPagVendas → sales.formas_pagamento
  2. /geral/categorias/ListarCategorias             → sales.categorias
Freq:     Semanal
Volume:   < 5.000 registros total
═════════════════════════════════════════════════════════════════════════════
"""
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_float, trigger_sheets_mirror
)

SCHEMA = "sales"

# ────────────────────────────────────────
# FORMAS DE PAGAMENTO
# ────────────────────────────────────────
def map_forma(item: dict, sigla: str):
    return {
        "empresa": sigla,
        "codigo": str(item.get("cCodigo")) if item.get("cCodigo") else None,
        "descricao": item.get("cDescricao") or None,
        "num_parcelas": to_float(item.get("nNumeroParcelas")),
    }

def importar_formas(sigla: str):
    inicio = time.time()
    print(f"\n▶️  {sigla} | Formas de Pagamento")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/produtos/formaspagvendas/",
        call="ListarFormasPagVendas",
        sigla=sigla,
        list_field="cadastros",
        page_size=100,
        label="FormasPag",
    )
    if not items:
        update_sync_state(f"formas_pagamento_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = [map_forma(r, sigla) for r in items]
    rows = [r for r in rows if r["codigo"]]
    n = supa_upsert(SCHEMA, "formas_pagamento", rows, "empresa,codigo")
    update_sync_state(f"formas_pagamento_{sigla}", sigla, n, modo="FULL")
    print(f"   ✅ {sigla}: {n} formas em {int(time.time()-inicio)}s")
    return n

# ────────────────────────────────────────
# CATEGORIAS
# ────────────────────────────────────────
def map_categoria(item: dict, sigla: str):
    conta = item.get("dados_contabeis") or {}
    return {
        "empresa": sigla,
        "codigo": str(item.get("codigo")) if item.get("codigo") else None,
        "descricao": item.get("descricao") or None,
        "conta_receita": conta.get("conta_receita") or None,
        "conta_despesa": conta.get("conta_despesa") or None,
    }

def importar_categorias(sigla: str):
    inicio = time.time()
    print(f"\n▶️  {sigla} | Categorias")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/geral/categorias/",
        call="ListarCategorias",
        sigla=sigla,
        list_field="categoria_cadastro",
        page_size=100,
        label="Categorias",
    )
    if not items:
        update_sync_state(f"categorias_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = [map_categoria(r, sigla) for r in items]
    rows = [r for r in rows if r["codigo"]]
    n = supa_upsert(SCHEMA, "categorias", rows, "empresa,codigo")
    update_sync_state(f"categorias_{sigla}", sigla, n, modo="FULL")
    print(f"   ✅ {sigla}: {n} categorias em {int(time.time()-inicio)}s")
    return n

# ────────────────────────────────────────
# MAIN
# ────────────────────────────────────────
def main():
    print("═══════════════════════════════════════════════════════════════")
    print("🏆 Import Auxiliares (Formas Pag + Categorias) — Omie → Supabase")
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
            total += importar_formas(sigla)
        except Exception as e:
            houve_erro = True
            print(f"❌ FormasPag {sigla}: {e}")
        try:
            total += importar_categorias(sigla)
        except Exception as e:
            houve_erro = True
            print(f"❌ Categorias {sigla}: {e}")

    elapsed = int(time.time() - inicio_geral)
    print()
    print("═══════════════════════════════════════════════════════════════")
    print(f"✅ GERAL concluído em {elapsed}s | Total: {total} rows (formas + categorias)")
    print("═══════════════════════════════════════════════════════════════")

    trigger_sheets_mirror("FormasPagamento")
    trigger_sheets_mirror("Categorias")

    if houve_erro:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n⚠️ Interrompido")
        sys.exit(130)

#!/usr/bin/env python3
"""
==========================================================================
IMPORT ORDERS AUXILIARES -- Omie -> Supabase (Weekly)
Combina 3 scripts GAS originais em 1:
  - Produtos_3_S.gs       -> orders.produtos_compras
  - Auxiliares_3_S.gs     -> orders.etapas_faturamento + orders.formas_pagamento_vendas
  - Compras_aux_3_S.gs    -> orders.familias_produtos + orders.produto_fornecedor
                              + orders.unidades + orders.formas_pagamento_compras
Freq:     Semanal
Volume:   < 30.000 registros total
==========================================================================
"""
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, PAUSA_ENTRE_CHAMADAS,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror, fetch_omie
)

SCHEMA = "orders"


# ====================================================================
# 1. PRODUTOS COMPRAS (/geral/produtos/ListarProdutos)
# ====================================================================
def map_produto(p: dict, sigla: str) -> dict:
    return {
        "empresa": sigla,
        "id_omie": to_int(p.get("codigo")),
        "codigo_integracao": p.get("codigo_produto_integracao") or None,
        "sku": p.get("codigo_produto") or None,
        "descricao": p.get("descricao") or None,
        "valor_unitario": to_float(p.get("valor_unitario")),
        "unidade": p.get("unidade") or None,
        "ncm": p.get("ncm") or None,
        "ean": p.get("ean") or None,
        "marca": p.get("marca") or None,
        "peso_liq": to_float(p.get("peso_liq")),
        "codigo_familia": p.get("codigo_familia") or None,
    }


def importar_produtos(sigla: str):
    inicio = time.time()
    print(f"\n-> {sigla} | Produtos Compras")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/geral/produtos/",
        call="ListarProdutos",
        sigla=sigla,
        list_field="produto_servico_cadastro",
        page_size=50,
        page_key="pagina",
        size_key="registros_por_pagina",
        extra_param={
            "apenas_importado_api": "N",
            "filtrar_apenas_omiepdv": "N",
        },
        label="Produtos",
    )
    if not items:
        update_sync_state(f"produtos_compras_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = [map_produto(p, sigla) for p in items]
    rows = [r for r in rows if r["id_omie"]]
    n = supa_upsert(SCHEMA, "produtos_compras", rows, "empresa,id_omie")
    update_sync_state(f"produtos_compras_{sigla}", sigla, n, modo="FULL")
    print(f"   {sigla}: {n} produtos em {int(time.time()-inicio)}s")
    return n


# ====================================================================
# 2. ETAPAS FATURAMENTO (/produtos/etapafat/ListarEtapasFaturamento)
#    Has nested array: each record has etapas[] sub-array
# ====================================================================
def map_etapa_fat(reg: dict, sigla: str) -> list:
    """Returns list of rows (one per etapa inside the registro)."""
    cod_op = reg.get("cCodOperacao") or ""
    desc_op = reg.get("cDescOperacao") or None
    filhos = reg.get("etapas") or []
    rows = []
    if filhos:
        for f in filhos:
            rows.append({
                "empresa": sigla,
                "cod_operacao": cod_op,
                "desc_operacao": desc_op,
                "cod_etapa": f.get("cCodigo") or "",
                "desc_padrao": f.get("cDescrPadrao") or None,
                "desc_etapa": f.get("cDescricao") or None,
                "inativo": f.get("cInativo") or None,
            })
    else:
        rows.append({
            "empresa": sigla,
            "cod_operacao": cod_op,
            "desc_operacao": desc_op,
            "cod_etapa": "",
            "desc_padrao": None,
            "desc_etapa": None,
            "inativo": None,
        })
    return rows


def importar_etapas_faturamento(sigla: str):
    inicio = time.time()
    print(f"\n-> {sigla} | Etapas Faturamento")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/produtos/etapafat/",
        call="ListarEtapasFaturamento",
        sigla=sigla,
        list_field="cadastros",
        page_size=100,
        page_key="pagina",
        size_key="registros_por_pagina",
        label="EtapasFat",
    )
    if not items:
        update_sync_state(f"etapas_faturamento_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = []
    for reg in items:
        rows.extend(map_etapa_fat(reg, sigla))
    rows = [r for r in rows if r["cod_operacao"]]
    n = supa_upsert(SCHEMA, "etapas_faturamento", rows, "empresa,cod_operacao,cod_etapa")
    update_sync_state(f"etapas_faturamento_{sigla}", sigla, n, modo="FULL")
    print(f"   {sigla}: {n} etapas em {int(time.time()-inicio)}s")
    return n


# ====================================================================
# 3. FORMAS PAGAMENTO VENDAS (/produtos/formaspagvendas/ListarFormasPagVendas)
# ====================================================================
def map_forma_pag_venda(item: dict, sigla: str) -> dict:
    return {
        "empresa": sigla,
        "codigo": str(item.get("cCodigo")) if item.get("cCodigo") else None,
        "descricao": item.get("cDescricao") or None,
        "num_parcelas": to_float(item.get("nNumeroParcelas")),
    }


def importar_formas_pag_vendas(sigla: str):
    inicio = time.time()
    print(f"\n-> {sigla} | Formas Pagamento Vendas")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/produtos/formaspagvendas/",
        call="ListarFormasPagVendas",
        sigla=sigla,
        list_field="cadastros",
        page_size=100,
        page_key="pagina",
        size_key="registros_por_pagina",
        label="FormasPagVendas",
    )
    if not items:
        update_sync_state(f"formas_pag_vendas_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = [map_forma_pag_venda(r, sigla) for r in items]
    rows = [r for r in rows if r["codigo"]]
    n = supa_upsert(SCHEMA, "formas_pagamento_vendas", rows, "empresa,codigo")
    update_sync_state(f"formas_pag_vendas_{sigla}", sigla, n, modo="FULL")
    print(f"   {sigla}: {n} formas em {int(time.time()-inicio)}s")
    return n


# ====================================================================
# 4. FAMILIAS PRODUTOS (/geral/familias/PesquisarFamilias)
#    Param especial: apenas {pagina: N} sem registros_por_pagina
# ====================================================================
def map_familia(item: dict, sigla: str) -> dict:
    return {
        "empresa": sigla,
        "codigo": to_int(item.get("codigo")),
        "nome_familia": item.get("nomeFamilia") or None,
        "cod_int": item.get("codInt") or None,
    }


def importar_familias(sigla: str):
    inicio = time.time()
    print(f"\n-> {sigla} | Familias Produtos")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/geral/familias/",
        call="PesquisarFamilias",
        sigla=sigla,
        list_field="famCadastro",
        page_size=100,
        page_key="pagina",
        size_key="registros_por_pagina",
        label="Familias",
    )
    if not items:
        update_sync_state(f"familias_produtos_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = [map_familia(r, sigla) for r in items]
    rows = [r for r in rows if r["codigo"]]
    n = supa_upsert(SCHEMA, "familias_produtos", rows, "empresa,codigo")
    update_sync_state(f"familias_produtos_{sigla}", sigla, n, modo="FULL")
    print(f"   {sigla}: {n} familias em {int(time.time()-inicio)}s")
    return n


# ====================================================================
# 5. PRODUTO FORNECEDOR (/estoque/produtofornecedor/ListarProdutoFornecedor)
#    Each cadastro has nested produtos[] array
# ====================================================================
def map_produto_fornecedor(cad: dict, sigla: str) -> list:
    """Returns list of rows (one per produto of a fornecedor)."""
    cod_forn = to_int(cad.get("nCodForn"))
    cnpj = cad.get("cCpfCnpj") or None
    fantasia = cad.get("cNomeFantasia") or None
    razao = cad.get("cRazaoSocial") or None
    prods = cad.get("produtos") or []
    rows = []
    if prods:
        for p in prods:
            rows.append({
                "empresa": sigla,
                "cod_forn": cod_forn,
                "cnpj": cnpj,
                "fantasia": fantasia,
                "razao": razao,
                "cod_int_prod": p.get("nCodIntProd") or None,
                "cod_prod": p.get("cCodigo") or "",
                "descricao": p.get("cDescricao") or None,
                "preco": to_float(p.get("nPreco")),
                "unidade": p.get("cUnidade") or None,
            })
    else:
        rows.append({
            "empresa": sigla,
            "cod_forn": cod_forn,
            "cnpj": cnpj,
            "fantasia": fantasia,
            "razao": razao,
            "cod_int_prod": None,
            "cod_prod": "",
            "descricao": None,
            "preco": None,
            "unidade": None,
        })
    return rows


def importar_produto_fornecedor(sigla: str):
    inicio = time.time()
    print(f"\n-> {sigla} | Produto Fornecedor")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/estoque/produtofornecedor/",
        call="ListarProdutoFornecedor",
        sigla=sigla,
        list_field="cadastros",
        page_size=100,
        page_key="pagina",
        size_key="registros_por_pagina",
        label="ProdForn",
    )
    if not items:
        update_sync_state(f"produto_fornecedor_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = []
    for cad in items:
        rows.extend(map_produto_fornecedor(cad, sigla))
    rows = [r for r in rows if r["cod_forn"]]
    n = supa_upsert(SCHEMA, "produto_fornecedor", rows, "empresa,cod_forn,cod_prod")
    update_sync_state(f"produto_fornecedor_{sigla}", sigla, n, modo="FULL")
    print(f"   {sigla}: {n} vinculos em {int(time.time()-inicio)}s")
    return n


# ====================================================================
# 6. UNIDADES (/geral/unidade/ListarUnidades)
#    Param especial: {codigo: ""}  -- retorna tudo de uma vez, sem paginacao
# ====================================================================
def map_unidade(item: dict, sigla: str) -> dict:
    return {
        "empresa": sigla,
        "sigla": item.get("cCodigo") or "",
        "descricao": item.get("cDescricao") or None,
    }


def importar_unidades(sigla: str):
    inicio = time.time()
    print(f"\n-> {sigla} | Unidades")
    # ListarUnidades nao pagina -- chama direto
    data = fetch_omie(
        url="https://app.omie.com.br/api/v1/geral/unidade/",
        call="ListarUnidades",
        sigla=sigla,
        param={"codigo": ""},
    )
    if data.get("_empty_page"):
        update_sync_state(f"unidades_{sigla}", sigla, 0, modo="FULL")
        return 0
    items = data.get("unidade_cadastro") or []
    if not items:
        update_sync_state(f"unidades_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = [map_unidade(r, sigla) for r in items]
    rows = [r for r in rows if r["sigla"]]
    n = supa_upsert(SCHEMA, "unidades", rows, "empresa,sigla")
    update_sync_state(f"unidades_{sigla}", sigla, n, modo="FULL")
    print(f"   {sigla}: {n} unidades em {int(time.time()-inicio)}s")
    return n


# ====================================================================
# 7. FORMAS PAGAMENTO COMPRAS (/produtos/formaspagcompras/ListarFormasPagCompras)
# ====================================================================
def map_forma_pag_compra(item: dict, sigla: str) -> dict:
    return {
        "empresa": sigla,
        "codigo": str(item.get("cCodigo")) if item.get("cCodigo") else None,
        "descricao": item.get("cDescricao") or None,
        "num_parcelas": to_float(item.get("nNumeroParcelas")),
        "cod_forma_pag": to_int(item.get("nCodFormaPag")),
    }


def importar_formas_pag_compras(sigla: str):
    inicio = time.time()
    print(f"\n-> {sigla} | Formas Pagamento Compras")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/produtos/formaspagcompras/",
        call="ListarFormasPagCompras",
        sigla=sigla,
        list_field="cadastros",
        page_size=100,
        page_key="pagina",
        size_key="registros_por_pagina",
        label="FormasPagCompras",
    )
    if not items:
        update_sync_state(f"formas_pag_compras_{sigla}", sigla, 0, modo="FULL")
        return 0
    rows = [map_forma_pag_compra(r, sigla) for r in items]
    rows = [r for r in rows if r["codigo"]]
    n = supa_upsert(SCHEMA, "formas_pagamento_compras", rows, "empresa,codigo")
    update_sync_state(f"formas_pag_compras_{sigla}", sigla, n, modo="FULL")
    print(f"   {sigla}: {n} formas em {int(time.time()-inicio)}s")
    return n


# ====================================================================
# MAIN
# ====================================================================
# All importers grouped by source GS script:
IMPORTERS = [
    # From Produtos_3_S.gs
    ("Produtos Compras", importar_produtos),
    # From Auxiliares_3_S.gs
    ("Etapas Faturamento", importar_etapas_faturamento),
    ("Formas Pag Vendas", importar_formas_pag_vendas),
    # From Compras_aux_3_S.gs
    ("Familias Produtos", importar_familias),
    ("Produto Fornecedor", importar_produto_fornecedor),
    ("Unidades", importar_unidades),
    ("Formas Pag Compras", importar_formas_pag_compras),
]


def main():
    print("=" * 63)
    print("Import Orders Auxiliares (Semanal) -- Omie -> Supabase")
    print("=" * 63)
    print(f"Empresas: {', '.join(EMPRESAS_ALVO)}")
    print(f"Tabelas: {len(IMPORTERS)}")

    inicio_geral = time.time()
    total = 0
    houve_erro = False

    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"\n  {sigla}: credenciais nao configuradas -- pulando")
            continue

        for nome, func in IMPORTERS:
            try:
                total += func(sigla)
            except Exception as e:
                houve_erro = True
                print(f"Erro em {nome} ({sigla}): {e}")
                try:
                    modulo_nome = nome.lower().replace(" ", "_")
                    update_sync_state(f"{modulo_nome}_{sigla}", sigla, 0,
                                      modo="ERRO", status="ERRO", erro=str(e)[:500])
                except Exception:
                    pass

            # Small pause between tables to be nice to Omie API
            time.sleep(PAUSA_ENTRE_CHAMADAS)

    elapsed = int(time.time() - inicio_geral)
    print()
    print("=" * 63)
    print(f"GERAL concluido em {elapsed}s | Total: {total} rows ({len(IMPORTERS)} tabelas)")
    print("=" * 63)

    # Trigger mirrors for main tables
    trigger_sheets_mirror("ProdutosCompras")
    trigger_sheets_mirror("EtapasFaturamento")
    trigger_sheets_mirror("ProdutoFornecedor")

    if houve_erro:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrompido")
        sys.exit(130)

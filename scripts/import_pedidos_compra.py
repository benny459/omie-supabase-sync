#!/usr/bin/env python3
"""
==========================================================================
IMPORT PEDIDOS DE COMPRA -- Omie -> Supabase
Endpoint: /produtos/pedidocompra/PesquisarPedCompra
Tabela:   orders.pedidos_compra
Freq:     Diaria
Volume:   Variavel -- cada pedido gera N rows (1 por item)
==========================================================================
"""
import os
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, PAUSA_ENTRE_CHAMADAS,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror
)

OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedidocompra/"
MODULO = "pedidos_compra"
SCHEMA = "orders"
TABELA = "pedidos_compra"
PK = "empresa,ncod_ped,ncod_item"


def map_pedido_item(sigla: str, cab: dict, prod: dict) -> dict:
    """Monta 1 row para 1 item de um pedido de compra."""
    return {
        "empresa": sigla,
        "ncod_ped": to_int(cab.get("nCodPed")),
        "cnumero": cab.get("cNumero") or None,
        "ccod_categ": cab.get("cCodCateg") or None,
        "cetapa": cab.get("cEtapa") or None,
        "dinc_data": cab.get("dIncData") or None,
        "cinc_hora": cab.get("cIncHora") or None,
        "ncod_for": to_int(cab.get("nCodFor")),
        "ccod_int_for": cab.get("cCodIntFor") or None,
        "ccontato": cab.get("cContato") or None,
        "ccod_parc": cab.get("cCodParc") or None,
        "nqtde_parc": to_float(cab.get("nQtdeParc")),
        "ddt_previsao": cab.get("dDtPrevisao") or None,
        "ncod_cc": to_int(cab.get("nCodCC")),
        "ncod_int_cc": cab.get("nCodIntCC") or None,
        "ncod_compr": to_int(cab.get("nCodCompr")),
        "ncod_proj": to_int(cab.get("nCodProj")),
        "ccod_int_ped": cab.get("cCodIntPed") or None,
        "cnum_pedido": cab.get("cNumPedido") or None,
        "ccontrato": cab.get("cContrato") or None,
        "cobs": cab.get("cObs") or None,
        "cobs_int": cab.get("cObsInt") or None,
        "ntotal_pedido": to_float(cab.get("nTotalPedido")),
        "ccod_status": cab.get("cCodStatus") or None,
        "cdesc_status": cab.get("cDescStatus") or None,
        "crecebido": cab.get("cRecebido") or None,
        "ddata_recebimento": cab.get("dDataRecebimento") or None,
        "ddt_faturamento": cab.get("dDtFaturamento") or None,
        "cnumero_nf": cab.get("cNumeroNF") or None,
        # Item fields
        "ncod_item": to_int(prod.get("nCodItem")) or 0,
        "ncod_prod": to_int(prod.get("nCodProd")),
        "ccod_int_prod": prod.get("cCodIntProd") or None,
        "cproduto": prod.get("cProduto") or None,
        "cdescricao": prod.get("cDescricao") or None,
        "cunidade": prod.get("cUnidade") or None,
        "nqtde": to_float(prod.get("nQtde")),
        "nval_unit": to_float(prod.get("nValUnit")),
        "nval_tot": to_float(prod.get("nValTot")),
        "ndesconto": to_float(prod.get("nDesconto")),
        "nfrete": to_float(prod.get("nFrete")),
        "nseguro": to_float(prod.get("nSeguro")),
        "ndespesas": to_float(prod.get("nDespesas")),
        "loc_estoque": prod.get("codigo_local_estoque") or None,
        "cean": prod.get("cEAN") or None,
        "cncm": prod.get("cNCM") or None,
        "nqtde_rec": to_float(prod.get("nQtdeRec")),
        "npeso_bruto": to_float(prod.get("nPesoBruto")),
        "npeso_liq": to_float(prod.get("nPesoLiq")),
        "ccod_int_item": prod.get("cCodIntItem") or None,
        "nval_merc": to_float(prod.get("nValMerc")),
        "nvalor_cofins": to_float(prod.get("nValorCofins")),
        "nvalor_icms": to_float(prod.get("nValorIcms")),
        "nvalor_ipi": to_float(prod.get("nValorIpi")),
        "nvalor_pis": to_float(prod.get("nValorPis")),
        "nvalor_st": to_float(prod.get("nValorSt")),
    }


def explodir_pedido(ped: dict, sigla: str) -> list:
    """Expande 1 pedido em N rows (1 por item, como ItensVendidos)."""
    cab = ped.get("cabecalho_consulta") or {}
    prods = ped.get("produtos_consulta") or []
    if not prods:
        # Pedido sem itens -- gera 1 row com campos de produto vazios
        return [map_pedido_item(sigla, cab, {})]
    return [map_pedido_item(sigla, cab, p) for p in prods]


def importar_empresa(sigla: str):
    inicio = time.time()
    print(f"\n-> {sigla} | Pedidos de Compra | FULL")

    # PesquisarPedCompra uses nPagina / nRegsPorPagina
    items = fetch_omie_paginated(
        url=OMIE_URL,
        call="PesquisarPedCompra",
        sigla=sigla,
        list_field="pedidos_pesquisa",
        page_size=100,
        page_key="nPagina",
        size_key="nRegsPorPagina",
        extra_param={
            "lExibirPedidosPendentes": "S",
            "lExibirPedidosFaturados": "S",
            "lExibirPedidosCancelados": "S",
            "lExibirPedidosRecebidos": "S",
            "lExibirPedidosEncerrados": "S",
        },
        label="PedCompra",
    )

    if not items:
        print(f"   {sigla}: nenhum registro")
        update_sync_state(f"pedidos_compra_{sigla}", sigla, 0, modo="FULL")
        return 0

    # Explodir pedidos em linhas de itens
    rows = []
    for ped in items:
        rows.extend(explodir_pedido(ped, sigla))

    # Filtra rows sem PK
    rows = [r for r in rows if r["ncod_ped"]]

    print(f"   {sigla}: {len(items)} pedidos -> {len(rows)} linhas (itens)")

    n = supa_upsert(SCHEMA, TABELA, rows, PK)
    update_sync_state(f"pedidos_compra_{sigla}", sigla, n, modo="FULL")

    elapsed = int(time.time() - inicio)
    print(f"   {sigla}: {n} rows em {elapsed}s")
    return n


def main():
    print("=" * 63)
    print("Import Pedidos de Compra -- Omie -> Supabase")
    print("=" * 63)
    print(f"Empresas: {', '.join(EMPRESAS_ALVO)}")

    inicio_geral = time.time()
    total = 0
    houve_erro = False

    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"  {sigla}: credenciais nao configuradas -- pulando")
            continue
        try:
            total += importar_empresa(sigla)
        except Exception as e:
            houve_erro = True
            print(f"Erro em {sigla}: {e}")
            try:
                update_sync_state(f"pedidos_compra_{sigla}", sigla, 0, modo="ERRO",
                                  status="ERRO", erro=str(e)[:500])
            except Exception:
                pass

    elapsed = int(time.time() - inicio_geral)
    print()
    print("=" * 63)
    print(f"GERAL concluido em {elapsed}s | Total: {total} rows")
    print("=" * 63)

    trigger_sheets_mirror("PedidosCompra")

    if houve_erro:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrompido")
        sys.exit(130)

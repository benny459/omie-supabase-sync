#!/usr/bin/env python3
"""
==========================================================================
IMPORT PEDIDOS DE COMPRA -- Omie -> Supabase
Endpoint: /produtos/pedidocompra/PesquisarPedCompra
Tabela:   orders.pedidos_compra
Volume:   ~4200 PCs / 13.6k linhas (cada pedido gera N rows = 1 por item)
==========================================================================

MODO via env var MAX_PAGINAS_PEDCOMPRA:

  - MAX_PAGINAS_PEDCOMPRA=10 (DIARIO) → pega so as 10 primeiras paginas
    (~1000 PCs mais recentes — API retorna em ordem ncod_ped DESC).
    Tempo: ~10-15s. Cobre edits em PCs criados/editados nos ultimos
    ~30 dias, que representam 95%+ dos casos.

  - MAX_PAGINAS_PEDCOMPRA=0 ou ausente (SEMANAL/FULL) → pega tudo.
    Tempo: ~60-90s. Garante captura de edits em PCs antigos raramente
    modificados.

A API Omie nao retorna data de alteracao nem aceita filtro por ela
(testado em test_omie_pc_filters.py), entao paginacao por DESC e a
unica forma viavel de ter incremental.

API tem cap de 100 registros/pagina. Fim de paginacao via faultstring
"Nao existem registros para a pagina [X]" (tratada em _common.fetch_omie).
==========================================================================
"""
import os
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, PAUSA_ENTRE_CHAMADAS,
    fetch_omie, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror,
)

# 0 ou ausente = pega todas as páginas (FULL).
# > 0 = limita a N páginas (DIARIO captura recentes).
MAX_PAGINAS = int(os.environ.get("MAX_PAGINAS_PEDCOMPRA", "0") or "0")

OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedidocompra/"
MODULO = "pedidos_compra"
SCHEMA = "orders"
TABELA = "pedidos_compra"
PK = "empresa,ncod_ped,ncod_item"

# Config:
PAGE_SIZE = 100  # cap rígido da API


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
        "ccontrato": cab.get("ccontrato") or None,
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
    """Expande 1 pedido em N rows (1 por item)."""
    cab = ped.get("cabecalho_consulta") or {}
    prods = ped.get("produtos_consulta") or []
    if not prods:
        return [map_pedido_item(sigla, cab, {})]
    return [map_pedido_item(sigla, cab, p) for p in prods]


def importar_empresa(sigla: str):
    inicio = time.time()
    modo_label = f"DIARIO ({MAX_PAGINAS} pgs / ~{MAX_PAGINAS*100} PCs recentes)" if MAX_PAGINAS > 0 else "FULL"
    print(f"\n-> {sigla} | Pedidos de Compra | {modo_label}")

    extra_param = {
        "lExibirPedidosPendentes":  "S",
        "lExibirPedidosFaturados":  "S",
        "lExibirPedidosCancelados": "S",
        "lExibirPedidosRecebidos":  "S",
        "lExibirPedidosEncerrados": "S",
    }

    all_items = []
    pagina = 1

    while True:
        param = {"nPagina": pagina, "nRegsPorPagina": PAGE_SIZE, **extra_param}
        print(f"   ⬇️  {sigla} | PedCompra pág {pagina} ({PAGE_SIZE}/p)...", end=" ", flush=True)
        data = fetch_omie(OMIE_URL, "PesquisarPedCompra", sigla, param)

        if data.get("_empty_page"):
            print("fim (sem mais registros).")
            break

        items = data.get("pedidos_pesquisa") or []
        if not items:
            print("vazio, fim.")
            break

        all_items.extend(items)
        print(f"{len(items)} registros (acum: {len(all_items)} | pág {pagina})")

        # Modo DIARIO: para após N páginas configuradas em MAX_PAGINAS_PEDCOMPRA
        if MAX_PAGINAS > 0 and pagina >= MAX_PAGINAS:
            print(f"   ✋ Modo DIARIO: parando após {MAX_PAGINAS} páginas configuradas")
            break

        # Limite de segurança: 100 páginas (10k PCs) — proteção pra modo FULL
        if pagina >= 100:
            print(f"   ⚠ Atingiu limite de 100 páginas — parando por segurança")
            break

        pagina += 1
        time.sleep(PAUSA_ENTRE_CHAMADAS)

    if not all_items:
        print(f"   {sigla}: nenhum registro")
        elapsed = int(time.time() - inicio)
        update_sync_state(f"pedidos_compra_{sigla}", sigla, 0, modo="FULL", duracao_segundos=elapsed)
        return 0

    # Explodir pedidos em linhas de itens
    rows = []
    for ped in all_items:
        rows.extend(explodir_pedido(ped, sigla))
    rows = [r for r in rows if r["ncod_ped"]]
    count_raw = len(rows)

    # Dedup por PK (empresa, ncod_ped, ncod_item) — necessário porque:
    #   1. PCs sem itens explodem para 1 row com ncod_item=0
    #   2. Itens sem nCodItem na resposta também viram ncod_item=0
    #   3. Mesmo PC pode aparecer em 2 páginas se a API tiver hiccup
    # UPSERT do Supabase rejeita duplicatas no batch (erro 21000).
    # Mantém a ÚLTIMA ocorrência (sobrescreve no dict).
    dedup: dict = {}
    for r in rows:
        key = (r["empresa"], r["ncod_ped"], r["ncod_item"])
        dedup[key] = r
    rows = list(dedup.values())
    if len(rows) < count_raw:
        print(f"   🔧 Dedup PK: {count_raw} → {len(rows)} rows únicos ({count_raw - len(rows)} duplicatas removidas)")

    print(f"   {sigla}: {len(all_items)} pedidos -> {len(rows)} linhas (itens)")

    n = supa_upsert(SCHEMA, TABELA, rows, PK)
    elapsed = int(time.time() - inicio)
    modo = "DIARIO" if MAX_PAGINAS > 0 else "FULL"
    update_sync_state(f"pedidos_compra_{sigla}", sigla, n, modo=modo, duracao_segundos=elapsed)

    print(f"   {sigla}: {n} rows em {elapsed}s ({modo})")
    return n


def main():
    print("=" * 63)
    print("Import Pedidos de Compra -- Omie -> Supabase")
    if MAX_PAGINAS > 0:
        print(f"Modo: DIARIO (primeiras {MAX_PAGINAS} pgs = ~{MAX_PAGINAS*100} PCs mais recentes)")
    else:
        print("Modo: FULL (todas as paginas, ~4200 PCs)")
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

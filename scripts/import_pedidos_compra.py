#!/usr/bin/env python3
"""
==========================================================================
IMPORT PEDIDOS DE COMPRA -- Omie -> Supabase
Endpoint: /produtos/pedidocompra/PesquisarPedCompra
Tabela:   orders.pedidos_compra
Freq:     Diaria (incremental) + 1x/semana FULL
Volume:   ~4200 PCs / 13.6k linhas (cada pedido gera N rows = 1 por item)
==========================================================================

MODO DE OPERAÇÃO:
  - INCREMENTAL (padrão): pagina pelo PesquisarPedCompra (que retorna em
    ordem decrescente de ncod_ped) e PARA quando atinge ncod_ped já
    sincronizado. Tipicamente baixa só 1-3 páginas (~100-300 PCs novos).

  - FULL: baixa tudo. Acionado por:
      * FORCAR_FULL=true (env var)
      * Sem dados prévios no Supabase (1º run)
      * Domingo (DIA_FULL_SEMANAL=6 por default, Python weekday)

A API do PesquisarPedCompra é brutalmente limitada (ver
test_omie_pc_filters.py): não aceita filtros de data, etapa, page_size > 100.
Mas confirmamos empiricamente que retorna em ordem ncod_ped DESC, então
incremental por offset/early-stop é viável.
==========================================================================
"""
import datetime
import json
import sys
import time
import urllib.parse

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, PAUSA_ENTRE_CHAMADAS, env,
    fetch_omie, supa_upsert, supa_select, update_sync_state,
    to_int, to_float, trigger_sheets_mirror,
)

OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedidocompra/"
MODULO = "pedidos_compra"
SCHEMA = "orders"
TABELA = "pedidos_compra"
PK = "empresa,ncod_ped,ncod_item"

# Config:
FORCAR_FULL = env("FORCAR_FULL", "false").lower() == "true"
DIA_FULL_SEMANAL = int(env("DIA_FULL_SEMANAL", "6"))  # 6=domingo (Python weekday)
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


def get_max_ncod_ped(sigla: str):
    """Retorna o maior ncod_ped já sincronizado pra essa empresa, ou None."""
    try:
        rows = supa_select(
            SCHEMA, TABELA,
            f"select=ncod_ped&empresa=eq.{urllib.parse.quote(sigla)}&order=ncod_ped.desc&limit=1"
        )
        if rows and rows[0].get("ncod_ped"):
            return rows[0]["ncod_ped"]
    except Exception as e:
        print(f"   ⚠️ Falha lendo MAX(ncod_ped): {e}")
    return None


def decidir_modo(sigla: str):
    """Retorna ('FULL'|'INCREMENTAL', max_ncod_ped_atual_ou_None)."""
    if FORCAR_FULL:
        return "FULL", None
    if datetime.datetime.now().weekday() == DIA_FULL_SEMANAL:
        return "FULL", None
    last = get_max_ncod_ped(sigla)
    if last is None:
        return "FULL", None  # primeiro run
    return "INCREMENTAL", last


def importar_empresa(sigla: str):
    inicio = time.time()
    modo, last_ncod_ped = decidir_modo(sigla)

    if modo == "INCREMENTAL":
        print(f"\n-> {sigla} | Pedidos de Compra | INCREMENTAL (early-stop em ncod_ped <= {last_ncod_ped})")
    else:
        print(f"\n-> {sigla} | Pedidos de Compra | FULL")

    extra_param = {
        "lExibirPedidosPendentes":  "S",
        "lExibirPedidosFaturados":  "S",
        "lExibirPedidosCancelados": "S",
        "lExibirPedidosRecebidos":  "S",
        "lExibirPedidosEncerrados": "S",
    }

    all_items = []
    pagina = 1
    parou_por_overlap = False

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

        # Em INCREMENTAL: extrair menor ncod_ped da página → se já está abaixo
        # do limite, pegamos os PCs > limite desta página e paramos.
        if modo == "INCREMENTAL" and last_ncod_ped is not None:
            ncods_pag = [to_int(p.get("cabecalho_consulta", {}).get("nCodPed")) for p in items]
            ncods_pag = [n for n in ncods_pag if n]
            min_pagina = min(ncods_pag) if ncods_pag else 0
            if min_pagina <= last_ncod_ped:
                # Última página relevante: filtra só os > last_ncod_ped
                items_relevantes = [
                    p for p in items
                    if to_int((p.get("cabecalho_consulta") or {}).get("nCodPed") or 0) > last_ncod_ped
                ]
                all_items.extend(items_relevantes)
                print(f"{len(items)} registros (filtrou {len(items_relevantes)} novos | min ncod_ped={min_pagina} <= limite={last_ncod_ped} → fim)")
                parou_por_overlap = True
                break

        all_items.extend(items)
        print(f"{len(items)} registros (acum: {len(all_items)} | pág {pagina})")

        # Limite de segurança: 100 páginas (10k PCs) — se não parou ainda algo está errado
        if pagina >= 100:
            print(f"   ⚠ Atingiu limite de 100 páginas — parando por segurança")
            break

        pagina += 1
        time.sleep(PAUSA_ENTRE_CHAMADAS)

    if not all_items:
        msg = "nenhum registro novo" if modo == "INCREMENTAL" else "nenhum registro"
        print(f"   {sigla}: {msg}")
        elapsed = int(time.time() - inicio)
        update_sync_state(f"pedidos_compra_{sigla}", sigla, 0, modo=modo, duracao_segundos=elapsed)
        return 0

    # Explodir pedidos em linhas de itens
    rows = []
    for ped in all_items:
        rows.extend(explodir_pedido(ped, sigla))
    rows = [r for r in rows if r["ncod_ped"]]

    print(f"   {sigla}: {len(all_items)} pedidos -> {len(rows)} linhas (itens)")

    n = supa_upsert(SCHEMA, TABELA, rows, PK)
    elapsed = int(time.time() - inicio)
    update_sync_state(f"pedidos_compra_{sigla}", sigla, n, modo=modo, duracao_segundos=elapsed)

    print(f"   {sigla}: {n} rows em {elapsed}s ({modo})")
    return n


def main():
    print("=" * 63)
    print(f"Import Pedidos de Compra -- Omie -> Supabase")
    print(f"Modo: {'FORCAR_FULL=true' if FORCAR_FULL else f'auto (FULL aos domingos, INCREMENTAL nos demais)'}")
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

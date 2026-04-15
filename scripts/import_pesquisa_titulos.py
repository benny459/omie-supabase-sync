#!/usr/bin/env python3
"""
Pesquisa de Titulos -- Omie -> Supabase
Endpoint: /financas/pesquisartitulos/ | PesquisarLancamentos
Tabela:   finance.pesquisa_titulos
Freq:     Diaria
Pagination: nPagina / nRegPorPagina (max 100)
NOTE: This endpoint uses different pagination param names (nPagina/nRegPorPagina)
      and different response structure (titulosEncontrados -> cabecTitulo + resumo).
"""
import sys, time
from datetime import datetime, timedelta

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, env,
    fetch_and_upsert_streaming, update_sync_state,
    to_int, to_float, trigger_sheets_mirror,
)

OMIE_URL = "https://app.omie.com.br/api/v1/financas/pesquisartitulos/"
SCHEMA   = "finance"
TABELA   = "pesquisa_titulos"
PK       = "empresa,cod_titulo"
FORCAR_FULL = env("FORCAR_FULL", "false").lower() == "true"
DIAS_INCREMENTAL = int(env("DIAS_INCREMENTAL", "90"))
MAX_SECONDS = int(env("MAX_SECONDS_PER_STEP", "7000"))


def map_row(titulo: dict, sigla: str) -> dict:
    """Maps a single titulo from PesquisarLancamentos response."""
    t      = titulo.get("cabecTitulo") or {}
    info   = t.get("info") or {}
    resumo = titulo.get("resumo") or {}

    # categorias rateio
    a_cats = t.get("aCodCateg") or []
    categorias_str = ", ".join(
        cat.get("cCodCateg", "") for cat in a_cats if isinstance(cat, dict)
    ) if isinstance(a_cats, list) else ""

    return {
        "empresa":            sigla,
        "cod_titulo":         to_int(t.get("nCodTitulo")),
        "cod_int_titulo":     t.get("cCodIntTitulo") or None,
        "num_titulo":         t.get("cNumTitulo") or None,
        "dt_emissao":         t.get("dDtEmissao") or None,
        "dt_vencimento":      t.get("dDtVenc") or None,
        "dt_previsao":        t.get("dDtPrevisao") or None,
        "dt_pagamento":       t.get("dDtPagamento") or None,
        "cod_cliente":        to_int(t.get("nCodCliente")),
        "cpf_cnpj_cliente":   t.get("cCPFCNPJCliente") or None,
        "cod_contrato":       to_int(t.get("nCodCtr")),
        "num_contrato":       t.get("cNumCtr") or None,
        "cod_os":             to_int(t.get("nCodOS")),
        "num_os":             t.get("cNumOS") or None,
        "cod_cc":             to_int(t.get("nCodCC")),
        "status":             t.get("cStatus") or None,
        "natureza":           t.get("cNatureza") or None,
        "tipo":               t.get("cTipo") or None,
        "operacao":           t.get("cOperacao") or None,
        "num_doc_fiscal":     t.get("cNumDocFiscal") or None,
        "cod_categoria":      t.get("cCodCateg") or None,
        "categorias_rateio":  categorias_str or None,
        "num_parcela":        t.get("cNumParcela") or None,
        "valor_titulo":       to_float(t.get("nValorTitulo")),
        "valor_pis":          to_float(t.get("nValorPIS")),
        "ret_pis":            t.get("cRetPIS") or None,
        "valor_cofins":       to_float(t.get("nValorCOFINS")),
        "ret_cofins":         t.get("cRetCOFINS") or None,
        "valor_csll":         to_float(t.get("nValorCSLL")),
        "ret_csll":           t.get("cRetCSLL") or None,
        "valor_ir":           to_float(t.get("nValorIR")),
        "ret_ir":             t.get("cRetIR") or None,
        "valor_iss":          to_float(t.get("nValorISS")),
        "ret_iss":            t.get("cRetISS") or None,
        "valor_inss":         to_float(t.get("nValorINSS")),
        "ret_inss":           t.get("cRetINSS") or None,
        "observacao":         t.get("observacao") or None,
        "cod_projeto":        t.get("cCodProjeto") or None,
        "cod_vendedor":       t.get("cCodVendedor") or None,
        "cod_comprador":      to_int(t.get("nCodComprador")),
        "codigo_barras":      t.get("cCodigoBarras") or None,
        "nsu":                t.get("cNSU") or None,
        "cod_nf":             to_int(t.get("nCodNF")),
        "dt_registro":        t.get("dDtRegistro") or None,
        "num_boleto":         t.get("cNumBoleto") or None,
        "chave_nfe":          t.get("cChaveNFe") or None,
        "origem":             t.get("cOrigem") or None,
        "cod_tit_repet":      to_int(t.get("nCodTitRepet")),
        "dt_cancelamento":    t.get("dDtCanc") or None,
        "liquidado":          resumo.get("cLiquidado") or None,
        "val_pago":           to_float(resumo.get("nValPago")),
        "val_aberto":         to_float(resumo.get("nValAberto")),
        "desconto":           to_float(resumo.get("nDesconto")),
        "juros":              to_float(resumo.get("nJuros")),
        "multa":              to_float(resumo.get("nMulta")),
        "val_liquido":        to_float(resumo.get("nValLiquido")),
        "info_d_inc":         info.get("dInc") or None,
        "info_h_inc":         info.get("hInc") or None,
        "info_u_inc":         info.get("uInc") or None,
        "info_d_alt":         info.get("dAlt") or None,
        "info_h_alt":         info.get("hAlt") or None,
        "info_u_alt":         info.get("uAlt") or None,
    }


def _data_filtro():
    if FORCAR_FULL:
        return None, "FULL"
    dt = datetime.now() - timedelta(days=DIAS_INCREMENTAL)
    return dt.strftime("%d/%m/%Y"), f"INCREMENTAL ({DIAS_INCREMENTAL}d)"

def main():
    print("=" * 60)
    print("  IMPORT PESQUISA TITULOS (STREAMING)")
    print("=" * 60)

    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            continue
        inicio = time.time()
        data_filtro, modo_label = _data_filtro()
        print(f"\n   Modo: {modo_label} | Filtro: {data_filtro or 'sem filtro'}")
        extra = {"lDadosCad": True}
        if data_filtro:
            extra["dDtIncDe"] = data_filtro  # PesquisarLancamentos usa dDtIncDe
        try:
            total, completed, pages = fetch_and_upsert_streaming(
                url=OMIE_URL, call="PesquisarLancamentos", sigla=sigla,
                list_field="titulosEncontrados",
                schema=SCHEMA, table=TABELA, pk=PK,
                mapper_fn=map_row,
                page_size=100,
                extra_param=extra,
                page_key="nPagina", size_key="nRegPorPagina",
                max_seconds=MAX_SECONDS,
                upsert_every=500,
                label="PesquisaTitulos",
            )
            duracao = int(time.time() - inicio)
            modo = "FULL" if completed else "PARCIAL"
            update_sync_state(f"pesquisa_titulos_{sigla}", sigla, total, modo=modo, duracao_segundos=duracao)
        except Exception as e:
            print(f"   ❌ {sigla}: {e}")
            update_sync_state(f"pesquisa_titulos_{sigla}", sigla, 0, status="ERRO", erro=str(e)[:200])

    trigger_sheets_mirror("pesquisa_titulos")


if __name__ == "__main__":
    main()

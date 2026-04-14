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

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, env,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror, upsert_with_tracking,
)

OMIE_URL = "https://app.omie.com.br/api/v1/financas/pesquisartitulos/"
SCHEMA   = "finance"
TABELA   = "pesquisa_titulos"
PK       = "empresa,cod_titulo"


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


def importar_empresa(sigla: str):
    inicio = time.time()
    print(f"\n{'='*60}")
    print(f"  {sigla} | Pesquisa Titulos")
    print(f"{'='*60}")

    # PesquisarLancamentos uses nPagina/nRegPorPagina pagination
    items = fetch_omie_paginated(
        url=OMIE_URL,
        call="PesquisarLancamentos",
        sigla=sigla,
        list_field="titulosEncontrados",
        page_size=100,
        extra_param={"lDadosCad": True},
        page_key="nPagina",
        size_key="nRegPorPagina",
        label="PesquisaTitulos",
    )

    if not items:
        print(f"   {sigla}: nenhum registro")
        update_sync_state(f"pesquisa_titulos_{sigla}", sigla, 0, modo="FULL")
        return 0

    rows = [map_row(t, sigla) for t in items]
    rows = [r for r in rows if r["cod_titulo"]]

    total, inserted, updated, before, after = upsert_with_tracking(
        SCHEMA, TABELA, rows, PK, empresa=sigla
    )

    duracao = int(time.time() - inicio)
    print(f"   {sigla}: {total} upserted ({inserted} new, {updated} upd) em {duracao}s")

    update_sync_state(
        f"pesquisa_titulos_{sigla}", sigla, total,
        modo="FULL", rows_inserted=inserted, rows_updated=updated,
        rows_before=before, duracao_segundos=duracao,
    )
    return total


def main():
    print("=" * 60)
    print("  IMPORT PESQUISA TITULOS  (Omie -> Supabase)")
    print("=" * 60)

    total_geral = 0
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"   {sigla}: credenciais ausentes, pulando")
            continue
        try:
            total_geral += importar_empresa(sigla)
        except Exception as e:
            print(f"   {sigla}: ERRO -> {e}")
            update_sync_state(
                f"pesquisa_titulos_{sigla}", sigla, 0,
                status="ERRO", erro=str(e)[:200],
            )

    print(f"\nTotal geral: {total_geral}")
    trigger_sheets_mirror("pesquisa_titulos")


if __name__ == "__main__":
    main()

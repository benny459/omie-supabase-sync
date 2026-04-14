#!/usr/bin/env python3
"""
Extratos de Conta Corrente -- Omie -> Supabase
Endpoints:
  - /geral/contacorrente/   | ListarContasCorrentes  (get list of accounts)
  - /financas/extrato/      | ListarExtrato          (get movements per account)
Tabela:   finance.extratos_cc
Freq:     Diaria
NOTE: ListarExtrato is NOT paginated -- it returns all movements for a given
      account + date range in a single call. We loop over each account per empresa.
"""
import sys, time
from datetime import datetime, timedelta

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, env,
    fetch_omie, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror, upsert_with_tracking,
    fetch_omie_paginated,
)

OMIE_URL_CC     = "https://app.omie.com.br/api/v1/geral/contacorrente/"
OMIE_URL_EXT    = "https://app.omie.com.br/api/v1/financas/extrato/"
SCHEMA          = "finance"
TABELA          = "extratos_cc"
PK              = "empresa,cod_conta_corrente,cod_lancamento"
DIAS_BUSCA      = int(env("EXTRATO_DIAS_BUSCA", "7"))


def obter_contas_correntes(sigla: str) -> list:
    """Fetch all bank accounts for this empresa."""
    items = fetch_omie_paginated(
        url=OMIE_URL_CC,
        call="ListarContasCorrentes",
        sigla=sigla,
        list_field="ListarContasCorrentes",
        page_size=100,
        label="ContasCC",
    )
    return [{"nCodCC": c.get("nCodCC"), "descricao": c.get("descricao")} for c in items]


def map_row(m: dict, sigla: str, cod_cc: int, cc_data: dict) -> dict:
    return {
        "empresa":            sigla,
        "cod_conta_corrente": to_int(cod_cc),
        "descricao_cc":       cc_data.get("cDescricao") or None,
        "cod_banco":          cc_data.get("nCodBanco") or None,
        "cod_agencia":        cc_data.get("nCodAgencia") or None,
        "num_conta":          cc_data.get("nNumConta") or None,
        "cod_lancamento":     to_int(m.get("nCodLancamento")),
        "cod_lanc_relac":     to_int(m.get("nCodLancRelac")),
        "situacao":           m.get("cSituacao") or None,
        "data_lancamento":    m.get("dDataLancamento") or None,
        "des_cliente":        m.get("cDesCliente") or None,
        "cod_cliente":        to_int(m.get("nCodCliente")),
        "raz_cliente":        m.get("cRazCliente") or None,
        "doc_cliente":        m.get("cDocCliente") or None,
        "tipo_documento":     m.get("cTipoDocumento") or None,
        "numero":             m.get("cNumero") or None,
        "valor_documento":    to_float(m.get("nValorDocumento")),
        "saldo":              to_float(m.get("nSaldo")),
        "cod_categoria":      m.get("cCodCategoria") or None,
        "des_categoria":      m.get("cDesCategoria") or None,
        "documento_fiscal":   m.get("cDocumentoFiscal") or None,
        "parcela":            m.get("cParcela") or None,
        "nosso_numero":       m.get("cNossoNumero") or None,
        "origem":             m.get("cOrigem") or None,
        "vendedor":           m.get("cVendedor") or None,
        "projeto":            m.get("cProjeto") or None,
        "observacoes":        m.get("cObservacoes") or None,
        "data_inclusao":      m.get("cDataInclusao") or None,
        "hora_inclusao":      m.get("cHoraInclusao") or None,
        "natureza":           m.get("cNatureza") or None,
        "bloqueado":          m.get("cBloqueado") or None,
        "data_conciliacao":   m.get("dDataConciliacao") or None,
    }


def importar_empresa(sigla: str):
    inicio = time.time()
    print(f"\n{'='*60}")
    print(f"  {sigla} | Extratos CC")
    print(f"{'='*60}")

    # Date range
    hoje = datetime.now()
    dt_inicio = hoje - timedelta(days=DIAS_BUSCA)
    dt_inicio_str = dt_inicio.strftime("%d/%m/%Y")
    dt_fim_str    = hoje.strftime("%d/%m/%Y")
    print(f"   Periodo: {dt_inicio_str} -> {dt_fim_str}")

    # Get bank accounts
    contas = obter_contas_correntes(sigla)
    print(f"   Contas correntes: {len(contas)}")

    if not contas:
        update_sync_state(f"extratos_cc_{sigla}", sigla, 0, modo="FULL")
        return 0

    all_rows = []
    for cc in contas:
        cod_cc = cc.get("nCodCC")
        if not cod_cc:
            continue

        try:
            data = fetch_omie(
                OMIE_URL_EXT, "ListarExtrato", sigla,
                {
                    "nCodCC": cod_cc,
                    "dPeriodoInicial": dt_inicio_str,
                    "dPeriodoFinal": dt_fim_str,
                    "cExibirApenasSaldo": "N",
                }
            )
        except Exception as e:
            print(f"   CC {cod_cc}: erro -> {e}")
            continue

        if data.get("_empty_page"):
            continue

        movimentos = data.get("listaMovimentos") or []
        cc_meta = {
            "cDescricao": data.get("cDescricao"),
            "nCodBanco": data.get("nCodBanco"),
            "nCodAgencia": data.get("nCodAgencia"),
            "nNumConta": data.get("nNumConta"),
        }

        for m in movimentos:
            row = map_row(m, sigla, cod_cc, cc_meta)
            if row["cod_lancamento"]:
                all_rows.append(row)

    if not all_rows:
        print(f"   {sigla}: nenhum movimento")
        update_sync_state(f"extratos_cc_{sigla}", sigla, 0, modo="FULL")
        return 0

    total, inserted, updated, before, after = upsert_with_tracking(
        SCHEMA, TABELA, all_rows, PK, empresa=sigla
    )

    duracao = int(time.time() - inicio)
    print(f"   {sigla}: {total} upserted ({inserted} new, {updated} upd) em {duracao}s")

    update_sync_state(
        f"extratos_cc_{sigla}", sigla, total,
        modo="FULL", rows_inserted=inserted, rows_updated=updated,
        rows_before=before, duracao_segundos=duracao,
    )
    return total


def main():
    print("=" * 60)
    print("  IMPORT EXTRATOS CC  (Omie -> Supabase)")
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
                f"extratos_cc_{sigla}", sigla, 0,
                status="ERRO", erro=str(e)[:200],
            )

    print(f"\nTotal geral: {total_geral}")
    trigger_sheets_mirror("extratos_cc")


if __name__ == "__main__":
    main()

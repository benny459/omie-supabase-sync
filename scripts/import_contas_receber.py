#!/usr/bin/env python3
"""
Contas a Receber -- Omie -> Supabase
Endpoint: /financas/contareceber/ | ListarContasReceber
Tabela:   finance.contas_receber
Freq:     Diaria
Pagination: pagina / registros_por_pagina (max 500)
"""
import sys, time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, env,
    fetch_and_upsert_streaming, update_sync_state,
    to_int, to_float, trigger_sheets_mirror,
)

OMIE_URL = "https://app.omie.com.br/api/v1/financas/contareceber/"
SCHEMA   = "finance"
TABELA   = "contas_receber"
PK       = "empresa,codigo_lancamento_omie"

DATA_INICIO = env("DATA_INICIO_FULL", "01/01/2024")


def map_row(c: dict, sigla: str) -> dict:
    info   = c.get("info") or {}
    boleto = c.get("boleto") or {}
    cats   = c.get("categorias") or []
    categorias_str = "; ".join(
        cat.get("codigo_categoria", "") for cat in cats if isinstance(cat, dict)
    ) if isinstance(cats, list) else ""

    return {
        "empresa":                       sigla,
        "codigo_lancamento_omie":        to_int(c.get("codigo_lancamento_omie")),
        "codigo_lancamento_integracao":  c.get("codigo_lancamento_integracao") or None,
        "codigo_cliente_fornecedor":     to_int(c.get("codigo_cliente_fornecedor")),
        "data_vencimento":               c.get("data_vencimento") or None,
        "data_previsao":                 c.get("data_previsao") or None,
        "valor_documento":               to_float(c.get("valor_documento")),
        "codigo_categoria":              c.get("codigo_categoria") or None,
        "categorias_rateio":             categorias_str or None,
        "id_conta_corrente":             to_int(c.get("id_conta_corrente")),
        "numero_documento":              c.get("numero_documento") or None,
        "numero_parcela":                c.get("numero_parcela") or None,
        "numero_documento_fiscal":       c.get("numero_documento_fiscal") or None,
        "numero_pedido":                 c.get("numero_pedido") or None,
        "chave_nfe":                     c.get("chave_nfe") or None,
        "data_emissao":                  c.get("data_emissao") or None,
        "id_origem":                     c.get("id_origem") or None,
        "codigo_projeto":                to_int(c.get("codigo_projeto")),
        "codigo_vendedor":               to_int(c.get("codigo_vendedor")),
        "status_titulo":                 c.get("status_titulo") or None,
        "observacao":                    c.get("observacao") or None,
        "valor_pis":                     to_float(c.get("valor_pis")),
        "retem_pis":                     c.get("retem_pis") or None,
        "valor_cofins":                  to_float(c.get("valor_cofins")),
        "retem_cofins":                  c.get("retem_cofins") or None,
        "valor_csll":                    to_float(c.get("valor_csll")),
        "retem_csll":                    c.get("retem_csll") or None,
        "valor_ir":                      to_float(c.get("valor_ir")),
        "retem_ir":                      c.get("retem_ir") or None,
        "valor_iss":                     to_float(c.get("valor_iss")),
        "retem_iss":                     c.get("retem_iss") or None,
        "valor_inss":                    to_float(c.get("valor_inss")),
        "retem_inss":                    c.get("retem_inss") or None,
        "boleto_gerado":                 boleto.get("cGerado") or None,
        "boleto_dt_emissao":             boleto.get("dDtEmBol") or None,
        "boleto_numero":                 boleto.get("cNumBoleto") or None,
        "boleto_num_bancario":           boleto.get("cNumBancario") or None,
        "info_d_inc":                    info.get("dInc") or None,
        "info_h_inc":                    info.get("hInc") or None,
        "info_u_inc":                    info.get("uInc") or None,
        "info_d_alt":                    info.get("dAlt") or None,
        "info_h_alt":                    info.get("hAlt") or None,
        "info_u_alt":                    info.get("uAlt") or None,
    }


MAX_SECONDS = int(env("MAX_SECONDS_PER_STEP", "7000"))

def main():
    print("=" * 60)
    print("  IMPORT CONTAS A RECEBER (STREAMING)")
    print("=" * 60)

    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            continue
        inicio = time.time()
        try:
            total, completed, pages = fetch_and_upsert_streaming(
                url=OMIE_URL, call="ListarContasReceber", sigla=sigla,
                list_field="conta_receber_cadastro",
                schema=SCHEMA, table=TABELA, pk=PK,
                mapper_fn=map_row,
                page_size=100,
                extra_param={"apenas_importado_api": "N", "filtrar_por_data_de": DATA_INICIO},
                max_seconds=MAX_SECONDS,
                upsert_every=500,
                label="ContasReceber",
            )
            duracao = int(time.time() - inicio)
            modo = "FULL" if completed else "PARCIAL"
            update_sync_state(f"contas_receber_{sigla}", sigla, total, modo=modo, duracao_segundos=duracao)
        except Exception as e:
            print(f"   ❌ {sigla}: {e}")
            update_sync_state(f"contas_receber_{sigla}", sigla, 0, status="ERRO", erro=str(e)[:200])

    trigger_sheets_mirror("contas_receber")


if __name__ == "__main__":
    main()

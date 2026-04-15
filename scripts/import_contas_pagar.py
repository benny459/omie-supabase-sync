#!/usr/bin/env python3
"""
Contas a Pagar -- Omie -> Supabase (STREAMING)
Endpoint: /financas/contapagar/ | ListarContasPagar
Tabela:   finance.contas_pagar
Freq:     Diaria
Volume:   ~54k registros (545 páginas) — usa streaming UPSERT
"""
import sys, time
from datetime import datetime, timedelta

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, env,
    fetch_and_upsert_streaming, update_sync_state,
    to_int, to_float, trigger_sheets_mirror,
)

OMIE_URL = "https://app.omie.com.br/api/v1/financas/contapagar/"
SCHEMA   = "finance"
TABELA   = "contas_pagar"
PK       = "empresa,codigo_lancamento_omie"
FORCAR_FULL = env("FORCAR_FULL", "false").lower() == "true"
DIAS_INCREMENTAL = int(env("DIAS_INCREMENTAL", "90"))  # diário: últimos 90 dias
DATA_INICIO_FULL = env("DATA_INICIO_FULL", "01/01/2024")
MAX_SECONDS = int(env("MAX_SECONDS_PER_STEP", "7000"))

def _data_filtro():
    """FULL usa data fixa. Incremental usa últimos N dias."""
    if FORCAR_FULL:
        return DATA_INICIO_FULL, "FULL"
    dt = datetime.now() - timedelta(days=DIAS_INCREMENTAL)
    return dt.strftime("%d/%m/%Y"), f"INCREMENTAL ({DIAS_INCREMENTAL}d)"


def map_row(c: dict, sigla: str) -> dict:
    info = c.get("info") or {}
    cats = c.get("categorias") or []
    categorias_str = "; ".join(
        cat.get("codigo_categoria", "") for cat in cats if isinstance(cat, dict)
    ) if cats else None
    return {
        "empresa": sigla,
        "codigo_lancamento_omie": to_int(c.get("codigo_lancamento_omie")),
        "codigo_lancamento_integracao": c.get("codigo_lancamento_integracao") or None,
        "codigo_cliente_fornecedor": to_int(c.get("codigo_cliente_fornecedor")),
        "data_vencimento": c.get("data_vencimento") or None,
        "data_previsao": c.get("data_previsao") or None,
        "valor_documento": to_float(c.get("valor_documento")),
        "valor_pago": to_float(c.get("valor_pago")),
        "codigo_categoria": c.get("codigo_categoria") or None,
        "categorias_rateio": categorias_str,
        "id_conta_corrente": to_int(c.get("id_conta_corrente")),
        "numero_documento_fiscal": c.get("numero_documento_fiscal") or None,
        "data_emissao": c.get("data_emissao") or None,
        "data_entrada": c.get("data_entrada") or None,
        "codigo_projeto": to_int(c.get("codigo_projeto")),
        "numero_pedido": c.get("numero_pedido") or None,
        "numero_documento": c.get("numero_documento") or None,
        "numero_parcela": c.get("numero_parcela") or None,
        "chave_nfe": c.get("chave_nfe") or None,
        "status_titulo": c.get("status_titulo") or None,
        "id_origem": c.get("id_origem") or None,
        "observacao": c.get("observacao") or None,
        "valor_pis": to_float(c.get("valor_pis")),
        "retem_pis": c.get("retem_pis") or None,
        "valor_cofins": to_float(c.get("valor_cofins")),
        "retem_cofins": c.get("retem_cofins") or None,
        "valor_csll": to_float(c.get("valor_csll")),
        "retem_csll": c.get("retem_csll") or None,
        "valor_ir": to_float(c.get("valor_ir")),
        "retem_ir": c.get("retem_ir") or None,
        "valor_iss": to_float(c.get("valor_iss")),
        "retem_iss": c.get("retem_iss") or None,
        "valor_inss": to_float(c.get("valor_inss")),
        "retem_inss": c.get("retem_inss") or None,
        "info_d_inc": info.get("dInc") or None,
        "info_h_inc": info.get("hInc") or None,
        "info_u_inc": info.get("uInc") or None,
        "info_d_alt": info.get("dAlt") or None,
        "info_h_alt": info.get("hAlt") or None,
        "info_u_alt": info.get("uAlt") or None,
    }


def main():
    print("=" * 60)
    print("  IMPORT CONTAS A PAGAR (STREAMING)")
    print("=" * 60)

    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            continue
        inicio = time.time()
        data_filtro, modo = _data_filtro()
        print(f"\n   Modo: {modo} | Filtro: {data_filtro}")
        try:
            total, completed, pages = fetch_and_upsert_streaming(
                url=OMIE_URL, call="ListarContasPagar", sigla=sigla,
                list_field="conta_pagar_cadastro",
                schema=SCHEMA, table=TABELA, pk=PK,
                mapper_fn=map_row,
                page_size=100,
                extra_param={"apenas_importado_api": "N", "filtrar_por_data_de": data_filtro},
                max_seconds=MAX_SECONDS,
                upsert_every=500,
                label="ContasPagar",
            )
            duracao = int(time.time() - inicio)
            modo = "FULL" if completed else "PARCIAL"
            update_sync_state(
                f"contas_pagar_{sigla}", sigla, total,
                modo=modo, duracao_segundos=duracao,
            )
        except Exception as e:
            print(f"   ❌ {sigla}: {e}")
            update_sync_state(f"contas_pagar_{sigla}", sigla, 0, status="ERRO", erro=str(e)[:200])

    trigger_sheets_mirror("contas_pagar")


if __name__ == "__main__":
    main()

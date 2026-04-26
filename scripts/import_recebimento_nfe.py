#!/usr/bin/env python3
"""
==========================================================================
IMPORT RECEBIMENTO NFE -- Omie -> Supabase
Endpoint: /produtos/recebimentonfe/ListarRecebimentos
Tabela:   orders.recebimento_nfe
Freq:     Diaria
Volume:   Variavel (depende do periodo)
==========================================================================
"""
import os
import sys
import time
from datetime import datetime, timedelta

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, PAUSA_ENTRE_CHAMADAS,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror
)

OMIE_URL = "https://app.omie.com.br/api/v1/produtos/recebimentonfe/"
MODULO = "recebimento_nfe"
SCHEMA = "orders"
TABELA = "recebimento_nfe"
PK = "empresa,id_receb"

DIAS_RETROAGIR = int(os.environ.get("DIAS_RETROAGIR", "365"))


def _calcular_periodo():
    """Retorna (dtEmissaoDe, dtEmissaoAte) no formato dd/MM/yyyy."""
    hoje = datetime.now()
    dt_ini = hoje - timedelta(days=DIAS_RETROAGIR)
    return dt_ini.strftime("%d/%m/%Y"), hoje.strftime("%d/%m/%Y")


def map_recebimento_to_row(r: dict, sigla: str) -> dict:
    c = r.get("cabec") or {}
    ic = r.get("infoCadastro") or {}
    ia = r.get("infoAdicionais") or {}
    t = r.get("totais") or {}
    parc = r.get("parcelas") or {}

    # Vinculo com pedido via primeiro item
    n_id_pedido = None
    c_num_pedido = None
    n_id_item_ped = None
    tem_vinculo = "NAO"
    itens_receb = r.get("itensRecebimento") or []
    if itens_receb:
        itens_cab = itens_receb[0].get("itensCabec") or {}
        if itens_cab.get("nIdPedido"):
            n_id_pedido = to_int(itens_cab.get("nIdPedido"))
            c_num_pedido = itens_cab.get("cNumPedido") or itens_cab.get("cNumero") or None
            n_id_item_ped = to_int(itens_cab.get("nIdItPedido"))
            tem_vinculo = "SIM"

    return {
        "empresa": sigla,
        "id_receb": to_int(c.get("nIdReceb")),
        "chave_nfe": c.get("cChaveNfe") or None,
        "id_fornecedor": to_int(c.get("nIdFornecedor")),
        "razao_social": c.get("cRazaoSocial") or None,
        "nome_fantasia": c.get("cNome") or None,
        "cnpj_cpf": c.get("cCNPJ_CPF") or None,
        "num_nfe": c.get("cNumeroNFe") or None,
        "serie": c.get("cSerieNFe") or None,
        "modelo": c.get("cModeloNFe") or None,
        "emissao": c.get("dEmissaoNFe") or None,
        "valor_nfe": to_float(c.get("nValorNFe")),
        "natureza_operacao": c.get("cNaturezaOperacao") or None,
        "etapa": c.get("cEtapa") or None,
        "faturado": ic.get("cFaturado") or None,
        "dt_fat": ic.get("dFat") or None,
        "recebido": ic.get("cRecebido") or None,
        "dt_rec": ic.get("dRec") or None,
        "autorizado": ic.get("cAutorizado") or None,
        "cancelada": ic.get("cCancelada") or None,
        "bloqueado": ic.get("cBloqueado") or None,
        "denegado": ic.get("cDenegado") or None,
        "operacao": ic.get("cOperacao") or None,
        "dt_inc": ic.get("dInc") or None,
        "hr_inc": ic.get("hInc") or None,
        "user_inc": ic.get("cUsuarioInc") or None,
        "dt_alt": ic.get("dAlt") or None,
        "hr_alt": ic.get("hAlt") or None,
        "user_alt": ic.get("cUsuarioAlt") or None,
        "total_nfe": to_float(t.get("vTotalNFe")),
        "total_produtos": to_float(t.get("vTotalProdutos")),
        "vlr_frete": to_float(t.get("vFrete")),
        "vlr_desconto": to_float(t.get("vDesconto")),
        "vlr_seguro": to_float(t.get("vSeguro")),
        "outras_despesas": to_float(t.get("vOutrasDespesas")),
        "vlr_icms": to_float(t.get("vICMS")),
        "icms_st": to_float(t.get("vICMSST")),
        "vlr_ipi": to_float(t.get("vIPI")),
        "vlr_pis": to_float(t.get("vPIS")),
        "vlr_cofins": to_float(t.get("vCOFINS")),
        "cod_parcela": parc.get("cCodParcela") or None,
        "qtd_parcela": to_float(parc.get("nQtdParcela")),
        "categ_compra": ia.get("cCategCompra") or None,
        "id_conta": to_int(ia.get("nIdConta")),
        "dt_registro": ia.get("dRegistro") or None,
        "id_projeto": to_int(ia.get("nIdProjeto")),
        "id_pedido": n_id_pedido,
        "num_pedido": c_num_pedido,
        "id_item_pedido": n_id_item_ped,
        "tem_vinculo": tem_vinculo,
    }


def importar_empresa(sigla: str):
    inicio = time.time()
    dt_ini, dt_fim = _calcular_periodo()
    print(f"\n-> {sigla} | Recebimento NFe | Periodo: {dt_ini} a {dt_fim}")

    # Endpoint uses nPagina / nRegistrosPorPagina
    items = fetch_omie_paginated(
        url=OMIE_URL,
        call="ListarRecebimentos",
        sigla=sigla,
        list_field="recebimentos",
        page_size=100,
        page_key="nPagina",
        size_key="nRegistrosPorPagina",
        extra_param={
            "cExibirDetalhes": "S",
            "dtEmissaoDe": dt_ini,
            "dtEmissaoAte": dt_fim,
        },
        label="Recebimentos",
    )

    if not items:
        print(f"   {sigla}: nenhum registro")
        update_sync_state(f"recebimento_nfe_{sigla}", sigla, 0, modo="FULL")
        return 0

    rows = [map_recebimento_to_row(r, sigla) for r in items]
    rows = [r for r in rows if r["id_receb"]]

    n = supa_upsert(SCHEMA, TABELA, rows, PK)
    elapsed = int(time.time() - inicio)
    update_sync_state(f"recebimento_nfe_{sigla}", sigla, n, modo="FULL", duracao_segundos=elapsed)

    print(f"   {sigla}: {len(items)} recebimentos -> {n} rows em {elapsed}s")
    return n


def main():
    print("=" * 63)
    print("Import Recebimento NFe -- Omie -> Supabase")
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
                update_sync_state(f"recebimento_nfe_{sigla}", sigla, 0, modo="ERRO",
                                  status="ERRO", erro=str(e)[:500])
            except Exception:
                pass

    elapsed = int(time.time() - inicio_geral)
    print()
    print("=" * 63)
    print(f"GERAL concluido em {elapsed}s | Total: {total} rows")
    print("=" * 63)

    trigger_sheets_mirror("RecebimentoNFe")

    if houve_erro:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrompido")
        sys.exit(130)

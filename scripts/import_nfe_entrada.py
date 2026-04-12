#!/usr/bin/env python3
"""
==========================================================================
IMPORT NFE ENTRADA -- Omie -> Supabase
Endpoint: /contador/xml/ListarDocumentos
Tabela:   orders.nfe_entrada
Freq:     Diaria
Volume:   Variavel (depende do periodo)
==========================================================================
"""
import os
import re
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, PAUSA_ENTRE_CHAMADAS,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror
)

OMIE_URL = "https://app.omie.com.br/api/v1/contador/xml/"
MODULO = "nfe_entrada"
SCHEMA = "orders"
TABELA = "nfe_entrada"
PK = "empresa,id_nf"

# Meses para buscar retroativamente (padrao 24)
MESES_RETROAGIR = int(os.environ.get("MESES_RETROAGIR", "24"))


def _extrair_pedido_do_xml(xml: str) -> str:
    """Extrai numero do pedido do XML embutido na resposta Omie."""
    if not xml:
        return None
    xml = xml.replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", '"')
    match = re.search(r"<xPed>(\d+)</xPed>", xml)
    return match.group(1) if match else None


def _calcular_periodo():
    """Retorna (dEmiInicial, dEmiFinal) no formato dd/MM/yyyy."""
    from datetime import datetime, timedelta
    hoje = datetime.now()
    dt_ini = datetime(hoje.year, hoje.month, 1)
    for _ in range(MESES_RETROAGIR):
        dt_ini = (dt_ini - timedelta(days=1)).replace(day=1)
    return dt_ini.strftime("%d/%m/%Y"), hoje.strftime("%d/%m/%Y")


def map_nfe_to_row(d: dict, sigla: str) -> dict:
    pedido_xml = _extrair_pedido_do_xml(d.get("cXml"))
    return {
        "empresa": sigla,
        "numero": d.get("nNumero") or None,
        "serie": d.get("cSerie") or None,
        "chave_acesso": d.get("nChave") or None,
        "emissao": d.get("dEmissao") or None,
        "hora": d.get("hEmissao") or None,
        "valor": to_float(d.get("nValor")),
        "status": d.get("cStatus") or None,
        "id_nf": to_int(d.get("nIdNF")),
        "id_pedido": to_int(d.get("nIdPedido")),
        "id_receb": to_int(d.get("nIdReceb")),
        "pedido_xml": pedido_xml,
    }


def importar_empresa(sigla: str):
    inicio = time.time()
    dt_ini, dt_fim = _calcular_periodo()
    print(f"\n-> {sigla} | NFe Entrada | Periodo: {dt_ini} a {dt_fim}")

    # Endpoint usa nPagina / nRegPorPagina
    items = fetch_omie_paginated(
        url=OMIE_URL,
        call="ListarDocumentos",
        sigla=sigla,
        list_field="documentosEncontrados",
        page_size=100,
        page_key="nPagina",
        size_key="nRegPorPagina",
        extra_param={
            "cModelo": "55",
            "cOperacao": "0",
            "dEmiInicial": dt_ini,
            "dEmiFinal": dt_fim,
        },
        label="NFe",
    )

    if not items:
        print(f"   {sigla}: nenhum registro")
        update_sync_state(f"nfe_entrada_{sigla}", sigla, 0, modo="FULL")
        return 0

    rows = [map_nfe_to_row(d, sigla) for d in items]
    rows = [r for r in rows if r["id_nf"]]

    n = supa_upsert(SCHEMA, TABELA, rows, PK)
    update_sync_state(f"nfe_entrada_{sigla}", sigla, n, modo="FULL")

    elapsed = int(time.time() - inicio)
    print(f"   {sigla}: {len(items)} docs -> {n} rows em {elapsed}s")
    return n


def main():
    print("=" * 63)
    print("Import NFe Entrada -- Omie -> Supabase")
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
                update_sync_state(f"nfe_entrada_{sigla}", sigla, 0, modo="ERRO",
                                  status="ERRO", erro=str(e)[:500])
            except Exception:
                pass

    elapsed = int(time.time() - inicio_geral)
    print()
    print("=" * 63)
    print(f"GERAL concluido em {elapsed}s | Total: {total} rows")
    print("=" * 63)

    trigger_sheets_mirror("NFeEntrada")

    if houve_erro:
        sys.exit(1)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\nInterrompido")
        sys.exit(130)

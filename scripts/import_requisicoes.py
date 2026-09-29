#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
📋 IMPORT REQUISIÇÕES DE COMPRA — Omie → Supabase
Endpoint: /produtos/requisicaocompra/ (PesquisarReq)
Tabela:   orders.requisicoes_compra
Uso:      alimenta o vínculo RC ↔ PV/OS no painel (rc_numero)
═════════════════════════════════════════════════════════════════════════════
"""
import json
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int,
)

OMIE_URL = "https://app.omie.com.br/api/v1/produtos/requisicaocompra/"


def br_to_iso(s):
    if not s or not isinstance(s, str) or len(s) != 10:
        return None
    try:
        dd, mm, yy = s.split("/")
        return f"{yy}-{mm}-{dd}"
    except ValueError:
        return None


def map_req(r: dict, sigla: str):
    cab = r.get("cabecalho") or r  # tolera resposta plana ou com cabeçalho
    itens = r.get("ItensReqCompra") or cab.get("ItensReqCompra") or []
    return {
        "empresa": sigla,
        "cod_req": to_int(cab.get("codReqCompra")),
        "cod_int": cab.get("codIntReqCompra") or None,
        # Campo "numero" explícito não aparece na doc — se existir em alguma
        # variação (nNumReq/numeroReq), captura; senão fica null e usamos cod_req.
        "numero": str(cab.get("nNumReq") or cab.get("numeroReq") or "") or None,
        "dt_sugestao": br_to_iso(cab.get("dtSugestao")),
        "cod_categ": cab.get("codCateg") or None,
        "etapa": str(cab.get("cEtapa") or cab.get("etapa") or "") or None,
        "obs": cab.get("obsReqCompra") or None,
        "obs_int": cab.get("obsIntReqCompra") or None,
        "qtde_itens": len(itens) if isinstance(itens, list) else None,
        "itens": json.dumps(itens, ensure_ascii=False),
        "raw": json.dumps(r, ensure_ascii=False),
    }


def importar(sigla: str):
    print(f"\n▶️  {sigla} | Requisições de compra (FULL)")
    items = fetch_omie_paginated(
        url=OMIE_URL, call="PesquisarReq", sigla=sigla,
        list_field="requisicaoCadastro", page_size=100,
        extra_param={"ordenar_por": "CODIGO"},
        label="ReqCompra",
    )
    rows = [r for r in (map_req(i, sigla) for i in items) if r["cod_req"]]
    if rows:
        supa_upsert("orders", "requisicoes_compra", rows, "empresa,cod_req")
    print(f"   ✅ {sigla}: {len(rows)} requisições")
    return len(rows)


def main():
    total = 0
    falhas = []
    for sigla in EMPRESAS_ALVO:
        try:
            n = importar(sigla)
            total += n
            update_sync_state("requisicoes_compra", sigla, n)
        except Exception as e:
            print(f"   ❌ {sigla}: {e}")
            falhas.append(sigla)
        time.sleep(1)
    print(f"\n🏁 Requisições: {total}" + (f" | FALHAS: {', '.join(falhas)}" if falhas else ""))
    if falhas:
        sys.exit(1)


if __name__ == "__main__":
    main()

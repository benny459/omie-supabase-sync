#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🧾 IMPORT NFs EMITIDAS — Omie → Supabase
NF-e de saída:  /produtos/nfconsultar/ ListarNF (tpNF=1)  → sales.nfe_saida
NFS-e:          /servicos/nfse/ ListarNFSEs                → sales.nfse_saida
Guarda colunas-chave + o objeto RAW inteiro (jsonb) — a base fica com tudo.
═════════════════════════════════════════════════════════════════════════════
"""
import json
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float,
)


def br_to_iso(s):
    if not s or not isinstance(s, str) or len(s) != 10:
        return None
    try:
        dd, mm, yy = s.split("/")
        return f"{yy}-{mm}-{dd}"
    except ValueError:
        return None


def g(d, *path, default=None):
    cur = d
    for k in path:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(k)
    return cur if cur is not None else default


def map_nfe(n: dict, sigla: str):
    return {
        "empresa": sigla,
        "id_nf": to_int(g(n, "compl", "nIdNF")) or to_int(g(n, "nIdNF")),
        "chave_nfe": g(n, "compl", "cChaveNFe") or g(n, "cChaveNFe"),
        "numero": str(g(n, "ide", "nNF", default="") or g(n, "ide", "cNumeroNFe", default="") or "") or None,
        "serie": str(g(n, "ide", "serie", default="") or g(n, "ide", "cSerie", default="") or "") or None,
        "emissao": br_to_iso(g(n, "ide", "dEmi") or g(n, "ide", "dEmissao")),
        "cliente_nome": g(n, "nfDestInt", "cNome") or g(n, "dest", "xNome"),
        "cliente_cnpj": g(n, "nfDestInt", "cnpj_cpf") or g(n, "dest", "CNPJ") or g(n, "dest", "CPF"),
        "valor_total": to_float(g(n, "total", "ICMSTot", "vNF")),
        "cancelada": bool(g(n, "infoCancelada") or str(g(n, "ide", "cancelada", default="")).upper() == "S"),
        "num_pedido": str(g(n, "pedido", "cNumPedido", default="") or "") or None,
        "raw": json.dumps(n, ensure_ascii=False),
    }


def map_nfse(n: dict, sigla: str):
    cab = n.get("Cabecalho") or {}
    num = cab.get("nNumeroNFSe") or cab.get("cNumeroNFSe") or g(n, "RPS", "nNumeroNFSe")
    return {
        "empresa": sigla,
        "id_nfse": to_int(cab.get("nCodNF")),
        "numero": str(num) if num not in (None, "", 0) else None,
        "emissao": br_to_iso(g(n, "Emissao", "cDataEmissao")),
        "cliente_nome": cab.get("cRazaoDestinatario"),
        "cliente_cnpj": cab.get("cCNPJDestinatario"),
        "valor_total": to_float(cab.get("nValorNFSe") or g(n, "Valores", "nValorTotalServicos")),
        "cancelada": bool(g(n, "Cancelamento", "cDataCancelamento")) or str(cab.get("cStatusNFSe", "")).upper() == "C",
        "numero_os": str(g(n, "OrdemServico", "nNumeroOS") or "") or None,
        "raw": json.dumps(n, ensure_ascii=False),
    }


def importar_nfe(sigla: str):
    print(f"\n▶️  {sigla} | NF-e de saída (FULL)")
    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/produtos/nfconsultar/",
        call="ListarNF", sigla=sigla,
        list_field="nfCadastro", page_size=100,
        extra_param={"tpNF": 1, "ordenar_por": "CODIGO"},
        label="NF-e",
    )
    rows = [r for r in (map_nfe(i, sigla) for i in items) if r["id_nf"]]
    if rows:
        supa_upsert("sales", "nfe_saida", rows, "empresa,id_nf")
    print(f"   ✅ {sigla}: {len(rows)} NF-e")
    return len(rows)


def importar_nfse(sigla: str):
    print(f"\n▶️  {sigla} | NFS-e emitidas")
    try:
        items = fetch_omie_paginated(
            url="https://app.omie.com.br/api/v1/servicos/nfse/",
            call="ListarNFSEs", sigla=sigla,
            list_field="nfseEncontradas", page_size=100,
            page_key="nPagina", size_key="nRegPorPagina",
            label="NFS-e",
        )
    except Exception as e:
        print(f"   ⚠️ NFS-e indisponível neste layout ({e}) — segue sem")
        return 0
    if items:
        amostra = {k: (sorted(v.keys()) if isinstance(v, dict) else type(v).__name__) for k, v in items[0].items()}
        print(f"   🔎 estrutura: {json.dumps(amostra, ensure_ascii=False)}")
    rows = [r for r in (map_nfse(i, sigla) for i in items) if r["id_nfse"]]
    if rows:
        supa_upsert("sales", "nfse_saida", rows, "empresa,id_nfse")
    print(f"   ✅ {sigla}: {len(rows)} NFS-e")
    return len(rows)


def main():
    total = 0
    falhas = []
    for sigla in EMPRESAS_ALVO:
        n = 0
        try:
            n += importar_nfe(sigla)
        except Exception as e:
            print(f"   ❌ {sigla} NF-e: {e}")
            falhas.append(f"{sigla}/nfe")
        time.sleep(1)
        try:
            n += importar_nfse(sigla)
        except Exception as e:
            print(f"   ❌ {sigla} NFS-e: {e}")
            falhas.append(f"{sigla}/nfse")
        total += n
        try:
            update_sync_state("nfs_saida", sigla, n)
        except Exception:
            pass
        time.sleep(1)
    print(f"\n🏁 NFs: {total}" + (f" | FALHAS: {', '.join(falhas)}" if falhas else ""))
    if falhas:
        sys.exit(1)


if __name__ == "__main__":
    main()

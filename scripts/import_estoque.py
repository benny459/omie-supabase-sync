#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
📦 IMPORT ESTOQUE — Omie → Supabase
Endpoint: /estoque/consulta/ (ListarPosEstoque + ListarMovimentoEstoque)
Tabelas:  estoque.posicao, estoque.movimentos
Freq:     Diária (movimentos janela de N dias) + posição do dia
Env:      ESTOQUE_DIAS_JANELA (default 40) | ESTOQUE_FULL=1 → desde 01/01/2024
═════════════════════════════════════════════════════════════════════════════
"""
import os
import sys
import time
from datetime import date, timedelta

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float,
)

OMIE_URL = "https://app.omie.com.br/api/v1/estoque/consulta/"
SCHEMA = "estoque"


def br(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def br_to_iso(s):
    """dd/mm/yyyy → yyyy-mm-dd (ou None)."""
    if not s or not isinstance(s, str) or len(s) != 10:
        return None
    try:
        dd, mm, yy = s.split("/")
        return f"{yy}-{mm}-{dd}"
    except ValueError:
        return None


def map_posicao(p: dict, sigla: str, data_pos: date):
    return {
        "empresa": sigla,
        "n_cod_prod": to_int(p.get("nCodProd")),
        "codigo_local_estoque": to_int(p.get("codigo_local_estoque")) or 0,
        "codigo": p.get("cCodigo") or None,
        "descricao": p.get("cDescricao") or None,
        "saldo": to_float(p.get("nSaldo")),
        "fisico": to_float(p.get("fisico")),
        "reservado": to_float(p.get("reservado")),
        "pendente": to_float(p.get("nPendente")),
        "cmc": to_float(p.get("nCMC")),
        "preco_unitario": to_float(p.get("nPrecoUnitario")),
        "estoque_minimo": to_float(p.get("estoque_minimo")),
        "data_posicao": data_pos.isoformat(),
    }


def map_movimento(m: dict, sigla: str):
    return {
        "empresa": sigla,
        "id_mov": to_int(m.get("idMov")),
        "id_prod": to_int(m.get("idProd")),
        "dt_mov": br_to_iso(m.get("dtMov")),
        "dt_emissao": br_to_iso(m.get("dtEmissao")),
        "cod_origem": m.get("codOrigem") or None,
        "des_origem": m.get("desOrigem") or None,
        "operacao": str(m.get("operacao")) if m.get("operacao") is not None else None,
        "tipo": m.get("tipo") or None,
        "num_doc": m.get("numDoc") or None,
        "num_pedido": str(m.get("numPedido")) if m.get("numPedido") else None,
        "qtde": to_float(m.get("qtde")),
        "valor": to_float(m.get("valor")),
        "saldo": to_float(m.get("saldo")),
        "cmc": to_float(m.get("cmc")),
        "descricao": m.get("descricao") or None,
        "codigo_local_estoque": to_int(m.get("codigo_local_estoque")),
        "cancelamento": str(m.get("cancelamento")) if m.get("cancelamento") is not None else None,
        "devolucao": str(m.get("devolucao")) if m.get("devolucao") is not None else None,
        "id_doc": to_int(m.get("idDoc")),
        "id_pedido": to_int(m.get("idPedido")),
        "id_recebimento": to_int(m.get("idRecebimento")),
    }


def importar_posicao(sigla: str):
    hoje = date.today()
    print(f"\n▶️  {sigla} | Posição de estoque em {br(hoje)}")
    items = fetch_omie_paginated(
        url=OMIE_URL, call="ListarPosEstoque", sigla=sigla,
        list_field="produtos", page_size=500,
        page_key="nPagina", size_key="nRegPorPagina",
        extra_param={"dDataPosicao": br(hoje), "cExibeTodos": "N", "lista_local_estoque": "TODOS"},
        label="PosEstoque",
    )
    rows = [r for r in (map_posicao(p, sigla, hoje) for p in items) if r["n_cod_prod"]]
    if rows:
        supa_upsert(SCHEMA, "posicao", rows, "empresa,n_cod_prod,codigo_local_estoque")
    print(f"   ✅ {sigla}: {len(rows)} produtos na posição")
    return len(rows)


def importar_movimentos(sigla: str, dt_ini: date, dt_fim: date):
    print(f"\n▶️  {sigla} | Movimentos {br(dt_ini)} → {br(dt_fim)}")
    items = fetch_omie_paginated(
        url=OMIE_URL, call="ListarMovimentoEstoque", sigla=sigla,
        list_field="movProdutoListar", page_size=500,
        page_key="nPagina", size_key="nRegPorPagina",
        extra_param={"dDtInicial": br(dt_ini), "dDtFinal": br(dt_fim), "lista_local_estoque": "TODOS"},
        label="MovEstoque",
    )
    rows = [r for r in (map_movimento(m, sigla) for m in items) if r["id_mov"]]
    if rows:
        supa_upsert(SCHEMA, "movimentos", rows, "empresa,id_mov")
    print(f"   ✅ {sigla}: {len(rows)} movimentos")
    return len(rows)


def main():
    full = os.environ.get("ESTOQUE_FULL", "") == "1"
    janela = int(os.environ.get("ESTOQUE_DIAS_JANELA", "40"))
    hoje = date.today()
    dt_ini = date(2024, 1, 1) if full else hoje - timedelta(days=janela)

    total_pos = total_mov = 0
    falhas = []
    for sigla in EMPRESAS_ALVO:
        n_pos = n_mov = 0
        try:
            n_pos = importar_posicao(sigla)
            total_pos += n_pos
        except Exception as e:
            print(f"   ❌ {sigla} posição: {e}")
            falhas.append(f"{sigla}/posicao")
        time.sleep(1)
        try:
            n_mov = importar_movimentos(sigla, dt_ini, hoje)
            total_mov += n_mov
        except Exception as e:
            print(f"   ❌ {sigla} movimentos: {e}")
            falhas.append(f"{sigla}/movimentos")
        time.sleep(1)
        try:
            update_sync_state("estoque", sigla, n_pos + n_mov,
                              modo="FULL" if full else f"JANELA_{janela}D",
                              status="ERRO" if any(f.startswith(sigla) for f in falhas) else "SUCESSO")
        except Exception as e:
            print(f"   (sync_state indisponível: {e})")

    print(f"\n🏁 Estoque: {total_pos} posições, {total_mov} movimentos"
          + (f" | FALHAS: {', '.join(falhas)}" if falhas else ""))
    if falhas:
        sys.exit(1)


if __name__ == "__main__":
    main()

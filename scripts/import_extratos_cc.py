#!/usr/bin/env python3
"""
Extratos de Conta Corrente -- Omie -> Supabase
Endpoints:
  - /geral/contacorrente/   | ListarContasCorrentes  (get list of accounts)
  - /financas/extrato/      | ListarExtrato          (get movements per account)
Tabela:   finance.extratos_cc
Freq:     Diaria

ATENCAO sobre paginacao do ListarExtrato:
  O endpoint NAO aceita nPagina/nRegPorPagina (responde "Tag [NPAGINA] não faz
  parte da estrutura"). Mas silenciosamente LIMITA a 50 movimentos por call.
  Comprovado em 2026-05-12 com Bradesco-Safe: 01-11/05 retornava 50 movs
  com ultimo em 04/05 -- todos os manuais conciliados de 08-11/05 sumiam.

  Workaround: chamamos em JANELAS de WINDOW_DAYS (default 7). Se uma janela
  retorna >=50 movs, SUBDIVIDIMOS recursivamente (split por data) ate caber.
  Dedup posterior por (empresa, cod_cc, cod_lancamento) absorve overlap.
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
EXTRATO_DATA_INICIO = env("EXTRATO_DATA_INICIO", "")  # override DD/MM/YYYY
EXTRATO_DIAS_BUSCA  = env("EXTRATO_DIAS_BUSCA", "")    # legado opcional
WINDOW_DAYS         = int(env("EXTRATO_WINDOW_DAYS", "30")) # janela base; subdivide adaptativamente em contas ativas
API_HARD_LIMIT      = 50  # Omie ListarExtrato corta silenciosamente em 50/call
MIN_WINDOW_DAYS     = 1   # nao subdivide alem de 1 dia (se mesmo assim vier 50, registra warning)


def _br_to_date(s: str) -> datetime:
    return datetime.strptime(s, "%d/%m/%Y")

def _date_to_br(d: datetime) -> str:
    return d.strftime("%d/%m/%Y")

def fetch_window_adaptive(sigla: str, cod_cc: int, dt_ini: datetime, dt_fim: datetime, depth: int = 0):
    """Chama ListarExtrato para janela [dt_ini, dt_fim]. Se a API retornar
    >=API_HARD_LIMIT movimentos (provavel corte silencioso), subdivide a janela
    ao meio e re-chama recursivamente. Retorna (lista_movimentos_agregada, cc_meta).

    Profundidade tipica: 2-3 niveis. Dedup posterior por PK absorve overlap."""
    di_str = _date_to_br(dt_ini); df_str = _date_to_br(dt_fim)
    indent = "    " + ("│ " * depth)
    try:
        data = fetch_omie(
            OMIE_URL_EXT, "ListarExtrato", sigla,
            {"nCodCC": cod_cc, "dPeriodoInicial": di_str, "dPeriodoFinal": df_str, "cExibirApenasSaldo": "N"}
        )
    except Exception as e:
        print(f"{indent}❌ {di_str}->{df_str} erro: {e}")
        return [], None

    if data.get("_empty_page"):
        return [], None

    movs = data.get("listaMovimentos") or []
    cc_meta = {
        "cDescricao": data.get("cDescricao"),
        "nCodBanco": data.get("nCodBanco"),
        "nCodAgencia": data.get("nCodAgencia"),
        "nNumConta": data.get("nNumConta"),
    }

    delta = (dt_fim - dt_ini).days
    # Hit no limite: subdivide se a janela ainda for divisivel
    if len(movs) >= API_HARD_LIMIT and delta > MIN_WINDOW_DAYS:
        mid = dt_ini + timedelta(days=delta // 2)
        print(f"{indent}⚠️  {di_str}->{df_str}: {len(movs)} movs (hit {API_HARD_LIMIT}) — subdividindo")
        movs_l, meta_l = fetch_window_adaptive(sigla, cod_cc, dt_ini, mid, depth + 1)
        movs_r, meta_r = fetch_window_adaptive(sigla, cod_cc, mid + timedelta(days=1), dt_fim, depth + 1)
        cc_meta = meta_l or meta_r or cc_meta
        return movs_l + movs_r, cc_meta

    if len(movs) >= API_HARD_LIMIT:
        # Janela ja eh 1 dia mas vem 50 — pode haver clipping real. Loga e segue.
        print(f"{indent}⚠️  {di_str}->{df_str}: {len(movs)} movs (>= limite e janela ja eh {delta} dia(s))")

    return movs, cc_meta


def calcular_dt_inicio(hoje: datetime) -> str:
    """Resolve data de inicio do extrato:
       1) EXTRATO_DATA_INICIO=DD/MM/YYYY (override absoluto, util pra backfill)
       2) EXTRATO_DIAS_BUSCA=N (legado: N dias atras)
       3) Default: 01/01 do ano corrente -> garante extrato sempre completo
          desde inicio do ano sem precisar tunar por env."""
    if EXTRATO_DATA_INICIO:
        return EXTRATO_DATA_INICIO
    if EXTRATO_DIAS_BUSCA:
        return (hoje - timedelta(days=int(EXTRATO_DIAS_BUSCA))).strftime("%d/%m/%Y")
    return f"01/01/{hoje.year}"


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
    dt_inicio_str = calcular_dt_inicio(hoje)
    dt_fim_str    = hoje.strftime("%d/%m/%Y")
    print(f"   Periodo: {dt_inicio_str} -> {dt_fim_str}")

    # Get bank accounts
    contas = obter_contas_correntes(sigla)
    print(f"   Contas correntes: {len(contas)}")

    if not contas:
        update_sync_state(f"extratos_cc_{sigla}", sigla, 0, modo="FULL")
        return 0

    # Itera por janelas de WINDOW_DAYS pra cada conta corrente. Cada janela é
    # adaptativa: se Omie retornar 50 movs (corte silencioso), subdivide.
    dt_ini_total = _br_to_date(dt_inicio_str)
    dt_fim_total = _br_to_date(dt_fim_str)
    janelas = []
    cur = dt_ini_total
    while cur <= dt_fim_total:
        nxt = min(cur + timedelta(days=WINDOW_DAYS - 1), dt_fim_total)
        janelas.append((cur, nxt))
        cur = nxt + timedelta(days=1)
    print(f"   Janelas: {len(janelas)} x {WINDOW_DAYS}d")

    all_rows = []
    for cc in contas:
        cod_cc = cc.get("nCodCC")
        if not cod_cc:
            continue
        cc_desc = cc.get("descricao", "?")
        cc_total = 0
        cc_meta = None
        for (jd_i, jd_f) in janelas:
            movs, meta = fetch_window_adaptive(sigla, cod_cc, jd_i, jd_f)
            if meta and not cc_meta:
                cc_meta = meta
            if not movs:
                continue
            cc_total += len(movs)
            for m in movs:
                row = map_row(m, sigla, cod_cc, cc_meta or {})
                if row["cod_lancamento"]:
                    all_rows.append(row)
        if cc_total > 0:
            print(f"   CC {cod_cc} ({cc_desc}): {cc_total} movimentos no total")

    if not all_rows:
        print(f"   {sigla}: nenhum movimento")
        update_sync_state(f"extratos_cc_{sigla}", sigla, 0, modo="FULL")
        return 0

    # Dedup por PK (empresa, cod_conta_corrente, cod_lancamento) — Omie as
    # vezes retorna o mesmo nCodLancamento em duas contas (ex: lancamento de
    # transferencia entre contas aparece em ambas). Sem isso o UPSERT estoura
    # com 21000 "ON CONFLICT DO UPDATE command cannot affect row a second time".
    dedup = {}
    for r in all_rows:
        key = (r["empresa"], r["cod_conta_corrente"], r["cod_lancamento"])
        dedup[key] = r
    deduped = list(dedup.values())
    if len(deduped) < len(all_rows):
        print(f"   Dedup: {len(all_rows)} -> {len(deduped)} (removidas {len(all_rows) - len(deduped)} duplicatas por PK)")

    total, inserted, updated, before, after = upsert_with_tracking(
        SCHEMA, TABELA, deduped, PK, empresa=sigla
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

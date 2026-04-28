#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🏆 IMPORT ETAPAS DE PEDIDOS — Omie → Supabase
Endpoint: /produtos/pedidoetapas/ListarEtapasPedido
Tabela:   sales.etapas_pedidos
Freq:     Diária / Semanal
Volume:   ~12k registros raw (5-6k após dedup)

═════════════════════════════════════════════════════════════════════════════
MODO via env var MAX_PAGINAS_ETAPAS:

  - MAX_PAGINAS_ETAPAS=20 (DIARIO) → pega só as ÚLTIMAS 20 páginas
    (~2.000 registros mais novos). API ordena por nCodPed ASC, então
    as últimas páginas trazem os pedidos com codigo mais alto = mais
    recentes. Análise da base mostra que 95%+ dos pedidos alterados
    nos últimos meses estão nas ~20 últimas páginas (de ~124 totais).
    Tempo: ~17s vs 100s do FULL.

  - MAX_PAGINAS_ETAPAS=0 ou ausente (SEMANAL/FULL) → pega todas as
    páginas. Garante que pedidos antigos reabertos sejam capturados.

A API ListarEtapasPedido não aceita filtro nativo por data alteração
(documentado no script anterior). Tail-by-page é a única estratégia
incremental viável.
═════════════════════════════════════════════════════════════════════════════
"""
import os
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, PAUSA_ENTRE_CHAMADAS,
    fetch_omie, supa_upsert, update_sync_state,
    to_int, trigger_sheets_mirror
)

# 0 ou ausente = pega todas as páginas (FULL).
# > 0 = limita às N últimas páginas (DIARIO captura apenas pedidos recentes).
MAX_PAGINAS = int(os.environ.get("MAX_PAGINAS_ETAPAS", "0") or "0")

OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedidoetapas/"
MODULO = "etapas_pedidos"
SCHEMA = "sales"
TABELA = "etapas_pedidos"
PK = "empresa,codigo_pedido"

def map_etapa_to_row(e: dict, sigla: str):
    fat = e.get("faturamento") or {}
    canc = e.get("cancelamento") or {}
    dev = e.get("devolucao") or {}
    info = e.get("info") or {}
    return {
        "empresa": sigla,
        "codigo_pedido": to_int(e.get("nCodPed")),
        "cod_int_pedido": e.get("cCodIntPed") or None,
        "numero": e.get("cNumero") or None,
        "etapa": e.get("cEtapa") or None,
        "dt_etapa": e.get("dDtEtapa") or None,
        "hr_etapa": e.get("cHrEtapa") or None,
        "user_etapa": e.get("cUsEtapa") or None,
        "faturado": fat.get("cFaturado") or None,
        "dt_fat": fat.get("dDtFat") or None,
        "hr_fat": fat.get("cHrFat") or None,
        "autorizado": fat.get("cAutorizado") or None,
        "denegado": fat.get("cDenegado") or None,
        "chave_nfe": fat.get("cChaveNFE") or None,
        "num_nfe": fat.get("cNumNFE") or None,
        "serie_nfe": fat.get("cSerieNFE") or None,
        "dt_saida": fat.get("dDtSaida") or None,
        "hr_saida": fat.get("cHrSaida") or None,
        "ambiente": fat.get("cAmbiente") or None,
        "cancelado": canc.get("cCancelado") or None,
        "dt_canc": canc.get("dDtCanc") or None,
        "hr_canc": canc.get("cHrCanc") or None,
        "user_canc": canc.get("cUsCanc") or None,
        "devolvido": dev.get("cDevolvido") or None,
        "dt_dev": dev.get("dDtDev") or None,
        "hr_dev": dev.get("cHrDev") or None,
        "user_dev": dev.get("cUsDev") or None,
        "d_inc": info.get("dInc") or None,
        "h_inc": info.get("hInc") or None,
        "u_inc": info.get("uInc") or None,
        "d_alt": info.get("dAlt") or None,
        "h_alt": info.get("hAlt") or None,
        "u_alt": info.get("uAlt") or None,
        "imp_api": e.get("cImpAPI") or None,
    }

PAGE_SIZE = 500

def fetch_etapas(sigla: str, max_paginas: int):
    """
    Paginação custom com 2 modos:
    - max_paginas == 0 → FULL: pega todas as páginas (ASC, página 1 até o fim)
    - max_paginas > 0 → TAIL: pega só as últimas N páginas (descobre total na 1ª chamada)

    Retorna lista de items.
    """
    # 1ª chamada SEMPRE em página 1 pra descobrir total_de_paginas
    print(f"   ⬇️  {sigla} | Etapas pág 1 (descobrindo total)...", end=" ", flush=True)
    first = fetch_omie(OMIE_URL, "ListarEtapasPedido", sigla,
                       {"nPagina": 1, "nRegPorPagina": PAGE_SIZE})
    if first.get("_empty_page"):
        print("nada.")
        return []
    items_p1 = first.get("etapasPedido") or []
    if not items_p1:
        print("vazio.")
        return []
    tot_pag = first.get("total_de_paginas") or first.get("nTotPaginas") or 0
    tot_reg = first.get("total_de_registros") or "?"
    try: tot_pag = int(tot_pag)
    except (TypeError, ValueError): tot_pag = 0
    print(f"{len(items_p1)} regs (total: {tot_pag} pgs / {tot_reg} regs)")

    # Decide range de páginas
    if max_paginas > 0 and tot_pag > 0:
        # TAIL: páginas (tot_pag - max_paginas + 1) até tot_pag
        start_page = max(1, tot_pag - max_paginas + 1)
        end_page = tot_pag
        print(f"   ✋ Modo TAIL: pegando páginas {start_page}–{end_page} de {tot_pag} (últimas {end_page - start_page + 1})")
        # Página 1 já foi puxada; só usa se cair no range
        all_items = list(items_p1) if 1 >= start_page else []
        first_to_fetch = max(start_page, 2)
    else:
        # FULL: usa página 1 e itera o resto
        print(f"   📜 Modo FULL: pegando todas as {tot_pag or '?'} páginas")
        start_page = 1
        end_page = tot_pag if tot_pag > 0 else 999  # safety cap
        all_items = list(items_p1)
        first_to_fetch = 2

    for p in range(first_to_fetch, end_page + 1):
        time.sleep(PAUSA_ENTRE_CHAMADAS)
        print(f"   ⬇️  {sigla} | Etapas pág {p}/{end_page}...", end=" ", flush=True)
        data = fetch_omie(OMIE_URL, "ListarEtapasPedido", sigla,
                          {"nPagina": p, "nRegPorPagina": PAGE_SIZE})
        if data.get("_empty_page"):
            print("fim.")
            break
        chunk = data.get("etapasPedido") or []
        if not chunk:
            print("vazio, fim.")
            break
        all_items.extend(chunk)
        print(f"{len(chunk)} regs (acum: {len(all_items)})")

    return all_items

def importar_empresa(sigla: str):
    inicio = time.time()
    modo_label = f"DIARIO (últimas {MAX_PAGINAS} pgs / ~{MAX_PAGINAS*PAGE_SIZE} regs novos)" if MAX_PAGINAS > 0 else "FULL"
    print(f"\n▶️  {sigla} | Etapas de Pedidos | {modo_label}")

    items = fetch_etapas(sigla, MAX_PAGINAS)

    if not items:
        print(f"   📭 {sigla}: nenhum registro")
        update_sync_state(f"etapas_pedidos_{sigla}", sigla, 0,
                          modo="DIARIO" if MAX_PAGINAS > 0 else "FULL")
        return 0

    rows = [map_etapa_to_row(e, sigla) for e in items]
    rows = [r for r in rows if r["codigo_pedido"]]  # skipa rows sem PK
    count_raw = len(rows)

    # 🔧 DEDUP: A API retorna múltiplas entradas por pedido (histórico de etapas).
    # Mantemos 1 row por (empresa, codigo_pedido) — a ÚLTIMA vista na paginação
    # (tipicamente a mais recente). Se quisermos guardar histórico completo,
    # aí precisamos mudar a PK pra incluir dt_etapa+hr_etapa.
    dedup = {}
    for r in rows:
        key = (r["empresa"], r["codigo_pedido"])
        dedup[key] = r  # sobrescreve — última vence
    rows = list(dedup.values())
    print(f"   🔧 Dedup: {count_raw} rows brutos → {len(rows)} pedidos únicos")

    maior_d_alt = ""
    maior_h_alt = ""
    for r in rows:
        if r.get("d_alt") and r["d_alt"] > maior_d_alt:
            maior_d_alt = r["d_alt"]
            maior_h_alt = r.get("h_alt") or ""

    n = supa_upsert(SCHEMA, TABELA, rows, PK)
    elapsed = int(time.time() - inicio)
    modo = "DIARIO" if MAX_PAGINAS > 0 else "FULL"
    update_sync_state(f"etapas_pedidos_{sigla}", sigla, n,
                      maior_d_alt=maior_d_alt, maior_h_alt=maior_h_alt,
                      modo=modo, duracao_segundos=elapsed)

    print(f"   ✅ {sigla}: {len(items)} items → {n} rows em {elapsed}s ({modo})")
    return n

def main():
    print("═══════════════════════════════════════════════════════════════")
    print("🏆 Import Etapas de Pedidos — Omie → Supabase")
    if MAX_PAGINAS > 0:
        print(f"📅 Modo: DIARIO (últimas {MAX_PAGINAS} pgs ≈ {MAX_PAGINAS*PAGE_SIZE} regs novos)")
    else:
        print("📜 Modo: FULL (todas as páginas)")
    print("═══════════════════════════════════════════════════════════════")
    print(f"🎯 Empresas: {', '.join(EMPRESAS_ALVO)}")

    inicio_geral = time.time()
    total = 0
    houve_erro = False

    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"⚠️ {sigla}: credenciais não configuradas — pulando")
            continue
        try:
            total += importar_empresa(sigla)
        except Exception as e:
            houve_erro = True
            print(f"❌ Erro em {sigla}: {e}")
            try:
                update_sync_state(f"etapas_pedidos_{sigla}", sigla, 0, modo="ERRO",
                                  status="ERRO", erro=str(e)[:500])
            except Exception:
                pass

    elapsed = int(time.time() - inicio_geral)
    print()
    print("═══════════════════════════════════════════════════════════════")
    print(f"✅ GERAL concluído em {elapsed}s | Total: {total} rows")
    print("═══════════════════════════════════════════════════════════════")

    trigger_sheets_mirror("EtapasPedidos")

    if houve_erro:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n⚠️ Interrompido")
        sys.exit(130)

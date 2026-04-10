#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🏆 IMPORT ETAPAS DE PEDIDOS — Omie → Supabase
Endpoint: /produtos/pedidoetapas/ListarEtapasPedido
Tabela:   sales.etapas_pedidos
Freq:     Diária
Volume:   3000-5000 registros
═════════════════════════════════════════════════════════════════════════════
"""
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, PAUSA_ENTRE_CHAMADAS,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, trigger_sheets_mirror
)

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

def importar_empresa(sigla: str):
    inicio = time.time()
    print(f"\n▶️  {sigla} | Etapas de Pedidos | FULL (estado atual de todos os pedidos)")

    # Etapas não tem filtro de data nativo — faz FULL sempre.
    # O UPSERT garante idempotência.
    items = fetch_omie_paginated(
        url=OMIE_URL,
        call="ListarEtapasPedido",
        sigla=sigla,
        list_field="etapasPedido",
        page_size=100,
        page_key="nPagina",
        size_key="nRegPorPagina",
        label="Etapas",
    )

    if not items:
        print(f"   📭 {sigla}: nenhum registro")
        update_sync_state(f"etapas_pedidos_{sigla}", sigla, 0, modo="FULL")
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
    update_sync_state(f"etapas_pedidos_{sigla}", sigla, n,
                      maior_d_alt=maior_d_alt, maior_h_alt=maior_h_alt, modo="FULL")

    elapsed = int(time.time() - inicio)
    print(f"   ✅ {sigla}: {len(items)} items → {n} rows em {elapsed}s")
    return n

def main():
    print("═══════════════════════════════════════════════════════════════")
    print("🏆 Import Etapas de Pedidos — Omie → Supabase")
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

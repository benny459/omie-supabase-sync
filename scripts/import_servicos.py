#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🏆 IMPORT SERVIÇOS — Omie → Supabase
Dois endpoints:
  1. /servicos/os/ListarOS            → sales.ordens_servico
  2. /servicos/contrato/ListarContratos → sales.contratos_servico
Freq:     Diária
Volume:   600-1200 OS/dia
═════════════════════════════════════════════════════════════════════════════
"""
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE,
    fetch_omie_paginated, supa_upsert, update_sync_state,
    to_int, to_float, trigger_sheets_mirror
)

SCHEMA = "sales"

# ══════════════════════════════════════════════════════════════════════════
# 1. ORDENS DE SERVIÇO
# ══════════════════════════════════════════════════════════════════════════

def map_os_rows(item: dict, sigla: str):
    """Uma OS pode ter múltiplos serviços — retorna lista de rows."""
    cab = item.get("Cabecalho") or {}
    info = item.get("InfoCadastro") or {}
    add = item.get("InformacoesAdicionais") or {}
    servicos = item.get("ServicosPrestados") or []

    def build_row(seq_idx, s=None):
        s = s or {}
        imp = s.get("impostos") or {}
        return {
            "empresa": sigla,
            "codigo_os": str(cab.get("nCodOS")) if cab.get("nCodOS") else None,
            "seq_item": to_int(s.get("nSeqItem")) if s.get("nSeqItem") else seq_idx,

            "numero_os": cab.get("cNumOS") or None,
            "codigo_cliente": str(cab.get("nCodCli")) if cab.get("nCodCli") else None,
            "dt_previsao": cab.get("dDtPrevisao") or None,
            "valor_total": to_float(cab.get("nValorTotal")),
            "etapa": cab.get("cEtapa") or None,
            "codigo_categoria": add.get("cCodCateg") or None,
            "codigo_projeto": str(add.get("nCodProj")) if add.get("nCodProj") else None,
            "codigo_cc": str(add.get("nCodCC")) if add.get("nCodCC") else None,
            "codigo_parcela": cab.get("cCodParc") or None,
            "qtd_parcelas": str(cab.get("nQtdeParc")) if cab.get("nQtdeParc") else None,
            "faturada": info.get("cFaturada") or None,
            "cancelada": info.get("cCancelada") or None,
            "d_inc": info.get("dDtInc") or None,
            "dt_fat": info.get("dDtFat") or None,

            "codigo_servico": str(s.get("nCodServico")) if s.get("nCodServico") else None,
            "descricao_servico": s.get("cDescServ") or None,
            "quantidade": to_float(s.get("nQtde")),
            "valor_unitario": to_float(s.get("nValUnit")),
            "trib_servico": s.get("cTribServ") or None,
            "retem_iss": s.get("cRetemISS") or None,
            "aliq_iss": to_float(imp.get("nAliqISS")),
            "valor_iss": to_float(imp.get("nValorISS")),
            "retem_inss": imp.get("cRetemINSS") or None,
            "valor_inss": to_float(imp.get("nValorINSS")),

            "codigo_vendedor": str(cab.get("nCodVend")) if cab.get("nCodVend") else None,
            "num_recibo": add.get("cNumRecibo") or None,
        }

    if not servicos:
        # OS sem serviços prestados → 1 row com seq_item=0
        return [build_row(0)]
    return [build_row(i + 1, s) for i, s in enumerate(servicos)]

def importar_ordens_servico(sigla: str):
    inicio = time.time()
    print(f"\n▶️  {sigla} | Ordens de Serviço")

    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/servicos/os/",
        call="ListarOS",
        sigla=sigla,
        list_field="osCadastro",
        page_size=200,  # subiu de 50 → 200 (OS tem payload grande, mas 200 é seguro)
        extra_param={"apenas_importado_api": "N"},
        label="OS",
    )

    if not items:
        update_sync_state(f"ordens_servico_{sigla}", sigla, 0, modo="FULL")
        return 0

    all_rows = []
    for item in items:
        all_rows.extend(map_os_rows(item, sigla))
    all_rows = [r for r in all_rows if r["codigo_os"]]

    # Dedup por PK (empresa, codigo_os, seq_item)
    dedup = {}
    for r in all_rows:
        key = (r["empresa"], r["codigo_os"], r["seq_item"])
        dedup[key] = r
    rows = list(dedup.values())
    print(f"   🔧 Dedup: {len(all_rows)} → {len(rows)} rows únicos")

    n = supa_upsert(SCHEMA, "ordens_servico", rows, "empresa,codigo_os,seq_item")
    elapsed = int(time.time() - inicio)
    update_sync_state(f"ordens_servico_{sigla}", sigla, n, modo="FULL", duracao_segundos=elapsed)

    print(f"   ✅ {sigla} OS: {len(items)} OS → {n} rows em {elapsed}s")
    return n

# ══════════════════════════════════════════════════════════════════════════
# 2. CONTRATOS DE SERVIÇO
# ══════════════════════════════════════════════════════════════════════════

def map_contrato_rows(item: dict, sigla: str):
    cab = item.get("cabecalho") or {}
    add = item.get("infAdic") or {}
    itens = item.get("itensContrato") or []

    def build_row(seq_idx, it=None):
        it = it or {}
        c = it.get("itemCabecalho") or {}
        d = it.get("itemDescrServ") or {}
        i = it.get("itemImpostos") or {}
        return {
            "empresa": sigla,
            "codigo_contrato": str(cab.get("nCodCtr")) if cab.get("nCodCtr") else None,
            "seq": to_int(c.get("seq")) if c.get("seq") else seq_idx,

            "numero_contrato": cab.get("cNumCtr") or None,
            "codigo_cliente": str(cab.get("nCodCli")) if cab.get("nCodCli") else None,
            "situacao": cab.get("cCodSit") or None,
            "vig_inicial": cab.get("dVigInicial") or None,
            "vig_final": cab.get("dVigFinal") or None,
            "tipo_faturamento": cab.get("cTipoFat") or None,
            "dia_faturamento": str(cab.get("nDiaFat")) if cab.get("nDiaFat") else None,
            "vlr_tot_mes": to_float(cab.get("nValTotMes")),
            "codigo_categoria": add.get("cCodCateg") or None,
            "codigo_cc": str(add.get("nCodCC")) if add.get("nCodCC") else None,
            "codigo_projeto": str(add.get("nCodProj")) if add.get("nCodProj") else None,

            "codigo_servico": str(c.get("codServico")) if c.get("codServico") else None,
            "quantidade": to_float(c.get("quant")),
            "valor_unitario": to_float(c.get("valorUnit")),
            "valor_total": to_float(c.get("valorTotal")),
            "cod_lc116": c.get("codLC116") or None,
            "cod_serv_munic": c.get("codServMunic") or None,
            "descricao_completa": d.get("descrCompleta") or None,
            "aliq_iss": to_float(i.get("aliqISS")),
            "valor_iss": to_float(i.get("valorISS")),
            "retem_iss": i.get("retISS") or None,
        }

    if not itens:
        return [build_row(0)]
    return [build_row(idx + 1, it) for idx, it in enumerate(itens)]

def importar_contratos(sigla: str):
    inicio = time.time()
    print(f"\n▶️  {sigla} | Contratos de Serviço")

    items = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/servicos/contrato/",
        call="ListarContratos",
        sigla=sigla,
        list_field="contratoCadastro",
        page_size=200,  # subiu de 50 → 200
        extra_param={"apenas_importado_api": "N"},
        label="Contratos",
    )

    if not items:
        update_sync_state(f"contratos_servico_{sigla}", sigla, 0, modo="FULL")
        return 0

    all_rows = []
    for item in items:
        all_rows.extend(map_contrato_rows(item, sigla))
    all_rows = [r for r in all_rows if r["codigo_contrato"]]

    dedup = {}
    for r in all_rows:
        key = (r["empresa"], r["codigo_contrato"], r["seq"])
        dedup[key] = r
    rows = list(dedup.values())

    n = supa_upsert(SCHEMA, "contratos_servico", rows, "empresa,codigo_contrato,seq")
    elapsed = int(time.time() - inicio)
    update_sync_state(f"contratos_servico_{sigla}", sigla, n, modo="FULL", duracao_segundos=elapsed)

    print(f"   ✅ {sigla} Contratos: {len(items)} → {n} rows em {elapsed}s")
    return n

# ══════════════════════════════════════════════════════════════════════════
# MAIN
# ══════════════════════════════════════════════════════════════════════════

def main():
    print("═══════════════════════════════════════════════════════════════")
    print("🏆 Import Serviços (OS + Contratos) — Omie → Supabase")
    print("═══════════════════════════════════════════════════════════════")
    print(f"🎯 Empresas: {', '.join(EMPRESAS_ALVO)}")

    inicio_geral = time.time()
    total = 0
    houve_erro = False

    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"⚠️ {sigla}: credenciais ausentes — pulando")
            continue
        try:
            total += importar_ordens_servico(sigla)
        except Exception as e:
            houve_erro = True
            print(f"❌ OS {sigla}: {e}")
            try:
                update_sync_state(f"ordens_servico_{sigla}", sigla, 0, modo="ERRO",
                                  status="ERRO", erro=str(e)[:500])
            except Exception:
                pass
        try:
            total += importar_contratos(sigla)
        except Exception as e:
            houve_erro = True
            print(f"❌ Contratos {sigla}: {e}")
            try:
                update_sync_state(f"contratos_servico_{sigla}", sigla, 0, modo="ERRO",
                                  status="ERRO", erro=str(e)[:500])
            except Exception:
                pass

    elapsed = int(time.time() - inicio_geral)
    print()
    print("═══════════════════════════════════════════════════════════════")
    print(f"✅ GERAL concluído em {elapsed}s | Total: {total} rows")
    print("═══════════════════════════════════════════════════════════════")

    trigger_sheets_mirror("OrdensServico")
    trigger_sheets_mirror("ContratosServico")

    if houve_erro:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n⚠️ Interrompido")
        sys.exit(130)

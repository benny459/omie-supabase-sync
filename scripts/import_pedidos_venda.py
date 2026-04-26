#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
🏆 IMPORT PEDIDOS VENDA — Omie → Supabase
Endpoint: /produtos/pedido/ListarPedidos (mesmo de ItensVendidos, mas mapeia o CABEÇALHO)
Tabela:   sales.pedidos_venda  (1 linha por pedido, não por item)
Freq:     Diária
Volume:   150-500 registros
═════════════════════════════════════════════════════════════════════════════
"""
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, EMPRESAS_OMIE, env,
    fetch_omie_paginated, supa_upsert, update_sync_state, get_last_d_alt,
    to_int, to_float, trigger_sheets_mirror
)

OMIE_URL = "https://app.omie.com.br/api/v1/produtos/pedido/"
SCHEMA = "sales"
TABELA = "pedidos_venda"
PK = "empresa,codigo_pedido"
DATA_INICIO_FULL = env("DATA_INICIO_FULL", "01/01/2025")
FORCAR_FULL = env("FORCAR_FULL", "false").lower() == "true"

def map_pedido_to_row(p: dict, sigla: str):
    cab = p.get("cabecalho") or {}
    info = p.get("infoCadastro") or {}
    total = p.get("total_pedido") or {}
    frete = p.get("frete") or {}
    add = p.get("informacoes_adicionais") or {}

    return {
        "empresa": sigla,
        "codigo_pedido": to_int(cab.get("codigo_pedido")),
        "cod_pedido_integracao": cab.get("codigo_pedido_integracao") or None,
        "numero_pedido": cab.get("numero_pedido") or None,
        "codigo_cliente": to_int(cab.get("codigo_cliente")),
        "data_previsao": cab.get("data_previsao") or None,
        "etapa": cab.get("etapa") or None,
        "codigo_parcela": str(cab.get("codigo_parcela")) if cab.get("codigo_parcela") else None,
        "qtde_parcelas": to_float(cab.get("qtde_parcelas")),
        "origem_pedido": cab.get("origem_pedido") or None,

        "valor_total": to_float(total.get("valor_total_pedido")),
        "quantidade_itens": to_float(total.get("quantidade_itens")),
        "valor_mercadorias": to_float(total.get("valor_mercadorias")),
        "valor_desconto": to_float(total.get("valor_desconto")),
        "valor_frete": to_float(total.get("valor_frete")),
        "valor_icms": to_float(total.get("valor_icms")),
        "valor_pis": to_float(total.get("valor_pis")),
        "valor_cofins": to_float(total.get("valor_cofins")),
        "base_icms_st": to_float(total.get("base_icms_st")),
        "valor_icms_st": to_float(total.get("valor_icms_st")),
        "valor_ipi": to_float(total.get("valor_ipi")),

        "cod_transportadora": str(frete.get("codigo_transportadora")) if frete.get("codigo_transportadora") else None,
        "modalidade": frete.get("modalidade") or None,
        "volumes": str(frete.get("quantidade_volumes")) if frete.get("quantidade_volumes") else None,
        "peso_bruto": str(frete.get("peso_bruto")) if frete.get("peso_bruto") else None,
        "peso_liquido": str(frete.get("peso_liquido")) if frete.get("peso_liquido") else None,

        "codigo_categoria": add.get("codigo_categoria") or None,
        "codigo_conta": add.get("codigo_conta_corrente") or None,
        "num_pedido_cliente": add.get("numero_pedido_cliente") or None,
        "contato": add.get("contato") or None,
        "consumidor_final": add.get("consumidor_final") or None,
        "email": add.get("enviar_email") or None,
        "codigo_vendedor": add.get("codVend") or None,
        "codigo_projeto": add.get("codProj") or None,
        "dados_adicionais_nf": add.get("dados_adicionais_nf") or None,

        "d_inc": info.get("dInc") or None,
        "h_inc": info.get("hInc") or None,
        "u_inc": info.get("uInc") or None,
        "d_alt": info.get("dAlt") or None,
        "h_alt": info.get("hAlt") or None,
        "u_alt": info.get("uAlt") or None,
    }

def importar_empresa(sigla: str):
    inicio = time.time()

    # Modo FULL vs INCREMENTAL
    ultimo_dalt = None
    modo = "FULL"
    filtro_data = DATA_INICIO_FULL
    if not FORCAR_FULL:
        ultimo_dalt = get_last_d_alt(f"pedidos_venda_{sigla}")
        if ultimo_dalt:
            modo = "INCREMENTAL"
            filtro_data = ultimo_dalt

    print(f"\n▶️  {sigla} | Pedidos Venda | Modo: {modo} | Filtro: {filtro_data}")

    items = fetch_omie_paginated(
        url=OMIE_URL,
        call="ListarPedidos",
        sigla=sigla,
        list_field="pedido_venda_produto",
        page_size=100,
        extra_param={
            "apenas_importado_api": "N",
            "filtrar_por_data_de": filtro_data,
        },
        label="Pedidos",
    )

    if not items:
        print(f"   📭 {sigla}: nenhum registro")
        update_sync_state(f"pedidos_venda_{sigla}", sigla, 0, modo=modo)
        return 0

    rows = [map_pedido_to_row(p, sigla) for p in items]
    rows = [r for r in rows if r["codigo_pedido"]]

    maior_d_alt = ultimo_dalt or ""
    maior_h_alt = ""
    for r in rows:
        if r.get("d_alt") and r["d_alt"] > maior_d_alt:
            maior_d_alt = r["d_alt"]
            maior_h_alt = r.get("h_alt") or ""

    n = supa_upsert(SCHEMA, TABELA, rows, PK)
    elapsed = int(time.time() - inicio)
    update_sync_state(f"pedidos_venda_{sigla}", sigla, n,
                      maior_d_alt=maior_d_alt, maior_h_alt=maior_h_alt,
                      modo=modo, duracao_segundos=elapsed)

    print(f"   ✅ {sigla}: {len(items)} pedidos → {n} rows em {elapsed}s ({modo})")
    return n

def main():
    print("═══════════════════════════════════════════════════════════════")
    print("🏆 Import Pedidos Venda — Omie → Supabase")
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
                update_sync_state(f"pedidos_venda_{sigla}", sigla, 0, modo="ERRO",
                                  status="ERRO", erro=str(e)[:500])
            except Exception:
                pass

    elapsed = int(time.time() - inicio_geral)
    print()
    print("═══════════════════════════════════════════════════════════════")
    print(f"✅ GERAL concluído em {elapsed}s | Total: {total} rows")
    print("═══════════════════════════════════════════════════════════════")

    trigger_sheets_mirror("PedidosVenda")

    if houve_erro:
        sys.exit(1)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n⚠️ Interrompido")
        sys.exit(130)

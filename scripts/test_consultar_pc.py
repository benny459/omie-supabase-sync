#!/usr/bin/env python3
"""
Compara o que vem do Omie via PesquisarPedCompra (sumário) vs
ConsultarPedCompra (detalhado) pra um PC específico.

Hipótese: PesquisarPedCompra omite campos importantes (valor, fornecedor,
itens) e precisa-se de ConsultarPedCompra pra trazer tudo.

Uso (env):
    PC_NUMEROS=6593,6597,6605 (default)
"""
import json
import os
import sys
import time
import urllib.request

EMPRESA = "SF"
APP_KEY = os.environ.get(f"OMIE_APP_KEY_{EMPRESA}", "")
APP_SECRET = os.environ.get(f"OMIE_APP_SECRET_{EMPRESA}", "")
URL = "https://app.omie.com.br/api/v1/produtos/pedidocompra/"
PCS = [s.strip() for s in os.environ.get("PC_NUMEROS", "6593,6597,6605").split(",")]


def call(call_name: str, param: dict):
    payload = {"call": call_name, "app_key": APP_KEY, "app_secret": APP_SECRET, "param": [param]}
    try:
        req = urllib.request.Request(URL, data=json.dumps(payload).encode("utf-8"),
                                      headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=60) as resp:
            return json.loads(resp.read().decode("utf-8")), None
    except Exception as e:
        return None, str(e)


print("=" * 70)
print(f"🧪 TESTE Omie ConsultarPedCompra vs PesquisarPedCompra — empresa {EMPRESA}")
print("=" * 70)

for pc_num in PCS:
    print(f"\n{'═' * 70}")
    print(f"PC: {pc_num}")
    print(f"{'═' * 70}")

    # 1. PesquisarPedCompra (sumário) — testa se retorna esse PC específico
    print("\n[1] PesquisarPedCompra (sumário)")
    pesq, err = call("PesquisarPedCompra", {
        "nPagina": 1, "nRegsPorPagina": 100,
        "lExibirPedidosPendentes":  "S",
        "lExibirPedidosFaturados":  "S",
        "lExibirPedidosCancelados": "S",
        "lExibirPedidosRecebidos":  "S",
        "lExibirPedidosEncerrados": "S",
    })
    if err:
        print(f"   ❌ {err}")
        continue
    items = pesq.get("pedidos_pesquisa") or []
    found = next((p for p in items if (p.get("cabecalho_consulta") or {}).get("cNumero") == pc_num), None)
    if not found:
        print(f"   ⚠ PC {pc_num} não está nos primeiros 100 itens — buscar em mais páginas?")
        # Tenta achar pelos números mais próximos
        for it in items[:3]:
            cab = it.get("cabecalho_consulta") or {}
            print(f"   amostra: cNumero={cab.get('cNumero')} cEtapa={cab.get('cEtapa')} nTotalPedido={cab.get('nTotalPedido')} nCodFor={cab.get('nCodFor')}")
    else:
        cab = found.get("cabecalho_consulta") or {}
        prods = found.get("produtos_consulta") or []
        print(f"   cabecalho_consulta:")
        for k in ["nCodPed", "cNumero", "cEtapa", "nCodFor", "cContato", "nTotalPedido", "dDtPrevisao"]:
            print(f"      {k}: {cab.get(k)}")
        print(f"   produtos_consulta: {len(prods)} item(s)")
        for i, p in enumerate(prods[:2]):
            print(f"      [{i}] cProduto={p.get('cProduto')} nQtde={p.get('nQtde')} nValUnit={p.get('nValUnit')} nValTot={p.get('nValTot')}")

    # 2. ConsultarPedCompra (detalhado) — usando nCodPed
    if found:
        ncod_ped = (found.get("cabecalho_consulta") or {}).get("nCodPed")
        if ncod_ped:
            print(f"\n[2] ConsultarPedCompra (detalhado) — nCodPed={ncod_ped}")
            time.sleep(1)  # respeitar rate limit
            cons, err = call("ConsultarPedCompra", {"nCodPed": ncod_ped})
            if err:
                print(f"   ❌ {err}")
            else:
                cab = cons.get("cabecalho") or cons.get("cabecalho_consulta") or {}
                prods = cons.get("produtos") or cons.get("produtos_consulta") or []
                print(f"   cabecalho:")
                for k in ["nCodPed", "cNumero", "cEtapa", "nCodFor", "cContato", "nTotalPedido", "dDtPrevisao"]:
                    print(f"      {k}: {cab.get(k)}")
                print(f"   produtos: {len(prods)} item(s)")
                for i, p in enumerate(prods[:3]):
                    print(f"      [{i}] cProduto={p.get('cProduto')} nQtde={p.get('nQtde')} nValUnit={p.get('nValUnit')} nValTot={p.get('nValTot')}")
                if len(cons) > 0 and not prods:
                    print(f"   📋 Top-level keys: {list(cons.keys())[:10]}")

print("\n" + "=" * 70)
print("✅ Comparação concluída — se ConsultarPedCompra trouxer o que Pesquisar omite,")
print("   precisamos enriquecer o importer com 1 chamada extra por PC.")
print("=" * 70)

#!/usr/bin/env python3
"""Configura a empresa SAFE WATER na Focus NFe para EMITIR, convivendo com o
Omie (pedido do Benny, 02/10/2026): Simples Nacional; NF-e e NFS-e ligadas com
séries próprias que não colidem com as do Omie.

  Omie hoje:  NF-e série 1 (último nº 2192) · RPS séries "NFSE" e "900"
  Focus:      NF-e série 1, CONTINUANDO a sequência do Omie (decisão 02/10/2026):
              o painel consulta o último nº no Omie na hora e manda o próximo
              explícito; `proximo_numero` aqui é só o ponto de partida.
              Homologação fica na série 2 (ambiente separado da SEFAZ).
              NFS-e: o número da nota é da PREFEITURA (segue sozinho); o RPS
              da Focus usa série "2" para não repetir RPS do Omie.

Sem FOCUS_CONFIRMA=SIM só mostra antes → depois (não grava nada).
Nunca imprime tokens, senhas nem o certificado. Branch focus-faturamento."""
import json
import sys
sys.path.insert(0, "scripts")
from _common import env
from import_focus_recebidos import focus

CNPJ = "15766003000108"
ALVO = {
    "regime_tributario": 1,               # Simples Nacional (Omie: optante_simples_nacional = S)
    "habilita_nfe": True,
    "serie_nfe_producao": 1,
    "proximo_numero_nfe_producao": 2193,   # Omie: última NF-e série 1 = 2192 (01/10/2026)
    "serie_nfe_homologacao": 2,
    "proximo_numero_nfe_homologacao": 1,
    "habilita_nfse": True,                # Barueri — provedor BarueriWs (certificado)
    "serie_nfse_producao": "2",
    "proximo_numero_nfse_producao": 1,
    "serie_nfse_homologacao": "2",
    "proximo_numero_nfse_homologacao": 1,
}
SENSIVEL = ("token", "senha", "certificado_base64", "arquivo_certificado", "csc")


def atual(master):
    st, data, _ = focus(master, "GET", f"/v2/empresas?cnpj={CNPJ}")
    lista = data if isinstance(data, list) else [data]
    if st != 200 or not lista or not isinstance(lista[0], dict):
        raise SystemExit(f"GET empresas → HTTP {st}: {str(data)[:300]}")
    return lista[0]


def main():
    master = env("FOCUS_TOKEN_MASTER")
    if not master:
        raise SystemExit("sem FOCUS_TOKEN_MASTER")
    emp = atual(master)
    print(f"Empresa id={emp.get('id')} {emp.get('nome')} ({emp.get('municipio')}/{emp.get('uf')})")
    mudar = {k: v for k, v in ALVO.items() if str(emp.get(k)) != str(v)}
    for k, v in ALVO.items():
        marca = "→ MUDA" if k in mudar else "  ok"
        print(f"  {marca}  {k}: {emp.get(k)!r} → {v!r}")
    if not mudar:
        print("Nada a mudar.")
        return
    if (env("FOCUS_CONFIRMA") or "").upper() != "SIM":
        print("\nSimulação — nada gravado. Rode com FOCUS_CONFIRMA=SIM para aplicar.")
        return
    st, data, _ = focus(master, "PUT", f"/v2/empresas/{emp['id']}", mudar)
    print(f"\nPUT /v2/empresas/{emp['id']} → HTTP {st}")
    if st not in (200, 201):
        print(f"   corpo: {json.dumps(data, ensure_ascii=False)[:600] if isinstance(data, (dict, list)) else str(data)[:600]}")
        raise SystemExit(1)
    depois = atual(master)
    print("Depois:")
    for k in ALVO:
        print(f"   {k} = {depois.get(k)!r}")
    falhou = [k for k, v in ALVO.items() if str(depois.get(k)) != str(v)]
    if falhou:
        print(f"⚠️ não ficaram como pedido: {falhou}")
        raise SystemExit(1)
    print("✅ Focus configurada.")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Diagnóstico da Focus NFe — só leitura. Mostra a configuração da empresa
(flags de manifestação, certificado) e testa as listagens de recebidos.
Nunca imprime tokens, senhas nem o certificado."""
import sys
sys.path.insert(0, "scripts")
from _common import env
from import_focus_recebidos import focus, EMPRESAS

SENSIVEL = ("token", "senha", "arquivo_certificado", "certificado_base64", "csc")


def mostrar_empresa(master, cnpj):
    st, data, _ = focus(master, "GET", f"/v2/empresas?cnpj={cnpj}")
    print(f"GET /v2/empresas?cnpj={cnpj} → HTTP {st}")
    lista = data if isinstance(data, list) else ([data] if isinstance(data, dict) else [])
    if not lista:
        print(f"   corpo: {str(data)[:400]}")
    for e in lista:
        for k in sorted(e):
            if any(s in k for s in SENSIVEL):
                continue
            v = e[k]
            if isinstance(v, (dict, list)):
                v = str(v)[:120]
            print(f"   {k} = {v}")


def testar(token, cnpj):
    for path in (f"/v2/nfes_recebidas?cnpj={cnpj}",
                 f"/v2/nfes_recebidas?cnpj={cnpj}&versao=0",
                 f"/v2/nfes_recebidas?cnpj={cnpj}&versao=1",
                 f"/v2/ctes_recebidas?cnpj={cnpj}",
                 f"/v2/nfsens_recebidas?cnpj={cnpj}"):
        st, data, hdr = focus(token, "GET", path)
        n = len(data) if isinstance(data, list) else "-"
        hs = {k: v for k, v in hdr.items() if k.lower().startswith("x-")}
        print(f"GET {path} → HTTP {st}, itens={n}, headers={hs}")
        if not isinstance(data, list):
            print(f"   corpo: {str(data)[:400]}")


master = env("FOCUS_TOKEN_MASTER")
for sigla, cnpj in EMPRESAS.items():
    print(f"\n===== {sigla} {cnpj}")
    if master:
        mostrar_empresa(master, cnpj)
    else:
        print("sem FOCUS_TOKEN_MASTER")
    tok = env(f"FOCUS_TOKEN_{sigla}")
    if tok:
        testar(tok, cnpj)
        for chave in (env("FOCUS_CHAVES") or "").split(","):
            if chave.strip():
                st, data, _ = focus(tok, "GET", f"/v2/nfes_recebidas/{chave.strip()}.json")
                print(f"GET /v2/nfes_recebidas/{chave.strip()}.json → HTTP {st}: {str(data)[:300]}")
    else:
        print(f"sem FOCUS_TOKEN_{sigla}")

#!/usr/bin/env python3
"""
NF-e SF — referência para a virada Omie → Focus (05/10/2026). SÓ LEITURA.

1. Omie (ListarNF, filtro por data): última NF-e emitida pela SF, por série —
   inclusive as que o espelho (sales.nfe_saida) ainda não tem.
2. Omie (ConsultarNF + dfedocs/ObterNfe): detalhe e XML das N NF-e mais
   recentes, gravados em saida/ para o diff com o montador do painel.
3. Focus (conta master, só GET /v2/empresas): habilitação de NF-e em produção
   e validade do certificado A1 da SF. Tokens nunca são impressos.

Nada é escrito no Omie nem na Focus.
"""
import base64
import json
import os
import sys
import urllib.request
from datetime import date, timedelta

sys.path.insert(0, "scripts")
from _common import fetch_omie  # noqa: E402

SAIDA = "saida"
os.makedirs(SAIDA, exist_ok=True)
N = int(os.environ.get("NFE_REF_N", "8"))
URL_NF = "https://app.omie.com.br/api/v1/produtos/nfconsultar/"
URL_DFE = "https://app.omie.com.br/api/v1/produtos/dfedocs/"


def br(d: date) -> str:
    return d.strftime("%d/%m/%Y")


def ultimas_omie():
    ini = date.today() - timedelta(days=20)
    notas, pag = [], 1
    while True:
        r = fetch_omie(URL_NF, "ListarNF", "SF", {
            "pagina": pag, "registros_por_pagina": 100, "apenas_importado_api": "N",
            "ordenar_por": "CODIGO", "tpNF": "1", "dEmiInicial": br(ini), "dEmiFinal": br(date.today() + timedelta(days=1)),
        })
        notas += r.get("nfCadastro") or []
        if pag >= int(r.get("total_de_paginas") or 1):
            break
        pag += 1
    resumo = {}
    for n in notas:
        ide = n.get("ide") or {}
        if str(ide.get("mod")) != "55":
            continue
        s, num = str(ide.get("serie")), int(str(ide.get("nNF") or "0") or 0)
        x = resumo.setdefault(s, {"max": 0, "qtd": 0, "ultima_emissao": None})
        x["qtd"] += 1
        if num > x["max"]:
            x["max"], x["ultima_emissao"] = num, ide.get("dEmi")
    print("Omie — NF-e modelo 55 da SF nos últimos 20 dias, por série:", json.dumps(resumo, ensure_ascii=False))
    notas.sort(key=lambda n: int(str((n.get("ide") or {}).get("nNF") or "0") or 0), reverse=True)
    return notas, resumo


def detalhes(notas):
    for n in notas[:N]:
        nid = (n.get("compl") or {}).get("nIdNF")
        num = (n.get("ide") or {}).get("nNF")
        try:
            det = fetch_omie(URL_NF, "ConsultarNF", "SF", {"nIdNF": nid})
            with open(f"{SAIDA}/nf_{num}_consulta.json", "w") as f:
                json.dump(det, f, ensure_ascii=False, indent=1)
        except Exception as e:  # noqa: BLE001
            print(f"ConsultarNF {num}: {e}")
        try:
            x = fetch_omie(URL_DFE, "ObterNfe", "SF", {"nIdNfe": nid})
            xml = x.get("cXmlNfe") or ""
            if xml:
                with open(f"{SAIDA}/nf_{num}.xml", "w") as f:
                    f.write(xml)
            print(f"NF {num}: consulta ok, xml {'ok' if xml else 'vazio'}")
        except Exception as e:  # noqa: BLE001
            print(f"ObterNfe {num}: {e}")


def focus():
    tok = os.environ.get("FOCUS_TOKEN_MASTER")
    if not tok:
        print("Focus: FOCUS_TOKEN_MASTER ausente")
        return
    req = urllib.request.Request("https://api.focusnfe.com.br/v2/empresas?cnpj=15766003000108",
                                 headers={"Authorization": "Basic " + base64.b64encode(f"{tok}:".encode()).decode()})
    with urllib.request.urlopen(req, timeout=30) as r:
        d = json.loads(r.read())
    e = d[0] if isinstance(d, list) else d
    seguro = {k: v for k, v in e.items() if "token" not in k.lower() and "senha" not in k.lower() and "certificado_base64" not in k}
    with open(f"{SAIDA}/focus_empresa_sf.json", "w") as f:
        json.dump(seguro, f, ensure_ascii=False, indent=1)
    campos = [k for k in seguro if any(p in k for p in ("habilita", "certificado", "regime", "serie", "proximo", "numero", "csc", "nfe"))]
    print("Focus empresa SF:", json.dumps({k: seguro[k] for k in campos}, ensure_ascii=False))
    print("Focus: token_producao presente =", bool(e.get("token_producao")), "| token_homologacao presente =", bool(e.get("token_homologacao")))


if __name__ == "__main__":
    notas, resumo = ultimas_omie()
    with open(f"{SAIDA}/resumo_series.json", "w") as f:
        json.dump(resumo, f)
    detalhes(notas)
    focus()

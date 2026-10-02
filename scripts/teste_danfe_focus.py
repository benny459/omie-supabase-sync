#!/usr/bin/env python3
"""DANFE pela Focus para comparar com a do Omie — SEM VALOR FISCAL.

Pega o XML de uma NF-e do Omie (padrão: 2172, Scania), converte para o JSON da
Focus e gera a DANFE:
  1) pré-visualização (POST /v2/nfe/danfe — não emite nada), se existir;
  2) senão, emite no AMBIENTE DE HOMOLOGAÇÃO da SEFAZ (homologacao.focusnfe.com.br,
     série 2 de homologação) — nunca em produção.
Salva em out/: o JSON enviado, a resposta e o PDF. Não imprime tokens.
Branch focus-faturamento (02/10/2026)."""
import base64
import html
import json
import os
import sys
import time
import urllib.error
import urllib.request

sys.path.insert(0, "scripts")
from _common import env, fetch_omie
from import_focus_recebidos import focus
from omie_xml_para_focus import converter

NID = int(env("NID_OMIE") or 12585589469)       # NF-e 2172 (25/09/2026)
CNPJ = "15766003000108"
OUT = "out"
os.makedirs(OUT, exist_ok=True)


def req(host, token, method, path, body=None, binario=False):
    auth = base64.b64encode(f"{token}:".encode()).decode()
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(f"{host}{path}", data=data, method=method,
                               headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(r, timeout=90) as resp:
            raw = resp.read()
            return resp.status, raw if binario else raw.decode("utf-8", "replace"), dict(resp.headers)
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode("utf-8", "replace"), dict(e.headers)


def xml_omie():
    r = fetch_omie("https://app.omie.com.br/api/v1/produtos/dfedocs/", "ObterNfe", "SF", {"nIdNfe": NID})
    xml = (r.get("cXmlNfe") or "").strip()
    if xml.startswith("http"):
        xml = urllib.request.urlopen(xml, timeout=30).read().decode("utf-8", "replace")
    elif xml.startswith("&lt;"):
        xml = html.unescape(xml)
    return xml.lstrip("﻿"), r.get("cPdf")


def main():
    xml, pdf_omie = xml_omie()
    nfe = converter(xml)
    with open(f"{OUT}/nfe_focus.json", "w") as f:
        json.dump(nfe, f, ensure_ascii=False, indent=2)
    print(f"JSON montado: {len(nfe['items'])} item(ns), total {nfe.get('valor_total')}, destinatário {nfe.get('nome_destinatario')}")
    if pdf_omie:
        urllib.request.urlretrieve(pdf_omie, f"{OUT}/danfe_omie.pdf")

    tok = env("FOCUS_TOKEN_SF")
    # 1) pré-visualização, sem emitir
    st, corpo, hdr = req("https://api.focusnfe.com.br", tok, "POST", "/v2/nfe/danfe", nfe, binario=True)
    print(f"POST /v2/nfe/danfe → HTTP {st} ({hdr.get('Content-Type')})")
    if st == 200 and "pdf" in (hdr.get("Content-Type") or ""):
        open(f"{OUT}/danfe_focus_previa.pdf", "wb").write(corpo)
        print("✅ DANFE de pré-visualização salva (nada foi emitido).")
        return
    print(f"   {corpo[:300] if isinstance(corpo, str) else corpo[:300].decode('utf-8', 'replace')}")

    # 2) homologação
    st, emp, _ = focus(env("FOCUS_TOKEN_MASTER"), "GET", f"/v2/empresas?cnpj={CNPJ}")
    emp = emp[0] if isinstance(emp, list) else emp
    tok_h = emp.get("token_homologacao")
    if not tok_h:
        raise SystemExit("sem token de homologação na empresa")
    host = "https://homologacao.focusnfe.com.br"
    ref = f"teste-danfe-{NID}-{int(time.time())}"
    st, corpo, _ = req(host, tok_h, "POST", f"/v2/nfe?ref={ref}", nfe)
    print(f"HOMOLOGAÇÃO POST /v2/nfe?ref={ref} → HTTP {st}: {corpo[:400]}")
    for _ in range(30):
        time.sleep(4)
        st, corpo, _ = req(host, tok_h, "GET", f"/v2/nfe/{ref}")
        d = json.loads(corpo) if corpo.strip().startswith("{") else {}
        if d.get("status") not in (None, "processando_autorizacao"):
            break
    open(f"{OUT}/resposta_homologacao.json", "w").write(corpo)
    print(f"status: {d.get('status')} | {d.get('status_sefaz')} {d.get('mensagem_sefaz')}")
    for e in d.get("erros", []) or []:
        print(f"   erro: {e}")
    if d.get("caminho_danfe"):
        st, pdf, _ = req(host, tok_h, "GET", d["caminho_danfe"], binario=True)
        if st != 200 and d["caminho_danfe"].startswith("http"):
            pdf = urllib.request.urlopen(d["caminho_danfe"], timeout=60).read()
        open(f"{OUT}/danfe_focus_homologacao.pdf", "wb").write(pdf)
        print(f"✅ DANFE de homologação salva (série {d.get('serie')} nº {d.get('numero')}, sem valor fiscal).")


if __name__ == "__main__":
    main()

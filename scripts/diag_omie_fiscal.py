#!/usr/bin/env python3
"""Diagnóstico fiscal do Omie (SÓ LEITURA) — o que precisamos para emitir pela
Focus igual ao Omie: cadastro da empresa (regime), o XML de uma NF-e por CFOP
(CSOSN/CST, IBS/CBS, informações complementares) e o cadastro de serviços
(LC116, código municipal, ISS). Nunca imprime chaves, senhas ou certificado.

Branch focus-faturamento (02/10/2026)."""
import base64
import html
import sys
import urllib.request
import xml.etree.ElementTree as ET
sys.path.insert(0, "scripts")
from _common import fetch_omie

SIGLA = "SF"
SENSIVEL = ("senha", "token", "secret", "key", "certificado", "csc")
# Uma NF-e recente de cada CFOP usado em 12 meses (nIdNF do espelho sales.nfe_saida).
NOTAS = {
    "5.102": 12586551511, "6.102": 12585880527, "5.949": 12575311906, "6.949": 12585868989,
    "5.202": 12578956506, "5.915": 12575337316, "6.915": 12571405768, "5.411": 12564604684,
    "6.556": 12569113595,
}
NS = {"n": "http://www.portalfiscal.inf.br/nfe"}


def limpo(d, prof=0):
    if isinstance(d, dict):
        return {k: limpo(v, prof + 1) for k, v in d.items() if not any(s in k.lower() for s in SENSIVEL)}
    if isinstance(d, list):
        return [limpo(x, prof + 1) for x in d[:3]]
    return d


def empresa():
    print("\n===== EMPRESA (geral/empresas ListarEmpresas)")
    r = fetch_omie("https://app.omie.com.br/api/v1/geral/empresas/", "ListarEmpresas", SIGLA,
                   {"pagina": 1, "registros_por_pagina": 50, "apenas_importado_api": "N"})
    for e in r.get("empresas_cadastro", []):
        for k, v in sorted(limpo(e).items()):
            print(f"   {k} = {str(v)[:160]}")


def texto(el, caminho):
    x = el.find(caminho, NS)
    return x.text if x is not None else ""


def grupo_imposto(det, nome):
    g = det.find(f"n:imposto/n:{nome}", NS)
    if g is None:
        return "-"
    sub = list(g)[0] if len(list(g)) else g
    campos = {c.tag.split("}")[1]: c.text for c in sub if c.text}
    return f"{sub.tag.split('}')[1]} {campos}"


def notas():
    for cfop, nid in NOTAS.items():
        print(f"\n===== NF-e CFOP {cfop} (nIdNF {nid})")
        try:
            r = fetch_omie("https://app.omie.com.br/api/v1/produtos/dfedocs/", "ObterNfe", SIGLA, {"nIdNfe": nid})
        except Exception as e:  # noqa: BLE001
            print(f"   erro: {e}")
            continue
        xml = (r.get("cXmlNfe") or "").strip()
        if not xml:
            print(f"   sem XML; chaves da resposta: {list(r)[:20]}")
            continue
        try:
            if xml.startswith("http"):
                xml = urllib.request.urlopen(xml, timeout=30).read().decode("utf-8", "replace")
            elif xml.startswith("&lt;"):
                xml = html.unescape(xml)
            elif not xml.lstrip("\ufeff").startswith("<"):
                xml = base64.b64decode(xml).decode("utf-8", "replace")
            xml = xml.lstrip("\ufeff")
            root = ET.fromstring(xml.encode("utf-8"))
        except Exception as e:  # noqa: BLE001
            print(f"   não consegui ler o XML ({e}); início: {xml[:160]!r}")
            continue
        inf = root.find(".//n:infNFe", NS)
        print(f"   natOp={texto(inf, 'n:ide/n:natOp')} serie={texto(inf, 'n:ide/n:serie')} nNF={texto(inf, 'n:ide/n:nNF')}"
              f" idDest={texto(inf, 'n:ide/n:idDest')} indFinal={texto(inf, 'n:ide/n:indFinal')} indPres={texto(inf, 'n:ide/n:indPres')}")
        print(f"   emit CRT={texto(inf, 'n:emit/n:CRT')} | dest UF={texto(inf, 'n:dest/n:enderDest/n:UF')} indIEDest={texto(inf, 'n:dest/n:indIEDest')}")
        for det in inf.findall("n:det", NS)[:3]:
            print(f"   item {det.get('nItem')}: CFOP={texto(det, 'n:prod/n:CFOP')} NCM={texto(det, 'n:prod/n:NCM')} uCom={texto(det, 'n:prod/n:uCom')}")
            for g in ("ICMS", "IPI", "PIS", "COFINS", "IBSCBS"):
                print(f"      {g}: {grupo_imposto(det, g)}")
        tot = inf.find("n:total", NS)
        print(f"   totais: {[c.tag.split('}')[1] for c in tot]}")
        print(f"   pag: {[ (texto(p, 'n:tPag'), texto(p, 'n:vPag')) for p in inf.findall('n:pag/n:detPag', NS)]}")
        print(f"   transp modFrete={texto(inf, 'n:transp/n:modFrete')}")
        print(f"   infCpl: {texto(inf, 'n:infAdic/n:infCpl')[:400]}")


def servicos():
    print("\n===== SERVIÇOS (servicos/servico ListarCadastroServico)")
    r = fetch_omie("https://app.omie.com.br/api/v1/servicos/servico/", "ListarCadastroServico", SIGLA,
                   {"nPagina": 1, "nRegPorPagina": 50})
    lista = r.get("cadastros") or r.get("cadastro") or []
    print(f"   {len(lista)} serviço(s); chaves: {list(r)[:10]}")
    for s in lista[:15]:
        print(f"   {limpo(s)}")


def documentos():
    """O que o Omie entrega de PDF: DANFE de uma NF-e e o recibo de uma OS."""
    print("\n===== DOCUMENTOS (PDF)")
    r = fetch_omie("https://app.omie.com.br/api/v1/produtos/dfedocs/", "ObterNfe", SIGLA, {"nIdNfe": NOTAS["5.102"]})
    print(f"   ObterNfe chaves: {sorted(r)}")
    for k, v in r.items():
        if k != "cXmlNfe":
            print(f"      {k} = {str(v)[:140]}")
    # Recibo de OS: tenta os métodos conhecidos da API de OS (só leitura).
    for call, param in (("ObterRecibo", {"nCodOS": 12586888580}), ("ConsultarOS", {"nCodOS": 12586888580})):
        try:
            r = fetch_omie("https://app.omie.com.br/api/v1/servicos/os/", call, SIGLA, param)
            print(f"   {call} chaves: {sorted(r)[:30]}")
            for k in ("InformacoesAdicionais", "Cabecalho", "Email", "Recibo", "cUrlRecibo", "cLinkRecibo"):
                if k in r:
                    print(f"      {k} = {str(limpo(r[k]))[:400]}")
        except Exception as e:  # noqa: BLE001
            print(f"   {call}: {str(e)[:200]}")


if __name__ == "__main__":
    if __import__("os").environ.get("SO_DOCUMENTOS"):
        documentos()
        raise SystemExit(0)
    empresa()
    notas()
    servicos()

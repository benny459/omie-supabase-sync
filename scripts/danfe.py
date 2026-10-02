#!/usr/bin/env python3
"""DANFE no desenho do Omie, gerada a partir do XML autorizado (nfeProc).

Decisão do Benny (02/10/2026): as NF-e emitidas pela Focus saem com a MESMA
DANFE que os clientes recebem hoje do Omie. Medidas, fontes (Courier base-14) e
caixas tiradas do PDF do Omie (NF-e 2172). Layout oficial do MOC — só muda o
rodapé (sem a marca do Omie).

Uso:  python3 scripts/danfe.py nota.xml [logo.png] > danfe.pdf
      from danfe import gerar_danfe; pdf_bytes = gerar_danfe(xml, logo_bytes, extra_info)
Branch focus-faturamento."""
from __future__ import annotations
import sys
import xml.etree.ElementTree as ET
from datetime import datetime

import fitz  # PyMuPDF

NS = {"n": "http://www.portalfiscal.inf.br/nfe"}
MM = 72 / 25.4          # pontos por milímetro
F, FB, FI = "cour", "cobo", "coit"   # Courier, Courier-Bold, Courier-Oblique
LW = 0.5                # espessura da linha (pt)
RAIO = 0.8              # canto arredondado (mm)


# ── utilidades de formatação ─────────────────────────────────────────────
def t(el, cam, padrao=""):
    if el is None:
        return padrao
    x = el.find(cam, NS)
    return x.text.strip() if x is not None and x.text else padrao


def br(v, casas=2):
    if v in (None, ""):
        return ""
    s = f"{float(v):,.{casas}f}"
    return s.replace(",", "X").replace(".", ",").replace("X", ".")


def br_min(v, max_casas=4):
    """Como o Omie: 2,0000 → 2 ; 525,7200 → 525,72 (mínimo 2 casas se tiver fração)."""
    if v in (None, ""):
        return ""
    f = float(v)
    if f == int(f):
        return br(f, 0)
    for c in range(2, max_casas + 1):
        if round(f, c) == f:
            return br(f, c)
    return br(f, max_casas)


def doc(v):
    v = "".join(ch for ch in (v or "") if ch.isdigit())
    if len(v) == 14:
        return f"{v[:2]}.{v[2:5]}.{v[5:8]}/{v[8:12]}-{v[12:]}"
    if len(v) == 11:
        return f"{v[:3]}.{v[3:6]}.{v[6:9]}-{v[9:]}"
    return v


def ie(v):
    d = "".join(ch for ch in (v or "") if ch.isdigit())
    return f"{d[:3]}.{d[3:6]}.{d[6:9]}.{d[9:]}" if len(d) == 12 else (v or "")


def cep(v):
    d = "".join(ch for ch in (v or "") if ch.isdigit())
    return f"{d[:5]}-{d[5:]}" if len(d) == 8 else (v or "")


def fone(v):
    d = "".join(ch for ch in (v or "") if ch.isdigit())
    if len(d) == 10:
        return f"({d[:2]}) {d[2:6]}-{d[6:]}"
    if len(d) == 11:
        return f"({d[:2]}) {d[2:7]}-{d[7:]}"
    return v or ""


def data_br(iso):
    return datetime.fromisoformat(iso).strftime("%d/%m/%Y") if iso else ""


def hora(iso):
    return datetime.fromisoformat(iso).strftime("%H:%M:%S") if iso else ""


def cest_fmt(v):
    return f"{v[:2]}.{v[2:5]}.{v[5:]}" if len(v or "") == 7 else (v or "")


# ── Code 128 (conjunto C) para a chave de acesso ─────────────────────────
C128 = ["212222", "222122", "222221", "121223", "121322", "131222", "122213", "122312", "132212", "221213",
        "221312", "231212", "112232", "122132", "122231", "113222", "123122", "123221", "223211", "221132",
        "221231", "213212", "223112", "312131", "311222", "321122", "321221", "312212", "322112", "322211",
        "212123", "212321", "232121", "111323", "131123", "131321", "112313", "132113", "132311", "211313",
        "231113", "231311", "112133", "112331", "132131", "113123", "113321", "133121", "313121", "211331",
        "231131", "213113", "213311", "213131", "311123", "311321", "331121", "312113", "312311", "332111",
        "314111", "221411", "431111", "111224", "111422", "121124", "121421", "141122", "141221", "112214",
        "112412", "122114", "122411", "142112", "142211", "241211", "221114", "413111", "241112", "134111",
        "111242", "121142", "121241", "114212", "124112", "124211", "411212", "421112", "421211", "212141",
        "214121", "412121", "111143", "111341", "131141", "114113", "114311", "411113", "411311", "113141",
        "114131", "311141", "411131", "211412", "211214", "211232", "2331112"]


def code128c(digitos):
    vals = [105] + [int(digitos[i:i + 2]) for i in range(0, len(digitos), 2)]
    chk = (vals[0] + sum(v * i for i, v in enumerate(vals[1:], 1))) % 103
    return "".join(C128[v] for v in vals + [chk, 106])


# ── desenho ──────────────────────────────────────────────────────────────
class Folha:
    def __init__(self, pg):
        self.pg = pg

    def caixa(self, x0, y0, x1, y1, rotulo=None, rot_tam=6, rot_fonte=F):
        r = fitz.Rect(x0 * MM, y0 * MM, x1 * MM, y1 * MM)
        # raio como fração de largura/altura (PyMuPDF) → canto circular de RAIO mm
        self.pg.draw_rect(r, color=(0, 0, 0), width=LW,
                          radius=(min(RAIO / max(x1 - x0, 0.1), 0.5), min(RAIO / max(y1 - y0, 0.1), 0.5)))
        if rotulo:
            self.txt(x0 + 0.5, y0 + 0.1, rotulo, rot_tam, rot_fonte)

    def txt(self, x, y_topo, s, tam, fonte=F, alinha="esq", x1=None, max_w=None):
        """x/y em mm (y = topo da linha, como o bbox do PDF do Omie)."""
        if not s:
            return
        larg = fitz.get_text_length(s, fontname=fonte, fontsize=tam) / MM
        if max_w and larg > max_w:  # encolhe se não couber (nunca corta)
            tam = tam * max_w / larg
            larg = max_w
        if alinha == "centro":
            x = (x + x1) / 2 - larg / 2
        elif alinha == "dir":
            x = x1 - larg
        base = y_topo + tam * 0.3528 * 1.0   # calibrado contra o PDF do Omie (topo do bbox = y)
        self.pg.insert_text((x * MM, base * MM), s, fontname=fonte, fontsize=tam)

    def campo(self, x0, y0, x1, rotulo, valor, alinha="centro", tam=10, fonte=FB, rot_tam=6):
        self.caixa(x0, y0, x1, y0 + 7, rotulo, rot_tam)
        if alinha == "esq":
            self.txt(x0 + 0.5, y0 + 2.9, valor, tam, fonte, max_w=x1 - x0 - 1)
        elif alinha == "dir":
            self.txt(x0, y0 + 2.9, valor, tam, fonte, "dir", x1 - 0.5, max_w=x1 - x0 - 1)
        else:
            self.txt(x0, y0 + 2.9, valor, tam, fonte, "centro", x1, max_w=x1 - x0 - 1)

    def tracejado(self, y, x0=3, x1=207, traco=1.0, vao=0.55):
        x = x0
        while x < x1:
            self.pg.draw_line((x * MM, y * MM), (min(x + traco, x1) * MM, y * MM), color=(0, 0, 0), width=LW)
            x += traco + vao

    def quebra(self, s, tam, fonte, larg_mm):
        palavras, linhas, cur = (s or "").split(), [], ""
        for p in palavras:
            tent = (cur + " " + p).strip()
            if fitz.get_text_length(tent, fontname=fonte, fontsize=tam) / MM <= larg_mm:
                cur = tent
            else:
                if cur:
                    linhas.append(cur)
                cur = p
        if cur:
            linhas.append(cur)
        return linhas

    def barras(self, x0, y0, x1, y1, padrao):
        modulos = sum(int(c) for c in padrao)
        w = (x1 - x0) / modulos
        x, barra = x0, True
        for c in padrao:
            larg = int(c) * w
            if barra:
                self.pg.draw_rect(fitz.Rect(x * MM, y0 * MM, (x + larg) * MM, y1 * MM), color=None, fill=(0, 0, 0), width=0)
            x += larg
            barra = not barra


def gerar_danfe(xml: str, logo: bytes | None = None, info_extra: str = "", impresso_em: datetime | None = None) -> bytes:
    root = ET.fromstring(xml.encode("utf-8"))
    inf = root.find(".//n:infNFe", NS)
    ide, emit, dest = inf.find("n:ide", NS), inf.find("n:emit", NS), inf.find("n:dest", NS)
    ee, ed = emit.find("n:enderEmit", NS), dest.find("n:enderDest", NS)
    tot = inf.find("n:total/n:ICMSTot", NS)
    prot = root.find(".//n:protNFe/n:infProt", NS)
    chave = inf.get("Id", "")[3:]
    nnf = br(t(ide, "n:nNF"), 0)
    serie = t(ide, "n:serie")

    doc_pdf = fitz.open()
    pg = doc_pdf.new_page(width=210 * MM, height=297 * MM)
    f = Folha(pg)

    # ── canhoto ──
    f.caixa(3, 3, 168, 11)
    canhoto = (f"RECEBEMOS DE {t(emit, 'n:xNome')} OS PRODUTOS E/OU SERVIÇOS CONSTANTES DA NOTA FISCAL ELETRÔNICA INDICADA "
               f"ABAIXO. EMISSÃO: {data_br(t(ide, 'n:dhEmi'))} VALOR TOTAL: R$ {br(t(tot, 'n:vNF'))} DESTINATÁRIO: "
               f"{t(dest, 'n:xNome')} - {t(ed, 'n:xLgr')}, {t(ed, 'n:nro')} {t(ed, 'n:xBairro')} {t(ed, 'n:xMun')}-{t(ed, 'n:UF')}")
    for i, ln in enumerate(f.quebra(canhoto, 7, F, 158.6)[:3]):
        f.txt(3.5, 3.5 + i * 2.45, ln, 7)
    f.caixa(3, 11, 38, 19, "DATA DE RECEBIMENTO")
    f.caixa(38, 11, 168, 19, "IDENTIFICAÇÃO E ASSINATURA DO RECEBEDOR")
    f.caixa(168, 3, 207, 19)
    f.txt(168, 3.0, "NF-e", 14, FB, "centro", 207)
    f.txt(168, 9.2, f"Nº {nnf}", 10, FB, "centro", 207)
    f.txt(168, 12.7, f"Série {serie}", 10, FB, "centro", 207)
    f.tracejado(20)

    # ── emitente / DANFE / chave ──
    f.caixa(3, 22, 87, 54)
    f.txt(3, 22.2, "IDENTIFICAÇÃO DO EMITENTE", 6, FI, "centro", 87)
    if logo:
        pg.insert_image(fitz.Rect(26 * MM, 28 * MM, 64 * MM, 39 * MM), stream=logo, keep_proportion=True)
    f.txt(3, 40.0, t(emit, "n:xNome"), 12, FB, "centro", 87, max_w=82)
    compl = f" - {t(ee, 'n:xCpl')}" if t(ee, "n:xCpl") else ""
    f.txt(3, 45.2, f"{t(ee, 'n:xLgr')}, {t(ee, 'n:nro')}{compl}", 8, F, "centro", 87, max_w=82)
    f.txt(3, 48.0, f"{t(ee, 'n:xBairro')} - {cep(t(ee, 'n:CEP'))}", 8, F, "centro", 87, max_w=82)
    f.txt(3, 50.8, f"{t(ee, 'n:xMun')} - {t(ee, 'n:UF')} Fone: {fone(t(ee, 'n:fone'))}", 8, F, "centro", 87, max_w=82)

    f.caixa(87, 22, 122, 54)
    f.txt(87, 23.0, "DANFE", 14, FB, "centro", 122)
    for (x, yy, s) in ((89.2, 28.2, "Documento Auxiliar"), (92.6, 31.0, "da Nota Fiscal"), (96.0, 33.8, "Eletrônica")):
        f.txt(x, yy, s, 8)
    f.txt(89.5, 36.2, "0 - ENTRADA", 8)
    f.txt(89.5, 39.2, "1 - SAÍDA", 8)
    f.caixa(114, 35, 119, 42)
    f.txt(114, 36.3, t(ide, "n:tpNF"), 12, FB, "centro", 119)
    f.txt(87, 43.7, f"Nº {nnf}", 10, FB, "centro", 122)
    f.txt(87, 46.7, f"Série {serie}", 10, FB, "centro", 122)
    f.txt(94.3, 50.3, "Folha 1/1", 8, FI)

    f.caixa(122, 22, 207, 38)
    if len(chave) == 44:
        f.barras(124.5, 23.5, 204.5, 36.5, code128c(chave))
    f.caixa(122, 38, 207, 46, "CHAVE DE ACESSO")
    f.txt(125.5, 42.3, " ".join(chave[i:i + 4] for i in range(0, 44, 4)), 7, FB)
    f.caixa(122, 46, 207, 54)
    f.txt(127.0, 46.5, "Consulta de autenticidade no portal nacional da NF-e", 7)
    f.txt(126.1, 50.8, "www.nfe.fazenda.gov.br/portal ou no site da Sefaz Autorizadora", 6)

    f.campo(3, 54, 122, "NATUREZA DA OPERAÇÃO", t(ide, "n:natOp"))
    protocolo = f"{t(prot, 'n:nProt')}  -  {data_br(t(prot, 'n:dhRecbto'))} {hora(t(prot, 'n:dhRecbto'))}" if prot is not None else ""
    f.campo(122, 54, 207, "PROTOCOLO DE AUTORIZAÇÃO DE USO", protocolo)
    f.campo(3, 61, 71, "INSCRIÇÃO ESTADUAL", ie(t(emit, "n:IE")))
    f.campo(71, 61, 139, "INSCRIÇÃO ESTADUAL DO SUBST. TRIBUT.", t(emit, "n:IEST"))
    f.campo(139, 61, 207, "CNPJ", doc(t(emit, "n:CNPJ")))

    # ── destinatário ──
    f.txt(3.5, 69.0, "DESTINATÁRIO / REMETENTE", 7, FB)
    f.campo(3, 72, 127, "NOME / RAZÃO SOCIAL", t(dest, "n:xNome"), "esq")
    f.campo(127, 72, 174, "CNPJ / CPF", doc(t(dest, "n:CNPJ") or t(dest, "n:CPF")))
    f.campo(174, 72, 207, "DATA DA EMISSÃO", data_br(t(ide, "n:dhEmi")))
    f.campo(3, 79, 99, "ENDEREÇO", f"{t(ed, 'n:xLgr')}, {t(ed, 'n:nro')}", "esq")
    f.campo(99, 79, 142, "BAIRRO / DISTRITO", t(ed, "n:xBairro"))
    f.campo(142, 79, 174, "CEP", cep(t(ed, "n:CEP")))
    f.campo(174, 79, 207, "DATA DA SAÍDA/ENTRADA", data_br(t(ide, "n:dhSaiEnt") or t(ide, "n:dhEmi")))
    f.campo(3, 86, 99, "MUNICÍPIO", t(ed, "n:xMun"), "esq")
    f.campo(99, 86, 107, "UF", t(ed, "n:UF"))
    f.campo(107, 86, 141, "FONE / FAX", fone(t(ed, "n:fone")))
    f.campo(141, 86, 174, "INSCRIÇÃO ESTADUAL", ie(t(dest, "n:IE")))
    f.campo(174, 86, 207, "HORA DA SAÍDA/ENTRADA", hora(t(ide, "n:dhSaiEnt") or t(ide, "n:dhEmi")))

    # ── fatura / duplicata ──
    f.txt(3.5, 94.0, "FATURA / DUPLICATA", 7, FB)
    for i, d in enumerate(inf.findall("n:cobr/n:dup", NS)[:7]):
        x0 = 3 + i * 29
        f.caixa(x0, 97, x0 + 28, 105)
        f.txt(x0 + 0.5, 97.1, "Num.", 6)
        f.txt(x0, 97.0, t(d, "n:nDup"), 7, FB, "dir", x0 + 27.5)
        f.txt(x0 + 0.5, 100.1, "Venc.", 6)
        f.txt(x0, 99.7, data_br(t(d, "n:dVenc")), 7, FB, "dir", x0 + 27.5)
        f.txt(x0 + 0.5, 102.5, "Valor", 6)
        f.txt(x0, 102.0, f"R$ {br(t(d, 'n:vDup'))}", 7, FB, "dir", x0 + 27.5)

    # ── cálculo do imposto ──
    f.txt(3.5, 106.0, "CÁLCULO DO IMPOSTO", 7, FB)
    xs = [3, 34, 65, 96, 127, 158, 176, 207]
    l1 = [("BASE DE CÁLCULO DO ICMS", "vBC"), ("VALOR DO ICMS", "vICMS"), ("BASE DE CÁLC. ICMS S.T.", "vBCST"),
          ("VALOR DO ICMS SUBST.", "vST"), ("VALOR IMP. IMPORTAÇÃO", "vII"), ("VALOR DO PIS", "vPIS"),
          ("VALOR TOTAL DOS PRODUTOS", "vProd")]
    l2 = [("VALOR DO FRETE", "vFrete"), ("VALOR DO SEGURO", "vSeg"), ("DESCONTO", "vDesc"),
          ("OUTRAS DESPESAS", "vOutro"), ("VALOR TOTAL DO IPI", "vIPI"), ("VALOR DA COFINS", "vCOFINS"),
          ("VALOR TOTAL DA NOTA", "vNF")]
    for y, linha in ((109, l1), (116, l2)):
        for i, (rot, tag) in enumerate(linha):
            f.campo(xs[i], y, xs[i + 1], rot, br(t(tot, f"n:{tag}", "0")), "dir",
                    rot_tam=5 if rot == "VALOR DA COFINS" else 6)

    # ── transportador ──
    f.txt(3.5, 124.0, "TRANSPORTADOR / VOLUMES TRANSPORTADOS", 7, FB)
    tr = inf.find("n:transp", NS)
    tp = tr.find("n:transporta", NS) if tr is not None else None
    vol = tr.find("n:vol", NS) if tr is not None else None
    veic = tr.find("n:veicTransp", NS) if tr is not None else None
    mod = t(tr, "n:modFrete")
    mod_txt = {"0": "(0) Remetente (CIF)", "1": "(1) Destinatário (FOB)", "2": "(2) Terceiros",
               "3": "(3) Próprio Remetente", "4": "(4) Próprio Destinatário", "9": "(9) Sem Frete"}.get(mod, mod)
    f.campo(3, 127, 62.2, "NOME / RAZÃO SOCIAL", t(tp, "n:xNome"), "esq")
    f.caixa(62.2, 127, 92.7, 134, "FRETE POR CONTA")
    f.txt(63.4, 129.8, mod_txt, 7, FB, max_w=28.5)
    f.campo(92.7, 127, 123.3, "CÓDIGO ANTT", t(veic, "n:RNTC"), "esq")
    f.campo(123.3, 127, 153.9, "PLACA DO VEÍCULO", t(veic, "n:placa"), "esq")
    f.campo(153.9, 127, 161.9, "UF", t(veic, "n:UF"))
    f.campo(161.9, 127, 207, "CNPJ / CPF", doc(t(tp, "n:CNPJ") or t(tp, "n:CPF")))
    f.campo(3, 134, 92.7, "ENDEREÇO", t(tp, "n:xEnder"), "esq")
    f.campo(92.7, 134, 153.7, "MUNICÍPIO", t(tp, "n:xMun"))
    f.campo(153.7, 134, 161.7, "UF", t(tp, "n:UF"))
    f.campo(161.7, 134, 207, "INSCRIÇÃO ESTADUAL", ie(t(tp, "n:IE")))
    for (x0, x1, rot, tag) in ((3, 23, "QUANTIDADE", "qVol"), (23, 58, "ESPÉCIE", "esp"), (58, 93, "MARCA", "marca"),
                               (93, 128, "NUMERAÇÃO", "nVol"), (128, 169, "PESO BRUTO (KG)", "pesoB"),
                               (169, 207, "PESO LÍQUIDO (KG)", "pesoL")):
        v = t(vol, f"n:{tag}")
        f.campo(x0, 141, x1, rot, br_min(v, 3) if tag.startswith("peso") or tag == "qVol" else v,
                "dir" if tag in ("qVol", "pesoB", "pesoL") else "esq")

    # ── produtos ──
    f.txt(3.5, 149.0, "DADOS DOS PRODUTOS / SERVIÇOS", 7, FB)
    f.caixa(3, 152, 207, 271)
    pg.draw_line((3 * MM, 157 * MM), (207 * MM, 157 * MM), color=(0, 0, 0), width=LW)
    cols = [3, 21, 84, 96, 104, 112, 118, 130, 144, 158, 170, 182, 193, 200, 207]
    for x in cols[1:-1]:
        pg.draw_line((x * MM, 152 * MM), (x * MM, 271 * MM), color=(0, 0, 0), width=LW)
    cab = ["CÓDIGO PRODUTO", "DESCRIÇÃO DO PRODUTO / SERVIÇO", "NCM/SH", "O/CSOSN", "CFOP", "UN", "QUANT",
           "VALOR UNIT", "VALOR TOTAL", "B.CÁLC|ICMS", "VALOR|ICMS", "VALOR|IPI", "ALÍQ.|ICMS", "ALÍQ.|IPI"]
    for i, h in enumerate(cab):
        partes = h.split("|")
        tam = 5 if h == "O/CSOSN" else 6
        if len(partes) == 1:
            f.txt(cols[i], 153.1, h, tam, F, "centro", cols[i + 1], max_w=cols[i + 1] - cols[i] - 0.4)
        else:
            f.txt(cols[i], 152.0, partes[0], 6, F, "centro", cols[i + 1])
            f.txt(cols[i], 154.1, partes[1], 6, F, "centro", cols[i + 1])
    y = 157.1
    for det in inf.findall("n:det", NS):
        p = det.find("n:prod", NS)
        icms = det.find("n:imposto/n:ICMS", NS)
        sub = list(icms)[0] if icms is not None and len(icms) else None
        orig, csosn = t(sub, "n:orig"), t(sub, "n:CSOSN") or t(sub, "n:CST")
        ipi = det.find("n:imposto/n:IPI/n:IPITrib", NS)
        desc = f.quebra(t(p, "n:xProd"), 6, F, 62)
        if t(p, "n:CEST"):
            desc.append(f"CEST: {cest_fmt(t(p, 'n:CEST'))}")
        if y + len(desc) * 2.1 > 270:
            break  # (nota com muitos itens: folha 2 — fica para quando aparecer)
        f.txt(3, y, t(p, "n:cProd"), 6, F, "centro", 21, max_w=17.6)
        for i, ln in enumerate(desc):
            f.txt(21.5, y + i * 2.1, ln, 6)
        f.txt(84, y, t(p, "n:NCM"), 6, F, "centro", 96)
        f.txt(96, y, f"{orig}{csosn}", 6, F, "centro", 104)
        f.txt(104, y, t(p, "n:CFOP"), 6, F, "centro", 112)
        f.txt(112, y, t(p, "n:uCom"), 6, F, "centro", 118, max_w=5.6)
        f.txt(118, y, br_min(t(p, "n:qCom")), 6, F, "dir", 129.5)
        f.txt(130, y, br_min(t(p, "n:vUnCom")), 6, F, "dir", 143.5)
        f.txt(144, y, br(t(p, "n:vProd")), 6, F, "dir", 157.5)
        f.txt(158, y, br(t(sub, "n:vBC", "0")), 6, F, "dir", 169.5)
        f.txt(170, y, br(t(sub, "n:vICMS", "0")), 6, F, "dir", 181.5)
        f.txt(182, y, br(t(ipi, "n:vIPI")) if ipi is not None else "", 6, F, "dir", 192.5)
        f.txt(193, y, br(t(sub, "n:pICMS", "0")), 6, F, "dir", 199.0)
        f.txt(200, y, br(t(ipi, "n:pIPI")) if ipi is not None else "", 6, F, "dir", 206.5)
        y += len(desc) * 2.1 + 4.4      # espaçamento do Omie entre itens
        f.tracejado(y - 0.5)
        y += 0.6

    # ── dados adicionais ──
    f.txt(3.5, 272.9, "DADOS ADICIONAIS", 7, FB)
    f.caixa(3, 276, 146, 291)
    f.txt(3.5, 275.9, "INFORMAÇÕES COMPLEMENTARES", 6, FB)
    linhas = []
    for parte in [p.strip() for p in t(inf, "n:infAdic/n:infCpl").split(";") if p.strip()] + ([info_extra] if info_extra else []):
        linhas += f.quebra(parte, 6, F, 141)
    for i, ln in enumerate(linhas[:5]):
        f.txt(3.5, 279.1 + i * 2.15, ln, 6)
    f.caixa(146, 276, 207, 291)
    f.txt(146.5, 275.9, "RESERVADO AO FISCO", 6, FB)
    agora = impresso_em or datetime.now()
    f.txt(3.5, 292.1, f"Impresso em {agora:%d/%m/%Y} as {agora:%H:%M:%S}", 6, FI)
    return doc_pdf.tobytes(garbage=3, deflate=True)


if __name__ == "__main__":
    xml = open(sys.argv[1], encoding="utf-8").read()
    logo = open(sys.argv[2], "rb").read() if len(sys.argv) > 2 else None
    extra = sys.argv[3] if len(sys.argv) > 3 else ""
    sys.stdout.buffer.write(gerar_danfe(xml, logo, extra))

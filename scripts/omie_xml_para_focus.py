#!/usr/bin/env python3
"""Converte o XML de uma NF-e emitida pelo Omie no JSON de emissão da Focus NFe
(API v2). Serve para (1) conferir paridade — reemitir em homologação a mesma
nota e comparar a DANFE — e (2) de base para a emissão pelo painel: o painel
vai montar o mesmo JSON a partir do PV, com as regras fiscais mapeadas em
docs/focus-faturamento.md. Branch focus-faturamento (02/10/2026)."""
import xml.etree.ElementTree as ET

NS = {"n": "http://www.portalfiscal.inf.br/nfe"}


def _t(el, caminho, padrao=None):
    if el is None:
        return padrao
    x = el.find(caminho, NS)
    return x.text if x is not None and x.text is not None else padrao


def _num(v):
    return None if v in (None, "") else float(v)


def _icms(det):
    g = det.find("n:imposto/n:ICMS", NS)
    if g is None or not len(g):
        return {}
    sub = list(g)[0]
    campo = lambda k: _t(sub, f"n:{k}")  # noqa: E731
    out = {"icms_origem": campo("orig"), "icms_situacao_tributaria": campo("CSOSN") or campo("CST")}
    mapa = {
        "modBC": "icms_modalidade_base_calculo", "vBC": "icms_base_calculo", "pICMS": "icms_aliquota",
        "vICMS": "icms_valor", "pCredSN": "icms_aliquota_credito_simples", "vCredICMSSN": "icms_valor_credito_simples",
        "modBCST": "icms_modalidade_base_calculo_st", "vBCST": "icms_base_calculo_st", "pICMSST": "icms_aliquota_st",
        "vICMSST": "icms_valor_st", "vBCSTRet": "icms_base_calculo_retido_st", "pST": "icms_aliquota_final",
        "vICMSSubstituto": "icms_valor_substituto", "vICMSSTRet": "icms_valor_retido_st",
    }
    for xml_k, focus_k in mapa.items():
        v = campo(xml_k)
        if v is not None:
            out[focus_k] = v
    return out


def _pis_cofins(det, nome, prefixo):
    g = det.find(f"n:imposto/n:{nome}", NS)
    if g is None or not len(g):
        return {}
    sub = list(g)[0]
    out = {f"{prefixo}_situacao_tributaria": _t(sub, "n:CST")}
    for xml_k, suf in (("vBC", "base_calculo"), (f"p{nome}", "aliquota_porcentual"), (f"v{nome}", "valor")):
        v = _t(sub, f"n:{xml_k}")
        if v is not None:
            out[f"{prefixo}_{suf}"] = v
    return out


def _ipi(det):
    g = det.find("n:imposto/n:IPI", NS)
    if g is None:
        return {}
    out = {}
    enq = _t(g, "n:cEnq")
    if enq:
        out["ipi_codigo_enquadramento_legal"] = enq
    trib = g.find("n:IPITrib", NS)
    if trib is None:
        trib = g.find("n:IPINT", NS)
    if trib is not None and _t(trib, "n:CST"):
        out["ipi_situacao_tributaria"] = _t(trib, "n:CST")
        for xml_k, k in (("vBC", "ipi_base_calculo"), ("pIPI", "ipi_aliquota"), ("vIPI", "ipi_valor")):
            if _t(trib, f"n:{xml_k}") is not None:
                out[k] = _t(trib, f"n:{xml_k}")
    return out


def converter(xml: str) -> dict:
    root = ET.fromstring(xml.encode("utf-8"))
    inf = root.find(".//n:infNFe", NS)
    ide, emit, dest = inf.find("n:ide", NS), inf.find("n:emit", NS), inf.find("n:dest", NS)
    end = dest.find("n:enderDest", NS) if dest is not None else None
    nfe = {
        "natureza_operacao": _t(ide, "n:natOp"),
        "data_emissao": _t(ide, "n:dhEmi"),
        "data_entrada_saida": _t(ide, "n:dhSaiEnt"),
        "tipo_documento": int(_t(ide, "n:tpNF", "1")),
        "local_destino": int(_t(ide, "n:idDest", "1")),
        "finalidade_emissao": int(_t(ide, "n:finNFe", "1")),
        "consumidor_final": int(_t(ide, "n:indFinal", "0")),
        "presenca_comprador": int(_t(ide, "n:indPres", "9")),
        "cnpj_emitente": _t(emit, "n:CNPJ"),
        "nome_destinatario": _t(dest, "n:xNome"),
        "cnpj_destinatario": _t(dest, "n:CNPJ"),
        "cpf_destinatario": _t(dest, "n:CPF"),
        "indicador_inscricao_estadual_destinatario": int(_t(dest, "n:indIEDest", "9")),
        "inscricao_estadual_destinatario": _t(dest, "n:IE"),
        "email_destinatario": _t(dest, "n:email"),
        "logradouro_destinatario": _t(end, "n:xLgr"),
        "numero_destinatario": _t(end, "n:nro"),
        "complemento_destinatario": _t(end, "n:xCpl"),
        "bairro_destinatario": _t(end, "n:xBairro"),
        "codigo_municipio_destinatario": _t(end, "n:cMun"),
        "municipio_destinatario": _t(end, "n:xMun"),
        "uf_destinatario": _t(end, "n:UF"),
        "cep_destinatario": _t(end, "n:CEP"),
        "telefone_destinatario": _t(end, "n:fone"),
        "modalidade_frete": int(_t(inf, "n:transp/n:modFrete", "9")),
        "informacoes_adicionais_contribuinte": _t(inf, "n:infAdic/n:infCpl"),
    }
    tr = inf.find("n:transp/n:transporta", NS)
    if tr is not None:
        nfe.update({k: v for k, v in {
            "nome_transportador": _t(tr, "n:xNome"), "cnpj_transportador": _t(tr, "n:CNPJ"),
            "municipio_transportador": _t(tr, "n:xMun"), "uf_transportador": _t(tr, "n:UF"),
            "endereco_transportador": _t(tr, "n:xEnder"), "inscricao_estadual_transportador": _t(tr, "n:IE"),
        }.items() if v})
    itens = []
    for det in inf.findall("n:det", NS):
        p = det.find("n:prod", NS)
        it = {
            "numero_item": int(det.get("nItem")),
            "codigo_produto": _t(p, "n:cProd"),
            "descricao": _t(p, "n:xProd"),
            "cfop": _t(p, "n:CFOP"),
            "codigo_ncm": _t(p, "n:NCM"),
            "cest": _t(p, "n:CEST"),
            "unidade_comercial": _t(p, "n:uCom"),
            "quantidade_comercial": _t(p, "n:qCom"),
            "valor_unitario_comercial": _t(p, "n:vUnCom"),
            "valor_bruto": _t(p, "n:vProd"),
            "unidade_tributavel": _t(p, "n:uTrib"),
            "quantidade_tributavel": _t(p, "n:qTrib"),
            "valor_unitario_tributavel": _t(p, "n:vUnTrib"),
            "valor_desconto": _t(p, "n:vDesc"),
            "valor_frete": _t(p, "n:vFrete"),
            "inclui_no_total": int(_t(p, "n:indTot", "1")),
            "pedido_compra": _t(p, "n:xPed"),
            "numero_item_pedido_compra": _t(p, "n:nItemPed"),
        }
        it.update(_icms(det))
        it.update(_ipi(det))
        it.update(_pis_cofins(det, "PIS", "pis"))
        it.update(_pis_cofins(det, "COFINS", "cofins"))
        itens.append({k: v for k, v in it.items() if v is not None})
    nfe["items"] = itens
    tot = inf.find("n:total/n:ICMSTot", NS)
    for xml_k, k in (("vProd", "valor_produtos"), ("vFrete", "valor_frete"), ("vSeg", "valor_seguro"),
                     ("vDesc", "valor_desconto"), ("vOutro", "valor_outras_despesas"), ("vNF", "valor_total")):
        nfe[k] = _t(tot, f"n:{xml_k}")
    fat = inf.find("n:cobr/n:fat", NS)
    if fat is not None:
        nfe.update({"numero_fatura": _t(fat, "n:nFat"), "valor_original_fatura": _t(fat, "n:vOrig"),
                    "valor_desconto_fatura": _t(fat, "n:vDesc"), "valor_liquido_fatura": _t(fat, "n:vLiq")})
    dups = [{"numero": _t(d, "n:nDup"), "data_vencimento": _t(d, "n:dVenc"), "valor": _t(d, "n:vDup")}
            for d in inf.findall("n:cobr/n:dup", NS)]
    if dups:
        nfe["duplicatas"] = dups
    nfe["formas_pagamento"] = [{"forma_pagamento": _t(p, "n:tPag"), "valor_pagamento": _t(p, "n:vPag")}
                               for p in inf.findall("n:pag/n:detPag", NS)]
    refs = [{"chave_nfe": r.text} for r in inf.findall("n:ide/n:NFref/n:refNFe", NS)]
    if refs:
        nfe["notas_referenciadas"] = refs
    return {k: v for k, v in nfe.items() if v not in (None, "")}

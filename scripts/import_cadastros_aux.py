#!/usr/bin/env python3
"""
Cadastros auxiliares do Omie que ainda não tinham espelho (05/10/26) — SÓ LEITURA no Omie.

  · Vendedores   /geral/vendedores/   ListarVendedores        → finance.vendedores
  · Serviços     /servicos/servico/   ListarCadastroServico   → sales.servicos_cadastro (LC116, ISS)
  · Unidades     /geral/unidade/      ListarUnidades          → orders.unidades

Poucas chamadas por empresa, com a pausa padrão entre elas (o limite de uso do
Omie já foi atingido uma vez — não insistir). No fim chama
orders.cad_aux_sync_omie(), que leva tudo para o cadastro nativo (cadastros.aux).
Nada é escrito no Omie.
"""
import json
import sys
import time

sys.path.insert(0, "scripts")
from _common import (
    EMPRESAS_ALVO, PAUSA_ENTRE_CHAMADAS, SUPABASE_URL,
    fetch_omie, fetch_omie_paginated, http_post_json, supa_headers, supa_upsert,
)


def rpc(nome: str, args: dict):
    code, body, _ = http_post_json(f"{SUPABASE_URL}/rest/v1/rpc/{nome}", args, supa_headers("orders"))
    if code < 200 or code >= 300:
        raise RuntimeError(f"RPC {nome} HTTP {code}: {body[:300].decode('utf-8', errors='replace')}")
    return json.loads(body.decode("utf-8") or "null")


def num(v):
    try:
        return float(str(v).replace(",", "."))
    except (TypeError, ValueError):
        return None


def vendedores(sigla: str) -> int:
    itens = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/geral/vendedores/", call="ListarVendedores", sigla=sigla,
        list_field="cadastro", page_size=100, extra_param={"apenas_importado_api": "N"}, label="Vendedores")
    rows = []
    for v in itens:
        cod = v.get("codigo") or v.get("codigo_vendedor")
        if not cod:
            continue
        rows.append({"empresa": sigla, "codigo": int(cod), "nome": v.get("nome") or "",
                     "email": v.get("email") or None, "comissao": num(v.get("comissao")),
                     "inativo": v.get("inativo") or "N", "raw": v})
    return supa_upsert("finance", "vendedores", rows, "empresa,codigo")


def servicos(sigla: str) -> int:
    itens = fetch_omie_paginated(
        url="https://app.omie.com.br/api/v1/servicos/servico/", call="ListarCadastroServico", sigla=sigla,
        list_field="cadastros", page_size=50, page_key="nPagina", size_key="nRegPorPagina", label="Serviços")
    rows = []
    for s in itens:
        il = s.get("intListar") or {}
        cab = s.get("cabecalho") or {}
        imp = s.get("impostos") or {}
        info = s.get("info") or {}
        cod = il.get("nCodServ")
        if not cod:
            continue
        rows.append({"empresa": sigla, "codigo": int(cod),
                     "descricao": cab.get("cDescricao") or cab.get("cCodigo") or "",
                     "cod_lc116": cab.get("cCodLC116") or None,
                     "cod_servico_municipio": cab.get("cCodServMun") or None,
                     "aliquota_iss": num(imp.get("nAliqISS")),
                     "inativo": info.get("inativo") or "N", "raw": s})
    return supa_upsert("sales", "servicos_cadastro", rows, "empresa,codigo")


def unidades(sigla: str) -> int:
    data = fetch_omie("https://app.omie.com.br/api/v1/geral/unidade/", "ListarUnidades", sigla, {"codigo": ""})
    lista = data.get("unidade_cadastro") or data.get("unidades") or []
    rows = [{"empresa": sigla, "sigla": (u.get("codigo") or "").strip().upper(), "descricao": u.get("descricao") or ""}
            for u in lista if (u.get("codigo") or "").strip()]
    return supa_upsert("orders", "unidades", rows, "empresa,sigla")


def main():
    for sigla in EMPRESAS_ALVO:
        for nome, fn in (("vendedores", vendedores), ("servicos", servicos), ("unidades", unidades)):
            try:
                print(f"▶ {sigla} · {nome}: {fn(sigla)} gravados")
            except Exception as e:  # um cadastro que falha não derruba os outros
                print(f"⚠️ {sigla} · {nome}: {e}")
                if "MISUSE" in str(e).upper():
                    print("   limite de uso do Omie — parando aqui para não insistir")
                    print(f"sync nativo: {rpc('cad_aux_sync_omie', {})}")
                    return
            time.sleep(PAUSA_ENTRE_CHAMADAS)
    print(f"sync nativo: {rpc('cad_aux_sync_omie', {})}")


if __name__ == "__main__":
    main()

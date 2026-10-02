#!/usr/bin/env python3
"""
Diagnóstico SOMENTE LEITURA: o painel (finance.contas_pagar / contas_receber)
bate com o Omie ao vivo?

Puxa TODOS os títulos do Omie (sem filtro de data) e compara por
codigo_lancamento_omie com o Supabase. Não grava nada no banco.

Saída: resumo no log + diag_paridade.json (artifact do workflow).
"""
import sys, json
from collections import defaultdict

sys.path.insert(0, "scripts")
from _common import EMPRESAS_ALVO, EMPRESAS_OMIE, fetch_omie_paginated, supa_select, to_int, to_float

TIPOS = {
    "pagar": ("https://app.omie.com.br/api/v1/financas/contapagar/", "ListarContasPagar",
              "conta_pagar_cadastro", "contas_pagar"),
    "receber": ("https://app.omie.com.br/api/v1/financas/contareceber/", "ListarContasReceber",
                "conta_receber_cadastro", "contas_receber"),
}
ABERTOS = {"A VENCER", "ATRASADO", "VENCE HOJE", "EMABERTO", "EM ABERTO"}
COLS = "codigo_lancamento_omie,status_titulo,valor_documento,data_vencimento,id_conta_corrente,codigo_cliente_fornecedor"


def situacao(status):
    s = (status or "").upper().strip()
    return "ABERTO" if s in ABERTOS else s or "?"


def supa_all(table, sigla):
    rows, off = [], 0
    while True:
        chunk = supa_select("finance", table,
                            f"select={COLS}&empresa=eq.{sigla}&order=codigo_lancamento_omie&limit=1000&offset={off}")
        rows.extend(chunk)
        if len(chunk) < 1000:
            return rows
        off += 1000


def nomes_contas():
    nomes = {}
    off = 0
    while True:
        chunk = supa_select("finance", "extratos_cc",
                            f"select=empresa,cod_conta_corrente,descricao_cc&limit=1000&offset={off}")
        for r in chunk:
            nomes[(r["empresa"], r["cod_conta_corrente"])] = r["descricao_cc"]
        if len(chunk) < 1000:
            return nomes
        off += 1000


def resumo_aberto(rows, sigla, nomes):
    por_conta = defaultdict(lambda: [0, 0.0])
    for r in rows:
        if situacao(r["status_titulo"]) != "ABERTO":
            continue
        cc = to_int(r["id_conta_corrente"])
        k = nomes.get((sigla, cc), f"conta {cc}")
        por_conta[k][0] += 1
        por_conta[k][1] += to_float(r["valor_documento"]) or 0
    return {k: {"qtd": v[0], "valor": round(v[1], 2)} for k, v in sorted(por_conta.items(), key=lambda x: -x[1][1])}


def main():
    nomes = nomes_contas()
    relatorio = {}
    for sigla in EMPRESAS_ALVO:
        if not EMPRESAS_OMIE.get(sigla):
            print(f"⚠️  {sigla}: sem credenciais, pulando")
            continue
        for tipo, (url, call, campo, tabela) in TIPOS.items():
            print(f"\n===== {sigla} / {tipo} =====")
            omie_raw = fetch_omie_paginated(url, call, sigla, campo, page_size=500,
                                            extra_param={"apenas_importado_api": "N"}, label=tipo)
            omie = {to_int(c["codigo_lancamento_omie"]): {
                "codigo_lancamento_omie": to_int(c["codigo_lancamento_omie"]),
                "status_titulo": c.get("status_titulo"),
                "valor_documento": to_float(c.get("valor_documento")),
                "data_vencimento": c.get("data_vencimento"),
                "id_conta_corrente": to_int(c.get("id_conta_corrente")),
                "codigo_cliente_fornecedor": to_int(c.get("codigo_cliente_fornecedor")),
            } for c in omie_raw}
            supa = {to_int(r["codigo_lancamento_omie"]): r for r in supa_all(tabela, sigla)}

            so_omie = [omie[k] for k in omie.keys() - supa.keys()]
            so_painel = [supa[k] for k in supa.keys() - omie.keys()]
            div_situacao, div_status, div_valor, div_venc, div_conta = [], [], [], [], []
            for k in omie.keys() & supa.keys():
                o, s = omie[k], supa[k]
                if situacao(o["status_titulo"]) != situacao(s["status_titulo"]):
                    div_situacao.append({"cod": k, "omie": o["status_titulo"], "painel": s["status_titulo"],
                                         "valor": o["valor_documento"], "venc": o["data_vencimento"]})
                elif (o["status_titulo"] or "") != (s["status_titulo"] or ""):
                    div_status.append(k)
                if abs((o["valor_documento"] or 0) - (to_float(s["valor_documento"]) or 0)) > 0.009:
                    div_valor.append({"cod": k, "omie": o["valor_documento"], "painel": s["valor_documento"]})
                if (o["data_vencimento"] or "") != (s["data_vencimento"] or ""):
                    div_venc.append({"cod": k, "omie": o["data_vencimento"], "painel": s["data_vencimento"]})
                if o["id_conta_corrente"] != to_int(s["id_conta_corrente"]):
                    div_conta.append({"cod": k, "omie": o["id_conta_corrente"], "painel": s["id_conta_corrente"]})

            so_painel_aberto = [r for r in so_painel if situacao(r["status_titulo"]) == "ABERTO"]
            so_omie_aberto = [r for r in so_omie if situacao(r["status_titulo"]) == "ABERTO"]
            r = {
                "omie_total": len(omie), "painel_total": len(supa),
                "so_no_omie": len(so_omie), "so_no_omie_abertos": len(so_omie_aberto),
                "so_no_painel": len(so_painel), "so_no_painel_abertos": len(so_painel_aberto),
                "situacao_diferente": len(div_situacao),
                "so_rotulo_vencimento_diferente": len(div_status),
                "valor_diferente": len(div_valor), "vencimento_diferente": len(div_venc),
                "conta_diferente": len(div_conta),
                "aberto_omie_por_conta": resumo_aberto(list(omie.values()), sigla, nomes),
                "aberto_painel_por_conta": resumo_aberto(list(supa.values()), sigla, nomes),
                "amostras": {
                    "so_no_omie_abertos": so_omie_aberto[:30],
                    "so_no_painel_abertos": so_painel_aberto[:30],
                    "situacao_diferente": div_situacao[:30],
                    "valor_diferente": div_valor[:30],
                    "vencimento_diferente": div_venc[:30],
                    "conta_diferente": div_conta[:30],
                },
            }
            relatorio[f"{sigla}/{tipo}"] = r
            print(json.dumps({k: v for k, v in r.items() if k != "amostras"}, ensure_ascii=False, indent=2))

    with open("diag_paridade.json", "w") as f:
        json.dump(relatorio, f, ensure_ascii=False, indent=2, default=str)
    print("\n✅ diag_paridade.json gravado")


if __name__ == "__main__":
    main()

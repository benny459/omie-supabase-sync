"""Carrega a Tabela NCM oficial (Siscomex/Receita) em cadastros.ncm (05/10/26).

Fonte: https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json
Uso:   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... python3 scripts/import_ncm.py
       (ou pelo workflow .github/workflows/import_ncm.yml, manual)
Grava por RPC (orders.ncm_carregar em lotes + orders.ncm_finalizar), não toca no Omie.
"""
import json, os, sys, urllib.error, urllib.request

URL = "https://portalunico.siscomex.gov.br/classif/api/publico/nomenclatura/download/json?perfil=PUBLICO"
SUPA = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY") or ""
LOTE = 800


def rpc(nome, corpo):
    req = urllib.request.Request(
        f"{SUPA}/rest/v1/rpc/{nome}", data=json.dumps(corpo).encode(), method="POST",
        headers={"apikey": KEY, "Authorization": f"Bearer {KEY}", "Content-Type": "application/json",
                 "Content-Profile": "orders"})
    try:
        with urllib.request.urlopen(req, timeout=300) as r:
            return json.loads(r.read() or "null")
    except urllib.error.HTTPError as e:
        sys.exit(f"erro {e.code} em {nome}: {e.read()[:500]!r}")


def main():
    if not SUPA or not KEY:
        sys.exit("faltam SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY")
    arq = sys.argv[1] if len(sys.argv) > 1 else None
    if arq:
        dados = json.load(open(arq, encoding="utf-8"))
    else:
        with urllib.request.urlopen(URL, timeout=120) as r:
            dados = json.loads(r.read().decode("utf-8"))
    linhas = dados["Nomenclaturas"]
    total = 0
    for i in range(0, len(linhas), LOTE):
        total += rpc("ncm_carregar", {"p_linhas": linhas[i:i + LOTE], "p_limpar": i == 0}) or 0
        print(f"  lote {i // LOTE + 1}: {total} linhas", flush=True)
    n = rpc("ncm_finalizar", {"p_versao": dados.get("Data_Ultima_Atualizacao_NCM"), "p_ato": dados.get("Ato")})
    print(f"✓ NCM carregada: {n} códigos ({dados.get('Data_Ultima_Atualizacao_NCM')} · {dados.get('Ato')})")


if __name__ == "__main__":
    main()

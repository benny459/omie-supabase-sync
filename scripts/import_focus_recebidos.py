#!/usr/bin/env python3
"""
═════════════════════════════════════════════════════════════════════════════
📥 FOCUS NFe → Supabase — documentos RECEBIDOS (NF-e, CT-e, NFS-e Nacional)
─────────────────────────────────────────────────────────────────────────────
Substitui a captura de notas de entrada do Omie. Para cada CNPJ configurado:
  1. Lista /v2/{nfes|ctes|nfsens}_recebidas a partir da maior `versao` já
     guardada (cursor da Focus) → orders.focus_recebidos (raw completo).
  2. NF-e sem manifestação → POST manifesto "ciencia" (libera o XML completo).
     Só ciência: desconhecimento/não realizada NUNCA saem daqui.
  3. NF-e já completa e ainda sem `detalhe` → baixa o JSON completo.

Tokens: FOCUS_TOKEN_<SIGLA> (token de produção da empresa na Focus).
Nada de pip install: só stdlib.
═════════════════════════════════════════════════════════════════════════════
"""
import base64
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, "scripts")
from _common import env, supa_upsert, supa_select, update_sync_state, to_float

API = "https://api.focusnfe.com.br"

# sigla → CNPJ (só dígitos). Adicionar CD/WW quando tiverem cadastro + token.
EMPRESAS = {
    "SF": "15766003000108",
}

TIPOS = {
    # tipo : (endpoint, campo da chave)
    "nfe":  ("nfes_recebidas",  "chave_nfe"),
    "cte":  ("ctes_recebidas",  "chave_cte"),
    "nfse": ("nfsens_recebidas", "chave"),
}

PAUSA = 0.7            # 100 req/min por token → folga
MAX_DETALHES = 200     # por execução


def agora():
    return datetime.now(timezone.utc).isoformat()


def focus(token, method, path, body=None, timeout=60):
    """Chamada à Focus com Basic Auth (token como usuário). Retorna (status, json|texto, headers)."""
    auth = base64.b64encode(f"{token}:".encode()).decode()
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(f"{API}{path}", data=data, method=method, headers={
        "Authorization": f"Basic {auth}",
        "Content-Type": "application/json",
    })
    for tent in range(1, 6):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                raw = r.read().decode("utf-8", "replace")
                return r.status, (json.loads(raw) if raw.strip() else None), dict(r.headers)
        except urllib.error.HTTPError as e:
            raw = e.read().decode("utf-8", "replace")
            if e.code == 429 or e.code >= 500:
                espera = 5 * tent
                print(f"   ⚠️ Focus HTTP {e.code} (tent {tent}/5) → {espera}s")
                time.sleep(espera)
                continue
            try:
                return e.code, json.loads(raw), dict(e.headers)
            except ValueError:
                return e.code, raw[:500], dict(e.headers)
        except urllib.error.URLError as e:
            print(f"   ⚠️ rede: {e} (tent {tent}/5)")
            time.sleep(5 * tent)
    raise RuntimeError(f"Focus falhou após 5 tentativas: {method} {path}")


def primeiro(d, *campos):
    for c in campos:
        v = d.get(c)
        if v not in (None, ""):
            return v
    return None


def mapear(tipo, item, sigla, cnpj):
    campo_chave = TIPOS[tipo][1]
    chave = primeiro(item, campo_chave, "chave", "chave_nfe", "chave_cte", "chave_acesso", "codigo_verificacao")
    if not chave:
        return None
    completa = primeiro(item, "nfe_completa", "cte_completo", "completa")
    return {
        "tipo": tipo,
        "chave": str(chave),
        "empresa": sigla,
        "cnpj": cnpj,
        "versao": item.get("versao"),
        "emitente_nome": primeiro(item, "nome_emitente", "razao_social_emitente", "nome_prestador"),
        "emitente_doc": primeiro(item, "documento_emitente", "cnpj_emitente", "cnpj_prestador", "documento_prestador"),
        "numero": str(primeiro(item, "numero", "numero_nfe", "numero_cte", "numero_nfse") or "") or None,
        "emissao": primeiro(item, "data_emissao", "data_emissao_nfse"),
        "valor": to_float(primeiro(item, "valor_total", "valor_servicos", "valor_liquido")),
        "situacao": primeiro(item, "situacao", "status"),
        "manifestacao": primeiro(item, "manifestacao_destinatario", "manifestacao"),
        "completa": (str(completa).lower() in ("true", "1", "s", "sim")) if completa is not None else None,
        "raw": item,
        "synced_at": agora(),
    }


def cursor_atual(tipo, cnpj):
    rows = supa_select("orders", "focus_recebidos",
                       f"select=versao&tipo=eq.{tipo}&cnpj=eq.{cnpj}&versao=not.is.null&order=versao.desc&limit=1")
    return rows[0]["versao"] if rows else 0


def listar(token, tipo, sigla, cnpj):
    endpoint = TIPOS[tipo][0]
    versao = cursor_atual(tipo, cnpj)
    total = 0
    amostra_mostrada = False
    while True:
        st, data, hdr = focus(token, "GET", f"/v2/{endpoint}?cnpj={cnpj}&versao={versao}")
        if st != 200:
            print(f"   ❌ {sigla} {tipo}: HTTP {st} {str(data)[:300]}")
            return total, False
        itens = data or []
        if not itens:
            break
        if not amostra_mostrada:
            print(f"   🔎 {tipo} campos: {sorted(itens[0].keys())}")
            amostra_mostrada = True
        rows = [r for r in (mapear(tipo, i, sigla, cnpj) for i in itens) if r]
        if rows:
            supa_upsert("orders", "focus_recebidos", rows, "tipo,chave")
        total += len(rows)
        nova = max((i.get("versao") or 0) for i in itens)
        print(f"   ⬇️  {sigla} {tipo}: +{len(rows)} (versao {versao}→{nova}, máx Focus {hdr.get('X-Max-Version', '?')})")
        if nova <= versao:
            break
        versao = nova
        time.sleep(PAUSA)
    return total, True


def dar_ciencia(token, sigla, cnpj):
    pend = supa_select("orders", "focus_recebidos",
                       f"select=chave,situacao&tipo=eq.nfe&cnpj=eq.{cnpj}&manifestacao=is.null&ciencia_em=is.null&limit=500")
    pend = [p for p in pend if str(p.get("situacao") or "").lower() not in ("cancelada", "denegada")]
    ok = 0
    for p in pend:
        st, data, _ = focus(token, "POST", f"/v2/nfes_recebidas/{p['chave']}/manifesto", {"tipo": "ciencia"})
        _patch(p["chave"], {"ciencia_em": agora() if st in (200, 201) else None,
                            "ciencia_resposta": {"http": st, "body": data}})
        if st in (200, 201):
            ok += 1
        else:
            print(f"   ⚠️ ciência {p['chave'][-8:]}: HTTP {st} {str(data)[:200]}")
        time.sleep(PAUSA)
    print(f"   ✍️  {sigla}: ciência em {ok}/{len(pend)} NF-e")
    return ok


def baixar_detalhes(token, sigla, cnpj):
    pend = supa_select("orders", "focus_recebidos",
                       f"select=chave&tipo=eq.nfe&cnpj=eq.{cnpj}&completa=is.true&detalhe=is.null&limit={MAX_DETALHES}")
    ok = 0
    for p in pend:
        st, data, _ = focus(token, "GET", f"/v2/nfes_recebidas/{p['chave']}.json?completa=1")
        if st == 200 and isinstance(data, dict):
            _patch(p["chave"], {"detalhe": data})
            ok += 1
        else:
            print(f"   ⚠️ detalhe {p['chave'][-8:]}: HTTP {st} {str(data)[:200]}")
        time.sleep(PAUSA)
    print(f"   📄 {sigla}: {ok}/{len(pend)} NF-e com documento completo baixado")
    return ok


def _patch(chave, campos, tipo="nfe"):
    from _common import SUPABASE_URL, supa_headers, http_request
    url = f"{SUPABASE_URL}/rest/v1/focus_recebidos?tipo=eq.{tipo}&chave=eq.{chave}"
    headers = supa_headers("orders", {"Prefer": "return=minimal"})
    code, body, _ = http_request(url, "PATCH", headers, json.dumps(campos).encode())
    if code >= 300:
        raise RuntimeError(f"PATCH focus_recebidos {chave}: HTTP {code} {body[:200]}")


def main():
    falhas = []
    for sigla, cnpj in EMPRESAS.items():
        token = env(f"FOCUS_TOKEN_{sigla}")
        if not token:
            print(f"⏭️  {sigla}: sem FOCUS_TOKEN_{sigla} — pulando")
            continue
        print(f"\n▶️  {sigla} ({cnpj})")
        total = 0
        for tipo in TIPOS:
            n, ok = listar(token, tipo, sigla, cnpj)
            total += n
            if not ok:
                falhas.append(f"{sigla}/{tipo}")
        try:
            if env("FOCUS_SEM_CIENCIA"):
                print("   ⏸️  FOCUS_SEM_CIENCIA ligado — sem manifestação nesta execução")
            else:
                dar_ciencia(token, sigla, cnpj)
            baixar_detalhes(token, sigla, cnpj)
        except Exception as e:
            print(f"   ❌ {sigla} pós-processamento: {e}")
            falhas.append(f"{sigla}/pos")
        try:
            update_sync_state("focus_recebidos", sigla, total)
        except Exception:
            pass
    print("\n🏁 Focus recebidos" + (f" | FALHAS: {', '.join(falhas)}" if falhas else " OK"))
    if falhas:
        sys.exit(1)


if __name__ == "__main__":
    main()

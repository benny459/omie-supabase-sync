#!/usr/bin/env bash
# Publica o painel (painel.waterworks.com.br) com travas (05/10/26).
# Porquê: em 04/10 o portal foi publicado de uma pasta antiga e apagou trabalho;
# a pasta principal do painel no Mac do Benny também estava dezenas de versões
# atrás. Só publica se o commit actual é exactamente origin/main e se o que
# está em produção (etiqueta prod-painel) já está contido nele.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
falha() { echo "✗ $*" >&2; exit 1; }
[ -z "$(git status --porcelain --untracked-files=no -- . ':!web/tsconfig.tsbuildinfo')" ] || falha "Há alterações por commitar."
git fetch -q origin main
git fetch -q -f origin "refs/tags/prod-painel:refs/tags/prod-painel" 2>/dev/null || true
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] || falha "Este commit não é o origin/main — faça git pull (ou push) antes de publicar."
if PROD=$(git rev-parse -q --verify "prod-painel^{commit}" 2>/dev/null); then
  git merge-base --is-ancestor "$PROD" HEAD || falha "Produção ($PROD) tem trabalho que este commit não tem."
fi
echo "✓ Travas OK: $(git log --oneline -1)"
[ "${PUBLICAR_TESTE:-0}" = 1 ] && { echo "(teste: não publiquei)"; exit 0; }
(cd web && vercel --prod --yes -m gitCommitSha="$(git rev-parse HEAD)" -m gitCommitRef=main)
git tag -f prod-painel HEAD >/dev/null && git push -q -f origin refs/tags/prod-painel
echo "✓ Publicado e marcado (prod-painel = $(git rev-parse --short HEAD))"

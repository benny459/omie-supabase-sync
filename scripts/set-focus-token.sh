#!/usr/bin/env bash
# Grava um token da Focus NFe na Vercel (projeto web) e no GitHub, sem passar pelo chat.
# Uso: bash scripts/set-focus-token.sh MASTER|SF
# Pede o token numa janela do macOS (campo oculto), testa na API e só grava se responder 200.
set -euo pipefail

QUAL="${1:-}"
case "$QUAL" in
  MASTER) TESTE="v2/empresas" ; ROTULO="Token principal produção" ;;
  SF)     TESTE="v2/nfes_recebidas?cnpj=15766003000108" ; ROTULO="Token Produção da SAFE WATER" ;;
  *) echo "uso: $0 MASTER|SF" ; exit 1 ;;
esac
NOME="FOCUS_TOKEN_$QUAL"

TOKEN=$(osascript -e "text returned of (display dialog \"Cole o $ROTULO (Focus NFe)\" default answer \"\" with hidden answer with title \"$NOME\")" 2>/dev/null || true)
TOKEN=$(printf '%s' "$TOKEN" | tr -d ' \n\r\t')
[ -n "$TOKEN" ] || { echo "❌ nada colado — cancelado"; exit 1; }

CODE=$(curl -s -o /dev/null -w "%{http_code}" -u "$TOKEN:" "https://api.focusnfe.com.br/$TESTE")
if [ "$CODE" != "200" ]; then
  echo "❌ a Focus respondeu HTTP $CODE com esse token em /$TESTE — não gravei nada (token de outro tipo ou copiado errado?)"
  exit 1
fi
echo "✅ token válido (HTTP 200 em /$TESTE, ${#TOKEN} caracteres)"

cd "$(dirname "$0")/../web"
vercel env rm "$NOME" production --yes >/dev/null 2>&1 || true
printf '%s' "$TOKEN" | vercel env add "$NOME" production >/dev/null
echo "✅ Vercel: $NOME gravado"
printf '%s' "$TOKEN" | gh secret set "$NOME" -R benny459/omie-supabase-sync
echo "✅ GitHub: $NOME gravado"

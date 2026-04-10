#!/bin/bash
# ════════════════════════════════════════════════════════════════════
# 🛠️ Comandos úteis — omie-supabase-sync
# Uso: `source cmds.sh` (define aliases) OU copia e cola comandos
# ════════════════════════════════════════════════════════════════════

# cd pro repo automaticamente se necessário
REPO_DIR="/Users/bennyalcalay/Downloads/Omie/omie-supabase-sync"

# ─────────────────────────────────────────────────────────────────
# 🚀 DISPARAR RUNS
# ─────────────────────────────────────────────────────────────────

# Run incremental (default, usa sync_state)
alias omie-run='cd "$REPO_DIR" && gh workflow run "Import Itens Vendidos (Omie → Supabase)" -f empresas=SF && sleep 3 && gh run watch $(gh run list --limit 1 --json databaseId --jq ".[0].databaseId")'

# Run FULL (ignora sync_state, reimporta tudo)
alias omie-run-full='cd "$REPO_DIR" && gh workflow run "Import Itens Vendidos (Omie → Supabase)" -f empresas=SF -f forcar_full=true && sleep 3 && gh run watch $(gh run list --limit 1 --json databaseId --jq ".[0].databaseId")'

# Run com empresas múltiplas
alias omie-run-all='cd "$REPO_DIR" && gh workflow run "Import Itens Vendidos (Omie → Supabase)" -f empresas=SF,CD,WW && sleep 3 && gh run watch $(gh run list --limit 1 --json databaseId --jq ".[0].databaseId")'

# ─────────────────────────────────────────────────────────────────
# 📊 MONITORAR
# ─────────────────────────────────────────────────────────────────

# Últimos 10 runs
alias omie-history='cd "$REPO_DIR" && gh run list --limit 10'

# Ver log completo do último run
alias omie-lastlog='cd "$REPO_DIR" && gh run view $(gh run list --limit 1 --json databaseId --jq ".[0].databaseId") --log | grep "Run import script" | sed "s/.*Z //"'

# Watch do run em progresso (se tiver algum)
alias omie-watch='cd "$REPO_DIR" && gh run watch $(gh run list --limit 1 --json databaseId --jq ".[0].databaseId")'

# ─────────────────────────────────────────────────────────────────
# 🗄️ SUPABASE (curl direto)
# ─────────────────────────────────────────────────────────────────

export SUPA_URL="https://zodflkfdnjhtwcjutbjl.supabase.co"
export SUPA_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvZGZsa2ZkbmpodHdjanV0YmpsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTg0NjgxMSwiZXhwIjoyMDkxNDIyODExfQ.vg1J1eU2VBo4Gz-uNyQikrPjFNQo8i8iDAd17DqGuXc"

# Conta total de linhas
alias supa-count='curl -s -D /tmp/h.txt -o /dev/null "$SUPA_URL/rest/v1/itens_vendidos?select=empresa&limit=1" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Accept-Profile: sales" -H "Prefer: count=exact" -H "Range: 0-0" && grep -i content-range /tmp/h.txt'

# Ver sync_state (última execução)
alias supa-sync='curl -s "$SUPA_URL/rest/v1/sync_state?select=*" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Accept-Profile: sales" | jq .'

# Distribuição por empresa
alias supa-dist='curl -s "$SUPA_URL/rest/v1/itens_vendidos?select=empresa,codigo_pedido" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Accept-Profile: sales" | jq "group_by(.empresa) | map({empresa: .[0].empresa, itens: length, pedidos_unicos: (map(.codigo_pedido) | unique | length)})"'

# Amostra de 5 linhas
alias supa-sample='curl -s "$SUPA_URL/rest/v1/itens_vendidos?select=empresa,codigo_pedido,numero_pedido,descricao,quantidade,valor_total,d_alt&limit=5" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Accept-Profile: sales" | jq .'

echo "✅ Aliases carregados:"
echo "  omie-run         — incremental"
echo "  omie-run-full    — reimporta tudo"
echo "  omie-run-all     — SF,CD,WW"
echo "  omie-history     — últimos 10 runs"
echo "  omie-lastlog     — log do último"
echo "  omie-watch       — watch run atual"
echo "  supa-count       — contagem total"
echo "  supa-sync        — estado do sync"
echo "  supa-dist        — distribuição por empresa"
echo "  supa-sample      — 5 linhas de amostra"

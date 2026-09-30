#!/bin/bash
# Grava a connection string do Supabase do painel (omie-data) no servidor de
# backup (188.245.161.139:/opt/backups/painel.env) e roda o primeiro dump.
# A senha não aparece no terminal nem no histórico: vem de uma janela do macOS
# e vai pelo stdin do ssh.
#
# Onde pegar: Supabase → projeto omie-data → Connect → "Session pooler"
# (postgresql://postgres.zodflkfdnjhtwcjutbjl:[SENHA]@aws-...pooler.supabase.com:5432/postgres)
set -euo pipefail
SRV=root@188.245.161.139

URL=$(osascript -e 'text returned of (display dialog "Cole a connection string do Supabase omie-data (Session pooler, porta 5432, COM a senha)" default answer "" with hidden answer with title "Backup do painel")' 2>/dev/null || true)
URL=$(printf '%s' "$URL" | tr -d ' \n\r\t')
[ -n "$URL" ] || { echo "❌ nada colado — cancelado"; exit 1; }
case "$URL" in *zodflkfdnjhtwcjutbjl*) ;; *) echo "❌ essa string não é do projeto omie-data (zodflkfdnjhtwcjutbjl)"; exit 1;; esac

printf '%s' "$URL" | ssh "$SRV" 'set -e
  read -r U
  N=$(/usr/lib/postgresql/17/bin/psql "$(echo "$U" | sed s/:6543/:5432/)" -Atc "select count(*) from approval.rc_projetos_itens" 2>&1) || { echo "❌ conexão falhou: $N"; exit 1; }
  umask 077; printf "DATABASE_URL=%s\n" "$U" > /opt/backups/painel.env
  echo "✅ conectou (rc_projetos_itens tem $N linhas) — gravado em /opt/backups/painel.env"'

echo "⏳ rodando o primeiro backup do painel (pode levar alguns minutos)…"
ssh "$SRV" '/opt/backups/backup-supabase.sh painel /opt/backups/painel.env; tail -1 /opt/backups/backup.log'

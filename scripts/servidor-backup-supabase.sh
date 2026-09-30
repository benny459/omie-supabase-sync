#!/bin/bash
# Backup diário dos Supabase (Benny, 28/09/2026; revisto 30/09/2026).
# Dump lógico completo de cada produto, guardado NESTE servidor e espelhado
# na Storage Box (sync-offsite.sh).
#
# 30/09: o dump era só do schema public. Ficavam de fora os usuários (auth),
# o schema pinacolada da WW e — no painel — TUDO (approval/sales/orders/
# finance/bi/platform). Agora vai tudo o que não é interno do Supabase.
# O espelho dos buckets estava depois de um "exit" e nunca rodava.
set -u
PGDUMP=/usr/lib/postgresql/17/bin/pg_dump
BASE=/opt/backups
LOG=$BASE/backup.log
DATA=$(date +%Y%m%d-%H%M)
STATUS=0

# Schemas geridos pelo Supabase: recriados por ele num projeto novo.
EXCLUI=(pg_* information_schema extensions graphql graphql_public realtime _realtime
        supabase_functions supabase_migrations vault pgsodium pgsodium_masks net
        pgbouncer _analytics)

backup_um() {
  local nome="$1" envfile="$2"
  local url surl destino args=()
  if [ ! -f "$envfile" ]; then echo "$(date -Is) $nome PULADO: $envfile não existe" >> "$LOG"; return; fi
  url=$(grep "^DATABASE_URL=" "$envfile" | head -1 | cut -d= -f2- | tr -d "\"\r\n")
  if [ -z "$url" ]; then echo "$(date -Is) $nome ERRO: DATABASE_URL vazio em $envfile" >> "$LOG"; STATUS=1; return; fi
  # pooler em transaction mode (6543) não serve pra pg_dump; sessão é 5432
  surl=$(echo "$url" | sed "s/:6543/:5432/")
  for s in "${EXCLUI[@]}"; do args+=("--exclude-schema=$s"); done
  mkdir -p "$BASE/$nome"
  destino="$BASE/$nome/$nome-$DATA.dump"
  if $PGDUMP --format=custom --no-owner --no-privileges "${args[@]}" \
       --file="$destino" "$surl" 2>> "$LOG"; then
    echo "$(date -Is) $nome OK $(du -h "$destino" | cut -f1) $destino" >> "$LOG"
  else
    echo "$(date -Is) $nome ERRO no pg_dump" >> "$LOG"; rm -f "$destino"; STATUS=1; return
  fi
  # retenção: 7 diários; dumps de dia 01 (mensais) ficam 92 dias.
  # (WW = 2,5 GB/dump; 30 diários não cabem nos 32 GB livres do disco)
  find "$BASE/$nome" -name "$nome-*.dump" -mtime +7 ! -name "$nome-????01-*.dump" -delete
  find "$BASE/$nome" -name "$nome-????01-*.dump" -mtime +92 -delete
}

# Um só: backup-supabase.sh <nome> <envfile>  (usado ao configurar um banco novo)
if [ $# -eq 2 ]; then backup_um "$1" "$2"; exit $STATUS; fi

backup_um fourmidia  /opt/fm-agent/.env
backup_um waterworks /opt/ww-agent/.env
# painel.waterworks (Supabase omie-data, zodflkfdnjhtwcjutbjl) — env só com
# DATABASE_URL, gravado por scripts/set-painel-backup-url.sh do repo omie-supabase-sync
backup_um painel     /opt/backups/painel.env

# Espelho dos arquivos de Storage (buckets públicos, sem chave) — ver backup-storage.mjs
NODE_PATH=/opt/fm-agent/repo/node_modules node /opt/backups/backup-storage.mjs || STATUS=1
exit $STATUS

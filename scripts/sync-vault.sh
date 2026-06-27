#!/usr/bin/env bash
# Espelha .md do vault Obsidian (docs/obsidian/Service/) pra backup limpo
# (md-obsidian/). Roda antes de commit que tocar a doc.
set -euo pipefail
cd "$(dirname "$0")/.."
VAULT="docs/obsidian/Service"
BACKUP="md-obsidian"
[ -d "$VAULT" ] || { echo "❌ Vault não encontrado em $VAULT" >&2; exit 1; }
mkdir -p "$BACKUP"
rsync -av --delete \
  --exclude='.obsidian/' --exclude='.trash/' --exclude='.DS_Store' \
  --include='*/' --include='*.md' --exclude='*' \
  "$VAULT/" "$BACKUP/"
find "$BACKUP" -mindepth 1 -type d -empty -delete 2>/dev/null || true
echo "✅ Sync vault → $BACKUP concluído."

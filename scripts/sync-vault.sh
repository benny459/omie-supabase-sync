#!/usr/bin/env bash
set -euo pipefail
export PATH="/usr/bin:/bin:/usr/local/bin:$PATH"
cd "$(dirname "$0")/.."
VAULT="docs/obsidian/Service"
BACKUP="md-obsidian"
[ -d "$VAULT" ] || { echo "❌ Vault não encontrado em $VAULT" >&2; exit 1; }
mkdir -p "$BACKUP"
# Limpa md-obsidian preservando .gitkeep
find "$BACKUP" -type f ! -name '.gitkeep' -delete 2>/dev/null || true
# Copia recursivo dos .md, preservando estrutura, ignorando .obsidian/.trash
( cd "$VAULT" && find . -name '*.md' -not -path './.obsidian/*' -not -path './.trash/*' | while IFS= read -r f; do
  dest="../../../$BACKUP/${f#./}"
  mkdir -p "$(dirname "$dest")"
  cp "$f" "$dest"
done )
find "$BACKUP" -mindepth 1 -type d -empty -delete 2>/dev/null || true
echo "✅ Sync vault → $BACKUP concluído."

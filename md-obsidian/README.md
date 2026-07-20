# Vault Obsidian — Ecossistema Omie 2

Documentação modular dos 3 produtos que compartilham a base `omie-data`:

- **Painel** (painel.waterworks.com.br — Next 16)
- **Metabase** (metabase.waterworks — Hetzner)
- **Base Supabase** (`omie-data` — fonte compartilhada)

Segue o pattern **LLM-maintained wiki** (Karpathy).

## Como Usar

1. Abre este folder como vault no Obsidian (`File → Open vault → Open folder`)
2. Wikilinks `[[...]]` resolvem automaticamente (inclusive cross-folder `[[Painel/10-Avulsos]]`)
3. Tags no painel de tags — `#painel-waterworks`, `#metabase`, `#supabase`
4. **Graph View** mostra interligações entre produtos

## Estrutura

- [[_schema]] — Convenções (como o Claude opera o vault)
- [[index]] — Catálogo completo (com links por produto)
- [[log]] — Cronologia prefixada por produto (`[painel]`, `[metabase]`, `[base]`)
- [[00-Overview-Ecossistema]] — Visão macro
- `Painel/` — 8 páginas (rotas + features)
- `Metabase/` — 9 páginas (overview + catálogo + 7 dashboards)
- `Base-Supabase/` — 3 páginas (overview + views + RLS)
- `Sources/` — Raw sources (imutáveis, referenciados)

## Status

- **Inicializado:** 2026-06-27 (Fase A skeleton)
- **Reorg + Fase B iniciada:** 2026-07-20 (estrutura 3-folders, todas as rotas + dashboards documentados)
- **Fase B em andamento:** aprofundar páginas marcadas `#stub` (Owner, dashboards menos usados)

## Backup

Espelho limpo em `md-obsidian/` no root do repo. Sync via `scripts/sync-vault.sh` (executar antes do commit).

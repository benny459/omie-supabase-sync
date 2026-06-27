# Vault Obsidian — Painel-WaterWorks

Documentação modular do projeto Painel-WaterWorks seguindo o pattern de **LLM-maintained wiki** (ver [[Sources/karpathy-knowledge-base-pattern]] no vault do waterworks-app).

## Como Usar

1. Abre este folder como vault no Obsidian (`File → Open vault → Open folder`)
2. Wikilinks `[[...]]` resolvem automaticamente
3. Tags `#painel-waterworks` no painel de tags
4. **Graph View** mostra interligações

## Estrutura

- [[_schema]] — Convenções (como o Claude opera o vault)
- [[index]] — Catálogo
- [[log]] — Cronologia
- [[00-Overview-Painel-WaterWorks]] — Overview do projeto
- `Sources/` — Raw sources (artigos, gists, decisões)

## Status

**Inicializado em:** 2026-06-27 (Fase A — skeleton). Módulos a aprofundar na Fase B.

## Backup

Espelho limpo em `md-obsidian/` no root do repo. Sync via `scripts/sync-vault.sh`.

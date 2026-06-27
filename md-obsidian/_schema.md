# _schema.md — Convenções do Vault Painel-WaterWorks

> Schema do wiki seguindo o pattern de **LLM-maintained personal wiki** (Karpathy). Este arquivo diz ao Claude Code COMO operar o vault. Co-evolui com o uso.

## Estrutura

```
Service/                        ← vault Obsidian (a "wiki")
├── _schema.md                  ← este arquivo (convenções)
├── README.md                   ← intro humano
├── index.md                    ← catálogo (LLM consulta primeiro)
├── log.md                      ← cronológico append-only
├── 00-Overview-Painel-WaterWorks.md ← overview do projeto + mapa de módulos
├── 01-XX-<modulo>.md           ← páginas de módulos (fase B)
└── Sources/                    ← raw sources (imutáveis depois do ingest)
```

**Backup espelhado:** `md-obsidian/` no root do repo (mantido por `scripts/sync-vault.sh`).

## 3 Camadas (Karpathy)

| Camada | Onde | Quem edita |
|---|---|---|
| **Raw Sources** | `Sources/*.md` | Humano joga; LLM lê, nunca modifica |
| **Wiki** | `Service/*.md` (módulos) | LLM edita; humano consome |
| **Schema** | `_schema.md` | Co-evolução |

## Operações

### INGEST — source nova
1. Salva raw em `Sources/<nome-kebab>.md` com frontmatter (`source_type`, `author`, `url_original`, `ingested_at`)
2. Discute key takeaways com o humano
3. Atualiza wiki pages afetadas (links `[[Sources/...]]`)
4. Atualiza `index.md` se criou página nova
5. Append em `log.md`: `## [YYYY-MM-DD] ingest | <título>`
6. Roda `scripts/sync-vault.sh` + commit + push

### QUERY — humano perguntou
1. Lê `index.md` primeiro
2. Drill nas páginas relevantes
3. Responde com `[[wikilinks]]` pras fontes
4. Se a resposta é valiosa → propõe arquivar como página nova

### LINT — health-check
Contradições, claims antigos, órfãs, conceitos sem página, cross-refs faltando, gaps pra web search.

### UPDATE — mudança no app
1. Atualiza módulo afetado
2. Atualiza "Versões Recentes" no overview
3. Append em `log.md`: `## [YYYY-MM-DD] update | <módulo> vX.Y.Z`
4. Sync + commit + push

## Convenções

- **Wikilinks** `[[Nome-Do-Arquivo]]` sem .md
- **Tags** sempre no final, prefixo `#painel-waterworks` + sub-tag de módulo
- **Páginas** 80-250 linhas, dividir se passar
- **Sources** imutáveis depois do ingest
- **Sync** sempre antes do commit: `bash scripts/sync-vault.sh`

## Tags
#painel-waterworks #vault #schema

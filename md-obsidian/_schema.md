# _schema.md — Convenções do Vault (Painel · Metabase · Base)

> Schema do wiki seguindo o pattern de **LLM-maintained personal wiki** (Karpathy). Este arquivo diz ao Claude Code COMO operar o vault. Co-evolui com o uso.

## Estrutura

```
Service/                          ← vault Obsidian (a "wiki")
├── _schema.md                    ← este arquivo (convenções)
├── README.md                     ← intro humano
├── index.md                      ← catálogo (LLM consulta primeiro)
├── log.md                        ← cronológico append-only, prefixado [produto]
├── 00-Overview-Ecossistema.md    ← visão macro (painel + metabase + base)
├── Painel/                       ← painel.waterworks.com.br
│   ├── 00-Overview-Painel.md
│   ├── 10-Avulsos.md, 11-Aguardando-Liberacao.md, 12-Faturamento.md, 13-Daily-Avulsos.md
│   ├── 20-Projetos.md, 21-PCs.md, 22-Owner.md
│   └── 30-Configuracoes.md
├── Metabase/                     ← metabase.waterworks (allka-01)
│   ├── 00-Overview-Metabase.md
│   ├── 01-Catalogo-Cards.md
│   └── Dash-N-<nome>.md          ← 1 arquivo por dashboard (8 hoje)
├── Base-Supabase/                ← omie-data (fonte compartilhada)
│   ├── 00-Overview-Base.md
│   ├── Views-Canonicas.md
│   └── RLS-e-Permissoes.md
└── Sources/                      ← raw sources (imutáveis depois do ingest)
```

**Backup espelhado:** `md-obsidian/` no root do repo (mantido por `scripts/sync-vault.sh`).

## 3 Camadas (Karpathy)

| Camada | Onde | Quem edita |
|---|---|---|
| **Raw Sources** | `Sources/*.md` | Humano joga; LLM lê, nunca modifica |
| **Wiki** | `Service/**/*.md` (módulos) | LLM edita; humano consome |
| **Schema** | `_schema.md` | Co-evolução |

## Regra de ouro: 1 tela = 1 arquivo

- **Painel:** cada rota tem sua página (`/avulsos`, `/relatorios/faturamento`, etc)
- **Metabase:** cada dashboard tem sua página (`Dash-N-<nome>.md`)
- Features que atravessam múltiplas telas (ex: [[Painel/11-Aguardando-Liberacao|Aguardando Liberação]]) viram overlay page própria, referenciada pelas rotas afetadas
- Não misturar Painel e Metabase na mesma página — usar wikilinks entre elas

## Convenção do log

`## [YYYY-MM-DD] [produto] tipo | título`

- **produto:** `painel` · `metabase` · `base` · `meta` (ou combinações `painel+base`)
- **tipo:** `setup` · `fix` · `feature` · `ux` · `decisao` · `analise` · `deliverable` · `migracao` · `plan` · `reorg` · `ingest` · `update`

Grep útil:
```bash
grep '\[painel'   docs/obsidian/Service/log.md
grep '\[metabase' docs/obsidian/Service/log.md
```

## Operações

### INGEST — source nova
1. Salva raw em `Sources/<nome-kebab>.md` com frontmatter (`source_type`, `author`, `url_original`, `ingested_at`)
2. Discute key takeaways com o humano
3. Atualiza wiki pages afetadas (links `[[Sources/...]]`)
4. Atualiza `index.md` se criou página nova
5. Append em `log.md`: `## [YYYY-MM-DD] [produto] ingest | <título>`
6. Roda `scripts/sync-vault.sh` + commit + push

### QUERY — humano perguntou
1. Lê `index.md` primeiro
2. Drill nas páginas relevantes (Painel/, Metabase/, Base-Supabase/)
3. Responde com `[[wikilinks]]` pras fontes
4. Se a resposta é valiosa → propõe arquivar como página nova

### LINT — health-check
Contradições, claims antigos, órfãs, conceitos sem página, cross-refs faltando, gaps pra web search.

### UPDATE — mudança em produto
1. Atualiza página do módulo/dashboard afetado
2. Atualiza "Versões Recentes" no overview do produto (Painel/00-Overview-Painel.md ou Metabase/00-Overview-Metabase.md)
3. Append em `log.md`: `## [YYYY-MM-DD] [produto] tipo | <título> vX.Y.Z`
4. `bash scripts/sync-vault.sh` → commit → push

## Convenções

- **Wikilinks** `[[Nome-Do-Arquivo]]` sem .md · cross-folder usa `[[Painel/10-Avulsos]]`
- **Tags** sempre no final. Prefixos: `#painel-waterworks` (painel) · `#metabase` · `#supabase`. Sub-tag: `#modulo`, `#dashboard`, `#feature`, `#overview`, `#stub`, ...
- **Páginas** 80-250 linhas — dividir se passar
- **Sources** imutáveis depois do ingest
- **Sync** sempre antes do commit: `bash scripts/sync-vault.sh`
- **Stubs** OK — marcar com tag `#stub` até aprofundar

## Tags
#painel-waterworks #metabase #vault #schema

# Aguardando Liberação — Módulo /avulsos

> Estado transitório manual imposto em PV/OS avulsa quando o cliente pediu a venda mas ainda não formalizou com pedido de compra. Adiciona um alarme dedicado sem silenciar os demais. Auto-clear ao faturar no Omie.

**Introduzido em:** v1.6.5 (2026-07-17). **Última mudança:** v1.6.8 (2026-07-20).

## Motivação

Vendas avulsas seguem um fluxo padrão: cliente confirma → pedido de compra formal → nós faturamos. Existem casos em que o cliente **pede a venda mas atrasa em enviar o PC**. Nesse limbo:

- A venda não pode ser faturada
- Não é bug nem "vendedor esqueceu algo" — está bloqueado no cliente
- Antes: caía nos alarmes normais (Venda em atraso, Previsão vencida), confundindo com problemas internos

**Solução:** um status paralelo, marcado manualmente por usuário autorizado, que sinaliza "aguardando o cliente destravar". Continua contando os demais alarmes (aditivo) — se de fato há problema interno junto, isso continua visível.

## Modelo de Dados

### `platform.pv_liberacao_status` — overlay

Uma linha por `pv_os_label`, histórico preservado (não deleta ao desmarcar).

| Coluna | Tipo | Nota |
|---|---|---|
| `pv_os_label` | text PK | Ex: `PV1789`, `OS4587` |
| `empresa` | text | `SF` / `CD` / `WW` |
| `aguardando_liberacao` | bool default true | Ativo se `true`. Desmarcar seta `false` (mantém linha pra auditoria) |
| `marcado_por` | text | Email de quem marcou |
| `marcado_em` | timestamptz | |
| `desmarcado_por` | text | |
| `desmarcado_em` | timestamptz | |

Index parcial: `pv_liberacao_status_ativo_idx (empresa, pv_os_label) WHERE aguardando_liberacao = true`.

### `platform.user_module_roles.can_release_pv` — permissão

Nova coluna bool default false. Quem tem esta flag em `modulo='avulsos'` pode marcar/desmarcar. `is_admin=true` também passa.

**Seed inicial (2026-07-17):**
- `benny@waterworks.com.br` (via `is_admin=true`)
- `fernanda@waterworks.com.br` (via `can_release_pv=true` em avulsos)

Pra adicionar outro user autorizado:
```sql
UPDATE platform.user_module_roles
   SET can_release_pv = true
  FROM platform.user_profiles up
 WHERE up.id = user_module_roles.user_id
   AND up.email = 'novo@waterworks.com.br'
   AND user_module_roles.modulo = 'avulsos';
```

### RLS

RLS ativa. Policies criadas mas na prática **não são usadas em prod** — o endpoint `/api/avulsos/liberacao` faz check explícito de permissão + escreve via `supaAdmin` (service role bypass). Motivo: RLS via `.schema("platform")` do supabase-js estava dando 403 mesmo pra admin. Padrão idêntico às demais rotas admin do projeto.

## API

### `GET /api/avulsos/liberacao`

Retorna `{ map: { [pv_os_label]: true } }` — só os ativos. Consumo em massa pelo painel.

### `POST /api/avulsos/liberacao`

Body: `{ pv_os_label, empresa, aguardando }`. 
- Check: user precisa ser `is_admin` OU `can_release_pv=true` em avulsos.
- Upsert com `onConflict: "pv_os_label"`.
- Retorna 403 sem permissão, 500 em outros erros.

## UI — Painel `/avulsos`

### Cadeado clicável no header do bucket

Componente `LiberacaoToggle` (em `web/components/BoldAvulsosView.tsx`, fim do arquivo):
- **Estado destravado** (default): 🔓 num pill neutro cinza
- **Estado travado**: 🔒 num pill âmbar
- **Pending** (request em voo): mostra "…" e fica desabilitado — evita race com refetch cross-tab
- **Sem permissão**: pill fica visível se o PV está travado (readonly), mas desabilitado

Só renderiza pra `modulo === "avulsos"` e `bucket.groupKind === "pvos"`.

### Overlay 🔒 no dot do pipeline

Quando travado, o **dot PV/OS** do pipeline recebe um cadeado sobreposto no canto superior direito (com sombra branca pra destacar sobre a bolinha). Adicionado no `Pipeline` component via prop `lock?: boolean` no stage `pvos`.

### Alarme aditivo

`AlarmKind = "aguarda_liberacao"` no grupo Vendas (junto de `pvos_incompl`, `sem_projeto`, `venda`).

Detecção em `computeBucketAlarms(rows, todayStartMs, liberacaoSet?)`:
- Se `pvLabel ∈ liberacaoSet` → adiciona `aguarda_liberacao` ao Set
- **Aditivo:** os demais alarmes seguem sendo calculados normalmente
- **Auto-clear:** o check `isEncerrada` (dt_fat / num_nfe / etapa='Faturado') retorna cedo antes disso, então quando o PV é faturado no Omie o status some sozinho

### Cross-tab sync

`BroadcastChannel("pv-liberacao-updated")` propaga toggles em outras abas abertas do painel. Cada aba tem um listener no `useEffect` do `BoldAvulsosView` que refaz o fetch ao receber.

## Webex Daily

Nova linha no bloco 🛍️ VENDAS do daily:
```
- 🔒 Aguardando Liberação (cliente sem PC): N · R$ X (=) · [ver](...) — Fernanda
```

**Detector server-side** (`web/lib/avulsos-report.ts:computeBuckets`):
- Segunda query leve pra `platform.pv_liberacao_status WHERE aguardando_liberacao=true`
- Passa o Set pro `computeBuckets` que adiciona `aguarda_liberacao` aditivo
- Owner fixo: **Fernanda**
- Snapshot diário persiste em `platform.avulsos_daily_snapshots` como qualquer outro AlarmKind — entra no chart 14d de evolução (cor âmbar `#d97706`)

## Integração com app `/servicos` (outro repo)

Este repo (`omie-supabase-sync`) só cobre o painel. O app `/servicos` (repo separado, coordenado à parte) deve consumir a mesma tabela:

```sql
SELECT pv_os_label
  FROM platform.pv_liberacao_status
 WHERE aguardando_liberacao = true;
```

`pv_os_label` casa 1:1 (ex.: `PV1789`). O app pode fazer overlay similar (sobrescrever etapa, mostrar 🔒 etc) usando esses labels.

## Comportamento Confirmado

- ✅ **Aditivo** — não silencia demais alarmes (correção v1.6.6 após pedido explícito)
- ✅ **Auto-clear ao faturar** — quando o PV é fechado no Omie, o `isEncerrada` no `computeBucketAlarms` retorna cedo, então o cadeado some sem precisar desmarcar
- ✅ **Sem confirmação de diálogo** — 1 click alterna (removido em v1.6.8 após reporte de "3º click não trava" — provável cancel acidental)
- ✅ **Toggle bloqueado durante request** — evita double-click e race com cross-tab refetch

## Fontes

- Commits: `56c8941` (v1.6.4), `e0ab67f` (v1.6.5), `d0e03d2` (v1.6.6), `8226fbc` (v1.6.7), `64e46e2` (v1.6.8)
- Migration DB: `pv_liberacao_status_and_perms` (aplicada em 2026-07-17 no project `zodflkfdnjhtwcjutbjl`)

## Ver Também

- [[00-Overview-Painel-WaterWorks]] — mapa geral
- [[log]] — cronologia
- [[project_categorias_venda_omie]] — outra taxonomia canônica do módulo /avulsos

## Tags
#painel-waterworks #avulsos #feature #aguarda-liberacao

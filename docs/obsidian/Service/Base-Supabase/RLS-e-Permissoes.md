# RLS e Permissões — Base Supabase

> Modelo canônico de permissões (usado pelo painel). Metabase acessa direto via user Postgres read-only (fora deste modelo).

## Tabelas

### `platform.user_profiles`

| Coluna | Tipo | Uso |
|---|---|---|
| `id` | uuid PK | = `auth.uid()` do Supabase Auth |
| `email` | text | Único |
| `nome` | text | Display |
| `role` | text | Legacy — `admin` / `aprovador` / `comprador` / `viewer` |
| `is_admin` | bool | **Bypass tudo se true** |
| `ativo` | bool | Soft-delete |
| `permissions` | jsonb | Legacy override por módulo/bloco (usado como fallback) |
| `ui_prefs` | jsonb | Preferências salvas de UI (colunas visíveis, ordem, etc) |

### `platform.user_module_roles` — perms granulares (modelo novo, preferencial)

Uma row por (`user_id`, `modulo`). Modulos: `avulsos`, `projetos`, `pcs`.

| Coluna | Tipo | Descrição |
|---|---|---|
| `user_id` | uuid | FK → `user_profiles.id` |
| `modulo` | text | `avulsos`, `projetos`, `pcs` |
| `can_edit_pv` | bool | Editar campos do PV/OS |
| `can_edit_rc` | bool | Editar RC |
| `can_edit_pc` | bool | Editar PC |
| `can_approve` | bool | Aprovar (só faz sentido em `pcs`) |
| `can_edit_log` | bool | Editar logística/materiais |
| `can_view_values` | bool | Ver R$ (senão mostra "R$ •••••") |
| `can_view_margin` | bool | Ver M.B. e badges PC vs RC |
| **`can_release_pv`** | bool | Marcar/desmarcar [[../Painel/11-Aguardando-Liberacao]] (só `avulsos`) — novo v1.6.5 |
| `approval_ceiling_brl` | numeric | Alçada individual em R$ (só `pcs`) |
| `weekly_budget_brl` | numeric | Teto semanal rolling 7d em R$ (só `pcs`) |

## Helper canônico (`web/lib/permissions.ts`)

- `canEdit(user, modulo, block)` → bool
- `canApprove(user, modulo, block='aprovacao')` → bool
- `canApproveValue(user, modulo, valor)` → `{ ok: true } | { ok: false, reason, ceiling?, weeklyRemaining? }`
- `canReleasePv(user)` → bool (novo v1.6.5)
- `canViewValues(user, modulo)` → bool
- `canViewMargin(user, modulo)` → bool

Lógica (função `effective(user, modulo, block)`):
1. Se `is_admin=true` → libera tudo
2. Se tem row em `user_module_roles` pro modulo → usa as flags dela (preferencial)
3. Fallback pra matriz DEFAULTS por role (legacy) + override JSONB `user_profiles.permissions`

## Users hoje (seed inicial)

- `benny@waterworks.com.br` — `is_admin=true`
- `fernanda@waterworks.com.br` — `role='aprovador'` + `can_release_pv=true` em `avulsos`
- (demais users com role appropriada)

Pra dar permissão específica:

```sql
-- Permitir X marcar Aguardando Liberação
UPDATE platform.user_module_roles
   SET can_release_pv = true
  FROM platform.user_profiles up
 WHERE up.id = user_module_roles.user_id
   AND up.email = 'novo@waterworks.com.br'
   AND user_module_roles.modulo = 'avulsos';
```

## RLS (Row-Level Security)

Ativa em várias tabelas `platform.*`. Padrão comum:

- **Read:** `authenticated` livre (`USING (true)`)
- **Write:** admin OR user_module_roles.can_X = true

**Importante:** em produção, RLS via `.schema("platform")` do supabase-js se mostrou frágil pra mutações — endpoints admin do painel usam padrão: check explícito de perm + `supaAdmin()` (service role, bypass RLS). Ver `/api/avulsos/liberacao/route.ts` como referência (v1.6.7+).

## Middleware da rota

- Rotas `/api/admin/*` → protegidas por `requireAdmin()` (`web/app/api/admin/_guard.ts`)
- Rotas `/api/approvals/*` → check via `canApprove` server-side (`/api/approvals/set-status`)
- Server components layout (`web/app/(app)/layout.tsx`) carrega perms via `supaServer()` → `UserPermsProvider`
- Cliente consome via `useUserPerms()` hook

## Ver Também

- [[00-Overview-Base]]
- [[../Painel/30-Configuracoes]] — admin UI
- [[../Painel/11-Aguardando-Liberacao]] — feature que introduziu `can_release_pv`
- [[../Painel/21-PCs]] — usa alçadas de aprovação

## Tags
#supabase #rls #permissoes #auth

# /configuracoes — Configurações

> Admin: user roles, permissões, tabelas admin, exclusões, sync manual.

## Rotas

- `/configuracoes` — home admin
- `/configuracoes/tabelas` — visualização de tabelas admin (excluded_pv_os, user_module_roles, etc)

## APIs admin

Todas gated por `requireAdmin()` (guard em `web/app/api/admin/_guard.ts`):

- `/api/admin/user-roles` — GET+POST `platform.user_module_roles`
- `/api/admin/invite` — enviar convite pra novo user
- `/api/admin/delete-user` — remove user
- `/api/admin/update-permissions` — patch em `user_profiles.permissions`
- `/api/admin/exclude-pv-os` — POST `{ action: 'exclude'|'restore', empresa, pv_os_label, motivo? }` → `platform.excluded_pv_os`
- `/api/admin/fetch-omie` — sync manual de PV/OS/PC do Omie
- `/api/admin/raw-table` — inspetor de tabelas cruas
- `/api/admin/run-details` — logs de execução do sync
- `/api/sync-now` + `/api/sync-now/status` — botão "Sync agora" no header

## Sistema de perms

Ver [[../Base-Supabase/RLS-e-Permissoes]] pra modelo canônico. Colunas de `platform.user_module_roles`:

- `can_edit_pv`, `can_edit_rc`, `can_edit_pc`, `can_edit_log` — edição de campos
- `can_approve` — aprovação (com alçada `approval_ceiling_brl` + teto `weekly_budget_brl` no modulo=pcs)
- `can_view_values`, `can_view_margin` — gates de visualização (esconde R$ e M.B.)
- `can_release_pv` — [[11-Aguardando-Liberacao|Aguardando Liberação]] (v1.6.5+, só modulo=avulsos)

**Users hoje (seed inicial):**
- benny@waterworks.com.br — `is_admin=true`
- fernanda@waterworks.com.br — `role='aprovador'` + `can_release_pv=true` em avulsos
- (demais users conforme cadastro)

## Ver Também

- [[../Base-Supabase/RLS-e-Permissoes]]
- [[11-Aguardando-Liberacao]] — feature que usa `can_release_pv`
- [[21-PCs]] — alçadas de aprovação

## Tags
#painel-waterworks #configuracoes #admin #modulo

# /pcs — Pedidos de Compra

> Aprovação + tracking de PCs (Pedidos de Compra). Mesmo motor do [[10-Avulsos]] com `modulo="pcs"`.

## Rota e componentes

- **Rota:** `/pcs`
- **Componente principal:** `BoldAvulsosView` (`modulo="pcs"`)
- **View DB:** `approval.v_pc_pcs`

## Difere de /avulsos em:

- **Bucket por PC individual** (não por PV/OS). Group key = `pc_numero`.
- **Fluxo de aprovação centralizado:**
  - Alçadas: `approval_ceiling_brl` por user (individual) + `weekly_budget_brl` (teto semanal, rolling 7d)
  - Endpoint `/api/approvals/set-status` faz check completo (perm + ceiling + weekly budget consumido)
  - Batch actions: aprovar/rejeitar em massa (toolbar flutuante quando > 0 selecionados)
- Pipeline stages relevantes: PV/OS · RC · **PC** (destacado) · Aprovação · Materiais · Saída
- Filtro forte por status (`aprovados`, `nao_aprovados`, `pendentes`, `atrasados`)

## Tabelas / views associadas

- `orders.pedidos_compra` — dados Omie sync
- `approval.v_pc_pcs` — enriched view
- `platform.user_module_roles.approval_ceiling_brl` + `weekly_budget_brl` (só usado em modulo=pcs)

## Ver Também

- [[10-Avulsos]] — motor compartilhado
- [[30-Configuracoes]] — onde configurar alçadas dos aprovadores
- [[../Base-Supabase/RLS-e-Permissoes]] — modelo canônico

## Tags
#painel-waterworks #pcs #compras #modulo

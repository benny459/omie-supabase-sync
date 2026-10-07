-- 107 · Budget de MATERIAIS do projeto separado do custo total (07/10/26, Benny — PJ361).
--
-- rc_projetos_budget.valor_budget é o custo TOTAL (materiais + mão de obra + despesas):
-- a sql/18 (plano_auto_crm) preenche sozinho, "CRM (automático)", e o Fluxo de caixa usa
-- como teto. A Lista de materiais, o cartão de Projetos e a regra de aprovação de PC
-- mostravam esse total como "Budget de materiais" (PJ361: R$ 81.001,25 em vez dos
-- R$ 60.879,25 de materiais da RC).
--
-- Regra nova (no código, lib/lista-pc-completar.ts e /api/rc-projetos/budget/summary):
--   budget de materiais = valor_budget_materiais (definido no painel, "editar" da Lista)
--                         senão projeto_plano.custo_materiais (total de materiais da RC).
-- valor_previsto_custos não serve: vem do upload do Fluxo Financeiro ("Previsto Custos",
-- custo total previsto). O valor_budget segue intocado para o Fluxo.

alter table approval.rc_projetos_budget
  add column if not exists valor_budget_materiais numeric,
  add column if not exists budget_materiais_por   text,
  add column if not exists budget_materiais_em    timestamptz;

-- Linha criada só para o budget de materiais (projeto ainda sem teto do Fluxo).
alter table approval.rc_projetos_budget alter column valor_budget drop not null;

comment on column approval.rc_projetos_budget.valor_budget is
  'Custo TOTAL previsto (materiais + mão de obra + despesas) — teto do Fluxo de caixa. Não é o budget de materiais.';
comment on column approval.rc_projetos_budget.valor_budget_materiais is
  'Budget de materiais definido no painel (Lista de materiais › editar). Vazio = total de materiais da RC (projeto_plano.custo_materiais).';

-- OPCIONAL (decisão do Benny): 3 projetos sem plano do CRM tinham o valor_budget
-- digitado à mão (não "CRM (automático)") e era esse número que a Lista e a aprovação
-- usavam: 9907655828 (R$ 200.000), 9829491988 (R$ 110.831,98), 12571925952 (R$ 34.544).
-- Sem plano, eles ficam SEM budget de materiais até alguém definir — e PC deles só
-- administrador aprova. Para manter o comportamento de hoje, descomente:
-- update approval.rc_projetos_budget
--    set valor_budget_materiais = valor_budget, budget_materiais_por = atualizado_por, budget_materiais_em = now()
--  where valor_budget_materiais is null and valor_budget is not null
--    and coalesce(atualizado_por, '') <> 'CRM (automático)'
--    and not exists (select 1 from approval.projeto_plano p
--                     where p.empresa = rc_projetos_budget.empresa and p.codigo_projeto = rc_projetos_budget.codigo_projeto
--                       and p.custo_materiais is not null);

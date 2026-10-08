-- 08/10/26 — "Projetos ativos" (pedido do Benny): Operação › Projetos mostra, por padrão, só os
-- projetos que alguém marcou como ativos (★), e um menu no topo lista esses projetos em ordem
-- decrescente para pular direto para um deles.
--
-- Por que não finance.projetos.inativo: é espelho do cadastro do Omie (403 de 424 projetos da SF
-- estão "ativos" lá) e o sync sobrescreve; não é a escolha do Benny.
-- Fica em approval.rc_projetos_budget, a linha por projeto que já guarda as flags de escopo
-- (frete_incluso, faturamento_direto…) — compartilhada por todo mundo, com o mesmo RLS de escrita
-- (admin / comprador / quem escreve em projetos). Projeto sem linha = não ativo.

alter table approval.rc_projetos_budget
  add column if not exists ativo     boolean not null default false,
  add column if not exists ativo_por text,
  add column if not exists ativo_em  timestamptz;

create index if not exists rc_projetos_budget_ativo_idx
  on approval.rc_projetos_budget (empresa, codigo_projeto) where ativo;

comment on column approval.rc_projetos_budget.ativo is
  'Projeto marcado como ativo (★) em Operação › Projetos — filtro padrão "Só ativos" e menu de projetos ativos.';

notify pgrst, 'reload schema';

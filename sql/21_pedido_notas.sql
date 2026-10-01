-- Anotações por pedido na tela de Operação (pedido do Benny, 01/10/2026).
-- Um "balãozinho" no início de cada pedido: qualquer usuário do painel escreve,
-- e fica registado quem escreveu e quando. Só leitura/escrita pela API do painel
-- (/api/pedidos/notas, com service role) — RLS ligada e sem policies, então o
-- cliente (anon/authenticated) não lê nem escreve direto.
--
-- `pedido` é o rótulo do cartão: PV/OS em Avulsos, nome do projeto em Projetos,
-- nº do PC em PCs Standalone. `modulo` separa os três.

create table if not exists platform.pedido_notas (
  id          bigserial primary key,
  empresa     text not null default 'SF',
  modulo      text not null check (modulo in ('avulsos', 'projetos', 'pcs')),
  pedido      text not null,
  texto       text not null check (length(btrim(texto)) between 1 and 2000),
  autor_id    uuid,
  autor_nome  text,
  autor_email text,
  criado_em   timestamptz not null default now()
);

create index if not exists pedido_notas_modulo_pedido_idx
  on platform.pedido_notas (modulo, pedido, criado_em);

alter table platform.pedido_notas enable row level security;
revoke all on platform.pedido_notas from anon, authenticated;

-- O schema platform não dá privilégio automático a tabelas novas: sem isto a API
-- falhava com "permission denied for sequence pedido_notas_id_seq".
grant select, insert, update, delete on platform.pedido_notas to service_role;
grant usage, select on sequence platform.pedido_notas_id_seq to service_role;

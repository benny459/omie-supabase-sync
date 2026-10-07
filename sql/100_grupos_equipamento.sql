-- 100 · Grupos de equipamento (07/10/26) — "necessário em" por grupo na lista de materiais.
--
-- Pedido do Benny: a lista de materiais já se agrupa por Equipamento (vem da coluna
-- Equipamento da CP), e cada linha tinha o seu "Necessário em", sempre vazio. Agora:
-- • platform.equipamento_grupo — cadastro simples (Cadastros › Grupos de equipamento):
--   nomes padronizados entre projetos ("Filtro Multimeios", "Osmose Reversa", "Geral").
--   A lista continua aceitando texto livre; o cadastro só sugere o nome padrão.
-- • A data "necessário em" do grupo NÃO tem tabela: fica nas próprias linhas
--   (approval.rc_projetos_itens.data_necessaria, que a RC — "data limite" — e o fluxo
--   já leem). A data do grupo é a data da maioria das linhas dele; definir a data do
--   grupo preenche as linhas que seguiam o grupo; linha com outra data é "data própria".
-- A tela funciona sem esta migração (sugere os nomes já usados nos projetos); com ela,
-- o cadastro passa a valer. Aplicada em 07/10/26 como migração p100_grupos_equipamento.

create table if not exists platform.equipamento_grupo (
  id bigserial primary key,
  nome text not null,
  nome_norm text not null,
  descricao text,
  ativo boolean not null default true,
  criado_por text, criado_em timestamptz not null default now(),
  atualizado_por text, atualizado_em timestamptz not null default now()
);
create unique index if not exists equipamento_grupo_nome_norm on platform.equipamento_grupo (nome_norm);
alter table platform.equipamento_grupo enable row level security;
grant all on platform.equipamento_grupo to service_role;
grant usage, select on sequence platform.equipamento_grupo_id_seq to service_role;

insert into platform.equipamento_grupo (nome, nome_norm, descricao, criado_por)
select v.nome, approval._norm_item(v.nome), v.descr, 'migração p100'
  from (values ('Geral', 'Itens comuns ao projeto, sem equipamento específico'),
               ('Filtro Multimeios', null), ('Filtro de Carvão', null), ('Abrandador', null),
               ('Osmose Reversa', null), ('Looping', 'Anel de distribuição / recirculação')) v(nome, descr)
on conflict (nome_norm) do nothing;

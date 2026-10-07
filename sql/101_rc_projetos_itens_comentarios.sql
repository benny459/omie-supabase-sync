-- 101 · Comentários nas linhas da lista de materiais (07/10/26).
--
-- Pedido do Benny: a coluna larga "Observação" sai da grade; cada linha ganha um
-- balão 💬 no fim com uma conversa curta — quem escreveu e quando.
-- • approval.rc_projetos_itens_comentarios: um comentário por linha da lista.
--   Some junto com a linha (on delete cascade).
-- • A observação que cada linha já tinha entra como 1º comentário, assinado por
--   quem editou a lista por último (senão "importado").
-- • rc_projetos_itens.observacao continua existindo: o colar do Excel com coluna
--   Observação e a planilha seguem gravando nela, e a tela mostra esse texto como
--   comentário enquanto ele não estiver na conversa.
-- Leitura e escrita só pelo servidor (/api/rc-projetos/comentarios, service_role).
-- Migração p101_rc_projetos_itens_comentarios — aplicar depois do OK do Benny.

create table if not exists approval.rc_projetos_itens_comentarios (
  id bigserial primary key,
  item_id uuid not null references approval.rc_projetos_itens(id) on delete cascade,
  autor text not null,
  texto text not null check (length(trim(texto)) > 0),
  criado_em timestamptz not null default now(),
  origem text not null default 'tela'   -- 'tela' | 'observacao' (migrada/colada)
);
create index if not exists rc_projetos_itens_comentarios_item on approval.rc_projetos_itens_comentarios (item_id, criado_em);
alter table approval.rc_projetos_itens_comentarios enable row level security;
grant all on approval.rc_projetos_itens_comentarios to service_role;
grant usage, select on sequence approval.rc_projetos_itens_comentarios_id_seq to service_role;

-- observação existente → 1º comentário (idempotente)
insert into approval.rc_projetos_itens_comentarios (item_id, autor, texto, criado_em, origem)
select i.id, coalesce(nullif(trim(i.atualizado_por), ''), 'importado'), trim(i.observacao),
       coalesce(i.atualizado_em, i.criado_em, now()), 'observacao'
  from approval.rc_projetos_itens i
 where nullif(trim(i.observacao), '') is not null
   and not exists (select 1 from approval.rc_projetos_itens_comentarios c
                    where c.item_id = i.id and c.texto = trim(i.observacao));

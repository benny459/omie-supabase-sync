-- 156 · Ponte PC → Lista de materiais (09/10/26, pedido do Benny)
--
-- "Muitas vezes preciso de material urgente para um projeto e faço direto a compra (PC)
-- linkada ao projeto. Tem que ter uma ponte: se o pedido não nasceu da lista (os itens do
-- PC não estão na lista), sincroniza sozinho e insere esses itens na lista. A fonte já não
-- é RC, é PC."
--
-- Só ADITIVA:
--   · approval.rc_projetos_itens.origem — 'rc' | 'novo' | 'pc' (NULL = linha antiga: a tela
--     continua deduzindo RC × novo como antes). 'pc' = linha trazida de um PC pela ponte —
--     selo "PC" na coluna Orig. da lista.
--   · approval.rc_projetos_pc_ponte — o RASTRO da ponte, um registro por item de PC tratado.
--     É o que a deixa idempotente: item de PC já tratado nunca volta a entrar (nem quando
--     alguém exclui a linha de propósito ou desfaz o vínculo); a chave primária no item do
--     PC impede duas execuções simultâneas de criarem duas linhas.
--       status 'inserido'           → virou linha nova da lista (lista_id)
--              'ligado'             → já havia uma linha sem PC com o mesmo código/descrição:
--                                     a linha foi ligada ao item (não duplica)
--              'removido_cancelado' → o PC foi cancelado e a linha (que só existia por causa
--                                     dele) foi para a lixeira; se o cancelamento for
--                                     desfeito, a ponte traz o item de novo.
-- Nada aqui chama o Omie.

alter table approval.rc_projetos_itens add column if not exists origem text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rc_projetos_itens_origem_chk') then
    alter table approval.rc_projetos_itens add constraint rc_projetos_itens_origem_chk
      check (origem is null or origem in ('rc', 'novo', 'pc'));
  end if;
end $$;
comment on column approval.rc_projetos_itens.origem is
  'rc = veio da RC · novo = digitado na lista · pc = trazido de um PC do projeto pela ponte (compra direta, sql/156). NULL = linha antiga (a tela deduz RC × novo).';

create table if not exists approval.rc_projetos_pc_ponte (
  pc_item_id     bigint primary key,
  empresa        text not null,
  codigo_projeto bigint not null,
  pedido_id      bigint,
  pc_numero      text not null,
  lista_id       uuid,
  status         text not null check (status in ('inserido', 'ligado', 'removido_cancelado')),
  por            text,
  criado_em      timestamptz not null default now(),
  atualizado_em  timestamptz not null default now()
);
create index if not exists rc_projetos_pc_ponte_projeto_idx on approval.rc_projetos_pc_ponte (empresa, codigo_projeto);
comment on table approval.rc_projetos_pc_ponte is
  'Ponte PC → lista (sql/156): itens de PC do projeto já tratados (inserido / ligado / removido_cancelado). Idempotência da ponte.';

revoke all on approval.rc_projetos_pc_ponte from public, anon, authenticated;
grant all on approval.rc_projetos_pc_ponte to service_role;

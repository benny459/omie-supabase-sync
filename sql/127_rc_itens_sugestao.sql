-- 08/10/26 — Lista de materiais: a SUGESTÃO de código do catálogo passa a ser gravada
-- na linha (spec C, "ora funciona, ora não"). Antes ela vivia só na memória da tela e
-- sumia a cada recarga/remontagem da grade (gerar PC, vincular, salvar, F5); a recusa
-- também não ficava gravada e a sugestão voltava.
--
--   sug_*       o item do nosso estoque sugerido (código, descrição, fornecedor, nota)
--   sug_status  'pendente' (à espera de ✓/✕) · 'aceita' (virou cat_*) · 'recusada'
--               (o casamento automático não sugere de novo para esta linha)
--
-- Só colunas novas, todas nulas: nada muda para quem ainda não grava sugestão.
alter table approval.rc_projetos_itens
  add column if not exists sug_ncod_prod  bigint,
  add column if not exists sug_codigo     text,
  add column if not exists sug_descricao  text,
  add column if not exists sug_fornecedor text,
  add column if not exists sug_score      numeric,
  add column if not exists sug_status     text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rc_projetos_itens_sug_status_chk') then
    alter table approval.rc_projetos_itens
      add constraint rc_projetos_itens_sug_status_chk
      check (sug_status is null or sug_status in ('pendente', 'aceita', 'recusada'));
  end if;
end $$;

comment on column approval.rc_projetos_itens.sug_status is
  'Sugestão de código do catálogo: pendente | aceita | recusada (recusada = o casamento automático pula a linha).';

notify pgrst, 'reload schema';

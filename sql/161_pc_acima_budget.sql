-- 09/10/26 — PC de projeto aprovado ACIMA do budget (Benny: "O Marcelo me avisa, mas tem sim
-- autonomia para aprovar para projetos"). Aditivo; o código funciona sem esta migração:
--   • PC do Omie (approval.approvals): o registro vai em custom_fields.acima_budget — já existe.
--   • PC do painel (compras.pedidos): sem a coluna nova, só a linha "⚠️ Aprovado acima do
--     budget…" no histórico do PC; com ela, a marca aparece também na linha de Operação › Projetos.
-- A chave projetos.aprovar_acima_budget já foi inserida no catálogo em produção em 09/10/26
-- (o insert abaixo é idempotente).

insert into platform.permissoes_catalogo (chave, modulo, rotulo, descricao, ordem)
values ('projetos.aprovar_acima_budget', 'projetos', 'Aprovar PC de projeto acima do budget',
        'PC de projeto de obra (PJ) que estoura o budget de materiais: aprova com aviso e motivo; o Benny é avisado no Webex', 400)
on conflict (chave) do nothing;

-- 1) marca no PC do painel: {projeto, estouro, total, teto, motivo, aviso, por, por_id, em}
alter table compras.pedidos add column if not exists aprov_acima_budget jsonb;

create or replace function orders.compras_marcar_acima_budget(p_id bigint, p_info jsonb)
returns void language sql security definer set search_path = compras, public as $$
  update compras.pedidos set aprov_acima_budget = p_info where id = p_id
$$;
revoke all on function orders.compras_marcar_acima_budget(bigint, jsonb) from public, anon, authenticated;
grant execute on function orders.compras_marcar_acima_budget(bigint, jsonb) to service_role;

-- 2) Operação › Projetos lê custom_fields: o PC nativo passa a levar acima_budget junto
--    (colunas e tipos não mudam; troca só a expressão do custom_fields, na definição ATUAL).
do $$
declare def text; novo text;
begin
  def := rtrim(pg_get_viewdef('approval.v_pc_nativos'::regclass, true), E' \n;');
  if def like '%aprov_acima_budget%' then return; end if;
  novo := regexp_replace(def,
    $re$jsonb_build_object\('compras_id', (p\.)?id, 'origem', 'compras', 'link', '/erp/compras'\)$re$,
    $rep$(jsonb_build_object('compras_id', \1id, 'origem', 'compras', 'link', '/erp/compras') || jsonb_strip_nulls(jsonb_build_object('acima_budget', \1aprov_acima_budget)))$rep$);
  if novo = def then raise exception 'v_pc_nativos: expressão do custom_fields não encontrada — revisar'; end if;
  execute 'create or replace view approval.v_pc_nativos as ' || novo;
end $$;

select sales.refresh_mv_pc_lists();

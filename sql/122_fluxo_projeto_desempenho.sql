-- 122 · Fluxo de caixa do projeto: as funções do previsto/execução sem plano genérico (07/10/26).
--
-- /api/rc-projetos/fluxo levava 5,5–10 s (e estourava o statement timeout sob carga).
-- Medido em PJ361/PJ366:
--   bi.projeto_fluxo_previsto  2,7–3,7 s     bi.projeto_execucao  2,8–6,1 s
-- A MESMA consulta, com os valores no lugar dos parâmetros, roda em 0,3 s. A causa: são
-- funções LANGUAGE sql com SET search_path (não são "inlinadas"), então o Postgres 17
-- planeja o corpo com $1/$2 genéricos — e approval.v_pc_projetos só consegue empurrar o
-- filtro do projeto para dentro quando conhece o valor (genérico: 2,2 s, monta as 6,4 mil
-- linhas da view e filtra no fim).
--
-- Correção sem mudar o resultado: cada função vira um invólucro plpgsql que roda o
-- MESMO corpo SQL (lido do catálogo, não copiado à mão) com RETURN QUERY EXECUTE … USING —
-- consulta dinâmica é planejada com os valores reais. As colunas saem com o tipo declarado.
-- bi.projeto_fluxo_derivado entra junto: o previsto o chama, e ele também lê a view.
--
-- Mais um índice: finance.pesquisa_titulos não tinha índice por projeto (seq scan de 73 mil
-- linhas, ~170 ms, repetido em várias funções do fluxo).
--
-- Idempotente: só converte o que ainda é LANGUAGE sql. As definições originais ficam em
-- bi._fn_backup_122 para voltar atrás (execute a coluna def).

create index if not exists idx_pt_cod_projeto on finance.pesquisa_titulos (cod_projeto, empresa);

create table if not exists bi._fn_backup_122 (proname text primary key, def text not null, em timestamptz default now());

do $do$
declare
  r record;
  v_body text;
  v_sel text;
  v_alias text;
begin
  for r in
    select p.oid, p.proname, p.prosrc, pg_get_function_arguments(p.oid) as args,
           pg_get_function_result(p.oid) as res, p.proargnames, p.proallargtypes, p.proargmodes
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'bi'
       and p.proname in ('projeto_fluxo_derivado', 'projeto_fluxo_previsto', 'projeto_execucao')
       and p.prolang = (select oid from pg_language where lanname = 'sql')
       and pg_get_function_identity_arguments(p.oid) = 'p_codigo_projeto bigint, p_empresa text'
  loop
    insert into bi._fn_backup_122 (proname, def) values (r.proname, pg_get_functiondef(r.oid))
      on conflict (proname) do nothing;

    v_body := regexp_replace(r.prosrc, ';\s*$', '');
    v_body := replace(replace(v_body, 'p_codigo_projeto', '$1'), 'p_empresa', '$2');

    select string_agg(format('q.%I::%s', a.nome, format_type(a.tipo, null)), ', ' order by a.ord),
           string_agg(format('%I', a.nome), ', ' order by a.ord)
      into v_sel, v_alias
      from unnest(r.proargnames, r.proallargtypes, r.proargmodes) with ordinality as a(nome, tipo, modo, ord)
     where a.modo = 't';

    execute format(
      'create or replace function bi.%I(%s) returns %s language plpgsql stable set search_path to %L as %L',
      r.proname, r.args, r.res, '',
      format('begin return query execute %L using p_codigo_projeto, p_empresa; end',
             'select ' || v_sel || ' from (' || v_body || E'\n) q(' || v_alias || ')'));
  end loop;
end
$do$;

-- Conferência depois de aplicar (deve dar 0,2–0,6 s cada, mesmo resultado de antes):
--   select * from bi.projeto_execucao(12580407532, 'SF');
--   select * from bi.projeto_fluxo_previsto(9000000000013, 'SF');

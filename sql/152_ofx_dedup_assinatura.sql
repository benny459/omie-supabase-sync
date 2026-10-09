-- 09/10/26 — Reimportar o extrato do Bradesco duplicava lançamentos: o banco gera FITID novo
-- para o mesmo lançamento a cada arquivo (PIX 6.000 de 06/10: N10365 num arquivo, N10169 no outro;
-- mesma data, valor, CHECKNUM 528325 e histórico). Agora um movimento é "já importado" se bater o
-- FITID OU a assinatura (data, valor, nº do documento, histórico). Conta por quantidade: duas
-- tarifas iguais no mesmo dia continuam entrando como duas (só entra o que excede o que já existe).
create or replace function finance.ofx_importar(p_empresa text, p_cod_cc bigint, p_banco text, p_conta text,
  p_arquivo text, p_usuario text, p_movs jsonb)
returns jsonb language plpgsql security definer set search_path to 'finance', 'public' as $function$
declare n_novos int; n_total int := jsonb_array_length(coalesce(p_movs, '[]'::jsonb));
begin
  if not exists (select 1 from finance.contas_correntes where empresa = p_empresa and cod_cc = p_cod_cc) then
    raise exception 'Conta corrente % / % não existe', p_empresa, p_cod_cc;
  end if;
  with arq as (
    select m, (m->>'data')::date dt, (m->>'valor')::numeric vl, coalesce(nullif(trim(m->>'checknum'), ''), '') ck,
           upper(regexp_replace(coalesce(m->>'memo', ''), '\s+', ' ', 'g')) me
      from jsonb_array_elements(p_movs) m
     where not exists (select 1 from finance.banco_movimentos b
                        where b.empresa = p_empresa and b.cod_cc = p_cod_cc and b.fitid = m->>'fitid')
  ), num as (
    select a.*, row_number() over (partition by dt, vl, ck, me order by m->>'fitid') k from arq a
  ), novos as (
    select n.m from num n
     where n.k > (select count(*) from finance.banco_movimentos b
                   where b.empresa = p_empresa and b.cod_cc = p_cod_cc and b.data = n.dt and b.valor = n.vl
                     and coalesce(nullif(trim(b.checknum), ''), '') = n.ck
                     and upper(regexp_replace(coalesce(b.memo, ''), '\s+', ' ', 'g')) = n.me
                     and coalesce(b.ignorado_motivo, '') <> 'duplicidade')
  ), ins as (
    insert into finance.banco_movimentos (empresa, cod_cc, banco, conta_banco, fitid, fitid_original, data, valor, tipo,
                                          memo, nome, refnum, checknum, origem, arquivo, importado_por, importado_em)
    select p_empresa, p_cod_cc, p_banco, p_conta, m->>'fitid', m->>'fitid_original', (m->>'data')::date,
           (m->>'valor')::numeric, m->>'tipo', m->>'memo', m->>'nome', m->>'refnum', m->>'checknum',
           case when (m->>'fitid') like 'csv:%' then 'csv' else 'ofx' end, p_arquivo, p_usuario, now()
      from novos
    on conflict (empresa, cod_cc, fitid) do nothing
    returning 1)
  select count(*) into n_novos from ins;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'ofx_importar', 'conta', p_empresa || ':' || p_cod_cc,
          jsonb_build_object('arquivo', p_arquivo, 'novos', n_novos, 'duplicados', n_total - n_novos));
  return jsonb_build_object('novos', n_novos, 'duplicados', n_total - n_novos, 'total', n_total);
end $function$;

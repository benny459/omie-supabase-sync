-- 06/10/26: visão geral da conciliação bancária — todas as contas com extrato no período,
-- % conciliado, pendentes (qtd/R$, entradas × saídas), extrato até e último arquivo importado.
-- Aplicado como migração p96_conciliacao_resumo. Lido por GET /api/financeiro/conciliacao?resumo=1.
create or replace function finance.conciliacao_resumo(p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path to 'finance', 'public' as $$
with m as (
  select mv.empresa, mv.cod_cc, mv.valor, mv.data, mv.ignorado, mv.conciliado_omie, mv.transferencia_par, mv.importado_em,
         coalesce((select sum(b.valor - coalesce(b.desconto,0) + coalesce(b.juros,0) + coalesce(b.multa,0))
                     from finance.baixas b where b.movimento_id = mv.id and b.estornado_em is null), 0) as casado
    from finance.banco_movimentos mv where mv.data between p_de and p_ate
),
e as (
  select m.*, case when m.ignorado then 'ignorado' when m.conciliado_omie then 'omie'
                   when m.casado >= abs(m.valor) - 0.004 then 'conciliado'
                   when m.casado > 0 then 'parcial' else 'pendente' end as estado from m
),
ag as (
  select empresa, cod_cc, count(*) n,
         count(*) filter (where estado in ('conciliado','omie','ignorado')) resolvidos,
         count(*) filter (where estado = 'conciliado') conciliados, count(*) filter (where estado = 'omie') omie,
         count(*) filter (where estado = 'ignorado') ignorados,
         count(*) filter (where estado = 'ignorado' and transferencia_par is not null) transferencias,
         count(*) filter (where estado in ('pendente','parcial')) pendentes,
         coalesce(sum(abs(valor) - casado) filter (where estado in ('pendente','parcial')), 0) pendentes_valor,
         count(*) filter (where estado in ('pendente','parcial') and valor > 0) pend_entradas,
         count(*) filter (where estado in ('pendente','parcial') and valor < 0) pend_saidas,
         coalesce(sum(valor) filter (where valor > 0), 0) entradas, coalesce(-sum(valor) filter (where valor < 0), 0) saidas,
         min(data) primeiro, max(data) ultimo
    from e group by empresa, cod_cc
),
contas as (
  select c.empresa, c.cod_cc, c.descricao, c.codigo_banco from finance.contas_correntes c
   where exists (select 1 from finance.banco_movimentos x where x.empresa = c.empresa and x.cod_cc = c.cod_cc)
),
imp as (
  select distinct on (i.empresa, i.cod_cc) i.empresa, i.cod_cc, i.arquivo, i.dt_ini, i.dt_fim, i.saldo_final, i.importado_em
    from finance.extrato_importacoes i order by i.empresa, i.cod_cc, i.importado_em desc
),
ext as (select empresa, cod_cc, max(data) extrato_ate from finance.banco_movimentos group by 1, 2)
select coalesce(jsonb_agg(jsonb_build_object(
  'empresa', c.empresa, 'cod_cc', c.cod_cc, 'descricao', c.descricao, 'codigo_banco', c.codigo_banco,
  'n', coalesce(ag.n, 0), 'resolvidos', coalesce(ag.resolvidos, 0), 'conciliados', coalesce(ag.conciliados, 0),
  'omie', coalesce(ag.omie, 0), 'ignorados', coalesce(ag.ignorados, 0), 'transferencias', coalesce(ag.transferencias, 0),
  'pendentes', coalesce(ag.pendentes, 0), 'pendentes_valor', coalesce(ag.pendentes_valor, 0),
  'pend_entradas', coalesce(ag.pend_entradas, 0), 'pend_saidas', coalesce(ag.pend_saidas, 0),
  'entradas', coalesce(ag.entradas, 0), 'saidas', coalesce(ag.saidas, 0),
  'pct', case when coalesce(ag.n, 0) = 0 then null else round(100.0 * ag.resolvidos / ag.n) end,
  'extrato_ate', ext.extrato_ate, 'ultima_importacao', imp.importado_em, 'ultimo_arquivo', imp.arquivo,
  'ultimo_de', imp.dt_ini, 'ultimo_ate', imp.dt_fim, 'saldo_extrato', imp.saldo_final
) order by coalesce(ag.pendentes, 0) desc, c.empresa, c.descricao), '[]'::jsonb)
from contas c
left join ag on ag.empresa = c.empresa and ag.cod_cc = c.cod_cc
left join imp on imp.empresa = c.empresa and imp.cod_cc = c.cod_cc
left join ext on ext.empresa = c.empresa and ext.cod_cc = c.cod_cc
$$;
revoke all on function finance.conciliacao_resumo(date, date) from public, anon, authenticated;
grant execute on function finance.conciliacao_resumo(date, date) to service_role;

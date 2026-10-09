-- 09/10/26 — Card "Bancos" (Pagar/Receber) e saldo do Fluxo de caixa mostravam o saldo do extrato
-- do OMIE, que parou de acompanhar a conta desde que os pagamentos passaram a ser feitos no painel
-- (Bradesco mostrava 6.979,38 com o extrato fechando em 29,43; C6 ~52 mil com o real ~4 mil).
-- finance.saldo_conta_atual(): para conta com extrato importado (OFX/CSV),
--   • com saldo no arquivo (LEDGERBAL): saldo final do último extrato + movimentos depois dele;
--   • sem saldo no arquivo (C6): último saldo do Omie ANTES do primeiro movimento importado + tudo
--     o que o extrato trouxe (sem as cópias marcadas "duplicidade");
-- sem extrato importado: o saldo do Omie, como antes. Mesmas colunas de bi.saldo_por_conta, que
-- fica como está (a conferência de corte compara com o Omie de propósito).
-- E "N mov. a conciliar" do Pagar passa a contar juros/multa/desconto da baixa (boleto pago com juros
-- não é pendência — o Receber já fazia assim).
create or replace function finance.saldo_conta_atual()
returns table(empresa text, cod_conta bigint, conta text, saldo numeric, dt_ultimo date, fonte text)
language sql stable security definer set search_path to '' as $function$
  with omie as (select * from bi.saldo_por_conta(null)),
  mv as (
    select b.empresa, b.cod_cc, min(b.data) ini, max(b.data) fim
      from finance.banco_movimentos b
     where b.origem in ('ofx', 'csv') and coalesce(b.ignorado_motivo, '') <> 'duplicidade'
     group by 1, 2
  ),
  imp as (
    select distinct on (i.empresa, i.cod_cc) i.empresa, i.cod_cc, i.saldo_final, i.dt_fim
      from finance.extrato_importacoes i
     where i.saldo_final is not null
     order by i.empresa, i.cod_cc, i.dt_fim desc, i.importado_em desc
  ),
  calc as (
    select mv.empresa, mv.cod_cc, mv.fim,
           case when imp.saldo_final is not null then
                  imp.saldo_final + coalesce((select sum(b.valor) from finance.banco_movimentos b
                     where b.empresa = mv.empresa and b.cod_cc = mv.cod_cc and b.data > imp.dt_fim
                       and b.origem in ('ofx', 'csv') and coalesce(b.ignorado_motivo, '') <> 'duplicidade'), 0)
                else
                  coalesce((select e.saldo from finance.extratos_cc e
                     where e.empresa = mv.empresa and e.cod_conta_corrente = mv.cod_cc and e.saldo is not null
                       and e.data_lancamento_d < mv.ini
                     order by e.data_lancamento_d desc, e.cod_lancamento desc limit 1), 0)
                  + (select sum(b.valor) from finance.banco_movimentos b
                     where b.empresa = mv.empresa and b.cod_cc = mv.cod_cc
                       and b.origem in ('ofx', 'csv') and coalesce(b.ignorado_motivo, '') <> 'duplicidade')
           end saldo,
           case when imp.saldo_final is not null then 'extrato' else 'extrato_somado' end fonte
      from mv left join imp on imp.empresa = mv.empresa and imp.cod_cc = mv.cod_cc
  )
  select coalesce(o.empresa, c.empresa), coalesce(o.cod_conta, c.cod_cc),
         coalesce(o.conta, (select cc.descricao from finance.contas_correntes cc where cc.empresa = c.empresa and cc.cod_cc = c.cod_cc limit 1)),
         coalesce(c.saldo, o.saldo), coalesce(c.fim, o.dt_ultimo), coalesce(c.fonte, 'omie')
    from omie o full join calc c on c.empresa = o.empresa and c.cod_cc = o.cod_conta
$function$;
grant execute on function finance.saldo_conta_atual() to service_role, authenticated;

-- troca a fonte do saldo nas três telas e corrige a contagem do Pagar (texto da função atual)
do $$
declare f text; d text;
begin
  foreach f in array array['finance.pagar_v3_dados(date)', 'finance.receber_v1_dados(date)', 'finance.fluxo_caixa_dados(date,date)'] loop
    d := pg_get_functiondef(f::regprocedure);
    d := replace(d, 'bi.saldo_por_conta(null) s', 'finance.saldo_conta_atual() s');
    d := replace(d, 'coalesce((select sum(b.valor) from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), 0)',
                    'coalesce((select sum(b.valor - b.desconto + b.juros + b.multa) from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), 0)');
    execute d;
  end loop;
end $$;

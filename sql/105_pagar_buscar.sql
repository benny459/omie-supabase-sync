-- 07/10/26 (Benny): procurar "Anderson" em Contas a pagar só mostrava o que
-- está a vencer — a tela só recebe títulos em aberto numa janela de datas.
-- Busca no servidor em TODOS os títulos a pagar (Omie + painel), de qualquer
-- data e situação: em aberto, vencidos antigos, pagos e cancelados.
create or replace function finance.pagar_buscar(p_q text, p_lim int default 300)
returns jsonb
language sql stable security definer set search_path to 'finance', 'public'
as $$
with p as (
  select nullif(trim(p_q), '') q, nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '') dig,
         (now() at time zone 'America/Sao_Paulo')::date hoje
),
pb as (
  select cod_titulo, sum(valor) v, max(data) ult from finance.baixas
   where cod_titulo is not null and natureza = 'P' and estornado_em is null group by 1
),
om as (
  select 'o:' || t.cod_titulo ref, 'o' orig, t.empresa emp, coalesce(nullif(t.contraparte, ''), t.contraparte_razao, '(sem nome)') forn,
         regexp_replace(coalesce(t.cnpj_cpf, ''), '\D', '', 'g') cnpj,
         coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, '')) doc, t.numero_parcela::text parc,
         t.categoria cat, t.projeto proj, t.conta_corrente conta, t.vencimento::date venc, t.valor_documento::numeric valor,
         greatest(round((coalesce(t.val_aberto, t.valor_documento) - coalesce(pb.v, 0))::numeric, 2), 0) saldo,
         case when t.status_titulo = 'CANCELADO' then 'cancelado'
              when t.status_titulo in ('PAGO', 'LIQUIDADO') or coalesce(t.val_aberto, t.valor_documento) - coalesce(pb.v, 0) <= 0.004 then 'pago'
              when t.vencimento < p.hoje then 'atrasado' else 'aberto' end situacao,
         coalesce(t.pagamento::date, pb.ult) pago_em
    from finance.v_titulos_omie_bruto t cross join p left join pb on pb.cod_titulo = t.cod_titulo
   where t.tipo = 'pagar' and t.status_titulo <> 'EXCLUIDO' and p.q is not null
     and (t.contraparte ilike '%' || p.q || '%' or t.contraparte_razao ilike '%' || p.q || '%'
          or t.numero_documento ilike '%' || p.q || '%' or t.numero_documento_fiscal ilike '%' || p.q || '%'
          or t.categoria ilike '%' || p.q || '%'
          or (length(p.dig) >= 5 and regexp_replace(coalesce(t.cnpj_cpf, ''), '\D', '', 'g') like '%' || p.dig || '%'))
),
pv as (
  select 'p:' || x.pagar_id ref, 'p' orig, x.empresa emp, coalesce(nullif(x.contraparte, ''), x.contraparte_razao, '(sem nome)') forn,
         regexp_replace(coalesce(x.cnpj_cpf, ''), '\D', '', 'g') cnpj,
         coalesce(nullif(x.numero_documento_fiscal, ''), x.numero_documento) doc, x.numero_parcela::text parc,
         x.categoria cat, x.projeto proj, x.conta_corrente conta, x.vencimento::date venc, x.valor_documento::numeric valor,
         greatest(round(coalesce(x.val_aberto, 0)::numeric, 2), 0) saldo,
         case when coalesce(x.quitado, false) or coalesce(x.val_aberto, 0) <= 0.004 then 'pago'
              when x.vencimento < p.hoje then 'atrasado' else 'aberto' end situacao,
         x.pago_em::date pago_em
    from finance.v_pagar_previsto x cross join p
   where p.q is not null and x.pagar_id is not null
     and (x.contraparte ilike '%' || p.q || '%' or x.contraparte_razao ilike '%' || p.q || '%'
          or x.numero_documento ilike '%' || p.q || '%' or x.numero_documento_fiscal ilike '%' || p.q || '%'
          or x.categoria ilike '%' || p.q || '%'
          or (length(p.dig) >= 5 and regexp_replace(coalesce(x.cnpj_cpf, ''), '\D', '', 'g') like '%' || p.dig || '%'))
)
-- corta pelo que está mais perto de hoje (parcelas recorrentes até 2032 não empurram para fora os pagos/vencidos)
select coalesce(jsonb_agg(to_jsonb(z) - 'dist' order by z.venc desc nulls last), '[]'::jsonb)
  from (select u.*, abs(coalesce(u.venc, (select hoje from p)) - (select hoje from p)) dist
          from (select * from om union all select * from pv) u
         order by dist, venc desc nulls last limit greatest(1, least(coalesce(p_lim, 300), 1000))) z
$$;

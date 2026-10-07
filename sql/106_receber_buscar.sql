-- 07/10/26: busca de Contas a receber em TODOS os títulos (recebidos, cancelados,
-- em aberto) — par de finance.pagar_buscar (sql/105).
create or replace function finance.receber_buscar(p_q text, p_lim int default 400)
returns jsonb
language sql stable security definer set search_path to 'finance', 'public'
as $$
with p as (
  select nullif(trim(p_q), '') q, nullif(regexp_replace(coalesce(p_q, ''), '\D', '', 'g'), '') dig,
         (now() at time zone 'America/Sao_Paulo')::date hoje
),
u as (
  select 'r:' || r.id ref, r.empresa emp, coalesce(nullif(r.contraparte, ''), r.contraparte_razao, '(sem nome)') forn,
         coalesce(nullif(r.numero_documento_fiscal, ''), nullif(r.numero_documento, '')) doc, r.numero_parcela::text parc,
         r.categoria cat, r.projeto proj, r.conta_corrente conta, r.vencimento::date venc, r.valor_documento::numeric valor,
         greatest(round(coalesce(r.val_aberto, 0)::numeric, 2), 0) saldo,
         case when r.status_titulo = 'CANCELADO' then 'cancelado'
              when r.status_titulo in ('RECEBIDO', 'LIQUIDADO') or coalesce(r.val_aberto, r.valor_documento) <= 0.004 then 'pago'
              when r.vencimento < p.hoje then 'atrasado' else 'aberto' end situacao,
         coalesce(r.pagamento::date, r.pago_em_painel::date) pago_em
    from finance.v_receber_bruto r cross join p
   where p.q is not null and coalesce(r.status_titulo, '') <> 'EXCLUIDO'
     and (r.contraparte ilike '%' || p.q || '%' or r.contraparte_razao ilike '%' || p.q || '%'
          or r.numero_documento ilike '%' || p.q || '%' or r.numero_documento_fiscal ilike '%' || p.q || '%'
          or r.numero_pedido ilike '%' || p.q || '%' or r.boleto_numero ilike '%' || p.q || '%'
          or r.categoria ilike '%' || p.q || '%'
          or (length(p.dig) >= 5 and regexp_replace(coalesce(r.cnpj_cpf, ''), '\D', '', 'g') like '%' || p.dig || '%'))
)
select coalesce(jsonb_agg(to_jsonb(z) - 'dist' order by z.venc desc nulls last), '[]'::jsonb)
  from (select u.*, abs(coalesce(u.venc, (select hoje from p)) - (select hoje from p)) dist from u
         order by dist, venc desc nulls last limit greatest(1, least(coalesce(p_lim, 400), 1000))) z
$$;

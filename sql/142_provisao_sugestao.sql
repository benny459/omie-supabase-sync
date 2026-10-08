-- 142 · Sugestão automática da provisão (spec fluxo v3 §1.3)
-- Para cada conta provisionada do Omie, procura NF recebida (orders.focus_recebidos: NF-e, NFS-e, CT-e)
-- do mesmo CNPJ, emitida entre 35 dias antes e 15 dias depois do vencimento, que ainda não esteja
-- em outro título nem em outra confirmação. Escolhe a de valor mais próximo. Só sugere — quem confirma é o usuário.

create or replace function finance.provisao_sugestao_nf(p_emp text, p_doc text, p_venc date, p_valor numeric)
returns jsonb language sql stable security definer set search_path to 'finance', 'public'
as $$
  select jsonb_build_object('tipo', case f.tipo when 'nfse' then 'NFSE' else 'NFE' end,
                            'numero', f.num, 'valor', round(f.valor, 2), 'emissao', f.emissao::date,
                            'chave', case when f.tipo in ('nfe', 'cte') then f.chave end,
                            'dif_pct', round(abs(f.valor - p_valor) / p_valor * 100, 1))
    from (
      -- NFS-e nacional: o número vem dentro da chave de 50 dígitos (posições 24–36)
      select x.*, coalesce(nullif(ltrim(x.numero, '0'), ''),
                           case when length(x.chave) = 50 then nullif(ltrim(substr(x.chave, 24, 13), '0'), '') end) num
        from orders.focus_recebidos x
       where x.empresa = p_emp
         and regexp_replace(coalesce(x.emitente_doc, ''), '\D', '', 'g') = nullif(regexp_replace(coalesce(p_doc, ''), '\D', '', 'g'), '')
         and x.emissao::date between p_venc - 35 and p_venc + 15
         and coalesce(x.situacao, '') not ilike '%cancel%'
    ) f
   where f.num is not null and p_valor > 0
     and abs(f.valor - p_valor) <= p_valor * 0.5          -- longe demais não é sugestão
     and not exists (select 1 from finance.pesquisa_titulos t
                      where t.empresa = p_emp and t.natureza = 'P'
                        and regexp_replace(coalesce(t.cpf_cnpj_cliente, ''), '\D', '', 'g') = regexp_replace(f.emitente_doc, '\D', '', 'g')
                        and ltrim(coalesce(t.num_doc_fiscal, ''), '0') = f.num)
     and not exists (select 1 from finance.provisao_confirmacoes c
                      where c.empresa = p_emp and c.desfeito_em is null and ltrim(c.numero_doc, '0') = f.num)
   order by abs(f.valor - p_valor), abs(f.emissao::date - p_venc)
   limit 1
$$;
revoke all on function finance.provisao_sugestao_nf(text, text, date, numeric) from public, anon, authenticated;

create or replace function finance.pagar_provisoes() returns jsonb
language sql stable security definer set search_path to 'finance', 'public'
as $$
with hoje as (select (now() at time zone 'America/Sao_Paulo')::date d),
om as (
  select t.*, finance.natureza_valor_omie(t) nat
    from finance.pesquisa_titulos t, hoje h
   where t.natureza = 'P' and t.origem = 'RPTP' and t.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
     and t.dt_vencimento_d between h.d - 180 and h.d + 120
),
om_reais as (
  -- documentos reais por série: pagos ou com NF (mais recentes primeiro)
  select r.empresa, r.cod_tit_repet, r.num_doc_fiscal, r.dt_vencimento_d, coalesce(nullif(r.val_pago, 0), r.valor_titulo) v,
         row_number() over (partition by r.empresa, r.cod_tit_repet order by r.dt_vencimento_d desc) n
    from finance.pesquisa_titulos r
   where r.natureza = 'P' and r.origem = 'RPTP' and coalesce(r.cod_tit_repet, 0) <> 0
     and (r.status in ('PAGO', 'LIQUIDADO') or coalesce(r.num_doc_fiscal, '') <> '')
     and (r.empresa, r.cod_tit_repet) in (select empresa, cod_tit_repet from om)
),
conf as (select * from finance.provisao_confirmacoes where desfeito_em is null),
pp as (
  select p.*, finance.natureza_valor_painel(p) nat from finance.pagar_previsto p
   where p.status = 'previsto' and coalesce(p.origem_titulo, '') <> 'pc' and (p.serie_id is not null or p.valor_estimado)
),
pp_reais as (
  select r.serie_id, r.nf_numero, r.vencimento, coalesce(nullif(r.valor_pago, 0), r.valor) v,
         row_number() over (partition by r.serie_id order by r.vencimento desc) n
    from finance.pagar_previsto r
   where r.serie_id is not null and (coalesce(r.nf_numero, '') <> '' or coalesce(r.valor_pago, 0) > 0)
     and r.serie_id in (select serie_id from pp)
)
select coalesce(jsonb_object_agg(ref, info), '{}'::jsonb) from (
  select 'o:' || o.cod_titulo ref, jsonb_build_object(
           'nat', o.nat, 'serie', o.cod_tit_repet::text,
           'ult', (select jsonb_build_object('nf', r.num_doc_fiscal, 'data', r.dt_vencimento_d) from om_reais r
                    where r.empresa = o.empresa and r.cod_tit_repet = o.cod_tit_repet and r.n = 1),
           'media3', (select round(avg(r.v), 2) from om_reais r where r.empresa = o.empresa and r.cod_tit_repet = o.cod_tit_repet and r.n <= 3),
           'conf', (select jsonb_build_object('id', c.id, 'doc', c.tipo_doc || ' ' || c.numero_doc, 'valor_prov', c.valor_prov, 'em', c.criado_em)
                      from conf c where c.empresa = o.empresa and c.cod_titulo = o.cod_titulo),
           'sug', case when o.nat = 'provisionado'
                       then finance.provisao_sugestao_nf(o.empresa, o.cpf_cnpj_cliente, o.dt_vencimento_d, o.valor_titulo) end) info
    from om o
  union all
  select 'p:' || p.id, jsonb_build_object(
           'nat', p.nat, 'serie', p.serie_id::text,
           'ult', (select jsonb_build_object('nf', r.nf_numero, 'data', r.vencimento) from pp_reais r where r.serie_id = p.serie_id and r.n = 1),
           'media3', (select round(avg(r.v), 2) from pp_reais r where r.serie_id = p.serie_id and r.n <= 3),
           'conf', (select jsonb_build_object('id', c.id, 'doc', c.tipo_doc || ' ' || c.numero_doc, 'valor_prov', c.valor_prov, 'em', c.criado_em)
                      from conf c where c.pagar_id = p.id))
    from pp p
) z
$$;

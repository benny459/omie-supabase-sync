-- P6 — Rentabilidade sobre as fontes nativas (05/10/2026).
--
-- Uma linha por PV/OS (Omie + nativos do schema vendas, espelhados em
-- sales.* com código ≥ 9e12) com a cadeia inteira e a margem:
--   receita   PV/OS (sales.v_erp_vendas) e, depois de faturado, o valor da NF
--             (orders.fat_emissoes autorizada em produção, ou a NF do Omie)
--   custo     PCs ligados ao PV/OS — o mesmo vínculo que a Avulsos usa
--             (sales.mv_pc_avulsos, via RC) somado ao pv_os gravado no próprio
--             PC (compras.pedidos), um PC uma vez só, valor do Omie quando há
--   pago      previsões nativas (finance.pagar_previsto, baixas do P4) e
--             títulos do Omie (finance.contas_pagar) pelo número do PC
--   recebido  finance.v_receber (Omie + nativo) pelo número do PV/OS
--   etapas    RC → PC → NF de entrada → recebido/conferido → pago, e
--             faturado → recebido
-- A margem segue a regra da Avulsos: (PV − PC) / PV, só quando há custo.
--
-- Materializada (lida pela Avulsos a cada carga) com índice único e
-- REFRESH CONCURRENTLY a cada 10 min — mesma convenção de sql/22.

-- Rótulo da origem nas emissões (PV1962 em vez do id interno "3").
alter table orders.fat_emissoes add column if not exists origem_rotulo text;

create or replace function orders.fat_emissoes_rotulo()
returns trigger language plpgsql security definer set search_path = orders, vendas, public as $$
begin
  if new.origem_rotulo is null and new.origem_tipo in ('pv','os','venda') and new.origem_id ~ '^\d+$' then
    select d.tipo || d.numero into new.origem_rotulo from vendas.documentos d where d.id = new.origem_id::bigint;
  end if;
  if new.origem_rotulo is null and new.origem_id ~* '^(PV|OS)\d+$' then
    new.origem_rotulo := upper(new.origem_id);
  end if;
  return new;
end $$;

drop trigger if exists fat_emissoes_rotulo on orders.fat_emissoes;
create trigger fat_emissoes_rotulo before insert or update of origem_id, origem_tipo on orders.fat_emissoes
  for each row execute function orders.fat_emissoes_rotulo();

update orders.fat_emissoes e set origem_rotulo = d.tipo || d.numero
  from vendas.documentos d
 where e.origem_rotulo is null and e.origem_tipo in ('pv','os','venda') and e.origem_id ~ '^\d+$' and d.id = e.origem_id::bigint;

-- Parcelas já criadas com o id interno passam a ter o rótulo.
update finance.receber r set numero_pedido = e.origem_rotulo
  from orders.fat_emissoes e
 where e.origem_rotulo is not null and r.id = any(e.receber_ids) and r.numero_pedido is distinct from e.origem_rotulo;

drop materialized view if exists sales.mv_rentab_pvos cascade;
create materialized view sales.mv_rentab_pvos as
with pv as (
  select v.empresa, v.tipo, v.numero, v.label, v.cliente, v.codigo_cliente, v.cnpj_cpf, v.projeto, v.codigo_projeto,
         v.emissao, v.dt_fat, v.nf, coalesce(v.faturado, false) as faturado, coalesce(v.valor_total, 0) as receita_pv,
         (v.codigo ~ '^\d+$' and v.codigo::numeric >= 9e12) as nativo
    from sales.v_erp_vendas v
   where not coalesce(v.cancelado, false) and v.label is not null
),
lk_mv as (
  select m.empresa, m.pv_os_label as label, x.pcn,
         max(m.valor_total) filter (where coalesce(m.ncod_ped, 0) > 0) as v_omie,
         max(m.valor_total) as v_any,
         bool_or(coalesce(m.pc_pago, false)) as pago_mv
    from sales.mv_pc_avulsos m
   cross join lateral (select coalesce(nullif(trim(m.pc_numero), ''), nullif(trim(m.pc_numero_manual), '')) as pcn) x
   where m.pv_os_label is not null and x.pcn is not null
   group by 1, 2, 3
),
pc as (
  select distinct on (p.empresa, p.numero) p.empresa, p.numero, p.etapa, p.nf, p.dt_rec, p.valor_total,
         coalesce(p.cancelado, false) as cancelado,
         upper(regexp_replace(coalesce(nullif(p.pv_os_painel, ''), p.pv_os), '\s', '', 'g')) as pv_label
    from compras.pedidos p
   where p.tipo = 'PC'
   order by p.empresa, p.numero, p.id desc
),
links as (
  select empresa, label, pcn from lk_mv
  union
  select empresa, pv_label, numero from pc where pv_label ~ '^(PV|OS)\d+$' and not cancelado
),
pag_nat as (
  select empresa, pedido_numero as pcn, sum(valor) as valor, sum(coalesce(valor_pago, 0)) as pago,
         bool_and(coalesce(valor_pago, 0) >= valor - 0.01) as quitado
    from finance.pagar_previsto where status = 'previsto' group by 1, 2
),
pag_omie as (
  select empresa, numero_pedido as pcn, sum(valor_documento) as valor,
         sum(case when upper(status_titulo) in ('PAGO', 'LIQUIDADO') then valor_documento else coalesce(valor_pago, 0) end) as pago,
         -- O Omie dá o título como PAGO mesmo com desconto: vale o status.
         bool_and(upper(status_titulo) in ('PAGO', 'LIQUIDADO')) as quitado
    from finance.contas_pagar
   where coalesce(numero_pedido, '') <> '' and upper(coalesce(status_titulo, '')) <> 'CANCELADO' group by 1, 2
),
pc_det as (
  select l.empresa, l.label, l.pcn,
         coalesce(m.v_omie, m.v_any, pc.valor_total, 0) as valor,
         coalesce(pc.nf, '') <> '' as tem_nf,
         (pc.dt_rec is not null or pc.etapa in ('60', '80')) as recebido,
         pc.etapa = '80' as conferido,
         (coalesce(pn.quitado, false) or coalesce(po.quitado, false) or coalesce(m.pago_mv, false)) as quitado,
         case when coalesce(pn.quitado, false) or coalesce(po.quitado, false) or coalesce(m.pago_mv, false)
              then coalesce(m.v_omie, m.v_any, pc.valor_total, 0)
              else least(coalesce(m.v_omie, m.v_any, pc.valor_total, 0), greatest(coalesce(pn.pago, 0), coalesce(po.pago, 0))) end as pago
    from links l
    left join lk_mv m on m.empresa = l.empresa and m.label = l.label and m.pcn = l.pcn
    left join pc on pc.empresa = l.empresa and pc.numero = l.pcn
    left join pag_nat pn on pn.empresa = l.empresa and pn.pcn = l.pcn
    left join pag_omie po on po.empresa = l.empresa and po.pcn = l.pcn
   where not coalesce(pc.cancelado, false)
),
custo as (
  select empresa, label,
         count(*) as n_pc, sum(valor) as custo,
         count(*) filter (where tem_nf) as n_nf_entrada,
         count(*) filter (where recebido) as n_recebido,
         count(*) filter (where conferido) as n_conferido,
         sum(pago) as pago,
         count(*) filter (where quitado or (valor > 0 and pago >= valor - 0.01)) as n_pago,
         array_agg(pcn order by pcn) as pcs
    from pc_det group by 1, 2
),
rc as (
  select empresa, label, count(distinct rc) as n_rc, sum(custo_rc) as custo_rc from (
    select m.empresa, m.pv_os_label as label, m.rc_numero::text as rc,
           (case when coalesce(m.rc_qtd, 0) = 0 then 1 else m.rc_qtd end) * coalesce(m.rc_custo, 0) as custo_rc
      from sales.mv_pc_avulsos m where m.pv_os_label is not null and m.rc_numero is not null
    union all
    select r.empresa, upper(regexp_replace(coalesce(nullif(r.pv_os_painel, ''), r.pv_os), '\s', '', 'g')), r.numero, 0
      from compras.pedidos r where r.tipo = 'RC' and not coalesce(r.cancelado, false)
       and coalesce(nullif(r.pv_os_painel, ''), r.pv_os) is not null
  ) x group by 1, 2
),
rec as (
  -- O Omie grava o número do PV/OS em numero_pedido (e repete em num_os,
  -- inclusive nos PVs). PV e OS têm numerações próprias que se cruzam: fica
  -- PV quando só existe o PV, ou quando a NF do título é a NF do PV.
  select r.empresa, x.label,
         sum(coalesce(r.valor_documento, 0)) as titulos,
         sum(greatest(coalesce(r.valor_pago, 0), coalesce(r.valor_pago_painel, 0))) as recebido
    from finance.v_receber r
   cross join lateral (select coalesce(nullif(r.numero_pedido, ''), nullif(r.num_os, '')) as n) k
    left join pv p on p.empresa = r.empresa and p.tipo = 'PV' and p.numero = k.n
    left join pv o on o.empresa = r.empresa and o.tipo = 'OS' and o.numero = k.n
   cross join lateral (select case
            when k.n ~* '^(PV|OS)\d+$' then upper(k.n)
            when p.label is not null and (o.label is null
                 or ltrim(coalesce(r.num_doc_fiscal, ''), '0') = ltrim(coalesce(p.nf, ''), '0')) then p.label
            when o.label is not null then o.label end as label) x
    -- Números de PV/OS repetem-se ao longo dos anos (e o PV nativo continua a
    -- sequência): título emitido muito antes do pedido é de outro documento.
    left join pv e on e.empresa = r.empresa and e.label = x.label
   where x.label is not null and upper(coalesce(r.status_titulo, '')) <> 'CANCELADO'
     and (r.emissao is null or e.emissao is null or r.emissao >= e.emissao - 60)
   group by 1, 2
),
fat as (
  select empresa, origem_rotulo as label, sum(valor_total) as valor_nf, max(numero) as nf_painel
    from orders.fat_emissoes
   where status = 'autorizada' and ambiente = 'producao' and origem_rotulo is not null
   group by 1, 2
)
select pv.empresa, pv.tipo, pv.numero, pv.label, pv.nativo,
       pv.cliente, pv.codigo_cliente, pv.cnpj_cpf, pv.projeto, pv.codigo_projeto,
       pv.emissao, pv.dt_fat, coalesce(fat.nf_painel, pv.nf) as nf,
       pv.receita_pv,
       case when pv.faturado or fat.valor_nf is not null then coalesce(fat.valor_nf, pv.receita_pv) end as receita_nf,
       (pv.faturado or fat.valor_nf is not null) as faturado,
       coalesce(rc.n_rc, 0) as n_rc, coalesce(rc.custo_rc, 0) as custo_rc,
       coalesce(c.n_pc, 0) as n_pc, coalesce(c.custo, 0) as custo,
       coalesce(c.n_nf_entrada, 0) as n_nf_entrada, coalesce(c.n_recebido, 0) as n_recebido,
       coalesce(c.n_conferido, 0) as n_conferido, coalesce(c.n_pago, 0) as n_pago,
       coalesce(c.pago, 0) as pago, greatest(coalesce(c.custo, 0) - coalesce(c.pago, 0), 0) as a_pagar,
       c.pcs,
       coalesce(rec.titulos, 0) as titulos_receber, coalesce(rec.recebido, 0) as recebido,
       greatest(coalesce(rec.titulos, 0) - coalesce(rec.recebido, 0), 0) as a_receber,
       case when coalesce(c.custo, 0) > 0 then pv.receita_pv - c.custo end as margem,
       case when coalesce(c.custo, 0) > 0 and pv.receita_pv > 0 then (pv.receita_pv - c.custo) / pv.receita_pv end as margem_pct,
       (coalesce(c.n_pc, 0) > 0 and c.n_pago = c.n_pc) as pago_ok,
       (coalesce(rec.titulos, 0) > 0 and rec.recebido >= rec.titulos - 0.01) as recebido_ok,
       case
         when coalesce(rec.titulos, 0) > 0 and rec.recebido >= rec.titulos - 0.01 then 'recebido'
         when pv.faturado or fat.valor_nf is not null then 'faturado'
         when coalesce(c.n_pc, 0) > 0 and c.n_pago = c.n_pc then 'pago'
         when coalesce(c.n_pc, 0) > 0 and c.n_conferido = c.n_pc then 'conferido'
         when coalesce(c.n_pc, 0) > 0 and c.n_recebido = c.n_pc then 'recebido_material'
         when coalesce(c.n_nf_entrada, 0) > 0 then 'nf_entrada'
         when coalesce(c.n_pc, 0) > 0 then 'pc'
         when coalesce(rc.n_rc, 0) > 0 then 'rc'
         else 'pedido'
       end as etapa_cadeia
  from pv
  left join custo c on c.empresa = pv.empresa and c.label = pv.label
  left join rc on rc.empresa = pv.empresa and rc.label = pv.label
  left join rec on rec.empresa = pv.empresa and rec.label = pv.label
  left join fat on fat.empresa = pv.empresa and fat.label = pv.label;

create unique index mv_rentab_pvos_uk on sales.mv_rentab_pvos (empresa, label);
create index mv_rentab_pvos_cli on sales.mv_rentab_pvos (empresa, codigo_cliente);
create index mv_rentab_pvos_emissao on sales.mv_rentab_pvos (emissao);

revoke all on sales.mv_rentab_pvos from public, anon, authenticated;
grant select on sales.mv_rentab_pvos to service_role;

-- Por cliente: a mesma fonte, agregada.
create or replace view sales.v_rentab_clientes with (security_invoker = true) as
select empresa, codigo_cliente, max(cliente) as cliente, max(cnpj_cpf) as cnpj_cpf,
       count(*) as n_pvos,
       sum(receita_pv) as receita, sum(coalesce(receita_nf, 0)) as faturado,
       sum(custo) as custo,
       sum(receita_pv) filter (where custo > 0) as receita_medida,
       sum(custo) filter (where custo > 0) as custo_medido,
       count(*) filter (where custo > 0) as n_medidos,
       case when sum(receita_pv) filter (where custo > 0) > 0
            then (sum(receita_pv) filter (where custo > 0) - sum(custo) filter (where custo > 0))
                 / sum(receita_pv) filter (where custo > 0) end as margem_pct,
       sum(pago) as pago, sum(a_pagar) as a_pagar, sum(recebido) as recebido, sum(a_receber) as a_receber,
       max(emissao) as ultima_emissao
  from sales.mv_rentab_pvos
 group by empresa, codigo_cliente;

revoke all on sales.v_rentab_clientes from public, anon, authenticated;
grant select on sales.v_rentab_clientes to service_role;

create or replace function sales.refresh_mv_rentab()
returns void language plpgsql security definer set search_path = sales, public as $$
begin
  begin
    refresh materialized view concurrently sales.mv_rentab_pvos;
  exception when others then
    raise warning 'refresh concurrently de mv_rentab_pvos falhou (%), usando refresh normal', sqlerrm;
    refresh materialized view sales.mv_rentab_pvos;
  end;
end $$;
revoke all on function sales.refresh_mv_rentab() from public, anon, authenticated;
grant execute on function sales.refresh_mv_rentab() to service_role;

-- A cada 10 min, 3 min depois da Avulsos (que ela lê).
select cron.unschedule('rentab-refresh') where exists (select 1 from cron.job where jobname = 'rentab-refresh');
select cron.schedule('rentab-refresh', '3-59/10 * * * *', $$select sales.refresh_mv_rentab()$$);

-- Cadeia de um PV/OS para o drill-down da tela de Rentabilidade.
create or replace function sales.rentab_cadeia(p_empresa text, p_label text)
returns jsonb language sql stable security definer set search_path = sales, compras, finance, orders, public as $$
  with r as (select * from sales.mv_rentab_pvos where empresa = p_empresa and label = p_label),
  pcs as (
    select p.numero, p.etapa, p.fornecedor_nome, p.valor_total, p.nf, p.dt_rec, p.emissao, p.origem,
           coalesce((select sum(pp.valor_pago) from finance.pagar_previsto pp
                      where pp.empresa = p.empresa and pp.pedido_numero = p.numero and pp.status = 'previsto'), 0) as pago_painel,
           coalesce((select sum(case when upper(cp.status_titulo) in ('PAGO','LIQUIDADO') then cp.valor_documento else coalesce(cp.valor_pago,0) end)
                       from finance.contas_pagar cp where cp.empresa = p.empresa and cp.numero_pedido = p.numero
                        and upper(coalesce(cp.status_titulo,'')) <> 'CANCELADO'), 0) as pago_omie,
           (select bool_and(upper(cp.status_titulo) in ('PAGO','LIQUIDADO')) from finance.contas_pagar cp
             where cp.empresa = p.empresa and cp.numero_pedido = p.numero and upper(coalesce(cp.status_titulo,'')) <> 'CANCELADO') as quitado_omie
      from compras.pedidos p, r
     where p.tipo = 'PC' and p.empresa = p_empresa and p.numero = any(r.pcs)
  ),
  rcs as (
    select m.rc_numero::text as numero, count(*) as itens, sum((case when coalesce(m.rc_qtd, 0) = 0 then 1 else m.rc_qtd end) * coalesce(m.rc_custo, 0)) as custo
      from sales.mv_pc_avulsos m where m.empresa = p_empresa and m.pv_os_label = p_label and m.rc_numero is not null
     group by 1
  ),
  rec as (
    -- Mesma resolução PV × OS da mv_rentab_pvos.
    select v.num_parcela, v.numero_parcela, v.vencimento, v.valor_documento,
           greatest(coalesce(v.valor_pago,0), coalesce(v.valor_pago_painel,0)) as recebido, v.status_titulo,
           coalesce(v.num_doc_fiscal, v.numero_documento_fiscal) as nf
      from finance.v_receber v
     cross join lateral (select coalesce(nullif(v.numero_pedido, ''), nullif(v.num_os, '')) as n) k
      left join sales.v_erp_vendas pv on pv.empresa = v.empresa and pv.tipo = 'PV' and pv.numero = k.n and not coalesce(pv.cancelado, false)
      left join sales.v_erp_vendas os on os.empresa = v.empresa and os.tipo = 'OS' and os.numero = k.n and not coalesce(os.cancelado, false)
     cross join lateral (select case
              when k.n ~* '^(PV|OS)\d+$' then upper(k.n)
              when pv.label is not null and (os.label is null
                   or ltrim(coalesce(v.num_doc_fiscal, ''), '0') = ltrim(coalesce(pv.nf, ''), '0')) then pv.label
              when os.label is not null then os.label end as label) x
      left join sales.v_erp_vendas e on e.empresa = v.empresa and e.label = x.label and not coalesce(e.cancelado, false)
     where v.empresa = p_empresa and x.label = p_label and upper(coalesce(v.status_titulo,'')) <> 'CANCELADO'
       and (v.emissao is null or e.emissao is null or v.emissao >= e.emissao - 60)
  )
  select jsonb_build_object(
    'pedido', (select to_jsonb(r) from r),
    'rcs', coalesce((select jsonb_agg(to_jsonb(rcs) order by numero) from rcs), '[]'::jsonb),
    'pcs', coalesce((select jsonb_agg(to_jsonb(pcs) order by numero) from pcs), '[]'::jsonb),
    'receber', coalesce((select jsonb_agg(to_jsonb(rec) order by vencimento) from rec), '[]'::jsonb)
  );
$$;
revoke all on function sales.rentab_cadeia(text, text) from public, anon, authenticated;
grant execute on function sales.rentab_cadeia(text, text) to service_role;

-- Ficha do cliente (P2): a margem passa a vir da mesma cadeia (mv_rentab_pvos)
-- — PV/OS × PCs ligados, só onde há custo lançado, como na Avulsos. Despesas e
-- mão de obra do BI continuam como informação à parte.
create or replace function orders.cadastros_ficha_cliente(p_id bigint)
returns jsonb language plpgsql stable security definer set search_path to 'cadastros', 'public' as $function$
declare p cadastros.pessoas; v_cods text[]; r jsonb := '{}'::jsonb;
begin
  select * into p from cadastros.pessoas where id = p_id;
  if not found then raise exception 'Cadastro % não encontrado', p_id; end if;
  v_cods := array_remove(array[p.codigo::text, p.codigo_omie::text], null);

  r := r || jsonb_build_object('vendas', coalesce((
    select jsonb_agg(jsonb_build_object('tipo', v.tipo, 'numero', v.numero, 'label', v.label, 'emissao', v.emissao,
             'valor', v.valor_total, 'etapa', v.etapa_desc, 'faturado', v.faturado, 'cancelado', v.cancelado,
             'dtFat', v.dt_fat, 'nf', v.nf, 'projeto', v.projeto,
             'custo', rp.custo, 'margemPct', rp.margem_pct, 'pagoOk', rp.pago_ok, 'recebidoOk', rp.recebido_ok,
             'etapaCadeia', rp.etapa_cadeia) order by v.emissao desc nulls last)
      from (select * from sales.v_erp_vendas v
             where v.empresa = p.empresa
               and (v.codigo_cliente = any(v_cods) or (p.doc is not null and regexp_replace(coalesce(v.cnpj_cpf, ''), '\D', '', 'g') = p.doc))
             order by v.emissao desc nulls last limit 300) v
      left join sales.mv_rentab_pvos rp on rp.empresa = v.empresa and rp.label = v.label), '[]'::jsonb));

  r := r || jsonb_build_object('nfs', coalesce((
    select jsonb_agg(x order by x->>'emissao' desc nulls last) from (
      select jsonb_build_object('tipo', 'NF-e', 'numero', n.numero, 'serie', n.serie, 'emissao', n.emissao::date,
               'valor', n.valor_total, 'cancelada', n.cancelada, 'pedido', n.num_pedido, 'chave', n.chave_nfe) x
        from sales.nfe_saida n
       where p.doc is not null and n.empresa = p.empresa and regexp_replace(coalesce(n.cliente_cnpj, ''), '\D', '', 'g') = p.doc
      union all
      select jsonb_build_object('tipo', 'NFS-e', 'numero', s.numero, 'emissao', s.emissao::date, 'valor', s.valor_total,
               'cancelada', s.cancelada, 'pedido', s.numero_os)
        from sales.nfse_saida s
       where p.doc is not null and s.empresa = p.empresa and regexp_replace(coalesce(s.cliente_cnpj, ''), '\D', '', 'g') = p.doc
      limit 300) t), '[]'::jsonb));

  r := r || jsonb_build_object('receber', (
    with t as (
      select * from finance.v_receber x
       where x.empresa = p.empresa
         and (x.codigo_cliente_fornecedor::text = any(v_cods)
              or (p.doc is not null and regexp_replace(coalesce(x.cnpj_cpf, ''), '\D', '', 'g') = p.doc))
         and coalesce(x.status_titulo, '') <> 'CANCELADO')
    select jsonb_build_object(
      'aberto', coalesce(sum(val_aberto) filter (where em_aberto), 0),
      'vencido', coalesce(sum(val_aberto) filter (where em_aberto and vencimento < current_date), 0),
      'recebido', coalesce(sum(valor_pago), 0),
      'titulos', coalesce((select jsonb_agg(jsonb_build_object('doc', y.numero_documento, 'parcela', y.numero_parcela,
                    'vencimento', y.vencimento, 'valor', y.valor_documento, 'pago', y.valor_pago, 'aberto', y.val_aberto,
                    'status', y.status_titulo, 'origem', y.origem_registro, 'nf', y.numero_documento_fiscal) order by y.vencimento desc)
                  from (select * from t order by vencimento desc nulls last limit 150) y), '[]'::jsonb))
      from t));

  r := r || jsonb_build_object('margem', (
    with c as (
      select * from sales.mv_rentab_pvos rp
       where rp.empresa = p.empresa
         and (rp.codigo_cliente = any(v_cods) or (p.doc is not null and regexp_replace(coalesce(rp.cnpj_cpf, ''), '\D', '', 'g') = p.doc))),
    b as (
      select coalesce(sum(despesas), 0) as despesas, coalesce(sum(custo_mao_obra), 0) as mao_obra
        from bi.v_rentabilidade_cliente b where b.codigo_cliente::text = any(v_cods))
    select jsonb_build_object(
      'fonte', 'cadeia',
      'faturamento', coalesce(sum(receita_pv) filter (where custo > 0), 0),
      'compras', coalesce(sum(custo) filter (where custo > 0), 0),
      'rentabilidade', coalesce(sum(receita_pv - custo) filter (where custo > 0), 0),
      'margem', case when coalesce(sum(receita_pv) filter (where custo > 0), 0) > 0
                     then round(sum(receita_pv - custo) filter (where custo > 0) / sum(receita_pv) filter (where custo > 0) * 100, 1) end,
      'pvos', count(*), 'pvosMedidos', count(*) filter (where custo > 0),
      'pago', coalesce(sum(pago), 0), 'aPagar', coalesce(sum(a_pagar), 0),
      'recebido', coalesce(sum(recebido), 0), 'aReceber', coalesce(sum(a_receber), 0),
      'despesas', (select despesas from b), 'maoObra', (select mao_obra from b))
      from c));

  return r;
end $function$;

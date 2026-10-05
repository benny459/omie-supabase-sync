-- 57 — lacunas da validação final do ciclo de vendas avulsas (05/10/2026)
-- (1) sales.rentab_lista: rentabilidade paginada no servidor
-- (2) conciliação: sugestão em GRUPO — um movimento que paga várias parcelas
--     do mesmo documento (NF/PV/PC) ou da mesma contraparte.

-- (1) ------------------------------------------------------------------------
create or replace function sales.rentab_lista(
  p_de date default null, p_ate date default null, p_abertos boolean default false,
  p_empresa text default null, p_projeto text default null, p_busca text default null,
  p_com_custo boolean default false, p_visao text default 'pedidos',
  p_limite int default 100, p_offset int default 0)
returns jsonb language sql stable security definer set search_path = sales, public as $$
with base as (
  select * from sales.mv_rentab_pvos m
  where (p_empresa is null or m.empresa = p_empresa)
    and (p_projeto is null or m.projeto = p_projeto)
    and (not p_com_custo or m.custo > 0)
    and (
      ((p_de is null or m.emissao >= p_de) and (p_ate is null or m.emissao <= p_ate))
      or (p_abertos and (not m.faturado
                         or (m.titulos_receber > 0 and not m.recebido_ok)
                         or (m.n_pc > 0 and not m.pago_ok)))
    )
    and (p_busca is null or p_busca = '' or
         concat_ws(' ', m.label, m.cliente, m.cnpj_cpf, m.projeto, m.nf) ilike '%' || p_busca || '%')
),
tot as (
  select count(*) n,
    coalesce(sum(receita_pv),0) receita, coalesce(sum(custo),0) custo,
    coalesce(sum(receita_pv) filter (where custo > 0),0) rec_med,
    coalesce(sum(custo) filter (where custo > 0),0) custo_med,
    count(*) filter (where custo > 0) n_med,
    coalesce(sum(pago),0) pago, coalesce(sum(a_pagar),0) a_pagar,
    coalesce(sum(recebido),0) recebido, coalesce(sum(a_receber),0) a_receber,
    coalesce(sum(receita_nf),0) faturado
  from base
),
cli as (
  select empresa || '|' || coalesce(codigo_cliente, cliente, '—') chave, max(cliente) cliente, count(*) n,
    sum(receita_pv) receita, sum(custo) custo,
    sum(receita_pv) filter (where custo > 0) rec_med, sum(custo) filter (where custo > 0) custo_med,
    sum(a_pagar) a_pagar, sum(recebido) recebido, sum(a_receber) a_receber
  from base group by 1
)
select jsonb_build_object(
  'totais', (select to_jsonb(tot) from tot),
  'projetos', (select coalesce(jsonb_agg(distinct projeto order by projeto), '[]') from sales.mv_rentab_pvos
                where projeto is not null and (p_empresa is null or empresa = p_empresa)),
  'total', case when p_visao = 'clientes' then (select count(*) from cli) else (select n from tot) end,
  'linhas', case when p_visao = 'clientes' then '[]'::jsonb else coalesce((
     select jsonb_agg(jsonb_build_object(
       'empresa', empresa, 'label', label, 'nativo', nativo, 'cliente', cliente, 'projeto', projeto,
       'emissao', emissao, 'nf', nf, 'receita_pv', receita_pv, 'receita_nf', receita_nf, 'faturado', faturado,
       'n_pc', n_pc, 'custo', custo, 'n_pago', n_pago, 'pago', pago, 'a_pagar', a_pagar,
       'titulos_receber', titulos_receber, 'recebido', recebido, 'a_receber', a_receber,
       'margem_pct', margem_pct, 'pago_ok', pago_ok, 'recebido_ok', recebido_ok, 'etapa_cadeia', etapa_cadeia)
       order by emissao desc nulls last, label)
     from (select * from base order by emissao desc nulls last, label
           limit greatest(1, least(p_limite, 500)) offset greatest(p_offset, 0)) pg), '[]') end,
  'clientes', case when p_visao = 'clientes' then coalesce((
     select jsonb_agg(to_jsonb(c) order by c.receita desc)
     from (select * from cli order by receita desc
           limit greatest(1, least(p_limite, 500)) offset greatest(p_offset, 0)) c), '[]') else '[]'::jsonb end
);
$$;
revoke all on function sales.rentab_lista(date,date,boolean,text,text,text,boolean,text,int,int) from public, anon, authenticated;
grant execute on function sales.rentab_lista(date,date,boolean,text,text,text,boolean,text,int,int) to service_role;

-- (2) ------------------------------------------------------------------------
-- Igual à de sql/52 + o bloco "grupos": parcelas em aberto do mesmo documento
-- (NF / PV / PC) ou da mesma contraparte (CNPJ) cuja SOMA bate com o que falta
-- do movimento (±0,01), com a parcela mais próxima a ≤45 dias do movimento.
-- A sugestão de grupo leva 'grupo': true e 'itens' (título + saldo de cada);
-- aceitar = conciliar com todos os itens de uma vez (a tela divide sozinha).
create or replace function finance.conciliacao_painel(p_empresa text, p_cod_cc bigint, p_de date, p_ate date)
returns jsonb language sql stable security definer set search_path = finance, public as $$
with movs as (
  select m.*,
         coalesce((select sum(b.valor) from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), 0) as casado,
         upper(coalesce(m.memo, '') || ' ' || coalesce(m.nome, '')) as texto,
         regexp_replace(coalesce(m.memo, '') || ' ' || coalesce(m.nome, ''), '\D', '', 'g') as digitos
    from finance.banco_movimentos m
   where m.empresa = p_empresa and m.cod_cc = p_cod_cc and m.data between p_de and p_ate
),
abertos as (
  select * from finance.v_titulos_nativos t where t.empresa = p_empresa and t.saldo > 0
),
cand as (
  select m.id as movimento_id, t.natureza, t.titulo, t.contraparte, t.documento, t.vencimento, t.saldo, t.valor, t.fase,
         (case when abs(abs(m.valor) - m.casado - t.saldo) < 0.005 then 50
               when abs(abs(m.valor) - m.casado - t.valor) < 0.005 then 40 else 0 end) as pts_valor,
         (case when t.vencimento is not null and abs(m.data - t.vencimento) <= 3 then 30
               when t.vencimento is not null and abs(m.data - t.vencimento) <= 10 then 10 else 0 end)
       + (case when length(t.cnpj) >= 8 and position(left(t.cnpj, 8) in m.digitos) > 0 then 20 else 0 end)
       + (case when (length(ltrim(regexp_replace(coalesce(t.nf_numero, ''), '\D', '', 'g'), '0')) >= 3
                      and m.texto ~ ('(^|\D)0*' || ltrim(regexp_replace(t.nf_numero, '\D', '', 'g'), '0') || '(\D|$)'))
                 or (length(regexp_replace(coalesce(t.pedido_numero, ''), '\D', '', 'g')) >= 3
                      and m.texto ~ ('(^|\D)' || regexp_replace(t.pedido_numero, '\D', '', 'g') || '(\D|$)'))
               then 20 else 0 end) as pts_extra
    from movs m
    join abertos t on t.natureza = case when m.valor < 0 then 'P' else 'R' end
   where not m.ignorado and m.casado < abs(m.valor) - 0.004
),
-- grupos de parcelas: por documento (NF, senão PV/PC, senão documento) e por contraparte
grupos as (
  select g.natureza, g.chave, g.rotulo, max(g.contraparte) contraparte, max(g.cnpj) cnpj,
         max(g.nf_numero) nf_numero, max(g.pedido_numero) pedido_numero,
         count(*) n, sum(g.saldo) saldo, min(g.vencimento) vencimento,
         bool_and(g.natureza <> 'P' or g.fase = 'liberado') liberado,
         min(g.fase) filter (where g.natureza = 'P' and g.fase <> 'liberado') fase_pend,
         array_agg(g.vencimento) vencs,
         jsonb_agg(jsonb_build_object('titulo', g.titulo, 'saldo', g.saldo, 'documento', g.documento,
                                      'vencimento', g.vencimento, 'fase', g.fase) order by g.vencimento nulls last, g.titulo) itens
    from (
      select t.*, 'doc:' || coalesce(nullif(t.cnpj, ''), t.contraparte, '') || '|' ||
                  coalesce(nullif(t.nf_numero, ''), nullif(t.pedido_numero, ''), nullif(t.documento, '')) as chave,
             coalesce(nullif(t.nf_numero, ''), nullif(t.pedido_numero, ''), t.documento) as rotulo
        from abertos t where coalesce(nullif(t.nf_numero, ''), nullif(t.pedido_numero, ''), nullif(t.documento, '')) is not null
      union all
      select t.*, 'cp:' || coalesce(nullif(t.cnpj, ''), t.contraparte), null
        from abertos t where coalesce(nullif(t.cnpj, ''), t.contraparte) is not null
    ) g
   group by g.natureza, g.chave, g.rotulo
  having count(*) between 2 and 12
),
cand_g as (
  select m.id as movimento_id, gr.*,
         60
       + (case when (select min(abs(m.data - v)) from unnest(gr.vencs) v) <= 10 then 10 else 0 end)
       + (case when length(gr.cnpj) >= 8 and position(left(gr.cnpj, 8) in m.digitos) > 0 then 20 else 0 end)
       + (case when (length(ltrim(regexp_replace(coalesce(gr.nf_numero, ''), '\D', '', 'g'), '0')) >= 3
                      and m.texto ~ ('(^|\D)0*' || ltrim(regexp_replace(gr.nf_numero, '\D', '', 'g'), '0') || '(\D|$)'))
                 or (length(regexp_replace(coalesce(gr.pedido_numero, ''), '\D', '', 'g')) >= 3
                      and m.texto ~ ('(^|\D)' || regexp_replace(gr.pedido_numero, '\D', '', 'g') || '(\D|$)'))
               then 20 else 0 end) as score,
         -- o mesmo conjunto achado pelo documento e pela contraparte aparece uma vez só
         row_number() over (partition by m.id, gr.natureza, gr.itens order by (gr.chave like 'doc:%') desc, gr.chave) as dup
    from movs m
    join grupos gr on gr.natureza = case when m.valor < 0 then 'P' else 'R' end
   where not m.ignorado and m.casado < abs(m.valor) - 0.004
     and abs(abs(m.valor) - m.casado - gr.saldo) <= 0.01
     and (select min(abs(m.data - v)) from unnest(gr.vencs) v) <= 45
),
todas as (
  select movimento_id, score, vencimento, jsonb_build_object('natureza', natureza, 'titulo', titulo, 'contraparte', contraparte,
           'documento', documento, 'vencimento', vencimento, 'saldo', saldo, 'fase', fase, 'score', score) as obj
    from (select c.*, c.pts_valor + c.pts_extra as score from cand c
           where c.pts_valor > 0 and c.pts_valor + c.pts_extra >= 50) z
  union all
  select movimento_id, score, vencimento, jsonb_build_object('grupo', true, 'natureza', natureza, 'titulo', chave,
           'contraparte', contraparte,
           'documento', case when chave like 'doc:%' then rotulo || ' · ' || n || ' parcelas'
                             else n || ' títulos em aberto' end,
           'vencimento', vencimento, 'saldo', saldo,
           'fase', case when liberado then 'liberado' else fase_pend end,
           'score', score, 'itens', itens)
    from cand_g where dup = 1
),
sug as (
  select movimento_id, jsonb_agg(obj order by score desc, vencimento) filter (where rk <= 5) as sugestoes
    from (select t.*, row_number() over (partition by movimento_id order by score desc, vencimento) rk from todas t) z
   group by movimento_id
)
select jsonb_build_object(
  'movimentos', coalesce((select jsonb_agg(jsonb_build_object(
      'id', m.id, 'data', m.data, 'valor', m.valor, 'tipo', m.tipo, 'memo', m.memo, 'nome', m.nome, 'fitid', m.fitid,
      'checknum', m.checknum, 'arquivo', m.arquivo, 'casado', m.casado, 'ignorado', m.ignorado, 'ignorado_motivo', m.ignorado_motivo,
      'estado', case when m.ignorado then 'ignorado'
                     when m.casado >= abs(m.valor) - 0.004 then 'conciliado'
                     when m.casado > 0 then 'parcial' else 'pendente' end,
      'baixas', coalesce((select jsonb_agg(jsonb_build_object('id', b.id, 'natureza', b.natureza,
                    'titulo', coalesce(b.pagar_id::text, b.receber_id::text), 'documento', b.documento,
                    'contraparte', b.contraparte, 'valor', b.valor) order by b.id)
                  from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), '[]'::jsonb),
      'sugestoes', coalesce(s.sugestoes, '[]'::jsonb)) order by m.data, m.id)
    from movs m left join sug s on s.movimento_id = m.id), '[]'::jsonb),
  'titulos', coalesce((select jsonb_agg(to_jsonb(t) order by t.vencimento nulls last) from abertos t), '[]'::jsonb)
)
$$;
revoke all on function finance.conciliacao_painel(text, bigint, date, date) from public, anon, authenticated;
grant execute on function finance.conciliacao_painel(text, bigint, date, date) to service_role;

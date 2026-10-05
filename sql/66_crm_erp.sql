-- 66_crm_erp.sql — P-CRM (05/10/26): o CRM (Propostas-WW) deixa de chamar o
-- Omie. Tudo o que ele lia ao vivo do Omie passa a sair do painel, por
-- /api/crm/erp (servidor-a-servidor, segredo COMPRAS_RC_SECRET).
--
-- Fontes: os espelhos que o painel já mantém (sales.produtos, finance.clientes,
-- finance.projetos, finance.categorias, finance.parcelas, sales.pedidos_venda,
-- sales.ordens_servico, sales.itens_vendidos, orders.pedidos_compra) mais os
-- nativos (cadastros.aux, compras.pedidos, códigos novos do estoque). Os PV/OS
-- nativos do painel já estão espelhados em sales.* (código ≥ 9e12), por isso
-- entram sem caso à parte. Os ids devolvidos continuam os do Omie onde existem —
-- o único caminho que ainda fala com o Omie (o "criar" do CRM com a chave
-- pv_os_nativo DESLIGADA) precisa deles.
-- Só leitura. Aplicado como migrações p66_crm_erp e p66b_crm_erp_consultar_codigos.

create or replace function orders._crm_data(t text) returns date
language sql immutable as $$
  select case when t ~ '^\d{2}/\d{2}/\d{4}' then to_date(substr(t,1,10), 'DD/MM/YYYY')
              when t ~ '^\d{4}-\d{2}-\d{2}' then substr(t,1,10)::date end
$$;

-- Listas de cadastro que o CRM usava do Omie.
create or replace function orders.crm_erp_lista(p_empresa text, p_lista text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare r jsonb;
begin
  if p_lista = 'produtos' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', p.id_omie, 'cod', coalesce(p.codigo_produto, ''), 'cod_novo', c.codigo,
      'desc', coalesce(p.descricao, ''),
      'un', upper(trim(coalesce(nullif(p.unidade, ''), nullif(pc.unidade, ''), f.unidade, 'UN'))),
      'ncm', coalesce(nullif(p.ncm, ''), nullif(pc.ncm, ''), f.ncm, ''),
      'vlr', coalesce(nullif(p.valor_unitario, 0), pc.valor_unitario, 0),
      'familia', coalesce(pf.descricao_familia, ''))), '[]'::jsonb)
      into r
      from sales.produtos p
      left join orders.produtos_compras pc on pc.empresa = p.empresa and pc.id_omie = p.id_omie
      left join orders.fat_produto_fiscal f on f.empresa = p.empresa and f.codigo_produto::text = p.id_omie::text
      left join orders.produto_familia pf on pf.empresa = p.empresa and pf.id_omie = p.id_omie
      left join platform.estoque_item_codigo c on c.empresa = p.empresa and c.n_cod_prod = p.id_omie and c.atual
     where p.empresa = p_empresa;
  elsif p_lista = 'clientes' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.codigo_cliente_omie, 'nome', coalesce(c.razao_social, ''), 'fant', coalesce(c.nome_fantasia, ''),
      'cnpj', coalesce(c.cnpj_cpf, ''), 'uf', coalesce(c.estado, ''))), '[]'::jsonb)
      into r
      from finance.clientes c
     where c.empresa = p_empresa and coalesce(c.inativo, 'N') <> 'S';
  elsif p_lista = 'servicos' then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', coalesce(nullif(a.omie_codigo, ''), a.codigo)::bigint, 'cod', a.codigo, 'desc', a.nome, 'un', 'UN', 'vlr', 0,
      'fiscal', jsonb_build_object('lc116', coalesce(a.dados->>'lc116', ''), 'mun', coalesce(a.dados->>'cod_municipio', ''),
                                   'trib', '', 'aliqIss', coalesce((a.dados->>'aliquota_iss')::numeric, 0),
                                   'retemIss', 'N', 'categ', '')) order by a.nome), '[]'::jsonb)
      into r
      from cadastros.aux a
     where a.registro = 'servicos' and a.empresa = p_empresa and not coalesce(a.inativo, false)
       and coalesce(nullif(a.omie_codigo, ''), a.codigo) ~ '^\d+$';
  elsif p_lista = 'categorias' then
    select coalesce(jsonb_agg(jsonb_build_object('codigo', c.codigo, 'descricao', coalesce(nullif(c.descricao, ''), c.descricao_padrao))
                              order by string_to_array(c.codigo, '.')::int[]), '[]'::jsonb)
      into r
      from finance.categorias c
     where c.empresa = p_empresa and c.codigo ~ '^1\.[0-9.]+$'
       and coalesce(c.conta_inativa, 'N') <> 'S' and coalesce(c.totalizadora, 'N') <> 'S' and coalesce(c.nao_exibir, 'N') <> 'S';
  elsif p_lista = 'projetos' then
    select coalesce(jsonb_agg(jsonb_build_object('codigo', p.codigo, 'nome', p.nome) order by p.codigo desc), '[]'::jsonb)
      into r
      from finance.projetos p
     where p.empresa = p_empresa and coalesce(p.inativo, 'N') <> 'S' and coalesce(p.nome, '') <> '';
  elsif p_lista = 'vendedores' then
    select coalesce(jsonb_agg(jsonb_build_object('codigo', coalesce(nullif(a.omie_codigo, ''), a.codigo)::bigint, 'nome', a.nome)), '[]'::jsonb)
      into r
      from cadastros.aux a
     where a.registro = 'vendedores' and a.empresa = p_empresa and not coalesce(a.inativo, false)
       and coalesce(nullif(a.omie_codigo, ''), a.codigo) ~ '^\d+$';
  elsif p_lista = 'parcelas' then
    select coalesce(jsonb_agg(jsonb_build_object('codigo', x.codigo, 'descricao', x.descricao, 'n', x.n_parcelas) order by x.codigo), '[]'::jsonb)
      into r
      from finance.parcelas x;
  else
    raise exception 'lista inválida: %', p_lista;
  end if;
  return r;
end $$;

-- PV/OS no formato de omie_pedidos_cache do CRM (o que o omie-sync-cache gravava).
-- p_texto: procura no nº do contrato / pedido do cliente / obs / dados da NF.
create or replace function orders.crm_erp_pedidos(p_empresa text, p_desde date default null,
  p_texto text default null, p_cliente bigint default null, p_limite int default 5000)
returns jsonb language sql stable security definer set search_path = '' as $$
  with pv as (
    select 'PV'::text tipo, v.codigo_pedido::bigint codigo_pedido, coalesce(v.numero_pedido, '') numero_pedido,
           v.codigo_cliente::bigint codigo_cliente, coalesce(v.valor_total, 0)::numeric valor_total,
           orders._crm_data(v.data_previsao) data_previsao, orders._crm_data(v.d_inc) data_emissao,
           coalesce(v.etapa, '') etapa, coalesce(v.codigo_parcela, '') codigo_parcela,
           v.numero_contrato, v.num_pedido_cliente numero_pedido_cliente,
           null::text obs_venda, v.dados_adicionais_nf,
           exists (select 1 from sales.etapas_pedidos e where e.empresa = v.empresa and e.codigo_pedido = v.codigo_pedido and e.cancelado = 'S') cancelada
      from sales.pedidos_venda v where v.empresa = p_empresa
  ), os as (
    select 'OS'::text, o.codigo_os::bigint, max(coalesce(o.numero_os, '')), (max(o.codigo_cliente) filter (where o.codigo_cliente ~ '^\d+$'))::bigint,
           max(coalesce(o.valor_total, 0))::numeric, orders._crm_data(max(o.dt_previsao)),
           coalesce(max(o.d_inc_d), orders._crm_data(max(o.d_inc))), max(coalesce(o.etapa, '')), max(coalesce(o.codigo_parcela, '')),
           max(o.numero_contrato), null::text, null::text, null::text, bool_or(o.cancelada = 'S')
      from sales.ordens_servico o where o.empresa = p_empresa and o.codigo_os ~ '^\d+$'
     group by o.codigo_os
  ), todos as (select * from pv union all select * from os)
  select coalesce(jsonb_agg(jsonb_build_object(
      'tipo', t.tipo, 'codigo_pedido', t.codigo_pedido, 'numero_pedido', t.numero_pedido,
      'codigo_cliente', t.codigo_cliente, 'valor_total', t.valor_total,
      'data_previsao', t.data_previsao, 'data_emissao', t.data_emissao, 'etapa', t.etapa,
      'codigo_parcela', t.codigo_parcela, 'parcela_descricao', fp.descricao,
      'numero_contrato', t.numero_contrato, 'numero_pedido_cliente', t.numero_pedido_cliente,
      'obs_venda', t.obs_venda, 'dados_adicionais_nf', t.dados_adicionais_nf,
      'cliente_nome', coalesce(nullif(c.nome_fantasia, ''), c.razao_social), 'cliente_cnpj', regexp_replace(coalesce(c.cnpj_cpf, ''), '\D', '', 'g'),
      'cancelada', t.cancelada) order by t.data_emissao desc nulls last), '[]'::jsonb)
    from (select * from todos t
           where (p_desde is null or t.data_emissao >= p_desde)
             and (p_cliente is null or t.codigo_cliente = p_cliente)
             and (p_texto is null or concat_ws(' | ', t.numero_contrato, t.numero_pedido_cliente, t.dados_adicionais_nf) ilike '%' || p_texto || '%')
           order by t.data_emissao desc nulls last limit greatest(1, least(p_limite, 20000))) t
    left join finance.clientes c on c.empresa = p_empresa and c.codigo_cliente_omie = t.codigo_cliente
    left join finance.parcelas fp on fp.codigo = t.codigo_parcela
$$;

-- Um PV/OS pelo número: código e itens (o "consultar"/"vincular" do CRM).
create or replace function orders.crm_erp_consultar(p_empresa text, p_tipo text, p_numero text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select case when upper(p_tipo) = 'OS' then (
      select jsonb_build_object('numero', max(o.numero_os), 'codigo', o.codigo_os,
        'vendedor', max(o.codigo_vendedor), 'projeto', max(o.codigo_projeto),
        'itens', jsonb_agg(jsonb_build_object('nCodServico', o.codigo_servico, 'cadastro', a.nome, 'codigo', a.codigo,
                 'descricao', o.descricao_servico, 'trib', o.trib_servico, 'lc116', a.dados->>'lc116', 'mun', a.dados->>'cod_municipio')
                 order by o.seq_item))
        from sales.ordens_servico o
        left join cadastros.aux a on a.registro = 'servicos' and a.empresa = o.empresa
                                 and coalesce(nullif(a.omie_codigo, ''), a.codigo) = o.codigo_servico::text
       where o.empresa = p_empresa and o.numero_os = p_numero
       group by o.codigo_os limit 1)
    else (
      select jsonb_build_object('numero', v.numero_pedido, 'codigo', v.codigo_pedido,
        'itens', coalesce((select jsonb_agg(jsonb_build_object('codigo_produto', i.codigo_produto, 'codigo', i.codigo_prod_omie, 'descricao', i.descricao)
                                            order by i.codigo_item)
                             from sales.itens_vendidos i where i.empresa = v.empresa and i.codigo_pedido = v.codigo_pedido), '[]'::jsonb))
        from sales.pedidos_venda v where v.empresa = p_empresa and v.numero_pedido = p_numero limit 1)
  end
$$;

-- Condição de pagamento dos pedidos de compra (o ConsultarPedCompra do CRM).
-- Nativos (compras.pedidos) e espelho do Omie (orders.pedidos_compra).
create or replace function orders.crm_erp_prazos_compra(p_empresa text, p_pedidos text[])
returns jsonb language sql stable security definer set search_path = '' as $$
  with nat as (
    select p.numero::text num, p.fornecedor_cod::text forn, p.parcela_cod cond, p.emissao::text emissao, p.previsao::text previsao,
           p.valor_total::numeric total
      from compras.pedidos p
     where p.empresa = p_empresa and p.numero::text = any(p_pedidos) and not coalesce(p.cancelado, false)
  ), omie as (
    select x.cnumero num, max(x.ncod_for)::text forn, max(x.ccod_parc) cond,
           orders._crm_data(max(x.dinc_data))::text emissao, orders._crm_data(max(x.ddt_previsao))::text previsao,
           coalesce(max(x.ntotal_pedido), sum(coalesce(x.nval_tot, 0)))::numeric total
      from orders.pedidos_compra x
     where x.empresa = p_empresa and x.cnumero = any(p_pedidos)
       and not exists (select 1 from nat n where n.num = x.cnumero)
     group by x.cnumero
  ), todos as (select * from nat union all select * from omie)
  select coalesce(jsonb_object_agg(t.num, jsonb_build_object(
      'pedido', t.num, 'codFornecedor', t.forn, 'codCondicao', coalesce(t.cond, ''),
      'condicao', fp.descricao, 'qtdParcelas', fp.n_parcelas, 'emissao', t.emissao, 'previsao', t.previsao, 'total', t.total)), '{}'::jsonb)
    from todos t left join finance.parcelas fp on fp.codigo = t.cond
$$;

revoke all on function orders.crm_erp_lista(text, text), orders.crm_erp_pedidos(text, date, text, bigint, int),
  orders.crm_erp_consultar(text, text, text), orders.crm_erp_prazos_compra(text, text[]) from public, anon, authenticated;
grant execute on function orders.crm_erp_lista(text, text), orders.crm_erp_pedidos(text, date, text, bigint, int),
  orders.crm_erp_consultar(text, text, text), orders.crm_erp_prazos_compra(text, text[]) to service_role;

-- 54 — NF-e mercantil da SF em produção pelo painel (05/10/2026)
--
-- Decisão do Benny: a SF para de emitir NF-e no Omie e passa a emitir pela
-- Focus, continuando a numeração do Omie (série 1; última no Omie: 2192).
-- A chave final (producao_liberada + ambiente) continua DESLIGADA: quem liga
-- é o Benny. Tudo aqui é aditivo.

-- 1) Config da SF: natureza igual à do Omie, série/número de produção, e a
--    trava "Omie desligado" (sem ela a produção não emite).
alter table orders.fat_config add column if not exists omie_nfe_desligado_em timestamptz;
alter table orders.fat_config add column if not exists nfe_serie_omie text;           -- série como o espelho do Omie grava ('001')
alter table orders.fat_config add column if not exists info_complementar_padrao text; -- textos do Simples Nacional (infCpl)

update orders.fat_config set
  natureza_operacao = 'Venda de Mercadoria Adquirida/Recebida de Terceiros',
  nfe_serie_producao = '1',
  nfe_proximo_producao = coalesce(nfe_proximo_producao, 2193),
  nfe_serie_omie = '001',
  info_complementar_padrao = 'I-Documento emitido por ME ou EPP, optante pelo Simples Nacional. II-Nao gera direito a credito fiscal de IPI.',
  updated_at = now(), updated_by = 'nfe-producao-sf'
where empresa = 'SF';

-- 2) Emissões: origem "PV do Omie", rótulo da origem (PV1890) e marca de ensaio.
alter table orders.fat_emissoes drop constraint if exists fat_emissoes_origem_tipo_check;
alter table orders.fat_emissoes add constraint fat_emissoes_origem_tipo_check
  check (origem_tipo in ('pv','os','venda','manual','teste','pv_omie'));
alter table orders.fat_emissoes add column if not exists origem_rotulo text;
alter table orders.fat_emissoes add column if not exists ensaio boolean not null default false;

-- 3) Dados fiscais por produto (NCM/CEST/origem/unidade). CEST só vem do XML
--    autorizado; NCM/origem/unidade também do histórico de NF do espelho.
create table if not exists orders.fat_produto_fiscal (
  empresa        text not null,
  codigo_produto text not null,
  ncm            text,
  cest           text,
  origem         integer,
  unidade        text,
  fonte          text,
  updated_at     timestamptz not null default now(),
  primary key (empresa, codigo_produto)
);
alter table orders.fat_produto_fiscal enable row level security;
revoke all on orders.fat_produto_fiscal from anon, authenticated;
grant select, insert, update, delete on orders.fat_produto_fiscal to service_role;

insert into orders.fat_produto_fiscal (empresa, codigo_produto, ncm, cest, origem, unidade, fonte) values
('SF','3043002','84212100','2109800',0,'UN','xml_omie'),
('SF','3043019','84212100','0100200',0,'UN','xml_omie'),
('SF','3043081','84818099','2109800',0,'UN','xml_omie'),
('SF','38030009','39140011',null,0,'UN','xml_omie'),
('SF','38050016','84212100',null,0,'UN','xml_omie'),
('SF','38050023','84212100',null,0,'UN','xml_omie'),
('SF','MOR100E','84219991','0103900',0,'PC','xml_omie')
on conflict (empresa, codigo_produto) do update
  set ncm = excluded.ncm, cest = coalesce(excluded.cest, orders.fat_produto_fiscal.cest),
      origem = excluded.origem, unidade = excluded.unidade, fonte = excluded.fonte, updated_at = now();

-- histórico do espelho (última NF de cada produto), sem sobrescrever o que veio do XML
insert into orders.fat_produto_fiscal (empresa, codigo_produto, ncm, origem, unidade, fonte)
select distinct on (n.empresa, d->'prod'->>'cProd')
       n.empresa, d->'prod'->>'cProd',
       replace(d->'prod'->>'NCM', '.', ''),
       nullif(d->'prod'->>'cOrigem','')::int,
       nullif(d->'prod'->>'uCom',''),
       'nfe_saida'
from sales.nfe_saida n, jsonb_array_elements(n.raw->'det') d
where n.empresa = 'SF' and not n.cancelada and coalesce(d->'prod'->>'cProd','') <> ''
order by n.empresa, d->'prod'->>'cProd', n.emissao desc
on conflict (empresa, codigo_produto) do nothing;

-- 4) Guarda da numeração: alguma NF-e da empresa nesta série com número >= ao
--    que vamos usar já existe no espelho do Omie? (= alguém emitiu no Omie).
create or replace function orders.fat_guarda_numeracao(p_empresa text, p_numero integer)
returns text language sql stable security definer set search_path = '' as $$
  select case when max(n.numero::bigint) >= p_numero
    then format('O Omie já tem a NF-e nº %s (série %s, %s) da %s — numeração em conflito. Desligue a emissão no Omie e ajuste o próximo número antes de emitir.',
                max(n.numero::bigint), max(n.serie), max(n.emissao), p_empresa)
    end
  from sales.nfe_saida n
  join orders.fat_config c on c.empresa = n.empresa
  where n.empresa = p_empresa and n.numero ~ '^\d+$'
    and coalesce(n.serie, '') = coalesce(c.nfe_serie_omie, '001')
$$;
revoke all on function orders.fat_guarda_numeracao(text, integer) from public, anon, authenticated;
grant execute on function orders.fat_guarda_numeracao(text, integer) to service_role;

-- 5) PVs do Omie em aberto (10/20/50) ainda sem NF — no Omie nem no painel.
create or replace view orders.v_fat_pv_omie_abertos with (security_invoker = true) as
select p.empresa, p.codigo_pedido, p.numero_pedido, 'PV' || p.numero_pedido as rotulo, p.etapa,
       p.codigo_cliente, coalesce(pe.razao_social, c.razao_social) as cliente, p.valor_total,
       p.codigo_parcela, p.num_pedido_cliente, p.data_previsao,
       (select e.id from orders.fat_emissoes e
         where e.origem_tipo = 'pv_omie' and e.origem_id = p.codigo_pedido::text and not e.ensaio
           and e.ambiente = 'producao' and e.status in ('processando','autorizada') limit 1) as emissao_painel
from sales.pedidos_venda p
left join cadastros.pessoas pe on pe.empresa = p.empresa and pe.codigo = p.codigo_cliente
left join finance.clientes c on c.empresa = p.empresa and c.codigo_cliente_omie = p.codigo_cliente
where p.codigo_pedido < 9000000000000
  and p.etapa in ('10','20','50')
  and not exists (select 1 from sales.nfe_saida n
                  where n.empresa = p.empresa and not n.cancelada
                    and (n.raw->'compl'->>'nIdPedido') = p.codigo_pedido::text);
revoke all on orders.v_fat_pv_omie_abertos from anon, authenticated;
grant select on orders.v_fat_pv_omie_abertos to service_role;

-- 6) Documento de faturamento de um PV do Omie (espelho): cabeçalho, cliente
--    do cadastro próprio, transportadora, itens com dados fiscais e parcelas
--    pela condição (mesma regra do PV nativo: vendas.parcelas_da_condicao).
create or replace function orders.fat_pv_omie_doc(p_empresa text, p_codigo bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'pv', to_jsonb(p) - 'synced_at',
    'cliente', (select to_jsonb(pe) from cadastros.pessoas pe where pe.empresa = p.empresa and pe.codigo = p.codigo_cliente),
    'cliente_omie', (select to_jsonb(c) from finance.clientes c where c.empresa = p.empresa and c.codigo_cliente_omie = p.codigo_cliente),
    'transportadora', (select to_jsonb(t) from cadastros.pessoas t where t.empresa = p.empresa and t.codigo = nullif(p.cod_transportadora::text, '')::bigint),
    'itens', coalesce((select jsonb_agg(jsonb_build_object(
        'codigo', i.codigo_prod_omie, 'descricao', i.descricao, 'unidade', coalesce(nullif(i.unidade, ''), f.unidade),
        'quantidade', i.quantidade, 'valor_unitario', i.valor_unitario, 'valor_total', i.valor_total,
        'valor_desconto', i.valor_desconto,
        'ncm', coalesce(nullif(replace(i.ncm, '.', ''), ''), f.ncm), 'cest', f.cest,
        'origem', coalesce(nullif(i.icms_origem::text, '')::int, f.origem, 0)) order by i.codigo_item)
      from sales.itens_vendidos i
      left join orders.fat_produto_fiscal f on f.empresa = i.empresa and f.codigo_produto = i.codigo_prod_omie
      where i.empresa = p.empresa and i.codigo_pedido = p.codigo_pedido), '[]'::jsonb),
    'condicao', (select fp.descricao from sales.formas_pagamento fp where fp.empresa = p.empresa and fp.codigo = p.codigo_parcela),
    'parcelas_dias', (select jsonb_agg(x.dias order by x.numero)
      from vendas.parcelas_da_condicao(p.empresa, p.codigo_parcela, nullif(p.qtde_parcelas::text, '')::numeric::int, current_date, p.valor_total) x),
    'nf_omie', (select jsonb_build_object('numero', n.numero, 'serie', n.serie, 'emissao', n.emissao, 'chave', n.chave_nfe)
      from sales.nfe_saida n where n.empresa = p.empresa and not n.cancelada
        and (n.raw->'compl'->>'nIdPedido') = p.codigo_pedido::text limit 1),
    'emissao_painel', (select jsonb_build_object('id', e.id, 'status', e.status, 'numero', e.numero)
      from orders.fat_emissoes e where e.origem_tipo = 'pv_omie' and e.origem_id = p.codigo_pedido::text
        and not e.ensaio and e.ambiente = 'producao' and e.status in ('processando','autorizada') limit 1)
  )
  from sales.pedidos_venda p
  where p.empresa = p_empresa and p.codigo_pedido = p_codigo
$$;
revoke all on function orders.fat_pv_omie_doc(text, bigint) from public, anon, authenticated;
grant execute on function orders.fat_pv_omie_doc(text, bigint) to service_role;

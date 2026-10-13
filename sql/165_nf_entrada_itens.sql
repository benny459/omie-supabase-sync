-- 13/10/26 — Itens da NF do fornecedor, como ELE escreveu (código e descrição), ligados ao item
-- do pedido de compra. Para conferir o que chegou e falar com o fornecedor. Preenchido quando a
-- nota é lida (portal: /api/painel/compras/nf-entrada) — XML guardado em
-- financeiro-documentos/nf-entrada/<chave>.xml.
create table if not exists orders.nf_entrada_itens (
  chave text not null,
  n_item int not null,
  empresa text not null,
  pedido_id bigint,
  item_id bigint,            -- compras.itens.id
  cod_forn text, desc_forn text, ncm text, cfop text, un text,
  qtd numeric, vu numeric, vt numeric,
  ncod_prod bigint,          -- nosso produto (Omie), quando o recebimento associou
  x_ped text, n_item_ped text,
  fonte text,                -- xml_focus | xml_omie | xml_guardado | omie_recebimento
  tem_xml boolean not null default false,
  atualizado_em timestamptz not null default now(),
  primary key (chave, n_item)
);
create index if not exists nf_entrada_itens_pedido on orders.nf_entrada_itens (pedido_id);
create index if not exists nf_entrada_itens_item on orders.nf_entrada_itens (item_id);
alter table orders.nf_entrada_itens enable row level security;
grant all on orders.nf_entrada_itens to service_role;

-- p_itens: [{n_item, cod_forn, desc_forn, ncm, cfop, un, qtd, vu, vt, x_ped, n_item_ped, id_it_pedido_omie, ncod_prod}]
-- Liga ao item do pedido: 1) item do Omie (omie_ncod_item); 2) xPed = nº do PC e nItemPed = seq;
-- 3) mesmo produto (ncod_prod) no pedido, quando há um só.
create or replace function orders.nf_entrada_gravar(p_chave text, p_empresa text, p_pedido_id bigint, p_fonte text, p_tem_xml boolean, p_itens jsonb)
returns jsonb language plpgsql security definer set search_path to 'orders', 'compras', 'public' as $function$
declare v_num text;
begin
  select numero into v_num from compras.pedidos where id = p_pedido_id;
  insert into orders.nf_entrada_itens as t (chave, n_item, empresa, pedido_id, item_id, cod_forn, desc_forn, ncm, cfop, un, qtd, vu, vt,
                                            ncod_prod, x_ped, n_item_ped, fonte, tem_xml, atualizado_em)
  select p_chave, (x->>'n_item')::int, p_empresa, p_pedido_id,
         coalesce(
           (select i.id from compras.itens i where i.pedido_id = p_pedido_id and i.omie_ncod_item is not null
               and i.omie_ncod_item::text = nullif(x->>'id_it_pedido_omie', '') limit 1),
           (select i.id from compras.itens i where i.pedido_id = p_pedido_id and ltrim(coalesce(x->>'x_ped', ''), '0') = ltrim(v_num, '0')
               and i.seq::text = ltrim(coalesce(x->>'n_item_ped', ''), '0') limit 1),
           (select min(i.id) from compras.itens i where i.pedido_id = p_pedido_id and i.ncod_prod is not null
               and i.ncod_prod::text = nullif(x->>'ncod_prod', '') having count(*) = 1)),
         x->>'cod_forn', x->>'desc_forn', x->>'ncm', x->>'cfop', x->>'un',
         nullif(x->>'qtd', '')::numeric, nullif(x->>'vu', '')::numeric, nullif(x->>'vt', '')::numeric,
         nullif(x->>'ncod_prod', '')::bigint, x->>'x_ped', x->>'n_item_ped', p_fonte, p_tem_xml, now()
    from jsonb_array_elements(p_itens) x
  on conflict (chave, n_item) do update set
    pedido_id = excluded.pedido_id, item_id = coalesce(excluded.item_id, t.item_id),
    cod_forn = excluded.cod_forn, desc_forn = excluded.desc_forn, ncm = excluded.ncm, cfop = excluded.cfop, un = excluded.un,
    qtd = excluded.qtd, vu = excluded.vu, vt = excluded.vt, ncod_prod = coalesce(excluded.ncod_prod, t.ncod_prod),
    x_ped = excluded.x_ped, n_item_ped = excluded.n_item_ped,
    fonte = case when excluded.tem_xml or not t.tem_xml then excluded.fonte else t.fonte end,
    tem_xml = t.tem_xml or excluded.tem_xml, atualizado_em = now();
  return coalesce((select jsonb_agg(jsonb_build_object('n_item', n_item, 'item_id', item_id) order by n_item)
                     from orders.nf_entrada_itens where chave = p_chave), '[]'::jsonb);
end $function$;
grant execute on function orders.nf_entrada_gravar(text, text, bigint, text, boolean, jsonb) to service_role;

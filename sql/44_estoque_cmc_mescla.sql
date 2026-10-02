-- Estoque v2 (02/10/26) — CMC do principal depois de mesclagem.
-- Antes: o principal ficava com o CMC dele (ex.: R$ 9,66) mesmo recebendo 2.430 un a R$ 14,95 do código mesclado,
-- e o "Valor" saía subestimado. Agora: média ponderada pelo estoque POSITIVO de cada código (o próprio, no Omie,
-- + cada quantidade positiva que entrou por mesclagem, ao CMC do código de origem). Se nenhum tinha estoque
-- positivo: preço do último PC (dele ou dos mesclados). Desfazer a mesclagem reverte os ajustes → volta o CMC próprio.
-- Colunas novas no fim: cmc_ponderado, cmc_proprio, cmc_partes (para o tooltip), ult_preco.

create or replace view orders.v_estoque_item as
with pos as (
  select empresa, n_cod_prod, max(codigo) as codigo, orders.fn_html_unescape(max(descricao)) as descricao,
         sum(saldo) as saldo, sum(saldo_omie) as saldo_omie, sum(ajuste) as ajuste,
         sum(fisico) as fisico, sum(reservado) as reservado, sum(pendente) as pendente,
         coalesce(sum(cmc * greatest(saldo, 0)) / nullif(sum(greatest(saldo, 0)), 0), max(cmc)) as cmc,
         max(estoque_minimo) as estoque_minimo, max(data_posicao) as data_posicao,
         bool_or(saldo < 0) as local_negativo,
         jsonb_agg(jsonb_build_object('local', codigo_local_estoque::text, 'saldo', saldo, 'saldo_omie', saldo_omie,
           'ajuste', ajuste, 'pendente', pendente, 'reservado', reservado, 'cmc', cmc) order by codigo_local_estoque) as locais
  from orders.v_estoque_saldo_local group by 1, 2
), dono as (
  select empresa, secundario, dono from orders.v_estoque_mescla_dono
), c90 as (
  -- movimentos, consumo e PCs de um código mesclado contam no principal (dono)
  select m.empresa, coalesce(dn.dono, m.id_prod) as id_prod, sum(abs(m.qtde)) as q90
  from orders.estoque_movimentos m left join dono dn on dn.empresa = m.empresa and dn.secundario = m.id_prod
  where m.tipo = 'saida' and coalesce(m.cancelamento, 'N') <> 'S' and m.dt_mov >= current_date - 90
  group by 1, 2
), um as (
  select m.empresa, coalesce(dn.dono, m.id_prod) as id_prod, max(m.dt_mov) as ult, count(*) as n
  from orders.estoque_movimentos m left join dono dn on dn.empresa = m.empresa and dn.secundario = m.id_prod
  where coalesce(m.cancelamento, 'N') <> 'S' group by 1, 2
), pcs as (
  select p.empresa, coalesce(dn.dono, i.ncod_prod) as ncod_prod,
         count(*) filter (where coalesce(p.etapa, '') not in ('60', '80') and p.dt_rec is null
                            and coalesce(i.qtd_recebida, 0) < i.qtd
                            and p.emissao < current_date - 60 and p.emissao >= current_date - 730) as pcs_velhos,
         count(*) filter (where i.qtd_recebida > i.qtd) as rec_a_mais,
         max(p.emissao) as ult_pc,
         (array_agg(i.valor_unit order by p.emissao desc nulls last) filter (where i.valor_unit > 0))[1] as ult_preco
  from compras.itens i join compras.pedidos p on p.id = i.pedido_id
  left join dono dn on dn.empresa = p.empresa and dn.secundario = i.ncod_prod
  where p.tipo = 'PC' and not coalesce(p.cancelado, false) and i.ncod_prod is not null
  group by 1, 2
), dup as (
  select empresa, prod_a as id from orders.v_estoque_duplicidade
  union select empresa, prod_b from orders.v_estoque_duplicidade
), mesc as (
  select empresa, secundario, dono as principal from dono
), mc as (
  -- CMC depois de mesclagem: o que entrou de cada código mesclado (quantidade positiva × CMC dele)
  select a.empresa, a.n_cod_prod,
         sum(a.diferenca * a.cmc) as v_in, sum(a.diferenca) as q_in,
         jsonb_agg(jsonb_build_object('codigo', coalesce((select max(x.codigo) from orders.estoque_posicao x where x.empresa = a.empresa and x.n_cod_prod = d.secundario), d.secundario::text),
                                      'qtd', a.diferenca, 'cmc', a.cmc) order by a.id) as partes
  from platform.estoque_ajuste a join platform.estoque_duplicidade_decisao d on d.id = a.mescla_id
  where a.tipo = 'mesclagem' and a.status = 'aplicado' and d.ativo and d.decisao = 'mesclado' and a.n_cod_prod = d.principal and a.diferenca > 0
  group by 1, 2
), own as (
  select empresa, n_cod_prod, sum(greatest(saldo, 0) * cmc) as v, sum(greatest(saldo, 0)) as qq,
         coalesce(sum(cmc * greatest(saldo, 0)) / nullif(sum(greatest(saldo, 0)), 0), max(cmc)) as cmc
  from orders.estoque_posicao group by 1, 2
), cad as (
  select c.*, coalesce(c.n_cod_prod, -c.id) as id_item from platform.estoque_item_cadastro c
), cod as (
  select empresa, n_cod_prod,
         max(codigo) filter (where atual) as codigo_novo,
         array_remove(array_agg(codigo) filter (where not atual), null) as codigos_antigos
  from platform.estoque_item_codigo group by 1, 2
)
select pos.empresa, pos.n_cod_prod,
       coalesce(pos.codigo, cad.omie_codigo, cod.codigo_novo, pos.n_cod_prod::text) as codigo,
       coalesce(nullif(cad.descricao, ''), pos.descricao) as descricao,
       coalesce(nullif(cad.unidade, ''), sp.unidade) as unidade, coalesce(nullif(cad.ncm, ''), sp.ncm) as ncm,
       pos.saldo, pos.saldo_omie, pos.ajuste, pos.fisico, pos.reservado, pos.pendente,
       -- principal de mesclagem: média ponderada pelo estoque positivo de cada código (o dele no Omie + o que entrou);
       -- se nenhum tinha estoque positivo, o preço do último PC (dele ou dos mesclados)
       case when mc.n_cod_prod is null then pos.cmc
            else coalesce((coalesce(own.v, 0) + mc.v_in) / nullif(coalesce(own.qq, 0) + mc.q_in, 0), pcs.ult_preco, pos.cmc) end as cmc,
       pos.estoque_minimo, pos.data_posicao,
       pos.locais, jsonb_array_length(pos.locais) as n_locais, pos.local_negativo,
       coalesce(c90.q90, 0) as consumo_90d, um.ult as ult_mov, coalesce(um.n, 0) as n_mov,
       coalesce(pcs.pcs_velhos, 0) as pcs_velhos, coalesce(pcs.rec_a_mais, 0) as rec_a_mais, pcs.ult_pc,
       (dup.id is not null) as duplicidade,
       coalesce(pf.omie_codigo_familia, fam.codigo_familia) as codigo_familia,
       coalesce(pf.nome, fam.descricao_familia) as familia,
       mesc.principal as mesclado_em,
       coalesce((select max(x.codigo) from orders.estoque_posicao x where x.empresa = pos.empresa and x.n_cod_prod = mesc.principal),
                (select max(k.codigo) from platform.estoque_item_codigo k where k.empresa = pos.empresa and k.n_cod_prod = mesc.principal and k.atual)) as mesclado_em_codigo,
       -- painel: família com prefixo, código novo, cadastro
       pf.id as familia_id, pf.prefixo as familia_prefixo, pf.material as familia_material,
       cod.codigo_novo, cod.codigos_antigos,
       coalesce(pos.codigo, cad.omie_codigo) as codigo_omie,
       cad.id as cadastro_id, cad.origem as cadastro_origem, cad.ean, cad.preco_ref, cad.local_padrao,
       cad.minimo as alarme_minimo, cad.ponto_pedido as alarme_ponto_pedido, cad.maximo as alarme_maximo,
       cad.foto_url, cad.obs as cadastro_obs, coalesce(cad.ativo, true) as ativo,
       cad.omie_status, cad.omie_erro,
       (mc.n_cod_prod is not null) as cmc_ponderado, pos.cmc as cmc_proprio,
       case when mc.n_cod_prod is not null then
         jsonb_build_array(jsonb_build_object('codigo', pos.codigo, 'qtd', coalesce(own.qq, 0), 'cmc', coalesce(own.cmc, pos.cmc), 'proprio', true)) || mc.partes end as cmc_partes,
       pcs.ult_preco
from pos
left join c90 on c90.empresa = pos.empresa and c90.id_prod = pos.n_cod_prod
left join um on um.empresa = pos.empresa and um.id_prod = pos.n_cod_prod
left join pcs on pcs.empresa = pos.empresa and pcs.ncod_prod = pos.n_cod_prod
left join (select distinct on (empresa, id_omie) empresa, id_omie, unidade, ncm from sales.produtos order by empresa, id_omie, synced_at desc) sp
  on sp.empresa = pos.empresa and sp.id_omie = pos.n_cod_prod
left join (select distinct empresa, id from dup) dup on dup.empresa = pos.empresa and dup.id = pos.n_cod_prod
left join orders.produto_familia fam on fam.empresa = pos.empresa and fam.id_omie = pos.n_cod_prod
left join mesc on mesc.empresa = pos.empresa and mesc.secundario = pos.n_cod_prod
left join platform.estoque_item_familia itf on itf.empresa = pos.empresa and itf.n_cod_prod = pos.n_cod_prod
left join lateral (select f.id from platform.estoque_familia f
                   where f.empresa = pos.empresa and f.omie_codigo_familia = fam.codigo_familia and f.ativo limit 1) fo on true
left join platform.estoque_familia pf on pf.id = coalesce(itf.familia_id, fo.id)
left join cad on cad.empresa = pos.empresa and cad.id_item = pos.n_cod_prod
left join cod on cod.empresa = pos.empresa and cod.n_cod_prod = pos.n_cod_prod
left join mc on mc.empresa = pos.empresa and mc.n_cod_prod = pos.n_cod_prod
left join own on own.empresa = pos.empresa and own.n_cod_prod = pos.n_cod_prod;

revoke all on orders.v_estoque_item from anon, authenticated;

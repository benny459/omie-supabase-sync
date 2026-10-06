-- 06/10/26 — PC × máximo da RC (Benny): cada item do PC ligado a uma RC compara
-- o valor com o da RC (custo máximo da CP quando veio do CRM).
-- 1) compras_pedido passa a devolver rc.vuMax (valor unitário líquido da RC).
-- 2) compras_rc_resumo: itens das RCs com a cobertura e o valor já comprados nos
--    OUTROS pedidos (exclui p_excluir) — a folha soma o pedido aberto e diz se a
--    RC fica atendida integralmente e quanto custou vs o máximo.
create or replace function orders.compras_pedido(p_id bigint)
 returns jsonb language sql stable security definer set search_path to 'compras', 'public'
as $function$
  select jsonb_build_object(
    'id', p.id, 'tipo', p.tipo, 'num', p.numero, 'etapa', p.etapa, 'emp', p.empresa,
    'etapaOmie', p.etapa_omie, 'cancelado', p.cancelado,
    'forn', p.fornecedor_nome, 'fornCod', p.fornecedor_cod, 'cnpj', p.fornecedor_cnpj,
    'catCod', p.categoria_cod, 'cat', p.categoria_desc, 'comprador', p.comprador, 'compradorCod', p.comprador_cod,
    'projCod', p.projeto_cod, 'proj', p.projeto_nome, 'contaCod', p.conta_cod, 'conta', p.conta_desc,
    'parc', p.parcela_cod, 'emissao', p.emissao, 'previsao', p.previsao, 'contato', p.contato,
    'numForn', p.num_pedido_fornecedor, 'contrato', p.contrato, 'obs', p.obs, 'obsInt', p.obs_int,
    'pv', coalesce(p.pv_os_painel, p.pv_os), 'pvCliente', coalesce(p.pv_cliente_painel, p.pv_cliente),
    'nf', p.nf, 'chave', p.chave_nfe, 'criadoEm', p.created_at,
    'enviadoEm', p.enviado_em, 'enviadoPor', p.enviado_por, 'enviadoPara', p.enviado_para, 'enviadoMeio', p.enviado_meio,
    'pcsDaRc', (select coalesce(jsonb_agg(distinct pp.numero), '[]'::jsonb) from compras.itens ri
                  join compras.item_rc l on l.rc_item_id = ri.id join compras.itens pi on pi.id = l.pc_item_id
                  join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado where ri.pedido_id = p.id),
    'dtFat', p.dt_faturado, 'dtRec', p.dt_rec,
    'aprov', p.aprov_status, 'aprovPor', p.aprov_por, 'aprovEm', p.aprov_em, 'aprovValor', p.aprov_valor,
    'frete', p.frete, 'valor', p.valor_total, 'origem', p.origem, 'ncodPed', p.omie_ncod_ped,
    'sync', p.omie_sync_status) || jsonb_build_object(
    'itens', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', i.id, 'seq', i.seq, 'cod', i.produto_cod, 'ncodProd', i.ncod_prod, 'desc', i.descricao,
        'un', i.unidade, 'qtd', i.qtd, 'vu', i.valor_unit, 'desc0', i.desconto, 'ipi', i.ipi, 'st', i.st,
        'ncm', i.ncm, 'local', i.local_estoque, 'obs', i.obs, 'rec', i.qtd_recebida,
        'rc', (select jsonb_build_object('itemId', ri.id, 'num', rp.numero, 'idx', ri.seq, 'desc', ri.descricao, 'qtd', ri.qtd,
                        'vuMax', round(coalesce(ri.valor_unit, 0) - coalesce(coalesce(ri.desconto, 0) / nullif(ri.qtd, 0), 0), 4))
                 from compras.item_rc l join compras.itens ri on ri.id = l.rc_item_id
                 join compras.pedidos rp on rp.id = ri.pedido_id
                where l.pc_item_id = i.id limit 1),
        'cov', (select coalesce(sum(l.qtd), 0) from compras.item_rc l
                  join compras.itens pi on pi.id = l.pc_item_id
                  join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
                 where l.rc_item_id = i.id)
      ) order by i.seq, i.id) from compras.itens i where i.pedido_id = p.id), '[]'::jsonb),
    'parcelas', coalesce((select jsonb_agg(jsonb_build_object('n', x.n, 'venc', x.vencimento, 'valor', x.valor, 'doc', x.tipo_doc) order by x.n)
                            from compras.parcelas x where x.pedido_id = p.id), '[]'::jsonb),
    'deptos', coalesce((select jsonb_agg(jsonb_build_object('nome', d.departamento, 'perc', d.perc) order by d.departamento)
                          from compras.departamentos d where d.pedido_id = p.id), '[]'::jsonb),
    'hist', coalesce((select jsonb_agg(jsonb_build_object('t', h.texto, 'em', h.em, 'por', h.por) order by h.em, h.id)
                        from compras.historico h where h.pedido_id = p.id), '[]'::jsonb)
  )
  from compras.pedidos p where p.id = p_id
$function$;

create or replace function orders.compras_rc_resumo(p_emp text, p_nums text[], p_excluir bigint default null)
 returns jsonb language sql stable security definer set search_path to 'compras', 'public'
as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'num', rp.numero,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object(
        'id', ri.id, 'qtd', ri.qtd,
        'vuMax', round(coalesce(ri.valor_unit, 0) - coalesce(coalesce(ri.desconto, 0) / nullif(ri.qtd, 0), 0), 4),
        'covOutros', (select coalesce(sum(l.qtd), 0) from compras.item_rc l
                        join compras.itens pi on pi.id = l.pc_item_id
                        join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
                       where l.rc_item_id = ri.id and pp.id is distinct from p_excluir),
        'valOutros', (select coalesce(sum(l.qtd * (coalesce(pi.valor_unit, 0) - coalesce(coalesce(pi.desconto, 0) / nullif(pi.qtd, 0), 0))), 0)
                        from compras.item_rc l
                        join compras.itens pi on pi.id = l.pc_item_id
                        join compras.pedidos pp on pp.id = pi.pedido_id and not pp.cancelado
                       where l.rc_item_id = ri.id and pp.id is distinct from p_excluir)
      ) order by ri.seq, ri.id), '[]'::jsonb) from compras.itens ri where ri.pedido_id = rp.id)
  )), '[]'::jsonb)
  from compras.pedidos rp
  where rp.tipo = 'RC' and not rp.cancelado and rp.empresa = upper(p_emp) and rp.numero = any(p_nums)
$function$;
revoke all on function orders.compras_rc_resumo(text, text[], bigint) from public, anon, authenticated;
grant execute on function orders.compras_rc_resumo(text, text[], bigint) to service_role;

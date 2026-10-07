-- 07/10/26 (Benny, Sarah São Luís): no contrato não dava para ver o recibo
-- emitido nem saber que a emissão tinha falhado. O histórico de cada
-- competência passa a trazer a última emissão de recibo (número, situação,
-- PDF, erro) e a NFS-e registrada (número, PDF anexado).
create or replace function orders.contrato_detalhe(p_id bigint)
returns jsonb language sql stable security definer set search_path to 'vendas', 'public'
as $function$
  select jsonb_build_object(
    'contrato', to_jsonb(c),
    'itens', coalesce((select jsonb_agg(to_jsonb(i) order by i.seq) from vendas.contrato_itens i where i.contrato_id = c.id), '[]'::jsonb),
    'historico_faturas', coalesce((select jsonb_agg(jsonb_build_object('id', cc.id, 'competencia', cc.competencia, 'status',
         case when d.status = 'faturado' then 'faturado' when d.status = 'cancelado' then 'cancelado' else cc.status end,
         'origem', cc.origem, 'documento', cc.documento_rotulo, 'venda_id', cc.venda_id, 'valor', coalesce(d.valor_total, cc.valor),
         'data', coalesce(d.dt_fat, cc.data_faturamento), 'recibo', cc.recibo,
         'emissao', (select jsonb_build_object('id', e.id, 'tipo', e.tipo, 'status', e.status, 'numero', e.numero, 'pdf_path', e.pdf_path,
                       'mensagem', e.mensagem, 'ambiente', e.ambiente, 'em', e.created_at)
                       from orders.fat_emissoes e
                      where cc.venda_id is not null and e.origem_id = cc.venda_id::text and coalesce(e.origem_tipo, '') <> 'teste'
                      order by (e.status = 'autorizada') desc, e.created_at desc limit 1),
         'nfse', (select jsonb_build_object('id', m.id, 'numero', m.numero, 'municipio', m.municipio, 'tem_pdf', m.pdf_path is not null,
                       'data', m.data_emissao)
                    from orders.fat_nfse_manual m
                   where cc.venda_id is not null and m.status = 'registrada' and ('venda:' || cc.venda_id) = any(m.os_chaves)
                   order by m.id desc limit 1)
       ) order by cc.competencia desc)
       from vendas.contrato_competencias cc left join vendas.documentos d on d.id = cc.venda_id
      where cc.contrato_id = c.id and cc.status <> 'cancelado'), '[]'::jsonb),
    'reajustes', coalesce((select jsonb_agg(to_jsonb(r) order by r.vigente_desde desc) from vendas.contrato_reajustes r where r.contrato_id = c.id), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('por', h.por, 'acao', h.acao, 'detalhe', h.detalhe, 'em', h.em) order by h.em desc)
       from (select * from vendas.contrato_hist h where h.contrato_id = c.id order by em desc limit 40) h), '[]'::jsonb)
  ) from vendas.contratos c where c.id = p_id
$function$;

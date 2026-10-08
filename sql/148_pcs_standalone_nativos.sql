-- 148 · PCs criados no Compras do painel aparecem nas listas da Operação (08/10/26)
-- Desde 01/10 o PC nasce e vive em compras.pedidos; as listas antigas (PCs Standalone, Avulsos,
-- Standby, Projetos) liam só o espelho do Omie, e o PC 7388 da Cris "sumiu" para a Fernanda.
-- approval.v_pc_nativos traz os PCs do Compras no MESMO formato de approval.v_pc_completo_enriched,
-- com o mesmo modulo_calc (PJ → projetos · com PV/OS → avulsos · 40_VS/41_VP → standby · resto → pcs).
-- Fica de fora o que já aparece pelo caminho antigo: número de PC já ligado a uma RC
-- (approval.approvals.pc_numero_manual) ou que existe no espelho do Omie.
-- source = 'compras_painel' e custom_fields.compras_id: a tela abre o pedido no Compras
-- (aprovar/editar lá) em vez de gravar na aprovação antiga.
-- Por ora só a lista Standalone (approval.v_pc_pcs) passa a incluir esses PCs.

create or replace view approval.v_pc_nativos as
select
    (p.empresa)::text as empresa,
    (-(9000000000000 + p.id))::bigint as ncod_ped,
    (p.numero)::text as pc_numero,
    null::text as pc_numero_manual,
    (p.etapa)::text as pc_etapa_code,
    (case p.etapa when '20' then 'Requisição' when '10' then 'Pedido de Compra' when '15' then 'Aprovação' when '40' then 'Faturado pelo fornecedor' when '60' then 'Recebido' when '80' then 'Conferido' end)::text as pc_etapa_texto,
    null::text as status_omie,
    (p.categoria_cod)::text as codigo_categoria_code,
    (p.categoria_desc)::text as codigo_categoria,
    (p.fornecedor_cod)::bigint as codigo_fornecedor,
    (p.contato)::text as contato_fornecedor,
    (p.fornecedor_nome)::text as nome_fornecedor,
    (to_char(p.previsao::date, 'DD/MM/YYYY'))::text as dt_previsao,
    (p.projeto_cod)::bigint as codigo_projeto,
    (p.projeto_nome)::text as projeto_nome,
    null::text as pv_origem_numero,
    null::text as pv_origem_cod_int,
    (p.valor_total)::numeric as valor_total,
    (select count(*) from compras.itens i where i.pedido_id = p.id)::bigint as qtd_itens,
    (to_char(p.emissao::date, 'DD/MM/YYYY'))::text as dt_inclusao,
    (p.etapa)::text as etapa,
    (case when p.pv_os like 'PV%' then 'PV' when p.pv_os like 'OS%' then 'OS' end)::text as pv_os_tipo,
    (regexp_replace(p.pv_os, '^(PV|OS)', ''))::text as pv_os_numero,
    null::text as tipo_omie,
    null::text as pv_emissao,
    null::bigint as pv_cliente_codigo,
    null::text as pv_cliente_nome,
    null::text as pv_cliente_fantasia,
    null::text as pv_cliente_cidade,
    null::text as pv_cliente_estado,
    null::text as pv_codigo_projeto,
    null::text as pv_codigo_vendedor,
    null::text as pv_data_previsao,
    null::numeric as pv_valor_total,
    null::numeric as pv_qtd_itens,
    null::text as pv_etapa_code,
    null::text as pv_etapa_texto,
    null::text as pv_dt_fat,
    null::text as pv_num_nfe,
    null::text as nova_prev_materiais,
    null::text as nova_prev_servicos,
    (case p.aprov_status when 'aprovado' then 'APROVADO' when 'reprovado' then 'NAO_APROVADO' else 'PENDENTE' end)::text as status,
    (case p.aprov_status when 'aprovado' then 'Aprovado' when 'reprovado' then 'Não aprovado' when 'nao_solicitada' then 'Aprovação não solicitada' else 'Pendente' end)::text as status_label,
    null::text as modulo,
    null::uuid as aprovador_id,
    (p.aprov_por)::text as aprovador_email,
    (p.aprov_em::timestamptz)::timestamp with time zone as aprovado_em,
    (p.aprov_valor)::numeric as valor_aprovado,
    null::numeric as valor_aprovado_audit,
    null::date as aprovar_ate,
    null::text as prioridade,
    null::text as justificativa,
    null::text as comentario_aprovacao,
    (p.comprador)::text as comprador,
    null::text as status_material,
    null::numeric as rc_numero,
    null::text as rc_descricao,
    null::numeric as rc_custo,
    null::numeric as rc_custo_total,
    null::text as mt_status_fornecimento,
    null::date as mt_data_emissao_nf,
    null::date as mt_data_recebimento_nf,
    null::text as mt_nf_fornecedor,
    null::boolean as pc_pago,
    null::text as material_enviado,
    (jsonb_build_object('compras_id', p.id, 'origem', 'compras', 'link', '/erp/compras'))::jsonb as custom_fields,
    ('compras_painel')::text as source,
    null::text as smart_id,
    null::text as smart_tabela,
    (p.pv_os)::text as pv_os_label,
    null::timestamp with time zone as imported_at,
    (0)::bigint as num_comentarios,
    (0)::bigint as num_anexos,
    (p.previsao::date)::date as _dt_previsao_d,
    (p.emissao::date)::date as _dt_inclusao_d,
    null::date as _pv_data_previsao_d,
    null::numeric as rc_qtd,
    null::text as pc_projeto_nome,
    (false)::boolean as pc_projeto_mismatch,
    null::text as pc_projeto_alert,
    (false)::boolean as categoria_alert,
    null::text as categoria_alert_label,
    null::numeric as rc_custo_total_calc,
    (p.valor_total)::numeric as pc_custo_total_calc,
    null::integer as prazo_entrega_dias,
    null::date as aprovar_ate_calc,
    null::integer as dias_para_aprovar,
    null::integer as dias_prazo_pv,
    null::text as status_atraso_pv,
    null::numeric as dif_rc_pc,
    null::numeric as dif_pct_pc_rc,
    null::text as rc_pc_vs_rc,
    null::integer as mes_entrega,
    null::integer as ano_entrega,
    (true)::boolean as pc_valido,
    null::text as pc_forma_pagamento,
    (case when coalesce(p.projeto_nome, '') ~ '^PJ' then 'projetos' when coalesce(p.pv_os, '') <> '' then 'avulsos' when coalesce(p.projeto_nome, '') ~ '^(40_VS|41_VP)' then 'standby' else 'pcs' end)::text as modulo_calc,
    (coalesce(p.projeto_nome, '') = '')::boolean as sem_projeto,
    (p.emissao::date >= current_date - 1)::boolean as pc_is_new,
    (false)::boolean as pv_is_new,
    null::text as pv_numero_contrato,
    (false)::boolean as servicos_concluidos,
    null::text as servicos_os_numero,
    null::timestamp with time zone as servicos_concluidos_em,
    null::text as servicos_concluidos_por
  from compras.pedidos p
 where p.tipo = 'PC' and p.origem = 'painel' and not p.cancelado
   and not exists (select 1 from approval.approvals a where a.empresa = p.empresa and a.pc_numero_manual = p.numero)
   and not exists (select 1 from orders.pedidos_compra o where o.empresa = p.empresa and ltrim(o.cnumero, '0') = p.numero);

grant select on approval.v_pc_nativos to authenticated, service_role, bi_readonly, waterworks_bi;

-- Standalone passa a somar os PCs nativos do Compras com a mesma regra de módulo
-- (não PJ, não 40_VS/41_VP, sem PV/OS). As colunas não mudam, então
-- sales.mv_pc_pcs e approval.v_compras_por_cliente continuam valendo.
create or replace view approval.v_pc_pcs as
select * from approval.v_pc_completo_enriched where modulo_calc = 'pcs'
union all
select * from approval.v_pc_nativos where modulo_calc = 'pcs';

refresh materialized view concurrently sales.mv_pc_pcs;

-- 12: Linha manual de RC ancorada direto no projeto (sem PV/OS)
--
-- Problema: o "+ Nova linha" do painel cria placeholders em approval.approvals
-- ancorados exclusivamente em pv_os_label (PV%/OS%). A CTE manual_rc_rows da
-- v_pc_completo exige pv_os_label IS NOT NULL e resolve o projeto via PV/OS.
-- 84 projetos têm todos os PCs ligados direto ao projeto (sem PV/OS) — neles o
-- modal trava em "Escolha um PV/OS" sem opção nenhuma (reclamação do comprador,
-- 18/09/26: "consegui criar no PJ364 apenas").
--
-- Solução: coluna codigo_projeto em approval.approvals como âncora alternativa.
-- Mudanças na CTE manual_rc_rows (e SÓ nela):
--   1. WHERE aceita codigo_projeto IS NOT NULL como âncora
--   2. LEFT JOIN finance.projetos proj_direct pelo codigo_projeto
--   3. codigo_projeto e projeto_nome saem da âncora direta (fallback do PV/OS)
-- modulo_calc (v_pc_completo_enriched) classifica por projeto_nome ~ '^PJ',
-- então a linha cai no bucket certo sem tocar na view enriched.

ALTER TABLE approval.approvals ADD COLUMN IF NOT EXISTS codigo_projeto bigint;

CREATE OR REPLACE VIEW approval.v_pc_completo AS
 WITH agg AS (
         SELECT pc.empresa,
            pc.ncod_ped,
            max(pc.cnumero) AS pc_numero,
            max(pc.cetapa) AS etapa,
            max(pc.cdesc_status) AS status_omie,
            max(pc.ccod_categ) AS codigo_categoria,
            max(pc.ncod_for) AS codigo_fornecedor,
            max(pc.ccontato) AS contato_fornecedor,
            max(pc.ddt_previsao) AS dt_previsao,
            max(pc.ncod_proj) AS codigo_projeto,
            max(pc.cnum_pedido) AS pv_origem_numero_raw,
            max(pc.ccod_int_ped) AS pv_origem_cod_int,
            COALESCE(sum(pc.nval_tot), max(pc.ntotal_pedido)) AS valor_total,
            count(*) AS qtd_itens,
            max(pc.dinc_data) AS dt_inclusao
           FROM orders.pedidos_compra pc
          GROUP BY pc.empresa, pc.ncod_ped
        ), lbl AS (
         SELECT a.empresa,
            a.ncod_ped,
            a.pc_numero,
            a.etapa,
            a.status_omie,
            a.codigo_categoria,
            a.codigo_fornecedor,
            a.contato_fornecedor,
            a.dt_previsao,
            a.codigo_projeto,
            a.pv_origem_numero_raw,
            a.pv_origem_cod_int,
            a.valor_total,
            a.qtd_itens,
            a.dt_inclusao,
            a2.pv_os_label,
            a2.custom_fields,
            a2.pc_numero_manual,
                CASE
                    WHEN a2.pv_os_label ~~ 'PV%'::text THEN 'PV'::text
                    WHEN a2.pv_os_label ~~ 'OS%'::text THEN 'OS'::text
                    ELSE NULL::text
                END AS pv_os_tipo,
                CASE
                    WHEN a2.pv_os_label ~~ 'PV%'::text THEN regexp_replace(a2.pv_os_label, '^PV'::text, ''::text)
                    WHEN a2.pv_os_label ~~ 'OS%'::text THEN regexp_replace(a2.pv_os_label, '^OS'::text, ''::text)
                    ELSE NULL::text
                END AS pv_os_numero
           FROM agg a
             LEFT JOIN approval.approvals a2 ON a2.empresa = a.empresa AND a2.ncod_ped = a.ncod_ped
        ), pv_info AS (
         SELECT pedidos_venda.empresa,
            pedidos_venda.numero_pedido,
            max(pedidos_venda.codigo_pedido) AS codigo_pedido,
            max(pedidos_venda.codigo_cliente) AS codigo_cliente,
            max(pedidos_venda.data_previsao) AS data_previsao,
            max(pedidos_venda.etapa) AS etapa_code,
            max(pedidos_venda.valor_total) AS valor_total,
            max(pedidos_venda.quantidade_itens) AS quantidade_itens,
            max(pedidos_venda.codigo_projeto) AS codigo_projeto,
            max(pedidos_venda.codigo_vendedor) AS codigo_vendedor,
            max(pedidos_venda.d_inc) AS d_inc,
            max(pedidos_venda.numero_contrato) AS numero_contrato
           FROM sales.pedidos_venda
          GROUP BY pedidos_venda.empresa, pedidos_venda.numero_pedido
        ), os_info AS (
         SELECT ordens_servico.empresa,
            ordens_servico.numero_os,
            max(ordens_servico.codigo_os) AS codigo_os,
            max(ordens_servico.codigo_cliente) AS codigo_cliente,
            max(ordens_servico.dt_previsao) AS data_previsao,
            max(ordens_servico.etapa) AS etapa_code,
            max(ordens_servico.valor_total) AS valor_total,
            count(*) AS quantidade_itens,
            max(ordens_servico.codigo_projeto) AS codigo_projeto,
            max(ordens_servico.codigo_vendedor) AS codigo_vendedor,
            max(ordens_servico.d_inc) AS d_inc,
            max(ordens_servico.dt_fat) AS dt_fat,
            max(ordens_servico.num_recibo) AS num_recibo,
            max(ordens_servico.numero_contrato) AS numero_contrato
           FROM sales.ordens_servico
          GROUP BY ordens_servico.empresa, ordens_servico.numero_os
        ), pv_etapa_atual AS (
         SELECT etapas_pedidos.empresa,
            etapas_pedidos.codigo_pedido,
            max(etapas_pedidos.etapa) AS etapa_code,
            max(etapas_pedidos.dt_etapa) AS dt_etapa,
            max(etapas_pedidos.dt_fat) AS dt_fat,
            max(etapas_pedidos.num_nfe) AS num_nfe,
            max(etapas_pedidos.faturado) AS faturado
           FROM sales.etapas_pedidos
          GROUP BY etapas_pedidos.empresa, etapas_pedidos.codigo_pedido
        ), orphan_pv_os AS (
         SELECT pedidos_venda.empresa,
            'PV'::text || pedidos_venda.numero_pedido AS pv_os_label,
            'PV'::text AS pv_os_tipo,
            pedidos_venda.numero_pedido AS pv_os_numero
           FROM sales.pedidos_venda
          WHERE NOT (EXISTS ( SELECT 1
                   FROM approval.approvals a
                  WHERE a.empresa = pedidos_venda.empresa AND a.pv_os_label = ('PV'::text || pedidos_venda.numero_pedido))) AND approval.try_parse_br_date(pedidos_venda.d_inc) >= (CURRENT_DATE - '60 days'::interval)
        UNION ALL
         SELECT ordens_servico.empresa,
            'OS'::text || ordens_servico.numero_os,
            'OS'::text AS text,
            ordens_servico.numero_os
           FROM sales.ordens_servico
          WHERE NOT (EXISTS ( SELECT 1
                   FROM approval.approvals a
                  WHERE a.empresa = ordens_servico.empresa AND a.pv_os_label = ('OS'::text || ordens_servico.numero_os))) AND approval.try_parse_br_date(ordens_servico.d_inc) >= (CURRENT_DATE - '60 days'::interval)
        ), existing_rows AS (
         SELECT lbl.empresa,
            lbl.ncod_ped,
            COALESCE(lbl.pc_numero_manual, lbl.pc_numero) AS pc_numero,
            lbl.pc_numero_manual,
            lbl.etapa AS pc_etapa_code,
            pc_ef.desc_padrao AS pc_etapa_texto,
            lbl.status_omie,
            lbl.codigo_categoria AS codigo_categoria_code,
            cat.descricao AS codigo_categoria,
            lbl.codigo_fornecedor,
            lbl.contato_fornecedor,
            lbl.dt_previsao,
            lbl.codigo_projeto,
            COALESCE(proj_pv.nome, proj_pc.nome) AS projeto_nome,
            lbl.pv_origem_numero_raw AS pv_origem_numero,
            lbl.pv_origem_cod_int,
            lbl.valor_total,
            lbl.qtd_itens,
            lbl.dt_inclusao,
            lbl.etapa,
            lbl.pv_os_tipo,
            lbl.pv_os_numero,
            COALESCE(
                CASE COALESCE(pvi.codigo_vendedor, oss.codigo_vendedor)
                    WHEN '12533290404'::text THEN 'Mercantil'::text
                    WHEN '12047248754'::text THEN 'Serviços'::text
                    WHEN '12533290350'::text THEN 'Mix'::text
                    ELSE NULL::text
                END, lbl.custom_fields ->> 's6ebca6d00'::text,
                CASE lbl.pv_os_tipo
                    WHEN 'OS'::text THEN 'Serviços'::text
                    WHEN 'PV'::text THEN 'Mercantil'::text
                    ELSE NULL::text
                END) AS tipo_omie,
            COALESCE(pvi.d_inc, oss.d_inc) AS pv_emissao,
            COALESCE(pvi.codigo_cliente, NULLIF(oss.codigo_cliente, ''::text)::bigint) AS pv_cliente_codigo,
            cli.razao_social AS pv_cliente_nome,
            cli.nome_fantasia AS pv_cliente_fantasia,
            cli.cidade AS pv_cliente_cidade,
            cli.estado AS pv_cliente_estado,
            COALESCE(pvi.codigo_projeto, oss.codigo_projeto) AS pv_codigo_projeto,
            COALESCE(pvi.codigo_vendedor, oss.codigo_vendedor) AS pv_codigo_vendedor,
            COALESCE(pvi.data_previsao, oss.data_previsao) AS pv_data_previsao,
            COALESCE(pvi.valor_total, oss.valor_total) AS pv_valor_total,
            COALESCE(pvi.quantidade_itens, oss.quantidade_itens::numeric) AS pv_qtd_itens,
            COALESCE(pet.etapa_code, pvi.etapa_code, oss.etapa_code) AS pv_etapa_code,
                CASE
                    WHEN lbl.pv_os_tipo = 'PV'::text THEN pv_ef.desc_padrao
                    WHEN lbl.pv_os_tipo = 'OS'::text THEN os_ef.desc_padrao
                    ELSE NULL::text
                END AS pv_etapa_texto,
            COALESCE(pet.dt_fat, oss.dt_fat) AS pv_dt_fat,
            COALESCE(pet.num_nfe, oss.num_recibo) AS pv_num_nfe,
            lbl.custom_fields ->> 's4b87bk9'::text AS nova_prev_materiais,
            lbl.custom_fields ->> 's242fb18ba'::text AS nova_prev_servicos,
            COALESCE(a.status, 'PENDENTE'::text) AS status,
                CASE COALESCE(a.status, 'PENDENTE'::text)
                    WHEN 'APROVADO'::text THEN 'Aprovado!'::text
                    WHEN 'APROVADO_FAT_DIRETO'::text THEN 'Aprovado (Fat. Direto)'::text
                    WHEN 'NAO_APROVADO'::text THEN 'Não Aprovado'::text
                    WHEN 'REJEITADO_VALIDADE'::text THEN 'Rejeitado por Validade'::text
                    WHEN 'CANCELAR_PEDIDO'::text THEN 'Cancelar Pedido'::text
                    WHEN 'PRE_SELECAO'::text THEN 'Pré seleção'::text
                    WHEN 'N_A'::text THEN 'N/A'::text
                    ELSE 'Pendente'::text
                END AS status_label,
            a.modulo,
            a.aprovador_id,
            a.aprovador_email,
            a.aprovado_em,
            a.valor_aprovado,
            a.valor_aprovado_audit,
            a.aprovar_ate,
            a.prioridade,
            a.justificativa,
            a.comentario_aprovacao,
            a.comprador,
            a.status_material,
            a.rc_numero,
            a.rc_descricao,
            a.rc_custo,
            a.rc_custo_total,
            a.mt_status_fornecimento,
            a.mt_data_emissao_nf,
            a.mt_data_recebimento_nf,
            a.mt_nf_fornecedor,
            a.pc_pago,
            a.material_enviado,
            a.custom_fields,
            COALESCE(a.source, 'omie_sync'::text) AS source,
            a.smart_id,
            a.smart_tabela,
            a.pv_os_label,
            a.imported_at,
            ( SELECT count(*) AS count
                   FROM approval.comments co
                  WHERE co.empresa = lbl.empresa AND co.ncod_ped = lbl.ncod_ped AND co.deleted_at IS NULL) AS num_comentarios,
            ( SELECT count(*) AS count
                   FROM approval.attachments at2
                  WHERE at2.empresa = lbl.empresa AND at2.ncod_ped = lbl.ncod_ped AND at2.deleted_at IS NULL) AS num_anexos,
            COALESCE(pvi.numero_contrato, oss.numero_contrato) AS pv_numero_contrato,
            COALESCE(a.servicos_concluidos, false) AS servicos_concluidos,
            a.servicos_os_numero,
            a.servicos_concluidos_em,
            a.servicos_concluidos_por
           FROM lbl
             LEFT JOIN approval.approvals a ON a.empresa = lbl.empresa AND a.ncod_ped = lbl.ncod_ped
             LEFT JOIN pv_info pvi ON pvi.empresa = lbl.empresa AND lbl.pv_os_tipo = 'PV'::text AND pvi.numero_pedido = lbl.pv_os_numero
             LEFT JOIN os_info oss ON oss.empresa = lbl.empresa AND lbl.pv_os_tipo = 'OS'::text AND oss.numero_os = lbl.pv_os_numero
             LEFT JOIN pv_etapa_atual pet ON pet.empresa = lbl.empresa AND pet.codigo_pedido = pvi.codigo_pedido
             LEFT JOIN orders.etapas_faturamento pv_ef ON pv_ef.empresa = lbl.empresa AND pv_ef.desc_operacao = 'Venda de Produto'::text AND pv_ef.cod_etapa = COALESCE(pet.etapa_code, pvi.etapa_code)
             LEFT JOIN orders.etapas_faturamento os_ef ON os_ef.empresa = lbl.empresa AND os_ef.desc_operacao = 'Venda de Serviço'::text AND os_ef.cod_etapa = oss.etapa_code
             LEFT JOIN orders.etapas_faturamento pc_ef ON pc_ef.empresa = lbl.empresa AND pc_ef.desc_operacao = 'Compra de Produto'::text AND pc_ef.cod_etapa = lbl.etapa
             LEFT JOIN finance.categorias cat ON cat.empresa = lbl.empresa AND cat.codigo = lbl.codigo_categoria
             LEFT JOIN finance.projetos proj_pv ON proj_pv.empresa = lbl.empresa AND proj_pv.codigo::text = COALESCE(pvi.codigo_projeto, oss.codigo_projeto)
             LEFT JOIN finance.projetos proj_pc ON proj_pc.empresa = lbl.empresa AND proj_pc.codigo = lbl.codigo_projeto
             LEFT JOIN finance.clientes cli ON cli.empresa = lbl.empresa AND cli.codigo_cliente_omie = COALESCE(pvi.codigo_cliente, NULLIF(oss.codigo_cliente, ''::text)::bigint)
        ), orphan_rows AS (
         SELECT po.empresa,
            - regexp_replace(po.pv_os_label, '[^0-9]'::text, ''::text, 'g'::text)::bigint AS ncod_ped,
            NULL::text AS pc_numero,
            NULL::text AS pc_numero_manual,
            NULL::text AS pc_etapa_code,
            NULL::text AS pc_etapa_texto,
            NULL::text AS status_omie,
            NULL::text AS codigo_categoria_code,
            NULL::text AS codigo_categoria,
            NULL::bigint AS codigo_fornecedor,
            NULL::text AS contato_fornecedor,
            NULL::text AS dt_previsao,
            NULL::bigint AS codigo_projeto,
            proj_pv.nome AS projeto_nome,
            NULL::text AS pv_origem_numero,
            NULL::text AS pv_origem_cod_int,
            NULL::numeric AS valor_total,
            0::bigint AS qtd_itens,
            NULL::text AS dt_inclusao,
            NULL::text AS etapa,
            po.pv_os_tipo,
            po.pv_os_numero,
                CASE COALESCE(pvi.codigo_vendedor, oss.codigo_vendedor)
                    WHEN '12533290404'::text THEN 'Mercantil'::text
                    WHEN '12047248754'::text THEN 'Serviços'::text
                    WHEN '12533290350'::text THEN 'Mix'::text
                    ELSE
                    CASE po.pv_os_tipo
                        WHEN 'OS'::text THEN 'Serviços'::text
                        ELSE 'Mercantil'::text
                    END
                END AS tipo_omie,
            COALESCE(pvi.d_inc, oss.d_inc) AS pv_emissao,
            COALESCE(pvi.codigo_cliente, NULLIF(oss.codigo_cliente, ''::text)::bigint) AS pv_cliente_codigo,
            cli.razao_social AS pv_cliente_nome,
            cli.nome_fantasia AS pv_cliente_fantasia,
            cli.cidade AS pv_cliente_cidade,
            cli.estado AS pv_cliente_estado,
            COALESCE(pvi.codigo_projeto, oss.codigo_projeto) AS pv_codigo_projeto,
            COALESCE(pvi.codigo_vendedor, oss.codigo_vendedor) AS pv_codigo_vendedor,
            COALESCE(pvi.data_previsao, oss.data_previsao) AS pv_data_previsao,
            COALESCE(pvi.valor_total, oss.valor_total) AS pv_valor_total,
            COALESCE(pvi.quantidade_itens, oss.quantidade_itens::numeric) AS pv_qtd_itens,
            COALESCE(pet.etapa_code, pvi.etapa_code, oss.etapa_code) AS pv_etapa_code,
                CASE
                    WHEN po.pv_os_tipo = 'PV'::text THEN pv_ef.desc_padrao
                    WHEN po.pv_os_tipo = 'OS'::text THEN os_ef.desc_padrao
                    ELSE NULL::text
                END AS pv_etapa_texto,
            COALESCE(pet.dt_fat, oss.dt_fat) AS pv_dt_fat,
            COALESCE(pet.num_nfe, oss.num_recibo) AS pv_num_nfe,
            NULL::text AS nova_prev_materiais,
            NULL::text AS nova_prev_servicos,
            'PENDENTE'::text AS status,
            'Pendente'::text AS status_label,
                CASE
                    WHEN po.pv_os_tipo = 'OS'::text AND COALESCE(pvi.codigo_projeto, oss.codigo_projeto) IS NOT NULL THEN 'projetos'::text
                    ELSE 'avulsos'::text
                END AS modulo,
            NULL::uuid AS aprovador_id,
            NULL::text AS aprovador_email,
            NULL::timestamp with time zone AS aprovado_em,
            NULL::numeric AS valor_aprovado,
            NULL::numeric AS valor_aprovado_audit,
            NULL::date AS aprovar_ate,
            NULL::text AS prioridade,
            NULL::text AS justificativa,
            NULL::text AS comentario_aprovacao,
            NULL::text AS comprador,
            NULL::text AS status_material,
            NULL::numeric AS rc_numero,
            NULL::text AS rc_descricao,
            NULL::numeric AS rc_custo,
            NULL::numeric AS rc_custo_total,
            NULL::text AS mt_status_fornecimento,
            NULL::date AS mt_data_emissao_nf,
            NULL::date AS mt_data_recebimento_nf,
            NULL::text AS mt_nf_fornecedor,
            NULL::boolean AS pc_pago,
            NULL::text AS material_enviado,
            '{}'::jsonb AS custom_fields,
            'omie_new'::text AS source,
            NULL::text AS smart_id,
            NULL::text AS smart_tabela,
            po.pv_os_label,
            NULL::timestamp with time zone AS imported_at,
            0::bigint AS num_comentarios,
            0::bigint AS num_anexos,
            COALESCE(pvi.numero_contrato, oss.numero_contrato) AS pv_numero_contrato,
            false AS servicos_concluidos,
            NULL::text AS servicos_os_numero,
            NULL::timestamp with time zone AS servicos_concluidos_em,
            NULL::text AS servicos_concluidos_por
           FROM orphan_pv_os po
             LEFT JOIN pv_info pvi ON pvi.empresa = po.empresa AND po.pv_os_tipo = 'PV'::text AND pvi.numero_pedido = po.pv_os_numero
             LEFT JOIN os_info oss ON oss.empresa = po.empresa AND po.pv_os_tipo = 'OS'::text AND oss.numero_os = po.pv_os_numero
             LEFT JOIN pv_etapa_atual pet ON pet.empresa = po.empresa AND pet.codigo_pedido = pvi.codigo_pedido
             LEFT JOIN orders.etapas_faturamento pv_ef ON pv_ef.empresa = po.empresa AND pv_ef.desc_operacao = 'Venda de Produto'::text AND pv_ef.cod_etapa = COALESCE(pet.etapa_code, pvi.etapa_code)
             LEFT JOIN orders.etapas_faturamento os_ef ON os_ef.empresa = po.empresa AND os_ef.desc_operacao = 'Venda de Serviço'::text AND os_ef.cod_etapa = oss.etapa_code
             LEFT JOIN finance.projetos proj_pv ON proj_pv.empresa = po.empresa AND proj_pv.codigo::text = COALESCE(pvi.codigo_projeto, oss.codigo_projeto)
             LEFT JOIN finance.clientes cli ON cli.empresa = po.empresa AND cli.codigo_cliente_omie = COALESCE(pvi.codigo_cliente, NULLIF(oss.codigo_cliente, ''::text)::bigint)
        ), manual_rc_rows AS (
         SELECT a.empresa,
            a.ncod_ped,
            a.pc_numero_manual AS pc_numero,
            a.pc_numero_manual,
            NULL::text AS pc_etapa_code,
            NULL::text AS pc_etapa_texto,
            NULL::text AS status_omie,
            NULL::text AS codigo_categoria_code,
            NULL::text AS codigo_categoria,
            NULL::bigint AS codigo_fornecedor,
            NULL::text AS contato_fornecedor,
            NULL::text AS dt_previsao,
            a.codigo_projeto AS codigo_projeto,
            COALESCE(proj_pv.nome, proj_direct.nome) AS projeto_nome,
            NULL::text AS pv_origem_numero,
            NULL::text AS pv_origem_cod_int,
            NULL::numeric AS valor_total,
            0::bigint AS qtd_itens,
            NULL::text AS dt_inclusao,
            NULL::text AS etapa,
                CASE
                    WHEN a.pv_os_label ~~ 'PV%'::text THEN 'PV'::text
                    WHEN a.pv_os_label ~~ 'OS%'::text THEN 'OS'::text
                    ELSE NULL::text
                END AS pv_os_tipo,
                CASE
                    WHEN a.pv_os_label ~~ 'PV%'::text THEN regexp_replace(a.pv_os_label, '^PV'::text, ''::text)
                    WHEN a.pv_os_label ~~ 'OS%'::text THEN regexp_replace(a.pv_os_label, '^OS'::text, ''::text)
                    ELSE NULL::text
                END AS pv_os_numero,
                CASE COALESCE(pvi.codigo_vendedor, oss.codigo_vendedor)
                    WHEN '12533290404'::text THEN 'Mercantil'::text
                    WHEN '12047248754'::text THEN 'Serviços'::text
                    WHEN '12533290350'::text THEN 'Mix'::text
                    ELSE
                    CASE
                        WHEN a.pv_os_label ~~ 'OS%'::text THEN 'Serviços'::text
                        ELSE 'Mercantil'::text
                    END
                END AS tipo_omie,
            COALESCE(pvi.d_inc, oss.d_inc) AS pv_emissao,
            COALESCE(pvi.codigo_cliente, NULLIF(oss.codigo_cliente, ''::text)::bigint) AS pv_cliente_codigo,
            cli.razao_social AS pv_cliente_nome,
            cli.nome_fantasia AS pv_cliente_fantasia,
            cli.cidade AS pv_cliente_cidade,
            cli.estado AS pv_cliente_estado,
            COALESCE(pvi.codigo_projeto, oss.codigo_projeto) AS pv_codigo_projeto,
            COALESCE(pvi.codigo_vendedor, oss.codigo_vendedor) AS pv_codigo_vendedor,
            COALESCE(pvi.data_previsao, oss.data_previsao) AS pv_data_previsao,
            COALESCE(pvi.valor_total, oss.valor_total) AS pv_valor_total,
            COALESCE(pvi.quantidade_itens, oss.quantidade_itens::numeric) AS pv_qtd_itens,
            COALESCE(pet.etapa_code, pvi.etapa_code, oss.etapa_code) AS pv_etapa_code,
                CASE
                    WHEN a.pv_os_label ~~ 'PV%'::text THEN pv_ef.desc_padrao
                    WHEN a.pv_os_label ~~ 'OS%'::text THEN os_ef.desc_padrao
                    ELSE NULL::text
                END AS pv_etapa_texto,
            COALESCE(pet.dt_fat, oss.dt_fat) AS pv_dt_fat,
            COALESCE(pet.num_nfe, oss.num_recibo) AS pv_num_nfe,
            a.custom_fields ->> 's4b87bk9'::text AS nova_prev_materiais,
            a.custom_fields ->> 's242fb18ba'::text AS nova_prev_servicos,
            COALESCE(a.status, 'PENDENTE'::text) AS status,
                CASE COALESCE(a.status, 'PENDENTE'::text)
                    WHEN 'APROVADO'::text THEN 'Aprovado!'::text
                    WHEN 'APROVADO_FAT_DIRETO'::text THEN 'Aprovado (Fat. Direto)'::text
                    WHEN 'NAO_APROVADO'::text THEN 'Não Aprovado'::text
                    WHEN 'REJEITADO_VALIDADE'::text THEN 'Rejeitado por Validade'::text
                    WHEN 'CANCELAR_PEDIDO'::text THEN 'Cancelar Pedido'::text
                    WHEN 'PRE_SELECAO'::text THEN 'Pré seleção'::text
                    WHEN 'N_A'::text THEN 'N/A'::text
                    ELSE 'Pendente'::text
                END AS status_label,
            a.modulo,
            a.aprovador_id,
            a.aprovador_email,
            a.aprovado_em,
            a.valor_aprovado,
            a.valor_aprovado_audit,
            a.aprovar_ate,
            a.prioridade,
            a.justificativa,
            a.comentario_aprovacao,
            a.comprador,
            a.status_material,
            a.rc_numero,
            a.rc_descricao,
            a.rc_custo,
            a.rc_custo_total,
            a.mt_status_fornecimento,
            a.mt_data_emissao_nf,
            a.mt_data_recebimento_nf,
            a.mt_nf_fornecedor,
            a.pc_pago,
            a.material_enviado,
            a.custom_fields,
            COALESCE(a.source, 'manual'::text) AS source,
            a.smart_id,
            a.smart_tabela,
            a.pv_os_label,
            a.imported_at,
            0::bigint AS num_comentarios,
            0::bigint AS num_anexos,
            COALESCE(pvi.numero_contrato, oss.numero_contrato) AS pv_numero_contrato,
            COALESCE(a.servicos_concluidos, false) AS servicos_concluidos,
            a.servicos_os_numero,
            a.servicos_concluidos_em,
            a.servicos_concluidos_por
           FROM approval.approvals a
             LEFT JOIN pv_info pvi ON pvi.empresa = a.empresa AND a.pv_os_label ~~ 'PV%'::text AND pvi.numero_pedido = regexp_replace(a.pv_os_label, '^PV'::text, ''::text)
             LEFT JOIN os_info oss ON oss.empresa = a.empresa AND a.pv_os_label ~~ 'OS%'::text AND oss.numero_os = regexp_replace(a.pv_os_label, '^OS'::text, ''::text)
             LEFT JOIN pv_etapa_atual pet ON pet.empresa = a.empresa AND pet.codigo_pedido = pvi.codigo_pedido
             LEFT JOIN orders.etapas_faturamento pv_ef ON pv_ef.empresa = a.empresa AND pv_ef.desc_operacao = 'Venda de Produto'::text AND pv_ef.cod_etapa = COALESCE(pet.etapa_code, pvi.etapa_code)
             LEFT JOIN orders.etapas_faturamento os_ef ON os_ef.empresa = a.empresa AND os_ef.desc_operacao = 'Venda de Serviço'::text AND os_ef.cod_etapa = oss.etapa_code
             LEFT JOIN finance.projetos proj_pv ON proj_pv.empresa = a.empresa AND proj_pv.codigo::text = COALESCE(pvi.codigo_projeto, oss.codigo_projeto)
             LEFT JOIN finance.projetos proj_direct ON proj_direct.empresa = a.empresa AND proj_direct.codigo = a.codigo_projeto
             LEFT JOIN finance.clientes cli ON cli.empresa = a.empresa AND cli.codigo_cliente_omie = COALESCE(pvi.codigo_cliente, NULLIF(oss.codigo_cliente, ''::text)::bigint)
          WHERE a.ncod_ped < 0 AND (a.pv_os_label IS NOT NULL OR a.codigo_projeto IS NOT NULL) AND COALESCE(a.modulo, 'avulsos'::text) <> 'pcs'::text
        ), manual_pc_rows AS (
         SELECT a.empresa,
            a.ncod_ped,
            a.pc_numero_manual AS pc_numero,
            a.pc_numero_manual,
            NULL::text AS pc_etapa_code,
            NULL::text AS pc_etapa_texto,
            NULL::text AS status_omie,
            NULL::text AS codigo_categoria_code,
            NULL::text AS codigo_categoria,
            NULL::bigint AS codigo_fornecedor,
            NULL::text AS contato_fornecedor,
            NULL::text AS dt_previsao,
            NULL::bigint AS codigo_projeto,
            NULL::text AS projeto_nome,
            NULL::text AS pv_origem_numero,
            NULL::text AS pv_origem_cod_int,
            NULL::numeric AS valor_total,
            0::bigint AS qtd_itens,
            NULL::text AS dt_inclusao,
            NULL::text AS etapa,
            NULL::text AS pv_os_tipo,
            NULL::text AS pv_os_numero,
            NULL::text AS tipo_omie,
            NULL::text AS pv_emissao,
            NULL::bigint AS pv_cliente_codigo,
            NULL::text AS pv_cliente_nome,
            NULL::text AS pv_cliente_fantasia,
            NULL::text AS pv_cliente_cidade,
            NULL::text AS pv_cliente_estado,
            NULL::text AS pv_codigo_projeto,
            NULL::text AS pv_codigo_vendedor,
            NULL::text AS pv_data_previsao,
            NULL::numeric AS pv_valor_total,
            NULL::numeric AS pv_qtd_itens,
            NULL::text AS pv_etapa_code,
            NULL::text AS pv_etapa_texto,
            NULL::text AS pv_dt_fat,
            NULL::text AS pv_num_nfe,
            NULL::text AS nova_prev_materiais,
            NULL::text AS nova_prev_servicos,
            COALESCE(a.status, 'PENDENTE'::text) AS status,
                CASE COALESCE(a.status, 'PENDENTE'::text)
                    WHEN 'APROVADO'::text THEN 'Aprovado!'::text
                    WHEN 'APROVADO_FAT_DIRETO'::text THEN 'Aprovado (Fat. Direto)'::text
                    WHEN 'NAO_APROVADO'::text THEN 'Não Aprovado'::text
                    WHEN 'REJEITADO_VALIDADE'::text THEN 'Rejeitado por Validade'::text
                    WHEN 'CANCELAR_PEDIDO'::text THEN 'Cancelar Pedido'::text
                    WHEN 'PRE_SELECAO'::text THEN 'Pré seleção'::text
                    WHEN 'N_A'::text THEN 'N/A'::text
                    ELSE 'Pendente'::text
                END AS status_label,
            a.modulo,
            a.aprovador_id,
            a.aprovador_email,
            a.aprovado_em,
            a.valor_aprovado,
            a.valor_aprovado_audit,
            a.aprovar_ate,
            a.prioridade,
            a.justificativa,
            a.comentario_aprovacao,
            a.comprador,
            a.status_material,
            a.rc_numero,
            a.rc_descricao,
            a.rc_custo,
            a.rc_custo_total,
            a.mt_status_fornecimento,
            a.mt_data_emissao_nf,
            a.mt_data_recebimento_nf,
            a.mt_nf_fornecedor,
            a.pc_pago,
            a.material_enviado,
            a.custom_fields,
            COALESCE(a.source, 'manual'::text) AS source,
            a.smart_id,
            a.smart_tabela,
            a.pv_os_label,
            a.imported_at,
            0::bigint AS num_comentarios,
            0::bigint AS num_anexos,
            NULL::text AS pv_numero_contrato,
            COALESCE(a.servicos_concluidos, false) AS servicos_concluidos,
            a.servicos_os_numero,
            a.servicos_concluidos_em,
            a.servicos_concluidos_por
           FROM approval.approvals a
          WHERE a.modulo = 'pcs'::text AND a.ncod_ped < 0 AND a.pc_numero_manual IS NOT NULL
        )
 SELECT existing_rows.empresa,
    existing_rows.ncod_ped,
    existing_rows.pc_numero,
    existing_rows.pc_numero_manual,
    existing_rows.pc_etapa_code,
    existing_rows.pc_etapa_texto,
    existing_rows.status_omie,
    existing_rows.codigo_categoria_code,
    existing_rows.codigo_categoria,
    existing_rows.codigo_fornecedor,
    existing_rows.contato_fornecedor,
    existing_rows.dt_previsao,
    existing_rows.codigo_projeto,
    existing_rows.projeto_nome,
    existing_rows.pv_origem_numero,
    existing_rows.pv_origem_cod_int,
    existing_rows.valor_total,
    existing_rows.qtd_itens,
    existing_rows.dt_inclusao,
    existing_rows.etapa,
    existing_rows.pv_os_tipo,
    existing_rows.pv_os_numero,
    existing_rows.tipo_omie,
    existing_rows.pv_emissao,
    existing_rows.pv_cliente_codigo,
    existing_rows.pv_cliente_nome,
    existing_rows.pv_cliente_fantasia,
    existing_rows.pv_cliente_cidade,
    existing_rows.pv_cliente_estado,
    existing_rows.pv_codigo_projeto,
    existing_rows.pv_codigo_vendedor,
    existing_rows.pv_data_previsao,
    existing_rows.pv_valor_total,
    existing_rows.pv_qtd_itens,
    existing_rows.pv_etapa_code,
    existing_rows.pv_etapa_texto,
    existing_rows.pv_dt_fat,
    existing_rows.pv_num_nfe,
    existing_rows.nova_prev_materiais,
    existing_rows.nova_prev_servicos,
    existing_rows.status,
    existing_rows.status_label,
    existing_rows.modulo,
    existing_rows.aprovador_id,
    existing_rows.aprovador_email,
    existing_rows.aprovado_em,
    existing_rows.valor_aprovado,
    existing_rows.valor_aprovado_audit,
    existing_rows.aprovar_ate,
    existing_rows.prioridade,
    existing_rows.justificativa,
    existing_rows.comentario_aprovacao,
    existing_rows.comprador,
    existing_rows.status_material,
    existing_rows.rc_numero,
    existing_rows.rc_descricao,
    existing_rows.rc_custo,
    existing_rows.rc_custo_total,
    existing_rows.mt_status_fornecimento,
    existing_rows.mt_data_emissao_nf,
    existing_rows.mt_data_recebimento_nf,
    existing_rows.mt_nf_fornecedor,
    existing_rows.pc_pago,
    existing_rows.material_enviado,
    existing_rows.custom_fields,
    existing_rows.source,
    existing_rows.smart_id,
    existing_rows.smart_tabela,
    existing_rows.pv_os_label,
    existing_rows.imported_at,
    existing_rows.num_comentarios,
    existing_rows.num_anexos,
    existing_rows.pv_numero_contrato,
    existing_rows.servicos_concluidos,
    existing_rows.servicos_os_numero,
    existing_rows.servicos_concluidos_em,
    existing_rows.servicos_concluidos_por
   FROM existing_rows
UNION ALL
 SELECT orphan_rows.empresa,
    orphan_rows.ncod_ped,
    orphan_rows.pc_numero,
    orphan_rows.pc_numero_manual,
    orphan_rows.pc_etapa_code,
    orphan_rows.pc_etapa_texto,
    orphan_rows.status_omie,
    orphan_rows.codigo_categoria_code,
    orphan_rows.codigo_categoria,
    orphan_rows.codigo_fornecedor,
    orphan_rows.contato_fornecedor,
    orphan_rows.dt_previsao,
    orphan_rows.codigo_projeto,
    orphan_rows.projeto_nome,
    orphan_rows.pv_origem_numero,
    orphan_rows.pv_origem_cod_int,
    orphan_rows.valor_total,
    orphan_rows.qtd_itens,
    orphan_rows.dt_inclusao,
    orphan_rows.etapa,
    orphan_rows.pv_os_tipo,
    orphan_rows.pv_os_numero,
    orphan_rows.tipo_omie,
    orphan_rows.pv_emissao,
    orphan_rows.pv_cliente_codigo,
    orphan_rows.pv_cliente_nome,
    orphan_rows.pv_cliente_fantasia,
    orphan_rows.pv_cliente_cidade,
    orphan_rows.pv_cliente_estado,
    orphan_rows.pv_codigo_projeto,
    orphan_rows.pv_codigo_vendedor,
    orphan_rows.pv_data_previsao,
    orphan_rows.pv_valor_total,
    orphan_rows.pv_qtd_itens,
    orphan_rows.pv_etapa_code,
    orphan_rows.pv_etapa_texto,
    orphan_rows.pv_dt_fat,
    orphan_rows.pv_num_nfe,
    orphan_rows.nova_prev_materiais,
    orphan_rows.nova_prev_servicos,
    orphan_rows.status,
    orphan_rows.status_label,
    orphan_rows.modulo,
    orphan_rows.aprovador_id,
    orphan_rows.aprovador_email,
    orphan_rows.aprovado_em,
    orphan_rows.valor_aprovado,
    orphan_rows.valor_aprovado_audit,
    orphan_rows.aprovar_ate,
    orphan_rows.prioridade,
    orphan_rows.justificativa,
    orphan_rows.comentario_aprovacao,
    orphan_rows.comprador,
    orphan_rows.status_material,
    orphan_rows.rc_numero,
    orphan_rows.rc_descricao,
    orphan_rows.rc_custo,
    orphan_rows.rc_custo_total,
    orphan_rows.mt_status_fornecimento,
    orphan_rows.mt_data_emissao_nf,
    orphan_rows.mt_data_recebimento_nf,
    orphan_rows.mt_nf_fornecedor,
    orphan_rows.pc_pago,
    orphan_rows.material_enviado,
    orphan_rows.custom_fields,
    orphan_rows.source,
    orphan_rows.smart_id,
    orphan_rows.smart_tabela,
    orphan_rows.pv_os_label,
    orphan_rows.imported_at,
    orphan_rows.num_comentarios,
    orphan_rows.num_anexos,
    orphan_rows.pv_numero_contrato,
    orphan_rows.servicos_concluidos,
    orphan_rows.servicos_os_numero,
    orphan_rows.servicos_concluidos_em,
    orphan_rows.servicos_concluidos_por
   FROM orphan_rows
UNION ALL
 SELECT manual_rc_rows.empresa,
    manual_rc_rows.ncod_ped,
    manual_rc_rows.pc_numero,
    manual_rc_rows.pc_numero_manual,
    manual_rc_rows.pc_etapa_code,
    manual_rc_rows.pc_etapa_texto,
    manual_rc_rows.status_omie,
    manual_rc_rows.codigo_categoria_code,
    manual_rc_rows.codigo_categoria,
    manual_rc_rows.codigo_fornecedor,
    manual_rc_rows.contato_fornecedor,
    manual_rc_rows.dt_previsao,
    manual_rc_rows.codigo_projeto,
    manual_rc_rows.projeto_nome,
    manual_rc_rows.pv_origem_numero,
    manual_rc_rows.pv_origem_cod_int,
    manual_rc_rows.valor_total,
    manual_rc_rows.qtd_itens,
    manual_rc_rows.dt_inclusao,
    manual_rc_rows.etapa,
    manual_rc_rows.pv_os_tipo,
    manual_rc_rows.pv_os_numero,
    manual_rc_rows.tipo_omie,
    manual_rc_rows.pv_emissao,
    manual_rc_rows.pv_cliente_codigo,
    manual_rc_rows.pv_cliente_nome,
    manual_rc_rows.pv_cliente_fantasia,
    manual_rc_rows.pv_cliente_cidade,
    manual_rc_rows.pv_cliente_estado,
    manual_rc_rows.pv_codigo_projeto,
    manual_rc_rows.pv_codigo_vendedor,
    manual_rc_rows.pv_data_previsao,
    manual_rc_rows.pv_valor_total,
    manual_rc_rows.pv_qtd_itens,
    manual_rc_rows.pv_etapa_code,
    manual_rc_rows.pv_etapa_texto,
    manual_rc_rows.pv_dt_fat,
    manual_rc_rows.pv_num_nfe,
    manual_rc_rows.nova_prev_materiais,
    manual_rc_rows.nova_prev_servicos,
    manual_rc_rows.status,
    manual_rc_rows.status_label,
    manual_rc_rows.modulo,
    manual_rc_rows.aprovador_id,
    manual_rc_rows.aprovador_email,
    manual_rc_rows.aprovado_em,
    manual_rc_rows.valor_aprovado,
    manual_rc_rows.valor_aprovado_audit,
    manual_rc_rows.aprovar_ate,
    manual_rc_rows.prioridade,
    manual_rc_rows.justificativa,
    manual_rc_rows.comentario_aprovacao,
    manual_rc_rows.comprador,
    manual_rc_rows.status_material,
    manual_rc_rows.rc_numero,
    manual_rc_rows.rc_descricao,
    manual_rc_rows.rc_custo,
    manual_rc_rows.rc_custo_total,
    manual_rc_rows.mt_status_fornecimento,
    manual_rc_rows.mt_data_emissao_nf,
    manual_rc_rows.mt_data_recebimento_nf,
    manual_rc_rows.mt_nf_fornecedor,
    manual_rc_rows.pc_pago,
    manual_rc_rows.material_enviado,
    manual_rc_rows.custom_fields,
    manual_rc_rows.source,
    manual_rc_rows.smart_id,
    manual_rc_rows.smart_tabela,
    manual_rc_rows.pv_os_label,
    manual_rc_rows.imported_at,
    manual_rc_rows.num_comentarios,
    manual_rc_rows.num_anexos,
    manual_rc_rows.pv_numero_contrato,
    manual_rc_rows.servicos_concluidos,
    manual_rc_rows.servicos_os_numero,
    manual_rc_rows.servicos_concluidos_em,
    manual_rc_rows.servicos_concluidos_por
   FROM manual_rc_rows
UNION ALL
 SELECT manual_pc_rows.empresa,
    manual_pc_rows.ncod_ped,
    manual_pc_rows.pc_numero,
    manual_pc_rows.pc_numero_manual,
    manual_pc_rows.pc_etapa_code,
    manual_pc_rows.pc_etapa_texto,
    manual_pc_rows.status_omie,
    manual_pc_rows.codigo_categoria_code,
    manual_pc_rows.codigo_categoria,
    manual_pc_rows.codigo_fornecedor,
    manual_pc_rows.contato_fornecedor,
    manual_pc_rows.dt_previsao,
    manual_pc_rows.codigo_projeto,
    manual_pc_rows.projeto_nome,
    manual_pc_rows.pv_origem_numero,
    manual_pc_rows.pv_origem_cod_int,
    manual_pc_rows.valor_total,
    manual_pc_rows.qtd_itens,
    manual_pc_rows.dt_inclusao,
    manual_pc_rows.etapa,
    manual_pc_rows.pv_os_tipo,
    manual_pc_rows.pv_os_numero,
    manual_pc_rows.tipo_omie,
    manual_pc_rows.pv_emissao,
    manual_pc_rows.pv_cliente_codigo,
    manual_pc_rows.pv_cliente_nome,
    manual_pc_rows.pv_cliente_fantasia,
    manual_pc_rows.pv_cliente_cidade,
    manual_pc_rows.pv_cliente_estado,
    manual_pc_rows.pv_codigo_projeto,
    manual_pc_rows.pv_codigo_vendedor,
    manual_pc_rows.pv_data_previsao,
    manual_pc_rows.pv_valor_total,
    manual_pc_rows.pv_qtd_itens,
    manual_pc_rows.pv_etapa_code,
    manual_pc_rows.pv_etapa_texto,
    manual_pc_rows.pv_dt_fat,
    manual_pc_rows.pv_num_nfe,
    manual_pc_rows.nova_prev_materiais,
    manual_pc_rows.nova_prev_servicos,
    manual_pc_rows.status,
    manual_pc_rows.status_label,
    manual_pc_rows.modulo,
    manual_pc_rows.aprovador_id,
    manual_pc_rows.aprovador_email,
    manual_pc_rows.aprovado_em,
    manual_pc_rows.valor_aprovado,
    manual_pc_rows.valor_aprovado_audit,
    manual_pc_rows.aprovar_ate,
    manual_pc_rows.prioridade,
    manual_pc_rows.justificativa,
    manual_pc_rows.comentario_aprovacao,
    manual_pc_rows.comprador,
    manual_pc_rows.status_material,
    manual_pc_rows.rc_numero,
    manual_pc_rows.rc_descricao,
    manual_pc_rows.rc_custo,
    manual_pc_rows.rc_custo_total,
    manual_pc_rows.mt_status_fornecimento,
    manual_pc_rows.mt_data_emissao_nf,
    manual_pc_rows.mt_data_recebimento_nf,
    manual_pc_rows.mt_nf_fornecedor,
    manual_pc_rows.pc_pago,
    manual_pc_rows.material_enviado,
    manual_pc_rows.custom_fields,
    manual_pc_rows.source,
    manual_pc_rows.smart_id,
    manual_pc_rows.smart_tabela,
    manual_pc_rows.pv_os_label,
    manual_pc_rows.imported_at,
    manual_pc_rows.num_comentarios,
    manual_pc_rows.num_anexos,
    manual_pc_rows.pv_numero_contrato,
    manual_pc_rows.servicos_concluidos,
    manual_pc_rows.servicos_os_numero,
    manual_pc_rows.servicos_concluidos_em,
    manual_pc_rows.servicos_concluidos_por
   FROM manual_pc_rows;

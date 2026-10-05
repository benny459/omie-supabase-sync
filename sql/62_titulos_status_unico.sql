-- 62 · Status único (migração p61_titulos_status_unico) dos títulos (05/10/26, decisão do Benny)
--
-- As baixas feitas no painel (finance.baixas: Pagar v3, Receber v1, conciliação
-- OFX) NÃO vão mais para o Omie. Em vez disso, todo o painel passa a enxergar o
-- título como PAGO / RECEBIDO (ou com saldo parcial) a partir do livro de
-- baixas — BI, fluxo de caixa, fichas, telas antigas, rentabilidade.
--
-- Camadas:
--   finance.v_titulos_efetivos  = finance.pesquisa_titulos (espelho do Omie) com
--       as baixas ativas do painel sobrepostas. Mesmas colunas e tipos da
--       tabela, para servir de substituto direto. Regra igual à do Pagar v3:
--       saldo = val_aberto − Σ valor; caixa pago = Σ (valor + juros + multa −
--       desconto). Só sobrepõe enquanto o Omie mostra o título em aberto — se o
--       Omie já baixou (PAGO/RECEBIDO/LIQUIDADO/CANCELADO), vale o Omie e nada
--       é somado duas vezes.
--   finance.v_titulos_bi        = v_titulos_efetivos + títulos nativos do painel
--       (previsões de PC em finance.pagar_previsto e contas a receber nascidas
--       no painel sem lançamento no Omie), no mesmo formato. É a fonte das
--       funções bi.* (antes liam finance.pesquisa_titulos).
--   finance.v_titulos_omie      = passa a ler v_titulos_efetivos (telas antigas,
--       v_receber, ficha do fornecedor, rentabilidade).
--   finance.v_titulos_omie_bruto / v_receber_bruto = o Omie cru, para as funções
--       que já descontam as baixas por conta própria (Pagar v3, Receber v1,
--       ficha 360) — assim não descontam duas vezes.
--
-- Funções de sincronização/reconciliação com o Omie (compras.conciliar_previsoes,
-- finance.conciliar_receber_omie, public.reconciliar_titulos_pagos) continuam a
-- ler a tabela crua de propósito.

-- ── 1. Omie cru (cópias das views actuais) ───────────────────────────────────
do $$
begin
  execute 'create or replace view finance.v_titulos_omie_bruto as ' || pg_get_viewdef('finance.v_titulos_omie'::regclass);
  execute 'create or replace view finance.v_receber_bruto as '
       || regexp_replace(pg_get_viewdef('finance.v_receber'::regclass), 'finance\.v_titulos_omie\y', 'finance.v_titulos_omie_bruto', 'g');
end $$;

-- ── 2. Títulos do Omie com as baixas do painel ──────────────────────────────
create or replace view finance.v_titulos_efetivos as
with bx as (
  select empresa, natureza, cod_titulo,
         sum(valor) abatido,
         sum(valor + coalesce(juros, 0) + coalesce(multa, 0) - coalesce(desconto, 0)) caixa,
         max(data) ultima
    from finance.baixas
   where cod_titulo is not null and estornado_em is null
   group by 1, 2, 3
),
j as (
  select p.*, bx.abatido, bx.caixa, bx.ultima,
         (bx.abatido is not null and p.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO')) sobrepoe,
         greatest(coalesce(p.val_aberto, p.valor_titulo) - coalesce(bx.abatido, 0), 0) aberto_ef
    from finance.pesquisa_titulos p
    left join bx on bx.empresa = p.empresa and bx.natureza = p.natureza and bx.cod_titulo = p.cod_titulo
)
select empresa, cod_titulo, cod_int_titulo, num_titulo, dt_emissao, dt_vencimento, dt_previsao,
       case when sobrepoe then to_char(ultima, 'DD/MM/YYYY') else dt_pagamento end dt_pagamento,
       cod_cliente, cpf_cnpj_cliente, cod_contrato, num_contrato, cod_os, num_os, cod_cc,
       case when sobrepoe and aberto_ef <= 0.004 then case natureza when 'R' then 'RECEBIDO' else 'PAGO' end
            else status end status,
       natureza, tipo, operacao, num_doc_fiscal, cod_categoria, categorias_rateio, num_parcela, valor_titulo,
       valor_pis, ret_pis, valor_cofins, ret_cofins, valor_csll, ret_csll, valor_ir, ret_ir, valor_iss, ret_iss,
       valor_inss, ret_inss, observacao, cod_projeto, cod_vendedor, cod_comprador, codigo_barras, nsu, cod_nf,
       dt_registro, num_boleto, chave_nfe, origem, cod_tit_repet, dt_cancelamento,
       case when sobrepoe and aberto_ef <= 0.004 then 'S' else liquidado end liquidado,
       case when sobrepoe then coalesce(val_pago, 0) + caixa else val_pago end val_pago,
       case when sobrepoe then aberto_ef else val_aberto end val_aberto,
       desconto, juros, multa, val_liquido, info_d_inc, info_h_inc, info_u_inc, info_d_alt, info_h_alt, info_u_alt,
       synced_at, dt_emissao_d, dt_vencimento_d,
       case when sobrepoe then ultima else dt_pagamento_d end dt_pagamento_d,
       grupo_despesa,
       case when sobrepoe and aberto_ef <= 0.004 then 'Pago' else status_pago_d end status_pago_d,
       dt_previsao_d,
       case when sobrepoe then abatido else 0::numeric end baixado_painel,
       case when sobrepoe then ultima end baixa_painel_em
  from j;

-- ── 3. + títulos nativos do painel, para o BI ────────────────────────────────
create or replace view finance.v_titulos_bi as
select * from finance.v_titulos_efetivos
union all
-- previsões de PC (a pagar nascido no painel)
select x.empresa, x.cod, null, 'PC ' || x.pedido_numero, to_char(x.emissao, 'DD/MM/YYYY'), to_char(x.vencimento, 'DD/MM/YYYY'),
       to_char(x.vencimento, 'DD/MM/YYYY'), to_char(x.ultima, 'DD/MM/YYYY'),
       x.fornecedor_cod, x.fornecedor_cnpj, null::bigint, null, null::bigint, x.pedido_numero, x.conta_cod,
       case when x.aberto <= 0.004 then 'PAGO' when x.vencimento < current_date then 'ATRASADO'
            when x.vencimento = current_date then 'VENCE HOJE' else 'A VENCER' end,
       'P', 'PC', null, x.nf_numero, x.categoria_cod, null, x.parcela_n || '/' || x.parcelas_total, x.valor,
       0, 'N', 0, 'N', 0, 'N', 0, 'N', 0, 'N', 0, 'N', 'Previsão do PC ' || x.pedido_numero || ' (painel)',
       x.projeto_cod::text, null, null::bigint, null, null, null::bigint,
       null, null, x.nf_chave, 'PAINEL', null::bigint, null,
       case when x.aberto <= 0.004 then 'S' else 'N' end, x.caixa, x.aberto, x.desconto, x.juros, x.multa, x.valor,
       null, null, null, null, null, null, x.updated_at, x.emissao, x.vencimento, x.ultima, null,
       case when x.aberto <= 0.004 then 'Pago' else 'Aberto' end, x.vencimento, x.abatido, x.ultima
  from (
    select pp.*, -(1000000000000 + pp.id) cod, pp.created_at::date emissao,
           coalesce(b.abatido, 0) abatido, coalesce(b.caixa, 0) caixa, b.ultima,
           coalesce(b.desconto, 0) desconto, coalesce(b.juros, 0) juros, coalesce(b.multa, 0) multa,
           greatest(pp.valor - coalesce(b.abatido, 0), 0) aberto
      from finance.pagar_previsto pp
      left join (select pagar_id, sum(valor) abatido,
                        sum(valor + coalesce(juros, 0) + coalesce(multa, 0) - coalesce(desconto, 0)) caixa,
                        sum(coalesce(desconto, 0)) desconto, sum(coalesce(juros, 0)) juros, sum(coalesce(multa, 0)) multa,
                        max(data) ultima
                   from finance.baixas where pagar_id is not null and estornado_em is null group by 1) b on b.pagar_id = pp.id
     where pp.status = 'previsto'
  ) x
union all
-- contas a receber nascidas no painel (sem lançamento no Omie)
select x.empresa, x.cod, x.id::text, x.numero_documento, to_char(x.emissao, 'DD/MM/YYYY'), to_char(x.vencimento, 'DD/MM/YYYY'),
       to_char(coalesce(x.previsao, x.vencimento), 'DD/MM/YYYY'), to_char(x.ultima, 'DD/MM/YYYY'),
       x.codigo_cliente_omie, x.cliente_cnpj, null::bigint, null, null::bigint, x.numero_pedido, x.id_conta_corrente,
       case when x.aberto <= 0.004 then 'RECEBIDO' when x.vencimento < current_date then 'ATRASADO'
            when x.vencimento = current_date then 'VENCE HOJE' else 'A VENCER' end,
       'R', 'NF', null, x.numero_documento_fiscal, x.codigo_categoria, null, x.numero_parcela, x.valor,
       0, 'N', 0, 'N', 0, 'N', 0, 'N', 0, 'N', 0, 'N', x.observacao,
       x.codigo_projeto, null, null::bigint, null, null, null::bigint,
       null, null, x.chave_nfe, 'PAINEL', null::bigint, null,
       case when x.aberto <= 0.004 then 'S' else 'N' end, x.caixa, x.aberto, x.desconto, x.juros, x.multa, x.valor,
       null, null, null, null, null, null, x.updated_at, x.emissao, x.vencimento, x.ultima, null,
       case when x.aberto <= 0.004 then 'Pago' else 'Aberto' end, coalesce(x.previsao, x.vencimento), x.abatido, x.ultima
  from (
    select r.*, -(2000000000000 + ('x' || substr(md5(r.id::text), 1, 10))::bit(40)::bigint) cod,
           coalesce(b.abatido, 0) abatido, coalesce(b.caixa, 0) caixa, b.ultima,
           coalesce(b.desconto, 0) desconto, coalesce(b.juros, 0) juros, coalesce(b.multa, 0) multa,
           greatest(r.valor - coalesce(b.abatido, 0), 0) aberto
      from finance.receber r
      left join (select receber_id, sum(valor) abatido,
                        sum(valor + coalesce(juros, 0) + coalesce(multa, 0) - coalesce(desconto, 0)) caixa,
                        sum(coalesce(desconto, 0)) desconto, sum(coalesce(juros, 0)) juros, sum(coalesce(multa, 0)) multa,
                        max(data) ultima
                   from finance.baixas where receber_id is not null and estornado_em is null group by 1) b on b.receber_id = r.id
     where r.origem = 'painel' and r.omie_codigo_lancamento is null
  ) x;

-- ── 4. Repontar consumidores ─────────────────────────────────────────────────
do $$
declare r record; v_def text; v_novo text;
begin
  -- 4a. v_titulos_omie passa a ler os títulos efetivos (mesmas colunas)
  execute 'create or replace view finance.v_titulos_omie as '
       || regexp_replace(pg_get_viewdef('finance.v_titulos_omie'::regclass), 'finance\.pesquisa_titulos\y', 'finance.v_titulos_efetivos', 'g');

  -- 4b. views usadas pelo BI → v_titulos_bi
  for r in select unnest(array['finance.pesquisa_titulos_validos', 'finance.v_despesa_alocada', 'finance.v_titulos_com_tipo_venda']) v loop
    v_def := pg_get_viewdef(r.v::regclass);
    v_novo := regexp_replace(v_def, 'finance\.pesquisa_titulos\y', 'finance.v_titulos_bi', 'g');
    if v_novo <> v_def then execute 'create or replace view ' || r.v || ' as ' || v_novo; end if;
  end loop;

  -- 4c. funções do BI → v_titulos_bi
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'bi' and p.prokind = 'f' and pg_get_functiondef(p.oid) ~ 'finance\.pesquisa_titulos\y' loop
    execute regexp_replace(pg_get_functiondef(r.oid), 'finance\.pesquisa_titulos\y', 'finance.v_titulos_bi', 'g');
  end loop;

  -- 4d. quem já desconta as baixas sozinho lê o Omie cru
  for r in select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname, p.proname) in (('finance', 'pagar_v3_dados'), ('finance', 'pagar_v3_baixar'),
                                             ('finance', 'receber_v1_dados'), ('finance', 'receber_v1_baixar'),
                                             ('orders', 'cadastros_ficha360')) loop
    v_def := pg_get_functiondef(r.oid);
    v_novo := regexp_replace(v_def, '(finance\.)?v_titulos_omie\y', 'finance.v_titulos_omie_bruto', 'g');
    v_novo := regexp_replace(v_novo, '(finance\.)?v_receber\y', 'finance.v_receber_bruto', 'g');
    if v_novo <> v_def then execute v_novo; end if;
  end loop;
end $$;

-- ── 5. Permissões (mesmas da v_titulos_omie) ────────────────────────────────
do $$
declare g record;
begin
  for g in select distinct grantee, privilege_type from information_schema.role_table_grants
            where table_schema = 'finance' and table_name = 'v_titulos_omie' and grantee not in ('postgres') loop
    execute format('grant %s on finance.v_titulos_efetivos, finance.v_titulos_bi, finance.v_titulos_omie_bruto, finance.v_receber_bruto to %I',
                   g.privilege_type, g.grantee);
  end loop;
  revoke all on finance.v_titulos_efetivos, finance.v_titulos_bi, finance.v_titulos_omie_bruto, finance.v_receber_bruto from anon;
end $$;

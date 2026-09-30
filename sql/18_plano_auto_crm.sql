-- 18 — Importação automática do plano de fechamento a partir do CRM.
--
-- O CRM publica o CP/MC de cada proposta ganha num caminho fixo do Storage
-- (propostas-pdfs/{empresa}/{numero}/cpmc.xlsx) a cada "Salvar fechamento".
-- O painel passa a importar esse arquivo sozinho. Esta tabela guarda QUAL
-- versão (ETag do Storage) já foi vista por projeto, para:
--   • não reimportar o mesmo arquivo a cada verificação;
--   • não atropelar um plano subido à mão — a primeira vez que o painel vê um
--     projeto que JÁ tem plano, só anota a versão (baseline); reimporta quando
--     o CRM publicar uma versão nova depois disso.
create table if not exists approval.plano_auto_crm (
  empresa         text        not null,
  codigo_projeto  bigint      not null,
  proposta        text        not null,
  etag            text,
  last_modified   timestamptz,
  visto_em        timestamptz not null default now(),
  importado_em    timestamptz,
  resultado       text,       -- 'importado' | 'baseline' | 'erro: ...'
  primary key (empresa, codigo_projeto)
);

alter table approval.plano_auto_crm enable row level security;
-- Só o service role escreve/lê (rotas de servidor). Sem policy = ninguém mais.
grant all on approval.plano_auto_crm to service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- approval.plano_importar — corrigida em 30/09/2026 (não estava versionada).
--
-- O bloco das etapas do cronograma usava a coluna "nome", que nunca existiu em
-- approval.projeto_etapas (a coluna é "etapa"), e não preenchia criado_por /
-- atualizado_por (NOT NULL). Resultado: TODA importação de plano falhava —
-- pelo botão ou automática — com "column t.nome does not exist".
-- Além disso, o sync apagava qualquer etapa fora das parcelas; agora só apaga
-- as que a própria importação criou (criado_por = 'plano_importar').
CREATE OR REPLACE FUNCTION approval.plano_importar(p_empresa text, p_codigo bigint, p_cab jsonb, p_parcelas jsonb, p_saidas jsonb, p_quem text, p_custos jsonb DEFAULT '[]'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_guardado jsonb;
  v_preservadas int := 0;
  v_agora timestamptz := now();
  v_custo numeric;
  v_etapas int := 0;
begin
  select coalesce(jsonb_object_agg(parcela::text, jsonb_build_object(
           'dt_ajustada', dt_ajustada, 'num_titulo', num_titulo, 'observacao', observacao)), '{}'::jsonb)
    into v_guardado
    from approval.projeto_plano_parcela
   where empresa = p_empresa and codigo_projeto = p_codigo;

  insert into approval.projeto_plano (
    empresa, codigo_projeto, proposta, cliente, data_base,
    valor_venda, valor_fechado, confirmado_por, confirmado_em, eixo_pagamento,
    prazo_entrega_dias, entrega_prevista,
    frete, deslocamento, instalacao, impostos, garantia,
    forma_pagamento, faturamento, observacoes,
    prop_pagamento, prop_faturamento, prop_prazo, prop_frete,
    prop_garantia, prop_instalacao, prop_observacoes,
    custo_materiais, custo_mao_obra, custo_despesas, margem_pct, margem_valor,
    importado_de, importado_em, importado_por, atualizado_em, atualizado_por)
  select p_empresa, p_codigo,
         p_cab->>'proposta', p_cab->>'cliente', (p_cab->>'data_base')::date,
         (p_cab->>'valor_venda')::numeric, (p_cab->>'valor_fechado')::numeric,
         p_cab->>'confirmado_por', p_cab->>'confirmado_em',
         (p_cab->>'eixo_pagamento')::date,
         (p_cab->>'prazo_entrega_dias')::int, (p_cab->>'entrega_prevista')::date,
         p_cab->>'frete', p_cab->>'deslocamento', p_cab->>'instalacao',
         p_cab->>'impostos', p_cab->>'garantia',
         p_cab->>'forma_pagamento', p_cab->>'faturamento', p_cab->>'observacoes',
         p_cab->>'prop_pagamento', p_cab->>'prop_faturamento', p_cab->>'prop_prazo',
         p_cab->>'prop_frete', p_cab->>'prop_garantia', p_cab->>'prop_instalacao',
         p_cab->>'prop_observacoes',
         (p_cab->>'custo_materiais')::numeric, (p_cab->>'custo_mao_obra')::numeric,
         (p_cab->>'custo_despesas')::numeric,
         (p_cab->>'margem_pct')::numeric, (p_cab->>'margem_valor')::numeric,
         p_cab->>'importado_de', v_agora, p_quem, v_agora, p_quem
  on conflict (empresa, codigo_projeto) do update set
    proposta = excluded.proposta, cliente = excluded.cliente,
    data_base = excluded.data_base, valor_venda = excluded.valor_venda,
    valor_fechado = excluded.valor_fechado,
    confirmado_por = excluded.confirmado_por, confirmado_em = excluded.confirmado_em,
    eixo_pagamento = excluded.eixo_pagamento,
    prazo_entrega_dias = excluded.prazo_entrega_dias,
    entrega_prevista = excluded.entrega_prevista,
    frete = excluded.frete, deslocamento = excluded.deslocamento,
    instalacao = excluded.instalacao, impostos = excluded.impostos,
    garantia = excluded.garantia, forma_pagamento = excluded.forma_pagamento,
    faturamento = excluded.faturamento, observacoes = excluded.observacoes,
    prop_pagamento = excluded.prop_pagamento, prop_faturamento = excluded.prop_faturamento,
    prop_prazo = excluded.prop_prazo, prop_frete = excluded.prop_frete,
    prop_garantia = excluded.prop_garantia, prop_instalacao = excluded.prop_instalacao,
    prop_observacoes = excluded.prop_observacoes,
    custo_materiais = excluded.custo_materiais, custo_mao_obra = excluded.custo_mao_obra,
    custo_despesas = excluded.custo_despesas,
    margem_pct = excluded.margem_pct, margem_valor = excluded.margem_valor,
    importado_de = excluded.importado_de, importado_em = excluded.importado_em,
    importado_por = excluded.importado_por,
    atualizado_em = excluded.atualizado_em, atualizado_por = excluded.atualizado_por;

  delete from approval.projeto_plano_parcela
   where empresa = p_empresa and codigo_projeto = p_codigo;
  delete from approval.projeto_plano_saida
   where empresa = p_empresa and codigo_projeto = p_codigo;
  delete from approval.projeto_plano_custo
   where empresa = p_empresa and codigo_projeto = p_codigo;

  insert into approval.projeto_plano_parcela (
    empresa, codigo_projeto, parcela, evento, pct, dias, dt_plano,
    dt_ajustada, num_titulo, observacao, valor, atualizado_em, atualizado_por)
  select p_empresa, p_codigo,
         (e->>'parcela')::int, e->>'evento',
         (e->>'pct')::numeric, (e->>'dias')::int, (e->>'dt_plano')::date,
         (v_guardado->(e->>'parcela')->>'dt_ajustada')::date,
          v_guardado->(e->>'parcela')->>'num_titulo',
          v_guardado->(e->>'parcela')->>'observacao',
         coalesce((e->>'valor')::numeric, 0), v_agora, p_quem
    from jsonb_array_elements(coalesce(p_parcelas, '[]'::jsonb)) e;

  insert into approval.projeto_plano_saida (
    empresa, codigo_projeto, origem, descricao, fornecedor, etapa,
    dias_apos_base, dt_prevista, valor, no_fluxo, atualizado_em, atualizado_por)
  select p_empresa, p_codigo,
         case when e->>'origem' = 'sem_pc' then 'sem_pc' else 'material' end,
         e->>'descricao', e->>'fornecedor', e->>'etapa',
         (e->>'dias_apos_base')::int, (e->>'dt_prevista')::date,
         coalesce((e->>'valor')::numeric, 0),
         coalesce((e->>'no_fluxo')::boolean, true), v_agora, p_quem
    from jsonb_array_elements(coalesce(p_saidas, '[]'::jsonb)) e;

  insert into approval.projeto_plano_custo (
    empresa, codigo_projeto, grupo, descricao, qtd_pessoas,
    valor_unit, quantidade, subtotal, observacao, ordem)
  select p_empresa, p_codigo,
         case when e->>'grupo' = 'efetivo' then 'efetivo' else 'despesa' end,
         e->>'descricao', (e->>'qtd_pessoas')::numeric,
         (e->>'valor_unit')::numeric, (e->>'quantidade')::numeric,
         coalesce((e->>'subtotal')::numeric, 0), e->>'observacao',
         coalesce((e->>'ordem')::int, 0)
    from jsonb_array_elements(coalesce(p_custos, '[]'::jsonb)) e;

  -- ── 1. Etapas do cronograma, a partir das parcelas ──────────────────────
  -- Sync por NOME. Etapa que sumiu da proposta é removida (só as que esta
  -- função criou); a que continua ganha a data nova mas MANTÉM a conclusão.
  with alvo as (
    select (e->>'evento')::text as nome,
           (e->>'dt_plano')::date as dt,
           ((e->>'parcela')::int) as ordem
      from jsonb_array_elements(coalesce(p_parcelas, '[]'::jsonb)) e
     where nullif(e->>'evento', '') is not null
  ),
  upd as (
    update approval.projeto_etapas t
       set data_prevista = a.dt, ordem = a.ordem,
           atualizado_por = p_quem, atualizado_em = v_agora
      from alvo a
     where t.empresa = p_empresa and t.codigo_projeto = p_codigo
       and lower(btrim(t.etapa)) = lower(btrim(a.nome))
    returning t.id
  ),
  del as (
    delete from approval.projeto_etapas t
     where t.empresa = p_empresa and t.codigo_projeto = p_codigo
       and t.criado_por = 'plano_importar'
       and not exists (select 1 from alvo a
                        where lower(btrim(a.nome)) = lower(btrim(t.etapa)))
    returning t.id
  ),
  ins as (
    insert into approval.projeto_etapas (empresa, codigo_projeto, etapa, data_prevista, ordem, criado_por, atualizado_por)
    select p_empresa, p_codigo, a.nome, a.dt, a.ordem, 'plano_importar', p_quem
      from alvo a
     where not exists (
       select 1 from approval.projeto_etapas t
        where t.empresa = p_empresa and t.codigo_projeto = p_codigo
          and lower(btrim(t.etapa)) = lower(btrim(a.nome)))
    returning id
  )
  select (select count(*) from upd) + (select count(*) from ins) into v_etapas;

  -- ── 2. Budget, só se ainda não houver ───────────────────────────────────
  v_custo := coalesce((p_cab->>'custo_materiais')::numeric, 0)
           + coalesce((p_cab->>'custo_mao_obra')::numeric, 0)
           + coalesce((p_cab->>'custo_despesas')::numeric, 0);
  if v_custo > 0 then
    insert into approval.rc_projetos_budget (
      empresa, codigo_projeto, valor_budget, valor_total_projeto,
      atualizado_em, atualizado_por)
    values (p_empresa, p_codigo, v_custo,
            coalesce((p_cab->>'valor_fechado')::numeric, (p_cab->>'valor_venda')::numeric),
            v_agora, p_quem)
    on conflict (empresa, codigo_projeto) do update set
      -- Preserva o teto que alguém definiu; só completa o que falta.
      valor_budget = coalesce(approval.rc_projetos_budget.valor_budget, excluded.valor_budget),
      valor_total_projeto = coalesce(excluded.valor_total_projeto,
                                     approval.rc_projetos_budget.valor_total_projeto),
      atualizado_em = excluded.atualizado_em,
      atualizado_por = excluded.atualizado_por;
  end if;

  select count(*) into v_preservadas
    from jsonb_array_elements(coalesce(p_parcelas, '[]'::jsonb)) e
   where v_guardado->(e->>'parcela')->>'dt_ajustada' is not null;

  return jsonb_build_object(
    'ok', true,
    'parcelas', jsonb_array_length(coalesce(p_parcelas, '[]'::jsonb)),
    'saidas',   jsonb_array_length(coalesce(p_saidas, '[]'::jsonb)),
    'custos',   jsonb_array_length(coalesce(p_custos, '[]'::jsonb)),
    'etapas',   v_etapas,
    'ajustes_preservados', v_preservadas);
end $function$;

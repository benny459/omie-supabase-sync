-- 67 · Conta a pagar manual NATIVA (05/10/26, saída do Omie — P-FIN pequeno)
--
-- Até aqui o "+ Nova conta" a pagar criava o título NO OMIE (IncluirContaPagar)
-- e o excluir apagava lá (ExcluirContaPagar). Agora a conta nasce no painel,
-- em finance.pagar_previsto (a mesma tabela das previsões de PC), com
-- origem_titulo = 'manual' e pedido_id NULL. Assim herda, sem código novo:
--   · baixa / estorno / conciliação (finance.baixa_registrar, pagar_id);
--   · Contas a Pagar v3 (finance.pagar_v3_dados lê v_pagar_previsto);
--   · BI e fluxo de caixa (v_titulos_bi, bi.fluxo_caixa_titulos);
--   · tela antiga de títulos (/api/financeiro/titulos lê v_pagar_previsto).
-- compras.gerar_previsoes / conciliar_previsoes só tocam linhas com pedido_id,
-- por isso nunca mexem nas manuais.

alter table finance.pagar_previsto alter column pedido_id drop not null;
alter table finance.pagar_previsto alter column pedido_numero drop not null;
alter table finance.pagar_previsto
  add column if not exists origem_titulo text not null default 'pc',
  add column if not exists documento text,
  add column if not exists obs text,
  add column if not exists data_emissao date,
  add column if not exists data_previsao date,
  add column if not exists extras jsonb,
  add column if not exists criado_por text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'pagar_previsto_origem_titulo_chk') then
    alter table finance.pagar_previsto add constraint pagar_previsto_origem_titulo_chk check (
      (origem_titulo = 'pc' and pedido_id is not null) or (origem_titulo = 'manual' and pedido_id is null));
  end if;
end $$;

-- ── v_pagar_previsto: rótulos da conta manual ────────────────────────────────
create or replace view finance.v_pagar_previsto as
 SELECT (- id) AS codigo_lancamento_omie,
    empresa,
    fornecedor_nome AS contraparte,
    fornecedor_nome AS contraparte_razao,
    fornecedor_cnpj AS cnpj_cpf,
    fornecedor_cod AS codigo_cliente_fornecedor,
    vencimento,
    coalesce(data_previsao, vencimento) AS previsao,
    data_emissao AS emissao,
    valor AS valor_documento,
    valor_pago,
    GREATEST((valor - valor_pago), (0)::numeric) AS val_aberto,
        CASE
            WHEN ((valor > (0)::numeric) AND (valor_pago >= valor)) THEN 'PAGO'::text
            WHEN (fase = 'previsto'::text) THEN 'PREVISTO'::text
            WHEN (fase = 'aguardando_recebimento'::text) THEN 'AGUARD_RECEB'::text
            WHEN (fase = 'aguardando_conferencia'::text) THEN 'AGUARD_CONF'::text
            ELSE 'LIBERADO'::text
        END AS status_titulo,
    CASE WHEN origem_titulo = 'manual' THEN coalesce(nullif(documento, ''), 'Conta a pagar')
         ELSE ('PC '::text || pedido_numero) END AS numero_documento,
    ((parcela_n || '/'::text) || parcelas_total) AS numero_parcela,
    nf_numero AS numero_documento_fiscal,
    pedido_numero AS numero_pedido,
    categoria_desc AS categoria,
    categoria_cod AS codigo_categoria,
    projeto_nome AS projeto,
    projeto_cod AS codigo_projeto,
    conta_desc AS conta_corrente,
    conta_cod AS cod_cc,
    CASE WHEN origem_titulo = 'manual' THEN
      coalesce(nullif(obs, ''), 'Conta a pagar (painel)') ||
        CASE
            WHEN ((valor_pago > (0)::numeric) AND (valor_pago < valor)) THEN (' · pago '::text || to_char(valor_pago, 'FM999G999G990D00'::text))
            WHEN ((valor > (0)::numeric) AND (valor_pago >= valor)) THEN (' · pago em '::text || to_char((pago_em)::timestamp with time zone, 'DD/MM/YYYY'::text))
            ELSE ''::text
        END
    ELSE
    (((((
        CASE fase
            WHEN 'previsto'::text THEN 'Previsto'::text
            WHEN 'aguardando_recebimento'::text THEN (('NF '::text || COALESCE(nf_numero, ''::text)) || ' — aguardando recebimento'::text)
            WHEN 'aguardando_conferencia'::text THEN 'Aguardando conferência'::text
            ELSE 'Liberado para pagar'::text
        END || ' (PC '::text) || pedido_numero) || ')'::text) ||
        CASE
            WHEN parcial THEN ' · parcial'::text
            ELSE ''::text
        END) ||
        CASE
            WHEN ((valor_pago > (0)::numeric) AND (valor_pago < valor)) THEN (' · pago '::text || to_char(valor_pago, 'FM999G999G990D00'::text))
            WHEN ((valor > (0)::numeric) AND (valor_pago >= valor)) THEN (' · pago em '::text || to_char((pago_em)::timestamp with time zone, 'DD/MM/YYYY'::text))
            ELSE ''::text
        END) END AS observacao,
    CASE WHEN origem_titulo = 'manual' THEN 'MANUAL'::text ELSE 'PC'::text END AS origem,
    tipo_doc AS tipo_documento,
    (NOT ((valor > (0)::numeric) AND (valor_pago >= valor))) AS em_aberto,
    (vencimento - CURRENT_DATE) AS dias_para_vencer,
    pedido_id,
    status,
    fase,
    parcial,
    valor_liberado,
    nf_chave AS chave_nfe,
    id AS pagar_id,
    pago_em,
    ((valor > (0)::numeric) AND (valor_pago >= valor)) AS quitado
   FROM finance.pagar_previsto pp
  WHERE (status = 'previsto'::text);

-- ── v_titulos_nativos: documento da conta manual ─────────────────────────────
create or replace view finance.v_titulos_nativos as
 SELECT 'P'::character(1) AS natureza,
    (pp.id)::text AS titulo,
    pp.empresa,
    pp.fornecedor_nome AS contraparte,
    regexp_replace(COALESCE(pp.fornecedor_cnpj, ''::text), '\D'::text, ''::text, 'g'::text) AS cnpj,
    CASE WHEN pp.origem_titulo = 'manual'
         THEN coalesce(nullif(pp.documento, ''), 'Conta a pagar') || ' · ' || pp.parcela_n || '/' || pp.parcelas_total
         ELSE ((((('PC '::text || pp.pedido_numero) || ' · '::text) || pp.parcela_n) || '/'::text) || pp.parcelas_total) END AS documento,
    pp.nf_numero,
    pp.pedido_numero,
    pp.vencimento,
    pp.valor,
    pp.valor_pago,
    GREATEST((pp.valor - pp.valor_pago), (0)::numeric) AS saldo,
    pp.fase,
    pp.conta_cod AS cod_cc
   FROM finance.pagar_previsto pp
  WHERE (pp.status = 'previsto'::text)
UNION ALL
 SELECT 'R'::character(1) AS natureza,
    (r.id)::text AS titulo,
    r.empresa,
    COALESCE(r.cliente_razao, cli.razao_social, cli.nome_fantasia) AS contraparte,
    regexp_replace(COALESCE(r.cliente_cnpj, cli.cnpj_cpf, ''::text), '\D'::text, ''::text, 'g'::text) AS cnpj,
    (COALESCE(NULLIF(r.numero_documento, ''::text), 'Conta a receber'::text) || COALESCE((' · '::text || NULLIF(r.numero_parcela, ''::text)), ''::text)) AS documento,
    r.numero_documento_fiscal AS nf_numero,
    r.numero_pedido AS pedido_numero,
    r.vencimento,
    r.valor,
    r.valor_pago,
    GREATEST((r.valor - r.valor_pago), (0)::numeric) AS saldo,
    NULL::text AS fase,
    r.id_conta_corrente AS cod_cc
   FROM ((finance.receber r
     LEFT JOIN finance.clientes cli ON (((cli.empresa = r.empresa) AND (cli.codigo_cliente_omie = r.codigo_cliente_omie))))
     LEFT JOIN finance.v_titulos_omie o ON (((r.omie_codigo_lancamento IS NOT NULL) AND (o.natureza = 'R'::text) AND (o.empresa = r.empresa) AND (o.cod_titulo = r.omie_codigo_lancamento))))
  WHERE ((r.origem = 'painel'::text) AND (COALESCE(o.status, ''::text) <> ALL (ARRAY['RECEBIDO'::text, 'CANCELADO'::text, 'EXCLUIDO'::text])));

-- ── v_titulos_bi: rótulos da conta manual no ramo das previsões ──────────────
do $$
declare d text := pg_get_viewdef('finance.v_titulos_bi'::regclass); n text;
begin
  n := replace(d, $a$('PC '::text || x.pedido_numero) AS num_titulo$a$,
    $a$CASE WHEN x.origem_titulo = 'manual' THEN COALESCE(NULLIF(x.documento, ''), 'Conta a pagar') ELSE ('PC '::text || x.pedido_numero) END AS num_titulo$a$);
  n := replace(n, $a$'PC'::text AS tipo,$a$,
    $a$CASE WHEN x.origem_titulo = 'manual' THEN 'MANUAL'::text ELSE 'PC'::text END AS tipo,$a$);
  n := replace(n, $a$(('Previsão do PC '::text || x.pedido_numero) || ' (painel)'::text) AS observacao$a$,
    $a$CASE WHEN x.origem_titulo = 'manual' THEN COALESCE(NULLIF(x.obs, ''), 'Conta a pagar (painel)') ELSE (('Previsão do PC '::text || x.pedido_numero) || ' (painel)'::text) END AS observacao$a$);
  n := replace(n, $a$(pp.created_at)::date AS emissao$a$, $a$COALESCE(pp.data_emissao, (pp.created_at)::date) AS emissao$a$);
  -- o pp.* da subconsulta foi expandido na criação: as colunas novas entram à mão
  n := replace(n, $a$(- ('1000000000000'::bigint + pp.id)) AS cod,$a$,
    $a$pp.origem_titulo, pp.documento, pp.obs, pp.data_emissao, (- ('1000000000000'::bigint + pp.id)) AS cod,$a$);
  if n = d or position('x.origem_titulo' in n) = 0 then raise exception 'v_titulos_bi: substituições não aplicadas'; end if;
  execute 'create or replace view finance.v_titulos_bi as ' || n;
end $$;

-- ── Incluir / excluir conta a pagar manual ───────────────────────────────────
-- p: {empresa, fornecedor_cod, valor, vencimento, previsao?, categoria_cod, conta_cod,
--     projeto_cod?, documento?, obs?, emissao?, nf_numero?, chave_nfe?, numero_parcela?,
--     tipo_doc?, extras?}
create or replace function finance.pagar_manual_incluir(p jsonb, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare v_emp text := upper(coalesce(p->>'empresa', 'SF')); v_forn bigint := nullif(p->>'fornecedor_cod', '')::bigint;
        v_valor numeric := round((p->>'valor')::numeric, 2); v_venc date := (p->>'vencimento')::date;
        v_cat text := nullif(p->>'categoria_cod', ''); v_cc bigint := nullif(p->>'conta_cod', '')::bigint;
        v_proj bigint := nullif(p->>'projeto_cod', '')::bigint;
        pe record; v_id bigint; v_parc text := nullif(trim(coalesce(p->>'numero_parcela', '')), '');
        v_n int := 1; v_t int := 1;
begin
  if v_forn is null or v_valor is null or v_valor <= 0 or v_venc is null or v_cat is null or v_cc is null then
    raise exception 'Campos obrigatórios: fornecedor, valor, vencimento, categoria e conta corrente';
  end if;
  select coalesce(nullif(razao_social, ''), nome_fantasia) nome, cnpj_cpf into pe
    from cadastros.pessoas where empresa = v_emp and codigo = v_forn and mesclado_em is null
   order by ativo desc limit 1;
  if not found then
    select coalesce(nullif(razao_social, ''), nome_fantasia) nome, cnpj_cpf into pe
      from finance.clientes where empresa = v_emp and codigo_cliente_omie = v_forn limit 1;
  end if;
  if v_parc ~ '^\d+\s*/\s*\d+$' then
    v_n := split_part(replace(v_parc, ' ', ''), '/', 1)::int; v_t := split_part(replace(v_parc, ' ', ''), '/', 2)::int;
  end if;

  insert into finance.pagar_previsto (empresa, pedido_id, pedido_numero, parcela_n, parcelas_total, vencimento, valor,
      tipo_doc, fornecedor_cod, fornecedor_nome, fornecedor_cnpj, categoria_cod, categoria_desc, projeto_cod, projeto_nome,
      conta_cod, conta_desc, status, fase, origem_parcelas, nf_numero, nf_chave,
      origem_titulo, documento, obs, data_emissao, data_previsao, extras, criado_por)
  values (v_emp, null, null, greatest(v_n, 1), greatest(v_t, v_n, 1), v_venc, v_valor,
      nullif(p->>'tipo_doc', ''), v_forn, pe.nome, pe.cnpj_cpf, v_cat,
      (select descricao from finance.categorias where empresa = v_emp and codigo = v_cat limit 1),
      v_proj, (select nome from finance.projetos where empresa = v_emp and codigo = v_proj limit 1),
      v_cc, (select descricao from finance.contas_correntes where empresa = v_emp and cod_cc = v_cc limit 1),
      'previsto', 'liberado', 'manual', nullif(p->>'nf_numero', ''), nullif(p->>'chave_nfe', ''),
      'manual', nullif(trim(coalesce(p->>'documento', '')), ''), nullif(trim(coalesce(p->>'obs', '')), ''),
      nullif(p->>'emissao', '')::date, nullif(p->>'previsao', '')::date,
      nullif(p->'extras', 'null'::jsonb), p_usuario)
  returning id into v_id;

  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'incluir_conta_manual', 'pagar', v_id::text, p);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;

create or replace function finance.pagar_manual_excluir(p_id bigint, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare r finance.pagar_previsto;
begin
  select * into r from finance.pagar_previsto where id = p_id for update;
  if not found then raise exception 'Conta não encontrada'; end if;
  if r.origem_titulo <> 'manual' then
    raise exception 'Só contas lançadas à mão no painel se excluem daqui (previsões de PC seguem o pedido)';
  end if;
  if exists (select 1 from finance.baixas where pagar_id = p_id and estornado_em is null) then
    raise exception 'Esta conta tem pagamento registado — estorne a baixa antes de excluir';
  end if;
  update finance.pagar_previsto set status = 'cancelado', updated_at = now() where id = p_id;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'excluir_conta_manual', 'pagar', p_id::text, to_jsonb(r));
  return jsonb_build_object('ok', true);
end $$;

revoke all on function finance.pagar_manual_incluir(jsonb, text) from public, anon, authenticated;
revoke all on function finance.pagar_manual_excluir(bigint, text) from public, anon, authenticated;
grant execute on function finance.pagar_manual_incluir(jsonb, text) to service_role;
grant execute on function finance.pagar_manual_excluir(bigint, text) to service_role;

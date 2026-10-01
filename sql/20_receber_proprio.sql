-- 20 — Contas a receber nascem no NOSSO sistema (01/10/2026).
--
-- Até aqui a tela de receber lia o espelho do Omie (finance.pesquisa_titulos).
-- Decisão do Benny (30/09–01/10/26): o painel passa a ser a fonte da verdade
-- das contas a receber. Na transição o Omie continua faturando e criando as
-- contas dele; elas entram aqui, são conferidas contra as nossas e NUNCA
-- duplicam. Quando a conferência estiver limpa por semanas, corta-se o Omie.
--
--   finance.receber                 — a tabela (fonte da verdade)
--   finance.conciliar_receber_omie() — traz/confere o Omie (pg_cron 30 min)
--   finance.v_receber               — o que a tela /financeiro/receber lê
--
-- Regras da conciliação (idempotente — rodar duas vezes não muda nada):
--   1. Título do Omie já ligado a uma linha nossa → recompara.
--      · origem 'omie'  : a linha espelha o Omie (valor, datas, docs).
--      · origem 'painel': a nossa manda; diferenças viram `divergencias`.
--   2. Linha nossa 'pendente' (tem pedido/NF/chave e ainda sem par) → procura
--      o título do Omie da mesma empresa + parcela + (pedido | NF | chave).
--      Achou → liga (e apaga a cópia 'omie' desse título, se já existia).
--   3. Título do Omie sem par → entra como origem 'omie', conferencia 'so_omie'.
-- Baixa (pago/em aberto) continua a vir do Omie até a integração do C6.
--
-- Conferência:
--   ok         — painel e Omie batem (valor ±0,01 e vencimento)
--   divergente — ligados, mas valor/vencimento/cliente diferem (ver divergencias)
--   pendente   — nossa, à espera do título do Omie (tem pedido/NF para casar)
--   so_painel  — nossa, sem documento para casar (conta manual) — não vai ao Omie
--   so_omie    — existe só no Omie (criada lá, fora do painel)

create table if not exists finance.receber (
  id                     uuid primary key default gen_random_uuid(),
  empresa                text not null,
  codigo_cliente_omie    bigint,
  cliente_cnpj           text,
  cliente_razao          text,
  numero_documento       text,
  numero_parcela         text,
  numero_pedido          text,
  numero_documento_fiscal text,
  chave_nfe              text,
  emissao                date,
  vencimento             date,
  previsao               date,
  valor                  numeric(14,2) not null,
  codigo_categoria       text,
  codigo_projeto         text,
  id_conta_corrente      bigint,
  observacao             text,
  -- campos do formulário sem coluna própria (tipo doc, origem, impostos retidos, entrada)
  extras                 jsonb,
  origem                 text not null check (origem in ('painel','omie')),
  omie_codigo_lancamento bigint,
  conferencia            text not null default 'pendente'
                         check (conferencia in ('ok','divergente','pendente','so_painel','so_omie')),
  divergencias           jsonb,
  conferido_em           timestamptz,
  created_at             timestamptz not null default now(),
  created_by             text,
  updated_at             timestamptz not null default now(),
  -- um título do Omie liga a no máximo UMA linha nossa
  unique (empresa, omie_codigo_lancamento)
);

create index if not exists receber_vencimento on finance.receber (vencimento);
create index if not exists receber_conferencia on finance.receber (conferencia);
create index if not exists receber_pendentes on finance.receber (empresa) where omie_codigo_lancamento is null;

create or replace function finance.receber_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists receber_touch on finance.receber;
create trigger receber_touch before update on finance.receber
  for each row execute function finance.receber_touch();

-- Dado financeiro consolidado: só o service role (rotas da API) lê e escreve.
alter table finance.receber enable row level security;
revoke all on finance.receber from anon, authenticated;
grant all on finance.receber to service_role;

-- Parcela comparável: '001/003' e '1/3' viram '1'. Comparamos só o número da
-- parcela — o total ('/3') às vezes falta de um dos lados.
create or replace function finance.parcela_n(p text) returns text
language sql immutable as $$
  select nullif(ltrim(split_part(regexp_replace(coalesce(p, ''), '\s', '', 'g'), '/', 1), '0'), '')
$$;

create or replace function finance._receber_diverg(
  r_valor numeric, r_venc date, r_cli bigint,
  o_valor numeric, o_venc date, o_cli bigint
) returns jsonb language sql immutable as $$
  select nullif(jsonb_strip_nulls(jsonb_build_object(
    'valor',      case when abs(coalesce(r_valor, 0) - coalesce(o_valor, 0)) > 0.01
                       then jsonb_build_object('painel', r_valor, 'omie', o_valor) end,
    'vencimento', case when r_venc is distinct from o_venc
                       then jsonb_build_object('painel', r_venc, 'omie', o_venc) end,
    'cliente',    case when r_cli is not null and o_cli is not null and r_cli <> o_cli
                       then jsonb_build_object('painel', r_cli, 'omie', o_cli) end
  )), '{}'::jsonb)
$$;

create or replace function finance.conciliar_receber_omie() returns jsonb
language plpgsql security definer set search_path = finance, public as $$
declare
  n_espelho int := 0; n_comparados int := 0; n_ligados int := 0; n_novos int := 0;
  r record; o record;
begin
  -- 1a. Linhas 'omie' espelham o Omie (só escreve quando algo mudou).
  update finance.receber x set
    codigo_cliente_omie = p.cod_cliente,
    cliente_cnpj = nullif(p.cpf_cnpj_cliente, ''),
    numero_documento = p.num_titulo, numero_parcela = p.num_parcela,
    numero_pedido = p.num_os, numero_documento_fiscal = p.num_doc_fiscal, chave_nfe = p.chave_nfe,
    emissao = p.dt_emissao_d, vencimento = p.dt_vencimento_d, previsao = p.dt_previsao_d,
    valor = coalesce(p.valor_titulo, 0), codigo_categoria = p.cod_categoria,
    codigo_projeto = p.cod_projeto, id_conta_corrente = p.cod_cc, observacao = p.observacao,
    conferido_em = now()
  from finance.pesquisa_titulos p
  where x.origem = 'omie' and p.natureza = 'R'
    and p.empresa = x.empresa and p.cod_titulo = x.omie_codigo_lancamento
    and (x.valor, x.vencimento, x.previsao, x.emissao, x.numero_documento, x.numero_parcela,
         x.numero_pedido, x.numero_documento_fiscal, x.chave_nfe, x.codigo_cliente_omie,
         x.codigo_categoria, x.codigo_projeto, x.id_conta_corrente, x.observacao, x.cliente_cnpj)
        is distinct from
        (coalesce(p.valor_titulo, 0)::numeric(14,2), p.dt_vencimento_d, p.dt_previsao_d, p.dt_emissao_d,
         p.num_titulo, p.num_parcela, p.num_os, p.num_doc_fiscal, p.chave_nfe, p.cod_cliente,
         p.cod_categoria, p.cod_projeto, p.cod_cc, p.observacao, nullif(p.cpf_cnpj_cliente, ''));
  get diagnostics n_espelho = row_count;

  -- 1b. Linhas 'painel' já ligadas: recompara.
  update finance.receber x set
    divergencias = d.dv,
    conferencia = case when d.dv is null then 'ok' else 'divergente' end,
    conferido_em = now()
  from (
    select x2.id, finance._receber_diverg(x2.valor, x2.vencimento, x2.codigo_cliente_omie,
                                          p.valor_titulo, p.dt_vencimento_d, p.cod_cliente) dv
    from finance.receber x2
    join finance.pesquisa_titulos p
      on p.natureza = 'R' and p.empresa = x2.empresa and p.cod_titulo = x2.omie_codigo_lancamento
    where x2.origem = 'painel'
  ) d
  where x.id = d.id
    and (x.divergencias is distinct from d.dv
         or x.conferencia is distinct from (case when d.dv is null then 'ok' else 'divergente' end));
  get diagnostics n_comparados = row_count;

  -- 2. Linhas 'painel' pendentes: procura o par no Omie.
  for r in
    select * from finance.receber
    where origem = 'painel' and omie_codigo_lancamento is null and conferencia = 'pendente'
    order by created_at
  loop
    select p.* into o
    from finance.pesquisa_titulos p
    where p.natureza = 'R' and p.empresa = r.empresa
      and coalesce(finance.parcela_n(p.num_parcela), '1') = coalesce(finance.parcela_n(r.numero_parcela), '1')
      and ( (nullif(r.numero_pedido, '') is not null and p.num_os = r.numero_pedido)
         or (nullif(r.numero_documento_fiscal, '') is not null
             and ltrim(p.num_doc_fiscal, '0') = ltrim(r.numero_documento_fiscal, '0'))
         or (nullif(r.chave_nfe, '') is not null and p.chave_nfe = r.chave_nfe) )
      -- livre: não ligado a outra linha nossa de origem painel
      and not exists (select 1 from finance.receber y
                      where y.origem = 'painel' and y.empresa = p.empresa
                        and y.omie_codigo_lancamento = p.cod_titulo)
    order by abs(coalesce(p.valor_titulo, 0) - r.valor),
             abs(coalesce(p.dt_vencimento_d, r.vencimento) - r.vencimento),
             p.cod_titulo
    limit 1;
    continue when not found;

    -- a cópia 'omie' desse título (se o sync chegou antes) dá lugar à nossa
    delete from finance.receber
     where origem = 'omie' and empresa = r.empresa and omie_codigo_lancamento = o.cod_titulo;

    update finance.receber set
      omie_codigo_lancamento = o.cod_titulo,
      divergencias = finance._receber_diverg(r.valor, r.vencimento, r.codigo_cliente_omie,
                                             o.valor_titulo, o.dt_vencimento_d, o.cod_cliente),
      conferencia = case when finance._receber_diverg(r.valor, r.vencimento, r.codigo_cliente_omie,
                                                      o.valor_titulo, o.dt_vencimento_d, o.cod_cliente) is null
                         then 'ok' else 'divergente' end,
      conferido_em = now()
    where id = r.id;
    n_ligados := n_ligados + 1;
  end loop;

  -- 3. Títulos do Omie sem par entram como 'so_omie'.
  insert into finance.receber (
    empresa, codigo_cliente_omie, cliente_cnpj, numero_documento, numero_parcela, numero_pedido,
    numero_documento_fiscal, chave_nfe, emissao, vencimento, previsao, valor, codigo_categoria,
    codigo_projeto, id_conta_corrente, observacao, origem, omie_codigo_lancamento, conferencia,
    conferido_em, created_by)
  select p.empresa, p.cod_cliente, nullif(p.cpf_cnpj_cliente, ''), p.num_titulo, p.num_parcela, p.num_os,
         p.num_doc_fiscal, p.chave_nfe, p.dt_emissao_d, p.dt_vencimento_d, p.dt_previsao_d,
         coalesce(p.valor_titulo, 0), p.cod_categoria, p.cod_projeto, p.cod_cc, p.observacao,
         'omie', p.cod_titulo, 'so_omie', now(), 'omie-sync'
  from finance.pesquisa_titulos p
  where p.natureza = 'R'
    and not exists (select 1 from finance.receber y
                    where y.empresa = p.empresa and y.omie_codigo_lancamento = p.cod_titulo)
  on conflict (empresa, omie_codigo_lancamento) do nothing;
  get diagnostics n_novos = row_count;

  return jsonb_build_object('espelhados', n_espelho, 'recomparados', n_comparados,
                            'ligados', n_ligados, 'novos_so_omie', n_novos, 'em', now());
end $$;

revoke all on function finance.conciliar_receber_omie() from public, anon, authenticated;
grant execute on function finance.conciliar_receber_omie() to service_role;

-- O que a tela lê. Mesmos nomes de coluna da finance.v_titulos_omie (a rota
-- da API só troca o nome da fonte). Valores, datas e documentos são os NOSSOS;
-- baixa (pago, saldo, status, data de pagamento) vem do Omie enquanto houver
-- título ligado. Linha nossa sem par: status calculado pelo vencimento.
create or replace view finance.v_receber as
select
  r.id,
  r.origem                                   as origem_registro,
  r.conferencia,
  r.divergencias,
  r.conferido_em,
  r.created_by,
  (r.omie_codigo_lancamento is not null and o.cod_titulo is null) as omie_ausente,
  r.empresa,
  'R'::text                                  as natureza,
  'receber'::text                            as tipo,
  r.omie_codigo_lancamento                   as cod_titulo,
  r.omie_codigo_lancamento                   as codigo_lancamento_omie,
  o.cod_int_titulo, o.cod_tit_repet,
  r.numero_documento                         as num_titulo,
  r.numero_documento,
  r.numero_parcela                           as num_parcela,
  r.numero_parcela,
  r.numero_documento_fiscal                  as num_doc_fiscal,
  r.numero_documento_fiscal,
  o.num_boleto, o.boleto_numero, coalesce(o.boleto_gerado, false) as boleto_gerado,
  o.codigo_barras, o.nsu,
  r.chave_nfe,
  o.num_contrato, o.cod_contrato,
  r.numero_pedido                            as num_os,
  r.numero_pedido,
  o.cod_os, o.cod_nf,
  r.codigo_cliente_omie                      as cod_cliente,
  r.codigo_cliente_omie                      as codigo_cliente_fornecedor,
  coalesce(nullif(cli.nome_fantasia, ''), cli.razao_social, r.cliente_razao) as contraparte,
  coalesce(cli.razao_social, r.cliente_razao) as contraparte_razao,
  coalesce(r.cliente_cnpj, cli.cnpj_cpf)     as cnpj_cpf,
  o.cod_vendedor, o.cod_comprador, o.dt_registro,
  r.emissao, r.vencimento, r.previsao,
  o.pagamento, o.dt_cancelamento,
  r.valor                                    as valor_titulo,
  r.valor                                    as valor_documento,
  o.val_liquido,
  coalesce(o.val_pago, 0)                    as val_pago,
  coalesce(o.val_pago, 0)                    as valor_pago,
  case when o.cod_titulo is not null then o.val_aberto else r.valor end as val_aberto,
  o.juros, o.multa, o.desconto,
  o.valor_ir, o.ret_ir, o.valor_pis, o.ret_pis, o.valor_cofins, o.ret_cofins,
  o.valor_csll, o.ret_csll, o.valor_inss, o.ret_inss, o.valor_iss, o.ret_iss,
  r.codigo_categoria                         as cod_categoria,
  r.codigo_categoria,
  cat.descricao                              as categoria,
  o.categorias_rateio, coalesce(o.tem_rateio, false) as tem_rateio, o.grupo_despesa,
  r.codigo_projeto                           as cod_projeto,
  r.codigo_projeto,
  proj.nome                                  as projeto,
  r.id_conta_corrente                        as cod_cc,
  cc.descricao                               as conta_corrente,
  o.operacao, o.origem, o.tipo_documento,
  coalesce(o.status, case when r.vencimento < current_date then 'ATRASADO'
                          when r.vencimento = current_date then 'VENCE HOJE'
                          else 'A VENCER' end) as status,
  coalesce(o.status, case when r.vencimento < current_date then 'ATRASADO'
                          when r.vencimento = current_date then 'VENCE HOJE'
                          else 'A VENCER' end) as status_titulo,
  o.liquidado, o.status_pago_d,
  r.observacao,
  o.info_d_inc, o.info_h_inc, o.info_u_inc, o.info_d_alt, o.info_h_alt, o.info_u_alt,
  coalesce(o.synced_at, r.updated_at)        as synced_at,
  case when o.cod_titulo is not null then o.em_aberto else true end as em_aberto,
  (r.vencimento - current_date)              as dias_para_vencer
from finance.receber r
left join finance.v_titulos_omie o
       on o.natureza = 'R' and o.empresa = r.empresa and o.cod_titulo = r.omie_codigo_lancamento
left join finance.clientes cli
       on cli.empresa = r.empresa and cli.codigo_cliente_omie = r.codigo_cliente_omie
left join finance.categorias cat
       on cat.empresa = r.empresa and cat.codigo = r.codigo_categoria
left join finance.projetos proj
       on proj.empresa = r.empresa and proj.codigo::text = r.codigo_projeto
left join finance.contas_correntes cc
       on cc.empresa = r.empresa and cc.cod_cc = r.id_conta_corrente;

revoke all on finance.v_receber from anon, authenticated;
grant select on finance.v_receber to service_role;

comment on table finance.receber is
  'Contas a receber — fonte da verdade desde 01/10/26. Omie entra pela finance.conciliar_receber_omie() sem duplicar.';
comment on view finance.v_receber is
  'Contas a receber para a tela (/financeiro/receber): nossos valores + baixa do Omie. Mesmos nomes da v_titulos_omie.';

-- Carga inicial + agenda (a cada 30 min, depois do sync financeiro).
select finance.conciliar_receber_omie();
select cron.schedule('conciliar-receber-omie', '20,50 * * * *', 'SELECT finance.conciliar_receber_omie()');

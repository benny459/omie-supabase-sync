-- 58 — Títulos a Pagar v3 (mockup "contas-a-pagar-v3", 05/10/26).
--
-- A tela nova paga, programa banco, baixa em lote e concilia OFX também os
-- títulos do OMIE (não só as previsões de PC do painel). Para a conciliação e o
-- livro de baixas continuarem num lugar só, a baixa de título do Omie entra no
-- MESMO livro (finance.baixas) — com cod_titulo em vez de pagar_id:
--
--   finance.baixas        + cod_titulo, desconto, juros, multa, lote_id, omie_status
--                         origem passa a aceitar 'lote'
--   finance.pagar_lotes   cabeçalho de uma baixa em lote
--   finance.pagar_programacao  "banco p/ pagar" escolhido por título
--
-- Omie: NADA é enviado ao Omie. A baixa de título do Omie fica com
-- omie_status = 'nao_enviado' (a tela mostra e exporta a lista para baixar lá
-- à mão) até o Benny decidir ligar o envio (LancarPagamento).
--
-- finance.baixas_painel (16 baixas reais de 02/10 do OFX C6, feitas fora do
-- código) é copiada para finance.baixas, para a Conciliação OFX ver esses
-- movimentos como conciliados. A tabela antiga fica como estava (+ migrado_para).

alter table finance.baixas
  add column if not exists cod_titulo  bigint,
  add column if not exists desconto    numeric(14, 2) not null default 0,
  add column if not exists juros       numeric(14, 2) not null default 0,
  add column if not exists multa       numeric(14, 2) not null default 0,
  add column if not exists lote_id     bigint,
  add column if not exists omie_status text;
alter table finance.baixas drop constraint if exists baixas_origem_check;
alter table finance.baixas add constraint baixas_origem_check check (origem in ('manual', 'conciliacao', 'lote'));
create index if not exists baixas_cod_titulo on finance.baixas (cod_titulo) where estornado_em is null;

create table if not exists finance.pagar_lotes (
  id          bigserial primary key,
  data        date not null,
  observacao  text,
  n           int not null default 0,
  total       numeric(14, 2) not null default 0,
  criado_por  text,
  criado_em   timestamptz not null default now()
);
create table if not exists finance.pagar_programacao (
  ref            text primary key,           -- 'o:<cod_titulo>' | 'p:<pagar_previsto.id>'
  empresa        text not null,
  cod_cc         bigint not null,
  atualizado_por text,
  atualizado_em  timestamptz not null default now()
);
alter table finance.pagar_lotes       enable row level security;
alter table finance.pagar_programacao enable row level security;
revoke all on finance.pagar_lotes, finance.pagar_programacao from anon, authenticated;
grant select, insert, update, delete on finance.pagar_lotes, finance.pagar_programacao to service_role;
grant usage, select on sequence finance.pagar_lotes_id_seq to service_role;

-- ── cópia das baixas antigas (baixas_painel → baixas) ────────────────────────
alter table finance.baixas_painel add column if not exists migrado_para bigint;
do $$ declare bp record; v_id bigint; begin
  for bp in select * from finance.baixas_painel where cancelado_em is null and migrado_para is null order by id loop
    insert into finance.baixas (empresa, natureza, cod_titulo, documento, contraparte, data, valor, cod_cc,
                                movimento_id, origem, observacao, criado_por, criado_em, omie_status)
    select bp.empresa, 'P', bp.cod_titulo,
           coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, ''), 'Título Omie ' || bp.cod_titulo),
           t.contraparte, bp.data, bp.valor, bp.cod_cc, bp.movimento_id,
           case when bp.movimento_id is null then 'manual' else 'conciliacao' end,
           trim(coalesce(bp.observacao || ' · ', '') || 'migrado de baixas_painel #' || bp.id),
           bp.criado_por, bp.criado_em, coalesce(bp.omie_status, 'nao_enviado')
      from (select 1) x
      left join finance.v_titulos_omie t on t.tipo = 'pagar' and t.cod_titulo = bp.cod_titulo
    returning id into v_id;
    update finance.baixas_painel set migrado_para = v_id where id = bp.id;
  end loop;
end $$;

-- ── dados da tela ────────────────────────────────────────────────────────────
-- Títulos em aberto com vencimento em [hoje-180, hoje+90] (o resto vai em
-- agregados por faixa), já com o saldo líquido das baixas do painel, a compra
-- (PC + aprovação + etapa/NF) e o status de pagamento da regra do mockup:
--   bloq  = PC sem aprovação (ou pendente)   nf  = aprovado, NF não recebida
--   ok    = aprovado e NF recebida/fat. direto  sempc = NF-e sem PC
--   dir   = sem PC (folha, imposto, contrato)
create or replace function finance.pagar_v3_dados(p_hoje date default null)
returns jsonb language sql stable security definer set search_path = finance, public as $$
with hoje as (select coalesce(p_hoje, (now() at time zone 'America/Sao_Paulo')::date) d),
pb as (
  select cod_titulo, sum(valor) v from finance.baixas
   where cod_titulo is not null and natureza = 'P' and estornado_em is null group by 1
),
om_ab as (
  select t.empresa, t.cod_titulo, t.vencimento venc,
         round(coalesce(t.val_aberto, t.valor_documento) - coalesce(pb.v, 0), 2) saldo,
         t.valor_documento, coalesce(nullif(t.contraparte, ''), '(sem nome)') forn, t.categoria cat, t.projeto proj,
         coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, '')) doc, t.numero_parcela parc,
         t.conta_corrente conta, t.cod_cc, t.tipo_documento tipo, regexp_replace(coalesce(t.cnpj_cpf, ''), '\D', '', 'g') cnpj,
         nullif(trim(split_part(coalesce(t.numero_pedido, ''), ',', 1)), '') pc, t.codigo_cliente_fornecedor cod_forn,
         t.numero_documento_fiscal nf_doc, t.observacao obs
    from finance.v_titulos_omie t cross join hoje h left join pb on pb.cod_titulo = t.cod_titulo
   where t.tipo = 'pagar' and t.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
     and t.vencimento between h.d - 180 and h.d + 90
     and coalesce(t.val_aberto, t.valor_documento) - coalesce(pb.v, 0) > 0.004
),
om_fora as (
  select t.empresa, t.vencimento venc, coalesce(t.val_aberto, t.valor_documento) - coalesce(pb.v, 0) saldo
    from finance.v_titulos_omie t cross join hoje h left join pb on pb.cod_titulo = t.cod_titulo
   where t.tipo = 'pagar' and t.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
     and (t.vencimento is null or t.vencimento < h.d - 180 or t.vencimento > h.d + 90)
     and coalesce(t.val_aberto, t.valor_documento) - coalesce(pb.v, 0) > 0.004
),
pv as (
  select p.empresa, p.pagar_id, p.vencimento venc, round(p.val_aberto, 2) saldo, p.valor_documento,
         coalesce(p.contraparte, '(sem nome)') forn, p.categoria cat, p.projeto proj,
         coalesce(nullif(p.numero_documento_fiscal, ''), p.numero_documento) doc, p.numero_parcela parc,
         p.conta_corrente conta, p.cod_cc, p.tipo_documento tipo, regexp_replace(coalesce(p.cnpj_cpf, ''), '\D', '', 'g') cnpj,
         p.numero_pedido pc, p.codigo_cliente_fornecedor cod_forn, p.fase, p.observacao obs, p.pedido_id
    from finance.v_pagar_previsto p where not coalesce(p.quitado, false) and p.val_aberto > 0.004
),
janela as (
  select 'o:' || o.cod_titulo ref, 'o' orig, o.*, null::text fase from om_ab o
),
pcs as (
  select distinct pcc.empresa, pcc.cnumero, pcc.ncod_ped
    from orders.pedidos_compra pcc
   where (pcc.empresa, pcc.cnumero) in (select empresa, pc from janela where pc is not null)
),
apr_ap as (
  select j.ref, array_agg(distinct ap.status) st,
         (array_agg(ap.aprovador_email) filter (where ap.status like 'APROVADO%'))[1] aprovador
    from janela j
    join pcs on pcs.empresa = j.empresa and pcs.cnumero = j.pc
    join approval.approvals ap on ap.empresa = pcs.empresa and (ap.ncod_ped = pcs.ncod_ped or ap.pc_numero_manual = pcs.cnumero)
   group by j.ref
),
apr as (
  select j.ref, x.st, x.aprovador, cp.etapa, cp.nf, cp.aprov_status, cp.aprov_por
    from janela j
    left join apr_ap x on x.ref = j.ref
    left join compras.pedidos cp on cp.empresa = j.empresa and cp.numero = j.pc and not coalesce(cp.cancelado, false)
   where j.pc is not null
),
linhas as (
  select j.ref, j.orig, j.empresa, j.venc, j.saldo, j.valor_documento, j.forn, j.cat, j.proj, j.doc, j.parc, j.conta,
         j.cod_cc, j.cod_titulo, j.tipo, j.cnpj, j.pc, j.cod_forn, j.nf_doc, j.obs, null::text fase,
         case when 'APROVADO_FAT_DIRETO' = any(a.st) then 'APROVADO_FAT_DIRETO'
              when exists (select 1 from unnest(a.st) s where s like 'APROVADO%') then 'APROVADO'
              when a.aprov_status = 'aprovado' then 'APROVADO'
              when 'PENDENTE' = any(a.st) then 'PENDENTE' end apr,
         coalesce(a.aprovador, a.aprov_por) aprov, a.etapa, a.nf, coalesce(array_length(a.st, 1), 0) > 1 div
    from janela j left join apr a on a.ref = j.ref
  union all
  select 'p:' || p.pagar_id, 'p', p.empresa, p.venc, p.saldo, p.valor_documento, p.forn, p.cat, p.proj, p.doc, p.parc,
         p.conta, p.cod_cc, null, p.tipo, p.cnpj, p.pc, p.cod_forn, null, p.obs, p.fase,
         case when p.fase = 'bloqueado' then 'PENDENTE' else 'APROVADO' end, cp.aprov_por, cp.etapa, cp.nf, false
    from pv p
    cross join hoje h
    left join compras.pedidos cp on cp.id = p.pedido_id
   where p.venc between h.d - 180 and h.d + 90
),
comst as (
  select l.*,
         case when l.fase is not null then
                case l.fase when 'liberado' then 'ok' when 'bloqueado' then 'bloq' else 'nf' end
              when l.apr = 'PENDENTE' or (l.apr is null and l.pc is not null) then 'bloq'
              when l.apr is not null and l.etapa in ('10', '15', '20') then 'nf'
              when l.apr is not null then 'ok'
              when l.tipo = 'NFE' then 'sempc'
              else 'dir' end st
    from linhas l
),
fora as (
  select empresa, venc, saldo from om_fora union all select empresa, venc, saldo from pv
),
agg as (
  select f.empresa,
         case when f.venc < h.d - 365 then 'v>365' when f.venc < h.d - 180 then 'v181-365'
              when f.venc > h.d + 365 then 'f>12m' when f.venc > h.d + 180 then 'f181-365'
              when f.venc > h.d + 90 then 'f91-180' end faixa,
         count(*) n, round(sum(f.saldo)) v
    from fora f, hoje h
   where f.venc < h.d - 180 or f.venc > h.d + 90 or f.venc is null
   group by 1, 2
),
mov as (
  select m.cod_cc, max(m.data) filter (where m.origem = 'ofx') ofx_ultimo,
         count(*) filter (where not m.ignorado and m.valor < 0
                          and coalesce((select sum(b.valor) from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), 0)
                              < abs(m.valor) - 0.004) pend
    from finance.banco_movimentos m group by 1
)
select jsonb_build_object(
  'hoje', (select d from hoje),
  'rows', coalesce((select jsonb_agg(jsonb_build_array(
      c.ref, c.empresa, c.venc, c.saldo, c.forn, c.cat, c.proj, c.doc, c.parc, c.conta, c.cod_cc, c.cod_titulo,
      c.apr, c.pc, c.etapa, c.nf, c.aprov, c.tipo, c.div, c.st, c.cnpj, c.orig, c.valor_documento, c.cod_forn,
      c.nf_doc, c.fase) order by c.venc, c.saldo desc) from comst c), '[]'::jsonb),
  'agg', coalesce((select jsonb_object_agg(e, fx) from (
      select empresa e, jsonb_object_agg(faixa, jsonb_build_object('n', n, 'v', v)) fx from agg where faixa is not null group by 1) z), '{}'::jsonb),
  'banks', coalesce((select jsonb_agg(jsonb_build_array(s.empresa, s.cod_conta, s.conta, cc.tipo_conta_corrente, s.saldo,
      s.dt_ultimo, mv.ofx_ultimo, coalesce(mv.pend, 0)) order by s.empresa, s.saldo desc)
      from bi.saldo_por_conta(null) s
      join finance.contas_correntes cc on cc.empresa = s.empresa and cc.cod_cc = s.cod_conta and coalesce(cc.inativo, 'N') <> 'S'
      left join mov mv on mv.cod_cc = s.cod_conta), '[]'::jsonb),
  'prog', coalesce((select jsonb_object_agg(ref, cod_cc) from finance.pagar_programacao), '{}'::jsonb)
)
$$;

-- ── baixa (individual, em lote ou por movimento do extrato) ──────────────────
-- p_itens: [{ref, valor, cod_cc, desconto?, juros?, multa?, forcar?, obs?}]
-- 'p:<id>' passa por finance.baixa_registrar (regras do P4: fase liberado,
-- saldo); 'o:<cod_titulo>' grava no mesmo livro com cod_titulo e
-- omie_status 'nao_enviado'. Bloqueio por status de pagamento (aprovação/NF)
-- é conferido na rota, que recalcula o status no servidor.
create or replace function finance.pagar_v3_baixar(
  p_itens jsonb, p_data date, p_obs text, p_usuario text, p_lote boolean default false, p_movimento_id bigint default null)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare i jsonb; v_ref text; v_val numeric; v_lote bigint; v_id bigint; v_n int := 0; v_tot numeric := 0;
        tt record; v_ja numeric; m finance.banco_movimentos; v_soma numeric := 0; v_obs text; r jsonb;
        v_forcar boolean; v_desc numeric; v_jur numeric; v_mul numeric; v_cc bigint;
begin
  if p_data is null then raise exception 'Data do pagamento obrigatória'; end if;
  if jsonb_array_length(coalesce(p_itens, '[]'::jsonb)) = 0 then raise exception 'Nenhum título'; end if;
  if p_movimento_id is not null then
    select * into m from finance.banco_movimentos where id = p_movimento_id for update;
    if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
    if m.ignorado then raise exception 'Movimento está ignorado — reative antes'; end if;
    if m.valor >= 0 then raise exception 'Movimento de entrada não paga título a pagar'; end if;
    select coalesce(sum(valor), 0) into v_ja from finance.baixas where movimento_id = m.id and estornado_em is null;
    for i in select * from jsonb_array_elements(p_itens) loop v_soma := v_soma + round((i->>'valor')::numeric, 2); end loop;
    if v_ja + v_soma > abs(m.valor) + 0.004 then
      raise exception 'Soma dos títulos (%) passa o valor do movimento (% já usado de %)', v_soma, v_ja, abs(m.valor);
    end if;
  end if;
  if p_lote then
    insert into finance.pagar_lotes (data, observacao, criado_por) values (p_data, nullif(trim(p_obs), ''), p_usuario)
    returning id into v_lote;
  end if;

  for i in select * from jsonb_array_elements(p_itens) loop
    v_ref := i->>'ref'; v_val := round((i->>'valor')::numeric, 2);
    v_forcar := coalesce((i->>'forcar')::boolean, false);
    v_desc := coalesce((i->>'desconto')::numeric, 0); v_jur := coalesce((i->>'juros')::numeric, 0); v_mul := coalesce((i->>'multa')::numeric, 0);
    v_cc := coalesce((i->>'cod_cc')::bigint, m.cod_cc);
    v_obs := nullif(trim(concat_ws(' · ', nullif(trim(i->>'obs'), ''), nullif(trim(p_obs), ''),
                     case when p_movimento_id is not null then 'OFX: ' || coalesce(m.memo, m.nome, m.fitid) end)), '');
    if v_val is null or v_val <= 0 then raise exception 'Valor inválido em %', v_ref; end if;
    if v_cc is null then raise exception 'Escolha o banco do pagamento (%)', v_ref; end if;

    if v_ref like 'p:%' then
      r := finance.baixa_registrar('P', substr(v_ref, 3), p_data, v_val, v_cc, p_movimento_id, v_obs, p_usuario,
                                   v_forcar or p_movimento_id is not null);
      v_id := (r->>'baixa_id')::bigint;
      update finance.baixas set desconto = v_desc, juros = v_jur, multa = v_mul, lote_id = v_lote,
             origem = case when v_lote is not null then 'lote' else origem end
       where id = v_id;
    elsif v_ref like 'o:%' then
      perform pg_advisory_xact_lock(hashtext(v_ref));
      select t.empresa, t.contraparte,
             coalesce(nullif(t.numero_documento_fiscal, ''), nullif(t.numero_documento, ''), 'Título Omie ' || t.cod_titulo) documento,
             round(coalesce(t.val_aberto, t.valor_documento) - coalesce((select sum(b.valor) from finance.baixas b
                   where b.cod_titulo = t.cod_titulo and b.natureza = 'P' and b.estornado_em is null), 0), 2) saldo
        into tt
        from finance.v_titulos_omie t
       where t.tipo = 'pagar' and t.cod_titulo = substr(v_ref, 3)::bigint
         and t.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO');
      if not found then raise exception 'Título % não está em aberto', v_ref; end if;
      if v_val > tt.saldo + 0.004 then raise exception 'Valor (%) maior que o saldo em aberto (%) de %', v_val, tt.saldo, tt.contraparte; end if;
      if v_forcar and v_obs is null then raise exception 'Pagamento de título bloqueado exige justificativa'; end if;
      if not exists (select 1 from finance.contas_correntes c where c.empresa = tt.empresa and c.cod_cc = v_cc)
         and p_movimento_id is null then
        raise exception 'Banco escolhido não é da empresa % (%)', tt.empresa, tt.contraparte;
      end if;
      insert into finance.baixas (empresa, natureza, cod_titulo, documento, contraparte, data, valor, cod_cc, movimento_id,
                                  origem, forcada, observacao, criado_por, desconto, juros, multa, lote_id, omie_status)
      values (tt.empresa, 'P', substr(v_ref, 3)::bigint, tt.documento, tt.contraparte, p_data, v_val, v_cc, p_movimento_id,
              case when p_movimento_id is not null then 'conciliacao' when v_lote is not null then 'lote' else 'manual' end,
              v_forcar, v_obs, p_usuario, v_desc, v_jur, v_mul, v_lote, 'nao_enviado')
      returning id into v_id;
      insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
      values (p_usuario, 'baixa', 'pagar_omie', substr(v_ref, 3),
              jsonb_build_object('baixa_id', v_id, 'valor', v_val, 'data', p_data, 'cod_cc', v_cc, 'movimento_id', p_movimento_id,
                                 'forcada', v_forcar, 'lote_id', v_lote, 'obs', v_obs));
    else
      raise exception 'Referência inválida: %', v_ref;
    end if;
    v_n := v_n + 1; v_tot := v_tot + v_val;
  end loop;

  if v_lote is not null then update finance.pagar_lotes set n = v_n, total = v_tot where id = v_lote; end if;
  if p_movimento_id is not null then
    insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
    values (p_usuario, 'conciliar', 'movimento', p_movimento_id::text, jsonb_build_object('itens', p_itens, 'valor', m.valor));
  end if;
  return jsonb_build_object('ok', true, 'baixas', v_n, 'total', v_tot, 'lote_id', v_lote);
end $$;

-- banco programado para pagar (por título)
create or replace function finance.pagar_v3_programar(p_refs text[], p_empresa text, p_cod_cc bigint, p_usuario text)
returns jsonb language plpgsql security definer set search_path = finance, public as $$
declare n int;
begin
  if p_cod_cc is null then
    delete from finance.pagar_programacao where ref = any(p_refs);
    get diagnostics n = row_count;
  else
    if not exists (select 1 from finance.contas_correntes where empresa = p_empresa and cod_cc = p_cod_cc and coalesce(inativo, 'N') <> 'S') then
      raise exception 'Conta % não é da empresa % (ou está inativa)', p_cod_cc, p_empresa;
    end if;
    insert into finance.pagar_programacao (ref, empresa, cod_cc, atualizado_por, atualizado_em)
    select unnest(p_refs), p_empresa, p_cod_cc, p_usuario, now()
    on conflict (ref) do update set cod_cc = excluded.cod_cc, empresa = excluded.empresa,
       atualizado_por = excluded.atualizado_por, atualizado_em = now();
    get diagnostics n = row_count;
  end if;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'programar_banco', 'pagar', p_empresa, jsonb_build_object('refs', p_refs, 'cod_cc', p_cod_cc));
  return jsonb_build_object('ok', true, 'n', n);
end $$;

-- baixas do pagar (hoje, ou todas as de títulos do Omie ainda não enviadas)
create or replace function finance.pagar_v3_baixas(p_desde timestamptz, p_so_omie_pendente boolean default false)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'empresa', b.empresa, 'ref', case when b.cod_titulo is not null then 'o:' || b.cod_titulo else 'p:' || b.pagar_id end,
    'cod_titulo', b.cod_titulo, 'documento', b.documento, 'contraparte', b.contraparte, 'data', b.data, 'valor', b.valor,
    'desconto', b.desconto, 'juros', b.juros, 'multa', b.multa, 'cod_cc', b.cod_cc, 'conta', cc.descricao,
    'origem', b.origem, 'forcada', b.forcada, 'observacao', b.observacao, 'lote_id', b.lote_id,
    'omie_status', b.omie_status, 'movimento_id', b.movimento_id, 'criado_por', b.criado_por, 'criado_em', b.criado_em)
    order by b.criado_em desc), '[]'::jsonb)
    from finance.baixas b
    left join finance.contas_correntes cc on cc.empresa = b.empresa and cc.cod_cc = b.cod_cc
   where b.natureza = 'P' and b.estornado_em is null
     and (case when p_so_omie_pendente then b.omie_status = 'nao_enviado' else b.criado_em >= p_desde end)
$$;

-- movimentos de uma conta (débitos e créditos) com o que já está casado
create or replace function finance.pagar_v3_movimentos(p_cod_cc bigint, p_de date)
returns jsonb language sql stable security definer set search_path = finance, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'empresa', m.empresa, 'data', m.data, 'valor', m.valor, 'memo', coalesce(m.memo, m.nome), 'arquivo', m.arquivo,
    'importado_em', m.importado_em, 'ignorado', m.ignorado, 'motivo', m.ignorado_motivo,
    'casado', coalesce(x.casado, 0), 'baixas', coalesce(x.baixas, '[]'::jsonb)) order by m.data desc, m.id), '[]'::jsonb)
    from finance.banco_movimentos m
    left join lateral (
      select sum(b.valor) casado, jsonb_agg(jsonb_build_object('id', b.id, 'contraparte', b.contraparte, 'empresa', b.empresa,
             'documento', b.documento, 'valor', b.valor, 'ref', case when b.cod_titulo is not null then 'o:' || b.cod_titulo
             when b.pagar_id is not null then 'p:' || b.pagar_id end)) baixas
        from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null) x on true
   where m.cod_cc = p_cod_cc and m.data >= p_de
$$;

do $$ declare f text; begin
  foreach f in array array[
    'finance.pagar_v3_dados(date)', 'finance.pagar_v3_baixar(jsonb, date, text, text, boolean, bigint)',
    'finance.pagar_v3_programar(text[], text, bigint, text)', 'finance.pagar_v3_baixas(timestamptz, boolean)',
    'finance.pagar_v3_movimentos(bigint, date)']
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- 73 · Conciliação: painel "Casar" (05/10/26)
-- Pedido do Benny: "não consigo fazer o casamento porque não consigo achar — dá mais opções:
-- nome do cliente, número de NF; pelo valor, vencimento e CNPJ já podia sugerir".
--
-- • finance.conc_titulos_abertos  — TODOS os títulos em aberto que um movimento pode quitar:
--     pagar do Omie (o:cod), previsões/contas a pagar do painel (p:id) e contas a receber
--     (r:uuid — Omie e painel, via v_receber_bruto). Antes só os títulos nativos apareciam.
-- • finance.conciliacao_candidatos — candidatos de um movimento com pontuação e MOTIVOS
--     (valor exato/próximo, vencimento, CNPJ no histórico, nome no histórico, NF/doc no
--     histórico, nosso número, aprendido) + grupos (parcelas do mesmo doc/cliente) + busca livre.
-- • finance.conciliar_casar        — concilia por referência (o:/p:/r:) com juros/desconto,
--     delegando nas funções do Pagar v3 / Receber v1 (mesmo livro de baixas).
-- • finance.conciliacao_aliases    — aprendizagem: trecho do histórico → cliente/fornecedor.
-- • transferência entre contas     — par de movimentos opostos, ambos marcados.
-- • finance.movimento_lancar_pessoa — "criar título e conciliar" com fornecedor/cliente do cadastro.
-- • conciliacao_painel passa a contar o casado em dinheiro (valor − desconto + juros + multa).
-- Migrações aplicadas: p73_conc_casar_1..n (aditivas).

create table if not exists finance.conciliacao_aliases (
  id bigserial primary key,
  chave text not null,
  natureza char(1) not null check (natureza in ('P','R')),
  empresa text,
  cnpj text,
  contraparte text not null,
  usos int not null default 1,
  criado_por text,
  criado_em timestamptz not null default now(),
  ultimo_uso timestamptz not null default now(),
  unique (chave, natureza, contraparte)
);
alter table finance.conciliacao_aliases enable row level security;
revoke all on finance.conciliacao_aliases from anon, authenticated;
grant all on finance.conciliacao_aliases to service_role;
grant usage, select on sequence finance.conciliacao_aliases_id_seq to service_role;

alter table finance.banco_movimentos add column if not exists transferencia_par bigint;

-- Texto "limpo" para comparar nomes: maiúsculas, sem acento, sem números e sem palavras de banco.
create or replace function finance.conc_texto(p text) returns text
language sql immutable as $$
  select trim(regexp_replace(regexp_replace(
    translate(upper(coalesce(p, '')), 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ', 'AAAAAEEEEIIIIOOOOOUUUUC'),
    '\m(PIX|TED|DOC|TEF|TRANSF|TRANSFERENCIA|ELET|DISPON|REMET|REMETENTE|REM|DES|DEST|DESTINATARIO|FAVORECIDO|RECEBIDO|RECEBIDA|RECEB|ENVIADO|ENVIADA|ENVIO|PAGO|PAGA|PAGAMENTO|PAGTO|PGTO|BOLETO|CONTA|DE|DA|DO|DOS|DAS|PARA|CNPJ|CPF|CREDITO|DEBITO|SALDO|OUTRA|TITULARIDADE|INTERNET|BANKING|CEL|COBRANCA|LIQUIDACAO|TRANSACAO|NUMERO|AUTOMATICAMENTE|REALIZADO|REFERENTE|AO|DOCUMENTO|COMPRA|CARTAO|TARIFA|SISPAG|QRCODE|QR|CODE)\M', ' ', 'g'),
    '[^A-Z ]+', ' ', 'g'))
$$;

-- Chave do alias: as 3 primeiras palavras significativas do histórico.
create or replace function finance.conc_chave(p text) returns text
language sql immutable as $$
  select nullif(array_to_string((regexp_split_to_array(regexp_replace(finance.conc_texto(p), '\s+', ' ', 'g'), ' '))[1:3], ' '), '')
$$;

-- Todos os títulos em aberto (pagar Omie + pagar painel + receber Omie/painel).
drop function if exists finance.conc_titulos_abertos(text, char);
create function finance.conc_titulos_abertos(p_empresa text, p_natureza char)
returns table (ref text, natureza char, empresa text, origem text, contraparte text, cnpj text,
               documento text, nf text, pedido text, num_titulo text, boleto text,
               vencimento date, previsao date, valor numeric, saldo numeric, fase text, razao text)
language sql stable security definer set search_path to 'finance', 'public' as $$
  with bx as (
    select b.cod_titulo, sum(b.valor) v from finance.baixas b
     where b.natureza = 'P' and b.cod_titulo is not null and b.estornado_em is null group by b.cod_titulo
  )
  select 'o:' || t.cod_titulo, 'P'::char, t.empresa, 'omie', coalesce(nullif(t.contraparte, ''), t.contraparte_razao),
         regexp_replace(coalesce(t.cnpj_cpf, ''), '\D', '', 'g'),
         coalesce(nullif(t.numero_documento, ''), t.num_titulo) || coalesce(' · ' || nullif(t.numero_parcela, ''), ''),
         nullif(coalesce(t.numero_documento_fiscal, t.num_doc_fiscal), ''), nullif(t.numero_pedido, ''),
         nullif(t.num_titulo, ''), nullif(coalesce(t.num_boleto, t.boleto_numero), ''),
         t.vencimento, t.previsao, coalesce(t.valor_documento, t.valor_titulo),
         round(coalesce(t.val_aberto, t.valor_documento) - coalesce(bx.v, 0), 2), t.status_titulo, t.contraparte_razao
    from finance.v_titulos_omie_bruto t left join bx on bx.cod_titulo = t.cod_titulo
   where p_natureza = 'P' and t.tipo = 'pagar' and (p_empresa is null or t.empresa = p_empresa)
     and t.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO')
     and coalesce(t.val_aberto, t.valor_documento) - coalesce(bx.v, 0) > 0.004
  union all
  select 'p:' || n.titulo, 'P'::char, n.empresa, 'painel', n.contraparte, regexp_replace(coalesce(n.cnpj, ''), '\D', '', 'g'),
         n.documento, nullif(n.nf_numero, ''), nullif(n.pedido_numero, ''), null, null,
         n.vencimento, null::date, n.valor, n.saldo, n.fase, null
    from finance.v_titulos_nativos n
   where p_natureza = 'P' and n.natureza = 'P' and n.saldo > 0.004 and (p_empresa is null or n.empresa = p_empresa)
  union all
  select 'r:' || r.id, 'R'::char, r.empresa, coalesce(r.origem_registro, 'omie'), coalesce(nullif(r.contraparte, ''), r.contraparte_razao),
         regexp_replace(coalesce(r.cnpj_cpf, ''), '\D', '', 'g'),
         coalesce(nullif(r.numero_documento, ''), r.num_titulo, 'Conta a receber') || coalesce(' · ' || nullif(r.numero_parcela, ''), ''),
         nullif(coalesce(r.numero_documento_fiscal, r.num_doc_fiscal), ''), nullif(r.numero_pedido, ''),
         nullif(r.num_titulo, ''), nullif(coalesce(r.num_boleto, r.boleto_numero), ''),
         r.vencimento, r.previsao, coalesce(r.valor_documento, r.valor_titulo),
         round(coalesce(r.val_aberto, r.valor_documento), 2), r.status_titulo, r.contraparte_razao
    from finance.v_receber_bruto r
   where p_natureza = 'R' and (p_empresa is null or r.empresa = p_empresa)
     and r.status_titulo in ('A VENCER', 'VENCE HOJE', 'ATRASADO') and coalesce(r.val_aberto, r.valor_documento) > 0.004
$$;
revoke all on function finance.conc_titulos_abertos(text, char) from public, anon, authenticated;
grant execute on function finance.conc_titulos_abertos(text, char) to service_role;

-- Restante de um movimento (em dinheiro).
create or replace function finance.conc_restante(p_movimento_id bigint) returns numeric
language sql stable security definer set search_path to 'finance', 'public' as $$
  select round(abs(m.valor) - coalesce((select sum(b.valor - coalesce(b.desconto, 0) + coalesce(b.juros, 0) + coalesce(b.multa, 0))
                                          from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), 0), 2)
    from finance.banco_movimentos m where m.id = p_movimento_id
$$;

-- Candidatos de um movimento (sugestões com motivos + grupos + busca livre).
drop function if exists finance.conciliacao_candidatos(bigint, text, numeric, numeric, date, date, boolean, int);
create function finance.conciliacao_candidatos(
  p_movimento_id bigint, p_q text default null, p_vmin numeric default null, p_vmax numeric default null,
  p_venc_de date default null, p_venc_ate date default null, p_todas_empresas boolean default false, p_lim int default 40)
returns jsonb language plpgsql volatile security definer set search_path to 'finance', 'public' as $$
declare m finance.banco_movimentos; v_nat char(1); v_rest numeric; v_txt text; v_dig text; v_nome text; v_q text; v_qdig text; v_qval numeric;
        v_cands jsonb; v_grupos jsonb; v_alias jsonb; v_mov jsonb;
begin
  select * into m from finance.banco_movimentos where id = p_movimento_id;
  if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
  v_nat := case when m.valor < 0 then 'P' else 'R' end;
  v_rest := finance.conc_restante(m.id);
  v_txt := upper(coalesce(m.memo, '') || ' ' || coalesce(m.nome, ''));
  v_dig := regexp_replace(coalesce(m.memo, '') || ' ' || coalesce(m.nome, ''), '\D', '', 'g');
  v_nome := finance.conc_texto(coalesce(m.memo, '') || ' ' || coalesce(m.nome, ''));
  v_q := nullif(trim(coalesce(p_q, '')), '');
  v_qdig := regexp_replace(coalesce(v_q, ''), '\D', '', 'g');
  -- valor digitado ("1.234,56", "1234.56", "1234")
  if v_q ~ '^\s*[0-9]+\.[0-9]{1,2}\s*$' then v_qval := v_q::numeric;
  elsif v_q ~ '^\s*(R\$)?\s*[0-9][0-9.]*(,[0-9]{1,2})?\s*$' then
    v_qval := replace(replace(regexp_replace(v_q, '[R$\s]', '', 'g'), '.', ''), ',', '.')::numeric;
  end if;
  v_mov := jsonb_build_object('id', m.id, 'empresa', m.empresa, 'cod_cc', m.cod_cc, 'data', m.data, 'valor', m.valor,
                              'memo', m.memo, 'nome', m.nome, 'natureza', v_nat, 'restante', v_rest,
                              'chave', finance.conc_chave(coalesce(m.memo, '') || ' ' || coalesce(m.nome, '')));

  select coalesce(jsonb_agg(jsonb_build_object('contraparte', a.contraparte, 'cnpj', a.cnpj, 'usos', a.usos)), '[]')
    into v_alias from finance.conciliacao_aliases a
   where a.natureza = v_nat and a.chave = finance.conc_chave(coalesce(m.memo, '') || ' ' || coalesce(m.nome, ''));

  if v_rest <= 0.004 and v_q is null and p_vmin is null and p_vmax is null and p_venc_de is null and p_venc_ate is null then
    return jsonb_build_object('movimento', v_mov, 'aliases', v_alias, 'candidatos', '[]'::jsonb, 'grupos', '[]'::jsonb);
  end if;

  -- títulos em aberto uma vez só (a fonte do Omie é pesada) e similaridade de nome por contraparte distinta
  drop table if exists pg_temp._conc_t;
  create temp table _conc_t on commit drop as
    select x.* from finance.conc_titulos_abertos(case when p_todas_empresas then null else m.empresa end, v_nat) x;
  drop table if exists pg_temp._conc_nm;
  create temp table _conc_nm on commit drop as
    select d.contraparte, d.razao,
           case when length(v_nome) >= 4 and length(coalesce(d.contraparte, '')) >= 3 then
             greatest(word_similarity(finance.conc_texto(d.contraparte), v_nome), word_similarity(v_nome, finance.conc_texto(d.contraparte)),
                      word_similarity(finance.conc_texto(coalesce(d.razao, '')), v_nome), word_similarity(v_nome, finance.conc_texto(coalesce(d.razao, ''))))
           else 0 end sim_memo,
           case when v_q is not null and length(v_q) >= 4 then
             greatest(word_similarity(finance.conc_texto(v_q), finance.conc_texto(d.contraparte)),
                      word_similarity(finance.conc_texto(v_q), finance.conc_texto(coalesce(d.razao, ''))))
           else 0 end sim_q
      from (select distinct contraparte, razao from _conc_t) d;

  with t as (
    select x.*, coalesce(nm.sim_memo, 0) sim_memo, coalesce(nm.sim_q, 0) sim_q
      from _conc_t x left join _conc_nm nm on nm.contraparte is not distinct from x.contraparte and nm.razao is not distinct from x.razao
  ), s as (
    select t.*, coalesce(t.previsao, t.vencimento) dref,
      -- valor
      case when abs(v_rest - t.saldo) < 0.005 then 50
           when abs(v_rest - t.valor) < 0.005 then 40
           when v_rest > 0 and abs(v_rest - t.saldo) <= least(greatest(0.50, t.saldo * 0.01), 50) then 25
           when v_rest > 0 and t.saldo > v_rest then 5 else 0 end as p_valor,
      -- data
      case when coalesce(t.previsao, t.vencimento) is null then 0
           when abs(m.data - coalesce(t.previsao, t.vencimento)) <= 3 then 30
           when abs(m.data - coalesce(t.previsao, t.vencimento)) <= 10 then 15
           when abs(m.data - coalesce(t.previsao, t.vencimento)) <= 30 then 5 else 0 end as p_data,
      case when length(t.cnpj) >= 8 and position(left(t.cnpj, 8) in v_dig) > 0 then 25 else 0 end as p_cnpj,
      case when t.sim_memo >= 0.55 then 20 else 0 end as p_nome,
      case when (length(ltrim(regexp_replace(coalesce(t.nf, ''), '\D', '', 'g'), '0')) >= 3
                  and v_txt ~ ('(^|\D)0*' || ltrim(regexp_replace(t.nf, '\D', '', 'g'), '0') || '(\D|$)'))
             or (length(regexp_replace(coalesce(t.pedido, ''), '\D', '', 'g')) >= 3
                  and v_txt ~ ('(^|\D)' || regexp_replace(t.pedido, '\D', '', 'g') || '(\D|$)'))
             or (length(ltrim(regexp_replace(coalesce(t.num_titulo, ''), '\D', '', 'g'), '0')) >= 4
                  and v_txt ~ ('(^|\D)0*' || ltrim(regexp_replace(t.num_titulo, '\D', '', 'g'), '0') || '(\D|$)'))
           then 25 else 0 end as p_doc,
      case when length(regexp_replace(coalesce(t.boleto, ''), '\D', '', 'g')) >= 6
                and position(regexp_replace(t.boleto, '\D', '', 'g') in v_dig) > 0 then 30 else 0 end as p_boleto,
      case when exists (select 1 from jsonb_array_elements(v_alias) a
                         where (length(t.cnpj) >= 8 and a->>'cnpj' = t.cnpj) or upper(a->>'contraparte') = upper(t.contraparte))
           then 30 else 0 end as p_alias
      from t
     where (p_vmin is null or t.saldo >= p_vmin) and (p_vmax is null or t.saldo <= p_vmax)
       and (p_venc_de is null or coalesce(t.previsao, t.vencimento) >= p_venc_de)
       and (p_venc_ate is null or coalesce(t.previsao, t.vencimento) <= p_venc_ate)
       and (v_q is null
            or (v_qval is not null and (abs(t.saldo - v_qval) < 0.005 or abs(t.valor - v_qval) < 0.005))
            or t.contraparte ilike '%' || v_q || '%'
            or t.razao ilike '%' || v_q || '%'
            or t.sim_q >= 0.6
            or (length(v_qdig) >= 3 and (position(v_qdig in t.cnpj) > 0
                 or regexp_replace(coalesce(t.nf, ''), '\D', '', 'g') = v_qdig
                 or ltrim(regexp_replace(coalesce(t.nf, ''), '\D', '', 'g'), '0') = ltrim(v_qdig, '0')
                 or regexp_replace(coalesce(t.pedido, ''), '\D', '', 'g') = v_qdig
                 or ltrim(regexp_replace(coalesce(t.num_titulo, ''), '\D', '', 'g'), '0') = ltrim(v_qdig, '0')
                 or position(v_qdig in regexp_replace(coalesce(t.documento, ''), '\D', '', 'g')) > 0
                 or position(v_qdig in regexp_replace(coalesce(t.boleto, ''), '\D', '', 'g')) > 0))
            or t.documento ilike '%' || v_q || '%')
  ), sc as (
    select s.*, s.p_valor + s.p_data + s.p_cnpj + s.p_nome + s.p_doc + s.p_boleto + s.p_alias as score
      from s
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'ref', ref, 'natureza', natureza, 'empresa', empresa, 'origem', origem, 'contraparte', contraparte, 'razao', razao, 'cnpj', cnpj,
           'documento', documento, 'nf', nf, 'pedido', pedido, 'vencimento', vencimento, 'previsao', previsao,
           'valor', valor, 'saldo', saldo, 'fase', fase, 'score', score,
           'motivos', (select coalesce(jsonb_agg(x), '[]') from unnest(array[
              case when p_valor = 50 then 'valor exato' when p_valor = 40 then 'valor do título'
                   when p_valor = 25 then 'valor próximo (dif. ' || to_char(saldo - v_rest, 'FM999G990D00') || ')'
                   when p_valor = 5 then 'quita em parte' end,
              case when p_data > 0 then 'vence ' || to_char(dref, 'DD/MM') || ' (' ||
                   case when dref = m.data then 'mesmo dia' else (case when dref > m.data then '+' else '−' end) || abs(dref - m.data) || 'd' end || ')' end,
              case when p_cnpj > 0 then 'CNPJ no histórico' end,
              case when p_nome > 0 then 'nome no histórico' end,
              case when p_doc > 0 then 'nº do documento no histórico' end,
              case when p_boleto > 0 then 'nosso número' end,
              case when p_alias > 0 then 'aprendido' end]) x where x is not null))
           order by score desc, abs(saldo - v_rest), dref nulls last), '[]')
    into v_cands
    from (select * from sc
           where (v_rest > 0 or v_q is not null) and (v_q is not null or p_vmin is not null or p_vmax is not null or p_venc_de is not null or p_venc_ate is not null
              or (score >= 40 and (p_valor >= 25 or p_cnpj > 0 or p_nome > 0 or p_doc > 0 or p_boleto > 0 or p_alias > 0)))
           order by score desc, abs(saldo - v_rest) limit greatest(5, least(coalesce(p_lim, 40), 200))) z;

  -- Grupos: parcelas do mesmo documento ou do mesmo cliente/fornecedor cuja soma = restante.
  with t as (select x.* from _conc_t x), g as (
    select chave, rotulo, max(contraparte) contraparte, max(cnpj) cnpj, count(*) n, sum(saldo) soma,
           min(coalesce(previsao, vencimento)) dmin,
           jsonb_agg(jsonb_build_object('ref', ref, 'saldo', saldo, 'documento', documento, 'vencimento', vencimento, 'contraparte', contraparte)
                     order by coalesce(previsao, vencimento) nulls last) itens
      from (
        select t.*, 'doc:' || coalesce(nullif(t.cnpj, ''), t.contraparte, '') || '|' || coalesce(t.nf, t.pedido, split_part(t.documento, ' · ', 1)) chave,
               coalesce(t.nf, t.pedido, split_part(t.documento, ' · ', 1)) rotulo
          from t where coalesce(t.nf, t.pedido, nullif(split_part(t.documento, ' · ', 1), '')) is not null
        union all
        select t.*, 'cp:' || coalesce(nullif(t.cnpj, ''), t.contraparte), null from t
         where coalesce(nullif(t.cnpj, ''), t.contraparte) is not null
      ) z
     group by chave, rotulo having v_rest > 0 and count(*) between 2 and 15 and abs(sum(saldo) - v_rest) <= 0.01
  )
  select coalesce(jsonb_agg(jsonb_build_object('grupo', true, 'chave', chave,
           'contraparte', contraparte, 'cnpj', cnpj, 'n', n, 'soma', soma, 'vencimento', dmin,
           'rotulo', case when chave like 'doc:%' then coalesce(rotulo, '') || ' · ' || n || ' parcelas' else n || ' títulos em aberto' end,
           'motivos', jsonb_build_array('soma exata (' || n || ')') ||
              case when length(cnpj) >= 8 and position(left(cnpj, 8) in v_dig) > 0 then '["CNPJ no histórico"]'::jsonb else '[]' end ||
              case when exists (select 1 from _conc_nm nm where nm.contraparte = g2.contraparte and nm.sim_memo >= 0.55) then '["nome no histórico"]'::jsonb else '[]' end,
           'itens', itens) order by (chave like 'doc:%') desc, abs(dmin - m.data) nulls last), '[]')
    into v_grupos from (select * from g order by (chave like 'doc:%') desc, abs(dmin - m.data) nulls last limit 8) g2;

  return jsonb_build_object('movimento', v_mov, 'aliases', v_alias, 'candidatos', v_cands, 'grupos', v_grupos);
end $$;
revoke all on function finance.conciliacao_candidatos(bigint, text, numeric, numeric, date, date, boolean, int) from public, anon, authenticated;
grant execute on function finance.conciliacao_candidatos(bigint, text, numeric, numeric, date, date, boolean, int) to service_role;

-- Conciliar por referência. Itens: [{ref:'o:..'|'p:..'|'r:..', valor, desconto?, juros?, multa?, obs?}]
-- valor = quanto abate do título; dinheiro = valor − desconto + juros + multa.
create or replace function finance.conciliar_casar(p_movimento_id bigint, p_itens jsonb, p_aprender boolean, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'finance', 'public' as $$
declare m finance.banco_movimentos; v_nat char(1); v_rest numeric; v_cash numeric := 0; i jsonb; v_ref text;
        v_p jsonb := '[]'; v_r jsonb := '[]'; v_t0 timestamptz := now(); v_n int := 0; v_cp text; v_cnpj text; v_chave text;
begin
  select * into m from finance.banco_movimentos where id = p_movimento_id for update;
  if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
  if m.ignorado then raise exception 'Movimento está ignorado — reative antes'; end if;
  if m.conciliado_omie then raise exception 'Movimento já foi baixado no Omie — não recebe nova baixa'; end if;
  v_nat := case when m.valor < 0 then 'P' else 'R' end;
  v_rest := finance.conc_restante(m.id);
  if jsonb_array_length(coalesce(p_itens, '[]')) = 0 then raise exception 'Escolha ao menos um título'; end if;
  for i in select * from jsonb_array_elements(p_itens) loop
    v_ref := i->>'ref';
    if v_ref is null or v_ref !~ '^[opr]:' then raise exception 'Referência inválida: %', v_ref; end if;
    if (v_nat = 'P' and v_ref like 'r:%') or (v_nat = 'R' and v_ref not like 'r:%') then
      raise exception 'Movimento de % não casa com título a %', case when v_nat = 'P' then 'saída' else 'entrada' end,
        case when v_nat = 'P' then 'receber' else 'pagar' end;
    end if;
    v_cash := v_cash + round((i->>'valor')::numeric, 2) - coalesce((i->>'desconto')::numeric, 0)
              + coalesce((i->>'juros')::numeric, 0) + coalesce((i->>'multa')::numeric, 0);
  end loop;
  if v_cash <= 0 then raise exception 'Nada para conciliar'; end if;
  if v_cash > v_rest + 0.004 then
    raise exception 'Total (R$ %) passa o que falta casar no movimento (R$ %)', v_cash, v_rest;
  end if;

  select x.contraparte, x.cnpj into v_cp, v_cnpj
    from finance.conc_titulos_abertos(m.empresa, v_nat) x where x.ref = p_itens->0->>'ref' limit 1;

  if v_nat = 'P' then
    for i in select * from jsonb_array_elements(p_itens) loop
      v_p := v_p || jsonb_build_object('ref', i->>'ref', 'valor', round((i->>'valor')::numeric, 2),
                     'desconto', coalesce((i->>'desconto')::numeric, 0), 'juros', coalesce((i->>'juros')::numeric, 0),
                     'multa', coalesce((i->>'multa')::numeric, 0), 'cod_cc', m.cod_cc, 'forcar', true,
                     'obs', coalesce(nullif(i->>'obs', ''), 'Conciliação OFX'));
    end loop;
    -- sem p_movimento_id: a validação do Pagar v3 soma só o "valor" (não o dinheiro); validamos acima e ligamos depois
    perform finance.pagar_v3_baixar(v_p, m.data, 'OFX: ' || coalesce(m.memo, m.nome, m.fitid), p_usuario, false, null);
    update finance.baixas set movimento_id = m.id, origem = 'conciliacao'
     where movimento_id is null and natureza = 'P' and criado_por = p_usuario and criado_em = v_t0;
    get diagnostics v_n = row_count;
    insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
    values (p_usuario, 'conciliar', 'movimento', m.id::text, jsonb_build_object('itens', p_itens, 'valor', m.valor, 'via', 'casar'));
  else
    for i in select * from jsonb_array_elements(p_itens) loop
      v_r := v_r || jsonb_build_object('id', substr(i->>'ref', 3), 'valor', round((i->>'valor')::numeric, 2),
                     'desconto', coalesce((i->>'desconto')::numeric, 0), 'juros', coalesce((i->>'juros')::numeric, 0),
                     'multa', coalesce((i->>'multa')::numeric, 0), 'obs', coalesce(nullif(i->>'obs', ''), 'Conciliação OFX'));
    end loop;
    perform finance.receber_v1_baixar(v_r, m.data, null, p_usuario, false, m.id);
    v_n := jsonb_array_length(v_r);
  end if;

  -- aprender: trecho do histórico → contraparte/CNPJ do 1º título (capturados antes da baixa)
  if coalesce(p_aprender, true) then
    v_chave := finance.conc_chave(coalesce(m.memo, '') || ' ' || coalesce(m.nome, ''));
    if v_chave is not null and length(v_chave) >= 4 and v_cp is not null then
      insert into finance.conciliacao_aliases (chave, natureza, empresa, cnpj, contraparte, criado_por)
      values (v_chave, v_nat, m.empresa, nullif(v_cnpj, ''), v_cp, p_usuario)
      on conflict (chave, natureza, contraparte) do update
        set usos = finance.conciliacao_aliases.usos + 1, ultimo_uso = now(),
            cnpj = coalesce(finance.conciliacao_aliases.cnpj, excluded.cnpj);
    end if;
  end if;
  return jsonb_build_object('ok', true, 'baixas', v_n, 'restante', finance.conc_restante(m.id));
end $$;
revoke all on function finance.conciliar_casar(bigint, jsonb, boolean, text) from public, anon, authenticated;
grant execute on function finance.conciliar_casar(bigint, jsonb, boolean, text) to service_role;

-- Transferência entre contas: candidatos e marcação.
create or replace function finance.transferencia_candidatos(p_movimento_id bigint) returns jsonb
language sql stable security definer set search_path to 'finance', 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'empresa', o.empresa, 'cod_cc', o.cod_cc, 'data', o.data, 'valor', o.valor,
           'memo', coalesce(o.memo, o.nome),
           'conta', (select c.descricao from finance.contas_correntes c where c.empresa = o.empresa and c.cod_cc = o.cod_cc limit 1))
           order by abs(o.data - m.data), o.id), '[]')
    from finance.banco_movimentos m
    join finance.banco_movimentos o on o.id <> m.id and o.cod_cc <> m.cod_cc
         and abs(o.valor + m.valor) < 0.005 and abs(o.data - m.data) <= 3
         and not o.ignorado and not o.conciliado_omie
         and not exists (select 1 from finance.baixas b where b.movimento_id = o.id and b.estornado_em is null)
   where m.id = p_movimento_id
$$;
grant execute on function finance.transferencia_candidatos(bigint) to service_role;

create or replace function finance.transferencia_marcar(p_movimento_id bigint, p_par bigint, p_usuario text) returns jsonb
language plpgsql security definer set search_path to 'finance', 'public' as $$
declare a finance.banco_movimentos; b finance.banco_movimentos;
begin
  select * into a from finance.banco_movimentos where id = p_movimento_id for update;
  if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
  if p_par is not null then
    select * into b from finance.banco_movimentos where id = p_par for update;
    if not found then raise exception 'Movimento par % não encontrado', p_par; end if;
    if abs(a.valor + b.valor) > 0.005 then raise exception 'Os valores não se compensam (% e %)', a.valor, b.valor; end if;
  end if;
  if exists (select 1 from finance.baixas x where x.movimento_id in (a.id, coalesce(p_par, -1)) and x.estornado_em is null) then
    raise exception 'Movimento já tem baixa — desfaça a conciliação antes';
  end if;
  update finance.banco_movimentos set ignorado = true, ignorado_em = now(), ignorado_por = p_usuario, transferencia_par = p_par,
         ignorado_motivo = 'Transferência entre contas' || coalesce(' ↔ mov #' || p_par, ' (par não importado)')
   where id = a.id;
  if p_par is not null then
    update finance.banco_movimentos set ignorado = true, ignorado_em = now(), ignorado_por = p_usuario, transferencia_par = a.id,
           ignorado_motivo = 'Transferência entre contas ↔ mov #' || a.id
     where id = p_par;
  end if;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'transferencia', 'movimento', a.id::text, jsonb_build_object('par', p_par, 'valor', a.valor));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function finance.transferencia_marcar(bigint, bigint, text) to service_role;

-- Reativar desfaz também o par da transferência.
create or replace function finance.transferencia_desfazer(p_movimento_id bigint, p_usuario text) returns jsonb
language plpgsql security definer set search_path to 'finance', 'public' as $$
declare v_par bigint;
begin
  select transferencia_par into v_par from finance.banco_movimentos where id = p_movimento_id;
  update finance.banco_movimentos set ignorado = false, ignorado_motivo = null, ignorado_por = null, ignorado_em = null, transferencia_par = null
   where id in (p_movimento_id, coalesce(v_par, -1));
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'transferencia_desfazer', 'movimento', p_movimento_id::text, jsonb_build_object('par', v_par));
  return jsonb_build_object('ok', true);
end $$;
grant execute on function finance.transferencia_desfazer(bigint, text) to service_role;

-- Criar título a partir do movimento, com fornecedor/cliente do cadastro, e conciliar.
create or replace function finance.movimento_lancar_pessoa(p_movimento_id bigint, p_categoria text, p_descricao text,
                                                           p_pessoa_codigo text, p_usuario text) returns jsonb
language plpgsql security definer set search_path to 'finance', 'public' as $$
declare r jsonb; m finance.banco_movimentos; pp record;
begin
  select * into m from finance.banco_movimentos where id = p_movimento_id;
  r := finance.movimento_lancar(p_movimento_id, p_categoria, p_descricao, p_usuario);
  if nullif(trim(coalesce(p_pessoa_codigo, '')), '') is not null then
    select p.codigo, coalesce(nullif(p.nome_fantasia, ''), p.razao_social) nome,
           regexp_replace(coalesce(p.cnpj_cpf, p.doc, ''), '\D', '', 'g') doc, p.codigo_omie
      into pp from cadastros.pessoas p
     where p.codigo::text = p_pessoa_codigo and p.mesclado_em is null
     order by (p.empresa = m.empresa) desc limit 1;
    if found then
      if m.valor < 0 then
        update finance.pagar_previsto set fornecedor_cod = pp.codigo, fornecedor_nome = pp.nome, fornecedor_cnpj = nullif(pp.doc, '')
         where id = (r->>'titulo')::bigint;
        update finance.baixas set contraparte = pp.nome where movimento_id = m.id and pagar_id = (r->>'titulo')::bigint;
      else
        update finance.receber set cliente_razao = pp.nome, cliente_cnpj = nullif(pp.doc, ''),
               codigo_cliente_omie = coalesce(pp.codigo_omie, pp.codigo)
         where id = (r->>'titulo')::uuid;
        update finance.baixas set contraparte = pp.nome where movimento_id = m.id and receber_id = (r->>'titulo')::uuid;
      end if;
    end if;
  end if;
  return r;
end $$;
grant execute on function finance.movimento_lancar_pessoa(bigint, text, text, text, text) to service_role;

-- conciliacao_painel: "casado" passa a ser o dinheiro (valor − desconto + juros + multa) e expõe transferencia_par.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('finance.conciliacao_painel(text,bigint,date,date)'::regprocedure);
  n := replace(d,
    'coalesce((select sum(b.valor) from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), 0) as casado',
    'coalesce((select sum(b.valor - coalesce(b.desconto, 0) + coalesce(b.juros, 0) + coalesce(b.multa, 0)) from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null), 0) as casado');
  n := replace(n, '''origem'', m.origem, ''auto'', m.auto,', '''origem'', m.origem, ''auto'', m.auto, ''transferencia_par'', m.transferencia_par,');
  if n <> d then execute n; end if;
end $$;

-- (p73_conc_casar_9/10) movimento já baixado no Omie ou ignorado: restante 0, sem sugestões, e o painel avisa.
do $$
declare d text; n text;
begin
  d := pg_get_functiondef('finance.conciliacao_candidatos(bigint,text,numeric,numeric,date,date,boolean,integer)'::regprocedure);
  n := replace(d, '  v_rest := finance.conc_restante(m.id);',
                  '  v_rest := finance.conc_restante(m.id);
  if m.conciliado_omie or m.ignorado then v_rest := 0; end if;');
  n := replace(n, '''memo'', m.memo, ''nome'', m.nome, ''natureza'', v_nat, ''restante'', v_rest,',
                  '''memo'', m.memo, ''nome'', m.nome, ''natureza'', v_nat, ''restante'', v_rest, ''omie'', m.conciliado_omie, ''ignorado'', m.ignorado, ''ignorado_motivo'', m.ignorado_motivo,');
  if n <> d then execute n; end if;
end $$;

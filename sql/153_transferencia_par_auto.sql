-- 09/10/26 — Transferência C6 → Bradesco de R$ 14.950 não conciliava: o lado do C6 foi marcado
-- "Transferência entre contas próprias" sem par (botão rápido), e a busca do outro lado descartava
-- qualquer movimento já ignorado — o Bradesco dizia "Nenhum movimento oposto".
-- 1) candidatos passam a incluir o lado oposto marcado como transferência SEM par;
-- 2) marcar transferência (botão rápido, pagar/receber/conciliação) liga sozinho ao outro lado
--    quando há exatamente um candidato; 3) desfazer um lado deixa o outro como "sem par".
create or replace function finance.transferencia_candidatos(p_movimento_id bigint)
returns jsonb language sql stable security definer set search_path to 'finance', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'empresa', o.empresa, 'cod_cc', o.cod_cc, 'data', o.data, 'valor', o.valor,
           'memo', coalesce(o.memo, o.nome), 'ja_marcado', o.ignorado,
           'conta', (select c.descricao from finance.contas_correntes c where c.empresa = o.empresa and c.cod_cc = o.cod_cc limit 1))
           order by o.ignorado desc, abs(o.data - m.data), o.id), '[]')
    from finance.banco_movimentos m
    join finance.banco_movimentos o on o.id <> m.id and o.cod_cc <> m.cod_cc
         and abs(o.valor + m.valor) < 0.005 and abs(o.data - m.data) <= 3
         and (not o.ignorado or (o.transferencia_par is null and o.ignorado_motivo ilike 'transfer%'))
         and not o.conciliado_omie
         and not exists (select 1 from finance.baixas b where b.movimento_id = o.id and b.estornado_em is null)
   where m.id = p_movimento_id
$function$;

create or replace function finance.movimento_ignorar(p_movimento_id bigint, p_ignorar boolean, p_motivo text, p_usuario text)
returns jsonb language plpgsql security definer set search_path to 'finance', 'public' as $function$
declare cands jsonb; par bigint; antigo bigint;
begin
  if p_ignorar and exists (select 1 from finance.baixas where movimento_id = p_movimento_id and estornado_em is null) then
    raise exception 'Movimento já conciliado — desfaça antes de ignorar';
  end if;
  if p_ignorar and coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo (ex.: tarifa, transferência entre contas)'; end if;
  -- Transferência entre contas: com um único lado oposto possível, liga os dois.
  if p_ignorar and trim(p_motivo) ilike 'transfer%' then
    cands := finance.transferencia_candidatos(p_movimento_id);
    if jsonb_array_length(cands) = 1 then
      par := (cands->0->>'id')::bigint;
      perform finance.transferencia_marcar(p_movimento_id, par, p_usuario);
      return jsonb_build_object('ok', true, 'par', par);
    end if;
  end if;
  select transferencia_par into antigo from finance.banco_movimentos where id = p_movimento_id;
  update finance.banco_movimentos set ignorado = p_ignorar,
         ignorado_motivo = case when p_ignorar then trim(p_motivo) end,
         ignorado_por = case when p_ignorar then p_usuario end,
         ignorado_em = case when p_ignorar then now() end,
         transferencia_par = case when p_ignorar then transferencia_par end
   where id = p_movimento_id;
  if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
  -- desfez um lado de uma transferência ligada: o outro continua transferência, agora sem par
  if not p_ignorar and antigo is not null then
    update finance.banco_movimentos set transferencia_par = null,
           ignorado_motivo = 'Transferência entre contas (par desfeito)'
     where id = antigo and transferencia_par = p_movimento_id;
  end if;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, case when p_ignorar then 'ignorar' else 'reativar' end, 'movimento', p_movimento_id::text,
          jsonb_build_object('motivo', p_motivo));
  return jsonb_build_object('ok', true);
end $function$;

-- 07/10/26 (Benny): título de R$ 400 pago com atraso por R$ 440,13. Ao casar,
-- a diferença tem de virar juros e o movimento fechar. Para movimentos que já
-- ficaram parciais (resto pendente), esta função lança o resto como juros na
-- última baixa do movimento — desde que ainda não tenha ido para o Omie.
create or replace function finance.conciliar_resto_juros(p_movimento_id bigint, p_usuario text)
returns jsonb
language plpgsql security definer set search_path to 'finance', 'public'
as $$
declare v_rest numeric; b finance.baixas;
begin
  perform 1 from finance.banco_movimentos where id = p_movimento_id for update;
  if not found then raise exception 'Movimento % não encontrado', p_movimento_id; end if;
  v_rest := finance.conc_restante(p_movimento_id);
  if v_rest <= 0.004 then raise exception 'Nada a lançar — o movimento já está casado'; end if;
  select * into b from finance.baixas
   where movimento_id = p_movimento_id and estornado_em is null
   order by criado_em desc, id desc limit 1;
  if not found then raise exception 'Este movimento ainda não tem título casado — use Casar…'; end if;
  if coalesce(b.omie_status, 'nao_enviado') <> 'nao_enviado' then
    raise exception 'A baixa de % já foi enviada ao Omie — estorne e case de novo com juros', b.contraparte;
  end if;
  update finance.baixas set juros = coalesce(juros, 0) + v_rest,
         observacao = concat_ws(' · ', observacao, 'juros/multa R$ ' || to_char(v_rest, 'FM999999990.00') || ' (diferença do extrato)')
   where id = b.id;
  insert into finance.financeiro_audit (usuario, acao, entidade, entidade_id, detalhe)
  values (p_usuario, 'conciliar_juros', 'movimento', p_movimento_id::text,
          jsonb_build_object('baixa_id', b.id, 'juros', v_rest, 'contraparte', b.contraparte));
  return jsonb_build_object('ok', true, 'baixa_id', b.id, 'juros', v_rest, 'contraparte', b.contraparte,
                            'restante', finance.conc_restante(p_movimento_id));
end $$;

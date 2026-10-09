-- 09/10/26 — Conta Omie.CASH: os movimentos vêm do próprio Omie JÁ baixados no título de lá
-- (banco_movimentos.conciliado_omie). A Conciliação completa já os contava como conciliados, mas a
-- aba "Conciliação OFX" do Pagar/Receber e o "N mov. a conciliar" do quadro Bancos não: mostravam
-- 141 pendentes, sugeriam casar (o servidor recusa: "já foi baixado no Omie… não recebe nova baixa")
-- e o botão parecia não fazer nada.
-- 1) movimentos da aba trazem conciliado_omie/omie_origem; 2) pendências ignoram os já baixados no Omie.
create or replace function finance.pagar_v3_movimentos(p_cod_cc bigint, p_de date)
returns jsonb language sql stable security definer set search_path to 'finance', 'public' as $function$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', m.id, 'empresa', m.empresa, 'data', m.data, 'valor', m.valor, 'memo', coalesce(m.memo, m.nome), 'arquivo', m.arquivo,
    'importado_em', m.importado_em, 'ignorado', m.ignorado, 'motivo', m.ignorado_motivo,
    'omie', m.conciliado_omie, 'omie_origem', m.omie_origem,
    'casado', coalesce(x.casado, 0), 'baixas', coalesce(x.baixas, '[]'::jsonb)) order by m.data desc, m.id), '[]'::jsonb)
    from finance.banco_movimentos m
    left join lateral (
      select sum(b.valor - b.desconto + b.juros + b.multa) casado,
             jsonb_agg(jsonb_build_object('id', b.id, 'contraparte', b.contraparte, 'empresa', b.empresa,
             'documento', b.documento, 'valor', b.valor, 'juros', b.juros + b.multa, 'ref',
             case when b.cod_titulo is not null then 'o:' || b.cod_titulo when b.pagar_id is not null then 'p:' || b.pagar_id
                  when b.receber_id is not null then 'r:' || b.receber_id end)) baixas
        from finance.baixas b where b.movimento_id = m.id and b.estornado_em is null) x on true
   where m.cod_cc = p_cod_cc and m.data >= p_de
$function$;

do $$
declare f text; d text; n0 int;
begin
  foreach f in array array['finance.pagar_v3_dados(date)', 'finance.receber_v1_dados(date)'] loop
    d := pg_get_functiondef(f::regprocedure); n0 := length(d);
    d := replace(d, 'count(*) filter (where not m.ignorado and m.valor', 'count(*) filter (where not m.ignorado and not m.conciliado_omie and m.valor');
    if length(d) = n0 then raise exception 'nada trocado em %', f; end if;
    execute d;
  end loop;
end $$;

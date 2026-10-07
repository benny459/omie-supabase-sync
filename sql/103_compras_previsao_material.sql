-- 103 · Previsão de entrega do material com uma só fonte: o PC (07/10/26).
--
-- Pedido do Benny: a "Prev. material" da Operação › Projetos, a previsão do PC no
-- Compras e a da Lista de materiais têm de ser a mesma data, editável dos dois lados.
-- • PC nascido no painel (origem 'painel'): a data é compras.pedidos.previsao. Editar na
--   Operação grava aqui (esta função) — e o Compras/Lista já leem este campo.
-- • PC importado do Omie: a previsão do Omie fica intocada (nada vai ao Omie); a remarcação
--   continua no campo "Nova prev. materiais" da aprovação (approvals.custom_fields.s4b87bk9),
--   que o Compras passa a mostrar ao lado da previsão do Omie.
-- Histórico em compras.historico. Migração p103_compras_previsao_material — aplicar após o OK.

create or replace function orders.compras_previsao_salvar(p_empresa text, p_numero text, p_previsao date, p_por text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_id bigint; v_origem text; v_antes date;
begin
  select p.id, p.origem, p.previsao into v_id, v_origem, v_antes
    from compras.pedidos p
   where p.empresa = upper(p_empresa) and p.numero = p_numero and p.tipo = 'PC' and not p.cancelado
   order by (p.origem = 'painel') desc, p.id desc limit 1;
  if v_id is null then return jsonb_build_object('ok', false, 'motivo', 'PC não encontrado'); end if;
  if v_origem <> 'painel' then return jsonb_build_object('ok', false, 'id', v_id, 'motivo', 'PC do Omie: vale a remarcação'); end if;
  if v_antes is not distinct from p_previsao then return jsonb_build_object('ok', true, 'id', v_id, 'igual', true); end if;
  update compras.pedidos set previsao = p_previsao, updated_at = now(), updated_by = p_por where id = v_id;
  insert into compras.historico (pedido_id, texto, por)
  values (v_id, format('Previsão de entrega: %s → %s (Operação › Projetos)',
                       coalesce(to_char(v_antes, 'DD/MM/YY'), '—'), coalesce(to_char(p_previsao, 'DD/MM/YY'), '—')), p_por);
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function orders.compras_previsao_salvar(text, text, date, text) from public, anon, authenticated;
grant execute on function orders.compras_previsao_salvar(text, text, date, text) to service_role;

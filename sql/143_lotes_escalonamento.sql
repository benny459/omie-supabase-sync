-- 08/10/26 — Agente de compras: memória do escalonamento de lotes PROPOSTOS (spec F).
--
-- Lote proposto não fica no banco (sql/129) — então o cron não tinha onde anotar que já
-- escalou, e só escalava no dia exato base = hoje − 2 (lote que já aparecia mais atrasado
-- nunca era escalado). Agora: proposto atrasado há ≥ 2 dias sem ação escala ao admin UMA vez;
-- depois, no máximo um lembrete por semana (lib/planejamento-compras decidirEscalonamento).
--
-- A anotação usa a própria compras.lote_planejado: uma linha-marcador status='proposto'
-- por (empresa, projeto, fornecedor_norm, data_base) com ultimo_aviso = 'escalado:AAAA-MM-DD'.
-- lotes_listar e lotes_do_dia continuam ignorando 'proposto' (nada muda na tela nem no cron
-- de geração). Enquanto esta migração não roda, o cron usa a regra sem estado (2º dia de
-- atraso e de 7 em 7 dias).

create unique index if not exists lote_planejado_marcador_proposto
  on compras.lote_planejado (empresa, codigo_projeto, coalesce(fornecedor_norm, ''), data_base)
  where status = 'proposto';

-- Marcadores dos últimos 120 dias (o cron casa pelo fornecedor_norm + data_base do lote).
create or replace function orders.lotes_escalonamentos()
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('empresa', l.empresa, 'codigo_projeto', l.codigo_projeto,
           'fornecedor_norm', coalesce(l.fornecedor_norm, ''), 'data_base', l.data_base, 'ultimo_aviso', l.ultimo_aviso)), '[]'::jsonb)
    from compras.lote_planejado l
   where l.status = 'proposto' and l.data_base > current_date - 120
$$;
revoke all on function orders.lotes_escalonamentos() from public, anon, authenticated;
grant execute on function orders.lotes_escalonamentos() to service_role;

-- Anota o aviso: { empresa, codigo_projeto, fornecedor, data_base, aviso }
create or replace function orders.lotes_escalonar(p jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_emp  text := coalesce(p->>'empresa', 'SF');
  v_proj bigint := (p->>'codigo_projeto')::bigint;
  v_norm text := nullif(approval._norm_item(p->>'fornecedor'), '');
  v_base date := (p->>'data_base')::date;
  v_id   uuid;
begin
  if v_proj is null or v_base is null then raise exception 'projeto e data_base obrigatórios'; end if;
  update compras.lote_planejado set ultimo_aviso = p->>'aviso', atualizado_em = now()
   where status = 'proposto' and empresa = v_emp and codigo_projeto = v_proj
     and coalesce(fornecedor_norm, '') = coalesce(v_norm, '') and data_base = v_base
  returning id into v_id;
  if v_id is null then
    insert into compras.lote_planejado (empresa, codigo_projeto, fornecedor_norm, fornecedor, data_base, data_pedir, status, ultimo_aviso, criado_por)
    values (v_emp, v_proj, v_norm, nullif(p->>'fornecedor', ''), v_base, v_base, 'proposto', p->>'aviso', 'agente')
    returning id into v_id;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id);
end $$;
revoke all on function orders.lotes_escalonar(jsonb) from public, anon, authenticated;
grant execute on function orders.lotes_escalonar(jsonb) to service_role;

notify pgrst, 'reload schema';

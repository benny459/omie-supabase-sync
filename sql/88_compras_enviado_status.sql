-- 06/10/26 — status "✉ Enviado" do pedido de compra: a lista passa a devolver
-- enviadoPor (tooltip do chip) e o histórico distingue o envio em modo teste.
do $$
declare d text := pg_get_functiondef('orders.compras_lista'::regproc);
begin
  if position('''enviadoPor''' in d) = 0 then
    d := replace(d, '''enviadoMeio'', b.enviado_meio,', '''enviadoMeio'', b.enviado_meio, ''enviadoPor'', b.enviado_por,');
    execute d;
  end if;
end $$;

create or replace function orders.compras_marcar_enviado(p_id bigint, p_para text, p_meio text, p_por text)
 returns jsonb language plpgsql security definer set search_path to 'compras', 'public' as $function$
declare v compras.pedidos;
begin
  select * into v from compras.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  if v.tipo <> 'PC' then raise exception 'Só pedido de compra é enviado ao fornecedor'; end if;
  if v.aprov_status <> 'aprovado' then raise exception 'Pedido ainda não aprovado — só pedido aprovado vai ao fornecedor'; end if;
  update compras.pedidos set enviado_em = now(), enviado_por = p_por, enviado_para = nullif(p_para, ''), enviado_meio = p_meio,
         updated_at = now(), updated_by = p_por where id = p_id;
  perform compras.add_hist(p_id, 'Enviado ao fornecedor' || case p_meio when 'email' then ' por e-mail' when 'email_teste' then ' por e-mail (TESTE)'
                                 when 'whatsapp' then ' por WhatsApp' else '' end
                                 || coalesce(' para ' || nullif(p_para, ''), ''), p_por);
  return jsonb_build_object('id', p_id, 'etapa', v.etapa);
end $function$;

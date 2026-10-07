-- 07/10/26 (PC 7214): PC do Omie aprovado na Operação (approval.approvals,
-- ligado pelo nº do PC em pc_numero_manual) continuava "não solicitada" no
-- Compras — compras.pedidos.aprov_status era só a foto da importação e nada
-- copiava a aprovação depois. Resultado: "Pedido ainda não aprovado" ao
-- mandar para Conferido. 300 PCs nessa situação.
-- Gatilho: aprovação APROVADO → PC aprovado no Compras (pelo código do Omie
-- OU pelo nº do PC). Só sobe para aprovado; nunca rebaixa.

create or replace function compras.tg_aprovacao_para_pedido() returns trigger
language plpgsql security definer set search_path to 'compras', 'approval', 'public'
as $$
begin
  if new.status not in ('APROVADO', 'APROVADO_FAT_DIRETO') then return new; end if;
  update compras.pedidos p
     set aprov_status = 'aprovado',
         aprov_por = coalesce(new.aprovador_email, p.aprov_por, 'Operação'),
         aprov_em = coalesce(new.aprovado_em, now()),
         aprov_valor = coalesce(new.valor_aprovado, p.aprov_valor)
   where p.empresa = new.empresa and p.tipo = 'PC' and not coalesce(p.cancelado, false)
     and p.aprov_status <> 'aprovado'
     and ((new.ncod_ped > 0 and p.omie_ncod_ped = new.ncod_ped)
          or (nullif(trim(new.pc_numero_manual), '') is not null and p.numero = trim(new.pc_numero_manual)));
  return new;
end $$;

drop trigger if exists trg_aprovacao_para_pedido on approval.approvals;
create trigger trg_aprovacao_para_pedido
  after insert or update of status, pc_numero_manual, ncod_ped on approval.approvals
  for each row execute function compras.tg_aprovacao_para_pedido();

-- acerto do que já estava aprovado
update compras.pedidos p
   set aprov_status = 'aprovado',
       aprov_por = coalesce(a.aprovador_email, p.aprov_por, 'Operação'),
       aprov_em = coalesce(a.aprovado_em, a.updated_at, now()),
       aprov_valor = coalesce(a.valor_aprovado, p.aprov_valor)
  from approval.approvals a
 where a.empresa = p.empresa and a.status in ('APROVADO', 'APROVADO_FAT_DIRETO')
   and p.tipo = 'PC' and not coalesce(p.cancelado, false) and p.aprov_status <> 'aprovado'
   and ((a.ncod_ped > 0 and p.omie_ncod_ped = a.ncod_ped)
        or (nullif(trim(a.pc_numero_manual), '') is not null and p.numero = trim(a.pc_numero_manual)));

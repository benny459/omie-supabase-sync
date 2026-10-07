-- 07/10/26 (PV1934, RC 7320): ao digitar o PC 7320 nos 4 itens da venda, a
-- regra "cada PC numa só linha" (approval.check_pc_manual_unico_global) tratou
-- as outras linhas com o mesmo PC como "órfãs" e APAGOU 3 itens da RC.
-- 1) O mesmo PC vale para vários itens da MESMA venda (pv_os_label).
--    Linha com dados de RC nunca é apagada em silêncio — conflito real recusa.
-- 2) Devolve os 3 itens apagados (a auditoria guarda a linha inteira).
-- 3) rc_qtd vazio fazia a tela mostrar "1": preenche com total ÷ unitário.
-- 4) Descrições com &quot; / &amp; vindas do Excel viram " / &.

create or replace function approval.check_pc_manual_unico_global()
returns trigger language plpgsql
as $function$
declare
  conflict_ncod numeric; conflict_pv_os text; conflict_status text; conflict_aprovador text; conflict_tem_rc boolean;
begin
  if new.pc_numero_manual is null or new.pc_numero_manual = '' then return new; end if;

  select ncod_ped, pv_os_label, status::text, aprovador_email, (rc_descricao is not null or rc_numero is not null)
    into conflict_ncod, conflict_pv_os, conflict_status, conflict_aprovador, conflict_tem_rc
    from approval.approvals
   where empresa = new.empresa and pc_numero_manual = new.pc_numero_manual and ncod_ped <> new.ncod_ped
     -- mesma venda: um PC cobre vários itens da RC — não é conflito
     and upper(coalesce(pv_os_label, '')) is distinct from upper(coalesce(new.pv_os_label, ''))
   limit 1;

  if conflict_ncod is null then return new; end if;

  -- só é lixo de verdade a linha pendente, sem aprovador e SEM item de RC
  if conflict_ncod < 0 and coalesce(conflict_status, 'PENDENTE') = 'PENDENTE'
     and conflict_aprovador is null and not coalesce(conflict_tem_rc, false) then
    delete from approval.approvals
     where empresa = new.empresa and ncod_ped = conflict_ncod and pc_numero_manual = new.pc_numero_manual;
    raise notice 'PC % estava em linha órfã pendente (ncod_ped %) — auto-liberado.', new.pc_numero_manual, conflict_ncod;
    return new;
  end if;

  raise exception 'PC % já está atribuído a outra venda (PV/OS %, ncod_ped %, status %). Cada número de PC só pode aparecer em uma venda.',
    new.pc_numero_manual, coalesce(conflict_pv_os, '—'), conflict_ncod, coalesce(conflict_status, '?')
    using errcode = 'unique_violation';
end;
$function$;

-- 2) devolve os itens da RC 7320 apagados em 07/10/26 14:35
insert into approval.approvals
select (jsonb_populate_record(null::approval.approvals, a.diff)).*
  from approval.audit_log a
 where a.action = 'delete' and a.ncod_ped in (-12546051196, -12546051197, -12546051198)
   and a.created_at >= '2026-10-07 17:35:00+00' and a.created_at < '2026-10-07 17:36:00+00'
   and not exists (select 1 from approval.approvals x where x.empresa = a.empresa and x.ncod_ped = a.ncod_ped);

-- 3) quantidade da RC a partir do total
update approval.approvals
   set custom_fields = coalesce(custom_fields, '{}'::jsonb) || jsonb_build_object('rc_qtd', round(rc_custo_total / rc_custo, 3))
 where (custom_fields->>'rc_qtd') is null and rc_custo > 0 and rc_custo_total > 0;

-- 4) entidades HTML nas descrições
update approval.approvals
   set rc_descricao = replace(replace(replace(rc_descricao, '&quot;', '"'), '&amp;', '&'), '&apos;', '''')
 where rc_descricao ~ '&(quot|amp|apos);';

-- 5) aplicado à mão em 07/10/26: o mesmo defeito apagou em 06/10 17h00 itens de
--    PV1935/1936/1937/1938/1941, OS4829 e PV1970 (publicação das RCs gravava o PC
--    em cada item e a regra apagava os irmãos). 17 itens devolvidos da auditoria
--    (versão mais recente de cada item que faltava); depois os totais de RC de cada
--    venda bateram centavo a centavo com os itens dos PCs.

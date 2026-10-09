-- 09/10/26 — PC criado no Compras ligado a projeto PJ (ex.: PC 7391 PJ361, Inter Soldas)
-- não aparecia em Operação › Projetos para o Marcelo aprovar: as views só liam o espelho
-- do Omie. Mesma solução do sql/148 (Standalone): soma approval.v_pc_nativos, com a regra
-- de módulo de sempre (PJ → projetos, PV/OS → avulsos, 40_VS/41_VP → standby).
-- Acrescenta ao fim da definição atual (as colunas não mudam; as MVs continuam valendo).
do $$
declare
  v text; def text; filtro text;
begin
  foreach v in array array['v_pc_projetos', 'v_pc_avulsos', 'v_pc_standby'] loop
    def := rtrim(pg_get_viewdef(('approval.' || v)::regclass, true), E' \n;');
    continue when def like '%v_pc_nativos%';
    filtro := case v
      when 'v_pc_projetos' then 'modulo_calc = ''projetos'''
      when 'v_pc_standby'  then 'modulo_calc = ''standby'''
      else 'modulo_calc = ''avulsos'' and not exists (select 1 from platform.excluded_pv_os ex where ex.empresa = n.empresa and ex.pv_os_label = n.pv_os_label)'
    end;
    execute format('create or replace view approval.%I as %s union all select n.* from approval.v_pc_nativos n where %s', v, def, filtro);
  end loop;
end $$;

select sales.refresh_mv_pc_lists();

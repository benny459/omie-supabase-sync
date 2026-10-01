-- Refresh das listas da Operação SEM bloquear a leitura (01/10/2026).
--
-- Problema: sales.refresh_mv_pc_lists() (pg_cron a cada 10 min) fazia
-- REFRESH MATERIALIZED VIEW normal nas 5 MVs dentro de uma única transação,
-- ~46 s. REFRESH normal pega ACCESS EXCLUSIVE: quem abria Avulsos/Projetos/PCs
-- nessa janela esperava até estourar o statement_timeout ("mv_pc_avulsos:
-- canceling statement due to statement timeout"). Acontecia a cada 10 min.
--
-- Solução: índice único em cada MV da Operação e REFRESH ... CONCURRENTLY
-- (só ExclusiveLock — SELECT continua lendo a versão anterior). Se um dia a
-- chave deixar de ser única e o CONCURRENTLY falhar, cai no REFRESH normal:
-- a lista nunca para de atualizar por causa disso.

create unique index if not exists mv_pc_avulsos_uk  on sales.mv_pc_avulsos  (empresa, ncod_ped, pv_os_label);
create unique index if not exists mv_pc_projetos_uk on sales.mv_pc_projetos (empresa, ncod_ped, pv_os_label);
create unique index if not exists mv_pc_pcs_uk      on sales.mv_pc_pcs      (empresa, ncod_ped);

create or replace function sales.refresh_mv_pc_lists()
returns void
language plpgsql
as $function$
declare
  mv text;
begin
  foreach mv in array array['sales.mv_pc_pcs', 'sales.mv_pc_avulsos', 'sales.mv_pc_projetos'] loop
    begin
      execute format('refresh materialized view concurrently %s', mv);
    exception when others then
      raise warning 'refresh concurrently de % falhou (%), usando refresh normal', mv, sqlerrm;
      execute format('refresh materialized view %s', mv);
    end;
  end loop;
  refresh materialized view bi.mv_pcs_aprovados;
  refresh materialized view bi.mv_custo_por_cliente;
end;
$function$;

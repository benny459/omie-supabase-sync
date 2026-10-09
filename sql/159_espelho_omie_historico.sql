-- 09/10/26 (Benny: "Pode aplicar") — sem sync do Omie desde 02/10/26: o espelho
-- orders.pedidos_compra vira histórico.
--
--   1. trava o espelho: nenhum INSERT/UPDATE/DELETE/TRUNCATE, com UMA exceção —
--      compras.espelhar_omie() (editar no Compras um PC de origem Omie reescreve as
--      linhas dele no espelho, sob o GUC compras.espelho_painel=1). Por isso o
--      service_role NÃO perde o grant: quem barra é o gatilho de instrução.
--      Barra de propósito os importadores Omie→espelho que ainda existiam à mão
--      (botão "Buscar no Omie" em Configurações, sync_specific_pcs, compras_historico).
--   2. some das listas a cópia do espelho quando o mesmo PC existe nativo
--      (approval.v_pc_espelho_duplicado) — Standby, Projetos, PCs e Avulsos.
--      E v_pc_nativos deixa de esconder o PC do Compras quando o nº existe no espelho
--      (agora quem ganha é o nativo).
--   3. PC do espelho sem aprovação própria deixa de ser PENDENTE: vira N_A com
--      status_label "Histórico Omie". Exceção: incluídos a partir de 01/09/26
--      (feitos no Omie logo antes da virada, podem estar mesmo à espera) continuam PENDENTE.
--   4. refresca as listas (sales.refresh_mv_pc_lists).
--
-- Backup das definições substituídas: approval._view_backup_159 (+ sql/_backup_views_159.sql).
-- Contagens antes/depois: approval._counts_159.
-- Desfazer: ver o bloco no fim deste arquivo (ou sql/_backup_views_159.sql).
-- Aplicado em prod 09/10/26 em 5 partes (159a…159e: backup, contagem, trava, duplicados+listas, nativos+histórico).

-- ── 0. backup + contagem "antes" ───────────────────────────────────────────
create table if not exists approval._view_backup_159 (nome text primary key, def text not null, em timestamptz not null default now());
revoke all on approval._view_backup_159 from anon, authenticated;
insert into approval._view_backup_159 (nome, def)
select 'approval.' || v, pg_get_viewdef(('approval.' || v)::regclass, true)
  from unnest(array['v_pc_completo', 'v_pc_nativos', 'v_pc_standby', 'v_pc_projetos', 'v_pc_pcs', 'v_pc_avulsos']) v
on conflict (nome) do nothing;

create table if not exists approval._counts_159 (fase text, lista text, source text, status text, n bigint, valor numeric, em timestamptz default now());
revoke all on approval._counts_159 from anon, authenticated;
insert into approval._counts_159 (fase, lista, source, status, n, valor)
select 'antes', l, source, status, count(*), round(sum(valor_total)) from (
  select 'v_pc_completo' l, source, status, valor_total from approval.v_pc_completo
  union all select 'v_pc_standby', source, status, valor_total from approval.v_pc_standby
  union all select 'v_pc_projetos', source, status, valor_total from approval.v_pc_projetos
  union all select 'v_pc_pcs', source, status, valor_total from approval.v_pc_pcs
  union all select 'v_pc_avulsos', source, status, valor_total from approval.v_pc_avulsos
  union all select 'mv_pc_projetos', source, status, valor_total from sales.mv_pc_projetos
  union all select 'mv_pc_pcs', source, status, valor_total from sales.mv_pc_pcs
  union all select 'mv_pc_avulsos', source, status, valor_total from sales.mv_pc_avulsos) x
where not exists (select 1 from approval._counts_159 where fase = 'antes')
group by 1, 2, 3, 4;

-- ── 1. espelho só leitura ──────────────────────────────────────────────────
create or replace function orders.tg_espelho_somente_historico()
returns trigger language plpgsql as $$
begin
  -- única escrita viva: compras.espelhar_omie() (editar PC de origem Omie no Compras)
  if coalesce(current_setting('compras.espelho_painel', true), '') = '1' then
    return null;
  end if;
  raise exception 'orders.pedidos_compra é histórico (sem sync Omie desde 02/10/26)'
    using errcode = '42501',
          hint = 'PCs nascem no painel (compras.pedidos). Para destravar, remover o gatilho espelho_somente_historico de orders.pedidos_compra.';
end $$;

create or replace trigger espelho_somente_historico
  before insert or update or delete or truncate on orders.pedidos_compra
  for each statement execute function orders.tg_espelho_somente_historico();

-- anon/authenticated já não tinham INSERT/UPDATE/DELETE no espelho (só service_role, bi_readonly/waterworks_bi SELECT).

-- ── 2a. cópia do espelho com o mesmo PC nativo ────────────────────────────
-- Espelho sem aprovação própria (ou só com N_A) cujo nº existe nativo: aprovação
-- manual (ncod_ped < 0, pc_numero_manual) ou PC do Compras (origem painel).
create or replace view approval.v_pc_espelho_duplicado as
with e as (
  select o.empresa, o.ncod_ped, max(o.cnumero) as cnumero
    from orders.pedidos_compra o
   group by o.empresa, o.ncod_ped
)
select e.empresa, e.ncod_ped, e.cnumero,
       case when exists (select 1 from approval.approvals n
                          where n.empresa = e.empresa and n.ncod_ped < 0
                            and n.pc_numero_manual = ltrim(e.cnumero, '0'))
            then 'aprovacao_nativa' else 'compras_painel' end as motivo
  from e
 where not exists (select 1 from approval.approvals a
                    where a.empresa = e.empresa and a.ncod_ped = e.ncod_ped
                      and a.status is not null and a.status <> 'N_A')
   and (exists (select 1 from approval.approvals n
                 where n.empresa = e.empresa and n.ncod_ped < 0
                   and n.pc_numero_manual = ltrim(e.cnumero, '0'))
     or exists (select 1 from compras.pedidos p
                 where p.empresa = e.empresa and p.tipo = 'PC' and p.origem = 'painel'
                   and not p.cancelado and p.numero = ltrim(e.cnumero, '0')));
grant select on approval.v_pc_espelho_duplicado to authenticated, service_role, bi_readonly, waterworks_bi;

-- ── 2b. listas: esconde a cópia do espelho (ramo v_pc_completo_enriched) ──
do $$
declare
  v text; def text; novo text; ancora text; filtro text;
begin
  foreach v in array array['v_pc_standby', 'v_pc_projetos', 'v_pc_pcs', 'v_pc_avulsos'] loop
    def := rtrim(pg_get_viewdef(('approval.' || v)::regclass, true), E' \n;');
    continue when def like '%v_pc_espelho_duplicado%';
    if v = 'v_pc_avulsos' then
      ancora := E'ex.pv_os_label = e.pv_os_label))\nUNION ALL';
      filtro := E'ex.pv_os_label = e.pv_os_label)) AND NOT (EXISTS ( SELECT 1 FROM approval.v_pc_espelho_duplicado dd WHERE dd.empresa = e.empresa AND dd.ncod_ped = e.ncod_ped))\nUNION ALL';
    else
      ancora := format(E'WHERE v_pc_completo_enriched.modulo_calc = %L::text\nUNION ALL', replace(v, 'v_pc_', ''));
      filtro := format(E'WHERE v_pc_completo_enriched.modulo_calc = %L::text AND NOT (EXISTS ( SELECT 1 FROM approval.v_pc_espelho_duplicado dd WHERE dd.empresa = v_pc_completo_enriched.empresa AND dd.ncod_ped = v_pc_completo_enriched.ncod_ped))\nUNION ALL', replace(v, 'v_pc_', ''));
    end if;
    if (length(def) - length(replace(def, ancora, ''))) / length(ancora) <> 1 then
      raise exception '159: âncora não encontrada (ou repetida) em approval.%', v;
    end if;
    novo := replace(def, ancora, filtro);
    execute format('create or replace view approval.%I as %s', v, novo);
  end loop;
end $$;

-- ── 2c. v_pc_nativos: o nativo ganha do espelho ───────────────────────────
do $$
declare def text; ancora text := E' AND NOT (EXISTS ( SELECT 1\n           FROM orders.pedidos_compra o\n          WHERE o.empresa = p.empresa AND ltrim(o.cnumero, ''0''::text) = p.numero))';
begin
  def := rtrim(pg_get_viewdef('approval.v_pc_nativos'::regclass, true), E' \n;');
  if position(ancora in def) = 0 then
    if def like '%orders.pedidos_compra%' then raise exception '159: âncora do espelho não encontrada em v_pc_nativos'; end if;
    return;  -- já aplicado
  end if;
  execute 'create or replace view approval.v_pc_nativos as ' || replace(def, ancora, '');
end $$;

-- ── 3. v_pc_completo: espelho sem aprovação → N_A "Histórico Omie" ────────
do $$
declare
  def text; ini int; fim int; seg text; novo_seg text;
  a_status text := 'COALESCE(a.status, ''PENDENTE''::text) AS status,';
  n_status text := 'CASE WHEN a.status IS NOT NULL THEN a.status WHEN approval.try_parse_br_date(lbl.dt_inclusao) >= ''2026-09-01''::date THEN ''PENDENTE''::text ELSE ''N_A''::text END AS status,';
  a_label text := 'CASE COALESCE(a.status, ''PENDENTE''::text)';
  n_label text := 'CASE CASE WHEN a.status IS NOT NULL THEN a.status WHEN approval.try_parse_br_date(lbl.dt_inclusao) >= ''2026-09-01''::date THEN ''PENDENTE''::text ELSE ''HISTORICO_OMIE''::text END';
  a_na text := 'WHEN ''N_A''::text THEN ''N/A''::text';
  n_na text := 'WHEN ''HISTORICO_OMIE''::text THEN ''Histórico Omie''::text' || E'\n                    ' || 'WHEN ''N_A''::text THEN ''N/A''::text';
  conta int;
begin
  def := rtrim(pg_get_viewdef('approval.v_pc_completo'::regclass, true), E' \n;');
  if def like '%HISTORICO_OMIE%' then return; end if;  -- já aplicado
  ini := strpos(def, '), existing_rows AS (');
  fim := strpos(def, '), orphan_rows AS (');
  if ini = 0 or fim = 0 or fim < ini then raise exception '159: CTE existing_rows não encontrada'; end if;
  seg := substr(def, ini, fim - ini);
  foreach conta in array array[
      (length(seg) - length(replace(seg, a_status, ''))) / length(a_status),
      (length(seg) - length(replace(seg, a_label, ''))) / length(a_label),
      (length(seg) - length(replace(seg, a_na, ''))) / length(a_na)] loop
    if conta <> 1 then raise exception '159: trecho de status em existing_rows não é único (%)', conta; end if;
  end loop;
  novo_seg := replace(replace(replace(seg, a_status, n_status), a_label, n_label), a_na, n_na);
  execute 'create or replace view approval.v_pc_completo as '
       || substr(def, 1, ini - 1) || novo_seg || substr(def, fim);
end $$;

-- ── 4. refresh das listas + contagem "depois" ─────────────────────────────
select sales.refresh_mv_pc_lists();
insert into approval._counts_159 (fase, lista, source, status, n, valor)
select 'depois', l, source, status, count(*), round(sum(valor_total)) from (
  select 'v_pc_completo' l, source, status, valor_total from approval.v_pc_completo
  union all select 'v_pc_standby', source, status, valor_total from approval.v_pc_standby
  union all select 'v_pc_projetos', source, status, valor_total from approval.v_pc_projetos
  union all select 'v_pc_pcs', source, status, valor_total from approval.v_pc_pcs
  union all select 'v_pc_avulsos', source, status, valor_total from approval.v_pc_avulsos
  union all select 'mv_pc_projetos', source, status, valor_total from sales.mv_pc_projetos
  union all select 'mv_pc_pcs', source, status, valor_total from sales.mv_pc_pcs
  union all select 'mv_pc_avulsos', source, status, valor_total from sales.mv_pc_avulsos) x
where not exists (select 1 from approval._counts_159 where fase = 'depois')
group by 1, 2, 3, 4;

-- ── Desfazer ──────────────────────────────────────────────────────────────
--   drop trigger if exists espelho_somente_historico on orders.pedidos_compra;
--   do $$ declare r record; begin
--     for r in select nome, def from approval._view_backup_159
--              order by case nome when 'approval.v_pc_completo' then 0 when 'approval.v_pc_nativos' then 1 else 2 end loop
--       execute format('create or replace view %s as %s', r.nome, rtrim(r.def, E' \n;'));
--     end loop; end $$;
--   drop view if exists approval.v_pc_espelho_duplicado;
--   select sales.refresh_mv_pc_lists();

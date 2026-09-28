-- Exclusão de pedido de compra no painel.
--
-- Apagar um PC à bruta não funciona e nunca funcionou: a linha não vive em
-- approval.approvals, vem de orders.pedidos_compra (o espelho do Omie, ramo
-- existing_rows da v_pc_completo). O botão 🗑 apagava só a aprovação e deixava
-- o PC no ecrã; e mesmo apagando no espelho, o próximo sync faz upsert e
-- repõe. Por isso a exclusão é suave e por NÚMERO de PC — some da vista,
-- sobrevive ao sync, e volta a qualquer momento.
--
-- Espelha platform.excluded_pv_os, que já existe para PV/OS.

create table if not exists platform.excluded_pc (
  empresa     text        not null,
  pc_numero   text        not null,
  motivo      text,
  excluded_at timestamptz not null default now(),
  excluded_by uuid,
  primary key (empresa, pc_numero)
);

comment on table platform.excluded_pc is
  'PCs escondidos do painel. Filtrado em /api/list/rows. Reversível: apagar a linha traz o PC de volta.';

-- O filtro corre por (empresa, pc_numero) a cada carregamento de lista.
create index if not exists excluded_pc_empresa_idx on platform.excluded_pc (empresa);

alter table platform.excluded_pc enable row level security;

-- Leitura para qualquer sessão autenticada: a lista é consultada para filtrar
-- o que o utilizador vê. Escrita só pela service role, atrás da API, que é
-- onde o papel (admin/aprovador/comprador) é verificado.
drop policy if exists excluded_pc_select on platform.excluded_pc;
create policy excluded_pc_select on platform.excluded_pc
  for select to authenticated using (true);

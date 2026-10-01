-- 34 — Controle de avisos de "NF sem pedido" (Webex, uma vez por NF) (01/10/2026).
create table if not exists compras.nf_avisos (
  chave text primary key,
  em    timestamptz not null default now()
);
alter table compras.nf_avisos enable row level security;
grant all on compras.nf_avisos to service_role;

create or replace function orders.compras_nf_avisadas(p_chaves text[])
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(chave), '[]'::jsonb) from compras.nf_avisos where chave = any (p_chaves)
$$;
create or replace function orders.compras_nf_marcar_avisadas(p_chaves text[])
returns int language sql security definer set search_path = compras, public as $$
  insert into compras.nf_avisos (chave) select unnest(p_chaves) on conflict do nothing returning 1
$$;
revoke all on function orders.compras_nf_avisadas(text[]) from public, anon, authenticated;
revoke all on function orders.compras_nf_marcar_avisadas(text[]) from public, anon, authenticated;
grant execute on function orders.compras_nf_avisadas(text[]) to service_role;
grant execute on function orders.compras_nf_marcar_avisadas(text[]) to service_role;

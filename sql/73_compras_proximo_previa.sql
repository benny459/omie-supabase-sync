-- p73 (05/10/26): prévia do próximo número de RC/PC, sem reservar
create or replace function compras.proximo_numero_previa(p_empresa text) returns text language sql stable security definer set search_path to 'compras','public' as $$ select (greatest(coalesce((select ultimo from compras.numeracao where empresa = p_empresa),0), coalesce((select max(numero::bigint) from compras.pedidos where empresa = p_empresa and numero ~ '^\d{1,15}$'),0), coalesce((select max(cnumero::bigint) from orders.pedidos_compra where empresa = p_empresa and cnumero ~ '^\d{1,15}$'),0)) + 1)::text $$;

-- p73b: wrapper em orders (schema compras não é exposto no PostgREST)
create or replace function orders.proximo_numero_previa(p_empresa text) returns text language sql stable security definer set search_path to 'orders','compras','public' as $$ select compras.proximo_numero_previa(p_empresa) $$;

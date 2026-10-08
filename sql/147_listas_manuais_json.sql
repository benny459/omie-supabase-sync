-- 147 · Listas de Operação (Projetos / Avulsos / PCs): linhas manuais frescas numa consulta só (08/10/26).
--
-- /api/list/rows mescla as linhas manuais (ncod_ped < 0) lidas da view VIVA por cima da MV
-- (que só atualiza a cada 10 min). Pelo PostgREST isso ia em páginas de 1000 — e cada página
-- monta a view inteira de novo (approval.v_pc_* ⇒ v_pc_completo: 4–8 s por página). Avulsos
-- tem ~1,8 mil linhas manuais ⇒ 2 páginas em série ⇒ ~19 s para a carga completa da tela.
--
-- Esta função devolve as MESMAS linhas, na mesma ordem, como um único json (sem o teto de
-- 1000 linhas do PostgREST): a view é montada uma vez só (~7 s em Avulsos, ~4 s em Projetos).
-- Só leitura, nada muda nos dados. A rota usa a função quando ela existe e volta ao caminho
-- antigo (páginas) se ela não existir ou falhar.

create or replace function approval.pc_lista_manuais(p_view text)
returns json
language plpgsql
stable
set search_path to ''
as $fn$
declare
  v json;
begin
  if p_view not in ('v_pc_avulsos', 'v_pc_pcs', 'v_pc_projetos') then
    raise exception 'view inválida: %', p_view;
  end if;
  execute format(
    'select coalesce(json_agg(v order by v.pv_os_label asc nulls last, v.ncod_ped asc), ''[]''::json)
       from approval.%I v where v.ncod_ped < 0', p_view)
    into v;
  return v;
end
$fn$;

revoke all on function approval.pc_lista_manuais(text) from public, anon, authenticated;
grant execute on function approval.pc_lista_manuais(text) to service_role;

-- Resumo do budget em Projetos (/api/rc-projetos/budget/summary): para saber se o nº de PC
-- digitado numa linha da lista existe, a rota chamava orders.compras_id_por_numero UMA vez
-- por número (até 400 chamadas por carga). Esta faz o mesmo teste para a lista inteira, com
-- a mesma regra (empresa em maiúsculas, número sem espaços, tipo PC, cancelado conta).
create or replace function orders.compras_pcs_existentes(p_empresa text, p_numeros text[])
returns text[]
language sql
stable
security definer
set search_path to ''
as $fn$
  select coalesce(array_agg(distinct p.numero), '{}')
    from compras.pedidos p
   where p.empresa = upper(p_empresa) and p.tipo = 'PC'
     and p.numero = any (select trim(x) from unnest(p_numeros) x)
$fn$;

revoke all on function orders.compras_pcs_existentes(text, text[]) from public, anon, authenticated;
grant execute on function orders.compras_pcs_existentes(text, text[]) to service_role;

notify pgrst, 'reload schema';

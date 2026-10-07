-- 104 · Lixeira da lista de materiais aceita gravação de quem edita a lista (07/10/26).
-- Erro do Benny ao remover linha: "permission denied for table rc_projetos_itens_lixeira"
-- (authenticated só tinha SELECT). Mesma regra de escrita de rc_projetos_itens. Aplicada como p104.
grant insert on approval.rc_projetos_itens_lixeira to authenticated;
drop policy if exists rc_itens_lixeira_ins on approval.rc_projetos_itens_lixeira;
create policy rc_itens_lixeira_ins on approval.rc_projetos_itens_lixeira for insert to authenticated
  with check (platform.is_admin() OR platform.is_buyer() OR platform.can_write_module('projetos'::text) OR platform.is_approver('projetos'::text));

-- 07/10/26: Contas a pagar não carregava ("canceling statement due to statement
-- timeout"): finance.pagar_v3_dados levava 3,7–6,7 s e passava dos 8 s do
-- PostgREST com o banco ocupado. O cruzamento PC × aprovação varria
-- orders.pedidos_compra inteira por PC. Com os índices: ~1,2 s.
create index if not exists idx_pedidos_compra_emp_cnumero on orders.pedidos_compra (empresa, cnumero);
create index if not exists idx_approvals_emp_pc_manual on approval.approvals (empresa, pc_numero_manual) where pc_numero_manual is not null;
analyze orders.pedidos_compra; analyze approval.approvals;

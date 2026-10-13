-- 13/10/26 — "não acha o cliente cadastrado, mas informa que já tem cadastro" (HAPVIDA - HOSPITAL
-- CRUZEIRO DO SUL, 44.649.812/0260-13): 372 cadastros vieram do Omie sem tag de cliente nem de
-- fornecedor (o sync regrava eh_* a partir das tags), e a busca por papel os escondia das duas abas,
-- enquanto a checagem de duplicidade (que olha todos) os achava. Cadastro sem papel nenhum agora
-- aparece em Clientes e em Fornecedores.
do $$
declare d text;
begin
  d := pg_get_functiondef('orders.cadastros_listar(text,text,text,boolean,integer,integer)'::regprocedure);
  d := replace(d, $a$and (case p_papel when 'cliente' then p.eh_cliente$a$,
    $a$and ((p_papel in ('cliente', 'fornecedor') and not (coalesce(p.eh_cliente, false) or coalesce(p.eh_fornecedor, false) or coalesce(p.eh_transportadora, false)))
            or case p_papel when 'cliente' then p.eh_cliente$a$);
  d := replace(d, $a$else true end)
       and (not coalesce(p_ativos$a$, $a$else true end)
       and (not coalesce(p_ativos$a$);
  if d not like '%p_papel in (%' then raise exception 'filtro não trocado'; end if;
  execute d;
end $$;

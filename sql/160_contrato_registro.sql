-- 160 · Contratos recorrentes: registro "de → para" das edições e valor da competência ao corrigir a OS — 09/10/26
-- Pedido do faturamento (Fernanda, via Benny): "fiz a alteração do valor de contrato do Hcor e acredito que não tenha
-- salvado e com isso o recibo acabou saindo sem o preço... preciso de uma forma para editar e corrigir o contrato".
--
-- O que aconteceu (08/10, CM180321 · ASSOCIACAO BENEFICENTE SIRIA): a edição gravou R$ 0,00 (o valor "2.720,64" virava
-- NaN no formulário e o banco o tornava 0 sem avisar); a OS4893 (competência 08/2026) foi gerada 22 s depois com R$ 0,00
-- e o recibo nº 4657 saiu com R$ 0,00. O código do painel (mesmo commit) já barra valor inválido/zerado e corrige a OS.
--
-- Esta migração é ADITIVA: uma função nova. Nada existente muda.
--   orders.contrato_registrar(id, por, acao, detalhe, comp_id, valor)
--     · grava no Registro do contrato (vendas.contrato_hist) as mudanças "de → para" de cada edição (acao 'alteracao'),
--       a OS atualizada com o valor do contrato ('os_atualizada') e o recibo cancelado para reemissão ('recibo_cancelado');
--     · com comp_id + valor, atualiza o valor guardado da competência (só competências do painel, não canceladas).
-- Até ser aplicada, o painel continua a gravar e a corrigir normalmente; só o Registro fica sem o "de → para".

create or replace function orders.contrato_registrar(p_id bigint, p_por text, p_acao text, p_detalhe jsonb,
                                                     p_comp_id bigint default null, p_valor numeric default null)
returns jsonb
language plpgsql
security definer
set search_path to 'vendas', 'public'
as $f$
begin
  if p_acao not in ('alteracao', 'os_atualizada', 'recibo_cancelado') then
    raise exception 'Registro do contrato: ação % não permitida', p_acao;
  end if;
  if not exists (select 1 from vendas.contratos where id = p_id) then
    raise exception 'Contrato % não encontrado', p_id;
  end if;
  if p_comp_id is not null and p_valor is not null then
    update vendas.contrato_competencias set valor = round(p_valor, 2)
     where id = p_comp_id and contrato_id = p_id and origem = 'painel' and status <> 'cancelado';
  end if;
  perform vendas.contrato_log(p_id, p_por, p_acao, coalesce(p_detalhe, '{}'::jsonb));
  return jsonb_build_object('ok', true);
end $f$;

revoke all on function orders.contrato_registrar(bigint, text, text, jsonb, bigint, numeric) from public, anon, authenticated;
grant execute on function orders.contrato_registrar(bigint, text, text, jsonb, bigint, numeric) to service_role;

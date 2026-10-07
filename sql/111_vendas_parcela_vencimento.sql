-- 111 · Previsão de recebimento (vencimento) de uma parcela de PV/OS nativo (07/10/26, Benny).
--
-- Operação › Projetos › "Vendas do projeto (PV/OS)": cada parcela tem a previsão de
-- faturamento (a da carteira do Faturamento — orders.fat_previsao_override, sql/72) e a
-- previsão de recebimento. Esta função grava o recebimento na própria parcela
-- (vendas.parcelas.vencimento), que é de onde o título a receber nasce ao faturar.
-- O schema vendas não é exposto no PostgREST — por isso a função em orders.
-- Parcela já faturada não muda aqui: o vencimento passa a ser o do título
-- (Financeiro › Receber › Editar, sql/80), e a tela usa esse caminho.
--
-- Até esta função existir, a tela muda só a data da parcela no Fluxo de caixa do
-- projeto (approval.projeto_plano_parcela.dt_ajustada) e avisa que falta a sql/111.

create or replace function orders.vendas_parcela_vencimento(p_parcela bigint, p_vencimento date, p_por text default null)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare r vendas.parcelas;
begin
  if p_vencimento is null then raise exception 'vencimento obrigatório'; end if;
  select * into r from vendas.parcelas where id = p_parcela for update;
  if not found then raise exception 'parcela não encontrada'; end if;
  if r.faturada_em is not null then
    raise exception 'parcela já faturada — o vencimento agora é o do título (Financeiro › Receber › Editar)';
  end if;
  update vendas.parcelas set vencimento = p_vencimento where id = p_parcela;
  insert into vendas.historico (documento_id, em, por, acao, detalhe)
  values (r.documento_id, now(), p_por, 'vencimento_parcela',
          jsonb_build_object('parcela', r.numero, 'antes', r.vencimento, 'depois', p_vencimento));
  return jsonb_build_object('parcela', r.numero, 'antes', r.vencimento, 'depois', p_vencimento);
end $$;

revoke all on function orders.vendas_parcela_vencimento(bigint, date, text) from public, anon, authenticated;
grant execute on function orders.vendas_parcela_vencimento(bigint, date, text) to service_role;

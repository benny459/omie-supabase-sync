-- 112 · Fluxo de caixa INICIAL do projeto, travado (07/10/26, Benny).
--
-- Projeto › 4 Fluxo de caixa ganhou o gráfico "fluxo inicial × fluxo em andamento".
-- O inicial é o plano do fechamento do CRM (parcelas + agenda de saídas) como foi
-- importado. Só que approval.plano_importar (sql/18) APAGA e reinsere
-- projeto_plano_parcela/projeto_plano_saida a cada reimportação (o CRM publica um
-- CP/MC novo a cada "Salvar fechamento") — o plano vivo não serve de foto.
--
-- Esta tabela é a foto: gravada UMA vez por projeto (na primeira importação, ou na
-- primeira abertura da aba para projetos antigos — o backfill abaixo já cobre os de
-- hoje) e nunca mais alterada, salvo "Redefinir fluxo inicial" (só administrador),
-- que chama approval.fluxo_inicial_congelar(..., p_forcar => true).
--
-- Aditiva: não mexe em nenhuma tabela existente. (Nome "inicial" e não "baseline":
-- approval.projeto_fluxo_baseline JÁ existe — é a foto por versão da APROVAÇÃO do fluxo.)

create table if not exists approval.projeto_fluxo_inicial (
  id              bigserial   primary key,
  empresa         text        not null,
  codigo_projeto  bigint      not null,
  tipo            text        not null check (tipo in ('entrada', 'saida')),
  data            date,
  valor           numeric     not null default 0,
  descricao       text,
  -- 'parcela' (entrada do fechamento) | 'material' | 'sem_pc' (obra/despesa)
  origem          text        not null,
  -- nº da parcela (entrada) ou id de projeto_plano_saida (saída) no momento da foto
  ref             text,
  proposta        text,
  congelado_em    timestamptz not null default now(),
  congelado_por   text
);

create index if not exists projeto_fluxo_inicial_proj_idx
  on approval.projeto_fluxo_inicial (empresa, codigo_projeto);

comment on table approval.projeto_fluxo_inicial is
  'Fluxo de caixa inicial (travado) do projeto: foto do plano do fechamento na 1ª importação. Só muda por fluxo_inicial_congelar(forcar=true) (admin).';

alter table approval.projeto_fluxo_inicial enable row level security;
-- Só o service role (rotas de servidor). Sem policy = ninguém mais.
grant all on approval.projeto_fluxo_inicial to service_role;
grant usage, select on sequence approval.projeto_fluxo_inicial_id_seq to service_role;

-- Congela o plano ATUAL como fluxo inicial. Sem p_forcar, não faz nada se a foto
-- já existe (idempotente — pode ser chamada a cada importação e a cada leitura).
-- Entradas: parcelas pela data do PLANO (dt_plano), nunca a ajustada.
-- Saídas: agenda do plano com no_fluxo = true, pela dt_prevista.
create or replace function approval.fluxo_inicial_congelar(
  p_empresa text, p_codigo bigint, p_quem text default null, p_forcar boolean default false)
returns jsonb language plpgsql security definer set search_path to '' as $$
declare
  v_existe boolean;
  v_prop text;
  v_n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('fluxo_inicial:' || p_empresa || ':' || p_codigo));
  select exists (select 1 from approval.projeto_fluxo_inicial
                  where empresa = p_empresa and codigo_projeto = p_codigo) into v_existe;
  if v_existe and not p_forcar then
    return jsonb_build_object('acao', 'ja_existia');
  end if;
  if not exists (select 1 from approval.projeto_plano_parcela where empresa = p_empresa and codigo_projeto = p_codigo)
     and not exists (select 1 from approval.projeto_plano_saida where empresa = p_empresa and codigo_projeto = p_codigo) then
    return jsonb_build_object('acao', 'sem_plano');
  end if;

  if v_existe then
    delete from approval.projeto_fluxo_inicial where empresa = p_empresa and codigo_projeto = p_codigo;
  end if;
  select proposta into v_prop from approval.projeto_plano
   where empresa = p_empresa and codigo_projeto = p_codigo;

  insert into approval.projeto_fluxo_inicial
    (empresa, codigo_projeto, tipo, data, valor, descricao, origem, ref, proposta, congelado_por)
  select p_empresa, p_codigo, 'entrada', p.dt_plano, coalesce(p.valor, 0),
         coalesce(nullif(p.evento, ''), 'Parcela ' || p.parcela), 'parcela', p.parcela::text, v_prop, p_quem
    from approval.projeto_plano_parcela p
   where p.empresa = p_empresa and p.codigo_projeto = p_codigo
  union all
  select p_empresa, p_codigo, 'saida', s.dt_prevista, coalesce(s.valor, 0),
         coalesce(nullif(s.descricao, ''), nullif(s.fornecedor, ''), 'Saída do plano'),
         case when s.origem = 'sem_pc' then 'sem_pc' else 'material' end, s.id::text, v_prop, p_quem
    from approval.projeto_plano_saida s
   where s.empresa = p_empresa and s.codigo_projeto = p_codigo and coalesce(s.no_fluxo, true);
  get diagnostics v_n = row_count;

  return jsonb_build_object('acao', case when v_existe then 'redefinido' else 'congelado' end, 'linhas', v_n);
end $$;

revoke all on function approval.fluxo_inicial_congelar(text, bigint, text, boolean) from public, anon, authenticated;
grant execute on function approval.fluxo_inicial_congelar(text, bigint, text, boolean) to service_role;

-- Backfill: todo projeto que já tem plano ganha a foto com as linhas de hoje.
select approval.fluxo_inicial_congelar(x.empresa, x.codigo_projeto, 'backfill sql/112', false)
  from (select empresa, codigo_projeto from approval.projeto_plano_parcela
        union
        select empresa, codigo_projeto from approval.projeto_plano_saida) x;

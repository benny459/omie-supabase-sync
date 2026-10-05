-- 53 — Faturamento pela Focus NFe (P5 do ciclo de vendas avulsas, 05/10/2026)
--
-- Emissão de NF-e (PV), NFS-e ou recibo (OS) pelo painel, sem Omie.
-- Regra de ouro: HOMOLOGAÇÃO é o padrão. Produção só com
-- orders.fat_config.producao_liberada = true, que só o Benny liga
-- (PATCH /api/faturamento/config, restrito ao e-mail dele).
--
-- Tabelas no schema orders (exposto), RLS ligada e SEM políticas: só o
-- service_role (rotas do painel, que validam a sessão) lê e grava.

create table if not exists orders.fat_config (
  empresa            text primary key,              -- SF | CD | WW
  cnpj               text,
  ativo              boolean not null default false, -- empresa habilitada para emitir pelo painel
  ambiente           text not null default 'homologacao'
                     check (ambiente in ('homologacao','producao')),
  producao_liberada  boolean not null default false, -- trava: só o Benny liga
  tipo_os            text not null default 'recibo'
                     check (tipo_os in ('recibo','nfse')),  -- OS vira recibo (padrão) ou NFS-e
  -- numeração por ambiente; null = a Focus/prefeitura numera sozinha
  nfe_serie_homologacao   text not null default '2',
  nfe_proximo_homologacao integer,
  nfe_serie_producao      text not null default '1',
  nfe_proximo_producao    integer,
  rps_serie_homologacao   text not null default '2',
  rps_serie_producao      text not null default '2',
  recibo_proximo          integer,                    -- recibo de prestação (segue o Omie)
  natureza_operacao  text not null default 'Venda de mercadoria',
  item_lista_servico text,                            -- NFS-e (Barueri)
  observacoes        text,
  updated_at         timestamptz not null default now(),
  updated_by         text
);

insert into orders.fat_config (empresa, cnpj, ativo)
values ('SF', '15766003000108', true), ('CD', null, false), ('WW', null, false)
on conflict (empresa) do nothing;

create table if not exists orders.fat_emissoes (
  id            bigserial primary key,
  empresa       text not null,
  ambiente      text not null check (ambiente in ('homologacao','producao')),
  tipo          text not null check (tipo in ('nfe','nfse','recibo')),
  ref           text not null unique,                 -- referência enviada à Focus
  origem_tipo   text not null default 'manual'
                check (origem_tipo in ('pv','os','venda','manual','teste')),
  origem_id     text,                                 -- id/nº do PV/OS de origem
  cliente       jsonb not null,
  itens         jsonb not null,
  condicao      jsonb,                                -- {parcelas:[{dias|vencimento, valor|percentual}]}
  payload       jsonb,                                -- JSON enviado à Focus
  status        text not null default 'rascunho'
                check (status in ('rascunho','processando','autorizada','rejeitada','cancelada','erro')),
  focus_status  text,
  mensagem      text,
  erros         jsonb,
  numero        text,
  serie         text,
  chave         text,
  valor_total   numeric(14,2) not null default 0,
  xml_path      text,                                 -- storage: fat-documentos/...
  pdf_path      text,
  receber_ids   uuid[],
  enviado_em    timestamptz,
  enviado_para  text,
  autorizada_em timestamptz,
  cancelada_em  timestamptz,
  criado_por    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists fat_emissoes_origem_idx on orders.fat_emissoes (origem_tipo, origem_id);
create index if not exists fat_emissoes_status_idx on orders.fat_emissoes (status);

alter table orders.fat_config   enable row level security;
alter table orders.fat_emissoes enable row level security;
revoke all on orders.fat_config, orders.fat_emissoes from anon, authenticated;
grant select, insert, update, delete on orders.fat_config, orders.fat_emissoes to service_role;
grant usage, select on sequence orders.fat_emissoes_id_seq to service_role;

-- Bucket privado para XML/PDF emitidos (lidos por URL assinada).
insert into storage.buckets (id, name, public)
values ('fat-documentos', 'fat-documentos', false)
on conflict (id) do nothing;

-- Numeração atómica (recibo e NF-e com número explícito). Devolve o número a
-- usar e avança o contador; null quando o contador não está configurado.
create or replace function orders.fat_reservar_numero(p_empresa text, p_campo text)
returns integer language plpgsql security definer set search_path = orders as $$
declare v integer;
begin
  if p_campo not in ('recibo_proximo','nfe_proximo_homologacao','nfe_proximo_producao') then
    raise exception 'campo inválido: %', p_campo;
  end if;
  execute format('update orders.fat_config set %1$I = %1$I + 1, updated_at = now()
                  where empresa = $1 and %1$I is not null returning %1$I - 1', p_campo)
    into v using p_empresa;
  return v;
end $$;
revoke all on function orders.fat_reservar_numero(text, text) from public, anon, authenticated;
grant execute on function orders.fat_reservar_numero(text, text) to service_role;

-- Em homologação a emissão só gera contas a receber se pedido (testes);
-- em produção sempre gera.
alter table orders.fat_emissoes add column if not exists gerar_receber boolean not null default true;

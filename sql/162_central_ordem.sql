-- 162 — Central de Ordem (Aria por módulo), 09/10/26.
--
-- SPEC: SPEC-allka-em-dia-central-de-ordem.md (secção 7), com o desvio pedido pelo
-- Benny: a Central vive DENTRO do painel legado (uma aba "Central de Ordem" em cada
-- módulo + "Meu dia"), não na barra do portal ALLKA.
--
-- Só aditivo: schema novo `ordem`, nenhuma tabela existente é tocada.
-- Nenhuma destas tabelas guarda permissões — quem vê o quê continua a sair de
-- platform.user_profiles / user_area_access / user_module_roles / permissoes_usuario.
--
-- Multi-tenant: tudo leva `tenant_slug` (chave de public.tenants, a mesma que
-- public.tenant_members usa). O painel é do tenant 'waterworks'; Serviços/RH e o CRM
-- podem gravar aqui com o seu próprio slug/módulo mais tarde.
--
-- Acesso: RLS ligado e SEM políticas; só service_role tem grant (as rotas
-- /api/ordem/* validam sessão e permissões no servidor antes de ler/gravar).

create schema if not exists ordem;
revoke all on schema ordem from public;
grant usage on schema ordem to service_role;

-- Configuração por tenant (parâmetros M1–M6/P1–P4, interruptores por módulo,
-- detetor, ação, comandos, sino, mensagens). Tudo nasce DESLIGADO; os valores
-- propostos vêm como "sugerido" no código e só valem quando o admin grava.
create table if not exists ordem.config (
  tenant_slug    text primary key,
  dados          jsonb not null default '{}'::jsonb,
  atualizado_por uuid,
  atualizado_em  timestamptz not null default now()
);

-- Cada mudança de configuração (quem, quando, antes → depois).
create table if not exists ordem.config_log (
  id          bigserial primary key,
  tenant_slug text not null,
  usuario_id  uuid,
  email       text,
  chave       text not null,          -- caminho do parâmetro (ex.: modulos.compras.ligado, dono.nf_coluna_meio)
  antes       jsonb,
  depois      jsonb,
  criado_em   timestamptz not null default now()
);
create index if not exists config_log_tenant_idx on ordem.config_log (tenant_slug, criado_em desc);

-- Dono de cada tipo de pendência (substitui os nomes fixos de avulsos-report.ts,
-- com fallback para eles quando não há linha).
create table if not exists ordem.dono_config (
  tenant_slug      text not null,
  tipo             text not null,
  papel            text not null,
  titular_id       uuid not null,
  substituto_id    uuid,
  titular_ausente  boolean not null default false,
  atualizado_por   uuid,
  atualizado_em    timestamptz not null default now(),
  primary key (tenant_slug, tipo)
);

-- Pendências detetadas (cache recalculado pelos detetores; a fonte continua a ser o módulo).
create table if not exists ordem.item (
  id              uuid primary key default gen_random_uuid(),
  tenant_slug     text not null,
  tipo            text not null,
  modulo          text not null,
  origem_ref      text not null,
  dono_id         uuid,                       -- null = sem dono resolvido (vai para a fila do admin)
  urgencia        text check (urgencia in ('critica','atencao')),
  rotulo_urgencia text,
  titulo          text not null,
  resumo          text,
  etapa           text,
  valor           numeric,
  link            text,                       -- "Abrir na tela tradicional ↗"
  recomendacao    jsonb not null,             -- contrato da secção 0.2
  dados           jsonb,                      -- evidência do detetor (membros do lote, etc.)
  depende_de      jsonb,                      -- {modulo, papel}
  estado          text not null default 'aberto'
                  check (estado in ('aberto','feito','recusado','adiado','encaminhado')),
  adiado_ate      timestamptz,
  degrau          int not null default 0,     -- escada: 0 lembrete · 1 2º aviso · 2 supervisão · 3 direção
  encaminhado_de  uuid references ordem.item(id),
  encaminhado_por uuid,
  criado_em       timestamptz not null default now(),
  visto_em        timestamptz not null default now(),   -- última vez que o detetor o encontrou
  resolvido_em    timestamptz,
  resolvido_como  text,                       -- 'detetor' (saiu sozinho) | 'acao' | 'manual'
  unique (tenant_slug, tipo, origem_ref)
);
create index if not exists item_fila_idx on ordem.item (tenant_slug, estado, modulo);
create index if not exists item_dono_idx on ordem.item (tenant_slug, dono_id, estado);
create index if not exists item_enc_idx on ordem.item (encaminhado_de);

-- Avisos do sino.
create table if not exists ordem.aviso (
  id              bigserial primary key,
  tenant_slug     text not null,
  destinatario_id uuid not null,
  tipo            text not null check (tipo in ('encaminhado','resposta','escada','acesso','info')),
  item_id         uuid references ordem.item(id),
  texto           text not null,
  criado_em       timestamptz not null default now(),
  lido_em         timestamptz
);
create index if not exists aviso_dest_idx on ordem.aviso (tenant_slug, destinatario_id, lido_em);

-- Pedidos de acesso (decididos pelo admin; a Central não concede nada sozinha).
create table if not exists ordem.pedido_acesso (
  id           uuid primary key default gen_random_uuid(),
  tenant_slug  text not null,
  usuario_id   uuid not null,
  modulo       text not null,
  motivo       text,
  estado       text not null default 'pendente' check (estado in ('pendente','aprovado','recusado')),
  decidido_por uuid,
  nota         text,
  criado_em    timestamptz not null default now(),
  decidido_em  timestamptz
);

-- Auditoria de cada ação feita a partir da Central (inclui comandos em lote).
create table if not exists ordem.acao_log (
  id          bigserial primary key,
  tenant_slug text not null,
  usuario_id  uuid not null,
  item_id     uuid,
  lote_id     uuid,                -- comando em lote: todas as linhas do mesmo comando
  comando     text,
  acao        text not null,       -- aceitar | ajustar | recusar | adiar | encaminhar | desfazer | executar | previa
  recomendado jsonb,
  executado   jsonb,
  motivo      text,
  desfeito_em timestamptz,
  criado_em   timestamptz not null default now()
);
create index if not exists acao_log_item_idx on ordem.acao_log (item_id);
create index if not exists acao_log_user_idx on ordem.acao_log (tenant_slug, usuario_id, criado_em desc);

-- Mensagens (Webex/sino) — em modo de ensaio só registam o que seriam.
create table if not exists ordem.mensagem (
  id              bigserial primary key,
  tenant_slug     text not null,
  destinatario_id uuid,
  destinatario_email text,
  canal           text not null,        -- webex | sino
  janela          text,                 -- 0730 | 1130 | 1600 | 1800 | escada
  modo            text not null,        -- ensaio | teste | ligado
  enviado         boolean not null default false,
  texto           text not null,
  erro            text,
  criado_em       timestamptz not null default now()
);
create index if not exists mensagem_idx on ordem.mensagem (tenant_slug, criado_em desc);

alter table ordem.config        enable row level security;
alter table ordem.config_log    enable row level security;
alter table ordem.dono_config   enable row level security;
alter table ordem.item          enable row level security;
alter table ordem.aviso         enable row level security;
alter table ordem.pedido_acesso enable row level security;
alter table ordem.acao_log      enable row level security;
alter table ordem.mensagem      enable row level security;

grant all on all tables in schema ordem to service_role;
grant usage, select on all sequences in schema ordem to service_role;

-- Expor o schema no PostgREST (só service_role tem grant; anon/authenticated não
-- veem nada). Acrescenta 'ordem' à lista atual sem tirar nenhum dos existentes.
do $$
declare atual text;
begin
  select split_part(c, '=', 2) into atual
    from pg_roles r, unnest(r.rolconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';
  if atual is null then atual := 'public, storage, graphql_public'; end if;
  if position('ordem' in atual) = 0 then
    execute format('alter role authenticator set pgrst.db_schemas = %L', atual || ',ordem');
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';

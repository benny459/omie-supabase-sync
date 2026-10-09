-- 09/10/26 — Histórico de envios da nota/recibo ao cliente (Faturamento › Enviar ao cliente).
-- Uma linha por envio (e-mail da plataforma ou "marcado como enviado" por outro caminho).
-- status acompanha o Resend (sent → delivered / bounced / complained / delivery_delayed / opened).
create table if not exists orders.fat_envios (
  id bigserial primary key,
  emissao_id bigint not null references orders.fat_emissoes(id) on delete cascade,
  meio text not null default 'email',          -- email | WhatsApp | Portal do cliente | Outro
  resend_id text,
  de text,
  para text[] not null default '{}',
  cc text[] not null default '{}',
  cco text[] not null default '{}',
  assunto text,
  anexos text[] not null default '{}',
  enviado_por text,
  enviado_em timestamptz not null default now(),
  status text not null default 'enviado',
  status_em timestamptz,
  detalhe text
);
create index if not exists fat_envios_emissao_idx on orders.fat_envios (emissao_id, enviado_em desc);
alter table orders.fat_envios enable row level security;
grant all on orders.fat_envios to service_role;
grant usage, select on sequence orders.fat_envios_id_seq to service_role;

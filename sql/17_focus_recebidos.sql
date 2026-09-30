-- 17 — Documentos fiscais RECEBIDOS via Focus NFe (substitui a captura do Omie)
-- NF-e, CT-e e NFS-e Nacional emitidos CONTRA nossos CNPJs.
-- Alimentado por scripts/import_focus_recebidos.py (lista paginada por `versao`)
-- e pelo webhook do painel (/api/focus/webhook). Só service role acessa.

create table if not exists orders.focus_recebidos (
  tipo            text        not null check (tipo in ('nfe','cte','nfse')),
  chave           text        not null,
  empresa         text        not null,          -- SF / CD / WW
  cnpj            text        not null,          -- nosso CNPJ (destinatário/tomador)
  versao          bigint,                        -- cursor da Focus
  emitente_nome   text,
  emitente_doc    text,
  numero          text,
  emissao         timestamptz,
  valor           numeric,
  situacao        text,                          -- autorizada / cancelada ...
  manifestacao    text,                          -- ciencia / confirmacao / ... (só NF-e)
  completa        boolean,                       -- XML completo disponível na Focus
  raw             jsonb       not null,          -- item da listagem, como veio
  detalhe         jsonb,                         -- documento completo (JSON) quando baixado
  ciencia_em      timestamptz,                   -- quando o painel mandou a ciência
  ciencia_resposta jsonb,
  primeiro_visto  timestamptz not null default now(),
  synced_at       timestamptz not null default now(),
  primary key (tipo, chave)
);

create index if not exists focus_recebidos_empresa_emissao on orders.focus_recebidos (empresa, emissao desc);
create index if not exists focus_recebidos_emitente on orders.focus_recebidos (emitente_doc);

alter table orders.focus_recebidos enable row level security;
revoke all on orders.focus_recebidos from anon, authenticated;

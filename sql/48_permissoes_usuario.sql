-- 48 — Usuários e acessos (03/10/2026): permissões finas por pessoa.
-- Modelo de três estados: sem linha = padrão de hoje (calculado em web/lib/acessos.ts);
-- linha com concedida=true/false = escolha explícita do administrador.
-- Só a service role lê/escreve (RLS ligado, sem policy).

create table if not exists platform.permissoes_catalogo (
  chave      text primary key,
  modulo     text not null,
  rotulo     text not null,
  descricao  text,
  ordem      int  not null default 0
);

create table if not exists platform.permissoes_usuario (
  user_id        uuid not null,
  chave          text not null references platform.permissoes_catalogo(chave) on delete cascade,
  concedida      boolean not null,
  por_email      text,
  em             timestamptz not null default now(),
  primary key (user_id, chave)
);

create table if not exists platform.acessos_audit (
  id          bigserial primary key,
  alvo_id     uuid,
  alvo_email  text,
  acao        text not null,
  antes       jsonb,
  depois      jsonb,
  por_email   text,
  em          timestamptz not null default now()
);
create index if not exists acessos_audit_alvo on platform.acessos_audit (alvo_id, em desc);

alter table platform.permissoes_catalogo enable row level security;
alter table platform.permissoes_usuario  enable row level security;
alter table platform.acessos_audit       enable row level security;
revoke all on platform.permissoes_catalogo, platform.permissoes_usuario, platform.acessos_audit from anon, authenticated;
grant usage on sequence platform.acessos_audit_id_seq to service_role;

insert into platform.permissoes_catalogo (chave, modulo, rotulo, descricao, ordem) values
  ('compras.acesso',            'compras',    'Abrir Compras',                    'Ver o módulo de Compras (requisições e pedidos)', 10),
  ('compras.ver_valores',       'compras',    'Ver valores e preços',             'Valores dos pedidos, preços unitários e histórico de preço', 20),
  ('compras.aprovar',           'compras',    'Aprovar pedido',                   'Aprovar pedidos de compra (respeita a alçada)', 30),
  ('compras.gerar_pc_nf',       'compras',    'Gerar pedido a partir da NF',      'Criar PC a partir de uma NF sem pedido', 40),
  ('compras.dispensar_nf',      'compras',    'Dispensar NF sem pedido',          'Liberar uma NF sem pedido com motivo', 50),
  ('compras.conferir',          'compras',    'Conferir e liberar pagamento',     'Conferência do recebimento (libera o pagamento)', 60),
  ('compras.enviar_fornecedor', 'compras',    'Enviar ao fornecedor',             'Enviar/marcar o pedido como enviado ao fornecedor', 70),
  ('estoque.acesso',            'estoque',    'Abrir Estoque',                    'Ver o módulo de Estoque', 10),
  ('estoque.ver_custos',        'estoque',    'Ver custos (CMC e valor)',         'Custo médio e valor em estoque', 20),
  ('estoque.ajustar',           'estoque',    'Ajustar saldo',                    'Ajustes de inventário (ainda exige a senha da janela)', 30),
  ('estoque.mesclar',           'estoque',    'Mesclar duplicidades',             'Mesclar e desfazer mesclagens', 40),
  ('estoque.senha_inventario',  'estoque',    'Gerar senha de inventário',        'Abrir e revogar janelas de inventário', 50),
  ('estoque.codigos',           'estoque',    'Recodificar / aplicar códigos',    'Famílias, revisão e códigos novos', 60),
  ('estoque.config_mov',        'estoque',    'Configurar tipos de movimentação', 'Tipos e justificativas de movimentação', 70),
  ('estoque.aprovar_perdas',    'estoque',    'Aprovar perdas',                   'Aprovar perdas / avarias / descartes', 80),
  ('financeiro.ver_pagar',      'financeiro', 'Ver contas a pagar',               'Títulos a Pagar', 10),
  ('financeiro.ver_receber',    'financeiro', 'Ver contas a receber',             'Títulos a Receber', 20),
  ('financeiro.editar_titulo',  'financeiro', 'Incluir / excluir título',         'Criar ou excluir títulos', 30)
on conflict (chave) do update set modulo = excluded.modulo, rotulo = excluded.rotulo,
  descricao = excluded.descricao, ordem = excluded.ordem;

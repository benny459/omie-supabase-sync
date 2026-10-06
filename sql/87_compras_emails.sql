-- 87 · Conversa por e-mail do pedido de compra com o fornecedor (06/10/26).
-- Cada e-mail enviado pelo painel (PDF do PC, respostas) e cada resposta do
-- fornecedor (Resend receiving → /api/compras/email/entrada) fica em
-- compras.emails, ligado ao pedido. compras não é exposto no PostgREST, por
-- isso as funções vivem em orders (só service_role).

create table if not exists compras.emails (
  id           bigserial primary key,
  empresa      text not null,
  pedido_id    bigint not null references compras.pedidos(id) on delete cascade,
  direcao      text not null check (direcao in ('saida', 'entrada')),
  message_id   text,
  in_reply_to  text,
  de           text,
  para         text[] not null default '{}',
  cc           text[] not null default '{}',
  cco          text[] not null default '{}',
  assunto      text,
  texto        text,
  html         text,
  anexos       jsonb not null default '[]'::jsonb,   -- [{nome, tipo, tamanho, caminho}]
  enviado_por  text,                                  -- e-mail de quem enviou (saída)
  resend_id    text,                                  -- id do e-mail no Resend (saída ou entrada)
  status       text not null default 'ok',            -- ok · erro · teste
  lido_em      timestamptz,                           -- entrada: quando alguém abriu a conversa
  criado_em    timestamptz not null default now()
);
create index if not exists emails_pedido_idx on compras.emails (pedido_id, criado_em);
create unique index if not exists emails_resend_uq on compras.emails (direcao, resend_id) where resend_id is not null;
alter table compras.emails enable row level security;

-- Grava uma mensagem (saída ou entrada). Devolve o id.
create or replace function orders.compras_email_registrar(p jsonb)
returns bigint language plpgsql security definer set search_path = compras, public as $$
declare v_id bigint; v_emp text;
begin
  select empresa into v_emp from compras.pedidos where id = (p->>'pedido_id')::bigint;
  if v_emp is null then raise exception 'pedido % não encontrado', p->>'pedido_id'; end if;
  insert into compras.emails (empresa, pedido_id, direcao, message_id, in_reply_to, de, para, cc, cco, assunto,
                              texto, html, anexos, enviado_por, resend_id, status)
  values (v_emp, (p->>'pedido_id')::bigint, p->>'direcao', p->>'message_id', p->>'in_reply_to', p->>'de',
          coalesce(array(select jsonb_array_elements_text(p->'para')), '{}'),
          coalesce(array(select jsonb_array_elements_text(p->'cc')), '{}'),
          coalesce(array(select jsonb_array_elements_text(p->'cco')), '{}'),
          p->>'assunto', p->>'texto', p->>'html', coalesce(p->'anexos', '[]'::jsonb), p->>'enviado_por',
          p->>'resend_id', coalesce(p->>'status', 'ok'))
  on conflict (direcao, resend_id) where resend_id is not null do nothing
  returning id into v_id;
  return v_id;
end $$;

-- Conversa de um pedido (mais antigo primeiro).
create or replace function orders.compras_emails(p_pedido bigint)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', e.id, 'direcao', e.direcao, 'messageId', e.message_id, 'inReplyTo', e.in_reply_to, 'de', e.de,
    'para', e.para, 'cc', e.cc, 'cco', e.cco, 'assunto', e.assunto, 'texto', e.texto, 'html', e.html,
    'anexos', e.anexos, 'por', e.enviado_por, 'status', e.status, 'lido', e.lido_em is not null, 'em', e.criado_em)
    order by e.criado_em, e.id), '[]'::jsonb)
  from compras.emails e where e.pedido_id = p_pedido
$$;

-- Marca as respostas do fornecedor de um pedido como lidas.
create or replace function orders.compras_emails_lidos(p_pedido bigint)
returns int language sql security definer set search_path = compras, public as $$
  with u as (update compras.emails set lido_em = now()
              where pedido_id = p_pedido and direcao = 'entrada' and lido_em is null returning 1)
  select count(*)::int from u
$$;

-- Pedidos com resposta do fornecedor ainda não lida: {pedido_id: n}.
create or replace function orders.compras_emails_nao_lidos()
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_object_agg(pedido_id::text, n), '{}'::jsonb)
    from (select pedido_id, count(*) n from compras.emails
           where direcao = 'entrada' and lido_em is null group by pedido_id) x
$$;

-- Último e-mail de saída do pedido (para encadear a resposta e saber quem avisar).
create or replace function orders.compras_email_ultimo_envio(p_pedido bigint)
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select to_jsonb(x) from (
    select e.message_id, e.assunto, e.enviado_por, e.para from compras.emails e
     where e.pedido_id = p_pedido and e.direcao = 'saida' and e.status <> 'erro'
     order by e.criado_em desc, e.id desc limit 1) x
$$;

revoke all on function orders.compras_email_registrar(jsonb), orders.compras_emails(bigint), orders.compras_emails_lidos(bigint),
  orders.compras_emails_nao_lidos(), orders.compras_email_ultimo_envio(bigint) from public, anon, authenticated;
grant execute on function orders.compras_email_registrar(jsonb), orders.compras_emails(bigint), orders.compras_emails_lidos(bigint),
  orders.compras_emails_nao_lidos(), orders.compras_email_ultimo_envio(bigint) to service_role;
grant usage on schema compras to service_role;
grant select, insert, update on compras.emails to service_role;
grant usage, select on sequence compras.emails_id_seq to service_role;

-- Anexos recebidos do fornecedor (privado; o painel serve por URL assinada).
insert into storage.buckets (id, name, public) values ('compras-emails', 'compras-emails', false)
on conflict (id) do nothing;

-- Cadastro (cadastros.pessoas) do fornecedor do pedido: id para abrir a ficha
-- por cima da folha e os e-mails atuais (o envio passa a ler daqui, não do espelho Omie).
create or replace function orders.compras_fornecedor_pessoa(p_empresa text, p_cod bigint, p_cnpj text)
returns jsonb language sql stable security definer set search_path = cadastros, public as $$
  with alvo as (
    select coalesce(x.mesclado_em, x.id) id from cadastros.pessoas x
     where x.empresa = p_empresa
       and ((p_cod is not null and (x.codigo_omie = p_cod or x.codigo = p_cod))
            or (nullif(regexp_replace(coalesce(p_cnpj, ''), '\D', '', 'g'), '') is not null
                and x.doc = regexp_replace(p_cnpj, '\D', '', 'g')))
     order by (x.codigo_omie = p_cod or x.codigo = p_cod) desc nulls last, x.mesclado_em nulls first, x.id
     limit 1)
  select jsonb_build_object('id', p.id, 'razao', p.razao_social, 'email', p.email, 'emailNfe', p.email_nfe,
                            'contatos', coalesce(p.contatos, '[]'::jsonb))
    from alvo a join cadastros.pessoas p on p.id = a.id
$$;
revoke all on function orders.compras_fornecedor_pessoa(text, bigint, text) from public, anon, authenticated;
grant execute on function orders.compras_fornecedor_pessoa(text, bigint, text) to service_role;

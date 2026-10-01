-- 33 — Casamento automático NF-e ↔ pedido, caixa "NF sem pedido" e fim da
--      etapa "Enviado ao fornecedor" (01/10/2026, decisões do Benny).
--
--   · Kanban: Requisição → Pedido de Compra (pendente|aprovado) → Faturado →
--     Recebido → Conferido. Aprovado = enviado ao fornecedor; o envio (e-mail,
--     WhatsApp) fica só registrado no histórico e em enviado_*, sem mover etapa.
--   · Quando uma NF-e chega pela Focus (import a cada 2h), compras.casar_nfs_focus
--     gera candidatas e compras.casar_auto confirma sozinho os casos seguros —
--     só para pedidos do PAINEL, aprovados, ainda em Pedido de Compra:
--       a) xPed da NF = número do pedido e mesmo fornecedor;
--       b) mesmo fornecedor, valor dentro de 1%, NF até 120 dias depois do
--          pedido e um único pedido nessas condições.
--     O pedido vai para "Faturado pelo fornecedor" e o histórico diz como casou.
--     O resto fica na caixa "NF sem pedido" (orders.compras_nfs_sem_pedido),
--     com sugestões, para casar à mão (orders.compras_nf_casar) — e dá para
--     desfazer (orders.compras_nf_descasar). O histórico do Omie segue como antes.

-- Envio não move mais etapa; quem estava em 35 volta para Pedido de Compra.
create or replace function orders.compras_marcar_enviado(p_id bigint, p_para text, p_meio text, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v compras.pedidos;
begin
  select * into v from compras.pedidos where id = p_id for update;
  if not found then raise exception 'Pedido % não existe', p_id; end if;
  if v.tipo <> 'PC' then raise exception 'Só pedido de compra é enviado ao fornecedor'; end if;
  if v.aprov_status <> 'aprovado' then raise exception 'Pedido ainda não aprovado — só pedido aprovado vai ao fornecedor'; end if;
  update compras.pedidos set enviado_em = now(), enviado_por = p_por, enviado_para = nullif(p_para, ''), enviado_meio = p_meio,
         updated_at = now(), updated_by = p_por where id = p_id;
  perform compras.add_hist(p_id, 'Enviado ao fornecedor' || case p_meio when 'email' then ' por e-mail' when 'whatsapp' then ' por WhatsApp' else '' end
                                 || coalesce(' para ' || nullif(p_para, ''), ''), p_por);
  return jsonb_build_object('id', p_id, 'etapa', v.etapa);
end $$;

update compras.pedidos set etapa = case when aprov_status = 'aprovado' then '15' else '10' end where origem = 'painel' and etapa = '35';
update compras.pedidos set etapa_manual = null, etapa = etapa_omie where origem = 'omie' and etapa = '35';

-- Liga uma NF (chave da Focus) a um pedido: vínculo confirmado, NF anexada ao
-- pedido (vários pedidos por NF e várias NF por pedido) e etapa ≥ Faturado.
create or replace function compras.ligar_nf(p_chave text, p_pedido bigint, p_por text, p_como text)
returns void language plpgsql security definer set search_path = compras, public as $$
declare f orders.focus_recebidos; v compras.pedidos; v_num text;
begin
  select * into f from orders.focus_recebidos where tipo = 'nfe' and chave = p_chave;
  if not found then raise exception 'NF-e % não está na Focus', p_chave; end if;
  select * into v from compras.pedidos where id = p_pedido for update;
  if not found or v.tipo <> 'PC' then raise exception 'Pedido de compra % não existe', p_pedido; end if;
  v_num := coalesce(nullif(ltrim(f.numero, '0'), ''), substr(p_chave, 26, 9));
  insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo, status, decidido_por, decidido_em)
  values (p_chave, p_pedido, 'resumo', 1, p_como, 'confirmado', p_por, now())
  on conflict (chave, pedido_id) do update set status = 'confirmado', decidido_por = p_por, decidido_em = now(),
    motivo = coalesce(compras.nf_vinculos.motivo, excluded.motivo);
  update compras.pedidos set
    nf = case when nf is null or nf = '' then v_num
              when v_num = any (string_to_array(replace(nf, ' ', ''), ',')) then nf else nf || ', ' || v_num end,
    chave_nfe = coalesce(chave_nfe, p_chave),
    dt_faturado = coalesce(dt_faturado, f.emissao::date),
    etapa = case when origem = 'painel' then compras.etapa_max(etapa, '40') else compras.etapa_max(etapa, '40') end,
    etapa_manual = case when origem = 'omie' then compras.etapa_max(etapa_manual, '40') else etapa_manual end,
    updated_at = now(), updated_by = p_por
  where id = p_pedido;
  perform compras.add_hist(p_pedido, 'NF-e ' || v_num || ' (' || to_char(f.valor, 'FM999G999G990D00') || ') ' || p_como, p_por);
end $$;

-- Confirmação automática dos casos seguros (só pedidos do painel).
create or replace function compras.casar_auto()
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare r record; n_xped int := 0; n_valor int := 0;
begin
  -- a) xPed = número do pedido, mesmo fornecedor
  for r in
    select v.chave, v.pedido_id from compras.nf_vinculos v
      join compras.pedidos p on p.id = v.pedido_id
     where v.status = 'sugerido' and v.origem = 'xped' and v.score >= 1
       and p.origem = 'painel' and p.tipo = 'PC' and not p.cancelado and p.aprov_status = 'aprovado' and p.etapa in ('10', '15')
       and not exists (select 1 from compras.nf_vinculos c where c.chave = v.chave and c.status = 'confirmado')
  loop
    perform compras.ligar_nf(r.chave, r.pedido_id, 'automático', 'casada automaticamente por xPed');
    n_xped := n_xped + 1;
  end loop;

  -- b) fornecedor + valor (±1%) + janela de datas, pedido único
  for r in
    with cand as (
      select f.chave, p.id as pedido_id,
             count(*) over (partition by f.chave) as n
        from orders.focus_recebidos f
        join compras.pedidos p on p.origem = 'painel' and p.tipo = 'PC' and not p.cancelado and p.aprov_status = 'aprovado'
                              and p.etapa in ('10', '15') and p.empresa = f.empresa
                              and regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g')
                              and abs(p.valor_total - f.valor) <= greatest(0.01 * f.valor, 0.05)
                              and f.emissao::date between p.emissao and p.emissao + 120
       where f.tipo = 'nfe' and lower(coalesce(f.situacao, '')) not in ('cancelada', 'denegada')
         and not exists (select 1 from compras.nf_vinculos c where c.chave = f.chave and c.status in ('confirmado'))
         and not exists (select 1 from compras.nf_vinculos c where c.chave = f.chave and c.pedido_id = p.id and c.status = 'descartado')
    )
    select chave, pedido_id from cand where n = 1
  loop
    perform compras.ligar_nf(r.chave, r.pedido_id, 'automático', 'casada automaticamente por fornecedor e valor');
    n_valor := n_valor + 1;
  end loop;
  return jsonb_build_object('por_xped', n_xped, 'por_valor', n_valor);
end $$;

-- Rodada completa: candidatas + automáticos (o que a lista e o import chamam).
create or replace function orders.compras_casar_nfs()
returns jsonb language sql security definer set search_path = compras, public as $$
  select compras.casar_nfs_focus() || compras.casar_auto()
$$;

create or replace function orders.compras_nf_casar(p_chave text, p_pedido bigint, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
begin
  perform compras.ligar_nf(p_chave, p_pedido, p_por, 'casada à mão');
  return jsonb_build_object('ok', true);
end $$;

-- Desfaz: vínculo descartado, NF sai do pedido; sem outra NF, volta ao Pedido de Compra.
create or replace function orders.compras_nf_descasar(p_chave text, p_pedido bigint, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
declare v_num text; v compras.pedidos; restam int;
begin
  select coalesce(nullif(ltrim(numero, '0'), ''), substr(p_chave, 26, 9)) into v_num from orders.focus_recebidos where tipo = 'nfe' and chave = p_chave;
  update compras.nf_vinculos set status = 'descartado', decidido_por = p_por, decidido_em = now()
   where chave = p_chave and pedido_id = p_pedido;
  select * into v from compras.pedidos where id = p_pedido for update;
  select count(*) into restam from compras.nf_vinculos where pedido_id = p_pedido and status = 'confirmado';
  update compras.pedidos set
    nf = nullif(array_to_string(array_remove(string_to_array(replace(coalesce(nf, ''), ' ', ''), ','), v_num), ', '), ''),
    chave_nfe = case when chave_nfe = p_chave then null else chave_nfe end,
    etapa = case when restam = 0 and origem = 'painel' and etapa = '40' then case when aprov_status = 'aprovado' then '15' else '10' end else etapa end,
    etapa_manual = case when restam = 0 and origem = 'omie' and etapa_manual = '40' then null else etapa_manual end,
    dt_faturado = case when restam = 0 then null else dt_faturado end,
    updated_at = now(), updated_by = p_por
  where id = p_pedido;
  update compras.pedidos set etapa = compras.etapa_max(etapa_omie, etapa_manual) where id = p_pedido and origem = 'omie';
  perform compras.add_hist(p_pedido, 'Casamento desfeito: NF-e ' || coalesce(v_num, right(p_chave, 9)), p_por);
  return jsonb_build_object('ok', true);
end $$;

-- NF dispensada de pedido (serviço, utilidade, frete, emergência): motivo
-- obrigatório, quem e quando. Sai do alarme e libera o pagamento.
create table if not exists compras.nf_dispensadas (
  chave  text primary key,
  motivo text not null,
  por    text not null,
  em     timestamptz not null default now()
);
alter table compras.nf_dispensadas enable row level security;
grant all on compras.nf_dispensadas to service_role;

create or replace function orders.compras_nf_dispensar(p_chave text, p_motivo text, p_por text)
returns jsonb language plpgsql security definer set search_path = compras, public as $$
begin
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Informe o motivo para dispensar a NF de pedido'; end if;
  insert into compras.nf_dispensadas (chave, motivo, por) values (p_chave, trim(p_motivo), p_por)
  on conflict (chave) do update set motivo = excluded.motivo, por = excluded.por, em = now();
  return jsonb_build_object('ok', true);
end $$;

-- Caixa "NF sem pedido": NF-e de mercadoria (modelo 55) da Focus sem pedido —
-- sem vínculo confirmado, não recebida por pedido do Omie, não dispensada e
-- sem pedido do Omie citado nela (xPed/texto, mesmo fornecedor: o histórico do
-- Omie segue o fluxo antigo). É isto que dispara o alarme "não pagar".
create or replace view compras.v_nf_sem_pedido as
select f.*
  from orders.focus_recebidos f
 where f.tipo = 'nfe' and substr(f.chave, 21, 2) = '55'
   and lower(coalesce(f.situacao, '')) not in ('cancelada', 'denegada')
   and not exists (select 1 from compras.nf_vinculos c where c.chave = f.chave and c.status = 'confirmado')
   and not exists (select 1 from compras.pedidos p where p.chave_nfe = f.chave)
   and not exists (select 1 from orders.recebimento_nfe r where r.chave_nfe = f.chave)
   and not exists (select 1 from compras.nf_dispensadas d where d.chave = f.chave)
   and not exists (select 1 from compras.nf_vinculos c join compras.pedidos p on p.id = c.pedido_id
                    where c.chave = f.chave and c.status = 'sugerido' and c.origem in ('xped', 'texto')
                      and c.score >= 1 and p.origem = 'omie');

create or replace function orders.compras_nfs_sem_pedido(p_empresa text default 'SF')
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'chave', f.chave, 'numero', coalesce(nullif(ltrim(f.numero, '0'), ''), substr(f.chave, 26, 9)),
           'emissao', f.emissao, 'chegou', f.primeiro_visto, 'valor', f.valor, 'emitente', f.emitente_nome, 'cnpj', f.emitente_doc,
           'completa', f.completa,
           'sugestoes', (select coalesce(jsonb_agg(jsonb_build_object('pedidoId', p.id, 'num', p.numero, 'forn', p.fornecedor_nome,
                                 'valor', p.valor_total, 'emissao', p.emissao, 'aprov', p.aprov_status, 'etapa', p.etapa,
                                 'origem', p.origem, 'score', v.score, 'motivo', v.motivo) order by v.score desc), '[]'::jsonb)
                           from compras.nf_vinculos v join compras.pedidos p on p.id = v.pedido_id
                          where v.chave = f.chave and v.status = 'sugerido' and not p.cancelado and p.etapa in ('10', '15', '35', '40'))
         ) order by f.emissao desc), '[]'::jsonb)
    from compras.v_nf_sem_pedido f where f.empresa = p_empresa
$$;

-- Para o alarme (banner, selo no menu) e para travar o pagamento.
create or replace function orders.compras_nf_sem_pedido_resumo()
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select jsonb_build_object('n', count(*), 'valor', coalesce(sum(valor), 0),
           'nfs', coalesce(jsonb_agg(jsonb_build_object('cnpj', regexp_replace(coalesce(emitente_doc, ''), '\D', '', 'g'),
                     'numero', coalesce(nullif(ltrim(numero, '0'), ''), ltrim(substr(chave, 26, 9), '0')), 'chave', chave)), '[]'::jsonb))
    from compras.v_nf_sem_pedido
$$;

-- NFs de cada pedido (para o cartão: o cartão é o PEDIDO; a NF é informação).
create or replace function orders.compras_nfs_por_pedido()
returns jsonb language sql stable security definer set search_path = compras, public as $$
  select coalesce(jsonb_object_agg(pedido_id, nfs), '{}'::jsonb) from (
    select v.pedido_id, jsonb_agg(jsonb_build_object('n', coalesce(nullif(ltrim(f.numero, '0'), ''), substr(f.chave, 26, 9)),
             'valor', f.valor, 'em', f.emissao, 'chave', f.chave, 'como', v.motivo, 'por', v.decidido_por) order by f.emissao) as nfs
      from compras.nf_vinculos v join orders.focus_recebidos f on f.tipo = 'nfe' and f.chave = v.chave
     where v.status = 'confirmado' group by v.pedido_id) z
$$;

do $$ declare f text;
begin
  for f in select p.oid::regprocedure::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where (n.nspname = 'orders' and p.proname like 'compras\_%') or n.nspname = 'compras' loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
    execute format('grant execute on function %s to service_role', f);
  end loop;
end $$;

-- 33b/33c (aplicadas logo depois): "tem pedido no Omie" = recebimento do Omie
-- com pedido ligado (id_pedido), casado por CNPJ do emitente + número da NF
-- (o recebimento não traz a chave; a NF de entrada do Omie não traz o pedido).
-- NF lançada no Omie SEM pedido continua no alarme.
create or replace view compras.v_nf_sem_pedido as
select f.*
  from orders.focus_recebidos f
 where f.tipo = 'nfe' and substr(f.chave, 21, 2) = '55'
   and lower(coalesce(f.situacao, '')) not in ('cancelada', 'denegada')
   and not exists (select 1 from compras.nf_vinculos c where c.chave = f.chave and c.status = 'confirmado')
   and not exists (select 1 from compras.pedidos p where p.chave_nfe = f.chave)
   and not exists (select 1 from orders.recebimento_nfe r
                    where r.empresa = f.empresa and coalesce(r.id_pedido, 0) <> 0
                      and (r.chave_nfe = f.chave
                           or (regexp_replace(coalesce(r.cnpj_cpf, ''), '\D', '', 'g') = regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g')
                               and ltrim(r.num_nfe, '0') = ltrim(coalesce(f.numero, ''), '0'))))
   and not exists (select 1 from compras.nf_dispensadas d where d.chave = f.chave)
   and not exists (select 1 from compras.nf_vinculos c join compras.pedidos p on p.id = c.pedido_id
                    where c.chave = f.chave and c.status = 'sugerido' and c.origem in ('xped', 'texto')
                      and c.score >= 1 and p.origem = 'omie');
revoke all on compras.v_nf_sem_pedido from public, anon, authenticated;
grant select on compras.v_nf_sem_pedido to service_role;

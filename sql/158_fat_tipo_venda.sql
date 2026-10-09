-- 158 · Faturamento: trocar o tipo da venda (Mix / Mercantil / Serviços) — pedido do Benny, 09/10/26
-- "permita mudar o tipo de venda para Mix, Mercantil ou Serviço na parte de faturamento"
-- "se muda para Mix em faturamento, ele chama o pessoal em serviço, da mesma forma como PV é criado da venda"
--
-- O tipo da venda é o "vendedor" (cadastros.aux registro='vendedores': Mix / Mercantil / Serviços — só a SF tem).
-- Quem lê o tipo é o codigo_vendedor do espelho de vendas (sales.pedidos_venda / sales.ordens_servico) →
-- approval.v_pc_completo.tipo_omie → approval.v_pc_avulsos. O app de Serviços (Painel de Vendas e avisos 8h/14h
-- da Aria) lista tudo o que é Mix/Serviços dali: é exatamente o caminho de quando o PV nasce Mix na venda
-- (orders.vendas_salvar → vendas.espelhar). Nada vai ao Omie.
--
-- Esta migração é ADITIVA: uma tabela de histórico e duas funções. Nada existente muda.
--   orders.fat_tipo_venda(empresa, chave)            → tipo atual, opções válidas, OS do app de Serviços, histórico
--   orders.fat_tipo_venda_trocar(empresa, chave, tipo, motivo, os_decisao, por, simular)
--        simular=true devolve o que vai acontecer sem gravar nada (a tela confirma antes).
-- Chaves da carteira: venda:<id> (PV/OS do painel), pv_omie:<codigo_pedido>, os_omie:<codigo_os>.
-- Regras (as mesmas da sql/145):
--   PV → Mix (com serviço da equipe) ou Mercantil (só material). PV não vira "Serviços": serviço puro é OS.
--   OS → Serviços ou Mix. OS não vira "Mercantil": material vendido sai num PV (NF-e).
--   Cancelado não muda. Saindo de Mix/Serviços com OS já gerada no app de Serviços → pede a decisão (os_decisao='manter').

create table if not exists orders.fat_tipo_venda_hist (
  id bigserial primary key,
  empresa text not null,
  chave text not null,
  rotulo text,
  de_codigo text,
  de_nome text,
  para_codigo text not null,
  para_nome text not null,
  os_servicos text,
  os_decisao text,
  motivo text,
  por text not null,
  em timestamptz not null default now()
);
create index if not exists fat_tipo_venda_hist_chave on orders.fat_tipo_venda_hist (empresa, chave, em desc);
alter table orders.fat_tipo_venda_hist enable row level security;
revoke all on orders.fat_tipo_venda_hist from anon, authenticated;
grant select, insert on orders.fat_tipo_venda_hist to service_role;
grant usage, select on sequence orders.fat_tipo_venda_hist_id_seq to service_role;

-- Documento da chave: tipo (PV/OS), rótulo, vendedor atual, status. Interno.
create or replace function orders.fat_tipo_venda_doc(p_empresa text, p_chave text)
returns jsonb language plpgsql stable security definer set search_path to 'orders', 'public' as $f$
declare v_k text := split_part(p_chave, ':', 1); v_id text := split_part(p_chave, ':', 2); r record;
begin
  if v_k = 'venda' then
    select d.id, d.tipo, d.tipo || d.numero as rotulo, d.vendedor_codigo as vend, d.status, d.empresa,
           (select pj.nome from finance.projetos pj where pj.empresa = d.empresa and pj.codigo::text = d.projeto_codigo::text limit 1) as pj
      into r from vendas.documentos d where d.id = nullif(v_id, '')::bigint;
    if not found then raise exception 'Documento % não encontrado', p_chave; end if;
    return jsonb_build_object('fonte', 'venda', 'id', r.id, 'tipo', r.tipo, 'rotulo', r.rotulo, 'vendedor', r.vend,
      'cancelado', r.status = 'cancelado', 'faturado', r.status = 'faturado', 'empresa', r.empresa, 'projeto', r.pj);
  elsif v_k = 'pv_omie' then
    select p.codigo_pedido, 'PV' || p.numero_pedido as rotulo, p.codigo_vendedor as vend, p.cod_pedido_integracao as integ,
           coalesce(e.cancelado, 'N') = 'S' as canc, coalesce(e.faturado, 'N') = 'S' as fat,
           (select pj.nome from finance.projetos pj where pj.empresa = p.empresa and pj.codigo::text = p.codigo_projeto::text limit 1) as pj
      into r from sales.pedidos_venda p
      left join sales.etapas_pedidos e on e.empresa = p.empresa and e.codigo_pedido = p.codigo_pedido
     where p.empresa = upper(p_empresa) and p.codigo_pedido = nullif(v_id, '')::bigint limit 1;
    if not found then raise exception 'PV % não encontrado no espelho de vendas', p_chave; end if;
    return jsonb_build_object('fonte', 'pv_omie', 'id', r.codigo_pedido, 'tipo', 'PV', 'rotulo', r.rotulo, 'vendedor', r.vend,
      'cancelado', r.canc, 'faturado', r.fat, 'empresa', upper(p_empresa), 'integracao', r.integ, 'projeto', r.pj);
  elsif v_k = 'os_omie' then
    select o.codigo_os, 'OS' || max(o.numero_os) as rotulo, max(o.codigo_vendedor) as vend,
           bool_or(coalesce(o.cancelada, 'N') = 'S') as canc, bool_or(coalesce(o.faturada, 'N') = 'S') as fat,
           (select pj.nome from finance.projetos pj where pj.empresa = upper(p_empresa) and pj.codigo::text = max(o.codigo_projeto)::text limit 1) as pj
      into r from sales.ordens_servico o
     where o.empresa = upper(p_empresa) and o.codigo_os = v_id group by o.codigo_os;
    if not found then raise exception 'OS % não encontrada no espelho de vendas', p_chave; end if;
    return jsonb_build_object('fonte', 'os_omie', 'id', r.codigo_os, 'tipo', 'OS', 'rotulo', r.rotulo, 'vendedor', r.vend,
      'cancelado', r.canc, 'faturado', r.fat, 'empresa', upper(p_empresa), 'projeto', r.pj);
  end if;
  raise exception 'Chave inválida: %', p_chave;
end $f$;

create or replace function orders.fat_tipo_venda(p_empresa text, p_chave text)
returns jsonb language plpgsql stable security definer set search_path to 'orders', 'public' as $f$
declare d jsonb; v_emp text := upper(coalesce(p_empresa, 'SF')); v_tipos jsonb; v_atual text; v_os record; v_hist jsonb;
begin
  d := orders.fat_tipo_venda_doc(v_emp, p_chave);
  select jsonb_object_agg(nome, codigo) into v_tipos from cadastros.aux
   where registro = 'vendedores' and empresa = v_emp and nome in ('Mix', 'Mercantil', 'Serviços') and not coalesce(inativo, false);
  if v_tipos is null or (select count(*) from jsonb_object_keys(v_tipos)) < 3 then
    return jsonb_build_object('disponivel', false, 'motivo', format('A empresa %s não usa tipo da venda (Mix/Mercantil/Serviços)', v_emp), 'doc', d);
  end if;
  select k into v_atual from jsonb_each_text(v_tipos) t(k, v) where v = d->>'vendedor';
  select max(a.servicos_os_numero) as os, max(a.custom_fields->>'ww_os_status') as st into v_os
    from approval.approvals a where a.empresa = v_emp and a.pv_os_label = d->>'rotulo';
  select coalesce(jsonb_agg(jsonb_build_object('de', h.de_nome, 'para', h.para_nome, 'por', h.por, 'em', h.em, 'motivo', h.motivo, 'os_decisao', h.os_decisao) order by h.em desc), '[]')
    into v_hist from (select * from orders.fat_tipo_venda_hist where empresa = v_emp and chave = p_chave order by em desc limit 10) h;
  return jsonb_build_object('disponivel', true, 'doc', d, 'atual', v_atual, 'codigos', v_tipos,
    'opcoes', case when d->>'tipo' = 'PV' then '["Mix","Mercantil"]'::jsonb else '["Serviços","Mix"]'::jsonb end,
    'os_servicos', v_os.os, 'os_status', v_os.st, 'historico', v_hist);
end $f$;

create or replace function orders.fat_tipo_venda_trocar(p_empresa text, p_chave text, p_tipo text, p_motivo text, p_os_decisao text, p_por text, p_simular boolean default false)
returns jsonb language plpgsql security definer set search_path to 'orders', 'public' as $f$
declare i jsonb; d jsonb; v_emp text := upper(coalesce(p_empresa, 'SF')); v_para text; v_de text; v_rot text; v_tipo text;
  v_efeitos jsonb := '[]'; v_serv_antes boolean; v_serv_depois boolean; v_os text; v_pj boolean;
begin
  i := orders.fat_tipo_venda(v_emp, p_chave);
  if not coalesce((i->>'disponivel')::boolean, false) then raise exception '%', i->>'motivo'; end if;
  d := i->'doc'; v_rot := d->>'rotulo'; v_tipo := d->>'tipo'; v_de := i->>'atual'; v_os := i->>'os_servicos';
  if p_tipo not in ('Mix', 'Mercantil', 'Serviços') then raise exception 'Tipo inválido: % (use Mix, Mercantil ou Serviços)', p_tipo; end if;
  if (d->>'cancelado')::boolean then raise exception '% está cancelado — o tipo não muda', v_rot; end if;
  if v_tipo = 'PV' and p_tipo = 'Serviços' then
    raise exception '% é pedido de venda (NF-e de produto). Se tem serviço da nossa equipe junto, escolha Mix — o pedido vai para a área de Serviços. Se é só serviço, ele deveria ser uma OS: crie em Nova emissão › Recibo de serviço (OS)', v_rot;
  end if;
  if v_tipo = 'OS' and p_tipo = 'Mercantil' then
    raise exception '% é ordem de serviço. Mercantil é venda só de material, que sai num PV (NF-e): crie em Nova emissão › NF-e. Para OS escolha Serviços ou Mix', v_rot;
  end if;
  if v_de is not distinct from p_tipo then raise exception '% já é %', v_rot, p_tipo; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo da troca (mín. 5 caracteres)'; end if;
  v_para := i->'codigos'->>p_tipo;
  v_serv_antes := v_de in ('Mix', 'Serviços');
  v_serv_depois := p_tipo in ('Mix', 'Serviços');
  -- pedido de projeto (PJ…) não está no Painel de Vendas do app de Serviços: segue pelo módulo de Projetos
  v_pj := coalesce(d->>'projeto', '') ~ '^PJ';

  if v_pj and v_serv_depois <> v_serv_antes then
    v_efeitos := v_efeitos || jsonb_build_array(format('%s é de projeto (%s): o serviço segue pelo módulo de Projetos — o Painel de Vendas do app de Serviços só lista vendas avulsas', v_rot, d->>'projeto'));
  elsif v_serv_depois and not v_serv_antes then
    v_efeitos := v_efeitos || jsonb_build_array(format('%s passa a aparecer para a área de Serviços: Painel de Vendas do app (app.waterworks.com.br/painel-de-vendas), onde a equipe gera a OS e agenda — o mesmo caminho do PV que nasce Mix na venda', v_rot),
      'entra nos avisos das 8h/14h da Aria ("agendar no prazo vendido") até ter OS');
    if v_os is not null then v_efeitos := v_efeitos || jsonb_build_array(format('já existe a OS %s ligada a %s no app de Serviços — nada é criado de novo', v_os, v_rot)); end if;
  elsif v_serv_antes and not v_serv_depois then
    v_efeitos := v_efeitos || jsonb_build_array(format('%s sai do Painel de Vendas do app de Serviços e dos avisos da Aria', v_rot));
    if v_os is not null then
      if coalesce(p_os_decisao, '') <> 'manter' then
        raise exception using errcode = 'P0T01',
          message = format('%s já tem a OS %s (%s) no app de Serviços. Trocar para %s tira o pedido do painel de Serviços, mas NÃO cancela a OS. Confirme o que fazer com a OS.', v_rot, v_os, coalesce(i->>'os_status', 'sem status'), p_tipo),
          detail = jsonb_build_object('os', v_os, 'status', i->>'os_status', 'rotulo', v_rot)::text;
      end if;
      v_efeitos := v_efeitos || jsonb_build_array(format('a OS %s continua no app de Serviços — avise a equipe para cancelar lá se o serviço não vai acontecer', v_os));
    end if;
  else
    v_efeitos := v_efeitos || jsonb_build_array(format('%s continua na área de Serviços (Mix e Serviços aparecem lá)', v_rot));
  end if;
  v_efeitos := v_efeitos || jsonb_build_array(
    format('o documento fiscal não muda: %s', case when v_tipo = 'PV' then 'PV sai em NF-e de produto (mesma natureza e CFOP)' else 'OS sai em recibo/NFS-e' end),
    'BI (margem, compras por cliente) e a tela de Operação passam a mostrar o tipo novo',
    'nada é enviado ao Omie');

  if p_simular then
    return jsonb_build_object('simulado', true, 'rotulo', v_rot, 'de', v_de, 'para', p_tipo, 'os_servicos', v_os, 'efeitos', v_efeitos);
  end if;

  if d->>'fonte' = 'venda' then
    update vendas.documentos set vendedor_codigo = v_para, servico_incluso = v_serv_depois, atualizado_por = p_por, atualizado_em = now()
     where id = (d->>'id')::bigint;
    perform vendas.espelhar((d->>'id')::bigint);
  elsif d->>'fonte' = 'pv_omie' then
    update sales.pedidos_venda set codigo_vendedor = v_para where empresa = v_emp and codigo_pedido = (d->>'id')::bigint;
    -- PV do painel espelhado: o documento nativo também
    update vendas.documentos set vendedor_codigo = v_para, servico_incluso = v_serv_depois, atualizado_por = p_por, atualizado_em = now()
     where 'painel:' || id = d->>'integracao';
  else
    update sales.ordens_servico set codigo_vendedor = v_para where empresa = v_emp and codigo_os = d->>'id';
  end if;

  insert into orders.fat_tipo_venda_hist (empresa, chave, rotulo, de_codigo, de_nome, para_codigo, para_nome, os_servicos, os_decisao, motivo, por)
  values (v_emp, p_chave, v_rot, d->>'vendedor', v_de, v_para, p_tipo, v_os, nullif(p_os_decisao, ''), trim(p_motivo), p_por);

  return jsonb_build_object('ok', true, 'rotulo', v_rot, 'de', v_de, 'para', p_tipo, 'os_servicos', v_os, 'efeitos', v_efeitos);
end $f$;

revoke all on function orders.fat_tipo_venda_doc(text, text) from public, anon, authenticated;
revoke all on function orders.fat_tipo_venda(text, text) from public, anon, authenticated;
revoke all on function orders.fat_tipo_venda_trocar(text, text, text, text, text, text, boolean) from public, anon, authenticated;
grant execute on function orders.fat_tipo_venda_doc(text, text) to service_role;
grant execute on function orders.fat_tipo_venda(text, text) to service_role;
grant execute on function orders.fat_tipo_venda_trocar(text, text, text, text, text, text, boolean) to service_role;

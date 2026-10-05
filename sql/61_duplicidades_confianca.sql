-- Cadastros › Duplicidades: "Muito provável" × "Duvidoso" (05/10/26).
--
-- O Benny só quer conferir os duvidosos. Cada grupo de duplicados ganha uma
-- confiança calculada pelas provas entre as linhas (e-mail, telefone, CEP,
-- endereço, IE, uso) e pelas contra-provas (cidades/UF/IE diferentes, ambos em
-- uso com contatos diferentes, CNPJs diferentes).
--   Muito provável = nenhuma contra-prova E (contato/endereço em comum OU uma
--                    linha sem uso nenhum). Nome só parecido exige contato/endereço.
--   Duvidoso       = o resto.
-- Os grupos ficam pré-calculados em cadastros.dup_grupos (cron de hora a hora +
-- a pedido), para a tela abrir rápido. "Mesclar todos os prováveis" corre em lote
-- com id de lote, auditado e desfazível ("Desfazer este lote"). Nada é mesclado
-- sozinho: quem clica é o administrador.

alter table cadastros.mesclas add column if not exists lote_id text;
create index if not exists mesclas_lote_idx on cadastros.mesclas (lote_id) where lote_id is not null;

create table if not exists cadastros.dup_grupos (
  chave         text primary key,
  tipo          text not null,               -- nome_igual | outra_empresa | parecido
  empresa       text,
  ids           bigint[] not null,
  sobrevivente  bigint,
  nivel         text,                        -- provavel | duvidoso | null (outra_empresa: agrupar)
  score         int not null default 0,
  motivos       jsonb not null default '[]'::jsonb,   -- [{t, tom: ok|warn|bad|info}]
  membros       jsonb not null default '[]'::jsonb,
  atualizado_em timestamptz not null default now()
);
create index if not exists dup_grupos_ids_idx on cadastros.dup_grupos using gin (ids);
alter table cadastros.dup_grupos enable row level security;
revoke all on cadastros.dup_grupos from public, anon, authenticated;
grant all on cadastros.dup_grupos to service_role;

create table if not exists cadastros.dup_lotes (
  lote_id     text primary key,
  motivo      text,
  por         text,
  em          timestamptz not null default now(),
  grupos      int not null default 0,
  mesclas     int not null default 0,
  erros       jsonb not null default '[]'::jsonb,
  desfeito_em timestamptz,
  desfeito_por text
);
alter table cadastros.dup_lotes enable row level security;
revoke all on cadastros.dup_lotes from public, anon, authenticated;
grant all on cadastros.dup_lotes to service_role;

-- Normalizações usadas nas provas.
create or replace function cadastros.so_digitos(t text) returns text
language sql immutable as $$ select nullif(regexp_replace(coalesce(t, ''), '\D', '', 'g'), '') $$;

create or replace function cadastros.fone_chave(t text) returns text
language sql immutable as $$
  select case when length(cadastros.so_digitos(t)) >= 8 then right(cadastros.so_digitos(t), 8) end
$$;

create or replace function cadastros.email_norm(t text) returns text
language sql immutable as $$
  select nullif(lower(trim(split_part(replace(coalesce(t, ''), ',', ';'), ';', 1))), '')
$$;

create or replace function cadastros.email_dominio(t text) returns text
language sql immutable as $$
  select case when d is null or d in ('gmail.com','hotmail.com','outlook.com','yahoo.com','yahoo.com.br','uol.com.br',
      'bol.com.br','terra.com.br','live.com','icloud.com','ig.com.br','globo.com','msn.com','hotmail.com.br','outlook.com.br')
    then null else d end
  from (select nullif(split_part(cadastros.email_norm(t), '@', 2), '') d) z
$$;

create or replace function cadastros.texto_norm(t text) returns text
language sql immutable as $$
  select nullif(regexp_replace(translate(lower(coalesce(t, '')), 'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn'),
                               '[^a-z0-9]', '', 'g'), '')
$$;

-- Recalcula todos os grupos (cron + a pedido).
create or replace function orders.cadastros_dup_refresh() returns jsonb
language plpgsql volatile security definer set search_path to 'cadastros', 'public' as $$
declare n int;
begin
  perform set_config('pg_trgm.similarity_threshold', '0.85', true);
  create temp table if not exists _dup_g (tipo text, chave text, ids bigint[]) on commit drop;
  truncate _dup_g;

  insert into _dup_g
  with ativos as (
    select p.*, cadastros.nome_chave(p.razao_social) nk from cadastros.pessoas p where p.mesclado_em is null
  )
  select 'nome_igual', empresa || ':' || nk, array_agg(id order by id)
    from ativos where nk is not null
   group by empresa, nk
  having count(*) > 1 and count(distinct doc) <= 1
  union all
  select 'outra_empresa', nk, array_agg(id order by (doc is not null) desc, empresa, id)
    from ativos where nk is not null
   group by nk
  having count(distinct empresa) > 1 and count(distinct entidade_id) > 1 and count(distinct doc) <= 1;

  insert into _dup_g
  select 'parecido', a.id || '-' || b.id, array[a.id, b.id]
    from cadastros.pessoas a
    join cadastros.pessoas b on cadastros.nome_chave(b.razao_social) % cadastros.nome_chave(a.razao_social)
                            and b.empresa = a.empresa and b.id > a.id and b.mesclado_em is null
                            and cadastros.nome_chave(b.razao_social) <> cadastros.nome_chave(a.razao_social)
   where a.mesclado_em is null and (a.doc is null or b.doc is null)
   limit 2000;

  -- tira os pares marcados "não é duplicado"
  delete from _dup_g t
   where not exists (select 1 from unnest(t.ids) x, unnest(t.ids) y
                      where x < y and not exists (select 1 from cadastros.duplicidade_ignorada i where i.a = x and i.b = y));

  delete from cadastros.dup_grupos;

  insert into cadastros.dup_grupos (chave, tipo, empresa, ids, sobrevivente, nivel, score, motivos, membros, atualizado_em)
  with uso as (  -- quanto cada código é usado (PCs, títulos, PV/OS, contratos)
    select empresa, cod, sum(n)::int n from (
      select empresa, fornecedor_cod::text cod, count(*) n from compras.pedidos group by 1, 2
      union all select empresa, codigo_cliente_fornecedor::text, count(*) from finance.contas_pagar group by 1, 2
      union all select empresa, codigo_cliente_fornecedor::text, count(*) from finance.contas_receber group by 1, 2
      union all select empresa, codigo_cliente_omie::text, count(*) from finance.receber group by 1, 2
      union all select empresa, fornecedor_cod::text, count(*) from finance.pagar_previsto group by 1, 2
      union all select empresa, codigo_cliente::text, count(*) from sales.pedidos_venda group by 1, 2
      union all select empresa, codigo_cliente::text, count(*) from sales.ordens_servico group by 1, 2
      union all select empresa, codigo_cliente::text, count(*) from sales.contratos_servico group by 1, 2
      union all select empresa, cliente_codigo::text, count(*) from vendas.documentos group by 1, 2
    ) z where cod is not null group by 1, 2
  ),
  m as (
    select g.tipo, g.chave, p.id, p.empresa, p.codigo, p.origem, p.razao_social, p.nome_fantasia, p.cnpj_cpf, p.doc,
           p.cidade, p.uf, p.eh_cliente, p.eh_fornecedor, p.ativo, p.entidade_id, p.created_at,
           p.email, p.telefone, p.cep, p.logradouro, p.numero, p.inscricao_estadual,
           coalesce(u.n, 0) uso,
           cadastros.email_norm(p.email) em, cadastros.email_dominio(p.email) dom,
           case when length(cadastros.so_digitos(p.cep)) = 8 then cadastros.so_digitos(p.cep) end cepn,
           case when cadastros.texto_norm(p.logradouro) is not null and cadastros.so_digitos(p.numero) is not null
                then cadastros.texto_norm(p.logradouro) || '#' || cadastros.so_digitos(p.numero) end endn,
           case when cadastros.so_digitos(p.inscricao_estadual) is not null and length(cadastros.so_digitos(p.inscricao_estadual)) >= 5
                then cadastros.so_digitos(p.inscricao_estadual) end ien,
           cadastros.texto_norm(p.cidade) cidn, upper(nullif(trim(p.uf), '')) ufn,
           array_remove(array[cadastros.fone_chave(p.telefone), cadastros.fone_chave(p.telefone2)], null) fones
      from _dup_g g
      cross join lateral unnest(g.ids) x(id)
      join cadastros.pessoas p on p.id = x.id
      left join uso u on u.empresa = p.empresa and u.cod = p.codigo::text
  ),
  fone_comum as (
    select chave from (select distinct chave, id, f from m, unnest(fones) f) z group by chave, f having count(distinct id) > 1
  ),
  ev as (
    select tipo, chave,
      count(distinct doc) filter (where doc is not null) > 1                         c_docs,
      count(distinct cidn) filter (where cidn is not null) > 1                       c_cidade,
      count(distinct ufn) filter (where ufn is not null) > 1                         c_uf,
      count(distinct ien) filter (where ien is not null) > 1                         c_ie,
      count(em) filter (where em is not null) > count(distinct em) filter (where em is not null)       p_email,
      count(dom) filter (where dom is not null) > count(distinct dom) filter (where dom is not null)   p_dominio,
      chave in (select chave from fone_comum)                                        p_fone,
      count(cepn) filter (where cepn is not null) > count(distinct cepn) filter (where cepn is not null) p_cep,
      count(endn) filter (where endn is not null) > count(distinct endn) filter (where endn is not null) p_end,
      count(ien) filter (where ien is not null) > count(distinct ien) filter (where ien is not null)   p_ie,
      bool_or(doc is not null) and bool_or(doc is null)                              p_um_doc,
      bool_or(uso = 0)                                                               p_orfao,
      min(uso) >= 5                                                                  ambos_uso,
      count(distinct em) filter (where em is not null) > 1 or
        count(distinct fones) filter (where cardinality(fones) > 0) > 1              contatos_dif
    from m group by tipo, chave
  ),
  cl as (
    select e.*,
      (p_email or p_dominio or p_fone or p_cep or p_end or p_ie) contato,
      (c_docs or c_cidade or c_uf or c_ie or (ambos_uso and contatos_dif and not (p_email or p_fone))) contra
    from ev e
  )
  select g.chave, g.tipo,
    case when g.tipo <> 'outra_empresa' then (select min(empresa) from m where m.chave = g.chave) end,
    g.ids,
    (select id from m where m.chave = g.chave order by uso desc, (doc is not null) desc, created_at, id limit 1),
    case when g.tipo = 'outra_empresa' then null
         when not c.contra and (c.contato or (c.p_orfao and g.tipo = 'nome_igual')) then 'provavel'
         else 'duvidoso' end,
    greatest(0, least(100,
        (case when c.p_email then 30 else 0 end) + (case when c.p_fone then 25 else 0 end)
      + (case when c.p_cep or c.p_end then 20 else 0 end) + (case when c.p_ie then 20 else 0 end)
      + (case when c.p_dominio and not c.p_email then 10 else 0 end)
      + (case when c.p_orfao then 15 else 0 end) + (case when c.p_um_doc then 10 else 0 end)
      + (case when g.tipo = 'nome_igual' then 10 else 0 end)
      - (case when c.contra then 50 else 0 end))),
    (select coalesce(jsonb_agg(jsonb_build_object('t', t, 'tom', tom)), '[]'::jsonb) from (values
        (g.tipo = 'nome_igual', 'nome idêntico', 'info'),
        (g.tipo = 'parecido', 'nome só parecido', 'warn'),
        (c.p_email, 'mesmo e-mail', 'ok'),
        (c.p_dominio and not c.p_email, 'mesmo domínio de e-mail', 'ok'),
        (c.p_fone, 'mesmo telefone', 'ok'),
        (c.p_cep, 'mesmo CEP', 'ok'),
        (c.p_end, 'mesmo endereço', 'ok'),
        (c.p_ie, 'mesma IE', 'ok'),
        (c.p_orfao, 'um sem uso', 'ok'),
        (c.p_um_doc, 'um com CNPJ/CPF, outro sem', 'info'),
        (c.c_docs, 'CNPJs diferentes', 'bad'),
        (c.c_cidade, 'cidades diferentes', 'bad'),
        (c.c_uf, 'UF diferente', 'bad'),
        (c.c_ie, 'IE diferentes', 'bad'),
        (c.ambos_uso and c.contatos_dif and not (c.p_email or c.p_fone), 'ambos em uso, contatos diferentes', 'bad')
      ) v(ok, t, tom) where ok),
    (select jsonb_agg(jsonb_build_object('id', id, 'empresa', empresa, 'codigo', codigo, 'origem', origem,
              'razao', razao_social, 'fantasia', nome_fantasia, 'doc', cnpj_cpf, 'cidade', cidade, 'uf', uf,
              'cliente', eh_cliente, 'fornecedor', eh_fornecedor, 'ativo', ativo, 'entidade', entidade_id,
              'criadoEm', created_at, 'uso', uso, 'email', email, 'telefone', telefone, 'cep', cep)
              order by array_position(g.ids, id)) from m where m.chave = g.chave),
    now()
  from _dup_g g join cl c on c.chave = g.chave and c.tipo = g.tipo;

  get diagnostics n = row_count;
  return jsonb_build_object('grupos', n, 'em', now());
end $$;

-- Lista rápida (lê a tabela pré-calculada).
create or replace function orders.cadastros_duplicidades_v2(p_lim int default 2000) returns jsonb
language sql stable security definer set search_path to 'cadastros', 'public' as $$
  select jsonb_build_object(
    'resumo', jsonb_build_object(
      'provavel', (select count(*) from cadastros.dup_grupos where nivel = 'provavel'),
      'duvidoso', (select count(*) from cadastros.dup_grupos where nivel = 'duvidoso'),
      'nomeIgual', (select count(*) from cadastros.dup_grupos where tipo = 'nome_igual'),
      'parecido', (select count(*) from cadastros.dup_grupos where tipo = 'parecido'),
      'outraEmpresa', (select count(*) from cadastros.dup_grupos where tipo = 'outra_empresa'),
      'ignorados', (select count(*) from cadastros.duplicidade_ignorada),
      'pessoas', (select count(*) from cadastros.pessoas where mesclado_em is null),
      'entidades', (select count(distinct entidade_id) from cadastros.pessoas where mesclado_em is null),
      'entidadesMultiEmpresa', (select count(*) from (select entidade_id from cadastros.pessoas where mesclado_em is null
                                  group by 1 having count(distinct empresa) > 1) z),
      'mesclas', (select count(*) from cadastros.mesclas where desfeita_em is null),
      'atualizadoEm', (select max(atualizado_em) from cadastros.dup_grupos)),
    'grupos', coalesce((select jsonb_agg(jsonb_build_object('tipo', tipo, 'chave', chave, 'nivel', nivel, 'score', score,
          'motivos', motivos, 'sobrevivente', sobrevivente, 'membros', membros)
          order by case nivel when 'provavel' then 0 when 'duvidoso' then 1 else 2 end, score desc, chave)
        from (select * from cadastros.dup_grupos
               order by case nivel when 'provavel' then 0 when 'duvidoso' then 1 else 2 end, score desc, chave
               limit greatest(1, least(coalesce(p_lim, 2000), 5000))) g), '[]'::jsonb),
    'ignorados', coalesce((select jsonb_agg(jsonb_build_object('a', i.a, 'b', i.b, 'por', i.por, 'em', i.em,
          'razaoA', pa.razao_social, 'razaoB', pb.razao_social, 'empresa', pa.empresa) order by i.em desc)
        from (select * from cadastros.duplicidade_ignorada order by em desc limit 300) i
        left join cadastros.pessoas pa on pa.id = i.a left join cadastros.pessoas pb on pb.id = i.b), '[]'::jsonb),
    'feitas', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'tipo', m.tipo, 'sobrevivente', m.sobrevivente_id,
          'absorvido', m.absorvido_id, 'empresa', m.empresa, 'codigoAntigo', m.codigo_antigo, 'codigoNovo', m.codigo_novo,
          'razao', (select razao_social from cadastros.pessoas where id = m.sobrevivente_id),
          'motivo', m.motivo, 'por', m.por, 'em', m.em, 'desfeitaEm', m.desfeita_em, 'lote', m.lote_id) order by m.em desc)
        from (select * from cadastros.mesclas order by em desc limit 100) m), '[]'::jsonb),
    'lotes', coalesce((select jsonb_agg(to_jsonb(l) order by l.em desc)
        from (select * from cadastros.dup_lotes order by em desc limit 20) l), '[]'::jsonb))
$$;

-- Tira da lista os grupos que contêm estes cadastros (depois de mesclar/ignorar).
create or replace function orders.cadastros_dup_tirar(p_ids bigint[]) returns int
language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare n int;
begin
  delete from cadastros.dup_grupos where ids && p_ids;
  get diagnostics n = row_count;
  return n;
end $$;

-- "Mesclar todos os prováveis": um lote, auditado, desfazível.
-- p_chaves null = todos os prováveis; senão só esses grupos (têm de ser prováveis).
create or replace function orders.cadastros_mesclar_provaveis(p_chaves text[], p_motivo text, p_por text)
returns jsonb language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare v_lote text := 'L' || to_char(clock_timestamp(), 'YYYYMMDDHH24MISSMS');
        g cadastros.dup_grupos; v_id bigint; r jsonb; v_ok int := 0; v_gr int := 0; v_err jsonb := '[]'::jsonb; v_feito boolean;
begin
  if nullif(trim(p_motivo), '') is null then raise exception 'Informe o motivo'; end if;
  for g in select * from cadastros.dup_grupos
            where nivel = 'provavel' and tipo <> 'outra_empresa' and (p_chaves is null or chave = any(p_chaves))
            order by chave loop
    v_feito := false;
    foreach v_id in array g.ids loop
      continue when v_id = g.sobrevivente;
      begin
        r := orders.cadastros_mesclar(g.sobrevivente, v_id, p_motivo || ' [lote ' || v_lote || ']', p_por);
        update cadastros.mesclas set lote_id = v_lote where id = (r->>'id')::bigint;
        v_ok := v_ok + 1; v_feito := true;
      exception when others then
        v_err := v_err || jsonb_build_array(jsonb_build_object('grupo', g.chave, 'id', v_id, 'erro', sqlerrm));
      end;
    end loop;
    if v_feito then v_gr := v_gr + 1; end if;
    delete from cadastros.dup_grupos where chave = g.chave;
  end loop;
  insert into cadastros.dup_lotes (lote_id, motivo, por, grupos, mesclas, erros)
  values (v_lote, p_motivo, p_por, v_gr, v_ok, v_err);
  return jsonb_build_object('lote', v_lote, 'grupos', v_gr, 'mesclas', v_ok, 'erros', v_err);
end $$;

create or replace function orders.cadastros_desfazer_lote(p_lote text, p_por text) returns jsonb
language plpgsql security definer set search_path to 'cadastros', 'public' as $$
declare v_id bigint; v_n int := 0;
begin
  if not exists (select 1 from cadastros.dup_lotes where lote_id = p_lote) then raise exception 'Lote % não encontrado', p_lote; end if;
  for v_id in select id from cadastros.mesclas where lote_id = p_lote and desfeita_em is null order by id desc loop
    perform orders.cadastros_desfazer_mescla(v_id, p_por);
    v_n := v_n + 1;
  end loop;
  update cadastros.dup_lotes set desfeito_em = now(), desfeito_por = p_por where lote_id = p_lote;
  perform orders.cadastros_dup_refresh();
  return jsonb_build_object('lote', p_lote, 'desfeitas', v_n);
end $$;

revoke all on function orders.cadastros_dup_refresh() from public, anon, authenticated;
revoke all on function orders.cadastros_duplicidades_v2(int) from public, anon, authenticated;
revoke all on function orders.cadastros_dup_tirar(bigint[]) from public, anon, authenticated;
revoke all on function orders.cadastros_mesclar_provaveis(text[], text, text) from public, anon, authenticated;
revoke all on function orders.cadastros_desfazer_lote(text, text) from public, anon, authenticated;
grant execute on function orders.cadastros_dup_refresh() to service_role;
grant execute on function orders.cadastros_duplicidades_v2(int) to service_role;
grant execute on function orders.cadastros_dup_tirar(bigint[]) to service_role;
grant execute on function orders.cadastros_mesclar_provaveis(text[], text, text) to service_role;
grant execute on function orders.cadastros_desfazer_lote(text, text) to service_role;

-- Recalcula de hora a hora (ao minuto 45, depois do sync do Omie ao 35).
select cron.schedule('cadastros-dup-refresh', '45 * * * *', 'select orders.cadastros_dup_refresh()');
select orders.cadastros_dup_refresh();

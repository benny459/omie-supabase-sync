-- 145 · "Vai ter serviço da nossa equipe?" no PV/OS (pedido do Benny, 08/10/26)
-- O tipo da venda (Mix / Mercantil / Serviços) é o "vendedor" herdado do Omie (cadastros.aux registro='vendedores').
-- Agora ele sai de uma resposta obrigatória, gravada em vendas.documentos.servico_incluso:
--  · OS → serviço incluso; tipo Serviços (fica Mix se o pedido já era Mix)
--  · PV com serviço incluso → Mix (aparece para a área de Serviços no app); sem → Mercantil
--  · sem resposta → não grava (vindo do CRM sem resposta, deduz do tipo escolhido lá)
-- Só onde a empresa tem os três tipos cadastrados (hoje: SF).
-- Também: approval.v_pc_completo não reconhecia o código atual de Serviços (12533290375).

alter table vendas.documentos add column if not exists servico_incluso boolean;

-- pedidos existentes: resposta deduzida do tipo atual
update vendas.documentos d set servico_incluso = case when d.tipo = 'OS' then true when a.nome in ('Mix', 'Serviços') then true when a.nome = 'Mercantil' then false end
  from cadastros.aux a
 where d.servico_incluso is null and a.registro = 'vendedores' and a.empresa = d.empresa and a.codigo = d.vendedor_codigo;
update vendas.documentos set servico_incluso = true where servico_incluso is null and tipo = 'OS';

do $do$
declare d text;
begin
  d := pg_get_functiondef('orders.vendas_salvar(jsonb,text)'::regprocedure);
  if position('servico_incluso' in d) = 0 then
    d := replace(d, '  v_cli record; it jsonb; k int := 0; v_merc numeric; v_base date; ja text;',
'  v_cli record; it jsonb; k int := 0; v_merc numeric; v_base date; ja text;
  v_serv boolean := nullif(p ->> ''servico_incluso'', '''')::boolean; v_vmix text; v_vmerc text; v_vserv text; v_vend text;');
    d := replace(d, '  perform vendas.espelhar(d.id);',
'  -- tipo da venda pela resposta "vai ter serviço da nossa equipe?" (sql/145)
  select max(codigo) filter (where nome = ''Mix''), max(codigo) filter (where nome = ''Mercantil''), max(codigo) filter (where nome = ''Serviços'')
    into v_vmix, v_vmerc, v_vserv
    from cadastros.aux where registro = ''vendedores'' and empresa = d.empresa and not coalesce(inativo, false);
  if v_vmix is not null and v_vmerc is not null and v_vserv is not null then
    if d.tipo = ''OS'' then
      v_serv := true;
      v_vend := case when d.vendedor_codigo = v_vmix then v_vmix else v_vserv end;
    else
      if v_serv is null then
        v_serv := case d.vendedor_codigo when v_vmix then true when v_vserv then true when v_vmerc then false end;
      end if;
      if v_serv is null then
        raise exception ''Responda: vai ter serviço da nossa equipe (instalação, visita)? Se sim, o pedido vira Mix e a área de Serviços passa a vê-lo'';
      end if;
      v_vend := case when v_serv then v_vmix else v_vmerc end;
    end if;
    update vendas.documentos set vendedor_codigo = v_vend, servico_incluso = v_serv where id = d.id returning * into d;
  end if;

  perform vendas.espelhar(d.id);');
    execute d;
  end if;
end $do$;

-- v_pc_completo: código atual de Serviços
do $do$
declare d text;
begin
  d := pg_get_viewdef('approval.v_pc_completo'::regclass);
  if position('12533290375' in d) = 0 then
    d := replace(d, 'WHEN ''12533290350''::text THEN ''Mix''::text', 'WHEN ''12533290375''::text THEN ''Serviços''::text WHEN ''12533290350''::text THEN ''Mix''::text');
    execute 'create or replace view approval.v_pc_completo as ' || d;
  end if;
end $do$;

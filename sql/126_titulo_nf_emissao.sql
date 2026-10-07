-- 07/10/26 (Benny): no detalhe e na edição da conta a pagar/receber faltavam
-- o NÚMERO DA NOTA e a DATA DE EMISSÃO. Passam a ser lidos e editáveis.
--  · título do Omie: sobreposição (titulo_ajustes) com as chaves 'nf' e 'emissao'
--    — o Omie não é escrito; o gatilho reaplica a cada sync.
--  · título do painel (pagar_previsto): nf_numero e data_emissao.

create or replace function finance._ajuste_campos(p jsonb)
returns jsonb language sql immutable
as $$
  select coalesce(jsonb_object_agg(k, v), '{}'::jsonb) from jsonb_each(p) e(k, v)
   where k in ('valor', 'vencimento', 'cod_categoria', 'cod_cc', 'cod_projeto', 'observacao', 'documento', 'nf', 'emissao')
$$;

create or replace function finance.tg_titulo_ajuste_reaplica()
returns trigger language plpgsql security definer set search_path to 'finance', 'public'
as $function$
declare a finance.titulo_ajustes; d numeric; v numeric; hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  select * into a from finance.titulo_ajustes where empresa = new.empresa and cod_titulo = new.cod_titulo;
  if not found then return new; end if;
  if a.novo ? 'valor' then
    v := (a.novo->>'valor')::numeric;
    if new.valor_titulo is distinct from v then
      d := v - coalesce(new.valor_titulo, 0);
      new.valor_titulo := v;
      if coalesce(new.val_aberto, 0) > 0 then new.val_aberto := greatest(new.val_aberto + d, 0); end if;
    end if;
  end if;
  if a.novo ? 'vencimento' then
    new.dt_vencimento := to_char((a.novo->>'vencimento')::date, 'DD/MM/YYYY');
    new.dt_previsao   := to_char((a.novo->>'vencimento')::date, 'DD/MM/YYYY');
    if new.status in ('A VENCER', 'VENCE HOJE', 'ATRASADO') then
      new.status := case when (a.novo->>'vencimento')::date < hoje then 'ATRASADO'
                         when (a.novo->>'vencimento')::date = hoje then 'VENCE HOJE' else 'A VENCER' end;
    end if;
  end if;
  if a.novo ? 'cod_categoria' then new.cod_categoria := a.novo->>'cod_categoria'; end if;
  if a.novo ? 'cod_cc'        then new.cod_cc        := (a.novo->>'cod_cc')::bigint; end if;
  if a.novo ? 'cod_projeto'   then new.cod_projeto   := nullif(a.novo->>'cod_projeto', ''); end if;
  if a.novo ? 'observacao'    then new.observacao    := nullif(a.novo->>'observacao', ''); end if;
  if a.novo ? 'documento'     then new.num_titulo    := nullif(a.novo->>'documento', ''); end if;
  if a.novo ? 'nf'            then new.num_doc_fiscal := nullif(a.novo->>'nf', ''); end if;
  if a.novo ? 'emissao'       then new.dt_emissao    := case when nullif(a.novo->>'emissao', '') is null then null
                                                             else to_char((a.novo->>'emissao')::date, 'DD/MM/YYYY') end; end if;
  return new;
end $function$;

-- titulo_ajustar guarda o "antes" de NF/emissão; titulo_para_editar devolve NF/emissão;
-- pagar_editar aceita nf_numero/data_emissao — remendos textuais idempotentes.
do $$
declare d text;
begin
  d := pg_get_functiondef('finance.titulo_ajustar'::regproc);
  if position('''nf'', x.num_doc_fiscal' in d) = 0 then
    d := replace(d, '''documento'', x.num_titulo,', '''documento'', x.num_titulo, ''nf'', x.num_doc_fiscal, ''emissao'', x.dt_emissao_d,');
    execute d;
  end if;

  d := pg_get_functiondef('finance.titulo_para_editar'::regproc);
  if position('''nf'', p.num_doc_fiscal' in d) = 0 then
    d := replace(d, '''documento'', pp.documento, ''obs'', pp.obs,', '''documento'', pp.documento, ''obs'', pp.obs, ''nf'', pp.nf_numero, ''emissao'', pp.data_emissao,');
    d := replace(d, '''obs'', p.observacao, ''aberto''', '''obs'', p.observacao, ''nf'', p.num_doc_fiscal, ''emissao'', p.dt_emissao_d, ''aberto''');
    execute d;
  end if;

  d := pg_get_functiondef('finance.pagar_editar'::regproc);
  if position('nf_numero      = case' in d) = 0 then
    d := replace(d, '    obs            = case when c ? ''obs'' then nullif(c->>''obs'', '''') else obs end,',
      '    obs            = case when c ? ''obs'' then nullif(c->>''obs'', '''') else obs end,
    nf_numero      = case when c ? ''nf'' then nullif(c->>''nf'', '''') else nf_numero end,
    data_emissao   = case when c ? ''emissao'' then nullif(c->>''emissao'', '''')::date else data_emissao end,');
    execute d;
  end if;
end $$;

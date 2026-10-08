-- 144 · Arquivo da nota na confirmação de provisão (08/10/26)
--  · bucket privado financeiro-documentos (XML/PDF/foto da nota, até 10 MB)
--  · provisao_confirmacoes.arquivo_path / arquivo_nome; provisao_confirmar grava p.arquivo_path/p.arquivo_nome
--  · pagar_provisoes: conf.arquivo = true quando há arquivo (link via /api/financeiro/provisao/nota?id=)
--  Remendos textuais idempotentes sobre as funções da sql/143.

insert into storage.buckets (id, name, public, file_size_limit)
values ('financeiro-documentos', 'financeiro-documentos', false, 10485760)
on conflict (id) do nothing;

alter table finance.provisao_confirmacoes add column if not exists arquivo_path text, add column if not exists arquivo_nome text;

do $do$
declare d text;
begin
  d := pg_get_functiondef('finance.provisao_confirmar(jsonb,text)'::regprocedure);
  if position('arquivo_path' in d) = 0 then
    d := replace(d, 'emissao_doc, escopo, motivo, antes, criado_por)', 'emissao_doc, escopo, motivo, antes, criado_por, arquivo_path, arquivo_nome)');
    d := replace(d, 'v_emi, v_esc, v_mot, antes, p_usuario)', 'v_emi, v_esc, v_mot, antes, p_usuario, nullif(p->>''arquivo_path'', ''''), nullif(p->>''arquivo_nome'', ''''))');
    execute d;
  end if;
  d := pg_get_functiondef('finance.pagar_provisoes()'::regprocedure);
  if position('''arquivo''' in d) = 0 then
    d := replace(d, '''emissao'', c.emissao_doc, ''em'', c.criado_em)', '''emissao'', c.emissao_doc, ''arquivo'', c.arquivo_path is not null, ''em'', c.criado_em)');
    execute d;
  end if;
end $do$;

-- vários arquivos por confirmação (nota + boleto/fatura): arquivos = [{path, nome}]
alter table finance.provisao_confirmacoes add column if not exists arquivos jsonb not null default '[]'::jsonb;
do $do$
declare d text;
begin
  d := pg_get_functiondef('finance.provisao_confirmar(jsonb,text)'::regprocedure);
  if position('arquivos' in d) = 0 then
    d := replace(d, 'criado_por, arquivo_path, arquivo_nome)', 'criado_por, arquivo_path, arquivo_nome, arquivos)');
    d := replace(d, 'nullif(p->>''arquivo_nome'', ''''))', 'nullif(p->>''arquivo_nome'', ''''), case when jsonb_typeof(p->''arquivos'') = ''array'' then p->''arquivos'' else ''[]''::jsonb end)');
    execute d;
  end if;
  d := pg_get_functiondef('finance.pagar_provisoes()'::regprocedure);
  if position('''n_arquivos''' in d) = 0 then
    d := replace(d, '''arquivo'', c.arquivo_path is not null,', '''arquivo'', c.arquivo_path is not null, ''n_arquivos'', greatest(jsonb_array_length(c.arquivos), (c.arquivo_path is not null)::int),');
    execute d;
  end if;
end $do$;

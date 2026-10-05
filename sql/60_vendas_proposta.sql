-- 60 — PV/OS nativo ligado à proposta do CRM (05/10/2026)
--
-- Benny: "ao preencher um PV/OS, um campo para procurar a proposta que está no
-- CRM… e ele já começa a trazer todos os dados da proposta. Esse vínculo é
-- importante, que exista e talvez seja obrigatório."
--
-- vendas.documentos.proposta (sql/49) guarda o nº. A obrigatoriedade é verificada
-- na rota /api/vendas (POST); a exceção — PV/OS sem proposta — só para admin,
-- com motivo, gravado aqui e no histórico. A carteira de faturamento passa a
-- mostrar a proposta (e o "sem proposta") dos documentos nativos.
-- Aplicado como migration p60_vendas_proposta_obrigatoria.

alter table vendas.documentos
  add column if not exists proposta_dispensa_motivo text,
  add column if not exists proposta_dispensa_por text,
  add column if not exists proposta_dispensa_em timestamptz;

create or replace function orders.vendas_dispensa_proposta(p_id bigint, p_motivo text, p_por text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare d vendas.documentos;
begin
  select * into d from vendas.documentos where id = p_id for update;
  if not found then raise exception 'Documento % não encontrado', p_id; end if;
  if length(trim(coalesce(p_motivo, ''))) < 5 then raise exception 'Informe o motivo de lançar sem proposta do CRM'; end if;
  update vendas.documentos set proposta_dispensa_motivo = trim(p_motivo), proposta_dispensa_por = p_por,
         proposta_dispensa_em = now() where id = p_id;
  insert into vendas.historico (documento_id, por, acao, detalhe)
  values (p_id, p_por, 'sem_proposta', jsonb_build_object('motivo', trim(p_motivo)));
  return jsonb_build_object('id', p_id, 'ok', true);
end $$;
grant execute on function orders.vendas_dispensa_proposta(bigint, text, text) to service_role;
revoke execute on function orders.vendas_dispensa_proposta(bigint, text, text) from public, anon, authenticated;

-- fat_carteira (sql/57 + sql/59): no nat_doc, depois de 'rotulo', entram
--   'proposta', nullif(proposta, ''), 'sem_proposta', proposta_dispensa_motivo
-- (aplicado por substituição no corpo da função, na mesma migration).

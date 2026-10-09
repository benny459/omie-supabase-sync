-- 09/10/26 — "Enviar ao cliente" também para a NFS-e registrada (emitida na prefeitura, sql/59).
-- Aditiva: o histórico orders.fat_envios (sql/151) passa a aceitar a NFS-e registrada no lugar da
-- emissão, e a NFS-e ganha os mesmos campos de "enviado" da fat_emissoes (sql/150) — sem eles ela
-- aparece como "✉ não enviado" na carteira. Até aplicar, o painel mostra "migração pendente" só
-- no envio da NFS-e registrada; NF-e e recibo já funcionam.
alter table orders.fat_envios alter column emissao_id drop not null;
alter table orders.fat_envios
  add column if not exists nfse_id bigint references orders.fat_nfse_manual(id) on delete cascade;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'fat_envios_alvo_chk') then
    alter table orders.fat_envios add constraint fat_envios_alvo_chk check (emissao_id is not null or nfse_id is not null);
  end if;
end $$;
create index if not exists fat_envios_nfse_idx on orders.fat_envios (nfse_id, enviado_em desc) where nfse_id is not null;

alter table orders.fat_nfse_manual
  add column if not exists enviado_em timestamptz,
  add column if not exists enviado_para text[],
  add column if not exists enviado_por text;

-- Lista de "não enviados" (carteira, lembrete diário): só autorizadas de produção sem envio.
create index if not exists fat_emissoes_nao_enviadas_idx on orders.fat_emissoes (empresa, autorizada_em desc)
  where status = 'autorizada' and ambiente = 'producao' and enviado_em is null;

notify pgrst, 'reload schema';

-- 09/10/26 — "Enviar ao cliente" no Faturamento: registra quando e para quem a nota/recibo foi enviado.
alter table orders.fat_emissoes
  add column if not exists enviado_em timestamptz,
  add column if not exists enviado_para text[],
  add column if not exists enviado_por text;

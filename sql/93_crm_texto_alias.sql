-- 06/10/26: "Compatibilizar com o estoque" (CP do CRM). De-para de descrição
-- livre → item nosso, gravado pela acao "vincular" de /api/catalogo/crm e lido
-- primeiro (score 1) pela acao "casar_top". Aplicado como migração p93.
create table if not exists compras.item_texto_alias (
  id bigserial primary key, empresa text not null default 'SF', texto_norm text not null, texto text not null,
  codigo_compra text, ncod_prod bigint not null, origem text not null default 'crm', criado_por text,
  criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now(),
  vezes integer not null default 1, unique (empresa, texto_norm));
-- orders.crm_alias_salvar(p_empresa, p_texto_norm, p_texto, p_codigo_compra, p_ncod_prod, p_por) → jsonb (upsert)
-- orders.crm_alias_ler(p_empresa, p_textos_norm text[]) → (texto_norm, ncod_prod, vezes)
-- (ver corpo completo na migração p93; ambas só para service_role)

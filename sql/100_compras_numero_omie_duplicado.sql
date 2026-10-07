-- 100 (07/10/2026, autorizado pelo Benny): PC com número repetido entre painel e Omie.
--
-- Em 01–02/10 o Omie ainda emitiu PCs (7341 Springway, 7342 OKI) com os mesmos
-- números que o painel já tinha dado (7341 Safe Water, 7342 Scania). A
-- conciliação importou os do Omie como "7341-OMIE"/"7342-OMIE" (UNIQUE empresa+numero).
-- Correção de dados feita à mão no mesmo dia (com histórico no pedido):
--   painel 7341 (Safe Water, pendente, não enviado) → 7369
--   7341-OMIE (Springway) → 7341  (número que o fornecedor recebeu e cita na NF)
--   7342-OMIE (OKI) fica assim: o 7342 do painel (Scania) já tem NF e previsto.
--
-- Aqui: o casamento NF ↔ pedido por número citado na NF também procura o
-- "<n>-OMIE", e quando há pedido com esse número do MESMO fornecedor não
-- sugere o de fornecedor diferente (a NF da OKI citando 7342 ia para a Scania).
create or replace function compras.casar_nfs_focus()
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'compras', 'public'
as $function$
declare n_ref int := 0; n_res int := 0;
begin
  drop table if exists _nf;
  create temp table _nf on commit drop as
  select f.chave, f.empresa, regexp_replace(coalesce(f.emitente_doc, ''), '\D', '', 'g') as cnpj_emit,
         f.emitente_nome, f.valor, f.emissao::date as emissao, f.numero,
         (select array_agg(distinct upper(t))
            from (select (regexp_matches(coalesce(i->>'pedido_compra', ''), '(P\d{4,}|\d{3,})', 'gi'))[1] as t
                    from jsonb_array_elements(coalesce(f.detalhe->'requisicao_nota_fiscal'->'itens', '[]'::jsonb)) i) z
           where t is not null) as refs_item,
         (select array_agg(distinct upper(m[2]))
            from regexp_matches(coalesce(f.detalhe->'requisicao_nota_fiscal'->>'informacoes_adicionais_contribuinte', ''),
                                '(pedido de compra|pedido|ped\.?|pc)\s*(?:n[º°o.]*\s*)?[:#-]?\s*(P\d{4,}|\d{3,})', 'gi') as m) as refs_texto
    from orders.focus_recebidos f
   where f.tipo = 'nfe' and lower(coalesce(f.situacao, '')) not in ('cancelada', 'denegada');

  with ref as (
    select n.chave, 'xped'::text as origem, r as numero from _nf n, unnest(n.refs_item) r
    union
    select n.chave, 'texto', r from _nf n, unnest(n.refs_texto) r
  ), cand0 as (
    select distinct on (ref.chave, p.id) ref.chave, p.id as pedido_id, ref.origem,
           case when regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit then 1.0 else 0.7 end as score,
           case when ref.origem = 'xped' then 'Pedido citado no item da NF' else 'Pedido citado nas informações da NF' end
             || case when upper(p.numero) <> ref.numero then ' (nº ' || ref.numero || ' do Omie)' else '' end
             || case when regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit
                     then ' · mesmo fornecedor' else ' · fornecedor diferente do pedido' end as motivo
      from ref join _nf n on n.chave = ref.chave
      join compras.pedidos p on p.empresa = n.empresa and upper(p.numero) in (ref.numero, ref.numero || '-OMIE')
                            and p.tipo = 'PC' and not p.cancelado
     order by ref.chave, p.id, ref.origem desc
  ), cand as (
    -- Havendo pedido citado do MESMO fornecedor, o de fornecedor diferente não é sugerido.
    select c.* from cand0 c
     where c.score = 1.0 or not exists (select 1 from cand0 d where d.chave = c.chave and d.score = 1.0)
  )
  insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo)
  select chave, pedido_id, origem, score, motivo from cand
  on conflict (chave, pedido_id) do update set
    origem = excluded.origem, score = greatest(compras.nf_vinculos.score, excluded.score), motivo = excluded.motivo
  where compras.nf_vinculos.status = 'sugerido';
  get diagnostics n_ref = row_count;

  with cand as (
    select n.chave, p.id as pedido_id,
           round(greatest(0.2, 0.9 - least(1, abs(p.valor_total - n.valor) / nullif(n.valor, 0)) * 2), 2) as score,
           'Mesmo fornecedor · valor ' ||
             case when abs(p.valor_total - n.valor) <= 0.05 then 'igual'
                  else to_char(abs(p.valor_total - n.valor) / nullif(n.valor, 0) * 100, 'FM990D0') || '% diferente' end
             || ' · pedido de ' || to_char(p.emissao, 'DD/MM/YY') as motivo,
           row_number() over (partition by n.chave order by abs(p.valor_total - n.valor), p.emissao desc) as rk
      from _nf n
      join compras.pedidos p on p.empresa = n.empresa and p.tipo = 'PC' and not p.cancelado and not p.omie_ausente
                            and regexp_replace(coalesce(p.fornecedor_cnpj, ''), '\D', '', 'g') = n.cnpj_emit
                            and p.etapa in ('10', '15', '35', '40') and p.nf is null
                            and p.emissao between n.emissao - 120 and n.emissao + 5
     where not exists (select 1 from compras.nf_vinculos v where v.chave = n.chave and v.origem <> 'resumo')
  )
  insert into compras.nf_vinculos (chave, pedido_id, origem, score, motivo)
  select chave, pedido_id, 'resumo', score, motivo from cand where rk <= 5
  on conflict (chave, pedido_id) do nothing;
  get diagnostics n_res = row_count;

  return jsonb_build_object('nfs', (select count(*) from _nf), 'por_referencia', n_ref, 'por_resumo', n_res);
end $function$;

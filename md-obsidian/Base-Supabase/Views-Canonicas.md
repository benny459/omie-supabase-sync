# Views Canônicas — Supabase omie-data

> As 19 views que Painel e Metabase consomem. Todas em schemas `approval`, `sales`, `finance`, `orders`.

## Approval (14 views)

Views de aprovação — enriched joins de sales + finance + orders.

| View | Consumidor | Descrição |
|---|---|---|
| **`v_pc_avulsos`** | Painel [[../Painel/10-Avulsos]] + Webex daily | Motor principal — PV/OS avulsos com pipeline. ~1700 rows típico. |
| `v_pc_avulsos_orphan` | Debug | PC órfão (sem PV/OS pai identificável) |
| **`v_pc_projetos`** | Painel [[../Painel/20-Projetos]] | Roll-up por projeto formal PJxxx |
| **`v_pc_pcs`** | Painel [[../Painel/21-PCs]] | 1 row por PC (foco em aprovação) |
| `v_pc_completo` | Base | View flat completa (raw) |
| `v_pc_completo_enriched` | Base | Enriched com etapa + projeto |
| `v_pc_consolidado` | Base | Consolidação legada |
| `v_pc_standby` | Base | (não usado pelo painel atualmente) |
| `v_pcs_all_flat` | Debug | Flat pra queries ad-hoc |
| `v_pvs_all_flat` | Debug | Flat pra queries ad-hoc |
| `v_pvs_summary` | Base | Roll-up PVs |
| **`v_faturamento_diario`** | Painel [[../Painel/12-Faturamento]] | OS+PV faturados por dia × categoria (via `cat_venda`) |
| `v_rc_projetos_itens` | Painel /projetos/materiais | RC-Projetos com itens desagregados |
| `v_rc_projetos_resumo` | Painel /projetos/materiais | Roll-up RC-Projetos |

## Sales (1 view)

| View | Consumidor | Descrição |
|---|---|---|
| **`sales.faturamento_unificado`** | Painel [[../Painel/12-Faturamento]] + Metabase [[../Metabase/Dash-3-Faturamento]] | UNION OS+PV faturados. Colunas: origem (OS/PV), empresa, codigo_categoria, codigo_cliente, codigo_projeto, dt_fat_d, valor_total, codigo_doc, numero_doc. |

## Finance (3 views)

| View | Consumidor | Descrição |
|---|---|---|
| **`v_titulos_com_tipo_venda`** | Metabase [[../Metabase/Dash-8-Analise-Resultados|Card 7 MRR]] | Enriched títulos com `tipo_venda` calculado (Novo Contrato / Recorrente MRR / Novo BOT / Recorrente BOT / Único) via `row_number() OVER (PARTITION BY num_contrato)` |
| **`v_extratos_consolidado`** | Metabase [[../Metabase/Dash-8-Analise-Resultados]] Cards 1,2,3,5,8 | UNION `extratos_cc` + `despesas_cartao_cs`. Fonte pra cash flow real. |
| `v_despesa_alocada` | Metabase | Despesa alocada por segmento (matriz de atribuição pro Card 9) |

## Orders (1 view)

| View | Consumidor | Descrição |
|---|---|---|
| `v_pcs_inconsistentes` | Debug | PCs com inconsistência entre Omie e sync |

## Função Canônica

### `public.cat_venda(codigo_categoria text) → text`

**IMMUTABLE**, mapeia códigos Omie 1.01.XX pra rótulos humanos:

| Input | Output |
|---|---|
| `1.01.01` | `Contratuais` |
| `1.01.02` | `Projetos` |
| `1.01.03` | `Revenda` |
| `1.01.97` | `Avulsos` |
| `1.01.98` | `BOT/SW` |
| _(outros)_ | `Outras` |

Também tem fallbacks por nome (ILIKE) quando o card usa `des_categoria` em vez de `cod_categoria`.

**Usado por:**
- `approval.v_faturamento_diario` (v1.6.4+)
- Painel: `web/app/api/relatorios/faturamento/route.ts` + `FaturamentoView`
- Metabase: cards 82, 116, 129, 137, 82

**Nunca usar `numero_contrato` como sinal de classificação** — esse campo guarda o OPS interno (`OPSxxxxxxxxxxx`) em quase toda venda, incluindo avulsas. Bug do v1.6.4 documentado em [[../log|log]] 2026-07-17.

## Ver Também

- [[00-Overview-Base]]
- [[RLS-e-Permissoes]]

## Tags
#supabase #views #canonical

# Spec — Contribuição de Compras por Cliente (painel.waterworks)

> **Cole este arquivo no Claude Code do repo `omie-supabase-sync` (pasta `web/` = painel).**
> Objetivo: expor, dentro do painel, a parcela de **compras (PCs)** atribuída a cada cliente/projeto, e deixá-la pronta para a consolidação de rentabilidade no Metabase.
> Faz parte do projeto maior **Rentabilidade por Cliente** (3 plataformas → Metabase). Ver [[../RENTABILIDADE-00-Visao-Geral]].

---

## Contexto

Este é 1 de 3 apps que alimentam o dashboard de rentabilidade. **Este app entrega as COMPRAS.** O faturamento vem do Omie (mesma base) e o custo técnico vem do app.waterworks.

O elo entre as bases é o **código Omie do cliente** (`codigo_cliente` aqui = `customers.omie_codigo_cliente` no app.waterworks). Toda saída precisa carregar esse código.

Vantagem: o painel **já vive na base `omie-data`** junto com o faturamento. Então compras + faturamento já podem ser cruzados aqui sem sync — só o custo técnico vem de fora.

Fontes existentes (ver [[21-PCs]], [[20-Projetos]], [[../Base-Supabase/Views-Canonicas]]):
- `orders.pedidos_compra` — PCs sincronizados do Omie.
- `approval.v_pc_pcs` — view enriquecida (1 row por PC).
- `approval.v_pc_projetos` — roll-up por projeto formal PJxxx.

---

## O que construir

### 1. View SQL — `v_compras_por_cliente`

No schema `approval` (ou `sales`), agregando compras por cliente + projeto + período:

**Colunas de saída (obrigatórias):**

| Coluna | Origem | Nota |
|---|---|---|
| `codigo_cliente` | `pedidos_compra` / `v_pc_pcs` | **elo com o Metabase — nunca omitir** |
| `cliente_nome` | join Omie | |
| `codigo_projeto` | PJxxx quando houver | pra filtro por projeto |
| `tipo_venda` | `cat_venda(codigo_categoria)` | Contratuais/Projetos/Avulsos/etc — ver [[../Base-Supabase/Views-Canonicas]] |
| `periodo_mes` | `date_trunc('month', dt)::date` | |
| `total_compras` | soma dos PCs **aprovados** | `numeric` |
| `qtd_pcs` | contagem | |

**Regras:**
- Contar só PCs **aprovados** (status de aprovação de [[21-PCs]]) — compras rejeitadas não são custo.
- Classificar por tipo via `public.cat_venda(codigo_categoria)` — **nunca** usar `numero_contrato` como sinal (bug documentado, ver [[../log|log]] 2026-07-17 e [[../Base-Supabase/Views-Canonicas]]).
- Se um PC não tiver `codigo_projeto` (avulso), agrupar por cliente mesmo assim.

### 2. Rota / API — `/api/relatorios/compras-por-cliente`

Params: `from`, `to`, `codigo_cliente?`, `codigo_projeto?`.

Retorno análogo ao de faturamento ([[12-Faturamento]]):
```ts
{ periodo, linhas: [{ codigo_cliente, cliente_nome, codigo_projeto, tipo_venda, total_compras, qtd_pcs }], totais }
```

### 3. Prévia dentro do painel

Adicionar um card/aba "Compras por Cliente" — reaproveitar o padrão visual de `FaturamentoView` ([[12-Faturamento]]) e do bucket de [[21-PCs]]:
- KPI "Compras no período" + tabela por cliente com drill por projeto.
- Nota: "Rentabilidade completa (faturamento − custo − compras) → metabase.waterworks.com.br".

### 4. (Opcional, forte) View de pré-consolidação `v_cliente_receita_compras`

Como faturamento **e** compras já estão na mesma base `omie-data`, criar uma view que junta os dois por cliente:
- Receita de `sales.faturamento_unificado` (por `codigo_cliente`, `codigo_projeto`, `cat_venda`).
- Compras de `v_compras_por_cliente`.
- Saída: `codigo_cliente, cliente_nome, codigo_projeto, tipo_venda, periodo_mes, faturamento, total_compras`.

Isso deixa o Metabase só precisando somar **1 número externo** (custo técnico do app.waterworks) em cima de uma linha já pronta. Recomendado.

---

## Entregáveis

1. Migration (via `mcp__supabase__apply_migration`) criando `v_compras_por_cliente` (+ `v_cliente_receita_compras` se optar pelo item 4).
2. Rota `/api/relatorios/compras-por-cliente` + card no painel.
3. Garantir que o user `bi_readonly` do Metabase tem `SELECT` nas views novas.
4. Atualizar [[21-PCs]] / [[12-Faturamento]] / [[../Base-Supabase/Views-Canonicas]] no vault + append em `log.md` (prefixo `[painel]`/`[base]`).

## Checklist de aceite

- [ ] `codigo_cliente` presente e casável com `omie_codigo_cliente` do app.waterworks.
- [ ] Só PCs aprovados entram no `total_compras`.
- [ ] `tipo_venda` via `cat_venda`, nunca via `numero_contrato`.
- [ ] Filtro por projeto funciona.

## Tags
#painel-waterworks #rentabilidade #compras #metabase #spec

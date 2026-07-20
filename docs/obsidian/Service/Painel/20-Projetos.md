# /projetos — Projetos Formais (PJxxx)

> Pipeline projeto + cronograma + budget/materiais. Mesmo motor do [[10-Avulsos]] (`BoldAvulsosView`) com `modulo="projetos"`.

## Rota e componentes

- **Rota:** `/projetos` — lista de projetos
- **Sub-rota:** `/projetos/[codigo]/materiais` — página fluxo financeiro + escopo + etapas
- **Componente principal:** `BoldAvulsosView` (mesmo do avulsos, condicionalizado)
- **View DB:** `approval.v_pc_projetos`

## Difere de /avulsos em:

- **Bucket por Projeto** (não por PV/OS individual). Group key = `projeto_nome`.
- **Pipeline com stage extra "Cronograma"** — deriva de `finance.projeto_etapas`. Estados: green/yellow/red/off. Dev = pior atraso da próxima etapa.
- **Botão "Escopo"** — abre `ProjetoEscopoButton` (docs/anexos)
- **Botão "Fluxo Financeiro"** — upload de xlsx com previsão de entrada + saída
- **Sub-página `materiais`:** RC-Projetos itens + budget summary + upload de xlsx modelo

## Tabelas / views associadas

- `finance.projeto_etapas` (cronograma)
- `finance.projeto_budget` (custos previstos)
- `finance.fluxo_financeiro` (previsão)
- `approval.v_rc_projetos_itens`, `approval.v_rc_projetos_resumo`

## Ver Também

- [[10-Avulsos]] — motor compartilhado
- [[../Base-Supabase/Views-Canonicas]]

## Tags
#painel-waterworks #projetos #modulo

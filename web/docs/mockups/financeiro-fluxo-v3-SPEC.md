# Financeiro — Provisionado × Real e aba Fluxo de Caixa por empresa com cenários (v3)

> **Para o Codex / Claude Code.** Repo `benny459/omie-supabase-sync` · app em `web/` · Supabase `omie-data` (`zodflkfdnjhtwcjutbjl`).
> Branch sugerida: `feat/financeiro-provisao-fluxo`. Duas entregas, dois PRs (P1 primeiro, P2 depende dele).
> O mockup HTML **completo e funcionando** está no fim deste arquivo (Anexo A). Salve-o em `web/docs/mockups/financeiro-fluxo-v3-2026-10-08.html` e porte-o com o mesmo padrão da Títulos a Pagar v3 (esqueleto em TSX + "motor" em TS).
> Regras da casa continuam valendo: **nada é escrito no Omie** (import congelado desde 05/10, `docs/omie-congelamento-financeiro.md`), migrations só acrescentam, e **toda mudança visível atualiza o manual** (`web/content/manual/06-pagar.md`, nova página para o fluxo, `npm run manual`) — ver `CLAUDE.md`.

---

## 0. O que existe hoje (lido no repo e no banco em 08/10/2026)

| Peça | Onde | Observação |
|---|---|---|
| Títulos a Pagar v3 | `web/components/financeiro/TelaPagarV3.tsx` + `pagar-v3-motor.ts` + `finance.pagar_v3_dados` (sql/58 → 62 → 67 → 120) | Status de pagamento já tem "Aguardando NF", "NF sem pedido", "Não autorizada". |
| Recorrências do Omie | `finance.pesquisa_titulos` com `origem = 'RPTP'` e `cod_tit_repet` | **10.784 títulos em aberto, 902 séries, R$ 870 mil nos próximos 90 dias.** Só 3.838 de 18.707 RPTP têm `num_doc_fiscal`. É o "> 12 meses R$ 14,6 mi · recorrências futuras" do card. |
| Séries do painel | `finance.titulo_series` + `pagar_previsto.serie_id/serie_seq` (sql/73) | "+ Nova conta" com recorrência. |
| Ajuste de título do Omie | `finance.titulo_ajustes` + `titulo_ajustar(…, p_escopo 'esta'/'proximas')` (sql/80, 126) | Sobreposição nativa; já aceita as chaves `valor`, `vencimento`, `nf`, `emissao`, `documento`… e reaplica a cada sync. **É a base da confirmação.** |
| Previsões de PC | `finance.pagar_previsto` `origem_titulo='pc'` (sql/29) | Viram `substituido` quando a conta real chega. |
| Fluxo de caixa atual | `/bi/financeiro` → `TelaFluxoNavy` / `FluxoCaixaView` + `/api/bi/fluxo-caixa` + `bi.fluxo_caixa_titulos` | Escopo **fixo** (entradas só SF, saídas das 3), sem escolha de conta, passado opcional. Fica como está; a aba nova é a operacional. |
| Razão / saldos | `finance.v_razao_nativo`, `finance.banco_movimentos`, `bi.saldo_por_conta(_nativo)` (sql/68) | Fonte do realizado e do saldo âncora. |
| Contratos recorrentes (receita) | `vendas.contratos` (sql/68_contratos) | Receber em aberto no Omie só vai até nov/26 — o futuro de entradas tem de vir dos contratos. |

**Caso real (Marcelo Carminati, SF, Serviços Prestados PJ, 2.03.97):** duas séries RPTP (`12045574323` dia 15 e `12045574912` dia 30), R$ 6.000 cada, lançadas até 2033. Todo mês ele emite uma NFS-e (NF 224, 233, 239, 246, 253…) e o financeiro hoje só "descobre" que a parcela é real quando paga. As de 15/10 e 30/10 estão sem NF — são **provisionadas**.

---

## P1 — Provisionado × Real

### 1.1 Regra (uma linha por título, calculada, não digitada)

`natureza_valor` ∈ `provisionado` | `real`

| Origem do título | Vira `provisionado` quando | Vira `real` quando |
|---|---|---|
| Omie recorrente (`origem='RPTP'`) | não tem `num_doc_fiscal`, nem `codigo_barras`, nem `chave_nfe`, nem confirmação no painel | qualquer um desses existe **ou** há linha em `finance.provisao_confirmacoes` |
| Série do painel (`pagar_previsto.serie_id is not null`) | ocorrência sem `nf_numero`/`documento` fiscal/`extras.codigo_barras` | idem, ou confirmação |
| Conta manual avulsa do painel | marcada como "valor estimado" no "+ Nova conta" (checkbox novo) | sem a marca, ou após confirmação |
| Previsão de PC (`origem_titulo='pc'`) | **nunca** — valor é o do pedido aprovado; continua com o status próprio (Aguardando NF etc.) | — |
| Demais do Omie (MANP, COMP, CTEP…) | nunca | sempre |
| **Receber**: competência de `vendas.contratos` ainda não faturada | sempre (entra só no fluxo) | quando a OS/recibo é emitido |

Tolerância de diferença: `finance.config` chave `provisao_tolerancia` = `{"pct": 10}`.

### 1.2 Banco — `sql/130_provisao_confirmar.sql`

```sql
-- 130 — Provisionado × real (08/10/26, Benny)
create table if not exists finance.provisao_confirmacoes (
  id            bigserial primary key,
  empresa       text not null,
  cod_titulo    bigint,              -- título do Omie (pesquisa_titulos)
  pagar_id      bigint references finance.pagar_previsto(id),  -- título do painel
  serie_ref     text,                -- cod_tit_repet::text ou titulo_series.id
  tipo_doc      text not null check (tipo_doc in ('NFSE','NFE','BOL','REC','DAS')),
  numero_doc    text not null,
  codigo_barras text, chave_nfe text,
  valor_prov    numeric(15,2) not null,
  valor_real    numeric(15,2) not null,
  venc_prov     date, venc_real date,
  escopo        text not null default 'esta' check (escopo in ('esta','proximas','media')),
  motivo        text,
  criado_por    text, criado_em timestamptz not null default now(),
  desfeito_em   timestamptz, desfeito_por text,
  check ((cod_titulo is not null) <> (pagar_id is not null))
);
create unique index if not exists provisao_conf_omie_uq on finance.provisao_confirmacoes (empresa, cod_titulo) where desfeito_em is null and cod_titulo is not null;
create unique index if not exists provisao_conf_painel_uq on finance.provisao_confirmacoes (pagar_id) where desfeito_em is null and pagar_id is not null;
alter table finance.provisao_confirmacoes enable row level security;
revoke all on finance.provisao_confirmacoes from anon, authenticated;
grant all on finance.provisao_confirmacoes to service_role;

alter table finance.pagar_previsto add column if not exists valor_estimado boolean not null default false;
insert into finance.config (chave, valor, atualizado_por) values ('provisao_tolerancia', '{"pct":10}', 'p130') on conflict do nothing;

-- natureza do valor de qualquer título a pagar (usar nas views)
create or replace function finance.natureza_valor_omie(t finance.pesquisa_titulos) returns text
language sql stable as $$
  select case when t.origem = 'RPTP'
               and coalesce(t.num_doc_fiscal,'') = '' and coalesce(t.codigo_barras,'') = '' and coalesce(t.chave_nfe,'') = ''
               and not exists (select 1 from finance.provisao_confirmacoes c
                                where c.empresa = t.empresa and c.cod_titulo = t.cod_titulo and c.desfeito_em is null)
              then 'provisionado' else 'real' end $$;
```

**RPC `finance.provisao_confirmar(p jsonb, p_usuario text) returns jsonb`** (security definer, uma transação):

1. Recebe `{empresa, cod_titulo | pagar_id, tipo_doc, numero_doc, valor_real, venc_real?, codigo_barras?, chave_nfe?, escopo, motivo?}`.
2. Valida: título em aberto e `provisionado`; `numero_doc` obrigatório; código de barras 44/47/48 dígitos; se `|valor_real − valor_prov| / valor_prov > tolerância` → `motivo` obrigatório.
3. **Título do Omie** → `finance.titulo_ajustar(empresa, cod, {valor, vencimento, nf: numero_doc, documento}, 'esta', usuario)`; código de barras/chave em `titulo_ajustes.novo` (acrescentar `codigo_barras`, `chave_nfe` à lista de `finance._ajuste_campos` e ao gatilho de reaplicação).
   **Título do painel** → `finance.pagar_editar` (nf_numero, valor, vencimento, `extras.codigo_barras`), `valor_estimado=false`.
4. Escopo da diferença:
   - `esta` → só esta parcela.
   - `proximas` → ajusta **valor** das próximas ocorrências da mesma série **ainda provisionadas** (Omie: `titulo_ajustar(…, 'proximas')` só com `valor`; painel: `serie_editar`). Nunca toca parcelas já reais/pagas.
   - `media` → mesmo que `proximas`, com valor = média dos 3 últimos `valor_real` confirmados/pagos da série.
5. Grava `provisao_confirmacoes` + `financeiro_audit` (`acao='provisao_confirmar'`).

**RPC `finance.provisao_desfazer(p_id bigint, p_usuario text)`** — só se o título não foi baixado; desfaz o ajuste (`titulo_desfazer_ajuste` / volta campos do painel) e marca `desfeito_em`. Ajustes de "próximas" também voltam.

**Expor na leitura:** `finance.pagar_v3_dados` (última definição em sql/120) ganha `natureza_valor`, `serie_ref`, `ult_real` (nº + data do último documento da série) e `media3` (média dos 3 últimos reais). O mesmo campo entra em `bi.fluxo_caixa_titulos` e na função nova do fluxo (P2).

### 1.3 Sugestão automática ("ajuste fino")

Job leve (no cron `omie-cash-banco` ou na entrada de NF — `orders.recebimento_nfe` / Focus NFe): para cada NF recebida, procurar título **provisionado** do mesmo CNPJ com vencimento em ±15 dias e valor dentro da tolerância → grava sugestão (`provisao_sugestoes`: título, NF, valor, score). Na tela aparece "NF 257 encontrada — confirmar?" com o formulário já preenchido; nunca confirma sozinho.

### 1.4 API

`POST /api/financeiro/provisao` — `{acao:'confirmar', …}` | `{acao:'desfazer', id}`. Permissão `financeiro.editar_titulo` (mesma do "+ Nova conta"). Erros da RPC voltam 422 com a mensagem.

### 1.5 Tela Títulos a Pagar v3 (mudanças — o resto fica igual)

- Linha **provisionada**: fundo hachurado leve + badge `◌ PROVISIONADO` (roxo, borda tracejada) na coluna de status; valor em roxo com "média 3 últimas R$ x" embaixo; sub-linha "recorrência nnn · último real: NF 253 · 15/09".
- Linha **real**: badge `✓ REAL` + documento. Se veio de provisão com diferença: "provisão era R$ x".
- Botão **Confirmar com NF** na linha provisionada (abre o modal do mockup). Formulário: tipo de documento, nº (obrigatório), valor real (pré-preenchido com o provisionado), vencimento real, código de barras/chave; mostra a diferença em R$ e %, alerta acima da tolerância com motivo obrigatório, e o escopo (só esta / esta e próximas / próximas pela média de 3).
- **Baixar** um provisionado: abre primeiro o modal de confirmação (admin pode pular com motivo).
- Filtro novo no segmento de status: `Provisionados` e `Provisionados vencendo em 7d`; card novo "Vencendo em 7 dias sem documento" (soma + nº, clique filtra). Provisionado vencendo em ≤ 7 dias entra no card **Bloqueados p/ pagar** como "Aguardando NF".
- "+ Nova conta": checkbox **Valor estimado (provisão)**; em recorrência vem marcado por padrão.
- Calendário dos 30 dias e cards: parte provisionada da barra hachurada.

---

## P2 — Aba Fluxo de Caixa (Financeiro)

### 2.1 Rota e navegação

- Página `web/app/(app)/financeiro/fluxo/page.tsx` → `TelaFluxoFin` (`web/components/financeiro/TelaFluxoFin.tsx` + `fluxo-fin-motor.ts` + `fluxo-fin.css`, escopo `.ff1`).
- `AppSidebar.tsx` grupo `financeiro`: item "Fluxo de Caixa" entre "Títulos a Receber" e "Conciliação". Permissão nova `financeiro.ver_fluxo` (padrão: quem tem `ver_pagar`).
- `/bi/financeiro` continua igual (visão BI de escopo fixo).

### 2.2 Filtros — **o fluxo é por empresa, com os bancos escolhidos unificados** (estado na URL `?emp=SF&contas=4,5,6&j=-3,3&vista=ambos&prov=1&venc=1&inter=1`)

- **Empresa**: seleção única CD / SF / WW (segmentado). Trocar de empresa pré-marca os bancos dela com saldo ≠ 0 + o banco padrão.
- **Bancos unificados**: linha de cartões, um por conta da empresa (nome, "padrão", saldo de hoje), clicáveis para entrar/sair; à direita "n de m bancos · saldo unificado" com a soma. Mínimo um banco. O fluxo inteiro (saldo, linhas, barras, demonstrativo) é a **soma desses bancos como se fossem um só caixa**.
- Título sem conta definida cai na **conta padrão da empresa** (`finance.config` chave `conta_padrao_fluxo` = `{"CD":id,"SF":id,"WW":id}`) e só entra se a padrão estiver marcada.
- **Transferências entre bancos escolhidos** se anulam e ficam ocultas (chave ligada). Transferência para um banco da mesma empresa **não** marcado aparece como saída/entrada normal.
- **Intercompany** (`finance.intercompany`): aporte/pagamento feito por banco de outra empresa do grupo entra como movimento da empresa analisada (grupo "Intercompany"), nunca some — CD e WW quase não têm recebíveis próprios, então sem isso o fluxo delas só mostra saídas.
- **Janela**: −1m/+1m · −3m/+3m (padrão) · −6m/+6m · só futuro 90d.
- **Chaves**: incluir provisionados (on) · contas a pagar vencidas entram hoje (on) · ocultar transferências entre os bancos escolhidos (on).

### 2.3 Dados — `sql/131_fluxo_caixa_financeiro.sql`

`finance.fluxo_caixa_lancamentos(p_empresa text, p_contas bigint[], p_de date, p_ate date)` → uma linha por lançamento:

| coluna | conteúdo |
|---|---|
| `data` | passado: data do movimento; futuro: `previsão` (vencido em aberto vem com a data original e flag `vencido`) |
| `fase` | `realizado` \| `aberto` |
| `natureza` | `E` \| `S` |
| `natureza_valor` | `real` \| `provisionado` (P1; contratos a faturar = `provisionado`) |
| `empresa`, `conta_id`, `grupo`, `categoria`, `contraparte`, `documento`, `valor`, `ref` (cod_titulo / pagar_id / receber_id / contrato_id) | |
| `transferencia` | true para transferência entre contas e intercompany (`finance.intercompany`) |

Fontes:
- **Realizado** (≤ ontem): `finance.v_razao_nativo` (antes do corte = arquivo do Omie; depois = `banco_movimentos` + baixas) — é o que de fato entrou/saiu da conta.
- **A pagar em aberto**: `pesquisa_titulos` natureza P (já com `titulo_ajustes`) ∪ `v_pagar_previsto` (manual, séries, PC não substituído).
- **A receber em aberto**: `pesquisa_titulos` natureza R ∪ `finance.receber` ∪ **competências futuras de `vendas.contratos` ativos ainda não faturadas** (valor_periodo, dia_faturamento + prazo da condição) como `provisionado`.
- `grupo`: mapear categoria → 6 grupos de saída (Pessoal e PJ · Fornecedores e matéria-prima · Impostos e guias · Locação de veículos · Administrativo e consumo · Financeiras) e 3 de entrada (Contratos recorrentes · Faturamento OS/vendas · Outras). Tabela `finance.fluxo_grupos(cod_categoria_prefixo, grupo)` editável.

`finance.fluxo_saldo_contas(p_contas bigint[])` → saldo âncora de hoje por conta (mesmo número dos cards "Bancos" da tela Pagar: saldo Omie / último OFX).

**Snapshot para "previsto × realizado"**: `finance.fluxo_snapshot(dia date, ref text, data_prevista date, valor numeric, natureza_valor text)` gravado todo dia 23:55 (pg_cron) com os abertos dos próximos 180 dias. O Δ do passado = realizado − valor que estava previsto para aquele período no snapshot mais antigo disponível. Antes de existir snapshot, a coluna Δ não aparece (sem inventar número).

**API** `GET /api/financeiro/fluxo?emp=SF&contas=4,5,6&de=&ate=` → `{saldo_hoje_por_conta, lancamentos, previsto_original}`. A montagem por dia/semana/mês, saldo e KPIs fica no navegador (como no fluxo do BI), para trocar a granularidade sem nova chamada.

### 2.4 Cálculo do saldo

- Âncora = soma do saldo de hoje das contas selecionadas.
- Para trás: saldo do início da janela = âncora − Σ(realizados de [início, hoje]).
- Para frente: cada período = saldo anterior + entradas − saídas (realizados do período + abertos).
- Vencidos em aberto (chave ligada) somam no dia de hoje; desligada, saem do fluxo e aparecem só no KPI.
- Provisionados desligados → somem de barras, tabela e saldo.

### 2.5 Tela (ver mockup)

1. **KPIs**: saldo hoje (contas selecionadas) · realizado na janela (E/S) · a realizar (E/S, quanto é vencido) · saldo projetado no fim · **menor saldo projetado e quando** (vermelho se < 0) · provisionado no futuro (% das saídas).
2. **Gráfico**: barras E (verde) / S (vermelho) por período; parte provisionada hachurada; fundo cinza no passado; linha de saldo contínua no passado e tracejada no futuro; marcador "hoje"; linha do zero; com a chave ligada, contorno tracejado = previsto original. Clique numa coluna → gaveta com os lançamentos.
3. **Lateral**: saídas dos próximos 30 dias por grupo · provisões aguardando documento em 7 dias (botão leva à Títulos a Pagar já filtrada).
4. **Demonstrativo** (períodos nas colunas, rolagem horizontal, coluna de hoje marcada): Saldo inicial · Entradas (expansível por grupo) · Saídas (expansível) · Resultado · Saldo final. Passado mostra realizado + Δ; futuro mostra valor + "x prov." em itálico roxo. Clique na célula → gaveta filtrada. **Exportar CSV**.
5. Gaveta: data (e vencimento original se vencido), contraparte, grupo, conta, documento, badge realizado / a realizar / provisionado / vencido, valor. Clique num título abre o modal de edição existente (`EditarTituloModal`) ou o de confirmação de provisão.

---

### 2.6 Visual v2 + linhas de simulação (cenários) — **substitui o gráfico de barras de 2.5**

O topo da aba passa a ser um **gráfico de saldo diário** grande; barras viram um "movimento semanal" fino embaixo. O demonstrativo (2.5 item 4) continua igual, sempre do cenário Base.

**Gráfico principal (diário, SVG responsivo, redesenha no resize)**
- **Vista**: `Só passado` · `Passado + futuro` · `Só futuro` (segmentado acima do gráfico). Vale para o gráfico e para o bloco Entradas e saídas.
- **Escala ajustada ao trecho visível** (padrão): o eixo Y vai do menor ao maior saldo do trecho + 8% — é o que deixa ver a oscilação dia a dia. Chave `Escala a partir do zero` para a leitura absoluta. Colchão fora da escala vira aviso "colchão ↑/↓ fora da escala" em vez de achatar a curva. Chave `Faixa de incerteza`.
- **Zoom**: navegador (minigráfico do período inteiro) embaixo, com seleção arrastável e alças nas bordas; roda do mouse no gráfico dá zoom no ponto; duplo clique / "desfazer zoom" volta. Janela curta troca o eixo X de meses para dias/semanas. O trecho do zoom é o mesmo do bloco Entradas e saídas.
- **Variação diária**: faixa de barras embaixo da linha com o resultado de cada dia (entrada − saída) do cenário em edição, verde/vermelho, passado esmaecido; tooltip mostra entradas, saídas e variação do dia.
- Passado: linha cheia cinza do saldo realizado com área degradê; fundo levemente sombreado.
- Futuro Base: linha azul + área degradê + **faixa de incerteza** (± desvio histórico previsto × realizado acumulado; enquanto não houver snapshot, usar 4,5% do giro bruto acumulado e escrever isso na legenda).
- Uma **linha por cenário** visível, na cor do cenário; ponto vazado no **menor saldo** de cada linha e ponto cheio no fim.
- **◆ eventos simulados** sobre a linha do cenário (verde entrada / vermelho saída, com título no hover).
- **Colchão mínimo de caixa**: linha âmbar tracejada (valor editável no card de KPI; guardar por usuário em `finance.config` / preferências). Zona abaixo de zero tingida de vermelho.
- **Hover com crosshair**: tooltip com a data, o saldo de cada cenário e o Δ contra o Base, mais o movimento do dia. Clique abre a gaveta com os lançamentos do dia.
- Cabeçalho: saldo final do cenário em edição em tamanho grande, Δ vs Base, menor saldo e "faltam R$ x para o colchão"; legenda em chips que ligam/desligam cada linha.

**Simulador (painel lateral fixo)**
- Abas dos cenários; `+ Cenário`, `Duplicar`, renomear, cor, `Excluir`, `Salvar`, `compartilhar` (visível para o financeiro ou só para mim).
- Cenários padrão: **Base** (não editável = títulos como estão), **Conservador** (atraso +15d, inadimplência 5%, despesas +5%, provisões +8%), **Otimista** (recupera 60% dos vencidos a receber em 45d).
- **Alavancas** (sliders, recalculam na hora, sem chamar a API):

| alavanca | faixa | efeito sobre os lançamentos EM ABERTO |
|---|---|---|
| Atraso dos clientes | 0–60 dias | toda entrada em aberto + N dias |
| Inadimplência | 0–25% | entrada em aberto × (1 − %) |
| Recuperar vencidos a receber | 0–100% … ao longo de 10–120 dias | soma os **recebíveis vencidos** (fora do Base, como no BI) distribuídos de amanhã até N dias |
| Variação das despesas | −20% a +20% | toda saída em aberto × (1 + %) |
| Provisões acima do previsto | −10% a +30% | só saídas `provisionado` (P1) × (1 + %) |
| Postergar fornecedores | 0–45 dias | saídas do grupo Fornecedores/matéria-prima + N dias (não mexe em vencidos) |

- **Linhas de simulação (eventos)**: descrição, entrada/saída, valor, data, repetição (uma vez / mensal ×3/×6/×12), empresa. Ficam numa biblioteca única; cada cenário marca quais usa (checkbox). Exemplos que já vêm no mockup: sinal e receita do SW, compra do equipamento, antecipação de recebíveis e a liquidação dela, contratação de técnico.
- Link **lançar** no evento: abre o "+ Nova conta" já preenchido com **Valor estimado (provisão)** marcado (P1) — o evento sai da simulação e vira título provisionado.
- Realizado nunca muda com cenário; alavancas só atuam de hoje em diante.

**Comparativo de cenários** (tabela abaixo do gráfico): saldo no fim, Δ vs Base, menor saldo + data, dias abaixo do colchão, **necessidade de caixa** (colchão − menor saldo, se positivo), entradas e saídas a realizar.

**Banco — acrescentar em `sql/131`:**

```sql
create table if not exists finance.fluxo_cenarios (
  id uuid primary key default gen_random_uuid(),
  nome text not null, cor text not null,
  alavancas jsonb not null default '{}'::jsonb,   -- {atraso, inad, rec, recDias, desp, prov, post}
  eventos bigint[] not null default '{}',
  empresas text[], compartilhado boolean not null default false,
  criado_por text, criado_em timestamptz not null default now(), atualizado_em timestamptz not null default now()
);
create table if not exists finance.fluxo_eventos (
  id bigserial primary key,
  descricao text not null, natureza char(1) not null check (natureza in ('E','S')),
  valor numeric(15,2) not null check (valor > 0), data date not null,
  repeticoes int not null default 1 check (repeticoes between 1 and 36),
  empresa text not null, conta_id bigint, categoria text,
  virou_titulo jsonb,              -- {tipo:'pagar'|'receber', id} quando "lançar"
  criado_por text, criado_em timestamptz not null default now()
);
-- RLS como as demais (service_role); a API filtra: compartilhado OR criado_por = usuário.
```

API: `GET/POST/PATCH/DELETE /api/financeiro/fluxo/cenarios` e `/api/financeiro/fluxo/eventos`. A simulação roda **no navegador** sobre os lançamentos de `/api/financeiro/fluxo` + `recebiveis_vencidos` (novo campo da resposta: recebíveis em aberto com previsão < hoje). Função pura `simular(lancamentos, cenario, eventos, janela, saldoHoje)` em `web/lib/fluxo-simular.ts`, com teste unitário.

### 2.7 Dia a dia do trecho escolhido

Card logo abaixo do gráfico, **sempre no mesmo trecho** que a vista (Só passado / Passado + futuro / Só futuro) e o zoom definem, e no **cenário em edição**:
- Cabeçalho: período e nº de dias, totais de entradas, saídas, resultado e saldo inicial → final do trecho.
- Uma linha por dia: data + dia da semana (marca fim de semana, **hoje** e "realizado"), saldo inicial, entradas, saídas (parte provisionada em itálico roxo), variação, saldo final, **Δ vs Base** (quando o cenário não é o Base) e barra de saldo (azul; âmbar abaixo do colchão; vermelho negativo). Dia abaixo do colchão ganha marca lateral âmbar.
- Clique no dia → abre os lançamentos dele ali mesmo: badge realizado / a realizar / provisionado / vencido / ◆ simulado, contraparte, grupo, documento, e avisos "data movida pelo cenário (orig. dd/mm)", "recuperação simulada", "vencido em dd/mm".
- Chaves e ações: `Só dias com movimento` (padrão ligado; hoje sempre aparece), `Próximos 30 dias` (atalho que põe o zoom em hoje → +29), `Abrir/fechar todos`, `CSV` (data; saldo inicial; entradas; entradas prov.; saídas; saídas prov.; variação; saldo final).
- Ao abrir, rola até hoje. A simulação guarda, por cenário, a lista de lançamentos já transformados (`its`: dia, natureza, valor, origem título/evento) — é ela que alimenta o detalhe, para o dia a dia bater 100% com a linha do gráfico.

---

## 3. Critérios de aceite

- [ ] Marcelo Carminati 15/10 e 30/10 aparecem como **PROVISIONADO**; confirmar com "NFS-e 257, R$ 6.000" vira **REAL** sem tocar o Omie; desfazer volta ao estado anterior.
- [ ] Confirmar com valor 19% maior pede motivo; escopo "esta e próximas" muda só parcelas ainda provisionadas da mesma série; "média de 3" usa os 3 últimos reais.
- [ ] Sync do Omie (manual) não apaga confirmação nem NF (gatilho de reaplicação).
- [ ] Baixar provisionado exige confirmação antes.
- [ ] Fluxo SF com só C6 Bank: saldo unificado = R$ 52.131,81 (card Bancos); SF com Omie.CASH + C6: R$ 191.617,42. Trocar granularidade, vista ou zoom não chama a API de novo.
- [ ] Transferência Omie.CASH → C6 some com os dois marcados e aparece como saída se só Omie.CASH estiver marcado.
- [ ] Soma das saídas abertas da janela = soma da Títulos a Pagar com o mesmo filtro (teste de conferência).
- [ ] Transferência Omie.CASH → C6 some com a chave ligada e aparece com ela desligada (entrada e saída se anulam no total do grupo).
- [ ] Cenário Conservador (atraso 15d) não altera nenhum ponto do passado; Base é idêntico ao demonstrativo.
- [ ] Evento mensal ×6 aparece 6 vezes no cenário que o marca e em nenhum outro; "lançar" cria conta com valor estimado.
- [ ] Menor saldo, dias abaixo do colchão e necessidade de caixa batem com a série diária (teste de `fluxo-simular.ts`).
- [ ] Vista Só futuro / Só passado e zoom reescalam o eixo Y ao trecho; variação diária visível em qualquer janela.
- [ ] Bloco Entradas e saídas: todo período mostra entrada, saída e resultado; totais = soma das colunas do trecho.
- [ ] Cenário salvo reaparece após recarregar; compartilhado aparece para outro usuário do financeiro.
- [ ] Dia a dia: soma das linhas = totais do card = bloco Entradas e saídas do mesmo trecho; saldo final de cada dia = ponto da linha do cenário no gráfico.
- [ ] Testes Playwright em `web/tests/` cobrindo: confirmar provisão, desfazer, filtro de contas, granularidade, gaveta.
- [ ] Manual: `06-pagar.md` (provisões) e nova `14-fluxo-caixa.md` (`rotas: ["/financeiro/fluxo"]`), `npm run manual`, JSON commitados.

## 4. Ordem de implementação

1. `sql/130` + RPCs + leitura no `pagar_v3_dados` → API `/api/financeiro/provisao` → UI na Pagar v3 → manual. **PR 1.**
2. `sql/131` (lançamentos por empresa/bancos, saldo, grupos, intercompany, snapshot + cron, cenários/eventos) → API `/api/financeiro/fluxo` (+ cenários) → `web/lib/fluxo-simular.ts` → `TelaFluxoFin` (gráfico diário com vista/zoom, entradas e saídas, simulador) → sidebar/permissão → manual. **PR 2.**
3. Depois: sugestão automática de NF (1.3).

---

## Anexo A — Mockup HTML completo (operacional)

Abrir direto no navegador. Dados de exemplo calibrados com o `omie-data` de 08/10/2026 (saldos das contas = cards da tela; totais mensais ≈ `pesquisa_titulos`). Tudo funciona: empresa, bancos unificados, janela, vista passado/futuro, zoom, dia a dia do trecho, escala, variação diária, entradas e saídas com valores, cenários, alavancas, eventos, comparativo, demonstrativo, gaveta, CSV e, na aba Títulos a Pagar, o modal de confirmação com tolerância e escopo.

````html
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fluxo de Caixa v2</title>
<style>
:root{
  --bg:#f6f7f9;--panel:#fff;--panel2:#f1f3f6;--line:#e4e7ec;--line2:#d0d5dd;
  --tx:#101828;--tx2:#475467;--tx3:#98a2b3;
  --cd:#f5a524;--sf:#2563eb;--ww:#14b8a6;
  --in:#16a34a;--out:#dc2626;--prov:#a855f7;--amber:#f59e0b;--r:14px;
}
@media (prefers-color-scheme:dark){:root:not([data-theme="light"]){
  --bg:#0b0f17;--panel:#121826;--panel2:#1a2233;--line:#232c3d;--line2:#33405a;
  --tx:#e6eaf2;--tx2:#a3adc2;--tx3:#6b778f;--sf:#3b82f6;--in:#22c55e;--out:#ef4444;--prov:#c084fc;}}
:root[data-theme="dark"]{--bg:#0b0f17;--panel:#121826;--panel2:#1a2233;--line:#232c3d;--line2:#33405a;
  --tx:#e6eaf2;--tx2:#a3adc2;--tx3:#6b778f;--sf:#3b82f6;--in:#22c55e;--out:#ef4444;--prov:#c084fc;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--tx);font:13px/1.45 -apple-system,"SF Pro Text","SF Pro Display",BlinkMacSystemFont,"Helvetica Neue",Inter,sans-serif;-webkit-font-smoothing:antialiased}
button,input,select{font:inherit;color:inherit}
button{cursor:pointer}
.num{font-variant-numeric:tabular-nums}
.wrap{max-width:1500px;margin:0 auto;padding:22px 24px 80px}
.top{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.k{color:var(--tx3);font-size:11px;letter-spacing:.08em;text-transform:uppercase}
h1{margin:2px 0 0;font-size:26px;font-weight:700;letter-spacing:-.022em}
.sub{color:var(--tx3);font-size:12px;margin-top:3px}
.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:18px;overflow-x:auto}
.tabs button{background:none;border:0;padding:10px 14px;color:var(--tx2);font-weight:600;border-bottom:2px solid transparent;white-space:nowrap}
.tabs button.on{color:var(--tx);border-color:var(--sf)}
.tabs .new{font-size:10px;background:var(--sf);color:#fff;border-radius:6px;padding:1px 6px;margin-left:6px;vertical-align:1px}
.btn{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:8px 14px;font-weight:600}
.btn.pri{background:var(--sf);border-color:var(--sf);color:#fff}
.btn.sm{padding:5px 10px;font-size:12px;border-radius:8px}
.btn.ghost{background:none;border-color:transparent;color:var(--tx2)}
.bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:16px}
.seg{display:inline-flex;flex-wrap:wrap;max-width:100%;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:3px;gap:2px}
.seg button{background:none;border:0;border-radius:8px;padding:6px 12px;color:var(--tx2);font-weight:500;white-space:nowrap}
.seg button.on{background:var(--panel2);color:var(--tx);box-shadow:inset 0 0 0 1px var(--line2)}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:0}
.chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line2);background:var(--panel);border-radius:999px;padding:6px 12px;font-weight:600;color:var(--tx2)}
.chip.on{color:var(--tx);border-color:var(--sf);box-shadow:0 0 0 1px var(--sf) inset}
.lbl{color:var(--tx3);font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;margin-right:2px}
.tog{display:inline-flex;align-items:center;gap:7px;color:var(--tx2);font-weight:500;user-select:none;cursor:pointer}
.tog i{width:30px;height:18px;border-radius:9px;background:var(--line2);position:relative;transition:.15s}
.tog i:after{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:#fff;transition:.15s}
.tog.on i{background:var(--sf)}.tog.on i:after{left:14px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:var(--r);padding:16px 18px}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px;margin-bottom:16px}
.kpi .l{color:var(--tx2);font-size:12px;font-weight:500}
.kpi .v{font-size:22px;font-weight:700;letter-spacing:-.02em;margin:6px 0 2px}
.kpi .s{color:var(--tx3);font-size:11.5px}
.pos{color:var(--in)}.neg{color:var(--out)}.pv{color:var(--prov)}
.grid2{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:14px;align-items:start}
@media(max-width:1100px){.grid2{grid-template-columns:minmax(0,1fr)}}
.legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--tx2);font-size:12px}
.legend span{display:inline-flex;align-items:center;gap:6px}
.sw{width:12px;height:12px;border-radius:3px;display:inline-block}
.hatch-in{background:repeating-linear-gradient(45deg,var(--in) 0 2px,transparent 2px 5px);border:1px solid var(--in)}
.hatch-out{background:repeating-linear-gradient(45deg,var(--out) 0 2px,transparent 2px 5px);border:1px solid var(--out)}
svg text{fill:var(--tx3);font-size:10.5px}
.tbl{width:100%;border-collapse:separate;border-spacing:0}
.tbl th,.tbl td{padding:8px 10px;border-bottom:1px solid var(--line);text-align:right;white-space:nowrap}
.tbl th{color:var(--tx3);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;position:sticky;top:0;background:var(--panel);z-index:1}
.tbl td:first-child,.tbl th:first-child{text-align:left;position:sticky;left:0;background:var(--panel);z-index:2}
.tbl tr.grp td{font-weight:700}
.tbl tr.sub td:first-child{padding-left:28px;color:var(--tx2)}
.tbl tr.tot td{font-weight:700;background:var(--panel2)}
.tbl tr.tot td:first-child{background:var(--panel2)}
.tbl td.c{cursor:pointer}.tbl td.c:hover{background:var(--panel2)}
.tbl .past{background:color-mix(in srgb,var(--panel2) 45%,transparent)}
.tbl .today{box-shadow:inset 2px 0 0 var(--sf)}
.var{display:block;font-size:10.5px;color:var(--tx3);font-weight:500}
.scroll{overflow:auto;max-height:560px;border:1px solid var(--line);border-radius:12px}
.badge{display:inline-flex;align-items:center;gap:4px;border-radius:6px;padding:2px 7px;font-size:11px;font-weight:700;letter-spacing:.02em}
.b-prov{background:color-mix(in srgb,var(--prov) 16%,transparent);color:var(--prov);border:1px dashed var(--prov)}
.b-real{background:color-mix(in srgb,var(--in) 14%,transparent);color:var(--in)}
.b-late{background:color-mix(in srgb,var(--amber) 18%,transparent);color:var(--amber)}
.row-prov td{background:repeating-linear-gradient(135deg,transparent 0 8px,color-mix(in srgb,var(--prov) 5%,transparent) 8px 16px)}
.list{width:100%;border-collapse:collapse}
.list th,.list td{padding:10px;border-bottom:1px solid var(--line);text-align:left;vertical-align:middle}
.list th{color:var(--tx3);font-size:11px;text-transform:uppercase;letter-spacing:.04em;font-weight:600}
.list td.r,.list th.r{text-align:right}
.muted{color:var(--tx3)}
.acct{display:flex;flex-direction:column;gap:2px;max-height:330px;overflow:auto}
.acct label{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px;cursor:pointer}
.acct label:hover{background:var(--panel2)}
.acct .bal{margin-left:auto;font-weight:600}
.pop{position:relative}
.pop .menu{position:absolute;top:calc(100% + 6px);left:0;z-index:20;width:360px;background:var(--panel);border:1px solid var(--line2);border-radius:12px;padding:10px;box-shadow:0 18px 40px rgba(0,0,0,.18);display:none}
.pop.open .menu{display:block}
.drawer{position:fixed;top:0;right:0;bottom:0;width:min(560px,100%);background:var(--panel);border-left:1px solid var(--line2);box-shadow:-20px 0 50px rgba(0,0,0,.2);transform:translateX(105%);transition:.22s;z-index:40;display:flex;flex-direction:column}
.drawer.open{transform:none}
.drawer header{padding:18px 20px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:10px}
.drawer .body{padding:6px 20px 20px;overflow:auto}
.modal-bg{position:fixed;inset:0;background:rgba(10,14,22,.5);display:none;align-items:center;justify-content:center;z-index:50;padding:16px}
.modal-bg.open{display:flex}
.modal{background:var(--panel);border-radius:16px;width:min(560px,100%);padding:22px;border:1px solid var(--line2)}
.modal h3{margin:0 0 4px;font-size:18px}
.fld{display:flex;flex-direction:column;gap:5px;margin-top:12px}
.fld span{color:var(--tx2);font-size:12px;font-weight:600}
.fld input,.fld select{background:var(--panel2);border:1px solid var(--line2);border-radius:9px;padding:9px 11px;outline:none}
.fld input:focus{border-color:var(--sf)}
.row2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.alert{border-radius:10px;padding:10px 12px;margin-top:12px;font-size:12.5px}
.alert.warn{background:color-mix(in srgb,var(--amber) 14%,transparent);color:var(--tx);border:1px solid color-mix(in srgb,var(--amber) 50%,transparent)}
.alert.ok{background:color-mix(in srgb,var(--in) 12%,transparent);border:1px solid color-mix(in srgb,var(--in) 40%,transparent)}
.radio{display:flex;flex-direction:column;gap:6px;margin-top:6px}
.radio label{display:flex;gap:8px;align-items:flex-start;padding:8px 10px;border:1px solid var(--line);border-radius:9px;cursor:pointer}
.radio label:has(input:checked){border-color:var(--sf);background:color-mix(in srgb,var(--sf) 7%,transparent)}
.toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%) translateY(30px);opacity:0;background:var(--tx);color:var(--bg);padding:10px 16px;border-radius:10px;font-weight:600;transition:.2s;z-index:60}
.toast.show{opacity:1;transform:translateX(-50%)}
.hide{display:none!important}
.mini{font-size:11.5px;color:var(--tx3)}
.side h4{margin:0 0 10px;font-size:13px}
.side .it{display:flex;justify-content:space-between;gap:8px;padding:7px 0;border-bottom:1px dashed var(--line)}
.side .it:last-child{border:0}
@media(max-width:640px){.wrap{padding:16px}#empChips{display:flex;flex-wrap:wrap;gap:6px}.kpi .v{font-size:19px}.row2{grid-template-columns:1fr}.pop .menu{width:min(340px,calc(100vw - 32px))}}
/* ── Fluxo v2: cenários ── */
.sim-grid{display:grid;grid-template-columns:minmax(0,1fr) 360px;gap:14px;align-items:start}
@media(max-width:1150px){.sim-grid{grid-template-columns:minmax(0,1fr)}}
.hero{padding:20px 22px 16px;background:
  radial-gradient(1200px 300px at 0% 0%,color-mix(in srgb,var(--sf) 9%,transparent),transparent 60%),var(--panel)}
.hero-top{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;flex-wrap:wrap;margin-bottom:6px}
.hero-v{font-size:34px;font-weight:700;letter-spacing:-.03em;margin:2px 0}
.cen-legend{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.cen-legend button{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line2);background:var(--panel);border-radius:999px;padding:5px 11px;font-weight:600;font-size:12px;color:var(--tx2)}
.cen-legend button.on{color:var(--tx)}
.cen-legend button:not(.on){opacity:.55}
.cen-legend i{width:16px;height:3px;border-radius:2px;display:inline-block}
.chart-wrap{position:relative}
.tip{position:absolute;pointer-events:none;background:color-mix(in srgb,var(--panel) 92%,transparent);backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);border:1px solid var(--line2);border-radius:12px;padding:10px 12px;font-size:12px;box-shadow:0 12px 30px rgba(0,0,0,.16);min-width:210px;display:none;z-index:5}
.tip .r{display:flex;justify-content:space-between;gap:14px;padding:2px 0}
.tip .r i{width:10px;height:3px;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:3px}
.flows-h{display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;border-top:1px solid var(--line);padding-top:16px;margin-top:4px}
.flows-tot{display:flex;gap:22px;flex-wrap:wrap}.flows-tot>span{display:flex;flex-direction:column}.flows-tot b{font-size:18px;letter-spacing:-.02em}
.simu{position:sticky;top:12px}
.cen-tabs{display:flex;gap:6px;flex-wrap:wrap;margin:12px 0}
.cen-tabs button{border:1px solid var(--line2);background:var(--panel);border-radius:9px;padding:6px 10px;font-weight:600;font-size:12px;color:var(--tx2);display:inline-flex;align-items:center;gap:6px}
.cen-tabs button.on{color:var(--tx);border-color:var(--tx2);background:var(--panel2)}
.lev{margin:12px 0 4px}
.lev .h{display:flex;justify-content:space-between;font-size:12px;color:var(--tx2);font-weight:600}
.lev .h b{color:var(--tx);font-variant-numeric:tabular-nums}
.lev input[type=range]{-webkit-appearance:none;appearance:none;width:100%;height:4px;border-radius:2px;background:linear-gradient(90deg,var(--cc,var(--sf)) var(--p,0%),var(--line2) var(--p,0%));margin:10px 0 4px;outline:none}
.lev input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--panel);border:2px solid var(--cc,var(--sf));box-shadow:0 1px 4px rgba(0,0,0,.2);cursor:pointer}
.lev input[type=range]::-moz-range-thumb{width:14px;height:14px;border-radius:50%;background:var(--panel);border:2px solid var(--cc,var(--sf))}
.lev .d{font-size:11px;color:var(--tx3)}
.sec{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--tx3);margin:16px 0 4px;display:flex;justify-content:space-between;align-items:center}
.ev{display:grid;grid-template-columns:18px 1fr auto;gap:8px;align-items:start;padding:8px 0;border-bottom:1px dashed var(--line)}
.ev:last-child{border:0}
.ev .t{font-weight:600;font-size:12.5px}
.ev .x{background:none;border:0;color:var(--tx3);font-size:14px;padding:0 2px}
.evform{display:none;background:var(--panel2);border-radius:10px;padding:10px;margin-top:8px}
.evform.open{display:block}
.evform input,.evform select{width:100%;background:var(--panel);border:1px solid var(--line2);border-radius:8px;padding:7px 9px;margin-top:6px}
.evform .row2{gap:8px}
.cmp-sw{width:10px;height:10px;border-radius:3px;display:inline-block;margin-right:7px;vertical-align:-1px}
.bancos{gap:8px;margin-top:-4px}
.bk{display:inline-flex;align-items:center;gap:8px;border:1px solid var(--line2);background:var(--panel);border-radius:12px;padding:7px 12px;text-align:left;color:var(--tx2);transition:.12s}
.bk>span:last-child{display:flex;flex-direction:column;font-weight:600;font-size:12px;line-height:1.25}
.bk b{font-size:13px;color:var(--tx)}.bk b.neg{color:var(--out)}
.bk .ck{width:16px;height:16px;border-radius:5px;border:1.5px solid var(--line2);display:inline-flex;align-items:center;justify-content:center;font-size:11px;color:#fff;flex:none}
.bk.on{border-color:var(--sf);color:var(--tx);box-shadow:0 0 0 1px var(--sf) inset}.bk.on .ck{background:var(--sf);border-color:var(--sf)}
.bk:not(.on){opacity:.6}
.bk-tot{display:flex;flex-direction:column;margin-left:auto;text-align:right}.bk-tot b{font-size:20px;letter-spacing:-.02em}
#diaTbl th{position:sticky;top:0;background:var(--panel);z-index:2}
#diaTbl tr.dr{cursor:pointer}#diaTbl tr.dr:hover td{background:var(--panel2)}
#diaTbl tr.past td{color:var(--tx2)}#diaTbl tr.hoje td{box-shadow:inset 0 2px 0 var(--sf);background:color-mix(in srgb,var(--sf) 6%,transparent)}
#diaTbl tr.low td:first-child{box-shadow:inset 3px 0 0 var(--amber)}
#diaTbl .car{display:inline-block;width:14px;color:var(--tx3)}
#diaTbl td{padding:9px 12px}
.sbar{height:6px;border-radius:3px;background:var(--panel2);overflow:hidden}.sbar i{display:block;height:100%;border-radius:3px}
.sub-l td{background:var(--panel2);padding:4px 12px 10px 36px!important}
.lancs{display:flex;flex-direction:column}
.ln{display:grid;grid-template-columns:110px 1fr auto;gap:10px;align-items:center;padding:7px 0;border-bottom:1px dashed var(--line)}.ln:last-child{border:0}
#diaIr{white-space:nowrap}
.kpi input{background:transparent;border:0;border-bottom:1px dashed var(--line2);font-size:22px;font-weight:700;width:100%;padding:2px 0;outline:none;letter-spacing:-.02em}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <div>
      <div class="k">Financeiro</div>
      <h1 id="ttl">Fluxo de Caixa</h1>
      <div class="sub">Mockup operacional · dados de exemplo calibrados com o omie-data em 08/10/2026 · fluxo por empresa, bancos unificados</div>
    </div>
    <div class="bar" style="margin:0">
      <button class="btn sm ghost" id="theme">◐ tema</button>
    </div>
  </div>

  <nav class="tabs" id="tabs">
    <button data-t="pagar">Títulos a Pagar</button>
    <button data-t="receber">Títulos a Receber</button>
    <button data-t="fluxo" class="on">Fluxo de Caixa<span class="new">novo</span></button>
    <button data-t="conc">Conciliação</button>
    <button data-t="inter">Intercompany</button>
  </nav>

  <!-- ═════════════ FLUXO DE CAIXA v2 (cenários) ═════════════ -->
  <section id="v-fluxo">
    <div class="bar">
      <span class="lbl">Empresa</span>
      <span id="empChips"></span>
      <div class="pop hide" id="popContas">
        <button class="btn sm" id="btnContas">Contas: <b id="contasLbl">todas</b> ▾</button>
        <div class="menu">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <b>Contas bancárias</b>
            <span><button class="btn sm ghost" id="cTodas">todas</button><button class="btn sm ghost" id="cNenhuma">nenhuma</button></span>
          </div>
          <div class="acct" id="acctList"></div>
          <div class="mini" style="margin-top:8px">Título sem conta definida entra pela conta padrão da empresa.</div>
        </div>
      </div>
      <span style="flex:1"></span>
      <span class="lbl">Janela</span>
      <div class="seg" id="segJanela">
        <button data-j="-1,1">−1m / +1m</button>
        <button data-j="-3,3" class="on">−3m / +3m</button>
        <button data-j="-6,6">−6m / +6m</button>
        <button data-j="0,3">só futuro 90d</button>
      </div>
    </div>
    <div class="bar bancos" id="bancos"></div>
    <div class="bar" style="margin-top:-6px">
      <span class="tog on" data-tg="prov"><i></i>Incluir provisionados</span>
      <span class="tog on" data-tg="venc"><i></i>Contas a pagar vencidas entram hoje</span>
      <span class="tog on" data-tg="inter"><i></i>Ocultar transferências entre os bancos escolhidos</span>
    </div>

    <div class="kpis" id="kpis2"></div>

    <div class="sim-grid">
      <!-- gráfico principal -->
      <div class="card hero">
        <div class="hero-top">
          <div>
            <div class="k">Saldo projetado · <span id="heroCen"></span></div>
            <div class="hero-v num" id="heroV"></div>
            <div class="mini" id="heroS"></div>
          </div>
          <div class="cen-legend" id="cenLegend"></div>
        </div>
        <div class="bar" style="margin:4px 0 10px;gap:12px">
          <div class="seg" id="segVista"><button data-v="passado">Só passado</button><button data-v="ambos" class="on">Passado + futuro</button><button data-v="futuro">Só futuro</button></div>
          <span class="tog" data-tg="zero"><i></i>Escala a partir do zero</span>
          <span class="tog on" data-tg="banda"><i></i>Faixa de incerteza</span>
          <span class="mini" id="zoomLbl" style="margin-left:auto"></span>
        </div>
        <div class="chart-wrap" id="heroWrap"><div id="hero"></div><div class="tip" id="tip"></div></div>
        <div id="brush" style="margin-top:8px"></div>
        <div class="mini" style="display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin:6px 2px 10px">
          <span>Linha cheia = realizado · Área azul = cenário base · Faixa = incerteza histórica (desvio previsto × realizado) · ◆ = evento simulado</span>
          <span>Escala ajusta ao trecho visível · arraste no navegador acima (ou role o mouse no gráfico) para dar zoom · duplo clique volta</span>
        </div>
        <div class="flows-h"><div><b style="font-size:15px">Entradas e saídas</b><div class="mini" id="flowsLbl"></div></div>
          <div class="flows-tot" id="flowsTot"></div>
          <div class="seg" id="segFlow"><button data-f="auto" class="on">Auto</button><button data-f="dia">Dia</button><button data-f="semana">Semana</button><button data-f="mes">Mês</button></div></div>
        <div class="legend" style="margin:8px 0 2px"><span><i class="sw" style="background:var(--in)"></i>entrada</span><span><i class="sw hatch-in"></i>entrada provisionada</span><span><i class="sw" style="background:var(--out)"></i>saída</span><span><i class="sw hatch-out"></i>saída provisionada</span><span>clique na coluna para ver os lançamentos</span></div>
        <div id="flows" style="overflow-x:auto"></div>
      </div>

      <!-- simulador -->
      <aside class="card simu" id="simu">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <b style="font-size:14px">Simulador</b>
          <span><button class="btn sm" id="dupCen">Duplicar</button> <button class="btn sm pri" id="novoCen">+ Cenário</button></span>
        </div>
        <div class="cen-tabs" id="cenTabs"></div>
        <div id="cenEdit"></div>
      </aside>
    </div>

    <div class="card" style="margin-top:14px;padding:0" id="diaCard">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap;padding:16px 18px">
        <div id="diaHead"></div>
        <div class="flows-tot" id="diaTot"></div>
        <div class="bar" style="margin:0">
          <span class="tog on" id="diaMov"><i></i>Só dias com movimento</span>
          <button class="btn sm" id="diaIr">Próximos 30 dias</button>
          <button class="btn sm" id="diaAbrir">Abrir/fechar todos</button>
          <button class="btn sm" id="diaCsv">CSV</button>
        </div>
      </div>
      <div class="scroll" id="diaScroll" style="border:0;border-top:1px solid var(--line);border-radius:0 0 var(--r) var(--r);max-height:620px"><table class="list num" id="diaTbl"></table></div>
    </div>

    <div class="card" style="margin-top:14px">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:10px">
        <b>Comparativo de cenários</b>
        <span class="mini">Δ sempre contra o cenário Base · necessidade de caixa = quanto falta para não furar o colchão</span>
      </div>
      <div style="overflow-x:auto"><table class="list num" id="cmp"></table></div>
    </div>

    <div class="card" style="margin-top:14px;padding:0">
      <div style="display:flex;justify-content:space-between;align-items:center;padding:14px 18px;gap:10px;flex-wrap:wrap">
        <b>Demonstrativo do fluxo (cenário base) · <span id="tblGran"></span></b>
        <div class="bar" style="margin:0">
          <div class="seg" id="segGran">
            <button data-g="dia">Dia</button>
            <button data-g="semana" class="on">Semana</button>
            <button data-g="mes">Mês</button>
          </div>
          <span class="tog" data-tg="ghost"><i></i>Previsto original</span>
          <button class="btn sm" id="csv">CSV</button>
        </div>
      </div>
      <div class="scroll" style="border:0;border-top:1px solid var(--line);border-radius:0 0 var(--r) var(--r)"><table class="tbl num" id="tbl"></table></div>
    </div>
  </section>

  <!-- ═════════════ PAGAR (recorte: provisões) ═════════════ -->
  <section id="v-pagar" class="hide">
    <div class="kpis" id="kpisProv"></div>
    <div class="bar">
      <div class="seg" id="segProv">
        <button data-f="todos" class="on">Todos</button>
        <button data-f="prov">Provisionados</button>
        <button data-f="real">Reais (com documento)</button>
        <button data-f="aguard">Provisionados vencendo em 7d</button>
      </div>
      <span class="mini">Recorte da tela atual — só a coluna/ações novas. O resto da Títulos a Pagar v3 fica igual.</span>
    </div>
    <div class="card" style="padding:0;overflow:auto">
      <table class="list num" id="provTbl"></table>
    </div>
  </section>

  <section id="v-outro" class="hide"><div class="card muted">Tela existente — fora do escopo deste mockup.</div></section>
</div>

<!-- drawer de lançamentos -->
<aside class="drawer" id="drawer">
  <header><div><div class="k" id="dwK"></div><b id="dwT" style="font-size:16px"></b><div class="mini" id="dwS"></div></div><button class="btn sm" id="dwX">✕</button></header>
  <div class="body" id="dwB"></div>
</aside>

<!-- modal confirmar provisão -->
<div class="modal-bg" id="mBg">
  <div class="modal">
    <div class="k">Confirmar provisão</div>
    <h3 id="mT"></h3>
    <div class="mini" id="mS"></div>
    <div class="row2">
      <label class="fld"><span>Tipo de documento</span>
        <select id="fTipo"><option value="NFSE">NFS-e</option><option value="NFE">NF-e</option><option value="BOL">Boleto / fatura</option><option value="REC">Recibo</option><option value="DAS">Guia (DAS/DARF/GPS)</option></select></label>
      <label class="fld"><span>Nº do documento *</span><input id="fNum" placeholder="ex.: 257"></label>
    </div>
    <div class="row2">
      <label class="fld"><span>Valor real (R$) *</span><input id="fVal" inputmode="decimal"></label>
      <label class="fld"><span>Vencimento real</span><input id="fVenc" type="date"></label>
    </div>
    <label class="fld"><span>Código de barras / linha digitável / chave NF-e (opcional)</span><input id="fBar" placeholder="44–48 dígitos"></label>
    <div id="fDiff"></div>
    <div id="fEscopo" class="hide">
      <div class="fld"><span>A diferença vale para…</span></div>
      <div class="radio">
        <label><input type="radio" name="esc" value="esta" checked><div><b>Só esta parcela</b><div class="mini">Consumo variável (energia, água, telefonia). As próximas continuam com o valor provisionado.</div></div></label>
        <label><input type="radio" name="esc" value="proximas"><div><b>Esta e as próximas provisões da série</b><div class="mini">Reajuste de contrato / novo valor fixo. Ajusta as provisões futuras que ainda não têm documento.</div></div></label>
        <label><input type="radio" name="esc" value="media"><div><b>Próximas pela média das últimas 3 reais</b><div class="mini">Para consumo: a provisão passa a ser a média móvel dos últimos 3 documentos.</div></div></label>
      </div>
    </div>
    <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px">
      <button class="btn" id="mCancel">Cancelar</button>
      <button class="btn pri" id="mOk">Confirmar e marcar como real</button>
    </div>
  </div>
</div>
<div class="toast" id="toast"></div>

<script>
/* ───────────── utilidades ───────────── */
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const HOJE=new Date(2026,9,8);
const iso=d=>d.toISOString().slice(0,10);
const addD=(d,n)=>{const x=new Date(d);x.setDate(x.getDate()+n);return x};
const addM=(d,n)=>new Date(d.getFullYear(),d.getMonth()+n,d.getDate());
const brl=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:0});
const brl2=v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const k=v=>{const a=Math.abs(v);const s=v<0?'−':'';return a>=1e6?s+(a/1e6).toFixed(2).replace('.',',')+' mi':a>=1e3?s+Math.round(a/1e3)+'k':s+Math.round(a)};
const dBR=d=>d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
const MES=['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
let seed=7;const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)}

/* ───────────── dados de exemplo ─────────────
   Contas e saldos = tela de hoje. Totais mensais ≈ omie-data (pesquisa_titulos). */
const EMP={CD:{nome:'CDG Projetos',cor:'var(--cd)'},SF:{nome:'SafeWater',cor:'var(--sf)'},WW:{nome:'WaterWorks',cor:'var(--ww)'}};
const CONTAS=[
 {id:1,emp:'CD',nome:'BB Automático Mais - CDG',saldo:6327.66,pad:true},
 {id:2,emp:'CD',nome:'Bradesco',saldo:-27982.17},
 {id:3,emp:'CD',nome:'Omie.CASH',saldo:0},
 {id:4,emp:'SF',nome:'Omie.CASH',saldo:139485.61,pad:true},
 {id:5,emp:'SF',nome:'Conta Simples',saldo:53996},
 {id:6,emp:'SF',nome:'C6 Bank',saldo:52131.81},
 {id:7,emp:'SF',nome:'Bradesco - Safe',saldo:6979.38},
 {id:8,emp:'SF',nome:'Aplicação Automática - Safe',saldo:39.95},
 {id:9,emp:'SF',nome:'Nubank',saldo:22.05},
 {id:10,emp:'WW',nome:'Omie.CASH',saldo:1104.03,pad:true},
 {id:11,emp:'WW',nome:'Bradesco - WW',saldo:-2589.34},
];
const GRUPOS={
 E:['Contratos recorrentes','Faturamento OS / vendas','Outras entradas'],
 S:['Pessoal e PJ','Fornecedores e matéria-prima','Impostos e guias','Locação de veículos','Administrativo e consumo','Financeiras']
};
// saídas mensais realizadas (abr→set) e entradas — omie-data
const REAL_S={CD:[27322,46550,25109,41684,74662,30911],SF:[518646,525959,559012,530211,455663,637432],WW:[17536,19003,22866,21222,20596,20234]};
const REAL_E={CD:[0,0,0,0,0,0],SF:[955330,442466,655074,752188,612970,933008],WW:[370,46079,370,370,370,370]};
const MIX_S=[.34,.30,.14,.06,.12,.04], MIX_E=[.62,.33,.05];

let L=[]; let nid=1;
function push(o){o.id=nid++;L.push(o)}
function contaDe(emp){const cs=CONTAS.filter(c=>c.emp===emp);const r=rnd();return r<.65?cs.find(c=>c.pad).id:cs[Math.floor(rnd()*cs.length)].id}
function espalha(emp,nat,total,ano,mes,status){ // quebra um total mensal em ~10–18 lançamentos
  if(total<=0)return; const n=8+Math.floor(rnd()*10); const mix=nat==='E'?MIX_E:MIX_S; const gs=GRUPOS[nat];
  for(let i=0;i<n;i++){ const g=pick(mix); const d=new Date(ano,mes,1+Math.floor(rnd()*27));
    push({emp,nat,grupo:gs[g],data:d,valor:Math.round(total/n*(.6+rnd()*.8)),status,conta:contaDe(emp),
      contraparte:nome(nat,g),prov:false,doc:status==='realizado'?'NF '+(1000+Math.floor(rnd()*900)):null}); }
}
function pick(mix){let r=rnd(),a=0;for(let i=0;i<mix.length;i++){a+=mix[i];if(r<a)return i}return mix.length-1}
const NOMES_S=[['Folha CLT','Pró-labore','Prestadores PJ'],['MECSTEEL Inox','TD SYNNEX','Brascon Tubos','Resinas e membranas'],['Simples Nacional (DAS)','DARF','GPS'],['Maestro Locadora'],['Condomínio Microservice','Energia','Telefonia','ZAC Contábil','Amil'],['Tarifas bancárias','Juros antecipação']];
const NOMES_E=[['Contratos hospitais'],['Faturamento OS','Venda de equipamentos'],['Rendimentos']];
function nome(nat,g){const a=(nat==='E'?NOMES_E:NOMES_S)[g];return a[Math.floor(rnd()*a.length)]}

// PASSADO: abr–set realizados + 1–7 out
['CD','SF','WW'].forEach(emp=>{for(let m=0;m<6;m++){espalha(emp,'S',REAL_S[emp][m],2026,3+m,'realizado');espalha(emp,'E',REAL_E[emp][m],2026,3+m,'realizado');}});
espalha('SF','S',91065,2026,9,'tmp');espalha('WW','S',11162,2026,9,'tmp');espalha('SF','E',98101,2026,9,'tmp');
L.forEach(x=>{if(x.status==='tmp'){x.status='realizado';x.data=new Date(2026,9,1+Math.floor(rnd()*7))}});
// previsto original do passado (snapshot) = realizado * desvio
L.filter(x=>x.status==='realizado').forEach(x=>x.previstoOrig=Math.round(x.valor*(0.85+rnd()*.3)));

const RECOR={'Pessoal e PJ':['MARCELO CARMINATI (PJ)','Prestadores PJ','Folha CLT'],'Fornecedores e matéria-prima':['Locação de sistemas','Manutenção frota'],'Impostos e guias':['Simples Nacional (DAS)','DARF','GPS'],'Locação de veículos':['Maestro Locadora'],'Administrativo e consumo':['Condomínio Microservice','Energia','Água','Telefonia','ZAC Contábil','Amil'],'Financeiras':['Tarifas bancárias']};
// FUTURO: provisões recorrentes (RPTP sem NF) + reais (com documento)
const PROV={CD:[48165,34215,34215,34215,31231,34709],SF:[227746,236796,233951,212664,225969,252737],WW:[20679,20096,20096,17057,12951,30366]};
const REALF={CD:[5983,2490,2490,0,0,0],SF:[306604,44124,30205,0,0,0],WW:[3992,992,992,992,992,992]};
['CD','SF','WW'].forEach(emp=>{for(let m=0;m<6;m++){
  const before=L.length; espalha(emp,'S',PROV[emp][m],2026,9+m,'aberto'); L.slice(before).forEach(x=>{x.prov=true;x.doc=null;x.contraparte=RECOR[x.grupo]?RECOR[x.grupo][Math.floor(rnd()*RECOR[x.grupo].length)]:x.contraparte});
  const b2=L.length; espalha(emp,'S',REALF[emp][m],2026,9+m,'aberto'); L.slice(b2).forEach(x=>{x.doc='NF '+(2000+Math.floor(rnd()*900))});
}});
// entradas futuras: Omie só tem out/nov reais; contratos recorrentes (vendas.contratos) entram como provisionado
const ENT_REAL=[665577,187427,0,0,0,0], ENT_CONTR=[0,520000,610000,600000,590000,640000];
for(let m=0;m<6;m++){const b=L.length;espalha('SF','E',ENT_REAL[m],2026,9+m,'aberto');L.slice(b).forEach(x=>x.doc='Recibo '+(500+Math.floor(rnd()*400)));
  const b2=L.length;espalha('SF','E',ENT_CONTR[m],2026,9+m,'aberto');L.slice(b2).forEach(x=>{x.prov=true;x.grupo='Contratos recorrentes';x.contraparte='Contrato (a faturar)';x.doc=null});}
// vencidos em aberto (últimos 60d)
for(let i=0;i<38;i++){push({emp:rnd()<.85?'SF':'CD',nat:'S',grupo:GRUPOS.S[pick(MIX_S)],data:addD(HOJE,-1-Math.floor(rnd()*60)),valor:Math.round(500+rnd()*8000),status:'aberto',conta:4,contraparte:'Título vencido',prov:false,doc:'NF '+(900+i)})}
// futuros do mês: jogar só para frente de hoje
L.forEach(x=>{if(x.status==='aberto'&&x.data<HOJE&&x.contraparte!=='Título vencido'){x.data=addD(HOJE,Math.floor(rnd()*20))}});
// transferências entre contas (para mostrar o filtro)
for(let m=0;m<6;m++){const d=new Date(2026,3+m,10);push({emp:'SF',nat:'S',grupo:'Transferência',data:d,valor:40000,status:'realizado',conta:4,contraparte:'→ C6 Bank',transf:true,previstoOrig:40000});push({emp:'SF',nat:'E',grupo:'Transferência',data:d,valor:40000,status:'realizado',conta:6,contraparte:'← Omie.CASH',transf:true,previstoOrig:40000});}

/* ───────────── estado ───────────── */
const S={emps:new Set(['CD','SF','WW']),contas:new Set(CONTAS.map(c=>c.id)),j:[-3,3],g:'semana',prov:true,venc:true,inter:true,ghost:false,abertos:new Set()};

/* ───────────── filtros UI ───────────── */
function renderChips(){
  $('#empChips').innerHTML=Object.entries(EMP).map(([c,e])=>`<button class="chip ${S.emps.has(c)?'on':''}" data-e="${c}" style="margin-right:6px"><i class="dot" style="background:${e.cor}"></i>${c} · ${e.nome}</button>`).join('');
  $$('#empChips .chip').forEach(b=>b.onclick=()=>{const c=b.dataset.e;
    if(S.emps.has(c)){if(S.emps.size===1)return;S.emps.delete(c);CONTAS.filter(x=>x.emp===c).forEach(x=>S.contas.delete(x.id))}
    else{S.emps.add(c);CONTAS.filter(x=>x.emp===c).forEach(x=>S.contas.add(x.id))}
    renderAll()});
}
function renderContas(){
  const vis=CONTAS.filter(c=>S.emps.has(c.emp));
  $('#acctList').innerHTML=[...S.emps].map(e=>`<div class="mini" style="margin:6px 8px 2px;font-weight:700"><i class="dot" style="background:${EMP[e].cor}"></i>${EMP[e].nome}</div>`+
    vis.filter(c=>c.emp===e).map(c=>`<label><input type="checkbox" data-c="${c.id}" ${S.contas.has(c.id)?'checked':''}>${c.nome}${c.pad?' <span class="mini">· padrão</span>':''}<span class="bal num ${c.saldo<0?'neg':''}">${brl(c.saldo)}</span></label>`).join('')).join('');
  $$('#acctList input').forEach(i=>i.onchange=()=>{const id=+i.dataset.c;i.checked?S.contas.add(id):S.contas.delete(id);renderAll(false)});
  const sel=vis.filter(c=>S.contas.has(c.id)).length;
  $('#contasLbl').textContent=sel===vis.length?'todas ('+sel+')':sel+' de '+vis.length;
}
$('#btnContas').onclick=e=>{e.stopPropagation();$('#popContas').classList.toggle('open')};
document.addEventListener('click',e=>{if(!$('#popContas').contains(e.target))$('#popContas').classList.remove('open')});
$('#cTodas').onclick=()=>{CONTAS.filter(c=>S.emps.has(c.emp)).forEach(c=>S.contas.add(c.id));renderAll(false)};
$('#cNenhuma').onclick=()=>{S.contas.clear();renderAll(false)};
$$('#segJanela button').forEach(b=>b.onclick=()=>{$$('#segJanela button').forEach(x=>x.classList.remove('on'));b.classList.add('on');S.j=b.dataset.j.split(',').map(Number);S.zoom=null;renderAll()});
$$('#segGran button').forEach(b=>b.onclick=()=>{$$('#segGran button').forEach(x=>x.classList.remove('on'));b.classList.add('on');S.g=b.dataset.g;renderAll()});
$$('.tog').forEach(t=>t.onclick=()=>{t.classList.toggle('on');S[t.dataset.tg]=t.classList.contains('on');renderAll()});

/* ───────────── motor do fluxo ───────────── */
function lancFiltrados(){
  return L.filter(x=>S.emps.has(x.emp)&&S.contas.has(x.conta)&&!(S.inter&&x.transf)&&(S.prov||!x.prov))
   .map(x=>{ if(x.status==='aberto'&&x.data<HOJE){ return S.venc?{...x,dataEf:HOJE,late:true}:null } return {...x,dataEf:x.data} }).filter(Boolean);
}
function buckets(){
  const ini=S.j[0]===0?HOJE:addM(new Date(HOJE.getFullYear(),HOJE.getMonth(),1),S.j[0]);
  const fim=S.j[0]===0?addD(HOJE,90):addD(addM(new Date(HOJE.getFullYear(),HOJE.getMonth()+1,1),S.j[1]),-1);
  const out=[];let d=new Date(ini);
  if(S.g==='dia'){while(d<=fim){out.push({a:new Date(d),b:new Date(d),lbl:dBR(d)});d=addD(d,1)}}
  else if(S.g==='semana'){d=addD(d,-((d.getDay()+6)%7));while(d<=fim){const b=addD(d,6);out.push({a:new Date(d),b,lbl:dBR(d)});d=addD(d,7)}}
  else{d=new Date(d.getFullYear(),d.getMonth(),1);while(d<=fim){const b=new Date(d.getFullYear(),d.getMonth()+1,0);out.push({a:new Date(d),b,lbl:MES[d.getMonth()]+'/'+String(d.getFullYear()).slice(2)});d=new Date(d.getFullYear(),d.getMonth()+1,1)}}
  out.forEach(x=>{x.past=x.b<HOJE;x.cur=x.a<=HOJE&&x.b>=HOJE});
  return {ini:out[0].a,fim:out[out.length-1].b,list:out};
}
function saldoHoje(){return CONTAS.filter(c=>S.emps.has(c.emp)&&S.contas.has(c.id)).reduce((a,c)=>a+c.saldo,0)}
function calc(){
  const B=buckets(), xs=lancFiltrados(); const day=d=>new Date(d.getFullYear(),d.getMonth(),d.getDate());
  B.list.forEach(b=>{b.items=[];b.E=0;b.S=0;b.Ep=0;b.Sp=0;b.Eo=0;b.So=0;b.gE={};b.gS={};b.gEp={};b.gSp={};b.gEo={};b.gSo={}});
  for(const x of xs){const d=day(x.dataEf);const b=B.list.find(b=>d>=b.a&&d<=b.b);if(!b)continue;b.items.push(x);
    const E=x.nat==='E';const key=E?'E':'S';b[key]+=x.valor;b['g'+key][x.grupo]=(b['g'+key][x.grupo]||0)+x.valor;
    if(x.prov){b[key+'p']+=x.valor;b['g'+key+'p'][x.grupo]=(b['g'+key+'p'][x.grupo]||0)+x.valor}
    if(x.status==='realizado'){b[key+'o']+=x.previstoOrig||x.valor;b['g'+key+'o'][x.grupo]=(b['g'+key+'o'][x.grupo]||0)+(x.previstoOrig||x.valor)}}
  // saldo: âncora = saldo de hoje; para trás desfaz realizados, para frente soma abertos
  const sh=saldoHoje(); const realPos=xs.filter(x=>x.status==='realizado'&&day(x.dataEf)>=B.ini).reduce((a,x)=>a+(x.nat==='E'?x.valor:-x.valor),0);
  let s=sh-realPos; // saldo no início da janela
  B.list.forEach(b=>{
    if(b.cur){ // mistura: realizados do período + abertos
      b.ini=s; b.fimSaldo=s+b.E-b.S; }
    else {b.ini=s;b.fimSaldo=s+b.E-b.S}
    s=b.fimSaldo});
  return {B,xs,sh};
}

/* ───────────── render ───────────── */
function renderAll(full=true){renderChips();renderContas();const R=calc();renderKpis(R);renderChart(R);renderSide(R);renderTable(R);}
function renderKpis({B,xs,sh}){
  const past=xs.filter(x=>x.status==='realizado'&&x.dataEf>=B.ini);
  const fut=xs.filter(x=>x.status==='aberto'&&x.dataEf<=B.fim);
  const sum=(a,n)=>a.filter(x=>x.nat===n).reduce((s,x)=>s+x.valor,0);
  const rE=sum(past,'E'),rS=sum(past,'S'),fE=sum(fut,'E'),fS=sum(fut,'S');
  const provS=fut.filter(x=>x.prov&&x.nat==='S').reduce((a,x)=>a+x.valor,0),provE=fut.filter(x=>x.prov&&x.nat==='E').reduce((a,x)=>a+x.valor,0);
  const futB=B.list.filter(b=>!b.past);let min=futB[0]||B.list[0];futB.forEach(b=>{if(b.fimSaldo<min.fimSaldo)min=b});
  const fim=B.list[B.list.length-1].fimSaldo;
  const late=xs.filter(x=>x.late).reduce((a,x)=>a+(x.nat==='S'?x.valor:0),0);
  const card=(l,v,s,cls='')=>`<div class="card kpi"><div class="l">${l}</div><div class="v num ${cls}">${v}</div><div class="s">${s}</div></div>`;
  $('#kpis').innerHTML=
    card('Saldo hoje · contas selecionadas',brl(sh),S.contas.size+' contas · Omie/OFX até 07/10',sh<0?'neg':'')+
    card('Realizado na janela',brl(rE-rS),`<span class="pos">+${k(rE)}</span> entradas · <span class="neg">−${k(rS)}</span> saídas`,rE-rS<0?'neg':'pos')+
    card('A realizar na janela',brl(fE-fS),`<span class="pos">+${k(fE)}</span> · <span class="neg">−${k(fS)}</span>${S.venc&&late?` · inclui ${k(late)} vencidos`:''}`,fE-fS<0?'neg':'pos')+
    card('Saldo projetado no fim',brl(fim),'em '+B.fim.toLocaleDateString('pt-BR'),fim<0?'neg':'')+
    card('Menor saldo projetado',brl(min?min.fimSaldo:0),min?(S.g==='dia'?'em ':'período de ')+min.lbl:'',min&&min.fimSaldo<0?'neg':'')+
    card('Provisionado no futuro',`<span class="pv">${k(provS+provE)}</span>`,`saídas ${k(provS)} · entradas ${k(provE)} · ${fS?Math.round(provS/fS*100):0}% das saídas`);
}
function renderChart({B}){
  const W=Math.max(760,B.list.length*(S.g==='dia'?14:S.g==='semana'?34:70)),H=300,pl=54,pr=14,pt=14,pb=34;
  const maxV=Math.max(1,...B.list.map(b=>Math.max(b.E,b.S,S.ghost?Math.max(b.Eo,b.So):0)));
  const sal=B.list.map(b=>b.fimSaldo);const smin=Math.min(0,...sal),smax=Math.max(0,...sal);
  const bw=(W-pl-pr)/B.list.length;const y=v=>pt+(H-pt-pb)*(1-v/maxV);const ys=v=>pt+(H-pt-pb)*(1-(v-smin)/((smax-smin)||1));
  let g=`<svg width="${W}" height="${H}" role="img" aria-label="Fluxo de caixa"><defs>
   <pattern id="hi" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--in)"/></pattern>
   <pattern id="ho" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--out)"/></pattern></defs>`;
  for(let i=0;i<=4;i++){const v=maxV*i/4;g+=`<line x1="${pl}" x2="${W-pr}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${pl-6}" y="${y(v)+3}" text-anchor="end">${k(v)}</text>`}
  B.list.forEach((b,i)=>{const x=pl+i*bw,w=Math.max(3,bw*.36);const op=b.past?1:.78;
    if(b.past)g+=`<rect x="${x}" y="${pt}" width="${bw}" height="${H-pt-pb}" fill="var(--panel2)" opacity=".5"/>`;
    const eR=b.E-b.Ep,sR=b.S-b.Sp;
    g+=`<rect x="${x+bw*.12}" y="${y(eR)}" width="${w}" height="${y(0)-y(eR)}" fill="var(--in)" opacity="${op}" rx="2"/>`;
    if(b.Ep)g+=`<rect x="${x+bw*.12}" y="${y(b.E)}" width="${w}" height="${y(eR)-y(b.E)}" fill="url(#hi)" stroke="var(--in)" stroke-width=".8"/>`;
    g+=`<rect x="${x+bw*.52}" y="${y(sR)}" width="${w}" height="${y(0)-y(sR)}" fill="var(--out)" opacity="${op}" rx="2"/>`;
    if(b.Sp)g+=`<rect x="${x+bw*.52}" y="${y(b.S)}" width="${w}" height="${y(sR)-y(b.S)}" fill="url(#ho)" stroke="var(--out)" stroke-width=".8"/>`;
    if(S.ghost&&b.past){g+=`<rect x="${x+bw*.12}" y="${y(b.Eo)}" width="${w}" height="${y(0)-y(b.Eo)}" fill="none" stroke="var(--tx2)" stroke-dasharray="3 2"/><rect x="${x+bw*.52}" y="${y(b.So)}" width="${w}" height="${y(0)-y(b.So)}" fill="none" stroke="var(--tx2)" stroke-dasharray="3 2"/>`}
    const step=Math.ceil(B.list.length/(W/60));if(i%step===0)g+=`<text x="${x+bw/2}" y="${H-pb+16}" text-anchor="middle">${b.lbl}</text>`;
    g+=`<rect x="${x}" y="${pt}" width="${bw}" height="${H-pt-pb}" fill="transparent" data-b="${i}" style="cursor:pointer"><title>${b.lbl}\nEntradas ${brl(b.E)} (prov. ${brl(b.Ep)})\nSaídas ${brl(b.S)} (prov. ${brl(b.Sp)})\nSaldo ${brl(b.fimSaldo)}</title></rect>`;
  });
  // linha de saldo: passado sólido, futuro tracejado
  const pts=B.list.map((b,i)=>[pl+i*bw+bw/2,ys(b.fimSaldo),b.past]);
  const iCur=Math.max(0,B.list.findIndex(b=>!b.past));
  const path=a=>a.map((p,i)=>(i?'L':'M')+p[0].toFixed(1)+' '+p[1].toFixed(1)).join(' ');
  g+=`<path d="${path(pts.slice(0,iCur+1))}" fill="none" stroke="var(--sf)" stroke-width="2.4"/>`;
  g+=`<path d="${path(pts.slice(iCur))}" fill="none" stroke="var(--sf)" stroke-width="2.4" stroke-dasharray="5 4"/>`;
  if(smin<0)g+=`<line x1="${pl}" x2="${W-pr}" y1="${ys(0)}" y2="${ys(0)}" stroke="var(--out)" stroke-dasharray="2 3" opacity=".6"/>`;
  const xc=pl+iCur*bw;g+=`<line x1="${xc}" x2="${xc}" y1="${pt}" y2="${H-pb}" stroke="var(--sf)"/><text x="${xc+4}" y="${pt+10}" style="fill:var(--sf);font-weight:700">hoje</text>`;
  const sx=W-pr;g+=`<text x="${sx}" y="${ys(smax)+3}" text-anchor="end" style="fill:var(--sf)">saldo ${k(smax)}</text>`;
  $('#chart').innerHTML=g+'</svg>';
  $$('#chart rect[data-b]').forEach(r=>r.onclick=()=>abrirBucket(B.list[+r.dataset.b]));
}
function renderSide({xs,B}){
  // provisionados que vencem em 7 dias e ainda sem documento
  const pend=L.filter(x=>x.prov&&x.nat==='S'&&x.status==='aberto'&&S.emps.has(x.emp)&&x.data>=HOJE&&x.data<=addD(HOJE,7)).sort((a,b)=>a.data-b.data);
  const byG={};xs.filter(x=>x.status==='aberto'&&x.nat==='S'&&x.dataEf<=addD(HOJE,30)).forEach(x=>byG[x.grupo]=(byG[x.grupo]||0)+x.valor);
  const top=Object.entries(byG).sort((a,b)=>b[1]-a[1]).slice(0,6);
  $('#side').innerHTML=`<h4>Saídas dos próximos 30 dias</h4>${top.map(([g,v])=>`<div class="it"><span>${g}</span><b class="num">${brl(v)}</b></div>`).join('')}
   <h4 style="margin-top:18px">Provisões aguardando documento · 7d <span class="badge b-prov">${pend.length}</span></h4>
   ${pend.slice(0,6).map(x=>`<div class="it"><span>${dBR(x.data)} · ${x.contraparte}<div class="mini">${x.emp} · ${x.grupo}</div></span><b class="num pv">${brl(x.valor)}</b></div>`).join('')||'<div class="mini">Nada pendente.</div>'}
   <button class="btn sm" style="margin-top:10px;width:100%" onclick="irPara('pagar','aguard')">Confirmar provisões →</button>`;
}
function renderTable({B}){
  $('#tblGran').textContent={dia:'por dia',semana:'por semana',mes:'por mês'}[S.g];
  const cols=B.list; const cls=b=>(b.past?'past':'')+(b.cur?' today':'');
  const cell=(b,v,vp,vo,click)=>{const showO=b.past&&vo!=null&&vo!==0;const d=showO?v-vo:0;
    return `<td class="c ${cls(b)}" ${click}>${v?k(v):'<span class="muted">—</span>'}${vp?`<span class="var pv"><i>${k(vp)} prov.</i></span>`:''}${showO?`<span class="var ${Math.abs(d)/vo>.1?(d>0?'neg':'pos'):''}">Δ ${d>0?'+':''}${k(d)}</span>`:''}</td>`};
  let h=`<thead><tr><th style="min-width:220px"></th>${cols.map(b=>`<th class="${cls(b)}">${b.lbl}${b.cur?' •':''}</th>`).join('')}</tr></thead><tbody>`;
  h+=`<tr class="tot"><td>Saldo inicial</td>${cols.map(b=>`<td class="${cls(b)} ${b.ini<0?'neg':''}">${k(b.ini)}</td>`).join('')}</tr>`;
  for(const nat of ['E','S']){
    const open=S.abertos.has(nat);
    h+=`<tr class="grp"><td style="cursor:pointer" data-x="${nat}">${open?'▾':'▸'} ${nat==='E'?'<span class="pos">Entradas</span>':'<span class="neg">Saídas</span>'}</td>${cols.map((b,i)=>cell(b,b[nat],b[nat+'p'],S.ghost||b.past?b[nat+'o']:null,`data-cell="${i}|${nat}|"`)).join('')}</tr>`;
    if(open) for(const g of GRUPOS[nat]) h+=`<tr class="sub"><td>${g}</td>${cols.map((b,i)=>cell(b,b['g'+nat][g]||0,b['g'+nat+'p'][g]||0,b.past?b['g'+nat+'o'][g]||0:null,`data-cell="${i}|${nat}|${g}"`)).join('')}</tr>`;
  }
  h+=`<tr class="grp"><td>Resultado do período</td>${cols.map(b=>{const v=b.E-b.S;return `<td class="${cls(b)} ${v<0?'neg':'pos'}">${k(v)}</td>`}).join('')}</tr>`;
  h+=`<tr class="tot"><td>Saldo final</td>${cols.map(b=>`<td class="${cls(b)} ${b.fimSaldo<0?'neg':''}">${k(b.fimSaldo)}</td>`).join('')}</tr></tbody>`;
  $('#tbl').innerHTML=h;
  $$('#tbl td[data-x]').forEach(t=>t.onclick=()=>{const n=t.dataset.x;S.abertos.has(n)?S.abertos.delete(n):S.abertos.add(n);renderTable(calc())});
  $$('#tbl td[data-cell]').forEach(t=>t.onclick=()=>{const [i,nat,g]=t.dataset.cell.split('|');abrirBucket(B.list[+i],nat,g)});
  const sc=$('.scroll'),th=$$('#tbl th.today')[0];if(th&&sc.scrollLeft===0)sc.scrollLeft=Math.max(0,th.offsetLeft-420);
}
function abrirBucket(b,nat,g){
  let it=b.items.slice();if(nat)it=it.filter(x=>x.nat===nat);if(g)it=it.filter(x=>x.grupo===g);
  it.sort((a,b)=>a.dataEf-b.dataEf);
  $('#dwK').textContent=b.past?'Realizado':'Projetado';
  $('#dwT').textContent=(S.g==='dia'?b.lbl:b.lbl+' → '+dBR(b.b))+(g?' · '+g:nat?' · '+(nat==='E'?'Entradas':'Saídas'):'');
  const tE=it.filter(x=>x.nat==='E').reduce((a,x)=>a+x.valor,0),tS=it.filter(x=>x.nat==='S').reduce((a,x)=>a+x.valor,0);
  $('#dwS').innerHTML=`${it.length} lançamentos · <span class="pos">+${brl(tE)}</span> · <span class="neg">−${brl(tS)}</span>`;
  const cn=id=>{const c=CONTAS.find(c=>c.id===id);return c?c.emp+' · '+c.nome:''};
  $('#dwB').innerHTML=`<table class="list num"><thead><tr><th>Data</th><th>Contraparte</th><th>Status</th><th class="r">Valor</th></tr></thead><tbody>${it.map(x=>`<tr class="${x.prov?'row-prov':''}"><td>${dBR(x.dataEf)}${x.late?`<div class="mini">venc ${dBR(x.data)}</div>`:''}</td><td>${x.contraparte}<div class="mini">${x.grupo} · ${cn(x.conta)}${x.doc?' · '+x.doc:''}</div></td><td>${x.status==='realizado'?'<span class="badge b-real">realizado</span>':x.prov?'<span class="badge b-prov">provisionado</span>':x.late?'<span class="badge b-late">vencido</span>':'<span class="badge" style="background:var(--panel2)">a realizar</span>'}</td><td class="r ${x.nat==='E'?'pos':'neg'}">${x.nat==='E'?'+':'−'}${brl2(x.valor)}</td></tr>`).join('')}</tbody></table>`;
  $('#drawer').classList.add('open');
}
$('#dwX').onclick=()=>$('#drawer').classList.remove('open');
$('#csv').onclick=()=>{const {B}=calc();const rows=[['periodo','inicio','fim','saldo_inicial','entradas','entradas_prov','saidas','saidas_prov','saldo_final']];
  B.list.forEach(b=>rows.push([b.lbl,iso(b.a),iso(b.b),b.ini,b.E,b.Ep,b.S,b.Sp,b.fimSaldo].join(';')));
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([rows.map(r=>Array.isArray(r)?r.join(';'):r).join('\n')],{type:'text/csv'}));a.download='fluxo-caixa.csv';a.click();toast('CSV gerado')};

/* ═════════════ FLUXO v2 · cenários e linhas de simulação ═════════════
   Nada aqui grava título: cenário = alavancas + eventos hipotéticos aplicados
   sobre os lançamentos reais (finance.fluxo_cenarios no banco). */
// contas a RECEBER vencidas (Safe) — fora do base; entram só pela alavanca "recuperar vencidos"
const REC_VENC=[];for(let i=0;i<26;i++)REC_VENC.push({id:9000+i,emp:'SF',nat:'E',grupo:'Faturamento OS / vendas',data:addD(HOJE,-5-Math.floor(rnd()*80)),valor:Math.round(2500+rnd()*11000),status:'aberto',conta:4,contraparte:'Cliente em atraso',doc:'Recibo '+(300+i)});
const LEV0={atraso:0,inad:0,rec:0,recDias:30,desp:0,prov:0,post:0};
const PALETA=['#f59e0b','#10b981','#a855f7','#ec4899','#06b6d4','#84cc16'];
let EVENTOS=[
 {id:1,desc:'Sinal Diaverum SW (4 unidades)',nat:'E',valor:120000,data:'2026-11-05',rep:1,emp:'SF'},
 {id:2,desc:'Equipamento SW — pagamento ao fornecedor',nat:'S',valor:95000,data:'2026-11-20',rep:1,emp:'SF'},
 {id:3,desc:'Receita SW por m³',nat:'E',valor:38000,data:'2026-12-10',rep:4,emp:'SF'},
 {id:4,desc:'Antecipação de recebíveis',nat:'E',valor:200000,data:'2026-10-20',rep:1,emp:'SF'},
 {id:5,desc:'Liquidação da antecipação (+3%)',nat:'S',valor:206000,data:'2026-11-20',rep:1,emp:'SF'},
 {id:6,desc:'Contratação técnico nível II',nat:'S',valor:9500,data:'2026-11-05',rep:6,emp:'SF'},
];
let evSeq=7;
let CENS=[
 {id:'base',nome:'Base',cor:'var(--sf)',vis:true,fixo:true,lev:{...LEV0},ev:new Set()},
 {id:'cons',nome:'Conservador',cor:PALETA[0],vis:true,lev:{...LEV0,atraso:15,inad:5,desp:5,prov:8},ev:new Set()},
 {id:'otim',nome:'Otimista',cor:PALETA[1],vis:true,lev:{...LEV0,rec:60,recDias:45},ev:new Set()},
 {id:'sw',nome:'Plano SW + antecipação',cor:PALETA[2],vis:false,lev:{...LEV0,post:15},ev:new Set([1,2,3,4,5])},
];
Object.assign(S,{edit:'cons',colchao:100000,fg:'auto',vista:'ambos',zoom:null,zero:false,banda:true});
const LEVS=[
 {k:'atraso',l:'Atraso dos clientes',min:0,max:60,st:1,u:' dias',d:'Empurra todas as entradas em aberto.'},
 {k:'inad',l:'Inadimplência',min:0,max:25,st:1,u:'%',d:'Parte das entradas que não entra.'},
 {k:'rec',l:'Recuperar vencidos a receber',min:0,max:100,st:5,u:'%',d:'',dyn:1},
 {k:'recDias',l:'…ao longo de',min:10,max:120,st:5,u:' dias',d:'Distribui a recuperação a partir de hoje.'},
 {k:'desp',l:'Variação das despesas',min:-20,max:20,st:1,u:'%',d:'Aplica em todas as saídas em aberto.'},
 {k:'prov',l:'Provisões acima do previsto',min:-10,max:30,st:1,u:'%',d:'Só nas saídas provisionadas (consumo, PJ…).'},
 {k:'post',l:'Postergar fornecedores',min:0,max:45,st:5,u:' dias',d:'Negociar prazo em matéria-prima/fornecedores.'},
];
const cen=id=>CENS.find(c=>c.id===id);
const sgn=v=>(v>0?'+':'')+v;

function janela(){const B=buckets();return {ini:new Date(B.ini.getFullYear(),B.ini.getMonth(),B.ini.getDate()),fim:B.fim}}
function sim(c){
  const {ini,fim}=janela();const N=Math.round((fim-ini)/864e5)+1;const it=HOJE-ini;const iH=Math.round(it/864e5);
  const ix=d=>Math.round((new Date(d.getFullYear(),d.getMonth(),d.getDate())-ini)/864e5);
  const E=new Float64Array(N),Sd=new Float64Array(N),EP=new Float64Array(N),SP=new Float64Array(N);const marks=[];const its=[];
  const xs=lancFiltrados();const lv=c.lev;
  let realPos=0;
  for(const x of xs){let d=x.dataEf,v=x.valor;
    if(x.status==='realizado'){if(d>=ini)realPos+=x.nat==='E'?v:-v}
    else{ if(x.nat==='E'){d=addD(d,lv.atraso);v*=1-lv.inad/100}
          else{v*=1+lv.desp/100;if(x.prov)v*=1+lv.prov/100;if(lv.post&&x.grupo==='Fornecedores e matéria-prima'&&!x.late)d=addD(d,lv.post)} }
    const i=ix(d);if(i<0||i>=N)continue;its.push({i,nat:x.nat,v,x,mov:x.status==='aberto'&&+d!==+x.dataEf});if(x.nat==='E'){E[i]+=v;if(x.prov)EP[i]+=v}else{Sd[i]+=v;if(x.prov)SP[i]+=v}}
  if(lv.rec>0)for(const x of REC_VENC){if(!S.emps.has(x.emp)||!S.contas.has(x.conta))continue;const i=ix(addD(HOJE,1+(x.id*7)%lv.recDias));if(i>=0&&i<N){E[i]+=x.valor*lv.rec/100;its.push({i,nat:'E',v:x.valor*lv.rec/100,x,rec:1})}}
  for(const e of EVENTOS){if(!c.ev.has(e.id)||!S.emps.has(e.emp))continue;const d0=new Date(e.data+'T12:00');
    for(let k=0;k<e.rep;k++){const i=ix(addM(d0,k));if(i<0||i>=N)continue;if(e.nat==='E')E[i]+=e.valor;else Sd[i]+=e.valor;marks.push({i,e});its.push({i,nat:e.nat,v:e.valor,e})}}
  const sal=new Float64Array(N);let s=saldoHoje()-realPos;let gross=0;const band=new Float64Array(N);
  for(let i=0;i<N;i++){s+=E[i]-Sd[i];sal[i]=s;if(i>=iH){gross+=E[i]+Sd[i];band[i]=gross*0.045}}
  let min=Infinity,minI=iH,abaixo=0;for(let i=iH;i<N;i++){if(sal[i]<min){min=sal[i];minI=i}if(sal[i]<S.colchao)abaixo++}
  const fE=E.slice(iH).reduce((a,b)=>a+b,0),fS=Sd.slice(iH).reduce((a,b)=>a+b,0);
  return {c,ini,N,iH,E,S:Sd,EP,SP,sal,band,min,minI,final:sal[N-1],abaixo,need:Math.max(0,S.colchao-min),fE,fS,marks,its};
}

let RES=[];
function renderAll(){renderChips();renderContas();renderSim();renderEditor();renderTable(calc())}
function renderSim(){
  RES=CENS.map(sim);const base=RES[0];const ed=RES.find(r=>r.c.id===S.edit)||base;
  // KPIs
  const card=(l,v,s,c='')=>`<div class="card kpi"><div class="l">${l}</div><div class="v num ${c}">${v}</div><div class="s">${s}</div></div>`;
  const dia=r=>addD(r.ini,r.minI).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
  const sh=saldoHoje();
  $('#kpis2').innerHTML=card('Saldo hoje · '+[...S.emps][0]+' unificado',brl(sh),S.contas.size+' bancos somados',sh<0?'neg':'')+
    card('Base · saldo no fim',brl(base.final),'em '+addD(base.ini,base.N-1).toLocaleDateString('pt-BR'),base.final<0?'neg':'')+
    card('Base · menor saldo',brl(base.min),dia(base),base.min<S.colchao?'neg':'')+
    card('A realizar · base',`<span class="pos">+${k(base.fE)}</span> <span class="neg">−${k(base.fS)}</span>`,'provisionado: '+k(base.EP.slice(base.iH).reduce((a,b)=>a+b,0)+base.SP.slice(base.iH).reduce((a,b)=>a+b,0)))+
    `<div class="card kpi"><div class="l">Colchão mínimo de caixa</div><input class="num" id="colIn" value="${S.colchao.toLocaleString('pt-BR')}"><div class="s">linha tracejada âmbar no gráfico</div></div>`;
  $('#colIn').onchange=e=>{S.colchao=Number(e.target.value.replace(/\D/g,''))||0;renderSim()};
  // cabeçalho do herói
  $('#heroCen').textContent=ed.c.nome;$('#heroV').textContent=brl(ed.final);$('#heroV').className='hero-v num'+(ed.final<0?' neg':'');
  const dv=ed.final-base.final;
  $('#heroS').innerHTML=(ed===base?'':`<b class="${dv<0?'neg':'pos'}">${dv>0?'+':''}${brl(dv)}</b> vs base · `)+`menor saldo ${brl(ed.min)} em ${dia(ed)}`+(ed.need?` · <b class="neg">faltam ${brl(ed.need)} para o colchão</b>`:'');
  $('#cenLegend').innerHTML=CENS.map(c=>`<button class="${c.vis?'on':''}" data-v="${c.id}"><i style="background:${c.cor}"></i>${c.nome}</button>`).join('');
  $$('#cenLegend button').forEach(b=>b.onclick=()=>{const c=cen(b.dataset.v);c.vis=!c.vis;renderSim()});
  drawHero();drawFlows(ed,base);renderCmp();renderDia();
}
function faixa(N,iH){if(S.zoom){const a=Math.max(0,Math.min(S.zoom[0],N-2)),z=Math.min(N-1,Math.max(S.zoom[1],a+1));return [a,z]}
  if(S.vista==='passado')return [0,Math.max(1,iH)];if(S.vista==='futuro')return [Math.min(iH,N-2),N-1];return [0,N-1]}
function drawHero(semBrush){
  const wrap=$('#heroWrap');const W=Math.max(320,wrap.clientWidth),H=Math.round(Math.min(440,Math.max(300,W*.42)));
  const vis=RES.filter(r=>r.c.vis);const b=RES[0];const N=b.N,iH=b.iH;const ed=RES.find(r=>r.c.id===S.edit)||b;
  const [a,z]=faixa(N,iH);
  const pl=8,pr=66,pt=16,pb=26,barH=Math.round(H*.2),gap=14;const yTop=pt,yBot=H-pb-barH-gap;
  // escala ajustada à faixa visível
  let lo=Infinity,hi=-Infinity;const acc=v=>{if(v<lo)lo=v;if(v>hi)hi=v};
  for(let i=a;i<=z;i++){if(i<=iH)acc(b.sal[i]);if(i>=iH)vis.forEach(r=>{acc(r.sal[i]);if(r===b&&S.banda){acc(b.sal[i]+b.band[i]);acc(b.sal[i]-b.band[i])}})}
  if(S.zero){lo=Math.min(lo,0,S.colchao);hi=Math.max(hi,0,S.colchao)}
  else{const span=hi-lo||1;if(S.colchao>lo-span*.25&&S.colchao<hi+span*.25){lo=Math.min(lo,S.colchao);hi=Math.max(hi,S.colchao)}}
  const pad=(hi-lo)*.08||1000;lo-=pad;hi+=pad;
  const X=i=>pl+(W-pl-pr)*(i-a)/(z-a),Y=v=>yTop+(yBot-yTop)*(1-(v-lo)/(hi-lo));
  const line=(arr,f,t)=>{f=Math.max(f,a);t=Math.min(t,z);if(t<f)return '';let p='';for(let i=f;i<=t;i++)p+=(i===f?'M':'L')+X(i).toFixed(1)+' '+Y(arr[i]).toFixed(1);return p};
  let g=`<svg width="${W}" height="${H}" id="heroSvg"><defs>
    <linearGradient id="ga" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--sf)" stop-opacity=".22"/><stop offset="1" stop-color="var(--sf)" stop-opacity="0"/></linearGradient>
    <linearGradient id="gp" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--tx2)" stop-opacity=".14"/><stop offset="1" stop-color="var(--tx2)" stop-opacity="0"/></linearGradient>
    <clipPath id="clipP"><rect x="${pl}" y="${yTop}" width="${W-pl-pr}" height="${yBot-yTop}"/></clipPath></defs>`;
  for(let t=0;t<=5;t++){const v=lo+(hi-lo)*t/5;g+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)" stroke-dasharray="${t?'2 4':''}"/><text x="${W-pr+8}" y="${Y(v)+3}">${k(v)}</text>`}
  // eixo x: meses em janela longa, dias em janela curta
  const dias=z-a;const passo=dias<=21?1:dias<=60?7:0;
  for(let i=a;i<=z;i++){const d=addD(b.ini,i);const marca=passo?((passo===1)||(d.getDay()===1)):d.getDate()===1;
    if(marca){g+=`<line x1="${X(i)}" x2="${X(i)}" y1="${yTop}" y2="${H-pb}" stroke="var(--line)" opacity=".55"/><text x="${X(i)+3}" y="${H-pb+16}">${passo?dBR(d):MES[d.getMonth()]+(d.getMonth()===0?'/'+String(d.getFullYear()).slice(2):'')}</text>`}}
  g+=`<g clip-path="url(#clipP)">`;
  if(lo<0)g+=`<rect x="${pl}" y="${Y(0)}" width="${W-pl-pr}" height="${Math.max(0,yBot-Y(0))}" fill="var(--out)" opacity=".06"/><line x1="${pl}" x2="${W-pr}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--out)" opacity=".5"/>`;
  if(a<iH){g+=`<rect x="${pl}" y="${yTop}" width="${X(Math.min(iH,z))-pl}" height="${yBot-yTop}" fill="var(--panel2)" opacity=".35"/>`;
    g+=`<path d="${line(b.sal,0,iH)} L${X(Math.min(iH,z))} ${yBot} L${X(a)} ${yBot}Z" fill="url(#gp)"/><path d="${line(b.sal,0,iH)}" fill="none" stroke="var(--tx2)" stroke-width="2"/>`}
  if(b.c.vis&&z>=iH){const f=Math.max(iH,a);
    if(S.banda){let up='',dn='';for(let i=f;i<=z;i++)up+=(i===f?'M':'L')+X(i).toFixed(1)+' '+Y(b.sal[i]+b.band[i]).toFixed(1);for(let i=z;i>=f;i--)dn+='L'+X(i).toFixed(1)+' '+Y(b.sal[i]-b.band[i]).toFixed(1);g+=`<path d="${up}${dn}Z" fill="var(--sf)" opacity=".08"/>`}
    g+=`<path d="${line(b.sal,iH,N-1)} L${X(z)} ${yBot} L${X(f)} ${yBot}Z" fill="url(#ga)"/>`}
  if(S.colchao>=lo&&S.colchao<=hi)g+=`<line x1="${pl}" x2="${W-pr}" y1="${Y(S.colchao)}" y2="${Y(S.colchao)}" stroke="var(--amber)" stroke-dasharray="6 5" stroke-width="1.4"/><text x="${pl+4}" y="${Y(S.colchao)-5}" style="fill:var(--amber);font-weight:700">colchão ${k(S.colchao)}</text>`;
  if(z>=iH)vis.slice().reverse().forEach(r=>{const base=r.c.id==='base';
    g+=`<path d="${line(r.sal,iH,N-1)}" fill="none" stroke="${r.c.cor}" stroke-width="${base?2.6:2}" stroke-linejoin="round"/>`;
    if(r.minI>=a&&r.minI<=z)g+=`<circle cx="${X(r.minI)}" cy="${Y(r.min)}" r="4" fill="var(--panel)" stroke="${r.c.cor}" stroke-width="2"/>`;
    if(z===N-1)g+=`<circle cx="${X(N-1)}" cy="${Y(r.final)}" r="3" fill="${r.c.cor}"/>`;
    r.marks.forEach(m=>{if(m.i<a||m.i>z)return;const x=X(m.i),y=Y(r.sal[m.i]);g+=`<path d="M${x} ${y-6} L${x+5} ${y} L${x} ${y+6} L${x-5} ${y}Z" fill="${m.e.nat==='E'?'var(--in)':'var(--out)'}" stroke="var(--panel)" stroke-width="1.2"><title>${m.e.desc} · ${m.e.nat==='E'?'+':'−'}${brl(m.e.valor)}</title></path>`})});
  g+=`</g>`;
  if(colchaoFora(lo,hi))g+=`<text x="${pl+4}" y="${S.colchao<lo?yBot-4:yTop+12}" style="fill:var(--amber);font-weight:700">colchão ${k(S.colchao)} ${S.colchao<lo?'↓':'↑'} fora da escala</text>`;
  // variação diária (barras do resultado do dia)
  const vb0=yBot+gap,vb1=H-pb,vm=(vb0+vb1)/2;const fonte=ed;let mx=1;for(let i=a;i<=z;i++)mx=Math.max(mx,Math.abs(fonte.E[i]-fonte.S[i]));
  g+=`<text x="${pl}" y="${vb0-3}" style="font-weight:700">variação diária${fonte!==b?' · '+fonte.c.nome:''}</text><line x1="${pl}" x2="${W-pr}" y1="${vm}" y2="${vm}" stroke="var(--line2)"/><text x="${W-pr+8}" y="${vb0+8}">+${k(mx)}</text><text x="${W-pr+8}" y="${vb1}">−${k(mx)}</text>`;
  const bwD=Math.max(1,(W-pl-pr)/(z-a+1)*.7);
  for(let i=a;i<=z;i++){const v=fonte.E[i]-fonte.S[i];if(!v)continue;const h=Math.abs(v)/mx*(vb1-vb0)/2;g+=`<rect x="${X(i)-bwD/2}" y="${v>0?vm-h:vm}" width="${bwD}" height="${Math.max(1,h)}" fill="${v>0?'var(--in)':'var(--out)'}" opacity="${i<iH?.45:.9}" rx="${bwD>4?1.5:0}"/>`}
  if(iH>=a&&iH<=z)g+=`<line x1="${X(iH)}" x2="${X(iH)}" y1="${yTop}" y2="${H-pb}" stroke="var(--tx)" opacity=".5"/><text x="${X(iH)+5}" y="${yTop+10}" style="fill:var(--tx);font-weight:700">hoje</text>`;
  g+=`<line id="cross" x1="0" x2="0" y1="${yTop}" y2="${H-pb}" stroke="var(--tx3)" stroke-dasharray="3 3" style="display:none"/><g id="crossDots"></g>`;
  g+=`<rect x="${pl}" y="${yTop}" width="${W-pl-pr}" height="${H-pb-yTop}" fill="transparent" id="hit" style="cursor:crosshair"/></svg>`;
  $('#hero').innerHTML=g;
  const hit=$('#hit'),tip=$('#tip'),cross=$('#cross');
  const idxAt=ev=>{const rc=$('#heroSvg').getBoundingClientRect();return Math.max(a,Math.min(z,a+Math.round((ev.clientX-rc.left-pl)/(W-pl-pr)*(z-a))))};
  hit.onmousemove=ev=>{const i=idxAt(ev);const d=addD(b.ini,i);cross.setAttribute('x1',X(i));cross.setAttribute('x2',X(i));cross.style.display='';
    $('#crossDots').innerHTML=(i<iH?[b]:vis).map(r=>`<circle cx="${X(i)}" cy="${Y(r.sal[i])}" r="4" fill="${i<iH?'var(--tx2)':r.c.cor}" stroke="var(--panel)" stroke-width="2"/>`).join('');
    const ant=i>0?b.sal[i-1]:b.sal[i];
    const rows=(i<iH?[b]:vis).map(r=>{const dv=r.sal[i]-b.sal[i];return `<div class="r"><span><i style="background:${i<iH?'var(--tx2)':r.c.cor}"></i>${i<iH?'Realizado':r.c.nome}</span><b class="num ${r.sal[i]<0?'neg':''}">${brl(r.sal[i])}${r.c.id!=='base'&&i>=iH&&Math.abs(dv)>1?` <span class="mini ${dv<0?'neg':'pos'}">${dv>0?'+':''}${k(dv)}</span>`:''}</b></div>`}).join('');
    const net=fonte.E[i]-fonte.S[i];
    tip.innerHTML=`<div class="mini" style="margin-bottom:4px;font-weight:700">${d.toLocaleDateString('pt-BR',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}${i<iH?' · realizado':''}</div>${rows}<div class="r mini" style="border-top:1px solid var(--line);margin-top:4px;padding-top:4px"><span>Entradas · saídas do dia</span><span><span class="pos">+${brl(fonte.E[i])}</span> · <span class="neg">−${brl(fonte.S[i])}</span></span></div><div class="r"><span class="mini">Variação do dia</span><b class="num ${net<0?'neg':'pos'}">${net>0?'+':''}${brl(net)}</b></div>`;
    tip.style.display='block';const tw=tip.offsetWidth;let lx=X(i)+14;if(lx+tw>W)lx=X(i)-tw-14;tip.style.left=lx+'px';tip.style.top='10px'};
  hit.onmouseleave=()=>{tip.style.display='none';cross.style.display='none';$('#crossDots').innerHTML=''};
  hit.onclick=ev=>{const i=idxAt(ev);const dd=addD(b.ini,i);
    const items=lancFiltrados().filter(x=>{const q=x.dataEf;return q.getFullYear()===dd.getFullYear()&&q.getMonth()===dd.getMonth()&&q.getDate()===dd.getDate()});
    abrirBucket({items,past:dd<HOJE,lbl:dBR(dd),b:dd})};
  // roda do mouse = zoom no ponto
  hit.onwheel=ev=>{ev.preventDefault();const i=idxAt(ev);const f=ev.deltaY>0?1.25:.8;let na=Math.round(i-(i-a)*f),nz=Math.round(i+(z-i)*f);na=Math.max(0,na);nz=Math.min(N-1,nz);if(nz-na<7)return;S.zoom=[na,nz];renderVista()};
  if(!semBrush)drawBrush(a,z);
  const zl=$('#zoomLbl');zl.innerHTML=`${addD(b.ini,a).toLocaleDateString('pt-BR')} → ${addD(b.ini,z).toLocaleDateString('pt-BR')} · ${z-a+1} dias`+(S.zoom?` · <a href="#" id="zoomReset" style="color:var(--sf)">desfazer zoom</a>`:'');
  const zr=$('#zoomReset');if(zr)zr.onclick=e=>{e.preventDefault();S.zoom=null;renderVista()};
}
function colchaoFora(lo,hi){return S.colchao<lo||S.colchao>hi}
function renderVista(){drawHero();const ed=RES.find(r=>r.c.id===S.edit)||RES[0];drawFlows(ed,RES[0]);renderDia();
  $$('#segVista button').forEach(x=>x.classList.toggle('on',!S.zoom&&x.dataset.v===S.vista))}
// navegador (brush): arraste para escolher o trecho; puxe as bordas para ajustar
function drawBrush(a,z){
  const b=RES[0];const W=Math.max(320,$('#heroWrap').clientWidth),H=54,pl=8,pr=66;const N=b.N;
  let lo=Infinity,hi=-Infinity;for(const v of b.sal){if(v<lo)lo=v;if(v>hi)hi=v}
  const X=i=>pl+(W-pl-pr)*i/(N-1),Y=v=>6+(H-12)*(1-(v-lo)/((hi-lo)||1));
  let p='';for(let i=0;i<N;i++)p+=(i?'L':'M')+X(i).toFixed(1)+' '+Y(b.sal[i]).toFixed(1);
  const x0=X(a),x1=X(z);
  $('#brush').innerHTML=`<svg width="${W}" height="${H}" id="brushSvg" style="cursor:crosshair">
    <rect x="${pl}" y="0" width="${W-pl-pr}" height="${H}" rx="8" fill="var(--panel2)"/>
    <path d="${p}" fill="none" stroke="var(--tx3)" stroke-width="1.2"/>
    <line x1="${X(b.iH)}" x2="${X(b.iH)}" y1="0" y2="${H}" stroke="var(--tx2)" stroke-dasharray="2 2"/>
    <rect x="${pl}" y="0" width="${Math.max(0,x0-pl)}" height="${H}" fill="var(--bg)" opacity=".55"/>
    <rect x="${x1}" y="0" width="${Math.max(0,W-pr-x1)}" height="${H}" fill="var(--bg)" opacity=".55"/>
    <rect id="bSel" x="${x0}" y="1" width="${Math.max(2,x1-x0)}" height="${H-2}" rx="6" fill="var(--sf)" fill-opacity=".08" stroke="var(--sf)" stroke-width="1.5" style="cursor:grab"/>
    <rect id="bL" x="${x0-4}" y="${H/2-12}" width="8" height="24" rx="3" fill="var(--sf)" style="cursor:ew-resize"/>
    <rect id="bR" x="${x1-4}" y="${H/2-12}" width="8" height="24" rx="3" fill="var(--sf)" style="cursor:ew-resize"/>
  </svg>`;
  const svg=$('#brushSvg');const toI=cx=>{const rc=svg.getBoundingClientRect();return Math.max(0,Math.min(N-1,Math.round((cx-rc.left-pl)/(W-pl-pr)*(N-1))))};
  let mode=null,start=0,za=a,zz=z;
  const sel=(na,nz)=>{const x0=X(na),x1=X(nz);$('#bSel').setAttribute('x',x0);$('#bSel').setAttribute('width',Math.max(2,x1-x0));$('#bL').setAttribute('x',x0-4);$('#bR').setAttribute('x',x1-4)};
  const down=(m)=>ev=>{ev.preventDefault();ev.stopPropagation();mode=m;start=toI(ev.clientX);za=a;zz=z;if(m==='new'){za=zz=start}
    const mv=e=>{const i=toI(e.clientX);let na=za,nz=zz;
      if(mode==='move'){const d=i-start;na=za+d;nz=zz+d;if(na<0){nz-=na;na=0}if(nz>N-1){na-=nz-(N-1);nz=N-1}}
      else if(mode==='L')na=Math.min(i,zz-3);else if(mode==='R')nz=Math.max(i,za+3);else{na=Math.min(start,i);nz=Math.max(start,i)}
      if(nz-na>=3){S.zoom=[na,nz];sel(na,nz);drawHero(true);const ed=RES.find(r=>r.c.id===S.edit)||RES[0];drawFlows(ed,RES[0])}};
    const up=()=>{document.removeEventListener('mousemove',mv);document.removeEventListener('mouseup',up);mode=null;renderVista()};
    document.addEventListener('mousemove',mv);document.addEventListener('mouseup',up)};
  $('#bSel').onmousedown=(z-a)>=(N-1)*.95?down('new'):down('move');$('#bL').onmousedown=down('L');$('#bR').onmousedown=down('R');svg.onmousedown=down('new');
  svg.ondblclick=()=>{S.zoom=null;renderVista()};
}
function drawFlows(r,b){
  const wrap=$('#heroWrap');const W=Math.max(320,wrap.clientWidth);
  const [fa,fz]=faixa(r.N,r.iH);const nD=fz-fa+1;const gran=S.fg==='auto'?(nD<=35?'dia':nD/7>20?'mes':'semana'):S.fg;
  $$('#segFlow button').forEach(x=>x.classList.toggle('on',x.dataset.f===S.fg));
  // períodos
  const per=[];
  if(gran==='dia'){for(let i=fa;i<=fz;i++)per.push([i,i])}
  else if(gran==='semana'){for(let i=fa;i<=fz;i+=7)per.push([i,Math.min(fz,i+6)])}
  else{let i=fa;while(i<=fz){const d=addD(r.ini,i);const fimM=new Date(d.getFullYear(),d.getMonth()+1,0);const j=Math.min(fz,i+Math.round((fimM-d)/864e5));per.push([i,j]);i=j+1}}
  const P=per.map(([a,z])=>{let e=0,s=0,eb=0,sb=0,ep=0,sp=0;for(let j=a;j<=z;j++){e+=r.E[j];s+=r.S[j];eb+=b.E[j];sb+=b.S[j];ep+=r.EP[j];sp+=r.SP[j]}
    const d=addD(r.ini,a);return {a,z,e,s,eb,sb,ep,sp,past:z<r.iH,cur:a<=r.iH&&z>=r.iH,
      lbl:gran==='mes'?MES[d.getMonth()]+(d.getMonth()===0?'/'+String(d.getFullYear()).slice(2):''):dBR(d)}});
  // totais (de hoje até o fim)
  const tE=P.reduce((q,p)=>q+p.e,0),tS=P.reduce((q,p)=>q+p.s,0);
  $('#flowsTot').innerHTML=`<span><span class="mini">Entradas no trecho</span><b class="pos num">${brl(tE)}</b></span><span><span class="mini">Saídas no trecho</span><b class="neg num">${brl(tS)}</b></span><span><span class="mini">Resultado</span><b class="num ${tE-tS<0?'neg':'pos'}">${tE-tS>0?'+':''}${brl(tE-tS)}</b></span>`;
  $('#flowsLbl').textContent=(r===b?'cenário base':r.c.nome+' · contorno tracejado = base')+' · '+({dia:'por dia',semana:'por semana',mes:'por mês'}[gran])+' · mesmo trecho do gráfico acima';
  const P0=P.filter(p=>p.e||p.s||p.eb||p.sb);P.length=0;P.push(...P0);const Wf=Math.max(W,P.length*(gran==='dia'?46:52)+70);
  const H=Math.round(Math.min(340,Math.max(240,W*.26))),pl=8,pr=62,pt=24,pb=44;
  const mx=Math.max(1,...P.map(p=>Math.max(p.e,p.s,r===b?0:Math.max(p.eb,p.sb))));
  const bw=(Wf-pl-pr)/P.length;const mid=pt+(H-pt-pb)/2;const half=(H-pt-pb)/2-14;const y=v=>v/mx*half;
  const showLbl=true, fs=bw>=60?11.5:10.5;
  let g=`<svg width="${Wf}" height="${H}" id="flowSvg"><defs>
    <pattern id="fhi" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--in)"/></pattern>
    <pattern id="fho" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2" height="5" fill="var(--out)"/></pattern></defs>`;
  [1,.5].forEach(f=>{g+=`<line x1="${pl}" x2="${Wf-pr}" y1="${mid-y(mx*f)}" y2="${mid-y(mx*f)}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${Wf-pr+8}" y="${mid-y(mx*f)+3}">+${k(mx*f)}</text><line x1="${pl}" x2="${Wf-pr}" y1="${mid+y(mx*f)}" y2="${mid+y(mx*f)}" stroke="var(--line)" stroke-dasharray="2 4"/><text x="${Wf-pr+8}" y="${mid+y(mx*f)+3}">−${k(mx*f)}</text>`});
  P.forEach((p,n)=>{const x0=pl+n*bw;const x=x0+bw*.16,ww=bw*.68,cx=x0+bw/2;const op=p.past?.5:1;
    if(p.past)g+=`<rect x="${x0}" y="${pt-18}" width="${bw}" height="${H-pt-pb+30}" fill="var(--panel2)" opacity=".35"/>`;
    if(p.cur)g+=`<rect x="${x0}" y="${pt-18}" width="${bw}" height="${H-pt-pb+30}" fill="var(--sf)" opacity=".06"/>`;
    const eR=p.e-p.ep,sR=p.s-p.sp;
    g+=`<rect x="${x}" y="${mid-y(eR)}" width="${ww}" height="${y(eR)}" rx="3" fill="var(--in)" opacity="${op}"/>`;
    if(p.ep>0)g+=`<rect x="${x}" y="${mid-y(p.e)}" width="${ww}" height="${y(p.ep)}" fill="url(#fhi)" stroke="var(--in)" stroke-width=".8" opacity="${op}"/>`;
    g+=`<rect x="${x}" y="${mid}" width="${ww}" height="${y(sR)}" rx="3" fill="var(--out)" opacity="${op}"/>`;
    if(p.sp>0)g+=`<rect x="${x}" y="${mid+y(sR)}" width="${ww}" height="${y(p.sp)}" fill="url(#fho)" stroke="var(--out)" stroke-width=".8" opacity="${op}"/>`;
    if(r!==b&&!p.past)g+=`<rect x="${x}" y="${mid-y(p.eb)}" width="${ww}" height="${y(p.eb)}" fill="none" stroke="var(--tx2)" stroke-dasharray="3 2"/><rect x="${x}" y="${mid}" width="${ww}" height="${y(p.sb)}" fill="none" stroke="var(--tx2)" stroke-dasharray="3 2"/>`;
    if(showLbl){
      if(p.e)g+=`<text x="${cx}" y="${mid-y(p.e)-5}" text-anchor="middle" style="fill:var(--in);font-weight:700;font-size:${fs}px">${k(p.e)}</text>`;
      if(p.s)g+=`<text x="${cx}" y="${mid+y(p.s)+13}" text-anchor="middle" style="fill:var(--out);font-weight:700;font-size:${fs}px">${k(p.s)}</text>`;}
    const net=p.e-p.s;
    g+=`<text x="${cx}" y="${H-pb+18}" text-anchor="middle" style="font-size:${fs}px;${p.cur?'fill:var(--tx);font-weight:700':''}">${p.lbl}</text>`;
    if(showLbl||n%2===0)g+=`<text x="${cx}" y="${H-pb+33}" text-anchor="middle" style="font-size:${fs}px;font-weight:700;fill:${net<0?'var(--out)':'var(--in)'}">${net>0?'+':''}${k(net)}</text>`;
    g+=`<rect x="${x0}" y="${pt-18}" width="${bw}" height="${H-pt+10}" fill="transparent" data-p="${n}" style="cursor:pointer"><title>${p.lbl}${p.past?' (realizado)':''}
Entradas ${brl(p.e)}${p.ep?' · provisionado '+brl(p.ep):''}
Saídas ${brl(p.s)}${p.sp?' · provisionado '+brl(p.sp):''}
Resultado ${brl(net)}${r!==b&&!p.past?'\nBase: +'+brl(p.eb)+' / −'+brl(p.sb):''}</title></rect>`});
  g+=`<line x1="${pl}" x2="${Wf-pr}" y1="${mid}" y2="${mid}" stroke="var(--line2)"/><text x="${Wf-pr+8}" y="${H-pb+33}" style="font-weight:700">resultado</text></svg>`;
  const fl=$('#flows');fl.innerHTML=g;const ic=P.findIndex(p=>p.cur);if(Wf>W&&ic>=0)fl.scrollLeft=Math.max(0,pl+ic*bw-W*.35);
  $$('#flowSvg rect[data-p]').forEach(el=>el.onclick=()=>{const p=P[+el.dataset.p];const a=addD(r.ini,p.a),z=addD(r.ini,p.z);
    const items=lancFiltrados().filter(x=>x.dataEf>=a&&x.dataEf<addD(z,1));abrirBucket({items,past:p.past,lbl:dBR(a),b:z})});
}
function renderCmp(){
  const b=RES[0];const dia=r=>addD(r.ini,r.minI).toLocaleDateString('pt-BR',{day:'2-digit',month:'short'});
  const rows=[
    ['Saldo no fim da janela',r=>`<b class="${r.final<0?'neg':''}">${brl(r.final)}</b>`],
    ['Δ vs base',r=>r.c.id==='base'?'<span class="muted">—</span>':`<span class="${r.final-b.final<0?'neg':'pos'}">${r.final-b.final>0?'+':''}${brl(r.final-b.final)}</span>`],
    ['Menor saldo',r=>`<span class="${r.min<S.colchao?'neg':''}">${brl(r.min)}</span><div class="mini">${dia(r)}</div>`],
    ['Dias abaixo do colchão',r=>r.abaixo?`<b class="neg">${r.abaixo}</b>`:'<span class="pos">0</span>'],
    ['Necessidade de caixa',r=>r.need?`<b class="neg">${brl(r.need)}</b>`:'<span class="pos">—</span>'],
    ['Entradas a realizar',r=>brl(r.fE)],['Saídas a realizar',r=>brl(r.fS)],
  ];
  $('#cmp').innerHTML=`<thead><tr><th></th>${RES.map(r=>`<th class="r" style="${r.c.vis?'':'opacity:.5'}"><span class="cmp-sw" style="background:${r.c.cor}"></span>${r.c.nome}</th>`).join('')}</tr></thead><tbody>${rows.map(([l,f])=>`<tr><td>${l}</td>${RES.map(r=>`<td class="r" style="${r.c.vis?'':'opacity:.5'}">${f(r)}</td>`).join('')}</tr>`).join('')}</tbody>`;
}
function renderEditor(){
  $('#cenTabs').innerHTML=CENS.map(c=>`<button class="${c.id===S.edit?'on':''}" data-e="${c.id}"><span class="cmp-sw" style="background:${c.cor};margin:0"></span>${c.nome}</button>`).join('');
  $$('#cenTabs button').forEach(b=>b.onclick=()=>{S.edit=b.dataset.e;renderEditor();renderSim()});
  const c=cen(S.edit);const venc=REC_VENC.filter(x=>S.emps.has(x.emp)).reduce((a,x)=>a+x.valor,0);
  let h='';
  if(c.fixo){h+=`<div class="alert ok" style="margin-top:0">O <b>Base</b> é o fluxo como está nos títulos (com as chaves acima). Para simular, <b>duplique</b> ou escolha outro cenário.</div>`}
  else{
    h+=`<div class="row2" style="grid-template-columns:1fr 70px;gap:8px"><input class="nm" id="cNome" value="${c.nome}" style="background:var(--panel2);border:1px solid var(--line2);border-radius:8px;padding:7px 9px"><input type="color" id="cCor" value="${c.cor.startsWith('#')?c.cor:'#f59e0b'}" style="width:100%;height:34px;border:1px solid var(--line2);border-radius:8px;background:none"></div>`;
    h+=`<div class="sec">Alavancas<button class="btn sm ghost" id="zerar">zerar</button></div>`;
    h+=LEVS.map(L=>`<div class="lev" style="--cc:${c.cor}"><div class="h"><span>${L.l}</span><b id="lv_${L.k}">${L.k==='recDias'?'':sgn(c.lev[L.k])}${L.k==='recDias'?c.lev[L.k]:''}${L.u}</b></div><input type="range" min="${L.min}" max="${L.max}" step="${L.st}" value="${c.lev[L.k]}" data-l="${L.k}" style="--p:${(c.lev[L.k]-L.min)/(L.max-L.min)*100}%"><div class="d">${L.dyn?'Vencidos a receber hoje: '+brl(venc)+' (fora do base).':L.d}</div></div>`).join('');
  }
  h+=`<div class="sec">Linhas de simulação (eventos)<button class="btn sm ghost" id="addEv">+ evento</button></div>
   <div class="evform" id="evForm">
     <input id="eDesc" placeholder="Descrição — ex.: novo contrato hospital X">
     <div class="row2"><select id="eNat"><option value="E">Entrada</option><option value="S">Saída</option></select><input id="eVal" placeholder="Valor R$" inputmode="decimal"></div>
     <div class="row2"><input id="eData" type="date" value="2026-11-10"><select id="eRep"><option value="1">uma vez</option><option value="3">mensal ×3</option><option value="6">mensal ×6</option><option value="12">mensal ×12</option></select></div>
     <select id="eEmp">${[...S.emps].map(e=>`<option>${e}</option>`).join('')}</select>
     <div style="display:flex;justify-content:flex-end;gap:6px;margin-top:8px"><button class="btn sm" id="eCancel">cancelar</button><button class="btn sm pri" id="eOk">adicionar ${c.fixo?'(em novo cenário)':'a '+c.nome}</button></div>
   </div>`;
  h+=EVENTOS.map(e=>`<div class="ev"><input type="checkbox" data-ev="${e.id}" ${c.ev.has(e.id)?'checked':''} ${c.fixo?'disabled':''}><div><div class="t">${e.desc}</div><div class="mini">${e.emp} · ${new Date(e.data+'T12:00').toLocaleDateString('pt-BR')}${e.rep>1?' · mensal ×'+e.rep:''} · <a href="#" data-lan="${e.id}" style="color:var(--sf)" title="Cria a conta no + Nova conta, marcada como valor estimado">lançar</a></div></div><div style="text-align:right"><b class="${e.nat==='E'?'pos':'neg'} num">${e.nat==='E'?'+':'−'}${k(e.valor)}</b><br><button class="x" data-del="${e.id}" title="remover">×</button></div></div>`).join('');
  if(!c.fixo)h+=`<div style="display:flex;gap:8px;margin-top:14px"><button class="btn sm" id="delCen" style="color:var(--out)">Excluir</button><span style="flex:1"></span><span class="tog" id="shareTog"><i></i>compartilhar</span><button class="btn sm pri" id="saveCen">Salvar cenário</button></div>`;
  $('#cenEdit').innerHTML=h;
  $$('#cenEdit input[type=range]').forEach(r=>r.oninput=()=>{const L=r.dataset.l;const D0=LEVS.find(x=>x.k===L);r.style.setProperty('--p',(r.value-D0.min)/(D0.max-D0.min)*100+'%');c.lev[L]=+r.value;const D=LEVS.find(x=>x.k===L);$('#lv_'+L).textContent=(L==='recDias'?r.value:sgn(+r.value))+D.u;c.vis=true;renderSim()});
  $$('#cenEdit [data-ev]').forEach(cb=>cb.onchange=()=>{const id=+cb.dataset.ev;cb.checked?c.ev.add(id):c.ev.delete(id);c.vis=true;renderSim()});
  $$('#cenEdit [data-del]').forEach(b=>b.onclick=()=>{const id=+b.dataset.del;EVENTOS=EVENTOS.filter(e=>e.id!==id);CENS.forEach(c=>c.ev.delete(id));renderEditor();renderSim()});
  $$('#cenEdit [data-lan]').forEach(a=>a.onclick=ev=>{ev.preventDefault();toast('Abre "+ Nova conta" já preenchida, marcada como valor estimado')});
  const nm=$('#cNome');if(nm)nm.oninput=()=>{c.nome=nm.value||'Cenário';renderSim();$$('#cenTabs button.on')[0].lastChild.textContent=c.nome};
  const cc=$('#cCor');if(cc)cc.oninput=()=>{c.cor=cc.value;renderSim();renderEditorTabsOnly()};
  const z=$('#zerar');if(z)z.onclick=()=>{c.lev={...LEV0};renderEditor();renderSim()};
  $('#addEv').onclick=()=>$('#evForm').classList.toggle('open');
  $('#eCancel').onclick=()=>$('#evForm').classList.remove('open');
  $('#eOk').onclick=()=>{const v=parseV($('#eVal').value);const desc=$('#eDesc').value.trim();if(!desc||!v){toast('Descrição e valor');return}
    const e={id:evSeq++,desc,nat:$('#eNat').value,valor:v,data:$('#eData').value||'2026-11-10',rep:+$('#eRep').value,emp:$('#eEmp').value};EVENTOS.push(e);
    let alvo=c;if(c.fixo){alvo=novoCen('Cenário '+(CENS.length));}
    alvo.ev.add(e.id);alvo.vis=true;S.edit=alvo.id;renderEditor();renderSim();toast('Evento adicionado a '+alvo.nome)};
  const dl=$('#delCen');if(dl)dl.onclick=()=>{CENS=CENS.filter(x=>x!==c);S.edit='base';renderEditor();renderSim()};
  const sv=$('#saveCen');if(sv)sv.onclick=()=>toast('Cenário salvo (finance.fluxo_cenarios)');
  const sh=$('#shareTog');if(sh)sh.onclick=()=>{sh.classList.toggle('on');toast(sh.classList.contains('on')?'Visível para o financeiro':'Só para você')};
}
function renderEditorTabsOnly(){$$('#cenTabs button').forEach(b=>{const c=cen(b.dataset.e);b.querySelector('.cmp-sw').style.background=c.cor})}
function novoCen(nome,base){const usados=CENS.map(c=>c.cor);const cor=PALETA.find(p=>!usados.includes(p))||PALETA[CENS.length%PALETA.length];
  const c={id:'c'+Date.now()+Math.floor(rnd()*99),nome,cor,vis:true,lev:base?{...base.lev}:{...LEV0},ev:new Set(base?base.ev:[])};CENS.push(c);return c}
$('#novoCen').onclick=()=>{const c=novoCen('Cenário '+CENS.length);S.edit=c.id;renderEditor();renderSim()};
$('#dupCen').onclick=()=>{const o=cen(S.edit);const c=novoCen(o.nome+' (cópia)',o);S.edit=c.id;renderEditor();renderSim()};
$$('#segFlow button').forEach(b=>b.onclick=()=>{S.fg=b.dataset.f;renderSim()});
$$('#segVista button').forEach(b=>b.onclick=()=>{S.vista=b.dataset.v;S.zoom=null;renderVista()});
let rz;window.addEventListener('resize',()=>{clearTimeout(rz);rz=setTimeout(renderSim,120)});

/* ── Fluxo por EMPRESA: escolhe uma empresa e unifica os bancos marcados dela ── */
S.emps=new Set(['SF']);S.contas=new Set(CONTAS.filter(c=>c.emp==='SF').map(c=>c.id));
function renderChips(){
  $('#empChips').innerHTML=`<div class="seg">${Object.entries(EMP).map(([c,e])=>`<button class="${S.emps.has(c)?'on':''}" data-e="${c}"><i class="dot" style="background:${e.cor}"></i>${c} · ${e.nome}</button>`).join('')}</div>`;
  $$('#empChips button').forEach(b=>b.onclick=()=>{const c=b.dataset.e;if(S.emps.has(c))return;
    S.emps=new Set([c]);S.contas=new Set(CONTAS.filter(x=>x.emp===c&&x.saldo!==0||x.emp===c&&x.pad).map(x=>x.id));S.zoom=null;renderAll()});
}
function renderContas(){
  const emp=[...S.emps][0];const cs=CONTAS.filter(c=>c.emp===emp);const sel=cs.filter(c=>S.contas.has(c.id));
  const tot=sel.reduce((a,c)=>a+c.saldo,0);
  $('#bancos').innerHTML=`<span class="lbl">Bancos unificados</span>`+cs.map(c=>`<button class="bk ${S.contas.has(c.id)?'on':''}" data-c="${c.id}"><span class="ck">${S.contas.has(c.id)?'✓':''}</span><span>${c.nome}${c.pad?' <span class="mini">· padrão</span>':''}<b class="num ${c.saldo<0?'neg':''}">${brl(c.saldo)}</b></span></button>`).join('')+
    `<span class="bk-tot"><span class="mini">${sel.length} de ${cs.length} bancos · saldo unificado</span><b class="num ${tot<0?'neg':''}">${brl(tot)}</b></span>`;
  $$('#bancos .bk').forEach(b=>b.onclick=()=>{const id=+b.dataset.c;if(S.contas.has(id)){if(S.contas.size===1){toast('Deixe pelo menos um banco');return}S.contas.delete(id)}else S.contas.add(id);renderAll()});
}
/* ── Dia a dia do trecho escolhido (vista/zoom) ── */
Object.assign(S,{soMov:true,diaAbertos:new Set()});
function renderDia(){
  if(!RES.length)return;const b=RES[0];const r=RES.find(x=>x.c.id===S.edit)||b;const N=b.N,iH=b.iH;const [a,z]=faixa(N,iH);
  const outro=r!==b;let rows=[];
  for(let i=a;i<=z;i++){const ini=i?r.sal[i-1]:r.sal[0]-(r.E[0]-r.S[0]);const mov=r.E[i]||r.S[i];if(S.soMov&&!mov&&i!==iH)continue;rows.push(i)}
  let tE=0,tS=0;for(let i=a;i<=z;i++){tE+=r.E[i];tS+=r.S[i]}
  const dias=z-a+1,abaixo=rows.filter(i=>i>=iH&&r.sal[i]<S.colchao).length;
  $('#diaHead').innerHTML=`<b style="font-size:15px">Dia a dia</b><div class="mini">${addD(b.ini,a).toLocaleDateString('pt-BR')} → ${addD(b.ini,z).toLocaleDateString('pt-BR')} · ${dias} dias · ${r.c.nome}${outro?' (Δ contra o Base)':''} · segue a vista e o zoom do gráfico</div>`;
  $('#diaTot').innerHTML=`<span><span class="mini">Entradas</span><b class="pos num">${brl(tE)}</b></span><span><span class="mini">Saídas</span><b class="neg num">${brl(tS)}</b></span><span><span class="mini">Resultado</span><b class="num ${tE-tS<0?'neg':'pos'}">${tE-tS>0?'+':''}${brl(tE-tS)}</b></span><span><span class="mini">Saldo inicial → final</span><b class="num">${k(a?r.sal[a-1]:r.sal[0])} → ${k(r.sal[z])}</b></span>`;
  let mxS=1,mnS=0;rows.forEach(i=>{mxS=Math.max(mxS,r.sal[i]);mnS=Math.min(mnS,r.sal[i])});
  const barra=v=>{const w=(v-mnS)/((mxS-mnS)||1)*100;return `<div class="sbar"><i style="width:${Math.max(1,w)}%;background:${v<0?'var(--out)':v<S.colchao?'var(--amber)':'var(--sf)'}"></i></div>`};
  const sem=['dom','seg','ter','qua','qui','sex','sáb'];
  let h=`<thead><tr><th>Data</th><th class="r">Saldo inicial</th><th class="r">Entradas</th><th class="r">Saídas</th><th class="r">Variação</th><th class="r">Saldo final</th>${outro?'<th class="r">Δ base</th>':''}<th style="width:140px"></th><th></th></tr></thead><tbody>`;
  for(const i of rows){const d=addD(b.ini,i);const ini=i?r.sal[i-1]:r.sal[i]-(r.E[i]-r.S[i]);const net=r.E[i]-r.S[i];const past=i<iH;const open=S.diaAbertos.has(i);
    const its=r.its.filter(t=>t.i===i);const fds=d.getDay()===0||d.getDay()===6;
    h+=`<tr class="dr ${past?'past':''} ${i===iH?'hoje':''} ${r.sal[i]<S.colchao&&!past?'low':''}" data-i="${i}">
      <td><span class="car">${its.length?(open?'▾':'▸'):''}</span><b>${dBR(d)}</b> <span class="mini">${sem[d.getDay()]}${fds?' · fim de semana':''}${i===iH?' · <b style="color:var(--sf)">hoje</b>':''}${past?' · realizado':''}</span></td>
      <td class="r">${brl(ini)}</td>
      <td class="r pos">${r.E[i]?'+'+brl(r.E[i]):'<span class="muted">—</span>'}${r.EP[i]?`<span class="var pv"><i>${k(r.EP[i])} prov.</i></span>`:''}</td>
      <td class="r neg">${r.S[i]?'−'+brl(r.S[i]):'<span class="muted">—</span>'}${r.SP[i]?`<span class="var pv"><i>${k(r.SP[i])} prov.</i></span>`:''}</td>
      <td class="r"><b class="${net<0?'neg':net>0?'pos':'muted'}">${net?(net>0?'+':'')+brl(net):'—'}</b></td>
      <td class="r"><b class="${r.sal[i]<0?'neg':''}">${brl(r.sal[i])}</b></td>
      ${outro?`<td class="r ${r.sal[i]-b.sal[i]<0?'neg':'pos'}">${Math.abs(r.sal[i]-b.sal[i])>1?(r.sal[i]-b.sal[i]>0?'+':'')+k(r.sal[i]-b.sal[i]):'<span class="muted">—</span>'}</td>`:''}
      <td>${barra(r.sal[i])}</td><td class="mini">${its.length?its.length+' lanç.':''}</td></tr>`;
    if(open){its.sort((p,q)=>(p.nat===q.nat?q.v-p.v:p.nat==='E'?-1:1));
      h+=`<tr class="sub-l"><td colspan="${outro?9:8}"><div class="lancs">${its.map(t=>{const x=t.x,e=t.e;const nome=e?e.desc:x.contraparte;const sub=e?'evento simulado · '+r.c.nome:(x.grupo+(x.doc?' · '+x.doc:'')+(t.rec?' · recuperação simulada':'')+(t.mov?' · data movida pelo cenário (orig. '+dBR(x.dataEf)+')':'')+(x.late?' · vencido em '+dBR(x.data):''));
        const tag=e?'<span class="badge" style="background:color-mix(in srgb,'+r.c.cor+' 18%,transparent);color:var(--tx)">◆ simulado</span>':x.status==='realizado'?'<span class="badge b-real">realizado</span>':x.prov?'<span class="badge b-prov">provisionado</span>':x.late?'<span class="badge b-late">vencido</span>':'<span class="badge" style="background:var(--panel2)">a realizar</span>';
        return `<div class="ln"><span>${tag}</span><span><b>${nome}</b><div class="mini">${sub}</div></span><b class="num ${t.nat==='E'?'pos':'neg'}">${t.nat==='E'?'+':'−'}${brl(t.v)}</b></div>`}).join('')}</div></td></tr>`}}
  if(!rows.length)h+=`<tr><td colspan="9" class="muted">Sem movimento no trecho.</td></tr>`;
  $('#diaTbl').innerHTML=h+'</tbody>';
  $$('#diaTbl tr.dr').forEach(tr=>tr.onclick=()=>{const i=+tr.dataset.i;S.diaAbertos.has(i)?S.diaAbertos.delete(i):S.diaAbertos.add(i);renderDia()});
  const hj=$('#diaTbl tr.hoje'),sc=$('#diaScroll');if(hj&&!S._diaRolou){sc.scrollTop=Math.max(0,hj.offsetTop-120);S._diaRolou=true}
  $('#diaMov').classList.toggle('on',S.soMov);
}
$('#diaMov').onclick=()=>{S.soMov=!S.soMov;renderDia()};
$('#diaAbrir').onclick=()=>{const r=RES.find(x=>x.c.id===S.edit)||RES[0];const [a,z]=faixa(r.N,r.iH);if(S.diaAbertos.size){S.diaAbertos.clear()}else{for(let i=a;i<=z;i++)if(r.E[i]||r.S[i])S.diaAbertos.add(i)}renderDia()};
$('#diaCsv').onclick=()=>{const r=RES.find(x=>x.c.id===S.edit)||RES[0];const [a,z]=faixa(r.N,r.iH);const L2=[['data','saldo_inicial','entradas','entradas_prov','saidas','saidas_prov','variacao','saldo_final'].join(';')];
  for(let i=a;i<=z;i++){if(S.soMov&&!(r.E[i]||r.S[i]))continue;L2.push([iso(addD(r.ini,i)),(i?r.sal[i-1]:r.sal[i]).toFixed(2),r.E[i].toFixed(2),r.EP[i].toFixed(2),r.S[i].toFixed(2),r.SP[i].toFixed(2),(r.E[i]-r.S[i]).toFixed(2),r.sal[i].toFixed(2)].join(';'))}
  const el=document.createElement('a');el.href=URL.createObjectURL(new Blob([L2.join('\n')],{type:'text/csv'}));el.download='fluxo-dia-a-dia.csv';el.click();toast('CSV do dia a dia gerado')};
$('#diaIr').onclick=()=>{S.zoom=null;S.vista='futuro';const r=RES[0];S.zoom=[r.iH,Math.min(r.N-1,r.iH+29)];renderVista()};
/* ───────────── TÍTULOS A PAGAR · provisões ───────────── */
const PROVLIST=[
 {id:'p1',emp:'SF',forn:'MARCELO CARMINATI',cat:'Serviços Prestados PJ',venc:'2026-10-15',valor:6000,serie:'12045574323',hist:[6000,6000,6000],ult:'NF 253 · 15/09'},
 {id:'p2',emp:'SF',forn:'MARCELO CARMINATI',cat:'Serviços Prestados PJ',venc:'2026-10-30',valor:6000,serie:'12045574912',hist:[6000,6000,6000],ult:'NF 253 · 30/09'},
 {id:'p3',emp:'SF',forn:'MAESTRO LOCADORA DE VEICULOS S.A.',cat:'Locação de Veículos',venc:'2026-10-13',valor:23855.13,serie:'12045570001',hist:[23855.13,23855.13,22990]},
 {id:'p4',emp:'SF',forn:'CONDOMINIO DO EDIFICIO MICROSERVICE',cat:'Condomínio',venc:'2026-10-10',valor:4026.95,serie:'12045570002',hist:[3980.2,4026.95,4102.3]},
 {id:'p5',emp:'WW',forn:'AMIL ASSISTENCIA MEDICA INTERNACIONAL S.A.',cat:'Plano de saúde',venc:'2026-10-20',valor:5027.49,serie:'12045570003',hist:[5027.49,5027.49,5027.49]},
 {id:'p6',emp:'SF',forn:'ZAC ASSESSORIA CONTABIL LTDA',cat:'Contabilidade',venc:'2026-10-14',valor:3769.13,serie:'12045570004',hist:[3769.13,3769.13,3769.13]},
 {id:'p7',emp:'SF',forn:'ENEL · energia sede',cat:'Energia elétrica',venc:'2026-10-21',valor:1850,serie:'12045570005',hist:[1712.4,1933.9,1801.55]},
 {id:'p8',emp:'CD',forn:'ARRIGHI ADVOGADOS E ASSOCIADOS',cat:'Honorários advocatícios',venc:'2026-10-25',valor:3735.3,serie:'12045570006',hist:[3735.3,3735.3,3735.3]},
 {id:'r1',emp:'SF',forn:'MECSTEEL DISTRIBUICAO E IMPORTACAO DE INOX LTDA',cat:'Compras de Matéria-prima',venc:'2026-10-08',valor:2180,real:true,doc:'NF 2021',origem:'PC 6951'},
 {id:'r2',emp:'SF',forn:'TD SYNNEX BRASIL LTDA',cat:'Mercadorias p/ revenda',venc:'2026-10-16',valor:2641,real:true,doc:'NF-e 88412',origem:'PC 6930'},
];
let fProv='todos';
$$('#segProv button').forEach(b=>b.onclick=()=>{$$('#segProv button').forEach(x=>x.classList.remove('on'));b.classList.add('on');fProv=b.dataset.f;renderProv()});
function renderProv(){
  const d=x=>new Date(x+'T12:00');const in7=x=>!x.real&&d(x.venc)<=addD(HOJE,7);
  const pv=PROVLIST.filter(x=>!x.real),rl=PROVLIST.filter(x=>x.real);
  const card=(l,v,s,c='')=>`<div class="card kpi"><div class="l">${l}</div><div class="v num ${c}">${v}</div><div class="s">${s}</div></div>`;
  $('#kpisProv').innerHTML=card('Provisionado em aberto · 30d',`<span class="pv">${brl(pv.reduce((a,x)=>a+x.valor,0))}</span>`,pv.length+' títulos sem documento')+
   card('Vencendo em 7 dias sem documento',brl(pv.filter(in7).reduce((a,x)=>a+x.valor,0)),pv.filter(in7).length+' títulos · cobrar NF/boleto','neg')+
   card('Confirmados hoje',brl(rl.filter(x=>x.confHoje).reduce((a,x)=>a+x.valor,0)),rl.filter(x=>x.confHoje).length+' provisões viraram reais')+
   card('Desvio médio provisão × real · 90d','2,4%','consumo 6,1% · fixos 0,3%');
  let it=PROVLIST.slice();if(fProv==='prov')it=pv;if(fProv==='real')it=rl;if(fProv==='aguard')it=pv.filter(in7);
  it.sort((a,b)=>a.venc.localeCompare(b.venc));
  $('#provTbl').innerHTML=`<thead><tr><th>Previsão</th><th>Emp.</th><th>Fornecedor</th><th>Categoria</th><th>Natureza</th><th>Documento</th><th class="r">Valor</th><th></th></tr></thead><tbody>`+
   it.map(x=>`<tr class="${x.real?'':'row-prov'}"><td>${dBR(d(x.venc))}${in7(x)?'<div class="mini" style="color:var(--amber)">vence em '+Math.round((d(x.venc)-HOJE)/864e5)+'d</div>':''}</td><td><i class="dot" style="background:${EMP[x.emp].cor}"></i>${x.emp}</td>
   <td><b>${x.forn}</b><div class="mini">${x.real?(x.origem||'')+(x.ajuste?` · provisão era ${brl2(x.ajuste)}`:''):'recorrência '+x.serie+(x.ult?' · último real: '+x.ult:'')}</div></td><td>${x.cat}</td>
   <td>${x.real?'<span class="badge b-real">✓ REAL</span>':'<span class="badge b-prov">◌ PROVISIONADO</span>'}</td>
   <td>${x.real?x.doc:'<span class="muted">aguardando NF/boleto</span>'}</td>
   <td class="r ${x.real?'':'pv'}"><b>${brl2(x.valor)}</b>${x.real?'':'<div class="mini">média 3 últimas '+brl(x.hist.reduce((a,v)=>a+v,0)/3)+'</div>'}</td>
   <td class="r">${x.real?(x.confHoje?'<button class="btn sm ghost" data-undo="'+x.id+'">desfazer</button>':''):'<button class="btn sm pri" data-conf="'+x.id+'">Confirmar com NF</button>'}</td></tr>`).join('')+'</tbody>';
  $$('[data-conf]').forEach(b=>b.onclick=()=>abrirModal(b.dataset.conf));
  $$('[data-undo]').forEach(b=>b.onclick=()=>{const x=PROVLIST.find(p=>p.id===b.dataset.undo);if(!x.confHoje){toast('Só dá para desfazer confirmações feitas no painel');return}
    x.real=false;x.valor=x.ajuste??x.valor;x.doc=null;x.confHoje=false;delete x.ajuste;renderProv();toast('Confirmação desfeita — voltou a provisionado')});
}
let cur=null;
function abrirModal(id){cur=PROVLIST.find(p=>p.id===id);
  $('#mT').textContent=cur.forn;$('#mS').innerHTML=`${cur.emp} · ${cur.cat} · provisionado <b class="pv">${brl2(cur.valor)}</b> para ${dBR(new Date(cur.venc+'T12:00'))}`;
  $('#fNum').value='';$('#fVal').value=cur.valor.toFixed(2).replace('.',',');$('#fVenc').value=cur.venc;$('#fBar').value='';$('#fTipo').value=/PJ|Contab|Honor/.test(cur.cat)?'NFSE':'BOL';
  diff();$('#mBg').classList.add('open');setTimeout(()=>$('#fNum').focus(),50)}
function parseV(s){return Number(String(s).replace(/\./g,'').replace(',','.'))||0}
function diff(){const v=parseV($('#fVal').value),d=v-cur.valor,p=cur.valor?d/cur.valor*100:0;
  const media=cur.hist.reduce((a,x)=>a+x,0)/cur.hist.length;
  if(Math.abs(d)<0.005){$('#fDiff').innerHTML=`<div class="alert ok">Valor igual ao provisionado. Só o documento será registrado.</div>`;$('#fEscopo').classList.add('hide');return}
  const forte=Math.abs(p)>10;
  $('#fDiff').innerHTML=`<div class="alert ${forte?'warn':'ok'}">Diferença de <b>${d>0?'+':''}${brl2(d)}</b> (${p>0?'+':''}${p.toFixed(1).replace('.',',')}%) sobre a provisão. ${forte?'<b>Acima da tolerância de 10%</b> — será pedido motivo e fica registrado na auditoria.':'Dentro da tolerância (10%).'} Média das 3 últimas reais: ${brl2(media)}.</div>${forte?'<label class="fld"><span>Motivo *</span><input id="fMot" placeholder="ex.: reajuste anual IPCA / consumo maior em setembro"></label>':''}`;
  $('#fEscopo').classList.remove('hide')}
$('#fVal').oninput=diff;
$('#mCancel').onclick=()=>$('#mBg').classList.remove('open');
$('#mOk').onclick=()=>{const num=$('#fNum').value.trim();const v=parseV($('#fVal').value);
  if(!num){toast('Informe o nº do documento');$('#fNum').focus();return}
  if(v<=0){toast('Valor inválido');return}
  const m=$('#fMot');if(m&&!m.value.trim()){toast('Informe o motivo da diferença');m.focus();return}
  const esc=(document.querySelector('input[name=esc]:checked')||{}).value||'esta';
  const ant=cur.valor;cur.ajuste=Math.abs(v-ant)>.004?ant:undefined;cur.valor=v;cur.real=true;cur.confHoje=true;cur.venc=$('#fVenc').value||cur.venc;
  cur.doc=$('#fTipo').selectedOptions[0].text+' '+num;cur.origem='recorrência '+cur.serie;
  let extra='';if(Math.abs(v-ant)>.004&&esc!=='esta'){const nv=esc==='media'?(cur.hist.slice(1).concat(v).reduce((a,x)=>a+x,0)/3):v;
    PROVLIST.filter(p=>!p.real&&p.serie===cur.serie).forEach(p=>p.valor=Math.round(nv*100)/100);extra=' · próximas provisões ajustadas para '+brl2(nv)}
  $('#mBg').classList.remove('open');renderProv();toast('Confirmado como real'+extra)};

/* ───────────── abas e tema ───────────── */
function irPara(t,f){$$('#tabs button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));
  $('#v-fluxo').classList.toggle('hide',t!=='fluxo');$('#v-pagar').classList.toggle('hide',t!=='pagar');$('#v-outro').classList.toggle('hide',['fluxo','pagar'].includes(t));
  $('#ttl').textContent={fluxo:'Fluxo de Caixa',pagar:'Títulos a Pagar',receber:'Títulos a Receber',conc:'Conciliação',inter:'Intercompany'}[t];
  if(t==='pagar'){if(f){fProv=f;$$('#segProv button').forEach(x=>x.classList.toggle('on',x.dataset.f===f))}renderProv()}
  $('#drawer').classList.remove('open')}
$$('#tabs button').forEach(b=>b.onclick=()=>irPara(b.dataset.t));
$('#theme').onclick=()=>{const r=document.documentElement;const cur=r.dataset.theme||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');r.dataset.theme=cur==='dark'?'light':'dark';renderAll()};
renderAll();
</script>
</body>
</html>

````

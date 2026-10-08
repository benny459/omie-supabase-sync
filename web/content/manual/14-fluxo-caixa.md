---
titulo: Fluxo de Caixa
resumo: Fluxo por empresa com os bancos escolhidos unificados — saldo diário, entradas e saídas, cenários e simulações.
icone: 📈
area: erp
rotas: /financeiro/fluxo
caminhos: web/components/financeiro/TelaFluxoFin.tsx, web/components/financeiro/fluxo-fin-motor.ts, web/components/financeiro/fluxo-fin.css, web/app/api/financeiro/fluxo, sql/140_fluxo_caixa_financeiro.sql
atualizado: 2026-10-08
---

**Financeiro → Fluxo de Caixa** mostra o caixa de **uma empresa** de cada vez, somando os bancos que você escolher como se fossem um só caixa: o que já entrou e saiu (realizado) e o que vai entrar e sair (títulos em aberto e contratos ainda a faturar).

## De onde vêm os números

| O quê | Origem |
|---|---|
| **Saldo de hoje** de cada banco | o mesmo número dos cartões "Bancos" do Contas a pagar (saldo do Omie / último extrato) |
| **Realizado** (passado) | o extrato das contas — o que de facto entrou e saiu |
| **A pagar** | títulos do Omie em aberto (com os ajustes feitos no painel) + contas lançadas no painel (manuais, recorrências, previsões de pedido de compra) |
| **A receber** | títulos em aberto + **competências futuras dos contratos** ainda não faturadas |
| **Provisionado** (roxo, hachurado) | recorrências do Omie **sem NF, boleto ou chave**, recorrências do painel sem documento e competências de contrato a faturar — valor estimado, ainda sem documento |

Contas a pagar **vencidas há até 60 dias** entram no dia de hoje (chave "Contas a pagar vencidas entram hoje"). Recebíveis vencidos **não** entram no cenário Base — só pela alavanca "Recuperar vencidos a receber" do simulador.

## Passo a passo

1. Escolha a **empresa** (CD, SF ou WW). Os bancos dela com saldo diferente de zero e o banco padrão já vêm marcados.
2. Nos **Bancos unificados**, clique para tirar ou pôr cada banco. À direita aparece o **saldo unificado**. A escolha fica guardada para a próxima vez.
3. Escolha a **janela** (−1m/+1m, −3m/+3m, −6m/+6m ou só futuro 90 dias) e a **vista** do gráfico (só passado, passado + futuro, só futuro).
4. **Zoom:** arraste no navegador (o minigráfico embaixo) ou role o mouse sobre o gráfico. Duplo clique volta.
5. Passe o mouse no gráfico para ver o saldo do dia em cada cenário; **clique** para ver os lançamentos daquele dia.
6. O bloco **Entradas e saídas** e o **Dia a dia** seguem sempre o mesmo trecho do gráfico. Clique num dia para abrir os lançamentos dele.
7. No **Demonstrativo** (por dia, semana ou mês), clique numa célula para ver os lançamentos; **CSV** exporta.

### Chaves

- **Incluir provisionados** — desligada, os valores estimados somem do gráfico, das tabelas e do saldo.
- **Contas a pagar vencidas entram hoje** — desligada, os vencidos saem do fluxo.
- **Ocultar transferências entre os bancos escolhidos** — transferência entre dois bancos **marcados** some (não é entrada nem saída do caixa). Se só um dos bancos estiver marcado, ela aparece como entrada ou saída normal.
- **Escala a partir do zero** / **Faixa de incerteza** — leitura do gráfico.

## Simulador (cenários)

- **Base** é o fluxo como está nos títulos — não muda.
- **Conservador** e **Otimista** vêm prontos; **+ Cenário** e **Duplicar** criam outros.
- **Alavancas** (atraso dos clientes, inadimplência, recuperar vencidos, variação das despesas, provisões acima do previsto, postergar fornecedores) só mexem do dia de hoje em diante. O realizado nunca muda.
- **Linhas de simulação (eventos):** entradas ou saídas hipotéticas (uma vez ou mensais). Cada cenário marca quais usa.
- **lançar** num evento abre o **+ Nova conta** já preenchido — o evento vira título de verdade.
- **Salvar cenário** guarda no servidor; com **compartilhar** ligado, o financeiro inteiro vê.
- **Colchão mínimo de caixa:** edite o valor no cartão; aparece como linha âmbar no gráfico e conta "dias abaixo do colchão" e "necessidade de caixa" no **Comparativo de cenários**.

## Perguntas frequentes

**O saldo de hoje não bate com o banco.** Ele é o saldo do Omie / último extrato importado, o mesmo dos cartões "Bancos" do Contas a pagar. Importe o OFX mais recente na Conciliação.

**Por que aparece um título sem banco?** Título sem conta definida entra pelo **banco padrão** da empresa e só aparece se esse banco estiver marcado.

**Onde está o "Previsto original" (Δ)?** O sistema começa a guardar, toda noite, o que estava previsto. Quando houver esse histórico, a chave "Previsto original" aparece no Demonstrativo e o Δ (realizado − previsto) passa a ser mostrado no passado. Antes disso ele não aparece — nada de número inventado.

**Quem vê esta aba?** Quem tem a permissão **Ver fluxo de caixa** (Usuários e acessos → Financeiro) e também vê contas a pagar ou a receber.

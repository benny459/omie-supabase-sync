---
titulo: Conciliação bancária
resumo: Extrato de qualquer banco (OFX/CSV), sugestões, painel Casar, regras e Omie Cash.
icone: 🏦
area: erp
rotas: /financeiro/conciliacao
caminhos: web/components/navy/tela/TelaConciliacaoBancaria.tsx, web/components/financeiro/pagar-v3-motor.ts, web/components/financeiro/receber-v1-motor.ts, web/components/financeiro/CasarPainel.tsx, web/lib/ofx.ts, web/app/api/financeiro/ofx, web/app/api/financeiro/conciliacao
atualizado: 2026-10-09
---

Conciliar é ligar cada lançamento do extrato ao título que ele paga ou recebe. Quando você concilia, o título fica **PAGO** ou **RECEBIDO** em todo o sistema (telas, BI e fluxo de caixa).

## Onde vejo o que falta conciliar em cada banco

**Financeiro → Conciliação bancária** é o lugar único da conciliação: **entradas e saídas** de cada conta, num só lugar.

1. No topo, a tabela **Contas** mostra todos os bancos com extrato no período: até que dia o extrato vai (e quantos dias está sem extrato), quantos movimentos, **% conciliado**, quanto **falta conciliar** (quantidade, valor, entradas × saídas) e o último arquivo importado. A conta com mais pendências aparece primeiro.
2. Clique numa conta para abrir os movimentos dela. Logo abaixo aparece o resumo da conta aberta (% conciliado, pendentes, sugestões, extrato até, saldo final do extrato).
3. Cada movimento mostra a situação numa etiqueta:
   - **Conciliado** — já ligado ao título (aparece com quem/qual documento; dá para **desfazer**);
   - **Sugestão** — o sistema achou o título provável: **aceitar sugestão** concilia com um clique (ou **casar…** para escolher outro);
   - **Pendente · sem par** — ninguém achou: **casar…** abre a busca de títulos (pagar e receber), criar lançamento (tarifa, juros, despesa) ou marcar transferência;
   - **Transferência entre contas**, **Tarifa** ou **Ignorado** — fora dos títulos, com o motivo.
4. Os filtros **Pendentes · Com sugestão · Conciliados · Ignorados / transferências · Todos** e **Entradas (receber) · Saídas (pagar)** deixam ver só o que interessa. A tela abre em **Pendentes**, últimos 90 dias.

> As abas de conciliação dentro de **Títulos a Pagar** (só saídas) e **Títulos a Receber** (só entradas) continuam, com o botão **Conciliação completa ↗** que abre esta tela já na mesma conta.

## Como faço para importar o extrato

1. Em **Financeiro → Conciliação bancária**, clique em **Importar OFX**.
2. Funciona com **OFX de qualquer banco** e também **CSV/Excel** (na primeira vez você indica as colunas; o sistema lembra).
3. Veja a **prévia**: conta reconhecida, período, saldo inicial e final, lançamentos repetidos.
4. Se a conta não for reconhecida, escolha uma ou **+ cadastrar conta**.
5. Confirme.

> **Dica:** lançamentos que já estavam importados não entram de novo. Pode reimportar o mesmo período sem medo: alguns bancos, como o Bradesco, mudam o código interno (FITID) do lançamento a cada arquivo. Por isso o painel também reconhece pela **data, valor, nº do documento e histórico**. Duas tarifas iguais no mesmo dia continuam entrando como duas; só entra de novo o que passar do que já existe.

## Como faço para casar um lançamento com o título

1. Clique no lançamento **pendente**. Abre o painel **Casar**.
2. Veja as **sugestões**, cada uma com o motivo (valor exato, data perto do vencimento, CNPJ ou nome no histórico, nº da NF/PV/OS, casamentos anteriores) e os **grupos** de parcelas cuja soma bate.
3. Não achou? Use a **busca**: nome ou fantasia do cliente/fornecedor, CNPJ, nº da NF, PV, OS, PC, valor ou vencimento.
4. Marque um ou mais títulos. O painel mostra o total contra o valor do extrato.
5. Sobrou diferença? Escolha **lançar como juros/multa**, **quitar com desconto** ou **deixar o resto pendente**.
6. Confirme.

Atalhos: **j/k** navegam, **/** vai para a busca, **Enter** casa, **Esc** fecha.

## Quando não existe título

- **Criar título e conciliar**: escolha o cliente/fornecedor e a categoria (tarifa, juros, rendimento…).
- **Transferência entre contas** (PIX/TED entre contas nossas, por exemplo do Bradesco para o C6): o sistema procura o lançamento do outro lado, com o mesmo valor e até 3 dias de diferença, e liga os dois.
  - Se um lado já foi marcado como transferência **sem** o par, ele aparece na busca do outro com *"já marcado como transferência, falta ligar"*. Clique **é este**.
  - O botão rápido **Marcar transferência** existe para entradas e para saídas, no Contas a pagar e no Contas a receber. Quando só há um candidato do outro lado, liga os dois sozinho.
- **Ignorar** com motivo.

## Regras e conciliação automática

- **Regras**: “Sempre que o histórico contiver X → categoria Y / ignorar”. Valem para as próximas importações (**Aplicar regras agora**).
- **Aceitar sugestões** casa de uma vez só as de alta certeza.
- **Conciliar automaticamente** roda o casamento automático; o que foi casado assim fica marcado **automático** e pode ser desfeito.
- O sistema **aprende**: depois que você liga um nome do histórico a um cliente, as próximas sugestões desse cliente sobem.

## Omie Cash

O **Omie Cash** funciona como uma conta bancária: os movimentos entram sozinhos de hora em hora e passam pela conciliação automática.

## Perguntas frequentes

**Concilei errado.** Use **desfazer** no lançamento (ou desfazer transferência).

**Os botões não aparecem para mim.** Baixar e conciliar dependem das permissões “Baixar / estornar título” e “Conciliação bancária”.

## Movimento de um banco pagando título de outra empresa

As sugestões do painel **Casar** procuram títulos de **todas as empresas** do grupo. Quando o título é de outra empresa (ex.: saída no C6 da SF pagando conta da CD), aparece a etiqueta **"outra empresa (CD) — gera intercompany"**. Ao casar, o título fica pago e o registro "CD deve à SF" entra em **Financeiro → Intercompany**, onde se marca como liquidado quando as empresas acertarem entre si.


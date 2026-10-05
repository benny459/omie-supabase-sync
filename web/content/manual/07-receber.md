---
titulo: Contas a Receber
resumo: Previsão de entrada, cobrança, renegociação e baixa dos recebimentos.
icone: 💰
area: erp
rotas: /financeiro/receber
caminhos: web/components/financeiro/TelaReceberV1.tsx, web/components/financeiro/receber-v1-motor.ts, web/app/api/financeiro/receber
atualizado: 2026-10-05
---

**Financeiro → Títulos a Receber** mostra o que os clientes devem: títulos do Omie e as parcelas criadas pelo **Faturamento** do painel.

## O que tem na tela

- **Base de datas**: alterne entre **Previsão** e **Vencimento**.
- **Indicadores** e **Pontualidade 30 dias**.
- **Próximos 30 dias · entradas por empresa** e **Bancos** (com o previsto para os próximos 7 dias).
- **Inadimplência · quem está devendo**: o que está para **cobrar** e o que já foi **prometido**, por faixa de atraso.
- **Recebimentos**: a tabela com Previsão, Cobrança, Situação e o histórico de pontualidade do cliente.

## Como faço para cobrar um cliente

1. Abra o título e clique em **Cobrar** (“Registrar cobrança”).
2. Informe canal, contato, nota e, se o cliente prometeu, a **nova previsão**.
3. Use **Copiar mensagem** para mandar pelo WhatsApp ou e-mail. O histórico fica no título.

> **Dica:** selecione vários títulos para cobrar ou alterar a previsão de uma vez.

## Renegociar e alterar previsão

- **Alterar previsão** muda quando você espera receber (o vencimento do documento não muda).
- **Marcar como renegociado** registra o acordo; dá para desfazer.

## Como faço para registrar um recebimento

1. Abra o título e clique em **Receber** (com juros, multa ou desconto; pode ser parcial).
2. Ou selecione vários e use **Receber em lote**.
3. O melhor caminho é **conciliar o extrato**: veja a página Conciliação.

> **Atenção:** **Emitir boleto** ainda não está disponível (depende do banco).

## Perguntas frequentes

**De onde vêm as parcelas?** Do Faturamento: ao emitir NF-e/recibo ou registrar NFS-e, as parcelas são criadas exatamente como na tela de emissão.

**Como abro a rentabilidade do pedido?** Na gaveta do título, use o link do PV/OS.

---
titulo: Contas a Pagar
resumo: Agenda, bancos, pode-pagar, reprogramar previsão, baixa em lote, arquivo C6 e contas recorrentes.
icone: 💸
area: erp
rotas: /financeiro/pagar
caminhos: web/components/financeiro/TelaPagarV3.tsx, web/components/financeiro/pagar-v3-motor.ts, web/components/financeiro/RemessaC6.tsx, web/components/financeiro/SerieDialog.tsx, web/components/NovoTituloModal.tsx, web/app/api/financeiro/pagar
atualizado: 2026-10-05
---

**Financeiro → Títulos a Pagar** junta os títulos do Omie (até o corte) e as contas nascidas no painel (previsões de PC e contas lançadas aqui).

## O que tem na tela

- **Indicadores clicáveis**: vencidos, hoje, 7, 30 e 90 dias e bloqueados — clique para filtrar.
- **Próximos 30 dias · por empresa**: agenda por dia ou semana. Clique num dia para ver o detalhe e **Baixar liberados**.
- **Bancos**: saldo de cada conta, último extrato e quanto está programado.
- **Vencidos · onde está o dinheiro**: ranking por fornecedor, categoria, projeto ou status.
- **Pagamentos**: a tabela, com filtros estilo Excel, colunas de **Compra** e **NF**, e exportação.

## Vencimento × previsão

- **Vencimento** é o que está no documento — não muda.
- **Previsão** é quando você vai pagar. Ela começa no vencimento; se cair em fim de semana ou feriado, vai para o **próximo dia útil** (feriados em Cadastros → Feriados).
- Para mudar: abra o título e clique em **Reprogramar previsão** — ou selecione vários e reprograme em lote. A nova data muda o **fluxo de caixa**, a agenda e os indicadores.

## Pode pagar?

O título mostra o caminho **PC → aprovação → NF → pagamento**. Título sem NF ou sem aprovação fica **bloqueado**. Para pagar mesmo assim é preciso escrever uma **justificativa**.

## Ciclo do pagamento — tenho certeza de que está em aberto?

Ao abrir um título, o quadro **Ciclo do pagamento** mostra o caminho inteiro do pedido de compra até o pagamento:

1. No topo, o **veredito**: "Em aberto — pode pagar", "Já pago em dd/mm", "Pago parcialmente", "Possível duplicidade — conferir" ou "Excluído no Omie — não pagar".
2. O **PC**: número, total, quem aprovou e quando foi recebido.
3. As **NFs** do PC com o valor de cada uma, e quanto do PC ainda está sem NF.
4. Todas as **parcelas** dessas NFs: vencimento, valor e situação (em aberto, programado, enviado ao banco, pago com data, excluído no Omie). A linha do título que você abriu aparece marcada "← este".
5. Os totais: valor das NFs, quanto já foi pago e quanto ainda está em aberto.

Na tabela, a coluna NF mostra **NF e parcela** (ex.: "NF 11924 · parc 002/002"), para distinguir títulos parecidos do mesmo pedido.

> **Atenção:** quando o financeiro refazia as parcelas no Omie, os títulos antigos sumiam de lá mas continuavam na nossa base. Esses títulos aparecem com o selo vermelho **"Excluído no Omie"** e um aviso no topo da lista — **não pague**. O botão "Tirar todos do contas a pagar" retira-os da lista (dá para desfazer).

## Como faço para pagar (dar baixa)

1. Abra o título e informe valor, data, conta e, se houver, **juros, multa ou desconto** (pode ser parcial).
2. Ou selecione vários e use **Baixar em lote** (os bloqueados ficam de fora).
3. Em **Baixas de hoje** dá para **estornar** um lançamento errado.

## Como faço para gerar o arquivo do C6

1. Selecione os títulos e clique em **Arquivo C6** (“Gerar arquivo C6 — pagamentos em lote”).
2. Escolha o modelo: **Pagamentos de contas (Pix, boleto, TED)** ou **Salários via Pix**.
3. Confira cada linha. Se faltar chave Pix ou conta do fornecedor, use **completar no cadastro ↗**.
4. Baixe o arquivo e suba no portal do C6. A baixa no sistema vem depois, pela conciliação.

## Pagar conta de outra empresa do grupo (intercompany)

Uma conta da **CD** ou da **WW** pode ser paga por um banco da **SF** (C6, Bradesco, Omie.CASH).

1. Na coluna **Banco p/ pagar**, abra a lista: aparecem as contas de todas as empresas do grupo — as da própria empresa primeiro, as outras marcadas "gera intercompany".
2. Escolha, por exemplo, **SF · C6 Bank** para um título da CD. Embaixo aparece "pago pela SF".
3. Dê a baixa normalmente (individual, em lote ou pelo arquivo do C6 + conciliação).

O título da CD fica **PAGO** e o sistema registra sozinho "**CD deve à SF**" em **Financeiro → Intercompany**. Estornar a baixa anula esse registro.

> **Atenção:** a despesa continua na DRE da empresa dona do título (CD); o caixa sai da conta que pagou (SF).

## Nova conta e contas recorrentes

1. Clique em **+ Nova conta**, escolha fornecedor, categoria, conta, projeto, vencimento e valor.
2. Em **Recorrência**, escolha a frequência (mensal, trimestral, anual…) e quantas vezes, até quando ou sem fim.
3. Para mudar uma conta recorrente: **Só esta ocorrência**, **Esta e as próximas** ou **Todas (as não pagas)**. Também dá para **Encerrar série** ou **Excluir série** (só sem pagamentos).

> **Atenção:** o Omie não recebe mais nada. Contas novas, baixas e previsões ficam só aqui — e o BI e o fluxo de caixa já enxergam.

## Perguntas frequentes

**Paguei e o título continua em aberto.** Confira se a baixa foi registrada (Baixas de hoje) ou concilie o extrato.

**Onde vejo o detalhe de um título do Omie?** Clique na linha; a gaveta mostra PC, NF, histórico e o fornecedor.

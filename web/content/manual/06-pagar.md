---
titulo: Contas a Pagar
resumo: Agenda, bancos, pode-pagar, editar título, reprogramar previsão, baixa em lote, arquivo C6 e contas recorrentes.
icone: 💸
area: erp
rotas: /financeiro/pagar
caminhos: web/components/financeiro/TelaPagarV3.tsx, web/components/financeiro/pagar-v3-motor.ts, web/components/financeiro/RemessaC6.tsx, web/components/financeiro/SerieDialog.tsx, web/components/financeiro/EditarTituloModal.tsx, web/lib/financeiro-editar.ts, web/components/NovoTituloModal.tsx, web/app/api/financeiro/pagar, web/app/api/financeiro/provisao, sql/141_provisao_confirmar.sql
atualizado: 2026-10-09
---

**Financeiro → Títulos a Pagar** junta os títulos do Omie (até o corte) e as contas nascidas no painel (previsões de PC e contas lançadas aqui).

## O que tem na tela

- **Indicadores clicáveis**: vencidos, hoje, 7, 30 e 90 dias e bloqueados — clique para filtrar.
- **Próximos 30 dias · por empresa**: agenda por dia ou semana. Clique num dia para ver o detalhe e **Baixar liberados**.
- **Bancos**: saldo de cada conta, último extrato e quanto está programado.
  - **Conta com extrato importado (OFX/CSV):** o saldo é o do **extrato**, e não mais o do Omie. Se o arquivo traz o saldo final (Bradesco), usa esse saldo mais o que entrou depois. Se não traz (C6), soma o que o extrato trouxe ao último saldo conhecido antes dele. O mesmo saldo vale no Contas a receber e no Fluxo de caixa.
  - **"N mov. a conciliar"** conta só as saídas do extrato ainda sem título casado. Boleto pago com juros ou multa, já casado, não conta mais como pendente.
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

> No arquivo, **chave Pix de telefone** sai no formato que o C6 exige (**+55 11 98772-6252**); e-mail, CPF/CNPJ e chave aleatória vão como estão. **Favorecido e descrição** saem **sem acento, cedilha ou símbolos** (o campo mostra "vai como: …" quando muda algo).

## Pagar conta de outra empresa do grupo (intercompany)

Uma conta da **CD** ou da **WW** pode ser paga por um banco da **SF** (C6, Bradesco, Omie.CASH).

1. Na coluna **Banco p/ pagar**, abra a lista: aparecem as contas de todas as empresas do grupo — as da própria empresa primeiro, as outras marcadas "gera intercompany".
2. Escolha, por exemplo, **SF · C6 Bank** para um título da CD. Embaixo aparece "pago pela SF".
3. Dê a baixa normalmente (individual, em lote ou pelo arquivo do C6 + conciliação).

O título da CD fica **PAGO** e o sistema registra sozinho "**CD deve à SF**" em **Financeiro → Intercompany**. Estornar a baixa anula esse registro.

> **Atenção:** a despesa continua na DRE da empresa dona do título (CD); o caixa sai da conta que pagou (SF).

## Como faço para editar um título (valor, vencimento, categoria…)

1. Clique no **✎** da linha ou abra o título e clique em **Editar título…**.
2. Mude o que precisar: valor, vencimento, previsão, categoria, conta corrente, projeto e observação. Em conta lançada no painel também dá para trocar o fornecedor e o documento.
3. Se o título é de uma **recorrência** (do Omie ou do painel), escolha em **Aplicar a**: **Só esta** ou **Esta e as próximas desta série** (no painel também **Todas**). O vencimento só muda na ocorrência aberta.
4. Clique em **Salvar**. O BI, o fluxo de caixa, a conciliação, o arquivo C6 e as fichas já veem o novo valor.

- **Título do Omie:** a alteração fica guardada no painel — o Omie não é alterado. A linha mostra **ajustado · orig. R$ X** e, na gaveta, **desfazer ajuste** volta ao valor original.
- **Previsão de PC:** mudar o valor exige **motivo**, porque o total das parcelas deixa de bater com o pedido de compra.
- O valor nunca pode ficar **abaixo do que já foi pago**.
- Precisa da permissão **Editar títulos** (financeiro.editar_titulo). Toda edição fica no histórico de auditoria.

## Nova conta e contas recorrentes

1. Clique em **+ Nova conta**, escolha fornecedor, categoria, conta, projeto, vencimento e valor.
   - A busca de **Fornecedor** usa o mesmo cadastro da tela **Cadastros**: aparecem os que vieram do Omie e os **cadastrados no painel**, na hora.
   - **Nº documento ou nº da nota fiscal é obrigatório.** Sem documento? Clique em **Gerar nº** — sai um número único (ex.: PG-SF-2610-000001) que fica registrado.
   - **Emissão**: se não preencher, fica a data do lançamento (hoje) — ela aparece no formulário e na gaveta do título.
   - **Código de barras / linha digitável** (boleto, 44/47/48 dígitos): cole no campo. Se o valor estiver vazio e o vencimento for o de hoje, o sistema lê **valor e vencimento do próprio código**. O código aparece na gaveta com **copiar** e vai sozinho para o **Arquivo C6** como pagamento de boleto. Dá para corrigir depois em **Editar título**.
2. Em **Recorrência**, escolha a frequência (mensal, trimestral, anual…) e quantas vezes, até quando ou sem fim.
3. Para mudar uma conta recorrente: **Só esta ocorrência**, **Esta e as próximas** ou **Todas (as não pagas)**. Também dá para **Encerrar série** ou **Excluir série** (só sem pagamentos).

> **Atenção:** o Omie não recebe mais nada. Contas novas, baixas e previsões ficam só aqui — e o BI e o fluxo de caixa já enxergam.

## Perguntas frequentes

**Paguei e o título continua em aberto.** Confira se a baixa foi registrada (Baixas de hoje) ou concilie o extrato.

**O valor de uma conta recorrente veio diferente este mês.** Abra o título, **Editar título…**, mude o valor e deixe **Só esta**. Se mudou de vez, use **Esta e as próximas desta série**.

**Onde vejo o detalhe de um título do Omie?** Clique na linha; a gaveta mostra PC, NF, histórico e o fornecedor.

## Conciliação: esta aba ou a tela completa?

A aba de conciliação desta tela mostra só as **saídas (contas a pagar)** da conta. Para ver **tudo o que falta conciliar** num banco — entradas e saídas, com a situação de cada movimento — e a visão geral de todos os bancos, clique em **Conciliação completa ↗** (ou vá em **Financeiro → Conciliação bancária**).

## Pagamento antecipado de pedido de compra

O botão **💸 Antecipar PC** (no topo) pede o nº do pedido e abre o lançamento do adiantamento (Pix ou depósito, com os dados do cadastro do fornecedor). O título nasce com o nº **PC 7356-ANT**, aparece aqui e pode ir no arquivo C6. As parcelas do pedido descontam o valor adiantado, então a conta não aparece duas vezes. Detalhes em **Compras › Pagamento antecipado**.

## O que já foi pago (aba ✓ Pagos)

Ao lado de **Em aberto**, a aba **✓ Pagos** mostra tudo o que já foi pago — títulos do Omie e baixas feitas no painel —, pela data do pagamento. Escolha o período (este mês, mês passado, 7/30/90 dias, ano ou livre); no topo aparecem o total, os juros/multa e quantos foram pagos com atraso. A busca e a empresa do topo também filtram aqui. **CSV** exporta.

## Busca em todo o histórico

Digitando um nome, documento, NF ou CNPJ (3 letras ou mais), a lista **Em aberto** ignora o período e mostra todos os títulos em aberto que combinam; logo abaixo aparece o **Histórico** com os pagos, cancelados e vencidos antigos. Uma linha acima do histórico mostra os filtros que estão valendo (empresa, filtros de coluna).

## Nº da NF e data de emissão

No detalhe do título aparecem **Nº da NF** e **Emissão**. Em **Editar título…** dá para informar os dois — em título do Omie a alteração vale no painel (o Omie não é escrito) e continua valendo depois de cada sincronização.

## Provisionado × Real

Conta **provisionada** é uma estimativa: ainda não tem documento (NF, boleto ou chave). Exemplos: aluguel, salário PJ e honorários lançados por recorrência antes de a nota chegar.

| Selo | Quando |
|---|---|
| **◌ PROVISIONADO** (roxo, linha hachurada) | recorrência do Omie sem NF/boleto/chave, recorrência do painel sem documento, ou conta lançada com **Valor estimado** |
| **✓ REAL** (verde) | tem documento, ou foi **confirmada com NF** |

- O cartão **Vencendo em 7 dias sem documento** e os botões **Provisionados** / **Provisionados vencendo em 7d** filtram essas contas.
- Na linha aparece a recorrência, o **último valor real** e a **média das 3 últimas**.

### Confirmar com NF

1. Na linha (ou no detalhe), clique **Confirmar com NF**.
2. **Arquivo (recomendado):** solte ou escolha no quadro **"📎 Nota, fatura ou boleto"** o **XML, PDF ou foto** — pode ser mais de um (ex.: a NFS-e e o boleto, ou a fatura da Vivo que já traz o boleto). O painel guarda os arquivos no título e preenche sozinho tipo, número, data de emissão, valor, vencimento e a linha digitável. XML é lido direto; PDF e foto são lidos pela IA — **confira os campos**. A linha digitável é conferida pelos dígitos verificadores, e o valor e o vencimento escritos nela mandam. Se o documento for de outro CNPJ, aparece um aviso.
3. Confira ou informe tipo (NF-e, NFS-e, boleto, recibo), número, **data de emissão** (vem com a data de hoje; ajuste se a nota foi emitida em outro dia — não pode ser futura), valor, vencimento e, se houver, o código de barras. Colando a linha digitável à mão, o painel lê dela o valor e o vencimento (boleto bancário) ou o valor (concessionária: Vivo, energia, água, guias).
4. Se o valor diferir mais de **10%** da provisão, escreva o motivo.
5. Escolha o alcance: **Só esta parcela** (consumo variável), **Esta e as próximas provisões da série** (reajuste — só mexe nas futuras sem documento) ou **Próximas pela média das últimas 3 reais**.
6. Salve: a conta vira **✓ REAL**, mostra "emitida dd/mm/aaaa", os links **📎 nota** / **📎 anexo 2** (abrem os arquivos) e "provisão era R$ …". **desfazer** volta tudo como estava.

Nada é gravado no Omie — a confirmação fica no painel, por cima do título.

### Sugestão automática

Quando chega uma NF (NF-e ou NFS-e, captada pela Focus) do **mesmo CNPJ**, emitida entre 35 dias antes e 15 dias depois do vencimento, com valor até 50% diferente, e que ainda não está em nenhum outro título, a linha mostra **✦ NFS-e 3601 encontrada — confirmar?**. Clicar abre o **Confirmar com NF** já preenchido com tipo, número, data de emissão, valor e chave — confira e salve. A sugestão nunca confirma sozinha.

### Baixa de provisionado

Conta provisionada **não pode ser baixada** nem entrar no pagamento em lote: confirme com a NF antes. O administrador pode forçar marcando **Administrador: baixar sem documento** e escrevendo o motivo na Observação (fica registrado na observação).

### Nova conta com valor estimado

No **+ Nova conta**, a caixa **Valor estimado (provisão)** marca a conta (ou a série recorrente) como provisionada. Recorrências já vêm com ela ligada.

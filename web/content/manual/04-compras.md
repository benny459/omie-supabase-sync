---
titulo: Compras
resumo: Requisição → pedido de compra → aprovação → NF → recebimento → conferência.
icone: 🛒
area: erp
rotas: /erp/compras
caminhos: web/components/compras, web/app/api/compras, web/lib/compras.ts, web/lib/compras-avisos.ts
atualizado: 2026-10-06
---

A tela **Compras** mostra o caminho de cada compra em **Kanban** (ou **Tabela**): **Requisição → Pedido de compra (pendente / aprovado) → Faturado → Recebido → Conferido**.

## Como faço para gerar um pedido de compra (PC) a partir da requisição (RC)

1. Na coluna **Requisição**, abra a RC (as novas aparecem marcadas como **nova**). Também dá para abrir direto clicando no nº da RC em **Operação**.
2. Marque os **itens** que vão neste pedido (a caixa do cabeçalho marca todos os que ainda faltam). Sem marcar nada, entram todos os que faltam.
3. Clique em **→ Gerar pedido de compra (N itens)**. Abre uma folha curta já preenchida: confira o **fornecedor** (vem o sugerido na RC), a **categoria**, a **condição**, a **previsão de entrega** e, se quiser, ajuste quantidade (parcial) e valor.
4. **Criar pedido de compra**: o PC é criado ligado à RC e ao PV/OS e **abre na hora** para você revisar frete, parcelas e mandar para aprovação (**⏳ Salvar e solicitar aprovação**).
5. Os itens que ficaram de fora continuam na RC para **outro pedido** (ex.: outro fornecedor). Cada item da RC mostra em que **PC** já está (clique no nº para abrir).
6. Depois de aprovado, use **🖨 Imprimir / PDF / enviar ao fornecedor**.

> Na RC, **Data limite de entrega** é até quando o material precisa chegar (vem do prazo da venda). No PC, **Previsão de entrega** é a data combinada com o fornecedor — a folha avisa se ela passa da data limite.

> **Atenção:** todo PC precisa estar ligado a uma **requisição** e a um **PV/OS**. Sem RC, só marcando “Pedido sem RC” com motivo (vai para aprovação). Compra para estoque ou uso interno: marque **Compra avulsa (sem venda)** com motivo.

> **Dica:** se o fornecedor não existe, clique em **Cadastrar fornecedor** ali mesmo — o cadastro já vem com o CNPJ.

## Como o pedido de compra se compara ao máximo da RC

A RC que vem do CRM traz o **custo máximo** de cada item (o orçado na CP). No pedido de compra, cada item ligado a uma RC mostra:

- **▲ X% acima do máximo da RC (máx R$ …)** em vermelho, se o valor (unitário menos o desconto) passou do máximo;
- **▼ redução de R$ … (X%) vs máximo da RC** em verde, se ficou abaixo;
- **= máximo da RC** se ficou igual.

Logo abaixo dos totais aparece **vs RC**: o máximo dos itens ligados, o valor deste pedido e a **redução** (ou quanto ficou **acima**). Quando a RC fica **atendida integralmente** (todos os itens e quantidades, somando este pedido e os anteriores), aparece também o total da RC comparado ao total comprado.

Se algum item estiver acima do máximo, o painel **Pronto para salvar?** avisa e pede um **motivo** — sem ele o pedido não salva. O motivo vai para a observação interna e o cartão do pedido em Compras ganha o selo **▲ acima do máximo da RC**, para quem aprova ver.

## Como faço para enviar o pedido ao fornecedor por e-mail e conversar com ele

1. Abra o pedido (aprovado) e clique em **Imprimir / PDF / enviar ao fornecedor** → enviar por e-mail.
2. O **Para** vem do cadastro do fornecedor. Fornecedor sem e-mail? Clique em **cadastrar ↗** (ou **editar e-mails no cadastro ↗**): o cadastro abre **por cima**, você salva e volta ao envio com o e-mail novo. Na folha do pedido, ao lado do CNPJ, **abrir cadastro ↗** faz o mesmo.
3. Todo e-mail sai de **compras@waterworks.com.br** com **cópia oculta automática para o compras@ e para você** — a conversa fica também no seu Gmail.
4. A aba **E-mails** do pedido mostra a conversa inteira: o envio do PDF, as respostas do fornecedor (com anexos) e as suas respostas. Para responder, escreva embaixo e clique **Enviar** — sai na mesma conversa (o fornecedor vê como resposta ao e-mail do pedido).
5. Quando o fornecedor responde, quem enviou o pedido recebe aviso no Webex e a resposta no Gmail; o cartão do pedido em Compras ganha o selo **✉ N** até alguém abrir a aba E-mails.

> **Modo teste:** enquanto estiver ligado, os e-mails só saem para os endereços de teste (e a cópia do compras@) — o painel avisa no topo do envio.

## NF de entrada (pela Focus)

- As NF-e emitidas contra a empresa chegam sozinhas (**📄 NF chegou pela Focus**) e **casam com o PC** automaticamente.
- NF sem pedido aparece no alerta **⛔ Sem pedido** — **não pague** até resolver: **Casar** com um PC existente, **Gerar pedido** a partir da NF (vai para aprovação) ou **Dispensar** com motivo.

## Recebimento e conferência

1. Quando o material chega, use **📦 Registrar recebimento** (etapa Recebido).
2. Depois de conferir, mova para **Conferido**. A conta a pagar fica **liberada para pagar**.

## Alertas

- O número em **Compras** na barra soma NF sem pedido + requisições novas.
- Uma faixa avisa **PCs criados no Omie depois de 01/10** — os pedidos devem nascer só no painel.

## Perguntas frequentes

**O PC não salva.** Veja se todos os itens têm RC (ou “sem RC” com motivo) e se o pedido tem PV/OS ou está marcado como compra avulsa.

**Posso mandar o PC por e-mail direto daqui?** Ainda não: o envio por e-mail depende da configuração do e-mail compras@. Por enquanto, gere o PDF e envie.

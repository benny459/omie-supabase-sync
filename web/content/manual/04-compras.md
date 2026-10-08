---
titulo: Compras
resumo: Requisição → pedido de compra → aprovação → NF → recebimento → conferência.
icone: 🛒
area: erp
rotas: /erp/compras
caminhos: web/components/compras, web/app/api/compras, web/lib/compras.ts, web/lib/compras-avisos.ts, web/lib/agente-compras.ts, web/app/api/cron/agente-compras
atualizado: 2026-10-08
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

## Aprovação automática pela Aria

Pedidos de compra de **Vendas avulsas** que cumprem a regra abaixo são aprovados sozinhos, sem passar pelo aprovador. Quem aprova fica registrado como **Aria**.

**A regra (todas ao mesmo tempo):**
- PC de **Vendas avulsas** incluído nos **últimos 30 dias** e ainda **pendente** de aprovação;
- valor do PC **menor ou igual ao da RC** que ele atende — PC feito no painel compara item a item com a RC ligada; PC antigo do Omie compara o total da venda (o mesmo selo "Compra abaixo do RC" da tela);
- condição de pagamento **faturada**: prazo depois da NF — "Para N dias" (N ≥ 1) ou parcelas como "28/56/84", "30/60/90". Nunca "A Vista", "A Vista/30", "N Parcelas" sem prazo;
- se o projeto tem fluxo de caixa, o fluxo precisa estar aprovado.

**Quando roda:** sozinho às **08h, 12h e 17h** (horário de Brasília). Cada rodada só mexe no que continua pendente — nunca reaprova nem desfaz decisão de ninguém.

**Onde ver:**
1. Em **Compras**, botão **🤖 Aprovação automática**: lista dos PCs pendentes com a decisão de cada um (elegível ou o motivo de não ser) e as últimas aprovações do agente. Administrador pode clicar em **Aprovar agora**.
2. No PC aprovado: "Aprovado · por Aria" e, no histórico, "Aprovado automaticamente pela Aria — PC R$ X ≤ RC R$ Y · condição faturada …".
3. No Webex, canal **Pedidos Aprovados!**: o cartão de sempre, com "Aprovado por: Aria (aprovação automática)".
4. No **Cesar** (assistente do painel): peça "simule a aprovação automática" ou "aprove os PCs elegíveis".

## Como faço para enviar o pedido ao fornecedor por e-mail e conversar com ele

1. Abra o pedido (aprovado) e clique em **Imprimir / PDF / enviar ao fornecedor** → enviar por e-mail.
2. O **Para** vem do cadastro do fornecedor. Fornecedor sem e-mail? Clique em **cadastrar ↗** (ou **editar e-mails no cadastro ↗**): o cadastro abre **por cima**, você salva e volta ao envio com o e-mail novo. Na folha do pedido, ao lado do CNPJ, **abrir cadastro ↗** faz o mesmo.
3. Todo e-mail sai de **compras@waterworks.com.br** com **cópia oculta automática para o compras@ e para você** — a conversa fica também no seu Gmail.
4. A aba **E-mails** do pedido mostra a conversa inteira: o envio do PDF, as respostas do fornecedor (com anexos) e as suas respostas. Para responder, escreva embaixo e clique **Enviar** — sai na mesma conversa (o fornecedor vê como resposta ao e-mail do pedido).
5. Quando o fornecedor responde, quem enviou o pedido recebe aviso no Webex e a resposta no Gmail; o cartão do pedido em Compras ganha o selo **✉ N** até alguém abrir a aba E-mails.

6. Depois do envio o pedido ganha o selo **✉ Enviado** (no cartão do kanban, no topo da folha do pedido e na coluna "Enviado ao fornecedor" da Tabela). Passe o mouse para ver quando, por quem, para quem e por qual caminho. O mesmo selo aparece quando você usa **Marcar como enviado** (WhatsApp, em mãos…). Fica registrado também no histórico do pedido.
7. Pedido aprovado que ainda não foi ao fornecedor mostra **não enviado**. O filtro **✉ Não enviados** (na barra de filtros) lista só esses.

> **Modo teste:** se a trava de teste estiver ligada, nada é bloqueado — o painel **redireciona**: quem estiver no Para/Cc/Cco e não for endereço de teste é trocado pelo endereço de teste. O assunto começa com **[TESTE → era para: …]** e uma faixa amarela no e-mail mostra para quem iria. O pedido fica com **✉ Enviado (teste)**. O aviso azul no topo do envio mostra a troca antes de enviar.

## NF de entrada (pela Focus)

- As NF-e emitidas contra a empresa chegam sozinhas (**📄 NF chegou pela Focus**) e **casam com o PC** automaticamente.
- NF sem pedido aparece no alerta **⛔ Sem pedido** — **não pague** até resolver: **Casar** com um PC existente, **Gerar pedido** a partir da NF (vai para aprovação) ou **Dispensar** com motivo.

## Recebimento e conferência

1. Quando o material chega, use **📦 Registrar recebimento** (etapa Recebido).
2. Depois de conferir, mova para **Conferido**. A conta a pagar fica **liberada para pagar**.

## Corrigir um pedido que veio do Omie

Os pedidos e requisições que vieram do Omie (selo **Veio do Omie**) se editam aqui como qualquer outro: fornecedor, condição, previsão, itens, parcelas, departamentos e vínculos com RC e PV/OS.

1. Abra o pedido e altere o que precisar.
2. Clique em **Salvar**. O pedido ganha o selo **editado no painel** e o histórico registra o **antes** e o **depois** (fornecedor, valor, previsão e número de itens).
3. Nada é gravado no Omie. A partir dessa edição, a importação do Omie **não sobrescreve mais** este pedido.

O novo valor passa a valer em Operação (Vendas avulsas / Projetos), na fila de aprovação, no BI e no Contas a Pagar previsto. Se o Omie já tiver um título com a mesma NF, a previsão do painel fica como "substituída" e não duplica. A aprovação segue a mesma regra dos pedidos do painel: editar não muda o status de aprovação.


- O número em **Compras** na barra soma NF sem pedido + requisições novas.
- Uma faixa avisa **PCs criados no Omie depois de 01/10** — os pedidos devem nascer só no painel.

## Pedidos criados pelo agente de compras (projetos)

Na **Lista de materiais** de um projeto (etapa ③ Planejamento), o **✨ Agente de compras** junta os itens do mesmo fornecedor em lotes, cada um com a data certa de pedir. Um lote **agendado** vira pedido de compra sozinho no dia, às 07:00, pelo mesmo caminho do “Gerar pedido de compra” da lista: fornecedor do cadastro, a última categoria e condição usadas com ele, e previsão = o primeiro “necessário em”. O pedido entra **aguardando aprovação** e aparece aqui e em **Aprovações PC**, como qualquer outro. Avisos pelo Webex:
- no dia, a lista dos PCs criados;
- na véspera, um lembrete;
- quando o agente não consegue gerar (fornecedor não achado com o mesmo nome no cadastro, ou sem categoria usada antes), avisa em vez de gerar;
- lote que passou 2 dias da data sem ninguém agir vai para o administrador.

**Prazos por fornecedor** (⏱, na mesma etapa): o prazo de entrega usado no planejamento. Vazio = vale o histórico, a média entre o pedido e a NF de entrada.

## Perguntas frequentes

**O PC não salva.** Veja se todos os itens têm RC (ou “sem RC” com motivo) e se o pedido tem PV/OS ou está marcado como compra avulsa.

**Posso mandar o PC por e-mail direto daqui?** Ainda não: o envio por e-mail depende da configuração do e-mail compras@. Por enquanto, gere o PDF e envie.

## Como faço um pagamento antecipado de um pedido de compra

Quando o fornecedor exige pagamento antes da entrega:

1. No cartão do PC aprovado, abra o menu **⋮ → 💸 Pagamento antecipado…** (ou, dentro do pedido, **💸 Pagamento antecipado** em Ações; ou no Contas a Pagar, **💸 Antecipar PC** e digite o número).
2. Confira o **valor** (vem o saldo do PC; use **50%** ou digite um valor para adiantamento parcial) e a **data do pagamento** (próximo dia útil).
3. Escolha **Pix** ou **TED / depósito** — a chave Pix ou banco/agência/conta vêm do cadastro do fornecedor; se mudar, marque **guardar no cadastro** para o arquivo C6 já sair certo.
4. Escolha a **conta corrente pagadora** e clique em **Lançar pagamento antecipado**.

O que acontece:
- Nasce um título no **Contas a Pagar** com o nº **PC 7356-ANT**, ligado ao pedido — entra no **arquivo C6**, no BI e no fluxo de caixa.
- O histórico do PC registra o adiantamento, e o cartão ganha o selo **💸 Antecipado · a pagar**, que vira **💸 Antecipado · pago** quando o título é baixado/conciliado (nada a fazer à parte).
- **Não paga duas vezes:** quando a NF do pedido chega, as parcelas a pagar do PC descontam o que já foi adiantado — a parcela coberta inteira sai do Contas a Pagar; a parcial fica só com o saldo (total − adiantado). Se o título antecipado for excluído, as parcelas voltam ao valor cheio.

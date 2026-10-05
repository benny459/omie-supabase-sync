---
titulo: CRM
resumo: Proposta ganha → PV/OS, requisição de compra e projeto, sem passar pelo Omie.
icone: 🤝
rotas: /crm
caminhos: web/app/api/crm, web/app/api/vendas/crm, web/app/api/catalogo/crm, web/app/api/compras/rc
atualizado: 2026-10-05
---

O CRM abre pela aba **CRM** da barra (dentro do portal). Aqui está o que mudou no caminho **proposta → pedido → compra**.

## Composição de preços (CP) com os nossos códigos

1. Na CP da proposta, busque a peça pelo **código novo**, pelo **código antigo do Omie** ou pela descrição.
2. O sistema mostra o **código atual**, o **custo médio (CMC)**, a **última compra** (fornecedor e data) e o **preço máximo** do item, se houver.
3. Se o custo digitado passar do preço máximo, aparece um alerta na linha.

> **Dica:** propostas antigas mostram o código de hoje automaticamente, mesmo que tenham sido feitas com o código do Omie.

## Como faço para criar o PV/OS de uma proposta ganha

1. Abra a proposta e clique para **criar o PV/OS**.
2. Confira os **itens**: dá para **trocar, adicionar e remover** itens (por exemplo, trocar 3 itens por um kit). O botão de criar só libera quando o **total fecha com o valor da proposta** — use **ajustar ao valor** se precisar.
3. Escolha **onde o pedido nasce no painel**: **Avulsos** (padrão) ou **Projeto**. Propostas de projeto (OPJ) já abrem em Projeto e só emitem com um projeto escolhido.
4. Se o projeto ainda não existe, clique em **+ Novo projeto** (veja abaixo).
5. Confira a **prévia da requisição de compra (RC)**: número previsto, itens, fornecedor sugerido e custo. Dá para editar antes de criar.
6. Confirme. O PV/OS e a RC aparecem na hora em **Operação → Avulsos** e em **Faturamento**.

> **Atenção:** enquanto a chave **“CRM cria PV/OS: no painel”** (em Operação → Pedidos · PV/OS) estiver desligada, o PV/OS ainda é criado no Omie. Com ela ligada, nasce no painel com a numeração seguinte.

## + Novo projeto

1. Ao lado do campo **Projeto**, clique em **+ Novo projeto**.
2. A janela já vem preenchida com o **cliente da proposta**, o **valor**, o **responsável** e o **próximo código livre** (PJ… para projeto, CT… para contrato).
3. Salve. O projeto é criado no cadastro central, **já fica selecionado** e você continua de onde parou.

> **Atenção:** se já existir um projeto com nome parecido para o mesmo cliente, aparece **“Já existe — usar este”**, para não duplicar.

## Perguntas frequentes

**O item não tem fornecedor nem preço máximo na prévia da RC.** É normal quando a peça nunca foi comprada por um PC no painel ou quando ninguém cadastrou o preço máximo (em Estoque, na ficha do item).

**Posso criar a RC sem código de item?** Pode. A linha entra como **item novo** e o comprador completa em Compras.

> **Atenção:** ao criar o PV/OS pelo CRM, **projeto** e **categoria de receita** são obrigatórios — sem eles o pedido não é criado. A **forma de recebimento** e a **condição** escolhidas seguem para o Faturamento do painel.

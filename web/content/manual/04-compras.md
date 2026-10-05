---
titulo: Compras
resumo: Requisição → pedido de compra → aprovação → NF → recebimento → conferência.
icone: 🛒
area: erp
rotas: /erp/compras
caminhos: web/components/compras, web/app/api/compras, web/lib/compras.ts, web/lib/compras-avisos.ts
atualizado: 2026-10-05
---

A tela **Compras** mostra o caminho de cada compra em **Kanban** (ou **Tabela**): **Requisição → Pedido de compra (pendente / aprovado) → Faturado → Recebido → Conferido**.

## Como faço para gerar um pedido de compra (PC) a partir da requisição (RC)

1. Na coluna **Requisição**, abra a RC (as novas aparecem marcadas como **nova**).
2. Clique em **→ Gerar Pedido de Compra** (ou, num PC, em **⇠ Puxar itens de requisição**).
3. Escolha o **fornecedor** e confira quantidades, valores, frete e parcelas.
4. Clique em **⏳ Salvar e solicitar aprovação**.
5. Depois de aprovado, use **🖨 Imprimir / PDF / enviar ao fornecedor**.

> **Atenção:** todo PC precisa estar ligado a uma **requisição** e a um **PV/OS**. Sem RC, só marcando “Pedido sem RC” com motivo (vai para aprovação). Compra para estoque ou uso interno: marque **Compra avulsa (sem venda)** com motivo.

> **Dica:** se o fornecedor não existe, clique em **Cadastrar fornecedor** ali mesmo — o cadastro já vem com o CNPJ.

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

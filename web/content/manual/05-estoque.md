---
titulo: Estoque
resumo: Itens, catálogo, movimentação, separação por projeto, inventário e duplicidades.
icone: 📦
area: erp
rotas: /estoque
caminhos: web/components/navy/estoque, web/components/navy/tela/TelaEstoqueNavy.tsx, web/app/(app)/estoque, web/app/api/estoque
atualizado: 2026-10-05
---

## Itens e ficha do item

- **Estoque → Itens** lista os itens com saldo, custo médio (CMC) e foto. A coluna de saldo mostra **“disp. X · sep. Y”** quando há material separado para projetos.
- Na **ficha do item**: códigos (novo e antigo do Omie), família, fornecedores, histórico de compras, onde está separado e o **Preço máximo de compra**.

> **Dica:** o **Preço máximo de compra** é usado no CRM e em Compras para avisar quando um custo passa do limite. Preencha nos itens mais comprados.

## Movimentação

Em **Estoque → Movimentação**, lance entradas, saídas, transferências e ajustes, informando cliente, projeto e solicitante.

## Como faço para separar material para um projeto (em lote)

1. Vá em **Estoque → Movimentação → + Separar material** (“Separação de material para projeto”).
2. Busque o **projeto** pelo código (ex.: PJ364) ou nome e informe **quem pediu**.
3. A tela traz os itens das RCs/PCs do projeto com **Necessário, Já separado e Disponível**. A quantidade vem sugerida — ajuste se precisar, ou **Colar do Excel** (código;qtd).
4. Itens em falta aparecem destacados; use **Abrir Compras (RC) ↗** para pedir.
5. **Confirmar**. Sai um lote só, com registro de quem e quando — dá para **Desfazer lote**.

Depois, na aba **Materiais separados** do projeto: **Devolver** (volta ao disponível) ou **Consumir** (baixa e lança o custo no projeto), por linha ou em lote.

> **Atenção:** separar não muda o saldo total — só tira do **disponível** para os outros.

## Inventário e duplicidades

- **Inventário**: contagem com janela própria; os ajustes são feitos só no painel.
- **Duplicidades**: itens repetidos para **mesclar** (o custo médio é recalculado e o histórico de códigos fica guardado).

## Perguntas frequentes

**O projeto não aparece na separação.** Use **+ Criar projeto** na própria busca, ou cadastre em Cadastros → Projetos.

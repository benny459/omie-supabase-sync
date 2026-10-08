---
titulo: Estoque
resumo: Itens, catálogo, movimentação, separação por projeto, inventário e duplicidades.
icone: 📦
area: erp
rotas: /estoque
caminhos: web/components/navy/estoque, web/components/navy/tela/TelaEstoqueNavy.tsx, web/app/(app)/estoque, web/app/api/estoque
atualizado: 2026-10-08
---

## Itens e ficha do item

- **Estoque → Itens** lista os itens com saldo, custo médio (CMC) e foto. A coluna de saldo mostra **“disp. X · sep. Y”** quando há material separado para projetos.
- Na **ficha do item**: códigos (novo e antigo do Omie), família, fornecedores, histórico de compras, onde está separado e o **Preço máximo de compra**.

> **Dica:** o **Preço máximo de compra** é usado no CRM e em Compras para avisar quando um custo passa do limite. Preencha nos itens mais comprados.

## Movimentação

![Vídeo: movimentação de estoque](/manual-video/estoque-movimentacao.mp4)

*Vídeo (3 min): entradas e saídas por nota, como lançar uma movimentação, separação para projeto, Kardex do item e ajuste de inventário.*

Em **Estoque → Movimentação** fica tudo o que entrou e saiu, dia a dia. O filtro escolhe **NF do Omie + internas**, **Só NF do Omie (automáticas)** ou **Só internas (lançadas aqui)**.

- **Entradas e saídas por nota** entram sozinhas (hoje vêm do Omie): nota de compra dá entrada; venda e remessa dão saída.
- **+ Nova movimentação** lança o que não tem nota, um ou vários itens de uma vez. Tipos: **Saída para obra/projeto**, **Retorno de obra**, **Transferência entre locais**, **Consumo interno**, **Perda / avaria / descarte** (fica aguardando aprovação do administrador) e **Devolução ao fornecedor** (exige o PC). Obrigatórios: quem pediu, justificativa e, na saída/retorno de obra, cliente ou projeto (o **PV / OS** preenche os dois). O saldo muda na hora, ao custo médio atual (o CMC não muda); falta de saldo só gera aviso. Errou? O administrador **cancela** o lançamento e o saldo volta.
- **Ficha do item › Movimentação**: o que foi lançado no painel, o gráfico do saldo ao longo do tempo e o Kardex (**Exportar Kardex**).
- **Contagem diferente do sistema**: ajuste pelo inventário — com a senha de inventário, **Ajustar saldo** na ficha (contagem + motivo; o painel lança a diferença).

## Como faço para separar material para um projeto (em lote)

1. Vá em **Estoque → Movimentação → Separar p/ projeto** (“Separação de material para projeto”) — ou, no projeto, aba **Materiais separados › + Separar material**.
2. Busque o **projeto** pelo código (ex.: PJ364) ou nome e informe **quem pediu**.
3. A tela traz os itens das RCs/PCs do projeto com **Necessário, Já separado e Disponível**. A quantidade vem sugerida — ajuste se precisar, ou **Colar do Excel** (código;qtd).
4. Itens em falta aparecem destacados; use **Abrir Compras (RC) ↗** para pedir.
5. **Confirmar**. Sai um lote só, com registro de quem e quando — dá para **Desfazer lote**.

Depois, na aba **Materiais separados** do projeto: **Devolver** (volta ao disponível) ou **Consumir** (baixa e lança o custo no projeto), por linha ou em lote.

> **Atenção:** separar não muda o saldo total — só tira do **disponível** para os outros.

## Inventário e duplicidades

- **Inventário**: contagem com janela própria; os ajustes são feitos só no painel.
- **Duplicidades**: itens repetidos para **mesclar** (o custo médio é recalculado e o histórico de códigos fica guardado).

## Como faço para acertar os códigos de compra (peça comprada que não é item nosso)

Peça comprada pelo Omie com código do fornecedor (ex.: `3019075`) e que nunca virou item do estoque **não entra em nota que movimenta estoque** (remessa, conserto, devolução, venda de produto). Para acertar:

1. Abra **Estoque › Códigos de compra**. A lista mostra os códigos comprados nos últimos 12 meses sem item nosso, com até 3 sugestões parecidas.
2. Se a sugestão for a mesma peça, clique em **vincular** ao lado dela. Para vários de uma vez, use **Vincular … muito parecidos (≥ 90%)**.
3. Se não houver item nosso, clique em **Acertar…** › **Cadastrar no estoque**: a família vem sugerida e a descrição, NCM, unidade e último preço já vêm preenchidos. O item ganha o próximo código da família.
4. Errou? Na aba **Vinculados**, clique em **desfazer**.

> **Atenção:** item cadastrado assim nasce com saldo 0 (a tela mostra quanto foi comprado). Registre o saldo conferido em **Estoque › Inventário**.

## Serviços no catálogo (família SV)

Os serviços (mão de obra, projeto, startup…) também têm código nosso: família **SV · Serviços**, marcada como **não-material** — aparecem no catálogo e na busca, mas **não movimentam estoque** nem pedem inventário. Cada um está ligado ao serviço do cadastro (LC116, código municipal) e ao código antigo do Omie, então notas e OS antigas resolvem sozinhas para o SV. Serviço novo criado pelo CRM ou pelo cadastro já nasce com o seu SV.

## Como faço para corrigir o NCM de uma peça

1. Em **Estoque**, use o filtro **Mais filtros › Sem NCM válido** para ver as peças sem NCM (ou com NCM que não existe mais na tabela oficial).
2. Abra a peça. Ao lado da unidade aparece **sem NCM — localizar** (ou o NCM atual com **trocar**).
3. Escolha uma sugestão ou busque por código/palavras, e clique. O NCM fica salvo no cadastro da peça e passa a sair nas notas.

> **Dica:** a tabela NCM é a oficial da Receita (Siscomex) e se atualiza sozinha todo dia 1º.

## Perguntas frequentes

**O projeto não aparece na separação.** Use **+ Criar projeto** na própria busca, ou cadastre em Cadastros → Projetos.

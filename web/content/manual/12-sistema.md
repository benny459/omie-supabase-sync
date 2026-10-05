---
titulo: Sistema (acessos)
resumo: Quem entra em quê — perfis, permissões e auditoria.
icone: ⚙️
rotas: /configuracoes
caminhos: web/app/(app)/configuracoes, web/components/UsuariosAcessos.tsx, web/lib/permissions.ts, web/lib/acessos-catalogo.ts
atualizado: 2026-10-05
---

## Onde fica

- No **portal**: engrenagem → **Sistema → Perfis e Permissões** (Geral, Painel, CRM Legado, Serviços, RH, Auditoria).
- No **painel**: engrenagem → **Usuários e acessos**.

## Como faço para dar acesso a uma pessoa nova

O convite por e-mail pode não chegar (o envio de e-mail do sistema é limitado). O caminho recomendado é a **senha provisória**:

1. No portal, abra **Sistema → Usuários**.
2. Clique em **+ Criar acesso com senha provisória**.
3. Preencha **e-mail**, **nome** e **papel** (normalmente *member*) e clique em **Gerar acesso**.
4. Aparece o **Cartão de acesso ALLKA** com o endereço, o e-mail e a senha provisória.
5. Clique em **Copiar texto** (para WhatsApp ou e-mail) ou em **Imprimir / salvar PDF** e envie à pessoa.
6. Libere o que ela pode ver em **Sistema → Perfis e Permissões** (aba Geral e aba Painel).

> **Atenção:** a senha provisória aparece **uma única vez**. Se fechar o cartão sem copiar, gere outra.

No primeiro acesso, a pessoa entra em **allka.ai** com o e-mail e a senha provisória e é levada à tela **Crie a sua senha**. Só depois disso entra no sistema.

Se o e-mail já tiver acesso, o sistema avisa e oferece **Gerar nova senha provisória** (serve também para quem esqueceu a senha).

## Como faço para liberar um módulo para alguém

1. Abra **Perfis e Permissões → Geral**.
2. Ache a pessoa e clique na célula do módulo (Portal, Operação, Compras, Estoque, Financeiro, BI, CRM, Serviços, RH).
3. Escolha liberar ou bloquear. Para o detalhe de cada app (telas e ações), use a aba do app.

> **Atenção:** só administradores mudam acessos. Toda mudança fica na **Auditoria**.

## Permissões finas do painel

Exemplos: ver valores de compra, aprovar PC, ver contas a pagar/receber, **baixar/estornar título**, **conciliação bancária**, lançar título, separar material para projeto. Cada uma pode ser ligada por pessoa.

## Perguntas frequentes

**A pessoa não consegue entrar no portal.** Confira se ela está liberada em **Portal** na aba Geral.

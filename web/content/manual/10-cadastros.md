---
titulo: Cadastros
resumo: Um cadastro só para todas as plataformas — sem duplicados.
icone: 🗂️
area: erp
rotas: /cadastros
caminhos: web/components/cadastros, web/app/(app)/cadastros, web/app/api/cadastros, web/lib/cadastros-server.ts
atualizado: 2026-10-09
---

Tudo o que era cadastrado no Omie agora é cadastrado aqui e vale para o painel, o CRM e os Serviços.

| Grupo | Cadastros |
|---|---|
| Pessoas | Clientes, Fornecedores, Transportadoras, Vendedores, Duplicidades |
| Itens | Itens (catálogo), Unidades de medida, Serviços (LC 116) |
| Projetos e vendas | Projetos, Condições de pagamento |
| Financeiro | Bancos e contas, Categorias, Centros de custo, Tipos de documento |
| Geral | Empresas do grupo, Feriados (dias úteis), Grupos de equipamento |

## Como faço para cadastrar um cliente ou fornecedor

1. Em **Cadastros → Clientes** (ou Fornecedores), clique em **+ Novo**.
2. Digite o **CNPJ** e use **Buscar na Receita** para preencher; o CEP completa o endereço.
3. Se o CNPJ ou um nome muito parecido já existir, aparece **“já existe — abrir este”**. Use o existente.
4. Salve.

**Vários e-mails no mesmo campo:** E-mail, E-mail de cobrança e E-mail para NF-e aceitam mais de um endereço, separados por vírgula ou ponto e vírgula. Exemplo: `operacional@hospital.com.br, financeiro@hospital.com.br`. Cada endereço é conferido; o aviso **E-mail inválido** só aparece se algum deles estiver errado.

> **Atenção:** **não é possível duplicar** um cadastro (mesmo CNPJ/CPF ou nome muito parecido). Só um administrador pode forçar, com motivo.

## Ficha completa (360°)

Clique num cliente ou fornecedor para ver tudo dele, somando SF, CD e WW:

- **Financeiro**: a receber e a pagar (aberto, vencido, pago/recebido) e o extrato dos pagamentos.
- **Comercial**: propostas do CRM, PV/OS e margem.
- **Faturamento**: notas emitidas.
- **Compras** (fornecedor): pedidos, NFs de entrada, **quanto gastei**, itens comprados.
- **Serviços** (cliente): unidades, OS e chamados.
- **Cadastro**: dados, empresas e histórico de alterações.

## Duplicidades

Em **Cadastros → Duplicidades**:

- **Muito provável**: mesmo telefone, e-mail ou endereço, ou um dos dois nunca usado. **Mesclar todos os prováveis** mostra uma prévia antes.
- **Duvidoso**: confira um a um — **Mesclar** ou **Não é duplicado**.
- **Empresas diferentes**: a mesma empresa na SF, CD e WW — **Agrupar**.
- Tudo pode ser desfeito (**Desfazer este lote**).

## Projetos, contas e demais cadastros

- **Projetos**: o próximo código livre (PJ… / CT…) aparece sozinho. Também dá para criar com **+ Novo projeto** direto no PV/OS, na emissão e no PC.
- **Bancos e contas**: banco, agência, conta, **chave Pix** e beneficiário (usados nos recibos, na NF-e e no arquivo C6).
- **Serviços**: ao salvar um serviço novo, ele ganha sozinho o código **SV00xx** e passa a aparecer na escolha de itens da OS (antes só o CRM gerava o código). Para visitas avulsas use **SV0036 VISITA TECNICA** — também existem SV0029 (emergencial), SV0030 (avaliação do sistema) e SV0031 (manutenção corretiva).
- **Feriados**: usados para levar a previsão de pagar/receber ao próximo dia útil.
- **Grupos de equipamento**: nomes padrão dos grupos da lista de materiais do projeto (“Filtro Multimeios”, “Osmose Reversa”, “Geral”…). A lista aceita texto livre, mas sugere estes nomes e oferece **≈ Nome** quando um grupo é quase igual a um padrão. A tela também mostra os nomes já usados nos projetos, para cadastrar com um clique.

## Perguntas frequentes

**Criei um cliente no Omie e não aparece.** O Omie não é mais usado para cadastros — cadastre aqui.

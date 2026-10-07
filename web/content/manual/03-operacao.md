---
titulo: Operação
resumo: Avulsos, projetos, PCs e pedidos de venda — o dia a dia da operação.
icone: 📋
area: operacao
rotas: /avulsos, /projetos, /pcs, /erp/vendas
caminhos: web/components/BoldAvulsosView.tsx, web/components/projeto, web/components/operacao, web/app/(app)/avulsos, web/app/(app)/projetos, web/app/(app)/pcs, web/app/(app)/erp/vendas, web/components/vendas
atualizado: 2026-10-07
---

## Avulsos

A lista de **pedidos de venda (PV/OS)** com as compras ligadas a cada um.

- Cada pedido mostra a **barra da cadeia**: Requisição → Pedido de compra → Aprovação → Recebido → Conferido → **Pago** → Faturado → **Recebido**.
- A coluna **M.B.** é a margem bruta (venda menos compras ligadas).
- Use as abas **Em aberto / Faturados / Todos**, a busca e os filtros rápidos (Pode faturar, Venda em atraso, Compra em atraso, Minha aprovação, Sem PC, etc.).
- Alterne a visão entre **Lista, Tabela, Kanban e Linha do tempo**.

### Período e ordem da lista

- **Entrou 7 dias / Entrou 30 dias**: pedidos **emitidos** (que entraram no painel) nos últimos 7 ou 30 dias — a data que aparece como "emitido" na linha. Um PV criado hoje aparece em "Entrou 7 dias".
- **Vence em 7 dias**: prazo limite nos próximos 7 dias. **Vencidos**: prazo limite já passou.
- Por padrão a lista vem do **mais novo para o mais antigo** (data de emissão).
- **Clique no nome da coluna para reordenar, como no Excel**: Pedido, emissão, Cliente, Etapas (quanto da cadeia já andou), Prazo, Serviço e, no bloco de valores, **RC**, **PC**, **PV** ou **M.B.** separadamente. Clique de novo para inverter (↑ crescente · ↓ decrescente). A ordem escolhida fica gravada para a próxima vez e entra em **Salvar visão atual**.
- Na vista **Tabela**, clique no cabeçalho de qualquer coluna para ordenar as linhas; o 3º clique volta à ordem da lista.

### Como faço para gerar o pedido de compra direto da linha (atalho)

1. Abra o PV/OS (clique na linha) para ver a **RC** e os itens.
2. Na coluna PC, clique em **+ Gerar pedido de compra**. Sem nada marcado, entram todos os itens da RC que ainda não têm PC; para escolher só alguns, marque as linhas antes (o botão mostra quantos).
3. A folha abre já preenchida da RC: itens, quantidade que ainda falta atender, valor, **fornecedor sugerido**, projeto e PV/OS. O fornecedor vem, nesta ordem: o da RC → o "Fornecedor sugerido" nos itens da RC → quem mais vendeu esses itens (histórico de compras); embaixo do campo aparece de onde veio a sugestão. A última categoria e condição usadas com ele entram sozinhas.
   - Em cada item: o selo **▲ acima / ▼ redução / = máximo da RC** (o valor da RC é o custo máximo) e o que **esse fornecedor** já cobrou pelo item — último preço e data (com o nº do PC), mínimo, média e quantas compras. **histórico (N)** abre todas as compras do item (as deste fornecedor em destaque). Trocou o fornecedor? Os preços mudam na hora. Confira o fornecedor, a **categoria**, a **condição** e a **previsão de entrega**; dá para desmarcar itens e mudar quantidade (parcial) e valor.
4. **Criar pedido de compra** grava o PC em Compras, ligado à RC e ao PV/OS — mesma numeração e mesma aprovação de sempre. O nº do PC aparece na linha logo em seguida.
5. Precisa de **mais de um pedido** (outro fornecedor, entrega separada)? Os itens que ficaram de fora — ou a quantidade que faltou — continuam disponíveis: clique de novo em **+ Gerar pedido de compra**.

- Os números **RC 7346** e o nº do **PC** na linha são links: clique para abrir a requisição ou o pedido direto em **Compras** (Cmd/clique do meio abre em outra aba).
- O PC feito no painel aparece na linha com **fornecedor, valor, previsão, etapa e NF** (antes só os PCs vindos do Omie mostravam esses dados). Aprovado ou não aprovado em Compras, a linha acompanha.
- Se a RC mudar de PV/OS (ex.: venda PV+OS em que a RC foi parar na OS), as linhas mudam de pedido sozinhas.
- **↗ OPS…** ao lado da etapa: a **proposta do CRM** que gerou o PV/OS. Clique para abri-la no CRM do portal.

> Departamentos, frete e conta corrente podem ser completados depois, abrindo o pedido em **Compras**. Para ligar um PC que já existe, digite o nº no campo **nº PC**.

### Serviço (vendas Mix e de serviço)

- O cartão **Serviço** vem do app de serviços. **Aguardando OS** quer dizer que a venda tem serviço previsto (vendedor Mix ou Serviços) e já está no **Painel de Vendas** do app de serviços, mas a OS ainda não foi gerada — o atalho **gerar OS ↗** abre esse painel.
- Quando a OS é criada a partir da venda no app de serviços, o nº da OS, o status e a previsão aparecem aqui sozinhos.

## Projetos

1. Abra **Operação → Projetos** e clique no projeto.
2. A página do projeto tem o plano (CP/MC), a lista de materiais e a aba **Materiais separados**.
3. Na lista de projetos, um selo mostra **“N itens separados · R$ · x% da lista”** quando já há material separado — clique para ir direto à aba.

### Lista de materiais, compras e budget do projeto

Tudo fica numa aba só: **Lista de materiais** (a antiga aba “Compras × lista” entrou nela; o atalho **🧾 Materiais × compras** da linha do projeto abre esta aba).

**No topo**: **Estimado da lista**, **Budget de materiais** (do CP/MC do CRM ou **editar**), **Comprometido (PCs)**, **Pago**, **Projetado × budget** (sobra/estoura) e a **Margem** contra a do fechamento. O estimado de cada linha é o **Valor unit.** da linha; vazio, o sistema preenche com o preço do **PC**, senão o **último preço do catálogo**, senão o **custo da CP** (a célula mostra de onde veio: “do PC”, “catálogo”, “da CP”).

**Montar a lista** (**Minha lista**):
1. Digite o item: o catálogo sugere primeiro os **itens do nosso estoque** (código novo, como no Faturamento) com **último preço pago, fornecedor e prazos**; código de compra já vinculado aparece como “cód. compra X”. Linha antiga com código do Omie que já tem item nosso passa a mostrar o código novo.
2. A coluna **Código** mostra o código do **nosso estoque** (nunca o do Omie). Sem item casado, a célula fica **âmbar** (“sem código” ou “Omie X”): clique em **⌕** para escolher ou criar. Dá para digitar o código (busca na hora) e colar com cabeçalho “Código” — código nosso, antigo ou de compra já ligado resolve a linha direto.
3. A coluna **Catálogo** mostra o item escolhido (✓), o que é para **conferir** (amarelo) e o que está **sem correspondência**. Clique nela para **escolher**: sugestões com % de semelhança, busca por nome/código ou **Criar item nosso** (família e próximo código; serviço → família SV). A escolha fica gravada para aquele texto — da próxima vez casa sozinho.
4. A lista **salva sozinha** alguns segundos depois de cada mudança. Só remover itens pede o botão **Salvar lista** (com confirmação).
5. Para importar do Excel: **Lista RC (Projeto) → 📄 Baixar modelo (.xlsx)**, preencha e suba. Depois, **⚡ Casar com o catálogo** acha os itens que vieram sem código (escolhas feitas à mão não mudam).

**Itens da CP**: a composição de preço da proposta do CRM. Só entra em **Minha lista** o item **casado** (✓ automático ou ✋ escolhido por você) — a caixinha de quem não casou fica travada (“case o item primeiro”). Clique em **No catálogo** para escolher ou criar o item.

**Grupos de equipamento e “Necessário em”**: a faixa **Grupos de equipamento** mostra cada grupo (vem da coluna Equipamento e da CP) com a quantidade de itens e a data **necessário em** do grupo. Definir a data do grupo preenche as linhas dele; uma linha pode ter **data própria** (fica marcada); linha nova do grupo herda a data. **usar dd/mm** aplica a entrega prevista da proposta. **≈ Nome** troca o nome do grupo pelo padrão do cadastro (Cadastros › Grupos de equipamento). Filtros **Todas / Sem PC / Com PC** combinam com o grupo. A data da linha é a que vai para a RC (data limite) e para o fluxo.

**Comprar e acompanhar** (colunas da direita, em azul claro):
- **RC**, **Pedido de compra** (clique abre o PC; fornecedor, previsão ou data/quantidade recebida), **Comprado** (valor da linha do PC; avisa quando a quantidade do PC é diferente da lista), **Situação** (mesmas cores do Compras: Pedido de Compra, Aguardando aprovação, Aprovado, Enviado, Faturado, Recebido, Conferido · NF) e **Vínculo** (nº do PC, código, descrição, manual — **desfazer**).
- Linha ligada só pelo **número do PC** também mostra valor: o sistema acha a linha do item dentro do PC (código, senão descrição).
- Marque as linhas e clique **Gerar RC (N)** — a RC entra em Compras com a venda (PV) do projeto e cada linha fica ligada à lista.
- **⇄ Vincular PCs automaticamente** liga as linhas aos itens dos PCs do projeto (código, depois descrição com as mesmas medidas); **Ver sugestões de vínculo** mostra as parecidas para **Confirmar**.
- Abaixo da lista: **Comprado fora da lista** e o **Fluxo de compras do projeto** mês a mês.

**Cartão “Custo planejado”** (topo do projeto): a barra mostra a composição e a legenda traz o valor de cada parte — materiais, obra e despesas, em R$ e %.

## Pedidos · PV/OS

- **PV** = venda de produtos (sai NF-e). **OS** = serviço (sai recibo ou NFS-e).
- Em **ERP → Vendas** você vê os PV/OS do painel e do Omie. Admins veem a chave **“CRM cria PV/OS: no Omie / no painel”**.
- **Novo PV/OS** pelo painel: precisa estar ligado a uma **proposta do CRM** (busca pelo número, cliente ou título). Só admin pode marcar “sem proposta”, com motivo.

> **Atenção:** a numeração é única e sequencial (próximo PV e próxima OS). Não crie PV/OS no Omie — o número pode repetir.

## Perguntas frequentes

**Não acho um pedido em Avulsos.** Confira a aba (Em aberto/Faturados/Todos) e limpe os filtros rápidos.

**A margem não aparece.** A M.B. só é calculada quando o pedido tem compras (PCs) ligadas.

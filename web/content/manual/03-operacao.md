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
2. As abas seguem a ordem do trabalho: **1 Resumo · 2 Lista de materiais · 3 Materiais separados · 4 Fluxo de caixa**.
3. Na lista de projetos, um selo mostra **“N itens separados · R$ · x% da lista”** quando já há material separado — clique para ir direto à aba.

### Lista de materiais, compras e budget do projeto

Tudo fica numa aba só: **Lista de materiais** (a antiga aba “Compras × lista” entrou nela; o atalho **🧾 Materiais × compras** da linha do projeto abre esta aba).

**No topo**: **Estimado da lista**, **Budget de materiais** (do CP/MC do CRM ou **editar**), **Comprometido (PCs)**, **Pago**, **Projetado × budget** (sobra/estoura) e a **Margem** contra a do fechamento. O estimado de cada linha é o **Valor unit.** da linha; vazio, o sistema preenche com o preço do **PC**, senão o **último preço do catálogo**, senão o **custo da CP** (a célula mostra de onde veio: “do PC”, “catálogo”, “da CP”).

**Montar a lista** (**Minha lista**) — colunas: # · Equipamento · **Código** · Item · Qtd · Un · Necessário em · Observação · Valor unit. · Total, e à direita (fundo azul claro) RC · **PC · situação** · Fornecedor · Comprado. Cada linha ocupa uma linha só (passe o mouse para ver o texto inteiro); ao rolar para o lado, as colunas até o Item ficam presas.
1. Digite o item: o catálogo sugere primeiro os **itens do nosso estoque** (código novo, como no Faturamento) com **último preço pago, fornecedor e prazos**; código de compra já vinculado aparece como “cód. compra X”. Linha antiga com código do Omie que já tem item nosso passa a mostrar o código novo.
2. **Código**: sempre o do nosso estoque (nunca o do Omie). O ícone ao lado diz a situação — **✓** casado, **⚠** conferir, **⌕** sem código (célula âmbar). Clique no ícone para **escolher**: sugestões com %, busca por nome/código ou **Criar item nosso** (família e próximo código; serviço → família SV). A escolha fica gravada para aquele texto — da próxima vez casa sozinho.
3. Casada, a linha mostra no **Item** a descrição do catálogo; o texto original (e o modelo, se houver) aparece ao passar o mouse e volta ao editar.
4. A lista **salva sozinha** alguns segundos depois de cada mudança. Só remover itens pede o botão **Salvar lista** (com confirmação).
5. Colar do Excel sem cabeçalho segue a ordem **Equipamento · Item · Qtd · Un · Necessário em · Observação · Valor unit.**; com a linha de cabeçalho, as colunas vão pelo nome (inclusive **Código, Modelo e PC**). Código nosso, antigo ou de compra já ligado resolve a linha direto. **⚡ Casar com o catálogo** acha o resto (escolhas feitas à mão não mudam).
6. **Valor unit.** vazio é preenchido do PC, do catálogo ou da CP — a origem aparece pequena na célula (PC / cat. / CP).

**Itens da CP**: a composição de preço da proposta do CRM. Só entra em **Minha lista** o item **casado** (✓ automático ou ✋ escolhido por você) — a caixinha de quem não casou fica travada (“case o item primeiro”). Clique em **No catálogo** para escolher ou criar o item.

**Grupos de equipamento e “Necessário em”**: os chips acima da lista filtram por grupo e mostram a data do grupo (“necessário 31/10” ou “sem data”). **📅 Datas por grupo** abre o painel com um grupo por linha: data, quantas linhas têm **data própria**, a sugestão (entrega prevista da proposta) com **aplicar**, **Aplicar a todos os grupos sem data** e **≈ Nome** para usar o nome padrão do cadastro. A data do grupo preenche as linhas dele; linha nova herda. Filtros **Todas / Sem PC / Com PC** combinam com o grupo. A data da linha é a que vai para a RC (data limite) e para o fluxo.

**Comprar e acompanhar**:
- **PC · situação**: o chip do PC (clique abre o pedido) na cor da situação do Compras (Pedido de Compra, Aguardando aprovação, Aprovado, Enviado, Faturado, Recebido, Conferido · NF); a dica traz previsão/recebimento e por onde foi o vínculo; **✕** desfaz vínculo por código, descrição ou manual. Linha sem PC mostra **+ vincular PC**: itens de PC do projeto parecidos com a linha (**Vincular**) ou **Procurar PC por número ou fornecedor**.
- **Fornecedor**: o do PC; sem PC, o sugerido pelo catálogo (em itálico) com entrega/fatura médias. **Comprado**: valor da linha do PC (**≠** quando a quantidade do PC difere da lista).
- Linha ligada só pelo **número do PC** também mostra valor: o sistema acha a linha do item dentro do PC (código, senão descrição).
- Marque as linhas e clique **Gerar RC (N)**; **⇄ Vincular PCs automaticamente** liga as linhas aos PCs do projeto — o que sobrar fica com **+ vincular PC** na própria linha.
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

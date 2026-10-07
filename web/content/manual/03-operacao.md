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

Tudo fica numa aba só: **Lista de materiais** (a antiga aba “Compras × lista” entrou nela). Na linha do projeto, **📂 Abrir projeto** leva até ela.

**No topo**: **Estimado da lista**, **Budget de materiais** (do CP/MC do CRM ou **editar**), **Comprometido (PCs)**, **Pago**, **Projetado × budget** (sobra/estoura) e a **Margem** contra a do fechamento. O estimado de cada linha é o **Valor unit.** da linha; vazio, o sistema preenche com o preço do **PC**, senão o **último preço do catálogo**, senão o **custo da CP** (a célula mostra de onde veio: “do PC”, “catálogo”, “da CP”).

**Resumo do projeto inteiro**: abaixo dos números, uma barra mostra numa escala só o **pago**, o **comprometido** (PCs), o **projetado** (comprometido + o que a lista ainda vai comprar) e a marca do **budget de materiais**; se o projetado passa do budget, aparece o alerta “estoura o budget de materiais em R$ X”. O mesmo projetado aparece no cartão do projeto na lista de Projetos (com o mesmo budget: o definido no painel, senão o do CRM). PCs escondidos (“Excluir PC”) não contam no comprometido nem no fluxo mensal.

**Aprovação dos PCs do projeto (PJ…)**: não depende da alçada da área nem do fluxo aprovado (o fluxo o Benny aprova à parte). Quem tem a permissão de aprovar compras do projeto aprova o PC quando o **projeto inteiro cabe no budget de materiais** (comprometido + este PC ≤ budget). Se estourar, só um administrador aprova — os demais veem “estoura o budget do projeto em R$ X — fica pendente para os administradores”. A Aria não aprova PC de projeto. Projetos-conta do Omie (41_VP, 47_CONTRATUAL…) seguem a regra de sempre.

**Comprar pela lista**: marque as linhas sem PC e clique **🧾 Gerar pedido de compra** — abre uma folha com **um pedido por fornecedor** (o fornecedor sugerido de cada linha agrupa; dá para trocar), com preço, quantidade, categoria, condição e previsão (o “Necessário em” mais cedo do grupo) editáveis. **Simular** confere tudo sem gravar. Os PCs nascem pelo caminho de sempre do Compras (numeração, aprovação, avisos) e cada item já fica ligado à sua linha da lista. **⤵ Importar para a lista** traz os itens da **RC** (a composição de preço da proposta) que ainda não estão na lista, cada um já casado com o nosso catálogo: resolva o ⚠ conferir / sem correspondência em **No catálogo** (sugestões, busca, Criar item nosso), marque o que entra (sem código entra âmbar, para resolver depois; desmarque para pular) e adicione. Se a RC já foi lançada em Compras, os itens vêm ligados a ela. Numa linha, o **RC** na célula do Item usa um item da RC ainda não usado (descrição, qtd, equipamento e custo da RC, passando pelo catálogo). Item digitado ou buscado livremente é **novo**. Para subir a lista inteira de uma planilha (uma aba por equipamento), use **📋 Subir planilha** no canto da aba.

> No projeto, **RC e CP (composição de preço) são a mesma coisa** e o nome usado é **RC**: os itens da RC são os da composição de preço da proposta; o nº mostrado é o do documento em Compras.

**Projetos › pedido aberto**: em cima, o resumo do projeto e os **Itens da RC sem PC** (uma linha por RC, com **+ Gerar pedido de compra**, que abre a Lista de materiais com os itens da RC marcados e o gerador aberto); embaixo, **uma linha por PC** — nº do PC, fornecedor, RC que atende, valor, aprovação, Prev. material, situação (mesmas cores da lista), material, NF de entrada e **☰** para ver os itens daquele PC na Lista de materiais.

**Previsão do material**: é a do PC. Mudar a “Prev. material” na Operação › Projetos grava a previsão do próprio PC quando ele nasceu no painel (com registro no histórico do PC); PC importado do Omie guarda a remarcação, e a folha do PC no Compras mostra “remarcada para dd/mm”.

**Montar a lista** (**Lista**) — colunas: # · **Orig.** (selo **RC** quando a linha veio da RC; vazio = item novo) · Equipamento · **Código** · Item · Qtd · Un · Necessário em · Valor unit. · **Projetado**, e à direita (fundo azul claro) **PC** · **Situação** · Fornecedor · **Comprado (PC)** · **Δ** · **💬**.
- **Projetado** = Qtd × Valor unit. (quanto se espera gastar). **Comprado (PC)** = valor da linha deste item no pedido de compra. **Δ** = Comprado − Projetado: verde abaixo, vermelho acima. **≠** no Comprado avisa que a quantidade do PC é diferente da lista (passe o mouse).
- **💬 Comentários** (substitui a coluna Observação): clique no balão para ver e escrever comentários — cada um guarda quem escreveu e quando; o número no balão é a quantidade. A observação antiga da linha aparece como primeiro comentário. Cada linha ocupa uma linha só (passe o mouse para ver o texto inteiro); ao rolar para o lado, as colunas até o Item ficam presas.
1. Digite o item: o catálogo sugere primeiro os **itens do nosso estoque** (código novo, como no Faturamento) com **último preço pago, fornecedor e prazos**; código de compra já vinculado aparece como “cód. compra X”. Linha antiga com código do Omie que já tem item nosso passa a mostrar o código novo.
2. **Código**: sempre o do nosso estoque (nunca o do Omie). O ícone ao lado diz a situação — **✓** casado, **⚠** conferir, **⌕** sem código (célula âmbar). Clique no ícone para **escolher**: sugestões com %, busca por nome/código ou **Criar item nosso** (família e próximo código; serviço → família SV). A escolha fica gravada para aquele texto — da próxima vez casa sozinho.
3. Casada, a linha mostra no **Item** a descrição do catálogo; o texto original (e o modelo, se houver) aparece ao passar o mouse e volta ao editar.
4. A lista **salva sozinha** alguns segundos depois de cada mudança. Só remover itens pede o botão **Salvar lista** (com confirmação).
5. Colar do Excel sem cabeçalho segue a ordem **Equipamento · Item · Qtd · Un · Necessário em · Valor unit.**; com a linha de cabeçalho, as colunas vão pelo nome (inclusive **Código, Modelo, PC e Observação** — a observação vira comentário). O Exportar Excel junta os comentários na coluna Observação. Código nosso, antigo ou de compra já ligado resolve a linha direto. **⚡ Casar com o catálogo** acha o resto (escolhas feitas à mão não mudam).
6. **Valor unit.** vazio é preenchido do PC, do catálogo ou da RC — a origem aparece pequena na célula (PC / cat. / RC).

**Itens da RC**: só consulta — o registro do plano original (a RC dá a ideia inicial e o budget). Mostra cada item com qtd, custo e total, e se está **na lista** (com o código nosso e a linha) ou **não usado**, e o total do plano × o que está na lista. Os itens entram pela **⤵ Importar para a lista** ou pelo **RC** da linha.

**Chega a tempo?** Ao lado de “Necessário em”, cada linha com data mostra **✓** (recebido ou chega com folga), **⚠** (em risco: chega com menos de 3 dias de folga, PC sem previsão, ou sem PC e o prazo médio do catálogo está apertado) ou **✕** (atrasado: chega depois, ou a data passou sem receber). A dica mostra “chega prev. dd/mm · necessário dd/mm · folga N dias” — sem PC, a chegada é estimada por hoje + prazo médio de entrega. Os filtros **⚠ Em risco** e **✕ Atrasados** ficam junto de Todas / Sem PC / Com PC, e cada grupo mostra quantas linhas estão em risco ou atrasadas (também no painel Datas por grupo).

**Grupos de equipamento e “Necessário em”**: os chips acima da lista filtram por grupo e mostram a data do grupo (“necessário 31/10” ou “sem data”). **📅 Datas por grupo** abre o painel com um grupo por linha: data, quantas linhas têm **data própria**, a sugestão (entrega prevista da proposta) com **aplicar**, **Aplicar a todos os grupos sem data** e **≈ Nome** para usar o nome padrão do cadastro. A data do grupo preenche as linhas dele; linha nova herda. Filtros **Todas / Sem PC / Com PC** combinam com o grupo. A data da linha é a que vai para o pedido de compra (previsão) e para o fluxo.

**Comprar e acompanhar**:
- **PC**: o número do pedido em destaque (clique abre o pedido). Número digitado na lista que não está vinculado aparece como **sug. 6405** (tracejado) — é só sugestão: clique para vincular.
- **Situação ⓘ**: o estado real do pedido (aprovação + etapa), com as mesmas cores no painel inteiro (lista, Compras e /pcs): 🟧 **Aguardando aprovação** · 🟦 **Aprovado** · **Enviado ao fornecedor** (anil) · **Faturado** (roxo, NF emitida, a caminho) · **Recebido** / **Recebido parcial** (verde-água) · 🟩 **Conferido** · 🟥 **Reprovado / Cancelado**. A dica traz a data do estado, a NF e quem aprovou; **✕** desfaz vínculo por código, descrição ou manual. Linha sem PC mostra **+ vincular**: itens de PC do projeto parecidos com a linha (**Vincular**) ou **Procurar PC por número ou fornecedor**.
- **Fornecedor**: o do PC; sem PC, o sugerido pelo catálogo (em itálico) com entrega/fatura médias. **Comprado**: valor da linha do PC (**≠** quando a quantidade do PC difere da lista).
- Linha ligada só pelo **número do PC** também mostra valor: o sistema acha a linha do item dentro do PC (código, senão descrição).
- Marque as linhas e clique **🧾 Gerar pedido de compra**; **⇄ Vincular PCs automaticamente** liga as linhas aos PCs do projeto — o que sobrar fica com **+ vincular PC** na própria linha.
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

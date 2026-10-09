---
titulo: Operação
resumo: Avulsos, projetos, PCs e pedidos de venda — o dia a dia da operação.
icone: 📋
area: operacao
rotas: /avulsos, /projetos, /pcs, /erp/vendas
caminhos: web/components/BoldAvulsosView.tsx, web/components/projeto, web/components/operacao, web/app/(app)/avulsos, web/app/(app)/projetos, web/app/(app)/pcs, web/app/(app)/erp/vendas, web/components/vendas
atualizado: 2026-10-09
---

## Avulsos

A lista de **pedidos de venda (PV/OS)** com as compras ligadas a cada um.

- Cada pedido mostra a **barra da cadeia**: Requisição → Pedido de compra → Aprovação → Recebido → Conferido → **Pago** → Faturado → **Recebido**.
- A coluna **M.B.** é a margem bruta (venda menos compras ligadas).
- Use as abas **Em aberto / Faturados / Todos**, a busca e os filtros rápidos (Pode faturar, Venda em atraso, Compra em atraso, Minha aprovação, Sem PC, etc.).
- **Não achou?** Quando a busca não encontra nada (em Vendas avulsas, PCs standalone ou Projetos), a tela diz **onde o número está**: nesta tela mas fora da aba/filtros (botão **Mostrar**), ou **noutra tela** — ex.: *PC 7119 está em Vendas avulsas › PV1861 (UNIMED CAMPINA GRANDE)* — com o link **Abrir em …** que já abre a tela certa com a busca. Procura PC, RC, PV/OS, PJ, NF do fornecedor e NF de venda (com ou sem zeros à esquerda). Lembre: **PCs standalone** só mostra PCs sem PV/OS e sem projeto (PJ, 40_VS, 41_VP). Se não estiver em lugar nenhum, avisa se o PC existe só no Omie (link para Compras), se está escondido em PCs excluídos, ou que não existe no painel.
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
2. Acima das abas fica o **painel do projeto** (valor fechado, barra de budget e **Comprar esta semana** — ver abaixo). As abas seguem a ordem do trabalho, sem numeração: **Resumo · Lista de materiais · Materiais separados · Fluxo de caixa**.
3. Na lista de projetos, um selo mostra **“N itens separados · R$ · x% da lista”** quando já há material separado — clique para ir direto à aba.

### A lista de projetos

Acima da lista há só **duas faixas**:
- **Topo**: título e contagem, **★ Projetos ativos**, **⚙ Ativos**, a busca (**⌘K**) e a visão (**Lista · Tabela · Kanban · Linha do tempo**). No **•••**: PCs escondidos, **📊 Mostrar os indicadores** (os KPIs ficam escondidos por padrão; a escolha fica gravada), log de alterações e a tela antiga.
- **Barra de filtros** (um cartão só): **Mostrar** ★ Só ativos | Todos · **Situação** Em aberto | Faturados | Todos · **Período** (Tudo · 7 dias · 30 dias · Vence em 7d · Vencidos) e, na segunda linha, **Atenção**: chips com uma **bolinha na cor da gravidade** — vermelho = atraso (venda em atraso, compra em atraso, recusados, sem NF há +5d), âmbar = aprovação/serviço (minha aprovação, serviço em atraso), cinza = “sem” (sem PC, sem OS) — com a contagem. Os chips combinam entre si. Os menos usados (material recebido sem NF, parcial, em estoque e cada status de serviço) e os filtros de venda/compra (tipo, etapa, fornecedor, categoria…) ficam em **≡ Mais filtros**. **Visões salvas ▾** guarda e aplica combinações. Com **Minha aprovação** marcado aparece **✓ Aprovar todas**.

Logo acima dos projetos, uma linha de texto: quantos são, **ordenado por** (nº do projeto, emissão, cliente, prazo, etapas, serviço, venda ou compras; ↓/↑ inverte), **expandir todos · recolher** e a **legenda das cores do trilho** (concluído · em andamento · atrasado · não iniciado). Em **Todos**, os ★ ativos vêm primeiro.

**Cada projeto é uma linha**:
- **Identidade**: ☆/★, nome, 💬 anotações, cliente · emissão · nº de compras e as etiquetas (etapa da venda em azul, tipo, NF de saída, proposta do CRM ↗, OC; “PV incompleto”, “defasado Omie”, “material sem NF” quando houver).
- **Trilho de etapas**: PV · RC · PC · Aprov · Mat · Serv · NF · Pago · Receb — verde concluído, âmbar em andamento, vermelho atrasado, cinza não iniciado, tracejado não se aplica (passe o mouse em cada uma). Embaixo, **agora:** a etapa travada e o que falta (vermelho quando atrasada) e o **serviço** numa pílula (aguardando OS, status da OS, ⚠ dias de atraso), com o nº da OS ↗ ou **gerar OS ↗**.
- **Prazo**: a data da venda em destaque, com **Nd de folga** ou **Nd atrasado** em vermelho.
- **Financeiro em duas barras + margem**: **Venda** (barra azul; a parte faturada em verde, com “% faturado”) e **Compras** (o budget de materiais é o contorno tracejado; PCs aprovados em azul e aguardando aprovação em âmbar; valor vermelho quando passa do budget). Embaixo, **margem projetada** e **real**. Os valores aparecem em “k” (R$ 743k); o valor completo fica ao passar o mouse.

**Clique no projeto** para abrir no lugar: **📂 Abrir projeto**, **+ Nova linha** e **🗑 Excluir projeto** em cima; depois **um** bloco de budget com a mesma barra do cabeçalho do projeto (aprovados · aguardando · a comprar · estoura, com a marca “budget”) e, à direita, **Venda** e **Resultado esp.**; embaixo, **Vendas (PV/OS)** × **Pedidos de compra**.

### Projetos ativos (★)

- **⚙ Ativos** (topo de **Operação › Projetos**): abre a lista de **todos os projetos**, do mais novo para o mais antigo, cada um com uma caixa de marcar. Marque os projetos **em andamento, em que se está atuando**; há **busca**, **Marcar todos** / **Desmarcar todos** (valem para o que a busca mostra) e **só marcados**. Nada grava até **Salvar** — e a seleção vale para todo mundo.
- Ao lado, o botão **★ Projetos ativos (N)** lista os projetos marcados como ativos, **do maior PJ para o menor**, com o cliente. Digite para buscar; **Enter** ou clique abre o cartão do projeto já expandido (projeto sem venda/compra na lista abre a página do projeto).
- Na barra de filtros, **Mostrar ★ Só ativos | Todos**: por padrão a lista mostra **só os ativos**; **Todos** mostra o resto. A escolha fica gravada no seu navegador. Enquanto nenhum projeto estiver marcado, aparecem todos.
- Atalhos para marcar ou desmarcar um projeto só: a **☆/★** ao lado do nome do projeto (no cartão), no menu ★ (digitando, aparecem também os não marcados, com ☆) ou no cabeçalho da página do projeto. Dá para **desfazer** pelo aviso que aparece embaixo.
- A marca é **a mesma para todo mundo** (é do projeto, não da pessoa). Marca quem edita projetos ou é administrador.
- A lista de projetos vem, por padrão, **em ordem decrescente de PJ** (mude em **ordenado por**, logo acima dos projetos).
- Na página do projeto, o mesmo menu **★ Projetos ativos** fica no cabeçalho para pular de um projeto ativo para outro.

### Resumo e Fluxo de caixa do projeto

**Resumo** mostra só o **fechamento do CRM**: no topo a proposta (OPJ…), o cliente e o **valor fechado** em destaque (com as saídas previstas e a sobra), os botões **▦ Baixar CP/MC Excel**, **⟳ Gerar atualizado** e **abrir no CRM ↗**; embaixo, os blocos **Projeto** (início, prazo, entrega prevista, quando saem mão de obra e despesas), **Por conta de quem** (frete, deslocamento, instalação e impostos — selo âmbar = por nossa conta), **Custos considerados** (materiais da RC, mão de obra, frete, demais despesas, total e a barra de composição) e **Recebimento** (parcelas com faturamento → pagamento). Projeto sem fechamento no CRM mostra as premissas do plano.

**Fluxo de caixa** abre com:
- **Aprovação do fluxo** (barra no topo, antes ficava no Resumo): Rascunho / Aguardando / Aprovado / Rejeitado, com **Enviar para aprovação**, **Aprovar fluxo**, **Rejeitar**, **Reabrir** e o **Histórico**. É ela que libera a aprovação dos PCs do projeto, como antes.
- **Os números** (inicial × em andamento): entradas, saídas, resultado, **menor saldo** (e quando), e o desvio de **prazo** das entradas e das saídas em dias (+ = atrasou / ficou para depois).
- **O gráfico**: por **semana** ou **mês** (Auto escolhe pelo tamanho do projeto). Barras para cima = entradas, para baixo = saídas; **contorno** = fluxo **inicial**, **cheia** = fluxo **em andamento**. A linha tracejada é o saldo acumulado inicial; a cheia, o em andamento. Marcados: o **menor saldo** de cada linha, o **maior desvio** entre as duas e **hoje**. Passe o mouse num período para ver entradas, saídas e saldo — inicial, atual e a diferença.
- **Fluxo inicial** = a foto do plano do fechamento na primeira importação (parcelas na data inicial, agenda de saídas da planilha). **Não muda** quando o CRM reimporta; se a proposta foi revisada, aparece o aviso e só o **administrador** pode **redefinir fluxo inicial**.
- **Fluxo em andamento**: **entradas** = cada parcela na data atual (vencimento do título se já faturou; senão a nova previsão de recebimento dos PV/OS; senão a inicial). **Saídas** = **PCs** do projeto (sem escondidos, cancelados e reprovados) nas parcelas do PC, ou previsão de entrega + prazo da condição; + linhas da **Lista sem PC** (estimado, no “Necessário em”); + saídas do plano que **não são material** (obra, despesas). **Sem contar duas vezes**: quando o projeto tem PC ou Lista, a saída de **material** do plano sai do andamento (os PCs e a Lista a substituem). O que já foi **baixado** (recebido/pago) entra na data da baixa e abate o previsto em ordem de data; previsto vencido e não baixado conta como **hoje**.
- Embaixo, recolhíveis (clique no título): **Entradas**, **Saídas** (com a coluna **Δ vs inicial** — dias que a data andou e diferença de valor; “novo” = não existia no inicial) e **Budget × pedidos de compra** (o antigo “Execução da despesa” do Resumo — requisitado, aprovado e pago contra o budget).

### Lista de materiais, compras e budget do projeto

![Vídeo: lista de materiais da RC à compatibilização e ao Excel](/manual-video/lista-materiais-rc.mp4)

*Vídeo (11 min): a tela de Projetos (filtros, trilho de etapas, prazo, venda × compras, ★ ativos), levar os itens da RC para a lista, compatibilizar os códigos com o estoque (✓ aceitar as melhores, ocultar a coluna), equipamentos e “necessário em”, colar do Excel, subir planilha, comprar (Comprar agora → Simular → Gerar), o Planejamento com o agente de compras e excluir a lista.*

Tudo fica numa aba só: **Lista de materiais** (a antiga aba “Compras × lista” entrou nela). Na linha do projeto, **📂 Abrir projeto** leva até ela.

**O caminho em três etapas** — um controle segmentado no topo da aba, com a contagem dentro de cada botão (**Itens da RC 60 · Lista 62 · Planejamento 7 para agir**) e uma dica de uma linha ao lado: **Itens da RC** — a **RC** (composição de preço da proposta) é a referência e a origem do **budget de materiais**; só leitura, com **→ lista** em cada item e **⤵ Levar para a lista os que faltam (N)**. **Lista** — o que se compra de fato: exclua itens da RC que não vão, inclua os novos, compatibilize com o nosso código, defina as datas e gere os **pedidos de compra**. **Planejamento** — quando pedir cada item. Projeto sem lista abre em Itens da RC; com lista, em Lista. Os PCs se acompanham em **Operação › Projetos** (por PC) e aqui, item a item; o link **vendas e datas em Operação › Projetos →** (à direita das etapas) abre o cartão do projeto lá.

**Painel do projeto** (acima das abas, vale para todas): três blocos — **Valor fechado** (com as parcelas e o **resultado planejado %**); a **barra de budget** — a trilha vai até o maior entre o budget e a lista prevista: **PCs aprovados** (azul) · **aguardando aprovação** (âmbar) · **ainda a comprar** (cinza) · o que **estoura o budget** (vermelho, à direita da marca vertical **budget**), com os valores na legenda (ou **sobra R$ X**); e **Comprar esta semana** (vermelho quando há item atrasado): o valor dos itens sem PC atrasados + dos próximos 7 dias, “N atrasados · N próximos 7 dias · **ver planejamento →**” (abre a etapa Planejamento). Com a aba Lista aberta, os números acompanham o que se edita antes de gravar. O antigo bloco “Budget de materiais / Lista prevista / Pedidos de compra” de dentro da aba saiu — era a mesma informação.
- **Budget de materiais** = total de **materiais** da RC (a linha “materiais” do Custo planejado). O budget fica **🔒 trancado**: só o Benny destranca (🔓) e define o valor (**editar**, para projeto antigo cuja RC não veio do CRM) ou volta ao da RC (**usar o da RC**). O mesmo cadeado vale para o teto do Fluxo de caixa. Não é o custo total do projeto (materiais + mão de obra + despesas) — esse continua sendo o teto do Fluxo de caixa.
- **Lista prevista** = PCs do projeto + o estimado das linhas que ainda não têm PC, e quanto isso é do budget (%).
- **Pedidos de compra**: **aprovados** e **aguardando aprovação** aparecem na legenda da barra.
- O estimado de cada linha é o **Valor unit.** da linha; vazio, o sistema preenche com o preço do **PC**, senão o **último preço do catálogo**, senão o **custo da RC**. O mesmo budget e a mesma lista prevista aparecem no cartão do projeto em Projetos e valem na aprovação dos PCs. PCs escondidos (“Excluir PC”) não contam.

**Aprovação dos PCs do projeto (PJ…)**: não depende da alçada da área nem do fluxo aprovado (o fluxo o Benny aprova à parte). Quem tem a permissão de aprovar compras do projeto aprova o PC quando o **projeto inteiro cabe no budget de materiais** (comprometido + este PC ≤ budget). Se estourar, só um administrador aprova — os demais veem “estoura o budget do projeto em R$ X — fica para os administradores”. A Aria não aprova PC de projeto.

**Aprovar acima do budget** (09/10/26, decisão do Benny: “O Marcelo me avisa, mas tem sim autonomia para aprovar para projetos”): quem tem a permissão **Aprovar PC de projeto acima do budget** (Usuários e acessos › Operação › Projetos — hoje, o Marcelo) aprova mesmo assim. Ao aprovar, a tela mostra o aviso — “Este PC estoura o budget do projeto PJ361 em R$ 200,77 (total R$ 61.080,02 de R$ 60.879,25). Você tem autonomia para aprovar — o Benny será avisado.” — e pede o **motivo** (mínimo 5 caracteres); cancelar não aprova. Vale para aprovar um PC e em lote (um aviso só, com a lista dos PCs que estouram, e um motivo para todos), para o PC do Omie e o PC criado no Compras. Fica gravado na aprovação: **aprovado acima do budget**, o estouro, o motivo, quem e quando; para o administrador aparece a marca **⚠ acima do budget** ao lado do status (passe o mouse para ver estouro, motivo e quem aprovou), e no PC do Compras também uma linha no **Histórico** do pedido. O Benny recebe o aviso no Webex (no cartão de aprovação e numa mensagem direta) com projeto, estouro, motivo e quem aprovou. **Reprovar** um PC que estoura não pede aviso nem motivo. Sem essa permissão, nada muda: fica para os administradores. Projetos-conta do Omie (41_VP, 47_CONTRATUAL…) seguem a regra de sempre. **PC criado no Compras** de projeto PJ também é aprovado ou recusado direto na **Operação › Projetos** por quem aprova no módulo Projetos — **sem precisar de acesso ao ERP/Compras** e com a mesma regra do budget; os outros pedidos do Compras continuam com quem aprova em Compras. Se a aprovação não puder ser gravada, a tela avisa o motivo e volta o status anterior (nunca mostra “aprovado” sem ter gravado).

**Só pode reprovar quem aprova** (08/10/26): mudar o status de aprovação — **Aprovado**, **Não aprovado**, **Rejeitado por validade**, **N/A**, **Pré-seleção** ou devolver um aprovado/recusado para **Pendente** — exige a **mesma permissão de aprovar** (aprovador do módulo, dentro da alçada; PC de projeto que estoura o budget: só administrador). Para quem não aprova, o status aparece só para leitura, com a dica “só quem aprova pode reprovar”, e a seleção em massa não mostra Aprovar/Rejeitar. Vale para a tela nova, a clássica e a aprovação em massa. **Cancelar pedido** também é só de quem aprova; **Devolver material** continua para admin, aprovador ou comprador.

**Pelo Compras**: no pedido de compra com projeto **PJ…**, o botão **📋 Puxar itens da Lista de materiais** (aba Itens) abre as linhas da lista sem PC (filtro por grupo e fornecedor); as escolhidas viram itens do pedido (código nosso, descrição, qtd e valor da lista, editáveis) e, ao salvar, cada linha fica ligada ao seu item — igual ao “Gerar pedido de compra” da lista. Trocar o fornecedor não desfaz os vínculos.

**Barra da Lista** (no máximo três linhas acima da grade): **equipamentos como chips coloridos** — **Todos N**, um chip por grupo com a sua cor, a contagem e **✕N** em vermelho quando há itens atrasados/em risco; clique para filtrar a lista (a mesma cor fica na borda esquerda das linhas e no cabeçalho do grupo); o último chip, **+ equipamento**, cria um grupo novo (nome com sugestões do cadastro e “necessário em”): os itens marcados entram nele; sem marcados, ele nasce com uma linha vazia para digitar. À direita, a **toolbar única**: **⬇ Baixar modelo** e **⬆ Subir lista preenchida** (ícones verdes do Excel — ver “Montar a lista”, item 5; colar é Ctrl+V numa linha em branco) · **⚡ Compatibilizar (N)** · **Colunas ▾** (mostra/esconde colunas — Item e Qtd ficam sempre; **restaurar padrão** volta tudo) · **A− 100% A+** (tamanho da letra da grade, em 4 passos; a grade encolhe as colunas com reticências para caber na largura da tela — esconder colunas abre espaço para letra maior; as duas escolhas ficam guardadas neste navegador) · **⋯** (🔎 Escolher vários do estoque (com quantidade), Vincular PCs automaticamente, Ver sugestões de vínculo, Exportar Excel, 🗂 Importar planilha antiga (uma aba por equipamento), Salvar agora, ⏱ Prazos por fornecedor, Casar com o catálogo de novo, Ver PCs com itens fora da lista). **Barra de seleção** (só com itens marcados, fundo azul, numa linha só): **N marcados · ✎ Alterar em lote ▾ · 🧾 Comprar agora · ✨ Planejar com o agente · mover para equipamento… · ⇄ vincular a um PC · 🗑 Excluir · limpar**. **Filtros** (“mostrar”, segmentado pequeno): **Todos · ⌕ Sem código N · Sem PC N · ✕ Atrasados / em risco N · ⏱ Prazo alterado N** (itens com o prazo ajustado à mão).

**Filtro por coluna (como no Excel)**: passe o mouse no cabeçalho de **Fornecedor, Item, Código, Equipamento, Un, Situação, PC, Prazo, Comprar até, Necessário em, Chegada prev., Projetado** (e Qtd, Valor unit., Comprado) e clique no **▾**. Abre um painel com **ordenar** (A→Z / Z→A; menor→maior; mais antiga→recente) e o filtro: em texto, **contém…** (ex.: “crepina” no Item acha todas as crepinas) e a **lista de valores** da coluna com a contagem, **Selecionar todos** e uma caixa por valor (“(vazio)” = sem valor); em números e datas, **de / até**, **só as vazias** e, nas datas, atalhos **até hoje · próx. 7 dias · próx. 30 dias**. Coluna com filtro fica com o ícone **azul** no cabeçalho. Os filtros de coluna **somam** com os chips de equipamento e com o “mostrar”; com algum filtro ativo aparece **✕ Limpar filtros (N)** e a contagem **N de M linhas** (também no rodapé da grade). Ficam guardados enquanto a aba do navegador estiver aberta, **por projeto** (não passam para outro projeto). A caixa **marcar todas** do cabeçalho marca **só as linhas visíveis**.

**✎ Alterar em lote ▾** (barra de seleção): muda de uma vez todas as linhas marcadas — **⏱ Prazo (dias)…** e **↺ voltar ao automático** (quem tem acesso a Compras) · **📅 Necessário em…** e **📅 Usar a data do grupo** · **🏭 Fornecedor…** (com os nomes conhecidos; o mesmo nome junta os itens no mesmo lote/PC) · **💲 Valor unit.…** e **💲 Usar último preço / custo RC** · **✖ Qtd × N…** e **＝ Qtd = N…** · **📏 Unidade…** · **✓ Aceitar sugestões** · **✕ Não é item nosso** · **⌫ Tirar o código** · **💬 Comentar em todos…** · **⛓ Desvincular PC** · **⬇ Exportar marcados para Excel** · **📋 Copiar** (tabela com cabeçalho, cola no Excel). As ações com valor abrem um campo no próprio menu; **Aplicar a N** confirma. Depois aparece um aviso com **Desfazer** (volta cada linha ao valor anterior; no prazo, regrava o prazo anterior). Comentário e desvincular PC pedem confirmação e **não têm desfazer**.

**A grade usa a tela inteira:** ao rolar a página para baixo, o painel do projeto, as abas, as etapas e a barra saem de cena e só o **cabeçalho das colunas** fica preso no topo (logo abaixo da barra do painel); não há mais uma caixa de rolagem pequena dentro da tela.

**Comprar pela lista**: marque as linhas sem PC e clique **🧾 Comprar agora** (barra de seleção) — abre uma folha com **um pedido por fornecedor** (o fornecedor sugerido de cada linha agrupa; dá para trocar), com preço, quantidade, categoria, condição e previsão (o “Necessário em” mais cedo do grupo) editáveis. **Simular** confere tudo sem gravar. Os PCs nascem pelo caminho de sempre do Compras (numeração, aprovação, avisos) e cada item já fica ligado à sua linha da lista. **⤵ Levar para a lista os que faltam (N)** (etapa Itens da RC) traz os itens da **RC** (a composição de preço da proposta) que ainda não estão na lista, cada um já casado com o nosso catálogo: resolva o ⚠ conferir / sem correspondência em **No catálogo** (sugestões, busca, Criar item nosso), marque o que entra (sem código entra âmbar, para resolver depois; desmarque para pular) e adicione. Se a RC já foi lançada em Compras, os itens vêm ligados a ela. Numa linha, o **RC** discreto na célula do Item (passe o mouse) usa um item da RC ainda não usado (descrição, qtd, equipamento e custo da RC, passando pelo catálogo). Item digitado ou buscado livremente é **novo**. Para subir a lista inteira de uma planilha antiga, com **uma aba por equipamento**, use **⋯ › 🗂 Importar planilha antiga** (o botão 📋 Subir planilha do topo do projeto saiu): ele substitui a lista e mostra antes quantos itens entram, atualizam e saem. Para a lista montada no modelo Excel, use **⬆ Subir lista preenchida**.

> No projeto, **RC e CP (composição de preço) são a mesma coisa** e o nome usado é **RC**: os itens da RC são os da composição de preço da proposta; o nº mostrado é o do documento em Compras.

**Margens do projeto** (na linha do projeto, embaixo das barras):
- **Margem projetada** = (PV − budget de materiais da RC) ÷ PV.
- **Margem real** = (PV − PCs aprovados) ÷ PV — cada PC uma vez; passe o mouse para ver como fica se os PCs aguardando aprovação forem aprovados.
- O antigo **M.B.** somava os PCs **e** os itens da RC sem PC; no projeto os PCs saem da Lista sem ligar à RC, e a mesma compra contava duas vezes (o PJ361 aparecia com −16%). Nos Avulsos o M.B. continua como era. No bloco de budget do projeto, **Result. esp.** é o resultado esperado do fechamento do CRM (venda − materiais − mão de obra − despesas) — não é a margem de materiais.

**Vendas (PV/OS)** (no projeto aberto, à esquerda): os PV/OS gerados para o projeto — nº (abre no Faturamento) e **parcela N** na mesma linha, o evento embaixo, valor e % do total (a soma confere com o PV do projeto), situação (a faturar / faturado com NF ou recibo / recebido) e OC do cliente. Em **faturamento** e **recebimento**, em cima fica sempre a **data vigente** (a nova previsão, ou a inicial quando não mudou) — clique nela para mudar. Embaixo: **= inicial** quando não mudou; se mudou, o campo fica com borda âmbar e aparece **inicial ~~dd/mm/aaaa~~ +Nd** (+N vermelho = atrasou, −N verde = adiantou). A **previsão inicial** vem do resumo financeiro do projeto e não muda. Escolher de novo a data inicial (ou clicar **↺**) apaga a nova previsão. Já faturado: em cima “dd/mm/aaaa faturado”; a inicial riscada só aparece embaixo se a data foi outra.
- A nova previsão de **faturamento** é a mesma da carteira do Faturamento (“Previsão fat.”). Mudá-la leva o recebimento junto (mesmo prazo), se o recebimento não tiver nova previsão própria — um aviso no canto da tela confirma.
- Do projeto (aba Lista de materiais), **mudar datas em Operação › Projetos →** abre esta tela já com o cartão do projeto aberto.
- A nova previsão de **recebimento** é a data da parcela no **Fluxo de caixa** do projeto (a reimportação do CRM não apaga). Já faturado: muda o vencimento do título a receber (precisa de “Editar título” no Financeiro). ↺ volta à inicial.
- PV/OS antigos do Omie aparecem com as datas do Omie; o Omie nunca é alterado.

**Projetos › projeto aberto**: em cima, as ações e o bloco de budget (barra aprovados · aguardando · a comprar · estoura, com a marca “budget”; budget de materiais, lista prevista, PCs e pago na linha de cima; **Venda** e **Resultado esp.** à direita — as margens ficam na linha do projeto). Embaixo, lado a lado como na linha aberta dos Avulsos (em tela estreita, um embaixo do outro): à esquerda **Vendas (PV/OS)** — ver acima — e à direita **Pedidos de compra**, uma linha por PC: nº (abre o PC), fornecedor, valor, aprovação, Prev. material (atraso em vermelho), **situação** (uma pílula, cores do Compras), NF de entrada e **💬** (comentários do PC, com quem escreveu e quando — ficam no histórico do pedido no Compras). No **⋯**: todos os campos do PC, **Ver itens na Lista de materiais** e a marcação do material à mão. Esta tela não mostra RC: as RCs, o valor delas e o **Gerar pedido de compra** ficam na **Lista de materiais**.

**Previsão do material**: é a do PC. Mudar a “Prev. material” na Operação › Projetos grava a previsão do próprio PC quando ele nasceu no painel (com registro no histórico do PC); PC importado do Omie guarda a remarcação, e a folha do PC no Compras mostra “remarcada para dd/mm”.

**Montar a lista** (**Lista**) — colunas: # · **Orig.** (selo **RC** quando a linha veio da RC; vazio = item novo) · Equipamento · **Código** · Item · Qtd · Un · Necessário em · Valor unit. · **Projetado**, e à direita (fundo azul claro) **PC** · **Situação** · Fornecedor · **Comprado (PC)** · **Δ** · **💬**.
- **Projetado** = Qtd × Valor unit. (quanto se espera gastar). **Comprado (PC)** = valor da linha deste item no pedido de compra. **Δ** = Comprado − Projetado: verde abaixo, vermelho acima. **≠** no Comprado avisa que a quantidade do PC é diferente da lista (passe o mouse).
- **💬 Comentários** (substitui a coluna Observação): clique no balão para ver e escrever comentários — cada um guarda quem escreveu e quando; o número no balão é a quantidade. A observação antiga da linha aparece como primeiro comentário. Cada linha ocupa uma linha só (passe o mouse para ver o texto inteiro); ao rolar para o lado, as colunas até o Item ficam presas.
1. Digite o item: o catálogo sugere primeiro os **itens do nosso estoque** (código novo, como no Faturamento) com **último preço pago, fornecedor e prazos**; código de compra já vinculado aparece como “cód. compra X”. Linha antiga com código do Omie que já tem item nosso passa a mostrar o código novo.
2. **Compatibilizar com o estoque** (coluna provisória, âmbar, tracejada, logo depois de **Código**): aparece **sozinha** enquanto houver linha sem código do nosso estoque (ao abrir, ao levar itens da RC, ao colar do Excel, ao criar linha nova) e **some sozinha** quando a última é resolvida; volta se entrar item novo sem código. Em cada linha sem código, um seletor já posicionado na **melhor sugestão** (`CÓDIGO · descrição (nota%)`), com as outras candidatas e duas opções fixas: **⌕ buscar no estoque…** e **＋ criar item novo no estoque** (abrem o seletor com busca e o “Criar item nosso”). **✓** aceita o selecionado (vira o código da linha e ensina o de-para — o mesmo texto casa sozinho da próxima vez); **✕** = “não é item nosso” (a linha sai da coluna e mostra **sem item nosso · escolher · rever**). Linha sem nenhuma candidata mostra “nenhuma parecida no estoque”. No cabeçalho: **✓ aceitar as melhores** (aceita a melhor de todas as linhas pendentes, com Desfazer) e **ocultar**. O botão **⚡ Compatibilizar (N)** da barra mostra/oculta a coluna a qualquer momento; aberta à mão, ela mostra também as linhas **já com código** (“✓ CÓDIGO · mantido”, **trocar por …**, **⌕ buscar no estoque…**, **✕ tirar o código**) — dá para aceitar tudo e depois ajustar algumas. A sugestão e a recusa ficam **gravadas na linha**: recarregar, gerar ou vincular PC e salvar não as apagam; depois de recarregar (F5), as **outras candidatas** de uma sugestão pendente voltam sozinhas em instantes (a sugestão gravada não muda). Se a busca no catálogo falhar, aparece **Não consegui buscar sugestões · tentar de novo**. Com linhas marcadas, **✓ Aceitar sugestões** fica em **✎ Alterar em lote ▾**.
2. **Código**: sempre o do nosso estoque (nunca o do Omie). O ícone ao lado diz a situação — **✓** casado, **⚠** conferir, **⌕** sem código (célula âmbar). Clique no ícone para **escolher**: sugestões com %, busca por nome/código ou **Criar item nosso** (família e próximo código; serviço → família SV). No Criar item nosso, o **NCM** tem ao lado **🔎 Localizar NCM** — o mesmo localizador do Faturamento: NCM das **nossas compras** (NF de entrada desse item ou parecido, com fornecedor e nº da NF), os NCMs **da família** escolhida (quantos itens usam cada um), as **sugestões do catálogo** e a busca na tabela oficial por código (ex.: `9026`) ou palavras. Clique num resultado para preencher. O NCM precisa existir na tabela oficial (8 dígitos — aparece ✓ ou ✕ embaixo do campo); só itens de **serviço (família SV)** podem ficar sem NCM. A escolha fica gravada para aquele texto — da próxima vez casa sozinho.
3. Casada, a linha mostra no **Item** a descrição do catálogo; o texto original (e o modelo, se houver) aparece ao passar o mouse e volta ao editar.
4. A lista **salva sozinha** alguns segundos depois de cada mudança — linha nova já ganha PC, situação, caixinha e 💬 logo depois de salvar, sem F5. Quando **não** puder salvar sozinha (lista recuperada do navegador, linhas a menos que no sistema, exclusão que falhou), aparece **⚠ não está salvando: motivo** com o botão **Salvar lista**. Mudar o texto do item ou o grupo de uma linha que já existe **não** cria linha nova: o vínculo com RC/PC e os comentários continuam. Linha nova, direto na tabela: no fim de cada grupo há **＋ linha · ＋ [3] linhas** — insere uma ou N linhas em branco **naquele grupo** (com a data do grupo) e já põe o cursor na primeira; passando o mouse numa linha, o **＋** ao lado do 🗑 **insere uma linha logo abaixo**. A linha em branco mostra “digite ou cole do Excel aqui (Ctrl+V)”: colando várias linhas do Excel nela, todas entram **naquele grupo**, como linhas novas (as de baixo não são sobrescritas). Linha em branco que ficar sem item não vai para o sistema. Também dá para Enter/digitar na última linha da grade (sempre há uma em branco no fim).
   - **Excluir**: o **🗑** no fim da linha (passe o mouse) ou marque várias e clique **🗑 Excluir N linhas**. Aparece **Desfazer** por alguns segundos; depois grava sozinho. O que sai vai para **Itens removidos** (recuperável). O PC de uma linha excluída não muda.
5. **Lista pelo Excel** — dois botões na barra, sem menu:
   - **⬇ Baixar modelo** baixa o modelo Excel com os nossos códigos (e os grupos deste projeto). Na aba **Lista**, a coluna **A “Item (digite e escolha)”**: comece a digitar o código ou parte da descrição e escolha na lista (`CÓDIGO · descrição`; no Excel 365/web a lista filtra enquanto você digita, nos antigos use a setinha). Preencha **Qtd**, **Necessário em** (dd/mm/aaaa) e **Grupo** (lista com os grupos do projeto e do cadastro; pode digitar um novo). As colunas cinza se preenchem sozinhas (Código, Item, Un, Valor unit., e à direita Fornecedor habitual, Último preço, Prazo médio, Total). **Valor unit. (se diferente)**, à direita, só se o preço for outro — vazio, vale o último preço. Item fora do estoque: digite o nome e confirme o aviso — entra **sem código** e passa pela compatibilização. A aba **Catálogo** (só leitura, com filtro) mostra todos os itens do estoque; as abas ficam protegidas sem senha (Revisão › Desproteger, se precisar).
   - **Copiar e colar direto**: as colunas **B:H** do modelo (faixa azul **“▼ COPIE ESTAS COLUNAS”**, com contorno azul) estão na mesma ordem da grade — **Código · Item · Qtd · Un · Necessário em · Valor unit. · Grupo**. Selecione da 1ª à última linha preenchida (ou **Ctrl+G › PARA_COLAR**), copie e cole com **Ctrl+V numa linha em branco** da lista: as linhas entram como novas; sem Grupo, ficam no grupo da linha onde colou. Com ou sem o cabeçalho.
   - **⬆ Subir lista preenchida** escolhe o arquivo (.xlsx do modelo, ou qualquer planilha/CSV com Código, Item, Qtd…; aba **Lista** se houver, senão a primeira) e abre a **prévia**: código do nosso estoque preenche descrição, fornecedor e valor; código que não é nosso aparece em vermelho e entra sem código; linhas em branco do modelo ficam de fora. Confira e **Adicionar à lista**.
   - O **Ctrl+V direto na grade** aceita também qualquer planilha nessa ordem (Código pode ficar vazio; datas dd/mm/aaaa). **🔎 Escolher vários do estoque (com quantidade)**, no **⋯**, busca no estoque e adiciona vários marcados de uma vez ao grupo escolhido. O Exportar Excel junta os comentários na coluna Observação. **⚡ Casar com o catálogo de novo** (no ⋯) acha o resto (escolhas feitas à mão e sugestões recusadas não mudam).
6. **Valor unit.** vazio é preenchido do PC, do catálogo ou da RC — a origem aparece pequena na célula (PC / cat. / RC).

**Itens da RC**: o registro do plano original (a RC dá a ideia inicial e o budget), agrupado por equipamento. Mostra cada item com qtd, custo e total, e na coluna **Na lista** ✓ (com o código nosso e a linha) ou o botão **→ lista**; embaixo, o total do plano × o que está na lista. **⤵ Levar para a lista os que faltam (N)** abre o importar com eles marcados, para conferir o código antes de adicionar. As vendas (PV/OS) e as previsões de faturamento ficam no cartão do projeto em Operação › Projetos.

**Chega a tempo?** Ao lado de “Necessário em” fica a **Chegada prev.**: a previsão do PC, a data do recebimento (“recebido”) ou, sem PC, **≈ dd/mm** em itálico (hoje + prazo médio do catálogo). Quando a previsão do PC já passou e nada chegou, a data aparece em vermelho com **PC atrasado N d**. O sinal ao lado compara a chegada com a necessidade: **✓** chega com folga (3 dias ou mais), **⚠** menos de 3 dias de folga ou PC sem previsão, **✕** chega depois do necessário (ou o necessário passou sem receber). PC atrasado conta como “chega hoje” nessa conta — a dica explica, por exemplo: “chegada efetiva hoje (PC atrasado 19d) · necessário 15/10 · folga 8d → ✓”. O filtro **Em risco / atrasados** junta as três situações; o cabeçalho de cada grupo mostra quantas linhas estão em risco ou atrasadas.

**Planejamento de compras — quando pedir cada item**: **comprar até = necessário em − prazo − 3 dias de folga**. O prazo usado é, nesta ordem: o **ajustado no item** (coluna **Prazo (dias)** da lista), o **ajustado** para o fornecedor em **⏱ Prazos por fornecedor**, o prazo do **item** no catálogo, o **histórico** do fornecedor (média pedido → NF de entrada) e, sem nada disso, **15 dias** (“prazo estimado”). Ajustar o prazo de um fornecedor muda o “comprar até” de **todos** os itens dele sem PC, em todos os projetos; deixar vazio volta ao histórico (histórico acima de 60 dias aparece com ⚠ para conferir).
- Na Lista, a coluna **Prazo (dias)** (logo antes de Comprar até) mostra o prazo considerado para cada item e de onde veio, pequeno embaixo: **forn. manual** (⏱ Prazos por fornecedor), **item** (catálogo), **histórico** ou **estimado** (15 dias). Quem tem acesso a **Compras** clica na célula e ajusta **só aquele item** (Enter grava, Esc cancela): a célula fica com **borda âmbar**, o valor novo em cima e o automático **riscado** embaixo (ex.: **10d** · ~~21d~~ ajust.), a dica diz **quem alterou e quando**, e o **↺** volta ao automático (apagar o número ou digitar o valor automático também volta). O Comprar até, a chegada prevista, o sinal ✓/⚠/✕, o planejamento e o agente recalculam na hora. O filtro **⏱ Prazo alterado** mostra só os itens ajustados.
- Na Lista, a coluna **Comprar até** (entre Prazo e Chegada prev.) mostra a data em negrito e, sem PC: **atrasado Nd** (vermelho — já devia ter comprado), **comprar agora** (âmbar — nos próximos 7 dias) ou **em Nd** (verde). Com PC vale o sinal de entrega do PC. **Chegada prev.** sem PC = hoje + o mesmo prazo. O filtro **Em risco / atrasados** inclui os itens atrasados e os de comprar agora. O fornecedor mostra o prazo (ex.: “· 21d”); sem fornecedor, “(prazo estimado 15d)”. Quando o prazo é o estimado, o Comprar até traz “· est.” — passe o mouse para ver “prazo estimado (15d)”.
- Na etapa Planejamento: caixas **Deveria já ter comprado** (vermelho) · **Comprar nos próximos 7 dias** (âmbar) · **Dentro do prazo** (verde) · **Já com PC** (azul), com a contagem e o valor. **Clique numa caixa para filtrar**: ela fica destacada na cor dela, os lotes do agente mostram só os que têm itens daquela caixa (“N de M lotes”) e a tabela só esses itens (em **Já com PC**, a lista dos itens com PC e se a previsão chega a tempo); clique de novo ou em **Todos** para ver tudo. Nas caixas de atrasados e próximos 7 dias, **ver na lista →** abre a Lista no filtro **Atrasados / em risco**. Abaixo, a tabela por **fornecedor e data de pedir** (ordenada pela data), com **🧾 Gerar PC** por grupo — abre a mesma folha do Gerar pedido de compra com os itens do grupo (salve a lista antes).
- No painel do topo do projeto, **Comprar esta semana** soma o valor dos itens sem PC atrasados e dos próximos 7 dias (**ver planejamento →** abre esta etapa).
- **✨ Agente de compras** (na etapa Planejamento): monta **lotes** — um PC por fornecedor por data. Junta os itens do mesmo fornecedor cujas datas de pedir caem na **janela de consolidação** (padrão 10 dias; mude no campo e, se quiser, **gravar como padrão**) e pede todos na data do mais apertado (um frete, uma aprovação). Cada cartão mostra fornecedor, **data de pedir** em destaque (“hoje” quando já passou), quando chega, a **explicação** (quantos itens juntou, a folga até o primeiro “necessário em”, prazo estimado), os itens, o valor e a linha de **caixa**: o gasto acumulado dos lotes até a data × os recebimentos das parcelas de venda (Vendas PV/OS) até lá — faltando, mostra a próxima entrada. O caixa informa, não bloqueia.
  - **🧾 Gerar PC** abre a folha do pedido com os itens do lote. **🔔 Agendar p/ dd/mm**: no dia, às 07:00, o agente cria o PC **em rascunho** (em Compras, etapa Pedido de Compra — revise e **Solicitar aprovação**) e avisa no Webex; na véspera manda um lembrete; item que ganhou PC por fora sai do lote. **mover p/** muda a data (em lote agendado, grava). **cancelar agendamento** devolve os itens aos lotes propostos. **conferir PC** mostra, sem gravar, o pedido que o agente montaria no dia (fornecedor do cadastro, categoria). **✨ explicar** reescreve a explicação com a IA, só com os fatos do lote.
  - **simular “comprar tudo hoje”** recalcula com todos os lotes hoje e compara o menor saldo de caixa com o do plano. Lote sem fornecedor provável aparece como “— sem fornecedor” para escolher na hora de gerar. O mesmo fornecedor escrito de jeitos diferentes (maiúsculas, acento, espaços) cai num lote só. Lote proposto atrasado há 2 dias ou mais sem ação é avisado ao administrador uma vez (depois, no máximo um lembrete por semana).
  - Na Lista, a barra de seleção tem **🧾 Comprar agora** e **✨ Planejar com o agente** para os itens marcados: comprar agora abre a folha do pedido; planejar leva para a etapa Planejamento com os lotes desses itens destacados.

**Grupos de equipamento e “Necessário em”**: a grade vem agrupada por equipamento; cada grupo abre com uma linha de cabeçalho com o nome, quantos itens e **necessário em** (a data do grupo, editável ali mesmo — muda as linhas que herdam; as de **data própria** ficam e o cabeçalho diz quantas são). Grupo sem data mostra **aplicar dd/mm (entrega prevista)** da proposta, e **≈ Nome** troca pelo nome padrão do cadastro. Cada grupo tem uma **cor** (bolinha no cabeçalho e borda esquerda das linhas, a mesma do chip). Para **dividir** a lista: marque os itens e use **+ equipamento** (grupo novo) ou **mover para equipamento…** (grupo existente) na barra de seleção — a linha que seguia a data do grupo antigo passa a seguir a do novo; data própria fica. A linha continua a mesma no sistema (PC, RC e comentários não se perdem). Linha nova herda a data do grupo. A data da linha é a que vai para o pedido de compra (previsão) e para o fluxo.

**Comprar e acompanhar**:
- **PC**: o número do pedido em destaque (clique abre o pedido). Número digitado na lista que não está vinculado aparece como **sug. 6405** (tracejado) — é só sugestão: clique para vincular.
- **Situação ⓘ**: o estado real do pedido (aprovação + etapa), com as mesmas cores no painel inteiro (lista, Compras e /pcs): 🟧 **Aguardando aprovação** · 🟦 **Aprovado** · **Enviado ao fornecedor** (anil) · **Faturado** (roxo, NF emitida, a caminho) · **Recebido** / **Recebido parcial** (verde-água) · 🟩 **Conferido** · **Devolução total / parcial** (lilás acinzentado) · 🟥 **Reprovado / Cancelado**. A dica traz a data do estado, a NF e quem aprovou; **✕** desfaz vínculo por código, descrição ou manual. Linha sem PC mostra **+ vincular**: itens de PC do projeto parecidos com a linha (**Vincular**) ou **Procurar PC por número ou fornecedor**.
- **Fornecedor**: o do PC; sem PC, o sugerido pelo catálogo (em itálico) com entrega/fatura médias. **Comprado**: valor da linha do PC (**≠** quando a quantidade do PC difere da lista).
- Linha ligada só pelo **número do PC** também mostra valor: o sistema acha a linha do item dentro do PC (código, senão descrição).
- Marque as linhas e clique **🧾 Gerar pedido de compra**; **⇄ Vincular PCs automaticamente** liga as linhas aos PCs do projeto — o que sobrar fica com **+ vincular PC** na própria linha.
- Abaixo da lista: o **Fluxo de compras do projeto** mês a mês. Itens de PCs do projeto que nenhuma linha cobre: **⋯ › Ver PCs com itens fora da lista** (já contam no comprometido) — com a ponte abaixo, essa lista normalmente fica vazia.

### Compra direta (PC fora da lista): os itens entram sozinhos

Quando o material é urgente e o PC é feito direto, ligado ao projeto, sem passar pela lista, o painel faz a **ponte PC → lista**: cada item de PC do projeto que nenhuma linha cobre entra na Lista de materiais sozinho.
- A linha nova tem o selo **PC** (azul) na coluna **Orig.**; passe o mouse para ver o número do PC, e clique para abrir o pedido. O 💬 da linha diz **“Item trazido do PC nnnn (compra direta, fora da lista)”**.
- A linha já nasce ligada ao item do PC: quantidade, unidade e valor unit. do pedido (com desconto/IPI/ST rateados, então o **Projetado** da linha é igual ao **Comprado**), **Necessário em** = previsão do PC e o fornecedor do PC. Código: o nosso, quando o produto do PC já é (ou está ligado a) um item do estoque; senão fica “sem código” com a sugestão para ✓/✕ e o código do PC na observação.
- Equipamento: o do item do PC (“Equip.: …”), senão o da RC com a mesma descrição, senão o grupo **Compras diretas**.
- “Coberto” quer dizer: linha ligada ao item do PC, linha que veio de uma RC atendida por ele, ou linha antiga com o número do PC que casa com o item (código, senão descrição). Se já existe uma linha **sem PC** que é o mesmo item com certeza (mesmo código, ou descrição com as mesmas medidas), a ponte **liga** essa linha ao PC em vez de criar outra.
- Quando roda: ao gravar um PC com projeto no Compras, ao abrir a Lista de materiais ou o cartão do projeto em **Operação › Projetos**, e todo dia às 06:30 (pega PC do Omie ligado ao projeto depois). Um aviso verde diz **“N item(ns) de compras diretas entraram na lista (PC 7xxx)”**.
- Nunca duplica: item de PC já trazido não volta — nem se você excluir a linha de propósito. Não entram itens de PC escondido nem itens devolvidos por inteiro (devolução parcial entra com o que ficou).
- **PC cancelado**: a linha que a ponte trouxe só daquele PC vai para **Itens removidos** (recuperável), com o motivo; se o cancelamento for desfeito, o item volta.
- Totais: o comprometido não muda (o PC já contava). O **projetado** = PCs + estimado das linhas **sem** PC — a linha da ponte tem PC, então conta uma vez só.
- Filtro: no ▾ da coluna **Orig.**, escolha **RC**, **PC** ou **novo**.

### Como faço para cancelar um pedido de compra do projeto

Em **Projetos**, abra o projeto e, na tabela **Pedidos de compra**, escolha **Cancelar pedido** no seletor **Aprovação** do PC — ou **⋯ › 🚫 Cancelar pedido…**. (Só quem aprova.)

1. A janela já mostra **o que vai acontecer** antes de gravar (o sistema simula no banco e desfaz): quantas linhas da Lista de materiais voltam a **sem PC**.
2. Escreva o **motivo** (obrigatório) e confirme. Fica gravado quem cancelou e quando.
3. O PC **sai da tabela**, do **comprometido**, da **barra de budget**, da **margem real** e do **fluxo de caixa** do projeto. As linhas da Lista ligadas a ele voltam a **sem PC**, com um comentário 💬 contando o motivo — dá para gerar um PC novo para elas pelo **🧾 Gerar pedido de compra** de sempre.
4. **PC que veio do Omie**: o painel **não escreve no Omie**. Ele fica cancelado **só no painel** (como o “Excluir PC”) e a janela avisa: **cancele também no Omie**.
5. **PC criado no painel**: fica cancelado também no **Compras**.

No fim da tabela de PCs aparece **▸ Cancelados / devolvidos (N)**, recolhido: PC, motivo, quem, quando e quantas linhas foram liberadas. **Desfazer cancelamento** (só admin) devolve o PC às contas e religa as linhas que continuam livres.

“Recusado” e “Rejeitado por validade” continuam como antes: o PC fica na tabela (como recusa a resolver), fora da margem real. **Cancelar** é a saída definitiva. **Excluir PC** (esconder) continua existindo para PC que nem devia estar no projeto e volta pelo menu **PCs escondidos**; o PC cancelado não aparece ali.

### Como faço para registrar uma devolução de material ao fornecedor

Na tabela de PCs do projeto: **⋯ › ↩ Devolver material…** (ou no **Compras**, no menu do pedido e na folha do PC).

1. Informe a **quantidade devolvida** de cada item (**tudo** preenche o que resta; **devolver tudo** marca o pedido inteiro). O total que sai do projeto aparece embaixo, e a janela diz se a devolução é **total** ou **parcial**.
2. Escreva o **motivo** e, se já existir, o **nº e a data da NF de devolução**.
3. Confirme. O **PC continua ativo**: a situação passa a **Devolução total / parcial**. O **valor devolvido** sai do comprometido, do budget, da margem e do fluxo de caixa.
4. Na Lista de materiais, as linhas desses itens voltam a **sem PC** pela quantidade devolvida: quantidade inteira → a linha é desligada do PC; só parte → a linha fica com o que ficou e nasce uma linha **“· repor (devolução PC …)”** com a quantidade devolvida, sem PC, pronta para um pedido novo. Cada linha ganha um comentário 💬.
5. **emitir NF de devolução ↗** abre o **Faturamento** com a **NF-e de devolução (de compra)** já escolhida, a NF de entrada procurada e o motivo — **não emite nada sozinho**; confira e emita por lá.

A devolução também fica em **Cancelados / devolvidos**; **desfazer** (só admin) volta a quantidade às linhas e o valor ao projeto.

**Cartão “Custo planejado”** (topo do projeto): a barra mostra a composição e a legenda traz o valor de cada parte — materiais, obra e despesas, em R$ e %.

## PCs Standalone

Em **/pcs** ficam os pedidos de compra que não pertencem a projeto nem a pedido de venda: o projeto **não** começa com **PJ**, **não** é **40_VS** nem **41_VP**, e o PC não tem PV/OS. É a mesma regra que separa Projetos, Standby e Avulsos.

- A lista abre **dos mais recentes para os mais antigos**, pela data de inclusão. No mesmo dia, o número maior vem primeiro.
- Entram tanto os PCs que vieram do Omie quanto os criados na tela **Compras** do painel (por exemplo, um PC de 47_CONTRATUAL lançado pela compradora). O PC do Compras aparece até 10 minutos depois de criado.
- **Aprovar, Não aprovado e voltar para Aguardando** funcionam aqui mesmo, também em lote, com a regra do Compras: um PC de projeto PJ é aprovado pelo Marcelo; se estourar o budget, pelo admin ou por quem tem **Aprovar PC de projeto acima do budget** (com aviso e motivo — ver acima). Para editar ou ver os detalhes, o clique abre a **folha do pedido no Compras**.

### Como faço para atribuir o cliente a um PC

O PC standalone só pode ser aprovado depois de dizer **para qual cliente (ou clientes) ele é**.
1. Na vista **Lista**, abra o PC e clique em **Atribuir cliente** (na vista **Tabela** clássica, na coluna **Cliente(s)**).
2. Em **Adicionar cliente**, digite parte do nome, a fantasia ou o CNPJ e **clique no cliente** da lista.
3. Mais de um cliente? Adicione os outros — o rateio vem 100/N; ajuste em **%** ou **R$**. A soma precisa dar **100%**.
4. Clique em **Salvar atribuição**. O quadro fecha, aparece **"PC 7388: cliente … salvo ✓"** e o botão vira **Clientes ✓** na hora.

- Escolher o cliente na busca **não grava sozinho**: só **Salvar atribuição** grava. Se fechar o quadro (✕, Cancelar ou clique fora) com algo escolhido, a tela pergunta se quer descartar.
- Se o **Salvar** estiver apagado, o motivo aparece ao lado (falta escolher o cliente, ou a soma não dá 100%).
- Se der erro, a mensagem diz o que fazer — ex.: *sessão expirou: recarregue a página (F5)*. O que já estava gravado no PC não se perde quando a gravação nova falha.

### Onde cada PC aparece

Vale para os PCs do Omie e para os criados no **Compras**, nesta ordem:
1. Projeto começa com **PJ** → **Projetos**. É lá que o Marcelo aprova.
2. Tem **PV/OS** → **Avulsos**, dentro do pedido de venda.
3. Projeto **40_VS** ou **41_VP**, sem PV/OS → **Standby**.
4. O resto → **PCs Standalone**.

### PCs antigos do Omie: **Histórico Omie**

Desde 02/10/26 não há mais sincronização com o Omie: os PCs que vieram de lá ficam guardados só como histórico (ninguém mais grava nessa cópia, nada vai para o Omie).
- **Mesmo PC nos dois lados** (a cópia do Omie e o PC do painel/aprovação com o mesmo número): a lista mostra **só o do painel** — a cópia do Omie saiu de Projetos, Standby e PCs Standalone, então PC já aprovado deixa de aparecer como pendente.
- **PC do Omie que nunca teve aprovação no painel**: deixa de ser **Pendente** e aparece como **Histórico Omie** (status N/A). Não entra na fila de aprovação, não conta como aprovado nem como “aguardando” na barra de budget e na margem, e não acende “compra em atraso”. Quem aprova ainda pode mudar o status dele, se for o caso.
- Exceção: os PCs incluídos no Omie **a partir de 01/09/26** sem aprovação continuam **Pendente** — podem estar mesmo à espera.

## Pedidos · PV/OS

- **PV** = venda de produtos (sai NF-e). **OS** = serviço (sai recibo ou NFS-e).
- Em **ERP → Vendas** você vê os PV/OS do painel e do Omie. Admins veem a chave **“CRM cria PV/OS: no Omie / no painel”**.
- **Novo PV/OS** pelo painel: precisa estar ligado a uma **proposta do CRM** (busca pelo número, cliente ou título). Só admin pode marcar “sem proposta”, com motivo.

### Vai ter serviço da nossa equipe? (Mix / Mercantil / Serviços)

No PV a pergunta **“Vai ter serviço da nossa equipe?”** é obrigatória — sem resposta o pedido não grava. Ela existe porque às vezes a instalação não está na proposta, mas é o nosso pessoal que vai fazer.

| Resposta | Tipo da venda | O que acontece |
|---|---|---|
| **Sim** (instalação, visita) | **Mix** | o pedido aparece no **Painel de Vendas** do app de Serviços para gerar a OS e agendar; entram os alarmes de serviço |
| **Não** (só material) | **Mercantil** | só entrega de material |
| OS (só serviço) | **Serviços** | já vem marcado — a OS é serviço |

Para corrigir um PV já criado (ex.: era Mix e ficou Mercantil): abra o pedido em **ERP → Vendas**, troque a resposta para **Sim** e clique **Gravar** (só enquanto o pedido está aberto). O antigo campo “Vendedor” era isto — o tipo da venda.

> **Atenção:** a numeração é única e sequencial (próximo PV e próxima OS). Não crie PV/OS no Omie — o número pode repetir.

### OC do cliente e anexos do PV/OS

- O cartão do pedido (Avulsos, nas vistas **Lista** e **✎ Edição**) mostra, embaixo do cliente, o **nº da OC do cliente** (ex.: **OC 4500931962**) e o clipe **📎** com quantos anexos o PV/OS tem.
- Clique no **📎** para ver os anexos, **subir arquivo** (PDF, imagem, Office, e-mail — até 25 MB) ou **colar um link**. Marque se o anexo é a **OC do cliente** ou **outro**. O **✕** remove.
- Na mesma janela dá para **corrigir o nº da OC**. Em PV/OS do Omie o número fica guardado no painel — **o Omie não é alterado**. Em PV/OS do painel, o nº também se edita no campo **Pedido / OC do cliente** do documento.
- A OC e os anexos que entram pelo **CRM** aparecem aqui sozinhos (origem "CRM").
- Os mesmos anexos aparecem em **ERP → Vendas** (gaveta do documento), no detalhe do PV/OS do painel (bloco **Anexos**) e no **Faturamento**.

## Perguntas frequentes

**Não acho um pedido em Avulsos.** Confira a aba (Em aberto/Faturados/Todos) e limpe os filtros rápidos.

**Não acho um projeto em Projetos.** A lista abre em **★ Só ativos** — clique em **Todos**, ou procure pelo menu **★ Projetos ativos** (digitando, ele também acha os não marcados).

**A margem não aparece.** A M.B. só é calculada quando o pedido tem compras (PCs) ligadas.

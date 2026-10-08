---
titulo: Operação
resumo: Avulsos, projetos, PCs e pedidos de venda — o dia a dia da operação.
icone: 📋
area: operacao
rotas: /avulsos, /projetos, /pcs, /erp/vendas
caminhos: web/components/BoldAvulsosView.tsx, web/components/projeto, web/components/operacao, web/app/(app)/avulsos, web/app/(app)/projetos, web/app/(app)/pcs, web/app/(app)/erp/vendas, web/components/vendas
atualizado: 2026-10-08
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

### Resumo e Fluxo de caixa do projeto

**1 Resumo** mostra só o **fechamento do CRM**: no topo a proposta (OPJ…), o cliente e o **valor fechado** em destaque (com as saídas previstas e a sobra), os botões **▦ Baixar CP/MC Excel**, **⟳ Gerar atualizado** e **abrir no CRM ↗**; embaixo, os blocos **Projeto** (início, prazo, entrega prevista, quando saem mão de obra e despesas), **Por conta de quem** (frete, deslocamento, instalação e impostos — selo âmbar = por nossa conta), **Custos considerados** (materiais da RC, mão de obra, frete, demais despesas, total e a barra de composição) e **Recebimento** (parcelas com faturamento → pagamento). Projeto sem fechamento no CRM mostra as premissas do plano.

**4 Fluxo de caixa** abre com:
- **Aprovação do fluxo** (barra no topo, antes ficava no Resumo): Rascunho / Aguardando / Aprovado / Rejeitado, com **Enviar para aprovação**, **Aprovar fluxo**, **Rejeitar**, **Reabrir** e o **Histórico**. É ela que libera a aprovação dos PCs do projeto, como antes.
- **Os números** (inicial × em andamento): entradas, saídas, resultado, **menor saldo** (e quando), e o desvio de **prazo** das entradas e das saídas em dias (+ = atrasou / ficou para depois).
- **O gráfico**: por **semana** ou **mês** (Auto escolhe pelo tamanho do projeto). Barras para cima = entradas, para baixo = saídas; **contorno** = fluxo **inicial**, **cheia** = fluxo **em andamento**. A linha tracejada é o saldo acumulado inicial; a cheia, o em andamento. Marcados: o **menor saldo** de cada linha, o **maior desvio** entre as duas e **hoje**. Passe o mouse num período para ver entradas, saídas e saldo — inicial, atual e a diferença.
- **Fluxo inicial** = a foto do plano do fechamento na primeira importação (parcelas na data inicial, agenda de saídas da planilha). **Não muda** quando o CRM reimporta; se a proposta foi revisada, aparece o aviso e só o **administrador** pode **redefinir fluxo inicial**.
- **Fluxo em andamento**: **entradas** = cada parcela na data atual (vencimento do título se já faturou; senão a nova previsão de recebimento dos PV/OS; senão a inicial). **Saídas** = **PCs** do projeto (sem escondidos, cancelados e reprovados) nas parcelas do PC, ou previsão de entrega + prazo da condição; + linhas da **Lista sem PC** (estimado, no “Necessário em”); + saídas do plano que **não são material** (obra, despesas). **Sem contar duas vezes**: quando o projeto tem PC ou Lista, a saída de **material** do plano sai do andamento (os PCs e a Lista a substituem). O que já foi **baixado** (recebido/pago) entra na data da baixa e abate o previsto em ordem de data; previsto vencido e não baixado conta como **hoje**.
- Embaixo, recolhíveis (clique no título): **Entradas**, **Saídas** (com a coluna **Δ vs inicial** — dias que a data andou e diferença de valor; “novo” = não existia no inicial) e **Budget × pedidos de compra** (o antigo “Execução da despesa” do Resumo — requisitado, aprovado e pago contra o budget).

### Lista de materiais, compras e budget do projeto

Tudo fica numa aba só: **Lista de materiais** (a antiga aba “Compras × lista” entrou nela). Na linha do projeto, **📂 Abrir projeto** leva até ela.

**O caminho**: a **RC** (composição de preço da proposta) é a referência e a origem do **budget de materiais**. **⤵ Importar itens da RC** uma vez e casar com o nosso código; depois a lista é o que se compra — exclua itens da RC que não vão, inclua os novos. Da lista saem os **pedidos de compra**; os PCs se acompanham em **Operação › Projetos** (por PC) e aqui, item a item.

**Resumo no topo** (um bloco só):
- **Budget de materiais** = total de **materiais** da RC (a linha “materiais” do Custo planejado). O budget fica **🔒 trancado**: só o Benny destranca (🔓) e define o valor (**editar**, para projeto antigo cuja RC não veio do CRM) ou volta ao da RC (**usar o da RC**). O mesmo cadeado vale para o teto do Fluxo de caixa. Não é o custo total do projeto (materiais + mão de obra + despesas) — esse continua sendo o teto do Fluxo de caixa.
- **Lista prevista** = PCs do projeto + o estimado das linhas que ainda não têm PC, e quanto isso é do budget (%).
- **Pedidos de compra**: **aprovados** e **aguardando aprovação** (R$ e % do budget), e o **pago**.
- A linha de situação diz **Dentro do budget · sobra R$ X** ou, em vermelho, **Estoura o budget em R$ X**. A barra mostra, na mesma escala, aprovados, aguardando, o que ainda falta comprar e a marca do budget.
- O estimado de cada linha é o **Valor unit.** da linha; vazio, o sistema preenche com o preço do **PC**, senão o **último preço do catálogo**, senão o **custo da RC**. O mesmo budget e a mesma lista prevista aparecem no cartão do projeto em Projetos e valem na aprovação dos PCs. PCs escondidos (“Excluir PC”) não contam.

**Aprovação dos PCs do projeto (PJ…)**: não depende da alçada da área nem do fluxo aprovado (o fluxo o Benny aprova à parte). Quem tem a permissão de aprovar compras do projeto aprova o PC quando o **projeto inteiro cabe no budget de materiais** (comprometido + este PC ≤ budget). Se estourar, só um administrador aprova — os demais veem “estoura o budget do projeto em R$ X — fica pendente para os administradores”. A Aria não aprova PC de projeto. Projetos-conta do Omie (41_VP, 47_CONTRATUAL…) seguem a regra de sempre.

**Pelo Compras**: no pedido de compra com projeto **PJ…**, o botão **📋 Puxar itens da Lista de materiais** (aba Itens) abre as linhas da lista sem PC (filtro por grupo e fornecedor); as escolhidas viram itens do pedido (código nosso, descrição, qtd e valor da lista, editáveis) e, ao salvar, cada linha fica ligada ao seu item — igual ao “Gerar pedido de compra” da lista. Trocar o fornecedor não desfaz os vínculos.

**Comprar pela lista**: marque as linhas sem PC e clique **🧾 Gerar pedido de compra** — abre uma folha com **um pedido por fornecedor** (o fornecedor sugerido de cada linha agrupa; dá para trocar), com preço, quantidade, categoria, condição e previsão (o “Necessário em” mais cedo do grupo) editáveis. **Simular** confere tudo sem gravar. Os PCs nascem pelo caminho de sempre do Compras (numeração, aprovação, avisos) e cada item já fica ligado à sua linha da lista. **⤵ Importar da RC o que falta (N)** traz os itens da **RC** (a composição de preço da proposta) que ainda não estão na lista, cada um já casado com o nosso catálogo: resolva o ⚠ conferir / sem correspondência em **No catálogo** (sugestões, busca, Criar item nosso), marque o que entra (sem código entra âmbar, para resolver depois; desmarque para pular) e adicione. Se a RC já foi lançada em Compras, os itens vêm ligados a ela. Numa linha, o **RC** discreto na célula do Item (passe o mouse) usa um item da RC ainda não usado (descrição, qtd, equipamento e custo da RC, passando pelo catálogo). Item digitado ou buscado livremente é **novo**. Para subir a lista inteira de uma planilha (uma aba por equipamento), use **📋 Subir planilha** no canto da aba.

> No projeto, **RC e CP (composição de preço) são a mesma coisa** e o nome usado é **RC**: os itens da RC são os da composição de preço da proposta; o nº mostrado é o do documento em Compras.

**Margens do projeto** (na linha do projeto e no projeto aberto, lado a lado):
- **Margem projetada** = (PV − budget de materiais da RC) ÷ PV.
- **Margem real** = (PV − PCs aprovados) ÷ PV — cada PC uma vez; passe o mouse para ver como fica se os PCs aguardando aprovação forem aprovados.
- O antigo **M.B.** somava os PCs **e** os itens da RC sem PC; no projeto os PCs saem da Lista sem ligar à RC, e a mesma compra contava duas vezes (o PJ361 aparecia com −16%). Nos Avulsos o M.B. continua como era. No bloco de budget do projeto, **Result. esp.** é o resultado esperado do fechamento do CRM (venda − materiais − mão de obra − despesas) — não é a margem de materiais.

**Vendas (PV/OS)** (no projeto aberto, à esquerda): os PV/OS gerados para o projeto — nº (abre no Faturamento) e **parcela N** na mesma linha, o evento embaixo, valor e % do total (a soma confere com o PV do projeto), situação (a faturar / faturado com NF ou recibo / recebido) e OC do cliente. Em **faturamento** e **recebimento**, em cima fica sempre a **data vigente** (a nova previsão, ou a inicial quando não mudou) — clique nela para mudar. Embaixo: **= inicial** quando não mudou; se mudou, o campo fica com borda âmbar e aparece **inicial ~~dd/mm/aaaa~~ +Nd** (+N vermelho = atrasou, −N verde = adiantou). A **previsão inicial** vem do resumo financeiro do projeto e não muda. Escolher de novo a data inicial (ou clicar **↺**) apaga a nova previsão. Já faturado: em cima “dd/mm/aaaa faturado”.
- A nova previsão de **faturamento** é a mesma da carteira do Faturamento (“Previsão fat.”). Mudá-la leva o recebimento junto (mesmo prazo), se o recebimento não tiver nova previsão própria — um aviso no canto da tela confirma.
- Do projeto (aba Lista de materiais), **mudar datas em Operação › Projetos →** abre esta tela já com o cartão do projeto aberto.
- A nova previsão de **recebimento** é a data da parcela no **Fluxo de caixa** do projeto (a reimportação do CRM não apaga). Já faturado: muda o vencimento do título a receber (precisa de “Editar título” no Financeiro). ↺ volta à inicial.
- PV/OS antigos do Omie aparecem com as datas do Omie; o Omie nunca é alterado.

**Projetos › projeto aberto**: em cima, o resumo (budget de materiais, projetado, comprometido, pago e as margens **projetada** × **real**). Embaixo, lado a lado como na linha aberta dos Avulsos (em tela estreita, um embaixo do outro): à esquerda **Vendas (PV/OS)** — ver acima — e à direita **Pedidos de compra**, uma linha por PC: nº (abre o PC), fornecedor, valor, aprovação, Prev. material (atraso em vermelho), **situação** (uma pílula, cores do Compras), NF de entrada e **💬** (comentários do PC, com quem escreveu e quando — ficam no histórico do pedido no Compras). No **⋯**: todos os campos do PC, **Ver itens na Lista de materiais** e a marcação do material à mão. Esta tela não mostra RC: as RCs, o valor delas e o **Gerar pedido de compra** ficam na **Lista de materiais**.

**Previsão do material**: é a do PC. Mudar a “Prev. material” na Operação › Projetos grava a previsão do próprio PC quando ele nasceu no painel (com registro no histórico do PC); PC importado do Omie guarda a remarcação, e a folha do PC no Compras mostra “remarcada para dd/mm”.

**Montar a lista** (**Lista**) — colunas: # · **Orig.** (selo **RC** quando a linha veio da RC; vazio = item novo) · Equipamento · **Código** · Item · Qtd · Un · Necessário em · Valor unit. · **Projetado**, e à direita (fundo azul claro) **PC** · **Situação** · Fornecedor · **Comprado (PC)** · **Δ** · **💬**.
- **Projetado** = Qtd × Valor unit. (quanto se espera gastar). **Comprado (PC)** = valor da linha deste item no pedido de compra. **Δ** = Comprado − Projetado: verde abaixo, vermelho acima. **≠** no Comprado avisa que a quantidade do PC é diferente da lista (passe o mouse).
- **💬 Comentários** (substitui a coluna Observação): clique no balão para ver e escrever comentários — cada um guarda quem escreveu e quando; o número no balão é a quantidade. A observação antiga da linha aparece como primeiro comentário. Cada linha ocupa uma linha só (passe o mouse para ver o texto inteiro); ao rolar para o lado, as colunas até o Item ficam presas.
1. Digite o item: o catálogo sugere primeiro os **itens do nosso estoque** (código novo, como no Faturamento) com **último preço pago, fornecedor e prazos**; código de compra já vinculado aparece como “cód. compra X”. Linha antiga com código do Omie que já tem item nosso passa a mostrar o código novo.
2. **Sugestão de código**: quando o catálogo acha um item provável (60% ou mais de semelhança), a sugestão aparece **dentro da célula Código**, numa caixa tracejada âmbar com o código, a descrição, o % e o fornecedor — ainda **não** é código: não conta como casado e não vai para o PC. **✓** aceita (vira o código da linha e ensina o de-para, para o mesmo texto casar sozinho da próxima vez) e **✕** recusa (a linha fica sem código e o catálogo **não volta a sugerir** para ela); clicar no texto da caixa abre o seletor para escolher outro. A sugestão e a recusa ficam **gravadas na linha**: recarregar a página, gerar ou vincular PC e salvar não as apagam. Linha nova, colada ou que só tem produto do Omie ganha sugestão sozinha alguns segundos depois; se a busca no catálogo falhar, aparece **Não consegui buscar sugestões · tentar de novo**. **⚠ Revisar sugestões (N)** abre uma tela com cada linha × sugestão (trocar pela outra candidata, procurar outro, recusar, aceitar as marcadas); **✓ Aceitar todas as sugestões (N)** aceita de uma vez (com Desfazer), e com linhas marcadas **Aceitar sugestões dos marcados**. Filtro **Sugestões a aceitar**. A barra mostra ✓ com código · ⚠ sugestão · ⌕ sem código.
2. **Código**: sempre o do nosso estoque (nunca o do Omie). O ícone ao lado diz a situação — **✓** casado, **⚠** conferir, **⌕** sem código (célula âmbar). Clique no ícone para **escolher**: sugestões com %, busca por nome/código ou **Criar item nosso** (família e próximo código; serviço → família SV). A escolha fica gravada para aquele texto — da próxima vez casa sozinho.
3. Casada, a linha mostra no **Item** a descrição do catálogo; o texto original (e o modelo, se houver) aparece ao passar o mouse e volta ao editar.
4. A lista **salva sozinha** alguns segundos depois de cada mudança — linha nova já ganha PC, situação, caixinha e 💬 logo depois de salvar, sem F5. Quando **não** puder salvar sozinha (lista recuperada do navegador, linhas a menos que no sistema, exclusão que falhou), aparece **⚠ não está salvando: motivo** com o botão **Salvar lista**. Mudar o texto do item ou o grupo de uma linha que já existe **não** cria linha nova: o vínculo com RC/PC e os comentários continuam. **+ Adicionar linha** (em cima) ou **+ linha** (embaixo) cria uma linha nova.
   - **Excluir**: o **🗑** no fim da linha (passe o mouse) ou marque várias e clique **🗑 Excluir N linhas**. Aparece **Desfazer** por alguns segundos; depois grava sozinho. O que sai vai para **Itens removidos** (recuperável). O PC de uma linha excluída não muda.
5. Colar do Excel sem cabeçalho segue a ordem **Equipamento · Item · Qtd · Un · Necessário em · Valor unit.**; com a linha de cabeçalho, as colunas vão pelo nome (inclusive **Código, Modelo, PC e Observação** — a observação vira comentário). O Exportar Excel junta os comentários na coluna Observação. Código nosso, antigo ou de compra já ligado resolve a linha direto. **⚡ Casar com o catálogo** acha o resto (escolhas feitas à mão não mudam).
6. **Valor unit.** vazio é preenchido do PC, do catálogo ou da RC — a origem aparece pequena na célula (PC / cat. / RC).

**Itens da RC**: o registro do plano original (a RC dá a ideia inicial e o budget). Mostra cada item com qtd, custo e total, e se está **na lista** (com o código nosso e a linha) ou **não usado**, e o total do plano × o que está na lista. Para mandar para a lista: **→ lista** num item, ou **⤴ Exportar para a lista os que faltam (N)** — abre o importar com eles marcados, para conferir o código antes de adicionar. Na barra da Lista, o mesmo botão à vista: **⤵ Importar da RC o que falta (N)** (apagado quando a lista já tem todos). No topo da Lista, a faixa **Vendas (PV/OS)** mostra os documentos do projeto e a previsão de faturamento (as datas se mudam em Operação › Projetos).

**Chega a tempo?** Ao lado de “Necessário em” fica a **Chegada prev.**: a previsão do PC, a data do recebimento (“recebido”) ou, sem PC, **≈ dd/mm** em itálico (hoje + prazo médio do catálogo). Quando a previsão do PC já passou e nada chegou, a data aparece em vermelho com **PC atrasado N d**. O sinal ao lado compara a chegada com a necessidade: **✓** chega com folga (3 dias ou mais), **⚠** menos de 3 dias de folga ou PC sem previsão, **✕** chega depois do necessário (ou o necessário passou sem receber). PC atrasado conta como “chega hoje” nessa conta — a dica explica, por exemplo: “chegada efetiva hoje (PC atrasado 19d) · necessário 15/10 · folga 8d → ✓”. Filtros **⚠ Em risco**, **✕ Atrasados** e **PC atrasado** junto de Todas / Sem PC / Com PC; cada grupo mostra quantas linhas estão em risco ou atrasadas (também no painel Datas por grupo).

**Grupos de equipamento e “Necessário em”**: os chips acima da lista filtram por grupo e mostram a data do grupo (“necessário 31/10” ou “sem data”). **📅 Datas por grupo** abre o painel com um grupo por linha: data, quantas linhas têm **data própria**, a sugestão (entrega prevista da proposta) com **aplicar**, **Aplicar a todos os grupos sem data** e **≈ Nome** para usar o nome padrão do cadastro. A data do grupo preenche as linhas dele; linha nova herda. Filtros **Todas / Sem PC / Com PC** combinam com o grupo. A data da linha é a que vai para o pedido de compra (previsão) e para o fluxo.

**Comprar e acompanhar**:
- **PC**: o número do pedido em destaque (clique abre o pedido). Número digitado na lista que não está vinculado aparece como **sug. 6405** (tracejado) — é só sugestão: clique para vincular.
- **Situação ⓘ**: o estado real do pedido (aprovação + etapa), com as mesmas cores no painel inteiro (lista, Compras e /pcs): 🟧 **Aguardando aprovação** · 🟦 **Aprovado** · **Enviado ao fornecedor** (anil) · **Faturado** (roxo, NF emitida, a caminho) · **Recebido** / **Recebido parcial** (verde-água) · 🟩 **Conferido** · 🟥 **Reprovado / Cancelado**. A dica traz a data do estado, a NF e quem aprovou; **✕** desfaz vínculo por código, descrição ou manual. Linha sem PC mostra **+ vincular**: itens de PC do projeto parecidos com a linha (**Vincular**) ou **Procurar PC por número ou fornecedor**.
- **Fornecedor**: o do PC; sem PC, o sugerido pelo catálogo (em itálico) com entrega/fatura médias. **Comprado**: valor da linha do PC (**≠** quando a quantidade do PC difere da lista).
- Linha ligada só pelo **número do PC** também mostra valor: o sistema acha a linha do item dentro do PC (código, senão descrição).
- Marque as linhas e clique **🧾 Gerar pedido de compra**; **⇄ Vincular PCs automaticamente** liga as linhas aos PCs do projeto — o que sobrar fica com **+ vincular PC** na própria linha.
- Abaixo da lista: o **Fluxo de compras do projeto** mês a mês. Itens de PCs do projeto que nenhuma linha cobre: **⋯ › Ver PCs com itens fora da lista** (já contam no comprometido).

**Cartão “Custo planejado”** (topo do projeto): a barra mostra a composição e a legenda traz o valor de cada parte — materiais, obra e despesas, em R$ e %.

## Pedidos · PV/OS

- **PV** = venda de produtos (sai NF-e). **OS** = serviço (sai recibo ou NFS-e).
- Em **ERP → Vendas** você vê os PV/OS do painel e do Omie. Admins veem a chave **“CRM cria PV/OS: no Omie / no painel”**.
- **Novo PV/OS** pelo painel: precisa estar ligado a uma **proposta do CRM** (busca pelo número, cliente ou título). Só admin pode marcar “sem proposta”, com motivo.

> **Atenção:** a numeração é única e sequencial (próximo PV e próxima OS). Não crie PV/OS no Omie — o número pode repetir.

### OC do cliente e anexos do PV/OS

- O cartão do pedido (Avulsos, nas vistas **Lista** e **✎ Edição**) mostra, embaixo do cliente, o **nº da OC do cliente** (ex.: **OC 4500931962**) e o clipe **📎** com quantos anexos o PV/OS tem.
- Clique no **📎** para ver os anexos, **subir arquivo** (PDF, imagem, Office, e-mail — até 25 MB) ou **colar um link**. Marque se o anexo é a **OC do cliente** ou **outro**. O **✕** remove.
- Na mesma janela dá para **corrigir o nº da OC**. Em PV/OS do Omie o número fica guardado no painel — **o Omie não é alterado**. Em PV/OS do painel, o nº também se edita no campo **Pedido / OC do cliente** do documento.
- A OC e os anexos que entram pelo **CRM** aparecem aqui sozinhos (origem "CRM").
- Os mesmos anexos aparecem em **ERP → Vendas** (gaveta do documento), no detalhe do PV/OS do painel (bloco **Anexos**) e no **Faturamento**.

## Perguntas frequentes

**Não acho um pedido em Avulsos.** Confira a aba (Em aberto/Faturados/Todos) e limpe os filtros rápidos.

**A margem não aparece.** A M.B. só é calculada quando o pedido tem compras (PCs) ligadas.

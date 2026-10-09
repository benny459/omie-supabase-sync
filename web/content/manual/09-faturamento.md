---
titulo: Faturamento
resumo: Carteira de PV/OS, emissão de NF-e (venda, devolução e remessa) e recibo, NFS-e da prefeitura e contratos recorrentes.
icone: 🧾
area: erp
rotas: /faturamento
caminhos: web/components/faturamento, web/app/(app)/faturamento, web/app/api/faturamento, web/lib/faturamento
atualizado: 2026-10-09
---

> **Atenção:** a **NF-e da SF está em PRODUÇÃO** — o que você emitir é documento fiscal real. A numeração é sequencial e automática (NF-e, recibo, PV e OS continuam de onde o Omie parou). **Não emita mais NF-e nem recibo pelo Omie.**

## A carteira (Pedidos & Ordens de Serviço)

- Escolha **Todos / PV · Produto / OS · Serviço** e o **Período** (Mês, Trimestre, Ano, 12 meses, Tudo). Os filtros ativos aparecem como etiquetas com **×** e **Limpar filtros**.
- Ao **buscar** (cliente, nome fantasia, PV, OS, OC, NF), a busca procura em **todos os períodos**. Se a consulta demorar, aparece "A consulta demorou demais — tente de novo".
- Colunas principais:
  - **Cliente**: nome fantasia em destaque e a razão social embaixo.
  - **Emissão**: data do PV/OS e, se ainda não faturado, **há N dias**.
  - **Previsão fat.**: quando deve ser faturado — **clique para mudar**. Alerta **atrasado N dias** ou **vence em N dias**.
  - **Recebimento**: **recebido**, **a receber**, **vencido** ou **parcial**, com a data.
- Visões: **Lista, Kanban, Emissões, NFS-e registradas**. Filtro rápido **Previsão atrasada** e **OS sem NFS-e**.
- Clique num documento para abrir a gaveta. Ela mostra **o que vai sair na nota**: destinatário completo (CNPJ, IE, endereço, município/IBGE, e-mail, com **editar cadastro**), recebimento (condição, forma de pagamento, conta, parcelas com datas e valores, instrução de Pix/banco), operação (natureza, CFOP, frete/transportadora, OC, projeto, vendedor), itens com NCM e CFOP e as **informações complementares exatamente como saem**. Pendências (falta IE, CEP, IBGE, e-mail, NCM, forma de pagamento) aparecem no topo.
- A gaveta também traz as notas (DANFE, XML, recibo — inclusive os antigos do Omie), recebimento e histórico.
- **OC do cliente e anexos:** na coluna Cliente aparece **OC nº** (ou "sem OC") e o clipe **📎** com o número de anexos — clique para ver ou anexar. Na gaveta, a seção **OC do cliente e anexos** permite corrigir o nº da OC (nos do Omie fica guardado no painel, sem mexer no Omie), subir arquivo ou colar link.

> **Importante:** não existe mais "Emitir" direto na lista ou na gaveta. O botão é **Revisar e emitir**: abre a folha completa já preenchida, onde você confere e edita tudo antes de emitir.

## Como ver a nota antes de emitir (prévia do DANFE)

- Na gaveta, clique em **Pré-visualizar DANFE** (PV) ou **Pré-visualizar recibo** (OS).
- Na folha de emissão, o mesmo botão mostra o documento **com o que você editou**.
- A prévia abre numa aba nova, no leiaute oficial do DANFE, com a marca **PRÉVIA — SEM VALOR FISCAL** e o número previsto (ex.: nº 2193). **Nada é enviado à SEFAZ e nenhum número é gasto.** Use **Imprimir / salvar PDF** se quiser guardar.

## Como faço para emitir uma nota nova

1. Clique em **+ Nova emissão**. Abre uma janela própria.
2. Escolha **Novo documento** (ou **Faturar um PV/OS existente**, buscando pelo número/cliente).
3. Escolha o **Tipo de documento**:
   - **NF-e (venda de produtos)** — gera o PV e a NF-e;
   - **Recibo de serviço (OS)** — gera a OS e o recibo;
   - **NFS-e da prefeitura (registrar)** — gera a OS; a NFS-e você registra depois.
4. O quadro **Será gerado** mostra os números (ex.: “OS nº 4885 · Recibo nº 4646”) — confirmados na emissão.
5. Busque a **Proposta do CRM** (puxa cliente, itens e condição) e/ou o **cliente** pelo nome, fantasia ou CNPJ.
6. Ao escolher o cliente, aparecem os **últimos faturamentos**. **Usar como modelo →** copia itens, prazos e forma de recebimento, recalculando as datas a partir de hoje.
7. Em **Recebimento**, a **condição de pagamento** já vem do PV/OS (ex.: "Para 28 dias") e gera as parcelas. Depois escolha a **forma** (boleto, Pix, transferência…) e a **conta**. As parcelas herdam a forma; marque **formas diferentes por parcela** só se precisar. Com **Pix** ou transferência, os dados da conta saem no documento.
8. **Projeto** e **categoria de receita** são **obrigatórios** — vêm do PV/OS (CRM); se faltarem, a emissão fica bloqueada até você escolher (ou criar o projeto em **+ Novo projeto**). Para boleto, Pix e transferência a **conta de recebimento** também é obrigatória. A **forma de recebimento** (boleto, Pix, transferência…) e a **conta** escolhidas no CRM ao criar o PV/OS já chegam preenchidas aqui.

**Itens com busca no catálogo:** em cada linha de item, digite parte do **nome ou do código** (novo ou do Omie) e escolha da lista. A linha já vem com código, descrição, NCM, unidade e o valor: na **simples remessa, conserto e devolução** pelo **custo médio (CMC)** — ou a última compra; na **venda**, pelo último preço vendido a esse cliente. Abaixo aparecem o CMC, a última compra e o **disponível em estoque** (em vermelho se a quantidade passar dele). Tudo continua editável.
8. Confira a **Prévia das contas a receber**, clique em **Pré-visualizar DANFE** (ou recibo) para ver o documento, depois **Validar** e, por fim, **Emitir**.

## Como faço para emitir o recibo de uma OS (inclusive OS do Omie)

A maioria das OS fatura por **recibo**, emitido **pelo painel** — também as OS que nasceram no Omie. Nada é gravado no Omie.

1. Abra a OS na carteira (busque pelo cliente ou pelo número, ex.: **OS4729**).
2. Clique em **Revisar e emitir recibo** (botão principal). Se a OS foi faturada por **NFS-e** da prefeitura, use **Registrar NFS-e** (botão secundário) em vez do recibo.
3. A folha abre **já preenchida e editável**: cliente, itens, **condição e parcelas (vencimentos)**, **forma de pagamento**, **conta** (a dos "DADOS BANCÁRIOS" da OS, ex.: Bradesco ag. 0368 c/c 266910-2), **categoria**, **projeto** (obrigatório), retenções (ISS/INSS) e observações. Mude o que precisar.
4. **Pré-visualizar recibo** mostra o documento com o que você editou; **Validar** confere tudo.
5. **Emitir** gera o recibo com a numeração do painel (continua de onde o Omie parou, ex.: nº 4646), cria as **contas a receber** com as parcelas da folha e marca a OS como **faturada no painel**.
6. A mesma OS **não pode ser faturada duas vezes**: se já tem recibo (do Omie ou do painel) ou NFS-e registrada, a emissão é bloqueada.

**O que sai no recibo:** emissão, cliente (um e-mail por linha), objeto e totais, vencimentos e o bloco **Pagamento** — forma de pagamento e os dados da conta escolhida: **banco, agência e conta** sempre que a conta os tiver e, se a forma for PIX, também a **chave PIX** (cadastre-a em **Cadastros › Bancos e contas**). Recibos já emitidos abrem no layout atual, com o bloco Pagamento completado.

> **Teste sem gastar número:** administradores podem marcar **Teste (forçar homologação)** na folha — sai um recibo de teste, sem usar a numeração real.

## Como faço para emitir vários recibos de uma vez (em lote)

1. Na busca da carteira, digite **os números separados por vírgula** (ou espaço / ponto e vírgula), ex.: **4729, 4735, 4738** ou **OS4729, OS4735**. A lista mostra só esses documentos, de todos os períodos.
2. Marque a caixa do cabeçalho para **selecionar todos** os que aparecem (ou marque um a um).
3. Na barra de seleção, clique em **Emitir N recibos**.
4. Abre a lista de conferência: para cada OS, o valor a receber, o vencimento, a **forma e a conta** (as mesmas que a folha "Revisar e emitir recibo" usaria — a conta dos dados bancários da OS ou a do último faturamento do cliente), o **projeto** e a **categoria**.
   - OS que **não podem** sair (já têm recibo ou NFS-e, falta projeto/categoria, PV que fatura por NF-e) ficam em vermelho, com o motivo, e **não entram no lote**. Use **abrir na folha** para corrigir uma a uma.
5. Clique em **Emitir N recibos** e confirme. Os recibos saem **um de cada vez, na ordem da lista**, com a numeração sequencial do painel, as contas a receber e o bloco Pagamento — exatamente como na emissão avulsa.
6. No fim, os recibos **já baixam sozinhos em PDF — um arquivo por recibo**, com o nome do recibo (ex.: *Recibo de Prestação de Serviço nº 0000004646.pdf*). Não abre tela de visualização. Se o navegador perguntar, **permita vários downloads**; se ele barrar, use **Baixar todos (.zip)**. Cada linha mostra o **nº do recibo** e o link **ver recibo**; **Baixar PDFs de novo** repete o download.

> Para mudar forma, conta, vencimento ou observação de uma OS antes de emitir, use **abrir na folha** — o lote usa os dados como estão.

**Baixar recibos já emitidos em lote:** OS **já faturadas** também podem ser marcadas (o botão de emitir ignora-as). Com elas selecionadas aparece **Baixar N recibos (PDF)**: sai **um PDF por recibo**, já com o nome do recibo — do painel ou do Omie. Se o navegador barrar vários downloads, clique em **.zip** ao lado.

**Um recibo só:** na gaveta da OS, **Recibo (PDF)** baixa o arquivo; **ver** abre no navegador.

## Faturar projeto por parcela do fechamento

PV e OS de **projeto** criados pelo CRM a partir do **Fechamento** trazem as parcelas combinadas com o cliente — cada uma com **nome** (ex.: "Contra Entrega do Material"), **valor**, **data prevista de faturamento** e **vencimento**. O PV leva as parcelas mercantis e a OS as de serviço.

1. Na carteira, a coluna **Previsão fat.** mostra a data da **próxima parcela por faturar** (e o filtro **Previsão atrasada** usa essa data).
2. Abra o PV/OS: a gaveta mostra **Parcelas do fechamento** — nome, valor, %, "fatura em", "vence em" e se já foi **faturada**.
3. Clique em **Revisar e emitir**. A folha abre já com a **próxima parcela** marcada em **Parcela do fechamento**:
   - o **valor da nota = valor da parcela** (os itens do escopo são ajustados proporcionalmente, mantendo NCM/CFOP/serviço);
   - o nome da parcela vai na descrição do item e nas observações ("Parcela 1/3 — Contra Entrega do Material…");
   - o **recebimento** usa o mesmo prazo do fechamento (vencimento − data de faturamento), contado a partir da data da nota.
   Para faturar outra parcela (ou duas juntas), marque/desmarque na lista — a folha se remonta sozinha.
4. **Emitir** (NF-e no PV; recibo na OS). A parcela fica **faturada**, o saldo do documento cai e ele continua na carteira até a última parcela. Se a nota for cancelada, a parcela volta a "a faturar".
5. **OS faturada por NFS-e da prefeitura:** em **Registrar NFS-e**, escolha a parcela que a nota fatura — o valor e o prazo vêm dela. Dá para registrar uma NFS-e por parcela.

> Proteções: a mesma parcela não pode ser faturada duas vezes, e a nota precisa valer exatamente a soma das parcelas escolhidas.

## Como faço para mudar forma de pagamento, conta ou outro dado da nota

1. Clique no PV/OS na carteira. A gaveta mostra **"O que vai sair na nota"**.
2. Em cada bloco (Destinatário, Recebimento, Operação e transporte, Itens, Informações complementares) há o botão **editar ✎**.
3. Ele abre a emissão (**Revisar e emitir**) já na seção certa, destacada.
4. Em **Recebimento**, no topo, escolha a **Forma de recebimento** (boleto, PIX, transferência…) e a **Conta de recebimento**. A instrução de pagamento sai na nota e em cada parcela.

> **Dica:** se o pedido não tem forma/conta, a emissão herda as do **último faturamento do cliente** — confira antes de emitir.

## Como faço para salvar uma nota como rascunho e continuar depois

1. Na folha de emissão, clique em **Salvar rascunho** (ao lado de Cancelar). Nada é emitido e nenhum número (PV, OS, NF-e, recibo) é reservado.
2. A folha também **salva sozinha a cada ~20 segundos** quando algo mudou, e ao **fechar sem emitir** — o rodapé mostra "rascunho salvo às hh:mm".
3. Para continuar: aba **✎ Rascunhos** (ao lado de NFS-e registradas) → **Continuar**. A folha reabre exatamente como estava.
4. Ao reabrir, o sistema **revalida** a nota e avisa o que mudou desde o rascunho (ex.: "o CMC mudou", saldo do estoque menor que a quantidade).
5. Um PV/OS da carteira com rascunho aparece com o selo **rascunho**; em **Revisar e emitir** você escolhe continuar o rascunho ou começar do zero.
6. Na lista de rascunhos também dá para **Duplicar** (usar como base para outra nota) e **Descartar**. Depois de emitida, a nota sai da lista sozinha.

> **Dica:** o número definitivo só é definido na hora de emitir — dois rascunhos nunca "brigam" pelo mesmo número.

## Depois de emitir

A janela acompanha: **1 · Enviando à Focus → 2 · Processando na SEFAZ → Autorizada** (ou Rejeitada).

- **Autorizada**: número/série, **chave de acesso**, protocolo, **DANFE**, **Baixar XML**, **Consultar na SEFAZ** e as **contas a receber criadas**.
- **Rejeitada**: o motivo em português e **Corrigir e reenviar** (o formulário continua preenchido).

### Como faço para enviar a nota ou o recibo ao cliente

**Nada é enviado sozinho.** Com o documento autorizado, clique em **✉ Enviar ao cliente**. O botão fica na janela de emissão e na carteira, quando o pedido está 100% faturado. Abre a mesma janela de envio do pedido de compra:
1. **Para** vem com os e-mails do cadastro do cliente. Dá para tirar, acrescentar, e usar **Cc** e **Cco**.
2. **Assunto** e **Texto complementar** são editáveis. O assunto segue o padrão do Omie: *SAFE WATER BRASIL LTDA - Recibo de Prestação de Serviço nº …*.
3. Vão anexados o **DANFE (PDF) e o XML** da NF-e, ou o **recibo em PDF**. Dá para incluir mais um anexo, como o boleto.
4. **👁 Visualizar o arquivo** mostra o PDF. **✉ Enviar agora** manda.

**De onde sai:** *WaterWorks Faturamento <noreply@waterworks.com.br>*. Se o cliente clicar em responder, a resposta vai para quem enviou. Todo envio vai com **cópia oculta para o contasareceber@ e para quem enviou**, com os anexos. A resposta do cliente chega para quem enviou.

**Histórico de envios** (na mesma janela): data, quem enviou, para quem, anexos e a situação do e-mail:
- **Enviado — aguardando entrega**;
- **✓ Entregue**;
- **Entrega atrasada** (o servidor do cliente ainda está recebendo);
- **✕ Devolvido** (o e-mail não existe ou recusou);
- **✕ Marcado como spam**;
- **✕ Falhou**.

A situação se atualiza sozinha cada vez que a janela é aberta.

**Enviou por WhatsApp ou pelo portal do cliente?** Use **✓ Marcar como enviado**. Ele só registra no histórico.

### De qual proposta é este pedido?

Ao faturar um PV ou OS, o topo da emissão mostra **Faturando PV… · Proposta Aprovada OPS…**: é a proposta do CRM que originou o pedido. O mesmo número aparece no campo **Proposta Aprovada** da seção Recebimento. No Omie, esse campo se chama **Contrato**.

## Como faço uma NF-e de devolução ou de simples remessa

Em **+ Nova emissão › Tipo de documento**, escolha:

- **NF-e de devolução (de compra)** — devolve ao fornecedor itens de uma NF de entrada (CFOP 5.202/6.202).
  1. Em **NF de origem**, busque pelo nº, fornecedor ou CNPJ e escolha a nota (ou cole a **chave de 44 dígitos**).
  2. O destinatário (fornecedor) e os itens vêm da nota; ajuste a **quantidade devolvida** (não pode passar da nota) e confira a **alíquota de ICMS** de cada item.
  3. Escolha ou escreva o **Motivo** e emita.
- **NF-e de simples remessa** (CFOP 5.949/6.949) ou **remessa p/ conserto** (5.915/6.915) — envia material sem venda.
  1. Escolha o **destinatário** no cadastro, o **Projeto** (obrigatório; **+ Novo projeto** cria na hora), **Para qual cliente** e o **Motivo**.
  2. Informe os itens e emita.

> **Atenção:** essas notas usam a **mesma numeração da NF-e de venda** (série 1) e **não criam contas a receber**. Se precisar, marque **Gerar cobrança** (remessa) ou **Gerar crédito a receber do fornecedor** (devolução) e preencha o Recebimento.

> **Dica:** a nota sai no mesmo formato do Omie: devolução com a NF de origem referenciada e “Motivo da Devolucao” nas informações complementares; remessa com “Projeto · Cliente · Motivo”.

### Só entram itens do nosso estoque

Na NF-e (remessa, conserto, devolução, venda de produto) a busca de itens mostra **primeiro os itens do nosso estoque**. Quem digita o código do fornecedor ou o código antigo do Omie também cai no item nosso (aparece "cód. compra 3019075" ao lado).

Códigos de compra sem item nosso aparecem separados, em **Códigos de compra sem item nosso**, e não vão direto para a nota:

- **Vincular a existente**: escolha o item nosso (os mais parecidos vêm primeiro) — o código de compra fica ligado a ele de vez.
- **Cadastrar no estoque**: cria o item com o próximo código da família e já coloca na nota.

> **Atenção:** a nota não emite com item sem código do estoque ("vincule ou cadastre"). Saldo zerado **não** bloqueia: aparece só o aviso "saldo do item ainda não conferido".

### Item fora do estoque em qualquer nota (recibo, NFS-e e NF-e)

Em **todo** tipo de documento, a linha com código que não é item nosso mostra o selo **código fora do estoque** e os botões **Criar item nosso** / **Vincular a item existente**. A janela traz:

- **Sugestões** — os 3 itens nossos mais parecidos (nome, preço e unidade), com a % de semelhança → **Usar este**;
- **Já existe no estoque?** e a busca por nome/código;
- **Cadastrar no estoque** (próximo código da família).

A escolha troca a linha na hora **e fica gravada no PV/OS** de origem, junto com o de-para: da próxima vez o mesmo código/descrição já entra como item nosso. Código antigo que já aponta para um item nosso (ex.: o id do Omie de um serviço) é trocado sozinho ao abrir a folha. No recibo e na NFS-e o selo é um aviso; só a NF-e bloqueia a emissão.

**Serviços têm código nosso:** cada serviço do cadastro ganhou um item na família **SV · Serviços** (SV0001, SV0002…), que não movimenta estoque. O código do Omie continua ligado a ele (ex.: 2244292537 → SV0013 "PRESTAÇÃO DE SERVICOS PROJETOS"); LC116 e código municipal continuam os do cadastro de serviços.

## NFS-e da prefeitura

A NFS-e continua sendo emitida no portal da prefeitura. Depois:

1. Na carteira, na OS, clique em **Registrar NFS-e**.
2. Informe número, código de verificação, data, valores e retenções (ISS retido, IR, PIS, COFINS, CSLL, INSS) e anexe o PDF/XML.
3. Salve. A OS fica faturada e as parcelas entram no contas a receber **pelo valor líquido**.

## Contratos recorrentes

Na aba **Contratos recorrentes**:

- Indicadores: receita recorrente do mês, a faturar, atrasados, reajustes e vigências vencendo.
- Para cada contrato: itens, valor do período, dia de faturamento, competências já faturadas.
- **Faturar** uma competência (ou várias) gera a OS; depois emita o recibo ou registre a NFS-e. **A mesma competência não pode ser faturada duas vezes.**
- **+ Novo contrato**, **Editar**, **Suspender**, **Encerrar**, **Registrar reajuste**.

## Prontidão

O botão **Prontidão** mostra se está tudo pronto para emitir (certificado, numeração, Omie desligado). A faixa amarela avisa quando o **certificado A1** está perto de vencer.

## Como faço para achar o NCM de um item

Toda NF-e precisa de um NCM válido (8 dígitos, da tabela oficial da Receita) em cada item. Sem ele, o botão **Emitir** fica bloqueado.

1. Na linha do item, clique em **Localizar NCM** (aparece em vermelho quando falta ou está errado).
2. No topo vêm as **sugestões para este item**, com o motivo: itens parecidos do nosso catálogo, a NF do fornecedor que vendeu a peça ou NF-e que já emitimos.
3. Se nenhuma servir, busque pelo **código** (ex.: `7609`) ou por **palavras** (ex.: `acessórios tubos alumínio`). Cada resultado mostra o caminho completo na tabela.
4. Clique no NCM certo. Com **salvar no cadastro do item** marcado, ele fica gravado na peça e nas próximas notas já vem preenchido.

> **Atenção:** o NCM é responsabilidade fiscal. Na dúvida entre dois códigos, confirme com a contabilidade antes de emitir.

## Perguntas frequentes

**Não acho uma OS faturada.** Ela pode estar fora do período escolhido — busque pelo número ou mude o período para **Tudo**.

**Errei a nota.** Rejeitada: corrija e reenvie. Autorizada: fale com o financeiro para cancelamento.

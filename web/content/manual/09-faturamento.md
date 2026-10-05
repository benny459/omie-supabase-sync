---
titulo: Faturamento
resumo: Carteira de PV/OS, emissão de NF-e (venda, devolução e remessa) e recibo, NFS-e da prefeitura e contratos recorrentes.
icone: 🧾
area: erp
rotas: /faturamento
caminhos: web/components/faturamento, web/app/(app)/faturamento, web/app/api/faturamento, web/lib/faturamento
atualizado: 2026-10-05
---

> **Atenção:** a **NF-e da SF está em PRODUÇÃO** — o que você emitir é documento fiscal real. A numeração é sequencial e automática (NF-e, recibo, PV e OS continuam de onde o Omie parou). **Não emita mais NF-e nem recibo pelo Omie.**

## A carteira (Pedidos & Ordens de Serviço)

- Escolha **Todos / PV · Produto / OS · Serviço** e o **Período** (Mês, Trimestre, Ano, 12 meses, Tudo). Os filtros ativos aparecem como etiquetas com **×** e **Limpar filtros**.
- Ao **buscar** (cliente, nome fantasia, PV, OS, OC, NF), a busca procura em **todos os períodos**.
- Colunas principais:
  - **Cliente**: nome fantasia em destaque e a razão social embaixo.
  - **Emissão**: data do PV/OS e, se ainda não faturado, **há N dias**.
  - **Previsão fat.**: quando deve ser faturado — **clique para mudar**. Alerta **atrasado N dias** ou **vence em N dias**.
  - **Recebimento**: **recebido**, **a receber**, **vencido** ou **parcial**, com a data.
- Visões: **Lista, Kanban, Emissões, NFS-e registradas**. Filtro rápido **Previsão atrasada** e **OS sem NFS-e**.
- Clique num documento para abrir a gaveta. Ela mostra **o que vai sair na nota**: destinatário completo (CNPJ, IE, endereço, município/IBGE, e-mail, com **editar cadastro**), recebimento (condição, forma de pagamento, conta, parcelas com datas e valores, instrução de Pix/banco), operação (natureza, CFOP, frete/transportadora, OC, projeto, vendedor), itens com NCM e CFOP e as **informações complementares exatamente como saem**. Pendências (falta IE, CEP, IBGE, e-mail, NCM, forma de pagamento) aparecem no topo.
- A gaveta também traz as notas (DANFE, XML, recibo — inclusive os antigos do Omie), recebimento e histórico.

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
8. **Projeto** e **categoria de receita** são **obrigatórios** — vêm do PV/OS (CRM); se faltarem, a emissão fica bloqueada até você escolher (ou criar o projeto em **+ Novo projeto**). Para boleto, Pix e transferência a **conta de recebimento** também é obrigatória.
8. Confira a **Prévia das contas a receber**, clique em **Pré-visualizar DANFE** (ou recibo) para ver o documento, depois **Validar** e, por fim, **Emitir**.

## Como faço para mudar forma de pagamento, conta ou outro dado da nota

1. Clique no PV/OS na carteira. A gaveta mostra **"O que vai sair na nota"**.
2. Em cada bloco (Destinatário, Recebimento, Operação e transporte, Itens, Informações complementares) há o botão **editar ✎**.
3. Ele abre a emissão (**Revisar e emitir**) já na seção certa, destacada.
4. Em **Recebimento**, no topo, escolha a **Forma de recebimento** (boleto, PIX, transferência…) e a **Conta de recebimento**. A instrução de pagamento sai na nota e em cada parcela.

> **Dica:** se o pedido não tem forma/conta, a emissão herda as do **último faturamento do cliente** — confira antes de emitir.

## Depois de emitir

A janela acompanha: **1 · Enviando à Focus → 2 · Processando na SEFAZ → Autorizada** (ou Rejeitada).

- **Autorizada**: número/série, **chave de acesso**, protocolo, **DANFE**, **Baixar XML**, **Consultar na SEFAZ** e as **contas a receber criadas**.
- **Rejeitada**: o motivo em português e **Corrigir e reenviar** (o formulário continua preenchido).

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

## Perguntas frequentes

**Não acho uma OS faturada.** Ela pode estar fora do período escolhido — busque pelo número ou mude o período para **Tudo**.

**Errei a nota.** Rejeitada: corrija e reenvie. Autorizada: fale com o financeiro para cancelamento.

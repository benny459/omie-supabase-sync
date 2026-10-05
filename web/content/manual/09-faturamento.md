---
titulo: Faturamento
resumo: Carteira de PV/OS, emissão de NF-e e recibo, NFS-e da prefeitura e contratos recorrentes.
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
- Clique num documento para abrir a gaveta: itens, notas (DANFE, XML, recibo — inclusive os antigos do Omie), recebimento e histórico.

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
7. Em **Recebimento**, escolha condição, forma (boleto, Pix, transferência…), conta, categoria e projeto. Ajuste as **parcelas** (precisam somar o total). Com **Pix** ou transferência, os dados da conta saem no documento.
8. Confira a **Prévia das contas a receber** e clique em **Validar**, depois **Emitir**.

## Depois de emitir

A janela acompanha: **1 · Enviando à Focus → 2 · Processando na SEFAZ → Autorizada** (ou Rejeitada).

- **Autorizada**: número/série, **chave de acesso**, protocolo, **DANFE**, **Baixar XML**, **Consultar na SEFAZ** e as **contas a receber criadas**.
- **Rejeitada**: o motivo em português e **Corrigir e reenviar** (o formulário continua preenchido).

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

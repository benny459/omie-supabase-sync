# Faturamento pela Focus NFe, sem depender do Omie

Levantamento de 02/10/2026, branch `focus-faturamento` (não está no `main`).
Fontes: diagnóstico da Focus pela API (só leitura, workflow `focus_diag`) e o
espelho das notas emitidas pelo Omie (`sales.nfe_saida`, `sales.nfse_saida`,
`sales.ordens_servico`).

## Onde estamos

| Item | Situação |
|---|---|
| Empresa SAFE WATER (15.766.003/0001-08) na Focus | cadastrada, Barueri/SP, IE 206878808115, IM 4AY5076 |
| Certificado A1 na Focus | carregado — **vence 23/10/2026** |
| Emissão de NF-e na Focus | **desligada** (`habilita_nfe = false`) |
| Emissão de NFS-e na Focus | **desligada** (`habilita_nfse = false`, `habilita_nfsen_producao = false`) |
| Regime tributário na Focus | **1 = Simples Nacional — errado**: as notas do Omie saem com PIS 0,65% e COFINS 3% (Lucro Presumido = regime 3) |
| Série / próximo número de NF-e na Focus | **não configurados** |
| NFS-e em Barueri pela Focus | suportado: provedor **BarueriWs**, ativo, com homologação e cancelamento; exige certificado, endereço, CPF/CNPJ do tomador e item da lista de serviço |
| Recebimento de notas (NF-e, CT-e, NFS-e) | já funciona (importer agendado) |

Volume dos últimos 12 meses: **851 OS faturadas (NFS-e)** e **388 NF-e**.
Serviço pesa mais que produto: sem NFS-e não dá para largar o Omie.

Como o Omie emite hoje:
- NF-e: modelo 55, **série 001**, última nº **2192** (01/10/2026). CFOPs mais
  usados: 5.949 e 6.949 (outras saídas, ~60% dos itens), 5.102/6.102 (venda),
  5.202 (devolução), 5.915/6.915 (remessa p/ conserto). PIS 0,65% / COFINS 3%;
  ICMS só em ~2% dos itens; IPI quase nunca.
- NFS-e: Barueri, RPS série **"NFSE"** (último RPS 67, NFS-e 107). Item LC116
  **7.03**, código municipal **070301220**, NBS 114031000, ISS não retido,
  e já com **IBS/CBS** (CBS 0,9%, IBS UF 0,1%, IBS Mun 0,1%, cClassTrib 000001).
  Local da prestação varia (ex.: Cotia) — o ISS pode ser devido lá.

## O que precisa ser feito

### 1. Configuração da empresa na Focus (decisão do Benny + contador)
1. Corrigir **regime tributário** para 3 (Lucro Presumido) — confirmar com o contador.
2. Ligar **NF-e** e **NFS-e** (homologação primeiro, depois produção).
3. Numeração sem colidir com o Omie enquanto os dois convivem:
   - NF-e: **série nova (ex.: 2)** começando em 1. Continuar a série 001 só
     quando o Omie parar de emitir de vez.
   - NFS-e: **série de RPS própria** na Focus (o número da NFS-e quem dá é a
     prefeitura; o RPS não pode repetir).
4. **Renovar o certificado A1 antes de 23/10** e subir na Focus (e no Omie,
   enquanto ele emitir).

### 2. Regras fiscais (o que o Omie calcula hoje e nós teremos que mandar pronto)
A Focus não calcula imposto: cada item vai com CFOP, CST de ICMS/PIS/COFINS
(e IPI quando houver), alíquotas e, desde 2026, o grupo **IBS/CBS**.
- Tabela `fiscal.regras` por (tipo de operação, UF destino, NCM/serviço) →
  CFOP, CSTs, alíquotas, cClassTrib, texto de informações complementares.
- Fonte para montar: o **XML** de uma NF-e de cada CFOP usado (o resumo do
  Omie no espelho não traz os CSTs) → baixar pela API do Omie e validar com o
  contador. Para NFS-e o espelho já tem tudo (LC116, código municipal, NBS,
  IBS/CBS).
- 5.949/6.949 é a maioria: entender com o contador o que é (remessa? comodato?
  locação?) — define CST e se há ICMS.

### 3. Cadastros que a nota exige
- **Cliente**: CNPJ/CPF, IE e indicador de IE, endereço completo com código
  IBGE do município, e-mail. Hoje vem do Omie (espelho) — conferir completude.
- **Produto**: NCM, unidade, origem, descrição fiscal. Já temos o catálogo do
  Omie no painel (`orders.mv_catalogo_compra`) — falta o lado de venda.
- **Serviço**: item LC116, código municipal, NBS, cClassTrib, local de prestação.

### 4. No painel
1. Tela "Emitir nota" a partir do PV/OS (pré-preenchida, com conferência dos impostos).
2. Envio à Focus (`POST /v2/nfe?ref=…` e `POST /v2/nfse?ref=…`), acompanhamento
   do status (webhook da Focus ou consulta), guardar XML e PDF (DANFE/DANFSe).
3. Cancelamento e carta de correção (NF-e).
4. E-mail ao cliente com XML+PDF.
5. Gravar a NF no pedido (marca "faturado") e gerar a **conta a receber no
   nosso sistema** (já existe: contas a receber nascem no painel).

### 5. O que deixa de acontecer sozinho quando o Omie não emite
- **Estoque**: a NF do Omie baixa o estoque dele. Nota pela Focus não baixa —
  precisamos do nosso movimento de estoque (ou aceitar o Omie divergente).
- **Contabilidade / SPED**: o contador hoje tira as notas do Omie. Precisa
  receber os XMLs da Focus (exportação mensal ou acesso à Focus).
- **Relatórios do Omie** (faturamento, comissão) deixam de ver essas notas — o
  painel passa a ser a fonte.

## Ordem sugerida
1. **NFS-e primeiro**: mais volume (851/ano), regra fiscal já conhecida pelo
   espelho, sem estoque envolvido. Homologação em Barueri → produção com série
   de RPS própria.
2. **NF-e depois**: depende do XML/regras com o contador e do estoque. Série 2
   em paralelo ao Omie até a virada.
3. **Virada**: quando a nota pela Focus estiver estável, o Omie para de emitir.

## Decisões pendentes (Benny)
- Pode corrigir o regime e ligar NF-e/NFS-e em **homologação** na Focus?
- Séries: NF-e série 2 e RPS série própria durante a convivência?
- Quem renova o certificado A1 (vence 23/10)?
- Contador: confirmar regime, CSTs e o que é o CFOP 5.949/6.949.
- Começar pela NFS-e?

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
| Regime tributário | **Simples Nacional** (Omie: `optante_simples_nacional = S`; Focus: regime 1) — correto |
| Emissão de NF-e na Focus | **ligada em 02/10/2026** — série **2**, próximo nº 1 (produção e homologação) |
| Emissão de NFS-e na Focus | **ligada em 02/10/2026** — RPS série **"2"**, próximo nº 1 (produção e homologação) |
| NFS-e em Barueri pela Focus | suportado: provedor **BarueriWs**, ativo, com homologação e cancelamento; exige certificado, endereço, CPF/CNPJ do tomador e item da lista de serviço |
| Recebimento de notas (NF-e, CT-e, NFS-e) | já funciona (importer agendado) |

Volume dos últimos 12 meses: **851 OS faturadas (NFS-e)** e **388 NF-e**.
Serviço pesa mais que produto: sem NFS-e não dá para largar o Omie.

Como o Omie emite hoje:
- NF-e: modelo 55, **série 1**, última nº **2192** (01/10/2026), CRT 1. Regras
  vistas no XML de uma nota de cada CFOP (`scripts/diag_omie_fiscal.py`):
  | CFOP | natureza | ICMS | PIS/COFINS | pagamento |
  |---|---|---|---|---|
  | 5.102 / 6.102 | venda de mercadoria de terceiros | CSOSN 102 | CST 49 zerado | 15 (boleto) |
  | 5.949 / 6.949 | outra saída não especificada | CSOSN 102 | CST 49 | 90 (sem pagamento) |
  | 5.915 / 6.915 | remessa p/ conserto | CSOSN 102 (6.915: 400) | CST 49 | 90 |
  | 5.202 / 6.556 | devolução de compra | **CSOSN 900 com ICMS destacado** (18%/12%) | CST 01 | 90, com NF-e referenciada |
  | 5.411 | devolução de compra com ST | CSOSN 500 (orig 6) | CST 49 | 90, com NF-e referenciada |
  Sem grupo IBS/CBS na NF-e. indFinal 1 (remessa: 0), indPres 9. infCpl padrão:
  "I-Documento emitido por ME ou EPP, optante pelo Simples Nacional. II-Nao gera
  direito a credito fiscal de IPI." + e-mail do destinatário + nº da OC.
  (O PIS 0,65%/COFINS 3% que aparece no resumo do Omie é valor informativo em
  CST 49 — não é Lucro Presumido.)
- NFS-e: Barueri, RPS séries **"NFSE"** (último 69) e **"900"** (último 22).
  Itens LC116 usados: 7.03, 17.09, 14.01, 17.02, 7.12, 14.02 (cada um com código
  municipal e NBS próprios). Exemplo: Item LC116
  **7.03**, código municipal **070301220**, NBS 114031000, ISS não retido,
  e já com **IBS/CBS** (CBS 0,9%, IBS UF 0,1%, IBS Mun 0,1%, cClassTrib 000001).
  Local da prestação varia (ex.: Cotia) — o ISS pode ser devido lá.

## O que precisa ser feito

### 1. Configuração da empresa na Focus — FEITO em 02/10/2026
`scripts/config_focus_empresa.py` (workflow `focus_diag`, modo `config` simula,
`config-aplicar` grava): regime 1, NF-e e NFS-e ligadas, NF-e série 2 e RPS série
"2" começando em 1 — o Omie continua emitindo nas séries dele (NF-e 1; RPS
"NFSE"/"900") sem colisão. Pendente: **renovar o certificado A1 antes de 23/10**
(Focus e Omie dependem dele).

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

## Decisões
- 02/10: regime Simples (confirmado); emitir pelas duas vias (Focus e Omie) por
  enquanto, com séries separadas — configurado.
- Pendente: quem renova o certificado A1 (vence 23/10)?
- Próximo: teste em homologação (NFS-e e NF-e) a partir de um PV/OS real.

# 🗺️ MAPA DE INTERLIGAÇÕES — Sales × Orders × Finance

## 📋 IDs das Planilhas

| Módulo | ID | URL |
|---|---|---|
| **Finance** | `1lodGkIBxO1es8fYcNmvKY-7M8Jft1wUDa2FX3RSM3rg` | [Link](https://docs.google.com/spreadsheets/d/1lodGkIBxO1es8fYcNmvKY-7M8Jft1wUDa2FX3RSM3rg) |
| **Orders** | `1rv7D3GTpsNUIAWW3V6ltHUqm5kNUg5apQ6TbmyM3izI` | [Link](https://docs.google.com/spreadsheets/d/1rv7D3GTpsNUIAWW3V6ltHUqm5kNUg5apQ6TbmyM3izI) |
| **Sales** | `14yjhkG9wNoHJsm7tRFq67qIFqO49wKYaR9y9u2gaEkU` | [Link](https://docs.google.com/spreadsheets/d/14yjhkG9wNoHJsm7tRFq67qIFqO49wKYaR9y9u2gaEkU) |

---

## 🔗 INTERLIGAÇÕES ENTRE PLANILHAS

### Orders → Finance (3 vínculos)

```
┌─────────────────────────────────────────────────────────────┐
│  ORDERS (Compras)                                            │
│                                                              │
│  📊 Painel de Resultados (Painel de Resulatdos_7.4_D.gs)    │
│  ├── carregarMapaContasPagar()                               │
│  │   └── LÊ Finance → ContasPagar_Consolidada               │
│  │       (NF col[11], Pedido col[15], Valor col[6])          │
│  │                                                           │
│  ├── carregarMapaFinanceiroMultiplasParcelas()                │
│  │   └── LÊ Finance → ContasReceber_Consolidada              │
│  │       (NF col[70], Parcela, Status, Data, Valor)          │
│  │                                                           │
│  └── carregarMapaVendasTotalizadoOmie()                      │
│      └── LÊ Sales → PV_consolidado + OS_consolidado          │
│          (ID pedido col[45/39], Valor col[16/6])              │
│                                                              │
│  📋 Pedidos Parciais (Pedidos Parciais_3_D.gs)               │
│  └── compilarPedidosCompra()                                 │
│      └── LÊ Finance → ContasPagar_Consolidada                │
│          (Pedido, Valor, Fornecedor — coluna BU[72])         │
│                                                              │
│  📊 Resultado Projeto (_Resultado_Projeto_AJ_D.gs)           │
│  ├── carregarRecebidosLancamentosPorProjeto()                │
│  │   └── LÊ Finance → Lançamentos_Consolidados               │
│  └── carregarAReceberPorProjeto()                            │
│      └── LÊ Finance → ContasReceber_Consolidada              │
└─────────────────────────────────────────────────────────────┘
```

### Orders → Sales (1 vínculo)

```
┌─────────────────────────────────────────────────────────────┐
│  ORDERS → SALES                                              │
│                                                              │
│  📊 Painel de Resultados                                     │
│  └── carregarMapaVendasTotalizadoOmie()                      │
│      └── LÊ Sales → PV_consolidado (col 45=ID, 16=Valor)    │
│      └── LÊ Sales → OS_consolidado (col 39=ID, 6=Valor)     │
└─────────────────────────────────────────────────────────────┘
```

### Finance → (sem referências externas)
Finance não lê de outras planilhas. Apenas links de navegação no menu.

### Sales → (sem referências externas)
Sales não lê de outras planilhas.

---

## 🔗 RESUMO VISUAL DAS DEPENDÊNCIAS

```
                    ┌──────────┐
                    │  FINANCE │
                    │          │
                    │ ContasPagar_Consolidada ◄──────┐
                    │ ContasReceber_Consolidada ◄────┤
                    │ Lançamentos_Consolidados ◄─────┤
                    └──────────┘                     │
                                                     │ LÊ (openById)
                    ┌──────────┐                     │
                    │  ORDERS  │─────────────────────┘
                    │          │
                    │ Painel de Resultados ──────┐
                    │ Pedidos Parciais ──────────┤── LÊ Finance
                    │ Resultado Projeto ─────────┘
                    │          │
                    └────┬─────┘
                         │ LÊ (openById)
                    ┌────▼─────┐
                    │  SALES   │
                    │          │
                    │ PV_consolidado ◄──────── Orders lê
                    │ OS_consolidado ◄──────── Orders lê
                    │ Consolidação_PV_OS       
                    └──────────┘
```

---

## 📊 SmartSuite — Tabelas conectadas

| Módulo | Script | SmartSuite Table ID | O que sincroniza |
|---|---|---|---|
| **Sales** | Sales_avulsos_3.13.gs | `679bd2d153f70a63197fde64` | Vendas Avulsas (PV 40_VS, 41_VP) |
| **Sales** | Smartsuite_projetos_15.gs | `696d3c3d35b1839e1b2a274f` | Projetos Ativos |
| **Sales** | Expor_Projects.gs | `679bd2ed42367e0b273b4374` | Projetos (update multi-registro) |
| **Orders** | Smart_PC_7.32_D.gs | `679bd37761f688f6107fde60` | Pedidos Compra |
| **Orders** | Smart_AV_7.13.gs | `679bd2d153f70a63197fde64` | Vendas Avulsas (compartilha com Sales!) |
| **Orders** | Smart_Projetos_8.4_D.gs | `696d3c3d35b1839e1b2a274f` | Projetos Ativos (compartilha com Sales!) |
| **Finance** | Smart_clientes.gs | `697798af32401aadbe51a97f` | Clientes |

### SmartSuite Tables compartilhadas:
- `679bd2d153f70a63197fde64` → usada por **Sales** E **Orders** (Vendas Avulsas)
- `696d3c3d35b1839e1b2a274f` → usada por **Sales** E **Orders** (Projetos Ativos)

---

## ⚠️ ABAS _CONSOLIDADA — Papel especial

As abas com sufixo `_Consolidada` são **abas de fórmulas/transformação**, não dados brutos:

| Aba | Planilha | Quem cria | Quem lê |
|---|---|---|---|
| `ContasPagar_Consolidada` | Finance | Fórmulas/Flow | **Orders** (Painel, Pedidos Parciais) |
| `ContasReceber_Consolidada` | Finance | Fórmulas/Flow | **Orders** (Painel, Resultado Projeto) |
| `Lançamentos_Consolidados` | Finance | Fórmulas/Flow | **Orders** (Resultado Projeto) |
| `PV_consolidado` | Sales | Fórmulas | **Orders** (Painel) |
| `OS_consolidado` | Sales | Fórmulas | **Orders** (Painel) |
| `Consolidação_PV_OS` | Sales | Script (criarConsolidacaoPVOS) | SmartSuite senders |
| `Smart_Consolidada` | Orders | Script | SmartSuite senders |
| `Compras_consolidado` | Orders | Script (consolidarDados) | SmartSuite senders |
| `NF_Consolidado` | Orders | Script | SmartSuite senders |

**⚠️ IMPORTANTE**: O mirror NÃO deve gravar nas abas `_Consolidada` — elas são derivadas (fórmulas/scripts) e lidas por outros scripts cross-planilha.

---

## 🗄️ Supabase — Schemas e Tabelas

### sales.* (8 tabelas — Omie Vendas)
| Tabela | Rows | Fonte API |
|---|---|---|
| itens_vendidos | ~909 | /produtos/pedido/ListarPedidos |
| etapas_pedidos | ~5.861 | /produtos/pedidoetapas/ListarEtapasPedido |
| pedidos_venda | ~567 | /produtos/pedido/ListarPedidos |
| ordens_servico | ~3.932 | /servicos/os/ListarOS |
| contratos_servico | ~104 | /servicos/contrato/ListarContratos |
| produtos | ~8.114 | /geral/produtos/ListarProdutosResumido |
| formas_pagamento | ~223 | /produtos/formaspagvendas/ |
| categorias | ~487 | /geral/categorias/ |

### orders.* (10 tabelas — Omie Compras)
| Tabela | Rows | Fonte API |
|---|---|---|
| pedidos_compra | ~13.476 | /produtos/pedidocompra/PesquisarPedCompra |
| produtos_compras | ~4.340 | /geral/produtos/ListarProdutos |
| nfe_entrada | ~1.501 | /contador/xml/ListarDocumentos |
| recebimento_nfe | ~784 | /produtos/recebimentonfe/ListarRecebimentos |
| etapas_faturamento | ~34 | /produtos/etapafat/ListarEtapasFaturamento |
| formas_pagamento_vendas | ~155 | /produtos/formaspagvendas/ |
| formas_pagamento_compras | ~155 | /produtos/formaspagcompras/ |
| familias_produtos | ~24 | /geral/familias/PesquisarFamilias |
| unidades | 0 | /geral/unidade/ListarUnidades |
| produto_fornecedor | 0 | /estoque/produtofornecedor/ |

### finance.* (18 tabelas — Omie Financeiro)
| Tabela | Rows | Fonte API |
|---|---|---|
| pesquisa_titulos | ~60.204 | /financas/pesquisartitulos/ |
| lancamentos_cc | ~71.646 | /financas/contacorrentelancamentos/ |
| contas_pagar | ~16.788 | /financas/contapagar/ |
| clientes | ~3.676 | /geral/clientes/ |
| contas_receber | ~2.427 | /financas/contareceber/ |
| bancos | ~1.201 | /geral/bancos/ |
| projetos | ~411 | /geral/projetos/ |
| categorias | ~182 | /geral/categorias/ |
| parcelas | ~155 | /geral/parcelas/ |
| extratos_cc | ~153 | /financas/extrato/ |
| contas_correntes | ~13 | /geral/contacorrente/ |
| empresas | ~1 | /geral/empresas/ |
| + 7 aux | vários | bandeiras, origens, finalidades, dre, tiposCC, tiposDoc |

### sales.sync_state (compartilhada)
Rastreia todas as sincronizações (Sales + Orders + Finance).

---

## 🔄 Fluxo de Dados Completo

```
OMIE API ──────────────────────────────────────────────────────┐
  │                                                             │
  ▼ (GitHub Actions — Python)                                   │
                                                                │
┌─────────────────────────────────────────────┐                 │
│  SUPABASE (Postgres)                        │                 │
│  ├── sales.*    (8 tabelas)                 │                 │
│  ├── orders.*   (10 tabelas)                │                 │
│  └── finance.*  (18 tabelas)                │                 │
└──────┬──────────────────────────────────────┘                 │
       │                                                        │
       ▼ (Apps Script Mirror — cada 15min)                      │
                                                                │
┌────────────────────┐ ┌────────────────────┐ ┌────────────────┐│
│  📊 FINANCE        │ │  🛒 ORDERS         │ │  💰 SALES      ││
│  Sheets            │ │  Sheets            │ │  Sheets        ││
│                    │ │                    │ │                ││
│  ContasPagar ◄─────┤ │  NFe_Entrada      │ │  ItensVendidos ││
│  ContasReceber ◄───┤ │  RecebimentoNFe   │ │  EtapasPedidos ││
│  PesquisaTitulos   │ │  PedidosCompra    │ │  PedidosVenda  ││
│  ExtratoCC         │ │  Produtos          │ │  OrdensServico ││
│  LancamentosCC     │ │  ...               │ │  Produtos      ││
│  Clientes          │ │                    │ │  ...           ││
│  ...               │ │                    │ │                ││
│                    │ │                    │ │ Consolidação   ││
│ ContasPagar_       │ │ Painel Resultados──┼─┼─► lê Sales    ││
│  Consolidada ──────┼─┼──► Orders lê       │ │ PV_consolidado││
│ ContasReceber_     │ │ Pedidos Parciais───┼─┘ OS_consolidado││
│  Consolidada ──────┼─┼──► Orders lê       │                 ││
│ Lançamentos_       │ │ Resultado Projeto──┘                  ││
│  Consolidados ─────┼─┼──► Orders lê                          ││
│                    │ │                                        ││
│      ▼             │ │      ▼                │      ▼        ││
│  Pagar/Receber     │ │  SmartSuite           │  SmartSuite   ││
│  Flow              │ │  (PC, AV, Proj)       │  (Avulsos,    ││
│      ▼             │ │      ▼                │   Projetos)   ││
│  SmartSuite        │ │  Webex Report         │      ▼        ││
│  (Clientes)        │ │                       │  Webex Report ││
│      ▼             │ │                       │               ││
│  Webex Report      │ │                       │               ││
└────────────────────┘ └────────────────────┘ └────────────────┘│
                                                                │
┌──────────────────────────────────────────────────────────────┘
│  🌐 PAINEL WEB (GitHub Pages)
│  https://benny459.github.io/omie-supabase-sync/
│  ├── Dashboard (sync_state de todos os módulos)
│  ├── Sales / Orders / Finance (dispatch + agenda)
│  └── Table Viewer (visualizar dados do Supabase)
└──────────────────────────────────────────────────────────────
```

---

## ⚠️ PONTOS DE ATENÇÃO

1. **Orders depende de Finance**: O "Painel de Resultados" de Orders abre Finance via `openById` pra ler ContasPagar_Consolidada, ContasReceber_Consolidada e Lançamentos_Consolidados. Se essas abas mudam de nome ou estrutura, Orders quebra.

2. **Orders depende de Sales**: O "Painel de Resultados" de Orders lê PV_consolidado e OS_consolidado de Sales pra totalizar vendas.

3. **SmartSuite compartilhada**: Sales e Orders escrevem na MESMA tabela SmartSuite (`679bd2d153f70a63197fde64` — Vendas Avulsas e `696d3c3d35b1839e1b2a274f` — Projetos Ativos). Cuidado com conflitos.

4. **_Consolidada ≠ raw**: O mirror NÃO deve gravar em abas `_Consolidada`. O mirror grava nas abas raw (ContasPagar, ContasReceber). As `_Consolidada` são derivadas com fórmulas que outras planilhas leem.

5. **BigQuery**: Finance tem um script `BigQuery.gs` que exporta `Lançamentos_Consolidados`, `ContasPagar_Consolidada`, `ContasReceber_Consolidada` pro BigQuery. Se migrar pra Supabase como fonte, pode conectar direto (sem Sheets no meio).

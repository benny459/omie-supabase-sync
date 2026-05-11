# 🗺️ Mapa de Campos SmartSuite ↔ Supabase/Omie

> Referência pra **import** (Smart → Supabase) e pra **UI nova** (Supabase → tela).
> Gerado em 2026-04-22 a partir de:
> - API do SmartSuite (`/applications/{app_id}/` das 3 tabelas)
> - Apps Scripts em `apps-script/orders/Smart_{AV,PC,Projetos}_*.gs`
>
> **Supersedes:** mapeamento ad-hoc nos `.gs`. Fonte de verdade daqui pra frente.

## Legenda das categorias

| Cat | Significado | Estratégia no app novo |
|-----|-------------|-------------------------|
| **O** | Vem direto do Omie (já está em `sales.*`/`orders.*`/`finance.*`) | **JOIN** na view `approval.v_pc_completo`, não duplica em `approvals` |
| **W** | Workflow de aprovação (manual no Smart, essencial) | **Coluna dedicada** em `approval.approvals` |
| **L** | Logística/NFe recebimento (manual no Smart) | **Coluna dedicada** em `approval.approvals` |
| **C** | Cotação, replanning, auditoria, etc (manual, secundário) | `approval.approvals.custom_fields` (jsonb) |
| **F** | Fórmula no Smart (derivado) | Calculado em **view SQL** ou no cliente — não armazena |
| **S** | System field do Smart (title, first_created, …) | Mapeado em metadata, não duplica |

---

## 1. Campos que vêm do Omie (categoria O)

Esses 3 apps (Avulsos/Projetos/PCs) recebem hoje os dados do Omie via `SmartSuite_Sync`. Quando a UI nova lê `approval.v_pc_completo`, pega direto do JOIN — sem precisar replicar.

### Do lado **Pedido de Venda / OS** (`sales.pedidos_venda`, `sales.etapas_pedidos`, `finance.clientes`, `finance.projetos`)

| Label Smart | Slug (AV) | Slug (PROJ) | Slug (PCS) | Supabase |
|---|---|---|---|---|
| V.PV / OS                 | `title`        | `title`        | —              | `sales.pedidos_venda.numero_pedido` |
| V.Previsão Limite_Omie    | `s0b49dd159`   | `s0b49dd159`   | `s0b49dd159`   | `sales.pedidos_venda.data_previsao` |
| V.Valor_Omie              | `s626230a23`   | `s626230a23`   | `s626230a23`*  | `sales.pedidos_venda.valor_total` |
| V.Cliente_Omie            | `s53aefb05c`   | `s53aefb05c`   | `sd7f83f00f`‡  | `finance.clientes.razao_social` (FK `codigo_cliente`) |
| V.Projeto_Omie            | `s8c48f1c4b`   | `s8c48f1c4b`   | `sa3ba17aff`   | `finance.projetos.descricao` (FK `codigo_projeto`) ou `sales.pedidos_venda.codigo_projeto` |
| V.Etapa Venda_Omie        | `s9ee9213bb`   | `s9ee9213bb`   | —              | `sales.etapas_pedidos.etapa` (última etapa do pedido) |
| V.Tipo_Omie (Merc/Serv/Mix)| `s6ebca6d00`  | —              | —              | derivado: presença de `ordens_servico` vs `itens_vendidos` |
| V.Emissão_Omie            | `se991fa1b6`   | —              | —              | `sales.pedidos_venda.d_inc` (data inclusão) |
| V.Data de Faturamento     | `s28f2347ed`   | `s28f2347ed`   | —              | `sales.etapas_pedidos.dt_fat` |
| V.NF saida                | `s03423faaf`   | `s03423faaf`   | —              | `sales.etapas_pedidos.num_nfe` |

\* Em PCs é label "PV Valor (F/K)" — mesmo campo semântico.
‡ Em PCs é `linkedrecordfield` ao invés de texto.

### Do lado **Pedido de Compra** (`orders.pedidos_compra`)

| Label Smart | Slug (AV) | Slug (PROJ) | Slug (PCS) | Supabase (`orders.pedidos_compra` = `pc`) |
|---|---|---|---|---|
| PC.Numero                 | `s670dc5f17`   | `s670dc5f17`   | `title`        | `pc.cnumero` |
| PC.Fornecedor             | `scc1a2eacd`   | `scc1a2eacd`   | `scc1a2eacd`   | `pc.ccontato` (ou JOIN `ncod_for` → cadastro de fornecedores, quando tiver) |
| PC.Custo (1 item)         | `sad280e350`   | `sad280e350`   | `sad280e350`   | `pc.nval_tot` (valor do item) |
| PC.Custo total            | `sjio0fft`     | `s19a6102e0`   | —              | `pc.ntotal_pedido` (total do PC agregado) |
| PC.Forma de Pagamento     | `s4c2a39858`   | `s4c2a39858`   | `s58ad3b921`   | JOIN: `pc.ccod_parc` → `orders.formas_pagamento_compras.descricao` |
| PC.Prazo de entrega (dias)| `scf0fb3a7a`   | `scf0fb3a7a`   | `scf0fb3a7a`   | derivado: `pc.ddt_previsao - pc.dinc_data` (ou coluna da PC que tu mantém) |
| PC.Previsão de entrega    | `sa1a68de1b` / `s0b34685a6` | idem AV | `s0b34685a6` | `pc.ddt_previsao` |
| PC.Data de Criação        | `sffec62653`   | `sffec62653`   | `s6krs1wy`     | `pc.dinc_data` |
| PC.Categoria              | `s108b3f279`   | `s108b3f279`   | `sb6b748982`   | JOIN: `pc.ccod_categ` → `sales.categorias.descricao` |
| PC.Status (etapa)         | `s96e0b892e`   | `s96e0b892e`   | `sc8d058bcc`   | `pc.cetapa` + `pc.cdesc_status` |
| PC.Projeto_Omie           | —              | —              | `sa3ba17aff`   | `pc.ncod_proj` → `finance.projetos.descricao` |

### Do lado **Recebimento de NFe** (`orders.recebimento_nfe`)

| Label Smart | Slug (AV) | Slug (PROJ) | Slug (PCS) | Supabase |
|---|---|---|---|---|
| Status Nfe                | —              | —              | `sc40d1040b`   | `orders.recebimento_nfe.etapa` |
| Data Emissão NF           | `s1866928ef`   | `s1866928ef`   | `s412680e66`   | `orders.recebimento_nfe.emissao` |
| Data Entrada/Recebimento  | `syzle95a` / `sb8c897460` | `syzle95a` / `sb8c897460` | `s987a3e9ab` | `orders.recebimento_nfe.dt_rec` |
| NFe Número                | `sb51b79ee5` / `sadcb6d8bf` | `sb51b79ee5` | `sa6772185e` | `orders.recebimento_nfe.num_nfe` |

> **Obs:** em `pcs` os slugs de NFe são diferentes porque a tabela PCs foi criada depois. A função de import tem que mapear os 3 conjuntos.

---

## 2. Workflow de aprovação (categoria W) — colunas dedicadas em `approval.approvals`

| Label Smart | Slug AV | Slug PROJ | Slug PCS | Coluna nova | Tipo |
|---|---|---|---|---|---|
| PC.Aprovação (status) | `sce8327bbb` | `sce8327bbb` | `sce8327bbb` | `status` | enum |
| PC.Data de Aprovação  | `s98eb6904f` | `s98eb6904f` | `s98eb6904f` | `aprovado_em` | timestamptz |
| PC.Aprovado por       | `s8dfb4a40b` | `s8dfb4a40b` | `s8dfb4a40b` | `aprovador_email` | text |
| PC.Valor Aprovado     | `scdff03d9d` | `scdff03d9d` | `s0efb96120` | `valor_aprovado` | numeric |
| PC.Valor Aprovado Audit.| `s6aa9f8ac0`| `s6aa9f8ac0` | — | `valor_aprovado_audit` | numeric |
| PC.Aprovar até        | `s394a485bc` | `s394a485bc` | — | `aprovar_ate` | date |
| PC.Prioridade         | — | — | `s38f01c3ed` | `prioridade` | enum (0/1/2) |
| PC.Justificativa      | `s2ee658402` | `s2ee658402` | `s2ee658402` | `justificativa` | text |
| Comprador             | `s0d4c98840` | `s0d4c98840` | `s0d0ccf8ea` | `comprador` | enum (Paulo/Erick) |
| Status do Material    | `s47e7b73ae` | `s47e7b73ae` | `s47e7b73ae` | `status_material` | enum |

### 2b. RC — Requisição de Compra (100% manual, promovido a colunas dedicadas)

Input é sempre manual: hoje digitado no Smart; no app novo continua editável e ganha **import Excel em massa** (ver Task #8). Por isso **não vão pro jsonb**, viram colunas indexadas.

| Label Smart | Slug AV | Slug PROJ | Slug PCS | Coluna nova | Tipo |
|---|---|---|---|---|---|
| *RC.Numero | `s3d4aaf144` | `s3d4aaf144` | `s3d4aaf144` | `rc_numero` | numeric |
| *RC.Descrição | `sf6383dg` | `sf6383dg` | `sf6383dg` | `rc_descricao` | text |
| *RC.Custo (unitário) | `s66b865956` | `s66b865956` | — | `rc_custo` | numeric |
| RC.Custo total | `sc91f74641` | `sf13db4835` | — | `rc_custo_total` | numeric |

> Precedência Avulsos × Projetos × PCs: mesmos 3 primeiros slugs aparecem nos 3 apps, é literalmente o mesmo dado — só muda onde o usuário digita hoje.

### Choices do `status` (normalizados, união dos 3 apps)

```
PENDENTE                    (default quando ainda não foi mexido)
N_A                         (N/A no Smart)
PRE_SELECAO                 ("Pré seleção")
APROVADO                    ("Aprovado!")
APROVADO_FAT_DIRETO         ("Aprovado faturamento direto")
NAO_APROVADO                ("Não Aprovado")
REJEITADO_VALIDADE          ("Rejeitado por Validade")
CANCELAR_PEDIDO             ("Cancelar Pedido")
```

---

## 3. Tracking logística / NFe (categoria L) — colunas dedicadas

| Label Smart | Slug AV | Slug PROJ | Slug PCS | Coluna nova | Tipo |
|---|---|---|---|---|---|
| MT.Status de Fornecimento | `s7d92bld` | `s7d92bld` | — | `mt_status_fornecimento` | enum (Faturado/Recebido/Conferido) |
| MT.Data Emissão NF (manual) | `s1866928ef` | `s1866928ef` | — | `mt_data_emissao_nf` | date |
| MT.Data Recebimento NF (manual) | `syzle95a` | `syzle95a` | — | `mt_data_recebimento_nf` | date |
| MT.NF Fornecedor (manual) | `sb51b79ee5` | `sb51b79ee5` | — | `mt_nf_fornecedor` | text |
| PC Pago (C/K)             | `sa9a2f10a4` | `sa9a2f10a4` | `sa9a2f10a4` | `pc_pago` | bool |
| Material Enviado?         | `sb063e3bab` | `sb063e3bab` | `sb063e3bab` | `material_enviado` | enum |

---

## 4. `custom_fields` jsonb (categoria C)

Tudo que é manual mas não faz parte do workflow/logística core. Mantém slug original pra facilitar import:

**Cotação (Avulsos e Projetos):**
- `s45deebc11` CT.Negociado e validado por (signature)
- `s40eb44451` Validado por (user)
- `sf655fd134` Assinado em (date)
- `s2de66f7c2` CT.Validade da cotação
- `s5ce09ac98` Cotado por
- `s1cd8f5240` CT.Cotação Num (linked record)
- `s2d248cea5` Data de Seleção
- `s72512058c` Cotação (status)
- `s1ab47c85b` Data de validação de cotação

**Replanning (só Avulsos e Projetos):**
- `s242fb18ba` V.Nova Prev. de Serviços
- `s4b87bk9` V.Nova Prev. de Materiais
- `sf93f06414` 6.Previsão Serviço
- `sdehbc9j` 6.Previsão Materiais
- `s0b34685a6` 5.PC Previsão de entrega (manual — diferente de PC.Previsão de entrega do Omie)
- `s83d610878` Data de Finalização (só Avulsos)

**Solicitação/Auditoria:**
- `sffa361729` Solicitação! (yesno)
- `s424b8f7f9` Solicitado em
- `s2c70d8927` Solicitado por
- `s70aa3b8ae` Motivo solicitação (multi-choice)
- `sbab94f35e` / `s88a2e1990` AUDITORIA (texto livre)
- `sdfcedb0fa` Auditoria_teste (só Avulsos)
- `s49f2dbc2e` Reprovados: Compra sem autorização (só Avulsos)
- `sc10666bff` Aprovados: Valor Smart x Omie
- `s52132a410` Aprovados: PC <= RC

**Links/anexos que não entram em `attachments`:**
- `s1cd8f5240` CT.Cotação Num (linked record — virar FK futura)
- `s7f7561ca4` RC vinc (linked record)
- `sb9082e2f2` 3.0 Relacionamento PV/OS
- `scd5745327` Link (linkfield, só PCs)
- `sb050a8a1c` PC.Links da requisição (linkfield, só PCs)

**PCs standalone específicos:**
- `sb8bd04e4f` 3.2 Data Solicitação (só PCs)

**Textarea:**
- `sb9bb1d2fe` Posição Adicional (só Avulsos — campo novo)
- `s1abb0d597` Meta (Gasto/Empate/Economia)

**Arquivos (entram em `approval.attachments`):**
- `sc55ada8e2` PC Comprovante (Avulsos/Projetos/PCs)
- `sa52b89c26` PC.Arquivos e imagens (só PCs)

---

## 5. Fórmulas (categoria F) — calcular em view ou client

Estes **não são armazenados**. São derivados de outros campos. Na view `approval.v_pc_completo_enriched` (ou no TS do lado do cliente):

| Slug | Label | Fórmula |
|---|---|---|
| `sc58d69241` / `sae020fd43` | Aprovar PC até | `DATEADD(data_previsao_pv, -prazo_entrega - 5, "days")` |
| `s3898c52b9` / `s0d6ae9bae` | Dias para aprovar | `DATEDIFF(aprovar_ate, TODAY(), "days")` |
| `s7997c15f3` | Dias para o prazo PV | `DATEDIFF(TODAY(), data_previsao_pv, "days")` |
| `s768e76ae9` | Status de atraso PV | `IF(dias_prazo >= 0, "✅ Dentro", "🟣 Atrasado")` |
| `sc13803f69` | Diferença RC/PC | `rc_custo - pc_custo` |
| `se1849db02` | Dif % PC/RC | `((pc_custo_total/rc_custo_total)-1)*100` |
| `s16e524807` | Mes Entrega | `MONTH(data_previsao_pv)` |
| `sf26e1ct` | Ano Entrega | `YEAR(data_previsao_pv)` |
| `sa5b95dfa0` / `sdead07cf8` / `scee1ea39d` | PC.Valido? | regra de validade de data de criação |
| ... (30 fórmulas em Avulsos, 21 em Projetos, 13 em PCs) | | |

Lista completa via `/tmp/smartsuite_snapshot/{avulsos,projetos,pcs}.json` (campos com `field_type = formulafield`).

---

## 6. System fields (categoria S) — metadata

Não entram em `approvals`, são metadados do próprio Smart:
- `title` (record title — normalizado como chave)
- `description` (rich text — ignorar)
- `first_created` / `last_updated` — mapear p/ `imported_at` e `updated_at`
- `followed_by` — ignorar (não usamos)
- `comments_count` — contamos em `approval.comments`
- `autonumber` — ignorar

---

## 7. Como o import vai reconciliar

Ao varrer `/applications/{app_id}/records/list/` pras 3 tabelas:

1. Para cada record do Smart, extrai campos por slug.
2. Identifica `empresa` + `ncod_ped` do PC correspondente no Omie:
   - **Avulsos/Projetos:** via `PC.Numero` (`s670dc5f17`) → `orders.pedidos_compra.cnumero`
   - **PCs:** via `title` (PC.Numero) → `orders.pedidos_compra.cnumero`
   - Se não existir em Omie: cria linha "órfã" em `approval.approvals` com `ncod_ped = NULL` (permite só em `source='smartsuite'`). Ou usa `smart_id` como fallback.
3. Preenche colunas dedicadas (categorias W, L) a partir dos slugs mapeados acima.
4. Joga tudo da categoria C no `custom_fields` mantendo chave = slug do Smart.
5. Define `source='smartsuite'`, `smart_id=record.id`, `smart_tabela=<avulsos|projetos|pcs>`, `imported_at=NOW()`.
6. Um PC aparece em **exatamente uma** das 3 tabelas Smart (confirmado 2026-04-22). Não há caso de colisão; se aparecer, é bug de dados no Smart — sinalizar, não mesclar.

---

## 8. Itens pendentes

- [ ] **Normalizar** `PC.Forma de Pagamento` (Avulsos/Projetos e PCs têm listas de choices diferentes)
- [ ] **Derivar V.Tipo_Omie** (Mercantil/Serviços/Mix) a partir dos relacionamentos em Supabase
- [ ] Criar cadastro de fornecedores em Supabase (hoje não temos, só `ncod_for` + `ccontato` string) — impacta `PC.Fornecedor`
- [ ] Criar tabela `approval.linked_records` pra os campos tipo `linkedrecordfield` quando for hora de ligar cotações/RC

---

**Fim do mapa.** Atualiza este doc sempre que um slug novo aparecer ou uma regra mudar.

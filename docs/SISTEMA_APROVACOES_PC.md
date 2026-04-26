# Sistema de Aprovações de PC — Documentação Completa

> **App em produção**: https://painel.waterworks.com.br
> **Repositório**: `benny459/omie-supabase-sync`
> **Stack**: Next.js 16 (App Router) + React 19 + Tailwind 3 + Supabase Postgres + GitHub Actions (sync) + Vercel (hosting)

---

## 1. Visão geral

Sistema interno da WaterWorks para aprovação e gestão de Pedidos de Compra (PCs), substituindo a antiga solução em SmartSuite. Os dados originais vivem no **Omie** (ERP) e são espelhados em **Supabase Postgres** via importadores Python rodando em **GitHub Actions**. A interface web é um Next.js hospedado na **Vercel**.

### Diagrama macro

```
┌─────────┐   GitHub Actions (cron)   ┌──────────────────┐   Views     ┌───────────────────┐
│  Omie   │─────────►   Importers ────►│    Supabase      │────────────►│  Next.js (Vercel) │
│  (ERP)  │   (Python: scripts/)       │  schemas: orders │             │  painel.waterworks│
└─────────┘                            │  sales, finance, │             │  .com.br          │
                                       │  approval, plat. │             └───────────────────┘
                                       └──────────────────┘                       │
                                                ▲                                  │
                                                └──────── escrita direta ──────────┘
                                                  (pc_numero_manual, status,
                                                   custom_fields, RLS-protected)
```

---

## 2. Modelo de dados

### Schemas Postgres

| Schema     | Propósito                                                                                          |
|------------|----------------------------------------------------------------------------------------------------|
| `orders`   | PCs e NFe entrada espelhados do Omie (`pedidos_compra`, `nfe_entrada`, `recebimento_nfe`, etc.)    |
| `sales`    | PVs, OSs, contratos, itens vendidos, etapas (`pedidos_venda`, `ordens_servico`, `etapas_pedidos`)   |
| `finance`  | Cadastros (clientes, projetos, categorias) + lançamentos (CP, CR, extratos, parcelas)               |
| `approval` | Camada do app: `approvals` (1 row por PC/PV/OS), `comments`, `attachments`, `audit_log`, **views**  |
| `platform` | Usuários, perfis, perms (`user_profiles`, `approvers`)                                              |

### Tabela central: `approval.approvals`

PK composta `(empresa, ncod_ped)`. Convenção de `ncod_ped`:

- **> 0** — sincronizado do Omie (PC real). Apaga tem regra estrita (admin only).
- **< 0** — placeholder/extra criado pelo usuário (PV/OS sem PC, ou row adicional dentro de um bucket).

Colunas-chave:
- Identidade: `empresa`, `ncod_ped`, `pv_os_label`, `pc_numero_manual`, `modulo`
- Workflow: `status`, `aprovador_email`, `aprovado_em`, `valor_aprovado`, `prioridade`, `justificativa`
- Manuais editáveis: `rc_numero`, `rc_descricao`, `rc_custo`, `rc_custo_total`
- Logística: `mt_status_fornecimento`, `mt_data_emissao_nf`, `mt_data_recebimento_nf`, `mt_nf_fornecedor`
- Snapshot Smart legado: `smart_id`, `smart_tabela`
- JSONB livre: `custom_fields` (slugs como `s4b87bk9`, `rc_qtd`, `rc_attachment_path`, etc.)

### Convenção 1:1

- **PC ↔ tabela Smart é 1:1**: um PC nunca aparece em mais de uma tabela SmartSuite — sem lógica de precedência no import.
- **Modelo Smart**: 1 linha por item de PV/OS — Avulsos/Projetos têm múltiplas linhas, mas `PC.Numero` só na 1ª. Linhas sem PC.Numero são ignoradas no import.

### Views principais (schema `approval`)

| View                          | Função                                                                                     |
|-------------------------------|--------------------------------------------------------------------------------------------|
| `v_pc_completo`               | Base — UNION de existing_rows (PCs do Omie), orphan_rows (PV/OS sem approval), manual_rc_rows (placeholders), manual_pc_rows |
| `v_pc_completo_enriched`      | Wrapper de `v_pc_completo` com derivações: datas parseadas, fórmulas, lookup de PC manual, alarmes, **modulo_calc** |
| `v_pc_avulsos`                | `WHERE modulo_calc = 'avulsos'`                                                            |
| `v_pc_projetos`               | `WHERE modulo_calc = 'projetos'`                                                           |
| `v_pc_pcs`                    | `WHERE modulo_calc = 'pcs'`                                                                |

#### Regra de classificação (`modulo_calc`)

```sql
CASE
  WHEN modulo = 'pcs' THEN 'pcs'                                              -- override manual
  WHEN _is_sale_row AND COALESCE(m_projeto_nome, projeto_nome) ~ '^PJ' THEN 'projetos'
  WHEN _is_sale_row AND COALESCE(m_projeto_nome, projeto_nome) ~ '^(40_VS|41_VP)' THEN 'avulsos'
  WHEN _is_sale_row THEN 'avulsos'                                            -- venda sem categoria → avulsos + alarme
  ELSE 'pcs'                                                                  -- PCs sem vínculo a venda
END
```

- `_is_sale_row` = `pv_os_label IS NOT NULL OR pv_os_tipo IS NOT NULL`
- `m_projeto_nome` = projeto do PC vinculado manualmente via `pc_numero_manual` (lookup por `cnumero`)

#### Alarmes derivados

| Coluna                 | Tipo    | Quando dispara                                                                          |
|------------------------|---------|------------------------------------------------------------------------------------------|
| `categoria_alert`      | bool    | Linha de venda + projeto faltando ou diferente de `^(PJ\|40_VS\|41_VP)`                 |
| `categoria_alert_label`| text    | Texto pra UI: `⚠ {projeto}` ou `⚠ Sem categoria`                                        |
| `pc_projeto_mismatch`  | bool    | PC vinculado tem `codigo_projeto` ≠ `pv_codigo_projeto`                                 |
| `pc_projeto_alert`     | text    | Sempre mostra projeto do PC; prefixa `⚠ ` quando há mismatch                            |

#### Fórmulas calculadas

- `rc_custo_total_calc` = `SUM(rc_qtd × rc_custo) OVER (PARTITION BY empresa, pv_os_label)` — onde `rc_qtd` vem de `custom_fields->>'rc_qtd'` (default 1)
- `pc_custo_total_calc` = `SUM(valor_total) OVER (PARTITION BY empresa, pv_os_label)`
- `prazo_entrega_dias` = `dt_previsao - dt_inclusao` (parseando date BR)
- `aprovar_ate_calc` = `pv_data_previsao - prazo_entrega - 5 dias`
- `dif_pct_pc_rc`, `rc_pc_vs_rc` (ranges com emojis)
- `status_atraso_pv` (Dentro/Atrasado/Atraso grande)

---

## 3. Sincronização Omie → Supabase

### Importadores e modos

| Tabela                       | Schema  | Modo            | Importador                       |
|------------------------------|---------|-----------------|----------------------------------|
| `pedidos_venda`              | sales   | INCREMENTAL     | `import_pedidos_venda.py`        |
| `itens_vendidos`             | sales   | INCREMENTAL     | `import_itens_vendidos.py`       |
| `contas_pagar`               | finance | INCREMENTAL     | `import_contas_pagar.py`         |
| `contas_receber`             | finance | INCREMENTAL     | `import_contas_receber.py`       |
| `pesquisa_titulos`           | finance | INCREMENTAL     | `import_pesquisa_titulos.py`     |
| `lancamentos_cc`             | finance | INCREMENTAL     | `import_finance_cadastros.py`    |
| `pedidos_compra`             | orders  | FULL            | `import_pedidos_compra.py`       |
| `nfe_entrada`                | orders  | FULL            | `import_nfe_entrada.py`          |
| `recebimento_nfe`            | orders  | FULL            | `import_recebimento_nfe.py`      |
| `etapas_pedidos`             | sales   | FULL            | `import_etapas_pedidos.py`       |
| `ordens_servico`             | sales   | FULL            | `import_servicos.py`             |
| `contratos_servico`          | sales   | FULL            | `import_servicos.py`             |
| `produtos`                   | sales   | FULL            | `import_produtos.py`             |
| `produtos_compras`           | orders  | FULL            | `import_orders_auxiliares.py`    |
| `etapas_faturamento`         | orders  | FULL            | `import_orders_auxiliares.py`    |
| `formas_pag_vendas/compras`  | orders  | FULL            | `import_orders_auxiliares.py`    |
| `clientes`                   | finance | FULL            | `import_finance_cadastros.py`    |
| `categorias`                 | finance | FULL            | `import_finance_cadastros.py`    |
| `projetos`                   | finance | FULL            | `import_finance_cadastros.py`    |
| `extratos_cc`                | finance | FULL            | `import_extratos_cc.py`          |
| `aux_*`                      | finance | FULL            | `import_finance_cadastros.py`    |

### Workflows GitHub Actions

| Workflow                       | Cron BRT                  | Conteúdo                                          |
|--------------------------------|---------------------------|---------------------------------------------------|
| `master_sales_diaria.yml`      | Seg-Sex 05:00 e 17:00     | etapas_pedidos, itens_vendidos, pedidos_venda     |
| `master_orders_diaria.yml`     | Seg-Sex 06:00 e 18:00     | nfe_entrada, recebimento_nfe, **pedidos_compra** |
| `master_finance_diaria.yml`    | Seg-Sex 07:00 e 15:00     | contas_pagar, contas_receber                      |
| `master_sales_semanal.yml`     | Domingo 05:00             | produtos, auxiliares                              |
| `master_orders_semanal.yml`    | Domingo ~01:30            | orders auxiliares (7 tabelas)                     |
| `master_finance_semanal.yml`   | Domingo 07:00             | clientes, categorias, projetos, CC, parcelas, lanc_cc |
| `master_finance_full.yml`      | (manual / desativado)     | full sync de CP, CR, pesquisa títulos, extratos   |

### Estado de sync

Tabela: `sales.sync_state`. PK: `(modulo, empresa)`. Colunas:
- `last_sync_at`, `last_d_alt_processed`, `last_h_alt_processed`
- `total_registros`, `rows_inserted`, `rows_updated`, `rows_before`
- `ultima_execucao_status` (SUCESSO/ERRO), `ultima_execucao_msg`
- `modo` (FULL/INCREMENTAL/ERRO)
- `duracao_segundos` ⚠ **bug parcial** — só finance preenchia até hoje (refator em curso)

### Empresas sincronizadas

Sempre 3 em paralelo: `SF` (Sandcastle Filtros), `CD` (Castle Detoxify), `WW` (WaterWorks).

---

## 4. App web — layout e componentes

### Páginas principais

```
/login              # Auth
/recover            # Reset senha
/avulsos            # Vendas Avulsas (modulo_calc='avulsos')
/projetos           # Projetos (modulo_calc='projetos', agrupado por projeto)
/pcs                # PCs Standalone (modulo_calc='pcs')
/configuracoes      # Admin only — sync, usuários, perms
```

### Estrutura de blocos (groups)

Definidos em `web/lib/columns.ts` como `Group[]`. Cada group tem `tint` (cor de fundo) e `columns[]`:

| Group         | Key         | Tint               | Columns destacadas                                              |
|---------------|-------------|--------------------|------------------------------------------------------------------|
| PV/OS · Omie  | `pvos`      | `bg-violet-50/70`  | `pv_os_label`, `pv_emissao`, cliente, projeto, valor, etapa     |
| RC            | `rc`        | `bg-amber-50/70`   | `rc_numero`, `rc_descricao`, `rc_qtd`, `rc_custo`, total (F)    |
| PC (Omie)     | `pc`        | `bg-blue-50/60`    | `pc_numero`, `pc_projeto_alert`, etapa, categoria, fornecedor   |
| Aprovação     | `aprovacao` | `bg-emerald-50/70` | `status_label`, `aprovador_email`, `aprovado_em`, justificativa |
| Logística     | `log`       | `bg-cyan-50/70`    | `mt_status_fornecimento`, NF datas, número                      |
| Fórmulas/Meta | `extras`    | `bg-slate-50`      | dias_para_aprovar, dif_rc_pc, source, smart_id, anexos          |

`groupsFor(modulo)` define a ordem por página:
- `avulsos` / `projetos`: PV/OS → RC → PC → Aprovação → Logística → Extras
- `pcs`: PC (sem editor `pc_numero` duplicado, sem `pc_projeto_alert`) → Prioridade → Aprovação → RC → Logística → Extras

### Componentes-chave

| Arquivo                                | Função                                                                                          |
|----------------------------------------|--------------------------------------------------------------------------------------------------|
| `GroupedModuleView.tsx`                | Tabela única + sticky header, agrupa por `pv_os_label` (ou `projeto_nome`), expand/collapse, batch select |
| `EditableCell.tsx`                     | Input inline (text/date/money/number/textarea) com persistência via `supaBrowser` + `router.refresh()` para somas em tempo real |
| `EditableStatusCell.tsx`               | Dropdown de status via `createPortal` (escapa overflow). `CANCELAR_PEDIDO` admin-only           |
| `FiltersBar.tsx`                       | Cards de status (Pendentes/Aprovados/etc) + facets dinâmicos (Projeto, Tipo Omie, Etapa, Categoria, Fornecedor) |
| `RcExcelDropZone.tsx`                  | Drop XLSX por bucket — parser col B=desc, C=qtd, D=custo. Detecta RC# do nome `RC####.xlsx`. Storage bucket `rc-files` |
| `AddRowButton.tsx`                     | Cria N rows extras dentro de um bucket PV/OS (ncod_ped negativo)                                |
| `PcInlineAdd.tsx`                      | Inserção manual de PC standalone                                                                |
| `SyncStatusBar.tsx`                    | Topo da página — última sync + histórico expandível                                              |
| `SyncPanel.tsx`                        | Painel completo (em `/configuracoes`) com Workflows + Runs                                       |
| `UsersAdmin.tsx`                       | CRUD de usuários (admin only)                                                                    |
| `DetailDrawer.tsx`                     | Drawer lateral com detalhes da linha clicada (comments, attachments, audit)                     |
| `PermissionsBadge.tsx`                 | Badge no topo mostrando o que o user pode fazer no módulo atual                                  |

### Fonte e visual

- **SF Pro / San Francisco** em todo lugar (removidos `font-mono` que vinham do legado).
- Logo WaterWorks no topo da sidebar.
- Domínio custom: `painel.waterworks.com.br` (subdomain do registro Registro.br com A record).

### Versão

Badge `v1.x.y` aparece em URL e UI. `web/package.json` controla. Script `npm run deploy` faz `npm version patch --no-git-tag-version && vercel --prod --yes`. Versão atual: **v1.1.9**.

---

## 5. Permissões e RLS

### Roles (`platform.user_profiles.role`)

| Role         | Pode editar          | Pode aprovar | Observações                                                |
|--------------|----------------------|--------------|------------------------------------------------------------|
| `admin`      | Tudo                 | Sim          | `is_admin = true` no perfil. Único que pode `CANCELAR_PEDIDO`, apagar primeira linha |
| `aprovador`  | Bloco aprovação      | Sim          | Listado em `platform.approvers` por módulo                 |
| `comprador`  | PV/OS, RC, PC, Log   | Não          | Inserções e edição manual de PC#                           |
| `viewer`     | Nada (só leitura)    | Não          |                                                             |

### Matriz de capacidades

Definida em `web/lib/permissions.ts`:

```ts
const DEFAULTS = {
  admin:     { pvos:✓✓ rc:✓✓ pc:✓✓ aprovacao:✓✓ log:✓✓ extras:✓✓ },
  aprovador: { aprovacao:✓✓, demais:✗✗ },
  comprador: { pvos:✓✗ rc:✓✗ pc:✓✗ aprovacao:✗✗ log:✓✗ extras:✗✗ },
  viewer:    { tudo:✗✗ },
};
// Override por usuário em user_profiles.permissions (PermsOverride JSONB)
```

### RLS Postgres

Helpers SECURITY DEFINER:
- `platform.is_admin()` — checa `is_admin` no perfil
- `platform.is_approver(modulo)` — checa `platform.approvers`
- `platform.is_buyer()` — checa `role = 'comprador'`

Policies relevantes:
```sql
CREATE POLICY approvals_write ON approval.approvals FOR ALL TO authenticated
  USING (platform.is_admin() OR platform.is_approver(modulo) OR platform.is_buyer())
  WITH CHECK (platform.is_admin() OR platform.is_approver(modulo) OR platform.is_buyer());
```

API routes server-side fazem checks adicionais para statuses sensíveis (CANCELAR_PEDIDO, deleção de primeiras linhas).

### API routes admin-only

- `POST /api/approvals/set-status` — admin-gate para `CANCELAR_PEDIDO`
- `POST /api/approvals/batch-approve` — idem
- `POST /api/approvals/batch-delete` — admin pra apagar linhas Omie (`ncod_ped > 0`); aprovador/comprador só apagam secundárias
- `POST /api/admin/sync` — dispatch/toggle/set-schedule de workflows
- `POST /api/admin/invite` — convite de usuário (gera senha temporária)
- `POST /api/admin/update-permissions` — overrides por user×modulo×bloco
- `POST /api/admin/delete-user` — admin only
- `GET /api/admin/pc-lookup` — busca PC do Omie via service role (bypass RLS)

---

## 6. Status workflow

### `STATUS_ORDER` (lib/columns.ts)

```
PENDENTE          (default)
PRE_SELECAO       laranja-pulsante
APROVADO          verde
APROVADO_FAT_DIRETO  verde-azulado
NAO_APROVADO      rosa
REJEITADO_VALIDADE roxo
N_A               cinza
CANCELAR_PEDIDO   preto (admin only)
```

### Transições

- Qualquer status → `APROVADO/APROVADO_FAT_DIRETO`: snapshot `valor_aprovado`, `aprovador_email`, `aprovado_em`. Posta no Webex via bot.
- Qualquer status → `NAO_APROVADO/REJEITADO/etc`: limpa snapshot
- → `CANCELAR_PEDIDO`: API valida admin; remove PC dos cards "Pendentes"/"Atrasados"

### Notificações Webex

Bot: `newapp@webex.bot`. Token em env `WEBEX_TOKEN`, sala em `WEBEX_ROOM_ID`. Lib em `web/lib/webex.ts`:
- 1 PC aprovado → mensagem detalhada com fornecedor, projeto, valor
- N PCs em lote → card consolidado com lista + total

---

## 7. Importação de RC via Excel

### Formato do arquivo

- Nome: `RC####.xlsx` (regex `RC\s*(\d+)/i` extrai o número)
- Sheet 1, linhas a partir do cabeçalho detectado ("Descrição"/"Produto" nas 5 primeiras linhas)
- Colunas: **B** = descrição, **C** = quantidade, **D** = custo unitário
- Parser BR/US: aceita `1.234,56` ou `1234.56`

### Fluxo

1. Drag de XLSX num bucket PV/OS na UI (componente `RcExcelDropZone`)
2. Parser local (lib `xlsx`) extrai itens
3. Modal de prévia
4. Ao confirmar:
   - Upload do arquivo em `Storage/rc-files/{empresa}/{pv_os_label}/{ts}-{name}`
   - Para cada item: tenta preencher row em branco existente (ncod_ped < 0 sem rc_*); se faltar, cria row novo com next ncod_ped negativo
   - Cada row recebe `custom_fields = { rc_attachment_path, rc_attachment_name, rc_qtd }`

### Cálculo do total

`rc_custo_total_calc = SUM(rc_qtd × rc_custo) OVER (PARTITION BY empresa, pv_os_label)` — soma todos os itens do mesmo PV/OS.

---

## 8. Decisões e regras de negócio acumuladas

### Sales side (PV/OS)

- **Toda venda** (PV ou OS) vai para Avulsas ou Projetos
- Projeto começa com `PJ` → **Projetos**
- Projeto começa com `40_VS` ou `41_VP` → **Avulsas**
- Sem categoria ou outra categoria → **Avulsas + alarme `categoria_alert`** para o usuário corrigir no Omie

### PCs side

- PC vinculado naturalmente (via Omie sync ou manual) aparece dentro do bucket PV/OS da venda
- PC sem vínculo → **PC Standalone**
- PC vinculado manualmente puxa todos os campos (etapa, categoria, fornecedor, etc.) via lookup `cnumero` em `orders.pedidos_compra`
- Se projeto do PC ≠ projeto da venda → **alarme `pc_projeto_alert`** ("⚠ {projeto} ≠ venda")

### Standalone

- PCs vêm naturalmente — **sem input manual de PC#** (coluna PC# é só display)
- Coluna `pc_projeto_alert` removida (não há venda pra comparar)

### Auto-classificação extra

- PV/OS com prefixo `PJ` no projeto → automaticamente vai pra Projetos (não precisa marcar manual)
- Soft delete não implementado: cancelamento no Omie não sincroniza automaticamente; user marca `CANCELAR_PEDIDO` manualmente

---

## 9. Histórico de mudanças relevantes

### v1.1.x (abr/2026)

- ✅ Adicionada coluna `*RC.Qtd` editável no bloco RC + recalculo total `qtd × custo`
- ✅ Botão "Importar RC excel" laranja no topo direito **removido** (drop zone por linha já cobre)
- ✅ RLS liberada para `comprador` (criada `platform.is_buyer()`)
- ✅ Fix parser Excel: custo agora vem da coluna **D** (era **H**)
- ✅ Batch delete: admin apaga qualquer linha; aprovador/comprador só apagam `ncod_ped < 0`
- ✅ Real-time sums: `EditableCell.persist()` chama `router.refresh()` após upsert
- ✅ Lookup automático de PC vinculado manualmente (cnumero → todos campos)
- ✅ Coluna PC.Projeto sempre visível com sinalização `⚠` quando ≠ venda
- ✅ Bug "PCs em Vendas Avulsas" corrigido — só `_is_sale_row` entra
- ✅ PC# duplicado em Standalone removido

### v1.0 (mar-abr/2026)

- Migração SmartSuite → Supabase
- Auth Supabase com reset password por email
- Convite de usuários via API admin
- Domain custom `painel.waterworks.com.br`
- Webex notifications
- Permissões granulares por bloco (matriz user × modulo × block)
- Painel de Sync (workflows + runs) dentro do app
- Versão badge na UI

---

## 10. Pendências e melhorias

### Em curso

- [ ] **Bug `duracao_segundos`**: refator em todos os importers de orders/sales/auxiliares (5 arquivos pendentes ao escrever este doc) para passar `elapsed` no `update_sync_state`
- [ ] **Erro `pedidos_compra`**: último run em ERRO ("Omie falhou após 5 tentativas") em 24/04 22:11 — basta re-disparar via painel `/configuracoes`

### Proposta aberta

Reorganizar workflows em **2 categorias por módulo**:

| Workflow novo            | Frequência         | Conteúdo                                       |
|--------------------------|--------------------|------------------------------------------------|
| `sales_incremental`      | A cada 1h          | PV, itens vendidos, etapas (últimos 7d)        |
| `sales_full`             | 1×/dia (madrugada) | Tudo + produtos + auxiliares                   |
| `orders_incremental`     | A cada 1h          | Pedidos compra, NFe entrada (últimos 7d)       |
| `orders_full`            | 1×/dia             | Tudo + auxiliares                              |
| `finance_incremental`    | A cada 1h          | CP, CR (últimos 30d)                           |
| `finance_full`           | 1×/dia             | Tudo + cadastros                               |

Hoje só finance/sales (parcial) suportam incremental nativo. Para fazer essa reorganização, vai precisar refator em ~5 importers (pedidos_compra, nfe_entrada, etapas_pedidos, recebimento_nfe, ordens_servico) pra aceitar `DIAS_INCREMENTAL`.

### Backlog

- [ ] Soft delete tracking — detectar cancelamento no Omie e sincronizar
- [ ] Drop zone repositioning (user pediu mais clareza)
- [ ] Pré-configurar agendas (3h / 24-7) — sugerido mas não confirmado
- [ ] Investigar erros transitórios "Omie falhou após 5 tentativas" (rate-limit?)

---

## 11. Variáveis de ambiente

### Vercel (production)

- `NEXT_PUBLIC_SUPABASE_URL` — URL do projeto Supabase
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — chave anônima (RLS aplicada)
- `SUPABASE_SERVICE_ROLE_KEY` — service role (bypass RLS, usada em API routes server-side)
- `GITHUB_TOKEN` — PAT com Actions+Contents+Workflows (Read/Write) em `benny459/omie-supabase-sync`
- `WEBEX_TOKEN` — bot token do `newapp@webex.bot`
- `WEBEX_ROOM_ID` — sala onde posta as aprovações

### GitHub Actions secrets (sync)

- `OMIE_APP_KEY_*` / `OMIE_APP_SECRET_*` — credenciais por empresa (SF, CD, WW)
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`
- `SHEETS_MIRROR_URL` (opcional) — webhook do Apps Script para mirror Sheets

---

## 12. Comandos úteis

```bash
# Deploy production (web)
cd web && npm run deploy   # bumps v1.x.y + vercel --prod

# Pull env vars (não decripta valores — só lista nomes)
cd web && vercel env ls production

# Disparar workflow manual via painel
# /configuracoes → Workflows → "Disparar agora"

# Re-load PostgREST schema cache após DDL
# Supabase MCP execute_sql:  NOTIFY pgrst, 'reload schema';

# Listar runs recentes (precisa de admin auth no app)
# https://painel.waterworks.com.br/configuracoes
```

---

## 13. Convenções de código (CLAUDE.md highlights)

- ❌ **Não criar arquivos .md sem pedido** — documento atual foi explicitamente solicitado
- ✅ **Sempre deployar `web/` na Vercel** após edição (`npm run deploy`)
- ✅ Usar Edit em vez de Write para arquivos existentes
- ✅ Não adicionar comentários óbvios — código fala por si
- ✅ Validar UI no browser para mudanças de frontend
- ❌ Não usar `font-mono` ou outros fonts além de SF Pro

---

_Documento gerado em 2026-04-26 a partir do estado atual do repositório `omie-supabase-sync`._

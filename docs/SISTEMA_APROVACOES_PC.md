# Sistema de Aprovações de PC — Documentação Completa

> **App em produção**: https://painel.waterworks.com.br
> **Repositório**: `benny459/omie-supabase-sync`
> **Stack**: Next.js 16 (App Router) + React 19 + Tailwind 3 + Supabase Postgres + GitHub Actions (sync) + Vercel (hosting)
> **Versão atual**: v1.2.5 (atualizado 2026-05-05)

---

## 1. Visão geral

Sistema interno da WaterWorks para aprovação e gestão de Pedidos de Compra (PCs), substituindo a antiga solução em SmartSuite. Os dados originais vivem no **Omie** (ERP) e são espelhados em **Supabase Postgres** via importadores Python rodando em **GitHub Actions**. A interface web é um Next.js hospedado na **Vercel**.

### Diagrama macro

```
┌─────────┐   GitHub Actions cron     ┌──────────────────┐   Views     ┌───────────────────┐
│  Omie   │─────────►   Importers ────►│    Supabase      │────────────►│  Next.js (Vercel) │
│  (ERP)  │   (Python: scripts/)       │  schemas: orders │             │  painel.waterworks│
└─────────┘                            │  sales, finance, │             │  .com.br          │
                                       │  approval, plat. │             └───────────────────┘
                                       └──────────────────┘                       │
                                                ▲                                  │
                                                └──────── escrita direta ──────────┘
                                                  (status, custom_fields,
                                                   RC manual, exclusão, …)
```

3 empresas sincronizadas: **SF** (Sandcastle Filtros), **CD** (Castle Detoxify), **WW** (WaterWorks).

---

## 2. Modelo de dados

### Schemas Postgres

| Schema     | Propósito                                                                                                  |
|------------|------------------------------------------------------------------------------------------------------------|
| `orders`   | PCs e NFe entrada espelhados do Omie (`pedidos_compra`, `nfe_entrada`, `recebimento_nfe`, etc.)            |
| `sales`    | PVs, OSs, contratos, itens vendidos, etapas + `sync_state` (estado de cada importer)                       |
| `finance`  | Cadastros (clientes, projetos, categorias) + lançamentos (CP, CR, extratos, parcelas)                       |
| `approval` | Camada do app: `approvals`, `comments`, `attachments`, `audit_log`, **8 views**                            |
| `platform` | Usuários, perfis, perms, scheduler_log, excluded_pv_os, fetch_omie_log, workflow_schedule (legado)         |

### Tabela central: `approval.approvals` (1.446 rows hoje)

PK composta `(empresa, ncod_ped)`. Convenção:

- **`ncod_ped > 0`** — sincronizado do Omie (PC real). Apaga só admin.
- **`ncod_ped < 0`** — placeholder/extra criado pelo usuário (PV/OS sem PC, RC manual, PC manual standalone). Comprador/aprovador também apaga.

Colunas-chave:
- **Identidade**: `empresa`, `ncod_ped`, `pv_os_label`, `pc_numero_manual`, `modulo`
- **Workflow**: `status`, `aprovador_id`, `aprovador_email`, `aprovado_em`, `valor_aprovado`, `valor_aprovado_audit`, `aprovar_ate`, `prioridade`, `justificativa`, `comentario_aprovacao`
- **RC manual**: `rc_numero`, `rc_descricao`, `rc_custo`, `rc_custo_total`
- **Logística**: `comprador`, `status_material`, `mt_*`, `pc_pago`, `material_enviado`
- **Metadados**: `source` (`omie_sync`/`native`/`manual`/`smartsuite`), `smart_id`, `smart_tabela`, `imported_at`, `created_at`, `updated_at`, `updated_by`
- **Custom JSONB**: `custom_fields` (slugs como `s4b87bk9` = nova_prev_materiais, `s242fb18ba` = nova_prev_servicos, `rc_qtd`, `rc_attachment_path`, `rc_attachment_name`, `s6ebca6d00` = tipo_omie override)

### Tabelas de suporte (`approval`)

| Tabela          | Conteúdo                                                                |
|-----------------|--------------------------------------------------------------------------|
| `attachments`   | Arquivos anexados a aprovações (link via empresa+ncod_ped)               |
| `audit_log`     | 3.100 rows — log de todas mudanças em `approvals` via trigger            |
| `comments`      | Comentários inline por linha (vazio hoje)                                |

### Tabelas de plataforma (`platform`)

| Tabela              | Rows | Função                                                            |
|---------------------|------|-------------------------------------------------------------------|
| `user_profiles`     | 7    | Perfil + role (`admin`/`aprovador`/`comprador`/`viewer`) + is_admin |
| `user_module_roles` | 18   | Permissões granulares por user × módulo (avulsos/projetos/pcs)   |
| `approvers`         | -    | Legado — listagem antiga de aprovadores por módulo               |
| `workflow_schedule` | 2    | **Legado** — usado pelo controller antigo (substituído por crons fixos) |
| `scheduler_log`     | 1    | Log de decisões do controller (deprecado, migrando)               |
| `fetch_omie_log`    | 0    | Log de uso do botão "Buscar PC do Omie" (admin manual fetch)      |
| `excluded_pv_os`    | 1    | PVs/OSs marcados como excluídos do painel (não aparecem mesmo sincronizando) |

### Convenções 1:1 (legado SmartSuite)

- **PC ↔ tabela Smart é 1:1**: um PC nunca aparece em mais de uma tabela SmartSuite — sem precedência no import.
- **Modelo Smart**: 1 linha por item de PV/OS. PC.Numero só na 1ª linha; linhas sem PC.Numero são ignoradas no import.

### Views do schema `approval`

| View                          | Função                                                                                                                                  |
|-------------------------------|------------------------------------------------------------------------------------------------------------------------------------------|
| `v_pc_completo`               | **Base** — UNION ALL de 4 fontes: `existing_rows` (PCs do Omie + LEFT JOIN approvals) + `orphan_rows` (PV/OS sem approval) + `manual_rc_rows` (orphans editados, ncod_ped<0) + `manual_pc_rows` (PCs standalone manuais) |
| `v_pc_completo_enriched`      | Wrapper de `v_pc_completo` com derivações: parse de datas BR, fórmulas (window functions), lookup de PC manual, alarmes, **`modulo_calc`** |
| `v_pc_consolidado`            | Variação simplificada (legado/utilitária)                                                                                               |
| `v_pc_avulsos_orphan`         | PV/OS com projeto `40_VS|41_VP` SEM PC E SEM approval — usado pra completar v_pc_avulsos                                                |
| `v_pc_avulsos`                | UNION: `v_pc_completo_enriched WHERE modulo_calc='avulsos' + v_pc_avulsos_orphan`                                                       |
| `v_pc_projetos`               | `WHERE modulo_calc = 'projetos'`                                                                                                          |
| `v_pc_pcs`                    | `WHERE modulo_calc = 'pcs'`                                                                                                              |

### Regra de classificação `modulo_calc`

```sql
CASE
  WHEN _is_sale_row AND COALESCE(m_projeto_nome, projeto_nome) ~ '^PJ' THEN 'projetos'
  WHEN _is_sale_row AND COALESCE(m_projeto_nome, projeto_nome) ~ '^(40_VS|41_VP)' THEN 'avulsos'
  WHEN _is_sale_row THEN 'avulsos'                       -- venda sem categoria → avulsos + alarme
  WHEN COALESCE(m_projeto_nome, projeto_nome) ~ '^(PJ|40_VS|41_VP)' THEN 'standby'  -- PC sem PV mas projeto especial → manual
  ELSE 'pcs'                                              -- PC sem PV → standalone
END
```

- `_is_sale_row` = `pv_os_label IS NOT NULL OR pv_os_tipo IS NOT NULL`
- `m_projeto_nome` = projeto resolvido via lookup `pc_numero_manual → orders.pedidos_compra.cnumero`
- **`standby`** = limbo: precisa entrada manual (ngm vê em painel automático)

### Alarmes derivados em `v_pc_completo_enriched`

| Coluna                  | Tipo  | Quando dispara                                                  |
|-------------------------|-------|------------------------------------------------------------------|
| `categoria_alert`       | bool  | Linha de venda + projeto faltando ou diferente de `^(PJ\|40_VS\|41_VP)` |
| `categoria_alert_label` | text  | `⚠ {projeto}` ou `⚠ Sem categoria`                              |
| `pc_projeto_mismatch`   | bool  | PC manual com projeto ≠ projeto da venda                        |
| `pc_projeto_alert`      | text  | Projeto do PC; prefixa `⚠ ` quando há mismatch                  |

### Fórmulas calculadas (window functions)

- `rc_custo_total_calc` = `SUM(rc_qtd × rc_custo) OVER (PARTITION BY empresa, pv_os_label)`
- `pc_custo_total_calc` = `SUM(valor_total) OVER (PARTITION BY empresa, pv_os_label)`
- `prazo_entrega_dias` = `dt_previsao - dt_inclusao` (parse BR)
- `aprovar_ate_calc` = `pv_data_previsao - prazo_entrega - 5 dias`
- `dif_pct_pc_rc`, `rc_pc_vs_rc` (ranges com emojis 💎/🟢/🚫)
- `status_atraso_pv` (✅ Dentro / 🟡 Atrasado / 🟣 Atraso grande)

---

## 3. Funções de segurança (RLS)

Todas em `platform`, `STABLE SECURITY DEFINER`:

| Função                       | Retorna | Lógica                                                                       |
|------------------------------|---------|------------------------------------------------------------------------------|
| `is_admin()`                 | bool    | `user_profiles.is_admin = true` pra `auth.uid()`                            |
| `is_buyer()`                 | bool    | `user_profiles.role = 'comprador'`                                           |
| `is_approver(modulo)`        | bool    | `approvers` (legado) OR `user_module_roles.can_approve = true`              |
| `can_write_module(modulo)`   | bool    | `user_module_roles` com qualquer flag edit/approve = true                   |
| `user_weekly_approved(uid, modulo)` | numeric | Soma de `valor_aprovado` da semana corrente (controle de teto)         |
| `handle_new_auth_user`       | trigger | Cria `user_profiles` quando alguém se cadastra via auth                     |
| `umr_touch_updated_at`       | trigger | Atualiza `updated_at` em `user_module_roles`                                 |

### Policies em `approval.approvals`

```sql
approvals_read     FOR SELECT TO authenticated USING (true);
approvals_read_anon FOR SELECT TO anon          USING (true);
approvals_write    FOR ALL    TO authenticated
  USING      (is_admin() OR can_write_module(modulo) OR is_approver(modulo) OR is_buyer())
  WITH CHECK (is_admin() OR can_write_module(modulo) OR is_approver(modulo) OR is_buyer());
```

### Triggers ativas

| Schema    | Tabela              | Trigger                          | Função                                                            |
|-----------|---------------------|----------------------------------|-------------------------------------------------------------------|
| approval  | approvals           | `trg_approvals_audit`            | Audit log: insert em `audit_log` para INSERT/UPDATE/DELETE        |
| approval  | approvals           | `trg_approvals_touch`            | Atualiza `updated_at` automático                                  |
| approval  | approvals           | `trg_fill_pv_os_label_orphan`    | Se `ncod_ped<0` e `pv_os_label IS NULL`, resolve via lookup PV/OS |
| approval  | approvals           | `trg_pc_manual_unico`            | Garante que `pc_numero_manual` é único globalmente; auto-deleta orphan pendente em conflito |
| platform  | user_module_roles   | `trg_umr_touch`                  | Atualiza `updated_at`                                             |

### Postgres role config (Supabase)

| Role            | `statement_timeout` | `pgrst.db_max_rows` |
|-----------------|---------------------|---------------------|
| `authenticated` | 60s                 | 5000 (não-efetivo)  |
| `anon`          | 3s                  | 5000                |
| `service_role`  | sem limite          | sem limite          |

⚠ `pgrst.db_max_rows` via role config **não tem efeito** — Supabase ignora; PostgREST permanece em max_rows=1000. Solução adotada: paginação `.range()` quando necessário.

---

## 4. Sincronização Omie → Supabase

### Importadores e modos

Tabelas `pedidos_compra` e `etapas_pedidos` puxam **últimas 70 páginas** no diário (cobre 12m); `etapas_pedidos` faz **FULL semanal** pra cobrir pedidos antigos reabertos.

| Tabela                 | Schema  | Modo            | Importador                    |
|------------------------|---------|-----------------|-------------------------------|
| `pedidos_venda`        | sales   | INCREMENTAL     | `import_pedidos_venda.py`     |
| `itens_vendidos`       | sales   | INCREMENTAL     | `import_itens_vendidos.py`    |
| `contas_pagar`         | finance | INCREMENTAL     | `import_contas_pagar.py`      |
| `contas_receber`       | finance | INCREMENTAL     | `import_contas_receber.py`    |
| `pesquisa_titulos`     | finance | INCREMENTAL     | `import_pesquisa_titulos.py`  |
| `lancamentos_cc`       | finance | INCREMENTAL     | `import_finance_cadastros.py` |
| `extratos_cc`          | finance | INCREMENTAL     | `import_extratos_cc.py`       |
| `pedidos_compra`       | orders  | DIÁRIO 70p / FULL semanal | `import_pedidos_compra.py` |
| `etapas_pedidos`       | sales   | DIÁRIO 70p / FULL semanal | `import_etapas_pedidos.py` |
| `nfe_entrada`          | orders  | FULL            | `import_nfe_entrada.py`       |
| `recebimento_nfe`      | orders  | FULL            | `import_recebimento_nfe.py`   |
| `ordens_servico`       | sales   | FULL            | `import_servicos.py`          |
| `contratos_servico`    | sales   | FULL            | `import_servicos.py`          |
| `produtos`             | sales   | FULL semanal    | `import_produtos.py`          |
| `produtos_compras`, `etapas_faturamento`, `formas_pag_*` | orders | FULL semanal | `import_orders_auxiliares.py` |
| `clientes`, `categorias`, `projetos`, `aux_*` | finance | FULL semanal | `import_finance_cadastros.py` |

### Workflows GitHub Actions (estado atual: crons fixos)

Decisão 2026-04-29: **abandonado o controller `master_scheduler.yml`** com cron `*/15 *` (atrasava demais). Cada workflow tem **seu próprio cron fixo**.

| Workflow                        | Cron UTC                              | Horário BRT                                  |
|---------------------------------|---------------------------------------|-----------------------------------------------|
| `master_orders_diaria.yml`      | `0 10,13,16,19,22 * * 1-5,0`          | 7, 10, 13, 16, 19 BRT (seg-sex + dom)        |
| `master_finance_diaria.yml`     | idem                                  | idem                                         |
| `master_sales_diaria.yml`       | idem                                  | idem                                         |
| `master_orders_semanal.yml`     | `0 10 * * 0`                          | Domingo 7h BRT                               |
| `master_finance_semanal.yml`    | idem                                  | idem                                         |
| `master_sales_semanal.yml`      | idem                                  | idem                                         |
| `master_finance_full.yml`       | manual                                | (rodar quando precisa rebackfill completo)   |
| `master_scheduler.yml`          | **sem cron** (legado, só `workflow_dispatch` em dry-run) | — |

⚠ **GitHub Actions atrasa crons** em horários de pico — observamos atrasos de 50-90min nos slots da tarde. Documentado/aceito; é melhor que `*/15` que perdia slots inteiros.

### Estado de sync (`sales.sync_state`, 56 rows = N módulos × 3 empresas)

PK = `(modulo, empresa)`. Faz **UPSERT** a cada execução → mantém só o último estado, sem histórico.

Colunas: `last_sync_at`, `total_registros`, `rows_inserted`, `rows_updated`, `rows_before`, `ultima_execucao_status` (SUCESSO/ERRO), `ultima_execucao_msg`, `modo`, `duracao_segundos`.

Pra **histórico de runs com timestamp**, ver:
- Painel `/configuracoes` → "Workflows: horários e status"
- API `GET /api/admin/run-history?days=N` (admin only) — busca via GitHub Actions API e cruza com slots esperados

### Fetch single-PC (admin only)

`POST /api/admin/fetch-omie` — admin pode buscar PC específico direto do Omie sem esperar o sync diário, pra urgências. Proteções:
- Rate-limit 10/h por user
- Cache 5 min (se já sincronizado recentemente, retorna cached)
- Audit log em `platform.fetch_omie_log`

UI: botão "Buscar PC do Omie" no header de `/configuracoes`.

---

## 5. Frontend — páginas e componentes

### Páginas principais

```
/login              # Auth
/recover            # Reset senha
/avulsos            # Vendas Avulsas (modulo_calc='avulsos')
/projetos           # Projetos (modulo_calc='projetos', agrupado por projeto OU PV/OS)
/pcs                # PCs Standalone (modulo_calc='pcs')
/relatorios         # Resumo de aprovados (sidebar)
/configuracoes      # Admin only — usuários, sync, detalhes execução
```

Todas as 3 páginas de solução (`/avulsos`, `/pcs`, `/projetos`) usam o componente `BoldAvulsosView` parametrizado.

### Estrutura de blocos (`web/lib/columns.ts`)

| Group         | Key         | Tint               | Columns destacadas                                              |
|---------------|-------------|--------------------|------------------------------------------------------------------|
| PV/OS · Omie  | `pvos`      | `bg-violet-50/70`  | `pv_os_label`, `pv_emissao`, cliente, **`pv_numero_contrato` (Proposta)**, projeto, valor, etapa, NF saída, **`servicos_concluidos` (V.Serviços OK — só /avulsos)** |
| RC            | `rc`        | `bg-amber-50/70`   | `rc_numero`, `rc_descricao`, `rc_qtd`, `rc_custo`, total (F)    |
| PC (Omie)     | `pc`        | `bg-blue-50/60`    | `pc_numero`, `pc_projeto_alert`, etapa, categoria, fornecedor, justificativa |
| Aprovação     | `aprovacao` | `bg-emerald-50/70` | `status_label`, `aprovador_email`, `aprovado_em`, comentario    |
| Logística     | `log`       | `bg-cyan-50/70`    | `mt_status_fornecimento`, NF datas, número                      |
| Fórmulas/Meta | `extras`    | `bg-slate-50`      | dias_para_aprovar, dif_rc_pc, source, anexos                    |

### Componentes-chave

| Arquivo                                | Função                                                                                          |
|----------------------------------------|--------------------------------------------------------------------------------------------------|
| `BoldAvulsosView.tsx`                  | View principal das 3 páginas. Bucket por PV/OS ou PC. Filtros, KPIs, batch select, paginação client. |
| `EditableCell.tsx`                     | Input inline (text/date/money/number/textarea). Persiste em `approvals` (custom_fields ou coluna direta) |
| `EditableStatusCell.tsx`               | Dropdown de status via `createPortal`. `CANCELAR_PEDIDO` admin-only                              |
| `RcExcelDropZone.tsx`                  | Drop XLSX por bucket. Parser col B=desc/C=qtd/D=custo. Storage `rc-files/{empresa}/{pv}/`        |
| `AddRowButton.tsx`                     | "+ Nova linha" no rodapé do bucket. Cria N rows com `ncod_ped < 0`                              |
| `PcInlineAdd.tsx`                      | "+ Adicionar PC" topo de `/pcs`. Lookup em `orders.pedidos_compra` antes de gravar manual       |
| `GlobalSearch.tsx`                     | Busca global ⌘K. Modal com input + hits. Click → navega pra módulo certo via `#bucket=` hash    |
| `FetchOmieButton.tsx`                  | Botão admin "Buscar PC do Omie" (fetch direto Omie pra urgência)                                |
| `QuickRunButtons.tsx`                  | "▶ Rodar diária" + "▶ Rodar semanal" no header de `/configuracoes`                              |
| `RunDetailsPanel.tsx`                  | Tabela de detalhes de execução por função (lê `sales.sync_state`)                                |
| `SyncStatusBar.tsx`                    | Topo da página — "Última sync: há Xh"                                                            |
| `SyncPanel.tsx`                        | Painel de workflows + runs em `/configuracoes`                                                   |
| `UsersAdmin.tsx`                       | CRUD de usuários (admin only)                                                                    |
| `VersionWatcher.tsx`                   | Badge `v1.x.y` sempre visível no top bar. Quando há update, vira botão verde animado             |

### Busca global (⌘K)

`/api/search?q=<termo>`:

- **Texto livre**: ilike em `pc_numero, pv_os_label, pv_os_numero, pv_origem_numero, nome_fornecedor, contato_fornecedor, pv_cliente_nome, pv_cliente_fantasia, projeto_nome`
- **Numérico puro** (ex: `1705`): só pc_numero/pv_os_numero/pv_origem_numero (rápido, sem range em valor)
- **Numérico decimal** (ex: `1901,89` ou `1901.89`): adiciona range em `valor_total`/`pv_valor_total` na faixa exata

3 queries paralelas (`v_pc_avulsos` + `v_pc_pcs` + `v_pc_projetos`) garantem que **PV/OS órfãos** (sem PC) também aparecem.

Click no hit → navega pra `/{modulo}#bucket=<label>`. Em `/avulsos` e `/projetos` o `data-bucket` = `pv_os_label`. Em `/pcs` é chave composta `empresa|ncod_ped`, mas há também `data-pc=<numero>` pro scroll achar quando hash começa com `PC `.

Click rápido (~500ms): se o bucket alvo não está nos rows pré-carregados, faz **targeted fetch** `/api/rows?view=...&label=X` ou `&pc=X` (~200ms) e injeta a row antes do scroll.

### Paginação

`/avulsos` (1.314 rows hoje), `/pcs` (1.219), `/projetos` (330) carregam só **1.000 rows no SSR** (PostgREST corta em max_rows=1000). Cliente faz **fetch em background** via `/api/rows?view=...&from=1000&to=1999` pra completar — header mostra "carregando mais…" amarelo enquanto roda.

---

## 6. Permissões

### Roles (`platform.user_profiles.role`)

| Role         | Pode editar          | Pode aprovar | Observações                                                |
|--------------|----------------------|--------------|------------------------------------------------------------|
| `admin`      | Tudo                 | Sim          | `is_admin = true`. Único que `CANCELAR_PEDIDO`, apaga PC do Omie, FetchOmieButton |
| `aprovador`  | Bloco aprovação      | Sim          | Pode aprovar/reprovar até teto (`approval_ceiling_brl`)   |
| `comprador`  | Conforme `user_module_roles` | Não  | Inserções manuais (RC, PC standalone), edição RC/PC       |
| `viewer`     | Nada (só leitura)    | Não          |                                                             |

### Permissões granulares (`platform.user_module_roles`)

PK = `(user_id, modulo)`. Modulos: `avulsos`, `projetos`, `pcs`. Flags por bloco:

| Coluna           | Habilita edição em                                       |
|------------------|----------------------------------------------------------|
| `can_edit_pv`    | Campos editáveis do PV (nova_prev_materiais/servicos)    |
| `can_edit_rc`    | Bloco RC inteiro (rc_numero, rc_descricao, rc_custo, ...) |
| `can_edit_pc`    | Bloco PC, pc_numero_manual, justificativa                |
| `can_edit_log`   | Logística (status_material, mt_*, datas NF)             |
| `can_approve`    | Bloco aprovação (status, valor_aprovado, etc)           |
| `approval_ceiling_brl` | Teto de valor pra aprovação (NULL = sem limite)   |
| `weekly_budget_brl`    | Teto semanal (`user_weekly_approved` controla)    |

### API routes admin/restritas

- `POST /api/approvals/set-status` — gate admin pra `CANCELAR_PEDIDO`
- `POST /api/approvals/batch-approve` — em lote
- `POST /api/approvals/batch-delete` — admin pra `ncod_ped > 0`; aprovador/comprador só `< 0`
- `POST /api/admin/sync` — dispatch / toggle / set-schedule de workflows
- `GET  /api/admin/run-details` — lê `sales.sync_state` agrupado por workflow
- `GET  /api/admin/run-history` — agrega GitHub Actions runs com slots esperados
- `POST /api/admin/fetch-omie` — admin only, single-fetch + rate-limit + cache + log
- `GET  /api/admin/pc-lookup` — busca PC em `orders.pedidos_compra` (service role bypass)
- `POST /api/admin/invite` — convite (gera senha temporária)
- `POST /api/admin/update-permissions` — overrides
- `POST /api/admin/delete-user` — admin only
- `GET  /api/rows?view=...&from=..&to=..` — paginação client (1000-row windows)
- `GET  /api/rows?view=...&label=X|pc=X` — targeted fetch de bucket específico
- `GET  /api/search?q=...` — busca global (qualquer authenticated user)
- `GET  /api/version` — buildId + version (público, polling do VersionWatcher)

### Usuários ativos hoje (7)

| Email                          | Role         | Notas                                                |
|--------------------------------|--------------|------------------------------------------------------|
| `benny@waterworks.com.br`      | admin        | Full access, dispatcha workflows                     |
| `compras@waterworks.com.br`    | comprador (Erick) | edit PV/RC/PC em avulsos+projetos+pcs           |
| `suporte@waterworks.com.br`    | comprador (Cristina) | can_edit_pv em avulsos                       |
| `filipe@waterworks.com.br`     | comprador    | can_edit_rc em avulsos+projetos                      |
| `fernanda@waterworks.com.br`   | aprovador    | aprova projetos                                       |
| (outros)                       | -            |                                                       |

---

## 7. Status workflow

```
PENDENTE          (default)
PRE_SELECAO       laranja-pulsante
APROVADO          verde
APROVADO_FAT_DIRETO  verde-azulado (faturamento direto, sem RC)
NAO_APROVADO      rosa
REJEITADO_VALIDADE roxo
N_A               cinza
CANCELAR_PEDIDO   preto (admin only)
```

### Status efetivo (`/avulsos`)

Quando todos os PCs do bucket estão aprovados, **RC manuais sem PC herdam APROVADO** automático (não precisa o user marcar 1 a 1). Lógica em `BoldAvulsosView.effectiveStatus()`.

### Notificações Webex

Bot `newapp@webex.bot` (`WEBEX_TOKEN`, `WEBEX_ROOM_ID`):
- 1 PC aprovado → mensagem detalhada
- N PCs em lote → card consolidado com lista + total

---

## 8. Importação RC via Excel

- Nome: `RC####.xlsx` (regex `RC\s*(\d+)/i`)
- Sheet 1, header detectado nas primeiras 5 linhas (`Descrição`/`Produto`)
- Colunas: **B**=descrição, **C**=qtd, **D**=custo unitário
- Parser BR/US: `1.234,56` ou `1234.56`

Fluxo:
1. Drag XLSX num bucket PV/OS
2. Parser local (`xlsx`) extrai itens
3. Modal de prévia
4. Confirma → upload em `Storage/rc-files/{empresa}/{pv_os_label}/{ts}-{name}` + cria/preenche rows com `ncod_ped < 0`

---

## 9. Histórico recente de mudanças relevantes

### v1.2.5 (2026-05-05) — Coluna "🔗 Link Serviços" com 3 estados + filtro 4 opções

- ✅ **Coluna renomeada** de `V.Serviços OK` → **`🔗 Link Serviços`**
- ✅ **3 estados visuais** na célula:
  - sem `servicos_os_numero` → `—`
  - `servicos_os_numero` populado + `servicos_concluidos = FALSE` → 🕓 OSxxx + label "Agendado" (laranja). Tooltip: "Agendado (ainda não foi executado)"
  - `servicos_os_numero` populado + `servicos_concluidos = TRUE` → ✅ OSxxx + data DD/MM/YYYY abaixo
- ✅ **Filtro "Serviços"** virou 4 opções: Todos / ✅ Executados / 🕓 Agendados / Sem OS
- ✅ **Convenção pro waterworks-app**: agendamento = só popular `servicos_os_numero` (deixa `servicos_concluidos = false`); execução = popular todos os 4 campos com `servicos_concluidos = true`

### v1.2.4 (2026-05-05) — Bug fix multi-select dos facets + "Limpar todos os filtros" sempre visível

- 🐛 **Bug latente corrigido**: `facetValues` calculava as opções de cada facet a partir de `filtered`, que já aplicava o próprio facet. Resultado: ao marcar "Entrega" em **Etapa Venda**, as outras opções (Faturado, Em Execução…) **sumiam** do dropdown, impossibilitando multi-select. Refatoração: extraída função `passesFilters(row, { skipFacet })` e `facetValues[key]` agora ignora o filtro do próprio facet
- ✅ **Botão "✕ Limpar todos os filtros" sempre visível** (era condicional). Desabilitado/cinza quando nada selecionado, vermelho ativo quando há qualquer filtro

### v1.2.3 (2026-05-05) — "Limpar todos os filtros" mestre + dropdown alinhamento

- ✅ **Botão "✕ Limpar todos os filtros"** (vermelho destacado) zera de uma vez: facets, status, etapa PV, serviços executados, atraso, range de datas, busca de texto
- ✅ **Dropdown FacetDropdown alinhado à esquerda** do botão (era right-0 → left-0) — não corta mais quando filtro está no canto esquerdo da tela

### v1.2.2 (2026-05-05) — UX do FacetDropdown

- ✅ Largura 260px → 320px (não corta mais labels longos)
- ✅ Header explicativo "Marque uma ou mais opções"
- ✅ Botão "Limpar todos" sempre visível no rodapé do dropdown (desabilitado quando 0)
- ✅ Botão "Aplicar" verde no rodapé pra confirmar e fechar

### v1.2.1 (2026-05-05) — Trigger propagação por bucket + rowspan visual

- ✅ **Trigger `trg_propagate_servicos_bucket`** (`approval.fn_propagate_servicos_bucket`): UPDATE em qualquer row de `(empresa, pv_os_label)` propaga os 4 campos `servicos_*` pras outras rows do mesmo bucket. waterworks-app não precisa enumerar rows — basta um UPDATE com `WHERE pv_os_label = 'OS4364'` ou em qualquer ncod_ped do bucket
- ✅ **Rowspan visual** no painel: `servicos_concluidos` adicionado em `MERGED_KEYS` do `BoldAvulsosView`. Mostra ✅/🕓 + OSxxx **apenas na 1ª linha** do bucket (pvosRuns); linhas seguintes ficam mescladas
- ✅ **Render: número OS sem traço** (`OS-1058` → `OS1058`) + data DD/MM/YYYY na linha 2
- ✅ Click no número abre `app.waterworks.com.br/ordens-de-servico/<num>` em nova aba

### v1.2.0 (2026-05-05) — Conclusão de serviços (escrita pelo waterworks-app)

- ✅ **4 colunas novas** em `approval.approvals`: `servicos_concluidos BOOLEAN DEFAULT FALSE`, `servicos_os_numero TEXT`, `servicos_concluidos_em TIMESTAMPTZ`, `servicos_concluidos_por TEXT`
- ✅ **Index parcial** `idx_approvals_servicos_concluidos` (WHERE `servicos_concluidos = TRUE`)
- ✅ **Coluna `V.Serviços OK`** no bloco PV/OS, **só em `/avulsos`** — render: `✅ <link OS-N>` + tooltip "Concluído em DD/MM/YYYY HH:mm por <email>". Click no nº abre `app.waterworks.com.br/ordens-de-servico/<num>` em nova aba
- ✅ **Filtro "Serviços executados"** (Todos/Concluídos/Pendentes) abaixo do filtro de etapa PV — só em `/avulsos`
- ✅ **Convenção de escrita** (waterworks-app via service_role):
  ```sql
  UPDATE approval.approvals
     SET servicos_concluidos     = TRUE,
         servicos_os_numero      = 'OS-1058',
         servicos_concluidos_em  = now(),
         servicos_concluidos_por = '<email>'
   WHERE empresa = $1 AND ncod_ped = $2;
  ```
- ✅ **6 views recriadas** com os 4 campos novos no fim: `v_pc_completo`, `v_pc_completo_enriched`, `v_pc_avulsos`, `v_pc_projetos`, `v_pc_pcs` (`v_pc_avulsos_orphan` não usa — UPDATE só atinge rows com `ncod_ped > 0` ou `< 0` que tenham approval row)
- 🐛 **Bugfix latente da v1.1.41 (Proposta)** — as views derivadas (`v_pc_avulsos`, `v_pc_projetos`, `v_pc_pcs`) listam colunas explícitas (não `SELECT *`). Na v1.1.41 só `v_pc_completo`/enriched foram atualizadas → coluna `pv_numero_contrato` deployada mas **vazia no painel**. Corrigido nesta release: todas 5 views agora expõem o campo
- ⚠ **Spec assumiu `updated_by` TEXT, mas é UUID** (FK pra `auth.users.id`). Convenção `'waterworks-app:<email>'` proposta no spec **não funciona**. Recomendação: criar service-user dedicado em `auth.users` pro waterworks-app e usar o UUID dele em todos os UPDATEs — auditoria via `audit_log` fica rastreável. Item pendente, **não bloqueia** a feature (audit funciona sem isso)
- 📝 **Limitação Postgres** (mesma da v1.1.41): colunas novas adicionadas no FIM do SELECT das views, não no meio. UI organiza visualmente

### v1.1.41 (2026-05-05) — Coluna "Proposta" (Nº Contrato Venda Omie)

- ✅ **Nova coluna `Proposta` no bloco PV/OS** — aparece logo após `V.Cliente_Omie` em Avulsos e Projetos. Mostra o nº do contrato de venda do Omie (ex: `OPS1604261026`), que corresponde à proposta original do CRM. Em branco quando o Omie não tiver o campo preenchido.
- ✅ **Nova coluna `numero_contrato TEXT`** em `sales.pedidos_venda` e `sales.ordens_servico` — populada via importer:
  - PV: `informacoes_adicionais.numero_contrato` (endpoint `ListarPedidos`)
  - OS: `InformacoesAdicionais.cNumContrato` (endpoint `ListarOS`)
- ✅ **Backfill via `forcar_full=true`** — todos os PVs/OS desde `01/01/2025` foram re-importados com o campo populado
- ✅ **Views recriadas** — `approval.v_pc_completo` e `approval.v_pc_completo_enriched` agora expõem `pv_numero_contrato` (COALESCE entre `pv_info.numero_contrato` e `os_info.numero_contrato`)
- 📝 **Limitação Postgres**: nova coluna foi adicionada **no fim** do SELECT das views — `CREATE OR REPLACE VIEW` não permite inserir coluna no meio (interpreta como rename). Pra reorganizar a ordem física das colunas seria necessário `DROP CASCADE` + recriar tudo

### v1.1.40 (2026-05-04) — Bug fix: "+ Nova linha" em modo projeto

- ✅ **Botão "+ Nova linha" agora aparece em modo agrupado por projeto** (`/projetos`) — antes era ocultado deliberadamente quando bucket abrangia múltiplos PVs
- ✅ **Modal mostra dropdown PV/OS** quando bucket é projeto (já existia em `AddRowButton.tsx`, só faltava ser ativado pelo `BoldAvulsosView`)
- ❌ **Upload XLSX continua oculto em modo projeto** — precisaria do mesmo seletor de destino no `RcExcelDropZone` (decisão de UX: deixar XLSX só em modo PV/OS por ora). Pra subir Excel pra um projeto, troca o agrupamento pra PV/OS
- 🐛 Bug reportado pelo Eric (CNTT) — não conseguia inserir pedidos PJ porque o botão sumia em modo projeto. Causa: condição `bucket.groupKind === "pvos"` em `BoldAvulsosView.tsx:1385`

### v1.1.39 (2026-04-30 → 05-01)

- ✅ **Crons fixos por workflow** — abandonado `master_scheduler` (controller `*/15`); cada YAML tem cron próprio (7/10/13/16/19 BRT diária; dom 7 BRT semanal)
- ✅ **Versão sempre visível** — VersionWatcher no top bar (badge v1.x.y), vira botão verde quando há update
- ✅ **Botões "Rodar diária/semanal agora"** — header de `/configuracoes` (QuickRunButtons)
- ✅ **Painel "Detalhes de execução por função"** — RunDetailsPanel + `/api/admin/run-details` lendo `sales.sync_state`
- ✅ **`/api/admin/run-history`** — histórico de GitHub runs cruzado com slots esperados
- ✅ **Botão "🗑 Apagar"** no batch toolbar (Filipe pediu pra apagar duplicata RC 6620)

### v1.1.3x (abr/2026, ciclo de busca + paginação)

- ✅ **Busca global ⌘K** (`GlobalSearch` + `/api/search`) — texto + numérico (com range só pra decimais)
- ✅ **Targeted fetch por hash** — click no hit traz a row alvo em ~500ms (`?label=` ou `?pc=`)
- ✅ **Paginação client `/api/rows`** — completa rows >1000 em background sem travar SSR
- ✅ **`maxDuration = 30/60`** nas pages do `(app)` group pra evitar gateway timeout do Vercel
- ✅ **Trigger `trg_fill_pv_os_label_orphan`** — preenche `pv_os_label` automático quando user salva edit em row órfã
- ✅ **Permissões granulares**: `is_buyer()`, `can_write_module()`, `can_edit_pv` flag pra Cristina/Filipe
- ✅ **Coluna `pc_projeto_alert`** sempre visível (alerta `⚠` quando projeto PC ≠ venda)
- ✅ **Standby branch** no `modulo_calc` — PC sem PV com projeto especial não aparece automático
- ✅ **`statement_timeout = 60s`** em `authenticated` (era 8s, estourava em queries pesadas)
- ✅ **Reportar erro real Omie** — `_common.fetch_omie` agora inclui HTTP code + faultstring no RuntimeError
- ✅ **Dedup `produto_fornecedor`** — fix Postgres erro 21000 (ON CONFLICT 2x na mesma row)

### v1.1.x antes (mar-abr/2026)

- Coluna `*RC.Qtd` editável + recalculo `qtd × custo`
- Soft delete via `excluded_pv_os` (admin marca PVs/OSs como ocultos do painel)
- Trigger `trg_pc_manual_unico` com auto-libera de orphan pendente em conflito
- Real-time sums (router.refresh após upsert)
- Lookup automático de PC vinculado manualmente (cnumero → todos campos)

### v1.0 (mar-abr/2026)

- Migração SmartSuite → Supabase
- Auth Supabase + reset password por email
- Domain custom `painel.waterworks.com.br`
- Webex notifications
- Permissões granulares por bloco

---

## 10. Pendências / Backlog

- [ ] **`scheduler_log` vazio** — controller antigo desativado mas a tabela continua sem inserts. Limpar ou repurpose pra fixed-cron tracking
- [ ] **Otimizar `v_pc_avulsos`** — query `SELECT *` demora 5-15s (window functions + UNION pesado). Materialized view ou simplificação seria útil
- [ ] **Atrasos do GitHub Actions cron** — aceitar/documentar; não dá pra resolver no nosso lado
- [ ] **`lancamentos_cc_*` ERRO** — Omie endpoint instável; com novo error reporting, próximo run vai mostrar HTTP exato pra investigar
- [ ] **`aux_finalidades_transferencia`, `aux_tipos_conta_corrente`** — mesma situação
- [ ] **Soft delete tracking** — detectar cancelamento no Omie e sincronizar
- [ ] **Restauração de PV/OS excluído** — UI admin pra remover de `excluded_pv_os`
- [ ] **`ntotal_pedido` NULL** em `pedidos_compra` — Omie não retorna no `Pesquisar`. Não impacta UI (soma de `nval_tot` cobre); cosmético só

---

## 11. Variáveis de ambiente

### Vercel (production)

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_BUILD_ID` — `VERCEL_GIT_COMMIT_SHA[:8]` (auto)
- `NEXT_PUBLIC_APP_VERSION` — lido de `web/package.json`
- `GITHUB_TOKEN` ou `GH_DISPATCH_TOKEN` — PAT com Actions+Contents+Workflows R/W em `benny459/omie-supabase-sync`
- `WEBEX_TOKEN`, `WEBEX_ROOM_ID`
- `OMIE_APP_KEY_SF/CD/WW`, `OMIE_APP_SECRET_SF/CD/WW` — usados pelo FetchOmieButton

### GitHub Actions secrets (sync)

- `OMIE_APP_KEY_*` / `OMIE_APP_SECRET_*` por empresa
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- `GH_DISPATCH_TOKEN` (legado, era usado pelo controller — pode remover)
- `SHEETS_MIRROR_URL`, `SHEETS_MIRROR_TOKEN` (opcional, mirror Sheets)

---

## 12. Comandos úteis

```bash
# Deploy production
cd web && vercel --prod --yes

# Bump versão (manual no package.json) e deploy
cd web && npx tsc --noEmit && vercel --prod --yes

# Ver runs recentes (admin no app)
# https://painel.waterworks.com.br/configuracoes

# NOTIFY pra recarregar PostgREST após DDL
# Supabase MCP: NOTIFY pgrst, 'reload schema';

# Validar schedule fixo dos workflows
grep -A2 "^  schedule:" .github/workflows/master_*.yml

# Disparar manualmente os 6 master_*
# /configuracoes → "▶ Rodar diária" / "▶ Rodar semanal"
```

---

## 13. Convenções de código (CLAUDE.md highlights)

- ❌ **Não criar arquivos `.md` sem pedido** — este foi explicitamente solicitado
- ✅ **Sempre deployar `web/` na Vercel** após edição (validamos em produção)
- ✅ Usar Edit em vez de Write para arquivos existentes (exceto reescrita completa)
- ✅ Não adicionar comentários óbvios — código fala por si
- ✅ Validar UI no browser pra mudanças de frontend (Playwright local com `E2E_BASE_URL` apontando pro deploy)
- ❌ Não usar `font-mono` ou outros fonts além de SF Pro (exceto badges técnicos: versão, ⌘K, etc)

---

_Documento atualizado em 2026-05-05. Estado refletido: schemas, views, RLS, triggers, scheduling fixo, busca global ⌘K, paginação client, fetch targeted, permissões granulares, batch delete, version watcher sempre visível, FetchOmieButton admin, **coluna Proposta (Nº contrato venda Omie) em PV/OS**, **fix botão "+ Nova linha" em modo projeto**, **🔗 Link Serviços com 3 estados (—/🕓/✅) + filtro 4 opções + trigger de propagação por bucket**, **multi-select dos facets corrigido + "✕ Limpar todos os filtros" mestre**._

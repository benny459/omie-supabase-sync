# Central de Ordem no painel — Fase 0 (inventário, permissões, fontes) e gate

SPEC: `SPEC-allka-em-dia-central-de-ordem.md` (+ contrato do cartão, Meu dia, mensagens e escada de `SPEC-ciclo-os-chamado-aria.md`).
**Desvio pedido pelo Benny (09/10/26):** construir DENTRO do painel legado (aba por módulo + Meu dia), não na barra do portal ALLKA. Serviços/RH e CRM ligam-se depois ao mesmo modelo de dados (`ordem.*`, por `tenant_slug`).
**Benny (09/10/26):** "me deixe configurar tudo para ir habilitando" → tudo nasce desligado; valores da SPEC como *sugerido*; histórico de mudanças.

## 1. Mapa módulo → camada de permissão (confirmado no código)

| Módulo da Central | Tela tradicional | Verificação de hoje (reutilizada em `lib/ordem/acesso.ts`) | Valores (R$) |
|---|---|---|---|
| compras | `/erp/compras` | `requirePermissao("compras.acesso")` = área `erp` (linha explícita) + chave | `compras.ver_valores` |
| financeiro | `/financeiro/pagar`, `/receber` | `requirePermissao("financeiro.ver_pagar"|"ver_receber")`; P2 "estrito" exige também a área `financeiro` | — |
| faturamento | `/faturamento` | `requirePermissao("faturamento.acesso")` | — |
| estoque | `/estoque` | `requirePermissao("estoque.acesso")` | `estoque.ver_custos` |
| cadastros | `/cadastros/*` | `requireArea("erp")` | — |
| operacao | `/avulsos`, `/pcs` | `canViewArea("operacao")` (menu) | `canViewValues(avulsos)` |
| projetos | `/projetos` | `canViewArea("operacao")` | `canViewValues(projetos)` |
| comercial | CRM legado | o próprio CRM (`/api/ordem-comercial?email=` devolve [] a quem não tem) | — |

Itens com chave extra: `receber_vencido` → `financeiro.ver_receber`; `extrato_a_conciliar` → `financeiro.conciliar`; restantes de pagar → `financeiro.ver_pagar`.
Ações: interruptor do admin **e** a chave da tela (`PERMISSAO_DA_ACAO`); a rota existente volta a verificar tudo (alçada, budget, `projetos.aprovar_acima_budget`).
Nota P2: hoje Títulos a Pagar/Receber exigem a área **ERP** (não a área "financeiro", que é DRE/BI). "tela" reproduz isso; "estrito" só restringe.

## 2. Perfis reais (platform.*, 09/10/26) usados no teste de permissões

| Pessoa | Áreas | Chaves relevantes | Vê na Central |
|---|---|---|---|
| benny@ (admin) | erp, financeiro, bi | todas | todos os módulos |
| marcelo@ (aprovador) | — (sem ERP) | compras.aprovar, projetos.aprovar_acima_budget | Operação, Projetos |
| gabriel@ | erp; operacao **negada** | compras.acesso, estoque.acesso | Compras, Estoque, Cadastros |
| fernanda@ (aprovador) | erp | faturamento.acesso (financeiro negado) | Compras, Operação, Projetos, Faturamento, Estoque, Cadastros |
| suporte@ Cristina (role admin, is_admin=false) | erp; financeiro negado | compras.acesso, enviar_fornecedor | Compras, Operação, Projetos, Cadastros (+Estoque pelo padrão erp) |
| compras@ Erick | erp | compras.*, faturamento.acesso | Compras, Operação, Projetos, Faturamento, Estoque, Cadastros |
| bpofinanceiro@ | erp | financeiro.* | Financeiro, Compras/Estoque (padrão erp), Cadastros |

## 3. Fontes de dados dos detetores (todas só leitura; nenhuma escreve)

| Detetor | Fonte (função existente) | Regra reutilizada |
|---|---|---|
| pc_pendente_aprovacao | `orders.compras_lista` + `lerAjustes` (mesmo filtro de `GET /api/compras`, **sem** os passos de escrita que essa rota faz antes) | coluna "Pedido de Compra · Pendentes" |
| pc_nao_enviado | idem | `naoEnviado` (`lib/compras.ts`) |
| entrega_atrasada | idem | `atrasado` (`lib/compras.ts`), só aprovados, 7–180 d |
| recebido_nao_conferido | idem | etapa 60 + M2 |
| nf_casar_lote / nf_divergente | `orders.compras_nfs_sugeridas` + `compras_nfs_do_pedido` (Focus) | M1 |
| nf_sem_pedido | `orders.compras_nfs_sem_pedido('SF')` | alarme ⛔ |
| titulo_* (pagar) | `carregar()` (extraído de `/api/financeiro/pagar`, sem mudança), `finance.pagar_v3_previsoes`, `finance.pagar_provisoes`, `finance.titulos_excluidos_pendentes` | KPIs de `pagar-v3-motor.ts` |
| receber_vencido | `finance.receber_v1_dados` | KPI "Precisa de ação" |
| extrato_a_conciliar | `finance.conciliacao_resumo(hoje-90, hoje)` | Pendentes por conta |
| Comercial | `GET propostas-ww/api/ordem-comercial` (x-compras-secret) | do CRM |

Legado só leitura: espelho do Omie (`orders.pedidos_compra`, trigger sql/159), `finance.v_titulos_omie`.

## 4. Inventário das telas tocadas (gate antes → depois)

| Tela / arquivo | Antes | Depois |
|---|---|---|
| `/erp/compras` (TelaCompras) | kanban/tabela, colunas, chips, filtros, ações, folhas | **inalterada** (só ganhou `?pedido=` vindo da Central, que já existia) |
| `/financeiro/pagar`, `/receber`, `/conciliacao` | KPIs, abas, filtros, ações | **inalteradas**; `carregar()` saiu da rota para `lib/financeiro-pagar-dados.ts` (mesmo código). Prova: GET antes/depois com as mesmas 533 linhas e a mesma distribuição de estados |
| Barra do topo (TopNav) | módulos e listas | mesmos itens e mesma largura: "✦ Central de Ordem" no fim da lista dos módulos (Compras/Faturamento: lista sem seta), "✦ Meu dia" e avisos no menu do avatar. 1ª versão punha um ✦ à direita e empurrava Faturamento/Cadastros/BI para "Mais" a 1420 px — corrigido |
| `vercel.json` | 9 crons | + `/api/cron/ordem` a cada 15 min |

## 5. Dados (sql/162, schema `ordem`, só aditivo)
`config`, `config_log`, `dono_config`, `item`, `aviso`, `pedido_acesso`, `acao_log`, `mensagem` — `tenant_slug`, RLS sem políticas, grant só a service_role; `ordem` acrescentado a `pgrst.db_schemas`.

## 6. Detetores do roteiro (outros módulos)

| Detetor | Fonte (função existente) |
|---|---|
| op_* (15) | `computeReportCounts()` de `lib/avulsos-report.ts` → `lib/alarmes.ts`; dono de hoje `ALARM_OWNERS` |
| pj_pc_pendente | `orders.compras_lista` (PJ), aprovação pelo caminho "projetos" de `/api/compras/acao` |
| pj_aprovar_ate | `approval.v_pc_projetos.aprovar_ate_calc` (PENDENTE/PRE_SELECAO, ≤ hoje+7) |
| pj_etapa_atrasada | `approval.projeto_etapas` |
| pj_acima_budget | `contextoProjeto()` de `lib/aprovacao-projeto.ts` (projetos ativos) |
| fat_nao_enviado | `pendentes()` de `lib/faturamento/enviar.ts` |
| fat_pendencia_cadastro | `orders.fat_carteira` (pend) → encaminha a Cadastros |
| est_abaixo_minimo | `orders.v_estoque_item` + `alarme()` de `lib/estoque.ts` |
| cad_duplicados | `orders.cadastros_duplicidades_v2('provavel')` |

## 7. Validação em produção (09/10/26, só leitura)

**Gate de não-regressão:** `GET /api/financeiro/pagar` antes e depois: 533 linhas, mesmos estados (dir 335 · ok 101 · sempc 62 · nf 29 · bloq 6) e as mesmas chaves. Telas de Compras/Financeiro/Operação sem mudança de código. Barra: mesma largura (módulos de um item ganham lista sem seta).

**Matriz de permissões** (funções reais `quemPorId` → `filtrarItens`/`podeExecutar`, com tudo ligado em simulação):

| Pessoa | Módulos na Central | Cadeados (sem contagem) | Financeiro (`?m=financeiro`) | Aprovar / Enviar / Conciliar |
|---|---|---|---|---|
| benny (admin) | todos | Comercial (CRM ainda sem a rota) | ok (23) | ✓ / ✓ / ✓ |
| marcelo (aprovador projetos, sem ERP) | Operação, Projetos | Compras, Financeiro, Faturamento, Estoque, Cadastros, Comercial | 403, 0 itens | ✓ (caminho Projetos) / ✗ / ✗ |
| gabriel (estoque) | Compras, Estoque, Cadastros | Financeiro, Operação, Projetos, Faturamento, Comercial | 403 | ✗ / ✓ / ✗ |
| fernanda (faturamento) | Compras, Operação, Projetos, Faturamento, Estoque, Cadastros | Financeiro, Comercial | 403 | ✓ / ✓ / ✗ |
| suporte@ Cristina (compras) | Compras, Operação, Projetos, Estoque, Cadastros | Financeiro, Faturamento, Comercial | 403 | ✗ / ✓ / ✗ |
| bpofinanceiro | Compras, Financeiro, Operação, Projetos, Faturamento, Estoque, Cadastros | Comercial | ok (23) | ✗ / ✗ / ✓ |

Hoje (tudo desligado) cada não-admin vê **0** itens; o admin vê 302 em pré-visualização. API: `?m=comercial` → 403 sem itens; "executar" → 403 "Ação ainda desligada"; "recusar" → 400 "Decisões desligadas". Valores mascarados testados em unidade (ninguém real sem `compras.ver_valores` hoje).

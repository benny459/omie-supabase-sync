# Central de Ordem (Aria por módulo)

> Painel · desde 09/10/26 · manual: `web/content/manual/15-central-de-ordem.md` · plano/inventário: `docs/plans/CENTRAL_DE_ORDEM.md`

Uma aba a mais em cada módulo (`/ordem?m=compras|financeiro|operacao|projetos|faturamento|estoque|cadastros`) e o **Meu dia** (`/ordem`). A Aria mostra só o que está fora de ordem, com o cartão de decisão (recomendação, porquê, impacto, alternativas, confiança/risco, Aceitar/Ajustar/Recusar/Adiar/Encaminhar, Desfazer, origem, "Abrir na tela tradicional ↗").

## Regras
- **Aditivo**: nenhuma tela, filtro ou ação mudou. Desvio da SPEC pedido pelo Benny: mora no painel, não na barra do portal.
- **Permissões só das camadas existentes** (`lib/ordem/acesso.ts`): `canViewArea`, `permissoesDe`, `canViewValues`. Módulo sem acesso = 🔒 sem contagem; API devolve 403.
- **Tudo desligado por omissão** (`ordem.config`): só o admin vê, em pré-visualização. Interruptores por módulo, detetor, ação, decisões, encaminhar, sino, diálogo, pedido de acesso, comandos, mensagens. Valores M1–P4 como *sugerido*. Cada mudança em `ordem.config_log`.
- **Ações só pelas rotas existentes** com o cookie da pessoa (`lib/ordem/executar.ts`, lista fechada de rotas): `/api/compras/acao`, `/api/compras/email`, `/api/compras/email/conversa`, `/api/financeiro/conciliacao`, `/api/approvals/*`. Pré-visualização antes, `ordem.acao_log` sempre.
- **Detetores só leem** (`lib/ordem/detectores/*`, regras puras em `regras-*.ts`), cron `/api/cron/ordem` a cada 15 min.

## Peças
| Peça | Onde |
|---|---|
| Fila/tela | `components/ordem/CentralOrdem.tsx`, `/api/ordem` |
| Configuração | `components/ordem/ConfigOrdem.tsx`, `/api/ordem/config` (admin) |
| Barra: menu do avatar (✦ Meu dia, avisos, contador), diálogo de entrada; lista de cada módulo | `components/ordem/SinoOrdem.tsx`, `TopNav.tsx`, `/api/ordem/estado`, `/api/ordem/avisos` |
| Ações / decisões | `/api/ordem/acao` |
| Encaminhar, pedido livre, pedido de acesso | `lib/ordem/encaminhar.ts`, `/api/ordem/pedido` |
| Comandos | `lib/ordem/comandos.ts`, `/api/ordem/comando` |
| Mensagens e escada | `lib/ordem/mensagens.ts` (+ `mensagens-regras.ts`), `/api/ordem/mensagens` (pré-visualização) |
| Comercial (CRM) | `lib/ordem/comercial.ts` → `propostas-ww/api/ordem-comercial` |
| Dados | `sql/162_central_ordem.sql` (schema `ordem`) |

## Ligações
[[Painel/00-Overview-Painel]] · [[Painel/10-Avulsos]] · [[Painel/20-Projetos]] · [[Painel/30-Configuracoes]]

#painel-waterworks #central-de-ordem #aria

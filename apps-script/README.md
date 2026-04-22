# 📜 Apps Script — scripts das planilhas Google Sheets

Estes scripts rodam dentro do Google Apps Script de cada planilha.
São **versionados aqui** como fonte da verdade — copie daqui pra o
Apps Script quando precisar.

## 📂 Estrutura

```
apps-script/
├── sales/     — Scripts da planilha "Omie Sales"
├── orders/    — Scripts da planilha "Omie Orders"
├── finance/   — Scripts da planilha "Omie Finance"
├── shared/    — Utilitários comuns (copiar em cada projeto)
├── debug/     — Scripts temporários de debug/fix
└── legacy/    — Versões antigas (pré-migração Supabase)
```

## 🎯 Arquivos principais por planilha

### Sales (`sales/`)
- `DashboardConfig.gs` — painel Dashboard com KPIs + bloco de Execução
- `SheetsMirror.gs` — Mirror Supabase → Sheets (com smart mirror)
- `OrquestradorPos.gs` — cadeia pós-import (mirror → consolidação → SmartSuite → Webex)

### Orders (`orders/`)
- `DashboardConfig_Orders.gs` — painel Dashboard Orders
- `SheetsMirror_Orders.gs` — Mirror com doPost (webhook)
- `OrquestradorPos_Orders.gs` — cadeia Orders (8 etapas)
- `Painel de Resulatdos_7.4_D.gs` — consolidação PC vs PV/OS
- `Smart_AV_7.13.gs`, `Smart_Projetos_8.4_D.gs`, `Smart_PC_7.32_D.gs` — syncs SmartSuite

### Finance (`finance/`)
- `SheetsMirror_Finance.gs` — Mirror com smart mirror nativo
- `OrquestradorPos_Finance.gs` — cadeia Finance (4 etapas + Webex)
- `Smart_clientes.gs` — sync SmartSuite de clientes
- `Pagar_7.gs`, `Contas a Receber.gs`, `Projetos_4.gs` — flows específicos

### Shared (`shared/`)
Arquivos utilitários que devem ser copiados **em cada** projeto Apps Script:
- `SupabaseClient.gs` — cliente HTTP pro Supabase PostgREST
- `GitHubActions.gs` — dispatch de workflows via API
- `TriggersBRT.gs` — utilitário pra criar triggers em horário Brasília

### Debug (`debug/`)
Scripts temporários usados pra diagnosticar problemas específicos.
Podem ser deletados quando não forem mais necessários. Exemplo:
- `Sales_DEBUG_datas.gs` — debug de comparação de datas
- `Sales_DEBUG_pvs_nao_criados.gs` — debug de inserção no SmartSuite
- `Sales_FIX_datas.gs` — fix de conversão de datas (histórico)
- `SmartSuiteMaster_PROTOTIPO.gs` — protótipo aba unificada (em avaliação)

### Legacy (`legacy/`)
Versões antigas dos scripts que operavam direto no Omie (sem Supabase).
Mantidos por referência histórica. **Não rodar em produção.**

## 🔧 Como copiar pra o Apps Script

Quando precisar atualizar um script no Apps Script da planilha:

1. Abre o arquivo aqui (ex: `apps-script/sales/SheetsMirror.gs`)
2. **Cmd+A** → copia tudo
3. No Apps Script da planilha correspondente, abre o arquivo equivalente
4. **Cmd+A** → cola por cima
5. **Cmd+S** pra salvar

Depois, **sempre que modificar no Apps Script**, lembre de refletir aqui:
1. Copia do Apps Script
2. Cola aqui no repo
3. `git add` + `git commit` + `git push`

## 🚨 Lembrete

Os arquivos em `apps-script/` **NÃO são executados automaticamente**.
Eles são a **fonte da verdade** — o código que realmente roda está
copiado nas planilhas. Mantê-los em sincronia é responsabilidade manual
(ou futura automação via clasp).

Pra automatizar sincronização: considere usar [clasp](https://github.com/google/clasp)
no futuro.

# 🏆 Omie → Supabase Sync

Sincronização automática de dados Omie para Supabase via GitHub Actions.

## Arquitetura

```
Omie API → GitHub Actions (Python) → Supabase (Postgres)
                                          ↓
                                    (opcional) Google Sheets mirror
```

- **Runner**: GitHub Actions (Ubuntu, Python 3.11, só stdlib — sem pip install)
- **Destino**: Postgres via PostgREST
- **Idempotência**: `UPSERT ON CONFLICT (empresa, codigo_pedido, codigo_item)`
- **Incremental automático**: lê `sync_state.last_d_alt_processed` e filtra por `dAlt`

## Módulos

| Módulo | Script | Tabela Supabase | Status |
|---|---|---|---|
| Itens Vendidos | `scripts/import_itens_vendidos.py` | `sales.itens_vendidos` | ✅ POC |
| Finance | (planejado) | `finance.*` | 📋 |
| Orders | (planejado) | `orders.*` | 📋 |

## Secrets necessários (GitHub → Settings → Secrets and variables → Actions)

| Secret | Descrição |
|---|---|
| `SUPABASE_URL` | URL do projeto Supabase (ex: `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key do Supabase (JWT) |
| `OMIE_APP_KEY_SF` | App key da empresa SF |
| `OMIE_APP_SECRET_SF` | App secret da empresa SF |
| `OMIE_APP_KEY_CD` | (opcional) App key da empresa CD |
| `OMIE_APP_SECRET_CD` | (opcional) App secret da empresa CD |
| `OMIE_APP_KEY_WW` | (opcional) App key da empresa WW |
| `OMIE_APP_SECRET_WW` | (opcional) App secret da empresa WW |

## Rodar manualmente

```bash
gh workflow run "Import Itens Vendidos (Omie → Supabase)" \
  -f empresas=SF \
  -f forcar_full=false \
  -f data_inicio=01/01/2025

# Acompanhar
gh run watch
```

## Rodar localmente

```bash
export SUPABASE_URL=https://xxxxx.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=eyJ...
export OMIE_APP_KEY_SF=...
export OMIE_APP_SECRET_SF=...

python3 scripts/import_itens_vendidos.py
```

## Agendamento

Cron configurado em `.github/workflows/import_itens_vendidos.yml`:
```yaml
schedule:
  - cron: "17 * * * *"   # a cada hora aos :17
```

Pra desabilitar, comenta o bloco `schedule:` no workflow.

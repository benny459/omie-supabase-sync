# 📋 Plano Completo — App de Aprovações (Substituição do SmartSuite)

> **Documento vivo.** Mantém-se atualizado ao longo do desenvolvimento.
> **Projeto:** Waterworks — substituição do SmartSuite por app Next.js próprio
> **Criado:** 2026-04-20
> **Última atualização:** 2026-04-20

---

## 🎯 Objetivo

Substituir o SmartSuite (atualmente usado para aprovação de PCs e cross-reference com PV/OS) por um app proprietário moderno, integrado diretamente ao Supabase que já contém todos os dados do Omie.

### Benefícios esperados
- ❌ Parar de pagar SmartSuite
- ⚡ Performance superior (dados vêm do Supabase direto, sem sync)
- 🎨 UI customizada para o fluxo Waterworks (não genérica)
- 🔐 Controle total sobre segurança, permissões e auditoria
- 📈 Escalabilidade e extensibilidade ilimitadas

---

## 🏗 Arquitetura — **MONOREPO** (decidido)

```
┌──────────────────────────────────────────────────────────┐
│  [Omie ERP]                                              │
└────────────────────┬─────────────────────────────────────┘
                     │ GitHub Actions Python (já existe)
                     │ Schedules: 2x/dia Seg-Sex
                     ▼
┌──────────────────────────────────────────────────────────┐
│  [Supabase Postgres]  ← fonte de verdade                 │
│                                                          │
│  Schemas existentes:                                     │
│    • sales.*     (PVs, OS, Contratos, Produtos, etc)     │
│    • orders.*    (PCs, NFe, Pedidos Compra)              │
│    • finance.*   (Contas Pagar/Receber, Clientes, etc)   │
│                                                          │
│  NOVO schema: approval.*                                 │
│    • approvals         (estado de aprovação por PC)      │
│    • comments          (threads de discussão)            │
│    • attachments       (metadados de arquivos)           │
│    • audit_log         (trilha de auditoria)             │
│    • user_roles        (permissões e alçadas)            │
│    • categorias_aprovacao (mapeamento cat→aprovadores)   │
│                                                          │
│  Views:                                                  │
│    • v_pc_completo      (PC + PV origem + aprovação)     │
│    • v_pc_pendentes     (PCs aguardando aprovação)       │
│                                                          │
│  Storage:                                                │
│    • bucket "attachments" (arquivos anexos)              │
└─────────┬──────────────────────────────┬─────────────────┘
          │ Supabase Client SDK          │ Storage API
          ▼                              ▼
┌──────────────────────────────────────────────────────────┐
│  [Next.js 14 App (Vercel)]                               │
│                                                          │
│  Repo: github.com/benny459/omie-supabase-sync (mesmo!)  │
│  Pasta: /app (subpasta dentro do repo existente)         │
│  Domain: aprovacoes.waterworks.com.br (ou vercel.app)    │
│                                                          │
│  Rotas:                                                  │
│    /login              → Google OAuth (@waterworks)      │
│    /dashboard          → Visão geral (pendentes, KPIs)   │
│    /pcs                → Lista + filtros + busca         │
│    /pc/[numero]        → Detalhes + ações + histórico    │
│    /admin              → Gestão de roles e alçadas       │
│                                                          │
│  Edge Functions:                                         │
│    • notify-webex      → posta mensagem Webex            │
│    • notify-email      → envia email aos aprovadores     │
│                                                          │
│  Stack:                                                  │
│    • Next.js 14 (App Router)                             │
│    • TypeScript                                          │
│    • Tailwind CSS + shadcn/ui                            │
│    • Supabase JS Client                                  │
│    • Tanstack Table (grid avançado)                      │
│    • React Hook Form + Zod (validação)                   │
└──────────────────────────────────────────────────────────┘
```

---

## 🔐 Autenticação e Permissões

### Estratégia
**Supabase Auth + Google OAuth restrito ao domínio @waterworks.com.br**

### Roles definidos

| Role | Permissões |
|------|-----------|
| `visualizador` | Lê tudo, não aprova |
| `analista` | Comenta, anexa, mas não aprova |
| `aprovador` | Aprova/rejeita dentro da alçada |
| `admin` | Tudo + gerencia usuários e alçadas |

### Alçada por categoria/projeto

**Decidido:** alçada por categoria de compra OU por projeto.

Exemplo:
```
Aprovador: joao@waterworks.com.br
Alçadas:
  - Categoria "Materiais Elétricos"  → pode aprovar até R$ 50.000
  - Categoria "Materiais Hidráulicos" → pode aprovar até R$ 30.000
  - Projeto "40_VS"                  → qualquer valor
```

Se o PC não tem aprovador com alçada suficiente, escala automaticamente para admin.

---

## 🗄 Schema Postgres

```sql
CREATE SCHEMA IF NOT EXISTS approval;

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. APROVAÇÕES (estado atual de cada PC)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE approval.approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_numero TEXT NOT NULL UNIQUE,
  empresa TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDENTE',
    -- PENDENTE, APROVADO, REJEITADO, EM_ANALISE
  aprovador_id UUID REFERENCES auth.users,
  aprovador_email TEXT,
  comentario_aprovacao TEXT,
  aprovado_em TIMESTAMPTZ,
  escalado_para UUID REFERENCES auth.users, -- se acima da alçada
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_approvals_status ON approval.approvals(status);
CREATE INDEX idx_approvals_aprovador ON approval.approvals(aprovador_id);

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. COMENTÁRIOS (thread por PC)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE approval.comments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_numero TEXT NOT NULL,
  autor_id UUID REFERENCES auth.users,
  autor_email TEXT NOT NULL,
  autor_nome TEXT,
  texto TEXT NOT NULL,
  reply_to UUID REFERENCES approval.comments(id), -- threading
  created_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ
);

CREATE INDEX idx_comments_pc ON approval.comments(pc_numero);
CREATE INDEX idx_comments_created ON approval.comments(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. ANEXOS (arquivos do PC)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE approval.attachments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pc_numero TEXT NOT NULL,
  storage_path TEXT NOT NULL,
    -- ex: "attachments/PC999/orcamento_2026-04.pdf"
  filename TEXT NOT NULL,
  content_type TEXT,
  size_bytes BIGINT,
  uploaded_by UUID REFERENCES auth.users,
  uploaded_by_email TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. AUDIT LOG (trilha de tudo que muda)
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE approval.audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
    -- 'pc', 'comment', 'attachment', 'role'
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
    -- 'create', 'update', 'approve', 'reject', 'delete', 'comment'
  user_id UUID REFERENCES auth.users,
  user_email TEXT,
  old_value JSONB,
  new_value JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_audit_entity ON approval.audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_created ON approval.audit_log(created_at DESC);

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. ROLES E ALÇADAS
-- ═══════════════════════════════════════════════════════════════════════════
CREATE TABLE approval.user_roles (
  user_id UUID PRIMARY KEY REFERENCES auth.users,
  email TEXT NOT NULL UNIQUE,
  nome TEXT,
  role TEXT NOT NULL DEFAULT 'visualizador',
    -- 'visualizador', 'analista', 'aprovador', 'admin'
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Alçadas por categoria E/OU projeto
CREATE TABLE approval.alcadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users,
  categoria TEXT,           -- NULL = todas
  projeto TEXT,             -- NULL = todos
  valor_max NUMERIC,        -- NULL = ilimitado
  ativo BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. VIEWS (facilitam queries do app)
-- ═══════════════════════════════════════════════════════════════════════════

-- PC completo com PV origem e estado de aprovação
CREATE VIEW approval.v_pc_completo AS
SELECT
  pc.empresa,
  pc.cnumero AS pc_numero,
  pc.ncod_ped AS pc_codigo,
  pc.cnum_pedido AS pv_origem,
  pc.valor_total AS valor_pc,
  pc.dt_previsao AS previsao_entrega,
  pc.cnome_fornecedor AS fornecedor,
  pc.ccod_int_ped AS cod_int_pedido,
  pc.ncod_proj AS codigo_projeto,
  COALESCE(a.status, 'PENDENTE') AS aprovacao_status,
  a.aprovador_email,
  a.aprovado_em,
  a.comentario_aprovacao,
  (SELECT COUNT(*) FROM approval.comments c
    WHERE c.pc_numero = pc.cnumero AND c.deleted_at IS NULL) AS num_comentarios,
  (SELECT COUNT(*) FROM approval.attachments at
    WHERE at.pc_numero = pc.cnumero AND at.deleted_at IS NULL) AS num_anexos
FROM orders.pedidos_compra pc
LEFT JOIN approval.approvals a ON a.pc_numero = pc.cnumero;

-- PCs pendentes de aprovação
CREATE VIEW approval.v_pc_pendentes AS
SELECT * FROM approval.v_pc_completo
WHERE aprovacao_status = 'PENDENTE'
ORDER BY previsao_entrega ASC NULLS LAST;
```

### RLS Policies (Row Level Security)

```sql
ALTER TABLE approval.approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval.audit_log ENABLE ROW LEVEL SECURITY;

-- Todos podem ler aprovações
CREATE POLICY "approvals_read_all" ON approval.approvals
  FOR SELECT USING (true);

-- Só aprovadores/admins podem criar/atualizar
CREATE POLICY "approvals_write_aprovadores" ON approval.approvals
  FOR UPDATE USING (
    EXISTS (SELECT 1 FROM approval.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('aprovador', 'admin'))
  );
```

---

## 📅 Roadmap (6 fases)

### Fase 0 — Setup (2-3 dias)

- [ ] Criar repo GitHub `waterworks-aprovacoes`
- [ ] `npx create-next-app@latest` com TypeScript + Tailwind + App Router
- [ ] Instalar Supabase JS, shadcn/ui, Tanstack Table
- [ ] Configurar Supabase Auth com Google OAuth
- [ ] Deploy inicial no Vercel (projeto novo, não mexe no atual)
- [ ] Env vars: `SUPABASE_URL`, `SUPABASE_ANON_KEY`

### Fase 1 — MVP Aprovação (4-5 dias)

- [ ] SQL: criar schema `approval` com as 5 tabelas base
- [ ] SQL: criar view `v_pc_completo` e `v_pc_pendentes`
- [ ] Página `/login` com Google OAuth
- [ ] Middleware de autenticação
- [ ] Página `/pcs` com Tanstack Table:
  - [ ] Colunas: PC#, Fornecedor, Valor, PV origem, Status, Previsão
  - [ ] Filtros: Status, Empresa, Categoria, Projeto, Data
  - [ ] Busca por PC número ou fornecedor
  - [ ] Ordenação por qualquer coluna
- [ ] Página `/pc/[numero]` com detalhes:
  - [ ] Card com dados do PC
  - [ ] Botões "Aprovar" / "Rejeitar" (visíveis só pra aprovadores)
  - [ ] Campo de comentário obrigatório na rejeição
  - [ ] Mostra aprovador + timestamp quando aprovado

### Fase 2 — Cross-reference PC ↔ PV/OS (3-4 dias)

- [ ] Na página `/pc/[numero]`, adicionar seção "Venda Relacionada":
  - [ ] Busca PV origem (via `cnum_pedido` do PC)
  - [ ] Mostra: PV#, cliente, valor, data, status
  - [ ] Link clicável pra `/pv/[numero]` (futuro)
- [ ] Opcional: página `/pv/[numero]` com os PCs associados

### Fase 3 — Histórico / Auditoria (2-3 dias)

- [ ] Trigger SQL: grava automaticamente em `audit_log` toda mudança em `approvals`, `comments`, `attachments`
- [ ] Na página `/pc/[numero]`, aba "Histórico":
  - [ ] Timeline com tudo que aconteceu no PC
  - [ ] "João aprovou em 20/04 às 14:32"
  - [ ] "Maria comentou: 'Verificar RC antes'"
  - [ ] "Pedro anexou orcamento.pdf"

### Fase 4 — Anexos (2 dias)

- [ ] Criar bucket `attachments` no Supabase Storage
- [ ] Configurar RLS no bucket (só autenticados)
- [ ] Componente de upload drag-and-drop
- [ ] Lista de anexos com download/preview
- [ ] Limite: 10 MB por arquivo, PDFs/imagens/docx

### Fase 5 — Notificações (2-3 dias)

- [ ] Edge Function `notify-webex`:
  - [ ] Quando PC fica pendente → avisa canal Webex
  - [ ] Quando aprovado/rejeitado → avisa solicitante
- [ ] Edge Function `notify-email`:
  - [ ] Resumo diário 07:00 BRT dos PCs pendentes
  - [ ] Menções em comentários
- [ ] Tabela `user_preferences`: o que cada user quer receber

### Fase 6 — Views customizadas (2 dias)

- [ ] Usuário salva filtros como "Minhas Views"
- [ ] Ex: "Pendentes do Projeto 40_VS", "Urgentes acima de 10k"
- [ ] Dashboard home: contagem por status + gráfico

---

## 🔀 Estratégia de Migração (não big bang)

1. **Semanas 1-3** → app roda em paralelo com SmartSuite
2. **Equipe testa** novos PCs no app enquanto SmartSuite continua recebendo dados do Omie
3. **Após 2 semanas de uso estável** → desliga sync pro SmartSuite (nos Apps Scripts)
4. **Arquiva** as apps SmartSuite (histórico permanece acessível)
5. **Cancela assinatura SmartSuite** 🎉

---

## 💰 Custos estimados

| Item | Custo mensal |
|------|-------------|
| Supabase (Free tier ou Pro) | $0-25 |
| Vercel (Hobby ou Pro) | $0-20 |
| Domínio custom (opcional) | ~R$40/ano |
| **Total** | **~R$100-250/mês** |

Comparado ao SmartSuite: economia significativa + app feito sob medida.

---

## 📦 Estrutura de pastas — **MONOREPO**

O Next.js app mora numa subpasta `/app` dentro do repo `omie-supabase-sync`:

```
omie-supabase-sync/              # repo existente
├── scripts/                     # Python Omie→Supabase (EXISTENTE)
├── .github/
│   └── workflows/               # GitHub Actions (EXISTENTE)
│       ├── master_sales_diaria.yml        # ignora mudanças em /app (path filter)
│       ├── master_orders_diaria.yml       # idem
│       └── ...
├── docs/                        # Painel web HTML (EXISTENTE)
├── sql/                         # Schemas Postgres (EXISTENTE)
│
└── app/                         # 🆕 NOVO: Next.js 14 aqui
    ├── app/                     # App Router
    │   ├── (auth)/
    │   │   └── login/page.tsx
    │   ├── (app)/
    │   │   ├── layout.tsx
    │   │   ├── dashboard/page.tsx
    │   │   ├── pcs/
    │   │   │   ├── page.tsx
    │   │   │   └── [numero]/page.tsx
    │   │   └── admin/
    │   │       ├── usuarios/page.tsx
    │   │       └── alcadas/page.tsx
    │   └── api/
    │       └── webhooks/
    ├── components/
    │   ├── ui/                  # shadcn components
    │   ├── pc-table.tsx
    │   ├── approval-button.tsx
    │   ├── comment-thread.tsx
    │   └── attachment-uploader.tsx
    ├── lib/
    │   ├── supabase/
    │   │   ├── client.ts
    │   │   ├── server.ts
    │   │   └── types.ts
    │   ├── auth/
    │   └── utils.ts
    ├── supabase/
    │   ├── migrations/          # SQL migrations (approval schema)
    │   └── functions/           # Edge functions
    ├── public/
    ├── .env.local               # gitignore
    ├── .gitignore
    ├── next.config.js
    ├── tailwind.config.ts
    ├── tsconfig.json
    └── package.json
```

## ⚙️ Configuração do Vercel (monorepo)

Ao criar o projeto Vercel:
- **Framework Preset**: Next.js
- **Root Directory**: `app` ← CRÍTICO (aponta pra subpasta)
- **Build Command**: `npm run build` (default)
- **Output Directory**: `.next` (default)
- **Install Command**: `npm install`

## 🛡 Path filters nos GitHub Actions existentes

Os workflows Python NÃO devem disparar quando só mexer em `/app/`. Adicionar ao topo de cada master YAML:

```yaml
on:
  workflow_dispatch:
    inputs: ...
  push:
    paths-ignore:
      - 'app/**'       # ignora mudanças no Next.js
      - 'docs/**'      # ignora mudanças no painel web
      - '**.md'        # ignora docs
  schedule:
    - cron: '...'
```

**Nota:** se os workflows atuais são só `workflow_dispatch` + `schedule` (sem `push`), não precisa mexer — eles já são inertes a commits.

---

## 🔧 Variáveis de ambiente necessárias

```bash
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://xxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJxxx
SUPABASE_SERVICE_ROLE_KEY=eyJxxx    # só no servidor

# Auth
GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxx

# Webex
WEBEX_TOKEN=xxx
WEBEX_ROOM_ID=xxx

# Email (opcional, usar Resend)
RESEND_API_KEY=re_xxx
```

---

## 🚀 PROMPT PARA CONTINUAR NO CLAUDE CODE (nova sessão)

Copie e cole na próxima sessão do Claude Code:

````
Estou construindo um app Next.js 14 que vai substituir o SmartSuite no meu
workflow Waterworks. Toda a pipeline Omie → Supabase já está pronta; agora
preciso construir a camada de aprovações e visualização.

CONTEXTO COMPLETO:
Leia o arquivo /Users/bennyalcalay/Downloads/Omie/APROVACOES_APP_PLAN.md —
tem toda a arquitetura, schema SQL, roadmap em 6 fases e estrutura de pastas.

IMPORTANTE — MONOREPO:
O app Next.js vai morar em subpasta `/app` DENTRO do repo existente
`omie-supabase-sync` (NÃO criar repo novo). Estrutura final:

    omie-supabase-sync/
    ├── scripts/            # Python existente — não mexer
    ├── .github/workflows/  # Actions existentes — não mexer (têm path filters)
    ├── docs/               # Painel web HTML existente — não mexer
    ├── sql/                # Schemas existentes — não mexer
    └── app/                # 🆕 Next.js aqui — criar TUDO aqui dentro

O repo local fica em:
  /Users/bennyalcalay/Downloads/Omie/omie-supabase-sync/

Comece fazendo `cd omie-supabase-sync && mkdir app && cd app` antes do setup.

RESUMO RÁPIDO:
- Supabase Postgres já tem dados de Omie (schemas sales.*, orders.*, finance.*)
- Crio novo schema "approval" com aprovações, comentários, anexos, audit
- App Next.js 14 + TypeScript + Tailwind + shadcn/ui + Tanstack Table
- Auth: Supabase Auth com Google OAuth (@waterworks.com.br apenas)
- Deploy: Vercel com Root Directory = "app" (monorepo)

O QUE JÁ FOI DECIDIDO:
- 3-10 pessoas usam o sistema
- Alçada de aprovação por categoria/projeto (não por valor simples)
- Todas as features: aprovar/rejeitar, cross-ref PC↔PV, histórico,
  anexos, notificações Webex, filtros customizados
- Stack: Next.js 14 + Vercel
- Monorepo: subpasta /app no repo omie-supabase-sync

TAREFA DESTA SESSÃO (FASE 0 — Setup):
1. cd /Users/bennyalcalay/Downloads/Omie/omie-supabase-sync/
2. Criar pasta "app" se não existir: mkdir -p app
3. cd app
4. Inicializar Next.js 14: npx create-next-app@latest . \
     --typescript --tailwind --app --src-dir=false --import-alias "@/*" --no-eslint
5. Instalar dependências:
   npm install @supabase/ssr @supabase/supabase-js @tanstack/react-table lucide-react
6. Inicializar shadcn/ui: npx shadcn@latest init
7. Adicionar alguns componentes base: npx shadcn@latest add button card input table
8. Configurar Supabase client em:
     - app/lib/supabase/client.ts   (browser)
     - app/lib/supabase/server.ts   (server actions)
     - app/lib/supabase/middleware.ts (middleware de auth)
9. Criar estrutura de pastas:
     - app/(auth)/login/page.tsx
     - app/(app)/layout.tsx  (navbar + auth check)
     - app/(app)/dashboard/page.tsx (placeholder "Em construção")
10. Página /login com botão "Entrar com Google"
11. middleware.ts na raiz do projeto (redireciona não autenticados pra /login)
12. Criar .env.local com os secrets (vazio, user preenche):
      NEXT_PUBLIC_SUPABASE_URL=
      NEXT_PUBLIC_SUPABASE_ANON_KEY=
13. Criar .env.example com estrutura (documentação)
14. Criar app/README.md explicando como rodar localmente
15. Testar: cd app && npm run dev → abre localhost:3000

NÃO FAÇA AINDA:
- Schema SQL do approval (vamos fazer na Fase 1, separadamente)
- Páginas /pcs ou /pc/[numero] (Fase 1)
- Anexos ou notificações (Fases 4-5)
- Deploy no Vercel (fazemos depois junto)
- Path filters nos workflows Python (fazemos se precisar)

QUANDO TERMINAR A FASE 0:
- Deve ser possível rodar "cd app && npm run dev" e ver página de login
- Página de login tem botão "Entrar com Google" (pode não funcionar ainda
  sem as env vars, mas a UI aparece)
- Middleware redireciona / pra /login se não autenticado
- Atualizar APROVACOES_APP_PLAN.md marcando Fase 0 como completa (checkbox)

IMPORTANTE:
- Pergunte antes de fazer mudanças grandes ou inesperadas
- Não codifique cegamente — prefiro parar e ajustar do que refazer
- Respeite o monorepo: NÃO mexa em nada fora da pasta `/app`
- Não commit ainda — deixa eu revisar primeiro

Pode começar?
````

---

## 📌 Status atual

| Fase | Status |
|------|:------:|
| 0. Setup | ⏸ aguardando início |
| 1. MVP Aprovação | ⏸ |
| 2. Cross-ref PC↔PV | ⏸ |
| 3. Histórico/Auditoria | ⏸ |
| 4. Anexos | ⏸ |
| 5. Notificações | ⏸ |
| 6. Views customizadas | ⏸ |

---

## 📚 Referências

- [Next.js 14 Docs](https://nextjs.org/docs)
- [Supabase Auth com Next.js](https://supabase.com/docs/guides/auth/server-side/nextjs)
- [shadcn/ui](https://ui.shadcn.com)
- [Tanstack Table](https://tanstack.com/table/latest)
- [Vercel Deployment](https://vercel.com/docs/frameworks/nextjs)

---

**Fim do plano.** Documento vivo — atualizar ao longo do desenvolvimento. 🎯

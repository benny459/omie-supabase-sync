-- ═══════════════════════════════════════════════════════════════════════════
-- 07 — Schemas approval.* e platform.* (substituição do SmartSuite)
-- ═══════════════════════════════════════════════════════════════════════════
-- Criado: 2026-04-22
--
-- Contexto:
--   • orders.pedidos_compra tem PK (empresa, ncod_ped, ncod_item) → 1 linha por ITEM.
--     O app agrupa por (empresa, ncod_ped) pra exibir "um PC".
--   • approval.approvals é 1 linha por PC (não por item): PK (empresa, ncod_ped).
--   • Registros ficam editáveis mesmo após aprovação (algumas variáveis ainda
--     podem mudar depois). Toda mudança vai pro audit_log.
--   • 3 módulos de aprovação:
--       - 'avulsos'   (Fernanda)
--       - 'projetos'  (Marcelo)
--       - 'pcs'       (Fernanda)   — PCs standalone (sem PV de origem)
--   • Origem dos registros: 'smartsuite' (histórico importado) ou 'native'
--     (criado no app novo). smart_id guarda o ID original pra reconciliação.

BEGIN;

-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA platform — usuários, perfis e permissões
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS platform;

-- Perfis dos usuários (1:1 com auth.users do Supabase Auth)
CREATE TABLE IF NOT EXISTS platform.user_profiles (
  id         uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text NOT NULL UNIQUE,
  nome       text,
  is_admin   boolean NOT NULL DEFAULT false,
  ativo      boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Quem pode aprovar em cada módulo. Sem alçadas por valor — só presença.
CREATE TABLE IF NOT EXISTS platform.approvers (
  user_id uuid NOT NULL REFERENCES platform.user_profiles(id) ON DELETE CASCADE,
  modulo  text NOT NULL CHECK (modulo IN ('avulsos','projetos','pcs')),
  PRIMARY KEY (user_id, modulo)
);

CREATE INDEX IF NOT EXISTS idx_approvers_modulo ON platform.approvers(modulo);

-- Trigger pra auto-criar user_profile quando alguém loga pela 1ª vez via Supabase Auth.
CREATE OR REPLACE FUNCTION platform.handle_new_auth_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO platform.user_profiles (id, email, nome)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email,'@',1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION platform.handle_new_auth_user();


-- ═══════════════════════════════════════════════════════════════════════════
-- SCHEMA approval — aprovações, comentários, anexos, audit
-- ═══════════════════════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS approval;

-- 1 linha por PC (empresa + ncod_ped). Fica editável sempre.
-- Obs: PCs "órfãos" do Smart (sem correspondência em Omie) entram com ncod_ped = -1*smart_numeric_id
-- enquanto source='smartsuite'. Reconciliação depois ajusta pro ncod_ped real.
CREATE TABLE IF NOT EXISTS approval.approvals (
  empresa              text NOT NULL,
  ncod_ped             bigint NOT NULL,
  modulo               text NOT NULL CHECK (modulo IN ('avulsos','projetos','pcs')),

  -- ─── Workflow de aprovação ───
  status               text NOT NULL DEFAULT 'PENDENTE'
                         CHECK (status IN (
                           'PENDENTE','N_A','PRE_SELECAO',
                           'APROVADO','APROVADO_FAT_DIRETO',
                           'NAO_APROVADO','REJEITADO_VALIDADE','CANCELAR_PEDIDO'
                         )),
  aprovador_id         uuid REFERENCES platform.user_profiles(id),
  aprovador_email      text,
  aprovado_em          timestamptz,
  valor_aprovado       numeric,
  valor_aprovado_audit numeric,
  aprovar_ate          date,
  prioridade           text CHECK (prioridade IN ('0','1','2')),      -- só PCs standalone
  justificativa        text,
  comentario_aprovacao text,
  comprador            text CHECK (comprador IN ('Paulo','Erick')),
  status_material      text,

  -- ─── RC (100% manual: input direto ou via planilha Excel) ───
  rc_numero            numeric,
  rc_descricao         text,
  rc_custo             numeric,
  rc_custo_total       numeric,

  -- ─── Logística / NFe manual ───
  mt_status_fornecimento text CHECK (mt_status_fornecimento IN (
                           'Faturado pelo Fornecedor','Recebido','Conferido'
                         )),
  mt_data_emissao_nf   date,
  mt_data_recebimento_nf date,
  mt_nf_fornecedor     text,
  pc_pago              boolean,
  material_enviado     text,

  -- ─── Campos secundários livres (cotação, replanning, auditoria, posição, links) ───
  custom_fields        jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- ─── Origem e reconciliação com SmartSuite ───
  source               text NOT NULL DEFAULT 'native'
                         CHECK (source IN ('smartsuite','native')),
  smart_id             text,                                  -- ID original no SmartSuite (record id)
  smart_tabela         text CHECK (smart_tabela IN ('avulsos','projetos','pcs')),
  imported_at          timestamptz,

  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid REFERENCES platform.user_profiles(id),

  PRIMARY KEY (empresa, ncod_ped)
);

CREATE INDEX IF NOT EXISTS idx_approvals_status       ON approval.approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_modulo       ON approval.approvals(modulo);
CREATE INDEX IF NOT EXISTS idx_approvals_aprovador    ON approval.approvals(aprovador_id);
CREATE INDEX IF NOT EXISTS idx_approvals_smart_id     ON approval.approvals(smart_id) WHERE smart_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approvals_rc_numero    ON approval.approvals(rc_numero) WHERE rc_numero IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_approvals_custom_gin   ON approval.approvals USING gin (custom_fields);

-- Trigger pra manter updated_at e gravar audit_log
CREATE OR REPLACE FUNCTION approval.touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_approvals_touch ON approval.approvals;
CREATE TRIGGER trg_approvals_touch
  BEFORE UPDATE ON approval.approvals
  FOR EACH ROW EXECUTE FUNCTION approval.touch_updated_at();


-- 2. Comentários
CREATE TABLE IF NOT EXISTS approval.comments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa      text NOT NULL,
  ncod_ped     bigint NOT NULL,
  autor_id     uuid REFERENCES platform.user_profiles(id),
  autor_email  text NOT NULL,
  texto        text NOT NULL,
  reply_to     uuid REFERENCES approval.comments(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  edited_at    timestamptz,
  deleted_at   timestamptz,
  FOREIGN KEY (empresa, ncod_ped) REFERENCES approval.approvals(empresa, ncod_ped) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_pc      ON approval.comments(empresa, ncod_ped);
CREATE INDEX IF NOT EXISTS idx_comments_created ON approval.comments(created_at DESC);


-- 3. Anexos (metadados; arquivos vão no Supabase Storage)
CREATE TABLE IF NOT EXISTS approval.attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  empresa      text NOT NULL,
  ncod_ped     bigint NOT NULL,
  storage_path text NOT NULL,   -- ex: "attachments/SF/12345/orcamento.pdf"
  filename     text NOT NULL,
  content_type text,
  size_bytes   bigint,
  uploaded_by  uuid REFERENCES platform.user_profiles(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz,
  FOREIGN KEY (empresa, ncod_ped) REFERENCES approval.approvals(empresa, ncod_ped) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_attachments_pc ON approval.attachments(empresa, ncod_ped);


-- 4. Audit log (tudo que muda em approvals/comments/attachments)
CREATE TABLE IF NOT EXISTS approval.audit_log (
  id          bigserial PRIMARY KEY,
  entity      text NOT NULL,           -- 'approval' | 'comment' | 'attachment'
  empresa     text,
  ncod_ped    bigint,
  entity_id   text,                    -- id do comment/attachment quando aplicável
  action      text NOT NULL,           -- 'insert'|'update'|'delete'|'approve'|'reject'
  user_id     uuid REFERENCES platform.user_profiles(id),
  user_email  text,
  diff        jsonb,                   -- { "campo": ["antes","depois"] }
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_audit_pc      ON approval.audit_log(empresa, ncod_ped);
CREATE INDEX IF NOT EXISTS idx_audit_created ON approval.audit_log(created_at DESC);

-- Audit automático de approvals
CREATE OR REPLACE FUNCTION approval.audit_approvals()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  d jsonb;
  act text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    act := 'insert';
    d   := to_jsonb(NEW);
  ELSIF TG_OP = 'UPDATE' THEN
    act := CASE
      WHEN OLD.status <> NEW.status AND NEW.status = 'APROVADO'  THEN 'approve'
      WHEN OLD.status <> NEW.status AND NEW.status = 'REJEITADO' THEN 'reject'
      ELSE 'update'
    END;
    SELECT jsonb_object_agg(key, jsonb_build_array(old_val, new_val))
      INTO d
    FROM (
      SELECT k AS key,
             to_jsonb(OLD) -> k AS old_val,
             to_jsonb(NEW) -> k AS new_val
      FROM jsonb_object_keys(to_jsonb(NEW)) k
      WHERE to_jsonb(OLD) -> k IS DISTINCT FROM to_jsonb(NEW) -> k
    ) changes;
  ELSE
    act := 'delete';
    d   := to_jsonb(OLD);
  END IF;

  INSERT INTO approval.audit_log (entity, empresa, ncod_ped, action, user_id, diff)
  VALUES (
    'approval',
    COALESCE(NEW.empresa, OLD.empresa),
    COALESCE(NEW.ncod_ped, OLD.ncod_ped),
    act,
    COALESCE(NEW.updated_by, OLD.updated_by),
    d
  );
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_approvals_audit ON approval.approvals;
CREATE TRIGGER trg_approvals_audit
  AFTER INSERT OR UPDATE OR DELETE ON approval.approvals
  FOR EACH ROW EXECUTE FUNCTION approval.audit_approvals();


-- ═══════════════════════════════════════════════════════════════════════════
-- VIEWS — consolidado PC + PV + aprovação (o que o app lê)
-- ═══════════════════════════════════════════════════════════════════════════

-- PC consolidado (1 linha por PC, agregando itens)
CREATE OR REPLACE VIEW approval.v_pc_consolidado AS
SELECT
  pc.empresa,
  pc.ncod_ped,
  MAX(pc.cnumero)        AS pc_numero,
  MAX(pc.cetapa)         AS etapa,
  MAX(pc.cdesc_status)   AS status_omie,
  MAX(pc.ccod_categ)     AS codigo_categoria,
  MAX(pc.ncod_for)       AS codigo_fornecedor,
  MAX(pc.ccontato)       AS contato_fornecedor,
  MAX(pc.ddt_previsao)   AS dt_previsao,
  MAX(pc.ncod_proj)      AS codigo_projeto,
  MAX(pc.cnum_pedido)    AS pv_origem_numero,
  MAX(pc.ccod_int_ped)   AS pv_origem_cod_int,
  MAX(pc.ntotal_pedido)  AS valor_total,
  COUNT(*)               AS qtd_itens,
  MAX(pc.dinc_data)      AS dt_inclusao,
  MAX(pc.synced_at)      AS synced_at
FROM orders.pedidos_compra pc
GROUP BY pc.empresa, pc.ncod_ped;

-- PC + aprovação + PV origem (view principal que o app usa)
CREATE OR REPLACE VIEW approval.v_pc_completo AS
SELECT
  c.empresa,
  c.ncod_ped,
  c.pc_numero,
  c.etapa,
  c.status_omie,
  c.codigo_categoria,
  c.codigo_fornecedor,
  c.contato_fornecedor,
  c.dt_previsao,
  c.codigo_projeto,
  c.pv_origem_numero,
  c.pv_origem_cod_int,
  c.valor_total,
  c.qtd_itens,
  c.dt_inclusao,

  -- PV origem (quando existir)
  pv.numero_pedido       AS pv_numero,
  pv.codigo_cliente      AS pv_cliente_codigo,
  pv.valor_total         AS pv_valor_total,
  pv.etapa               AS pv_etapa,
  pv.data_previsao       AS pv_data_previsao,

  -- Aprovação
  COALESCE(a.status, 'PENDENTE') AS status,
  a.modulo,
  a.aprovador_email,
  a.aprovado_em,
  a.valor_aprovado,
  a.valor_aprovado_audit,
  a.aprovar_ate,
  a.prioridade,
  a.justificativa,
  a.comentario_aprovacao,
  a.comprador,
  a.status_material,

  -- RC (manual / Excel)
  a.rc_numero,
  a.rc_descricao,
  a.rc_custo,
  a.rc_custo_total,

  -- Logística
  a.mt_status_fornecimento,
  a.mt_data_emissao_nf,
  a.mt_data_recebimento_nf,
  a.mt_nf_fornecedor,
  a.pc_pago,
  a.material_enviado,

  -- Livre
  a.custom_fields,

  -- Origem
  a.source,
  a.smart_id,
  a.smart_tabela,
  a.imported_at,

  -- Contadores de thread
  (SELECT COUNT(*) FROM approval.comments    co
     WHERE co.empresa = c.empresa AND co.ncod_ped = c.ncod_ped AND co.deleted_at IS NULL) AS num_comentarios,
  (SELECT COUNT(*) FROM approval.attachments at
     WHERE at.empresa = c.empresa AND at.ncod_ped = c.ncod_ped AND at.deleted_at IS NULL) AS num_anexos

FROM approval.v_pc_consolidado c
LEFT JOIN approval.approvals a
  ON a.empresa  = c.empresa AND a.ncod_ped = c.ncod_ped
LEFT JOIN sales.pedidos_venda pv
  ON pv.empresa = c.empresa AND pv.numero_pedido = c.pv_origem_numero;


-- ═══════════════════════════════════════════════════════════════════════════
-- RLS
-- ═══════════════════════════════════════════════════════════════════════════
ALTER TABLE platform.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform.approvers     ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval.approvals     ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval.comments      ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval.attachments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval.audit_log     ENABLE ROW LEVEL SECURITY;

-- Helper: "o user logado é admin?"
CREATE OR REPLACE FUNCTION platform.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE((SELECT is_admin FROM platform.user_profiles WHERE id = auth.uid()), false);
$$;

-- Helper: "o user logado aprova <modulo>?"
CREATE OR REPLACE FUNCTION platform.is_approver(p_modulo text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (SELECT 1 FROM platform.approvers WHERE user_id = auth.uid() AND modulo = p_modulo);
$$;

-- Policies: leitura aberta pra qualquer usuário autenticado
DROP POLICY IF EXISTS profiles_read         ON platform.user_profiles;
DROP POLICY IF EXISTS approvers_read        ON platform.approvers;
DROP POLICY IF EXISTS approvals_read        ON approval.approvals;
DROP POLICY IF EXISTS comments_read         ON approval.comments;
DROP POLICY IF EXISTS attach_read           ON approval.attachments;
DROP POLICY IF EXISTS audit_read            ON approval.audit_log;
DROP POLICY IF EXISTS profiles_admin_write  ON platform.user_profiles;
DROP POLICY IF EXISTS approvers_admin_write ON platform.approvers;
DROP POLICY IF EXISTS approvals_write       ON approval.approvals;
DROP POLICY IF EXISTS comments_insert       ON approval.comments;
DROP POLICY IF EXISTS comments_update       ON approval.comments;
DROP POLICY IF EXISTS attach_insert         ON approval.attachments;
DROP POLICY IF EXISTS attach_update         ON approval.attachments;

CREATE POLICY profiles_read  ON platform.user_profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY approvers_read ON platform.approvers     FOR SELECT TO authenticated USING (true);
CREATE POLICY approvals_read ON approval.approvals     FOR SELECT TO authenticated USING (true);
CREATE POLICY comments_read  ON approval.comments      FOR SELECT TO authenticated USING (true);
CREATE POLICY attach_read    ON approval.attachments   FOR SELECT TO authenticated USING (true);
CREATE POLICY audit_read     ON approval.audit_log     FOR SELECT TO authenticated USING (true);

-- Escrita em profiles/approvers: só admin
CREATE POLICY profiles_admin_write  ON platform.user_profiles FOR ALL TO authenticated
  USING (platform.is_admin() OR id = auth.uid())       -- user edita o próprio, admin edita todos
  WITH CHECK (platform.is_admin() OR id = auth.uid());

CREATE POLICY approvers_admin_write ON platform.approvers FOR ALL TO authenticated
  USING (platform.is_admin()) WITH CHECK (platform.is_admin());

-- Escrita em approvals: só quem é approver do módulo (ou admin)
CREATE POLICY approvals_write ON approval.approvals FOR ALL TO authenticated
  USING (platform.is_admin() OR platform.is_approver(modulo))
  WITH CHECK (platform.is_admin() OR platform.is_approver(modulo));

-- Escrita em comments: autenticado pode criar; só autor ou admin edita/deleta
CREATE POLICY comments_insert ON approval.comments FOR INSERT TO authenticated WITH CHECK (autor_id = auth.uid());
CREATE POLICY comments_update ON approval.comments FOR UPDATE TO authenticated
  USING (autor_id = auth.uid() OR platform.is_admin())
  WITH CHECK (autor_id = auth.uid() OR platform.is_admin());

-- Escrita em attachments: autenticado cria; só uploader ou admin remove
CREATE POLICY attach_insert ON approval.attachments FOR INSERT TO authenticated WITH CHECK (uploaded_by = auth.uid());
CREATE POLICY attach_update ON approval.attachments FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid() OR platform.is_admin())
  WITH CHECK (uploaded_by = auth.uid() OR platform.is_admin());

-- Audit log: ninguém escreve direto (trigger faz), todos leem
-- (nenhuma policy de write = insert via trigger SECURITY DEFINER)

COMMIT;

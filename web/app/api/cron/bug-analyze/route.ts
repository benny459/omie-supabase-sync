// =============================================================
// /api/cron/bug-analyze — pipeline Gemini 2x → Claude → Issue fix-me.
// Adaptado do waterworks-app pro stack do Painel Omie.
//
// Roda a cada 5 min (vercel.json). Cada execução:
//   1. Lista bugs do supabase omie-data onde analyzed_at IS NULL,
//      status='aberto', analysis_attempts < 3, criados nas últimas 48h.
//   2. Para cada bug: tenta Gemini com JSON estruturado.
//      - Se confidence != high, tenta Gemini de novo (outro ângulo).
//      - Se ainda não high, tenta Claude Sonnet 4.6.
//   3. Atualiza bug com analyzed_at, analysis_confidence,
//      technical_details, out_of_scope, analysis_attempts++.
//   4. Se confidence=high E !out_of_scope: cria Issue GitHub
//      em benny459/omie-supabase-sync com label fix-me.
//      Workflow fix-bug.yml dispara → Claude Code aplica fix → PR.
//
// Auth: Vercel envia "Authorization: Bearer ${CRON_SECRET}".
// Acesso manual: ?secret=<CRON_SECRET>.
// =============================================================

import { NextRequest, NextResponse } from "next/server";
import { bugSupabaseServer, BUG_SUPABASE_USING_SERVICE_ROLE } from "@/lib/bug-supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300; // 5min — Vercel Pro

const BATCH_SIZE = 10;
const ANALYSIS_WINDOW_HOURS = 48;
const MAX_ATTEMPTS = 3;

const SYSTEM_PROMPT = `És um especialista em bugs do Painel Omie da WaterWorks (painel.waterworks.com.br).

Stack:
- Next.js 16 + React 19 + TypeScript 5 + Tailwind CSS
- Supabase Postgres com schemas: public, sales, orders, finance, approval, platform
- PostgREST acessado via supaBrowser() (schema default = "approval") e supaServer()
- Auth via @supabase/ssr (cookies)
- Vercel deploy → painel.waterworks.com.br

Tabelas principais:
- approval.approvals (RC/PC/PV em aprovação — empresa, ncod_ped, modulo, source, status,
  rc_numero, rc_descricao, rc_custo, pv_os_label, custom_fields JSONB)
- approval.v_pc_avulsos, v_pc_pcs, v_pc_projetos, v_pc_completo_enriched (views ricas)
- orders.pedidos_compra (cache Omie), sales.pedidos_venda, sales.ordens_servico
- orders.etapas_faturamento (cod_operacao 01=OS, 11=PV, 21=PC)
- platform.user_profiles, user_module_roles, approvers (RBAC granular)
- platform.is_admin(), is_buyer(), can_write_module(modulo), is_approver(modulo)

RLS:
- bugs_all: ALL public — qualquer um lê/escreve
- approvals_write: ALL authenticated (is_admin OR can_write_module(modulo) OR is_approver(modulo) OR is_buyer())
- approvals_read: SELECT authenticated/anon

Stack UI:
- AppSidebar + AppNav (layout)
- BoldAvulsosView (lista massiva com kanban/grupos por PV/OS ou projeto)
- AddRowButton (insere RC vazia em approvals com ncod_ped negativo)
- AddPcByNumberButton (importa PC pelo número do Omie)
- EditableCell (edição inline de células)
- RcExcelDropZone (upload .xlsx)
- DetailDrawer

Bugs comuns no painel Omie:
- Cliente browser sem schema=approval no createBrowserClient (cai em public.X)
- PGRST205 "Could not find the table" — schema cache desatualizado
- RLS bloqueando INSERT/UPDATE/DELETE (faltam permissões granulares)
- React error #418 hydration mismatch (Intl.NumberFormat/DateTimeFormat divergindo Node vs browser)
- Filtros PostgREST com OR não compostos (precisam de and=(or(...),or(...)))
- 23 MB de mensagens JSONB com base64 → SELECT estourando statement_timeout
- vercel.json: cron path errado, function maxDuration baixo
- Acentos em portugues sumindo em joins/queries

Recebes um bug reportado por um utilizador via widget de suporte. Inclui descrição
livre + chat com o assistente de intake. Tu fazes o DIAGNÓSTICO TÉCNICO (não conversas).

────────────────────────────────────────────────────────────
RESPONDE EM JSON ESTRITO com este shape:

{
  "user_summary": "1 a 2 frases em PT-BR leigo, sem termos técnicos. Apenas o que está a falhar.",
  "technical_details": "diagnóstico completo em markdown — vai PARA A ISSUE: ficheiro EXATO (path relativo a web/) + linha aproximada + causa raiz + fix mínimo em código (3-10 linhas) + passos repro se inferíveis. Se out_of_scope=true ou confidence=low sem info, deixa string vazia.",
  "confidence": "high" | "medium" | "low",
  "out_of_scope": true | false
}

Regras:
- "high" só quando tens certeza do ficheiro+causa. Não inventes.
- "out_of_scope": true se a mensagem NÃO é sobre o Painel Omie (ex: pedido sobre app.waterworks.com.br ou Propostas-WW). technical_details vazio.
- Se duvidoso, prefere "low"/"medium" — Issue só é criada com "high".
- Devolve APENAS os 4 campos.`;

const SECOND_PASS = `\n[Reanálise — outro ângulo. A 1ª passagem foi inconclusiva. Considera hydration SSR/CSR, RLS, schema cache PostgREST, filtros compostos, cron Vercel.]`;

const RESPONSE_SCHEMA = {
  type: "OBJECT",
  properties: {
    user_summary: { type: "STRING" },
    technical_details: { type: "STRING" },
    confidence: { type: "STRING", enum: ["high", "medium", "low"] },
    out_of_scope: { type: "BOOLEAN" },
  },
  required: ["user_summary", "technical_details", "confidence", "out_of_scope"],
};

const SAFETY_OFF = [
  "HARM_CATEGORY_HARASSMENT",
  "HARM_CATEGORY_HATE_SPEECH",
  "HARM_CATEGORY_SEXUALLY_EXPLICIT",
  "HARM_CATEGORY_DANGEROUS_CONTENT",
  "HARM_CATEGORY_CIVIC_INTEGRITY",
].map((c) => ({ category: c, threshold: "BLOCK_NONE" }));

type Diag = {
  user_summary: string;
  technical_details: string;
  confidence: "high" | "medium" | "low";
  out_of_scope: boolean;
};

type DiagResult = Diag | { _error: string };

function isDiag(x: DiagResult): x is Diag {
  return !("_error" in x) && typeof (x as Diag).confidence === "string";
}

async function callGemini(bugText: string, secondPass = false): Promise<DiagResult> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { _error: "GEMINI_API_KEY ausente" };
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${key}`;
  const system = SYSTEM_PROMPT + (secondPass ? SECOND_PASS : "");
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: bugText }] }],
        systemInstruction: { parts: [{ text: system }] },
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 8000,
          responseMimeType: "application/json",
          responseSchema: RESPONSE_SCHEMA,
        },
        safetySettings: SAFETY_OFF,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { _error: `gemini ${resp.status}: ${body.slice(0, 200)}` };
    }
    const data = (await resp.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    };
    const cand = data.candidates?.[0];
    const raw = (cand?.content?.parts || []).map((p) => p.text || "").join("\n").trim();
    if (!raw) return { _error: `vazio (finishReason=${cand?.finishReason || "UNKNOWN"})` };
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "user_summary" in parsed) return parsed as Diag;
      return { _error: "shape inválido" };
    } catch (e) {
      return { _error: `JSON inválido: ${e instanceof Error ? e.message : "err"}` };
    }
  } catch (e) {
    return { _error: `network: ${e instanceof Error ? e.message : "err"}` };
  }
}

async function callClaude(bugText: string): Promise<DiagResult> {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return { _error: "ANTHROPIC_API_KEY ausente — não é possível escalar" };
  const system =
    SYSTEM_PROMPT +
    "\n\nIMPORTANTE: devolve APENAS o objeto JSON, sem prefixo nem ```json```. " +
    'Apenas: { "user_summary": ..., "technical_details": ..., "confidence": ..., "out_of_scope": ... }';
  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 2500,
        system,
        messages: [{ role: "user", content: bugText }],
      }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      return { _error: `claude ${resp.status}: ${body.slice(0, 200)}` };
    }
    const data = (await resp.json()) as { content?: { type?: string; text?: string }[] };
    let raw = (data.content || []).filter((c) => c.type === "text").map((c) => c.text || "").join("").trim();
    if (raw.startsWith("```")) raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && "user_summary" in parsed) return parsed as Diag;
      return { _error: "claude: shape inválido" };
    } catch (e) {
      return { _error: `claude JSON: ${e instanceof Error ? e.message : "err"}` };
    }
  } catch (e) {
    return { _error: `claude network: ${e instanceof Error ? e.message : "err"}` };
  }
}

async function diagnose(bugText: string): Promise<{ diag: Diag | null; trace: string[] }> {
  const trace: string[] = [];
  let r = await callGemini(bugText, false);
  trace.push(`gemini1: ${isDiag(r) ? r.confidence : r._error}`);
  if (isDiag(r) && r.confidence === "high") return { diag: r, trace };
  r = await callGemini(bugText, true);
  trace.push(`gemini2: ${isDiag(r) ? r.confidence : r._error}`);
  if (isDiag(r) && r.confidence === "high") return { diag: r, trace };
  const geminiBest: Diag | null = isDiag(r) ? r : null;
  const c = await callClaude(bugText);
  trace.push(`claude: ${isDiag(c) ? c.confidence : c._error}`);
  if (isDiag(c)) return { diag: c, trace };
  return { diag: geminiBest, trace };
}

type BugRow = {
  id: string;
  ticket_code: string | null;
  descricao: string;
  mensagens: { role: string; content: string }[] | null;
  reporter_email: string;
  reporter_nome: string | null;
  url: string | null;
  analysis_attempts: number;
  created_at: string;
};

function buildBugContext(bug: BugRow): string {
  const lines: string[] = [];
  lines.push(`# Bug ${bug.ticket_code || bug.id}`);
  lines.push(`Reportado por: ${bug.reporter_nome || ""} <${bug.reporter_email}>`);
  if (bug.url) lines.push(`Tela: ${bug.url}`);
  lines.push("");
  lines.push("## Descrição");
  lines.push(bug.descricao || "(vazio)");
  if (Array.isArray(bug.mensagens) && bug.mensagens.length > 0) {
    lines.push("");
    lines.push("## Chat de intake (resumido)");
    for (const m of bug.mensagens.slice(-10)) {
      const role = m.role === "assistant" ? "AI" : "USER";
      lines.push(`- ${role}: ${(m.content || "").slice(0, 400)}`);
    }
  }
  return lines.join("\n");
}

async function createGithubIssue(bug: BugRow, diag: Diag): Promise<{ number: number; url: string } | null> {
  const token = process.env.GITHUB_TOKEN;
  const owner = process.env.GITHUB_REPO_OWNER || "benny459";
  const repo = process.env.GITHUB_REPO_NAME || "omie-supabase-sync";
  if (!token) return null;

  const title = `[fix-me] ${bug.ticket_code || bug.id} — ${diag.user_summary.slice(0, 120)}`;
  const ticketRef = bug.ticket_code ? `Ticket: \`${bug.ticket_code}\`` : `Bug ID: \`${bug.id}\``;
  const body = [
    "Issue criada automaticamente pelo cron `/api/cron/bug-analyze`.",
    "Workflow `.github/workflows/fix-bug.yml` deve disparar e abrir PR com o fix.",
    "",
    "## Resumo (linguagem leiga)",
    diag.user_summary,
    "",
    "## Diagnóstico técnico",
    diag.technical_details,
    "",
    "## Origem",
    ticketRef,
    `Reportado por: ${bug.reporter_nome || ""} <${bug.reporter_email}>`,
    bug.url ? `Tela: ${bug.url}` : "",
    `Confidence IA: ${diag.confidence}`,
    "",
    "## Bug original",
    "```",
    (bug.descricao || "").slice(0, 4000),
    "```",
  ].filter((l) => l !== null).join("\n");

  try {
    const resp = await fetch(`https://api.github.com/repos/${owner}/${repo}/issues`, {
      method: "POST",
      headers: { Authorization: `token ${token}`, Accept: "application/vnd.github+json" },
      body: JSON.stringify({
        title: title.slice(0, 200),
        body: body.slice(0, 60000),
        labels: ["fix-me", "auto-generated"],
      }),
    });
    if (resp.status !== 201 && resp.status !== 200) return null;
    const data = (await resp.json()) as { number?: number; html_url?: string };
    if (!data.number) return null;
    return { number: data.number, url: data.html_url || "" };
  } catch {
    return null;
  }
}

function unauthorized() { return NextResponse.json({ error: "unauthorized" }, { status: 401 }); }

async function authorize(req: NextRequest): Promise<boolean> {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${expected}`) return true;
  const url = new URL(req.url);
  if (url.searchParams.get("secret") === expected) return true;
  return false;
}

export async function GET(req: NextRequest) {
  const ok = await authorize(req);
  if (!ok) return unauthorized();

  const sb = bugSupabaseServer();
  const cutoff = new Date(Date.now() - ANALYSIS_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

  const { data: bugs, error } = await sb
    .from("bugs")
    .select("id, ticket_code, descricao, mensagens, reporter_email, reporter_nome, url, analysis_attempts, created_at")
    .is("analyzed_at", null)
    .eq("status", "aberto")
    .lt("analysis_attempts", MAX_ATTEMPTS)
    .gte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(BATCH_SIZE);

  if (error) {
    return NextResponse.json(
      { error: error.message, using_service_role: BUG_SUPABASE_USING_SERVICE_ROLE },
      { status: 500 }
    );
  }
  if (!bugs || bugs.length === 0) return NextResponse.json({ analyzed: 0, issues_created: 0 });

  let issuesCreated = 0;
  const results: { bug: string; confidence: string | null; issue_number: number | null; error?: string }[] = [];

  for (const raw of bugs as BugRow[]) {
    try {
      const ctx = buildBugContext(raw);
      const { diag, trace } = await diagnose(ctx);
      const nowIso = new Date().toISOString();

      if (!diag) {
        await sb.from("bugs").update({
          analyzed_at: nowIso,
          analysis_attempts: raw.analysis_attempts + 1,
          analysis_confidence: "low",
          technical_details: `(análise IA falhou) ${trace.join(" | ")}`,
        }).eq("id", raw.id);
        results.push({ bug: raw.ticket_code || raw.id, confidence: null, issue_number: null, error: trace.join(" | ") });
        continue;
      }

      const update: Record<string, unknown> = {
        analyzed_at: nowIso,
        analysis_attempts: raw.analysis_attempts + 1,
        analysis_confidence: diag.confidence,
        technical_details: diag.technical_details || null,
        out_of_scope: diag.out_of_scope === true,
      };

      let issueNumber: number | null = null;
      if (diag.confidence === "high" && !diag.out_of_scope) {
        const issue = await createGithubIssue(raw, diag);
        if (issue) {
          update.github_issue_number = issue.number;
          update.github_issue_url = issue.url;
          issueNumber = issue.number;
          issuesCreated++;
        }
      }

      const { error: updErr } = await sb.from("bugs").update(update).eq("id", raw.id);
      if (updErr) {
        results.push({ bug: raw.ticket_code || raw.id, confidence: diag.confidence, issue_number: issueNumber, error: `update: ${updErr.message}` });
      } else {
        results.push({ bug: raw.ticket_code || raw.id, confidence: diag.confidence, issue_number: issueNumber });
      }
    } catch (e) {
      await sb.from("bugs").update({ analysis_attempts: raw.analysis_attempts + 1 }).eq("id", raw.id);
      results.push({ bug: raw.ticket_code || raw.id, confidence: null, issue_number: null, error: e instanceof Error ? e.message : "unknown" });
    }
  }

  return NextResponse.json({
    analyzed: bugs.length,
    issues_created: issuesCreated,
    using_service_role: BUG_SUPABASE_USING_SERVICE_ROLE,
    results,
  });
}

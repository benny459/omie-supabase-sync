"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { bugSupabase, BUG_EMPRESA_ID } from "@/lib/bug-supabase";

type Msg = { id: string; role: "user" | "assistant"; content: string; images?: ImgAtt[] };
type ImgAtt = { name: string; data_url: string };
type Draft = { id: string; messages: Msg[]; summary: string; images: ImgAtt[] };
type View = "closed" | "open" | "minimized";
type Tab = "chat" | "history" | "admin";

const WELCOME: Msg = {
  id: "welcome",
  role: "assistant",
  content: "Olá! Pode reportar um problema ou tirar uma dúvida sobre o painel. Anexe prints se ajudar.",
};

const MAX_IMG = 4 * 1024 * 1024;

const STATUS_LABEL: Record<string, { label: string; bg: string; tx: string }> = {
  aberto: { label: "Recebido", bg: "#e2e8f0", tx: "#1e293b" },
  em_processamento: { label: "Estou olhando", bg: "#dbeafe", tx: "#1e40af" },
  aguardando_user: { label: "Preciso de uma resposta sua", bg: "#fef3c7", tx: "#92400e" },
  pronto: { label: "Resolvido — aguarde a publicação", bg: "#ede9fe", tx: "#5b21b6" },
  pendente_merge: { label: "Quase publicando", bg: "#ede9fe", tx: "#5b21b6" },
  validado: { label: "Concluído", bg: "#d1fae5", tx: "#065f46" },
  excede_escopo: { label: "Encaminhado", bg: "#e2e8f0", tx: "#475569" },
  falhou: { label: "Não consegui resolver agora", bg: "#fecaca", tx: "#991b1b" },
  recusado: { label: "Não tratado", bg: "#e2e8f0", tx: "#475569" },
  cancelado: { label: "Cancelado", bg: "#e2e8f0", tx: "#475569" },
};

function humanize(s: string): string {
  let out = s;
  out = out.replace(/\bcommit\s+[a-f0-9]{7,40}\b/gi, "uma atualização");
  out = out.replace(/\bcommit_sha\b/gi, "código da atualização");
  out = out.replace(/\bvercel\b/gi, "publicação");
  out = out.replace(/\bdeploy(a|ar|ando)?\b/gi, "publica$1");
  out = out.replace(/\bbranch\b/gi, "versão");
  out = out.replace(/\bpush(ado)?\b/gi, "enviado$1");
  out = out.replace(/\bdiff\b/gi, "alteração");
  out = out.replace(/\bem\s+\/[\w\-/.\[\]()]+/g, "");
  out = out.replace(/\b(GET|POST|PATCH|DELETE)\s+\/api\/[^\s]+/g, "");
  out = out.replace(/\s{2,}/g, " ").trim();
  return out;
}

type MsgLike = { role?: string; from?: string; content?: string };
type StatusBugLike = { status: string; mensagens?: MsgLike[] | null; github_issue_number?: number | null };

function isClaudeLoopResolved(t: StatusBugLike): boolean {
  const msgs = t.mensagens || [];
  if (msgs.length === 0) return false;
  const last = msgs[msgs.length - 1];
  if (last.from !== "claude-loop") return false;
  return /v\d+\.\d+\.\d+\s*\(sobe em/i.test(String(last.content || ""));
}

function effectiveStatus(t: StatusBugLike): string {
  if (isClaudeLoopResolved(t) && t.status === "aguardando_user") return "pronto";
  if (t.github_issue_number && (t.status === "aberto" || t.status === "em_processamento")) return "pronto";
  return t.status;
}

const CONSOLE_BUFFER: { level: string; msg: string; ts: string }[] = [];
const CONSOLE_BUFFER_MAX = 80;

function installConsoleCapture() {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __wwBugConsoleHooked?: boolean };
  if (w.__wwBugConsoleHooked) return;
  w.__wwBugConsoleHooked = true;
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error, debug: console.debug };
  const push = (level: string, args: unknown[]) => {
    try {
      const msg = args.map(a => {
        if (typeof a === "string") return a;
        if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack || ""}`;
        try { return JSON.stringify(a); } catch { return String(a); }
      }).join(" ");
      CONSOLE_BUFFER.push({ level, msg: msg.slice(0, 2000), ts: new Date().toISOString() });
      if (CONSOLE_BUFFER.length > CONSOLE_BUFFER_MAX) CONSOLE_BUFFER.shift();
    } catch { /* swallow */ }
  };
  (["log", "info", "warn", "error", "debug"] as const).forEach(lvl => {
    console[lvl] = (...args: unknown[]) => { push(lvl, args); orig[lvl](...args); };
  });
  window.addEventListener("error", e => push("error", [`[window.error] ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`]));
  window.addEventListener("unhandledrejection", e => {
    const r = (e as PromiseRejectionEvent).reason as { message?: string; stack?: string };
    push("error", [`[unhandledrejection] ${r?.message || r}\n${r?.stack || ""}`]);
  });
}

interface UserLike { email?: string | null; nome?: string | null }

export default function SupportWidget({ user, isAdmin = false }: { user: UserLike | null | undefined; isAdmin?: boolean }) {
  const [view, setView] = useState<View>("closed");

  useEffect(() => { installConsoleCapture(); }, []);
  if (!user || !user.email) return null;

  return (
    <>
      {view === "closed" && (
        <button
          onClick={() => setView("open")}
          title="Reportar bug ou tirar dúvida"
          className="fixed bottom-4 right-4 z-[9000] rounded-full bg-red-600 hover:bg-red-700 text-white px-4 py-3 text-sm font-bold shadow-[0_6px_18px_rgba(220,38,38,0.45)] transition-colors"
        >
          🛟 Suporte
        </button>
      )}
      {view === "minimized" && (
        <button
          onClick={() => setView("open")}
          title="Restaurar suporte"
          className="fixed bottom-4 right-4 z-[9000] rounded-full bg-amber-500 hover:bg-amber-600 text-white px-3 py-2 text-xs font-semibold shadow-[0_4px_14px_rgba(245,158,11,0.45)]"
        >
          🛟 Suporte (em rascunho)
        </button>
      )}
      {view !== "closed" && (
        <div style={{ display: view === "minimized" ? "none" : undefined }}>
          <SupportPanel
            user={user}
            isAdmin={isAdmin}
            onMinimize={() => setView("minimized")}
            onClose={() => setView("closed")}
          />
        </div>
      )}
    </>
  );
}

function SupportPanel({ user, isAdmin, onMinimize, onClose }: { user: UserLike; isAdmin: boolean; onMinimize: () => void; onClose: () => void }) {
  const [tab, setTab] = useState<Tab>("chat");
  const [messages, setMessages] = useState<Msg[]>([WELCOME]);
  const [pendingImages, setPendingImages] = useState<ImgAtt[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [closed, setClosed] = useState<null | "bug" | "nao_bug">(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [submittedCodes, setSubmittedCodes] = useState<string[] | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).forEach(file => {
      if (file.size > MAX_IMG) { alert(`"${file.name}" é maior que 4MB — comprima ou corte antes.`); return; }
      const r = new FileReader();
      r.onload = () => setPendingImages(p => [...p, { name: file.name, data_url: String(r.result || "") }]);
      r.readAsDataURL(file);
    });
    if (fileRef.current) fileRef.current.value = "";
  };

  const send = async () => {
    const text = input.trim();
    if ((!text && pendingImages.length === 0) || busy) return;
    const userMsg: Msg = {
      id: `u_${Date.now()}`, role: "user",
      content: text || (pendingImages.length > 0 ? `[anexou ${pendingImages.length} imagem(ns)]` : ""),
      images: pendingImages.length > 0 ? pendingImages : undefined,
    };
    const next = [...messages, userMsg];
    setMessages(next); setInput(""); setPendingImages([]); setBusy(true);
    try {
      const res = await fetch("/api/bug-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })) }),
      });
      const data = await res.json();
      if (data.ok && data.message) {
        setMessages(p => [...p, { id: `a_${Date.now()}`, role: "assistant", content: data.message }]);
        if (data.closedKind === "bug" || data.closedKind === "nao_bug") setClosed(data.closedKind);
      } else {
        setMessages(p => [...p, { id: `e_${Date.now()}`, role: "assistant", content: `Erro: ${data.error || "desconhecido"}` }]);
      }
    } catch (err) {
      setMessages(p => [...p, { id: `e_${Date.now()}`, role: "assistant", content: `Erro: ${err instanceof Error ? err.message : "desconhecido"}` }]);
    } finally { setBusy(false); }
  };

  const collectImages = (msgs: Msg[]) => msgs.flatMap(m => m.images || []);

  const addToConjunto = () => {
    if (closed !== "bug") return;
    const userMsgs = messages.filter(m => m.role === "user");
    if (userMsgs.length === 0) return;
    const summary = userMsgs.map(m => m.content).join(" / ").slice(0, 80);
    const draft: Draft = { id: `d_${Date.now()}`, messages: messages.filter(m => m.id !== "welcome"), summary, images: collectImages(messages) };
    setDrafts(p => [...p, draft]);
    setMessages([WELCOME, { id: `a_${Date.now()}_added`, role: "assistant", content: `Adicionado ao conjunto (${drafts.length + 1}). Pode me contar o próximo problema ou clicar em "Enviar conjunto".` }]);
    setClosed(null); setInput(""); setPendingImages([]);
  };

  const removeDraft = (id: string) => setDrafts(p => p.filter(d => d.id !== id));

  const submitConjunto = async () => {
    const allDrafts = [...drafts];
    if (closed === "bug") {
      const userMsgs = messages.filter(m => m.role === "user");
      if (userMsgs.length > 0) {
        allDrafts.push({ id: "d_now", messages: messages.filter(m => m.id !== "welcome"), summary: userMsgs.map(m => m.content).join(" / ").slice(0, 80), images: collectImages(messages) });
      }
    }
    if (allDrafts.length === 0 || submitting) return;
    setSubmitting(true);
    try {
      const sessRes = await bugSupabase.from("bug_sessions").insert({
        empresa_id: BUG_EMPRESA_ID,
        reporter_email: user.email || "",
        reporter_nome: user.nome || "",
        status: "submetida",
        bug_count: allDrafts.length,
        submitted_at: new Date().toISOString(),
      }).select("id").single();
      if (sessRes.error || !sessRes.data) throw new Error(sessRes.error?.message || "session insert failed");
      const sessionId = sessRes.data.id;
      const url = typeof window !== "undefined" ? window.location.pathname : "";
      const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
      const consoleLogs = [...CONSOLE_BUFFER];
      const rows = allDrafts.map(d => ({
        empresa_id: BUG_EMPRESA_ID, session_id: sessionId,
        reporter_email: user.email || "", reporter_nome: user.nome || "",
        descricao: d.messages.filter(m => m.role === "user").map(m => m.content).join("\n\n"),
        url, user_agent: ua, console_logs: consoleLogs, imagens_extras: d.images,
        mensagens: d.messages.map(m => ({ role: m.role, content: m.content, images: m.images })),
        status: "aberto",
      }));
      const bugsRes = await bugSupabase.from("bugs").insert(rows).select("ticket_code");
      if (bugsRes.error) throw new Error(bugsRes.error.message);
      const codes = (bugsRes.data || []).map(r => r.ticket_code).filter(Boolean) as string[];
      setSubmittedCodes(codes); setDrafts([]); setMessages([WELCOME]); setClosed(null);
    } catch (e) {
      setMessages(p => [...p, { id: `e_${Date.now()}`, role: "assistant", content: `Falha ao enviar: ${e instanceof Error ? e.message : "erro"}` }]);
    } finally { setSubmitting(false); }
  };

  const total = drafts.length + (closed === "bug" ? 1 : 0);

  return (
    <div className="fixed bottom-4 right-4 z-[9100] w-[min(100vw-1.5rem,400px)] h-[min(80vh,640px)] bg-white dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/50">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-red-500/15 flex items-center justify-center text-base">🛟</div>
          <div>
            <div className="text-sm font-semibold">Suporte</div>
            <div className="text-[10px] text-zinc-500">{tab === "chat" ? "Bug ou pergunta — descreva à vontade" : "Acompanhe seus tickets"}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button onClick={onMinimize} title="Minimizar (mantém rascunho)" className="text-zinc-500 hover:text-zinc-700 px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">—</button>
          <button onClick={onClose} title="Fechar (descarta rascunho)" className="text-zinc-500 hover:text-zinc-700 px-2 py-1 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800">✕</button>
        </div>
      </div>

      <div className="flex border-b border-zinc-200 dark:border-zinc-700">
        <button onClick={() => setTab("chat")}
          className={`flex-1 py-2 text-xs font-medium ${tab === "chat" ? "bg-zinc-100 dark:bg-zinc-800 border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-700"}`}>
          💬 Novo {total > 0 && <span className="ml-1 inline-block bg-red-600 text-white px-1.5 py-0 rounded-full text-[9px] font-bold align-middle">{total}</span>}
        </button>
        <button onClick={() => setTab("history")}
          className={`flex-1 py-2 text-xs font-medium ${tab === "history" ? "bg-zinc-100 dark:bg-zinc-800 border-b-2 border-blue-500" : "text-zinc-500 hover:text-zinc-700"}`}>
          📋 Meus tickets
        </button>
        {isAdmin && (
          <button onClick={() => setTab("admin")}
            className={`flex-1 py-2 text-xs font-medium ${tab === "admin" ? "bg-zinc-100 dark:bg-zinc-800 border-b-2 border-emerald-500" : "text-zinc-500 hover:text-zinc-700"}`}>
            🛡️ Admin
          </button>
        )}
      </div>

      {tab === "history" ? (
        <MyTicketsPanel user={user} />
      ) : tab === "admin" ? (
        <AdminTicketsPanel />
      ) : (
        <>
          {drafts.length > 0 && (
            <div className="border-b border-zinc-200 dark:border-zinc-700 bg-amber-50 dark:bg-amber-950/20 px-3 py-2">
              <div className="text-[11px] font-semibold text-amber-900 dark:text-amber-200 mb-1.5">✓ {drafts.length} problema{drafts.length > 1 ? "s" : ""} no conjunto</div>
              {drafts.map((d, i) => (
                <div key={d.id} className="flex items-center justify-between gap-2 bg-white/60 dark:bg-black/20 rounded px-2 py-1 text-[11px] mb-1">
                  <span className="flex-1 truncate"><b className="mr-1.5">{i + 1}.</b>{d.summary}{d.images.length > 0 && <span className="ml-1 opacity-70">📎{d.images.length}</span>}</span>
                  <button onClick={() => removeDraft(d.id)} className="text-zinc-500 hover:text-red-600 px-1" title="Remover">✕</button>
                </div>
              ))}
            </div>
          )}

          {submittedCodes && submittedCodes.length > 0 && (
            <div className="border-b border-zinc-200 dark:border-zinc-700 bg-emerald-50 dark:bg-emerald-950/20 px-3 py-2">
              <div className="text-[11px] font-semibold text-emerald-900 dark:text-emerald-200 mb-1">✓ Conjunto enviado — {submittedCodes.length} ticket{submittedCodes.length > 1 ? "s" : ""}:</div>
              <div className="flex flex-wrap gap-1">
                {submittedCodes.map(c => <span key={c} className="text-[10px] font-mono bg-white/60 dark:bg-black/20 rounded px-1.5 py-0.5">{c}</span>)}
              </div>
              <p className="text-[10px] text-emerald-800 dark:text-emerald-300 mt-1">Acompanhe a resolução em &quot;Meus tickets&quot;.</p>
            </div>
          )}

          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map(m => (
              <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className="max-w-[85%] space-y-1">
                  <div className={`px-3 py-2 rounded-xl text-sm whitespace-pre-wrap ${m.role === "user" ? "bg-blue-500 text-white" : "bg-zinc-100 dark:bg-zinc-800"}`}>{m.content}</div>
                  {m.images && m.images.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {m.images.map((img, i) => (
                        <img key={i} src={img.data_url} alt={img.name} onClick={() => window.open(img.data_url, "_blank")}
                          className="h-20 rounded-md border object-cover cursor-pointer hover:opacity-90" />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>

          {pendingImages.length > 0 && (
            <div className="px-3 pt-2 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 flex gap-1.5 flex-wrap">
              {pendingImages.map((img, i) => (
                <div key={i} className="relative">
                  <img src={img.data_url} alt={img.name} className="h-14 w-14 rounded border object-cover" />
                  <button onClick={() => setPendingImages(p => p.filter((_, j) => j !== i))} title="Remover"
                    className="absolute -top-1 -right-1 bg-red-600 text-white rounded-full w-4 h-4 text-[10px] flex items-center justify-center">✕</button>
                </div>
              ))}
            </div>
          )}

          {closed === "bug" && (
            <div className="px-3 pt-2 pb-1 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30 flex gap-2">
              <button onClick={addToConjunto} className="flex-1 bg-amber-500 hover:bg-amber-600 text-white py-2 rounded-xl text-xs font-bold">+ Adicionar outro problema</button>
              <button onClick={submitConjunto} disabled={submitting} className="flex-1 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-xl text-xs font-bold">
                {submitting ? "Enviando..." : `Enviar conjunto (${total})`}
              </button>
            </div>
          )}
          {closed !== "bug" && drafts.length > 0 && (
            <div className="px-3 pt-2 pb-1 border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-800/30">
              <button onClick={submitConjunto} disabled={submitting} className="w-full bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white py-2 rounded-xl text-xs font-bold">
                {submitting ? "Enviando..." : `Enviar conjunto (${drafts.length})`}
              </button>
            </div>
          )}

          <div className="flex items-end gap-2 p-3 border-t border-zinc-200 dark:border-zinc-700">
            <input ref={fileRef} type="file" accept="image/*" multiple className="hidden" onChange={e => handleFiles(e.target.files)} />
            <button onClick={() => fileRef.current?.click()} disabled={busy} title="Anexar print/foto"
              className="h-10 w-10 rounded-xl border bg-white dark:bg-zinc-800 hover:bg-zinc-100 dark:hover:bg-zinc-700 flex items-center justify-center text-base disabled:opacity-40">📎</button>
            <textarea value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
              placeholder={drafts.length > 0 ? "Descreva o próximo problema..." : "Descreva o problema ou faça sua pergunta..."}
              rows={2} disabled={busy}
              className="flex-1 border border-zinc-300 dark:border-zinc-600 rounded-xl px-3 py-2 text-sm resize-none outline-none focus:ring-2 focus:ring-blue-500/30 bg-white dark:bg-zinc-800 disabled:opacity-50" />
            <button onClick={send} disabled={busy || (!input.trim() && pendingImages.length === 0)}
              className="h-10 w-10 rounded-xl bg-blue-500 text-white flex items-center justify-center hover:bg-blue-600 disabled:opacity-40 text-base">
              {busy ? "⏳" : "→"}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

type BugRow = {
  id: string; ticket_code: string | null; descricao: string | null; url: string | null;
  status: string; mensagens: { role: string; content: string; from?: string; images?: ImgAtt[] }[] | null;
  imagens_extras: ImgAtt[] | null; reporter_email: string | null; colaboradores: string[] | null;
  created_at: string;
  processed_at?: string | null;
  github_issue_number?: number | null;
  fixed_by_model?: string | null;
};

function ModelBadge({ model }: { model?: string | null }) {
  if (!model) return null;
  const m = model.toLowerCase();
  if (m === "gemini") {
    return <span title="Resolvido por Gemini 2.5 Pro" className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: "#dbeafe", color: "#1d4ed8", border: "1px solid #93c5fd" }}>✦ Gemini</span>;
  }
  if (m === "anthropic") {
    return <span title="Resolvido por Claude Sonnet 4.6" className="inline-block px-1.5 py-0.5 rounded text-[9px] font-semibold" style={{ background: "#ffedd5", color: "#c2410c", border: "1px solid #fdba74" }}>◆ Claude</span>;
  }
  return null;
}

function MyTicketsPanel({ user }: { user: UserLike }) {
  const [tickets, setTickets] = useState<BugRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyById, setReplyById] = useState<Record<string, string>>({});
  const [sendingById, setSendingById] = useState<Record<string, boolean>>({});
  const [collabInputById, setCollabInputById] = useState<Record<string, string>>({});

  // Lista sem `mensagens` / `imagens_extras` (JSONB pesado quando tem screenshots base64).
  const LIST_COLS = "id,ticket_code,descricao,url,status,reporter_email,colaboradores,created_at,processed_at";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const { data, error } = await bugSupabase.from("bugs")
          .select(LIST_COLS)
          .or(`reporter_email.eq.${user.email},colaboradores.cs.{${user.email}}`)
          .order("created_at", { ascending: false }).limit(30);
        if (!alive) return;
        if (error) setError(error.message);
        else setTickets((((data as unknown) as BugRow[]) || []).map(r => ({ ...r, mensagens: r.mensagens || [], imagens_extras: r.imagens_extras || [] })));
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "erro"); }
      finally { if (alive) setLoading(false); }
    };
    load();
    const channel = bugSupabase.channel(`bugs-${user.email}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bugs" }, () => { if (alive) load(); })
      .subscribe();
    return () => { alive = false; bugSupabase.removeChannel(channel); };
  }, [user.email]);

  const loadFullTicket = async (id: string, force = false) => {
    const t = tickets.find(x => x.id === id);
    if (!t) return;
    if (!force && t.mensagens && t.mensagens.length > 0) return;
    try {
      const { data, error } = await bugSupabase.from("bugs")
        .select("mensagens,imagens_extras,status,processed_at,github_issue_number,github_issue_url,branch_name,preview_url,analyzed_at,analysis_confidence")
        .eq("id", id).single();
      if (error) throw error;
      if (data) {
        setTickets(prev => prev.map(x => x.id === id ? {
          ...x,
          mensagens: (data.mensagens || []) as BugRow["mensagens"],
          imagens_extras: (data.imagens_extras || x.imagens_extras || []) as BugRow["imagens_extras"],
          status: (data.status as string) ?? x.status,
          processed_at: (data.processed_at as string | null) ?? x.processed_at,
        } : x));
      }
    } catch (e) { console.warn("loadFullTicket:", e); }
  };

  const [refreshing, setRefreshing] = useState(false);
  const refreshAll = async () => {
    setRefreshing(true);
    try {
      const { data } = await bugSupabase.from("bugs").select(LIST_COLS)
        .or(`reporter_email.eq.${user.email},colaboradores.cs.{${user.email}}`)
        .order("created_at", { ascending: false }).limit(30);
      if (Array.isArray(data)) {
        setTickets(prev => {
          const byId = new Map(prev.map(p => [p.id, p]));
          return ((data as unknown) as BugRow[]).map(r => {
            const existing = byId.get(r.id);
            return existing
              ? { ...existing, ...r, mensagens: existing.mensagens, imagens_extras: existing.imagens_extras }
              : { ...r, mensagens: [], imagens_extras: [] };
          });
        });
      }
      if (openId) await loadFullTicket(openId, true);
    } finally { setRefreshing(false); }
  };

  const sendReply = async (id: string) => {
    const text = (replyById[id] || "").trim();
    if (!text) return;
    setSendingById(p => ({ ...p, [id]: true }));
    try {
      const t = tickets.find(x => x.id === id);
      const prev = t?.mensagens || [];
      const nextStatus = t?.status === "aguardando_user" ? "em_processamento" : t?.status;
      await bugSupabase.from("bugs").update({ mensagens: [...prev, { role: "user", content: text, ts: new Date().toISOString() }], status: nextStatus }).eq("id", id);
      setReplyById(p => ({ ...p, [id]: "" }));
    } catch (e) { alert(`Falha: ${e instanceof Error ? e.message : "erro"}`); }
    finally { setSendingById(p => ({ ...p, [id]: false })); }
  };

  const addCollab = async (id: string) => {
    const email = (collabInputById[id] || "").trim().toLowerCase();
    if (!email || !email.includes("@")) { alert("Informe um email válido."); return; }
    const t = tickets.find(x => x.id === id); if (!t) return;
    const next = Array.from(new Set([...(t.colaboradores || []), email]));
    try { await bugSupabase.from("bugs").update({ colaboradores: next }).eq("id", id); setCollabInputById(p => ({ ...p, [id]: "" })); }
    catch (e) { alert(`Falha: ${e instanceof Error ? e.message : "erro"}`); }
  };

  const removeCollab = async (id: string, email: string) => {
    const t = tickets.find(x => x.id === id); if (!t) return;
    const next = (t.colaboradores || []).filter(x => x !== email);
    try { await bugSupabase.from("bugs").update({ colaboradores: next }).eq("id", id); } catch { /* swallow */ }
  };

  if (loading) return <div className="p-6 text-center text-sm text-zinc-500">Carregando…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Erro: {error}</div>;
  if (tickets.length === 0) return <div className="p-6 text-center text-sm text-zinc-500">Você ainda não reportou nada.</div>;

  return (
    <div className="flex-1 overflow-y-auto p-3 space-y-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-[11px] text-zinc-500">{tickets.length} ticket{tickets.length !== 1 ? "s" : ""}</span>
        <button onClick={refreshAll} disabled={refreshing} className="inline-flex items-center gap-1 text-[11px] text-zinc-500 hover:text-zinc-900 dark:hover:text-white disabled:opacity-40" title="Atualizar">
          <span className={refreshing ? "inline-block animate-spin" : "inline-block"}>↻</span>
          {refreshing ? "Atualizando..." : "Atualizar"}
        </button>
      </div>
      {tickets.map((t) => {
        const eff = effectiveStatus(t);
        const meta = STATUS_LABEL[eff] || { label: eff, bg: "#e2e8f0", tx: "#1e293b" };
        const isOpen = openId === t.id;
        const friendlyMsgs = (t.mensagens || []).filter(m => m.role === "assistant").map(m => humanize(m.content));
        const latest = friendlyMsgs[friendlyMsgs.length - 1];
        const canEdit = t.reporter_email === user.email;
        return (
          <div key={t.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
            <button onClick={() => { if (!isOpen) loadFullTicket(t.id); setOpenId(isOpen ? null : t.id); }} className="w-full p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: meta.bg, color: meta.tx }}>{meta.label}</span>
                    <span className="text-[10px] text-zinc-400 tabular-nums">{t.ticket_code || t.id.slice(0, 8)}</span>
                  </div>
                  <p className="text-sm line-clamp-2 break-words">{t.descricao || "(sem descrição)"}</p>
                  {latest && <p className="text-xs text-zinc-500 mt-1 line-clamp-2 italic">↳ {latest}</p>}
                </div>
              </div>
            </button>
            {isOpen && (
              <div className="border-t border-zinc-200 dark:border-zinc-700 p-3 space-y-2 bg-zinc-50 dark:bg-zinc-800/30">
                <div className="rounded-md border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 p-2 space-y-1.5">
                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Colaboradores neste ticket</div>
                  <div className="flex flex-wrap gap-1">
                    {(t.colaboradores || []).length === 0 && <span className="text-[10px] text-zinc-400 italic">Nenhum por enquanto. Adicione abaixo se outra pessoa precisa acompanhar.</span>}
                    {(t.colaboradores || []).map(email => (
                      <span key={email} className="inline-flex items-center gap-1 bg-blue-100 dark:bg-blue-950/40 text-blue-800 dark:text-blue-200 rounded-full px-2 py-0.5 text-[10px]">
                        {email}
                        {canEdit && <button onClick={() => removeCollab(t.id, email)} className="hover:text-red-600" title="Remover">✕</button>}
                      </span>
                    ))}
                  </div>
                  {canEdit && (
                    <div className="flex gap-1.5">
                      <input type="email" value={collabInputById[t.id] || ""} onChange={e => setCollabInputById(p => ({ ...p, [t.id]: e.target.value }))}
                        placeholder="email do colaborador@..."
                        className="flex-1 border border-zinc-300 dark:border-zinc-600 rounded-md px-2 py-1 text-[11px] bg-white dark:bg-zinc-800 outline-none" />
                      <button onClick={() => addCollab(t.id)} className="px-2 py-1 rounded-md text-[11px] font-semibold bg-blue-500 text-white hover:bg-blue-600">+ Adicionar</button>
                    </div>
                  )}
                </div>

                {(t.imagens_extras || []).length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {(t.imagens_extras || []).map((img, i) => (
                      <img key={i} src={img.data_url} alt={img.name} onClick={() => window.open(img.data_url, "_blank")}
                        className="h-16 rounded-md border object-cover cursor-pointer hover:opacity-90" />
                    ))}
                  </div>
                )}

                <div className="text-[10px] uppercase tracking-wider text-zinc-500">Histórico</div>
                {(t.mensagens || []).map((m, i) => (
                  <div key={i} className={`text-xs rounded-md px-2.5 py-1.5 ${
                    m.role === "user" ? "bg-blue-100 dark:bg-blue-950/40 ml-6" :
                    m.from === "admin" ? "bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 mr-6" :
                    "bg-zinc-100 dark:bg-zinc-800 mr-6"
                  }`}>
                    <div className="text-[9px] uppercase tracking-wider mb-0.5 opacity-60">{m.role === "user" ? "Você" : (m.from === "admin" ? "Admin" : (m.from === "claude-loop" ? "Suporte" : "Assistente"))}</div>
                    <div className="whitespace-pre-wrap break-words">{m.role === "assistant" ? humanize(m.content) : m.content}</div>
                  </div>
                ))}
                {!["validado", "cancelado", "recusado"].includes(t.status) && (
                  <div className="pt-2 space-y-1.5">
                    <textarea value={replyById[t.id] || ""} onChange={e => setReplyById(p => ({ ...p, [t.id]: e.target.value }))}
                      placeholder={t.status === "aguardando_user" ? "Responda a pergunta do suporte..." : "Algo a acrescentar ou perguntar?"}
                      rows={2} disabled={!!sendingById[t.id]}
                      className="w-full border border-zinc-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs resize-none outline-none focus:ring-2 focus:ring-blue-500/30 bg-white dark:bg-zinc-800 disabled:opacity-50" />
                    <div className="flex justify-end">
                      <button onClick={() => sendReply(t.id)} disabled={!(replyById[t.id] || "").trim() || !!sendingById[t.id]}
                        className="px-3 py-1 rounded-md text-xs font-semibold bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40">
                        {sendingById[t.id] ? "Enviando..." : "Enviar"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const ADMIN_STATUS_OPTIONS = [
  { key: "aberto", label: "Recebido" },
  { key: "em_processamento", label: "Em proc." },
  { key: "aguardando_user", label: "Aguard. user" },
  { key: "pronto", label: "Pronto" },
  { key: "pendente_merge", label: "Pendente merge" },
  { key: "validado", label: "Validado" },
  { key: "excede_escopo", label: "Excede" },
  { key: "falhou", label: "Falhou" },
  { key: "recusado", label: "Recusado" },
  { key: "cancelado", label: "Cancelado" },
];

type AdminBugRow = BugRow & { reporter_nome: string | null };

function AdminTicketsPanel() {
  const [tickets, setTickets] = useState<AdminBugRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [replyById, setReplyById] = useState<Record<string, string>>({});
  const [sendingById, setSendingById] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [hideTerminal, setHideTerminal] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const cols = "id,ticket_code,descricao,url,status,mensagens,imagens_extras,reporter_email,reporter_nome,colaboradores,created_at,fixed_by_model";
        const { data, error } = await bugSupabase.from("bugs")
          .select(cols).order("created_at", { ascending: false }).limit(300);
        if (!alive) return;
        if (error) setError(error.message);
        else setTickets((data as AdminBugRow[]) || []);
      } catch (e) { if (alive) setError(e instanceof Error ? e.message : "erro"); }
      finally { if (alive) setLoading(false); }
    };
    load();
    const channel = bugSupabase.channel("admin-bugs-all")
      .on("postgres_changes", { event: "*", schema: "public", table: "bugs" }, () => { if (alive) load(); })
      .subscribe();
    return () => { alive = false; bugSupabase.removeChannel(channel); };
  }, []);

  const toggleStatus = (k: string) => setStatusFilter(p => {
    const n = new Set(p); if (n.has(k)) n.delete(k); else n.add(k); return n;
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const terminal = new Set(["validado", "cancelado", "recusado"]);
    return tickets.filter(t => {
      if (hideTerminal && statusFilter.size === 0 && terminal.has(t.status)) return false;
      if (statusFilter.size > 0 && !statusFilter.has(t.status)) return false;
      if (q) {
        const hay = [t.descricao || "", t.reporter_email || "", t.reporter_nome || "", t.ticket_code || ""].join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [tickets, search, statusFilter, hideTerminal]);

  const sendAdminReply = async (id: string) => {
    const text = (replyById[id] || "").trim();
    if (!text) return;
    setSendingById(p => ({ ...p, [id]: true }));
    try {
      const t = tickets.find(x => x.id === id);
      const prev = (t?.mensagens || []) as { role: string; content: string; from?: string; ts?: string }[];
      const newMsg = { role: "assistant", content: text, from: "admin", ts: new Date().toISOString() };
      const { error } = await bugSupabase.from("bugs").update({ mensagens: [...prev, newMsg] }).eq("id", id);
      if (error) throw error;
      setReplyById(p => ({ ...p, [id]: "" }));
    } catch (e) { alert(`Falha: ${e instanceof Error ? e.message : "erro"}`); }
    finally { setSendingById(p => ({ ...p, [id]: false })); }
  };

  if (loading) return <div className="p-6 text-center text-sm text-zinc-500">Carregando…</div>;
  if (error) return <div className="p-6 text-sm text-red-600">Erro: {error}</div>;

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="sticky top-0 z-10 bg-white dark:bg-zinc-900 border-b border-zinc-200 dark:border-zinc-700 p-3 space-y-1.5">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Buscar (descrição, email, código...)"
          className="w-full border border-zinc-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs bg-white dark:bg-zinc-800 outline-none" />
        <div className="flex flex-wrap gap-1">
          {ADMIN_STATUS_OPTIONS.map(o => {
            const m = STATUS_LABEL[o.key];
            const active = statusFilter.has(o.key);
            return (
              <button key={o.key} onClick={() => toggleStatus(o.key)}
                style={active && m ? { background: m.bg, color: m.tx } : undefined}
                className={`px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${active ? "border-transparent" : "bg-white dark:bg-zinc-800 text-zinc-500 border-zinc-300 dark:border-zinc-600 hover:border-zinc-400"}`}>
                {o.label}
              </button>
            );
          })}
          {statusFilter.size > 0 && (
            <button onClick={() => setStatusFilter(new Set())} className="px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-700">limpar</button>
          )}
        </div>
        <div className="flex items-center justify-between text-[10px] text-zinc-500">
          <label className="flex items-center gap-1 cursor-pointer">
            <input type="checkbox" checked={hideTerminal} onChange={e => setHideTerminal(e.target.checked)} className="h-3 w-3" />
            Ocultar finalizados
          </label>
          <span>{filtered.length} de {tickets.length}</span>
        </div>
      </div>

      <div className="p-3 space-y-2">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-500">Nenhum ticket pra esses filtros.</div>
        ) : filtered.map(t => {
          const eff = effectiveStatus(t);
          const meta = STATUS_LABEL[eff] || { label: eff, bg: "#e2e8f0", tx: "#1e293b" };
          const isOpen = openId === t.id;
          const lastMsg = (t.mensagens || []).slice(-1)[0];
          return (
            <div key={t.id} className="rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 overflow-hidden">
              <button onClick={() => setOpenId(isOpen ? null : t.id)} className="w-full p-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="inline-block px-2 py-0.5 rounded-md text-[10px] font-semibold" style={{ background: meta.bg, color: meta.tx }}>{t.status}</span>
                  <span className="text-[10px] text-zinc-400 tabular-nums">{t.ticket_code || t.id.slice(0, 8)}</span>
                  <ModelBadge model={t.fixed_by_model} />
                  <span className="text-[10px] text-zinc-500 truncate max-w-[180px]">{t.reporter_nome || t.reporter_email}</span>
                  <span className="text-[10px] text-zinc-400 ml-auto">{new Date(t.created_at).toLocaleDateString("pt-BR")}</span>
                </div>
                <p className="text-sm line-clamp-2 break-words">{t.descricao || "(sem descrição)"}</p>
                {lastMsg && (
                  <p className="text-xs text-zinc-500 mt-1 line-clamp-2 italic">
                    ↳ <span className="opacity-70">[{lastMsg.role}{lastMsg.from ? "/" + lastMsg.from : ""}]</span> {lastMsg.content}
                  </p>
                )}
              </button>
              {isOpen && (
                <div className="border-t border-zinc-200 dark:border-zinc-700 p-3 space-y-2 bg-zinc-50 dark:bg-zinc-800/30">
                  <div className="text-[10px] text-zinc-500 space-y-0.5">
                    <div><span className="opacity-60">Reporter:</span> {t.reporter_email}{t.reporter_nome ? ` (${t.reporter_nome})` : ""}</div>
                    {t.url && <div className="truncate"><span className="opacity-60">URL:</span> {t.url}</div>}
                    <div><span className="opacity-60">Aberto:</span> {new Date(t.created_at).toLocaleString("pt-BR")}</div>
                    {t.colaboradores && t.colaboradores.length > 0 && (
                      <div><span className="opacity-60">Colab:</span> {t.colaboradores.join(", ")}</div>
                    )}
                  </div>

                  {(t.imagens_extras || []).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {(t.imagens_extras || []).map((img, i) => (
                        <img key={i} src={img.data_url} alt={img.name} onClick={() => window.open(img.data_url, "_blank")}
                          className="h-16 rounded-md border object-cover cursor-pointer hover:opacity-90" />
                      ))}
                    </div>
                  )}

                  <div className="text-[10px] uppercase tracking-wider text-zinc-500">Histórico (cru)</div>
                  {(t.mensagens || []).map((m, i) => {
                    const senderLabel = m.role === "user" ? "Usuário" : m.from === "admin" ? "Admin (você)" : m.from === "claude-loop" ? "Bot" : "Assistente";
                    const align =
                      m.role === "user" ? "ml-6 bg-blue-100 dark:bg-blue-950/40" :
                      m.from === "admin" ? "mr-6 bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900" :
                      "mr-6 bg-zinc-100 dark:bg-zinc-800";
                    return (
                      <div key={i} className={`text-xs rounded-md px-2.5 py-1.5 ${align}`}>
                        <div className="text-[9px] uppercase tracking-wider mb-0.5 opacity-60 flex justify-between gap-2">
                          <span>{senderLabel}</span>
                        </div>
                        <div className="whitespace-pre-wrap break-words">{m.content}</div>
                      </div>
                    );
                  })}
                  <div className="pt-2 space-y-1.5">
                    <textarea value={replyById[t.id] || ""} onChange={e => setReplyById(p => ({ ...p, [t.id]: e.target.value }))}
                      placeholder="Responder como Admin (vai aparecer pro usuário no thread dele)..."
                      rows={2} disabled={!!sendingById[t.id]}
                      className="w-full border border-zinc-300 dark:border-zinc-600 rounded-md px-2 py-1.5 text-xs resize-none outline-none focus:ring-2 focus:ring-emerald-500/30 bg-white dark:bg-zinc-800 disabled:opacity-50" />
                    <div className="flex justify-end">
                      <button onClick={() => sendAdminReply(t.id)} disabled={!(replyById[t.id] || "").trim() || !!sendingById[t.id]}
                        className="px-3 py-1 rounded-md text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40">
                        {sendingById[t.id] ? "Enviando..." : "Enviar como Admin"}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

"use client";

import { useEffect, useState } from "react";
import { supaBrowser } from "@/lib/supabase";
import { fmtBRL, fmtDateTime } from "@/lib/format";

type Selected = {
  empresa: string;
  ncod_ped: number;
  pc_numero?: string | null;
  modulo?: string | null;
};

type Comment = {
  id: string;
  autor_email: string;
  texto: string;
  created_at: string;
  deleted_at: string | null;
};

type AuditEntry = {
  id: number;
  action: string;
  user_email: string | null;
  diff: Record<string, [unknown, unknown]> | null;
  created_at: string;
};

type TimelineItem =
  | ({ kind: "comment"; ts: string } & Comment)
  | ({ kind: "audit"; ts: string } & AuditEntry);

export default function DetailDrawer({
  selected,
  onClose,
}: {
  selected: Selected | null;
  onClose: () => void;
}) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [tab, setTab] = useState<"timeline" | "comments" | "audit">("timeline");
  const [newComment, setNewComment] = useState("");
  const [posting, setPosting] = useState(false);
  const [userEmail, setUserEmail] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    if (!selected) return;
    setLoading(true);
    const supa = supaBrowser();
    Promise.all([
      supa
        .from("comments")
        .select("id,autor_email,texto,created_at,deleted_at")
        .eq("empresa", selected.empresa)
        .eq("ncod_ped", selected.ncod_ped)
        .order("created_at", { ascending: true })
        .returns<Comment[]>(),
      supa
        .from("audit_log")
        .select("id,action,user_email,diff,created_at")
        .eq("empresa", selected.empresa)
        .eq("ncod_ped", selected.ncod_ped)
        .order("created_at", { ascending: true })
        .returns<AuditEntry[]>(),
      supa.auth.getUser(),
    ])
      .then(([c, a, u]) => {
        setComments(c.data ?? []);
        setAudit(a.data ?? []);
        setUserEmail(u.data.user?.email ?? null);
        setUserId(u.data.user?.id ?? null);
      })
      .finally(() => setLoading(false));
  }, [selected]);

  async function postComment() {
    if (!selected || !userId || !userEmail || !newComment.trim()) return;
    setPosting(true);
    const supa = supaBrowser();
    const { data, error } = await supa
      .from("comments")
      .insert({
        empresa: selected.empresa,
        ncod_ped: selected.ncod_ped,
        autor_id: userId,
        autor_email: userEmail,
        texto: newComment.trim(),
      })
      .select()
      .single<Comment>();
    setPosting(false);
    if (!error && data) {
      setComments((prev) => [...prev, data]);
      setNewComment("");
    } else if (error) {
      alert(`Erro: ${error.message}`);
    }
  }

  if (!selected) return null;

  const timeline: TimelineItem[] = [
    ...comments
      .filter((c) => !c.deleted_at)
      .map<TimelineItem>((c) => ({ ...c, kind: "comment", ts: c.created_at })),
    ...audit.map<TimelineItem>((a) => ({ ...a, kind: "audit", ts: a.created_at })),
  ].sort((a, b) => a.ts.localeCompare(b.ts));

  const source = tab === "timeline" ? timeline : tab === "comments"
    ? comments.filter((c) => !c.deleted_at).map<TimelineItem>((c) => ({ ...c, kind: "comment", ts: c.created_at }))
    : audit.map<TimelineItem>((a) => ({ ...a, kind: "audit", ts: a.created_at }));

  return (
    <div className="fixed inset-0 z-30 flex">
      <div className="flex-1 bg-slate-900/30" onClick={onClose} />
      <aside className="w-full max-w-lg bg-white shadow-xl border-l border-slate-200 flex flex-col">
        <header className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <div>
            <div className="text-xs text-slate-400 uppercase">{selected.modulo ?? "—"}</div>
            <h2 className="font-semibold text-slate-900">
              PC {selected.pc_numero ?? "—"}{" "}
              <span className="text-slate-400 font-normal text-sm">
                · {selected.empresa}/{selected.ncod_ped}
              </span>
            </h2>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 text-xl leading-none"
          >
            ×
          </button>
        </header>

        <div className="flex gap-1 px-5 py-2 border-b border-slate-100 text-xs">
          {([
            ["timeline", `Timeline (${comments.length + audit.length})`],
            ["comments", `Comentários (${comments.length})`],
            ["audit",    `Audit (${audit.length})`],
          ] as const).map(([k, lbl]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded-full font-medium transition ${
                tab === k
                  ? "bg-slate-900 text-white"
                  : "text-slate-500 hover:bg-slate-100"
              }`}
            >
              {lbl}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3">
          {loading && <div className="text-slate-400 text-sm">Carregando…</div>}
          {!loading && source.length === 0 && (
            <div className="text-slate-400 text-sm italic">Nada ainda.</div>
          )}
          {source.map((item) =>
            item.kind === "comment" ? (
              <CommentBubble key={`c-${item.id}`} c={item} />
            ) : (
              <AuditBubble key={`a-${item.id}`} a={item} />
            ),
          )}
        </div>

        {/* Input de comentário */}
        <div className="border-t border-slate-200 p-4 space-y-2">
          {userEmail ? (
            <>
              <textarea
                value={newComment}
                onChange={(e) => setNewComment(e.target.value)}
                placeholder="Escrever comentário…"
                rows={2}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              />
              <div className="flex justify-between items-center">
                <span className="text-xs text-slate-400">{userEmail}</span>
                <button
                  onClick={postComment}
                  disabled={posting || !newComment.trim()}
                  className="px-3 py-1.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-40 text-white text-xs font-medium rounded-lg"
                >
                  {posting ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-400">Faça login pra comentar.</div>
          )}
        </div>
      </aside>
    </div>
  );
}

function CommentBubble({ c }: { c: Comment & { kind?: string; ts?: string } }) {
  return (
    <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3">
      <div className="flex justify-between items-baseline mb-1">
        <span className="font-medium text-sm text-slate-800">{c.autor_email}</span>
        <span className="text-[10px] text-slate-400">{fmtDateTime(c.created_at)}</span>
      </div>
      <p className="text-sm text-slate-700 whitespace-pre-wrap">{c.texto}</p>
    </div>
  );
}

function AuditBubble({ a }: { a: AuditEntry & { kind?: string; ts?: string } }) {
  const changedFields = a.diff
    ? Object.keys(a.diff).filter((k) => !k.startsWith("_"))
    : [];
  const isBigDiff = changedFields.length > 6;

  const actionLabels: Record<string, string> = {
    insert: "Criado",
    update: "Alterado",
    delete: "Removido",
    approve: "✅ Aprovado",
    reject: "❌ Rejeitado",
  };

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm">
      <div className="flex justify-between items-baseline mb-1">
        <span className="font-medium text-slate-700">
          {actionLabels[a.action] ?? a.action}
          {a.user_email ? ` · ${a.user_email}` : ""}
        </span>
        <span className="text-[10px] text-slate-400">{fmtDateTime(a.created_at)}</span>
      </div>
      {a.action === "insert" && (
        <p className="text-xs text-slate-500">Registro importado/criado.</p>
      )}
      {a.action !== "insert" && changedFields.length > 0 && (
        <ul className="text-xs text-slate-600 space-y-0.5 mt-1">
          {(isBigDiff ? changedFields.slice(0, 6) : changedFields).map((k) => {
            const [oldV, newV] = a.diff![k];
            return (
              <li key={k}>
                <span className=" text-[10px] text-slate-400">{k}</span>{" "}
                <span className="line-through text-slate-400">{fmtVal(oldV)}</span>
                {" → "}
                <span className="text-slate-800">{fmtVal(newV)}</span>
              </li>
            );
          })}
          {isBigDiff && (
            <li className="text-slate-400 italic">
              … +{changedFields.length - 6} campos
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

function fmtVal(v: unknown): string {
  if (v === null || v === undefined) return "∅";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (typeof v === "number") return fmtBRL(v);
  if (typeof v === "string") {
    if (v.length > 40) return v.slice(0, 40) + "…";
    return v;
  }
  return JSON.stringify(v).slice(0, 40);
}

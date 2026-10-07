"use client";
// OC do cliente e anexos do PV/OS (07/10/26, sql/110). Peças reaproveitadas
// pelo card de Avulsos/Projetos, pela carteira do Faturamento, pela gaveta do
// ERP · Vendas e pelo detalhe do PV/OS nativo:
//   useOcResumo  — nº da OC e contagem de anexos de vários PV/OS de uma vez;
//   OcChip       — "OC 4500931962 · 📎 2" (clicar abre a janela de anexos);
//   OcAnexosPainel — ver/editar o nº da OC, subir arquivo, colar link, remover;
//   OcAnexosModal  — o painel numa janela.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supaBrowser } from "@/lib/supabase";
import { BUCKET_VENDAS_ANEXOS, LIMITE_ANEXO, type AnexoTipo, type OcDoc, type OcResumo } from "@/lib/vendas-anexos";

const CANAL = "vendas-anexos-updated";

/** Avisa as outras telas/abas que um PV/OS mudou (OC ou anexos). */
function avisarMudanca(label: string) {
  // Outras instâncias do canal (mesma aba ou outras) recebem; quem envia, não.
  try { const ch = new BroadcastChannel(CANAL); ch.postMessage({ label }); ch.close(); } catch { /* sem suporte */ }
}

/** Resumo (OC + nº de anexos) de vários PV/OS. Chave do mapa: "EMPRESA|PV1968". */
export function useOcResumo(itens: { empresa: string; label: string }[]) {
  const [mapa, setMapa] = useState<Map<string, OcResumo>>(new Map());
  const [tick, setTick] = useState(0);
  const chave = useMemo(() => {
    const s = new Set<string>();
    for (const i of itens) if (/^(PV|OS)\d+$/i.test(i.label ?? "")) s.add(`${(i.empresa || "SF").toUpperCase()}|${i.label.toUpperCase()}`);
    return [...s].sort().join(",");
  }, [itens]);

  useEffect(() => {
    const bump = () => setTick((n) => n + 1);
    let ch: BroadcastChannel | null = null;
    try { ch = new BroadcastChannel(CANAL); ch.addEventListener("message", bump); } catch { /* ignore */ }
    return () => { try { ch?.close(); } catch { /* ignore */ } };
  }, []);

  useEffect(() => {
    if (!chave) return;
    const porEmpresa = new Map<string, string[]>();
    for (const k of chave.split(",")) {
      const [e, l] = k.split("|");
      porEmpresa.set(e, [...(porEmpresa.get(e) ?? []), l]);
    }
    const ctrl = new AbortController();
    (async () => {
      const next = new Map<string, OcResumo>();
      await Promise.all([...porEmpresa].flatMap(([empresa, labels]) => {
        const lotes: string[][] = [];
        for (let i = 0; i < labels.length; i += 400) lotes.push(labels.slice(i, i + 400));
        return lotes.map(async (ls) => {
          try {
            const r = await fetch("/api/vendas/anexos", {
              method: "POST", headers: { "content-type": "application/json" }, signal: ctrl.signal,
              body: JSON.stringify({ acao: "resumo", empresa, labels: ls }),
            });
            if (!r.ok) return;
            const j = (await r.json()) as { rows?: OcResumo[] };
            for (const x of j.rows ?? []) next.set(`${empresa}|${x.label.toUpperCase()}`, x);
          } catch { /* abortado / offline */ }
        });
      }));
      if (!ctrl.signal.aborted) setMapa(next);
    })();
    return () => ctrl.abort();
  }, [chave, tick]);

  return mapa;
}

/** "OC 4500931962" + "📎 2". Clicar no clipe abre a janela de anexos. */
export function OcChip({ empresa, label, resumo, mostrarOc = true, compacto = false, prefixo, className }: {
  empresa: string; label: string; resumo?: OcResumo | null; mostrarOc?: boolean; compacto?: boolean;
  /** texto antes (Projetos: o PV/OS a que se refere) */ prefixo?: string; className?: string;
}) {
  const [aberto, setAberto] = useState(false);
  const oc = resumo?.num_pedido_cliente ?? null;
  const n = resumo?.anexos ?? 0;
  return (
    <span className={`inline-flex items-center gap-1.5 min-w-0 ${className ?? ""}`} onClick={(e) => e.stopPropagation()}>
      {prefixo && <span className="text-ww-textFaint">{prefixo}</span>}
      {mostrarOc && oc && (
        <span className="font-mono truncate" title={`OC do cliente${resumo?.oc_origem === "omie" ? " (do Omie)" : ""}`}>OC {oc}</span>
      )}
      <button type="button" onClick={(e) => { e.stopPropagation(); setAberto(true); }}
        title={n ? `${n} anexo(s)${resumo?.anexos_oc ? ` · ${resumo.anexos_oc} da OC` : ""} — ver` : "Anexos (OC do cliente, etc.) — anexar"}
        className={`inline-flex items-center gap-0.5 rounded px-1 leading-[1.4] border transition ${n
          ? "border-ww-border text-ww-text hover:bg-ww-rowHover"
          : "border-transparent text-ww-textFaint opacity-60 hover:opacity-100 hover:border-ww-border"} ${compacto ? "text-[10.5px]" : "text-[11px]"}`}>
        <span aria-hidden>📎</span>{n > 0 && <span className="font-mono font-semibold">{n}</span>}
      </button>
      {aberto && <OcAnexosModal empresa={empresa} label={label} onClose={() => setAberto(false)} />}
    </span>
  );
}

export function OcAnexosModal({ empresa, label, onClose }: { empresa: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose]);
  return (
    <div className="fixed inset-0 z-[80] bg-slate-900/50 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={(e) => { e.stopPropagation(); onClose(); }}>
      <div className="bg-ww-panel border border-ww-border rounded-xl shadow-2xl w-full max-w-xl p-5 max-h-[88vh] overflow-y-auto text-left cursor-default"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-3">
          <h3 className="font-semibold text-ww-text text-[14px]">{label} · OC do cliente e anexos <span className="text-ww-textFaint font-normal text-[12px]">({empresa})</span></h3>
          <button onClick={onClose} className="text-ww-textFaint hover:text-ww-text text-xl leading-none">×</button>
        </div>
        <OcAnexosPainel empresa={empresa} label={label} />
      </div>
    </div>
  );
}

const tamanhoTxt = (n: number | null) => (!n ? "" : n > 1048576 ? `${(n / 1048576).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Ver/editar a OC e os anexos de um PV/OS. mostrarOc=false quando a tela já
 *  tem o campo da OC (o detalhe do PV/OS nativo). */
export function OcAnexosPainel({ empresa, label, mostrarOc = true, onMudou }: {
  empresa: string; label: string; mostrarOc?: boolean; onMudou?: (d: OcDoc) => void;
}) {
  const [d, setD] = useState<OcDoc | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocTxt, setOcTxt] = useState("");
  const [ocpd, setOcpd] = useState<string | null>(null);
  const [link, setLink] = useState({ url: "", nome: "" });
  const [tipoNovo, setTipoNovo] = useState<AnexoTipo>("oc_cliente");
  const fileRef = useRef<HTMLInputElement>(null);

  const carregar = useCallback(async () => {
    try {
      const r = await fetch(`/api/vendas/anexos?empresa=${encodeURIComponent(empresa)}&label=${encodeURIComponent(label)}`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setD(j); setOcTxt(j.num_pedido_cliente ?? ""); setErro(null);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
  }, [empresa, label]);
  useEffect(() => { carregar(); }, [carregar]);

  async function post(corpo: Record<string, unknown>, rotulo: string) {
    setOcpd(rotulo); setErro(null);
    try {
      const r = await fetch("/api/vendas/anexos", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ empresa, label, ...corpo }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      if (corpo.acao !== "upload_url") { setD(j); setOcTxt(j.num_pedido_cliente ?? ""); onMudou?.(j); avisarMudanca(label); }
      return j;
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); return null; } finally { setOcpd(null); }
  }

  async function subir(files: FileList | null) {
    for (const f of Array.from(files ?? [])) {
      if (f.size > LIMITE_ANEXO) { setErro(`${f.name}: maior que 25 MB`); continue; }
      const u = await post({ acao: "upload_url", nome: f.name }, `Enviando ${f.name}…`);
      if (!u?.path) return;
      setOcpd(`Enviando ${f.name}…`);
      const { error } = await supaBrowser().storage.from(BUCKET_VENDAS_ANEXOS).uploadToSignedUrl(u.path, u.token, f, { contentType: f.type || undefined });
      setOcpd(null);
      if (error) { setErro(`${f.name}: ${error.message}`); return; }
      await post({ acao: "incluir", nome: f.name, arquivo_path: u.path, tipo: tipoNovo, tamanho: f.size, mime: f.type || null }, "Gravando…");
    }
    if (fileRef.current) fileRef.current.value = "";
  }

  const input = "w-full rounded-md border border-ww-border bg-ww-bg px-2 py-1 text-[12.5px] text-ww-text outline-none focus:border-ww-accent";
  const btn = "rounded-md border border-ww-border px-2.5 py-1 text-[12px] font-semibold text-ww-text hover:bg-ww-rowHover disabled:opacity-40";
  const pendente = !!d?.pendente;
  const ocMudou = (d?.num_pedido_cliente ?? "") !== ocTxt.trim();

  return (
    <div className="space-y-3 text-[12.5px] text-ww-text">
      {erro && <div className="rounded-md border border-red-300 bg-red-50 dark:bg-red-950/30 px-2.5 py-1.5 text-red-700 dark:text-red-300">{erro}</div>}
      {pendente && <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-amber-800 dark:text-amber-200">
        Migração pendente (sql/110): por enquanto só aparece o nº da OC que está no Omie; anexos e edição entram quando a migração for aplicada.</div>}
      {!d && !erro && <div className="text-ww-textMuted">Carregando…</div>}

      {d && mostrarOc && (
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-ww-textFaint font-semibold mb-1">Nº da OC / pedido do cliente</div>
          <div className="flex gap-2">
            <input className={input} value={ocTxt} disabled={pendente} placeholder="ex.: 4500931962" maxLength={60}
              onChange={(e) => setOcTxt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && ocMudou) post({ acao: "oc", num_pedido_cliente: ocTxt }, "Gravando…"); }} />
            <button className={btn} disabled={pendente || !ocMudou || !!ocpd} onClick={() => post({ acao: "oc", num_pedido_cliente: ocTxt }, "Gravando…")}>Salvar</button>
          </div>
          <div className="text-[11px] text-ww-textFaint mt-1">
            {d.nativo ? "PV/OS do painel — gravado no documento." : "PV/OS do Omie — o nº fica guardado no painel; o Omie não é alterado."}
            {d.oc_omie && d.oc_omie !== d.num_pedido_cliente ? ` No Omie: ${d.oc_omie}.` : ""}
          </div>
        </div>
      )}

      {d && (
        <div>
          <div className="text-[10.5px] uppercase tracking-wide text-ww-textFaint font-semibold mb-1">Anexos ({d.anexos.length})</div>
          {d.anexos.length === 0 && <div className="text-ww-textFaint">Nenhum anexo.</div>}
          <ul className="divide-y divide-ww-border/60 border border-ww-border rounded-md empty:hidden">
            {d.anexos.map((a) => (
              <li key={a.id} className="flex items-center gap-2 px-2.5 py-1.5">
                <span aria-hidden>{a.arquivo_path ? "📄" : "🔗"}</span>
                <div className="min-w-0 flex-1">
                  {a.url
                    ? <a href={a.url} target="_blank" rel="noopener noreferrer" className="font-medium text-ww-accent underline underline-offset-2 truncate block">{a.nome}</a>
                    : <span className="font-medium truncate block">{a.nome}</span>}
                  <div className="text-[10.5px] text-ww-textFaint truncate">
                    {a.tipo === "oc_cliente" && <b className="text-ww-text">OC do cliente · </b>}
                    {a.origem === "crm" ? "CRM" : "painel"}{a.por ? ` · ${a.por}` : ""} · {new Date(a.em).toLocaleDateString("pt-BR")}{a.tamanho ? ` · ${tamanhoTxt(a.tamanho)}` : ""}
                  </div>
                </div>
                <button className="text-ww-textFaint hover:text-red-600 text-[12px] px-1" title="Remover anexo" disabled={!!ocpd}
                  onClick={() => { if (confirm(`Remover o anexo "${a.nome}"?`)) post({ acao: "remover", id: a.id }, "Removendo…"); }}>✕</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {d && !pendente && (
        <div className="space-y-2 rounded-md border border-dashed border-ww-border p-2.5">
          <div className="flex items-center gap-3 text-[12px]">
            <span className="text-ww-textMuted">Novo anexo é:</span>
            <label className="inline-flex items-center gap-1"><input type="radio" checked={tipoNovo === "oc_cliente"} onChange={() => setTipoNovo("oc_cliente")} />OC do cliente</label>
            <label className="inline-flex items-center gap-1"><input type="radio" checked={tipoNovo === "outro"} onChange={() => setTipoNovo("outro")} />Outro</label>
          </div>
          <div className="flex items-center gap-2">
            <input ref={fileRef} type="file" multiple className="hidden" onChange={(e) => subir(e.target.files)} />
            <button className={btn} disabled={!!ocpd} onClick={() => fileRef.current?.click()}>Subir arquivo…</button>
            <span className="text-[11px] text-ww-textFaint">PDF, imagem, Office, e-mail · até 25 MB</span>
          </div>
          <div className="flex gap-2">
            <input className={input} placeholder="ou cole um link (https://…)" value={link.url} onChange={(e) => setLink({ ...link, url: e.target.value })} />
            <input className={`${input} max-w-[160px]`} placeholder="nome (opcional)" value={link.nome} onChange={(e) => setLink({ ...link, nome: e.target.value })} />
            <button className={btn} disabled={!!ocpd || !/^https?:\/\/\S+/i.test(link.url.trim())}
              onClick={async () => { const j = await post({ acao: "incluir", url: link.url.trim(), nome: link.nome.trim() || null, tipo: tipoNovo }, "Gravando…"); if (j) setLink({ url: "", nome: "" }); }}>Anexar</button>
          </div>
        </div>
      )}
      {ocpd && <div className="text-ww-textMuted animate-pulse">{ocpd}</div>}
    </div>
  );
}

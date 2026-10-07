"use client";
/* Gerar pedido de compra pela LISTA de materiais (07/10/26, aprovado pelo Benny).
   As linhas marcadas (sem PC) viram um PC por fornecedor — o fornecedor da linha
   (sugestão do catálogo) agrupa, e se troca aqui. Preço, quantidade, categoria,
   condição e previsão se ajustam por pedido; o "Necessário em" mais cedo do grupo
   vira a previsão de entrega. Grava pelo MESMO caminho da folha de Compras
   (compras_salvar: numeração, aprovação, avisos) via /api/rc-projetos/compras
   acao=gerar_pc, e cada item do PC já nasce ligado à sua linha da lista.
   "Simular" passa pelas mesmas travas sem gravar nada. Nada vai ao Omie. */
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { gerarParcelas, hoje, addDias, TIPOS_FRETE, type Refs } from "@/lib/compras";

export type LinhaParaPc = { id: string; item: string; codigo: string; qtd: number; vu: number; fornecedor: string; necessario: string | null; un: string };
type Forn = { cod: number; nome: string; fantasia?: string; cnpj?: string; ultCatCod?: string; ultParc?: string; ultContato?: string };
type Grupo = { chave: string; fornQ: string; forn: Forn | null; ops: Forn[]; catCod: string; parc: string; previsao: string;
  itens: (LinhaParaPc & { on: boolean })[] };

const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

async function json<T>(r: Response): Promise<T> {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
  return j as T;
}

export default function GerarPcDaLista({ empresa, codigoProjeto, linhas, onFechar, onFeito }: {
  empresa: string; codigoProjeto: number; linhas: LinhaParaPc[];
  onFechar: () => void; onFeito: (nums: string[]) => void;
}) {
  const [refs, setRefs] = useState<Refs | null>(null);
  const [grupos, setGrupos] = useState<Grupo[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // um grupo por fornecedor sugerido; previsão = o necessário mais cedo (senão hoje + 7)
  useEffect(() => {
    const m = new Map<string, Grupo>();
    for (const l of linhas) {
      const k = norm(l.fornecedor || "") || "SEM";
      const g = m.get(k) ?? { chave: k, fornQ: l.fornecedor || "", forn: null, ops: [], catCod: "", parc: "", previsao: "", itens: [] };
      g.itens.push({ ...l, on: true });
      if (l.necessario && (!g.previsao || l.necessario < g.previsao)) g.previsao = l.necessario;
      m.set(k, g);
    }
    const gs = [...m.values()].map((g) => ({ ...g, previsao: g.previsao || addDias(hoje(), 7) }));
    setGrupos(gs);
    (async () => {
      try {
        const rf = await json<Refs>(await fetch(`/api/compras/refs?emp=${encodeURIComponent(empresa)}`));
        setRefs(rf);
        // resolve o fornecedor sugerido de cada grupo no cadastro
        const resolvidos = await Promise.all(gs.map(async (g) => {
          if (!g.fornQ.trim()) return { ...g, parc: rf.parcelas[0]?.cod ?? "" };
          const ops = await json<Forn[]>(await fetch(`/api/compras/buscar?tipo=fornecedor&emp=${encodeURIComponent(empresa)}&q=${encodeURIComponent(g.fornQ.slice(0, 30))}`)).catch(() => []);
          const f = ops.find((o) => norm(o.nome) === norm(g.fornQ) || norm(o.fantasia ?? "") === norm(g.fornQ)) ?? ops[0] ?? null;
          return { ...g, forn: f, fornQ: f ? (f.fantasia || f.nome) : g.fornQ, catCod: f?.ultCatCod ?? "",
            parc: f?.ultParc && rf.parcelas.some((p) => p.cod === f.ultParc) ? f.ultParc : (rf.parcelas[0]?.cod ?? "") };
        }));
        setGrupos(resolvidos);
      } catch (e) { setErro((e as Error).message); }
    })();
  }, [linhas, empresa]);

  const setG = (i: number, patch: Partial<Grupo>) => setGrupos((gs) => gs.map((g, k) => (k === i ? { ...g, ...patch } : g)));
  const buscarForn = async (i: number, q: string) => {
    setG(i, { fornQ: q, forn: null });
    if (q.trim().length < 2) { setG(i, { ops: [] }); return; }
    const ops = await json<Forn[]>(await fetch(`/api/compras/buscar?tipo=fornecedor&emp=${encodeURIComponent(empresa)}&q=${encodeURIComponent(q.trim())}`)).catch(() => []);
    setGrupos((gs) => gs.map((g, k) => (k === i && g.fornQ === q ? { ...g, ops } : g)));
  };
  const escolherForn = (i: number, f: Forn) => setG(i, { forn: f, fornQ: f.fantasia || f.nome, ops: [],
    ...(f.ultCatCod ? { catCod: f.ultCatCod } : {}), ...(f.ultParc && refs?.parcelas.some((p) => p.cod === f.ultParc) ? { parc: f.ultParc } : {}) });

  const totalG = (g: Grupo) => Math.round(g.itens.filter((x) => x.on).reduce((a, x) => a + x.qtd * x.vu, 0) * 100) / 100;
  const ativos = useMemo(() => grupos.filter((g) => g.itens.some((x) => x.on)), [grupos]);

  const montar = () => ativos.map((g) => {
    const cat = refs?.categorias.find((c) => c.cod === g.catCod);
    const dias = refs?.parcelas.find((p) => p.cod === g.parc)?.dias ?? [0];
    const total = totalG(g);
    return {
      corpo: {
        fornCod: g.forn?.cod ?? null, forn: g.forn?.nome ?? "", cnpj: g.forn?.cnpj ?? null,
        catCod: cat?.cod ?? "", cat: cat?.desc ?? "", comprador: null, compradorCod: null,
        contaCod: null, conta: "", parc: g.parc, previsao: g.previsao, contato: g.forn?.ultContato ?? null, numForn: null, contrato: null,
        obs: null, frete: { tipo: TIPOS_FRETE[5] }, parcelas: gerarParcelas(total, dias, g.previsao || hoje()), deptos: [],
      },
      linhas: g.itens.filter((x) => x.on).map((x) => ({ lista_id: x.id, qtd: x.qtd, vu: x.vu })),
    };
  });

  const enviar = async (simular: boolean) => {
    setErro(null); setAviso(null);
    const semForn = ativos.find((g) => !g.forn);
    if (semForn) { setErro(`Escolha o fornecedor do pedido "${semForn.fornQ || "sem fornecedor"}".`); return; }
    const semCat = ativos.find((g) => !g.catCod);
    if (semCat) { setErro(`Escolha a categoria do pedido de ${semCat.fornQ}.`); return; }
    setOcupado(true);
    try {
      const j = await json<{ ok: boolean; simulado?: boolean; pedidos: { num?: string }[] }>(await fetch("/api/rc-projetos/compras", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acao: "gerar_pc", empresa, codigo: codigoProjeto, simular, grupos: montar() }) }));
      if (simular) setAviso(`Simulação ok: ${j.pedidos.length} pedido(s) de compra seriam criados, com ${ativos.reduce((a, g) => a + g.itens.filter((x) => x.on).length, 0)} linha(s). Nada foi gravado.`);
      else onFeito(j.pedidos.map((p) => String(p.num)));
    } catch (e) { setErro((e as Error).message); }
    finally { setOcupado(false); }
  };

  const inp = "w-full rounded-md border border-ww-border bg-transparent px-2 py-1 text-[12px] text-ww-text";
  return createPortal(
    <div className="fixed inset-0 z-[120] bg-black/45 flex items-end sm:items-start justify-center sm:pt-[6vh]" onMouseDown={(e) => { if (e.target === e.currentTarget) onFechar(); }}>
      <div role="dialog" aria-label="Gerar pedido de compra"
        className="w-full sm:w-[min(980px,96vw)] max-h-[90vh] overflow-auto rounded-t-xl sm:rounded-xl border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-2xl p-4 space-y-3 text-[12px]">
        <div className="flex items-start gap-2">
          <div>
            <h3 className="text-[15px] font-semibold text-ww-text">Gerar pedido de compra pela lista</h3>
            <p className="text-[11px] text-ww-textMuted">Um pedido por fornecedor. Revise preço, quantidade, categoria, condição e previsão (o “Necessário em” mais cedo de cada grupo). Numeração, aprovação e avisos são os de sempre; cada item do PC já fica ligado à linha da lista.</p>
          </div>
          <button type="button" className="ml-auto text-ww-accent hover:underline" onClick={onFechar}>fechar</button>
        </div>
        {!refs && !erro && <p className="text-ww-textFaint">Carregando categorias e condições…</p>}
        {grupos.map((g, i) => (
          <div key={g.chave} className="rounded-lg border border-ww-border p-3 space-y-2">
            <div className="grid gap-2" style={{ gridTemplateColumns: "minmax(200px,2fr) minmax(160px,1.4fr) minmax(130px,1fr) 130px" }}>
              <label className="relative space-y-0.5"><span className="text-[10.5px] text-ww-textMuted">Fornecedor</span>
                <input className={inp} value={g.fornQ} placeholder="nome, fantasia ou CNPJ" onChange={(e) => void buscarForn(i, e.target.value)} />
                {g.ops.length > 0 && (
                  <div className="absolute z-10 left-0 right-0 top-full mt-0.5 max-h-52 overflow-auto rounded-md border border-ww-border bg-[rgb(var(--color-ww-panel))] shadow-xl">
                    {g.ops.map((f) => (
                      <button key={f.cod} type="button" onClick={() => escolherForn(i, f)} className="block w-full text-left px-2 py-1 hover:bg-ww-rowHover">
                        {f.fantasia || f.nome}<span className="text-ww-textFaint">{f.cnpj ? ` · ${f.cnpj}` : ""}</span>
                      </button>))}
                  </div>)}
                {!g.forn && <span className="text-[10px] text-amber-700 dark:text-amber-300">{g.fornQ ? "escolha o fornecedor na lista" : "sem fornecedor sugerido — busque"}</span>}
              </label>
              <label className="space-y-0.5"><span className="text-[10.5px] text-ww-textMuted">Categoria</span>
                <select className={inp} value={g.catCod} onChange={(e) => setG(i, { catCod: e.target.value })}>
                  <option value="">— escolha —</option>
                  {refs?.categorias.map((c) => <option key={c.cod} value={c.cod}>{c.cod} · {c.desc}</option>)}
                </select></label>
              <label className="space-y-0.5"><span className="text-[10.5px] text-ww-textMuted">Condição</span>
                <select className={inp} value={g.parc} onChange={(e) => setG(i, { parc: e.target.value })}>
                  {refs?.parcelas.map((p) => <option key={p.cod} value={p.cod}>{p.desc}</option>)}
                </select></label>
              <label className="space-y-0.5"><span className="text-[10.5px] text-ww-textMuted">Previsão (necessário)</span>
                <input type="date" className={inp} value={g.previsao} onChange={(e) => setG(i, { previsao: e.target.value })} /></label>
            </div>
            <table className="w-full text-[11.5px]">
              <thead><tr className="text-left text-[10px] uppercase text-ww-textMuted">
                <th className="w-6" /><th>Código</th><th>Item</th><th className="text-right w-20">Qtd</th><th className="text-right w-28">Valor unit.</th><th className="text-right w-28">Total</th>
              </tr></thead>
              <tbody>{g.itens.map((x, k) => (
                <tr key={x.id} className={`border-t border-ww-border/50 ${x.on ? "" : "opacity-40"}`}>
                  <td><input type="checkbox" checked={x.on} onChange={() => setG(i, { itens: g.itens.map((y, j) => (j === k ? { ...y, on: !y.on } : y)) })} /></td>
                  <td className="font-mono text-[11px]">{x.codigo || "—"}</td>
                  <td className="truncate max-w-[340px]" title={x.item}>{x.item}</td>
                  <td><input className={`${inp} text-right`} inputMode="decimal" value={String(x.qtd)}
                    onChange={(e) => setG(i, { itens: g.itens.map((y, j) => (j === k ? { ...y, qtd: Number(e.target.value.replace(",", ".")) || 0 } : y)) })} /></td>
                  <td><input className={`${inp} text-right`} inputMode="decimal" value={String(x.vu)}
                    onChange={(e) => setG(i, { itens: g.itens.map((y, j) => (j === k ? { ...y, vu: Number(e.target.value.replace(",", ".")) || 0 } : y)) })} /></td>
                  <td className="text-right tabular-nums">{brl(x.qtd * x.vu)}</td>
                </tr>))}</tbody>
              <tfoot><tr><td colSpan={5} className="text-right text-ww-textMuted pt-1">Total do pedido</td><td className="text-right font-semibold pt-1">{brl(totalG(g))}</td></tr></tfoot>
            </table>
          </div>
        ))}
        {erro && <div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-rose-700 dark:text-rose-300">{erro}</div>}
        {aviso && <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-2 text-emerald-700 dark:text-emerald-300">{aviso}</div>}
        <div className="flex items-center gap-2 justify-end">
          <span className="mr-auto text-ww-textMuted">{ativos.length} pedido(s) · {brl(ativos.reduce((a, g) => a + totalG(g), 0))}</span>
          <button type="button" disabled={ocupado || !refs} onClick={() => void enviar(true)}
            className="px-3 py-1.5 rounded-lg border border-ww-border hover:bg-ww-rowHover disabled:opacity-40">Simular</button>
          <button type="button" disabled={ocupado || !refs || !ativos.length} onClick={() => void enviar(false)}
            className="px-3 py-1.5 rounded-lg bg-ww-accent text-white font-semibold disabled:opacity-40">
            {ocupado ? "Gravando…" : `Gerar ${ativos.length} pedido(s) de compra`}
          </button>
        </div>
      </div>
    </div>, document.body);
}

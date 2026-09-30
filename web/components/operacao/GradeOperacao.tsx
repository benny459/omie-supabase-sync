"use client";

/**
 * Tabela = planilha editável (mockup de 30/09/2026).
 *
 * Clique numa célula e digite: Enter salva e desce, Tab vai para a direita,
 * setas navegam, Esc cancela, Del limpa. Ctrl+C/Ctrl+V copia e cola —
 * inclusive blocos do Excel. Ctrl+D replica o valor da célula ativa nas
 * linhas marcadas. Recusa sem justificativa fica marcada em vermelho.
 *
 * Só são editáveis (✎) as colunas que a grade antiga já editava; as que vêm
 * do Omie (valor do PC, fornecedor, categoria, pagamento, NF) são leitura —
 * o Omie é a fonte e sobrescreveria no próximo sync.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { diasAte, dBR, isoDia, type Compra, type Pedido } from "@/lib/operacao-modelo";
import type { CAMPOS, Modulo } from "@/lib/approvals-write";
import { FinStrip, OPCOES_STATUS, RECUSAS, SeloDif } from "./TelaOperacao";

type AnyRow = Record<string, unknown>;
type Gravar = (c: Compra, campo: keyof typeof CAMPOS, valor: unknown, patch: AnyRow) => Promise<boolean>;
type Tipo = "text" | "number" | "date" | "select";
type Col = {
  k: string; l: string; g: string; w: number; al?: "r"; tipo?: Tipo;
  ro?: (c: Compra) => boolean; // leitura (por linha)
  valor: (c: Compra, p: Pedido) => string;       // valor "cru" p/ editar/copiar
  mostra?: (c: Compra, p: Pedido) => React.ReactNode;
};

const GRUPOS = ["Venda", "Requisição", "Pedido de compra", "Aprovação", "Datas", "Recebimento"];

export default function GradeOperacao({ visiveis, modulo, $, podeAprovar, podeEditar, ehAdmin, sel, setSel, setStatus, gravar, abrirDrawer, nomeId }: {
  visiveis: { p: Pedido; compras: Compra[] }[]; modulo: Modulo; $: (v: number | null) => string;
  podeAprovar: boolean; podeEditar: boolean; ehAdmin: boolean;
  sel: Set<string>; setSel: (s: Set<string>) => void;
  setStatus: (c: Compra, v: string) => void; gravar: Gravar; abrirDrawer: (k: string) => void; nomeId: (p: Pedido) => string;
}) {
  const [ocultos, setOcultos] = useState<Set<string>>(new Set());
  useEffect(() => { try { setOcultos(new Set(JSON.parse(localStorage.getItem(`op:${modulo}:gruposOcultos`) ?? "[]"))); } catch { /* */ } }, [modulo]);
  const alternarGrupo = (g: string) => setOcultos((x) => {
    const n = new Set(x); if (n.has(g)) n.delete(g); else n.add(g);
    try { localStorage.setItem(`op:${modulo}:gruposOcultos`, JSON.stringify([...n])); } catch { /* */ }
    return n;
  });

  const semEdicaoRc = !podeEditar || modulo === "pcs";
  const COLS: Col[] = useMemo(() => [
    { k: "pv", l: modulo === "pcs" ? "PC" : modulo === "projetos" ? "Projeto" : "PV/OS", g: "Venda", w: 96, ro: () => true, valor: (c, p) => nomeId(p) },
    { k: "cli", l: modulo === "pcs" ? "Fornecedor" : "Cliente", g: "Venda", w: 190, ro: () => true, valor: (c, p) => p.cliente },
    { k: "rc", l: "RC nº", g: "Requisição", w: 76, tipo: "number", ro: () => semEdicaoRc, valor: (c) => c.rcNumero },
    { k: "desc", l: "Descrição", g: "Requisição", w: 200, tipo: "text", ro: () => semEdicaoRc, valor: (c) => String(c.row.rc_descricao ?? "") },
    { k: "qtd", l: "Qtd", g: "Requisição", w: 58, al: "r", tipo: "number", ro: () => semEdicaoRc, valor: (c) => String(c.qtd) },
    { k: "unit", l: "Custo unit.", g: "Requisição", w: 108, al: "r", tipo: "number", ro: () => semEdicaoRc, valor: (c) => String(c.unit), mostra: (c) => $(c.unit) },
    { k: "val", l: "Total", g: "Requisição", w: 108, al: "r", ro: () => true, valor: (c) => String(c.rcTotal), mostra: (c) => $(c.rcTotal) },
    { k: "pc", l: "PC #", g: "Pedido de compra", w: 88, tipo: "text", ro: (c) => semEdicaoRc || (c.temPc && Number(c.row.ncod_ped) > 0),
      valor: (c) => c.pc, mostra: (c) => c.pc || <span className="ph">+ nº PC</span> },
    { k: "pcVal", l: "Valor PC", g: "Pedido de compra", w: 108, al: "r", ro: () => true, valor: (c) => (c.pcValor == null ? "" : String(c.pcValor)),
      mostra: (c) => (c.pcValor == null ? <span className="ph">—</span> : $(c.pcValor)) },
    { k: "dif", l: "PC vs RC", g: "Pedido de compra", w: 96, ro: () => true, valor: (c) => (c.dif == null ? "" : String(c.dif)), mostra: (c) => <SeloDif d={c.dif} compacto /> },
    { k: "forn", l: "Fornecedor", g: "Pedido de compra", w: 160, ro: () => true, valor: (c) => c.fornecedor },
    { k: "cat", l: "Categoria", g: "Pedido de compra", w: 96, ro: () => true, valor: (c) => c.categoria },
    { k: "pgto", l: "Pagamento", g: "Pedido de compra", w: 112, ro: () => true, valor: (c) => c.pagamento },
    { k: "st", l: "Status", g: "Aprovação", w: 160, tipo: "select", ro: (c) => !podeAprovar || !c.temPc || c.estado === "recebido",
      valor: (c) => c.statusCodigo,
      mostra: (c) => <span className={`st ${c.estado}`}>{c.estado === "sem_pc" ? "Sem PC" : c.estado === "recebido" ? "Recebido"
        : OPCOES_STATUS.find((o) => o.v === c.statusCodigo)?.l ?? c.statusCodigo}</span> },
    { k: "just", l: "Justificativa", g: "Aprovação", w: 190, tipo: "text", ro: () => !(podeAprovar || podeEditar), valor: (c) => c.justificativa },
    { k: "aprovarAte", l: "Aprovar até", g: "Aprovação", w: 92, ro: () => true, valor: (c) => dBR(c.aprovarAte) },
    { k: "prev", l: "Prev. materiais", g: "Datas", w: 128, tipo: "date", ro: (c) => !podeEditar || !c.temPc || c.estado === "recebido",
      valor: (c) => isoDia(c.prev), mostra: (c) => <span className={c.prev != null && c.estado !== "recebido" && (diasAte(c.prev) ?? 0) < 0 ? "late" : ""}>{dBR(c.prev) || <span className="ph">—</span>}</span> },
    { k: "prevSrv", l: "Prev. serviços", g: "Datas", w: 110, ro: () => true, valor: (c) => dBR(c.prevServicos) },
    { k: "lim", l: "Limite PV", g: "Datas", w: 92, ro: () => true, valor: (c, p) => dBR(p.lim) },
    { k: "nf", l: "NF fornec.", g: "Recebimento", w: 96, ro: () => true, valor: (c) => c.nfFornecedor, mostra: (c) => c.nfFornecedor || <span className="ph">—</span> },
    { k: "rec", l: "Recebido em", g: "Recebimento", w: 100, ro: () => true, valor: (c) => dBR(c.recebidoEm) },
  ], [$, modulo, nomeId, podeAprovar, podeEditar, semEdicaoRc]);
  const cols = COLS.filter((c) => !ocultos.has(c.g));

  // Linhas navegáveis (compras) e cabeçalhos de pedido.
  const [limite, setLimite] = useState(400);
  const linhas = useMemo(() => {
    const out: { p: Pedido; c: Compra }[] = [];
    for (const { p, compras } of visiveis) for (const c of compras) out.push({ p, c });
    return out.slice(0, limite);
  }, [visiveis, limite]);
  const totalLinhas = visiveis.reduce((a, x) => a + x.compras.length, 0);

  const [cel, setCel] = useState<{ r: number; c: number }>({ r: 0, c: 0 });
  const [editando, setEditando] = useState(false);
  const [rascunho, setRascunho] = useState("");
  const [sujos, setSujos] = useState<Set<string>>(new Set());
  const [pendentes, setPendentes] = useState(0);
  const [nope, setNope] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  const colAt = cols[cel.c];
  const linAt = linhas[cel.r];
  const podeEditarCel = (i: number, j: number) => {
    const l = linhas[i], col = cols[j];
    return !!(l && col && col.tipo && !(col.ro?.(l.c)));
  };

  /** Grava UMA célula. Devolve se gravou. */
  const gravarCel = useCallback(async (l: { p: Pedido; c: Compra }, col: Col, bruto: string) => {
    const v = bruto.trim();
    const c = l.c;
    const marcaSujo = () => setSujos((x) => new Set(x).add(`${c.key}:${col.k}`));
    setPendentes((n) => n + 1);
    let ok = true;
    try {
      const num = (x: string) => (x === "" ? null : Number(x.replace(/\./g, "").replace(",", ".")));
      switch (col.k) {
        case "rc": ok = await gravar(c, "rcNumero", num(v), { rc_numero: num(v) }); break;
        case "desc": ok = await gravar(c, "rcDescricao", v || null, { rc_descricao: v || null }); break;
        case "qtd": ok = await gravar(c, "rcQtd", num(v), { rc_qtd: num(v) }); break;
        case "unit": ok = await gravar(c, "rcCusto", num(v), { rc_custo: num(v) }); break;
        case "pc": ok = await gravar(c, "pc", v || null, { pc_numero_manual: v || null }); break;
        case "just": ok = await gravar(c, "justificativa", v || null, { justificativa: v || null }); break;
        case "prev": {
          const iso = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : (() => { const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; })();
          if (v && !iso) { ok = false; break; }
          ok = await gravar(c, "prevMateriais", iso || null, { nova_prev_materiais: iso || null }); break;
        }
        case "st": {
          const cod = OPCOES_STATUS.find((o) => o.v === v || o.l.toLowerCase() === v.toLowerCase())?.v;
          if (!cod || (cod === "CANCELAR_PEDIDO" && !ehAdmin)) { ok = false; break; }
          setStatus(c, cod); break;
        }
        default: ok = false;
      }
    } finally { setPendentes((n) => n - 1); }
    if (ok) marcaSujo(); else { setNope(`${c.key}:${col.k}`); setTimeout(() => setNope(null), 400); }
    return ok;
  }, [ehAdmin, gravar, setStatus]);

  const mover = useCallback((dr: number, dc: number) => {
    setCel((x) => ({ r: Math.max(0, Math.min(linhas.length - 1, x.r + dr)), c: Math.max(0, Math.min(cols.length - 1, x.c + dc)) }));
  }, [linhas.length, cols.length]);

  const iniciar = (inicial?: string) => {
    if (!linAt || !colAt || !podeEditarCel(cel.r, cel.c)) { if (linAt && colAt) { setNope(`${linAt.c.key}:${colAt.k}`); setTimeout(() => setNope(null), 400); } return; }
    setRascunho(inicial ?? colAt.valor(linAt.c, linAt.p));
    setEditando(true);
  };
  const confirmar = async (dr = 1, dc = 0) => {
    if (linAt && colAt && rascunho !== colAt.valor(linAt.c, linAt.p)) await gravarCel(linAt, colAt, rascunho);
    setEditando(false);
    mover(dr, dc);
    wrapRef.current?.focus();
  };

  // Teclado no contêiner (fora da edição).
  const onKey = async (e: React.KeyboardEvent) => {
    if (editando) return;
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === "ArrowDown") { e.preventDefault(); mover(1, 0); }
    else if (e.key === "ArrowUp") { e.preventDefault(); mover(-1, 0); }
    else if (e.key === "ArrowRight" || (e.key === "Tab" && !e.shiftKey)) { e.preventDefault(); mover(0, 1); }
    else if (e.key === "ArrowLeft" || (e.key === "Tab" && e.shiftKey)) { e.preventDefault(); mover(0, -1); }
    else if (e.key === "Enter" || e.key === "F2") { e.preventDefault(); iniciar(); }
    else if (e.key === "Delete" || e.key === "Backspace") {
      e.preventDefault();
      if (linAt && colAt && podeEditarCel(cel.r, cel.c) && colAt.k !== "st") await gravarCel(linAt, colAt, "");
    }
    else if (mod && e.key.toLowerCase() === "c") {
      if (linAt && colAt) { e.preventDefault(); void navigator.clipboard.writeText(colAt.valor(linAt.c, linAt.p)); }
    }
    else if (mod && e.key.toLowerCase() === "d") {
      e.preventDefault();
      if (!linAt || !colAt || !podeEditarCel(cel.r, cel.c)) return;
      const v = colAt.valor(linAt.c, linAt.p);
      const alvo = linhas.map((l, i) => ({ l, i })).filter(({ l, i }) => sel.has(l.c.key) && i !== cel.r && podeEditarCel(i, cel.c));
      for (const { l } of alvo) await gravarCel(l, colAt, v);
    }
    else if (!mod && e.key.length === 1) { e.preventDefault(); iniciar(colAt?.tipo === "select" || colAt?.tipo === "date" ? undefined : e.key); }
  };

  // Colar bloco (Excel/TSV) a partir da célula ativa, só em colunas editáveis.
  const onPaste = async (e: React.ClipboardEvent) => {
    if (editando) return;
    const txt = e.clipboardData.getData("text/plain");
    if (!txt) return;
    e.preventDefault();
    const bloco = txt.replace(/\r\n?/g, "\n").replace(/\n$/, "").split("\n").map((l) => l.split("\t"));
    let feitos = 0, pulados = 0;
    for (let i = 0; i < bloco.length; i++) {
      for (let j = 0; j < bloco[i].length; j++) {
        const r = cel.r + i, cc = cel.c + j;
        if (r >= linhas.length || cc >= cols.length) continue;
        if (!podeEditarCel(r, cc)) { pulados++; continue; }
        if (await gravarCel(linhas[r], cols[cc], bloco[i][j])) feitos++;
      }
    }
    if (pulados) { setNope(`${linAt?.c.key}:${colAt?.k}`); setTimeout(() => setNope(null), 400); }
    void feitos;
  };

  // Mantém a célula ativa visível.
  useEffect(() => {
    const el = wrapRef.current?.querySelector<HTMLElement>(`[data-cel="${cel.r}-${cel.c}"]`);
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [cel]);

  // Grupos visíveis e larguras para o cabeçalho duplo.
  const gruposVis = GRUPOS.map((g) => ({ g, n: cols.filter((c) => c.g === g).length })).filter((x) => x.n);
  let i = -1;
  let pedAnterior = "";

  return (
    <div>
      <div className="gbar">
        <span className="gl">Colunas:</span>
        {GRUPOS.map((g) => (
          <button key={g} className={`chip sm ${ocultos.has(g) ? "" : "on"}`} onClick={() => alternarGrupo(g)}>{g}</button>
        ))}
        <span style={{ flex: 1 }} />
        <span className={`save ${pendentes ? "busy" : ""}`}>{pendentes ? `Salvando ${pendentes}…` : "✓ Tudo salvo"}</span>
      </div>
      <div className="hint">
        <kbd>clique</kbd> seleciona · <kbd>Enter</kbd> ou digite para editar · <kbd>Tab</kbd>/<kbd>↑↓←→</kbd> navega · <kbd>Del</kbd> limpa ·{" "}
        <kbd>Ctrl+C</kbd>/<kbd>Ctrl+V</kbd> copia e cola (inclusive do Excel) · <kbd>Ctrl+D</kbd> replica o valor nas linhas marcadas ·{" "}
        <span className="lg dirty">alterado</span> <span className="lg err">pendência</span> · colunas com ✎ são editáveis; as do Omie são leitura
      </div>
      <div className="gridwrap" ref={wrapRef} tabIndex={0} onKeyDown={(e) => void onKey(e)} onPaste={(e) => void onPaste(e)}>
        <table className="grid">
          <thead>
            <tr className="gh">
              <th className="blank" style={{ width: 36 }} />
              {gruposVis.map(({ g, n }) => <th key={g} colSpan={n}>{g}</th>)}
              <th className="blank" />
            </tr>
            <tr className="ch">
              <th style={{ width: 36 }}>
                <input type="checkbox" className="cb" checked={linhas.length > 0 && linhas.every((l) => sel.has(l.c.key))}
                  onChange={(e) => setSel(e.target.checked ? new Set(linhas.map((l) => l.c.key)) : new Set())} />
              </th>
              {cols.map((c) => <th key={c.k} className={c.al === "r" ? "r" : ""} style={{ minWidth: c.w, maxWidth: c.w + 60 }}>{c.tipo ? "✎ " : ""}{c.l}</th>)}
              <th style={{ width: 90 }} />
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => {
              i++;
              const ri = i;
              const cabecalho = l.p.id !== pedAnterior;
              pedAnterior = l.p.id;
              return [
                cabecalho && (
                  <tr key={`g-${l.p.id}`} className="grp">
                    <td colSpan={cols.length + 2}>
                      <span className="stkx"><b>{nomeId(l.p)}</b> · {l.p.cliente}{l.p.lim ? ` · limite ${dBR(l.p.lim)}` : ""}
                        <span className="gfin"> <FinResumo p={l.p} $={$} /></span></span>
                    </td>
                  </tr>
                ),
                <tr key={l.c.key} className={sel.has(l.c.key) ? "sel" : ""}>
                  <td style={{ width: 36 }}>
                    <input type="checkbox" className="cb" checked={sel.has(l.c.key)}
                      onChange={() => { const n = new Set(sel); if (n.has(l.c.key)) n.delete(l.c.key); else n.add(l.c.key); setSel(n); }} />
                  </td>
                  {cols.map((col, j) => {
                    const ativa = cel.r === ri && cel.c === j;
                    const ed = !!col.tipo && !col.ro?.(l.c);
                    const k = `${l.c.key}:${col.k}`;
                    const erro = col.k === "just" && RECUSAS.has(l.c.statusCodigo) && !l.c.justificativa;
                    const cls = [col.al === "r" ? "r" : "", ed ? "ed" : "ro", sujos.has(k) ? "dirty" : "", erro ? "err" : "",
                      ativa ? "act" : "", ativa && editando ? "editing" : "", nope === k ? "nope" : ""].join(" ");
                    return (
                      <td key={col.k} data-cel={`${ri}-${j}`} className={cls} style={{ minWidth: col.w, maxWidth: col.w + 60 }}
                        title={erro ? "Recusado sem justificativa" : undefined}
                        onMouseDown={() => { if (!(ativa && editando)) { setEditando(false); setCel({ r: ri, c: j }); } }}
                        onDoubleClick={() => iniciar()}>
                        {ativa && editando ? (
                          col.tipo === "select" ? (
                            <select autoFocus value={rascunho} onChange={(e) => { setRascunho(e.target.value); }}
                              onBlur={() => void confirmar(0, 0)}
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void confirmar(1, 0); } if (e.key === "Escape") { setEditando(false); wrapRef.current?.focus(); } }}>
                              {OPCOES_STATUS.filter((o) => !o.admin || ehAdmin).map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                            </select>
                          ) : (
                            <input autoFocus className={col.al === "r" ? "r" : ""} type={col.tipo === "date" ? "date" : "text"} value={rascunho}
                              onChange={(e) => setRascunho(e.target.value)}
                              onBlur={() => { if (editando) void confirmar(0, 0); }}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") { e.preventDefault(); void confirmar(1, 0); }
                                else if (e.key === "Tab") { e.preventDefault(); void confirmar(0, e.shiftKey ? -1 : 1); }
                                else if (e.key === "Escape") { e.preventDefault(); setEditando(false); wrapRef.current?.focus(); }
                              }} />
                          )
                        ) : (col.mostra ? col.mostra(l.c, l.p) : (col.valor(l.c, l.p) || <span className="ph">—</span>))}
                      </td>
                    );
                  })}
                  <td style={{ width: 90 }}>
                    <div className="acts">
                      {l.c.estado === "pendente" && podeAprovar && (
                        <>
                          <button className="icon ok" title="Aprovar" onClick={() => setStatus(l.c, "APROVADO")}>✓</button>
                          <button className="icon" title="Recusar" onClick={() => setStatus(l.c, "NAO_APROVADO")}>✕</button>
                        </>
                      )}
                      <button className="icon" title="Todos os campos" onClick={() => abrirDrawer(l.c.key)}>⋯</button>
                    </div>
                  </td>
                </tr>,
              ];
            })}
          </tbody>
        </table>
      </div>
      {totalLinhas > limite && (
        <div style={{ textAlign: "center", margin: 12 }}>
          <button className="btn" onClick={() => setLimite((x) => x + 400)}>Mostrar mais {Math.min(400, totalLinhas - limite)} de {totalLinhas - limite} linhas</button>
        </div>
      )}
    </div>
  );
}

function FinResumo({ p, $ }: { p: Pedido; $: (v: number | null) => string }) {
  // Versão em linha do RC · PC · PV · M.B. para o cabeçalho de grupo.
  void FinStrip;
  const it = p.compras;
  const rc = it.reduce((a, c) => a + c.rcTotal, 0);
  const comPc = it.filter((c) => c.pcValor != null);
  const porPc = new Map<string, number>();
  for (const c of comPc) porPc.set(c.pc, c.pcValor ?? 0);
  const pc = [...porPc.values()].reduce((a, v) => a + v, 0);
  const rcPc = comPc.reduce((a, c) => a + c.rcTotal, 0);
  const custo = pc + it.filter((c) => c.pcValor == null).reduce((a, c) => a + c.rcTotal, 0);
  const mb = p.valorPv > 0 ? (p.valorPv - custo) / p.valorPv : null;
  const est = comPc.length < it.length;
  const cls = mb == null ? "" : mb >= 0.35 ? "good" : mb >= 0.2 ? "warn" : "bad";
  return (
    <>
      RC <b>{$(rc)}</b> · PC <b>{comPc.length ? $(pc) : "—"}</b> {comPc.length ? <SeloDif d={rcPc > 0 ? pc / rcPc - 1 : null} compacto /> : null}
      {" "}· PV <b>{$(p.valorPv)}</b> · M.B.{est ? "*" : ""} <b className={cls}>{mb == null ? "—" : `${(mb * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`}</b>
    </>
  );
}

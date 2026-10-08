// @ts-nocheck — porte direto do script do mockup "contas-a-pagar-v3" (05/10/26).
// O mockup é imperativo (innerHTML + handlers); aqui fica igual, mas:
//  · dados reais de /api/financeiro/pagar (janela venc. -180..+90 + agregados);
//  · todas as ações gravam no servidor (baixa, lote, banco programado,
//    conciliação, ignorar/desfazer, estorno) e a tela recarrega;
//  · tudo escopado no contentor (root) — nada de document.getElementById.
// O componente React (TelaPagarV3) monta o esqueleto e chama montarPagarV3.

type Opts = {
  root: HTMLElement;
  admin: boolean;
  onNovaConta: () => void;
  onFornecedor: (cod: number, emp: string) => void;
  /** Remessa ao banco (C6) dos títulos escolhidos — abre a tela "Gerar arquivo C6". */
  onRemessa: (refs: string[]) => void;
  /** Série de recorrência (editar esta / próximas / todas, encerrar, excluir). */
  onSerie: (serieId: string, ref: string) => void;
  /** Editar o título (valor, vencimento, previsão, categoria…) — EditarTituloModal (sql/80). */
  onEditar: (ref: string) => void;
};

const EMPS = ["CD", "SF", "WW"];
const EC = { CD: "#f5a524", SF: "#3b82f6", WW: "#14b8a6" };
const EN = { CD: "CDG Projetos", SF: "SafeWater", WW: "WaterWorks" };
const DAY = 864e5;
const ETAPA = { "10": "Pedido incluído", "15": "Pedido enviado", "20": "Aguardando faturamento", "40": "NF emitida (não recebida)", "60": "NF recebida (conferência)", "80": "NF recebida" };
const PST = {
  ok: { l: "Liberado", c: "b-ok", d: "Compra aprovada e NF recebida — pode pagar." },
  dir: { l: "Despesa direta", c: "b-dir", d: "Sem pedido de compra (folha, imposto, contrato). Liberado conforme categoria." },
  nf: { l: "Aguardando NF", c: "b-nf", d: "Compra aprovada, mas a NF ainda não foi recebida/conferida. Pagar só se for adiantamento combinado." },
  bloq: { l: "Não autorizada", c: "b-bloq", d: "O pedido de compra ainda não foi aprovado. Não pagar sem aprovação." },
  sempc: { l: "NF sem pedido", c: "b-sempc", d: "Título de NF-e sem pedido de compra vinculado. Vincular ou justificar antes de pagar." },
};
const PORD = ["bloq", "sempc", "nf", "ok", "dir"];
const FASE = { previsto: "Previsto (PC)", aguardando_recebimento: "Aguardando recebimento", aguardando_conferencia: "Aguardando conferência", liberado: "Liberado", bloqueado: "Bloqueado" };

export function montarPagarV3(o: Opts) {
  const root = o.root;
  const q = (id) => root.querySelector("#" + id);
  const qa = (sel) => root.querySelectorAll(sel);
  let TODAY = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) + "T00:00:00");
  let rows = [], BANKS = [], AGG = {}, PODE = { baixar: false, conciliar: false, incluir: false, editar: false }, EXCL = [];
  // Nome curto: fantasia; sem fantasia, a razão sem os termos genéricos (05/10/26 — "nomeação").
  const GEN = /^(COMERCIO|COMERCIAL|IMPORTACAO|IMPORTADORA|EXPORTACAO|E|DE|DO|DA|DOS|DAS|PRODUTOS|LTDA\.?|EIRELI|S\.?A\.?|ME|EPP|SOCIEDADE|INDUSTRIA|SERVICOS)$/i;
  function curto(razao) { const w = String(razao || "").split(/\s+/).filter(Boolean); const out = []; for (const x of w) { if (out.length >= 2 && GEN.test(x)) break; out.push(x); if (out.length >= 3) break; } return out.join(" ") || String(razao || ""); }
  let MOV = [], MOVLOAD = false, BAIXAS = [], vivo = true, carregando = true, erro = "";
  let FERIADOS = new Set();
  // Previsão (sql/73): o vencimento é do documento; a previsão é nossa e manda na agenda,
  // nos KPIs e no fluxo de caixa. r.vd = vencimento · r.d / r.dias = previsão.
  const naoUtil = (iso_) => { const d = new Date(iso_ + "T00:00:00"); return d.getDay() === 0 || d.getDay() === 6 || FERIADOS.has(iso_); };

  const S = { emp: "ALL", q: "", agMode: "dia", agHide: {}, vcEmp: "SF", vcRange: 60, vcCut: null, agSel: 0, cf: {}, cfv: {}, rkDim: "cat", rkOpen: null,
    tab: "tit", per: "hoje", st: "all", filter: null, kpi: null, sel: new Set(), sort: { k: "pst", dir: 1 }, ofxBank: null };

  const brl = (v) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const k = (v) => { const a = Math.abs(v); if (a >= 1e6) return "R$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi"; if (a >= 1e3) return "R$ " + Math.round(v / 1e3).toLocaleString("pt-BR") + " mil"; return "R$ " + Math.round(v); };
  const kk = (v) => { const a = Math.abs(v); if (a >= 1e6) return (v / 1e6).toFixed(1).replace(".", ",") + "M"; if (a >= 1e3) return Math.round(v / 1e3) + "k"; return Math.round(v) + ""; };
  const dm = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const wd = (d) => d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const sum = (a) => a.reduce((s, r) => s + r.v, 0);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const empOk = (r, e = S.emp) => e === "ALL" || r.emp === e;
  const qOk = (r) => !S.q || [r.forn, r.cat, r.proj, r.doc, r.conta, r.pc, r.nf, r.cnpj].join(" ").toLowerCase().includes(S.q);
  const open_ = () => rows.filter((r) => !r.paid);
  const isProv = (r) => r?.prv?.nat === "provisionado";
  const base = () => open_().filter((r) => empOk(r) && qOk(r));
  const badge = (s) => `<span class="bdg ${PST[s].c}">${PST[s].l}</span>`;
  const bankOf = (cod) => BANKS.find((b) => b.cod === cod);
  const bankDesc = (cod) => bankOf(cod)?.desc ?? "";
  // Contas do grupo (SF/CD/WW) — a da própria empresa primeiro (05/10/26: pagar conta da CD/WW por banco da SF gera intercompany).
  const payBanks = (e) => { const ok = BANKS.filter((b) => b.tipo !== "CX" && b.tipo !== "AD"); return [...ok.filter((b) => b.emp === e), ...ok.filter((b) => b.emp !== e)]; };
  const bankGroupsHtml = (e, cur) => { const bs = payBanks(e); const emps = [...new Set(bs.map((b) => b.emp))];
    return emps.map((x) => `<optgroup label="${x === e ? EN[x] || x : (EN[x] || x) + " — gera intercompany"}">${bs.filter((b) => b.emp === x).map((b) => `<option value="${b.cod}" ${b.cod === cur ? "selected" : ""}>${x} · ${esc(b.desc)}</option>`).join("")}</optgroup>`).join(""); };
  const interco = (r, cod) => { const bk = cod ? bankOf(cod) : null; return bk && bk.emp !== r.emp ? bk.emp : null; };
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const tip = q("tip");
  function showTip(e, h) { tip.innerHTML = h; tip.style.display = "block"; tip.style.left = Math.min(e.clientX + 14, innerWidth - 240) + "px"; tip.style.top = e.clientY + 14 + "px"; }
  function hideTip() { tip.style.display = "none"; }
  function toast(m, ruim) { const t = q("toast"); t.textContent = m; t.style.display = "block"; t.style.borderColor = ruim ? "var(--red)" : ""; clearTimeout(t._t); t._t = setTimeout(() => (t.style.display = "none"), ruim ? 7000 : 3600); }

  // ── servidor ────────────────────────────────────────────────────────────
  async function api(body) {
    const r = await fetch("/api/financeiro/pagar", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
    return j;
  }
  async function carregar() {
    try {
      // 07/10/26: uma chamada às vezes ficava presa no servidor e a tela em "Carregando" para sempre —
      // corta em 20 s e tenta de novo; na segunda falha mostra o erro (com o botão de recarregar do navegador).
      const tentar = async () => { const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 20000);
        try { return await fetch("/api/financeiro/pagar", { cache: "no-store", signal: ctl.signal }); } finally { clearTimeout(t); } };
      let r;
      try { r = await tentar(); } catch { r = await tentar().catch(() => { throw new Error("O servidor demorou para responder — recarregue a página (F5)."); }); }
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
      if (!vivo) return;
      TODAY = new Date(j.hoje + "T00:00:00");
      PODE = j.pode ?? PODE;
      BANKS = (j.banks ?? []).map((b) => ({ emp: b[0], cod: Number(b[1]), desc: b[2], tipo: b[3], saldo: Number(b[4]) || 0, dt: b[5], ofx: b[6], pend: Number(b[7]) || 0 }));
      AGG = j.agg ?? {};
      const prog = j.prog ?? {};
      const PREV = j.prev ?? {}, ENV = j.env ?? {}, SERIE = j.serie ?? {}, NOMES = j.nomes ?? {}, CATPC = j.catpc ?? {}, AJ = j.ajustes ?? {};
      EXCL = j.excl ?? []; const EX = new Set(EXCL);
      // provisionado × real (sql/141): ref → {nat, serie, ult, media3, conf}
      const PROVM = await fetch("/api/financeiro/provisao", { cache: "no-store" }).then((x) => (x.ok ? x.json() : {})).then((x) => x.provisoes ?? {}).catch(() => ({}));
      FERIADOS = new Set(j.feriados ?? []);
      const sel = new Set([...S.sel].map((i) => rows[i]?.ref).filter(Boolean));
      rows = (j.rows ?? []).map((x, i) => {
        const vd = new Date(x[2] + "T00:00:00");
        const pv = PREV[x[0]]; const d = pv && pv[0] ? new Date(pv[0] + "T00:00:00") : vd;
        const cod_cc = x[10] != null ? Number(x[10]) : null;
        const def = cod_cc && BANKS.some((b) => b.emp === x[1] && b.cod === cod_cc && b.tipo !== "CX" && b.tipo !== "AD") ? cod_cc : null;
        return { id: i, ref: x[0], emp: x[1], venc: x[2], d, dias: Math.round((d - TODAY) / DAY), v: Number(x[3]), forn: x[4], cat: x[5] ?? "", proj: x[6] ?? "",
          doc: x[7] ?? "", parc: x[8] ?? "", conta: x[9] ?? "", cod_cc, cod: x[11], apr: x[12], pc: x[13], etapa: x[14], nf: x[15], aprov: x[16], tipo: x[17],
          div: !!x[18], st: x[19], cnpj: x[20], orig: x[21], vdoc: Number(x[22]) || 0, cod_forn: x[23], fase: x[25], paid: null,
          vd, repr: !!(pv && pv[1]), env: ENV[x[0]] ?? null, serie: SERIE[x[0]] ?? null, aj: AJ[x[0]] ?? null, nfdoc: x[24] ? String(x[24]).replace(/^0+/, "") : "",
          excl: EX.has(x[0]), ...(() => { const n = NOMES[x[1] + "|" + x[23]]; const raz = (n && n[1]) || x[4] || ""; const fan = n && n[0]; const catH = !x[5] && x[13] ? CATPC[x[1] + "|" + String(x[13]).split(",")[0].trim()] : null;
            return { forn: fan || curto(raz), razao: raz, cat: x[5] || catH || "", catHer: !!catH }; })(),
          bank: prog[x[0]] != null ? Number(prog[x[0]]) : def, prv: PROVM[x[0]] ?? null };
      });
      // provisionado vencendo em ≤ 7 dias sem documento = "Aguardando NF" (entra em Bloqueados p/ pagar)
      rows.forEach((x) => { if (isProv(x) && x.dias <= 7 && x.st === "dir") x.st = "nf"; });
      S.sel = new Set(rows.filter((r) => sel.has(r.ref)).map((r) => r.id));
      if (S.ofxBank == null) {
        const cands = BANKS.filter((b) => ["CC", "CA", "PG"].includes(b.tipo));
        S.ofxBank = (cands.find((b) => b.pend > 0) ?? cands.find((b) => b.ofx) ?? cands[0])?.cod ?? null;
      }
      erro = ""; carregando = false;
    } catch (e) { erro = e.message; carregando = false; }
    render();
  }
  async function carregarMov() {
    if (!PODE.conciliar || !S.ofxBank) { MOV = []; MOVLOAD = true; return; }
    const de = iso(new Date(+TODAY - 90 * DAY));
    const r = await fetch(`/api/financeiro/pagar?mov=${S.ofxBank}&de=${de}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    MOV = (j.movimentos ?? []).map((m) => ({ ...m, v: Number(m.valor), casado: Number(m.casado) || 0, pick: null }));
    MOVLOAD = true;
  }
  async function carregarBaixas() {
    const r = await fetch("/api/financeiro/pagar?baixas=hoje", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    BAIXAS = j.baixas ?? [];
  }
  async function recarregarTudo() { await Promise.all([carregar(), carregarMov(), carregarBaixas()]); render(); }

  function seg(id, key, cb, num) {
    qa("#" + id + " button").forEach((b) => (b.onclick = () => { qa("#" + id + " button").forEach((x) => x.classList.toggle("on", x === b)); S[key] = num ? +b.dataset.v : b.dataset.v; cb && cb(); render(); }));
  }
  function setSeg(id, v) { qa("#" + id + " button").forEach((x) => x.classList.toggle("on", x.dataset.v === String(v))); }
  const weekIdx = (d) => Math.floor(d / 7);
  const weekLabel = (i) => dm(new Date(+TODAY + i * 7 * DAY)) + "–" + dm(new Date(+TODAY + (i * 7 + 6) * DAY));
  const aggSum = (key, f) => EMPS.filter((e) => S.emp === "ALL" || S.emp === e).reduce((s, e) => s + ((AGG[e] || {})[key]?.[f] || 0), 0);
  function goTable() { q("ws").scrollIntoView({ behavior: "smooth", block: "start" }); }
  function setFilter(label, f) { S.filter = { label, f }; S.kpi = null; S.tab = "tit"; S.per = "tudo"; S.st = "all"; setSeg("tPer", "tudo"); render(); goTable(); }

  /* KPIs */
  function renderKpis() {
    const b = base();
    const sets = [
      { id: "v60", l: "Vencidos · últimos 60d", f: (r) => r.dias < 0 && r.dias >= -60, cls: "red", acc: "var(--red)" },
      { id: "hoje", l: "Vence hoje", f: (r) => r.dias === 0, acc: "var(--amber)" },
      { id: "d7", l: "Próx. 7 dias", f: (r) => r.dias >= 1 && r.dias <= 7, acc: "#60a5fa" },
      { id: "d30", l: "Próx. 30 dias", f: (r) => r.dias >= 0 && r.dias <= 30, acc: "var(--sf)" },
      { id: "d90", l: "Próx. 90 dias", f: (r) => r.dias >= 0 && r.dias <= 90, acc: "var(--violet)" },
      { id: "bloq", l: "Bloqueados p/ pagar · 30d", f: (r) => r.dias >= -60 && r.dias <= 30 && ["bloq", "sempc", "nf"].includes(r.st), acc: "var(--orange)" },
      { id: "prov7", l: "Vencendo em 7 dias sem documento", f: (r) => isProv(r) && r.dias >= -60 && r.dias <= 7, acc: "#a855f7" },
    ];
    let h = "";
    for (const s of sets) {
      const a = b.filter(s.f), v = sum(a);
      const split = EMPS.map((e) => { const x = sum(a.filter((r) => r.emp === e)); return x ? `<i style="width:${(x / v) * 100}%;background:${EC[e]}"></i>` : ""; }).join("");
      let extra = "";
      if (s.id === "v60") { const old = sum(b.filter((r) => r.dias < -60)) + aggSum("v181-365", "v") + aggSum("v>365", "v"); if (old > 0) extra = `<div class="warn">+ ${k(old)} vencidos há &gt;60d</div>`; }
      if (s.id === "bloq") extra = `<div class="mini">${["bloq", "sempc", "nf"].map((x) => { const n = a.filter((r) => r.st === x).length; return n ? `<span>${PST[x].l}: <b style="color:var(--tx)">${n}</b></span>` : ""; }).join("")}</div>`;
      h += `<div class="kpi ${s.cls || ""} ${S.kpi === s.id ? "sel" : ""}" data-k="${s.id}"><div class="acc" style="background:${s.acc}"></div><div class="l">${s.l}</div><div class="v num">${k(v)}</div><div class="s">${a.length} títulos</div>${v && s.id !== "bloq" ? `<div class="split">${split}</div>` : ""}${extra}</div>`;
    }
    const el = q("kpis"); el.innerHTML = h;
    el.querySelectorAll(".kpi").forEach((n) => (n.onclick = () => { const s = sets.find((x) => x.id === n.dataset.k); if (S.kpi === s.id) { S.kpi = null; S.filter = null; render(); return; } setFilter(s.l, s.f); S.kpi = s.id; render(); }));
    q("horizon").innerHTML = `<span>Fora do horizonte (não entra nos cards):</span><span class="pill">91–180d <b class="num">${k(aggSum("f91-180", "v"))}</b></span><span class="pill">6–12 meses <b class="num">${k(aggSum("f181-365", "v"))}</b></span><span class="pill">&gt;12 meses <b class="num">${k(aggSum("f>12m", "v"))}</b> · recorrências futuras</span>`;
  }

  /* AGENDA 30 dias */
  function renderAgenda() {
    const b = base().filter((r) => r.dias >= 0 && r.dias <= 30);
    const emps = EMPS.filter((e) => S.emp === "ALL" || S.emp === e);
    q("agLegend").innerHTML = emps.map((e) => `<button data-e="${e}" class="${S.agHide[e] ? "off" : ""}"><span class="dot" style="background:${EC[e]}"></span>${e} <span class="num" style="color:var(--tx3)">${kk(sum(b.filter((r) => r.emp === e)))}</span></button>`).join("");
    qa("#agLegend button").forEach((x) => (x.onclick = () => { S.agHide[x.dataset.e] = !S.agHide[x.dataset.e]; render(); }));
    const vis = emps.filter((e) => !S.agHide[e]); const day = S.agMode === "dia"; const n = day ? 31 : 5;
    const bk = [...Array(n)].map(() => ({ by: {}, rows: [] }));
    b.filter((r) => vis.includes(r.emp)).forEach((r) => { const i = day ? r.dias : Math.min(4, weekIdx(r.dias)); bk[i].by[r.emp] = (bk[i].by[r.emp] || 0) + r.v; bk[i].rows.push(r); });
    const max = Math.max(1, ...bk.map((x) => Object.values(x.by).reduce((a, c) => a + c, 0)));
    const W = 780, H = 220, pl = 44, pr = 8, pt = 18, pb = 34, cw = (W - pl - pr) / n, bw = Math.min(day ? 16 : 70, cw * 0.72);
    const step = Math.pow(10, Math.floor(Math.log10(max))); const nice = [1, 2, 2.5, 5, 10].map((m) => m * step).find((s) => max / s <= 4) || step * 10; const top = Math.ceil(max / nice) * nice;
    let g = ""; for (let t = 0; t <= top; t += nice) { const y = pt + (H - pt - pb) * (1 - t / top); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" style="stroke:var(--line)"/><text x="${pl - 6}" y="${y + 4}" style="fill:var(--tx3)" font-size="10" text-anchor="end">${kk(t)}</text>`; }
    let cum = 0; const line = []; const tot = sum(b.filter((r) => vis.includes(r.emp))) || 1;
    bk.forEach((x, i) => {
      const X = pl + i * cw + (cw - bw) / 2; let y = H - pb; const d = new Date(+TODAY + (day ? i : i * 7) * DAY);
      if (day && (d.getDay() === 0 || d.getDay() === 6)) g += `<rect x="${pl + i * cw}" y="${pt}" width="${cw}" height="${H - pt - pb}" style="fill:var(--tx);fill-opacity:.035"/>`;
      const isSel = S.agSel === i; if (isSel) g += `<rect x="${pl + i * cw + 1}" y="${pt}" width="${cw - 2}" height="${H - pt - pb}" fill="#3b82f62a" rx="4"/>`;
      vis.forEach((e) => { const v = x.by[e] || 0; if (!v) return; const h = ((H - pt - pb) * v) / top; y -= h; g += `<rect x="${X}" y="${y}" width="${bw}" height="${Math.max(h, 1)}" fill="${EC[e]}" rx="2" opacity="${S.agSel != null && !isSel ? 0.45 : 1}"/>`; });
      const t = Object.values(x.by).reduce((a, c) => a + c, 0);
      if (t && (!day || t / top > 0.18)) g += `<text x="${X + bw / 2}" y="${y - 4}" style="fill:var(--tx2)" font-size="9.5" text-anchor="middle">${kk(t)}</text>`;
      g += `<rect class="hit" data-i="${i}" x="${pl + i * cw}" y="${pt}" width="${cw}" height="${H - pt}" fill="transparent" style="cursor:pointer"/>`;
      if (day) { if (i % 3 === 0) g += `<text x="${X + bw / 2}" y="${H - pb + 14}" style="fill:${i === 0 ? "#f59e0b" : "var(--tx3)"}" font-size="10" text-anchor="middle">${i === 0 ? "hoje" : dm(d)}</text>`; }
      else g += `<text x="${X + bw / 2}" y="${H - pb + 14}" style="fill:var(--tx2)" font-size="10.5" text-anchor="middle">Sem ${i + 1}</text><text x="${X + bw / 2}" y="${H - pb + 27}" style="fill:var(--tx3)" font-size="9.5" text-anchor="middle">${weekLabel(i)}</text>`;
      cum += t; line.push([pl + i * cw + cw / 2, pt + (H - pt - pb) * (1 - cum / tot)]);
    });
    g += `<polyline points="${line.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#a78bfa" stroke-width="1.5" stroke-dasharray="3 3" opacity=".8"/><text x="${W - pr}" y="12" fill="#a78bfa" font-size="10" text-anchor="end">--- acumulado do mês</text>`;
    const el = q("agChart"); el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`;
    el.querySelectorAll(".hit").forEach((h) => {
      const i = +h.dataset.i, x = bk[i];
      h.onmousemove = (e) => { const d = new Date(+TODAY + (day ? i : i * 7) * DAY); const t = Object.values(x.by).reduce((a, c) => a + c, 0); const bl = x.rows.filter((r) => ["bloq", "sempc", "nf"].includes(r.st)).length;
        showTip(e, `<div class="t">${day ? wd(d) + " " + dm(d) : "Semana " + (i + 1) + " · " + weekLabel(i)}</div>${vis.map((z) => `<div class="r"><span><span class="dot" style="background:${EC[z]}"></span>${z}</span><b class="num">${brl(x.by[z] || 0)}</b></div>`).join("")}<div class="r" style="border-top:1px solid var(--line2);margin-top:5px;padding-top:5px"><span>${x.rows.length} títulos${bl ? ` · <span style="color:#f59e0b">${bl} bloq.</span>` : ""}</span><b class="num">${brl(t)}</b></div>`); };
      h.onmouseleave = hideTip;
      h.onclick = () => { hideTip(); S.agSel = S.agSel === i ? null : i; render(); };
    });
    renderDay(vis, day, n);
    const wk = [0, 1, 2, 3, 4]; const cell = (e, w) => b.filter((r) => (e === "T" ? vis.includes(r.emp) : r.emp === e) && Math.min(4, weekIdx(r.dias)) === w);
    let p = `<tr><th>Empresa</th>${wk.map((w) => `<th>Sem ${w + 1}<br><span style="font-size:10px">${weekLabel(w)}</span></th>`).join("")}<th>Total 30d</th></tr>`;
    vis.forEach((e) => { p += `<tr><td><span class="emp ${e}">${e}</span> <span style="color:var(--tx2);margin-left:4px">${EN[e]}</span></td>${wk.map((w) => { const v = sum(cell(e, w)); return `<td class="c ${v ? "" : "z"}" data-e="${e}" data-w="${w}">${v ? kk(v) : "—"}</td>`; }).join("")}<td><b>${brl(sum(b.filter((r) => r.emp === e)))}</b></td></tr>`; });
    p += `<tr class="ptot"><td>Total</td>${wk.map((w) => `<td>${kk(sum(cell("T", w)))}</td>`).join("")}<td>${brl(sum(b.filter((r) => vis.includes(r.emp))))}</td></tr>`;
    const pv = q("pivot"); pv.innerHTML = p;
    pv.querySelectorAll("td.c").forEach((c) => (c.onclick = () => { const e = c.dataset.e, w = +c.dataset.w; setFilter(`${e} · Semana ${w + 1} (${weekLabel(w)})`, (r) => r.emp === e && r.dias >= 0 && r.dias <= 30 && Math.min(4, weekIdx(r.dias)) === w); }));
  }

  /* OVERVIEW DO DIA */
  function renderDay(vis, day, n) {
    const el = q("agDay");
    if (S.agSel == null || S.agSel >= n) { el.innerHTML = ""; return; }
    const i = S.agSel; const inSel = (r) => (day ? r.dias === i : r.dias >= 0 && r.dias <= 30 && Math.min(4, weekIdx(r.dias)) === i);
    const rs0 = rows.filter((r) => vis.includes(r.emp) && empOk(r) && qOk(r) && inSel(r));
    const open = rs0.filter((r) => !r.paid), paid = rs0.filter((r) => r.paid);
    const d = new Date(+TODAY + (day ? i : i * 7) * DAY);
    const ttl = day ? `${i === 0 ? "Hoje" : wd(d)} ${dm(d)}<small>${i === 0 ? wd(d) : i === 1 ? "amanhã" : "em " + i + " dias"}</small>` : `Semana ${i + 1}<small>${weekLabel(i)}</small>`;
    const lib = open.filter((r) => ["ok", "dir"].includes(r.st)), blq = open.filter((r) => !["ok", "dir"].includes(r.st)); const tot = sum(open) || 1;
    const cats = {}; open.forEach((r) => { const c = r.cat || "Sem categoria"; cats[c] = (cats[c] || 0) + r.v; });
    const topc = Object.entries(cats).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const grp = vis.map((e) => ({ e, rs: rs0.filter((r) => r.emp === e).sort((a, b) => (a.paid ? 1 : 0) - (b.paid ? 1 : 0) || a.dias - b.dias || b.v - a.v) })).filter((g) => g.rs.length);
    el.innerHTML = `<div class="dayov">
     <div class="doh">
       <div class="nav"><button id="dPrev" ${i <= 0 ? "disabled" : ""}>‹</button><span class="ttl">${ttl}</span><button id="dNext" ${i >= n - 1 ? "disabled" : ""}>›</button></div>
       <div><div class="big num">${brl(sum(open))}</div><div class="sub2">${open.length} em aberto${paid.length ? ` · ${paid.length} baixado${paid.length > 1 ? "s" : ""}` : ""}</div></div>
       <div><div class="dsplit"><i style="width:${(sum(lib) / tot) * 100}%;background:#22c55e"></i><i style="width:${(sum(blq) / tot) * 100}%;background:#f59e0b"></i></div><div class="sub2" style="margin-top:4px"><span style="color:#22c55e">liberado ${kk(sum(lib))}</span> · <span style="color:#f59e0b">bloqueado ${kk(sum(blq))}</span></div></div>
       <div class="dmeta">${vis.map((e) => { const v = sum(open.filter((r) => r.emp === e)); return v ? `<span class="chip" style="font-size:11.5px;padding:3px 9px;border-radius:999px;background:var(--bg)"><span class="dot" style="background:${EC[e]}"></span>${e} ${kk(v)}</span>` : ""; }).join("")}</div>
       <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="dTbl">Abrir na tabela</button>${PODE.baixar ? `<button class="btn ok sm" id="dPay" ${lib.length ? "" : "disabled"}>Baixar liberados (${lib.length})</button>` : ""}<button class="btn sm" id="dClose" title="Fechar">✕</button></div>
     </div>
     ${topc.length ? `<div class="dcats">${topc.map(([c, v]) => `<span class="${c === "Sem categoria" ? "nocat" : ""}">${esc(c)} <b class="num">${kk(v)}</b></span>`).join("")}</div>` : ""}
     <div class="dbody2">${grp.length ? grp.map((g) => `<div class="dg"><div class="dgh"><span class="emp ${g.e}">${g.e}</span>${EN[g.e]} · ${g.rs.length} título${g.rs.length > 1 ? "s" : ""}<b class="num">${brl(sum(g.rs.filter((r) => !r.paid)))}</b></div>
       ${g.rs.map((r) => `<div class="drow ${r.paid ? "pd" : ""}" data-id="${r.id}"><span class="sub2 num dd">${day ? "" : dm(r.d)}</span><span class="f" title="${esc(r.forn)}">${esc(r.forn)}</span><span class="m ${r.cat ? "" : "nocat"}">${esc(r.cat || "Sem categoria")}${r.pc ? " · PC " + esc(r.pc) : ""}</span>${r.paid ? '<span class="bdg b-pago">Baixado</span>' : badge(r.st)}<span class="num" style="text-align:right;font-weight:650">${brl(r.v)}</span><span style="text-align:right">${r.paid || !PODE.baixar ? "" : `<button class="btn sm">Baixar</button>`}</span></div>`).join("")}</div>`).join("") : '<div style="padding:18px;color:var(--tx3)">Nada lançado para este dia.</div>'}</div>
    </div>`;
    q("dPrev").onclick = () => { S.agSel = Math.max(0, i - 1); render(); };
    q("dNext").onclick = () => { S.agSel = Math.min(n - 1, i + 1); render(); };
    q("dClose").onclick = () => { S.agSel = null; render(); };
    q("dTbl").onclick = () => setFilter(day ? `Vencimento ${dm(d)}` : `Semana ${i + 1} (${weekLabel(i)})`, inSel);
    if (q("dPay")) q("dPay").onclick = () => { S.sel.clear(); lib.forEach((r) => S.sel.add(r.id)); openBatch(); };
    el.querySelectorAll(".drow").forEach((x) => (x.onclick = () => openDrawer(+x.dataset.id)));
  }

  /* FILTRO POR COLUNA (EXCEL) */
  const pop = q("cfPop");
  const onMouseDown = (e) => { if (pop.classList.contains("on") && !pop.contains(e.target) && !e.target.classList.contains("fbtn")) pop.classList.remove("on"); };
  document.addEventListener("mousedown", onMouseDown);
  function openCf(key, btn) {
    const rc = btn.getBoundingClientRect(); pop.style.position = "fixed"; pop.style.left = Math.min(rc.left - 10, innerWidth - 290) + "px"; pop.style.top = rc.bottom + 6 + "px";
    const sortBtns = `<div class="srt"><button data-s="1">${key === "v" ? "Menor → maior" : "A → Z"}</button><button data-s="-1">${key === "v" ? "Maior → menor" : "Z → A"}</button></div>`;
    if (key === "v") {
      pop.innerHTML = `${sortBtns}<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0"><label class="sub2">Mínimo<input type="number" id="cfMin" value="${S.cfv.min ?? ""}" placeholder="0"></label><label class="sub2">Máximo<input type="number" id="cfMax" value="${S.cfv.max ?? ""}" placeholder="∞"></label></div><div class="acts2"><button class="btn sm" id="cfClr">Limpar</button><button class="btn pri sm" id="cfOk">Aplicar</button></div>`;
    } else {
      const vals = {}; tblBase().filter((r) => cfOk(r, key)).forEach((r) => { const v = COLV[key](r); vals[v] = (vals[v] || 0) + 1; });
      const list = Object.entries(vals);
      list.sort(key === "dias" ? (a, b) => { const p = (x) => x[0].split("/").reverse().join(""); return p(a).localeCompare(p(b)); } : (a, b) => a[0].localeCompare(b[0]));
      const cur = S.cf[key];
      pop.innerHTML = `${sortBtns}<input type="text" id="cfQ" placeholder="Pesquisar ${COLN[key].toLowerCase()}…"><div class="cflist" id="cfL"><label><input type="checkbox" class="ck" id="cfAll"><span><b>(Selecionar tudo)</b></span></label>${list.map(([v, c]) => `<label data-v="${esc(v)}"><input type="checkbox" class="ck cfv" value="${esc(v)}" ${!cur || cur.has(v) ? "checked" : ""}><span title="${esc(v)}">${esc(v)}</span><small>${c}</small></label>`).join("")}</div><div class="acts2"><button class="btn sm" id="cfClr">Limpar filtro</button><button class="btn pri sm" id="cfOk">Aplicar</button></div>`;
      const boxes = () => [...pop.querySelectorAll(".cfv")].filter((b) => b.closest("label").style.display !== "none");
      const syncAll = () => { const b = boxes(); q("cfAll").checked = b.length && b.every((x) => x.checked); };
      q("cfAll").onchange = (e) => { boxes().forEach((b) => (b.checked = e.target.checked)); };
      pop.querySelectorAll(".cfv").forEach((b) => (b.onchange = syncAll));
      q("cfQ").oninput = (e) => { const qq = e.target.value.toLowerCase(); pop.querySelectorAll("#cfL label[data-v]").forEach((l) => { const m = l.dataset.v.toLowerCase().includes(qq); l.style.display = m ? "" : "none"; if (qq) l.querySelector("input").checked = m; }); syncAll(); };
      syncAll(); setTimeout(() => q("cfQ")?.focus(), 10);
    }
    pop.classList.add("on");
    pop.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { S.sort = { k: key, dir: +b.dataset.s }; pop.classList.remove("on"); renderTable(); }));
    q("cfClr").onclick = () => { if (key === "v") S.cfv = {}; else delete S.cf[key]; pop.classList.remove("on"); renderTable(); };
    q("cfOk").onclick = () => {
      if (key === "v") { const mn = q("cfMin").value, mx = q("cfMax").value; S.cfv = { min: mn === "" ? null : +mn, max: mx === "" ? null : +mx }; if (S.cfv.min == null && S.cfv.max == null) S.cfv = {}; }
      else { const all = [...pop.querySelectorAll(".cfv")]; const on = all.filter((b) => b.checked && b.closest("label").style.display !== "none").map((b) => b.value); if (on.length === all.length) delete S.cf[key]; else S.cf[key] = new Set(on); }
      pop.classList.remove("on"); renderTable();
    };
    pop.onkeydown = (e) => { if (e.key === "Enter") q("cfOk").click(); };
  }

  /* PROGRAMAÇÃO POR BANCO */
  function renderBStrip(pre) {
    const g = {}; pre.forEach((r) => { const key = r.bank ? (bankOf(r.bank)?.emp ?? r.emp) + "|" + r.bank : "none"; (g[key] = g[key] || []).push(r); });
    const cur = S.cf.bank;
    const cards = Object.entries(g).sort((a, b) => (a[0] === "none" ? -1 : b[0] === "none" ? 1 : sum(b[1]) - sum(a[1]))).map(([key, rs]) => {
      if (key === "none") return `<div class="bcard none" data-b="(sem banco)"><div class="t">⚠ Sem banco definido</div><div class="v num">${brl(sum(rs))}</div><div class="s">${rs.length} títulos — escolha o banco</div></div>`;
      const [e, cod] = key.split("|"); const bk = bankOf(+cod); const saldo = bk ? bk.saldo : 0; const lib = sum(rs.filter((r) => ["ok", "dir"].includes(r.st))); const over = lib > saldo; const nm = bk?.desc ?? cod;
      const c6 = /\bc6\b/i.test(nm) ? `<button class="btn sm" data-c6="${key}" style="margin-top:6px" title="Gerar o arquivo de pagamentos do C6 com estes títulos">Arquivo C6 ↓</button>` : "";
      return `<div class="bcard ${over ? "over" : ""} ${cur && cur.size === 1 && cur.has(nm) ? "on" : ""}" data-b="${esc(nm)}"><div class="t"><span class="emp ${e}">${e}</span>${esc(nm)}</div><div class="v num">${brl(sum(rs))}</div><div class="s">${rs.length} títulos · saldo ${kk(saldo)}${over ? " · falta " + kk(lib - saldo) : " ✓"}</div>${(() => { const ou = rs.filter((r) => r.emp !== e); if (!ou.length) return ""; const es2 = [...new Set(ou.map((r) => r.emp))].join("/"); return `<div class="s" style="color:#a78bfa">inclui ${ou.length} título${ou.length > 1 ? "s" : ""} de ${es2} · intercompany</div>`; })()}${c6}</div>`;
    }).join("");
    const el = q("bstrip"); el.innerHTML = cards ? `<span class="sub2" style="align-self:center;margin-right:2px">Programação<br>por banco</span>` + cards : "";
    el.querySelectorAll("[data-c6]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); const lst = g[b.dataset.c6] || []; if (lst.length) o.onRemessa(lst.map((r) => r.ref)); }));
    el.querySelectorAll(".bcard").forEach((c) => (c.onclick = () => { const b = c.dataset.b; if (S.cf.bank && S.cf.bank.size === 1 && S.cf.bank.has(b)) delete S.cf.bank; else S.cf.bank = new Set([b]); renderTable(); }));
  }

  /* BANCOS */
  function renderBanks() {
    const list = BANKS.filter((b) => (S.emp === "ALL" || b.emp === S.emp) && ["CC", "CA", "PG"].includes(b.tipo));
    q("banks").innerHTML = list.map((b) => `<div class="bk"><span class="emp ${b.emp}">${b.emp}</span><span class="nm">${esc(b.desc)}</span><span class="sd num ${b.saldo < 0 ? "neg" : ""}">${brl(b.saldo)}</span>
      <span class="meta"><span>${b.ofx ? "OFX até " + dm(new Date(b.ofx + "T00:00:00")) : b.dt ? "Saldo Omie " + dm(new Date(b.dt + "T00:00:00")) : "sem extrato"}</span>${b.pend ? `<span style="color:#f59e0b">${b.pend} mov. a conciliar</span>` : b.ofx ? '<span style="color:#22c55e">conciliado</span>' : ""}</span></div>`).join("") || '<div class="sub2">Nenhuma conta.</div>';
    const hoje = base().filter((r) => r.dias === 0); const lib = hoje.filter((r) => ["ok", "dir"].includes(r.st)); const saldo = list.reduce((s, b) => s + b.saldo, 0);
    q("cov").innerHTML = `<div class="row"><span>A pagar hoje · liberado</span><b class="num">${brl(sum(lib))}</b></div><div class="row"><span>A pagar hoje · bloqueado</span><b class="num" style="color:#f59e0b">${brl(sum(hoje) - sum(lib))}</b></div><div class="row"><span>Saldo nas contas acima</span><b class="num">${brl(saldo)}</b></div><div class="row" style="border-top:1px solid var(--line2);margin-top:5px;padding-top:7px"><span>Sobra após pagar o liberado</span><b class="num ${saldo - sum(lib) < 0 ? "neg" : ""}" style="font-size:15px">${brl(saldo - sum(lib))}</b></div>`;
  }

  /* VENCIDOS + RANKING */
  function vcRows() { const R = S.vcRange, E = S.vcEmp; return open_().filter((r) => r.dias < 0 && -r.dias <= R && empOk(r, E) && qOk(r)); }
  function renderVenc() {
    const R = S.vcRange, E = S.vcEmp; const all = open_().filter((r) => r.dias < 0 && empOk(r, E) && qOk(r)); const inR = all.filter((r) => -r.dias <= R);
    q("vcDesc").textContent = `Últimos ${R} dias · ${E === "ALL" ? "todas as empresas" : EN[E]} · ${inR.length} títulos · ${brl(sum(inR))}`;
    const nW = Math.ceil(R / 7); const W = 620, H = 200, pl = 40, pr = 6, pt = 14, pb = 26, cw = (W - pl - pr) / nW, bw = Math.min(28, cw * 0.7);
    const bk = [...Array(nW)].map(() => ({ v: 0, n: 0 })); inR.forEach((r) => { const w = Math.floor((-r.dias - 1) / 7); if (w < nW) { bk[w].v += r.v; bk[w].n++; } });
    const max = Math.max(1, ...bk.map((b) => b.v));
    let g = ""; [0, 0.5, 1].forEach((t) => { const y = pt + (H - pt - pb) * (1 - t); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" style="stroke:var(--line)"/><text x="${pl - 5}" y="${y + 4}" style="fill:var(--tx3)" font-size="9.5" text-anchor="end">${kk(max * t)}</text>`; });
    bk.forEach((b, j) => {
      const i = nW - 1 - j; const x = pl + i * cw + (cw - bw) / 2; const h = ((H - pt - pb) * b.v) / max; const age = j * 7; const col = age < 15 ? "#f87171" : age < 30 ? "#ef4444" : age < 60 ? "#dc2626" : "#991b1b";
      const sel = S.vcCut && S.vcCut.type === "w" && S.vcCut.j === j; const dim = S.vcCut && !sel;
      g += `<rect x="${x}" y="${H - pb - h}" width="${bw}" height="${Math.max(h, b.v ? 2 : 0)}" fill="${col}" rx="2" opacity="${dim ? 0.3 : 1}" ${sel ? 'stroke="#93c5fd" stroke-width="1.5"' : ""}/>`;
      g += `<rect class="hit" data-j="${j}" x="${pl + i * cw}" y="${pt}" width="${cw}" height="${H - pt}" fill="transparent" style="cursor:pointer"/>`;
      if (j % Math.ceil(nW / 6) === 0) g += `<text x="${x + bw / 2}" y="${H - pb + 14}" style="fill:var(--tx3)" font-size="9.5" text-anchor="middle">-${(j + 1) * 7}d</text>`;
    });
    const el = q("vcChart"); el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`;
    el.querySelectorAll(".hit").forEach((h) => {
      const j = +h.dataset.j, b = bk[j]; const a = new Date(+TODAY - (j + 1) * 7 * DAY), z = new Date(+TODAY - (j * 7 + 1) * DAY);
      h.onmousemove = (e) => showTip(e, `<div class="t">Venceu ${dm(a)}–${dm(z)}</div><div class="r"><span>${b.n} títulos</span><b class="num">${brl(b.v)}</b></div><div style="color:var(--tx3);margin-top:4px;font-size:11px">clique para recortar o ranking</div>`);
      h.onmouseleave = hideTip;
      h.onclick = () => { hideTip(); S.vcCut = S.vcCut && S.vcCut.type === "w" && S.vcCut.j === j ? null : { type: "w", j, label: `venceu ${dm(a)}–${dm(z)}`, f: (r) => r.dias <= -(j * 7 + 1) && r.dias >= -(j + 1) * 7 }; S.rkOpen = null; render(); };
    });
    const B = [["1–15 dias", 1, 15], ["16–30 dias", 16, 30], ["31–60 dias", 31, 60], ["61–90 dias", 61, 90], ["91–180 dias", 91, 180]];
    const ag = B.map(([l, a, z]) => { const s = all.filter((r) => -r.dias >= a && -r.dias <= z); return { l, a, z, v: sum(s), n: s.length }; });
    const ee = E === "ALL" ? EMPS : [E];
    ag.push({ l: "181–365 dias", a: 181, z: 365, agg: 1, v: ee.reduce((s, e) => s + ((AGG[e] || {})["v181-365"]?.v || 0), 0), n: ee.reduce((s, e) => s + ((AGG[e] || {})["v181-365"]?.n || 0), 0) },
      { l: "> 1 ano", a: 366, z: 1e9, agg: 1, v: ee.reduce((s, e) => s + ((AGG[e] || {})["v>365"]?.v || 0), 0), n: ee.reduce((s, e) => s + ((AGG[e] || {})["v>365"]?.n || 0), 0) });
    const mx = Math.max(1, ...ag.map((x) => x.v)); const cols = ["#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d", "#5b1414"];
    q("aging").innerHTML = ag.map((x, i) => `<div class="ag ${x.z <= R ? "" : "old"} ${S.vcCut && S.vcCut.type === "a" && S.vcCut.i === i ? "sel" : ""}" data-i="${i}"><span class="lab">${x.l}</span><span class="bt"><i style="width:${(x.v / mx) * 100}%;background:${cols[i]}"></i></span><span class="num" style="text-align:right;font-weight:600">${k(x.v)}</span><span class="cnt num">${x.n}</span></div>`).join("");
    qa("#aging .ag").forEach((n) => (n.onclick = () => {
      const i = +n.dataset.i, x = ag[i];
      if (x.agg) { toast(`${x.n} títulos de ${x.l}: fora da janela carregada (180 dias) — veja na tela clássica (link no rodapé)`); return; }
      if (x.z > R) { const nr = [30, 60, 90, 180].find((v) => v >= x.z); if (nr) { S.vcRange = nr; setSeg("vcRange", nr); } }
      S.vcCut = S.vcCut && S.vcCut.type === "a" && S.vcCut.i === i ? null : { type: "a", i, label: `vencidos ${x.l}`, f: (r) => -r.dias >= x.a && -r.dias <= x.z }; S.rkOpen = null; render();
    }));
    const old = ag.filter((x) => x.a > 60); const ov = old.reduce((s, x) => s + x.v, 0), on = old.reduce((s, x) => s + x.n, 0);
    q("vcAlert").innerHTML = ov > 0 ? `<div class="alert"><span><b>${k(ov)}</b> em ${on} títulos vencidos há mais de 60 dias. Provável pagamento sem baixa — confira com o OFX.</span><button id="limpa">Listar para baixa</button></div>` : "";
    const lb = q("limpa"); if (lb) lb.onclick = () => setFilter(`Vencidos >60d · ${E === "ALL" ? "Todas" : E}`, (r) => empOk(r, E) && r.dias < -60);
    renderRank();
  }
  const DIM = { cat: { l: "Categoria", g: (r) => r.cat || "(Sem categoria)" }, forn: { l: "Fornecedor", g: (r) => r.forn }, proj: { l: "Projeto", g: (r) => r.proj || "(Sem projeto)" }, pst: { l: "Status pgto", g: (r) => PST[r.st].l } };
  function renderRank() {
    let a = vcRows(); if (S.vcCut) a = a.filter(S.vcCut.f);
    q("rkFilter").innerHTML = S.vcCut ? `<span class="fchip">Recorte: ${esc(S.vcCut.label)}<button id="cutX">×</button></span>` : "Clique numa barra ou faixa ao lado para recortar";
    const cx = q("cutX"); if (cx) cx.onclick = () => { S.vcCut = null; render(); };
    const D = DIM[S.rkDim]; const g = {}; a.forEach((r) => { const n = D.g(r); (g[n] = g[n] || []).push(r); });
    const list = Object.entries(g).map(([n, rs]) => ({ n, rs, v: sum(rs) })).sort((x, y) => y.v - x.v); const mx = Math.max(1, ...list.map((x) => x.v)); const tot = sum(a) || 1;
    q("rank").innerHTML = list.map((x) => {
      const open = S.rkOpen === x.n; const miss = x.n.startsWith("(Sem");
      const bars = EMPS.map((e) => { const v = sum(x.rs.filter((r) => r.emp === e)); return v ? `<i style="width:${(v / mx) * 100}%;background:${EC[e]}"></i>` : ""; }).join("");
      const its = x.rs.slice().sort((p, qq) => qq.v - p.v);
      return `<div class="rk ${open ? "open" : ""}" data-n="${esc(x.n)}"><div class="rkh"><span class="nm">${esc(x.n)}${miss ? '<span class="flag">CLASSIFICAR</span>' : ""}<small>${x.rs.length} título${x.rs.length > 1 ? "s" : ""} · ${((x.v / tot) * 100).toFixed(0)}%</small></span><span class="vv num">${brl(x.v)}</span><span class="car">›</span><span class="rkb">${bars}</span></div>
      <div class="rkd">${its.slice(0, 12).map((r) => `<div class="li" data-id="${r.id}"><span class="emp ${r.emp}">${r.emp}</span><span class="num neg">${dm(r.d)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S.rkDim === "forn" ? r.cat || "Sem categoria" : r.forn)}</span>${badge(r.st)}<span class="num" style="text-align:right;font-weight:600">${brl(r.v)}</span></div>`).join("")}
      <div style="display:flex;justify-content:space-between;margin-top:8px"><span class="sub2">${its.length > 12 ? "+ " + (its.length - 12) + " títulos" : ""}</span><button class="link" data-go>Abrir na tabela de pagamentos →</button></div></div></div>`;
    }).join("") || '<div style="color:var(--tx3);padding:12px">Nenhum vencido neste recorte.</div>';
    qa("#rank .rk").forEach((n) => {
      const nm = n.dataset.n;
      n.querySelector(".rkh").onclick = () => { S.rkOpen = S.rkOpen === nm ? null : nm; renderRank(); };
      n.querySelectorAll(".li").forEach((l) => (l.onclick = () => openDrawer(+l.dataset.id)));
      n.querySelector("[data-go]").onclick = () => { const E = S.vcEmp, R = S.vcRange, cut = S.vcCut; setFilter(`${D.l}: ${nm} · vencidos ${R}d${cut ? " · " + cut.label : ""} · ${E === "ALL" ? "Todas" : E}`, (r) => r.dias < 0 && -r.dias <= R && empOk(r, E) && (!cut || cut.f(r)) && D.g(r) === nm); };
    });
  }

  /* TABELA DE PAGAMENTOS */
  const PER = { hoje: (r) => r.dias === 0, venc: (r) => r.dias < 0 && r.dias >= -60, amanha: (r) => r.dias === 1, d7: (r) => r.dias >= 0 && r.dias <= 7, d30: (r) => r.dias >= 0 && r.dias <= 30, tudo: (r) => r.dias >= -60 && r.dias <= 30 };
  // Com busca digitada o período não corta: procurar "Anderson" acha também o vencido antigo e o de longo prazo (07/10/26).
  function tblBase() { const a = base(); return S.filter ? a.filter(S.filter.f) : S.q ? a : a.filter(PER[S.per]); }
  // Histórico da busca (servidor): pagos, cancelados e vencidos fora da janela carregada.
  let HIST = { q: "", itens: [], carregando: false }, histT = 0;
  function buscarHist() {
    clearTimeout(histT);
    const termo = S.q;
    if (termo.length < 3) { HIST = { q: "", itens: [], carregando: false }; renderBusca(); return; }
    HIST = { q: termo, itens: [], carregando: true }; renderBusca();
    histT = setTimeout(async () => {
      try {
        const r = await fetch(`/api/financeiro/pagar?buscar=${encodeURIComponent(termo)}`, { cache: "no-store" });
        const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
        if (S.q === termo) { HIST = { q: termo, itens: j.itens ?? [], carregando: false }; renderBusca(); }
      } catch (e) { if (S.q === termo) { HIST = { q: termo, itens: [], carregando: false, erro: e.message }; renderBusca(); } }
    }, 350);
  }
  function renderBusca() {
    const tb = q("tbl"); if (!tb) return;
    let el = q("tblHist");
    if (!el) { el = document.createElement("div"); el.id = "tblHist"; (tb.closest(".tbl") || tb).insertAdjacentElement("afterend", el); }
    if (!HIST.q) { el.innerHTML = ""; return; }
    if (HIST.carregando) { el.innerHTML = `<div class="sub2" style="padding:12px 4px">Procurando “${esc(HIST.q)}” em todos os títulos (pagos e vencidos)…</div>`; return; }
    if (HIST.erro) { el.innerHTML = `<div class="sub2" style="padding:12px 4px;color:#f87171">Busca no histórico falhou: ${esc(HIST.erro)}</div>`; return; }
    const abertos = new Set(rows.filter((r) => !r.paid).map((r) => r.ref));
    // Ordem útil (07/10/26): vencidos, depois pagos do mais recente ao mais antigo, depois os futuros, cancelados por último.
    const ORD = { atrasado: 0, pago: 1, aberto: 2, cancelado: 3 };
    const it = HIST.itens.filter((x) => !abertos.has(x.ref) && empOk({ emp: x.emp })).sort((a, b) =>
      (ORD[a.situacao] ?? 9) - (ORD[b.situacao] ?? 9)
      || (a.situacao === "aberto" ? String(a.venc).localeCompare(String(b.venc)) : String(b.pago_em || b.venc).localeCompare(String(a.pago_em || a.venc))));
    const foraEmp = S.emp !== "ALL" ? HIST.itens.filter((x) => !abertos.has(x.ref) && x.emp !== S.emp).length : 0;
    const filtros = `<div class="sub2" style="margin:0 4px 8px">Filtros: busca “${esc(HIST.q)}” em <b>todos os períodos</b> (o período fica de lado enquanto há busca) · empresa <b>${S.emp === "ALL" ? "todas" : esc(S.emp)}</b>${foraEmp ? ` — <span style="color:#f59e0b">${foraEmp} título(s) de outras empresas escondidos; escolha “Todas” para ver</span>` : ""}${nActive() ? ` · <span style="color:#f59e0b">${nActive()} filtro(s) de coluna na lista acima</span>` : ""}</div>`;
    const SIT = { pago: ["Pago", "#22c55e"], atrasado: ["Vencido", "#f87171"], aberto: ["Em aberto", "#cbd5e1"], cancelado: ["Cancelado", "#94a3b8"] };
    const dbr = (s) => (s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—");
    el.innerHTML = `<div style="margin-top:18px"><div style="display:flex;gap:10px;align-items:baseline;margin:0 4px 8px"><b>Histórico de “${esc(HIST.q)}”</b><span class="sub2">${it.length} título(s) fora da lista acima — pagos, cancelados e vencidos antigos · ${brl(it.reduce((s, x) => s + Number(x.valor || 0), 0))}${HIST.itens.length >= 400 ? " · mostrando os 400 mais próximos de hoje" : ""}</span></div>${filtros}
      ${it.length ? `<div class="tbl" style="max-height:520px"><table class="num"><thead><tr><th>Vencimento</th><th>Emp.</th><th>Fornecedor</th><th>Categoria</th><th>Documento</th><th>Situação</th><th class="r">Valor</th><th class="r">Saldo</th></tr></thead><tbody>${it.map((x) => { const s = SIT[x.situacao] || [x.situacao, "#cbd5e1"];
        return `<tr><td>${dbr(x.venc)}</td><td><span class="emp ${esc(x.emp)}">${esc(x.emp)}</span></td><td style="font-weight:500">${esc(x.forn)}</td><td style="color:var(--tx2)">${esc(x.cat || "Sem categoria")}</td><td class="mono">${esc(x.doc || "—")}${x.parc ? ` <span class="sub2">· ${esc(x.parc)}</span>` : ""}</td><td><span style="color:${s[1]};font-weight:600">${s[0]}</span>${x.situacao === "pago" && x.pago_em ? `<div class="sub2">em ${dbr(x.pago_em)}</div>` : ""}</td><td class="r">${brl(Number(x.valor || 0))}</td><td class="r">${Number(x.saldo) > 0.004 ? brl(Number(x.saldo)) : "—"}</td></tr>`; }).join("")}</tbody></table></div>` : `<div class="sub2" style="padding:4px">Nada além do que está na lista acima.</div>`}</div>`;
  }
  const nfLbl = (r) => (r.etapa ? (["60", "80"].includes(r.etapa) ? "Recebida" : r.etapa === "40" ? "Emitida" : "Sem NF") : r.tipo === "NFE" ? "NF-e (sem PC)" : "—");
  const COLV = { dias: (r) => r.d.toLocaleDateString("pt-BR"), emp: (r) => r.emp, forn: (r) => r.forn, cat: (r) => r.cat || "Sem categoria", pc: (r) => (r.pc ? "PC " + r.pc : "(sem PC)"), etapa: nfLbl, pst: (r) => PST[r.st].l, conta: (r) => r.conta, bank: (r) => (r.bank ? bankDesc(r.bank) : "(sem banco)") };
  const COLN = { dias: "Previsão", emp: "Empresa", forn: "Fornecedor", cat: "Categoria", pc: "Compra", etapa: "NF", pst: "Pagamento", conta: "Conta prevista", bank: "Banco p/ pagar", v: "Valor" };
  function cfOk(r, ex) { for (const kk2 in S.cf) { if (kk2 === ex) continue; if (!S.cf[kk2].has(COLV[kk2](r))) return false; } if (ex !== "v") { const { min, max } = S.cfv; if (min != null && r.v < min) return false; if (max != null && r.v > max) return false; } return true; }
  const nActive = () => Object.keys(S.cf).length + (S.cfv.min != null || S.cfv.max != null ? 1 : 0);
  function tblRows() { return tblBase().filter((r) => cfOk(r)); }
  let tblAtual = [];
  // Aviso: títulos que já não existem no Omie (refeitos/excluídos lá) e ainda aparecem como abertos (sql/75).
  function renderExcl() {
    const el = q("exclBox"); if (!el) return;
    const ex = rows.filter((r) => r.excl && !r.paid);
    if (!ex.length) { el.innerHTML = ""; return; }
    const tot = ex.reduce((s, r) => s + r.v, 0);
    el.innerHTML = `<div style="margin:8px 0;padding:10px 12px;border:1px solid rgba(239,68,68,.45);border-radius:10px;background:rgba(239,68,68,.08);display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12.5px">
      <b style="color:#f87171">${ex.length} título(s) · ${brl(tot)}</b><span>já não existem no Omie (foram refeitos ou excluídos lá) e ainda aparecem aqui — <b>não pagar</b>. Estão marcados "Excluído no Omie" na coluna Pagamento.</span>
      <span style="margin-left:auto"></span><button class="btn sm" id="exFil">Mostrar só esses</button>${PODE.incluir ? '<button class="btn sm" id="exMar" title="Tira-os do contas a pagar (reversível)">Tirar todos do contas a pagar</button>' : ""}</div>`;
    q("exFil").textContent = S.exOnly ? "Mostrar todos" : "Mostrar só esses";
    q("exFil").onclick = () => { S.exOnly = !S.exOnly; renderTable(); };
    if (q("exMar")) q("exMar").onclick = async () => {
      if (!confirm(`Tirar ${ex.length} título(s) (${brl(tot)}) do contas a pagar? Eles já não existem no Omie. Dá para desfazer.`)) return;
      try { const j = await api({ acao: "excluidos_marcar", refs: ex.map((r) => r.ref) }); toast(`${j.n} título(s) retirados (excluídos no Omie)`); await recarregarTudo(); } catch (e) { toast(e.message, true); }
    };
  }

  function renderTable() {
    renderExcl();
    const pre = tblRows();
    const cnt = (x) => pre.filter((r) => r.st === x).length;
    const nProv = pre.filter(isProv).length, nProv7 = pre.filter((x) => isProv(x) && x.dias <= 7).length;
    q("tSt").innerHTML = `<button data-v="all" class="${S.st === "all" ? "on" : ""}">Todos<span class="c">${pre.length}</span></button>` + ["ok", "dir", "nf", "sempc", "bloq"].map((x) => (cnt(x) ? `<button data-v="${x}" class="${S.st === x ? "on" : ""}"><span class="dot" style="background:${{ ok: "#4ade80", dir: "#cbd5e1", nf: "#fbbf24", sempc: "#fdba74", bloq: "#f87171" }[x]}"></span>${PST[x].l}<span class="c">${cnt(x)}</span></button>` : "")).join("")
      + (nProv ? `<button data-v="prov" class="${S.st === "prov" ? "on" : ""}" title="Recorrências e contas estimadas ainda sem documento"><span class="dot" style="background:#a855f7"></span>Provisionados<span class="c">${nProv}</span></button>` : "")
      + (nProv7 ? `<button data-v="prov7" class="${S.st === "prov7" ? "on" : ""}"><span class="dot" style="background:#a855f7"></span>Provisionados vencendo em 7d<span class="c">${nProv7}</span></button>` : "");
    qa("#tSt button").forEach((b) => (b.onclick = () => { S.st = b.dataset.v; renderTable(); }));
    const a0 = S.st === "all" ? pre : S.st === "prov" ? pre.filter(isProv) : S.st === "prov7" ? pre.filter((x) => isProv(x) && x.dias <= 7) : pre.filter((r) => r.st === S.st);
    const a = S.exOnly ? a0.filter((r) => r.excl) : a0;
    const { k: sk, dir } = S.sort;
    a.sort((x, y) => { let p, qq; if (sk === "pst") { p = PORD.indexOf(x.st); qq = PORD.indexOf(y.st); if (p === qq) return y.v - x.v; } else if (sk === "bank") { p = bankDesc(x.bank); qq = bankDesc(y.bank); } else { p = x[sk]; qq = y[sk]; } return (typeof p === "number" ? p - qq : String(p ?? "").localeCompare(String(qq ?? ""))) * dir; });
    tblAtual = a;
    const na = nActive();
    q("fchip").innerHTML = (S.filter ? `<span class="fchip">${esc(S.filter.label)}<button id="clr">×</button></span> ` : "") + Object.keys(S.cf).map((kx) => `<span class="fchip">${COLN[kx]}: ${S.cf[kx].size === 1 ? esc([...S.cf[kx]][0]) : S.cf[kx].size + " valores"}<button data-cfx="${kx}">×</button></span> `).join("") + (S.cfv.min != null || S.cfv.max != null ? `<span class="fchip">Valor ${S.cfv.min != null ? "≥ " + kk(S.cfv.min) : ""} ${S.cfv.max != null ? "≤ " + kk(S.cfv.max) : ""}<button data-cfx="v">×</button></span> ` : "") + (na || S.filter || S.st !== "all" ? `<button class="clrall" id="clrAll">Limpar filtros${na + (S.filter ? 1 : 0) + (S.st !== "all" ? 1 : 0) > 1 ? " (" + (na + (S.filter ? 1 : 0) + (S.st !== "all" ? 1 : 0)) + ")" : ""}</button>` : "");
    qa("[data-cfx]").forEach((b) => (b.onclick = () => { const kx = b.dataset.cfx; if (kx === "v") S.cfv = {}; else delete S.cf[kx]; renderTable(); }));
    const ca = q("clrAll"); if (ca) ca.onclick = () => { S.cf = {}; S.cfv = {}; S.filter = null; S.kpi = null; S.st = "all"; render(); };
    const c = q("clr"); if (c) c.onclick = () => { S.filter = null; S.kpi = null; render(); };
    const show = a.slice(0, 400); const allSel = show.length && show.every((r) => S.sel.has(r.id));
    const H = [["", "", 0], ["dias", "Previsão", 0], ["emp", "Emp.", 0], ["forn", "Fornecedor", 0], ["cat", "Categoria", 0], ["pc", "Compra", 0], ["etapa", "NF", 0], ["pst", "Pagamento", 0], ["bank", "Banco p/ pagar", 0], ["v", "Valor", 1], ["", "", 0]];
    q("tbl").innerHTML = `<thead><tr>${H.map(([key, l, r], i) => (i === 0 ? `<th style="width:30px;cursor:default">${PODE.baixar ? `<input type="checkbox" class="ck" id="ckAll" ${allSel ? "checked" : ""}>` : ""}</th>` : `<th class="${r ? "r" : ""}" ${key ? `data-k="${key}"` : ""}>${l}${sk === key && key ? (dir > 0 ? " ↑" : " ↓") : ""}${key ? `<button class="fbtn ${(key === "v" ? S.cfv.min != null || S.cfv.max != null : !!S.cf[key]) ? "on" : ""}" data-f="${key}" title="Filtrar">▾</button>` : ""}</th>`)).join("")}</tr></thead><tbody>${show.map((r) => {
      const compra = r.pc ? `<span class="mono">PC ${esc(r.pc)}</span><div class="sub2">${r.fase ? esc(FASE[r.fase] ?? r.fase) : r.apr === "PENDENTE" || !r.apr ? '<span style="color:#f87171">aprovação pendente</span>' : r.apr === "APROVADO_FAT_DIRETO" ? "aprovado · fat. direto" : "aprovado" + (r.aprov ? " · " + esc(String(r.aprov).split("@")[0]) : "")}</div>` : '<span class="sub2">—</span>';
      const nf = r.etapa ? `<span style="color:${["60", "80"].includes(r.etapa) ? "#22c55e" : "#f59e0b"}">${["60", "80"].includes(r.etapa) ? "Recebida" : r.etapa === "40" ? "Emitida" : "Sem NF"}</span>${r.nfdoc || r.nf ? `<div class="sub2 mono" title="${esc(r.nf ? "NFs do PC: " + r.nf : "")}">NF ${esc(r.nfdoc || String(r.nf).split(",")[0].replace(/^0+/, ""))}${r.parc ? " · parc " + esc(r.parc) : ""}</div>` : ""}` : r.tipo === "NFE" ? '<span class="sub2">NF-e (sem PC)</span>' : '<span class="sub2">—</span>';
      const pv = r.prv, prov = isProv(r);
      const pvSub = pv && pv.serie ? `<div class="sub2">${prov ? "recorrência " + esc(pv.serie) : ""}${pv.ult ? `${prov ? " · " : ""}último real: NF ${esc(String(pv.ult.nf || "—").replace(/^0+(?=\d)/, ""))} · ${dm(new Date(String(pv.ult.data).slice(0, 10) + "T00:00:00"))}` : ""}</div>` : "";
      return `<tr data-id="${r.id}" class="${S.sel.has(r.id) ? "sel" : ""} ${prov ? "row-prov" : ""}"><td>${PODE.baixar ? `<input type="checkbox" class="ck" data-id="${r.id}" ${S.sel.has(r.id) ? "checked" : ""}>` : ""}</td>
      <td class="${r.dias < 0 ? "od" : r.dias === 0 ? "td" : ""}">${dm(r.d)} <span class="sub2">${r.dias < 0 ? r.dias + "d" : r.dias === 0 ? "hoje" : "+" + r.dias + "d"}</span>${+r.d !== +r.vd || r.repr ? `<div class="sub2" title="Vencimento do documento${r.repr ? " · previsão reprogramada" : ""}">venc ${dm(r.vd)}${r.repr ? ' · <span style="color:#a78bfa">reprog.</span>' : ""}</div>` : ""}</td>
      <td><span class="emp ${r.emp}">${r.emp}</span></td><td title="${esc(r.razao || r.forn)}" style="font-weight:500">${esc(r.forn)}${r.razao && r.razao !== r.forn ? `<div class="sub2" style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.razao)}</div>` : ""}${pvSub}</td><td class="${r.cat ? "" : "nocat"}" style="color:var(--tx2)" title="${r.catHer ? "Categoria herdada do pedido de compra" : ""}">${esc(r.cat || "Sem categoria")}${r.catHer ? '<div class="sub2">do PC</div>' : ""}</td>
      <td>${compra}</td><td>${nf}</td><td>${r.excl ? '<span class="bdg b-bloq" title="Este título já não existe no Omie (foi refeito/excluído lá) — não pagar">Excluído no Omie</span>' : badge(r.st)}${prov ? '<div style="margin-top:4px"><span class="bdg b-prov" title="Valor estimado — ainda sem NF/boleto. Confirme com o documento quando chegar.">◌ PROVISIONADO</span>' + (pv?.sug && PODE.editar ? `<div style="margin-top:4px"><button class="sugnf" data-sug="${r.id}" title="NF recebida do mesmo CNPJ, emitida em ${esc(String(pv.sug.emissao).split("-").reverse().join("/"))} · ${brl(Number(pv.sug.valor))}${Number(pv.sug.dif_pct) > 0 ? " · " + pv.sug.dif_pct + "% de diferença" : ""}">✦ ${pv.sug.tipo === "NFSE" ? "NFS-e" : "NF-e"} ${esc(pv.sug.numero)} encontrada — confirmar?</button></div>` : "") + '</div>' : pv?.conf ? `<div style="margin-top:4px"><span class="bdg b-real" title="Confirmado com documento no painel">✓ REAL</span> <span class="sub2">${esc(pv.conf.doc)}${pv.conf.emissao ? " · emitida " + esc(String(pv.conf.emissao).slice(0, 10).split("-").reverse().join("/")) : ""}</span>${Math.abs(Number(pv.conf.valor_prov) - r.vdoc) > 0.01 ? `<div class="sub2">provisão era ${brl(Number(pv.conf.valor_prov))}</div>` : ""}</div>` : ""}</td><td><select class="bsel ${r.bank ? (r.bank !== r.cod_cc ? "chg" : "") : "need"}" data-bk="${r.id}" title="Conta prevista no Omie: ${esc(r.conta)}" ${PODE.baixar ? "" : "disabled"}><option value="">Escolher banco…</option>${bankGroupsHtml(r.emp, r.bank)}</select>${interco(r, r.bank) ? `<div class="sub2" style="color:#a78bfa" title="Título da ${r.emp} pago por conta da ${interco(r, r.bank)} — fica registado como intercompany">pago pela ${interco(r, r.bank)}</div>` : ""}${r.env ? `<div class="sub2" style="color:#38bdf8" title="Arquivo de remessa #${r.env.id} gerado em ${new Date(r.env.em).toLocaleString("pt-BR")}">↗ enviado ${esc(r.env.banco)} · pagto ${dm(new Date(r.env.data + "T00:00:00"))}</div>` : ""}</td><td class="r" style="font-weight:650${prov ? ";color:#a855f7" : ""}">${brl(r.v)}${prov && pv?.media3 ? `<div class="sub2">média 3 últimas ${brl(Number(pv.media3))}</div>` : ""}${r.aj?.novo?.valor != null ? `<div class="sub2" title="Valor ajustado no painel">ajustado · orig. ${brl(Number(r.aj.orig?.valor ?? 0))}</div>` : ""}</td>
      <td class="r" style="white-space:nowrap">${prov && PODE.editar ? `<button class="btn sm pri" data-cf="${r.id}" title="Informar a NF/boleto e o valor real">Confirmar com NF</button> ` : ""}${pv?.conf && PODE.editar ? `<button class="btn sm" data-desf="${r.id}" title="Desfazer a confirmação (volta a provisionado)">desfazer</button> ` : ""}${PODE.editar ? `<button class="btn sm" data-ed="${r.id}" title="Editar título (valor, vencimento, categoria…)">✎</button> ` : ""}${PODE.baixar ? `<button class="btn sm" data-bx="${r.id}">Baixar</button>` : ""}</td></tr>`;
    }).join("")}</tbody>`;
    qa("#tbl tbody tr").forEach((tr) => (tr.onclick = (e) => { if (e.target.classList.contains("ck") || e.target.tagName === "SELECT" || e.target.tagName === "OPTION") return; openDrawer(+tr.dataset.id); }));
    qa("#tbl [data-ed]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); o.onEditar(rows[+b.dataset.ed].ref); }));
    qa("#tbl [data-cf]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); abrirConfirmar(rows[+b.dataset.cf]); }));
    qa("#tbl [data-sug]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); const r = rows[+b.dataset.sug]; abrirConfirmar(r, r?.prv?.sug); }));
    qa("#tbl [data-desf]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); desfazerConf(rows[+b.dataset.desf]); }));
    qa("#tbl tbody .ck").forEach((cx) => (cx.onchange = () => { const id = +cx.dataset.id; cx.checked ? S.sel.add(id) : S.sel.delete(id); cx.closest("tr").classList.toggle("sel", cx.checked); renderAbar(); }));
    const ckAll = q("ckAll"); if (ckAll) ckAll.onchange = (e) => { show.forEach((r) => (e.target.checked ? S.sel.add(r.id) : S.sel.delete(r.id))); renderTable(); };
    qa("#tbl .bsel").forEach((x) => { x.onclick = (e) => e.stopPropagation(); x.onchange = () => programar([rows[+x.dataset.bk]], x.value ? +x.value : null); });
    renderBStrip(pre);
    qa("#tbl .fbtn").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openCf(b.dataset.f, b); }));
    qa("#tbl th[data-k]").forEach((h) => (h.onclick = () => { const key = h.dataset.k; S.sort = S.sort.k === key ? { k: key, dir: -S.sort.dir } : { k: key, dir: key === "v" ? -1 : 1 }; renderTable(); }));
    q("tblFoot").textContent = `${a.length} títulos · ${brl(sum(a))} · liberados ${brl(sum(a.filter((r) => ["ok", "dir"].includes(r.st))))}${a.length > 400 ? " · mostrando 400" : ""}`;
    q("tcTit").textContent = pre.length;
    renderBusca();
    renderAbar();
  }
  async function programar(rs, cod) {
    const porEmp = {}; rs.forEach((r) => (porEmp[r.emp] = porEmp[r.emp] || []).push(r));
    try {
      for (const [e, lst] of Object.entries(porEmp)) {
        await api({ acao: "programar", refs: lst.map((r) => r.ref), empresa: e, cod_cc: cod });
        lst.forEach((r) => (r.bank = cod));
      }
      if (cod) toast(`${rs.length} título${rs.length > 1 ? "s" : ""} programado${rs.length > 1 ? "s" : ""} para ${bankDesc(cod)}`);
    } catch (e) { toast(e.message, true); }
    renderTable(); renderBanks();
  }
  function renderAbar() {
    const sel = rows.filter((r) => S.sel.has(r.id) && !r.paid); const b = q("abar"); b.classList.toggle("on", sel.length > 0); if (!sel.length) return;
    const es = EMPS.filter((e) => sel.some((r) => r.emp === e)); const ab = q("abarBank");
    ab.innerHTML = '<option value="">Definir banco p/ selecionados…</option>' + bankGroupsHtml(es.length === 1 ? es[0] : "SF", null);
    ab.onchange = () => { if (!ab.value) return; programar(sel, +ab.value); };
    const bl = sel.filter((r) => !["ok", "dir"].includes(r.st));
    q("abarN").textContent = `${sel.length} selecionado${sel.length > 1 ? "s" : ""}`;
    q("abarV").textContent = brl(sum(sel));
    q("abarE").textContent = EMPS.filter((e) => sel.some((r) => r.emp === e)).map((e) => `${e}: ${sel.filter((r) => r.emp === e).length}`).join(" · ");
    q("abarW").textContent = bl.length ? `⚠ ${bl.length} bloqueado${bl.length > 1 ? "s" : ""} — ficam fora do lote` : "";
  }

  /* BAIXA */
  const ov = q("ov"), dr = q("drawer"), md = q("modal");
  function closeAll() { ov.classList.remove("on"); dr.classList.remove("on"); md.classList.remove("on"); }
  ov.onclick = closeAll;
  const onKey = (e) => { if (e.key === "Escape") closeAll(); };
  document.addEventListener("keydown", onKey);
  const num = (v) => +String(v).replace(/\./g, "").replace(",", ".") || 0;
  const fmt = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function bankOpts(e, cur) { return `<option value="">Selecione o banco…</option>` + bankGroupsHtml(e, cur); }
  function flowHtml(r) {
    if (!r.pc) return "";
    const apOk = r.apr && r.apr !== "PENDENTE"; const nfOk = ["60", "80"].includes(r.etapa) || r.fase === "liberado"; const nfE = r.etapa === "40";
    const s = (cls, t, d) => `<div class="step ${cls}"><i></i><b>${t}</b>${d}</div>`;
    return `<div class="flow">${s("ok", "Pedido", "PC " + esc(r.pc))}${s(apOk ? "ok" : "bad", "Aprovação", apOk ? (r.apr === "APROVADO_FAT_DIRETO" ? "fat. direto" : "aprovado") + (r.aprov ? "<br>" + esc(String(r.aprov).split("@")[0]) : "") : "pendente")}${s(nfOk ? "ok" : "warn", "NF", nfOk ? "recebida" + (r.nf ? "<br>" + esc(String(r.nf).split(",")[0]) : "") : nfE ? "emitida, não recebida" : r.fase ? esc(FASE[r.fase] ?? r.fase) : ETAPA[r.etapa] || "—")}${s(r.paid ? "ok" : "", "Pagamento", r.paid ? "baixado" : "em aberto")}</div>`;
  }
  // Ciclo do pagamento (sql/75 finance.pagar_ciclo): PC → NFs → parcelas → pagamentos, com veredito.
  function cicloHtml(c) {
    if (!c) return '<h4>Ciclo do pagamento</h4><div class="sub2">sem dados de pedido/NF para este título</div>';
    const dt = (s) => (s ? new Date(String(s).slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR") : "—");
    const v = c.veredito || ""; const cor = /não pagar|duplic/i.test(v) ? "#f87171" : /pago/i.test(v) ? "#22c55e" : "#38bdf8";
    const stLbl = (t) => t.status === "EXCLUIDO" ? '<span class="bdg b-bloq">excluído no Omie</span>' : t.status === "PAGO" ? `<span class="bdg b-pago">pago ${dt(t.pago_em)}</span>`
      : t.status === "CANCELADO" ? '<span class="bdg">cancelado</span>' : (t.remessas && t.remessas.length) ? `<span class="bdg" style="color:#38bdf8">enviado ${esc(t.remessas[t.remessas.length - 1].banco)} #${t.remessas[t.remessas.length - 1].remessa}</span>`
      : t.prog_cc ? '<span class="bdg">programado</span>' : (t.pago > 0 ? '<span class="bdg">parcial</span>' : '<span class="bdg">em aberto</span>');
    const pc = c.pc;
    const T = c.totais || {};
    return `<h4>Ciclo do pagamento</h4>
      <div style="padding:8px 10px;border-radius:9px;border:1px solid ${cor};color:${cor};font-weight:650;margin:6px 0 10px">${esc(v)}</div>
      ${pc ? `<div class="sub2" style="margin-bottom:8px"><b class="mono">PC ${esc(pc.numero)}</b>${pc.total != null ? ` · total ${brl(Number(pc.total))}` : ""}${pc.aprovacao ? ` · ${esc(pc.aprovacao)}${pc.aprovado_por ? " por " + esc(String(pc.aprovado_por).split("@")[0]) : ""}` : ""}${pc.recebido_em ? ` · recebido ${dt(pc.recebido_em)}` : ""}</div>` : ""}
      ${(c.nfs || []).length ? `<div class="sub2" style="margin-bottom:6px">NFs: ${c.nfs.map((n) => `<span class="mono">NF ${esc(n.nf)}</span> ${brl(Number(n.valor))}`).join(" · ")}${T.pc_sem_nf > 0.01 ? ` · <span style="color:#f59e0b">sem NF ainda ${brl(Number(T.pc_sem_nf))}</span>` : ""}</div>` : ""}
      <table class="num" style="width:100%;font-size:12px;border-collapse:collapse;margin-top:4px"><thead><tr style="color:var(--tx3);text-align:left"><th>NF</th><th>Parc.</th><th>Venc.</th><th class="r">Valor</th><th>Situação</th></tr></thead><tbody>
      ${(c.titulos || []).map((t) => `<tr style="${t.atual ? "background:rgba(56,189,248,.08);" : ""}${t.status === "EXCLUIDO" ? "opacity:.55;text-decoration:line-through;" : ""}"><td class="mono">${esc(t.nf || "—")}</td><td>${esc(t.parcela || "—")}${t.atual ? ' <b style="color:#38bdf8">← este</b>' : ""}</td><td>${dt(t.vencimento)}</td><td class="r">${brl(Number(t.valor))}</td><td>${stLbl(t)}</td></tr>`).join("")}
      </tbody></table>
      <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px;font-size:12px"><span>Total das NFs <b>${brl(Number(T.valor || 0))}</b></span><span>Pago <b style="color:#22c55e">${brl(Number(T.pago || 0))}</b></span><span>Em aberto <b>${brl(Number(T.aberto || 0))}</b></span>${T.excluidos ? `<span class="sub2">${T.excluidos} título(s) antigo(s) excluído(s) no Omie, fora da conta</span>` : ""}</div>`;
  }

  /* ── Provisionado × Real (sql/141): confirmar com NF / desfazer ── */
  function abrirConfirmar(r, sug?) {
    if (!r) return; const pv = r.prv || {}; const media = Number(pv.media3) || 0;
    const ehCod = r.ref.startsWith("o:"); const tipoSug = /PJ|Contab|Honor|Servi/i.test(r.cat) ? "NFSE" : "BOL";
    md.innerHTML = `<div class="dh"><div><div class="sub2" style="text-transform:uppercase;letter-spacing:.06em">Confirmar provisão</div><h3 style="margin:2px 0 0">${esc(r.forn)}</h3>
      <div class="sub2" style="margin-top:3px">${r.emp} · ${esc(r.cat || "Sem categoria")} · provisionado <b style="color:#a855f7">${brl(r.v)}</b> para ${dm(r.vd)}${pv.serie ? " · recorrência " + esc(pv.serie) : ""}</div></div><button class="btn" id="mX" style="height:34px">✕</button></div>
      <div class="dbody"><div class="frm">
        <label>Tipo de documento<select id="fTipo">${[["NFSE", "NFS-e"], ["NFE", "NF-e"], ["BOL", "Boleto / fatura"], ["REC", "Recibo"], ["DAS", "Guia (DAS/DARF/GPS)"]].map(([v, l]) => `<option value="${v}" ${v === tipoSug ? "selected" : ""}>${l}</option>`).join("")}</select></label>
        <label>Nº do documento *<input id="fNum" placeholder="ex.: 257"></label>
        <label>Data de emissão *<input type="date" id="fEmi" max="${iso(new Date())}"></label>
        <label>Valor real (R$) *<input id="fVal" class="num" value="${fmt(r.v)}"></label>
        <label>Vencimento real<input type="date" id="fVenc" value="${iso(r.vd)}"></label>
        <label>Código de barras / linha digitável / chave NF-e (opcional)<input id="fBar" placeholder="44–48 dígitos"></label>
      </div>
      <div id="fDiff"></div>
      <div id="fEscopo" style="display:none;margin-top:10px"><div class="sub2" style="font-weight:600;margin-bottom:6px">A diferença vale para…</div>
        <label class="ovr"><input type="radio" name="esc" value="esta" checked> <span><b>Só esta parcela</b> — consumo variável (energia, água, telefonia). As próximas continuam com o valor provisionado.</span></label>
        <label class="ovr"><input type="radio" name="esc" value="proximas"> <span><b>Esta e as próximas provisões da série</b> — reajuste / novo valor fixo. Só mexe nas futuras ainda sem documento.</span></label>
        <label class="ovr"><input type="radio" name="esc" value="media"> <span><b>Próximas pela média das últimas 3 reais</b> — para consumo: a provisão vira a média dos 3 últimos documentos.</span></label>
      </div></div>
      <div class="df"><button class="btn" id="mC">Cancelar</button><button class="btn ok" id="mOk">Confirmar e marcar como real</button></div>`;
    ov.classList.add("on"); md.classList.add("on");
    q("mX").onclick = q("mC").onclick = closeAll;
    const diff = () => {
      const v = num(q("fVal").value), d = v - r.v, p = r.v ? (d / r.v) * 100 : 0;
      if (Math.abs(d) < 0.005) { q("fDiff").innerHTML = `<div class="verdict ok" style="margin-top:10px"><b>Valor igual ao provisionado</b><span>Só o documento será registrado.</span></div>`; q("fEscopo").style.display = "none"; return; }
      const forte = Math.abs(p) > 10;
      q("fDiff").innerHTML = `<div class="verdict ${forte ? "bloq" : "ok"}" style="margin-top:10px"><b>Diferença de ${d > 0 ? "+" : ""}${brl(d)} (${p > 0 ? "+" : ""}${p.toFixed(1).replace(".", ",")}%)</b><span>${forte ? "<b>Acima da tolerância de 10%</b> — o motivo é obrigatório e fica na auditoria." : "Dentro da tolerância (10%)."}${media ? " Média das 3 últimas reais: " + brl(media) + "." : ""}</span></div>${forte ? '<div class="frm" style="margin-top:8px"><label class="full">Motivo *<input id="fMot" placeholder="ex.: reajuste anual IPCA / consumo maior em setembro"></label></div>' : ""}`;
      q("fEscopo").style.display = pv.serie ? "" : "none";
    };
    if (sug) { // sugestão automática (sql/142): NF recebida do mesmo CNPJ
      q("fTipo").value = sug.tipo; q("fNum").value = sug.numero || ""; q("fVal").value = fmt(Number(sug.valor));
      if (sug.chave) q("fBar").value = sug.chave;
      if (sug.emissao) q("fEmi").value = String(sug.emissao).slice(0, 10);
    }
    q("fVal").oninput = diff; diff(); setTimeout(() => q(sug ? "fVal" : "fNum")?.focus(), 50);
    q("mOk").onclick = async () => {
      const numDoc = q("fNum").value.trim(); const v = num(q("fVal").value);
      if (!numDoc) { toast("Informe o nº do documento", true); q("fNum").focus(); return; }
      const emi = q("fEmi").value;
      if (!emi) { toast("Informe a data de emissão do documento", true); q("fEmi").focus(); return; }
      if (emi > iso(new Date())) { toast("A data de emissão não pode ser no futuro", true); q("fEmi").focus(); return; }
      if (!(v > 0)) { toast("Valor inválido", true); return; }
      const m = q("fMot"); if (m && !m.value.trim()) { toast("Informe o motivo da diferença", true); m.focus(); return; }
      const esc_ = root.querySelector("input[name=esc]:checked")?.value || "esta";
      const bar = q("fBar").value.replace(/\D/g, ""); const tipo = q("fTipo").value;
      q("mOk").disabled = true;
      try {
        const rr = await fetch("/api/financeiro/provisao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
          acao: "confirmar", empresa: r.emp, ...(ehCod ? { cod_titulo: Number(r.ref.slice(2)) } : { pagar_id: Number(r.ref.slice(2)) }),
          tipo_doc: tipo, numero_doc: numDoc, valor_real: v, venc_real: q("fVenc").value || null, emissao: emi,
          ...(bar.length === 44 && tipo === "NFE" ? { chave_nfe: bar } : bar ? { codigo_barras: bar } : {}),
          escopo: esc_, motivo: m ? m.value.trim() : null }) });
        const j = await rr.json(); if (!rr.ok) throw new Error(j.error ?? "HTTP " + rr.status);
        closeAll(); toast("Confirmado como real" + (j.proximas ? ` · ${j.proximas} próxima(s) provisão(ões) ajustada(s) para ${brl(Number(j.valor_proximas))}` : ""));
        await recarregarTudo();
      } catch (e) { toast(e.message, true); q("mOk").disabled = false; }
    };
  }
  async function desfazerConf(r) {
    const c = r?.prv?.conf; if (!c) return;
    md.innerHTML = `<div class="dh"><div><h3 style="margin:0">Desfazer confirmação</h3><div class="sub2" style="margin-top:3px">${esc(r.forn)} · ${esc(c.doc)} — volta a provisionado (e as próximas parcelas ajustadas, se houver)</div></div><button class="btn" id="mX" style="height:34px">✕</button></div>
      <div class="df"><button class="btn" id="mC">Cancelar</button><button class="btn" id="mOk" style="color:var(--red)">Desfazer</button></div>`;
    ov.classList.add("on"); md.classList.add("on"); q("mX").onclick = q("mC").onclick = closeAll;
    q("mOk").onclick = async () => { q("mOk").disabled = true;
      try { const rr = await fetch("/api/financeiro/provisao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "desfazer", id: c.id }) });
        const j = await rr.json(); if (!rr.ok) throw new Error(j.error ?? "HTTP " + rr.status); closeAll(); toast("Confirmação desfeita — voltou a provisionado"); await recarregarTudo();
      } catch (e) { toast(e.message, true); q("mOk").disabled = false; } };
  }

  function openDrawer(id) {
    const r = rows[id]; if (!r) return; hideTip();
    const st = r.dias < 0 ? `<span class="neg">Vencido há ${-r.dias} dias</span>` : r.dias === 0 ? '<span style="color:#f59e0b">Vence hoje</span>' : `Vence em ${r.dias} dias`;
    const blocked = !["ok", "dir"].includes(r.st);
    const provD = isProv(r);
    dr.innerHTML = `<div class="dh"><div><span class="emp ${r.emp}">${r.emp}</span> <span class="sub2" style="margin-left:6px">${EN[r.emp]}</span><h3>${esc(r.forn)}</h3><div style="font-size:12px">${st} · ${badge(r.st)}</div></div><button class="btn" id="dX" style="height:34px">✕</button></div>
    <div class="dbody">
      ${provD ? `<div class="box" style="margin-bottom:12px;border:1px dashed #a855f7;background:color-mix(in srgb,#a855f7 7%,transparent)"><h4 style="color:#a855f7">◌ Provisionado — valor estimado, sem documento</h4><div class="sub2">${r.prv?.serie ? "Recorrência " + esc(r.prv.serie) : "Conta estimada"}${r.prv?.ult ? " · último real: NF " + esc(String(r.prv.ult.nf || "—")) + " · " + dm(new Date(String(r.prv.ult.data).slice(0, 10) + "T00:00:00")) : ""}${r.prv?.media3 ? " · média das 3 últimas " + brl(Number(r.prv.media3)) : ""}. Antes de pagar, confirme com a NF/boleto e o valor real.</div>${PODE.editar ? '<div style="margin-top:8px"><button class="btn sm pri" id="dConf">Confirmar com NF</button></div>' : ""}</div>` : ""}
      <div class="verdict ${r.st}"><b>${r.st === "ok" || r.st === "dir" ? "Pode pagar" : "Não pagar ainda"}</b><span>${PST[r.st].d}${r.div ? ' <br><span style="color:#f59e0b">⚠ Este PC tem registros de aprovação divergentes na base — conferir.</span>' : ""}</span></div>
      <div class="box" id="dCiclo" style="margin-bottom:12px"><h4>Ciclo do pagamento</h4><div class="sub2">carregando…</div></div>
      ${flowHtml(r)}
      <div class="dgrid">
        <div><span>Vencimento (documento)</span>${r.vd.toLocaleDateString("pt-BR")}</div>
        <div class="full" style="grid-column:1/-1"><span>Previsão de pagamento</span>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:4px"><input type="date" id="pvData" value="${iso(r.d)}" style="max-width:170px;height:30px;padding:0 8px;border-radius:7px;border:1px solid var(--line2);background:var(--bg);color:var(--tx);color-scheme:dark light;font:inherit"><button class="btn sm" id="pvOk">Reprogramar</button>${r.repr ? '<button class="link" id="pvReg">voltar à regra do dia útil</button>' : ""}<span id="pvAv" class="sub2" style="color:#f59e0b"></span></div>
          <div class="sub2" id="pvHist" style="margin-top:4px">${r.repr ? "reprogramada · carregando histórico…" : +r.d !== +r.vd ? "dia útil seguinte ao vencimento (regra)" : ""}</div></div><div><span>Valor em aberto</span><b class="num" style="font-size:16px">${brl(r.v)}</b>${r.vdoc && Math.abs(r.vdoc - r.v) > 0.01 ? `<div class="sub2">documento ${brl(r.vdoc)}</div>` : ""}${r.aj?.novo?.valor != null ? `<div class="sub2">valor ajustado (orig. ${brl(Number(r.aj.orig?.valor ?? 0))})${PODE.editar ? ' · <button class="link" id="dDesAj">desfazer ajuste</button>' : ""}</div>` : ""}</div>
        <div><span>Categoria</span><span class="${r.cat ? "" : "nocat"}">${esc(r.cat || "Sem categoria")}</span></div><div><span>Projeto</span>${esc(r.proj || "—")}</div>
        <div><span>Documento / Parcela</span>${esc(r.doc || "—")} · ${esc(r.parc || "—")}</div><div><span>Nº da NF</span><span id="dNf" class="mono">…</span></div><div><span>Emissão</span><span id="dEmis">…</span></div><div class="full" style="grid-column:1/-1"><span>Código de barras</span><span id="dBarras" class="mono" style="word-break:break-all">…</span></div><div><span>Tipo doc.</span>${esc(r.tipo === "99999" ? "Outros" : r.tipo || "—")}</div>
        <div><span>Conta prevista</span>${esc(r.conta || "—")}</div><div><span>${r.orig === "o" ? "Cód. título Omie" : "Previsão do PC"}</span><span class="mono">${r.orig === "o" ? r.cod : esc(r.ref)}</span></div>
      </div>
      <div style="margin:-6px 0 14px;display:flex;gap:14px;flex-wrap:wrap;align-items:center">${PODE.editar ? `<button class="btn sm" id="dEdit" title="Valor, vencimento, previsão, categoria, conta, projeto, nº da NF, emissão, observação">Editar título…</button>` : ""}${r.cod_forn ? `<button class="link" id="dForn">Ver fornecedor (histórico) →</button>` : ""}</div>
      ${r.serie ? `<div class="box" style="margin-bottom:12px"><h4>Conta recorrente</h4><div class="sub2">Ocorrência ${r.serie.seq}${r.serie.n ? " de " + r.serie.n : ""} da série</div><div style="margin-top:8px"><button class="btn sm" id="dSerie">Editar / encerrar série…</button></div></div>` : ""}
      ${PODE.baixar ? `<div class="box"><h4>Baixar título</h4>
        <div class="frm">
          <label>Data do pagamento<input type="date" id="bData" value="${iso(TODAY)}"></label>
          <label>Pago pelo banco<select id="bBanco">${bankOpts(r.emp, r.bank)}</select></label>
          <label>Valor pago<input id="bVal" class="num" value="${fmt(r.v)}"></label>
          <label>Desconto<input id="bDesc" class="num" value="0,00"></label>
          <label>Juros<input id="bJur" class="num" value="0,00"></label>
          <label>Multa<input id="bMul" class="num" value="0,00"></label>
          <label class="full">Observação<input id="bObs" placeholder="Ex.: PIX, comprovante no Drive"></label>
        </div>
        ${blocked ? `<label class="ovr"><input type="checkbox" id="bOvr" class="ck"> <span>Pagar mesmo assim — registro a justificativa abaixo (fica no histórico de auditoria)</span></label>` : ""}
        ${provD && o.admin ? `<label class="ovr"><input type="checkbox" id="bOvrProv" class="ck"> <span>Administrador: baixar sem documento — justificativa obrigatória na Observação</span></label>` : ""}
        <div class="tot"><span style="color:var(--tx2)">Total debitado no banco</span><b class="num" id="bTot" style="font-size:17px"></b></div>
        <div id="bPart" style="font-size:12px;color:#f59e0b;margin-top:6px"></div>
        <div class="origem">${r.orig === "o" ? "Título do Omie: a baixa fica registada no painel e vale em todo o painel (BI, fluxo de caixa, fichas) como PAGO. O Omie não é mais atualizado." : "Previsão de PC do painel: a baixa vai para o livro de baixas e para a conciliação."}</div>
      </div>` : '<div class="sub2">Sem permissão para baixar (financeiro.baixar).</div>'}
    </div>
    <div class="df">${PODE.baixar ? `<button class="btn" id="dSel">${S.sel.has(id) ? "Remover do lote" : "Adicionar ao lote"}</button><button class="btn ok" id="dOk">Confirmar baixa</button>` : ""}</div>`;
    ov.classList.add("on"); dr.classList.add("on");
    q("dX").onclick = closeAll;
    if (q("dForn")) q("dForn").onclick = () => o.onFornecedor(Number(r.cod_forn), r.emp);
    if (q("dEdit")) q("dEdit").onclick = () => { closeAll(); o.onEditar(r.ref); };
    if (q("dDesAj")) q("dDesAj").onclick = async () => { if (!confirm(`Voltar ao valor original do Omie (${brl(Number(r.aj.orig?.valor ?? 0))})?`)) return;
      try { await api({ acao: "desfazer_ajuste", ref: r.ref }); toast("Ajuste desfeito — voltou ao valor do Omie"); closeAll(); await recarregarTudo(); } catch (e) { toast(e.message, true); } };
    fetch(`/api/financeiro/pagar?ciclo=${encodeURIComponent(r.ref)}`, { cache: "no-store" }).then((x) => x.json()).then((j) => { const el = q("dCiclo"); if (el) el.innerHTML = cicloHtml(j.ciclo); }).catch(() => { const el = q("dCiclo"); if (el) el.innerHTML = '<h4>Ciclo do pagamento</h4><div class="sub2">não foi possível carregar</div>'; });
    if (q("dSerie")) q("dSerie").onclick = () => { closeAll(); o.onSerie(r.serie.id, r.ref); };
    const pvAviso = () => { const v = q("pvData").value; q("pvAv").textContent = v && naoUtil(v) ? "⚠ dia não útil — o banco só processa no próximo dia útil" : ""; };
    q("pvData").oninput = pvAviso; pvAviso();
    q("pvOk").onclick = async () => { const v = q("pvData").value; if (!v) return; q("pvOk").disabled = true;
      try { await api({ acao: "reprogramar", refs: [r.ref], data: v, obs: null }); toast(`Previsão reprogramada para ${new Date(v + "T00:00:00").toLocaleDateString("pt-BR")}`); closeAll(); await recarregarTudo(); }
      catch (e) { toast(e.message, true); q("pvOk").disabled = false; } };
    if (q("pvReg")) q("pvReg").onclick = async () => { try { await api({ acao: "reprogramar", refs: [r.ref], data: null }); toast("Previsão voltou à regra do dia útil"); closeAll(); await recarregarTudo(); } catch (e) { toast(e.message, true); } };
    fetch(`/api/financeiro/pagar?doc=${encodeURIComponent(r.ref)}`, { cache: "no-store" }).then((x) => x.json()).then((j) => {
      const d = j.doc || {}; const em = q("dEmis"), bc = q("dBarras"); if (!em || !bc) return;
      const nfEl = q("dNf"); if (nfEl) nfEl.textContent = d.nf ? String(d.nf).replace(/^0+(?=\d)/, "") : "— (edite o título para informar)";
      const f = (x) => (x ? new Date(String(x).slice(0, 10) + "T00:00:00").toLocaleDateString("pt-BR") : "—");
      em.textContent = d.emissao ? f(d.emissao) + (d.lancado_em && String(d.emissao).slice(0, 10) === String(d.lancado_em).slice(0, 10) ? " · data do lançamento" : "") : "—";
      if (d.barras) {
        bc.innerHTML = `${esc(d.barras)} <button class="link" id="dBarrasCp">copiar</button>`;
        q("dBarrasCp").onclick = () => { navigator.clipboard?.writeText(d.barras).then(() => toast("Código de barras copiado"), () => toast("Não deu para copiar", true)); };
      } else bc.textContent = "—";
    }).catch(() => { const em = q("dEmis"), bc = q("dBarras"), nfEl = q("dNf"); if (em) em.textContent = "—"; if (bc) bc.textContent = "—"; if (nfEl) nfEl.textContent = "—"; });
    if (r.repr) fetch(`/api/financeiro/pagar?hist=${encodeURIComponent(r.ref)}`, { cache: "no-store" }).then((x) => x.json()).then((j) => {
      const h = (j.historico ?? [])[0]; const el = q("pvHist"); if (!el) return;
      const f = (x) => (x ? new Date(x + "T00:00:00").toLocaleDateString("pt-BR") : "—");
      el.textContent = h ? `reprogramada de ${f(h.de)} → ${f(h.para)} por ${String(h.por).split("@")[0]} em ${new Date(h.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}${h.obs ? " · " + h.obs : ""}` : "reprogramada";
    }).catch(() => {});
    if (!PODE.baixar) return;
    const calc = () => {
      const v = num(q("bVal").value), t = v - num(q("bDesc").value) + num(q("bJur").value) + num(q("bMul").value); q("bTot").textContent = brl(t);
      q("bPart").textContent = v < r.v - 0.005 ? `Baixa parcial: restará ${brl(r.v - v)} em aberto` : v > r.v + 0.005 ? "Valor maior que o saldo em aberto" : "";
      const ovr = q("bOvr"); const okOvr = !blocked || (ovr && ovr.checked && q("bObs").value.trim().length >= 5);
      q("dOk").disabled = !q("bBanco").value || !okOvr || v <= 0 || v > r.v + 0.005; q("bBanco").classList.toggle("need", !q("bBanco").value);
      if (blocked) q("bObs").classList.toggle("need", ovr && ovr.checked && q("bObs").value.trim().length < 5);
    };
    ["bVal", "bDesc", "bJur", "bMul", "bBanco", "bObs"].forEach((x) => (q(x).oninput = calc)); if (q("bOvr")) q("bOvr").onchange = calc; calc();
    q("dSel").onclick = () => { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); closeAll(); renderTable(); };
    if (q("dConf")) q("dConf").onclick = () => { closeAll(); abrirConfirmar(r); };
    q("dOk").onclick = async () => {
      if (provD) {
        const pula = q("bOvrProv")?.checked;
        if (!pula) { toast("Provisionado: confirme com a NF/boleto antes de baixar"); closeAll(); abrirConfirmar(r); return; }
        if ((q("bObs").value || "").trim().length < 5) { toast("Escreva a justificativa na Observação (baixa sem documento)", true); return; }
      }
      const v = num(q("bVal").value); q("dOk").disabled = true;
      try {
        await api({ acao: "baixar", data: q("bData").value, lote: false, itens: [{ ref: r.ref, valor: v, cod_cc: +q("bBanco").value, desconto: num(q("bDesc").value), juros: num(q("bJur").value), multa: num(q("bMul").value), forcar: blocked || provD, obs: (provD ? "[baixa sem documento — provisão] " : "") + q("bObs").value }] });
        const bn = bankDesc(+q("bBanco").value); closeAll(); if (v >= r.v - 0.005) r.paid = true; else r.v = +(r.v - v).toFixed(2); render(); toast(`Baixa registrada · ${r.forn.slice(0, 28)} · ${brl(v)} · ${bn}`);
        S.sel.delete(id); await recarregarTudo();
      } catch (e) { toast(e.message, true); q("dOk").disabled = false; }
    };
  }
  q("abarClr").onclick = () => { S.sel.clear(); renderTable(); };
  q("abarC6").onclick = () => { const sel = rows.filter((r) => S.sel.has(r.id) && !r.paid); if (sel.length) o.onRemessa(sel.map((r) => r.ref)); };
  q("abarRep").onclick = () => openReprog();
  function openReprog() {
    const sel = rows.filter((r) => S.sel.has(r.id) && !r.paid); if (!sel.length) return;
    md.innerHTML = `<div class="dh"><div><h3 style="margin:0">Reprogramar previsão</h3><div class="sub2" style="margin-top:3px">${sel.length} títulos · ${brl(sum(sel))} — o vencimento do documento não muda</div></div><button class="btn" id="mX" style="height:34px">✕</button></div>
    <div class="dbody"><div class="frm" style="margin-bottom:10px"><label>Nova previsão<input type="date" id="rpData" value="${iso(TODAY)}"></label><label>Motivo (opcional)<input id="rpObs" placeholder="Ex.: caixa apertado, negociar com fornecedor"></label></div>
    <div id="rpAv" class="sub2" style="color:#f59e0b;min-height:16px"></div>
    <div class="gl" style="max-height:260px;overflow:auto">${sel.map((r) => `<div><span class="num">${dm(r.d)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.forn)} <span class="sub2">· venc ${dm(r.vd)}</span></span><span class="num" style="text-align:right">${brl(r.v)}</span></div>`).join("")}</div>
    <div style="margin-top:10px"><button class="link" id="rpReg">Voltar todos à regra do dia útil</button></div></div>
    <div class="df"><button class="btn" id="mC">Cancelar</button><button class="btn ok" id="mOk">Reprogramar ${sel.length}</button></div>`;
    ov.classList.add("on"); md.classList.add("on");
    const av = () => { const v = q("rpData").value; q("rpAv").textContent = v && naoUtil(v) ? "⚠ dia não útil — o banco só processa no próximo dia útil (pode gravar mesmo assim)" : ""; };
    q("rpData").oninput = av; av();
    q("mX").onclick = q("mC").onclick = closeAll;
    const enviar = async (data) => { q("mOk").disabled = true;
      try { await api({ acao: "reprogramar", refs: sel.map((r) => r.ref), data, obs: q("rpObs").value || null }); closeAll(); S.sel.clear(); toast(data ? `${sel.length} títulos reprogramados para ${new Date(data + "T00:00:00").toLocaleDateString("pt-BR")}` : `${sel.length} títulos de volta à regra`); await recarregarTudo(); }
      catch (e) { toast(e.message, true); q("mOk").disabled = false; } };
    q("mOk").onclick = () => q("rpData").value && enviar(q("rpData").value);
    q("rpReg").onclick = () => enviar(null);
  }
  q("abarGo").onclick = () => openBatch();
  function openBatch() {
    const all = rows.filter((r) => S.sel.has(r.id) && !r.paid); const sel = all.filter((r) => ["ok", "dir"].includes(r.st) && !isProv(r)); const out = all.filter((r) => !["ok", "dir"].includes(r.st) || isProv(r));
    const groups = EMPS.filter((e) => sel.some((r) => r.emp === e));
    md.innerHTML = `<div class="dh"><div><h3 style="margin:0">Baixa em lote</h3><div class="sub2" style="margin-top:3px">${sel.length} títulos · ${brl(sum(sel))} · valor integral</div></div><button class="btn" id="mX" style="height:34px">✕</button></div>
    <div class="dbody">
      ${out.length ? `<div class="verdict bloq" style="margin-bottom:12px"><b>${out.length} fora do lote</b><span>${out.map((r) => esc(r.forn.slice(0, 24)) + " (" + PST[r.st].l + ")").join(" · ")} — baixe individualmente com justificativa, se for o caso.</span></div>` : ""}
      <div class="frm" style="margin-bottom:14px"><label>Data do pagamento<input type="date" id="lData" value="${iso(TODAY)}"></label><label>Observação (vale para todos)<input id="lObs" placeholder="Ex.: remessa CNAB 05/10"></label></div>
      ${groups.map((e) => { const rs = sel.filter((r) => r.emp === e); const common = [...new Set(rs.map((r) => r.bank).filter(Boolean))].filter((c) => payBanks(e).some((b) => b.cod === c));
        return `<div class="grp"><div class="grph"><span class="emp ${e}">${e}</span><b>${EN[e]}</b><span class="sub2">${rs.length} títulos · <b class="num" style="color:var(--tx)">${brl(sum(rs))}</b></span><select data-e="${e}" class="lb">${bankOpts(e, common.length === 1 ? common[0] : null)}</select></div>
        <div class="gl">${rs.sort((a, b) => a.dias - b.dias).map((r) => `<div><span class="num ${r.dias < 0 ? "neg" : ""}">${dm(r.d)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.forn)} <span class="sub2">· ${esc(r.cat || "Sem categoria")}</span></span><span class="num" style="text-align:right">${brl(r.v)}</span></div>`).join("")}</div></div>`; }).join("")}
      ${groups.length > 1 ? '<div class="sub2">A seleção mistura empresas — escolha o banco de cada uma. Um banco de outra empresa do grupo gera intercompany.</div>' : '<div class="sub2">Banco de outra empresa do grupo gera intercompany (ex.: título da CD pago pela SF).</div>'}
      <div class="origem">Os títulos ficam PAGOS em todo o painel (BI, fluxo de caixa, fichas). O Omie não é mais atualizado.</div>
    </div>
    <div class="df"><button class="btn" id="mC">Cancelar</button><button class="btn ok" id="mOk">Confirmar ${sel.length} baixas</button></div>`;
    ov.classList.add("on"); md.classList.add("on");
    const chk = () => { const okk = sel.length && [...md.querySelectorAll(".lb")].every((s) => s.value); md.querySelectorAll(".lb").forEach((s) => s.classList.toggle("need", !s.value)); q("mOk").disabled = !okk; };
    md.querySelectorAll(".lb").forEach((s) => (s.onchange = chk)); chk();
    q("mX").onclick = q("mC").onclick = closeAll;
    q("mOk").onclick = async () => {
      const bk = {}; md.querySelectorAll(".lb").forEach((s) => (bk[s.dataset.e] = +s.value)); q("mOk").disabled = true;
      try {
        await api({ acao: "baixar", lote: true, data: q("lData").value, obs: q("lObs").value, itens: sel.map((r) => ({ ref: r.ref, valor: r.v, cod_cc: bk[r.emp] })) });
        closeAll(); sel.forEach((r) => (r.paid = true)); S.sel.clear(); render(); toast(`${sel.length} títulos baixados · ${brl(sum(sel))}`); await recarregarTudo();
      } catch (e) { toast(e.message, true); q("mOk").disabled = false; }
    };
  }

  /* CONCILIAÇÃO OFX */
  function candidates(m) {
    if (m.v > 0) return []; const val = -m.v - m.casado; const md_ = new Date(m.data + "T00:00:00"); const bank = bankOf(S.ofxBank);
    return open_().filter((r) => Math.abs(r.v - val) < 0.02).map((r) => { const dd = Math.abs((r.d - md_) / DAY); const sc = 100 - dd * 6 - (bank && r.emp !== bank.emp ? 15 : 0); return { r, dd, sc: Math.max(40, Math.round(sc)) }; }).filter((c) => c.dd <= 35).sort((a, b) => b.sc - a.sc);
  }
  const estado = (m) => (m.ignorado ? "ign" : m.casado >= Math.abs(m.v) - 0.004 ? "done" : "new");
  function renderConc() {
    const el = q("pConc"); const bank = bankOf(S.ofxBank);
    const nNew = MOV.filter((m) => estado(m) === "new" && m.v < 0).length; q("tcConc").textContent = PODE.conciliar ? nNew : "—";
    if (!PODE.conciliar) { el.innerHTML = '<div class="sub2" style="padding:20px">Sem permissão para conciliação (financeiro.conciliar).</div>'; return; }
    const bankSel = `<select id="cBank" class="bsel" style="max-width:280px">${BANKS.filter((b) => ["CC", "CA", "PG"].includes(b.tipo)).map((b) => `<option value="${b.cod}" ${b.cod === S.ofxBank ? "selected" : ""}>${b.emp} · ${esc(b.desc)}${b.pend ? ` (${b.pend})` : ""}</option>`).join("")}</select>`;
    const deb = MOV.filter((m) => m.v < 0), cre = MOV.filter((m) => m.v > 0);
    MOV.forEach((m) => { m.c = estado(m) === "new" ? candidates(m) : []; if ((m.pick == null || !m.c.some((x) => x.r.id === m.pick)) && m.c.length) m.pick = m.c[0].r.id; });
    const sug = MOV.filter((m) => estado(m) === "new" && m.c.length);
    const arquivos = [...new Set(MOV.map((m) => m.arquivo).filter(Boolean))];
    el.innerHTML = `<div class="drop" style="padding:12px 16px"><div><b>Extrato da conta</b> <span class="sub2">· ${bank ? bank.emp + " · " + esc(bank.desc) : "—"} · últimos 90 dias · ${MOV.length} movimentos${arquivos.length ? " · " + esc(arquivos.slice(0, 2).join(", ")) : ""}</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${bankSel}<label class="btn sm" style="cursor:pointer">Importar .ofx<input type="file" id="cFile" accept=".ofx,.OFX,application/x-ofx" style="display:none"></label><button class="btn ok sm" id="cAll" ${sug.length ? "" : "disabled"}>Conciliar ${sug.length} sugestões</button><a class="btn sm" href="/financeiro/conciliacao?conta=${bank ? encodeURIComponent(bank.emp + ":" + bank.cod) : ""}" title="Entradas e saídas da conta, com a situação de cada movimento, e a visão geral de todos os bancos">Conciliação completa ↗</a></div></div><div class="sub2" style="padding:0 16px 8px">Aqui aparecem só as <b>saídas</b> (contas a pagar). Para ver tudo o que falta conciliar desta conta — entradas e saídas — use a <b>Conciliação completa</b>.</div>
    <div class="cstats"><div class="cst"><b class="num">${brl(-deb.reduce((s, m) => s + m.v, 0))}</b>${deb.length} débitos</div><div class="cst"><b class="num">${brl(cre.reduce((s, m) => s + m.v, 0))}</b>${cre.length} créditos</div><div class="cst"><b class="num" style="color:#22c55e">${MOV.filter((m) => estado(m) === "done").length}</b>conciliados</div><div class="cst"><b class="num" style="color:#f59e0b">${sug.length}</b>com sugestão</div><div class="cst"><b class="num">${MOV.filter((m) => estado(m) === "new" && m.v < 0 && !m.c.length).length}</b>sem par</div></div>
    ${!MOVLOAD ? '<div class="carregando">Carregando extrato…</div>' : !MOV.length ? '<div class="sub2" style="padding:16px">Nenhum movimento importado nesta conta nos últimos 90 dias — importe o OFX do banco.</div>' : `<div class="tbl" style="max-height:560px"><div class="mrow h"><span>Data</span><span>Extrato (OFX)</span><span style="text-align:right">Valor</span><span></span><span>Título sugerido</span><span style="text-align:right">Ação</span></div>
    ${MOV.map((m, ix) => {
      const c = m.c || []; let right = "", act = ""; const est = estado(m);
      if (est === "done") { right = `<div class="cand">${(m.baixas || []).map((b) => `<span class="f">${esc(b.contraparte || b.documento || "—")}</span><span class="sub2">${esc(b.empresa)} · ${brl(Number(b.valor))}${b.ref && b.ref.startsWith("o:") ? " · título Omie" : ""}</span>`).join("")}</div>`; act = `<span class="bdg b-pago">Conciliado</span><button class="btn sm" data-undo="${ix}">Desfazer</button>`; }
      else if (est === "ign") { right = `<span class="sub2">${esc(m.motivo)}</span>`; act = `<button class="btn sm" data-reat="${ix}">Desfazer</button>`; }
      else if (m.v > 0) { right = `<div class="cand"><span class="f">Entrada — não é contas a pagar</span><span class="sub2">Recebimento ou transferência entre contas — concilie na <a href="/financeiro/conciliacao?conta=${bank ? encodeURIComponent(bank.emp + ":" + bank.cod) : ""}" style="color:#7aa2ff">Conciliação bancária</a></span></div>`; act = `<button class="btn sm" data-ign="${ix}" data-mot="Transferência entre contas próprias">Marcar transferência</button>`; }
      else if (c.length) { const p = c.find((x) => x.r.id === m.pick) || c[0]; const r = p.r;
        right = `<div class="cand">${c.length > 1 ? `<select data-pick="${ix}">${c.map((x) => `<option value="${x.r.id}" ${x.r.id === m.pick ? "selected" : ""}>${esc(x.r.forn.slice(0, 30))} · ${x.r.emp} · venc ${dm(x.r.d)}</option>`).join("")}</select><span class="sub2">${c.length} títulos com o mesmo valor — confira</span>` : `<span class="f">${esc(r.forn)} <span class="score ${p.sc < 85 ? "mid" : ""}">${p.sc}%</span></span><span class="sub2">${r.emp} · venc. ${dm(r.d)} · ${esc(r.cat || "Sem categoria")} ${bank && r.emp !== bank.emp ? '<span style="color:#f59e0b">· título de ' + r.emp + " pago por conta " + bank.emp + "</span>" : ""}</span>`}</div>`;
        act = `<button class="btn sm" data-ign="${ix}" data-mot="Ignorado manualmente">Ignorar</button><button class="btn ok sm" data-ok="${ix}">Conciliar</button>`; }
      else { right = `<span class="sub2">Nenhum título em aberto com este valor${m.casado > 0 ? ` (restam ${brl(-m.v - m.casado)})` : ""}</span>`; act = `<button class="btn sm" data-ign="${ix}" data-mot="Sem título — lançar despesa">Lançar despesa</button>`;
        // casado em parte (pagou com atraso): o resto vira juros/multa do título já casado (07/10/26)
        if (m.casado > 0 && PODE.baixar) act += `<button class="btn ok sm" data-jur="${ix}" title="Lança a diferença como juros/multa no título já casado e fecha o movimento">Resto ${brl(-m.v - m.casado)} como juros</button>`; }
      if (est === "new") act = `<button class="btn sm" data-casar="${ix}" title="Casar: buscar título por nome, CNPJ, NF, PV/OS, valor ou vencimento (Omie + painel)">Casar…</button>` + act;
      return `<div class="mrow ${est === "done" ? "done" : est === "ign" ? "ign" : ""}"><span class="num">${dm(new Date(m.data + "T00:00:00"))}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.memo)}">${esc(m.memo)}</span><span class="num" style="text-align:right;font-weight:650;color:${m.v < 0 ? "#f87171" : "#22c55e"}">${brl(m.v)}</span><span class="arr">→</span>${right}<span class="acts">${act}</span></div>`;
    }).join("")}</div>`}`;
    q("cBank").onchange = async (e) => { S.ofxBank = +e.target.value; MOVLOAD = false; renderConc(); await carregarMov(); renderConc(); };
    q("cFile").onchange = async (e) => {
      const f = e.target.files?.[0]; if (!f || !bank) return;
      const fd = new FormData(); fd.append("arquivo", f); fd.append("empresa", bank.emp); fd.append("cod_cc", String(bank.cod));
      try { const r = await fetch("/api/financeiro/ofx", { method: "POST", body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status); toast(`OFX importado: ${j.novos ?? 0} novos · ${j.duplicados ?? 0} já existiam`); await recarregarTudo(); }
      catch (er) { toast(er.message, true); }
    };
    const conc = async (m) => { const r = rows[m.pick]; if (!r) return; await api({ acao: "conciliar", movimento_id: m.id, itens: [{ ref: r.ref, valor: Math.min(r.v, -m.v - m.casado) }] }); };
    q("cAll").onclick = async () => { const used = new Set(); let n = 0, falhas = 0; q("cAll").disabled = true;
      for (const m of sug) { if (used.has(m.pick)) continue; used.add(m.pick); try { await conc(m); n++; } catch { falhas++; } }
      toast(`${n} movimentos conciliados${falhas ? ` · ${falhas} com erro` : ""}`, falhas > 0); await recarregarTudo(); };
    el.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = async () => { const m = MOV[+b.dataset.ok]; b.disabled = true; try { await conc(m); toast(`Conciliado · ${rows[m.pick]?.forn.slice(0, 28)} · ${brl(-m.v)}`); await recarregarTudo(); } catch (e) { toast(e.message, true); b.disabled = false; } }));
    el.querySelectorAll("[data-casar]").forEach((b) => (b.onclick = () => window.dispatchEvent(new CustomEvent("conc:casar", { detail: { movimentoId: MOV[+b.dataset.casar].id } }))));
    el.querySelectorAll("[data-ign]").forEach((b) => (b.onclick = async () => { const m = MOV[+b.dataset.ign]; try { await api({ acao: "ignorar", movimento_id: m.id, ignorar: true, motivo: b.dataset.mot }); await carregarMov(); render(); } catch (e) { toast(e.message, true); } }));
    el.querySelectorAll("[data-reat]").forEach((b) => (b.onclick = async () => { const m = MOV[+b.dataset.reat]; try { await api({ acao: "ignorar", movimento_id: m.id, ignorar: false }); await carregarMov(); render(); } catch (e) { toast(e.message, true); } }));
    el.querySelectorAll("[data-jur]").forEach((b) => (b.onclick = async () => {
      const m = MOV[+b.dataset.jur]; b.disabled = true;
      try {
        const r = await fetch("/api/financeiro/conciliacao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "juros_resto", movimento_id: m.id }) });
        const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
        toast(`Juros/multa de ${brl(Number(j.juros))} lançados em ${j.contraparte ?? "título"} — movimento conciliado`); await recarregarTudo();
      } catch (e) { b.disabled = false; toast(e.message, true); }
    }));
    el.querySelectorAll("[data-undo]").forEach((b) => (b.onclick = async () => { const m = MOV[+b.dataset.undo]; try { await api({ acao: "desfazer", movimento_id: m.id }); toast("Conciliação desfeita — baixas estornadas"); await recarregarTudo(); } catch (e) { toast(e.message, true); } }));
    el.querySelectorAll("[data-pick]").forEach((s) => (s.onchange = () => { MOV[+s.dataset.pick].pick = +s.value; renderConc(); }));
  }

  /* BAIXAS DE HOJE */
  function renderHist() {
    q("tcHist").textContent = BAIXAS.length;
    q("pHist").innerHTML = `<div class="tbar"><span class="sub2">Baixas registadas hoje no painel (manual, lote e extrato) — já valem no BI, no fluxo de caixa e nas fichas.</span><span style="margin-left:auto"></span><button class="btn sm" id="hOmie">Exportar baixas de hoje (CSV)</button></div>` +
      (BAIXAS.length ? `<div class="tbl"><table class="num"><thead><tr><th>Hora</th><th>Emp.</th><th>Fornecedor</th><th>Documento</th><th>Banco</th><th>Origem</th><th class="r">Valor</th><th></th></tr></thead><tbody>${BAIXAS.map((b) => `<tr><td>${new Date(b.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td><td><span class="emp ${b.empresa}">${b.empresa}</span></td><td>${esc(b.contraparte)}</td><td class="mono">${esc(b.documento)}</td><td>${esc(b.conta ?? b.cod_cc)}</td><td style="color:var(--tx2)">${esc(b.origem)}${b.lote_id ? " · lote " + b.lote_id : ""}${b.forcada ? ' · <span style="color:#f87171">forçada</span>' : ""}</td><td class="r">${brl(Number(b.valor))}</td><td class="r">${PODE.baixar ? `<button class="btn sm danger" data-est="${b.id}">Estornar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : '<div style="padding:24px;color:var(--tx3)">Nenhuma baixa registada hoje. Baixas manuais, em lote e por extrato aparecem aqui.</div>');
    q("hOmie").onclick = () => {
      if (!BAIXAS.length) { toast("Nenhuma baixa registada hoje"); return; }
      csv("baixas-pagar-hoje.csv", [["empresa", "cod_titulo", "fornecedor", "documento", "data_pagamento", "valor", "desconto", "juros", "multa", "banco", "origem", "observacao"], ...BAIXAS.map((b) => [b.empresa, b.cod_titulo, b.contraparte, b.documento, b.data, b.valor, b.desconto, b.juros, b.multa, b.conta, b.origem, b.observacao])]);
    };
    qa("#pHist [data-est]").forEach((bt) => (bt.onclick = () => estornar(+bt.dataset.est)));
  }
  function estornar(id) {
    md.innerHTML = `<div class="dh"><div><h3 style="margin:0">Estornar baixa #${id}</h3><div class="sub2" style="margin-top:3px">O título volta a ficar em aberto. Se veio do extrato, o movimento volta a pendente.</div></div><button class="btn" id="mX" style="height:34px">✕</button></div><div class="dbody"><label class="sub2">Motivo<input class="mtxt" id="eMot" placeholder="Ex.: lançado em duplicidade"></label></div><div class="df"><button class="btn" id="mC">Cancelar</button><button class="btn danger" id="mOk" disabled>Estornar</button></div>`;
    ov.classList.add("on"); md.classList.add("on");
    q("mX").onclick = q("mC").onclick = closeAll;
    q("eMot").oninput = () => (q("mOk").disabled = q("eMot").value.trim().length < 3);
    q("mOk").onclick = async () => { try { await api({ acao: "estornar", baixa_id: id, motivo: q("eMot").value }); closeAll(); toast("Baixa estornada"); await recarregarTudo(); } catch (e) { toast(e.message, true); } };
  }
  function csv(nome, linhas) {
    const t = linhas.map((l) => l.map((c) => { const s = String(c ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + t], { type: "text/csv;charset=utf-8" })); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  q("tCsv").onclick = () => csv(`titulos-a-pagar-${iso(TODAY)}.csv`, [["vencimento", "empresa", "fornecedor", "cnpj", "categoria", "projeto", "documento", "parcela", "pc", "nf", "status_pagamento", "banco_programado", "conta_prevista", "valor_aberto", "origem", "ref"],
    ...tblAtual.map((r) => [r.venc, r.emp, r.forn, r.cnpj, r.cat, r.proj, r.doc, r.parc, r.pc, r.nf, PST[r.st].l, bankDesc(r.bank), r.conta, String(r.v).replace(".", ","), r.orig === "o" ? "Omie" : "Previsão PC", r.ref])]);

  function renderTabs() { qa("#wsTabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.tab)); q("pTit").style.display = S.tab === "tit" ? "" : "none"; q("pConc").style.display = S.tab === "conc" ? "" : "none"; q("pHist").style.display = S.tab === "hist" ? "" : "none";
    const pp = q("pPagos"); if (pp) { pp.style.display = S.tab === "pagos" ? "" : "none"; if (S.tab === "pagos") carregarPagos(); } }
  /* PAGOS (07/10/26, Benny): o que já foi pago, de forma clara — por data do pagamento, Omie + painel. */
  let PG = { per: "mes", de: "", ate: "", itens: [], carregando: false, erro: "", chave: "", atraso: false };
  const isoD = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  function pgPeriodo() {
    const h = new Date(); h.setHours(0, 0, 0, 0); const d = new Date(h);
    if (PG.per === "mes") return [isoD(new Date(h.getFullYear(), h.getMonth(), 1)), isoD(h)];
    if (PG.per === "mesant") return [isoD(new Date(h.getFullYear(), h.getMonth() - 1, 1)), isoD(new Date(h.getFullYear(), h.getMonth(), 0))];
    if (PG.per === "ano") return [isoD(new Date(h.getFullYear(), 0, 1)), isoD(h)];
    if (PG.per === "livre") return [PG.de || isoD(new Date(+h - 30 * 864e5)), PG.ate || isoD(h)];
    d.setDate(d.getDate() - ({ d7: 7, d30: 30, d90: 90 }[PG.per] ?? 30)); return [isoD(d), isoD(h)];
  }
  async function carregarPagos() {
    const [de, ate] = pgPeriodo(); const chave = de + "|" + ate;
    if (PG.chave === chave && !PG.erro) { renderPagos(); return; }
    PG.carregando = true; PG.erro = ""; PG.chave = chave; renderPagos();
    try {
      const r = await fetch(`/api/financeiro/pagar?pagos=1&de=${de}&ate=${ate}`, { cache: "no-store" });
      const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
      if (PG.chave === chave) { PG.itens = j.itens ?? []; PG.carregando = false; renderPagos(); }
    } catch (e) { PG.carregando = false; PG.erro = e.message; PG.chave = ""; renderPagos(); }
  }
  function renderPagos() {
    const el = q("pPagos"); if (!el) return;
    const [de, ate] = pgPeriodo();
    const dbr = (s) => (s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString("pt-BR") : "—");
    const atr = (x) => (x.venc && x.pago_em ? Math.round((new Date(x.pago_em + "T12:00:00") - new Date(x.venc + "T12:00:00")) / 864e5) : 0);
    const base = PG.itens.filter((x) => empOk({ emp: x.emp }) && (!S.q || [x.forn, x.cat, x.doc, x.conta].join(" ").toLowerCase().includes(S.q)));
    const it = PG.atraso ? base.filter((x) => atr(x) > 0) : base;
    const tot = base.reduce((a, x) => a + Number(x.valor_pago || 0), 0), jur = base.reduce((a, x) => a + Number(x.juros || 0), 0);
    const nAtr = base.filter((x) => atr(x) > 0).length;
    const PERS = [["mes", "Este mês"], ["mesant", "Mês passado"], ["d7", "7 dias"], ["d30", "30 dias"], ["d90", "90 dias"], ["ano", "Ano"], ["livre", "Período…"]];
    q("tcPagos").textContent = PG.carregando ? "…" : base.length;
    el.innerHTML = `<div class="tbar" style="flex-wrap:wrap;gap:8px">
        <div class="seg sm" id="pgPer">${PERS.map(([v, l]) => `<button data-v="${v}" class="${PG.per === v ? "on" : ""}">${l}</button>`).join("")}</div>
        ${PG.per === "livre" ? `<input type="date" class="in" id="pgDe" value="${de}" style="height:28px"> até <input type="date" class="in" id="pgAte" value="${ate}" style="height:28px">` : `<span class="sub2">${dbr(de)} a ${dbr(ate)}</span>`}
        <label class="sub2" style="display:inline-flex;gap:4px;align-items:center;margin-left:8px"><input type="checkbox" id="pgAtr" ${PG.atraso ? "checked" : ""}> só os pagos com atraso</label>
        <span style="margin-left:auto"></span><button class="btn sm" id="pgCsv">CSV</button></div>
      <div style="display:flex;gap:18px;flex-wrap:wrap;margin:10px 4px 12px">
        <div><div class="sub2">Total pago${S.emp !== "ALL" ? " · " + esc(S.emp) : ""}</div><b class="num" style="font-size:20px;color:#22c55e">${brl(tot)}</b></div>
        <div><div class="sub2">Títulos</div><b class="num" style="font-size:20px">${base.length}</b></div>
        <div><div class="sub2">Juros / multa</div><b class="num" style="font-size:20px;color:${jur > 0 ? "#f59e0b" : "inherit"}">${brl(jur)}</b></div>
        <div><div class="sub2">pagos com atraso</div><b class="num" style="font-size:20px;color:${nAtr ? "#f87171" : "inherit"}">${nAtr}</b></div>
      </div>
      ${PG.carregando ? '<div class="carregando">Carregando pagos…</div>' : PG.erro ? `<div class="erro">${esc(PG.erro)}</div>` : !it.length ? '<div class="sub2" style="padding:16px">Nada pago neste período com estes filtros.</div>' :
      `<div class="tbl" style="max-height:600px"><table class="num"><thead><tr><th>Pago em</th><th>Emp.</th><th>Fornecedor</th><th>Categoria</th><th>Documento</th><th>Vencimento</th><th class="r">Valor pago</th><th>Conta</th><th>Origem</th></tr></thead><tbody>${it.slice(0, 1500).map((x) => { const a = atr(x);
        return `<tr><td><span class="bdg b-pago">Pago</span> ${dbr(x.pago_em)}</td><td><span class="emp ${esc(x.emp)}">${esc(x.emp)}</span></td><td style="font-weight:500">${esc(x.forn)}</td><td style="color:var(--tx2)">${esc(x.cat || "Sem categoria")}</td><td class="mono">${esc(x.doc || "—")}${x.parc ? ` <span class="sub2">· ${esc(x.parc)}</span>` : ""}</td><td>${dbr(x.venc)}${a > 0 ? ` <span style="color:#f87171;font-size:11px">+${a}d</span>` : a < 0 ? ` <span class="sub2">antecipado</span>` : ""}</td><td class="r">${brl(Number(x.valor_pago || 0))}${Number(x.juros) > 0 ? `<div class="sub2" style="color:#f59e0b">juros ${brl(Number(x.juros))}</div>` : ""}${Number(x.desconto) > 0 ? `<div class="sub2">desc. ${brl(Number(x.desconto))}</div>` : ""}</td><td style="color:var(--tx2)">${esc(x.conta || "—")}</td><td class="sub2">${x.origem === "painel" ? "painel" : "Omie"}</td></tr>`; }).join("")}</tbody></table></div>
      <div class="foot"><span>${it.length} título(s) · ${brl(it.reduce((a, x) => a + Number(x.valor_pago || 0), 0))}${it.length > 1500 ? " · mostrando 1.500 (use o CSV para todos)" : ""}</span><span>Data = dia em que o dinheiro saiu · empresa e busca do topo também filtram aqui</span></div>`}`;
    qa("#pgPer button").forEach((b) => (b.onclick = () => { PG.per = b.dataset.v; carregarPagos(); }));
    const de0 = q("pgDe"), ate0 = q("pgAte");
    if (de0) de0.onchange = () => { PG.de = de0.value; carregarPagos(); };
    if (ate0) ate0.onchange = () => { PG.ate = ate0.value; carregarPagos(); };
    q("pgAtr").onchange = (e) => { PG.atraso = e.target.checked; renderPagos(); };
    q("pgCsv").onclick = () => csv(`pagos-${de}-a-${ate}.csv`, [["pago_em", "empresa", "Fornecedor", "categoria", "documento", "parcela", "vencimento", "valor_pago", "juros_multa", "desconto", "conta", "origem"],
      ...it.map((x) => [x.pago_em, x.emp, x.forn, x.cat, x.doc, x.parc, x.venc, x.valor_pago, x.juros, x.desconto, x.conta, x.origem])]);
  }

  qa("#wsTabs button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.v; render(); }));
  const goOfx = () => { S.tab = "conc"; render(); goTable(); };
  q("hdrOfx").onclick = goOfx; q("bkOfx").onclick = goOfx;
  q("hdrNova").onclick = () => o.onNovaConta();
  const hs = q("hdrSync");
  if (!o.admin) hs.classList.add("hidden");
  hs.onclick = async () => {
    hs.disabled = true; hs.textContent = "Disparando…";
    try { const r = await fetch("/api/admin/run-workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "finance", kind: "diaria" }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status); toast("Sync do Omie disparado — recarregue em alguns minutos"); }
    catch (e) { toast(e.message, true); } finally { hs.disabled = false; hs.textContent = "Sincronizar"; }
  };

  function render() {
    q("hoje").textContent = TODAY.toLocaleDateString("pt-BR");
    q("cpErro").innerHTML = erro ? `<div class="erro">${esc(erro)}</div>` : "";
    q("cpCarregando").classList.toggle("hidden", !carregando);
    q("cpCorpo").classList.toggle("hidden", carregando);
    if (carregando) return;
    q("hdrNova").classList.toggle("hidden", !PODE.incluir);
    renderKpis(); renderAgenda(); renderBanks(); renderVenc(); renderTable(); renderConc(); renderHist(); renderTabs();
  }
  seg("empSeg", "emp", () => { S.rkOpen = null; }); seg("agMode", "agMode", () => (S.agSel = 0)); seg("vcEmp", "vcEmp", () => { S.vcCut = null; S.rkOpen = null; });
  seg("vcRange", "vcRange", () => { S.vcCut = null; S.rkOpen = null; }, 1); seg("rkDim", "rkDim", () => (S.rkOpen = null));
  seg("tPer", "per", () => { S.filter = null; S.kpi = null; S.st = "all"; });
  q("q").oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); render(); buscarHist(); };

  render();
  (async () => { await carregar(); await Promise.all([carregarMov(), carregarBaixas()]); if (vivo) render(); })();

  return {
    recarregar: recarregarTudo,
    destruir() { vivo = false; document.removeEventListener("mousedown", onMouseDown); document.removeEventListener("keydown", onKey); },
  };
}

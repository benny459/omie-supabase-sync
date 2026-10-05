// @ts-nocheck — porte do script do mockup "contas-a-receber-v1" (05/10/26),
// ligado a /api/financeiro/receber. Mesmo desenho do pagar-v3-motor.ts:
// imperativo, escopado no contentor, toda ação grava no servidor e recarrega.

type Opts = {
  root: HTMLElement;
  admin: boolean;
  onNovaConta: () => void;
};

const EMPS = ["CD", "SF", "WW"];
const EC = { CD: "#f5a524", SF: "#3b82f6", WW: "#14b8a6" };
const EN = { CD: "CDG Projetos", SF: "SafeWater", WW: "WaterWorks" };
const DAY = 864e5;
const SIT = {
  cobrar: { l: "Cobrar", c: "b-cobrar", d: "Vencido e sem promessa de pagamento. Cobrar o cliente hoje." },
  prom: { l: "Prometido", c: "b-prom", d: "Vencido, mas com nova previsão de pagamento registrada." },
  reneg: { l: "Renegociado", c: "b-reneg", d: "Título em renegociação." },
  semb: { l: "Sem boleto", c: "b-semb", d: "A vencer sem boleto nem NF registrada — emitir boleto ou enviar dados para depósito." },
  nfs: { l: "NF/RPS emitida", c: "b-nfs", d: "Cobrança por NF de serviço (TED/depósito), sem boleto." },
  bol: { l: "Boleto emitido", c: "b-bol", d: "Boleto registrado — acompanhar liquidação." },
};
const SORD = ["cobrar", "prom", "reneg", "semb", "nfs", "bol"];

export function montarReceberV1(o: Opts) {
  const root = o.root;
  const q = (id) => root.querySelector("#" + id);
  const qa = (sel) => root.querySelectorAll(sel);
  let TODAY = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) + "T00:00:00");
  let rows = [], BANKS = [], PONT = { n: 0, pct: null }, PODE = { baixar: false, conciliar: false, incluir: false, cobrar: false };
  let MOV = [], MOVLOAD = false, BAIXAS = [], vivo = true, carregando = true, erro = "";

  const S = { emp: "ALL", q: "", base: "prev", agMode: "dia", agHide: {}, agSel: 0, vcEmp: "SF", vcRange: 60, vcCut: null, rkDim: "cli", rkOpen: null,
    tab: "tit", per: "hoje", st: "all", filter: null, kpi: null, sel: new Set(), sort: { k: "sit", dir: 1 }, cf: {}, cfv: {}, ofxBank: null };

  const brl = (v) => (v ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const k = (v) => { const a = Math.abs(v); if (a >= 1e6) return "R$ " + (v / 1e6).toLocaleString("pt-BR", { maximumFractionDigits: 1 }) + " mi"; if (a >= 1e3) return "R$ " + Math.round(v / 1e3).toLocaleString("pt-BR") + " mil"; return "R$ " + Math.round(v); };
  const kk = (v) => { const a = Math.abs(v); if (a >= 1e6) return (v / 1e6).toFixed(1).replace(".", ",") + "M"; if (a >= 1e3) return Math.round(v / 1e3) + "k"; return Math.round(v) + ""; };
  const dm = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" });
  const dmy = (d) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  const wd = (d) => d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "");
  const sum = (a) => a.reduce((s, r) => s + r.v, 0);
  const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pd = (s) => (s ? new Date(s + "T00:00:00") : null);
  const empOk = (r, e = S.emp) => e === "ALL" || r.emp === e;
  const qOk = (r) => !S.q || [r.forn, r.cnpj, r.cat, r.proj, r.doc, r.nbol, r.nf, r.conta, r.pedido].join(" ").toLowerCase().includes(S.q);
  const D = (r) => (S.base === "prev" ? r.diasP : r.diasV);
  const DD = (r) => (S.base === "prev" && !(r.diasV < 0 && !r.prom) ? r.prevD : r.d);
  const open_ = () => rows.filter((r) => !r.paid);
  const base = () => open_().filter((r) => empOk(r) && qOk(r));
  const badge = (s) => `<span class="bdg ${SIT[s].c}">${SIT[s].l}</span>`;
  const iso = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const num = (v) => +String(v).replace(/\./g, "").replace(",", ".") || 0;
  const fmt = (v) => v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const bankOf = (cod) => BANKS.find((b) => b.cod === cod);
  const bankDesc = (cod) => bankOf(cod)?.desc ?? "";
  const payBanks = (e) => BANKS.filter((b) => b.emp === e && !["CX", "AD"].includes(b.tipo));
  function histTag(r) { if (r.nh == null) return '<span class="hist n">sem histórico</span>'; const c = r.pont >= 80 && r.atr <= 3 ? "g" : r.atr > 10 || r.pont < 40 ? "b" : "m"; return `<span class="hist ${c}">${r.pont}% pontual · ${r.atr > 0 ? "+" + r.atr + "d" : r.atr + "d"}</span>`; }
  function sit(o) { o.st = o.reneg ? "reneg" : o.diasV < 0 ? (o.prom ? "prom" : "cobrar") : o.bol ? "bol" : o.tipo === "NFS" ? "nfs" : "semb"; }
  const tip = q("tip");
  function showTip(e, h) { tip.innerHTML = h; tip.style.display = "block"; tip.style.left = Math.min(e.clientX + 14, innerWidth - 240) + "px"; tip.style.top = e.clientY + 14 + "px"; }
  function hideTip() { tip.style.display = "none"; }
  function toast(m, ruim) { const t = q("toast"); t.textContent = m; t.style.display = "block"; t.style.borderColor = ruim ? "var(--red)" : ""; clearTimeout(t._t); t._t = setTimeout(() => (t.style.display = "none"), ruim ? 7000 : 3600); }

  // ── servidor ────────────────────────────────────────────────────────────
  async function api(body) {
    const r = await fetch("/api/financeiro/receber", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
    return j;
  }
  async function carregar() {
    try {
      const r = await fetch("/api/financeiro/receber", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status);
      if (!vivo) return;
      TODAY = new Date(j.hoje + "T00:00:00");
      PODE = j.pode ?? PODE; PONT = j.pont30 ?? PONT;
      BANKS = (j.banks ?? []).map((b) => ({ emp: b[0], cod: Number(b[1]), desc: b[2], tipo: b[3], saldo: Number(b[4]) || 0, dt: b[5], ofx: b[6], pend: Number(b[7]) || 0 }));
      const prog = j.prog ?? {};
      const sel = new Set([...S.sel].map((i) => rows[i]?.ref).filter(Boolean));
      rows = (j.rows ?? []).map((x, i) => {
        const d = pd(x[2]); const prev = pd(x[17] || x[21] || x[2]);
        const cod_cc = x[10] != null ? Number(x[10]) : null;
        const def = cod_cc && BANKS.some((b) => b.emp === x[1] && b.cod === cod_cc && !["CX", "AD"].includes(b.tipo)) ? cod_cc : null;
        const o2 = { id: i, ref: x[0], uid: x[30], emp: x[1], venc: x[2], d, diasV: Math.round((d - TODAY) / DAY), v: Number(x[3]), forn: x[4], cat: x[5] ?? "", proj: x[6] ?? "",
          doc: x[7] ?? "", parc: x[8] ?? "", conta: x[9] ?? "", cod_cc, cod: x[11], bol: !!x[12], nbol: x[13] ?? "", nf: x[14] ?? "", tipo: x[15], reneg: !!x[16], pOv: x[17],
          atr: x[18] != null ? Number(x[18]) : null, pont: x[19] != null ? Number(x[19]) : null, nh: x[20] != null ? Number(x[20]) : null, prevD: prev, cnpj: x[22] ?? "",
          orig: x[23], vdoc: Number(x[24]) || 0, cod_cli: x[25], ncob: Number(x[26]) || 0, pedido: x[27], rotulo: x[28], pessoa: x[29], paid: null,
          bank: prog[x[0]] != null ? Number(prog[x[0]]) : def };
        o2.prom = o2.diasV < 0 && prev > d && prev >= TODAY;
        o2.diasP = o2.diasV < 0 && !o2.prom ? o2.diasV : Math.round((prev - TODAY) / DAY);
        sit(o2); return o2;
      });
      S.sel = new Set(rows.filter((r) => sel.has(r.ref)).map((r) => r.id));
      if (S.ofxBank == null) { const c = BANKS.filter((b) => ["CC", "CA", "PG"].includes(b.tipo)); S.ofxBank = (c.find((b) => b.pend > 0) ?? c.find((b) => b.ofx) ?? c[0])?.cod ?? null; }
      erro = ""; carregando = false;
    } catch (e) { erro = e.message; carregando = false; }
    render();
  }
  async function carregarMov() {
    if (!PODE.conciliar || !S.ofxBank) { MOV = []; MOVLOAD = true; return; }
    const r = await fetch(`/api/financeiro/receber?mov=${S.ofxBank}&de=${iso(new Date(+TODAY - 90 * DAY))}`, { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    MOV = (j.movimentos ?? []).filter((m) => Number(m.valor) > 0).map((m) => ({ ...m, v: Number(m.valor), casado: Number(m.casado) || 0, pick: null }));
    MOVLOAD = true;
  }
  async function carregarBaixas() { const r = await fetch("/api/financeiro/receber?baixas=hoje", { cache: "no-store" }); const j = await r.json().catch(() => ({})); BAIXAS = j.baixas ?? []; }
  async function recarregarTudo() { await Promise.all([carregar(), carregarMov(), carregarBaixas()]); render(); }

  function seg(id, key, cb, isNum) { qa("#" + id + " button").forEach((b) => (b.onclick = () => { qa("#" + id + " button").forEach((x) => x.classList.toggle("on", x === b)); S[key] = isNum ? +b.dataset.v : b.dataset.v; cb && cb(); render(); })); }
  function setSeg(id, v) { qa("#" + id + " button").forEach((x) => x.classList.toggle("on", x.dataset.v === String(v))); }
  const weekIdx = (d) => Math.floor(d / 7);
  const weekLabel = (i) => dm(new Date(+TODAY + i * 7 * DAY)) + "–" + dm(new Date(+TODAY + (i * 7 + 6) * DAY));
  function goTable() { q("ws").scrollIntoView({ behavior: "smooth", block: "start" }); }
  function setFilter(label, f) { S.filter = { label, f }; S.kpi = null; S.tab = "tit"; S.per = "tudo"; S.st = "all"; setSeg("tPer", "tudo"); render(); goTable(); }

  /* KPIs */
  function renderKpis() {
    const b = base(); const bl = S.base === "prev" ? "previsão" : "vencimento";
    const sets = [
      { id: "v60", l: "Vencidos · últimos 60d", f: (r) => r.diasV < 0 && r.diasV >= -60, cls: "red", acc: "var(--red)" },
      { id: "hoje", l: `Entra hoje · ${bl}`, f: (r) => D(r) === 0, acc: "var(--amber)" },
      { id: "d7", l: "Próx. 7 dias", f: (r) => D(r) >= 1 && D(r) <= 7, acc: "#60a5fa" },
      { id: "d30", l: "Próx. 30 dias", f: (r) => D(r) >= 0 && D(r) <= 30, acc: "var(--sf)" },
      { id: "acao", l: "Precisa de ação · 30d", f: (r) => (r.diasV < 0 && r.diasV >= -60 && r.st === "cobrar") || (D(r) >= 0 && D(r) <= 30 && r.st === "semb"), acc: "var(--orange)" },
    ];
    let h = "";
    for (const s of sets) {
      const a = b.filter(s.f), v = sum(a);
      const split = EMPS.map((e) => { const x = sum(a.filter((r) => r.emp === e)); return x ? `<i style="width:${(x / v) * 100}%;background:${EC[e]}"></i>` : ""; }).join("");
      let extra = "";
      if (s.id === "v60") { const old = b.filter((r) => r.diasV < -60); if (old.length) extra = `<div class="warn">+ ${k(sum(old))} vencidos há &gt;60d · ${old.length}</div>`; }
      if (s.id === "acao") extra = `<div class="mini"><span>Cobrar: <b style="color:var(--tx)">${a.filter((r) => r.st === "cobrar").length}</b></span><span>Sem boleto: <b style="color:var(--tx)">${a.filter((r) => r.st === "semb").length}</b></span></div>`;
      h += `<div class="kpi ${s.cls || ""} ${S.kpi === s.id ? "sel" : ""}" data-k="${s.id}"><div class="acc" style="background:${s.acc}"></div><div class="l">${s.l}</div><div class="v num">${k(v)}</div><div class="s">${a.length} títulos</div>${v && s.id !== "acao" ? `<div class="split">${split}</div>` : ""}${extra}</div>`;
    }
    h += `<div class="kpi green"><div class="acc" style="background:var(--green)"></div><div class="l">Pontualidade 30d</div><div class="v num">${PONT.pct != null ? PONT.pct + "%" : "—"}</div><div class="s">recebidos até o vencimento · ${PONT.n} títulos</div><div class="split"><i style="width:${PONT.pct ?? 0}%;background:var(--green)"></i></div></div>`;
    const el = q("kpis"); el.innerHTML = h;
    el.querySelectorAll(".kpi[data-k]").forEach((n) => (n.onclick = () => { const s = sets.find((x) => x.id === n.dataset.k); if (S.kpi === s.id) { S.kpi = null; S.filter = null; render(); return; } setFilter(s.l, s.f); S.kpi = s.id; render(); }));
  }

  /* AGENDA */
  function renderAgenda() {
    q("agDesc").textContent = `Por ${S.base === "prev" ? "previsão de recebimento" : "vencimento"} · clique num dia para ver logo abaixo · ‹ › navega`;
    const b = base().filter((r) => D(r) >= 0 && D(r) <= 30);
    const emps = EMPS.filter((e) => S.emp === "ALL" || S.emp === e);
    q("agLegend").innerHTML = emps.map((e) => `<button data-e="${e}" class="${S.agHide[e] ? "off" : ""}"><span class="dot" style="background:${EC[e]}"></span>${e} <span class="num" style="color:var(--tx3)">${kk(sum(b.filter((r) => r.emp === e)))}</span></button>`).join("");
    qa("#agLegend button").forEach((x) => (x.onclick = () => { S.agHide[x.dataset.e] = !S.agHide[x.dataset.e]; render(); }));
    const vis = emps.filter((e) => !S.agHide[e]); const day = S.agMode === "dia"; const n = day ? 31 : 5;
    const bk = [...Array(n)].map(() => ({ by: {}, rows: [] }));
    b.filter((r) => vis.includes(r.emp)).forEach((r) => { const i = day ? D(r) : Math.min(4, weekIdx(D(r))); bk[i].by[r.emp] = (bk[i].by[r.emp] || 0) + r.v; bk[i].rows.push(r); });
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
      if (t && (!day || t / top > 0.15)) g += `<text x="${X + bw / 2}" y="${y - 4}" style="fill:var(--tx2)" font-size="9.5" text-anchor="middle">${kk(t)}</text>`;
      g += `<rect class="hit" data-i="${i}" x="${pl + i * cw}" y="${pt}" width="${cw}" height="${H - pt}" fill="transparent" style="cursor:pointer"/>`;
      if (day) { if (i % 3 === 0) g += `<text x="${X + bw / 2}" y="${H - pb + 14}" style="fill:${i === 0 ? "#f59e0b" : "var(--tx3)"}" font-size="10" text-anchor="middle">${i === 0 ? "hoje" : dm(d)}</text>`; }
      else g += `<text x="${X + bw / 2}" y="${H - pb + 14}" style="fill:var(--tx2)" font-size="10.5" text-anchor="middle">Sem ${i + 1}</text><text x="${X + bw / 2}" y="${H - pb + 27}" style="fill:var(--tx3)" font-size="9.5" text-anchor="middle">${weekLabel(i)}</text>`;
      cum += t; line.push([pl + i * cw + cw / 2, pt + (H - pt - pb) * (1 - cum / tot)]);
    });
    g += `<polyline points="${line.map((p) => p.join(",")).join(" ")}" fill="none" stroke="#4ade80" stroke-width="1.5" stroke-dasharray="3 3" opacity=".7"/><text x="${W - pr}" y="12" fill="#22c55e" font-size="10" text-anchor="end">--- acumulado do mês</text>`;
    const el = q("agChart"); el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`;
    el.querySelectorAll(".hit").forEach((h) => {
      const i = +h.dataset.i, x = bk[i];
      h.onmousemove = (e) => { const d = new Date(+TODAY + (day ? i : i * 7) * DAY); const t = Object.values(x.by).reduce((a, c) => a + c, 0); showTip(e, `<div class="t">${day ? wd(d) + " " + dm(d) : "Semana " + (i + 1) + " · " + weekLabel(i)}</div>${vis.map((z) => `<div class="r"><span><span class="dot" style="background:${EC[z]}"></span>${z}</span><b class="num">${brl(x.by[z] || 0)}</b></div>`).join("")}<div class="r" style="border-top:1px solid var(--line2);margin-top:5px;padding-top:5px"><span>${x.rows.length} títulos</span><b class="num">${brl(t)}</b></div>`); };
      h.onmouseleave = hideTip; h.onclick = () => { hideTip(); S.agSel = S.agSel === i ? null : i; render(); };
    });
    renderDay(vis, day, n);
    const wk = [0, 1, 2, 3, 4]; const cell = (e, w) => b.filter((r) => (e === "T" ? vis.includes(r.emp) : r.emp === e) && Math.min(4, weekIdx(D(r))) === w);
    let p = `<tr><th>Empresa</th>${wk.map((w) => `<th>Sem ${w + 1}<br><span style="font-size:10px">${weekLabel(w)}</span></th>`).join("")}<th>Total 30d</th></tr>`;
    vis.forEach((e) => { p += `<tr><td><span class="emp ${e}">${e}</span> <span style="color:var(--tx2);margin-left:4px">${EN[e]}</span></td>${wk.map((w) => { const v = sum(cell(e, w)); return `<td class="c ${v ? "" : "z"}" data-e="${e}" data-w="${w}">${v ? kk(v) : "—"}</td>`; }).join("")}<td><b>${brl(sum(b.filter((r) => r.emp === e)))}</b></td></tr>`; });
    p += `<tr class="ptot"><td>Total</td>${wk.map((w) => `<td>${kk(sum(cell("T", w)))}</td>`).join("")}<td>${brl(sum(b.filter((r) => vis.includes(r.emp))))}</td></tr>`;
    const pv = q("pivot"); pv.innerHTML = p;
    pv.querySelectorAll("td.c").forEach((c) => (c.onclick = () => { const e = c.dataset.e, w = +c.dataset.w; setFilter(`${e} · Semana ${w + 1} (${weekLabel(w)})`, (r) => r.emp === e && D(r) >= 0 && D(r) <= 30 && Math.min(4, weekIdx(D(r))) === w); }));
  }
  function renderDay(vis, day, n) {
    const el = q("agDay");
    if (S.agSel == null || S.agSel >= n) { el.innerHTML = ""; return; }
    const i = S.agSel; const inSel = (r) => (day ? D(r) === i : D(r) >= 0 && D(r) <= 30 && Math.min(4, weekIdx(D(r))) === i);
    const rs0 = rows.filter((r) => vis.includes(r.emp) && empOk(r) && qOk(r) && inSel(r));
    const open = rs0.filter((r) => !r.paid), paid = rs0.filter((r) => r.paid);
    const d = new Date(+TODAY + (day ? i : i * 7) * DAY);
    const ttl = day ? `${i === 0 ? "Hoje" : wd(d)} ${dm(d)}<small>${i === 0 ? wd(d) : i === 1 ? "amanhã" : "em " + i + " dias"}</small>` : `Semana ${i + 1}<small>${weekLabel(i)}</small>`;
    const okb = open.filter((r) => ["bol", "nfs", "prom"].includes(r.st)), risk = open.filter((r) => !["bol", "nfs", "prom"].includes(r.st)); const tot = sum(open) || 1;
    const cl = {}; open.forEach((r) => { cl[r.forn] = (cl[r.forn] || 0) + r.v; }); const topc = Object.entries(cl).sort((a, b) => b[1] - a[1]).slice(0, 6);
    const grp = vis.map((e) => ({ e, rs: rs0.filter((r) => r.emp === e).sort((a, b) => (a.paid ? 1 : 0) - (b.paid ? 1 : 0) || D(a) - D(b) || b.v - a.v) })).filter((g) => g.rs.length);
    el.innerHTML = `<div class="dayov"><div class="doh">
       <div class="nav"><button id="dPrev" ${i <= 0 ? "disabled" : ""}>‹</button><span class="ttl">${ttl}</span><button id="dNext" ${i >= n - 1 ? "disabled" : ""}>›</button></div>
       <div><div class="big num ent">${brl(sum(open))}</div><div class="sub2">${open.length} a receber${paid.length ? ` · ${paid.length} já recebido${paid.length > 1 ? "s" : ""}` : ""}</div></div>
       <div><div class="dsplit"><i style="width:${(sum(okb) / tot) * 100}%;background:#22c55e"></i><i style="width:${(sum(risk) / tot) * 100}%;background:#f59e0b"></i></div><div class="sub2" style="margin-top:4px"><span style="color:#22c55e">cobrança ok ${kk(sum(okb))}</span> · <span style="color:#f59e0b">exige ação ${kk(sum(risk))}</span></div></div>
       <div class="dmeta">${vis.map((e) => { const v = sum(open.filter((r) => r.emp === e)); return v ? `<span class="chip" style="font-size:11.5px;padding:3px 9px;border-radius:999px;background:var(--bg)"><span class="dot" style="background:${EC[e]}"></span>${e} ${kk(v)}</span>` : ""; }).join("")}</div>
       <div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap"><button class="btn sm" id="dTbl">Abrir na tabela</button><button class="btn sm" id="dClose">✕</button></div></div>
     ${topc.length ? `<div class="dcats">${topc.map(([c, v]) => `<span>${esc(c)} <b class="num">${kk(v)}</b></span>`).join("")}</div>` : ""}
     <div class="dbody2">${grp.length ? grp.map((g) => `<div class="dg"><div class="dgh"><span class="emp ${g.e}">${g.e}</span>${EN[g.e]} · ${g.rs.length} título${g.rs.length > 1 ? "s" : ""}<b class="num">${brl(sum(g.rs.filter((r) => !r.paid)))}</b></div>
       ${g.rs.map((r) => `<div class="drow ${r.paid ? "pd" : ""}" data-id="${r.id}"><span class="sub2 num dd">${day ? "" : dm(DD(r))}</span><span class="f" title="${esc(r.forn)}">${esc(r.forn)}</span><span class="m">${esc(r.cat || "Sem categoria")}${r.diasV < 0 ? ' · <span class="neg">venceu ' + dm(r.d) + "</span>" : ""}</span>${r.paid ? '<span class="bdg b-pago">Recebido</span>' : badge(r.st)}<span class="num" style="text-align:right;font-weight:650">${brl(r.v)}</span><span style="text-align:right">${r.paid || !PODE.baixar ? "" : `<button class="btn sm">Receber</button>`}</span></div>`).join("")}</div>`).join("") : '<div style="padding:18px;color:var(--tx3)">Nada previsto para este dia.</div>'}</div></div>`;
    q("dPrev").onclick = () => { S.agSel = Math.max(0, i - 1); render(); }; q("dNext").onclick = () => { S.agSel = Math.min(n - 1, i + 1); render(); };
    q("dClose").onclick = () => { S.agSel = null; render(); };
    q("dTbl").onclick = () => setFilter(day ? `${S.base === "prev" ? "Previsão" : "Vencimento"} ${dm(d)}` : `Semana ${i + 1} (${weekLabel(i)})`, inSel);
    el.querySelectorAll(".drow").forEach((x) => (x.onclick = () => openDrawer(+x.dataset.id)));
  }

  /* BANCOS */
  function renderBanks() {
    const list = BANKS.filter((b) => (S.emp === "ALL" || b.emp === S.emp) && ["CC", "CA", "PG"].includes(b.tipo));
    const in7 = (b) => sum(base().filter((r) => r.emp === b.emp && r.bank === b.cod && D(r) >= 0 && D(r) <= 7));
    q("banks").innerHTML = list.map((b) => { const e7 = in7(b);
      return `<div class="bk"><span class="emp ${b.emp}">${b.emp}</span><span class="nm">${esc(b.desc)}</span><span class="sd num ${b.saldo < 0 ? "neg" : ""}">${brl(b.saldo)}</span>
      <span class="meta">${e7 ? `<span class="ent">+ ${kk(e7)} previsto 7d</span>` : ""}<span>${b.ofx ? "OFX até " + dm(pd(b.ofx)) : b.dt ? "Saldo Omie " + dm(pd(b.dt)) : "sem extrato"}</span>${b.pend ? `<span style="color:#f59e0b">${b.pend} créditos a conciliar</span>` : b.ofx ? '<span style="color:#22c55e">conciliado</span>' : ""}</span></div>`; }).join("") || '<div class="sub2">Nenhuma conta.</div>';
    const hoje = base().filter((r) => D(r) === 0), s7 = base().filter((r) => D(r) >= 0 && D(r) <= 7), venc = base().filter((r) => r.diasV < 0 && r.diasV >= -60); const saldo = list.reduce((s, b) => s + b.saldo, 0);
    q("cov").innerHTML = `<div class="row"><span>Saldo nas contas acima</span><b class="num">${brl(saldo)}</b></div><div class="row"><span>Entra hoje (${S.base === "prev" ? "previsão" : "venc."})</span><b class="num ent">+ ${brl(sum(hoje))}</b></div><div class="row"><span>Entra em 7 dias</span><b class="num ent">+ ${brl(sum(s7))}</b></div><div class="row"><span>Em atraso (60d) a cobrar</span><b class="num" style="color:#f59e0b">${brl(sum(venc))}</b></div><div class="row" style="border-top:1px solid var(--line2);margin-top:5px;padding-top:7px"><span>Saldo projetado em 7 dias*</span><b class="num" style="font-size:15px">${brl(saldo + sum(s7))}</b></div><div class="sub2" style="margin-top:4px">*sem considerar os pagamentos (veja Títulos a Pagar)</div>`;
  }

  /* INADIMPLÊNCIA */
  function vcRows() { const R = S.vcRange, E = S.vcEmp; return open_().filter((r) => r.diasV < 0 && -r.diasV <= R && empOk(r, E) && qOk(r)); }
  function renderVenc() {
    const R = S.vcRange, E = S.vcEmp; const all = open_().filter((r) => r.diasV < 0 && empOk(r, E) && qOk(r)); const inR = all.filter((r) => -r.diasV <= R);
    q("vcDesc").textContent = `${R >= 9999 ? "Todos os vencidos" : "Vencidos nos últimos " + R + " dias"} · ${E === "ALL" ? "todas as empresas" : EN[E]} · ${inR.length} títulos · ${brl(sum(inR))} · ${new Set(inR.map((r) => r.forn)).size} clientes`;
    const nW = R >= 9999 ? 26 : Math.ceil(R / 7); const W = 620, H = 200, pl = 40, pr = 6, pt = 14, pb = 26, cw = (W - pl - pr) / nW, bw = Math.min(28, cw * 0.7);
    const bk = [...Array(nW)].map(() => ({ v: 0, n: 0, pr: 0 })); inR.forEach((r) => { const w = Math.floor((-r.diasV - 1) / 7); if (w < nW) { bk[w].v += r.v; bk[w].n++; if (r.st !== "cobrar") bk[w].pr += r.v; } });
    const max = Math.max(1, ...bk.map((b) => b.v));
    let g = ""; [0, 0.5, 1].forEach((t) => { const y = pt + (H - pt - pb) * (1 - t); g += `<line x1="${pl}" x2="${W - pr}" y1="${y}" y2="${y}" style="stroke:var(--line)"/><text x="${pl - 5}" y="${y + 4}" style="fill:var(--tx3)" font-size="9.5" text-anchor="end">${kk(max * t)}</text>`; });
    bk.forEach((b, j) => {
      const i = nW - 1 - j; const x = pl + i * cw + (cw - bw) / 2; const h = ((H - pt - pb) * b.v) / max; const hp = ((H - pt - pb) * b.pr) / max;
      const sel = S.vcCut && S.vcCut.type === "w" && S.vcCut.j === j; const dim = S.vcCut && !sel;
      g += `<rect x="${x}" y="${H - pb - h}" width="${bw}" height="${Math.max(h, b.v ? 2 : 0)}" fill="#ef4444" rx="2" opacity="${dim ? 0.3 : 1}" ${sel ? 'stroke="#93c5fd" stroke-width="1.5"' : ""}/>`;
      if (hp) g += `<rect x="${x}" y="${H - pb - hp}" width="${bw}" height="${hp}" fill="#f59e0b" rx="2" opacity="${dim ? 0.3 : 1}"/>`;
      g += `<rect class="hit" data-j="${j}" x="${pl + i * cw}" y="${pt}" width="${cw}" height="${H - pt}" fill="transparent" style="cursor:pointer"/>`;
      if (j % Math.ceil(nW / 6) === 0) g += `<text x="${x + bw / 2}" y="${H - pb + 14}" style="fill:var(--tx3)" font-size="9.5" text-anchor="middle">-${(j + 1) * 7}d</text>`;
    });
    g += `<text x="${W - pr}" y="11" style="fill:var(--tx2)" font-size="10" text-anchor="end"><tspan fill="#ef4444">■</tspan> cobrar  <tspan fill="#f59e0b">■</tspan> prometido/reneg.</text>`;
    const el = q("vcChart"); el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" width="100%" style="display:block">${g}</svg>`;
    el.querySelectorAll(".hit").forEach((h) => {
      const j = +h.dataset.j, b = bk[j]; const a = new Date(+TODAY - (j + 1) * 7 * DAY), z = new Date(+TODAY - (j * 7 + 1) * DAY);
      h.onmousemove = (e) => showTip(e, `<div class="t">Venceu ${dm(a)}–${dm(z)}</div><div class="r"><span>${b.n} títulos</span><b class="num">${brl(b.v)}</b></div><div class="r"><span>com promessa</span><b class="num">${brl(b.pr)}</b></div>`);
      h.onmouseleave = hideTip; h.onclick = () => { hideTip(); S.vcCut = S.vcCut && S.vcCut.type === "w" && S.vcCut.j === j ? null : { type: "w", j, label: `venceu ${dm(a)}–${dm(z)}`, f: (r) => r.diasV <= -(j * 7 + 1) && r.diasV >= -(j + 1) * 7 }; S.rkOpen = null; render(); };
    });
    const B = [["1–15 dias", 1, 15], ["16–30 dias", 16, 30], ["31–60 dias", 31, 60], ["61–90 dias", 61, 90], ["91–180 dias", 91, 180], ["181–365 dias", 181, 365], ["> 1 ano", 366, 1e9]];
    const ag = B.map(([l, a, z]) => { const s = all.filter((r) => -r.diasV >= a && -r.diasV <= z); return { l, a, z, v: sum(s), n: s.length }; });
    const mx = Math.max(1, ...ag.map((x) => x.v)); const cols = ["#f87171", "#ef4444", "#dc2626", "#b91c1c", "#991b1b", "#7f1d1d", "#5b1414"];
    q("aging").innerHTML = ag.map((x, i) => `<div class="ag ${x.a <= R ? "" : "old"} ${S.vcCut && S.vcCut.type === "a" && S.vcCut.i === i ? "sel" : ""}" data-i="${i}"><span class="lab">${x.l}</span><span class="bt"><i style="width:${(x.v / mx) * 100}%;background:${cols[i]}"></i></span><span class="num" style="text-align:right;font-weight:600">${k(x.v)}</span><span class="cnt num">${x.n}</span></div>`).join("");
    qa("#aging .ag").forEach((n) => (n.onclick = () => { const i = +n.dataset.i, x = ag[i];
      if (x.a > R) { const nr = [30, 60, 90, 180].find((v) => v >= x.z) || 9999; S.vcRange = nr; setSeg("vcRange", nr); }
      S.vcCut = S.vcCut && S.vcCut.type === "a" && S.vcCut.i === i ? null : { type: "a", i, label: `vencidos ${x.l}`, f: (r) => -r.diasV >= x.a && -r.diasV <= x.z }; S.rkOpen = null; render(); }));
    const old = ag.filter((x) => x.a > 180); const ov = old.reduce((s, x) => s + x.v, 0), on = old.reduce((s, x) => s + x.n, 0);
    q("vcAlert").innerHTML = ov > 0 ? `<div class="alert"><span><b>${k(ov)}</b> em ${on} títulos vencidos há mais de 6 meses${E === "ALL" ? "" : " em " + E}. Avaliar perda (PDD), renegociação ou baixa.</span><button id="limpa">Listar</button></div>` : "";
    const lb = q("limpa"); if (lb) lb.onclick = () => setFilter(`Vencidos >180d · ${E === "ALL" ? "Todas" : E}`, (r) => empOk(r, E) && r.diasV < -180);
    renderRank();
  }
  const DIM = { cli: { l: "Cliente", g: (r) => r.forn }, cat: { l: "Categoria", g: (r) => r.cat || "(Sem categoria)" }, proj: { l: "Projeto", g: (r) => r.proj || "(Sem projeto)" }, sit: { l: "Situação", g: (r) => SIT[r.st].l } };
  function renderRank() {
    let a = vcRows(); if (S.vcCut) a = a.filter(S.vcCut.f);
    q("rkFilter").innerHTML = S.vcCut ? `<span class="fchip">Recorte: ${esc(S.vcCut.label)}<button id="cutX">×</button></span>` : "Clique numa barra ou faixa ao lado para recortar";
    const cx = q("cutX"); if (cx) cx.onclick = () => { S.vcCut = null; render(); };
    const Dm = DIM[S.rkDim]; const g = {}; a.forEach((r) => { const n = Dm.g(r); (g[n] = g[n] || []).push(r); });
    const list = Object.entries(g).map(([n, rs]) => ({ n, rs, v: sum(rs) })).sort((x, y) => y.v - x.v); const mx = Math.max(1, ...list.map((x) => x.v)); const tot = sum(a) || 1;
    q("rank").innerHTML = list.map((x) => { const open = S.rkOpen === x.n; const r0 = x.rs[0];
      const bars = EMPS.map((e) => { const v = sum(x.rs.filter((r) => r.emp === e)); return v ? `<i style="width:${(v / mx) * 100}%;background:${EC[e]}"></i>` : ""; }).join("");
      const its = x.rs.slice().sort((p, qq) => p.diasV - qq.diasV); const maxAt = -Math.min(...x.rs.map((r) => r.diasV));
      return `<div class="rk ${open ? "open" : ""}" data-n="${esc(x.n)}"><div class="rkh"><span class="nm">${esc(x.n)}<small>${x.rs.length} título${x.rs.length > 1 ? "s" : ""} · ${((x.v / tot) * 100).toFixed(0)}% · até ${maxAt}d${S.rkDim === "cli" ? " · " : ""}</small>${S.rkDim === "cli" ? histTag(r0) : ""}</span><span class="vv num">${brl(x.v)}</span><span class="car">›</span><span class="rkb">${bars}</span></div>
      <div class="rkd">${its.slice(0, 12).map((r) => `<div class="li" data-id="${r.id}"><span class="emp ${r.emp}">${r.emp}</span><span class="num neg">${dm(r.d)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(S.rkDim === "cli" ? (r.cat || "Sem categoria") + (r.nf ? " · NF " + r.nf : r.doc ? " · " + r.doc : "") : r.forn)}</span>${badge(r.st)}<span class="num" style="text-align:right;font-weight:600">${brl(r.v)}</span></div>`).join("")}
      <div style="display:flex;justify-content:space-between;margin-top:8px;gap:8px;flex-wrap:wrap"><span class="sub2">${its.length > 12 ? "+ " + (its.length - 12) + " títulos" : ""}</span><span style="display:flex;gap:12px">${S.rkDim === "cli" && r0.pessoa ? `<a class="link" href="/cadastros/${r0.pessoa}">Ficha do cliente</a>` : ""}${S.rkDim === "cli" && PODE.cobrar ? `<button class="link" data-cob>Registrar cobrança</button>` : ""}<button class="link" data-go>Abrir na tabela →</button></span></div></div></div>`; }).join("") || '<div style="color:var(--tx3);padding:12px">Nenhum vencido neste recorte. 🎉</div>';
    qa("#rank .rk").forEach((n) => { const nm = n.dataset.n;
      n.querySelector(".rkh").onclick = () => { S.rkOpen = S.rkOpen === nm ? null : nm; renderRank(); };
      n.querySelectorAll(".li").forEach((l) => (l.onclick = () => openDrawer(+l.dataset.id)));
      const cb = n.querySelector("[data-cob]"); if (cb) cb.onclick = () => openCob(g[nm].map((r) => r.id));
      n.querySelector("[data-go]").onclick = () => { const E = S.vcEmp, R = S.vcRange, cut = S.vcCut; setFilter(`${Dm.l}: ${nm} · vencidos ${R >= 9999 ? "todos" : R + "d"}${cut ? " · " + cut.label : ""}`, (r) => r.diasV < 0 && -r.diasV <= R && empOk(r, E) && (!cut || cut.f(r)) && Dm.g(r) === nm); };
    });
  }

  /* TABELA */
  const PER = { hoje: (r) => D(r) === 0, venc: (r) => r.diasV < 0, amanha: (r) => D(r) === 1, d7: (r) => D(r) >= 0 && D(r) <= 7, d30: (r) => D(r) >= 0 && D(r) <= 30, tudo: () => true };
  function tblBase() { const a = base(); return S.filter ? a.filter(S.filter.f) : a.filter(PER[S.per]); }
  const cobLbl = (r) => (r.bol ? "Boleto" : r.tipo === "NFS" ? "NF/RPS" : "Sem boleto");
  const histLbl = (r) => (r.nh == null ? "Sem histórico" : r.pont >= 80 && r.atr <= 3 ? "Bom pagador" : r.atr > 10 || r.pont < 40 ? "Atrasa muito" : "Atrasa às vezes");
  const COLV = { dias: (r) => r.d.toLocaleDateString("pt-BR"), prev: (r) => DD(r).toLocaleDateString("pt-BR"), emp: (r) => r.emp, forn: (r) => r.forn, cat: (r) => r.cat || "Sem categoria", cob: cobLbl, sit: (r) => SIT[r.st].l, hist: histLbl, bank: (r) => (r.bank ? bankDesc(r.bank) : "(sem banco)") };
  const COLN = { dias: "Vencimento", prev: "Previsão", emp: "Empresa", forn: "Cliente", cat: "Categoria", cob: "Cobrança", sit: "Situação", hist: "Histórico", bank: "Banco p/ receber", v: "Valor" };
  function cfOk(r, ex) { for (const key in S.cf) { if (key === ex) continue; if (!S.cf[key].has(COLV[key](r))) return false; } if (ex !== "v") { const { min, max } = S.cfv; if (min != null && r.v < min) return false; if (max != null && r.v > max) return false; } return true; }
  const nActive = () => Object.keys(S.cf).length + (S.cfv.min != null || S.cfv.max != null ? 1 : 0);
  function tblRows() { return tblBase().filter((r) => cfOk(r)); }
  let tblAtual = [];
  function renderTable() {
    const pre = tblRows(); const cnt = (x) => pre.filter((r) => r.st === x).length;
    const dc = { cobrar: "#f87171", prom: "#fbbf24", reneg: "#c4b5fd", semb: "#fdba74", nfs: "#93c5fd", bol: "#4ade80" };
    q("tSt").innerHTML = `<button data-v="all" class="${S.st === "all" ? "on" : ""}">Todos<span class="c">${pre.length}</span></button>` + SORD.map((x) => (cnt(x) ? `<button data-v="${x}" class="${S.st === x ? "on" : ""}"><span class="dot" style="background:${dc[x]}"></span>${SIT[x].l}<span class="c">${cnt(x)}</span></button>` : "")).join("");
    qa("#tSt button").forEach((b) => (b.onclick = () => { S.st = b.dataset.v; renderTable(); }));
    const a = S.st === "all" ? pre : pre.filter((r) => r.st === S.st);
    const { k: sk, dir } = S.sort;
    a.sort((x, y) => { let p, qq; if (sk === "sit") { p = SORD.indexOf(x.st); qq = SORD.indexOf(y.st); if (p === qq) return x.diasV - y.diasV || y.v - x.v; } else if (sk === "prev") { p = +DD(x); qq = +DD(y); } else if (sk === "hist") { p = x.atr ?? -99; qq = y.atr ?? -99; } else if (sk === "bank") { p = bankDesc(x.bank); qq = bankDesc(y.bank); } else { p = x[sk]; qq = y[sk]; } return (typeof p === "number" ? p - qq : String(p ?? "").localeCompare(String(qq ?? ""))) * dir; });
    tblAtual = a;
    const na = nActive(); const tot = na + (S.filter ? 1 : 0) + (S.st !== "all" ? 1 : 0);
    q("fchip").innerHTML = (S.filter ? `<span class="fchip">${esc(S.filter.label)}<button id="clr">×</button></span> ` : "") + Object.keys(S.cf).map((key) => `<span class="fchip">${COLN[key]}: ${S.cf[key].size === 1 ? esc([...S.cf[key]][0]) : S.cf[key].size + " valores"}<button data-cfx="${key}">×</button></span> `).join("") + (S.cfv.min != null || S.cfv.max != null ? `<span class="fchip">Valor ${S.cfv.min != null ? "≥ " + kk(S.cfv.min) : ""} ${S.cfv.max != null ? "≤ " + kk(S.cfv.max) : ""}<button data-cfx="v">×</button></span> ` : "") + (tot ? `<button class="clrall" id="clrAll">Limpar filtros${tot > 1 ? " (" + tot + ")" : ""}</button>` : "");
    const c = q("clr"); if (c) c.onclick = () => { S.filter = null; S.kpi = null; render(); };
    qa("[data-cfx]").forEach((b) => (b.onclick = () => { const key = b.dataset.cfx; if (key === "v") S.cfv = {}; else delete S.cf[key]; renderTable(); }));
    const ca = q("clrAll"); if (ca) ca.onclick = () => { S.cf = {}; S.cfv = {}; S.filter = null; S.kpi = null; S.st = "all"; render(); };
    const show = a.slice(0, 400); const allSel = show.length && show.every((r) => S.sel.has(r.id));
    const H = [["", "", 0], ["dias", "Venc.", 0], ["prev", "Previsão", 0], ["emp", "Emp.", 0], ["forn", "Cliente", 0], ["cat", "Categoria", 0], ["cob", "Cobrança", 0], ["sit", "Situação", 0], ["hist", "Histórico", 0], ["bank", "Banco p/ receber", 0], ["v", "Valor", 1], ["", "", 0]];
    q("tbl").innerHTML = `<thead><tr>${H.map(([key, l, r], i) => (i === 0 ? `<th style="width:30px;cursor:default"><input type="checkbox" class="ck" id="ckAll" ${allSel ? "checked" : ""}></th>` : `<th class="${r ? "r" : ""}" ${key ? `data-k="${key}"` : ""}>${l}${sk === key && key ? (dir > 0 ? " ↑" : " ↓") : ""}${key ? `<button class="fbtn ${(key === "v" ? S.cfv.min != null || S.cfv.max != null : !!S.cf[key]) ? "on" : ""}" data-f="${key}">▾</button>` : ""}</th>`)).join("")}</tr></thead><tbody>${show.map((r) => {
      const pdias = Math.round((r.prevD - TODAY) / DAY);
      const prevCell = +r.prevD === +r.d ? '<span class="sub2">= venc.</span>' : `<span style="color:${r.prom ? "#f59e0b" : "var(--tx2)"}">${dm(r.prevD)}</span> <span class="sub2">${pdias === 0 ? "hoje" : pdias > 0 ? "+" + pdias + "d" : pdias + "d"}</span>`;
      const cob = r.bol ? `<span class="mono">${esc((r.nbol || "").slice(-6) || "—")}</span><div class="sub2">boleto${r.nf ? " · NF " + esc(r.nf) : ""}</div>` : r.tipo === "NFS" ? `<span>NF ${esc(r.nf || r.doc)}</span><div class="sub2">${esc(r.doc)}</div>` : `<span style="color:#fb923c">Sem boleto</span><div class="sub2">${esc(r.doc || r.tipo)}</div>`;
      return `<tr data-id="${r.id}" class="${S.sel.has(r.id) ? "sel" : ""}"><td><input type="checkbox" class="ck" data-id="${r.id}" ${S.sel.has(r.id) ? "checked" : ""}></td>
      <td class="${r.diasV < 0 ? "od" : r.diasV === 0 ? "td" : ""}">${dmy(r.d)} <span class="sub2">${r.diasV < 0 ? r.diasV + "d" : r.diasV === 0 ? "hoje" : ""}</span></td><td>${prevCell}</td>
      <td><span class="emp ${r.emp}">${r.emp}</span></td><td title="${esc(r.forn)} · ${esc(r.cnpj)}" style="font-weight:500">${esc(r.forn)}</td><td style="color:var(--tx2)">${esc(r.cat || "Sem categoria")}</td>
      <td>${cob}</td><td>${badge(r.st)}${r.ncob ? `<div class="sub2">cobrado ${r.ncob}x</div>` : ""}</td><td>${histTag(r)}</td>
      <td><select class="bsel ${r.bank ? (r.bank !== r.cod_cc ? "chg" : "") : "need"}" data-bk="${r.id}" title="Conta no Omie: ${esc(r.conta)}" ${PODE.baixar ? "" : "disabled"}><option value="">Escolher banco…</option>${payBanks(r.emp).map((b) => `<option value="${b.cod}" ${b.cod === r.bank ? "selected" : ""}>${esc(b.desc)}</option>`).join("")}</select></td>
      <td class="r" style="font-weight:650">${brl(r.v)}</td><td class="r">${PODE.baixar ? `<button class="btn sm">Receber</button>` : ""}</td></tr>`; }).join("")}</tbody>`;
    qa("#tbl tbody tr").forEach((tr) => (tr.onclick = (e) => { if (e.target.classList.contains("ck") || e.target.tagName === "SELECT" || e.target.tagName === "OPTION") return; openDrawer(+tr.dataset.id); }));
    qa("#tbl tbody .ck").forEach((cx) => (cx.onchange = () => { const id = +cx.dataset.id; cx.checked ? S.sel.add(id) : S.sel.delete(id); cx.closest("tr").classList.toggle("sel", cx.checked); renderAbar(); }));
    q("ckAll").onchange = (e) => { show.forEach((r) => (e.target.checked ? S.sel.add(r.id) : S.sel.delete(r.id))); renderTable(); };
    qa("#tbl .bsel").forEach((x) => { x.onclick = (e) => e.stopPropagation(); x.onchange = () => programar([rows[+x.dataset.bk]], x.value ? +x.value : null); });
    qa("#tbl .fbtn").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); openCf(b.dataset.f, b); }));
    qa("#tbl th[data-k]").forEach((h) => (h.onclick = () => { const key = h.dataset.k; S.sort = S.sort.k === key ? { k: key, dir: -S.sort.dir } : { k: key, dir: key === "v" ? -1 : 1 }; renderTable(); }));
    renderBStrip(pre);
    q("tblFoot").textContent = `${a.length} títulos · ${brl(sum(a))} · a cobrar ${brl(sum(a.filter((r) => r.st === "cobrar")))}${a.length > 400 ? " · mostrando 400" : ""}`;
    q("tcTit").textContent = pre.length; renderAbar();
  }
  async function programar(rs, cod) {
    const porEmp = {}; rs.forEach((r) => (porEmp[r.emp] = porEmp[r.emp] || []).push(r));
    try { for (const [e, lst] of Object.entries(porEmp)) { await api({ acao: "programar", ids: lst.map((r) => r.uid), empresa: e, cod_cc: cod }); lst.forEach((r) => (r.bank = cod)); } if (cod) toast(`${rs.length} título(s) → ${bankDesc(cod)}`); }
    catch (e) { toast(e.message, true); }
    renderTable(); renderBanks();
  }
  function renderBStrip(pre) {
    const g = {}; pre.forEach((r) => { const key = r.bank ? r.emp + "|" + r.bank : "none"; (g[key] = g[key] || []).push(r); }); const cur = S.cf.bank;
    const cards = Object.entries(g).sort((a, b) => (a[0] === "none" ? -1 : b[0] === "none" ? 1 : sum(b[1]) - sum(a[1]))).map(([key, rs]) => {
      if (key === "none") return `<div class="bcard none" data-b="(sem banco)"><div class="t">⚠ Sem banco definido</div><div class="v num">${brl(sum(rs))}</div><div class="s">${rs.length} títulos — escolha o banco</div></div>`;
      const [e, cod] = key.split("|"); const bk = bankOf(+cod); const nm = bk?.desc ?? cod;
      return `<div class="bcard ${cur && cur.size === 1 && cur.has(nm) ? "on" : ""}" data-b="${esc(nm)}"><div class="t"><span class="emp ${e}">${e}</span>${esc(nm)}</div><div class="v num ent">+ ${brl(sum(rs))}</div><div class="s">${rs.length} títulos · saldo hoje ${kk(bk ? bk.saldo : 0)}</div></div>`; }).join("");
    const el = q("bstrip"); el.innerHTML = cards ? `<span class="sub2" style="align-self:center;margin-right:2px">Entradas<br>por banco</span>` + cards : "";
    el.querySelectorAll(".bcard").forEach((c) => (c.onclick = () => { const b = c.dataset.b; if (S.cf.bank && S.cf.bank.size === 1 && S.cf.bank.has(b)) delete S.cf.bank; else S.cf.bank = new Set([b]); renderTable(); }));
  }
  function renderAbar() {
    const sel = rows.filter((r) => S.sel.has(r.id) && !r.paid); const b = q("abar"); b.classList.toggle("on", sel.length > 0); if (!sel.length) return;
    q("abarN").textContent = `${sel.length} selecionado${sel.length > 1 ? "s" : ""}`; q("abarV").textContent = brl(sum(sel));
    const es = EMPS.filter((e) => sel.some((r) => r.emp === e)); q("abarE").textContent = es.map((e) => `${e}: ${sel.filter((r) => r.emp === e).length}`).join(" · ");
    const ab = q("abarBank");
    ab.innerHTML = '<option value="">Definir banco p/ selecionados…</option>' + es.map((e) => `<optgroup label="${EN[e]}">${payBanks(e).map((x) => `<option value="${e}|${x.cod}">${e} · ${esc(x.desc)}</option>`).join("")}</optgroup>`).join("");
    ab.disabled = !PODE.baixar; q("abarGo").disabled = !PODE.baixar; q("abarCob").disabled = !PODE.cobrar; q("abarPrev").disabled = !PODE.cobrar;
    ab.onchange = () => { if (!ab.value) return; const [e, cod] = ab.value.split("|"); programar(sel.filter((r) => r.emp === e), +cod); };
  }

  /* DRAWER / AÇÕES */
  const ov = q("ov"), dr = q("drawer"), md = q("modal");
  function closeAll() { ov.classList.remove("on"); dr.classList.remove("on"); md.classList.remove("on"); }
  ov.onclick = closeAll;
  const pop = q("cfPop");
  const onKey = (e) => { if (e.key === "Escape") { closeAll(); pop.classList.remove("on"); } };
  document.addEventListener("keydown", onKey);
  function bankOpts(e, cur) { const bs = payBanks(e); return `<option value="">Selecione o banco…</option>` + bs.map((b) => `<option value="${b.cod}" ${b.cod === cur ? "selected" : ""}>${esc(b.desc)}</option>`).join(""); }
  function openDrawer(id) {
    const r = rows[id]; if (!r) return; hideTip();
    const st = r.diasV < 0 ? `<span class="neg">Vencido há ${-r.diasV} dias</span>` : r.diasV === 0 ? '<span style="color:#f59e0b">Vence hoje</span>' : `Vence em ${r.diasV} dias`;
    const vcls = r.st === "cobrar" ? "bloq" : r.st === "prom" || r.st === "semb" ? "nf" : r.st === "reneg" ? "dir" : "ok";
    const others = open_().filter((x) => x.forn === r.forn && x.id !== r.id);
    dr.innerHTML = `<div class="dh"><div><span class="emp ${r.emp}">${r.emp}</span> <span class="sub2" style="margin-left:6px">${EN[r.emp]}</span><h3>${esc(r.forn)}</h3><div style="font-size:12px">${st} · ${badge(r.st)}</div></div><button class="btn" id="dX" style="height:34px">✕</button></div>
    <div class="dbody">
      <div class="verdict ${vcls}"><b>${SIT[r.st].l}</b><span>${SIT[r.st].d}</span></div>
      <div class="dgrid">
        <div><span>Vencimento</span>${r.d.toLocaleDateString("pt-BR")}</div><div><span>Valor em aberto</span><b class="num" style="font-size:16px">${brl(r.v)}</b>${r.vdoc && Math.abs(r.vdoc - r.v) > 0.01 ? `<div class="sub2">documento ${brl(r.vdoc)}</div>` : ""}</div>
        <div><span>Previsão de recebimento</span>${r.prevD.toLocaleDateString("pt-BR")}${r.pOv ? ' <span class="flag">AJUSTADA</span>' : ""}</div><div><span>Histórico do cliente (12m)</span>${histTag(r)}${r.nh ? ` <span class="sub2">· ${r.nh} títulos</span>` : ""}</div>
        <div><span>Categoria</span>${esc(r.cat || "Sem categoria")}</div><div><span>Projeto / contrato</span>${esc(r.proj || "—")}</div>
        <div><span>Cobrança</span>${r.bol ? 'Boleto <span class="mono">' + esc(r.nbol || "—") + "</span>" : r.tipo === "NFS" ? "NF de serviço " + esc(r.nf || "") : '<span style="color:#fb923c">Sem boleto</span>'}</div><div><span>Doc / NF / Parcela</span>${esc(r.doc || "—")}${r.nf ? " · NF " + esc(r.nf) : ""} · ${esc(r.parc || "—")}</div>
        <div><span>CNPJ</span><span class="mono">${esc(r.cnpj || "—")}</span></div><div><span>Outros em aberto deste cliente</span>${others.length ? `${others.length} · ${brl(sum(others))}` : "nenhum"}</div>
        <div><span>Origem</span>${r.orig === "painel" ? "Conta do painel (faturamento)" : "Omie · cód. " + esc(r.cod)}</div><div><span>Pedido</span>${r.rotulo ? `<a class="link" href="/bi/rentabilidade?pedido=${encodeURIComponent(r.rotulo)}&empresa=${r.emp}">${esc(r.rotulo)} · rentabilidade →</a>` : esc(r.pedido || "—")}</div>
      </div>
      ${r.pessoa ? `<div style="margin:-6px 0 12px"><a class="link" href="/cadastros/${r.pessoa}">Ficha do cliente (histórico completo) →</a></div>` : ""}
      <div class="tabs2" id="dTabs">${PODE.baixar ? '<button data-v="rec" class="on">Receber</button>' : ""}${PODE.cobrar ? '<button data-v="prev">Alterar previsão</button><button data-v="cob">Registrar cobrança</button>' : ""}${r.bol || r.diasV < 0 ? "" : '<button data-v="bol">Emitir boleto</button>'}</div>
      <div class="box" id="dBox"></div>
      <div id="dCobH" style="margin-top:14px;font-size:12px;color:var(--tx2)"></div>
    </div>
    <div class="df" id="dFoot"></div>`;
    ov.classList.add("on"); dr.classList.add("on");
    q("dX").onclick = closeAll;
    if (r.ncob) fetch(`/api/financeiro/receber?cobrancas=${r.uid}`).then((x) => x.json()).then((j) => { const l = j.cobrancas ?? []; if (!l.length || !q("dCobH")) return; q("dCobH").innerHTML = `<b style="color:var(--tx)">Cobranças registradas</b>${l.map((c) => `<div style="padding:6px 0;border-bottom:1px solid var(--line)">${new Date(c.em).toLocaleDateString("pt-BR")} · ${esc(c.canal)}${c.contato ? " · " + esc(c.contato) : ""} · ${esc(c.nota || "—")}${c.nova_previsao ? " · nova previsão " + dm(pd(c.nova_previsao)) : ""} <span class="sub2">· ${esc(String(c.por || "").split("@")[0])}</span></div>`).join("")}`; }).catch(() => {});
    const tab = (t) => {
      qa("#dTabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === t));
      if (t === "rec") {
        q("dBox").innerHTML = `<div class="frm"><label>Data do recebimento<input type="date" id="bData" value="${iso(TODAY)}"></label><label>Recebido no banco<select id="bBanco">${bankOpts(r.emp, r.bank)}</select></label>
          <label>Valor recebido<input id="bVal" class="num" value="${fmt(r.v)}"></label><label>Desconto concedido<input id="bDesc" class="num" value="0,00"></label><label>Juros<input id="bJur" class="num" value="0,00"></label><label>Multa<input id="bMul" class="num" value="0,00"></label>
          <label class="full">Observação<input id="bObs" placeholder="Ex.: PIX, TED, comprovante"></label></div>
          <div class="tot"><span style="color:var(--tx2)">Total creditado no banco</span><b class="num ent" id="bTot" style="font-size:17px"></b></div><div id="bPart" style="font-size:12px;color:#f59e0b;margin-top:6px"></div>
          <div class="origem">${r.orig === "painel" ? "Conta do painel: a baixa vai para o livro de baixas e para a conciliação." : "Conta do Omie: o recebimento fica registado no painel (sai do “em aberto” aqui) e entra na lista “não enviado ao Omie” — o Omie não é alterado."}</div>`;
        q("dFoot").innerHTML = `<button class="btn" id="dSel">${S.sel.has(id) ? "Remover do lote" : "Adicionar ao lote"}</button><button class="btn ok" id="dOk">Confirmar recebimento</button>`;
        const calc = () => { const v = num(q("bVal").value); q("bTot").textContent = brl(v - num(q("bDesc").value) + num(q("bJur").value) + num(q("bMul").value)); q("bPart").textContent = v < r.v - 0.005 ? `Recebimento parcial: restará ${brl(r.v - v)} em aberto` : v > r.v + 0.005 ? "Valor maior que o saldo — lance a diferença em juros/multa" : ""; q("dOk").disabled = !q("bBanco").value || v <= 0 || v > r.v + 0.005; q("bBanco").classList.toggle("need", !q("bBanco").value); };
        ["bVal", "bDesc", "bJur", "bMul", "bBanco"].forEach((x) => (q(x).oninput = calc)); calc();
        q("dSel").onclick = () => { S.sel.has(id) ? S.sel.delete(id) : S.sel.add(id); closeAll(); renderTable(); };
        q("dOk").onclick = async () => { const v = num(q("bVal").value); q("dOk").disabled = true;
          try { await api({ acao: "receber", data: q("bData").value, itens: [{ id: r.uid, valor: v, cod_cc: +q("bBanco").value, desconto: num(q("bDesc").value), juros: num(q("bJur").value), multa: num(q("bMul").value), obs: q("bObs").value }] });
            closeAll(); if (v >= r.v - 0.005) r.paid = true; else r.v = +(r.v - v).toFixed(2); render(); toast(`Recebimento registrado · ${r.forn.slice(0, 28)} · ${brl(v)}`); S.sel.delete(id); await recarregarTudo(); }
          catch (e) { toast(e.message, true); q("dOk").disabled = false; } };
      } else if (t === "prev") {
        q("dBox").innerHTML = `<div class="frm"><label>Nova previsão<input type="date" id="pDate" value="${iso(new Date(Math.max(+r.prevD, +TODAY + 7 * DAY)))}"></label><label>Quem confirmou<input id="pWho" placeholder="Ex.: Ana — financeiro do cliente"></label><label class="full">Observação<input id="pObs" placeholder="Ex.: pagamento no próximo lote do hospital"></label></div><div class="sub2" style="margin-top:8px">${r.orig === "painel" ? "Grava a previsão da própria conta." : "Grava em <span class=\"mono\">finance.previsao_override</span> (fluxo de caixa e esta tela). O Omie não é alterado."}</div>`;
        q("dFoot").innerHTML = `<button class="btn" id="dRen">${r.reneg ? "Desfazer renegociado" : "Marcar renegociado"}</button><button class="btn pri" id="dOk">Salvar previsão</button>`;
        q("dOk").onclick = async () => { try { await api({ acao: "previsao", ids: [r.uid], data: q("pDate").value, obs: [q("pWho").value, q("pObs").value].filter(Boolean).join(" · ") }); closeAll(); toast(`Previsão de ${r.forn.slice(0, 26)} → ${dm(pd(q("pDate").value))}`); await recarregarTudo(); } catch (e) { toast(e.message, true); } };
        q("dRen").onclick = async () => { try { await api({ acao: "renegociar", ids: [r.uid], motivo: q("pObs").value || null, desfazer: r.reneg }); closeAll(); toast(r.reneg ? "Renegociação desfeita" : "Título marcado como renegociado"); await recarregarTudo(); } catch (e) { toast(e.message, true); } };
      } else if (t === "cob") {
        const msg = `Olá! Identificamos o título ${r.doc || ""} de ${brl(r.v)} vencido em ${r.d.toLocaleDateString("pt-BR")}${r.bol && r.nbol ? ", boleto " + r.nbol : ""}. Podemos contar com o pagamento até …?`;
        q("dBox").innerHTML = `<div class="frm"><label>Canal<select id="cCan"><option>E-mail</option><option>WhatsApp</option><option>Telefone</option><option>Portal do cliente</option></select></label><label>Contato<input id="cWho" placeholder="Nome / setor"></label><label>Nova previsão (opcional)<input type="date" id="cPrev"></label><label class="full">O que ficou combinado<input id="cNota" placeholder="Ex.: vai verificar com o contas a pagar e retorna até sexta"></label></div>
          <div class="sub2" style="margin-top:8px">Mensagem sugerida: “${esc(msg)}” — o envio é por você (o painel ainda não manda e-mail ao cliente).</div>`;
        q("dFoot").innerHTML = `<button class="btn" id="dCopy">Copiar mensagem</button><button class="btn pri" id="dOk">Registrar cobrança</button>`;
        q("dCopy").onclick = async () => { try { await navigator.clipboard.writeText(msg); toast("Mensagem copiada"); } catch { toast("Não consegui copiar — selecione o texto acima", true); } };
        q("dOk").onclick = async () => { try { await api({ acao: "cobranca", ids: [r.uid], canal: q("cCan").value, contato: q("cWho").value, nota: q("cNota").value, nova_previsao: q("cPrev").value || null }); closeAll(); toast(`Cobrança registrada · ${r.forn.slice(0, 28)}`); await recarregarTudo(); } catch (e) { toast(e.message, true); } };
      } else {
        q("dBox").innerHTML = `<div class="sub2">Emissão de boleto <b>em breve</b>: hoje o boleto nasce no Omie (GerarBoleto) e o painel não escreve no Omie. Fica para quando a API de cobrança do banco (C6/Bradesco) estiver liberada.</div><div class="frm" style="margin-top:10px"><label>Conta de cobrança<select disabled>${bankOpts(r.emp, r.bank)}</select></label><label>Enviar para<input disabled placeholder="financeiro@cliente.com.br"></label></div>`;
        q("dFoot").innerHTML = `<button class="btn pri" disabled>Emitir boleto (em breve)</button>`;
      }
    };
    qa("#dTabs button").forEach((b) => (b.onclick = () => tab(b.dataset.v)));
    tab(PODE.baixar ? "rec" : PODE.cobrar ? "prev" : "bol");
  }
  function openCob(ids) {
    const rs = ids.map((i) => rows[i]).filter(Boolean); if (!rs.length) return; const r = rs[0];
    md.innerHTML = `<div class="dh"><div><h3 style="margin:0">Registrar cobrança · ${esc(r.forn)}${rs.some((x) => x.forn !== r.forn) ? " e outros" : ""}</h3><div class="sub2" style="margin-top:3px">${rs.length} títulos · ${brl(sum(rs))}</div></div><button class="btn" id="mX" style="height:34px">✕</button></div>
    <div class="dbody"><div class="frm"><label>Canal<select id="cCan"><option>E-mail</option><option>WhatsApp</option><option>Telefone</option><option>Portal do cliente</option></select></label><label>Nova previsão (opcional)<input type="date" id="cPrev"></label><label>Contato<input id="cWho" placeholder="Nome / setor"></label><label>O que ficou combinado<input id="cNota" placeholder="Ex.: paga tudo no dia 15"></label></div>
    <div class="gl" style="margin-top:12px;border:1px solid var(--line2);border-radius:10px">${rs.map((x) => `<div><span class="num ${x.diasV < 0 ? "neg" : ""}">${dm(x.d)}</span><span>${esc(x.forn.slice(0, 26))} · ${esc(x.cat)} ${x.nf ? "· NF " + esc(x.nf) : ""}</span><span class="num" style="text-align:right">${brl(x.v)}</span></div>`).join("")}</div></div>
    <div class="df"><button class="btn" id="mC">Cancelar</button><button class="btn pri" id="mOk">Registrar</button></div>`;
    ov.classList.add("on"); md.classList.add("on");
    q("mX").onclick = q("mC").onclick = closeAll;
    q("mOk").onclick = async () => { const np = q("cPrev").value; try { await api({ acao: "cobranca", ids: rs.map((x) => x.uid), canal: q("cCan").value, contato: q("cWho").value, nota: q("cNota").value, nova_previsao: np || null }); closeAll(); toast(`Cobrança registrada em ${rs.length} títulos${np ? " · previsão " + dm(pd(np)) : ""}`); S.sel.clear(); await recarregarTudo(); } catch (e) { toast(e.message, true); } };
  }
  q("abarClr").onclick = () => { S.sel.clear(); renderTable(); };
  q("abarCob").onclick = () => openCob([...S.sel].filter((i) => !rows[i]?.paid));
  q("abarPrev").onclick = () => openCob([...S.sel].filter((i) => !rows[i]?.paid));
  q("abarGo").onclick = () => {
    const sel = rows.filter((r) => S.sel.has(r.id) && !r.paid); const groups = EMPS.filter((e) => sel.some((r) => r.emp === e));
    md.innerHTML = `<div class="dh"><div><h3 style="margin:0">Receber em lote</h3><div class="sub2" style="margin-top:3px">${sel.length} títulos · ${brl(sum(sel))} · valor integral</div></div><button class="btn" id="mX" style="height:34px">✕</button></div>
    <div class="dbody"><div class="frm" style="margin-bottom:14px"><label>Data do recebimento<input type="date" id="lData" value="${iso(TODAY)}"></label><label>Observação<input id="lObs" placeholder="Ex.: retorno CNAB 05/10"></label></div>
    ${groups.map((e) => { const rs = sel.filter((r) => r.emp === e); const common = [...new Set(rs.map((r) => r.bank).filter(Boolean))];
      return `<div class="grp"><div class="grph"><span class="emp ${e}">${e}</span><b>${EN[e]}</b><span class="sub2">${rs.length} títulos · <b class="num" style="color:var(--tx)">${brl(sum(rs))}</b></span><select data-e="${e}" class="lb">${bankOpts(e, common.length === 1 ? common[0] : null)}</select></div>
      <div class="gl">${rs.map((r) => `<div><span class="num ${r.diasV < 0 ? "neg" : ""}">${dm(r.d)}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.forn)} <span class="sub2">· ${esc(r.cat)}</span></span><span class="num" style="text-align:right">${brl(r.v)}</span></div>`).join("")}</div></div>`; }).join("")}
    <div class="origem">Contas do Omie ficam recebidas no painel e na lista “não enviado ao Omie” (Baixas de hoje → exportar). O Omie não é alterado.</div></div>
    <div class="df"><button class="btn" id="mC">Cancelar</button><button class="btn ok" id="mOk">Confirmar ${sel.length} recebimentos</button></div>`;
    ov.classList.add("on"); md.classList.add("on");
    const chk = () => { const okk = sel.length && [...md.querySelectorAll(".lb")].every((s) => s.value); md.querySelectorAll(".lb").forEach((s) => s.classList.toggle("need", !s.value)); q("mOk").disabled = !okk; };
    md.querySelectorAll(".lb").forEach((s) => (s.onchange = chk)); chk();
    q("mX").onclick = q("mC").onclick = closeAll;
    q("mOk").onclick = async () => { const bk = {}; md.querySelectorAll(".lb").forEach((s) => (bk[s.dataset.e] = +s.value)); q("mOk").disabled = true;
      try { await api({ acao: "receber", lote: true, data: q("lData").value, obs: q("lObs").value, itens: sel.map((r) => ({ id: r.uid, valor: r.v, cod_cc: bk[r.emp] })) }); closeAll(); sel.forEach((r) => (r.paid = true)); render(); toast(`${sel.length} recebimentos registrados · ${brl(sum(sel))}`); S.sel.clear(); await recarregarTudo(); }
      catch (e) { toast(e.message, true); q("mOk").disabled = false; } };
  };

  /* FILTRO EXCEL */
  const onMouseDown = (e) => { if (pop.classList.contains("on") && !pop.contains(e.target) && !e.target.classList.contains("fbtn")) pop.classList.remove("on"); };
  document.addEventListener("mousedown", onMouseDown);
  function openCf(key, btn) {
    const rc = btn.getBoundingClientRect(); pop.style.position = "fixed"; pop.style.left = Math.min(rc.left - 10, innerWidth - 290) + "px"; pop.style.top = rc.bottom + 6 + "px";
    const sortBtns = `<div class="srt"><button data-s="1">${key === "v" ? "Menor → maior" : "A → Z"}</button><button data-s="-1">${key === "v" ? "Maior → menor" : "Z → A"}</button></div>`;
    if (key === "v") pop.innerHTML = `${sortBtns}<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0"><label class="sub2">Mínimo<input type="number" id="cfMin" value="${S.cfv.min ?? ""}"></label><label class="sub2">Máximo<input type="number" id="cfMax" value="${S.cfv.max ?? ""}"></label></div><div class="acts2"><button class="btn sm" id="cfClr">Limpar</button><button class="btn pri sm" id="cfOk">Aplicar</button></div>`;
    else { const vals = {}; tblBase().filter((r) => cfOk(r, key)).forEach((r) => { const v = COLV[key](r); vals[v] = (vals[v] || 0) + 1; });
      const list = Object.entries(vals); list.sort(["dias", "prev"].includes(key) ? (a, b) => { const p = (x) => x[0].split("/").reverse().join(""); return p(a).localeCompare(p(b)); } : (a, b) => a[0].localeCompare(b[0]));
      const cur = S.cf[key];
      pop.innerHTML = `${sortBtns}<input type="text" id="cfQ" placeholder="Pesquisar ${COLN[key].toLowerCase()}…"><div class="cflist" id="cfL"><label><input type="checkbox" class="ck" id="cfAll"><span><b>(Selecionar tudo)</b></span></label>${list.map(([v, c]) => `<label data-v="${esc(v)}"><input type="checkbox" class="ck cfv" value="${esc(v)}" ${!cur || cur.has(v) ? "checked" : ""}><span title="${esc(v)}">${esc(v)}</span><small>${c}</small></label>`).join("")}</div><div class="acts2"><button class="btn sm" id="cfClr">Limpar filtro</button><button class="btn pri sm" id="cfOk">Aplicar</button></div>`;
      const boxes = () => [...pop.querySelectorAll(".cfv")].filter((b) => b.closest("label").style.display !== "none");
      const syncAll = () => { const b = boxes(); q("cfAll").checked = b.length && b.every((x) => x.checked); };
      q("cfAll").onchange = (e) => boxes().forEach((b) => (b.checked = e.target.checked));
      pop.querySelectorAll(".cfv").forEach((b) => (b.onchange = syncAll));
      q("cfQ").oninput = (e) => { const qq = e.target.value.toLowerCase(); pop.querySelectorAll("#cfL label[data-v]").forEach((l) => { const m = l.dataset.v.toLowerCase().includes(qq); l.style.display = m ? "" : "none"; if (qq) l.querySelector("input").checked = m; }); syncAll(); };
      syncAll(); setTimeout(() => q("cfQ")?.focus(), 10); }
    pop.classList.add("on");
    pop.querySelectorAll("[data-s]").forEach((b) => (b.onclick = () => { S.sort = { k: key, dir: +b.dataset.s }; pop.classList.remove("on"); renderTable(); }));
    q("cfClr").onclick = () => { if (key === "v") S.cfv = {}; else delete S.cf[key]; pop.classList.remove("on"); renderTable(); };
    q("cfOk").onclick = () => { if (key === "v") { const mn = q("cfMin").value, mx = q("cfMax").value; S.cfv = { min: mn === "" ? null : +mn, max: mx === "" ? null : +mx }; if (S.cfv.min == null && S.cfv.max == null) S.cfv = {}; }
      else { const all = [...pop.querySelectorAll(".cfv")]; const on = all.filter((b) => b.checked && b.closest("label").style.display !== "none").map((b) => b.value); if (on.length === all.length) delete S.cf[key]; else S.cf[key] = new Set(on); }
      pop.classList.remove("on"); renderTable(); };
    pop.onkeydown = (e) => { if (e.key === "Enter") q("cfOk").click(); };
  }

  /* CONCILIAÇÃO OFX (créditos) */
  const norm = (s) => String(s ?? "").toUpperCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const estado = (m) => (m.ignorado ? "ign" : m.casado >= m.v - 0.004 ? "done" : "new");
  function candidates(m) {
    const resto = m.v - m.casado; const memo = norm(m.memo);
    if (resto < 50 && /REND/.test(memo)) return [];
    const bank = bankOf(S.ofxBank); const op = open_().filter((r) => !bank || r.emp === bank.emp);
    const dig = memo.replace(/\D/g, " ");
    const bm = op.find((r) => r.nbol && r.nbol.length >= 8 && dig.includes(r.nbol.replace(/^0+/, "").slice(-10)));
    if (bm) return [{ ids: [bm.id], sc: 100, why: "nosso número no extrato", dif: +(resto - bm.v).toFixed(2) }].filter((c) => c.dif > -0.02);
    const words = memo.split(/\s+/).filter((w) => w.length > 4 && !["RECEBIDA", "RECEBIDO", "COBRANCA", "DEPOSITO", "DINHEIRO", "TRANSFERENCIA", "LIQUIDACAO"].includes(w));
    const nameHit = (r) => words.some((w) => norm(r.forn).includes(w));
    const c = op.filter((r) => Math.abs(r.v - resto) < 0.02).map((r) => ({ ids: [r.id], sc: Math.max(50, (nameHit(r) ? 95 : 70) - Math.min(30, Math.abs(r.diasV))), why: nameHit(r) ? "valor + nome do pagador" : "valor exato", dif: 0 }));
    if (!c.length) { const by = {}; op.filter(nameHit).forEach((r) => (by[r.forn] = by[r.forn] || []).push(r));
      for (const rs of Object.values(by)) for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) if (Math.abs(rs[i].v + rs[j].v - resto) < 0.02) c.push({ ids: [rs[i].id, rs[j].id], sc: 90, why: "soma de 2 títulos do mesmo cliente", dif: 0 }); }
    return c.sort((a, b) => b.sc - a.sc).slice(0, 6);
  }
  function renderConc() {
    const el = q("pConc"); const bank = bankOf(S.ofxBank);
    q("tcConc").textContent = PODE.conciliar ? MOV.filter((m) => estado(m) === "new").length : "—";
    if (!PODE.conciliar) { el.innerHTML = '<div class="sub2" style="padding:20px">Sem permissão para conciliação (financeiro.conciliar).</div>'; return; }
    const bankSel = `<select id="cBank" class="bsel" style="max-width:280px">${BANKS.filter((b) => ["CC", "CA", "PG"].includes(b.tipo)).map((b) => `<option value="${b.cod}" ${b.cod === S.ofxBank ? "selected" : ""}>${b.emp} · ${esc(b.desc)}${b.pend ? ` (${b.pend})` : ""}</option>`).join("")}</select>`;
    MOV.forEach((m) => { m.c = estado(m) === "new" ? candidates(m) : []; if ((m.pick == null || m.pick >= m.c.length) && m.c.length) m.pick = 0; });
    const sug = MOV.filter((m) => estado(m) === "new" && m.c.length);
    el.innerHTML = `<div class="drop" style="padding:12px 16px"><div><b>Créditos do extrato</b> <span class="sub2">· ${bank ? bank.emp + " · " + esc(bank.desc) : "—"} · últimos 90 dias · ${MOV.length} créditos</span></div><div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">${bankSel}<label class="btn sm" style="cursor:pointer">Importar .ofx<input type="file" id="cFile" accept=".ofx,.OFX" style="display:none"></label><button class="btn ok sm" id="cAll" ${sug.length ? "" : "disabled"}>Conciliar ${sug.length} sugestões</button></div></div>
    <div class="cstats"><div class="cst"><b class="num ent">${brl(MOV.reduce((s, m) => s + m.v, 0))}</b>${MOV.length} créditos</div><div class="cst"><b class="num" style="color:#22c55e">${MOV.filter((m) => estado(m) === "done").length}</b>conciliados</div><div class="cst"><b class="num" style="color:#f59e0b">${sug.length}</b>com sugestão</div><div class="cst"><b class="num">${MOV.filter((m) => estado(m) === "new" && !m.c.length).length}</b>sem título</div></div>
    ${!MOVLOAD ? '<div class="carregando">Carregando extrato…</div>' : !MOV.length ? '<div class="sub2" style="padding:16px">Nenhum crédito importado nesta conta nos últimos 90 dias — importe o OFX do banco.</div>' : `<div class="tbl" style="max-height:600px"><div class="mrow h"><span>Data</span><span>Extrato (OFX)</span><span style="text-align:right">Valor</span><span></span><span>Título(s) sugerido(s)</span><span style="text-align:right">Ação</span></div>
    ${MOV.map((m, ix) => { const c = m.c || []; let right = "", act = ""; const est = estado(m);
      if (est === "done") { right = `<div class="cand"><span class="f">${(m.baixas || []).map((b) => esc(b.contraparte || b.documento || "—")).join(" + ")}</span><span class="sub2">${(m.baixas || []).length} baixa(s)${(m.baixas || []).some((b) => Number(b.juros) > 0) ? " · com juros/multa" : ""}</span></div>`; act = `<span class="bdg b-pago">Conciliado · recebido</span><button class="btn sm" data-undo="${ix}">Desfazer</button>`; }
      else if (est === "ign") { right = `<span class="sub2">${esc(m.motivo)}</span>`; act = `<button class="btn sm" data-reat="${ix}">Desfazer</button>`; }
      else if (c.length) { const p = c[m.pick] || c[0]; const rs = p.ids.map((i) => rows[i]);
        const desc = rs.map((r) => `${esc(r.forn.slice(0, 30))} · venc ${dm(r.d)} · ${brl(r.v)}`).join("<br>");
        right = `<div class="cand">${c.length > 1 ? `<select data-pick="${ix}">${c.map((x, j) => `<option value="${j}" ${j === m.pick ? "selected" : ""}>${x.ids.map((i) => rows[i].forn.slice(0, 26) + " · venc " + dm(rows[i].d)).join(" + ")}</option>`).join("")}</select><span class="sub2">${c.length} títulos possíveis — confira o pagador</span>` : `<span class="f">${desc} <span class="score ${p.sc < 85 ? "mid" : ""}">${p.sc}%</span></span><span class="sub2">${p.why}${p.dif > 0 ? ` · <span style="color:#f59e0b">pago ${brl(p.dif)} a mais → juros/multa</span>` : ""}</span>`}</div>`;
        act = `<button class="btn sm" data-ign="${ix}" data-mot="Ignorado manualmente">Ignorar</button><button class="btn ok sm" data-ok="${ix}">Conciliar</button>`; }
      else if (/REND/.test(norm(m.memo))) { right = `<div class="cand"><span class="f">Rendimento de aplicação</span><span class="sub2">Não é contas a receber — lançar como receita financeira</span></div>`; act = `<button class="btn sm" data-ign="${ix}" data-mot="Lançado como rendimento">Lançar rendimento</button>`; }
      else { right = `<span class="sub2">Nenhum título em aberto bate com este crédito${m.casado > 0 ? ` (restam ${brl(m.v - m.casado)})` : ""}</span>`; act = `<button class="btn sm" data-ign="${ix}" data-mot="Transferência entre contas próprias">Transferência</button><button class="btn sm" data-ign="${ix}" data-mot="Crédito sem título — identificar pagador">Identificar depois</button>`; }
      return `<div class="mrow ${est === "done" ? "done" : est === "ign" ? "ign" : ""}"><span class="num">${dm(pd(m.data))}</span><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(m.memo)}">${esc(m.memo)}</span><span class="num ent" style="text-align:right;font-weight:650">+ ${brl(m.v)}</span><span class="arr">→</span>${right}<span class="acts">${act}</span></div>`; }).join("")}</div>`}`;
    q("cBank").onchange = async (e) => { S.ofxBank = +e.target.value; MOVLOAD = false; renderConc(); await carregarMov(); renderConc(); };
    q("cFile").onchange = async (e) => { const f = e.target.files?.[0]; if (!f || !bank) return; const fd = new FormData(); fd.append("arquivo", f); fd.append("empresa", bank.emp); fd.append("cod_cc", String(bank.cod));
      try { const r = await fetch("/api/financeiro/ofx", { method: "POST", body: fd }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status); toast(`OFX importado: ${j.novos ?? 0} novos · ${j.duplicados ?? 0} já existiam`); await recarregarTudo(); } catch (er) { toast(er.message, true); } };
    const conc = async (m) => { const p = m.c[m.pick] || m.c[0]; const rs = p.ids.map((i) => rows[i]);
      await api({ acao: "conciliar", movimento_id: m.id, itens: rs.map((r, j) => ({ id: r.uid, valor: r.v, juros: j === 0 && p.dif > 0 ? p.dif : 0 })) }); };
    q("cAll").onclick = async () => { const used = new Set(); let n = 0, falhas = 0; q("cAll").disabled = true;
      for (const m of sug) { const p = m.c[m.pick] || m.c[0]; if (p.ids.some((i) => used.has(i))) continue; p.ids.forEach((i) => used.add(i)); try { await conc(m); n++; } catch { falhas++; } }
      toast(`${n} créditos conciliados${falhas ? ` · ${falhas} com erro` : ""}`, falhas > 0); await recarregarTudo(); };
    el.querySelectorAll("[data-ok]").forEach((b) => (b.onclick = async () => { const m = MOV[+b.dataset.ok]; b.disabled = true; try { await conc(m); toast("Conciliado · recebimento baixado"); await recarregarTudo(); } catch (e) { toast(e.message, true); b.disabled = false; } }));
    el.querySelectorAll("[data-ign]").forEach((b) => (b.onclick = async () => { const m = MOV[+b.dataset.ign]; try { await api({ acao: "ignorar", movimento_id: m.id, ignorar: true, motivo: b.dataset.mot }); await carregarMov(); render(); } catch (e) { toast(e.message, true); } }));
    el.querySelectorAll("[data-reat]").forEach((b) => (b.onclick = async () => { const m = MOV[+b.dataset.reat]; try { await api({ acao: "ignorar", movimento_id: m.id, ignorar: false }); await carregarMov(); render(); } catch (e) { toast(e.message, true); } }));
    el.querySelectorAll("[data-undo]").forEach((b) => (b.onclick = async () => { const m = MOV[+b.dataset.undo]; try { await api({ acao: "desfazer", movimento_id: m.id }); toast("Conciliação desfeita — recebimentos estornados"); await recarregarTudo(); } catch (e) { toast(e.message, true); } }));
    el.querySelectorAll("[data-pick]").forEach((s) => (s.onchange = () => { MOV[+s.dataset.pick].pick = +s.value; renderConc(); }));
  }

  /* BAIXAS DE HOJE */
  function renderHist() {
    q("tcHist").textContent = BAIXAS.length;
    const omie = BAIXAS.filter((b) => b.omie_status === "nao_enviado").length;
    q("pHist").innerHTML = `<div class="tbar"><span class="sub2">Recebimentos registados hoje no painel (manual, lote e extrato).${omie ? ` <b style="color:#f59e0b">${omie}</b> de contas do Omie ainda não lançados lá.` : ""}</span><span style="margin-left:auto"></span><button class="btn sm" id="hOmie">Exportar pendentes no Omie (CSV)</button></div>` +
      (BAIXAS.length ? `<div class="tbl"><table class="num"><thead><tr><th>Hora</th><th>Emp.</th><th>Cliente</th><th>Documento</th><th>Banco</th><th>Origem</th><th>Omie</th><th class="r">Valor</th><th></th></tr></thead><tbody>${BAIXAS.map((b) => `<tr><td>${new Date(b.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td><td><span class="emp ${b.empresa}">${b.empresa}</span></td><td>${esc(b.contraparte)}</td><td class="mono">${esc(b.documento)}</td><td>${esc(b.conta ?? b.cod_cc)}</td><td style="color:var(--tx2)">${esc(b.origem)}${b.lote_id ? " · lote " + b.lote_id : ""}${Number(b.juros) + Number(b.multa) > 0 ? " · +" + brl(Number(b.juros) + Number(b.multa)) : ""}</td><td>${b.omie_status === "nao_enviado" ? '<span class="bdg omie-nao">não enviado</span>' : '<span class="sub2">— (painel)</span>'}</td><td class="r ent">+ ${brl(Number(b.valor))}</td><td class="r">${PODE.baixar ? `<button class="btn sm danger" data-est="${b.id}">Estornar</button>` : ""}</td></tr>`).join("")}</tbody></table></div>`
        : '<div style="padding:24px;color:var(--tx3)">Nenhum recebimento registado hoje. Baixas manuais, em lote e por extrato aparecem aqui com o estado no Omie.</div>');
    q("hOmie").onclick = async () => { const r = await fetch("/api/financeiro/receber?baixas=omie", { cache: "no-store" }); const j = await r.json().catch(() => ({})); const l = j.baixas ?? []; if (!l.length) { toast("Nenhum recebimento de conta do Omie pendente"); return; }
      csv("recebimentos-pendentes-omie.csv", [["empresa", "cod_titulo_omie", "cliente", "documento", "data_recebimento", "valor", "desconto", "juros", "multa", "banco", "origem", "observacao"], ...l.map((b) => [b.empresa, b.cod_titulo, b.contraparte, b.documento, b.data, b.valor, b.desconto, b.juros, b.multa, b.conta, b.origem, b.observacao])]); };
    qa("#pHist [data-est]").forEach((bt) => (bt.onclick = () => estornar(+bt.dataset.est)));
  }
  function estornar(id) {
    md.innerHTML = `<div class="dh"><div><h3 style="margin:0">Estornar recebimento #${id}</h3><div class="sub2" style="margin-top:3px">A conta volta a ficar em aberto. Se veio do extrato, o crédito volta a pendente.</div></div><button class="btn" id="mX" style="height:34px">✕</button></div><div class="dbody"><label class="sub2">Motivo<input class="mtxt" id="eMot" placeholder="Ex.: lançado em duplicidade"></label></div><div class="df"><button class="btn" id="mC">Cancelar</button><button class="btn danger" id="mOk" disabled>Estornar</button></div>`;
    ov.classList.add("on"); md.classList.add("on"); q("mX").onclick = q("mC").onclick = closeAll;
    q("eMot").oninput = () => (q("mOk").disabled = q("eMot").value.trim().length < 3);
    q("mOk").onclick = async () => { try { await api({ acao: "estornar", baixa_id: id, motivo: q("eMot").value }); closeAll(); toast("Recebimento estornado"); await recarregarTudo(); } catch (e) { toast(e.message, true); } };
  }
  function csv(nome, linhas) {
    const t = linhas.map((l) => l.map((c) => { const s = String(c ?? ""); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(";")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["﻿" + t], { type: "text/csv;charset=utf-8" })); a.download = nome; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  q("tCsv").onclick = () => csv(`titulos-a-receber-${iso(TODAY)}.csv`, [["vencimento", "previsao", "empresa", "cliente", "cnpj", "categoria", "projeto", "documento", "parcela", "nf", "boleto", "situacao", "historico", "banco_programado", "valor_aberto", "origem", "pedido"],
    ...tblAtual.map((r) => [r.venc, iso(r.prevD), r.emp, r.forn, r.cnpj, r.cat, r.proj, r.doc, r.parc, r.nf, r.nbol, SIT[r.st].l, histLbl(r), bankDesc(r.bank), String(r.v).replace(".", ","), r.orig, r.rotulo || r.pedido])]);

  function renderTabs() { qa("#wsTabs button").forEach((b) => b.classList.toggle("on", b.dataset.v === S.tab)); q("pTit").style.display = S.tab === "tit" ? "" : "none"; q("pConc").style.display = S.tab === "conc" ? "" : "none"; q("pHist").style.display = S.tab === "hist" ? "" : "none"; }
  qa("#wsTabs button").forEach((b) => (b.onclick = () => { S.tab = b.dataset.v; render(); }));
  const goOfx = () => { S.tab = "conc"; render(); goTable(); }; q("hdrOfx").onclick = goOfx; q("bkOfx").onclick = goOfx;
  q("hdrNova").onclick = () => o.onNovaConta();
  const hs = q("hdrSync"); if (!o.admin) hs.classList.add("hidden");
  hs.onclick = async () => { hs.disabled = true; hs.textContent = "Disparando…";
    try { const r = await fetch("/api/admin/run-workflow", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tool: "finance", kind: "diaria" }) }); const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "HTTP " + r.status); toast("Sync do Omie disparado — recarregue em alguns minutos"); }
    catch (e) { toast(e.message, true); } finally { hs.disabled = false; hs.textContent = "Sincronizar"; } };

  function render() {
    q("hoje").textContent = TODAY.toLocaleDateString("pt-BR");
    q("cpErro").innerHTML = erro ? `<div class="erro">${esc(erro)}</div>` : "";
    q("cpCarregando").classList.toggle("hidden", !carregando); q("cpCorpo").classList.toggle("hidden", carregando);
    if (carregando) return;
    q("hdrNova").classList.toggle("hidden", !PODE.incluir);
    renderKpis(); renderAgenda(); renderBanks(); renderVenc(); renderTable(); renderConc(); renderHist(); renderTabs();
  }
  seg("empSeg", "emp", () => { S.rkOpen = null; }); seg("baseSeg", "base", () => { S.agSel = 0; }); seg("agMode", "agMode", () => (S.agSel = 0));
  seg("vcEmp", "vcEmp", () => { S.vcCut = null; S.rkOpen = null; }); seg("vcRange", "vcRange", () => { S.vcCut = null; S.rkOpen = null; }, 1); seg("rkDim", "rkDim", () => (S.rkOpen = null));
  seg("tPer", "per", () => { S.filter = null; S.kpi = null; S.st = "all"; });
  q("q").oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); render(); };

  render();
  (async () => { await carregar(); await Promise.all([carregarMov(), carregarBaixas()]); if (vivo) render(); })();
  return { recarregar: recarregarTudo, destruir() { vivo = false; document.removeEventListener("mousedown", onMouseDown); document.removeEventListener("keydown", onKey); } };
}

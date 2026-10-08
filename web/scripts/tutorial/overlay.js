// Overlay de tutorial (08/10/26) — colado no console/Chrome MCP antes de cada captura.
// window.__tut.passo({ sel | texto, legenda, fala, n, total, titulo })
//   sel: seletor CSS do elemento a destacar; ou texto: procura botão/link/aba com esse texto.
//   Sem sel/texto: só legenda + fala (tela inteira).
(() => {
  if (!document.getElementById("__tut_css")) {
    const css = document.createElement("style"); css.id = "__tut_css";
    css.textContent = `
      #__tut_ring{position:fixed;z-index:2147483646;border:3px solid #f5b547;border-radius:10px;box-shadow:0 0 0 6px rgba(245,181,71,.28),0 0 0 9999px rgba(5,12,26,.38);pointer-events:none}
      #__tut_cur{position:fixed;z-index:2147483647;width:24px;height:24px;border-radius:50%;background:rgba(110,168,255,.6);border:2px solid #fff;pointer-events:none;transform:translate(-50%,-50%)}
      #__tut_fala{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483647;max-width:min(1100px,92vw);width:max-content;background:rgba(8,14,28,.92);color:#fff;border-radius:12px;padding:12px 20px;font:500 19px/1.4 -apple-system,system-ui,sans-serif;text-align:center;pointer-events:none;box-shadow:0 8px 30px rgba(0,0,0,.35)}
      #__tut_leg{position:fixed;left:50%;transform:translateX(-50%);z-index:2147483647;background:#0c1830;color:#fff;border:1.5px solid #f5b547;border-radius:999px;padding:7px 16px;font:650 15px -apple-system,system-ui,sans-serif;pointer-events:none;white-space:nowrap}
      #__tut_top{position:fixed;top:12px;right:16px;z-index:2147483647;background:#f5b547;color:#0c1830;border-radius:999px;padding:5px 12px;font:700 13px -apple-system,system-ui,sans-serif;pointer-events:none}`;
    document.documentElement.appendChild(css);
  }
  const el = (id) => document.getElementById(id) || document.body.appendChild(Object.assign(document.createElement("div"), { id }));
  const limpar = () => ["__tut_ring", "__tut_cur", "__tut_fala", "__tut_leg", "__tut_top"].forEach((id) => document.getElementById(id)?.remove());
  const achar = (texto) => {
    const t = texto.toLowerCase();
    const cands = [...document.querySelectorAll("button,a,[role=tab],[role=button],label,th,h1,h2,h3,summary")]
      .filter((e) => e.offsetParent !== null && (e.innerText || "").toLowerCase().includes(t));
    cands.sort((a, b) => (a.innerText || "").length - (b.innerText || "").length);
    return cands[0] || null;
  };
  window.__tut = {
    limpar,
    passo({ sel, texto, legenda, fala, n, total, titulo }) {
      limpar();
      const alvo = sel ? document.querySelector(sel) : texto ? achar(texto) : null;
      if (alvo) {
        alvo.scrollIntoView({ block: "center", inline: "nearest" });
        const r = alvo.getBoundingClientRect();
        Object.assign(el("__tut_ring").style, { left: r.left - 6 + "px", top: r.top - 6 + "px", width: r.width + 12 + "px", height: r.height + 12 + "px" });
        Object.assign(el("__tut_cur").style, { left: r.left + r.width / 2 + "px", top: r.top + r.height / 2 + "px" });
      }
      if (fala) el("__tut_fala").textContent = fala;
      if (legenda) {
        const l = el("__tut_leg"); l.textContent = legenda;
        const fh = document.getElementById("__tut_fala")?.getBoundingClientRect().height || 0;
        l.style.bottom = 22 + fh + 12 + "px";
      }
      if (n) el("__tut_top").textContent = `${titulo ? titulo + " · " : ""}passo ${n}${total ? " de " + total : ""}`;
      return alvo ? (alvo.innerText || alvo.getAttribute("aria-label") || alvo.tagName).slice(0, 60) : (sel || texto ? "NÃO ACHEI" : "tela");
    },
  };
  return "overlay pronto";
})();

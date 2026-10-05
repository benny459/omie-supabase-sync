// Aparência por usuário (05/10/26) — modo, paleta, vidro, fundo, densidade e
// fonte. O mesmo ficheiro existe no portal e nos Serviços: a preferência é
// uma só e vive em platform.aparencia_usuario (cache em localStorage).
// O script do <head> (SCRIPT_APARENCIA) aplica antes da primeira pintura.

export type Modo = "claro" | "escuro" | "sistema";
export type Paleta = "blue" | "teal" | "violet" | "indigo" | "esmeralda" | "ametista" | "grafite" | "ambar";
export type Fundo = "solido" | "gradiente" | "padrao" | "aurora" | "malha" | "cor";

export type Aparencia = {
  modo: Modo;
  paleta: Paleta;
  vidro: number;        // 0–100
  fundo: Fundo;
  fundoCor: string;     // #rrggbb, usado quando fundo = "cor"
  densidade: "conforto" | "compacta";
  fonte: 90 | 100 | 110;
};

export const PADRAO: Aparencia = {
  modo: "escuro", paleta: "blue", vidro: 0, fundo: "solido", fundoCor: "#0a1628", densidade: "conforto", fonte: 100,
};

export const PALETAS: { id: Paleta; nome: string; cor: string }[] = [
  { id: "blue", nome: "Azul (Midnight)", cor: "#3b82f6" },
  { id: "indigo", nome: "Índigo", cor: "#6366f1" },
  { id: "violet", nome: "Violeta", cor: "#8b5cf6" },
  { id: "ametista", nome: "Ametista", cor: "#c026d3" },
  { id: "teal", nome: "Turquesa", cor: "#14b8a6" },
  { id: "esmeralda", nome: "Esmeralda", cor: "#10b981" },
  { id: "ambar", nome: "Âmbar", cor: "#f59e0b" },
  { id: "grafite", nome: "Grafite", cor: "#94a3b8" },
];

export const FUNDOS: { id: Fundo; nome: string }[] = [
  { id: "solido", nome: "Sólido" },
  { id: "gradiente", nome: "Gradiente" },
  { id: "aurora", nome: "Aurora" },
  { id: "malha", nome: "Malha" },
  { id: "padrao", nome: "Pontilhado" },
  { id: "cor", nome: "Cor própria" },
];

export const LS_APARENCIA = "allka-aparencia";

export function normalizar(x: unknown): Aparencia {
  const o = (x && typeof x === "object" ? x : {}) as Partial<Aparencia>;
  const ok = <T,>(v: unknown, lista: readonly T[], d: T) => (lista.includes(v as T) ? (v as T) : d);
  return {
    modo: ok(o.modo, ["claro", "escuro", "sistema"] as const, PADRAO.modo),
    paleta: ok(o.paleta, PALETAS.map((p) => p.id), PADRAO.paleta),
    vidro: Math.max(0, Math.min(100, Number.isFinite(Number(o.vidro)) ? Math.round(Number(o.vidro)) : 0)),
    fundo: ok(o.fundo, FUNDOS.map((f) => f.id), PADRAO.fundo),
    fundoCor: /^#[0-9a-f]{6}$/i.test(String(o.fundoCor ?? "")) ? String(o.fundoCor) : PADRAO.fundoCor,
    densidade: ok(o.densidade, ["conforto", "compacta"] as const, PADRAO.densidade),
    fonte: ok(Number(o.fonte), [90, 100, 110] as const, PADRAO.fonte),
  };
}

/** Aplica no <html>. Igual à lógica do SCRIPT_APARENCIA (mantenha os dois em sincronia). */
export function aplicar(a: Aparencia) {
  if (typeof document === "undefined") return;
  const h = document.documentElement;
  const escuro = a.modo === "escuro" || (a.modo === "sistema" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  h.classList.toggle("dark", escuro);
  h.style.colorScheme = escuro ? "dark" : "light";
  if (a.paleta === "blue") h.removeAttribute("data-paleta"); else h.setAttribute("data-paleta", a.paleta);
  if (a.vidro > 0) {
    h.setAttribute("data-vidro", "");
    h.style.setProperty("--ap-a", String(1 - (a.vidro / 100) * 0.6));
    h.style.setProperty("--ap-blur", `${Math.round(4 + (a.vidro / 100) * 16)}px`);
  } else {
    h.removeAttribute("data-vidro"); h.style.removeProperty("--ap-a"); h.style.removeProperty("--ap-blur");
  }
  if (a.fundo === "solido") h.removeAttribute("data-fundo"); else h.setAttribute("data-fundo", a.fundo);
  h.style.setProperty("--ap-fundo-cor", a.fundoCor);
  if (a.densidade === "compacta") h.setAttribute("data-densidade", "compacta"); else h.removeAttribute("data-densidade");
  h.style.setProperty("--ap-fonte", String(a.fonte / 100));
  if (a.fonte !== 100) h.setAttribute("data-fonte", String(a.fonte)); else h.removeAttribute("data-fonte");
}

export function lerLocal(): Aparencia | null {
  try {
    const raw = localStorage.getItem(LS_APARENCIA);
    return raw ? normalizar(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function gravarLocal(a: Aparencia) {
  try { localStorage.setItem(LS_APARENCIA, JSON.stringify(a)); } catch { /* sem storage */ }
}

/** Script inline para o <head>: aplica a aparência em cache antes de pintar. */
export const SCRIPT_APARENCIA = `(function(){try{var h=document.documentElement;var raw=localStorage.getItem('${LS_APARENCIA}');var a=raw?JSON.parse(raw):null;var modo=a&&a.modo;if(!modo){var t=localStorage.getItem('ww-theme');modo=t==='light'?'claro':t==='system'?'sistema':'escuro';}var dk=modo==='escuro'||(modo==='sistema'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(dk)h.classList.add('dark');else h.classList.remove('dark');h.style.colorScheme=dk?'dark':'light';if(!a)return;if(a.paleta&&a.paleta!=='blue')h.setAttribute('data-paleta',a.paleta);var v=+a.vidro||0;if(v>0){h.setAttribute('data-vidro','');h.style.setProperty('--ap-a',String(1-v/100*0.6));h.style.setProperty('--ap-blur',Math.round(4+v/100*16)+'px');}if(a.fundo&&a.fundo!=='solido')h.setAttribute('data-fundo',a.fundo);if(a.fundoCor)h.style.setProperty('--ap-fundo-cor',a.fundoCor);if(a.densidade==='compacta')h.setAttribute('data-densidade','compacta');var f=+a.fonte||100;h.style.setProperty('--ap-fonte',String(f/100));if(f!==100)h.setAttribute('data-fonte',String(f));}catch(e){}})();`;

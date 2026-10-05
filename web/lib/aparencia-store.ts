"use client";
// Guarda da aparência no browser: estado único, gravação no banco
// (platform.aparencia_usuario, linha do próprio usuário) e aviso a quem ouve.
import { useSyncExternalStore } from "react";
import { supaBrowser } from "@/lib/supabase";
import { type Aparencia, PADRAO, aplicar, gravarLocal, lerLocal, normalizar } from "@/lib/aparencia";

let atual: Aparencia | null = null;
const ouvintes = new Set<() => void>();
let timer: ReturnType<typeof setTimeout> | null = null;

function avisar() { ouvintes.forEach((f) => f()); }

export function obterAparencia(): Aparencia {
  if (!atual) atual = (typeof window !== "undefined" && lerLocal()) || legado();
  return atual;
}

/** Quem ainda só tem a escolha antiga (ww-theme) entra com ela. */
function legado(): Aparencia {
  try {
    const t = localStorage.getItem("ww-theme");
    return { ...PADRAO, modo: t === "light" ? "claro" : t === "system" ? "sistema" : "escuro" };
  } catch { return PADRAO; }
}

async function gravarBanco(a: Aparencia) {
  const sb = supaBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  await sb.schema("platform" as never).from("aparencia_usuario").upsert({
    user_id: user.id, email: user.email, prefs: a, atualizado_em: new Date().toISOString(), atualizado_de: "painel",
  });
}

/** Aplica já (pré-visualização ao vivo), guarda no cache e, 600 ms depois, no banco. */
export function definirAparencia(parcial: Partial<Aparencia>) {
  const a = normalizar({ ...obterAparencia(), ...parcial });
  atual = a;
  aplicar(a);
  gravarLocal(a);
  try { localStorage.setItem("ww-theme", a.modo === "claro" ? "light" : a.modo === "sistema" ? "system" : "dark"); } catch { /* */ }
  avisar();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { gravarBanco(a).catch(() => null); }, 600);
}

/** Lê o banco ao abrir: outra app pode ter mudado a escolha. */
export async function carregarDoBanco() {
  const sb = supaBrowser();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return;
  const { data } = await sb.schema("platform" as never).from("aparencia_usuario").select("prefs").eq("user_id", user.id).maybeSingle();
  const prefs = (data as { prefs?: unknown } | null)?.prefs;
  if (!prefs || typeof prefs !== "object" || !Object.keys(prefs).length) {
    // Primeira vez: sobe o que este browser já usa, para as outras apps herdarem.
    if (lerLocal()) gravarBanco(obterAparencia()).catch(() => null);
    return;
  }
  const a = normalizar(prefs);
  if (JSON.stringify(a) === JSON.stringify(obterAparencia())) return;
  atual = a; aplicar(a); gravarLocal(a); avisar();
}

export function useAparencia(): Aparencia {
  return useSyncExternalStore(
    (f) => { ouvintes.add(f); return () => { ouvintes.delete(f); }; },
    obterAparencia,
    () => PADRAO,
  );
}

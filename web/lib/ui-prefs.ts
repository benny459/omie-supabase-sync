"use client";

import { supaBrowser } from "./supabase";

export type UiPrefs = {
  columnGroups?: {
    avulsos?:  Record<string, boolean>;
    projetos?: Record<string, boolean>;
    pcs?:      Record<string, boolean>;
  };
};

const LS_KEY = "waterworks.ui_prefs.v2";

let cached: UiPrefs | null = null;

export function readLocalPrefs(): UiPrefs {
  if (cached) return cached;
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    cached = raw ? JSON.parse(raw) : {};
    return cached ?? {};
  } catch { return {}; }
}

export function writeLocalPrefs(prefs: UiPrefs) {
  cached = prefs;
  if (typeof window !== "undefined") {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(prefs)); } catch {}
  }
}

export async function savePrefs(patch: Partial<UiPrefs>) {
  const cur = readLocalPrefs();
  const next: UiPrefs = {
    ...cur, ...patch,
    columnGroups: { ...(cur.columnGroups ?? {}), ...(patch.columnGroups ?? {}) },
  };
  writeLocalPrefs(next);

  const supa = supaBrowser();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return;
  // .schema() retorna PostgrestClient (sem .auth) → usar só pra DB
  await supa.schema("platform" as never)
    .from("user_profiles")
    .update({ ui_prefs: next })
    .eq("id", user.id);
}

export async function loadPrefsFromDb(): Promise<UiPrefs> {
  const supa = supaBrowser();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return readLocalPrefs();

  const { data } = await supa.schema("platform" as never)
    .from("user_profiles")
    .select("ui_prefs")
    .eq("id", user.id)
    .maybeSingle();

  const dbPrefs = ((data as { ui_prefs?: UiPrefs } | null)?.ui_prefs) ?? {};
  const merged: UiPrefs = {
    ...readLocalPrefs(), ...dbPrefs,
    columnGroups: {
      ...(readLocalPrefs().columnGroups ?? {}),
      ...(dbPrefs.columnGroups ?? {}),
    },
  };
  writeLocalPrefs(merged);
  return merged;
}

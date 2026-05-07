// Clientes Supabase pra os 2 sistemas externos consumidos pelo /owner.
// Service role (bypass RLS) — só usar em API routes server-side, nunca no browser.
// Se env vars não estão setadas, retorna null (dashboard mostra placeholder).
import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let _ww: SupabaseClient | null | undefined;
let _crm: SupabaseClient | null | undefined;

export function wwClient(): SupabaseClient | null {
  if (_ww !== undefined) return _ww;
  const url = process.env.WW_SUPABASE_URL;
  const key = process.env.WW_SERVICE_ROLE_KEY;
  if (!url || !key) { _ww = null; return null; }
  _ww = createClient(url, key, { auth: { persistSession: false } });
  return _ww;
}

export function crmClient(): SupabaseClient | null {
  if (_crm !== undefined) return _crm;
  const url = process.env.CRM_SUPABASE_URL;
  const key = process.env.CRM_SERVICE_ROLE_KEY;
  if (!url || !key) { _crm = null; return null; }
  _crm = createClient(url, key, { auth: { persistSession: false } });
  return _crm;
}

export const CRM_EMPRESA_ID = process.env.CRM_EMPRESA_ID ?? "b1bf590f-c281-41f8-9968-a70b0dc02b31";

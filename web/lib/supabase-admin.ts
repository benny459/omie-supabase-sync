import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * Cliente admin do Supabase — usa SERVICE_ROLE_KEY, que bypassa RLS.
 * Só use em API routes/server actions que JÁ validaram que o caller é admin.
 */
export function supaAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY not configured");
  }
  return createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** Gera senha aleatória legível (12 chars com letras + números) */
export function generateTempPassword(): string {
  const chars = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  for (const b of bytes) out += chars[b % chars.length];
  return out;
}

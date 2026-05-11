// Cliente Supabase omie-data para uso SERVER-SIDE (cron, API routes Admin).
// Prefere BUG_SUPABASE_SERVICE_ROLE_KEY (bypassa RLS); cai pra anon hardcoded
// (RLS bugs_all permite todas as ops, então anon é suficiente).
// NUNCA importar isto em código client-side.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const FALLBACK_URL = "https://zodflkfdnjhtwcjutbjl.supabase.co";
const FALLBACK_ANON =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpvZGZsa2ZkbmpodHdjanV0YmpsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4NDY4MTEsImV4cCI6MjA5MTQyMjgxMX0.Swde5fyjxeOU8jT0dQb7GoJZuRBTRAeW5I1IKtrWg_E";

const URL =
  process.env.BUG_SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  FALLBACK_URL;

const SERVICE_KEY =
  process.env.BUG_SUPABASE_SERVICE_ROLE_KEY ||
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  FALLBACK_ANON;

let _client: SupabaseClient | null = null;

export function bugSupabaseServer(): SupabaseClient {
  if (!_client) {
    _client = createClient(URL, SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return _client;
}

export const BUG_SUPABASE_USING_SERVICE_ROLE = !!(
  process.env.BUG_SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
);

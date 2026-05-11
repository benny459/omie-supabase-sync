import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!url || !anonKey) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY",
  );
}

/**
 * Cliente browser padrão — schema approval.
 * Para outros schemas, use `.schema("platform")` no retorno (Supabase v2 suporta isso).
 */
export function supaBrowser() {
  return createBrowserClient(url, anonKey, { db: { schema: "approval" } });
}

import { createBrowserClient } from "@supabase/ssr";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Client com schema "public" — bugs e bug_sessions vivem aí.
// O cliente padrão (lib/supabase.ts) usa schema "approval", então
// precisamos de um separado pra ler/escrever os tickets.
export const bugSupabase = createBrowserClient(url, anonKey);

export const BUG_EMPRESA_ID = "b1bf590f-c281-41f8-9968-a70b0dc02b31";

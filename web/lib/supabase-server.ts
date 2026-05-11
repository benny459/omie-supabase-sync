import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

// Cliente para server components e route handlers.
export async function supaServer(
  schema: "approval" | "platform" | "public" = "approval",
) {
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    db: { schema },
    cookies: {
      getAll() { return cookieStore.getAll(); },
      setAll(pairs) {
        try {
          pairs.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Server component: read-only. Middleware sets cookies.
        }
      },
    },
  });
}

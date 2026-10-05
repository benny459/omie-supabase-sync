import "server-only";

/**
 * RH na barra do painel (03/10/26). O RH é módulo próprio, mas mora na app de
 * Serviços, com a régua de lá — o painel não a conhece nem fala com essa app.
 * Pergunta ao portal (allka.ai/api/menu/rh), que já sabe, mandando o token da
 * PRÓPRIA sessão (portal e painel partilham o Supabase): a resposta é só sobre
 * quem chama. 5 minutos de cache por pessoa; falhou → sem RH na barra
 * (na dúvida, esconder). Chamado por /api/menu/rh depois de a barra montar
 * (05/10/26) — por isso o limite pode ser folgado: o portal frio passa de 2,5 s.
 */
export type TelaRh = { label: string; next: string };

const PORTAL = "https://allka.ai";
const TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { em: number; telas: TelaRh[] }>();

export async function telasRhDoPortal(userId: string, accessToken: string | undefined): Promise<TelaRh[]> {
  if (!accessToken) return [];
  const c = cache.get(userId);
  if (c && Date.now() - c.em < TTL_MS) return c.telas;
  try {
    const r = await fetch(`${PORTAL}/api/menu/rh`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      cache: "no-store",
      signal: AbortSignal.timeout(9000),
    });
    if (!r.ok) return [];
    const d = (await r.json()) as { telas?: TelaRh[] };
    const telas = Array.isArray(d.telas) ? d.telas.filter((t) => typeof t?.next === "string" && t.next.startsWith("/rh")) : [];
    cache.set(userId, { em: Date.now(), telas });
    return telas;
  } catch {
    return [];
  }
}

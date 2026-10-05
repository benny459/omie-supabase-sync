import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Passe servidor-a-servidor do cadastro único (05/10/26, sql/54_cadastro_unico.sql).
// As apps de Serviços e o CRM Legado assinam cada pedido a /api/cadastros/sync:
//   header x-cadastros-passe = base64url(JSON {s:"cadastros", x:expira(s), n:nonce, h:sha256(corpo)})
//                              + "." + base64url(HMAC-SHA256(payload, CADASTROS_SYNC_SECRET))
// O hash do corpo amarra o passe a este pedido; vale 60 s.

const b64url = (b: Buffer) => b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

export function passeValido(passe: string | null, corpo: string): boolean {
  const segredo = process.env.CADASTROS_SYNC_SECRET;
  if (!segredo || !passe) return false;
  const [payload, assinatura] = passe.split(".");
  if (!payload || !assinatura) return false;
  const esperada = Buffer.from(b64url(createHmac("sha256", segredo).update(payload).digest()));
  const veio = Buffer.from(assinatura);
  if (esperada.length !== veio.length || !timingSafeEqual(esperada, veio)) return false;
  try {
    const d = JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8")) as
      { s?: string; x?: number; h?: string };
    if (d.s !== "cadastros" || !d.x || Date.now() / 1000 > d.x) return false;
    return d.h === createHash("sha256").update(corpo).digest("hex");
  } catch {
    return false;
  }
}

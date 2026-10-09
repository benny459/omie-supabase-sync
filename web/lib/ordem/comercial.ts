import "server-only";
// Comercial (CRM legado Propostas-WW) na Central do painel — só leitura.
// O painel não guarda o acesso ao CRM: quem decide é o próprio CRM
// (GET /api/ordem-comercial?email= devolve [] a quem não tem acesso). Ações: só "Abrir no CRM ↗".
// Se o CRM não responder (404, fora do ar, sem segredo), a aba fica com cadeado e nada quebra.
import type { ItemTela, Recomendacao } from "./tipos";

const BASE = process.env.CRM_ORDEM_URL || "https://propostas-ww.vercel.app";

type ItemCrm = {
  id: string; tipo: string; origem_ref: string; dono_email?: string; urgencia?: "critica" | "atencao";
  rotulo_urgencia?: string; etapa?: string; titulo: string; resumo?: string; link?: string;
  recomendacao?: { acao?: string; porque?: string; impacto?: string; alternativas?: { acao: string; nota?: string }[]; confianca?: string };
};

export type Comercial = { acesso: boolean; itens: ItemTela[]; erro?: string; motivo?: string | null };

export async function comercialDe(email: string, uid: string): Promise<Comercial> {
  const segredo = process.env.COMPRAS_RC_SECRET;
  if (!segredo || !email) return { acesso: false, itens: [], erro: "sem segredo", motivo: "integração com o CRM não configurada" };
  try {
    const r = await fetch(`${BASE}/api/ordem-comercial?email=${encodeURIComponent(email)}`, {
      headers: { "x-compras-secret": segredo }, cache: "no-store", signal: AbortSignal.timeout(3500),
    });
    if (!r.ok) return { acesso: false, itens: [], erro: `CRM ${r.status}`, motivo: `CRM indisponível (${r.status})` };
    const j = (await r.json()) as { ok?: boolean; email?: string; itens?: ItemCrm[] };
    if (!j?.ok || (j.email && j.email.toLowerCase() !== email.toLowerCase())) return { acesso: false, itens: [] };
    const itens = (j.itens ?? []).map((x): ItemTela => {
      const rc = x.recomendacao ?? {};
      const conf = rc.confianca === "alta" || rc.confianca === "baixa" ? rc.confianca : "media";
      const rec: Recomendacao = { acao: rc.acao ?? x.titulo, porque: rc.porque ?? "", impacto: rc.impacto, alternativas: rc.alternativas?.slice(0, 2), confianca: conf };
      return {
        id: `crm:${x.id}`, tipo: `crm_${x.tipo}`, modulo: "comercial", origem_ref: x.origem_ref, titulo: x.titulo, resumo: x.resumo ?? null,
        etapa: x.etapa ?? null, valor: null, urgencia: x.urgencia ?? "atencao", rotulo_urgencia: x.rotulo_urgencia ?? null,
        link: x.link ?? BASE, recomendacao: rec, depende_de: null, estado: "aberto", degrau: 0,
        dono_id: x.dono_email?.toLowerCase() === email.toLowerCase() ? uid : null, dono_nome: x.dono_email?.split("@")[0] ?? null,
        meu: x.dono_email?.toLowerCase() === email.toLowerCase(), criado_em: new Date().toISOString(), adiado_ate: null,
        encaminhado_de: null, encaminhado_por_nome: null, externo: true, acao: null,
      };
    });
    // Sem itens = sem acesso OU fila zerada; o CRM não distingue — a aba só abre com itens.
    return { acesso: itens.length > 0, itens, motivo: itens.length ? null : "sem itens do CRM para si (ou sem acesso ao CRM)" };
  } catch (e) {
    return { acesso: false, itens: [], erro: e instanceof Error ? e.message : String(e) };
  }
}

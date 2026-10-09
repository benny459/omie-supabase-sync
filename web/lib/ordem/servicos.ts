import "server-only";
// Serviços (app.waterworks — waterworks-app) no Meu dia do painel — só leitura.
// Contrato: GET https://app.waterworks.com.br/api/ciclo/central?email=<pessoa>
//   Authorization: Bearer CICLO_CENTRAL_TOKEN. 403 enquanto "Exportar itens para a Central" está
//   desligado lá. O acesso é decidido pelo próprio app (lista vazia = sem acesso / fila zerada).
// Cartões só com "Abrir em Serviços ↗" — aceitar/recusar continua a ser feito no app.
import type { ItemTela } from "./tipos";
import type { Externo } from "./fila";

const BASE = process.env.SERVICOS_CENTRAL_URL || "https://app.waterworks.com.br";

type ItemSv = {
  id: string | null; chave: string; tipo: string; origem_ref: string; titulo: string; dono_email?: string; papel?: string;
  urgencia?: "critica" | "atencao"; rotulo_urgencia?: string; degrau?: number; estado?: string; criada_em?: string;
  recomendacao?: { recomendacao?: string; porque?: string; impacto?: string; alternativas?: { acao?: string; recomendacao?: string; nota?: string; impacto?: string }[]; confianca?: string; riscos?: string[]; conferir?: string[] };
  abrir_url?: string; responder_url?: string;
};

export async function servicosDe(email: string, uid: string): Promise<Externo> {
  const token = process.env.CICLO_CENTRAL_TOKEN;
  if (!token) return { acesso: false, itens: [], motivo: "integração com Serviços não configurada (falta CICLO_CENTRAL_TOKEN)" };
  if (!email) return { acesso: false, itens: [] };
  try {
    const r = await fetch(`${BASE}/api/ciclo/central?email=${encodeURIComponent(email)}`, {
      headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(4000),
    });
    if (r.status === 403) return { acesso: false, itens: [], motivo: "exportação para a Central desligada no app de Serviços" };
    if (!r.ok) return { acesso: false, itens: [], motivo: `Serviços indisponível (${r.status})` };
    const j = (await r.json()) as { email?: string; itens?: ItemSv[] };
    if (j.email && j.email.toLowerCase() !== email.toLowerCase()) return { acesso: false, itens: [] };
    const itens = (j.itens ?? []).filter((x) => (x.estado ?? "aberto") === "aberto").map((x): ItemTela => {
      const rc = x.recomendacao ?? {};
      const conf = rc.confianca === "alta" || rc.confianca === "baixa" ? rc.confianca : "media";
      const meu = (x.dono_email ?? "").toLowerCase() === email.toLowerCase();
      return {
        id: `sv:${x.id ?? x.chave}`, tipo: `sv_${x.tipo}`, modulo: "servicos", origem_ref: x.origem_ref, titulo: x.titulo,
        resumo: x.papel ? `papel: ${x.papel}` : null, etapa: null, valor: null,
        urgencia: x.urgencia ?? "atencao", rotulo_urgencia: x.rotulo_urgencia ?? null,
        link: x.responder_url ?? x.abrir_url ?? `${BASE}/chamados`,
        recomendacao: {
          acao: rc.recomendacao ?? x.titulo, porque: rc.porque ?? "", impacto: rc.impacto,
          alternativas: (rc.alternativas ?? []).slice(0, 2).map((a) => ({ acao: a.acao ?? a.recomendacao ?? "", nota: a.nota ?? a.impacto })),
          confianca: conf, risco: rc.riscos?.join("; "), conferir: rc.conferir,
        },
        depende_de: null, estado: "aberto", degrau: Number(x.degrau ?? 0), dono_id: meu ? uid : null,
        dono_nome: x.dono_email?.split("@")[0] ?? null, meu, criado_em: x.criada_em ?? new Date().toISOString(),
        adiado_ate: null, encaminhado_de: null, encaminhado_por_nome: null, externo: true, acao: null,
      };
    });
    return { acesso: itens.length > 0, itens, motivo: itens.length ? null : "sem itens de Serviços para si (ou sem acesso no app)" };
  } catch (e) {
    return { acesso: false, itens: [], motivo: `Serviços indisponível (${e instanceof Error ? e.message : String(e)})` };
  }
}

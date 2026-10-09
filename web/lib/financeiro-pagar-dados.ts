import "server-only";
// Dados de Títulos a Pagar v3 + sobreposição das regras de Compras (fase do PC do
// painel e "NF sem pedido"). Saiu de app/api/financeiro/pagar/route.ts (09/10/26) sem
// mudar nada, para a Central de Ordem (lib/ordem) usar EXACTAMENTE a mesma regra da tela.
import { fin } from "@/lib/financeiro-baixas";
import { supaAdmin } from "@/lib/supabase-admin";

export type Linha = [string, string, string, number, string, string | null, string | null, string | null, string | null,
  string | null, number | null, number | null, string | null, string | null, string | null, string | null,
  string | null, string | null, boolean, string, string, string, number, number | null, string | null, string | null];

const dig = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Dados da tela + sobreposição das regras de Compras (fase do PC do painel e
 *  "NF sem pedido"), as mesmas que a tela antiga aplicava. */
export async function carregar() {
  const ord = supaAdmin().schema("orders");
  const [d, sp, fz] = await Promise.all([
    fin().rpc("pagar_v3_dados", {}),
    ord.rpc("compras_nf_sem_pedido_resumo"),
    ord.rpc("compras_fases_pagar"),
  ]);
  if (d.error) throw d.error;
  const dados = d.data as { hoje: string; rows: Linha[]; agg: unknown; banks: unknown[]; prog: Record<string, number> };

  type NfRef = { cnpj: string; numero: string; chave: string; pedido?: string };
  const semPed = new Set(((sp.data as { nfs?: NfRef[] } | null)?.nfs ?? []).map((n) => `${n.cnpj}|${n.numero}`));
  const aguard = new Set(((sp.data as { aguardando?: NfRef[] } | null)?.aguardando ?? []).map((n) => `${n.cnpj}|${n.numero}`));
  type Fase = { cnpj: string; nf: string; fase: string; pedido: string };
  const fases = new Map(((fz.data as Fase[] | null) ?? []).map((f) => [`${f.cnpj}|${f.nf}`, f]));

  for (const r of dados.rows) {
    if (r[21] !== "o") continue;
    const nf = dig(r[24]).replace(/^0+/, "");
    if (!nf) continue;
    const k = `${dig(r[20])}|${nf}`;
    const f = fases.get(k);
    if (f) {
      r[25] = f.fase;
      r[19] = f.fase === "liberado" ? "ok" : f.fase === "bloqueado" ? "bloq" : "nf";
      if (!r[13]) r[13] = f.pedido;
    }
    if (aguard.has(k)) r[19] = "bloq";
    if (semPed.has(k)) r[19] = "sempc";
  }
  return dados;
}


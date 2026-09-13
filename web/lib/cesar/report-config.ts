// Régua de incorporação dos reports do Cesar (v3, 13/09/2026).
//
// O painel não tem perfis como os apps (Admin/Agent/Technician) — tem is_admin
// e acesso por área. Então a régua aqui é: TODO MUNDO com acesso à tela pode
// incorporar para a equipe (o comportamento que o painel sempre teve), e o
// admin trava ou rebaixa pessoas específicas por EXCEÇÃO em
// public.cesar_report_user_config (email → todos | proprio | nenhum).
import type { SupabaseClient } from "@supabase/supabase-js";

export type ModoReport = "todos" | "proprio" | "nenhum";

function modoValido(m: unknown): m is ModoReport {
  return m === "todos" || m === "proprio" || m === "nenhum";
}

/** A exceção vence; sem exceção, todos podem publicar para a equipe. */
export async function modoReportDoUsuario(
  publico: SupabaseClient, email: string,
): Promise<ModoReport> {
  const { data } = await publico
    .from("cesar_report_user_config")
    .select("modo")
    .ilike("email", email)
    .maybeSingle();
  if (modoValido(data?.modo)) return data!.modo;
  return "todos";
}

/** Uma linha de cesar_reports com o que a régua de visibilidade precisa. */
export type ReportLinha = {
  id: string; tela: string; titulo: string; payload: unknown;
  criado_por: string | null; visibilidade: string; shared_emails: string[] | null;
  created_at: string;
};

/** A régua de quem vê um report, aplicada em memória — a lista por tela é
 *  curta (≤30) e o filtro composto em PostgREST ficaria ilegível. */
export function visivelPara(r: ReportLinha, email: string): boolean {
  const dono = (r.criado_por || "").toLowerCase() === email.toLowerCase();
  if (dono) return true;
  if (r.visibilidade === "todos") return true;
  if (r.visibilidade === "custom") {
    return (r.shared_emails || []).some((e) => (e || "").toLowerCase() === email.toLowerCase());
  }
  return false; // proprio
}

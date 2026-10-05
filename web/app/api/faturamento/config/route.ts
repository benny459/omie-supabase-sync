import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { DONO_PRODUCAO, exigirFaturamento, falha } from "@/lib/faturamento/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const { data, error } = await supaAdmin().schema("orders").from("fat_config").select("*").order("empresa");
  if (error) return falha(error.message, 500);
  return NextResponse.json({ config: data ?? [], pode_producao: q.email === DONO_PRODUCAO });
}

/**
 * PATCH { empresa, ...campos } — numeração, séries, tipo de OS, natureza.
 * ambiente/producao_liberada: só o Benny (chave de produção).
 */
const LIVRES = ["tipo_os", "nfe_serie_homologacao", "nfe_proximo_homologacao", "nfe_serie_producao", "nfe_proximo_producao",
  "rps_serie_homologacao", "rps_serie_producao", "recibo_proximo", "natureza_operacao", "item_lista_servico", "observacoes"];
const SO_DONO = ["ambiente", "producao_liberada", "ativo", "cnpj"];

export async function PATCH(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  if (!q.admin) return falha("Só administradores alteram a configuração", 403);
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const empresa = String(body.empresa || "");
  if (!empresa) return falha("empresa é obrigatória");
  const campos: Record<string, unknown> = {};
  for (const k of LIVRES) if (k in body) campos[k] = body[k];
  for (const k of SO_DONO) {
    if (!(k in body)) continue;
    if (q.email !== DONO_PRODUCAO) return falha(`Só ${DONO_PRODUCAO} altera ${k}`, 403);
    campos[k] = body[k];
  }
  if (campos.ambiente === "producao" && body.producao_liberada !== true) {
    const { data } = await supaAdmin().schema("orders").from("fat_config").select("producao_liberada").eq("empresa", empresa).maybeSingle();
    if (!(data as { producao_liberada?: boolean } | null)?.producao_liberada) return falha("Ligue producao_liberada junto com ambiente=producao");
  }
  campos.updated_at = new Date().toISOString();
  campos.updated_by = q.email;
  const { data, error } = await supaAdmin().schema("orders").from("fat_config").update(campos).eq("empresa", empresa).select("*").single();
  if (error) return falha(error.message);
  return NextResponse.json({ config: data });
}

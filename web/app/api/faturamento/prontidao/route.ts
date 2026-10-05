import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { DONO_PRODUCAO, exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { empresaFocus } from "@/lib/faturamento/focus";

export const dynamic = "force-dynamic";

/** GET ?empresa=SF — prontidão para emitir NF-e em produção (só leitura). */
export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const empresa = req.nextUrl.searchParams.get("empresa") || "SF";
  const db = supaAdmin().schema("orders");
  const { data: cfg, error } = await db.from("fat_config").select("*").eq("empresa", empresa).maybeSingle();
  if (error || !cfg) return falha(error?.message ?? "sem configuração", 500);
  const c = cfg as Record<string, unknown>;
  let focus: Record<string, unknown> | null = null;
  let focusErro: string | null = null;
  try {
    const e = (await empresaFocus(String(c.cnpj))) as Record<string, unknown>;
    focus = {
      habilita_nfe: e.habilita_nfe, regime_tributario: e.regime_tributario,
      certificado_valido_ate: e.certificado_valido_ate, certificado_cnpj: e.certificado_cnpj,
      serie_nfe_producao: e.serie_nfe_producao, proximo_numero_nfe_producao: e.proximo_numero_nfe_producao,
      token_producao: !!e.token_producao, token_homologacao: !!e.token_homologacao,
    };
  } catch (e) { focusErro = e instanceof Error ? e.message : String(e); }
  const { data: ult } = await supaAdmin().schema("sales").from("nfe_saida").select("numero,serie,emissao")
    .eq("empresa", empresa).eq("cancelada", false).order("numero", { ascending: false }).limit(1);
  const { data: guarda } = await db.rpc("fat_guarda_numeracao", { p_empresa: empresa, p_numero: (c.nfe_proximo_producao as number) ?? 0 });
  const tokenEnv = !!process.env[`FOCUS_TOKEN_${empresa}`];
  return NextResponse.json({
    empresa, config: {
      ambiente: c.ambiente, producao_liberada: c.producao_liberada, natureza_operacao: c.natureza_operacao,
      nfe_serie_producao: c.nfe_serie_producao, nfe_proximo_producao: c.nfe_proximo_producao,
      omie_nfe_desligado_em: c.omie_nfe_desligado_em,
    },
    focus, focus_erro: focusErro, token_producao_env: tokenEnv,
    ultima_nfe_omie: ult?.[0] ?? null, conflito_numeracao: guarda ?? null,
    pode_mudar: q.email === DONO_PRODUCAO,
  });
}

/** POST { empresa, omie_desligado: boolean } — só o Benny confirma que desligou
 *  a emissão de NF-e no Omie (pré-condição da produção no painel). */
export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  if (q.email !== DONO_PRODUCAO) return falha(`Só ${DONO_PRODUCAO} confirma o desligamento no Omie`, 403);
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; omie_desligado?: boolean };
  const empresa = b.empresa || "SF";
  const { data, error } = await supaAdmin().schema("orders").from("fat_config")
    .update({ omie_nfe_desligado_em: b.omie_desligado ? new Date().toISOString() : null, updated_at: new Date().toISOString(), updated_by: q.email })
    .eq("empresa", empresa).select("omie_nfe_desligado_em").single();
  if (error) return falha(error.message);
  return NextResponse.json(data);
}

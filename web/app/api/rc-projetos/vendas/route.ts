// Vendas do projeto (PV/OS) — 07/10/26, pedido do Benny (Operação › Projetos).
//
//   GET  ?empresa=&codigo=  → os PV/OS do projeto (ver lib/vendas-projeto: previsão INICIAL e
//                             NOVA de faturamento e de recebimento, situação, título, OC)
//   POST { empresa, codigo, chave, campo: "faturamento" | "recebimento", data | null }
//        → grava a NOVA previsão (null = volta à inicial). A inicial nunca muda.
//
//   faturamento → orders.fat_previsao_definir (a mesma da carteira do Faturamento). Mantém
//                 o prazo: se o recebimento não tinha nova previsão, ele anda junto.
//   recebimento → approval.projeto_plano_parcela.dt_ajustada (o ajuste que a reimportação
//                 do CRM preserva e que manda no Fluxo de caixa do projeto); e mais:
//                 nativo ainda não faturado → vendas.parcelas.vencimento (sql/111);
//                 faturado → vencimento do título a receber (Financeiro › Editar, sql/80).
// O Omie nunca é escrito.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canEdit } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { permissoesDe } from "@/lib/acessos";
import { montar, somaDias, difDias } from "@/lib/vendas-projeto";
import { editarTitulo } from "@/lib/financeiro-editar";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const u = new URL(req.url);
  const empresa = (u.searchParams.get("empresa") || "SF").toUpperCase();
  const codigo = Number(u.searchParams.get("codigo"));
  if (!Number.isFinite(codigo) || codigo <= 0) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });
  try {
    // em paralelo: a montagem e as permissões
    const [{ docs }, perms] = await Promise.all([montar(empresa, codigo), loadPerms()]);
    const pode: Record<string, boolean> = perms ? await permissoesDe(perms) : {};
    const admin = !!perms?.is_admin;
    return NextResponse.json({
      docs, total: Math.round(docs.reduce((a, d) => a + d.valor, 0) * 100) / 100,
      pode: { editar: admin || canEdit(perms, "projetos", "pvos") || !!pode["faturamento.acesso"], titulo: admin || !!pode["financeiro.editar_titulo"] },
    });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const perms = await loadPerms();
  const pode: Record<string, boolean> = perms ? await permissoesDe(perms) : {};
  const admin = !!perms?.is_admin;
  if (!perms || !(admin || canEdit(perms, "projetos", "pvos") || pode["faturamento.acesso"])) {
    return NextResponse.json({ error: "Sem permissão para mudar a previsão" }, { status: 403 });
  }
  const b = (await req.json().catch(() => ({}))) as { empresa?: string; codigo?: number; chave?: string; campo?: string; data?: string | null };
  const empresa = String(b.empresa ?? "SF").toUpperCase();
  const codigo = Number(b.codigo);
  const chave = String(b.chave ?? "");
  const campo = b.campo === "recebimento" ? "recebimento" : "faturamento";
  const data = b.data ? String(b.data) : null;
  if (!/^(pv_omie|os_omie|venda):[0-9A-Za-z_-]+$/.test(chave)) return NextResponse.json({ error: "chave inválida" }, { status: 400 });
  if (data && !/^\d{4}-\d{2}-\d{2}$/.test(data)) return NextResponse.json({ error: "data inválida" }, { status: 400 });
  if (!Number.isFinite(codigo) || codigo <= 0) return NextResponse.json({ error: "codigo obrigatório" }, { status: 400 });

  const { docs, parcelas } = await montar(empresa, codigo);
  const doc = docs.find((d) => d.chave === chave);
  if (!doc) return NextResponse.json({ error: "documento não é deste projeto" }, { status: 404 });
  const p = parcelas.find((x) => x.parcela === doc.parcela) ?? null;
  const email = user.email ?? "painel";
  const avisos: string[] = [];

  /** Grava a nova previsão de recebimento da parcela do plano (null = volta à inicial). */
  const gravarReceb = async (nova: string | null) => {
    if (!p) return false;
    const v = nova && nova !== p.dt_plano ? nova : null;
    const { error } = await supaAdmin().schema("approval").from("projeto_plano_parcela")
      .update({ dt_ajustada: v }).eq("empresa", empresa).eq("codigo_projeto", codigo).eq("parcela", p.parcela);
    if (error) throw new Error(`Fluxo de caixa: ${error.message}`);
    return true;
  };

  try {
    if (campo === "faturamento") {
      if (doc.faturado) return NextResponse.json({ error: "documento já faturado — a previsão de faturamento não muda" }, { status: 400 });
      const antes = doc.fat_nova ?? doc.fat_inicial;
      const { error } = await supaAdmin().schema("orders").rpc("fat_previsao_definir", { p_chave: chave, p_data: data && data !== doc.fat_inicial ? data : null, p_por: email });
      if (error) throw new Error(error.message);
      // mantém o prazo: o recebimento sem nova previsão anda junto
      const depois = data ?? doc.fat_inicial;
      if (p && !doc.receb_nova && antes && depois && antes !== depois && p.dt_plano) {
        await gravarReceb(somaDias(p.dt_plano, difDias(depois, antes)));
        avisos.push("o recebimento andou junto (mesmo prazo)");
      }
      return NextResponse.json({ ok: true, campo, avisos });
    }

    // recebimento
    const alvo = data ?? p?.dt_plano ?? null;
    if (doc.faturado) {
      if (!doc.titulo_ref) return NextResponse.json({ error: "faturado e não achei o título a receber — mude o vencimento em Financeiro › Receber" }, { status: 400 });
      if (!(admin || pode["financeiro.editar_titulo"])) return NextResponse.json({ error: "Sem permissão para editar o título (financeiro.editar_titulo)" }, { status: 403 });
      if (!alvo) return NextResponse.json({ error: "informe a data" }, { status: 400 });
      const r = await editarTitulo("R", doc.titulo_ref, { vencimento: alvo }, "esta", `Previsão de recebimento do projeto ${codigo} (${doc.rotulo})`, email);
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j as { error?: string }).error ?? "não consegui editar o título"); }
      avisos.push("vencimento do título atualizado");
    } else if (doc.parcela_id && alvo) {
      const { error } = await supaAdmin().schema("orders").rpc("vendas_parcela_vencimento", { p_parcela: doc.parcela_id, p_vencimento: alvo, p_por: email });
      if (error) avisos.push(/vendas_parcela_vencimento|function/.test(error.message)
        ? "a parcela do PV/OS ainda não guarda a data (falta aplicar a sql/111) — o fluxo de caixa já usa a nova"
        : `parcela do PV/OS: ${error.message}`);
    }
    if (!(await gravarReceb(data))) avisos.push("sem parcela do plano ligada — o Fluxo de caixa não tem onde mudar");
    return NextResponse.json({ ok: true, campo, avisos });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

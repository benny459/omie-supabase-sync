// /api/financeiro/receber — Títulos a Receber v1 (mockup "contas-a-receber-v1", 05/10/26).
//
//  GET                       → { hoje, rows, pont30, banks, prog, pode } (sql/60 finance.receber_v1_dados)
//                              rows = contas em aberto de finance.v_receber (Omie conferido + nascidas no painel).
//                              Linha compacta: ver comentário de receber_v1_dados.
//  GET ?baixas=hoje|omie     → recebimentos de hoje / de contas do Omie ainda não lançados lá
//  GET ?mov=<cod_cc>&de=…    → movimentos do extrato (créditos e débitos) com o que já está casado
//  GET ?cobrancas=<uuid>     → histórico de cobranças de uma conta
//  POST { acao: "receber", itens: [{id, valor, cod_cc, desconto?, juros?, multa?, obs?}], data, obs?, lote? }
//  POST { acao: "conciliar", movimento_id, itens: [{id, valor, juros?}] }
//  POST { acao: "previsao", ids, data, obs? }
//  POST { acao: "cobranca", ids, canal, contato?, nota?, nova_previsao? }
//  POST { acao: "renegociar", ids, motivo?, desfazer? }
//  POST { acao: "programar", ids, empresa, cod_cc | null }
//  POST { acao: "estornar", baixa_id, motivo } · { acao: "ignorar" | "desfazer", movimento_id, … }
//  GET  ?editar=<ref r:uuid> → dados da conta para o modal "Editar" (sql/80)
//  POST { acao: "editar", ref, campos, escopo?, motivo? } · { acao: "desfazer_ajuste", ref }  (financeiro.editar_titulo)
//
// Nada é escrito no Omie: recebimento de conta do Omie fica com omie_status
// 'nao_enviado'; previsão ajustada vai para finance.previsao_override; boleto não é gerado.
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";
import { dadosParaEditar, editarTitulo, desfazerAjuste, type CamposEditar } from "@/lib/financeiro-editar";

export const runtime = "nodejs";
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(req: Request) {
  const a = await exigir("financeiro.ver_receber");
  if (a instanceof NextResponse) return a;
  const u = new URL(req.url);

  const baixas = u.searchParams.get("baixas");
  if (baixas) {
    const inicioHoje = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) + "T00:00:00-03:00");
    const { data, error } = await fin().rpc("receber_v1_baixas", { p_desde: inicioHoje.toISOString(), p_so_omie_pendente: baixas === "omie" });
    return error ? erroDb(error) : NextResponse.json({ baixas: data });
  }
  const cob = u.searchParams.get("cobrancas");
  if (cob) {
    if (!UUID.test(cob)) return NextResponse.json({ error: "id inválido" }, { status: 400 });
    const { data, error } = await fin().rpc("receber_v1_cobrancas_de", { p_id: cob });
    return error ? erroDb(error) : NextResponse.json({ cobrancas: data });
  }
  const editar = u.searchParams.get("editar");
  if (editar) {
    if (!a.pode["financeiro.editar_titulo"]) return NextResponse.json({ error: "Sem permissão (financeiro.editar_titulo)" }, { status: 403 });
    return dadosParaEditar(editar);
  }
  const mov = Number(u.searchParams.get("mov") ?? 0);
  if (mov) {
    if (!a.pode["financeiro.conciliar"]) return NextResponse.json({ error: "Sem permissão (financeiro.conciliar)" }, { status: 403 });
    const de = u.searchParams.get("de") ?? "";
    const { data, error } = await fin().rpc("pagar_v3_movimentos", { p_cod_cc: mov, p_de: ISO.test(de) ? de : "2000-01-01" });
    return error ? erroDb(error) : NextResponse.json({ movimentos: data });
  }

  const [{ data, error }, aj] = await Promise.all([fin().rpc("receber_v1_dados", {}), fin().rpc("titulo_ajustes_mapa", { p_natureza: "R" })]);
  if (error) return erroDb(error);
  return NextResponse.json({
    ...(data as object),
    ajustes: aj.data ?? {},
    pode: {
      baixar: !!a.pode["financeiro.baixar"], conciliar: !!a.pode["financeiro.conciliar"],
      incluir: !!a.pode["financeiro.editar_titulo"], editar: !!a.pode["financeiro.editar_titulo"], cobrar: !!a.pode["financeiro.editar_titulo"] || !!a.pode["financeiro.baixar"],
    },
  }, { headers: { "Cache-Control": "no-store" } });
}

type Item = { id?: string; valor?: number; cod_cc?: number | null; desconto?: number; juros?: number; multa?: number; obs?: string };

export async function POST(req: Request) {
  let b: { acao?: string; itens?: Item[]; data?: string; obs?: string; lote?: boolean; baixa_id?: number; motivo?: string;
           ids?: string[]; empresa?: string; cod_cc?: number | null; movimento_id?: number; ignorar?: boolean;
           canal?: string; contato?: string; nota?: string; nova_previsao?: string; desfazer?: boolean;
           ref?: string; campos?: CamposEditar; escopo?: string };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  if (b.acao === "editar" || b.acao === "desfazer_ajuste") {
    const r = await exigir("financeiro.ver_receber", "financeiro.editar_titulo");
    if (r instanceof NextResponse) return r;
    const ref = String(b.ref ?? "");
    if (b.acao === "desfazer_ajuste") return desfazerAjuste(ref, r.email);
    return editarTitulo("R", ref, b.campos ?? {}, b.escopo ?? "esta", b.motivo?.trim() || null, r.email);
  }

  const conc = b.acao === "conciliar" || b.acao === "ignorar" || b.acao === "desfazer";
  const gestao = b.acao === "previsao" || b.acao === "cobranca" || b.acao === "renegociar";
  const a = await exigir(...(conc ? ["financeiro.conciliar" as const] : gestao ? ["financeiro.ver_receber" as const] : ["financeiro.baixar" as const]));
  if (a instanceof NextResponse) return a;
  if (gestao && !a.pode["financeiro.editar_titulo"] && !a.pode["financeiro.baixar"]) {
    return NextResponse.json({ error: "Sem permissão para registar cobrança/previsão (financeiro.editar_titulo)" }, { status: 403 });
  }
  const ids = (b.ids ?? []).filter((x) => UUID.test(x));

  switch (b.acao) {
    case "estornar": {
      if (!b.baixa_id) return NextResponse.json({ error: "baixa_id obrigatório" }, { status: 400 });
      const { data, error } = await fin().rpc("baixa_estornar", { p_baixa_id: b.baixa_id, p_motivo: b.motivo ?? "", p_usuario: a.email });
      return error ? erroDb(error) : NextResponse.json(data);
    }
    case "programar": {
      if (!ids.length || !b.empresa) return NextResponse.json({ error: "ids e empresa obrigatórios" }, { status: 400 });
      const { data, error } = await fin().rpc("pagar_v3_programar", { p_refs: ids.map((i) => "r:" + i), p_empresa: b.empresa, p_cod_cc: b.cod_cc ?? null, p_usuario: a.email });
      return error ? erroDb(error) : NextResponse.json(data);
    }
    case "previsao": {
      if (!ids.length || !b.data || !ISO.test(b.data)) return NextResponse.json({ error: "ids e data obrigatórios" }, { status: 400 });
      const { data, error } = await fin().rpc("receber_v1_previsao", { p_ids: ids, p_data: b.data, p_obs: b.obs ?? null, p_usuario: a.email });
      return error ? erroDb(error) : NextResponse.json(data);
    }
    case "cobranca": {
      if (!ids.length || !b.canal) return NextResponse.json({ error: "ids e canal obrigatórios" }, { status: 400 });
      const np = b.nova_previsao && ISO.test(b.nova_previsao) ? b.nova_previsao : null;
      const { data, error } = await fin().rpc("receber_v1_cobranca", { p_ids: ids, p_canal: b.canal, p_contato: b.contato ?? null, p_nota: b.nota ?? null, p_nova_prev: np, p_usuario: a.email });
      return error ? erroDb(error) : NextResponse.json(data);
    }
    case "renegociar": {
      if (!ids.length) return NextResponse.json({ error: "ids obrigatórios" }, { status: 400 });
      const { data, error } = await fin().rpc("receber_v1_renegociar", { p_ids: ids, p_motivo: b.motivo ?? null, p_usuario: a.email, p_desfazer: !!b.desfazer });
      return error ? erroDb(error) : NextResponse.json(data);
    }
    case "ignorar": {
      if (!b.movimento_id) return NextResponse.json({ error: "movimento_id obrigatório" }, { status: 400 });
      const { data, error } = await fin().rpc("movimento_ignorar", { p_movimento_id: b.movimento_id, p_ignorar: b.ignorar !== false, p_motivo: b.motivo ?? "", p_usuario: a.email });
      return error ? erroDb(error) : NextResponse.json(data);
    }
    case "desfazer": {
      if (!b.movimento_id) return NextResponse.json({ error: "movimento_id obrigatório" }, { status: 400 });
      const { data, error } = await fin().rpc("conciliacao_desfazer", { p_movimento_id: b.movimento_id, p_motivo: b.motivo ?? "Conciliação desfeita na tela Receber", p_usuario: a.email });
      return error ? erroDb(error) : NextResponse.json(data);
    }
    case "receber":
    case "conciliar": {
      const itens = (b.itens ?? []).filter((i) => i.id && UUID.test(i.id) && Number(i.valor) > 0);
      if (!itens.length) return NextResponse.json({ error: "Nenhuma conta válida" }, { status: 400 });
      if (b.acao === "conciliar") {
        if (!b.movimento_id) return NextResponse.json({ error: "movimento_id obrigatório" }, { status: 400 });
        const { data: mov } = await fin().from("banco_movimentos").select("data").eq("id", b.movimento_id).maybeSingle();
        const { data, error } = await fin().rpc("receber_v1_baixar", {
          p_itens: itens.map((i) => ({ id: i.id, valor: i.valor, juros: i.juros ?? 0, cod_cc: null, obs: "Conciliado pelo extrato" })),
          p_data: (mov as { data?: string } | null)?.data ?? b.data, p_obs: null, p_usuario: a.email, p_lote: false, p_movimento_id: b.movimento_id,
        });
        return error ? erroDb(error) : NextResponse.json(data);
      }
      if (!b.data || !ISO.test(b.data)) return NextResponse.json({ error: "data (YYYY-MM-DD) obrigatória" }, { status: 400 });
      const { data, error } = await fin().rpc("receber_v1_baixar", {
        p_itens: itens, p_data: b.data, p_obs: b.obs ?? null, p_usuario: a.email, p_lote: !!b.lote, p_movimento_id: null,
      });
      return error ? erroDb(error) : NextResponse.json(data);
    }
    default:
      return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  }
}

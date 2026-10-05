import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { supaAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

/**
 * Rascunhos da folha "Nova emissão" (05/10/26) — orders.fat_rascunhos.
 *  GET                      → lista (status rascunho), mais recentes primeiro
 *  GET ?id=N                → um rascunho com o estado completo (payload)
 *  GET ?chaves=1            → chaves de PV/OS da carteira que têm rascunho aberto (selo na lista)
 *  POST { id?, ...resumo, payload } → cria ou atualiza (não reserva numeração)
 *  PATCH { id, status: "descartado" | "emitido" | "rascunho", emissao_id? }
 *  POST { op: "duplicar", id } → cópia como novo rascunho
 */
const COLS = "id,empresa,tipo,operacao,origem,chave,rotulo,cliente_codigo,cliente_nome,destinatario,projeto,valor_total,titulo,status,emissao_id,criado_por,criado_em,atualizado_por,atualizado_em";

export async function GET(req: NextRequest) {
  const quem = await exigirFaturamento();
  if (quem instanceof NextResponse) return quem;
  const sp = req.nextUrl.searchParams;
  const t = supaAdmin().schema("orders").from("fat_rascunhos");
  try {
    if (sp.get("id")) {
      const { data, error } = await t.select(`${COLS},payload`).eq("id", Number(sp.get("id"))).maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) return NextResponse.json({ error: "Rascunho não encontrado" }, { status: 404 });
      return NextResponse.json({ rascunho: data });
    }
    if (sp.get("chaves")) {
      const { data, error } = await t.select("id,chave").eq("status", "rascunho").not("chave", "is", null);
      if (error) throw new Error(error.message);
      return NextResponse.json({ chaves: data ?? [] });
    }
    const { data, error } = await t.select(COLS).eq("status", "rascunho").order("atualizado_em", { ascending: false }).limit(200);
    if (error) throw new Error(error.message);
    return NextResponse.json({ rascunhos: data ?? [] });
  } catch (e) { return falha(e); }
}

type Corpo = {
  op?: string; id?: number | null; empresa?: string; tipo?: string; operacao?: string | null; origem?: string;
  chave?: string | null; rotulo?: string | null; cliente_codigo?: string | null; cliente_nome?: string | null;
  destinatario?: string | null; projeto?: string | null; valor_total?: number; titulo?: string | null; payload?: unknown;
};

export async function POST(req: NextRequest) {
  const quem = await exigirFaturamento();
  if (quem instanceof NextResponse) return quem;
  const b = (await req.json().catch(() => null)) as Corpo | null;
  if (!b) return falha("corpo inválido");
  const t = supaAdmin().schema("orders").from("fat_rascunhos");
  const agora = new Date().toISOString();
  try {
    if (b.op === "duplicar") {
      const { data: o, error: e1 } = await t.select("*").eq("id", Number(b.id)).maybeSingle();
      if (e1 || !o) throw new Error(e1?.message ?? "Rascunho não encontrado");
      const { id: _id, criado_em: _c, atualizado_em: _a, emissao_id: _e, ...resto } = o as Record<string, unknown>;
      const { data, error } = await t.insert({ ...resto, status: "rascunho", titulo: `Cópia de ${o.titulo ?? o.cliente_nome ?? `#${o.id}`}`,
        criado_por: quem.email, atualizado_por: quem.email }).select("id").single();
      if (error) throw new Error(error.message);
      return NextResponse.json({ ok: true, id: data.id });
    }
    if (!b.payload || !b.empresa || !b.tipo) return falha("rascunho sem empresa/tipo/estado");
    const linha = {
      empresa: b.empresa, tipo: b.tipo, operacao: b.operacao ?? null, origem: b.origem ?? "novo", chave: b.chave ?? null,
      rotulo: b.rotulo ?? null, cliente_codigo: b.cliente_codigo ?? null, cliente_nome: b.cliente_nome ?? null,
      destinatario: b.destinatario ?? null, projeto: b.projeto ?? null, valor_total: Number(b.valor_total) || 0,
      titulo: b.titulo ?? null, payload: b.payload, atualizado_por: quem.email, atualizado_em: agora,
    };
    if (b.id) {
      const { data, error } = await t.update(linha).eq("id", b.id).eq("status", "rascunho").select("id,atualizado_em").maybeSingle();
      if (error) throw new Error(error.message);
      if (data) return NextResponse.json({ ok: true, id: data.id, salvo_em: data.atualizado_em });
      // rascunho já emitido/descartado: segue como um novo
    }
    const { data, error } = await t.insert({ ...linha, status: "rascunho", criado_por: quem.email }).select("id,atualizado_em").single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true, id: data.id, salvo_em: data.atualizado_em });
  } catch (e) { return falha(e); }
}

export async function PATCH(req: NextRequest) {
  const quem = await exigirFaturamento();
  if (quem instanceof NextResponse) return quem;
  const b = (await req.json().catch(() => null)) as { id?: number; status?: string; emissao_id?: number | null } | null;
  if (!b?.id || !["descartado", "emitido", "rascunho"].includes(String(b.status))) return falha("id/status inválidos");
  try {
    const { error } = await supaAdmin().schema("orders").from("fat_rascunhos")
      .update({ status: b.status, emissao_id: b.emissao_id ?? null, atualizado_por: quem.email, atualizado_em: new Date().toISOString() })
      .eq("id", b.id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) { return falha(e); }
}

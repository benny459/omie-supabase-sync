// Cenários e linhas de simulação do Fluxo de Caixa (sql/140).
// GET → { cenarios, eventos } (os meus + os compartilhados)
// POST { acao: "salvar_cenario", cenario: {id?, nome, cor, alavancas, eventos[], empresas[], compartilhado} }
//      { acao: "excluir_cenario", id }
//      { acao: "criar_evento", evento: {descricao, natureza, valor, data, repeticoes, empresa} }
//      { acao: "excluir_evento", id }
// A simulação roda no navegador; nada aqui grava título.
import { NextResponse } from "next/server";
import { fin, erroDb } from "@/lib/financeiro-baixas";
import { exigirFluxo } from "@/lib/fluxo-auth";

export const runtime = "nodejs";
const UUID = /^[0-9a-f-]{36}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET() {
  const a = await exigirFluxo();
  if (a instanceof NextResponse) return a;
  const filtro = `compartilhado.eq.true,criado_por.eq.${a.email}`;
  const [c, e] = await Promise.all([
    fin().from("fluxo_cenarios").select("*").or(filtro).order("criado_em"),
    fin().from("fluxo_eventos").select("*").order("data"),
  ]);
  if (c.error) return erroDb(c.error);
  if (e.error) return erroDb(e.error);
  return NextResponse.json({ cenarios: c.data ?? [], eventos: e.data ?? [], usuario: a.email }, { headers: { "Cache-Control": "no-store" } });
}

type Corpo = {
  acao?: string; id?: string | number;
  cenario?: { id?: string; nome?: string; cor?: string; alavancas?: Record<string, number>; eventos?: number[]; empresas?: string[]; compartilhado?: boolean };
  evento?: { descricao?: string; natureza?: string; valor?: number; data?: string; repeticoes?: number; empresa?: string };
};

export async function POST(req: Request) {
  const a = await exigirFluxo();
  if (a instanceof NextResponse) return a;
  const b = (await req.json().catch(() => ({}))) as Corpo;

  if (b.acao === "salvar_cenario" && b.cenario) {
    const c = b.cenario;
    const linha = {
      nome: String(c.nome ?? "Cenário").slice(0, 80), cor: String(c.cor ?? "#f59e0b").slice(0, 20),
      alavancas: c.alavancas ?? {}, eventos: (c.eventos ?? []).map(Number).filter(Number.isFinite),
      empresas: c.empresas ?? null, compartilhado: !!c.compartilhado, atualizado_em: new Date().toISOString(),
    };
    if (c.id && UUID.test(c.id)) {
      const { data: atual } = await fin().from("fluxo_cenarios").select("criado_por, compartilhado").eq("id", c.id).maybeSingle();
      if (atual && atual.criado_por !== a.email && !atual.compartilhado) return NextResponse.json({ error: "Cenário de outra pessoa" }, { status: 403 });
      if (atual) {
        const { data, error } = await fin().from("fluxo_cenarios").update(linha).eq("id", c.id).select().single();
        return error ? erroDb(error) : NextResponse.json({ cenario: data });
      }
    }
    const { data, error } = await fin().from("fluxo_cenarios").insert({ ...linha, criado_por: a.email }).select().single();
    return error ? erroDb(error) : NextResponse.json({ cenario: data });
  }
  if (b.acao === "excluir_cenario" && typeof b.id === "string" && UUID.test(b.id)) {
    const { data: atual } = await fin().from("fluxo_cenarios").select("criado_por").eq("id", b.id).maybeSingle();
    if (atual && atual.criado_por !== a.email) return NextResponse.json({ error: "Só quem criou exclui o cenário" }, { status: 403 });
    const { error } = await fin().from("fluxo_cenarios").delete().eq("id", b.id);
    return error ? erroDb(error) : NextResponse.json({ ok: true });
  }
  if (b.acao === "criar_evento" && b.evento) {
    const e = b.evento;
    if (!e.descricao?.trim() || !(Number(e.valor) > 0) || !ISO.test(String(e.data)) || !["E", "S"].includes(String(e.natureza)))
      return NextResponse.json({ error: "Descrição, valor, data e entrada/saída" }, { status: 400 });
    const { data, error } = await fin().from("fluxo_eventos").insert({
      descricao: e.descricao.trim().slice(0, 200), natureza: e.natureza, valor: Math.round(Number(e.valor) * 100) / 100, data: e.data,
      repeticoes: Math.max(1, Math.min(36, Number(e.repeticoes) || 1)), empresa: String(e.empresa ?? "SF"), criado_por: a.email,
    }).select().single();
    return error ? erroDb(error) : NextResponse.json({ evento: data });
  }
  if (b.acao === "excluir_evento" && Number(b.id) > 0) {
    const { error } = await fin().from("fluxo_eventos").delete().eq("id", Number(b.id));
    return error ? erroDb(error) : NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "ação inválida" }, { status: 400 });
}

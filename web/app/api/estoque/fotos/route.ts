// Busca automática de fotos do Estoque — estado e controles (admin).
// GET  → provedor (pronto? o que falta), job (ligado, cota do dia, usados hoje, motivo de pausa), progresso.
// POST { acao: "iniciar" | "pausar" }        (admin) → liga/desliga o job (o cron roda a cada 5 min)
// POST { acao: "cota", cota }                 (admin) → buscas por dia (padrão 100 = faixa grátis do Google)
// POST { acao: "rodar" }                      (admin) → roda um ciclo agora (a tela chama enquanto está aberta)
// POST { acao: "refazer_sem_resultado" }      (admin) → devolve à fila os itens que não acharam foto
// Nenhuma chamada paga acontece sem IMAGE_SEARCH_PROVIDER + IMAGE_SEARCH_KEY (+ IMAGE_SEARCH_CX no Google).

import { NextResponse } from "next/server";
import { exigirAdminEstoque, orders, platform, quemEstoque } from "@/lib/estoque-server";
import { configProvedor, rodarCiclo, urlsAssinadas } from "@/lib/estoque-fotos";

export const runtime = "nodejs";
export const maxDuration = 60;

async function estado() {
  const db = platform();
  const [job, fotos, busca] = await Promise.all([
    db.from("estoque_foto_job").select("*").eq("id", 1).single(),
    db.from("estoque_foto").select("origem"),
    db.from("estoque_foto_busca").select("status"),
  ]);
  const erro = job.error ?? fotos.error ?? busca.error;
  if (erro) throw new Error(erro.message);
  const cont = (l: { status?: string; origem?: string }[] | null, k: "status" | "origem") =>
    (l ?? []).reduce<Record<string, number>>((m, x) => { const v = String(x[k]); m[v] = (m[v] ?? 0) + 1; return m; }, {});
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const j = job.data as Record<string, unknown>;
  return {
    provedor: configProvedor(),
    job: { ...j, usados_hoje: j.dia === hoje ? Number(j.usados_dia) : 0, rodando: !!j.rodando_ate && new Date(String(j.rodando_ate)) > new Date() },
    fotos: { total: (fotos.data ?? []).length, por_origem: cont(fotos.data as { origem: string }[], "origem") },
    busca: cont(busca.data as { status: string }[], "status"),
  };
}

/** Página Fotos: últimas fotos achadas (URL assinada), itens sem achado e o ritmo da última meia hora. */
async function detalhes() {
  const db = platform();
  const meia = new Date(Date.now() - 30 * 60_000).toISOString();
  const [rec, sem, ritmo] = await Promise.all([
    db.from("estoque_foto").select("n_cod_prod, path, origem, created_at").order("created_at", { ascending: false }).limit(24),
    db.from("estoque_foto_busca").select("n_cod_prod, termo, status, ultimo_erro, buscado_em").in("status", ["sem_resultado", "erro"]).order("buscado_em", { ascending: false }).limit(200),
    db.from("estoque_foto_busca").select("n_cod_prod", { count: "exact", head: true }).gte("buscado_em", meia),
  ]);
  const erro = rec.error ?? sem.error;
  if (erro) throw new Error(erro.message);
  const recs = (rec.data ?? []) as { n_cod_prod: number; path: string; origem: string; created_at: string }[];
  const sems = (sem.data ?? []) as { n_cod_prod: number; termo: string | null; status: string; ultimo_erro: string | null; buscado_em: string | null }[];
  const ids = [...new Set([...recs, ...sems].map((x) => Number(x.n_cod_prod)))];
  const [urls, pos] = await Promise.all([
    urlsAssinadas(recs.map((r) => r.path)).catch(() => new Map<string, string>()),
    ids.length ? orders().from("estoque_posicao").select("n_cod_prod, codigo, descricao").in("n_cod_prod", ids) : Promise.resolve({ data: [], error: null }),
  ]);
  const nome = new Map(((pos.data ?? []) as { n_cod_prod: number; codigo: string; descricao: string }[]).map((p) => [Number(p.n_cod_prod), p]));
  return {
    recentes: recs.map((r) => ({ ...r, url: urls.get(r.path) ?? null, codigo: nome.get(Number(r.n_cod_prod))?.codigo ?? null, descricao: nome.get(Number(r.n_cod_prod))?.descricao ?? null })),
    sem_achado: sems.map((r) => ({ ...r, codigo: nome.get(Number(r.n_cod_prod))?.codigo ?? null, descricao: nome.get(Number(r.n_cod_prod))?.descricao ?? null })),
    ritmo_por_min: Math.round(((ritmo.count ?? 0) / 30) * 10) / 10,
  };
}

export async function GET(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const resumo = new URL(req.url).searchParams.get("resumo");
  try { return NextResponse.json({ ...(await estado()), ...(resumo ? {} : await detalhes()), admin: q.admin }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: Request) {
  const q = await exigirAdminEstoque();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { acao?: string; cota?: number };
  const db = platform();
  const agora = new Date().toISOString();
  try {
    if (b.acao === "iniciar") {
      const cfg = configProvedor();
      if (!cfg.pronto) return NextResponse.json({ error: `Busca automática aguardando chave: falta ${cfg.faltando.join(", ")} na Vercel` }, { status: 409 });
      const r = await db.from("estoque_foto_job").update({ ativo: true, pausa_motivo: null, ultimo_erro: null, updated_by_email: q.email, updated_at: agora }).eq("id", 1);
      if (r.error) throw new Error(r.error.message);
    } else if (b.acao === "pausar") {
      const r = await db.from("estoque_foto_job").update({ ativo: false, pausa_motivo: `pausado por ${q.email}`, updated_by_email: q.email, updated_at: agora }).eq("id", 1);
      if (r.error) throw new Error(r.error.message);
    } else if (b.acao === "cota") {
      const c = Math.round(Number(b.cota));
      if (!(c >= 1 && c <= 10000)) return NextResponse.json({ error: "Cota entre 1 e 10.000 buscas por dia" }, { status: 400 });
      const r = await db.from("estoque_foto_job").update({ cota_dia: c, updated_by_email: q.email, updated_at: agora }).eq("id", 1);
      if (r.error) throw new Error(r.error.message);
    } else if (b.acao === "rodar") {
      const r = await rodarCiclo({ max: 120, prazoMs: 40_000, email: "busca automática" });
      return NextResponse.json({ ciclo: r, ...(await estado()) });
    } else if (b.acao === "refazer_sem_resultado") {
      const r = await db.from("estoque_foto_busca").update({ status: "pendente", tentativas: 0 }).eq("status", "sem_resultado");
      if (r.error) throw new Error(r.error.message);
    } else return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
    return NextResponse.json({ ok: true, ...(await estado()) });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

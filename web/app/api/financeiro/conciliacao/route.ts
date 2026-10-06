// /api/financeiro/conciliacao (05/10/26)
//  GET  ?empresa&cod_cc&de&ate → movimentos do extrato (com o que já está casado),
//       sugestões por movimento e títulos do painel em aberto para casar à mão.
//  POST { acao: "conciliar", movimento_id, itens: [{ titulo, valor, forcar?, obs? }] }
//       { acao: "desfazer",  movimento_id, motivo? }
//       { acao: "ignorar" | "reativar", movimento_id, motivo? }
//       { acao: "lancar", movimento_id, categoria, descricao? } → cria o título (tarifa, juros,
//         rendimento, despesa sem título) e já concilia
//       { acao: "regra_criar", contem, acao_regra: "ignorar"|"lancar", categoria?, descricao?, natureza?, empresa?, cod_cc?, valor_max? }
//       { acao: "regra_remover", id }   { acao: "regras_aplicar", empresa, cod_cc, de?, ate? }
//  GET  ?regras=1 → regras de conciliação
//  GET  ?resumo=1&de&ate → visão geral de TODAS as contas (06/10/26): % conciliado, pendentes (qtd/R$,
//       entradas×saídas), último extrato importado — para ver de cara qual banco precisa de atenção
//  GET  ?candidatos=<mov>&q&vmin&vmax&venc_de&venc_ate&todas=1 → painel "Casar" (sql/73): candidatos com
//       motivos (valor, vencimento, CNPJ/nome/NF no histórico, nosso número, aprendido) de TODOS os
//       títulos em aberto (Omie + painel), grupos de parcelas e busca livre
//  GET  ?transferencia=<mov> → movimentos opostos de outras contas (transferência entre contas)
//  POST { acao: "casar", movimento_id, itens: [{ ref: "o:|p:|r:…", valor, juros?, desconto?, multa? }], aprender? }
//       { acao: "aceitar_lote", movimentos: [ids], limiar? } → 1º candidato (≥ limiar, sem empate) de cada um
//       { acao: "transferencia", movimento_id, par? }  { acao: "transferencia_desfazer", movimento_id }
//       { acao: "lancar", …, pessoa? } → com fornecedor/cliente do cadastro
//       { acao: "auto", empresa, cod_cc, de?, ate? } → conciliação automática (só o
//       que é praticamente certo: valor exato + CNPJ/documento; grupo do mesmo documento)
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";

export const runtime = "nodejs";
export const maxDuration = 60;

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const a = await exigir("financeiro.conciliar");
  if (a instanceof NextResponse) return a;
  const u = new URL(req.url);
  const candMov = Number(u.searchParams.get("candidatos") ?? 0);
  if (candMov) {
    const num = (k: string) => { const v = u.searchParams.get(k); return v && v.trim() !== "" && Number.isFinite(Number(v.replace(",", "."))) ? Number(v.replace(",", ".")) : null; };
    const dt = (k: string) => { const v = u.searchParams.get(k) ?? ""; return ISO.test(v) ? v : null; };
    const { data, error } = await fin().rpc("conciliacao_candidatos", {
      p_movimento_id: candMov, p_q: (u.searchParams.get("q") ?? "").trim() || null,
      p_vmin: num("vmin"), p_vmax: num("vmax"), p_venc_de: dt("venc_de"), p_venc_ate: dt("venc_ate"),
      p_todas_empresas: u.searchParams.get("todas") === "1", p_lim: Math.min(200, Number(u.searchParams.get("lim") ?? 60) || 60),
    });
    if (error) return erroDb(error);
    return NextResponse.json({ ...(data as object), pode_baixar: !!a.pode["financeiro.baixar"] });
  }
  const trMov = Number(u.searchParams.get("transferencia") ?? 0);
  if (trMov) {
    const { data, error } = await fin().rpc("transferencia_candidatos", { p_movimento_id: trMov });
    if (error) return erroDb(error);
    return NextResponse.json({ candidatos: data ?? [] });
  }
  if (u.searchParams.get("resumo")) {
    const de = u.searchParams.get("de") ?? "", ate = u.searchParams.get("ate") ?? "";
    if (!ISO.test(de) || !ISO.test(ate)) return NextResponse.json({ error: "de e ate (YYYY-MM-DD) obrigatórios" }, { status: 400 });
    const { data, error } = await fin().rpc("conciliacao_resumo", { p_de: de, p_ate: ate });
    if (error) return erroDb(error);
    return NextResponse.json({ contas: data ?? [] });
  }
  if (u.searchParams.get("regras")) {
    const { data, error } = await fin().from("conciliacao_regras").select("*").eq("ativo", true).order("id", { ascending: false });
    if (error) return erroDb(error);
    return NextResponse.json({ regras: data ?? [] });
  }
  const empresa = (u.searchParams.get("empresa") ?? "").toUpperCase();
  const codCc = Number(u.searchParams.get("cod_cc") ?? 0);
  const de = u.searchParams.get("de") ?? "", ate = u.searchParams.get("ate") ?? "";
  if (!empresa || !codCc || !ISO.test(de) || !ISO.test(ate)) {
    return NextResponse.json({ error: "empresa, cod_cc, de e ate (YYYY-MM-DD) obrigatórios" }, { status: 400 });
  }
  const { data, error } = await fin().rpc("conciliacao_painel", { p_empresa: empresa, p_cod_cc: codCc, p_de: de, p_ate: ate });
  if (error) return erroDb(error);
  return NextResponse.json({ ...(data as object), pode_baixar: !!a.pode["financeiro.baixar"] });
}

export async function POST(req: Request) {
  const a = await exigir("financeiro.conciliar");
  if (a instanceof NextResponse) return a;
  let b: { acao?: string; movimento_id?: number; itens?: { titulo: string; valor: number; forcar?: boolean; obs?: string }[]; motivo?: string;
           casar?: { ref: string; valor: number; juros?: number; desconto?: number; multa?: number; obs?: string }[]; aprender?: boolean;
           movimentos?: number[]; limiar?: number; par?: number | null; pessoa?: string | null;
           empresa?: string; cod_cc?: number; de?: string; ate?: string; categoria?: string; descricao?: string;
           contem?: string; acao_regra?: string; natureza?: string; valor_max?: number; id?: number };
  try { b = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (b.acao === "regra_criar") {
    const contem = String(b.contem ?? "").trim();
    if (contem.length < 3) return NextResponse.json({ error: "Informe um trecho do histórico com 3+ letras" }, { status: 400 });
    if (b.acao_regra !== "ignorar" && b.acao_regra !== "lancar") return NextResponse.json({ error: "Ação da regra: ignorar ou lançar" }, { status: 400 });
    if (b.acao_regra === "lancar" && !b.categoria) return NextResponse.json({ error: "Escolha a categoria" }, { status: 400 });
    const { data, error } = await fin().from("conciliacao_regras").insert({
      empresa: b.empresa ? String(b.empresa).toUpperCase() : null, cod_cc: b.cod_cc ? Number(b.cod_cc) : null, contem,
      natureza: b.natureza === "P" || b.natureza === "R" ? b.natureza : null,
      valor_max: b.valor_max ? Number(b.valor_max) : null, acao: b.acao_regra,
      categoria_cod: b.categoria ?? null, descricao: b.descricao ?? null, motivo: b.acao_regra === "ignorar" ? (b.motivo || `Regra: ${contem}`) : null,
      criado_por: a.email,
    }).select("id").single();
    if (error) return erroDb(error);
    return NextResponse.json({ ok: true, id: data.id });
  }
  if (b.acao === "regra_remover") {
    const { error } = await fin().from("conciliacao_regras").update({ ativo: false }).eq("id", Number(b.id ?? 0));
    if (error) return erroDb(error);
    return NextResponse.json({ ok: true });
  }
  if (b.acao === "regras_aplicar") {
    if (!a.pode["financeiro.baixar"]) return NextResponse.json({ error: "Sem permissão (financeiro.baixar)" }, { status: 403 });
    const r = await fin().rpc("regras_aplicar", {
      p_empresa: b.empresa ? String(b.empresa).toUpperCase() : null, p_cod_cc: b.cod_cc ? Number(b.cod_cc) : null,
      p_de: b.de && ISO.test(b.de) ? b.de : null, p_ate: b.ate && ISO.test(b.ate) ? b.ate : null,
    });
    if (r.error) return erroDb(r.error);
    return NextResponse.json(r.data);
  }
  if (b.acao === "auto") {
    if (!a.pode["financeiro.baixar"]) return NextResponse.json({ error: "Sem permissão (financeiro.baixar)" }, { status: 403 });
    const r = await fin().rpc("conciliacao_auto", {
      p_empresa: b.empresa ? String(b.empresa).toUpperCase() : null, p_cod_cc: b.cod_cc ? Number(b.cod_cc) : null,
      p_de: b.de && ISO.test(b.de) ? b.de : null, p_ate: b.ate && ISO.test(b.ate) ? b.ate : null,
    });
    if (r.error) return erroDb(r.error);
    return NextResponse.json(r.data);
  }
  if (b.acao === "aceitar_lote") {
    if (!a.pode["financeiro.baixar"]) return NextResponse.json({ error: "Sem permissão (financeiro.baixar)" }, { status: 403 });
    const ids = (b.movimentos ?? []).map(Number).filter((n) => n > 0).slice(0, 25);
    const limiar = Math.max(60, Number(b.limiar ?? 80) || 80);
    const usados = new Set<string>(); let ok = 0; const pulados: { id: number; motivo: string }[] = []; const erros: { id: number; erro: string }[] = [];
    for (const id of ids) {
      const c = await fin().rpc("conciliacao_candidatos", { p_movimento_id: id, p_lim: 5 });
      if (c.error) { erros.push({ id, erro: c.error.message }); continue; }
      const d = c.data as { movimento: { restante: number }; candidatos: { ref: string; saldo: number; score: number }[]; grupos: { itens: { ref: string; saldo: number }[]; motivos: string[] }[] };
      const rest = Number(d.movimento?.restante ?? 0);
      const [c1, c2] = d.candidatos ?? [];
      let itens: { ref: string; valor: number }[] | null = null;
      if (c1 && c1.score >= limiar && !(c2 && c2.score >= c1.score) && Math.abs(Number(c1.saldo) - rest) < 0.005) itens = [{ ref: c1.ref, valor: rest }];
      else if (!c1 && d.grupos?.length === 1 && d.grupos[0].motivos.length > 1) itens = d.grupos[0].itens.map((x) => ({ ref: x.ref, valor: Number(x.saldo) }));
      if (!itens) { pulados.push({ id, motivo: c1 ? `melhor ${c1.score} pts${c2 && c2.score >= c1.score ? " (empate)" : ""}` : "sem candidato" }); continue; }
      if (itens.some((x) => usados.has(x.ref))) { pulados.push({ id, motivo: "título já usado neste lote" }); continue; }
      const r = await fin().rpc("conciliar_casar", { p_movimento_id: id, p_itens: itens, p_aprender: true, p_usuario: a.email });
      if (r.error) { erros.push({ id, erro: r.error.message }); continue; }
      ok++; itens.forEach((x) => usados.add(x.ref));
    }
    return NextResponse.json({ ok: true, conciliados: ok, pulados, erros });
  }
  const mov = Number(b.movimento_id ?? 0);
  if (!mov) return NextResponse.json({ error: "movimento_id obrigatório" }, { status: 400 });

  let r;
  if (b.acao === "casar") {
    if (!a.pode["financeiro.baixar"]) return NextResponse.json({ error: "Sem permissão (financeiro.baixar)" }, { status: 403 });
    const n2 = (v: unknown) => Math.round((Number(v) || 0) * 100) / 100;
    const itens = (b.casar ?? []).filter((i) => i && /^[opr]:/.test(String(i.ref)) && Number(i.valor) > 0)
      .map((i) => ({ ref: String(i.ref), valor: n2(i.valor), juros: n2(i.juros), desconto: n2(i.desconto), multa: n2(i.multa),
                     ...(i.obs ? { obs: String(i.obs).slice(0, 300) } : {}) }));
    if (!itens.length) return NextResponse.json({ error: "Escolha ao menos um título" }, { status: 400 });
    r = await fin().rpc("conciliar_casar", { p_movimento_id: mov, p_itens: itens, p_aprender: b.aprender !== false, p_usuario: a.email });
  } else if (b.acao === "transferencia") {
    if (!a.pode["financeiro.baixar"]) return NextResponse.json({ error: "Sem permissão (financeiro.baixar)" }, { status: 403 });
    r = await fin().rpc("transferencia_marcar", { p_movimento_id: mov, p_par: b.par ? Number(b.par) : null, p_usuario: a.email });
  } else if (b.acao === "transferencia_desfazer") {
    r = await fin().rpc("transferencia_desfazer", { p_movimento_id: mov, p_usuario: a.email });
  } else if (b.acao === "conciliar") {
    // conciliar dá baixa: exige também a permissão de baixar
    if (!a.pode["financeiro.baixar"]) return NextResponse.json({ error: "Sem permissão (financeiro.baixar)" }, { status: 403 });
    const itens = (b.itens ?? []).filter((i) => i && i.titulo && Number(i.valor) > 0)
      .map((i) => ({ titulo: String(i.titulo), valor: Math.round(Number(i.valor) * 100) / 100, forcar: !!i.forcar, ...(i.obs ? { obs: String(i.obs).slice(0, 300) } : {}) }));
    if (!itens.length) return NextResponse.json({ error: "Escolha ao menos um título" }, { status: 400 });
    r = await fin().rpc("conciliar", { p_movimento_id: mov, p_itens: itens, p_usuario: a.email });
  } else if (b.acao === "lancar") {
    if (!a.pode["financeiro.baixar"]) return NextResponse.json({ error: "Sem permissão (financeiro.baixar)" }, { status: 403 });
    r = b.pessoa
      ? await fin().rpc("movimento_lancar_pessoa", { p_movimento_id: mov, p_categoria: String(b.categoria ?? ""), p_descricao: b.descricao ?? null, p_pessoa_codigo: String(b.pessoa), p_usuario: a.email })
      : await fin().rpc("movimento_lancar", { p_movimento_id: mov, p_categoria: String(b.categoria ?? ""), p_descricao: b.descricao ?? null, p_usuario: a.email });
  } else if (b.acao === "desfazer") {
    r = await fin().rpc("conciliacao_desfazer", { p_movimento_id: mov, p_motivo: b.motivo ?? null, p_usuario: a.email });
  } else if (b.acao === "ignorar" || b.acao === "reativar") {
    r = await fin().rpc("movimento_ignorar", { p_movimento_id: mov, p_ignorar: b.acao === "ignorar", p_motivo: b.motivo ?? null, p_usuario: a.email });
  } else {
    return NextResponse.json({ error: "acao inválida" }, { status: 400 });
  }
  if (r.error) return erroDb(r.error);
  return NextResponse.json(r.data);
}

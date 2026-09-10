// O fluxo de caixa previsto de um projeto.
//
//   GET  ?empresa=&codigo_projeto=   → linhas + cabeçalho + realizado + cobertura
//   PUT                              → grava a grade inteira (substitui as linhas)
//   POST { acao: "enviar" | "aprovar" | "rejeitar" | "reabrir" }
//
// ── Por que PUT substitui tudo ───────────────────────────────────────────────
// A tela é uma grade tipo planilha: a pessoa digita, cola do Excel, apaga
// linhas. Mandar diffs a partir disso exigiria rastrear identidade de linha
// numa UI onde ela não existe — colar 30 linhas por cima de 12 não tem "linha
// correspondente". Substituir o conjunto é o que casa com o gesto.
//
// ── Por que quem grava não é quem aprova ─────────────────────────────────────
// canEdit(projetos, "pvos") lança; canApprove(projetos) decide. É a mesma
// matriz de permissão do resto do módulo — uma regra paralela aqui sairia de
// sincronia com a de lá no primeiro ajuste.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canApprove, canEdit } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";

export const runtime = "nodejs";
export const maxDuration = 60;

type LinhaIn = {
  tipo: "entrada" | "saida";
  descricao: string;
  categoria?: string | null;
  data_prevista: string;
  valor: number;
  observacao?: string | null;
  origem?: "manual" | "planilha" | "import";
};

const ehData = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

async function contexto(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return { erro: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };

  const url = new URL(req.url);
  const empresa = url.searchParams.get("empresa");
  const codigo  = Number(url.searchParams.get("codigo_projeto"));
  return { supa, user, empresa, codigo, url };
}

export async function GET(req: Request) {
  const ctx = await contexto(req);
  if ("erro" in ctx) return ctx.erro;
  const { user, empresa, codigo } = ctx;
  if (!empresa || !Number.isFinite(codigo)) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }

  const perms = await loadPerms();
  const admin = supaAdmin();

  // Tudo de uma vez: a tela mostra as quatro coisas juntas e buscar em série
  // somaria quatro idas ao banco antes do primeiro pixel.
  const [linhas, cab, realizado, cobertura, eventos, previsto, saldo, orc] = await Promise.all([
    admin.schema("approval").from("projeto_fluxo_linha")
      .select("id, tipo, descricao, categoria, data_prevista, valor, observacao, origem, ordem")
      .eq("empresa", empresa).eq("codigo_projeto", codigo)
      .order("data_prevista", { ascending: true }).order("ordem", { ascending: true }),
    admin.schema("approval").from("projeto_fluxo")
      .select("*").eq("empresa", empresa).eq("codigo_projeto", codigo).maybeSingle(),
    admin.schema("bi").rpc("projeto_realizado_mensal", { p_codigo_projeto: codigo }),
    admin.schema("bi").rpc("projeto_cobertura_titulo", { p_codigo_projeto: codigo }),
    admin.schema("approval").from("projeto_fluxo_evento")
      .select("versao, acao, por, em, motivo, total_entradas, total_saidas, linhas")
      .eq("empresa", empresa).eq("codigo_projeto", codigo)
      .order("em", { ascending: false }).limit(20),
    // O fluxo que o Omie já sabe, com o ajuste de cronograma e o desvio.
    // É o que faz a tela não abrir vazia.
    admin.schema("bi").rpc("projeto_fluxo_previsto", {
      p_codigo_projeto: codigo, p_empresa: empresa,
    }),
    // O realizado dia a dia. A curva de saldo é montada na TELA a partir dele
    // e do previsto — uma função de banco que juntasse os dois teria que
    // recalcular o previsto inteiro, e o previsto é a parte cara.
    admin.schema("bi").rpc("projeto_realizado_diario", { p_codigo_projeto: codigo }),
    // O teto de gasto do projeto. Vem da mesma tabela que a tela de materiais
    // usa — um segundo lugar para editar o mesmo número daria dois budgets.
    admin.schema("approval").from("rc_projetos_budget")
      .select("valor_budget, valor_total_projeto, resultado_bruto_esperado_pct")
      .eq("empresa", empresa).eq("codigo_projeto", codigo).maybeSingle(),
  ]);

  const falha = [["linhas", linhas], ["cabecalho", cab], ["realizado", realizado],
                 ["cobertura", cobertura], ["eventos", eventos], ["previsto", previsto],
                 ["saldo", saldo], ["orcamento", orc]]
    .find(([, r]) => (r as { error?: unknown }).error);
  if (falha) {
    return NextResponse.json(
      { error: `${falha[0]}: ${(falha[1] as { error: { message: string } }).error.message}` },
      { status: 500 });
  }

  return NextResponse.json({
    empresa, codigo_projeto: codigo,
    linhas: linhas.data ?? [],
    // Sem cabeçalho ainda = projeto que nunca teve plano. A tela trata como
    // rascunho vazio em vez de exigir um "criar fluxo" antes de digitar.
    cabecalho: cab.data ?? { status: "rascunho", versao: 1 },
    realizado: realizado.data ?? [],
    cobertura: ((cobertura.data as unknown[]) ?? [])[0] ?? null,
    // Linhas derivadas do Omie + cronograma + desvio. A tela soma isto com as
    // manuais; nada aqui é apagável pelo usuário.
    previsto: previsto.data ?? [],
    realizado_diario: saldo.data ?? [],
    orcamento: orc.data ?? null,
    eventos: eventos.data ?? [],
    pode_editar: canEdit(perms, "projetos", "pvos"),
    pode_aprovar: canApprove(perms, "projetos"),
    eu: user.email ?? user.id,
  });
}

export async function PUT(req: Request) {
  const ctx = await contexto(req);
  if ("erro" in ctx) return ctx.erro;
  const { user } = ctx;

  const perms = await loadPerms();
  if (!canEdit(perms, "projetos", "pvos")) {
    return NextResponse.json({ error: "Sem permissão para lançar o fluxo" }, { status: 403 });
  }

  const body = await req.json().catch(() => null) as
    { empresa?: string; codigo_projeto?: number; linhas?: LinhaIn[] } | null;
  if (!body?.empresa || !Number.isFinite(Number(body.codigo_projeto))) {
    return NextResponse.json({ error: "empresa e codigo_projeto obrigatórios" }, { status: 400 });
  }
  const empresa = String(body.empresa);
  const codigo = Number(body.codigo_projeto);
  const entrada = Array.isArray(body.linhas) ? body.linhas : [];

  // Valida ANTES de apagar. Apagar as linhas boas e falhar ao inserir as novas
  // deixaria o projeto sem plano nenhum por causa de uma data mal digitada.
  const erros: string[] = [];
  const limpas = entrada.map((l, i) => {
    const n = i + 1;
    if (l.tipo !== "entrada" && l.tipo !== "saida") erros.push(`linha ${n}: tipo inválido`);
    if (!String(l.descricao ?? "").trim()) erros.push(`linha ${n}: sem descrição`);
    if (!ehData(l.data_prevista)) erros.push(`linha ${n}: data inválida`);
    const v = Number(l.valor);
    if (!Number.isFinite(v) || v < 0) erros.push(`linha ${n}: valor inválido`);
    return {
      empresa, codigo_projeto: codigo,
      tipo: l.tipo,
      descricao: String(l.descricao ?? "").trim().slice(0, 300),
      categoria: l.categoria ? String(l.categoria).trim().slice(0, 80) : null,
      data_prevista: l.data_prevista,
      valor: Math.round(v * 100) / 100,
      observacao: l.observacao ? String(l.observacao).slice(0, 500) : null,
      origem: l.origem ?? "manual",
      ordem: i,
      criada_por: user.email ?? user.id,
      atualizada_por: user.email ?? user.id,
      atualizada_em: new Date().toISOString(),
    };
  });
  if (erros.length) {
    return NextResponse.json({ error: erros.slice(0, 8).join(" · "), erros }, { status: 400 });
  }

  const admin = supaAdmin();
  const del = await admin.schema("approval").from("projeto_fluxo_linha")
    .delete().eq("empresa", empresa).eq("codigo_projeto", codigo);
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 });

  if (limpas.length) {
    const ins = await admin.schema("approval").from("projeto_fluxo_linha").insert(limpas);
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 });
  } else {
    // Grade esvaziada: o trigger de invalidação só dispara com linha, então o
    // cabeçalho precisa voltar a rascunho aqui — senão um plano aprovado
    // continuaria "aprovado" sem nenhuma linha por trás.
    await admin.schema("approval").from("projeto_fluxo")
      .upsert({ empresa, codigo_projeto: codigo, status: "rascunho",
                atualizado_em: new Date().toISOString() },
              { onConflict: "empresa,codigo_projeto" });
  }

  return NextResponse.json({ ok: true, linhas: limpas.length });
}

export async function POST(req: Request) {
  const ctx = await contexto(req);
  if ("erro" in ctx) return ctx.erro;
  const { user } = ctx;

  const body = await req.json().catch(() => null) as
    { empresa?: string; codigo_projeto?: number; acao?: string; motivo?: string } | null;
  if (!body?.empresa || !Number.isFinite(Number(body.codigo_projeto)) || !body.acao) {
    return NextResponse.json({ error: "empresa, codigo_projeto e acao obrigatórios" }, { status: 400 });
  }
  const empresa = String(body.empresa);
  const codigo = Number(body.codigo_projeto);
  const acao = String(body.acao);
  const perms = await loadPerms();
  const quem = user.email ?? user.id;

  const podeLancar  = canEdit(perms, "projetos", "pvos");
  const podeDecidir = canApprove(perms, "projetos");

  if (acao === "enviar" && !podeLancar) {
    return NextResponse.json({ error: "Sem permissão para enviar o fluxo" }, { status: 403 });
  }
  if (["aprovar", "rejeitar", "reabrir"].includes(acao) && !podeDecidir) {
    return NextResponse.json({ error: "Sem permissão para aprovar o fluxo" }, { status: 403 });
  }
  if (!["enviar", "aprovar", "rejeitar", "reabrir"].includes(acao)) {
    return NextResponse.json({ error: `ação inválida: ${acao}` }, { status: 400 });
  }
  if (acao === "rejeitar" && !String(body.motivo ?? "").trim()) {
    // Rejeitar sem motivo obriga quem lançou a perguntar por fora, e a resposta
    // não volta pro sistema.
    return NextResponse.json({ error: "Diga o motivo da rejeição." }, { status: 400 });
  }

  const admin = supaAdmin();

  // O plano é a soma de DUAS origens: o que vem do Omie (pedido de venda,
  // títulos, pedidos de compra) e o que foi acrescentado à mão.
  //
  // Antes esta rota contava só as linhas manuais. Como o fluxo passou a vir
  // pronto do ERP, um projeto normal tem zero linhas manuais — e enviar para
  // aprovação respondia "não há linhas no fluxo", com R$ 52 mil e R$ 36 mil na
  // tela. Os totais gravados na aprovação também sairiam zerados.
  const [manuais, derivadas] = await Promise.all([
    admin.schema("approval").from("projeto_fluxo_linha").select("tipo, valor")
      .eq("empresa", empresa).eq("codigo_projeto", codigo),
    admin.schema("bi").rpc("projeto_fluxo_previsto",
      { p_codigo_projeto: codigo, p_empresa: empresa }),
  ]);
  if (manuais.error) return NextResponse.json({ error: manuais.error.message }, { status: 500 });
  if (derivadas.error) return NextResponse.json({ error: derivadas.error.message }, { status: 500 });

  const man = (manuais.data ?? []) as Array<{ tipo: string; valor: number }>;
  const der = (derivadas.data ?? []) as Array<{ lado: string; valor: number }>;
  const qtd = man.length + der.length;

  if (acao === "enviar" && !qtd) {
    return NextResponse.json({
      error: "Este projeto não tem nada previsto: nenhum pedido de venda, título ou pedido de compra, e nenhuma linha lançada à mão.",
    }, { status: 400 });
  }
  const totEnt = man.filter((l) => l.tipo === "entrada").reduce((a, l) => a + Number(l.valor), 0)
               + der.filter((l) => l.lado === "entrada").reduce((a, l) => a + Number(l.valor), 0);
  const totSai = man.filter((l) => l.tipo === "saida").reduce((a, l) => a + Number(l.valor), 0)
               + der.filter((l) => l.lado === "saida").reduce((a, l) => a + Number(l.valor), 0);
  const todas = { length: qtd };

  const { data: atual } = await admin.schema("approval").from("projeto_fluxo")
    .select("versao, status").eq("empresa", empresa).eq("codigo_projeto", codigo).maybeSingle();
  const versao = Number((atual as { versao?: number } | null)?.versao ?? 1);
  const agora = new Date().toISOString();

  const novoStatus = acao === "enviar" ? "pendente"
                   : acao === "aprovar" ? "aprovado"
                   : acao === "rejeitar" ? "rejeitado"
                   : "rascunho";

  const patch: Record<string, unknown> = {
    empresa, codigo_projeto: codigo, status: novoStatus, versao, atualizado_em: agora,
  };
  if (acao === "enviar") { patch.enviado_por = quem; patch.enviado_em = agora; patch.motivo = null; }
  if (acao !== "enviar") { patch.decidido_por = quem; patch.decidido_em = agora; patch.motivo = body.motivo ?? null; }
  if (acao === "aprovar") {
    // Fotografia do que foi aprovado: permite dizer depois o que mudou em
    // relação ao plano que passou pela aprovação.
    patch.total_entradas_aprovado = totEnt;
    patch.total_saidas_aprovado   = totSai;
    patch.linhas_aprovadas        = todas.length;
  }

  const up = await admin.schema("approval").from("projeto_fluxo")
    .upsert(patch, { onConflict: "empresa,codigo_projeto" });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  // ── Congela a foto do que foi aprovado ─────────────────────────────────────
  // O desvio é "quanto escorregou desde que foi aprovado". Sem congelar a
  // previsão de cada linha AGORA, o desvio seria medido contra uma data que
  // muda junto com a linha — e nunca acusaria nada.
  if (acao === "aprovar") {
    // Reusa o que já foi buscado acima: previsto é a consulta cara da tela.
    const fotos = (derivadas.data as Array<{
      fonte: string; referencia: string; data_efetiva: string | null; valor: number;
    }> ?? []).map((r) => ({
      empresa, codigo_projeto: codigo, versao,
      fonte: r.fonte, referencia: r.referencia,
      data_prevista: r.data_efetiva, valor: r.valor,
    }));
    if (fotos.length) {
      // Reaprovar a MESMA versão substitui a foto: a última aprovação é a que
      // vale, e duas fotos da mesma versão dariam dois desvios para a linha.
      await admin.schema("approval").from("projeto_fluxo_baseline")
        .delete().eq("empresa", empresa).eq("codigo_projeto", codigo).eq("versao", versao);
      await admin.schema("approval").from("projeto_fluxo_baseline").insert(fotos);
    }
  }

  await admin.schema("approval").from("projeto_fluxo_evento").insert({
    empresa, codigo_projeto: codigo, versao,
    acao: acao === "enviar" ? "enviado" : acao === "aprovar" ? "aprovado"
        : acao === "rejeitar" ? "rejeitado" : "reaberto",
    por: quem, motivo: body.motivo ?? null,
    total_entradas: totEnt, total_saidas: totSai, linhas: todas.length,
  });

  return NextResponse.json({ ok: true, status: novoStatus, versao });
}

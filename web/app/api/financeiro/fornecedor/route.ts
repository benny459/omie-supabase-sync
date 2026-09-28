// GET /api/financeiro/fornecedor?cod=123&empresa=SF&tipo=pagar
//
// Retrato de um fornecedor para ler SEM sair da tela de Contas a Pagar:
// quanto se deve, quanto já se pagou, como ele se comporta em prazo, em que
// categorias entra, e os últimos títulos.
//
// Dois cuidados que mudam o número:
//   · "Em aberto" é pelo saldo (val_aberto), não pelo status — título com
//     status velho e saldo zero já não se paga.
//   · Pontualidade compara pagamento com vencimento SÓ nos títulos que têm as
//     duas datas; sem isso a média mente com os que nunca foram baixados.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const maxDuration = 30;

type Linha = {
  cod_titulo: number;
  vencimento: string | null;
  pagamento: string | null;
  valor_documento: number | string | null;
  val_aberto: number | string | null;
  val_pago: number | string | null;
  status_titulo: string | null;
  categoria: string | null;
  projeto: string | null;
  origem: string | null;
  num_titulo: string | null;
  observacao: string | null;
};

const num = (v: unknown) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  }

  const url = new URL(req.url);
  const cod = Number(url.searchParams.get("cod"));
  const empresa = (url.searchParams.get("empresa") ?? "").trim();
  const tipo = url.searchParams.get("tipo") === "receber" ? "receber" : "pagar";
  if (!Number.isFinite(cod) || cod <= 0) {
    return NextResponse.json({ error: "cod obrigatório" }, { status: 400 });
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );

  // Histórico inteiro do fornecedor, não uma janela: a pergunta é "como é
  // trabalhar com ele", e isso não se responde com os últimos 90 dias.
  const PAGE = 1000;
  const MAX = 10_000;
  const linhas: Linha[] = [];
  let contraparte: string | null = null;
  let contraparteRazao: string | null = null;
  let cnpj: string | null = null;

  for (let off = 0; off < MAX; off += PAGE) {
    let q = admin.from("v_titulos_omie")
      .select("cod_titulo, vencimento, pagamento, valor_documento, val_aberto, val_pago, " +
              "status_titulo, categoria, projeto, origem, num_titulo, observacao, " +
              "contraparte, contraparte_razao, cnpj_cpf")
      .eq("tipo", tipo)
      .eq("codigo_cliente_fornecedor", cod);
    if (empresa) q = q.eq("empresa", empresa);
    const { data, error } = await q
      .order("vencimento", { ascending: false, nullsFirst: false })
      .range(off, off + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const lote = (data ?? []) as unknown as (Linha & {
      contraparte: string | null; contraparte_razao: string | null; cnpj_cpf: string | null;
    })[];
    for (const l of lote) {
      contraparte ??= l.contraparte;
      contraparteRazao ??= l.contraparte_razao;
      cnpj ??= l.cnpj_cpf;
    }
    linhas.push(...lote);
    if (lote.length < PAGE) break;
  }

  if (linhas.length === 0) {
    return NextResponse.json({ error: "Fornecedor sem títulos" }, { status: 404 });
  }

  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

  let emAberto = 0, qtdAberto = 0, vencido = 0, qtdVencido = 0;
  let pago = 0, qtdPago = 0, total = 0;
  let somaAtraso = 0, qtdComAtraso = 0, pagosNoPrazo = 0;
  let primeiro: string | null = null, ultimo: string | null = null;
  const porCategoria = new Map<string, { total: number; qtd: number }>();
  const porAno = new Map<string, { total: number; qtd: number }>();

  for (const l of linhas) {
    const doc = num(l.valor_documento);
    const aberto = num(l.val_aberto);
    if (l.status_titulo === "CANCELADO") continue;

    total += doc;
    if (aberto > 0) {
      emAberto += aberto; qtdAberto += 1;
      if (l.vencimento && l.vencimento < hoje) { vencido += aberto; qtdVencido += 1; }
    } else {
      pago += num(l.val_pago); qtdPago += 1;
    }

    // Pontualidade: só onde há vencimento E pagamento.
    if (l.vencimento && l.pagamento) {
      const dias = Math.round(
        (Date.parse(l.pagamento) - Date.parse(l.vencimento)) / 86_400_000,
      );
      if (Number.isFinite(dias)) {
        somaAtraso += dias; qtdComAtraso += 1;
        if (dias <= 0) pagosNoPrazo += 1;
      }
    }

    if (l.vencimento) {
      if (!primeiro || l.vencimento < primeiro) primeiro = l.vencimento;
      if (!ultimo || l.vencimento > ultimo) ultimo = l.vencimento;
      const ano = l.vencimento.slice(0, 4);
      const a = porAno.get(ano) ?? { total: 0, qtd: 0 };
      a.total += doc; a.qtd += 1; porAno.set(ano, a);
    }

    const cat = l.categoria ?? "(Sem categoria)";
    const c = porCategoria.get(cat) ?? { total: 0, qtd: 0 };
    c.total += doc; c.qtd += 1; porCategoria.set(cat, c);
  }

  const ordena = (m: Map<string, { total: number; qtd: number }>) =>
    [...m.entries()].map(([nome, v]) => ({ nome, ...v })).sort((a, b) => b.total - a.total);

  return NextResponse.json({
    fornecedor: { cod, nome: contraparte, razao: contraparteRazao, cnpj_cpf: cnpj },
    resumo: {
      titulos: linhas.length,
      total,
      em_aberto: emAberto, qtd_aberto: qtdAberto,
      vencido, qtd_vencido: qtdVencido,
      pago, qtd_pago: qtdPago,
      ticket_medio: linhas.length ? total / linhas.length : 0,
      primeiro_titulo: primeiro,
      ultimo_titulo: ultimo,
      // null quando nunca houve baixa com as duas datas — melhor do que fingir 0.
      atraso_medio_dias: qtdComAtraso ? somaAtraso / qtdComAtraso : null,
      pontualidade_pct: qtdComAtraso ? pagosNoPrazo / qtdComAtraso : null,
      base_pontualidade: qtdComAtraso,
    },
    por_categoria: ordena(porCategoria).slice(0, 8),
    por_ano: [...porAno.entries()].map(([ano, v]) => ({ ano, ...v })).sort((a, b) => a.ano.localeCompare(b.ano)),
    ultimos: linhas.slice(0, 20),
  });
}

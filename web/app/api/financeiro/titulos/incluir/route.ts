// POST /api/financeiro/titulos/incluir — "+ Nova conta". Nada vai ao Omie.
//  · pagar   — desde 05/10/26 (sql/67) nasce no painel: finance.pagar_previsto
//              com origem_titulo='manual' (finance.pagar_manual_incluir). Entra
//              no Contas a Pagar, no BI/fluxo de caixa e na baixa/conciliação.
//  · receber — desde 01/10/26 grava SÓ em finance.receber (sql/20).

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { permissoesDe } from "@/lib/acessos";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;

type Body = {
  tipo: "pagar" | "receber";
  empresa: string;
  codigo_cliente_fornecedor: number;
  valor_documento: number;
  data_vencimento: string;      // YYYY-MM-DD
  data_previsao?: string;       // YYYY-MM-DD (default = vencimento)
  codigo_categoria: string;
  id_conta_corrente: number;
  codigo_projeto?: number | null;
  numero_documento?: string | null;
  observacao?: string | null;

  // Campos que o Omie aceita e o formulario nao mandava. Os nomes seguem a
  // tabela espelho finance.contas_pagar, que e o payload do Omie ja gravado.
  data_emissao?: string | null;        // YYYY-MM-DD
  data_entrada?: string | null;        // YYYY-MM-DD
  numero_parcela?: string | null;
  numero_documento_fiscal?: string | null;
  chave_nfe?: string | null;
  numero_pedido?: string | null;
  codigo_tipo_documento?: string | null;   // NFE BOL PIX DAS CTE ...
  id_origem?: string | null;               // COMP MANP ADCP ...
  valor_pis?: number | null;    retem_pis?: boolean;
  valor_cofins?: number | null; retem_cofins?: boolean;
  valor_csll?: number | null;   retem_csll?: boolean;
  valor_ir?: number | null;     retem_ir?: boolean;
  valor_iss?: number | null;    retem_iss?: boolean;
  valor_inss?: number | null;   retem_inss?: boolean;
};

export async function POST(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  }
  if (!(await permissoesDe(perms))["financeiro.editar_titulo"]) {
    return NextResponse.json({ error: "Sem permissão para incluir títulos" }, { status: 403 });
  }

  let body: Body;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }

  const tipo = body.tipo === "receber" ? "receber" : "pagar";
  const empresa = (body.empresa ?? "SF").toUpperCase();
  if (!body.codigo_cliente_fornecedor || !body.valor_documento || !body.data_vencimento ||
      !body.codigo_categoria || !body.id_conta_corrente) {
    return NextResponse.json({ error: "Campos obrigatórios: contraparte, valor, vencimento, categoria e conta corrente" }, { status: 400 });
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(body.data_vencimento)) {
    return NextResponse.json({ error: "data_vencimento deve ser YYYY-MM-DD" }, { status: 400 });
  }

  const previsaoISO = body.data_previsao && /^\d{4}-\d{2}-\d{2}$/.test(body.data_previsao)
    ? body.data_previsao : body.data_vencimento;

  /* Receber nasce no NOSSO sistema desde 01/10/26 (finance.receber) e não vai
     ao Omie. Com pedido/NF/chave fica 'pendente' até a conciliação achar o
     título que o Omie criar ao faturar; sem documento é conta só do painel. */
  if (tipo === "receber") return incluirReceber(body, empresa, previsaoISO, perms.id ?? null);

  return incluirPagarNativo(body, empresa, previsaoISO);
}

async function incluirPagarNativo(body: Body, empresa: string, previsaoISO: string) {
  const { data: { user } } = await (await supaServer()).auth.getUser();
  const extras: Record<string, unknown> = {};
  if (body.codigo_tipo_documento) extras.codigo_tipo_documento = body.codigo_tipo_documento;
  if (body.id_origem) extras.id_origem = body.id_origem;
  if (body.data_entrada) extras.data_entrada = body.data_entrada;
  if (body.numero_pedido) extras.numero_pedido = body.numero_pedido;
  for (const k of ["pis", "cofins", "csll", "ir", "iss", "inss"] as const) {
    const v = Number(body[`valor_${k}`] ?? 0);
    if (v > 0) { extras[`valor_${k}`] = v; extras[`retem_${k}`] = !!body[`retem_${k}`]; }
  }
  const { data, error } = await supaAdmin().schema("finance").rpc("pagar_manual_incluir", {
    p: {
      empresa,
      fornecedor_cod: body.codigo_cliente_fornecedor,
      valor: body.valor_documento,
      vencimento: body.data_vencimento,
      previsao: previsaoISO,
      categoria_cod: body.codigo_categoria,
      conta_cod: body.id_conta_corrente,
      projeto_cod: body.codigo_projeto ?? null,
      documento: body.numero_documento ?? null,
      obs: body.observacao ?? null,
      emissao: iso(body.data_emissao),
      nf_numero: body.numero_documento_fiscal ?? null,
      chave_nfe: body.chave_nfe ?? null,
      numero_parcela: body.numero_parcela ?? null,
      tipo_doc: body.codigo_tipo_documento ?? null,
      extras: Object.keys(extras).length ? extras : null,
    },
    p_usuario: user?.email ?? "?",
  });
  if (error) return NextResponse.json({ error: (error.message ?? "Erro").replace(/^.*?ERROR:\s*/, "") }, { status: 422 });
  return NextResponse.json({ ok: true, id: (data as { id?: number } | null)?.id ?? null });
}

const iso = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
const vazio = (v: string | null | undefined) => (v ?? "").trim() || null;

async function incluirReceber(body: Body, empresa: string, previsaoISO: string, userId: string | null) {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );
  const pedido = vazio(body.numero_pedido), nf = vazio(body.numero_documento_fiscal), chave = vazio(body.chave_nfe);

  // O que o formulário manda e não tem coluna própria fica guardado, não se perde.
  const extras: Record<string, unknown> = {};
  if (body.codigo_tipo_documento) extras.codigo_tipo_documento = body.codigo_tipo_documento;
  if (body.id_origem) extras.id_origem = body.id_origem;
  if (iso(body.data_entrada)) extras.data_entrada = body.data_entrada;
  for (const k of ["pis", "cofins", "csll", "ir", "iss", "inss"] as const) {
    const v = Number(body[`valor_${k}`] ?? 0);
    if (v > 0) extras[`valor_${k}`] = v;
  }

  const { data, error } = await admin.from("receber").insert({
    empresa,
    codigo_cliente_omie: body.codigo_cliente_fornecedor,
    numero_documento: vazio(body.numero_documento),
    numero_parcela: vazio(body.numero_parcela),
    numero_pedido: pedido,
    numero_documento_fiscal: nf,
    chave_nfe: chave,
    emissao: iso(body.data_emissao),
    vencimento: body.data_vencimento,
    previsao: previsaoISO,
    valor: body.valor_documento,
    codigo_categoria: body.codigo_categoria,
    codigo_projeto: body.codigo_projeto ? String(body.codigo_projeto) : null,
    id_conta_corrente: body.id_conta_corrente,
    observacao: vazio(body.observacao),
    extras: Object.keys(extras).length ? extras : null,
    origem: "painel",
    conferencia: pedido || nf || chave ? "pendente" : "so_painel",
    created_by: userId,
  }).select("id, conferencia").single();
  if (error) return NextResponse.json({ error: `Não gravou: ${error.message}` }, { status: 500 });
  return NextResponse.json({ ok: true, id: data.id, conferencia: data.conferencia });
}

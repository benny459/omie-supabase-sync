// Editar título a pagar / a receber (05/10/26, sql/80). Usado por
// /api/financeiro/pagar e /api/financeiro/receber (acao "editar" | "desfazer_ajuste").
//  · 'o:<cod>' e 'r:<uuid>' do Omie → finance.titulo_ajustar (sobreposição em
//    finance.titulo_ajustes; o Omie nunca é escrito). Escopo 'proximas' = mesma
//    recorrência do Omie.
//  · 'p:<id>' / 'r:<uuid>' do painel → pagar_editar / receber_editar; série do
//    painel com escopo 'proximas' | 'todas' → serie_editar (sql/73).
//  · Previsão: pagar_reprogramar / receber_v1_previsao (o histórico continua lá).
import { NextResponse } from "next/server";
import { fin, erroDb } from "@/lib/financeiro-baixas";

export type CamposEditar = {
  valor?: number; vencimento?: string; previsao?: string; categoria_cod?: string | null; conta_cod?: number | null;
  projeto_cod?: string | number | null; contraparte_cod?: number | null; documento?: string | null; obs?: string | null;
  /** boleto (só contas a pagar do painel, 'p:<id>') — vazio remove */ codigo_barras?: string | null;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const REF = /^(o:\d+|p:\d+|r:[0-9a-f-]{36})$/i;

type Info = { natureza: "P" | "R"; empresa: string; origem: "omie" | "manual" | "pc"; cod_titulo?: number;
  serie?: { tipo: "omie" | "painel"; id: string | number; proximas: number } | null };

export async function dadosParaEditar(ref: string) {
  if (!REF.test(ref)) return NextResponse.json({ error: "ref inválida" }, { status: 400 });
  const { data, error } = await fin().rpc("titulo_para_editar", { p_ref: ref });
  if (error) return erroDb(error);
  if (!data) return NextResponse.json({ error: "Título não encontrado (ou já não está em aberto)" }, { status: 404 });
  const det = ref.startsWith("p:") || ref.startsWith("o:") ? (await fin().rpc("pagar_detalhe_doc", { p_ref: ref })).data as { barras?: string | null; emissao?: string | null } | null : null;
  return NextResponse.json({ titulo: { ...(data as object), codigo_barras: det?.barras ?? null, emissao: det?.emissao ?? null } }, { headers: { "Cache-Control": "no-store" } });
}

export async function editarTitulo(natureza: "P" | "R", ref: string, campos: CamposEditar, escopo: string, motivo: string | null, email: string) {
  if (!REF.test(ref) || (natureza === "P" ? ref.startsWith("r:") : !ref.startsWith("r:"))) {
    return NextResponse.json({ error: "ref inválida" }, { status: 400 });
  }
  const { data: info, error: e0 } = await fin().rpc("titulo_para_editar", { p_ref: ref });
  if (e0) return erroDb(e0);
  const t = info as Info | null;
  if (!t) return NextResponse.json({ error: "Título não encontrado (ou já não está em aberto)" }, { status: 404 });
  const esc = ["esta", "proximas", "todas"].includes(escopo) ? escopo : "esta";
  if (campos.vencimento != null && !ISO.test(campos.vencimento)) return NextResponse.json({ error: "vencimento inválido" }, { status: 400 });
  if (campos.previsao != null && !ISO.test(campos.previsao)) return NextResponse.json({ error: "previsão inválida" }, { status: 400 });
  if (campos.valor != null && !(Number(campos.valor) > 0)) return NextResponse.json({ error: "valor inválido" }, { status: 400 });
  if (esc !== "esta" && campos.vencimento != null) return NextResponse.json({ error: "Vencimento só se muda nesta ocorrência" }, { status: 400 });

  // só as chaves enviadas (undefined = não mexe)
  const so = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
  let res: unknown = { ok: true };
  if (t.origem === "omie") {
    if (esc === "todas") return NextResponse.json({ error: "Título do Omie: escolha só esta ou esta e as próximas" }, { status: 400 });
    const c = so({ valor: campos.valor, vencimento: campos.vencimento, cod_categoria: campos.categoria_cod,
      cod_cc: campos.conta_cod, cod_projeto: campos.projeto_cod == null ? campos.projeto_cod : String(campos.projeto_cod), observacao: campos.obs });
    if (Object.keys(c).length) {
      const { data, error } = await fin().rpc("titulo_ajustar", { p_empresa: t.empresa, p_cod: t.cod_titulo, p_campos: c, p_escopo: esc, p_motivo: motivo, p_usuario: email });
      if (error) return erroDb(error);
      res = data;
    }
  } else if (esc !== "esta" && t.serie?.tipo === "painel") {
    const c = so({ valor: campos.valor, categoria_cod: campos.categoria_cod, conta_cod: campos.conta_cod,
      projeto_cod: campos.projeto_cod, obs: campos.obs, documento: campos.documento });
    if (Object.keys(c).length) {
      const { data, error } = await fin().rpc("serie_editar", { p_serie: t.serie.id, p_id: ref.slice(2), p_escopo: esc, p_campos: c, p_usuario: email });
      if (error) return erroDb(error);
      res = data;
    }
  } else {
    const c = so({ valor: campos.valor, vencimento: campos.vencimento, categoria_cod: campos.categoria_cod, conta_cod: campos.conta_cod,
      projeto_cod: campos.projeto_cod, documento: campos.documento, obs: campos.obs,
      ...(natureza === "P" ? { fornecedor_cod: campos.contraparte_cod } : { cliente_cod: campos.contraparte_cod }) });
    if (Object.keys(c).length) {
      const { data, error } = natureza === "P"
        ? await fin().rpc("pagar_editar", { p_id: Number(ref.slice(2)), p_campos: c, p_motivo: motivo, p_usuario: email })
        : await fin().rpc("receber_editar", { p_id: ref.slice(2), p_campos: c, p_escopo: "esta", p_motivo: motivo, p_usuario: email });
      if (error) return erroDb(error);
      res = data;
    }
  }
  if (campos.codigo_barras !== undefined) {
    if (!ref.startsWith("p:")) return NextResponse.json({ error: "Código de barras só em conta a pagar do painel" }, { status: 400 });
    const { error } = await fin().rpc("pagar_codigo_barras_salvar", { p_id: Number(ref.slice(2)), p_barras: campos.codigo_barras ?? "", p_usuario: email });
    if (error) return erroDb(error);
  }
  if (campos.previsao) {
    const { error } = natureza === "P"
      ? await fin().rpc("pagar_reprogramar", { p_refs: [ref], p_data: campos.previsao, p_obs: motivo || "editado no título", p_usuario: email })
      : await fin().rpc("receber_v1_previsao", { p_ids: [ref.slice(2)], p_data: campos.previsao, p_obs: motivo || "editado no título", p_usuario: email });
    if (error) return erroDb(error);
  }
  return NextResponse.json(res);
}

export async function desfazerAjuste(ref: string, email: string) {
  if (!REF.test(ref)) return NextResponse.json({ error: "ref inválida" }, { status: 400 });
  const { data: info, error: e0 } = await fin().rpc("titulo_para_editar", { p_ref: ref });
  if (e0) return erroDb(e0);
  const t = info as Info | null;
  if (!t || t.origem !== "omie") return NextResponse.json({ error: "Só título do Omie tem ajuste para desfazer" }, { status: 400 });
  const { data, error } = await fin().rpc("titulo_desfazer_ajuste", { p_empresa: t.empresa, p_cod: t.cod_titulo, p_usuario: email });
  return error ? erroDb(error) : NextResponse.json(data);
}

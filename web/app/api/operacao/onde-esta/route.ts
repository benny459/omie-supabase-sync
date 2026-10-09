// GET /api/operacao/onde-esta?q=7119&de=pcs
//
// "Onde está?" (09/10/26). A busca das telas da Operação (Vendas avulsas, PCs
// standalone, Projetos) só olha a própria tela — e cada PC mora em UMA delas
// (/pcs = PC sem PV/OS e sem projeto PJ/40_VS/41_VP). Quem procura o PC 7119 em
// PCs standalone recebia "Nada com estes filtros", embora ele estivesse em Vendas
// avulsas › PV1861. Quando a busca dá zero, a tela chama esta rota e mostra onde
// está, com o link que abre a tela certa já filtrada.
//
// Só leitura. Fonte: as MVs que as próprias telas leem (sales.mv_pc_*; ~2,3 mil,
// ~1,5 mil e ~1,8 mil linhas — o filtro roda em poucos ms) e, se não achar, o
// espelho do Omie (orders.pedidos_compra, índice empresa+cnumero) e os PCs
// escondidos (platform.excluded_pc). Mesma porta das telas: área Operação (ou ERP).

import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import {
  interpretarTermo, bateProjeto, hrefTela, TELA_LABEL,
  type Achado, type RespostaOndeEsta, type TelaOp, type Termo,
} from "@/lib/onde-esta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

const MV: Record<TelaOp, string> = { avulsos: "mv_pc_avulsos", pcs: "mv_pc_pcs", projetos: "mv_pc_projetos" };
const COLS = "empresa, ncod_ped, pc_numero, pc_numero_manual, nome_fornecedor, codigo_projeto, projeto_nome, " +
  "pv_os_label, pv_os_numero, pv_cliente_nome, pv_cliente_fantasia, pv_dt_fat, pv_num_nfe, pv_etapa_texto, " +
  "rc_numero, mt_nf_fornecedor";
const MAX = 5;

type Linha = {
  empresa: string | null; ncod_ped: number | null; pc_numero: string | null; pc_numero_manual: string | null;
  nome_fornecedor: string | null; codigo_projeto: number | null; projeto_nome: string | null;
  pv_os_label: string | null; pv_os_numero: string | null; pv_cliente_nome: string | null; pv_cliente_fantasia: string | null;
  pv_dt_fat: string | null; pv_num_nfe: string | null; pv_etapa_texto: string | null;
  rc_numero: number | string | null; mt_nf_fornecedor: string | null;
};

const s = (v: unknown) => String(v ?? "").trim();
const lista = (vs: string[]) => `(${vs.map((v) => `"${v}"`).join(",")})`;

/** Filtro do PostgREST (.or) para o termo. */
function filtro(t: Termo): string {
  if (t.tipo === "numero") {
    const l = lista(t.variantes);
    return [
      `pc_numero.in.${l}`, `pc_numero_manual.in.${l}`, `pv_os_numero.in.${l}`,
      `rc_numero.eq.${t.n}`, `mt_nf_fornecedor.in.${l}`, `pv_num_nfe.in.${l}`,
    ].join(",");
  }
  if (t.tipo === "pvos") return `pv_os_label.eq.${t.label}`;
  if (t.tipo === "pj") return `projeto_nome.ilike.${t.prefixo}*,projeto_nome.ilike.PJ_${t.prefixo.slice(2)}*`;
  const p = `*${t.t}*`;
  return [`pv_cliente_fantasia.ilike.${p}`, `pv_cliente_nome.ilike.${p}`, `nome_fornecedor.ilike.${p}`, `projeto_nome.ilike.${p}`].join(",");
}

/** O que bateu nesta linha (para dizer "PC 7119", "NF 1575"…) e com que termo a tela de destino o acha. */
function oQueBateu(t: Termo, r: Linha, qOriginal: string): { oQue: string; qTela: "termo" | "rotulo" } | null {
  if (t.tipo === "numero") {
    const em = (v: unknown) => t.variantes.includes(s(v));
    if (em(r.pc_numero) || em(r.pc_numero_manual)) return { oQue: `PC ${t.n}`, qTela: "termo" };
    if (s(r.rc_numero) === t.n) return { oQue: `RC ${t.n}`, qTela: "termo" };
    if (em(r.pv_os_numero)) return { oQue: s(r.pv_os_label) || `PV/OS ${t.n}`, qTela: "rotulo" };
    if (em(r.mt_nf_fornecedor)) return { oQue: `NF do fornecedor ${t.n}`, qTela: "rotulo" };
    if (em(r.pv_num_nfe)) return { oQue: `NF de venda ${t.n}`, qTela: "rotulo" };
    return null;
  }
  if (t.tipo === "pvos") return s(r.pv_os_label).toUpperCase() === t.label ? { oQue: t.label, qTela: "rotulo" } : null;
  if (t.tipo === "pj") return bateProjeto(r.projeto_nome, t.prefixo) ? { oQue: s(r.projeto_nome), qTela: "rotulo" } : null;
  return { oQue: `"${qOriginal}"`, qTela: "termo" };
}

const encerrado = (r: Linha) => !!s(r.pv_dt_fat) || !!s(r.pv_num_nfe) || ["Faturado", "Cancelado"].includes(s(r.pv_etapa_texto));
const cliente = (r: Linha) => s(r.pv_cliente_fantasia) || s(r.pv_cliente_nome);
const pcDe = (r: Linha) => s(r.pc_numero) || s(r.pc_numero_manual);

/** O "cartão" da tela em que a linha aparece — mesma chave que a tela agrupa. */
function cartao(tela: TelaOp, r: Linha): { chave: string; rotulo: string; onde: string } {
  if (tela === "pcs") {
    const pc = pcDe(r) || `#${s(r.ncod_ped)}`;
    return { chave: `${s(r.empresa)}|${pc}`, rotulo: pc, onde: `PC ${pc}${s(r.nome_fornecedor) ? ` (${s(r.nome_fornecedor)})` : ""}` };
  }
  if (tela === "projetos") {
    const pj = s(r.projeto_nome) || "Sem projeto";
    const pv = s(r.pv_os_label);
    return { chave: `${s(r.empresa)}|${pj}`, rotulo: pj, onde: `${pj}${pv ? ` · ${pv}` : ""}${cliente(r) ? ` (${cliente(r)})` : ""}` };
  }
  const pv = s(r.pv_os_label) || "sem PV/OS";
  return { chave: `${s(r.empresa)}|${pv}`, rotulo: pv, onde: `${pv}${cliente(r) ? ` (${cliente(r)})` : ""}` };
}

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "operacao") && !canViewArea(perms, "erp")) {
    return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  }
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim().slice(0, 60);
  const termo = interpretarTermo(q);
  if (!termo) return NextResponse.json({ q, achados: [], fora: null } satisfies RespostaOndeEsta);

  const adm = supaAdmin();
  const sales = adm.schema("sales" as never);
  const telas: TelaOp[] = ["avulsos", "pcs", "projetos"];
  const [resps, escondidosR] = await Promise.all([
    Promise.all(telas.map((t) => sales.from(MV[t]).select(COLS).or(filtro(termo)).limit(60))),
    adm.schema("platform" as never).from("excluded_pc").select("empresa, pc_numero"),
  ]);
  const erro = resps.find((r) => r.error)?.error;
  if (erro) return NextResponse.json({ error: erro.message }, { status: 500 });
  const escondidos = new Set(((escondidosR.data ?? []) as { empresa: string; pc_numero: string }[])
    .map((e) => `${s(e.empresa)}|${s(e.pc_numero)}`));

  type Acum = { a: Achado; oQues: Set<string>; qTela: string; codProj: number | null; empresa: string };
  const vistos = new Map<string, Acum>();
  telas.forEach((tela, i) => {
    for (const r of (resps[i].data ?? []) as unknown as Linha[]) {
      const b = oQueBateu(termo, r, q);
      if (!b) continue;
      const c = cartao(tela, r);
      const k = `${tela}|${c.chave}`;
      const escondido = !!pcDe(r) && escondidos.has(`${s(r.empresa)}|${pcDe(r)}`);
      const qTela = b.qTela === "termo" ? (termo.tipo === "numero" ? termo.n : q) : c.rotulo;
      const ja = vistos.get(k);
      if (ja) {
        ja.oQues.add(b.oQue);
        ja.a.faturado = ja.a.faturado && encerrado(r);
        ja.a.escondido = ja.a.escondido && escondido;
        ja.codProj ??= r.codigo_projeto ?? null;
        continue;
      }
      vistos.set(k, {
        a: { tela, oQue: b.oQue, onde: c.onde, faturado: encerrado(r), href: "", escondido },
        oQues: new Set([b.oQue]), qTela, codProj: r.codigo_projeto ?? null, empresa: s(r.empresa),
      });
    }
  });
  const total = vistos.size;
  for (const v of vistos.values()) {
    // PC primeiro ("PC 7119 · RC 7119"): é o que a pessoa costuma procurar.
    v.a.oQue = [...v.oQues].sort((x, y) => Number(!x.startsWith("PC")) - Number(!y.startsWith("PC"))).join(" · ");
    const extra: Record<string, string> = {};
    if (v.a.tela === "projetos" && v.codProj) { extra.abrir = String(v.codProj); extra.empresa = v.empresa; }
    v.a.href = hrefTela(v.a.tela, v.qTela, extra);
  }
  const achados = [...vistos.values()].map((v) => v.a)
    .sort((a, b) => Number(!!a.escondido) - Number(!!b.escondido) || Number(a.faturado) - Number(b.faturado))
    .slice(0, MAX);

  let fora: RespostaOndeEsta["fora"] = null;
  if (!achados.length && termo.tipo === "numero") {
    // Não está em nenhuma tela da Operação. Existe no espelho do Omie?
    const { data: omie } = await adm.schema("orders" as never).from("pedidos_compra")
      .select("empresa, cnumero, ncod_proj, cetapa").in("cnumero", termo.variantes).limit(5);
    const o = (omie ?? []) as { empresa: string; cnumero: string }[];
    if (o.length) {
      const emp = [...new Set(o.map((x) => x.empresa))].join(", ");
      const esc = o.some((x) => escondidos.has(`${s(x.empresa)}|${s(x.cnumero)}`));
      fora = esc
        ? { msg: `O PC ${termo.n} (${emp}) existe, mas foi escondido em "PCs excluídos" — reexiba-o por lá para voltar à lista.` }
        : { msg: `O PC ${termo.n} (${emp}) existe no Omie, mas não entrou em nenhuma tela da Operação (pode ser cancelado, de outra categoria ou ainda não sincronizado). Veja-o em Compras.`,
            href: `/erp/compras?${new URLSearchParams({ abrir: s(o[0].cnumero), tipo: "PC", emp: s(o[0].empresa) })}`, hrefLabel: "Abrir em Compras" };
    }
  }
  if (!achados.length && !fora) {
    fora = { msg: `"${q}" não existe no painel (${Object.values(TELA_LABEL).join(", ")}). Pode estar só no Omie ou com outro número — confira o número ou procure pelo cliente/fornecedor.` };
  }
  return NextResponse.json({ q, achados, fora, mais: total > MAX } satisfies RespostaOndeEsta);
}

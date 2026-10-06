// /api/vendas/crm — servidor-a-servidor para o CRM (Propostas-WW), P1 05/10/26.
//   GET  ?empresa=SF                    → { pv_os_nativo } (a chave por empresa; padrão desligada = Omie)
//   GET  ?empresa=SF&proposta=OPS…      → PV/OS nativos da proposta
//   GET  ?empresa=SF&id=123             → documento (o "consultar" do CRM)
//   GET  ?op=proximo&tipo=PV|OS&empresa=SF → { tipo, proximo } — próximo nº SEM consumir (prévia; confirmado ao gravar)
//   POST { empresa, proposta, tipo, cab, itens, parcelas, por }
//        → cria o PV/OS no painel (no lugar do IncluirPedido/IncluirOS do Omie).
//        Recebe o mesmo "cab/itens/parcelas" que o CRM montava para o Omie.
// Autenticação: header x-compras-secret = COMPRAS_RC_SECRET (o mesmo da RC).
// A rota é pública no middleware; a guarda é o segredo.
import { FORMAS_RECEBIMENTO } from "@/lib/vendas";
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { crmAutorizado, documento, erro, naoAutorizado, salvarVenda } from "@/lib/vendas-server";
import type { VendaItem, VendaParcela, VendaSalvar } from "@/lib/vendas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CabCrm = {
  cliente_omie?: string | number; data?: string; etapa?: string; parcela?: string; n_parcelas?: number | string;
  categoria?: string; projeto?: string | number; conta?: string | number; vend?: string | number;
  forma_recebimento?: string; parcela_desc?: string;
  cenario?: string | number; cf?: string; obs?: string; obs_nf?: string; num_pedido_cliente?: string; contato?: string;
};
type ItemCrm = {
  id?: number | string; cod?: string; desc: string; un?: string; ncm?: string; qty: number | string; unit: number | string;
  cfop?: string; fiscal?: Record<string, unknown> | null;
};
type ParcelaCrm = { numero_parcela?: number; data_vencimento?: string; valor?: number; percentual?: number; quantidade_dias?: number;
  /** fechamento de projeto (CRM 2.6.641): nome do evento e data prevista de faturamento */ descricao?: string; data_faturamento?: string };

const isoDe = (s?: string) => {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s.trim());
  return m ? `${m[3]}-${m[2]}-${m[1]}` : s.slice(0, 10);
};
const txt = (v: unknown) => (v == null || v === "" ? null : String(v));

export async function GET(req: Request) {
  if (!crmAutorizado(req)) return naoAutorizado();
  const sp = new URL(req.url).searchParams;
  const empresa = (sp.get("empresa") ?? "SF").toUpperCase();
  try {
    if (sp.get("op") === "proximo") {
      const tipo = (sp.get("tipo") ?? "PV").toUpperCase();
      if (tipo !== "PV" && tipo !== "OS") return NextResponse.json({ error: "tipo deve ser PV ou OS" }, { status: 400 });
      const p = await rpc<{ pv: number; os: number }>("fat_proximos", { p_empresa: empresa });
      return NextResponse.json({ empresa, tipo, proximo: tipo === "PV" ? p.pv : p.os, aviso: "prévia — confirmado ao gravar" });
    }
    if (sp.get("id")) return NextResponse.json(await documento(Number(sp.get("id"))));
    if (sp.get("proposta")) return NextResponse.json(await rpc("vendas_da_proposta", { p_empresa: empresa, p_proposta: sp.get("proposta") }));
    return NextResponse.json(await rpc("vendas_config", { p_empresa: empresa }));
  } catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  if (!crmAutorizado(req)) return naoAutorizado();
  const b = (await req.json().catch(() => null)) as {
    empresa?: string; proposta?: string; tipo?: string; cab?: CabCrm; itens?: ItemCrm[]; parcelas?: ParcelaCrm[]; por?: string;
  } | null;
  const empresa = (b?.empresa ?? "SF").toUpperCase();
  const tipo = b?.tipo === "OS" ? "OS" : "PV";
  const proposta = String(b?.proposta ?? "").trim();
  const cab = b?.cab ?? {};
  if (!proposta) return NextResponse.json({ error: "proposta obrigatória" }, { status: 400 });
  if (!b?.itens?.length) return NextResponse.json({ error: "sem itens" }, { status: 400 });
  if (!String(b.por ?? "").trim()) return NextResponse.json({ error: "falta quem está a emitir (por)" }, { status: 400 });
  try {
    const cfg = await rpc<{ pv_os_nativo: boolean }>("vendas_config", { p_empresa: empresa });
    // x-vendas-forcar só vale fora de produção (teste local do CRM com a chave desligada).
    const forcar = process.env.NODE_ENV !== "production" && req.headers.get("x-vendas-forcar") === "1";
    if (!cfg.pv_os_nativo && !forcar) {
      return NextResponse.json({ error: `PV/OS nativos desligados para ${empresa} — o CRM deve criar no Omie` }, { status: 409 });
    }
    const itens: VendaItem[] = b.itens.map((i) => ({
      codigo: txt(i.cod), ncod_prod: Number(i.id) || null, descricao: String(i.desc ?? "").trim(),
      unidade: i.un || "UN", ncm: txt(i.ncm), cfop: txt(i.cfop),
      quantidade: Number(i.qty) || 1, valor_unitario: Number(i.unit) || 0, fiscal: i.fiscal ?? null,
    }));
    const parcelas: VendaParcela[] = (b.parcelas ?? []).filter((x) => x.data_vencimento).map((x, k) => ({
      numero: Number(x.numero_parcela) || k + 1, vencimento: isoDe(x.data_vencimento)!, valor: Number(x.valor) || 0,
      percentual: x.percentual ?? null, dias: x.quantidade_dias ?? null,
      descricao: txt(x.descricao), faturamento_previsto: isoDe(x.data_faturamento) ?? null,
    }));
    // CRM 2.6.622+: projeto e categoria de receita são obrigatórios (05/10/26).
    if (!Number(cab.projeto)) return NextResponse.json({ error: "Projeto obrigatório: escolha o projeto do PV/OS no CRM" }, { status: 400 });
    if (!txt(cab.categoria)) return NextResponse.json({ error: "Categoria de receita obrigatória: escolha a categoria do PV/OS no CRM" }, { status: 400 });
    const forma = txt(cab.forma_recebimento)?.toUpperCase() ?? null;
    if (forma && !FORMAS_RECEBIMENTO.some((f) => f.codigo === forma)) return NextResponse.json({ error: `Forma de recebimento inválida: ${forma}` }, { status: 400 });
    const p: VendaSalvar = {
      empresa, tipo, origem: "crm", proposta, cliente_codigo: String(cab.cliente_omie ?? ""),
      previsao: isoDe(cab.data), condicao_codigo: txt(cab.parcela),
      qtd_parcelas: Number(cab.n_parcelas) || null, projeto_codigo: Number(cab.projeto) ? String(cab.projeto) : null,
      categoria_codigo: txt(cab.categoria), vendedor_codigo: Number(cab.vend) ? String(cab.vend) : null,
      conta_codigo: Number(cab.conta) ? String(cab.conta) : null, cenario_impostos: txt(cab.cenario),
      forma_recebimento: forma, condicao_descricao: txt(cab.parcela_desc),
      consumidor_final: txt(cab.cf), observacoes: txt(cab.obs), obs_nf: txt(cab.obs_nf),
      num_pedido_cliente: txt(cab.num_pedido_cliente), contato: txt(cab.contato), etapa: txt(cab.etapa),
      itens, parcelas,
    };
    const r = await salvarVenda(p, `CRM · ${String(b.por).trim()}`);
    return NextResponse.json({ ok: true, ...r });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: msg }, { status: /já tem o documento/.test(msg) ? 409 : 400 });
  }
}

// /api/crm/erp — servidor-a-servidor para o CRM (Propostas-WW), P-CRM 05/10/26.
// Tudo o que o CRM lia ao vivo do Omie (cadastros, PV/OS, condições, pedidos
// de compra) sai daqui, dos espelhos e nativos do painel (sql/66_crm_erp.sql).
//   POST { acao: "lista", lista: produtos|clientes|servicos|categorias|projetos|vendedores|parcelas }
//   POST { acao: "pedidos", desde?: "AAAA-MM-DD", texto?, cliente?, limite? }  → formato do omie_pedidos_cache
//   POST { acao: "consultar", tipo: "PV"|"OS", numero }                        → código e itens
//   POST { acao: "prazos_compra", pedidos: string[] }                          → condição de cada PC
// Autenticação: header x-compras-secret = COMPRAS_RC_SECRET (o mesmo da RC e do PV/OS).
// Rota pública no middleware (/api/crm/erp); a guarda é o segredo. Só leitura.
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { crmAutorizado, naoAutorizado } from "@/lib/vendas-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const LISTAS = new Set(["produtos", "clientes", "servicos", "categorias", "projetos", "vendedores", "parcelas"]);

export async function POST(req: Request) {
  if (!crmAutorizado(req)) return naoAutorizado();
  const b = (await req.json().catch(() => null)) as {
    acao?: string; empresa?: string; lista?: string; desde?: string; texto?: string; cliente?: number | string;
    limite?: number; tipo?: string; numero?: string | number; pedidos?: unknown[];
  } | null;
  const empresa = String(b?.empresa ?? "SF").toUpperCase();
  try {
    if (b?.acao === "lista") {
      if (!LISTAS.has(String(b.lista))) return NextResponse.json({ error: "lista inválida" }, { status: 400 });
      return NextResponse.json({ itens: await rpc("crm_erp_lista", { p_empresa: empresa, p_lista: b.lista }) });
    }
    if (b?.acao === "pedidos") {
      const desde = /^\d{4}-\d{2}-\d{2}$/.test(String(b.desde ?? "")) ? b.desde : null;
      const cli = Number(b.cliente);
      return NextResponse.json({ pedidos: await rpc("crm_erp_pedidos", {
        p_empresa: empresa, p_desde: desde, p_texto: b.texto ? String(b.texto).slice(0, 80) : null,
        p_cliente: Number.isFinite(cli) && cli > 0 ? cli : null, p_limite: Math.min(Number(b.limite) || 5000, 20000),
      }) });
    }
    if (b?.acao === "consultar") {
      const numero = String(b.numero ?? "").trim();
      if (!numero) return NextResponse.json({ error: "numero obrigatório" }, { status: 400 });
      const r = await rpc("crm_erp_consultar", { p_empresa: empresa, p_tipo: b.tipo === "OS" ? "OS" : "PV", p_numero: numero });
      if (!r) return NextResponse.json({ error: `${b.tipo === "OS" ? "OS" : "PV"} ${numero} não encontrado` }, { status: 404 });
      return NextResponse.json(r);
    }
    if (b?.acao === "prazos_compra") {
      const pedidos = [...new Set((b.pedidos ?? []).map((p) => String(p ?? "").trim()).filter(Boolean))].slice(0, 500);
      if (!pedidos.length) return NextResponse.json({ error: "pedidos[] obrigatório" }, { status: 400 });
      return NextResponse.json({ prazos: await rpc("crm_erp_prazos_compra", { p_empresa: empresa, p_pedidos: pedidos }) });
    }
    return NextResponse.json({ error: "acao inválida (lista | pedidos | consultar | prazos_compra)" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

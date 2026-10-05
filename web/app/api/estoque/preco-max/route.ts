// Preço máximo de compra por item (P7, 05/10/26) — opcional. Ninguém é
// bloqueado: CP (CRM), RC e PC mostram um aviso quando o valor passa dele.
// GET  ?prods=123,456          → { [n_cod_prod]: preco_maximo }   (quem abre o Estoque ou o Compras)
// POST { n_cod_prod, preco_maximo, obs? } → grava; preco_maximo vazio/0 apaga.
//      Exige "Famílias, códigos e fotos" (estoque.codigos) — é cadastro do item.
import { NextResponse } from "next/server";
import { exigirAdminEstoque, msgErro, orders } from "@/lib/estoque-server";
import { precosMaximos } from "@/lib/catalogo-crm";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";

export async function GET(req: Request) {
  // Leitura: qualquer um da área ERP (o formulário do PC também usa).
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  const ids = (new URL(req.url).searchParams.get("prods") ?? "").split(",").map((s) => Number(s.trim())).filter((x) => Number.isFinite(x) && x !== 0).slice(0, 300);
  try { return NextResponse.json(await precosMaximos(ids)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

export async function POST(req: Request) {
  const q = await exigirAdminEstoque("estoque.codigos");
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { n_cod_prod?: number; preco_maximo?: number | string | null; obs?: string };
  const prod = Number(b.n_cod_prod);
  if (!Number.isFinite(prod) || prod === 0) return NextResponse.json({ error: "Item obrigatório" }, { status: 400 });
  const valor = b.preco_maximo == null || b.preco_maximo === "" ? null : Number(String(b.preco_maximo).replace(",", "."));
  if (valor != null && (!Number.isFinite(valor) || valor < 0)) return NextResponse.json({ error: "Preço máximo inválido" }, { status: 400 });
  const r = await orders().rpc("estoque_preco_max_definir", { p_empresa: "SF", p_prod: prod, p_valor: valor, p_obs: b.obs ?? null, p_email: q.email });
  if (r.error) return NextResponse.json({ error: msgErro(r.error) }, { status: 409 });
  return NextResponse.json({ ok: true, resultado: r.data });
}

// GET  /api/vendas?emp=SF&desde=AAAA-MM-DD&status=aberto[,faturado]  → PV/OS nativos (orders.vendas_lista)
// POST /api/vendas  { ...VendaSalvar }       → cria/edita (orders.vendas_salvar)
import { NextResponse } from "next/server";
import { rpc } from "@/lib/compras-server";
import { documento, erro, exigirVendas, salvarVenda } from "@/lib/vendas-server";
import type { VendaSalvar } from "@/lib/vendas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  try {
    let linhas = await rpc("vendas_lista", { p_empresa: sp.get("emp")?.toUpperCase() || null, p_desde: sp.get("desde") || null }) as { status?: string }[];
    // ?status=aberto (ou lista separada por vírgula) — antes era ignorado e vinham também os faturados.
    const status = (sp.get("status") ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (status.length && Array.isArray(linhas)) linhas = linhas.filter((l) => status.includes(String(l.status ?? "").toLowerCase()));
    const config = await rpc("vendas_config", { p_empresa: (sp.get("emp") ?? "SF").toUpperCase() });
    return NextResponse.json({ linhas, config, admin: q.admin });
  } catch (e) { return erro(e); }
}

export async function POST(req: Request) {
  const q = await exigirVendas();
  if (q instanceof NextResponse) return q;
  try {
    const body = (await req.json()) as VendaSalvar & { sem_proposta?: { motivo?: string } | null };
    const { sem_proposta, ...resto } = body;
    // Vínculo com a proposta do CRM é obrigatório (05/10/26). Exceção: admin
    // marca "sem proposta" com motivo (auditado), como o "PC sem RC".
    // Projeto e categoria de receita obrigatórios no PV/OS do painel (05/10/26).
    if (!String(resto.projeto_codigo ?? "").trim()) return NextResponse.json({ error: "Escolha o projeto do PV/OS (obrigatório)" }, { status: 400 });
    if (!String(resto.categoria_codigo ?? "").trim()) return NextResponse.json({ error: "Escolha a categoria de receita do PV/OS (obrigatória)" }, { status: 400 });
    const temProposta = !!String(resto.proposta ?? "").trim();
    const motivo = String(sem_proposta?.motivo ?? "").trim();
    if (!temProposta) {
      let dispensado = false;
      if (resto.id) {
        const atual = await documento(Number(resto.id)).catch(() => null) as (Record<string, unknown> | null);
        dispensado = !!atual?.proposta_dispensa_motivo;
      }
      if (!dispensado) {
        if (!motivo) return NextResponse.json({ error: "Informe a proposta do CRM deste PV/OS (ou, se admin, marque “sem proposta” com o motivo)" }, { status: 400 });
        if (!q.admin) return NextResponse.json({ error: "Só um administrador pode lançar PV/OS sem proposta do CRM" }, { status: 403 });
        if (motivo.length < 5) return NextResponse.json({ error: "Motivo de “sem proposta” muito curto" }, { status: 400 });
      }
    }
    const p = { ...resto, origem: resto.id ? undefined : "painel" };
    const r = await salvarVenda(p as VendaSalvar, q.nome);
    if (!temProposta && motivo) await rpc("vendas_dispensa_proposta", { p_id: r.id, p_motivo: motivo, p_por: q.email });
    return NextResponse.json(r);
  } catch (e) { return erro(e); }
}

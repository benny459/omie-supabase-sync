// /api/catalogo/crm — servidor-a-servidor para o CRM (Propostas-WW), P7 05/10/26.
// A CP e a RC do CRM usam o código NATIVO do item e o custo do painel.
//   POST { acao: "buscar", q, limite?, historico? } → { itens: ItemCrm[] }
//   POST { acao: "resolver", codigos: string[], historico? } → { itens: { [codigo]: ItemCrm } }  (propostas antigas)
//   POST { acao: "casar", textos: string[], historico? }     → { itens: (ItemCrm|null)[] }       (linhas sem código)
//   POST { acao: "buscar", tipo: "servico", q } → { itens: [{ id, cod, desc, un, lc116, cod_municipio }] } (cadastro de serviços)
//   POST { acao: "criar", tipo: "produto"|"servico", descricao, unidade?, ncm? (8 díg., obrigatório p/ produto), familia_id?, lc116?, por, simular? }
//        → { item: { id, desc, cod, un, ncm, tipo } } · parecido → 409 { error, duplicado: true, candidatos: [{ id, cod, desc }] }
//   POST { acao: "familias" } → { familias: [{ id, nome, prefixo, material }] }
//   POST { acao: "casar_top", textos[], custos?[], unidades?[], top?=3 } → { itens: Candidato[][] }  (até 200 linhas; top N itens NOSSOS por linha)
//   POST { acao: "vincular", descricao_compra, codigo_compra?, ncod_prod, por } → { ok, vinculo }  (de-para texto → item nosso)
//   historico > 0 traz as últimas compras (fornecedor, data, preço) de cada item — a RC usa.
// Autenticação: header x-compras-secret = COMPRAS_RC_SECRET (o mesmo da RC e do PV/OS).
// Rota pública no middleware; a guarda é o segredo. Só leitura, exceto "criar".
import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { casarTopCrm, vincularCrm, buscarItensCrm, buscarServicosCrm, casarItensCrm, criarItemCrm, familiasCrm, Parecido, resolverCodigosCrm } from "@/lib/catalogo-crm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

function autorizado(req: Request) {
  const esperado = process.env.COMPRAS_RC_SECRET ?? "";
  const veio = req.headers.get("x-compras-secret") ?? "";
  if (!esperado || esperado.length !== veio.length) return false;
  return timingSafeEqual(Buffer.from(esperado), Buffer.from(veio));
}

export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as {
    acao?: string; q?: string; custos?: (number | null)[]; unidades?: (string | null)[]; top?: number;
    descricao_compra?: string; codigo_compra?: string | null; ncod_prod?: number; limite?: number; historico?: number; codigos?: string[]; textos?: string[]; empresa?: string;
    tipo?: string; descricao?: string; unidade?: string; ncm?: string; familia_id?: number; lc116?: string; por?: string; simular?: boolean;
  } | null;
  const empresa = (b?.empresa ?? "SF").toUpperCase();
  const hist = Math.max(0, Math.min(Number(b?.historico ?? 0) || 0, 10));
  try {
    if (b?.acao === "buscar" && b.tipo === "servico") {
      return NextResponse.json({ itens: await buscarServicosCrm(String(b.q ?? ""), Number(b.limite) || 10, empresa) });
    }
    if (b?.acao === "familias") return NextResponse.json({ familias: await familiasCrm(empresa) });
    if (b?.acao === "criar") {
      if (b.tipo !== "produto" && b.tipo !== "servico") return NextResponse.json({ error: "tipo deve ser produto ou servico" }, { status: 400 });
      try {
        const item = await criarItemCrm({ tipo: b.tipo, descricao: String(b.descricao ?? ""), unidade: b.unidade, ncm: b.ncm ?? null,
          por: String(b.por ?? "crm"), empresa, familia_id: b.familia_id ?? null, lc116: b.lc116 ?? null, simular: !!b.simular });
        return NextResponse.json({ item, ...(b.simular ? { simulado: true } : {}) });
      } catch (e) {
        if (e instanceof Parecido) return NextResponse.json({ error: e.message, duplicado: true, candidatos: e.candidatos }, { status: 409 });
        return NextResponse.json({ error: (e as Error).message }, { status: 400 });
      }
    }
    if (b?.acao === "buscar") {
      const itens = await buscarItensCrm(String(b.q ?? ""), Number(b.limite) || 10, Math.max(0, Math.min(Number(b.historico ?? 3), 10)), empresa);
      return NextResponse.json({ itens });
    }
    if (b?.acao === "resolver") {
      if (!Array.isArray(b.codigos)) return NextResponse.json({ error: "codigos[] obrigatório" }, { status: 400 });
      return NextResponse.json({ itens: await resolverCodigosCrm(b.codigos.map(String), empresa, hist) });
    }
    if (b?.acao === "casar") {
      if (!Array.isArray(b.textos)) return NextResponse.json({ error: "textos[] obrigatório" }, { status: 400 });
      return NextResponse.json({ itens: await casarItensCrm(b.textos.map(String), empresa, hist) });
    }
    if (b?.acao === "casar_top") {
      if (!Array.isArray(b.textos)) return NextResponse.json({ error: "textos[] obrigatório" }, { status: 400 });
      if (b.textos.length > 200) return NextResponse.json({ error: "no máximo 200 linhas por chamada" }, { status: 400 });
      const itens = await casarTopCrm(b.textos.map(String), Array.isArray(b.custos) ? b.custos : [], Array.isArray(b.unidades) ? b.unidades : [],
        Number(b.top) || 3, empresa);
      return NextResponse.json({ itens });
    }
    if (b?.acao === "vincular") {
      try {
        const vinculo = await vincularCrm({ descricao_compra: String(b.descricao_compra ?? ""), codigo_compra: b.codigo_compra ?? null,
          ncod_prod: Number(b.ncod_prod), por: String((b as { por?: string }).por ?? "crm"), empresa });
        return NextResponse.json({ ok: true, vinculo });
      } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
    }
    return NextResponse.json({ error: "acao inválida (buscar | resolver | casar | casar_top | vincular | criar | familias)" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

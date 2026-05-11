// Busca global: pesquisa em paralelo nas 3 views (v_pc_avulsos, v_pc_pcs,
// v_pc_projetos) — cada uma cobre o respectivo módulo, INCLUINDO PV/OS órfãos
// (source='orphan') que v_pc_completo_enriched não tem.
//
// GET /api/search?q=OS994&debug=1
//
// RLS aplica naturalmente (usa supaServer com cookies do user).
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";

type Row = {
  empresa: string | null;
  pc_numero: string | null;
  pv_os_label: string | null;
  pv_os_numero: string | null;
  pv_origem_numero: string | null;
  nome_fornecedor: string | null;
  contato_fornecedor: string | null;
  pv_cliente_nome: string | null;
  pv_cliente_fantasia: string | null;
  projeto_nome: string | null;
  valor_total: number | null;
  pv_valor_total: number | null;
  etapa: string | null;
  pv_etapa_texto: string | null;
  source: string | null;
};

type Hit = {
  bucket_key: string;
  bucket_label: string;
  modulo: "avulsos" | "pcs" | "projetos";
  empresa: string | null;
  pc_numero: string | null;
  pv_os_label: string | null;
  fornecedor: string | null;
  cliente: string | null;
  projeto: string | null;
  valor: number | null;
  etapa: string | null;
  matched_field: string;
  is_orphan: boolean;
};

const SEARCH_COLS = "empresa, pc_numero, pv_os_label, pv_os_numero, pv_origem_numero, nome_fornecedor, contato_fornecedor, pv_cliente_nome, pv_cliente_fantasia, projeto_nome, valor_total, pv_valor_total, etapa, pv_etapa_texto, source";

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const debug = url.searchParams.get("debug") === "1";
  if (q.length < 2) return NextResponse.json({ hits: [] });

  // Detecta query puramente numérica:
  //   "1901"     → range [1901, 1902)        — qualquer 1901,xx
  //   "1901,89"  → range [1901.89, 1901.90)  — exato no decimal
  //   "1901.89"  → idem
  // Se for número, NÃO usa ilike text-based (não faz sentido procurar valor em
  // nome de fornecedor/cliente — e a vírgula causa parse error no PostgREST).
  const numMatch = q.match(/^\s*(\d{1,9})(?:[.,](\d{1,2}))?\s*$/);

  let orFilter: string;
  if (numMatch) {
    const [, intPart, decPart] = numMatch;
    const filters: string[] = [
      // Inteiro puro provavelmente é ID — sempre bate em ilike PC/PV/PV-origem
      `pc_numero.ilike.*${intPart}*`,
      `pv_os_numero.ilike.*${intPart}*`,
      `pv_origem_numero.ilike.*${intPart}*`,
    ];
    // Range em valor SOMENTE se a query tem decimal (ex: "1901,89"). Pra
    // inteiro puro, range em valor_total/pv_valor_total (sem índice) força
    // sequential scan em todas as views e estoura statement_timeout (30s).
    // Quem quer buscar por valor digita com decimal — é o caso natural.
    if (decPart) {
      const dec = decPart.padEnd(2, "0");
      const min = Number(`${intPart}.${dec}`);
      const max = Number((min + 0.01).toFixed(2));
      filters.push(`and(valor_total.gte.${min},valor_total.lt.${max})`);
      filters.push(`and(pv_valor_total.gte.${min},pv_valor_total.lt.${max})`);
    }
    orFilter = filters.join(",");
  } else {
    // Query textual: escapa wildcards LIKE. Vírgulas não chegam aqui (não bate
    // o numMatch + texto livre não costuma ter vírgulas relevantes).
    const safe = q.replace(/[%_()]/g, (m) => `\\${m}`);
    const like = `*${safe}*`;
    orFilter = [
      `pc_numero.ilike.${like}`,
      `pv_os_label.ilike.${like}`,
      `pv_os_numero.ilike.${like}`,
      `pv_origem_numero.ilike.${like}`,
      `nome_fornecedor.ilike.${like}`,
      `contato_fornecedor.ilike.${like}`,
      `pv_cliente_nome.ilike.${like}`,
      `pv_cliente_fantasia.ilike.${like}`,
      `projeto_nome.ilike.${like}`,
    ].join(",");
  }

  // Busca em paralelo nas 3 views — cada uma já é o "destino" desse módulo
  const [avulsos, pcs, projetos] = await Promise.all([
    supa.from("v_pc_avulsos").select(SEARCH_COLS).or(orFilter).limit(150),
    supa.from("v_pc_pcs").select(SEARCH_COLS).or(orFilter).limit(150),
    supa.from("v_pc_projetos").select(SEARCH_COLS).or(orFilter).limit(150),
  ]);

  const errs = [avulsos.error, pcs.error, projetos.error].filter(Boolean);
  if (errs.length === 3) {
    return NextResponse.json({ error: errs[0]?.message ?? "search failed" }, { status: 500 });
  }

  const ql = q.toLowerCase();
  function matchedField(r: Row): string {
    const has = (v: string | null) => v?.toLowerCase().includes(ql);
    if (has(r.pc_numero)) return "PC";
    if (has(r.pv_os_label) || has(r.pv_os_numero)) return "PV/OS";
    if (has(r.pv_origem_numero)) return "PV de origem";
    if (has(r.nome_fornecedor) || has(r.contato_fornecedor)) return "Fornecedor";
    if (has(r.pv_cliente_nome) || has(r.pv_cliente_fantasia)) return "Cliente";
    if (has(r.projeto_nome)) return "Projeto";
    if (numMatch) return "Valor";
    return "—";
  }

  function pushFrom(rows: Row[] | null, modulo: Hit["modulo"], byKey: Map<string, Hit>) {
    if (!rows) return;
    for (const r of rows) {
      const hasPv = !!r.pv_os_label;
      const bucket_key = hasPv
        ? `${modulo}:PV:${r.pv_os_label}`
        : `${modulo}:PC:${r.empresa}:${r.pc_numero ?? ""}`;
      const bucket_label = hasPv
        ? (r.pv_os_label as string)
        : `PC ${r.pc_numero ?? "—"}`;
      if (byKey.has(bucket_key)) continue;
      byKey.set(bucket_key, {
        bucket_key, bucket_label, modulo,
        empresa: r.empresa,
        pc_numero: r.pc_numero,
        pv_os_label: r.pv_os_label,
        fornecedor: r.nome_fornecedor ?? r.contato_fornecedor,
        cliente: r.pv_cliente_fantasia ?? r.pv_cliente_nome,
        projeto: r.projeto_nome,
        valor: r.valor_total ?? r.pv_valor_total,
        etapa: r.etapa ?? r.pv_etapa_texto,
        matched_field: matchedField(r),
        is_orphan: r.source === "orphan",
      });
    }
  }

  const byKey = new Map<string, Hit>();
  pushFrom((avulsos.data ?? []) as Row[], "avulsos", byKey);
  pushFrom((pcs.data ?? []) as Row[], "pcs", byKey);
  pushFrom((projetos.data ?? []) as Row[], "projetos", byKey);

  const order = { avulsos: 0, pcs: 1, projetos: 2 };
  const hits = [...byKey.values()].sort(
    (a, b) => order[a.modulo] - order[b.modulo]
  ).slice(0, 50);

  return NextResponse.json({
    hits,
    total: byKey.size,
    debug: debug ? {
      avulsos: avulsos.data?.length ?? 0,
      pcs: pcs.data?.length ?? 0,
      projetos: projetos.data?.length ?? 0,
      orFilter,
    } : undefined,
  });
}

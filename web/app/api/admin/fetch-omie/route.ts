// Single-fetch direto do Omie pra um PC específico — pra urgências sem
// esperar o sync diário. Idempotente: upsert sobrescreve mesma linha quando
// o sync automático rodar depois, sem duplicar.
//
// POST { tipo: 'pc', numero: '6620', empresa: 'SF' }
//
// Proteções contra abuso:
//   1. Cache 5 min: se já sincronizado recentemente, retorna sem chamar Omie
//   2. Rate-limit 10/h por user
//   3. Log auditável em platform.fetch_omie_log
import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 30;  // Omie pode demorar 5-10s

const CACHE_MIN = 5;          // Não bate Omie se synced_at < 5 min
const RATE_LIMIT_PER_HOUR = 10;

const OMIE_PC_URL = "https://app.omie.com.br/api/v1/produtos/pedidocompra/";

function toIntOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}
function toFloatOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function strOrNull(v: unknown): string | null {
  return v === null || v === undefined || v === "" ? null : String(v);
}

type Cab = Record<string, unknown>;
type Prod = Record<string, unknown>;

function mapPedidoItem(sigla: string, cab: Cab, prod: Prod) {
  return {
    empresa: sigla,
    ncod_ped: toIntOrNull(cab.nCodPed),
    cnumero:        strOrNull(cab.cNumero),
    ccod_categ:     strOrNull(cab.cCodCateg),
    cetapa:         strOrNull(cab.cEtapa),
    dinc_data:      strOrNull(cab.dIncData),
    cinc_hora:      strOrNull(cab.cIncHora),
    ncod_for:       toIntOrNull(cab.nCodFor),
    ccod_int_for:   strOrNull(cab.cCodIntFor),
    ccontato:       strOrNull(cab.cContato),
    ccod_parc:      strOrNull(cab.cCodParc),
    nqtde_parc:     toFloatOrNull(cab.nQtdeParc),
    ddt_previsao:   strOrNull(cab.dDtPrevisao),
    ncod_cc:        toIntOrNull(cab.nCodCC),
    ncod_int_cc:    strOrNull(cab.nCodIntCC),
    ncod_compr:     toIntOrNull(cab.nCodCompr),
    ncod_proj:      toIntOrNull(cab.nCodProj),
    ccod_int_ped:   strOrNull(cab.cCodIntPed),
    cnum_pedido:    strOrNull(cab.cNumPedido),
    ccontrato:      strOrNull(cab.ccontrato),
    cobs:           strOrNull(cab.cObs),
    cobs_int:       strOrNull(cab.cObsInt),
    ntotal_pedido:  toFloatOrNull(cab.nTotalPedido),
    ccod_status:    strOrNull(cab.cCodStatus),
    cdesc_status:   strOrNull(cab.cDescStatus),
    crecebido:      strOrNull(cab.cRecebido),
    ddata_recebimento: strOrNull(cab.dDataRecebimento),
    ddt_faturamento:   strOrNull(cab.dDtFaturamento),
    cnumero_nf:     strOrNull(cab.cNumeroNF),
    // Item
    ncod_item:      toIntOrNull(prod.nCodItem) ?? 0,
    ncod_prod:      toIntOrNull(prod.nCodProd),
    ccod_int_prod:  strOrNull(prod.cCodIntProd),
    cproduto:       strOrNull(prod.cProduto),
    cdescricao:     strOrNull(prod.cDescricao),
    cunidade:       strOrNull(prod.cUnidade),
    nqtde:          toFloatOrNull(prod.nQtde),
    nval_unit:      toFloatOrNull(prod.nValUnit),
    nval_tot:       toFloatOrNull(prod.nValTot),
    ndesconto:      toFloatOrNull(prod.nDesconto),
    nfrete:         toFloatOrNull(prod.nFrete),
    nseguro:        toFloatOrNull(prod.nSeguro),
    ndespesas:      toFloatOrNull(prod.nDespesas),
    loc_estoque:    strOrNull(prod.codigo_local_estoque),
    cean:           strOrNull(prod.cEAN),
    cncm:           strOrNull(prod.cNCM),
    nqtde_rec:      toFloatOrNull(prod.nQtdeRec),
    npeso_bruto:    toFloatOrNull(prod.nPesoBruto),
    npeso_liq:      toFloatOrNull(prod.nPesoLiq),
    ccod_int_item:  strOrNull(prod.cCodIntItem),
    nval_merc:      toFloatOrNull(prod.nValMerc),
    nvalor_cofins:  toFloatOrNull(prod.nValorCofins),
    nvalor_icms:    toFloatOrNull(prod.nValorIcms),
    nvalor_ipi:     toFloatOrNull(prod.nValorIpi),
    nvalor_pis:     toFloatOrNull(prod.nValorPis),
    nvalor_st:      toFloatOrNull(prod.nValorSt),
  };
}

async function callOmie(empresa: string, call: string, param: unknown) {
  const appKey    = process.env[`OMIE_APP_KEY_${empresa}`];
  const appSecret = process.env[`OMIE_APP_SECRET_${empresa}`];
  if (!appKey || !appSecret) {
    throw new Error(`Sem credenciais Omie pra empresa ${empresa}`);
  }
  const r = await fetch(OMIE_PC_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "OmiePainel-FetchOne/1.0" },
    body: JSON.stringify({ call, app_key: appKey, app_secret: appSecret, param: [param] }),
  });
  const text = await r.text();
  if (r.status === 500 && /existem .{0,3}registros|existem .{0,3}cadastros/i.test(text)) {
    return { _empty: true };
  }
  if (!r.ok) {
    let detail = text.slice(0, 300);
    try { const j = JSON.parse(text); if (j.faultstring) detail = j.faultstring; } catch {}
    throw new Error(`Omie HTTP ${r.status}: ${detail}`);
  }
  return JSON.parse(text);
}

async function logCall(userId: string, userEmail: string | null, body: { tipo: string; numero: string; empresa: string }, outcome: string, msg?: string) {
  try {
    const admin = supaAdmin();
    await admin.schema("platform" as never).from("fetch_omie_log").insert({
      user_id: userId, user_email: userEmail,
      tipo: body.tipo, numero: body.numero, empresa: body.empresa,
      outcome, msg: msg ?? null,
    });
  } catch { /* log é best-effort */ }
}

export async function POST(req: Request) {
  // Auth: APENAS admin. A ideia é que o sync funcione e isso seja muleta de
  // emergência só pra admin — não vira hábito de uso pelos aprovadores.
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: prof } = await supa
    .schema("platform" as never).from("user_profiles")
    .select("is_admin").eq("id", user.id).maybeSingle();
  if (!(prof as { is_admin?: boolean } | null)?.is_admin) {
    return NextResponse.json({ error: "Apenas administradores podem buscar PC direto do Omie" }, { status: 403 });
  }

  let body: { tipo: string; numero: string; empresa: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  if (body.tipo !== "pc") {
    return NextResponse.json({ error: "Apenas tipo='pc' suportado por enquanto" }, { status: 400 });
  }
  if (!body.numero || !body.empresa) {
    return NextResponse.json({ error: "numero e empresa obrigatórios" }, { status: 400 });
  }
  const numero = String(body.numero).trim();
  const admin = supaAdmin();

  // ── PROTEÇÃO 1: Rate-limit (10/h por user) ──────────────────────────────
  const { count: callsLastHour } = await admin
    .schema("platform" as never).from("fetch_omie_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", user.id)
    .gte("ts", new Date(Date.now() - 60 * 60_000).toISOString());
  if ((callsLastHour ?? 0) >= RATE_LIMIT_PER_HOUR) {
    await logCall(user.id, user.email ?? null, body, "rate_limited",
      `${callsLastHour} chamadas na última hora`);
    return NextResponse.json({
      error: `Você atingiu o limite de ${RATE_LIMIT_PER_HOUR} buscas por hora. Aguarde alguns minutos.`,
    }, { status: 429 });
  }

  // ── PROTEÇÃO 2: Cache 5 min — se PC já foi atualizado recentemente, retorna ──
  const { data: cached } = await admin
    .schema("orders" as never).from("pedidos_compra")
    .select("cnumero, ccontato, ntotal_pedido, cetapa, cnum_pedido, synced_at")
    .eq("empresa", body.empresa).eq("cnumero", numero)
    .order("synced_at", { ascending: false }).limit(1).maybeSingle();
  type CachedRow = { cnumero?: string; ccontato?: string; ntotal_pedido?: number; cetapa?: string; cnum_pedido?: string; synced_at?: string } | null;
  const c = cached as CachedRow;
  if (c?.synced_at) {
    const ageMin = (Date.now() - new Date(c.synced_at).getTime()) / 60_000;
    if (ageMin < CACHE_MIN) {
      await logCall(user.id, user.email ?? null, body, "cached", `age=${ageMin.toFixed(1)}min`);
      return NextResponse.json({
        ok: true, cached: true,
        message: `PC ${numero} já foi sincronizado há ${ageMin.toFixed(0)} min — sem necessidade de buscar de novo.`,
        pc_numero: c.cnumero, fornecedor: c.ccontato, valor_total: c.ntotal_pedido,
        etapa: c.cetapa, cnum_pedido: c.cnum_pedido,
      });
    }
  }

  // ── Pesquisa o PC pelo número (cNumero) na empresa indicada ────────────
  let result;
  try {
    result = await callOmie(body.empresa, "PesquisarPedCompra", {
      nPagina: 1, nRegsPorPagina: 5,
      lExibirPedidosPendentes:  "S", lExibirPedidosFaturados:  "S",
      lExibirPedidosCancelados: "S", lExibirPedidosRecebidos:  "S",
      lExibirPedidosEncerrados: "S",
      cNumero: numero,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    await logCall(user.id, user.email ?? null, body, "error", msg);
    return NextResponse.json({ error: `Falha consultando Omie: ${msg}` }, { status: 502 });
  }

  if ((result as { _empty?: boolean })._empty) {
    await logCall(user.id, user.email ?? null, body, "not_found");
    return NextResponse.json({ error: `PC ${numero} não encontrado no Omie (${body.empresa})` }, { status: 404 });
  }
  const items = (result as { pedidos_pesquisa?: Array<Record<string, unknown>> }).pedidos_pesquisa ?? [];
  const exact = items.find((p) => {
    const cab = (p.cabecalho_consulta ?? {}) as { cNumero?: string };
    return cab.cNumero === numero;
  });
  if (!exact) {
    await logCall(user.id, user.email ?? null, body, "not_found");
    return NextResponse.json({ error: `PC ${numero} não encontrado no Omie (${body.empresa})` }, { status: 404 });
  }

  const cab = (exact.cabecalho_consulta ?? {}) as Cab;
  const prods = ((exact.produtos_consulta ?? []) as Prod[]);
  const rows = (prods.length === 0 ? [{}] : prods).map((p) => mapPedidoItem(body.empresa, cab, p));
  const dedup = new Map<string, ReturnType<typeof mapPedidoItem>>();
  for (const r of rows) dedup.set(`${r.empresa}|${r.ncod_ped}|${r.ncod_item}`, r);
  const finalRows = [...dedup.values()];

  const { error: ue } = await admin.schema("orders" as never).from("pedidos_compra")
    .upsert(finalRows, { onConflict: "empresa,ncod_ped,ncod_item" });
  if (ue) {
    await logCall(user.id, user.email ?? null, body, "error", ue.message);
    return NextResponse.json({ error: `Upsert falhou: ${ue.message}` }, { status: 500 });
  }

  await logCall(user.id, user.email ?? null, body, "ok", `${finalRows.length} rows`);
  return NextResponse.json({
    ok: true, cached: false,
    message: `PC ${cab.cNumero} sincronizado direto do Omie.`,
    pc_numero: cab.cNumero, fornecedor: cab.cContato,
    valor_total: cab.nTotalPedido, etapa: cab.cEtapa,
    cnum_pedido: cab.cNumPedido, rows_persistidos: finalRows.length,
  });
}

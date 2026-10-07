// Vendas do projeto (PV/OS) — 07/10/26, Benny. Montagem usada por /api/rc-projetos/vendas.
//
// Cada documento (uma parcela do fechamento) tem DUAS datas, cada uma com previsão
// INICIAL (nunca muda por edição) e NOVA (editável; vazia = igual à inicial):
//
//   faturamento  inicial = a do documento (vendas.parcelas.faturamento_previsto no nativo,
//                          gerado do fechamento do CRM; a data do Omie no espelhado)
//                nova    = orders.fat_previsao_override (sql/72) — a MESMA da carteira do
//                          Faturamento ("Previsão fat.", clique para mudar)
//   recebimento  inicial = approval.projeto_plano_parcela.dt_plano (resumo financeiro / plano
//                          do CRM — o que o Fluxo de caixa já usa)
//                nova    = projeto_plano_parcela.dt_ajustada — o ajuste que a reimportação do
//                          CRM preserva (sql/18) e que manda no Fluxo de caixa
//
// Faturado: o recebimento atual é o vencimento do TÍTULO a receber (Financeiro › Receber).
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";

export type VendaProjeto = {
  chave: string; tipo: "PV" | "OS"; numero: string; rotulo: string; origem: "painel" | "Omie";
  evento: string | null; valor: number; oc: string | null; etapa: string | null;
  parcela: number | null;            // parcela do plano (entrada do Fluxo de caixa)
  parcela_id: number | null;         // vendas.parcelas.id (nativo)
  fat_inicial: string | null; fat_nova: string | null;
  receb_inicial: string | null; receb_nova: string | null;
  faturado: boolean; dt_fat: string | null; nf: string | null; recebido: boolean;
  titulo_ref: string | null; titulo_venc: string | null;
  /** faturado, mas a consulta do título falhou: o recebimento fica "indisponível" (nunca outra data) */
  titulo_indisponivel?: boolean;
};

export const dia = (v: unknown): string | null => {
  const s = String(v ?? "");
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
};
export const somaDias = (d: string, n: number) => {
  const t = new Date(`${d}T12:00:00Z`); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10);
};
export const difDias = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86400000);
const dig = (s: unknown) => String(s ?? "").replace(/\D/g, "").replace(/^0+/, "");

export type ParcelaPlano = { parcela: number; evento: string | null; valor: number | null; dt_plano: string | null; dt_ajustada: string | null };
type ParV = { id: number; documento_id: number; numero: number; vencimento: string | null; faturamento_previsto: string | null; faturada_em: string | null; descricao: string | null };
type TituloRow = { id: string; numero_documento: string | null; numero_documento_fiscal: string | null; vencimento: string | null;
  valor_documento: number | null; val_aberto: number | null; status_titulo: string | null };

export async function montar(empresa: string, codigo: number): Promise<{ docs: VendaProjeto[]; parcelas: ParcelaPlano[] }> {
  const adm = supaAdmin();
  const [omie, pvs, oss, parc] = await Promise.all([
    adm.schema("bi").rpc("projeto_vendas", { p_codigo_projeto: codigo, p_empresa: empresa }),
    adm.schema("sales").from("pedidos_venda").select("codigo_pedido, numero_pedido, num_pedido_cliente")
      .eq("empresa", empresa).eq("codigo_projeto", codigo),
    adm.schema("sales").from("ordens_servico").select("codigo_os, numero_os")
      .eq("empresa", empresa).eq("codigo_projeto", codigo),
    adm.schema("approval").from("projeto_plano_parcela").select("parcela, evento, valor, dt_plano, dt_ajustada")
      .eq("empresa", empresa).eq("codigo_projeto", codigo).order("parcela"),
  ]);
  /* Nativos (vendas.*, fora do PostgREST): o espelho em sales.* tem codigo =
     9000000000000 + id; o documento completo (com parcelas) vem de orders.vendas_documento. */
  const BASE = 9000000000000;
  const codsNat = [
    ...((pvs.data ?? []) as { codigo_pedido: number }[]).map((p) => Number(p.codigo_pedido)),
    ...((oss.data ?? []) as { codigo_os: string }[]).map((o) => Number(o.codigo_os)),
  ].filter((c) => Number.isFinite(c) && c > BASE);
  const nativos = (await Promise.all([...new Set(codsNat)].map(async (c) =>
    (await adm.schema("orders").rpc("vendas_documento", { p_id: c - BASE })).data as Record<string, unknown> | null)))
    .filter((d): d is Record<string, unknown> => !!d && d.status !== "cancelado");

  const docs: VendaProjeto[] = [];
  const vistos = new Set<string>();
  for (const d of nativos) {
    const ps = ((d.parcelas ?? []) as ParV[]).slice().sort((a, b) => a.numero - b.numero);
    const p = ps.find((x) => !x.faturada_em) ?? ps[ps.length - 1];
    const tipo = String(d.tipo) === "PV" ? "PV" : "OS";
    vistos.add(`${tipo}${d.numero}`);
    docs.push({
      chave: `venda:${d.id}`, tipo, numero: String(d.numero), rotulo: `${tipo}${d.numero}`, origem: "painel",
      evento: (d.evento as string | null) ?? p?.descricao ?? null, valor: Number(d.valor_total) || 0,
      oc: (d.num_pedido_cliente as string | null) || null, etapa: (d.etapa as string | null) ?? null,
      parcela: Number(String(d.evento ?? "").match(/^\s*(\d+)\s*·/)?.[1] ?? NaN) || null,
      parcela_id: ps.length === 1 && p ? Number(p.id) : null,
      fat_inicial: dia(p?.faturamento_previsto) ?? dia(d.previsao), fat_nova: null,
      receb_inicial: null, receb_nova: null,
      faturado: String(d.status) === "faturado" || String(d.etapa) === "60" || !!d.dt_fat,
      dt_fat: dia(d.dt_fat), nf: (d.nf as string | null) || null, recebido: false, titulo_ref: null, titulo_venc: null,
    });
  }
  const codPv = new Map(((pvs.data ?? []) as { codigo_pedido: number; numero_pedido: string; num_pedido_cliente: string | null }[]).map((p) => [String(p.numero_pedido), p]));
  const codOs = new Map(((oss.data ?? []) as { codigo_os: string; numero_os: string }[]).map((o) => [String(o.numero_os), o]));
  for (const v of (omie.data ?? []) as { tipo: string; label: string; numero: string; valor: number; etapa_code: string; etapa_texto: string; dt_previsao: string | null; dt_faturado: string | null; num_nfe: string | null; faturado: boolean }[]) {
    if (vistos.has(v.label)) continue;
    const tipo = v.tipo === "PV" ? "PV" : "OS";
    const cod = tipo === "PV" ? codPv.get(String(v.numero))?.codigo_pedido : codOs.get(String(v.numero))?.codigo_os;
    if (cod != null && Number(cod) >= BASE) continue;   // nativo: já veio acima
    docs.push({
      chave: cod != null ? `${tipo === "PV" ? "pv_omie" : "os_omie"}:${cod}` : "", tipo, numero: String(v.numero), rotulo: v.label, origem: "Omie",
      evento: null, valor: Number(v.valor) || 0, oc: tipo === "PV" ? (codPv.get(String(v.numero))?.num_pedido_cliente || null) : null,
      etapa: v.etapa_texto ?? v.etapa_code ?? null, parcela: null, parcela_id: null,
      fat_inicial: dia(v.dt_previsao), fat_nova: null, receb_inicial: null, receb_nova: null,
      faturado: !!v.faturado, dt_fat: dia(v.dt_faturado), nf: v.num_nfe || null, recebido: false, titulo_ref: null, titulo_venc: null,
    });
  }
  // Nova previsão de faturamento = a da carteira (override)
  const chaves = docs.map((d) => d.chave).filter(Boolean);
  if (chaves.length) {
    const { data } = await adm.schema("orders").from("fat_previsao_override").select("chave, previsao").in("chave", chaves);
    const ov = new Map(((data ?? []) as { chave: string; previsao: string }[]).map((o) => [o.chave, dia(o.previsao)]));
    for (const d of docs) d.fat_nova = ov.get(d.chave) ?? null;
  }
  // Parcela do plano de cada documento: nativo pelo nº do evento; senão mesmo valor, na ordem das datas
  const parcelas = ((parc.data ?? []) as ParcelaPlano[]).map((p) => ({ ...p, dt_plano: dia(p.dt_plano), dt_ajustada: dia(p.dt_ajustada) }));
  for (const d of docs) if (d.parcela != null && !parcelas.some((p) => p.parcela === d.parcela)) d.parcela = null;
  const usadas = new Set(docs.map((d) => d.parcela).filter((x): x is number => x != null));
  for (const d of docs.filter((x) => x.parcela == null)
    .sort((a, b) => (a.fat_inicial ?? "9").localeCompare(b.fat_inicial ?? "9") || a.rotulo.localeCompare(b.rotulo))) {
    const p = parcelas.find((x) => !usadas.has(x.parcela) && Math.abs(Number(x.valor ?? 0) - d.valor) <= Math.max(0.05, d.valor * 0.005));
    if (p) { d.parcela = p.parcela; usadas.add(p.parcela); }
  }
  for (const d of docs) {
    const p = parcelas.find((x) => x.parcela === d.parcela);
    if (p) { d.receb_inicial = p.dt_plano; d.receb_nova = p.dt_ajustada; if (!d.evento) d.evento = p.evento; }
  }
  /* Faturado: o título a receber (NF / recibo) manda no recebimento. 07/10/26 (perf): UMA
     consulta para todos os documentos, direto na finance.v_receber_bruto (a receber_buscar,
     uma por NF e com ilike na base inteira, levava 8–37 s e às vezes caía). Falhou duas vezes:
     "vencimento indisponível" — nunca outra data no lugar. */
  const fats = docs.filter((d) => d.faturado && d.nf);
  if (fats.length) {
    const nfs = [...new Set(fats.flatMap((d) => [String(d.nf), dig(d.nf)]).filter(Boolean))];
    const lista = nfs.map((n) => `"${n.replace(/"/g, "")}"`).join(",");
    const consulta = () => adm.schema("finance").from("v_receber_bruto")
      .select("id, numero_documento, numero_documento_fiscal, vencimento, valor_documento, val_aberto, status_titulo")
      .eq("empresa", empresa).or(`numero_documento_fiscal.in.(${lista}),numero_documento.in.(${lista})`).limit(500);
    let r = await consulta();
    if (r.error) r = await consulta();
    if (r.error) { for (const d of fats) d.titulo_indisponivel = true; }
    else {
      const ts = ((r.data ?? []) as TituloRow[]).filter((t) => !["EXCLUIDO", "CANCELADO"].includes(String(t.status_titulo ?? "")));
      for (const d of fats) {
        const meus = ts.filter((t) => dig(t.numero_documento_fiscal) === dig(d.nf) || dig(t.numero_documento) === dig(d.nf));
        const t = meus.find((x) => Math.abs(Number(x.valor_documento) - d.valor) < 0.05) ?? (meus.length === 1 ? meus[0] : null);
        if (t) {
          d.titulo_ref = `r:${t.id}`; d.titulo_venc = dia(t.vencimento);
          d.recebido = ["RECEBIDO", "LIQUIDADO"].includes(String(t.status_titulo ?? "")) || Number(t.val_aberto ?? t.valor_documento) <= 0.004;
        }
      }
    }
  }
  docs.sort((a, b) => (a.parcela ?? 99) - (b.parcela ?? 99) || (a.fat_inicial ?? "9").localeCompare(b.fat_inicial ?? "9"));
  return { docs, parcelas };
}

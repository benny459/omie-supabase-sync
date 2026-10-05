import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { prevoo } from "@/lib/faturamento/server";
import { supaAdmin } from "@/lib/supabase-admin";
import type { DocFat } from "@/lib/faturamento/montar";
import { buscarItensEstoque, codigosSemEstoque, MSG_SEM_ESTOQUE, type CodigoCompra } from "@/lib/estoque-vinculos";
import { buscarItensCrm } from "@/lib/catalogo-crm";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Nova emissão (folha dedicada, 05/10/26).
 *  GET ?op=opcoes&emp=SF              → condições, formas, contas, categorias, projetos, centros, vendedores
 *  GET ?op=proximos&emp=SF             → próximos nº de PV, OS, NF-e e recibo (sem consumir)
 *  GET ?op=historico&emp=SF&doc=CNPJ  → últimos faturamentos do cliente ("usar como modelo")
 *  GET ?op=nf_origem&emp=SF&q=…        → NF de entrada para a devolução (Focus + espelho Omie), com itens/tributos quando há
 *  GET ?op=pessoa_doc&emp=SF&doc=CNPJ  → id do cadastro (cadastros.pessoas) pelo CNPJ/CPF
 *  GET ?op=itens&emp=SF&q=…&cli=COD    → itens do catálogo nativo (código novo/Omie/descrição) com NCM/CEST/origem, CMC, última compra, saldo e último preço de venda ao cliente
 *  POST { op: "previa", documento }   → pré-voo (payload + checagens + parcelas), sem enviar nada
 */

type NfOrigemItem = {
  codigo: string; descricao: string; ncm: string | null; cest: string | null; cfop: string | null; unidade: string;
  quantidade: number; valor_unitario: number; origem: number | null;
  icms_aliquota: number | null; pis_cst: string | null; pis_aliquota: number | null; cofins_cst: string | null; cofins_aliquota: number | null;
  ref_item: number | null;
};
const nOuNull = (v: unknown) => (v == null || v === "" ? null : Number(v));
/** Itens da NF de entrada a partir do JSON completo da Focus (requisicao_nota_fiscal.itens). */
function itensFocus(det: Record<string, unknown> | null): NfOrigemItem[] {
  const req = (det?.requisicao_nota_fiscal ?? null) as Record<string, unknown> | null;
  const its = (req?.itens ?? []) as Record<string, unknown>[];
  return its.map((i) => ({
    codigo: String(i.codigo_produto ?? ""), descricao: String(i.descricao ?? ""),
    ncm: i.codigo_ncm ? String(i.codigo_ncm) : null, cest: i.cest ? String(i.cest) : null, cfop: i.cfop ? String(i.cfop) : null,
    unidade: String(i.unidade_comercial ?? "UN"),
    quantidade: Number(i.quantidade_comercial ?? 0), valor_unitario: Number(i.valor_unitario_comercial ?? 0),
    origem: nOuNull(i.icms_origem),
    icms_aliquota: nOuNull(i.icms_aliquota),
    pis_cst: i.pis_situacao_tributaria ? String(i.pis_situacao_tributaria) : null, pis_aliquota: nOuNull(i.pis_aliquota_porcentual),
    cofins_cst: i.cofins_situacao_tributaria ? String(i.cofins_situacao_tributaria) : null, cofins_aliquota: nOuNull(i.cofins_aliquota_porcentual),
    ref_item: nOuNull(i.numero_item),
  }));
}

/** Formas de recebimento: tipo de documento do título (cadastros › tipos de documento)
 *  + o tPag da NF-e correspondente. */
const FORMAS = [
  { codigo: "BOL", nome: "Boleto", tpag: "15" },
  { codigo: "PIX", nome: "Pix", tpag: "17" },
  { codigo: "TRA", nome: "Transferência", tpag: "18" },
  { codigo: "TED", nome: "TED", tpag: "18" },
  { codigo: "DEP", nome: "Depósito", tpag: "16" },
  { codigo: "CRC", nome: "Cartão de crédito", tpag: "03" },
  { codigo: "CRD", nome: "Cartão de débito", tpag: "04" },
  { codigo: "DIN", nome: "Dinheiro", tpag: "01" },
  { codigo: "CHQ", nome: "Cheque", tpag: "02" },
  { codigo: "DUP", nome: "Duplicata", tpag: "15" },
  { codigo: "REC", nome: "Recibo", tpag: "99" },
  { codigo: "NFS", nome: "Nota Fiscal de Serviço", tpag: "99" },
  { codigo: "99999", nome: "Outros", tpag: "99" },
];

/** Prazos de uma condição: dados.dias, "30/60/90", "Para 28 dias", "A28", "N Parcelas" (30 em 30). */
function diasDe(codigo: string, nome: string, dados: { dias?: number[] } | null): number[] | null {
  if (Array.isArray(dados?.dias) && dados!.dias!.length) return dados!.dias!;
  const n = nome.toLowerCase();
  if (/vista/.test(n) || codigo === "000") return [0];
  const barras = nome.match(/\d+(?:\s*\/\s*\d+)+/);
  if (barras) return barras[0].split("/").map((x) => Number(x.trim()));
  const para = n.match(/(\d+)\s*(dias|ddl|dd)/);
  if (para) return [Number(para[1])];
  const a = codigo.match(/^A(\d+)$/i);
  if (a) return [Number(a[1])];
  const parc = n.match(/^(\d+)\s*parcela/);
  if (parc) return Array.from({ length: Number(parc[1]) }, (_, i) => 30 * (i + 1));
  return null;
}

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const sp = req.nextUrl.searchParams;
  const emp = (sp.get("emp") ?? "SF").toUpperCase();
  const op = sp.get("op") ?? "opcoes";
  const a = supaAdmin();
  try {
    if (op === "sem_estoque") {
      // Linhas da folha (CRM, rascunho antigo, digitadas) cujo código não é item nosso: com o produto
      // de compra correspondente, para "Criar item nosso" / "Vincular" na própria linha (05/10/26).
      const cods = (sp.get("cods") ?? "").split(",").map((c) => c.trim()).filter(Boolean).slice(0, 200);
      const sem = await codigosSemEstoque(emp, cods);
      if (!sem.length) return NextResponse.json({ sem: [] });
      const [cat, fis] = await Promise.all([
        a.schema("orders").from("mv_catalogo_compra").select("ncod_prod,codigo,descricao,unidade,ultimo_preco,ultima_compra,fornecedor,fornecedor_cod")
          .eq("empresa", emp).in("codigo", sem),
        a.schema("orders").from("fat_produto_fiscal").select("codigo_produto,ncm").eq("empresa", emp).in("codigo_produto", sem),
      ]);
      type Cat = { ncod_prod: number; codigo: string; descricao: string; unidade: string | null; ultimo_preco: number | null; ultima_compra: string | null;
        fornecedor: string | null; fornecedor_cod: number | null };
      const cMap = new Map(((cat.data ?? []) as Cat[]).map((c) => [c.codigo.toUpperCase(), c]));
      const nMap = new Map(((fis.data ?? []) as { codigo_produto: string; ncm: string | null }[]).map((f) => [f.codigo_produto.toUpperCase(), f.ncm]));
      return NextResponse.json({ sem: sem.map((codigo) => {
        const c = cMap.get(codigo.toUpperCase());
        const compra: CodigoCompra | null = c ? { n_cod_prod: Number(c.ncod_prod), codigo: c.codigo, descricao: c.descricao, unidade: c.unidade,
          ultimo_preco: c.ultimo_preco, ultima_compra: c.ultima_compra, fornecedor: c.fornecedor, fornecedor_cod: c.fornecedor_cod,
          ncm: nMap.get(codigo.toUpperCase()) ?? null } : null;
        return { codigo, compra };
      }) });
    }
    if (op === "itens") {
      // Autocompletar dos itens da folha (05/10/26): catálogo nativo + fiscal + CMC/última compra/saldo
      // + último preço vendido a este cliente (espelho dos PVs).
      const termo = (sp.get("q") ?? "").trim();
      if (termo.length < 2) return NextResponse.json({ itens: [], compra: [] });
      // NF-e (venda/remessa/conserto/devolução) movimenta estoque: só itens NATIVOS; código de compra
      // resolvido para o item nosso, ou devolvido à parte em "compra" para vincular/cadastrar (05/10/26).
      let compra: CodigoCompra[] = [];
      let base: { codigo: string | null; codigo_omie: string | null; descricao: string; unidade: string | null; cmc: number | null; saldo: number | null;
        ultimo_preco: number | null; ultima_compra?: string | null; via?: string | null; n_cod_prod?: number; ncm?: string | null }[];
      if (sp.get("estoque") === "1") {
        const r = await buscarItensEstoque(emp, termo, 10);
        compra = r.compra;
        base = r.nativos.map((x) => ({ codigo: x.codigo, codigo_omie: x.codigo_omie, descricao: x.descricao, unidade: x.unidade, cmc: x.cmc,
          saldo: x.saldo, ultimo_preco: x.ultimo_preco, ultima_compra: null, via: x.via, n_cod_prod: x.n_cod_prod, ncm: x.ncm }));
      } else {
        base = await buscarItensCrm(termo, 10, 0, emp);
      }
      const cods = [...new Set(base.flatMap((b) => [b.codigo, b.codigo_omie]).filter((c): c is string => !!c))];
      const [fis, vend] = await Promise.all([
        cods.length ? a.schema("orders").from("fat_produto_fiscal").select("codigo_produto,ncm,cest,origem,unidade").eq("empresa", emp).in("codigo_produto", cods) : Promise.resolve({ data: [] }),
        cods.length && sp.get("cli") ? a.schema("sales").from("itens_vendidos").select("codigo_produto,valor_unitario,d_inc_d").eq("empresa", emp)
          .eq("codigo_cliente", sp.get("cli")!).in("codigo_produto", cods).order("d_inc_d", { ascending: false }).limit(60) : Promise.resolve({ data: [] }),
      ]);
      type F = { codigo_produto: string; ncm: string | null; cest: string | null; origem: number | null; unidade: string | null };
      type V = { codigo_produto: string; valor_unitario: number; d_inc_d: string | null };
      const fMap = new Map(((fis.data ?? []) as F[]).map((f) => [f.codigo_produto, f]));
      const vMap = new Map<string, V>();
      for (const v of (vend.data ?? []) as V[]) if (!vMap.has(v.codigo_produto)) vMap.set(v.codigo_produto, v);
      return NextResponse.json({ itens: base.map((b) => {
        const f = (b.codigo && fMap.get(b.codigo)) || (b.codigo_omie && fMap.get(b.codigo_omie)) || null;
        const v = (b.codigo && vMap.get(b.codigo)) || (b.codigo_omie && vMap.get(b.codigo_omie)) || null;
        return { codigo: b.codigo ?? b.codigo_omie ?? "", codigo_omie: b.codigo_omie, descricao: b.descricao, unidade: f?.unidade || b.unidade || "UN",
          ncm: f?.ncm ?? b.ncm ?? null, cest: f?.cest ?? null, origem: f?.origem ?? null, cmc: b.cmc, saldo: b.saldo,
          ultimo_preco: b.ultimo_preco, ultima_compra: b.ultima_compra ?? null, ultima_venda: v ? Number(v.valor_unitario) : null, ultima_venda_em: v?.d_inc_d ?? null,
          via: b.via ?? null, nativo: sp.get("estoque") === "1" };
      }), compra });
    }
    if (op === "proximos") {
      // Próximos números (sem consumir): PV/OS (vendas.numeracao ⊕ Omie), NF-e e recibo (fat_config).
      const { data, error } = await a.schema("orders").rpc("fat_proximos", { p_empresa: emp });
      if (error) throw new Error(error.message);
      return NextResponse.json(data ?? {});
    }
    if (op === "nf_origem") {
      // Devolução de compra: escolhe a NF de entrada (fornecedor) a referenciar.
      const q = (sp.get("q") ?? "").replace(/[^\p{L}\p{N} ./-]/gu, " ").trim();
      const dig = q.replace(/\D/g, "");
      if (q.length < 2) return NextResponse.json({ notas: [] });
      const filtrosF = [`emitente_nome.ilike.%${q}%`];
      if (dig) filtrosF.push(`numero.eq.${dig.replace(/^0+/, "") || dig}`, `numero.eq.${dig}`);
      if (dig.length >= 8) filtrosF.push(`emitente_doc.ilike.%${dig}%`);
      if (dig.length === 44) filtrosF.push(`chave.eq.${dig}`);
      const filtrosO = [`fornecedor.ilike.%${q}%`];
      if (dig) filtrosO.push(`numero.eq.${dig.replace(/^0+/, "") || dig}`);
      if (dig.length >= 8) filtrosO.push(`cnpj_cpf.ilike.%${dig}%`);
      if (dig.length === 44) filtrosO.push(`chave_nfe.eq.${dig}`);
      const [f, o] = await Promise.all([
        a.schema("orders").from("focus_recebidos").select("chave,numero,emissao,emitente_nome,emitente_doc,valor,completa,detalhe")
          .eq("empresa", emp).or(filtrosF.join(",")).order("emissao", { ascending: false }).limit(12),
        a.schema("orders").from("v_erp_nf_entrada").select("numero,serie,fornecedor,cnpj_cpf,emissao,valor_total,chave_nfe,natureza_operacao")
          .eq("empresa", emp).or(filtrosO.join(",")).order("emissao", { ascending: false }).limit(10),
      ]);
      if (f.error) throw new Error(f.error.message);
      const notas: Record<string, unknown>[] = [];
      const vistas = new Set<string>();
      for (const r of (f.data ?? []) as Record<string, unknown>[]) {
        const det = (r.detalhe ?? null) as Record<string, unknown> | null;
        const req = (det?.requisicao_nota_fiscal ?? null) as Record<string, unknown> | null;
        const ch = String(r.chave ?? "");
        vistas.add(ch);
        notas.push({
          fonte: "focus", chave: ch, numero: String(r.numero ?? ""), serie: req?.serie ? String(req.serie) : ch.length === 44 ? String(Number(ch.slice(22, 25))) : null,
          emissao: r.emissao ? String(r.emissao).slice(0, 10) : null, emitente: r.emitente_nome, emitente_doc: String(r.emitente_doc ?? ""),
          valor: Number(r.valor ?? 0), natureza: req?.natureza_operacao ?? null, itens: r.completa ? itensFocus(det) : [],
        });
      }
      for (const r of (o.data ?? []) as Record<string, unknown>[]) {
        const ch = String(r.chave_nfe ?? "");
        if (!ch || vistas.has(ch)) continue;
        vistas.add(ch);
        notas.push({
          fonte: "omie", chave: ch, numero: String(r.numero ?? ""), serie: r.serie ? String(Number(r.serie)) : null,
          emissao: r.emissao ? String(r.emissao).slice(0, 10) : null, emitente: r.fornecedor, emitente_doc: String(r.cnpj_cpf ?? "").replace(/\D/g, ""),
          valor: Number(r.valor_total ?? 0), natureza: r.natureza_operacao ?? null, itens: [],
        });
      }
      return NextResponse.json({ notas });
    }
    if (op === "pessoa_doc") {
      const doc = (sp.get("doc") ?? "").replace(/\D/g, "");
      if (doc.length < 11) return NextResponse.json({ id: null });
      const { data, error } = await a.schema("orders").rpc("cadastros_listar", { p_papel: null, p_empresa: emp, p_q: doc, p_ativos: true, p_lim: 1, p_off: 0 });
      if (error) throw new Error(error.message);
      const l = ((data as { linhas?: { id: number; codigo: number; razao: string }[] } | null)?.linhas ?? [])[0];
      return NextResponse.json({ id: l?.id ?? null, codigo: l?.codigo ?? null, razao: l?.razao ?? null });
    }
    if (op === "historico") {
      const doc = (sp.get("doc") ?? "").replace(/\D/g, "");
      if (doc.length < 11) return NextResponse.json({ historico: [] });
      const { data, error } = await a.schema("orders").rpc("fat_historico_cliente", { p_empresa: emp, p_doc: doc, p_lim: 10 });
      if (error) throw new Error(error.message);
      return NextResponse.json({ historico: data ?? [] });
    }
    // cadastros.* não é exposto no PostgREST: lê pela função orders.cad_aux_opcoes.
    const aux = async (registro: string) => {
      const r = await a.schema("orders").rpc("cad_aux_opcoes", { p_registro: registro, p_empresa: emp });
      return { data: (r.data ?? []) as unknown[], error: r.error };
    };
    const [cond, contas, cats, proj, cc, vend, contasAux] = await Promise.all([
      aux("condicoes"),
      a.schema("finance").from("contas_correntes").select("cod_cc,descricao,tipo_conta_corrente").eq("empresa", emp).neq("inativo", "S").order("descricao").limit(200),
      a.schema("finance").from("categorias").select("codigo,descricao").eq("empresa", emp).like("codigo", "1.%")
        .neq("conta_inativa", "S").neq("totalizadora", "S").order("codigo").limit(500),
      a.schema("finance").from("projetos").select("codigo,nome").eq("empresa", emp).neq("inativo", "S").order("nome").limit(1000),
      aux("centros_custo"),
      aux("vendedores"),
      aux("contas"),   // dados bancários + chave PIX (cadastros › bancos e contas)
    ]);
    const err = cond.error ?? contas.error ?? cats.error ?? proj.error ?? cc.error ?? vend.error;
    if (err) throw new Error(err.message);
    type Aux = { codigo: string; nome: string; dados: { dias?: number[] } | null };
    type ContaAux = { codigo: string; dados: Record<string, unknown> | null };
    const dadosConta = new Map(((contasAux.data ?? []) as ContaAux[]).map((c) => [String(c.codigo), c.dados ?? {}]));
    const txt = (v: unknown) => (v == null || v === "" ? null : String(v));
    return NextResponse.json({
      condicoes: ((cond.data ?? []) as Aux[]).map((c) => ({ codigo: c.codigo, nome: c.nome, dias: diasDe(c.codigo, c.nome, c.dados) }))
        .sort((x, y) => x.codigo.localeCompare(y.codigo)),
      formas: FORMAS,
      contas: (contas.data ?? []).map((c) => {
        const d = dadosConta.get(String(c.cod_cc)) ?? {};
        return { codigo: Number(c.cod_cc), nome: c.descricao, tipo: c.tipo_conta_corrente,
          banco: txt(d.banco), agencia: txt(d.agencia), conta: txt(d.conta),
          pix_tipo: txt(d.pix_tipo), pix_chave: txt(d.pix_chave), beneficiario: txt(d.beneficiario) };
      }),
      categorias: (cats.data ?? []).map((c) => ({ codigo: c.codigo, nome: c.descricao })),
      projetos: (proj.data ?? []).map((p) => ({ codigo: String(p.codigo), nome: p.nome })),
      centros: ((cc.data ?? []) as Aux[]).map((c) => ({ codigo: c.codigo, nome: c.nome })),
      vendedores: ((vend.data ?? []) as Aux[]).map((v) => ({ codigo: v.codigo, nome: v.nome })),
    });
  } catch (e) {
    return falha(e);
  }
}

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const body = await req.json().catch(() => ({})) as { op?: string; documento?: DocFat; tipo?: string };
  if (body.op !== "previa" || !body.documento) return falha("op/documento inválidos");
  try {
    const r = await prevoo(body.documento, {});
    // NF-e movimenta estoque: todo item precisa ser do estoque nosso (código novo) — 05/10/26.
    if (body.tipo === "nfe") {
      const sem = await codigosSemEstoque(body.documento.empresa, body.documento.itens.map((i) => i.codigo ?? ""));
      const semCodigo = body.documento.itens.some((i) => !(i.codigo ?? "").trim());
      if (sem.length || semCodigo) {
        r.checagens.push({ item: "Itens do estoque", ok: false, nivel: "erro",
          detalhe: semCodigo && !sem.length ? "Há item sem código — escolha o item do estoque pela busca." : MSG_SEM_ESTOQUE(sem) });
        r.pode_emitir = false;
      } else r.checagens.push({ item: "Itens do estoque", ok: true, nivel: "erro", detalhe: "Todos os itens têm código do estoque." });
    }
    return NextResponse.json(r);
  } catch (e) {
    return falha(e);
  }
}

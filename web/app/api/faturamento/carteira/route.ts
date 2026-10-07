import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { bloqueioOsOmie, configDe, documentoOsOmie, documentoPvOmie, emitir, emitirOsOmie, emitirPvOmie, prevoo, prevooRecibo, urlArquivo } from "@/lib/faturamento/server";
import { completarRecebimento } from "@/lib/faturamento/lote";
import { totalDoc } from "@/lib/faturamento/montar";
import { docFat, documento } from "@/lib/vendas-server";
import { docFatParcelas, parcelasProjeto } from "@/lib/vendas-fat";
import type { DocFat } from "@/lib/faturamento/montar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Carteira de faturamento PV & OS (05/10/2026) — a tela /faturamento no
   conceito "PV → NF-e · OS → NFS-e". GET devolve os documentos (Omie e
   nativos) a faturar ou faturados no período; POST age sobre UM documento
   pela chave ("pv_omie:<codigo>" | "venda:<id>"):
     doc     → itens e cliente montados (só banco, nada sai);
     prevoo  → checagens completas sem enviar;
     ensaio  → mesma nota na HOMOLOGAÇÃO (só PV do Omie);
     emitir  → emissão no ambiente da empresa (produção só com a chave do Benny);
     lote    → (OS) documento do recibo completo como a folha o preencheria
               (forma/conta/instrução) + pré-voo, sem enviar — para "Emitir N recibos".
   GET com busca "4729, 4735; OS4738" procura cada número (todos os períodos).
   OS do Omie ("os_omie:<codigo_os>", 05/10/26): emitem RECIBO pelo painel
   (numeração recibo_proximo); NFS-e da prefeitura só se registra. */

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const empresa = req.nextUrl.searchParams.get("empresa") || "SF";
  const desde = req.nextUrl.searchParams.get("desde");
  // Com texto de busca, a carteira procura em todos os períodos (sql/72).
  const buscaTxt = (req.nextUrl.searchParams.get("busca") ?? "").trim().slice(0, 400);
  const pDesde = desde && /^\d{4}-\d{2}-\d{2}$/.test(desde) ? desde : null;
  const carteira = (b: string | null) => supaAdmin().schema("orders").rpc("fat_carteira", { p_empresa: empresa, p_desde: pDesde, p_busca: b });
  // Vários números (vírgula, ponto e vírgula ou espaço): uma busca por número, unidas.
  const nums = buscaTxt.split(/[,;\s]+/).map((t) => t.trim()).filter(Boolean);
  if (nums.length > 1 && nums.every((t) => /^(PV|OS)?\d+$/i.test(t))) {
    const rs = await Promise.all([...new Set(nums.map((t) => t.replace(/^(PV|OS)/i, "")))].slice(0, 40).map((t) => carteira(t)));
    const erro = rs.find((r) => r.error)?.error;
    if (erro) return falha(erro.message, 500);
    const base = (rs[0].data ?? {}) as Record<string, unknown>;
    const docs = new Map<string, unknown>();
    for (const r of rs) for (const d of ((r.data as { docs?: { chave: string }[] } | null)?.docs ?? [])) docs.set(d.chave, d);
    return NextResponse.json({ ...base, docs: [...docs.values()] });
  }
  const { data, error } = await carteira(buscaTxt.slice(0, 80) || null);
  if (error) return falha(error.message, 500);
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as { chave?: string; acao?: string; empresa?: string; documento?: DocFat | null; forcar_homologacao?: boolean;
    /** PV/OS de projeto: parcelas do fechamento a faturar nesta nota (06/10/26). */ parcelas?: number[] | null };
  if (b.forcar_homologacao && !q.homologacao) return falha("Sem permissão para emitir em homologação (Usuários e acessos → Faturamento)", 403);
  const [tipo, idTxt] = String(b.chave ?? "").split(":");
  const id = Number(idTxt);
  const empresa = b.empresa || "SF";
  if (!Number.isFinite(id) || id <= 0) return falha("chave inválida");
  try {
    if (tipo === "pv_omie") {
      if (b.acao === "lote") return NextResponse.json({ bloqueio: "PV fatura por NF-e — use a folha" });
      if (b.acao === "doc") {
        const { bruto, doc } = await documentoPvOmie(empresa, id);
        return NextResponse.json({ documento: doc, condicao: bruto.condicao, parcelas_dias: bruto.parcelas_dias });
      }
      if (b.acao === "prevoo") {
        const { bruto, doc } = await documentoPvOmie(empresa, id);
        const pre = await prevoo(doc, { nf_omie: bruto.nf_omie, emissao_painel: bruto.emissao_painel, etapa: String(bruto.pv.etapa ?? ""), total_pv: Number(bruto.pv.valor_total) });
        return NextResponse.json({ documento: doc, ...pre });
      }
      if (b.acao === "ensaio" || b.acao === "emitir") {
        const e = await emitirPvOmie(empresa, id, { ensaio: b.acao === "ensaio", criado_por: q.email, documento: b.documento ?? null });
        return NextResponse.json({ emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path) });
      }
    }
    if (tipo === "venda") {
      const d = await documento(id);
      // Projeto com parcelas do fechamento: a nota fatura parcela(s), não o documento inteiro.
      const projeto = parcelasProjeto(d);
      const docProj = projeto.length ? docFatParcelas(d, b.parcelas ?? null) : null;
      const doc = docProj ?? docFat(d);
      if (b.acao === "doc") return NextResponse.json({ documento: doc, parcelas_projeto: projeto.length ? projeto : null });
      if (b.acao === "lote") {
        if (d.tipo !== "OS") return NextResponse.json({ bloqueio: "PV fatura por NF-e — use a folha" });
        if (projeto.length) return NextResponse.json({ bloqueio: "OS de projeto: fature por parcela do fechamento na folha (Revisar e emitir)" });
        const cfg = await configDe(empresa);
        if (cfg.tipo_os !== "recibo") return NextResponse.json({ bloqueio: "OS desta empresa fatura por NFS-e, não por recibo" });
        const comp = await completarRecebimento(doc);
        const bloqueio = d.status !== "aberto" ? `${d.label} não está em aberto (${d.status})` : null;
        const pre = await prevooRecibo(comp, { bloqueio, total_os: Number(d.valor_total) });
        return NextResponse.json({ documento: comp, bloqueio, ...pre });
      }
      if (b.acao === "prevoo") {
        const alvo = b.documento ? { ...b.documento, empresa: doc.empresa } : doc;
        const pre = await prevoo(alvo, { total_pv: alvo.parcela_doc ? alvo.parcela_doc.total : Number(d.valor_total) });
        return NextResponse.json({ documento: doc, ...pre });
      }
      if (b.acao === "emitir") {
        if (d.status !== "aberto") return falha(`${d.label} não está em aberto (${d.status})`);
        const final = b.documento ? { ...b.documento, empresa: doc.empresa, rotulo: doc.rotulo } : doc;
        let vendaParcelas: number[] | null = null;
        if (projeto.length) {
          // Confere as parcelas com o banco: existem, estão por faturar e a nota vale a soma delas.
          const nums = [...new Set((final.parcela_doc?.numeros ?? []).map(Number))];
          if (!nums.length) return falha("Projeto: escolha a(s) parcela(s) do fechamento que esta nota fatura");
          const sel = projeto.filter((p) => nums.includes(p.numero));
          if (sel.length !== nums.length) return falha("Parcela inexistente neste documento");
          const ja = sel.find((p) => p.faturada_em);
          if (ja) return falha(`A parcela ${ja.numero} (${ja.descricao}) já foi faturada`);
          const alvo = Math.round(sel.reduce((a, p) => a + Number(p.valor), 0) * 100) / 100;
          const tot = totalDoc(final.itens);
          if (Math.abs(tot - alvo) > 0.05) return falha(`A nota vale R$ ${tot.toFixed(2)} mas a(s) parcela(s) somam R$ ${alvo.toFixed(2)}`);
          vendaParcelas = nums;
        }
        const e = await emitir(final, {
          tipo: d.tipo === "PV" ? "nfe" : undefined, origem_tipo: d.tipo === "OS" ? "os" : "pv",
          origem_id: String(id), origem_rotulo: d.label, criado_por: q.email,
          venda_parcelas: vendaParcelas, forcar_homologacao: !!b.forcar_homologacao, manter_origem: !!b.forcar_homologacao,
        });
        return NextResponse.json({ emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path) });
      }
      if (b.acao === "ensaio") return falha("Ensaio só existe para PV do Omie — use Validar");
    }
    if (tipo === "os_omie") {
      const { bruto, doc } = await documentoOsOmie(empresa, id);
      if (b.acao === "doc") return NextResponse.json({ documento: doc, condicao: bruto.condicao, parcelas_dias: bruto.parcelas_dias, bloqueio: bloqueioOsOmie(bruto) });
      if (b.acao === "lote") {
        const comp = await completarRecebimento(doc);
        const bloqueio = bloqueioOsOmie(bruto);
        const pre = await prevooRecibo(comp, { bloqueio, total_os: totalDoc(doc.itens) });
        return NextResponse.json({ documento: comp, bloqueio, ...pre });
      }
      if (b.acao === "prevoo") {
        const pre = await prevooRecibo(b.documento ? { ...b.documento, empresa, rotulo: doc.rotulo } : doc, { bloqueio: bloqueioOsOmie(bruto), total_os: totalDoc(doc.itens) });
        return NextResponse.json({ documento: doc, ...pre });
      }
      if (b.acao === "emitir") {
        const e = await emitirOsOmie(empresa, id, { criado_por: q.email, documento: b.documento ?? null, forcar_homologacao: !!b.forcar_homologacao });
        return NextResponse.json({ emissao: e, xml_url: null, pdf_url: await urlArquivo(e.pdf_path) });
      }
      if (b.acao === "ensaio") return falha("OS do Omie: use “Teste (forçar homologação)” na folha");
    }
    return falha("ação inválida");
  } catch (e) {
    return falha(e);
  }
}

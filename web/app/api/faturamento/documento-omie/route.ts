import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { configDe, emitente, urlArquivo } from "@/lib/faturamento/server";
import { reciboHtml, type DocFat } from "@/lib/faturamento/montar";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Documentos de notas emitidas no Omie, para abrir pela carteira (sql/72).
   - tipo=recibo&os=<codigo_os>: 2ª via do recibo no nosso modelo (réplica do
     Omie), montada do espelho da OS — não chama o Omie.
   - tipo=nfe&nid=<nIdNF>&fmt=xml|pdf: XML/DANFE pedidos ao Omie UMA vez (só
     leitura) e guardados em fat-documentos/omie/…; os cliques seguintes vêm do
     Storage. Se o Omie limitar, devolve um erro amigável. Nada é escrito no Omie. */
const BUCKET = "fat-documentos";

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const sp = req.nextUrl.searchParams;
  const empresa = (sp.get("empresa") || "SF").toUpperCase();
  const tipo = sp.get("tipo");
  try {
    if (tipo === "recibo") return await recibo(empresa, String(sp.get("os") ?? ""));
    if (tipo === "nfe") return await nfe(empresa, String(sp.get("nid") ?? ""), sp.get("fmt") === "pdf" ? "pdf" : "xml");
    return falha("tipo inválido");
  } catch (e) {
    return falha(e instanceof Error ? e.message : String(e), 502);
  }
}

async function recibo(empresa: string, codigoOs: string) {
  if (!/^\d+$/.test(codigoOs)) return falha("OS inválida");
  const db = supaAdmin();
  const { data: linhas, error } = await db.schema("sales").from("ordens_servico")
    .select("numero_os,codigo_cliente,descricao_servico,quantidade,valor_unitario,valor_total,num_recibo,dt_fat_d,seq_item")
    .eq("empresa", empresa).eq("codigo_os", codigoOs).order("seq_item");
  if (error) throw new Error(error.message);
  if (!linhas?.length) return falha("OS não encontrada no espelho", 404);
  const l0 = linhas[0] as Record<string, unknown>;
  const numRecibo = Number(String(l0.num_recibo ?? "").replace(/\D/g, ""));
  if (!numRecibo) return falha("Esta OS não tem recibo emitido no Omie", 404);
  const { data: pe } = await db.schema("orders").rpc("fat_cliente_doc", { p_empresa: empresa, p_codigo: Number(l0.codigo_cliente) });
  const p = (pe ?? {}) as Record<string, string | null>;
  const doc11 = String(p.cnpj_cpf ?? "").replace(/\D/g, "");
  // Parcelas reais do contas a receber (vencimentos e valores do recibo).
  const { data: rec } = await db.schema("orders").rpc("fat_receber_resumo", { p_empresa: empresa, p_labels: [`OS${l0.numero_os}`] });
  const parcs = ((rec as Record<string, { parcelas?: { vencimento: string; valor: number }[] }> | null)?.[`OS${l0.numero_os}`]?.parcelas ?? [])
    .map((x) => ({ vencimento: x.vencimento, valor: Number(x.valor) }));
  const doc: DocFat = {
    empresa,
    cliente: {
      nome: p.razao_social ?? "", cnpj: doc11.length === 14 ? doc11 : null, cpf: doc11.length === 11 ? doc11 : null,
      ie: p.inscricao_estadual ?? null, email: p.email ?? null, logradouro: p.logradouro ?? "", numero: p.numero ?? "",
      complemento: p.complemento ?? null, bairro: p.bairro ?? "", municipio: p.cidade ?? "", codigo_municipio: p.cidade_ibge ?? null,
      uf: p.uf ?? "", cep: p.cep ?? "", telefone: p.telefone ?? null,
    },
    itens: linhas.map((x: Record<string, unknown>) => ({
      codigo: "", descricao: String(x.descricao_servico ?? ""), quantidade: Number(x.quantidade) || 1,
      valor_unitario: Number(x.valor_unitario) || (Number(x.valor_total) / (Number(x.quantidade) || 1)),
    })),
    condicao: parcs.length ? { parcelas: parcs } : null,
    rotulo: `OS${l0.numero_os}`,
  };
  const cfg = await configDe(empresa);
  const em = await emitente(cfg);
  const html = reciboHtml(doc, em, numRecibo, false, String(l0.dt_fat_d ?? "") || null);
  return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}

async function nfe(empresa: string, nid: string, fmt: "xml" | "pdf") {
  if (!/^\d+$/.test(nid)) return falha("NF inválida");
  const caminho = `omie/${empresa}/${nid}.${fmt}`;
  const st = supaAdmin().storage.from(BUCKET);
  const { data: ja } = await st.list(`omie/${empresa}`, { search: `${nid}.${fmt}` });
  if (ja?.some((f) => f.name === `${nid}.${fmt}`)) return redirecionar(caminho);

  const app_key = process.env[`OMIE_APP_KEY_${empresa}`];
  const app_secret = process.env[`OMIE_APP_SECRET_${empresa}`];
  if (!app_key || !app_secret) return falha("Credenciais do Omie desta empresa não configuradas no painel", 503);
  // Leitura única no Omie (dfedocs › ObterNfe): devolve o XML e o link do DANFE.
  const r = await fetch("https://app.omie.com.br/api/v1/produtos/dfedocs/", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ call: "ObterNfe", app_key, app_secret, param: [{ nIdNfe: Number(nid) }] }),
  });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  const fault = String(j.faultstring ?? "");
  if (fault || !r.ok) {
    if (/MISUSE|bloquead|consumo|limite/i.test(fault)) return falha("O Omie está limitando as consultas agora. Tente de novo em alguns minutos.", 429);
    return falha(`Omie: ${fault || `HTTP ${r.status}`}`, 502);
  }
  const xml = Object.entries(j).find(([k, v]) => /xml/i.test(k) && typeof v === "string" && String(v).includes("<"))?.[1] as string | undefined;
  const pdfUrl = Object.entries(j).find(([k, v]) => /(pdf|danfe)/i.test(k) && typeof v === "string" && /^https?:/i.test(String(v)))?.[1] as string | undefined;
  if (xml) await st.upload(`omie/${empresa}/${nid}.xml`, new Blob([xml], { type: "application/xml" }), { upsert: true, contentType: "application/xml" });
  if (pdfUrl) {
    const pr = await fetch(pdfUrl).catch(() => null);
    if (pr?.ok) {
      const bytes = new Uint8Array(await pr.arrayBuffer());
      await st.upload(`omie/${empresa}/${nid}.pdf`, new Blob([bytes], { type: "application/pdf" }), { upsert: true, contentType: "application/pdf" });
    }
  }
  if (fmt === "xml" && !xml) return falha("O Omie não devolveu o XML desta nota", 404);
  if (fmt === "pdf" && !pdfUrl) return falha("O Omie não devolveu o DANFE desta nota — abra o XML ou consulte na SEFAZ pela chave", 404);
  return redirecionar(caminho);
}

async function redirecionar(caminho: string) {
  const url = await urlArquivo(caminho);
  if (!url) return falha("Arquivo não disponível", 404);
  return NextResponse.redirect(url);
}

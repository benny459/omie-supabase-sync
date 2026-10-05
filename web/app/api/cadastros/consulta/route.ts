// GET /api/cadastros/consulta?cnpj=…  → dados públicos da Receita (BrasilAPI) para pré-preencher
// GET /api/cadastros/consulta?cep=…   → endereço do CEP (ViaCEP)
// Só leitura de bases públicas; nada é gravado aqui — a pessoa confere e salva.
import { NextResponse } from "next/server";
import { exigirCadastros } from "@/lib/cadastros-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type BrasilApiCnpj = {
  razao_social?: string; nome_fantasia?: string; cep?: string; logradouro?: string; descricao_tipo_de_logradouro?: string;
  numero?: string; complemento?: string; bairro?: string; municipio?: string; uf?: string; codigo_municipio_ibge?: number;
  ddd_telefone_1?: string; email?: string | null; opcao_pelo_simples?: boolean | null; descricao_situacao_cadastral?: string;
};

export async function GET(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  const sp = new URL(req.url).searchParams;
  const cnpj = (sp.get("cnpj") ?? "").replace(/\D/g, "");
  const cep = (sp.get("cep") ?? "").replace(/\D/g, "");
  try {
    if (cnpj) {
      if (cnpj.length !== 14) return NextResponse.json({ error: "CNPJ precisa de 14 dígitos" }, { status: 400 });
      const r = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`, { cache: "no-store", signal: AbortSignal.timeout(8000) });
      if (r.status === 404) return NextResponse.json({ error: "CNPJ não encontrado na Receita" }, { status: 404 });
      if (!r.ok) return NextResponse.json({ error: "Consulta à Receita indisponível agora — preencha à mão" }, { status: 502 });
      const d = (await r.json()) as BrasilApiCnpj;
      const tel = (d.ddd_telefone_1 ?? "").replace(/\D/g, "");
      return NextResponse.json({
        razao: d.razao_social ?? "", fantasia: d.nome_fantasia ?? "", cep: d.cep ?? "",
        logradouro: [d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(" "), numero: d.numero ?? "",
        complemento: d.complemento ?? "", bairro: d.bairro ?? "", cidade: d.municipio ?? "", uf: d.uf ?? "",
        ibge: d.codigo_municipio_ibge ? String(d.codigo_municipio_ibge) : "",
        telefone: tel ? `${tel.slice(0, 2)} ${tel.slice(2)}` : "", email: (d.email ?? "").toLowerCase(),
        simples: d.opcao_pelo_simples ?? null, situacao: d.descricao_situacao_cadastral ?? "",
      });
    }
    if (cep) {
      if (cep.length !== 8) return NextResponse.json({ error: "CEP precisa de 8 dígitos" }, { status: 400 });
      const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, { cache: "no-store", signal: AbortSignal.timeout(6000) });
      const d = (await r.json().catch(() => ({}))) as { logradouro?: string; bairro?: string; localidade?: string; uf?: string; ibge?: string; erro?: boolean };
      if (!r.ok || d.erro) return NextResponse.json({ error: "CEP não encontrado" }, { status: 404 });
      return NextResponse.json({ logradouro: d.logradouro ?? "", bairro: d.bairro ?? "", cidade: d.localidade ?? "", uf: d.uf ?? "", ibge: d.ibge ?? "" });
    }
    return NextResponse.json({ error: "Informe cnpj ou cep" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Consulta indisponível agora — preencha à mão" }, { status: 502 });
  }
}

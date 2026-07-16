// /projetos/[codigo]/materiais — Lista de Materiais (RC) do projeto em cheio.
// Acessada pelo botão "Materiais" no bucket do /projetos.
// SSR resolve empresa + nome_projeto pra o header; corpo é o RcProjetoItensBlock.

import Link from "next/link";
import { supaServer } from "@/lib/supabase-server";
import MateriaisProjetoView from "@/components/MateriaisProjetoView";

export const dynamic = "force-dynamic";

type Params = { codigo: string };
type SearchParams = { empresa?: string };

export default async function ProjetoMateriaisPage({
  params, searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<SearchParams>;
}) {
  const { codigo } = await params;
  const { empresa: empresaParam } = await searchParams;
  const codigoProjeto = Number(codigo);
  if (!Number.isFinite(codigoProjeto) || codigoProjeto <= 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <p className="text-rose-700">Código de projeto inválido.</p>
        <Link href="/projetos" className="text-sky-700 underline text-sm">← Voltar para Projetos</Link>
      </div>
    );
  }

  // Descobre empresa (query param OU inferido da tabela) + nome_projeto
  const supa = await supaServer();
  let empresa = empresaParam ? String(empresaParam) : "";
  let projetoNome = "";

  // Se empresa não veio na URL, tenta encontrar por codigo_projeto
  if (!empresa) {
    const { data: any1 } = await supa
      .schema("approval" as never)
      .from("v_pc_projetos")
      .select("empresa, projeto_nome")
      .eq("codigo_projeto", codigoProjeto)
      .limit(1)
      .maybeSingle();
    if (any1) {
      empresa = String((any1 as { empresa?: string }).empresa ?? "SF");
      projetoNome = String((any1 as { projeto_nome?: string }).projeto_nome ?? "");
    }
  } else {
    const { data: proj } = await supa
      .schema("approval" as never)
      .from("v_pc_projetos")
      .select("projeto_nome")
      .eq("empresa", empresa)
      .eq("codigo_projeto", codigoProjeto)
      .limit(1)
      .maybeSingle();
    if (proj) projetoNome = String((proj as { projeto_nome?: string }).projeto_nome ?? "");
  }

  if (!empresa) empresa = "SF"; // fallback pra padrão da instância

  return (
    <div className="w-full px-4 py-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[12px] text-ww-textMuted">
            <Link href="/projetos" className="hover:text-ww-text hover:underline">Projetos</Link>
            <span>·</span>
            <span className="font-mono text-[11px]">{empresa}</span>
            <span>·</span>
            <span className="font-mono text-[11px]">PJ{codigoProjeto}</span>
          </div>
          <h1 className="text-[22px] font-bold text-ww-text tracking-[-0.4px] mt-1 truncate">
            🧱 Lista de Materiais
            {projetoNome && <span className="ml-2 text-ww-textMuted font-normal">— {projetoNome}</span>}
          </h1>
          <p className="text-[12px] text-ww-textMuted mt-0.5">
            Itens agrupados em abas por equipamento; PC vinculado herda status (previsão, logística, recebimento).
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/projetos"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12px] font-semibold border border-ww-border bg-ww-panel hover:bg-ww-rowHover text-ww-text transition">
            ← Voltar
          </Link>
        </div>
      </div>

      <MateriaisProjetoView empresa={empresa} codigoProjeto={codigoProjeto} />
    </div>
  );
}

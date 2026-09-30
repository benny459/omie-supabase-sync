// Importação automática do plano de fechamento a partir do CRM.
//
// ── O pedido ────────────────────────────────────────────────────────────────
// O CRM publica o CP/MC de cada proposta ganha no Storage, sempre no mesmo
// caminho, a cada "Salvar fechamento". Até aqui alguém tinha de baixar e subir
// esse arquivo no botão "Importar planilha da proposta". Agora o painel vê a
// versão nova e importa sozinho; o botão continua para quem quiser subir outra.
//
// ── Quando importa ──────────────────────────────────────────────────────────
//   • projeto sem plano                          → importa;
//   • projeto com plano, versão já vista         → nada;
//   • projeto com plano, 1ª vez que o vemos      → só anota a versão (baseline):
//     esse plano foi posto por alguém, e o arquivo do CRM pode ser mais velho
//     que ele — atropelá-lo seria apagar trabalho;
//   • projeto com plano, o CRM publicou versão nova depois do baseline → importa.
// "Versão" é o ETag do Storage: muda a cada upload, igual a cada download.
//
// Reimportar preserva as datas ajustadas das parcelas (plano_importar guarda
// dt_ajustada/num_titulo/observacao), como no botão.

import { supaAdmin } from "@/lib/supabase-admin";
import { lerPlanoFechamento } from "@/lib/plano-fechamento";
import { importarPlano } from "@/lib/plano-importar";
import { fetchPropostasLigadas } from "@/lib/crm-fechamento";

export type ResultadoAuto = {
  empresa: string; codigo_projeto: number; proposta?: string;
  acao: "importado" | "baseline" | "sem_mudanca" | "sem_arquivo" | "sem_proposta" | "erro";
  detalhe?: string;
};

const QUEM = "CRM (automático)";

type Candidata = { numero: string; valor: number; cpmcUrl: string };

async function versao(url: string) {
  const r = await fetch(url, { method: "HEAD", cache: "no-store" });
  if (!r.ok) return null;
  const lm = r.headers.get("last-modified");
  return { etag: r.headers.get("etag") ?? lm ?? "", lastModified: lm ? new Date(lm).toISOString() : null };
}

/** Sincroniza UM projeto. `candidatas` são as propostas do CRM ligadas a ele;
 *  com mais de uma, manda a de maior valor (a mesma regra do budget). */
export async function sincronizarPlano(
  empresa: string, codigo: number, candidatas: Candidata[],
): Promise<ResultadoAuto> {
  const base = { empresa, codigo_projeto: codigo };
  if (!candidatas.length) return { ...base, acao: "sem_proposta" };
  const prop = [...candidatas].sort((a, b) => b.valor - a.valor)[0];

  const v = await versao(prop.cpmcUrl);
  if (!v) return { ...base, proposta: prop.numero, acao: "sem_arquivo" };

  const db = supaAdmin().schema("approval");
  const [{ data: estado }, { data: plano }] = await Promise.all([
    db.from("plano_auto_crm").select("proposta, etag, resultado")
      .eq("empresa", empresa).eq("codigo_projeto", codigo).maybeSingle(),
    db.from("projeto_plano").select("importado_por")
      .eq("empresa", empresa).eq("codigo_projeto", codigo).maybeSingle(),
  ]);
  const est = estado as { proposta: string; etag: string | null; resultado: string | null } | null;
  // Versão que deu erro tenta de novo na próxima volta: o erro pode ter sido
  // nosso (foi o caso da função de etapas em 30/09) e não do arquivo.
  const falhou = !!est?.resultado?.startsWith("erro");
  if (est && !falhou && est.proposta === prop.numero && est.etag === v.etag) {
    return { ...base, proposta: prop.numero, acao: "sem_mudanca" };
  }

  const anotar = (resultado: string, importado: boolean) =>
    db.from("plano_auto_crm").upsert({
      empresa, codigo_projeto: codigo, proposta: prop.numero,
      etag: v.etag, last_modified: v.lastModified, visto_em: new Date().toISOString(),
      ...(importado ? { importado_em: new Date().toISOString() } : {}),
      resultado,
    }, { onConflict: "empresa,codigo_projeto" });

  // Plano existente, posto por gente, e nunca visto por aqui: só baseline.
  const importadoPorGente = plano && (plano as { importado_por: string | null }).importado_por !== QUEM;
  if (plano && importadoPorGente && !est) {
    await anotar("baseline", false);
    return { ...base, proposta: prop.numero, acao: "baseline",
      detalhe: "já tinha plano importado à mão — reimporta quando o CRM publicar versão nova" };
  }

  try {
    const r = await fetch(prop.cpmcUrl, { cache: "no-store" });
    if (!r.ok) throw new Error(`download ${r.status}`);
    const lido = lerPlanoFechamento(await r.arrayBuffer());
    if (!lido.parcelas.length && !lido.saidas.length) {
      throw new Error(`planilha sem parcela nem saída (${lido.avisos.join("; ")})`);
    }
    const { error } = await importarPlano(empresa, codigo, {
      ...lido,
      importado_de: `CRM ${prop.numero} · cpmc.xlsx${v.lastModified ? ` · ${v.lastModified.slice(0, 16).replace("T", " ")}` : ""}`,
    } as never, QUEM);
    if (error) throw new Error(error.message);
    await anotar("importado", true);
    return { ...base, proposta: prop.numero, acao: "importado",
      detalhe: `${lido.parcelas.length} parcela(s), ${lido.saidas.length} saída(s)` };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Anota o erro para a tela/diagnóstico; a próxima volta tenta de novo.
    await anotar(`erro: ${msg}`.slice(0, 500), false);
    return { ...base, proposta: prop.numero, acao: "erro", detalhe: msg };
  }
}

/** Varre todos os projetos ligados no CRM. Empresa vem de finance.projetos. */
export async function sincronizarTodos(): Promise<ResultadoAuto[]> {
  const props = await fetchPropostasLigadas();
  const porCodigo = new Map<number, Candidata[]>();
  for (const p of props) porCodigo.set(p.codigo, [...(porCodigo.get(p.codigo) ?? []), p]);
  if (!porCodigo.size) return [];

  const { data: projs } = await supaAdmin().schema("finance").from("projetos")
    .select("empresa, codigo").in("codigo", [...porCodigo.keys()]);
  const empresaDe = new Map<number, string>();
  for (const r of (projs ?? []) as Array<{ empresa: string; codigo: number }>) {
    if (!empresaDe.has(Number(r.codigo))) empresaDe.set(Number(r.codigo), r.empresa);
  }

  const out: ResultadoAuto[] = [];
  for (const [codigo, cands] of porCodigo) {
    out.push(await sincronizarPlano(empresaDe.get(codigo) ?? "SF", codigo, cands));
  }
  return out;
}

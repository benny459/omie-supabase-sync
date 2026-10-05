import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Contratos recorrentes (sql/68, 05/10/2026) — aba da tela /faturamento.
   GET  → painel (KPIs, contratos, competências devidas) ou ?id= → detalhe.
   POST → ações:
     faturar        {id, competencia}        cria a OS nativa da competência
     faturar_lote   {itens:[{id,competencia}]}
     desfazer       {comp_id, motivo}        cancela a OS gerada (se aberta)
     salvar         {contrato}               novo/editar (numeração CT)
     status         {id, status, motivo}     ativo / suspenso / encerrado
     reajustar      {id, desde, valor, indice, obs}
     importar       {}                       relê o espelho do Omie (só leitura do espelho; admin)
   A OS criada segue pela carteira: recibo (Emitir) ou NFS-e da prefeitura
   (Registrar NFS-e). Nada é escrito no Omie. */

const db = () => supaAdmin().schema("orders");

export async function GET(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const id = Number(req.nextUrl.searchParams.get("id"));
  if (Number.isFinite(id) && id > 0) {
    const { data, error } = await db().rpc("contrato_detalhe", { p_id: id });
    if (error) return falha(error.message, 500);
    if (!data) return falha("Contrato não encontrado", 404);
    return NextResponse.json(data);
  }
  const empresa = req.nextUrl.searchParams.get("empresa") || "SF";
  const { data, error } = await db().rpc("contratos_painel", { p_empresa: empresa });
  if (error) return falha(error.message, 500);
  return NextResponse.json(data);
}

type Corpo = {
  acao?: string; id?: number; competencia?: string; comp_id?: number; motivo?: string; status?: string;
  itens?: { id: number; competencia: string }[]; contrato?: Record<string, unknown>;
  desde?: string; valor?: number; indice?: string; obs?: string;
};
const dataOk = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as Corpo;
  try {
    switch (b.acao) {
      case "faturar": {
        if (!b.id || !dataOk(b.competencia)) return falha("Informe contrato e competência");
        const { data, error } = await db().rpc("contrato_faturar", { p_id: b.id, p_competencia: b.competencia, p_por: q.email });
        if (error) return falha(error.message);
        await db().rpc("vendas_refrescar").then(() => null, () => null);
        return NextResponse.json({ ok: true, documento: data });
      }
      case "faturar_lote": {
        const lista = (b.itens ?? []).filter((x) => x && x.id && dataOk(x.competencia)).slice(0, 100);
        if (!lista.length) return falha("Nada selecionado");
        const feitos: unknown[] = [];
        const erros: { id: number; competencia: string; erro: string }[] = [];
        for (const x of lista) {
          const { data, error } = await db().rpc("contrato_faturar", { p_id: x.id, p_competencia: x.competencia, p_por: q.email });
          if (error) erros.push({ id: x.id, competencia: x.competencia, erro: error.message });
          else feitos.push(data);
        }
        await db().rpc("vendas_refrescar").then(() => null, () => null);
        return NextResponse.json({ ok: true, feitos, erros });
      }
      case "desfazer": {
        if (!b.comp_id) return falha("Competência inválida");
        const { data, error } = await db().rpc("contrato_desfazer", { p_comp_id: b.comp_id, p_motivo: b.motivo ?? "", p_por: q.email });
        if (error) return falha(error.message);
        await db().rpc("vendas_refrescar").then(() => null, () => null);
        return NextResponse.json(data);
      }
      case "salvar": {
        const { data, error } = await db().rpc("contrato_salvar", { p: b.contrato ?? {}, p_por: q.email });
        if (error) return falha(error.message);
        return NextResponse.json(data);
      }
      case "status": {
        if (!b.id || !b.status) return falha("Informe contrato e status");
        const { data, error } = await db().rpc("contrato_status", { p_id: b.id, p_status: b.status, p_motivo: b.motivo ?? "", p_por: q.email });
        if (error) return falha(error.message);
        return NextResponse.json(data);
      }
      case "reajustar": {
        if (!b.id || !dataOk(b.desde) || !(Number(b.valor) > 0)) return falha("Informe a data e o novo valor");
        const { data, error } = await db().rpc("contrato_reajustar", {
          p_id: b.id, p_vigente_desde: b.desde, p_valor_novo: Number(b.valor), p_indice: b.indice ?? "", p_obs: b.obs ?? "", p_por: q.email,
        });
        if (error) return falha(error.message);
        return NextResponse.json(data);
      }
      case "importar": {
        if (!q.admin) return falha("Só administradores relêem os contratos do Omie", 403);
        const { data, error } = await db().rpc("contratos_importar_omie", { p_por: q.email });
        if (error) return falha(error.message);
        return NextResponse.json(data);
      }
      default:
        return falha("ação inválida");
    }
  } catch (e) {
    return falha(e);
  }
}

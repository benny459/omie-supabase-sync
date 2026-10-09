import { NextResponse, type NextRequest } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { brl, diffContrato, itensNormalizados, textoMudanca, validarItensContrato, type ItemCtr } from "@/lib/faturamento/contrato-valor";
import { detalhe, osAbertas, reaplicarNaOs, registrar, type DetalheContrato } from "@/lib/faturamento/contrato-server";
import { cancelarRecibo } from "@/lib/faturamento/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/* Contratos recorrentes (sql/68, 05/10/2026) — aba da tela /faturamento.
   GET  → painel (KPIs, contratos, competências devidas) ou ?id= → detalhe.
   POST → ações:
     faturar        {id, competencia}        cria a OS nativa da competência
     faturar_lote   {itens:[{id,competencia}]}
     desfazer       {comp_id, motivo}        cancela a OS gerada (se aberta)
     salvar         {contrato, aplicar_os}   novo/editar (numeração CT); aplicar_os → OS abertas recebem os itens novos
     atualizar_os   {id, comp_id}            OS aberta da competência recebe o valor/itens atuais do contrato
     corrigir_recibo {id, comp_id, motivo}   cancela o RECIBO emitido da competência e atualiza a OS (09/10/26);
                                             o recibo novo é emitido depois pelo botão "Emitir recibo"
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
  desde?: string; valor?: number; indice?: string; obs?: string; aplicar_os?: boolean;
};

/** Valor do contrato precisa ser maior que zero para faturar (09/10/26 — OS4893 saiu com R$ 0,00). */
async function travaValorZero(id: number) {
  const d = await detalhe(id);
  if (!d) return "Contrato não encontrado";
  const v = Number(d.contrato.valor_periodo ?? 0);
  if (!(Math.round(v * 100) > 0)) {
    return `O contrato ${String(d.contrato.numero ?? "")} está com valor R$ 0,00 — a OS e o recibo sairiam sem preço. Abra o contrato, clique em Editar, informe o valor do serviço (ex.: 2.720,64) e grave; depois fature.`;
  }
  return null;
}

/** Recibos/OS desta competência que saíram zerados (para a tela avisar e oferecer a correção). */
const zerados = (d: DetalheContrato) => d.historico_faturas
  .filter((h) => h.origem === "painel" && h.venda_id && ["gerado", "faturado"].includes(h.status) && !(Math.round(Number(h.valor) * 100) > 0))
  .map((h) => ({ comp_id: h.id, competencia: h.competencia, documento: h.documento, recibo: h.emissao?.status === "autorizada" ? h.emissao.numero : null }));
const dataOk = (s: unknown) => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);

export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  const b = (await req.json().catch(() => ({}))) as Corpo;
  try {
    switch (b.acao) {
      case "faturar": {
        if (!b.id || !dataOk(b.competencia)) return falha("Informe contrato e competência");
        const zero = await travaValorZero(b.id);
        if (zero) return falha(zero);
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
        const zeroDe = new Map<number, string | null>();
        for (const x of lista) {
          if (!zeroDe.has(x.id)) zeroDe.set(x.id, await travaValorZero(x.id));
          const z = zeroDe.get(x.id);
          if (z) { erros.push({ id: x.id, competencia: x.competencia, erro: z }); continue; }
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
        const c = (b.contrato ?? {}) as Record<string, unknown> & { id?: number | null; itens?: ItemCtr[] };
        const inval = validarItensContrato(c.itens);
        if (inval) return falha(inval);
        const id0 = Number(c.id) || null;
        const antes = id0 ? await detalhe(id0) : null;
        const { data, error } = await db().rpc("contrato_salvar", { p: { ...c, itens: itensNormalizados(c.itens ?? []) }, p_por: q.email });
        if (error) return falha(error.message);
        const r = data as { id: number; numero: string; valor: number };
        const depois = await detalhe(Number(r.id));
        let mudancas: string[] = [];
        let registro = true;
        let itensMudaram = !antes;
        if (antes && depois) {
          const m = diffContrato(antes, depois);
          itensMudaram = m.some((x) => x.campo === "itens");
          mudancas = m.map(textoMudanca);
          if (m.length) registro = await registrar(r.id, q.email, "alteracao", { mudancas: m, texto: mudancas.join(" · ") }).catch(() => false);
        }
        const os_atualizadas: { documento: string; de: number; para: number }[] = [];
        const os_erros: string[] = [];
        if (b.aplicar_os && depois) {
          for (const h of osAbertas(depois).filter((x) => itensMudaram || Math.abs(Number(x.valor) - Number(r.valor)) > 0.005)) {
            try { os_atualizadas.push(await reaplicarNaOs(depois, h, q.email)); } catch (e) { os_erros.push(e instanceof Error ? e.message : String(e)); }
          }
        }
        const fresco = os_atualizadas.length ? await detalhe(Number(r.id)) : depois;
        return NextResponse.json({ ...r, mudancas, registro, os_atualizadas, os_erros,
          os_abertas: fresco ? osAbertas(fresco).filter((h) => Math.abs(Number(h.valor) - Number(r.valor)) > 0.005).map((h) => ({ comp_id: h.id, documento: h.documento, valor: Number(h.valor) })) : [],
          zerados: fresco ? zerados(fresco) : [] });
      }
      case "atualizar_os": {
        if (!b.id || !b.comp_id) return falha("Informe o contrato e a competência");
        const d = await detalhe(b.id);
        if (!d) return falha("Contrato não encontrado", 404);
        const h = d.historico_faturas.find((x) => x.id === b.comp_id);
        if (!h || !h.venda_id) return falha("Esta competência não tem OS gerada pelo painel — use Faturar.");
        if (!(Math.round(Number(d.contrato.valor_periodo ?? 0) * 100) > 0)) return falha("O contrato está com valor R$ 0,00 — clique em Editar, informe o valor e grave antes de atualizar a OS.");
        const os = await reaplicarNaOs(d, h, q.email);
        return NextResponse.json({ ok: true, ...os });
      }
      case "corrigir_recibo": {
        if (!b.id || !b.comp_id) return falha("Informe o contrato e a competência");
        const motivo = String(b.motivo ?? "").trim();
        if (motivo.length < 10) return falha("Escreva o motivo (pelo menos 10 letras) — ex.: “recibo saiu com valor zerado; reemitido com o valor do contrato”.");
        const d = await detalhe(b.id);
        if (!d) return falha("Contrato não encontrado", 404);
        const valor = Number(d.contrato.valor_periodo ?? 0);
        if (!(Math.round(valor * 100) > 0)) return falha("O contrato está com valor R$ 0,00 — clique em Editar, informe o valor certo e grave; depois volte aqui para corrigir o recibo.");
        const h = d.historico_faturas.find((x) => x.id === b.comp_id);
        if (!h || !h.venda_id) return falha("Esta competência não tem OS gerada pelo painel.");
        if (h.nfse) return falha(`A ${h.documento} tem a NFS-e nº ${h.nfse.numero} registrada: cancele a nota no portal da prefeitura e depois em Faturamento › NFS-e registradas › Cancelar; aí atualize a OS.`);
        let recibo: string | null = null;
        if (h.emissao?.status === "autorizada") {
          if (h.emissao.tipo !== "recibo") return falha(`A ${h.documento} foi faturada com ${h.emissao.tipo.toUpperCase()} — só recibos são cancelados pelo painel.`);
          const e = await cancelarRecibo(h.emissao.id, motivo, q.email);
          recibo = e.numero;
          await registrar(b.id, q.email, "recibo_cancelado", { documento: h.documento, competencia: h.competencia, recibo: e.numero, valor: Number(e.valor_total), motivo,
            texto: `recibo nº ${e.numero} (${brl(Number(e.valor_total))}) da ${h.documento} cancelado para reemissão` }).catch(() => false);
        }
        const fresco = (await detalhe(b.id))!;
        const h2 = fresco.historico_faturas.find((x) => x.id === b.comp_id)!;
        try {
          const os = await reaplicarNaOs(fresco, h2, q.email);
          return NextResponse.json({ ok: true, recibo_cancelado: recibo, ...os });
        } catch (e) {
          if (!recibo) throw e;
          return falha(`O recibo nº ${recibo} foi cancelado, mas a ${h.documento} não foi atualizada (${e instanceof Error ? e.message : String(e)}). Clique em “Atualizar OS com o valor do contrato” no contrato e depois em Emitir recibo.`);
        }
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

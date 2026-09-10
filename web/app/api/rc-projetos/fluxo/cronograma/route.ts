// PUT /api/rc-projetos/fluxo/cronograma
//
// Grava a data de emissão da nota (e, se preciso, uma previsão manual) de uma
// linha do fluxo previsto.
//
// ── Por que grava a EMISSÃO e não a previsão ────────────────────────────────
// Quem controla o cronograma sabe quando a nota sai; a previsão de recebimento
// é consequência do prazo comercial que o PV já tem. Pedir as duas datas seria
// pedir para redigitar o prazo — e a cópia divergiria do Omie no primeiro
// ajuste. A previsão manual existe só para o prazo que o sistema não consegue
// ler (11% das formas de pagamento) e para parcelamento irregular.
//
// ── O envio ao Omie é um segundo passo ──────────────────────────────────────
// `enviar_omie: true` só faz sentido para linha que JÁ É TÍTULO — o Omie não
// tem o que atualizar num PV que ainda não foi faturado. Reaproveita
// finance.previsao_override e a rota de sync que o fluxo de caixa já usa, em
// vez de abrir um segundo caminho para o mesmo ERP.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canEdit } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  empresa?: string;
  codigo_projeto?: number;
  fonte?: string;
  referencia?: string;
  dt_emissao_prevista?: string | null;
  dt_previsao_manual?: string | null;
  prazo_dias_aplicado?: number | null;
  observacao?: string | null;
  /** Grava também em finance.previsao_override, para o envio ao Omie. */
  enviar_omie?: boolean;
  /** Obrigatório quando enviar_omie: é o título que o Omie conhece. */
  cod_titulo?: number | null;
};

const FONTES = new Set(["titulo_receber", "pv_a_faturar", "pedido_compra"]);
const ehData = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

export async function PUT(req: Request) {
  const supa = await supaServer("approval");
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canEdit(perms, "projetos", "pvos")) {
    return NextResponse.json({ error: "Sem permissão para mexer no cronograma" }, { status: 403 });
  }

  const b = (await req.json().catch(() => null)) as Body | null;
  if (!b?.empresa || !Number.isFinite(Number(b.codigo_projeto)) || !b.fonte || !b.referencia) {
    return NextResponse.json(
      { error: "empresa, codigo_projeto, fonte e referencia obrigatórios" }, { status: 400 });
  }
  if (!FONTES.has(String(b.fonte))) {
    return NextResponse.json({ error: `fonte inválida: ${b.fonte}` }, { status: 400 });
  }
  for (const [nome, v] of [["dt_emissao_prevista", b.dt_emissao_prevista],
                           ["dt_previsao_manual", b.dt_previsao_manual]] as const) {
    if (v != null && v !== "" && !ehData(v)) {
      return NextResponse.json({ error: `${nome} inválida` }, { status: 400 });
    }
  }

  const admin = supaAdmin();
  const empresa = String(b.empresa);
  const codigo = Number(b.codigo_projeto);
  const quem = user.email ?? user.id;

  const linha = {
    empresa, codigo_projeto: codigo,
    fonte: String(b.fonte), referencia: String(b.referencia),
    dt_emissao_prevista: b.dt_emissao_prevista || null,
    dt_previsao_manual: b.dt_previsao_manual || null,
    prazo_dias_aplicado: Number.isFinite(Number(b.prazo_dias_aplicado))
      ? Number(b.prazo_dias_aplicado) : null,
    observacao: b.observacao ? String(b.observacao).slice(0, 500) : null,
    atualizado_por: quem,
    atualizado_em: new Date().toISOString(),
  };

  // Linha inteiramente vazia = "desfaz o ajuste". Guardar uma linha só com
  // nulos faria a data efetiva continuar sendo a do Omie, mas deixaria um
  // registro que sugere que alguém mexeu — e ninguém mexeu.
  const vazia = !linha.dt_emissao_prevista && !linha.dt_previsao_manual;
  if (vazia) {
    const { error } = await admin.schema("approval").from("projeto_fluxo_cronograma")
      .delete().eq("empresa", empresa).eq("codigo_projeto", codigo)
      .eq("fonte", linha.fonte).eq("referencia", linha.referencia);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  } else {
    const { error } = await admin.schema("approval").from("projeto_fluxo_cronograma")
      .upsert(linha, { onConflict: "empresa,codigo_projeto,fonte,referencia" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // ── Empurra para o Omie, quando pedido e quando faz sentido ───────────────
  let omie: { ok: boolean; motivo?: string } | null = null;
  if (b.enviar_omie) {
    if (linha.fonte !== "titulo_receber" || !b.cod_titulo) {
      omie = { ok: false, motivo: "Só título já emitido pode ir pro Omie — um PV ainda não faturado não tem previsão lá para atualizar." };
    } else {
      // Precisa da data EFETIVA, que é o que o Omie deve passar a mostrar.
      const { data: prev, error: pErr } = await admin.schema("bi")
        .rpc("projeto_fluxo_previsto", { p_codigo_projeto: codigo, p_empresa: empresa });
      const alvo = ((prev ?? []) as Array<{ fonte: string; referencia: string; data_efetiva: string | null }>)
        .find((r) => r.fonte === linha.fonte && r.referencia === linha.referencia);
      if (pErr || !alvo?.data_efetiva) {
        omie = { ok: false, motivo: pErr?.message ?? "não consegui calcular a data efetiva desta linha" };
      } else {
        // A tabela só tem cod_titulo / dt_previsao_nova / observacao — quem
        // alterou vai no texto da observação, que é onde ela cabe hoje.
        const { error: oErr } = await admin.schema("finance").from("previsao_override")
          .upsert({
            cod_titulo: Number(b.cod_titulo),
            dt_previsao_nova: alvo.data_efetiva,
            observacao: `cronograma do projeto ${codigo} · ${quem}`,
            atualizado_em: new Date().toISOString(),
          }, { onConflict: "cod_titulo" });
        omie = oErr ? { ok: false, motivo: oErr.message } : { ok: true };
      }
    }
  }

  return NextResponse.json({ ok: true, removido: vazia, omie });
}

// GET /api/simples?competencia=2026-09
//
// Projeção do DAS do mês. A graça é que a alíquota já está travada no dia 1º —
// depende só do RBT12 e do fator r, ambos de meses fechados. O que se move
// durante o mês é a base, e é ela que vem do Omie em tempo real.
//
// RBT12 e fator r saem de finance.simples_historico (o que o PGDAS declarou),
// não do faturamento reconstruído: em alguns meses o contador declarou valores
// diferentes do que o Omie mostra, e para o RBT12 quem manda é a declaração.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";
import { apurar, custoPorMil, calcularFatorR, folgaAteProximaFaixa, aliquotaEfetiva,
         CORTE_FATOR_R, type Atividade } from "@/lib/simples";

export const runtime = "nodejs";
export const maxDuration = 60;

type LinhaHist = { competencia: string; receita_bruta: number; folha: number | null };
type LinhaFat = {
  competencia: string; mercantil: number; qtd_nfe: number;
  servico_anexo_iii: number; servico_anexo_v: number; qtd_os_nota: number;
  servico_recibo: number; qtd_os_recibo: number;
  ultima_nfe: string | null; ultima_os: string | null;
};

const mesISO = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
const somaMeses = (iso: string, n: number) => {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCMonth(d.getUTCMonth() + n);
  return mesISO(d);
};

export async function GET(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro")) {
    return NextResponse.json({ error: "Sem acesso ao Simples Nacional" }, { status: 403 });
  }

  const url = new URL(req.url);
  const pedido = url.searchParams.get("competencia"); // "2026-09"
  const hoje = new Date();
  const competencia = /^\d{4}-\d{2}$/.test(pedido ?? "")
    ? `${pedido}-01`
    : mesISO(new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), 1)));

  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "finance" } },
  );

  /* Janela ampla: 13 meses para trás cobre o RBT12 e ainda dá a série de
     conferência da tela. */
  const inicioJanela = somaMeses(competencia, -13);
  const fimJanela = somaMeses(competencia, 1);

  const [hist, fat, docs, anexoIii] = await Promise.all([
    adm.from("simples_historico").select("competencia, receita_bruta, folha")
       .gte("competencia", inicioJanela).lt("competencia", fimJanela).order("competencia"),
    adm.rpc("simples_faturamento", { p_de: inicioJanela, p_ate: fimJanela }),
    adm.rpc("simples_documentos", { p_de: competencia, p_ate: somaMeses(competencia, 1) }),
    adm.from("simples_anexo_iii").select("codigo_cliente, observacao"),
  ]);

  const erro = hist.error ?? fat.error ?? docs.error ?? anexoIii.error;
  if (erro) return NextResponse.json({ error: erro.message }, { status: 500 });

  const historico = (hist.data ?? []) as LinhaHist[];
  const faturamento = (fat.data ?? []) as LinhaFat[];
  const num = (v: unknown) => Number(v ?? 0);

  /* RBT12 e folha: os 12 meses ANTERIORES à competência. */
  const doze = historico.filter((h) => h.competencia < competencia).slice(-12);
  const rbt12 = doze.reduce((s, h) => s + num(h.receita_bruta), 0);

  const comFolha = doze.filter((h) => h.folha !== null && h.folha !== undefined);
  const mesesSemFolha = doze.length - comFolha.length;
  const folhaConhecida = comFolha.reduce((s, h) => s + num(h.folha), 0);
  /* Falta a folha de algum mês? Completa pela média dos conhecidos e avisa na
     tela. Na prática não muda o anexo: seria preciso folha ~2,8x maior. */
  const mediaFolha = comFolha.length ? folhaConhecida / comFolha.length : 0;
  const folha12 = folhaConhecida + mesesSemFolha * mediaFolha;
  const fatorR = doze.length ? calcularFatorR(folha12, rbt12) : null;

  const doMes = faturamento.find((f) => f.competencia === competencia);
  const mercantil = num(doMes?.mercantil);
  const servicoIii = num(doMes?.servico_anexo_iii);
  const servicoV = num(doMes?.servico_anexo_v);
  const recibo = num(doMes?.servico_recibo);

  /* Onde os serviços sujeitos ao fator r caem hoje. Abaixo de 28% é Anexo V. */
  const anexoServico = fatorR !== null && fatorR >= CORTE_FATOR_R ? "III" : "V";
  const atividades: Atividade[] = [
    { anexo: "I", base: mercantil, rotulo: "Revenda de mercadorias" },
    { anexo: anexoServico, base: servicoV, rotulo: `Serviços sujeitos ao fator r (Anexo ${anexoServico})` },
    { anexo: "III", base: servicoIii, rotulo: "Serviços do Anexo III" },
  ];
  const realizado = apurar(rbt12, atividades, fatorR);

  /* Cenários de fechamento: só o mercantil se move de verdade — as OS de
     serviço são as recorrentes e já entraram no dia 1º. */
  const ultimos6 = faturamento.filter((f) => f.competencia < competencia).slice(-6);
  const mediaMercantil = ultimos6.length
    ? ultimos6.reduce((s, f) => s + num(f.mercantil), 0) / ultimos6.length
    : mercantil;
  const mesAnterior = faturamento.find((f) => f.competencia === somaMeses(competencia, -1));

  const cenario = (rotulo: string, merc: number) => {
    const a = apurar(rbt12, [
      { anexo: "I", base: merc, rotulo: "Revenda de mercadorias" },
      { anexo: anexoServico, base: servicoV, rotulo: "Serviços fator r" },
      { anexo: "III", base: servicoIii, rotulo: "Serviços Anexo III" },
    ], fatorR);
    return { rotulo, mercantil: merc, receita: a.receitaDoMes, das: a.das, efetiva: a.efetivaMedia };
  };

  /* Conferência: o que a reconstrução do Omie dá contra o que foi declarado.
     Onde diverge, quem decidiu diferente foi o contador — a tela mostra para
     que a diferença não passe despercebida. */
  const conferencia = faturamento
    .filter((f) => f.competencia < competencia)
    .map((f) => {
      const calc = num(f.mercantil) + num(f.servico_anexo_iii) + num(f.servico_anexo_v);
      const dec = historico.find((h) => h.competencia === f.competencia)?.receita_bruta;
      return {
        competencia: f.competencia,
        calculado: calc,
        declarado: dec === undefined || dec === null ? null : num(dec),
        diferenca: dec === undefined || dec === null ? null : calc - num(dec),
        recibo: num(f.servico_recibo),
      };
    });

  return NextResponse.json({
    competencia,
    rbt12,
    faixa: realizado.faixa,
    folha12,
    fatorR,
    mesesSemFolha,
    anexoServico,
    efetivas: { I: aliquotaEfetiva("I", rbt12), III: aliquotaEfetiva("III", rbt12), V: aliquotaEfetiva("V", rbt12) },
    custoPorMil: custoPorMil(rbt12),
    folgaFaixa: folgaAteProximaFaixa(rbt12),
    bases: { mercantil, servicoIii, servicoV, recibo },
    contagens: {
      nfe: num(doMes?.qtd_nfe), osNota: num(doMes?.qtd_os_nota), osRecibo: num(doMes?.qtd_os_recibo),
    },
    sincronizado: { nfe: doMes?.ultima_nfe ?? null, os: doMes?.ultima_os ?? null },
    realizado,
    cenarios: [
      cenario("Parar hoje", mercantil),
      cenario("Mercantil na média de 6 meses", mediaMercantil),
      cenario("Repetir o mês anterior", num(mesAnterior?.mercantil)),
    ],
    conferencia,
    documentos: docs.data ?? [],
    anexoIiiClientes: anexoIii.data ?? [],
  });
}

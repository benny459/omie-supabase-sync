// Simples Nacional — o motor de cálculo.
//
// A conta do Simples é determinística e, o que importa aqui, a alíquota do mês
// já está TRAVADA no dia 1º: ela depende só do RBT12 (12 meses fechados) e do
// fator r (folha de 12 meses fechados). A única coisa que se move durante o mês
// é a base — a receita que vai sendo faturada. É isso que permite projetar.
//
// Conferido contra dois PGDAS reais da Safe Water (07/2026 e 08/2026): as três
// alíquotas efetivas, a repartição por tributo e o teto de ISS batem ao centavo
// (diferença máxima de R$ 0,02 no DAS, arredondamento interno do PGDAS).
//
// LC 123/2006, art. 18 e Anexos I, III e V.

export type Anexo = "I" | "III" | "V";

/** Uma faixa da tabela: teto de RBT12, alíquota nominal e parcela a deduzir. */
type Faixa = { ate: number; nominal: number; deduzir: number };

/** Repartição dos tributos dentro do débito, por faixa (1..6). */
type Reparticao = Partial<Record<Tributo, number>>;

export type Tributo = "IRPJ" | "CSLL" | "COFINS" | "PIS" | "CPP" | "ICMS" | "ISS";

export const TRIBUTOS: Tributo[] = ["IRPJ", "CSLL", "COFINS", "PIS", "CPP", "ICMS", "ISS"];

const FAIXAS: Record<Anexo, Faixa[]> = {
  I: [
    { ate: 180_000, nominal: 0.04, deduzir: 0 },
    { ate: 360_000, nominal: 0.073, deduzir: 5_940 },
    { ate: 720_000, nominal: 0.095, deduzir: 13_860 },
    { ate: 1_800_000, nominal: 0.107, deduzir: 22_500 },
    { ate: 3_600_000, nominal: 0.143, deduzir: 87_300 },
    { ate: 4_800_000, nominal: 0.19, deduzir: 378_000 },
  ],
  III: [
    { ate: 180_000, nominal: 0.06, deduzir: 0 },
    { ate: 360_000, nominal: 0.112, deduzir: 9_360 },
    { ate: 720_000, nominal: 0.135, deduzir: 17_640 },
    { ate: 1_800_000, nominal: 0.16, deduzir: 35_640 },
    { ate: 3_600_000, nominal: 0.21, deduzir: 125_640 },
    { ate: 4_800_000, nominal: 0.33, deduzir: 648_000 },
  ],
  V: [
    { ate: 180_000, nominal: 0.155, deduzir: 0 },
    { ate: 360_000, nominal: 0.18, deduzir: 4_500 },
    { ate: 720_000, nominal: 0.195, deduzir: 9_900 },
    { ate: 1_800_000, nominal: 0.205, deduzir: 17_100 },
    { ate: 3_600_000, nominal: 0.23, deduzir: 62_100 },
    { ate: 4_800_000, nominal: 0.305, deduzir: 540_000 },
  ],
};

/* Percentuais de repartição. A 6ª faixa perde o ICMS (Anexo I) e o ISS
   (III e V) — esses passam a ser recolhidos fora do DAS. */
const REPARTICAO: Record<Anexo, Reparticao[]> = {
  I: [
    { IRPJ: 0.055, CSLL: 0.035, COFINS: 0.1274, PIS: 0.0276, CPP: 0.415, ICMS: 0.34 },
    { IRPJ: 0.055, CSLL: 0.035, COFINS: 0.1274, PIS: 0.0276, CPP: 0.415, ICMS: 0.34 },
    { IRPJ: 0.055, CSLL: 0.035, COFINS: 0.1274, PIS: 0.0276, CPP: 0.42, ICMS: 0.335 },
    { IRPJ: 0.055, CSLL: 0.035, COFINS: 0.1274, PIS: 0.0276, CPP: 0.42, ICMS: 0.335 },
    { IRPJ: 0.055, CSLL: 0.035, COFINS: 0.1274, PIS: 0.0276, CPP: 0.42, ICMS: 0.335 },
    { IRPJ: 0.135, CSLL: 0.10, COFINS: 0.2827, PIS: 0.0613, CPP: 0.421 },
  ],
  III: [
    { IRPJ: 0.04, CSLL: 0.035, COFINS: 0.1282, PIS: 0.0278, CPP: 0.434, ISS: 0.335 },
    { IRPJ: 0.04, CSLL: 0.035, COFINS: 0.1405, PIS: 0.0305, CPP: 0.434, ISS: 0.32 },
    { IRPJ: 0.04, CSLL: 0.035, COFINS: 0.1364, PIS: 0.0296, CPP: 0.434, ISS: 0.325 },
    { IRPJ: 0.04, CSLL: 0.035, COFINS: 0.1364, PIS: 0.0296, CPP: 0.434, ISS: 0.325 },
    { IRPJ: 0.04, CSLL: 0.035, COFINS: 0.1282, PIS: 0.0278, CPP: 0.434, ISS: 0.335 },
    { IRPJ: 0.35, CSLL: 0.15, COFINS: 0.1603, PIS: 0.0347, CPP: 0.305 },
  ],
  V: [
    { IRPJ: 0.25, CSLL: 0.15, COFINS: 0.141, PIS: 0.0305, CPP: 0.2885, ISS: 0.14 },
    { IRPJ: 0.23, CSLL: 0.15, COFINS: 0.141, PIS: 0.0305, CPP: 0.2785, ISS: 0.17 },
    { IRPJ: 0.24, CSLL: 0.15, COFINS: 0.1492, PIS: 0.0323, CPP: 0.2385, ISS: 0.19 },
    { IRPJ: 0.21, CSLL: 0.15, COFINS: 0.1574, PIS: 0.0341, CPP: 0.2385, ISS: 0.21 },
    { IRPJ: 0.23, CSLL: 0.125, COFINS: 0.141, PIS: 0.0305, CPP: 0.2385, ISS: 0.235 },
    { IRPJ: 0.35, CSLL: 0.155, COFINS: 0.1644, PIS: 0.0356, CPP: 0.295 },
  ],
};

/** Acima disto o ISS trava em 5% da base e o excedente vai para os demais. */
const TETO_ISS = 0.05;

const cent = (v: number) => Math.round(v * 100) / 100;

/** Índice 0..5 da faixa em que o RBT12 cai. Acima de 4,8 MM fica na última. */
export function faixaDe(rbt12: number): number {
  const i = FAIXAS.I.findIndex((f) => rbt12 <= f.ate);
  return i === -1 ? 5 : i;
}

/** Alíquota efetiva: (RBT12 × nominal − dedução) ÷ RBT12. */
export function aliquotaEfetiva(anexo: Anexo, rbt12: number): number {
  if (rbt12 <= 0) return FAIXAS[anexo][0].nominal;
  const f = FAIXAS[anexo][faixaDe(rbt12)];
  return (rbt12 * f.nominal - f.deduzir) / rbt12;
}

export type DebitoAtividade = {
  anexo: Anexo;
  base: number;
  efetiva: number;
  debito: number;
  tributos: Partial<Record<Tributo, number>>;
  /** true quando o ISS bateu no teto de 5% e houve redistribuição. */
  issNoTeto: boolean;
};

/** O débito de UMA atividade (uma base, um anexo). */
export function debitoDaAtividade(anexo: Anexo, rbt12: number, base: number): DebitoAtividade {
  const efetiva = aliquotaEfetiva(anexo, rbt12);
  const debito = cent(base * efetiva);
  const rep = REPARTICAO[anexo][faixaDe(rbt12)];

  let tributos: Partial<Record<Tributo, number>> = {};
  for (const [k, pct] of Object.entries(rep)) tributos[k as Tributo] = cent(debito * pct);

  /* Teto do ISS: quando a parcela de ISS passa de 5% da base, ela é cortada em
     5% e a diferença é redistribuída entre os demais tributos, proporcional aos
     percentuais originais. É o que faz o IRPJ do Anexo III sair maior do que a
     repartição pura sugeriria. */
  let issNoTeto = false;
  const teto = cent(base * TETO_ISS);
  if (rep.ISS !== undefined && (tributos.ISS ?? 0) > teto) {
    issNoTeto = true;
    const sobra = debito - teto;
    const outros = Object.entries(rep).filter(([k]) => k !== "ISS");
    const soma = outros.reduce((s, [, v]) => s + v, 0);
    tributos = { ISS: teto };
    for (const [k, v] of outros) tributos[k as Tributo] = cent((sobra * v) / soma);
  }

  return { anexo, base, efetiva, debito, tributos, issNoTeto };
}

export type Atividade = { anexo: Anexo; base: number; rotulo: string };

export type Apuracao = {
  rbt12: number;
  faixa: number;
  fatorR: number | null;
  /** Anexo em que os serviços sujeitos ao fator r caem: V abaixo de 28%, III acima. */
  anexoServico: Anexo;
  receitaDoMes: number;
  atividades: (DebitoAtividade & { rotulo: string })[];
  tributos: Record<Tributo, number>;
  das: number;
  /** Alíquota média sobre a receita do mês — só para leitura. */
  efetivaMedia: number;
};

/** Corte do fator r: a partir daqui os serviços migram do Anexo V para o III. */
export const CORTE_FATOR_R = 0.28;

export function apurar(rbt12: number, atividades: Atividade[], fatorR: number | null): Apuracao {
  const det = atividades
    .filter((a) => a.base > 0)
    .map((a) => ({ ...debitoDaAtividade(a.anexo, rbt12, a.base), rotulo: a.rotulo }));

  const tributos = Object.fromEntries(TRIBUTOS.map((t) => [t, 0])) as Record<Tributo, number>;
  for (const d of det) {
    for (const [k, v] of Object.entries(d.tributos)) tributos[k as Tributo] = cent(tributos[k as Tributo] + (v ?? 0));
  }
  const das = cent(det.reduce((s, d) => s + d.debito, 0));
  const receitaDoMes = cent(det.reduce((s, d) => s + d.base, 0));

  return {
    rbt12,
    faixa: faixaDe(rbt12) + 1,
    fatorR,
    anexoServico: fatorR !== null && fatorR >= CORTE_FATOR_R ? "III" : "V",
    receitaDoMes,
    atividades: det,
    tributos,
    das,
    efetivaMedia: receitaDoMes > 0 ? das / receitaDoMes : 0,
  };
}

/** Quanto de DAS custa cada R$ 1.000 faturados agora, por anexo. */
export function custoPorMil(rbt12: number): Record<Anexo, number> {
  return {
    I: cent(1000 * aliquotaEfetiva("I", rbt12)),
    III: cent(1000 * aliquotaEfetiva("III", rbt12)),
    V: cent(1000 * aliquotaEfetiva("V", rbt12)),
  };
}

/** Fator r = folha dos 12 meses anteriores ÷ RBT12. */
export function calcularFatorR(folha12: number, rbt12: number): number | null {
  if (!rbt12) return null;
  return folha12 / rbt12;
}

/** Quanto ainda cabe no mês antes de o RBT12 empurrar a empresa para a faixa seguinte. */
export function folgaAteProximaFaixa(rbt12: number): number | null {
  const i = faixaDe(rbt12);
  if (i >= 5) return null;
  return cent(FAIXAS.I[i].ate - rbt12);
}

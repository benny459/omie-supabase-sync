// Leitura do código de barras / linha digitável de boletos (06/10/26).
// Aceita espaços, pontos e traços. Bancário: 47 dígitos (linha digitável) ou 44
// (código de barras). Concessionária/tributo: 48 (linha) ou 44 começando com 8.
// Devolve valor e vencimento quando dá para ler (bancário: fator de vencimento,
// já com a virada de 22/02/2025; concessionária: só o valor, quando é "valor efetivo").

export type LeituraBoleto = {
  digitos: string; tipo: "bancario" | "concessionaria"; valido: boolean; aviso?: string;
  valor: number | null; vencimento: string | null;   // YYYY-MM-DD
};

const so = (s: string) => (s ?? "").replace(/\D/g, "");

function mod11Banco(num: string) {
  let soma = 0, peso = 2;
  for (let i = num.length - 1; i >= 0; i--) { soma += Number(num[i]) * peso; peso = peso === 9 ? 2 : peso + 1; }
  const r = 11 - (soma % 11);
  return r === 0 || r === 10 || r === 11 ? 1 : r;
}

function vencDoFator(fator: number): string | null {
  if (!fator) return null;
  const dia = 86_400_000;
  const a = Date.UTC(1997, 9, 7) + fator * dia;             // regra original
  const b = Date.UTC(2025, 1, 22) + (fator - 1000) * dia;   // depois da virada (fator 1000 = 22/02/2025)
  const hoje = Date.now();
  const d = Math.abs(a - hoje) <= Math.abs(b - hoje) ? a : b;
  return new Date(d).toISOString().slice(0, 10);
}

export function lerBoleto(entrada: string): LeituraBoleto | null {
  const d = so(entrada);
  if (![44, 47, 48].includes(d.length)) return null;
  if (d.length === 48 || (d.length === 44 && d[0] === "8")) {
    const barra = d.length === 48 ? [0, 12, 24, 36].map((i) => d.slice(i, i + 11)).join("") : d;
    const efetivo = barra[2] === "6" || barra[2] === "8";
    const v = efetivo ? Number(barra.slice(4, 15)) / 100 : null;
    return { digitos: d, tipo: "concessionaria", valido: barra[0] === "8", valor: v && v > 0 ? v : null, vencimento: null,
      aviso: barra[0] === "8" ? undefined : "concessionária deveria começar com 8" };
  }
  const barra = d.length === 47
    ? d.slice(0, 4) + d.slice(32, 33) + d.slice(33, 47) + d.slice(4, 9) + d.slice(10, 20) + d.slice(21, 31)
    : d;
  const dv = Number(barra[4]);
  const valido = mod11Banco(barra.slice(0, 4) + barra.slice(5)) === dv;
  const fator = Number(barra.slice(5, 9));
  const valor = Number(barra.slice(9, 19)) / 100;
  return { digitos: d, tipo: "bancario", valido, aviso: valido ? undefined : "dígito verificador não confere — confira o código",
    valor: valor > 0 ? valor : null, vencimento: vencDoFator(fator) };
}

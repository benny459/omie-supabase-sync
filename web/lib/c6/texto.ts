// Regras de texto do arquivo de pagamentos do C6 (06/10/26). Puro: usado no
// gerador do arquivo (servidor) e na prévia do modal (cliente).
//  · textos livres (favorecido, descrição): sem acento/cedilha e só A–Z a–z 0–9,
//    espaço e . , - / — o C6 recusa o resto;
//  · chave Pix telefone: "+55 11 98772-6252" (celular 5-4, fixo 4-4). E-mail,
//    CPF/CNPJ e chave aleatória ficam como estão.

export function limparTextoC6(s: string | null | undefined, max = 140): string {
  return String(s ?? "")
    .replace(/[çÇ]/g, (c) => (c === "ç" ? "c" : "C"))
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9 .,/-]/g, " ")
    .replace(/\s+/g, " ").trim().slice(0, max);
}

export function cpfValido(d: string): boolean {
  if (!/^\d{11}$/.test(d) || /^(\d)\1{10}$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11; return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

const EVP = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Formato de telefone que o C6 pede. null se não der para ler como telefone. */
export function telefoneC6(digitos: string): string | null {
  let d = digitos.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  const ddd = d.slice(0, 2), n = d.slice(2);
  if (/^0/.test(ddd)) return null;
  return n.length === 9 ? `+55 ${ddd} ${n.slice(0, 5)}-${n.slice(5)}` : `+55 ${ddd} ${n.slice(0, 4)}-${n.slice(4)}`;
}

/** Normaliza a chave Pix para o arquivo do C6. `tipo` = pix_tipo do cadastro, se houver
 *  (telefone|celular|phone|cpf|cnpj|email|aleatoria|evp). */
export function chavePixC6(chave: string | null | undefined, tipo?: string | null): string {
  const c = String(chave ?? "").trim();
  if (!c) return "";
  const t = String(tipo ?? "").toLowerCase();
  if (c.includes("@") || EVP.test(c) || /^(email|e-mail|aleatoria|aleatória|evp)$/.test(t)) return c;
  const d = c.replace(/\D/g, "");
  if (/^(telefone|celular|phone|fone)$/.test(t)) return telefoneC6(d) ?? c;
  if (/^(cpf|cnpj)$/.test(t)) return c;
  if (d.length === 14 && !c.startsWith("+")) return c;                       // CNPJ
  const pareceFone = c.startsWith("+") || /[()]/.test(c) || ((d.length === 12 || d.length === 13) && d.startsWith("55")) || d.length === 10;
  if (d.length === 11 && !c.startsWith("+") && cpfValido(d)) return c;         // CPF ganha quando o DV confere
  if (pareceFone || d.length === 11) return telefoneC6(d) ?? c;
  return c;
}

// Inscrição Estadual do destinatário — regra pura (servidor e tela), 09/10/26.
// Caso que motivou: HECI (27193705000129), PV1865 — a SEFAZ-ES rejeitou 6× "IE do destinatário não
// informada" porque a nota saiu sem IE, mas a NF-e 2212 do mesmo cliente tinha sido autorizada com
// a IE 080048633. O sistema tem de avisar ANTES e já sugerir a IE certa (regra do Benny: "já sugere e
// fala o que quer").

export type IeFonte = {
  ie: string;
  /** nfe = NF-e autorizada pela SEFAZ (a mais forte); cadastro = cadastro do cliente; omie = cadastro antigo do Omie */
  fonte: "nfe" | "cadastro" | "omie";
  /** "da NF-e 2212 autorizada em 09/10" */
  rotulo: string;
};
export type IeCadastro = { id: number; empresa: string; codigo: number | null; ie: string | null };
export type IeInfo = {
  doc: string;
  fontes: IeFonte[];
  sugestao: IeFonte | null;
  /** linhas do cadastro com este CNPJ (todas as empresas) */
  cadastros: IeCadastro[];
};

export const ieDig = (v: string | null | undefined) => String(v ?? "").replace(/\D/g, "");
export const ieIsento = (v: string | null | undefined) => /isent/i.test(String(v ?? ""));
/** IE de contribuinte (numérica). */
export const ieNumerica = (v: string | null | undefined) => !ieIsento(v) && ieDig(v).length >= 2;

export type IeAlerta = {
  nivel: "erro" | "aviso";
  tipo: "falta" | "isento" | "diferente" | "cadastro_vazio";
  /** IE a aplicar no botão (“Usar esta IE” / “Salvar no cadastro”) */
  sugerida: string;
  texto: string;
};

/** Compara a IE que vai na nota com a IE conhecida do cliente. null = nada a avisar. */
export function avaliarIe(ieNota: string | null | undefined, info: IeInfo | null | undefined): IeAlerta | null {
  if (!info) return null;
  const s = info.sugestao;
  const nota = ieNumerica(ieNota) ? ieDig(ieNota) : "";
  if (!nota && s) {
    // NF-e autorizada ou cadastro nosso com IE: a SEFAZ vai rejeitar — bloqueia. Só o espelho do Omie: avisa.
    const nivel = s.fonte === "omie" ? "aviso" : "erro";
    const texto = ieIsento(ieNota)
      ? `A nota está como ISENTO, mas este cliente tem Inscrição Estadual — a SEFAZ vai rejeitar (“IE do destinatário não informada”). Sugerido: ${s.ie} (${s.rotulo}).`
      : `Falta a Inscrição Estadual — a SEFAZ vai rejeitar. Sugerido: ${s.ie} (${s.rotulo}).`;
    return { nivel, tipo: ieIsento(ieNota) ? "isento" : "falta", sugerida: s.ie, texto };
  }
  if (nota && s && ieDig(s.ie) !== nota && s.fonte !== "omie") {
    return { nivel: "aviso", tipo: "diferente", sugerida: s.ie,
      texto: `A IE desta nota (${nota}) é diferente da IE ${s.rotulo} (${s.ie}). Confira — IE errada a SEFAZ rejeita (232/233).` };
  }
  if (nota && info.cadastros.length && info.cadastros.some((c) => !ieNumerica(c.ie))) {
    return { nivel: "aviso", tipo: "cadastro_vazio", sugerida: nota,
      texto: `O cadastro do cliente está sem a IE ${nota} — salve no cadastro para as próximas notas saírem certas.` };
  }
  return null;
}

/** Onde achar a IE quando o sistema não conhece nenhuma (consulta pública por CNPJ). */
export const CONSULTA_IE = {
  sintegra: "http://www.sintegra.gov.br/",
  ccc: "https://dfe-portal.svrs.rs.gov.br/NFE/CCC",
};

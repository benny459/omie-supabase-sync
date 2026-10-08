// Colar do Excel — o MESMO parser para o Ctrl+V da grade e para o "Colar do Excel" do
// modal "Adicionar itens" da lista de materiais (08/10/26, spec D).
//
// • Com cabeçalho (2+ nomes de coluna reconhecidos na 1ª linha): cada coluna vai pelo nome.
// • Sem cabeçalho: pela posição, na ordem que quem chama passar (na lista de materiais:
//   Código · Item · Qtd · Un · Necessário em · Valor unit. — Código pode vir vazio).
// • Datas dd/mm/aaaa (ou dd/mm/aa) viram ISO — antes eram descartadas em silêncio no salvar
//   e a linha ficava com a data do grupo.

export type AlvoColar = { label: string; key: string; tipo?: string };

/** Quebra o texto colado em linhas × células (TAB do Excel; `;` de CSV como reserva). */
export function dividirColagem(texto: string): string[][] {
  return texto
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .filter((l, i, arr) => l.trim() !== "" || i < arr.length - 1)
    .map((l) => (l.includes("\t") ? l.split("\t") : l.split(/;(?=(?:[^"]*"[^"]*")*[^"]*$)/)));
}

/** "30/10/2026", "30/10/26", "2026-10-30" ou número de série do Excel → "2026-10-30"; senão "". */
export function dataParaIso(v: string): string {
  const t = String(v ?? "").trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(t);
  if (m) {
    const a = m[3].length === 2 ? `20${m[3]}` : m[3];
    const d = new Date(Date.UTC(Number(a), Number(m[2]) - 1, Number(m[1])));
    if (d.getUTCDate() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1) return "";
    return d.toISOString().slice(0, 10);
  }
  // número de série do Excel (dias desde 1899-12-30), quando a célula de data vem crua
  // (planilha importada: pode vir com a fração da hora, ex. 46345.9994 — arredonda para o dia)
  if (/^\d{5}(\.\d+)?$/.test(t)) {
    const d = new Date(Date.UTC(1899, 11, 30) + Math.round(Number(t)) * 86400000);
    return d.toISOString().slice(0, 10);
  }
  return "";
}

const nrm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Lê o bloco colado. `alvosNome` = colunas reconhecíveis pelo cabeçalho; `posicionais` =
 *  ordem sem cabeçalho; `inicio` = posição da 1ª coluna colada dentro de `posicionais`. */
export function lerColagem(texto: string, alvosNome: AlvoColar[], posicionais: AlvoColar[], inicio = 0):
  { comCabecalho: boolean; linhas: Record<string, string>[] } {
  const grade = dividirColagem(texto);
  if (!grade.length) return { comCabecalho: false, linhas: [] };
  const porNome = grade[0].map((c) => alvosNome.find((e) => nrm(e.label) === nrm(c) || nrm(e.key) === nrm(c)));
  const comCabecalho = porNome.filter(Boolean).length >= 2;
  const corpo = comCabecalho ? grade.slice(1) : grade;
  const linhas = corpo.map((cells) => {
    const o: Record<string, string> = {};
    cells.forEach((valor, dc) => {
      const col = comCabecalho ? porNome[dc] : posicionais[inicio + dc];
      if (!col) return; // passou da última coluna: descarta em vez de embaralhar
      const v = valor.trim().replace(/^"|"$/g, "");
      o[col.key] = col.tipo === "data" ? (dataParaIso(v) || "") : v;
    });
    return o;
  });
  return { comCabecalho, linhas };
}

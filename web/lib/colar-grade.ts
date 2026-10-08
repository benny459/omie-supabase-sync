// Colar do Excel — o MESMO parser para o Ctrl+V da grade e para o "Colar do Excel" do
// modal "Adicionar itens" da lista de materiais (08/10/26, spec D).
//
// • Com cabeçalho (2+ nomes de coluna reconhecidos na 1ª linha): cada coluna vai pelo nome.
// • Sem cabeçalho: pela posição, na ordem que quem chama passar (na lista de materiais:
//   Código · Item · Qtd · Un · Necessário em · Valor unit. · Grupo — Código pode vir vazio;
//   é a ordem do bloco B:H "PARA_COLAR" do modelo Excel).
// • Datas dd/mm/aaaa (ou dd/mm/aa) viram ISO — antes eram descartadas em silêncio no salvar
//   e a linha ficava com a data do grupo.
// • Modelo Excel novo (lib/modelo-lista, 08/10/26): linhas de título/instrução antes do
//   cabeçalho são puladas; a coluna "Item (digite e escolha)" traz "CÓDIGO · descrição" (ou
//   texto livre, ou só o código) e vira Código + Item; linhas do modelo sem item nem qtd saem.

export type AlvoColar = { label: string; key: string; tipo?: string };

/** Colunas da lista de materiais reconhecidas pelo cabeçalho (modal "Adicionar itens" / importar). */
export const ALVOS_LISTA: AlvoColar[] = [
  { label: "Código", key: "cat_codigo" }, { label: "Cod", key: "cat_codigo" }, { label: "Item", key: "item" }, { label: "Descrição", key: "item" },
  { label: "Qtd", key: "qtd" }, { label: "Quantidade", key: "qtd" }, { label: "Un", key: "un" }, { label: "Unidade", key: "un" },
  { label: "Necessário em", key: "data_necessaria", tipo: "data" }, { label: "Data", key: "data_necessaria", tipo: "data" },
  { label: "Valor unit.", key: "cat_valor_unit" }, { label: "Valor unit. (se diferente)", key: "cat_valor_unit" }, { label: "Valor", key: "cat_valor_unit" }, { label: "Valor unitário", key: "cat_valor_unit" },
  { label: "Grupo", key: "equipamento" }, { label: "Equipamento", key: "equipamento" },
];
/** Ordem sem cabeçalho na lista de materiais. */
export const POSICIONAIS_LISTA: AlvoColar[] = [
  { label: "Código", key: "cat_codigo" }, { label: "Item", key: "item" }, { label: "Qtd", key: "qtd" }, { label: "Un", key: "un" },
  { label: "Necessário em", key: "data_necessaria", tipo: "data" }, { label: "Valor unit.", key: "cat_valor_unit" },
  { label: "Grupo", key: "equipamento" },
];
/** Na grade, o Grupo (equipamento) fica à esquerda e fora do colar por posição — entra como
 *  7ª posição, depois de Valor unit., para o bloco B:H do modelo colar direto. */
export const POSICIONAIS_EXTRAS_GRADE: AlvoColar[] = [{ label: "Grupo", key: "equipamento" }];

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

/** Cabeçalho da coluna de escolha do modelo ("Item (digite e escolha)"). */
const ehEscolha = (c: string) => /^item digite/.test(nrm(c));
/** Código do nosso estoque (ME0063, SV0035…) — família 2-3 letras + número. */
const RE_CODIGO = /^[A-Z]{2,3}\d{3,}$/i;

/** "ME0063 · ROTAMETRO…" → { codigo: "ME0063", descricao: "ROTAMETRO…" }; "ME0063" → só o
 *  código; texto livre → só a descrição. */
export function separarEscolha(v: string): { codigo: string; descricao: string } {
  const t = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!t) return { codigo: "", descricao: "" };
  const m = /^([A-Z]{2,3}\d{3,})\s*[·•]\s*(.*)$/i.exec(t);
  if (m) return { codigo: m[1].toUpperCase(), descricao: m[2].trim() };
  if (RE_CODIGO.test(t)) return { codigo: t.toUpperCase(), descricao: "" };
  return { codigo: "", descricao: t };
}

/** Lê o bloco colado. `alvosNome` = colunas reconhecíveis pelo cabeçalho; `posicionais` =
 *  ordem sem cabeçalho; `inicio` = posição da 1ª coluna colada dentro de `posicionais`. */
export function lerColagem(texto: string, alvosNome: AlvoColar[], posicionais: AlvoColar[], inicio = 0):
  { comCabecalho: boolean; linhas: Record<string, string>[] } {
  let grade = dividirColagem(texto);
  if (!grade.length) return { comCabecalho: false, linhas: [] };
  const casa = (c: string) => alvosNome.find((e) => nrm(e.label) === nrm(c) || nrm(e.key) === nrm(c))
    ?? (ehEscolha(c) ? { label: c, key: "_escolha" } : undefined);
  const ehCab = (cells: string[]) => cells.map(casa).filter(Boolean).length >= 2;
  // título/instrução/faixa "copie estas colunas" do modelo antes do cabeçalho: linhas com no
  // máximo 2 células preenchidas, cabeçalho até a 6ª linha
  if (!ehCab(grade[0])) {
    const k = grade.findIndex((cells, j) => j > 0 && j <= 5 && ehCab(cells));
    if (k > 0 && grade.slice(0, k).every((cells) => cells.filter((c) => c.trim()).length <= 2)) grade = grade.slice(k);
  }
  const porNome = grade[0].map(casa);
  const comCabecalho = porNome.filter(Boolean).length >= 2;
  const modelo = comCabecalho && porNome.some((c) => c?.key === "_escolha");
  const corpo = comCabecalho ? grade.slice(1) : grade;
  const linhas = corpo.map((cells) => {
    const o: Record<string, string> = {};
    cells.forEach((valor, dc) => {
      const col = comCabecalho ? porNome[dc] : posicionais[inicio + dc];
      if (!col) return; // passou da última coluna: descarta em vez de embaralhar
      const v = valor.trim().replace(/^"|"$/g, "");
      if (o[col.key] && !v) return; // duas colunas para o mesmo campo: a vazia não apaga a cheia
      o[col.key] = col.tipo === "data" ? (dataParaIso(v) || "") : v;
    });
    if (modelo) {
      const e = separarEscolha(o._escolha ?? "");
      delete o._escolha;
      if (!String(o.cat_codigo ?? "").trim() && e.codigo) o.cat_codigo = e.codigo;
      // a coluna Descrição (fórmula) manda; sem o resultado gravado, vale o texto escolhido
      if (!String(o.item ?? "").trim()) o.item = e.descricao || "";
    }
    return o;
  });
  // modelo: as ~300 linhas preparadas que ficaram em branco (sem item e sem qtd) não contam
  return { comCabecalho, linhas: modelo ? linhas.filter((o) => String(o.item ?? "").trim() || String(o.cat_codigo ?? "").trim() || String(o.qtd ?? "").trim()) : linhas };
}

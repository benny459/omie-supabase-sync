/** Texto que vai para o casamento com o catálogo e para o de-para (08/10/26, spec C.7).
 *  UM lugar só: a tela (sugestão, aceitar, seletor) e o "importar RC" da rota de compras
 *  usavam textos diferentes ("item modelo" × "item · modelo") e o mesmo item ora casava
 *  sozinho pelo de-para, ora não. */
export const textoCasar = (item: string | null | undefined, modelo?: string | null) =>
  [item, modelo].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");

/** Nota mínima para um casamento "conferir" virar SUGESTÃO na linha (07/10/26). */
export const SUG_MIN = 0.6;

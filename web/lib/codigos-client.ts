"use client";
/* Histórico de códigos no Compras (02/10/26): resolve qualquer código já usado
   (Omie, mesclado, recodificado) → item de hoje, pelo resolvedor do Estoque
   (POST /api/estoque/resolver, sql/47). Junta os pedidos do mesmo "tick" num
   POST só e guarda em cache por sessão. Nunca reescreve PC/NF: só mostra. */

export type CodigoHojeInfo = { codigo_usado: string; origem: string; n_cod_prod_atual: number; codigo_atual: string | null;
  codigo_omie_atual: string | null; codigo_novo_atual: string | null; descricao_atual: string | null; mudou_de_item: boolean };

const cache = new Map<string, Promise<CodigoHojeInfo | null>>();
let fila: { cod: string; ok: (v: CodigoHojeInfo | null) => void }[] = [];
let agendado = false;

async function despachar() {
  agendado = false;
  const lote = fila; fila = [];
  const codes = [...new Set(lote.map((x) => x.cod))];
  let res: Record<string, CodigoHojeInfo[]> = {};
  try {
    const r = await fetch("/api/estoque/resolver", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ codes }) });
    if (r.ok) res = ((await r.json()) as { resolvido?: Record<string, CodigoHojeInfo[]> }).resolvido ?? {};
  } catch { /* sem resolvedor: só não mostra o selo */ }
  for (const x of lote) {
    const l = res[x.cod] ?? [];
    // código de fornecedor não identifica o nosso item sozinho
    x.ok(l.find((i) => i.origem !== "fornecedor") ?? null);
  }
}

export function resolverCodigo(cod: string | null | undefined): Promise<CodigoHojeInfo | null> {
  const c = String(cod ?? "").trim();
  if (!c) return Promise.resolve(null);
  const k = c.toUpperCase();
  let p = cache.get(k);
  if (!p) {
    p = new Promise((ok) => { fila.push({ cod: c, ok }); if (!agendado) { agendado = true; setTimeout(despachar, 30); } });
    cache.set(k, p);
  }
  return p;
}

/** Mostrar o selo só quando o item de hoje tem outro código (ou é outro item). */
export const codigoMudou = (cod: string | null | undefined, i: CodigoHojeInfo | null) =>
  !!i && !!cod && (i.mudou_de_item || String(i.codigo_atual ?? "").toUpperCase() !== String(cod).trim().toUpperCase());

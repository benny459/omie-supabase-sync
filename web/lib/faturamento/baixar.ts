"use client";
/* Download de recibos em PDF direto do navegador (05/10/26): um arquivo por
   recibo, com o nome do recibo, sem tela de visualização. Se o navegador
   barrar vários downloads seguidos, os mesmos arquivos saem num .zip. */

export type Baixado = { nome: string; blob: Blob };

/** URL do PDF a partir do link da 2ª via em HTML (/api/faturamento/arquivo?p=…). */
export function pdfDoLink(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, location.origin);
    const p = u.searchParams.get("p");
    return p && /\/recibo\//.test(p) ? `/api/faturamento/recibo-pdf?p=${encodeURIComponent(p)}` : null;
  } catch { return null; }
}

function nomeDoCabecalho(cd: string | null, reserva: string) {
  if (!cd) return reserva;
  const utf = cd.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
  if (utf) { try { return decodeURIComponent(utf); } catch { /* segue */ } }
  return cd.match(/filename="([^"]+)"/i)?.[1] ?? reserva;
}

function salvar({ nome, blob }: Baixado) {
  const href = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href, download: nome, style: "display:none" });
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 60_000);
}

/** Baixa cada URL como um arquivo, um de cada vez (com pausa entre eles). */
export async function baixarPdfs(urls: string[], aoAvancar?: (feitos: number, total: number) => void): Promise<{ ok: Baixado[]; falhas: string[] }> {
  const ok: Baixado[] = []; const falhas: string[] = [];
  for (let i = 0; i < urls.length; i++) {
    try {
      const r = await fetch(urls[i], { cache: "no-store" });
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("pdf")) {
        const j = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const item = { nome: nomeDoCabecalho(r.headers.get("content-disposition"), `recibo-${i + 1}.pdf`), blob: await r.blob() };
      ok.push(item); salvar(item);
    } catch (e) { falhas.push((e as Error).message); }
    aoAvancar?.(i + 1, urls.length);
    if (i < urls.length - 1) await new Promise((res) => window.setTimeout(res, 450));
  }
  return { ok, falhas };
}

/** Os mesmos arquivos num .zip (quando o navegador barra vários downloads). */
export async function baixarZip(itens: Baixado[], nome = "recibos.zip") {
  const JSZip = (await import("jszip")).default;
  const z = new JSZip();
  const usados = new Set<string>();
  for (const it of itens) {
    let n = it.nome, k = 2;
    while (usados.has(n)) n = it.nome.replace(/\.pdf$/i, ` (${k++}).pdf`);
    usados.add(n); z.file(n, it.blob);
  }
  salvar({ nome, blob: await z.generateAsync({ type: "blob" }) });
}

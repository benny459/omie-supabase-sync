// Abre um documento HTML guardado (recibo, 2ª via) como página: o Storage
// serve .html como text/plain, então lemos aqui e devolvemos text/html em UTF-8,
// com uma barra "Imprimir / salvar PDF" que some na impressão.
// Vários ?p=…&p=… (recibos em lote, 05/10/26): todos numa página só, um por folha.
import { NextResponse } from "next/server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { caminhoValido as valido, documentoGuardado as documento } from "@/lib/faturamento/recibo-doc";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  const ps = new URL(req.url).searchParams.getAll("p").slice(0, 60);
  if (!ps.length || !ps.every(valido)) return NextResponse.json({ error: "arquivo inválido" }, { status: 400 });
  const docs = await Promise.all(ps.map(documento));
  if (docs.some((d) => d == null)) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  let html = docs[0]!;
  if (docs.length > 1) {
    // Junta os corpos na página do primeiro: cada recibo numa folha.
    const corpo = (h: string) => h.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? h;
    html = html.replace(/<body([^>]*)>[\s\S]*<\/body>/i, (_m, a) => `<body${a}>${docs.map((d) => corpo(d!)).join("\n")}</body>`)
      .replace(/<\/head>/i, "<style>.folha{break-after:page}.folha:last-of-type{break-after:auto}@media screen{.folha{margin-bottom:8mm;box-shadow:0 0 0 1px #ddd}}</style></head>");
  }
  const n = docs.length > 1 ? `<span style="color:#cbd5e1;margin-right:auto">${docs.length} documentos</span>` : "";
  const barra = `<div class="__barra" style="position:sticky;top:0;z-index:9;display:flex;gap:8px;align-items:center;justify-content:flex-end;padding:8px 12px;background:#0f172a;font:13px system-ui,sans-serif">${n}<button onclick="window.print()" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer">Imprimir / salvar PDF</button><button onclick="window.close()" style="background:#334155;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer">Fechar</button></div><style>@media print{.__barra{display:none!important}}</style>`;
  html = /<body[^>]*>/i.test(html) ? html.replace(/<body([^>]*)>/i, `<body$1>${barra}`) : barra + html;
  if (!/<meta[^>]+charset/i.test(html)) html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}

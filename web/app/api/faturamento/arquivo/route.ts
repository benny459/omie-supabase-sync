// Abre um documento HTML guardado (recibo, 2ª via) como página: o Storage
// serve .html como text/plain, então lemos aqui e devolvemos text/html em UTF-8,
// com uma barra "Imprimir / salvar PDF" que some na impressão.
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const BUCKET = "fat-documentos";

export async function GET(req: Request) {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso" }, { status: 403 });
  const p = new URL(req.url).searchParams.get("p") ?? "";
  if (!p || p.includes("..") || !/\.html?$/i.test(p)) return NextResponse.json({ error: "arquivo inválido" }, { status: 400 });
  const { data, error } = await supaAdmin().storage.from(BUCKET).download(p);
  if (error || !data) return NextResponse.json({ error: "Documento não encontrado" }, { status: 404 });
  let html = new TextDecoder("utf-8").decode(await data.arrayBuffer());
  const barra = `<div class="__barra" style="position:sticky;top:0;z-index:9;display:flex;gap:8px;justify-content:flex-end;padding:8px 12px;background:#0f172a;font:13px system-ui,sans-serif"><button onclick="window.print()" style="background:#2563eb;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer">Imprimir / salvar PDF</button><button onclick="window.close()" style="background:#334155;color:#fff;border:0;border-radius:8px;padding:6px 14px;cursor:pointer">Fechar</button></div><style>@media print{.__barra{display:none!important}}</style>`;
  html = /<body[^>]*>/i.test(html) ? html.replace(/<body([^>]*)>/i, `<body$1>${barra}`) : barra + html;
  if (!/<meta[^>]+charset/i.test(html)) html = html.replace(/<head>/i, '<head><meta charset="utf-8">');
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store" } });
}

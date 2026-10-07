// /api/vendas/anexos — OC do cliente e anexos de um PV/OS, para as telas (07/10/26, sql/110).
//   GET  ?empresa=SF&label=PV1968                       → OcDoc (nº da OC, origem, anexos com URL)
//   POST { acao:"resumo", empresa, labels:[…] }          → { rows:[{label, num_pedido_cliente, anexos, anexos_oc}] }
//   POST { acao:"oc", empresa, label, num_pedido_cliente } → OcDoc  (Omie: guardado no painel, o Omie não é tocado)
//   POST { acao:"upload_url", empresa, label, nome }     → { path, token } (upload direto ao bucket)
//   POST { acao:"incluir", empresa, label, nome, url? | arquivo_path?, tipo, tamanho?, mime? } → OcDoc
//   POST { acao:"remover", empresa, label, id }          → OcDoc
// Ler: qualquer sessão. Gravar: áreas Operação, Vendas ou ERP.
import { NextResponse } from "next/server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { partirLabel } from "@/lib/vendas-anexos";
import { MigracaoPendente, anexoIncluir, anexoRemover, ocDefinir, ocDoc, ocResumo, urlDeUpload } from "@/lib/vendas-anexos-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const falha = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: msg, pendente: e instanceof MigracaoPendente || undefined }, { status: e instanceof MigracaoPendente ? 409 : 400 });
};

async function quem() {
  const perms = await loadPerms();
  if (!perms) return null;
  const supa = await supaServer("platform");
  const { data: { user } } = await supa.auth.getUser();
  const { data: prof } = await supaAdmin().schema("platform").from("user_profiles").select("nome").eq("id", perms.id ?? "").maybeSingle();
  const pode = canViewArea(perms, "erp") || canViewArea(perms, "operacao") || canViewArea(perms, "vendas");
  return { nome: (prof as { nome?: string } | null)?.nome || user?.email || "painel", pode };
}

export async function GET(req: Request) {
  if (!(await loadPerms())) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const empresa = (sp.get("empresa") ?? "SF").toUpperCase();
  const pl = partirLabel(sp.get("label") ?? "");
  if (!pl) return NextResponse.json({ error: "label deve ser PV<nº> ou OS<nº>" }, { status: 400 });
  try { return NextResponse.json(await ocDoc(empresa, pl.tipo, pl.numero)); } catch (e) { return falha(e); }
}

export async function POST(req: Request) {
  const q = await quem();
  if (!q) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const acao = String(b?.acao ?? "");
  const empresa = String(b?.empresa ?? "SF").toUpperCase();
  try {
    if (acao === "resumo") {
      const labels = Array.isArray(b?.labels) ? (b!.labels as unknown[]).map(String) : [];
      return NextResponse.json(await ocResumo(empresa, labels));
    }
    if (!q.pode) return NextResponse.json({ error: "Sem acesso para alterar o PV/OS" }, { status: 403 });
    const pl = partirLabel(String(b?.label ?? ""));
    if (!pl) return NextResponse.json({ error: "label deve ser PV<nº> ou OS<nº>" }, { status: 400 });
    const { tipo, numero } = pl;
    if (acao === "oc") {
      const oc = b?.num_pedido_cliente == null ? null : String(b.num_pedido_cliente).trim().slice(0, 60) || null;
      await ocDefinir(empresa, tipo, numero, oc, q.nome);
    } else if (acao === "upload_url") {
      return NextResponse.json(await urlDeUpload(empresa, tipo, numero, String(b?.nome ?? "arquivo")));
    } else if (acao === "incluir") {
      const url = b?.url ? String(b.url).trim() : null;
      const path = b?.arquivo_path ? String(b.arquivo_path) : null;
      if (path && !path.startsWith(`${empresa}/${tipo}${numero}/`)) return NextResponse.json({ error: "caminho de arquivo inválido" }, { status: 400 });
      if (url && !/^https?:\/\//i.test(url)) return NextResponse.json({ error: "o link deve começar com http:// ou https://" }, { status: 400 });
      await anexoIncluir(empresa, tipo, numero, {
        nome: b?.nome ? String(b.nome).slice(0, 300) : null, url, arquivo_path: path,
        tipo: b?.tipo === "oc_cliente" ? "oc_cliente" : "outro",
        tamanho: Number(b?.tamanho) || null, mime: b?.mime ? String(b.mime) : null,
      }, "painel", q.nome);
    } else if (acao === "remover") {
      const id = Number(b?.id);
      if (!id) return NextResponse.json({ error: "id do anexo obrigatório" }, { status: 400 });
      await anexoRemover(id, q.nome);
    } else {
      return NextResponse.json({ error: `acao desconhecida: ${acao}` }, { status: 400 });
    }
    return NextResponse.json(await ocDoc(empresa, tipo, numero));
  } catch (e) { return falha(e); }
}

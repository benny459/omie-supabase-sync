// Foto de UM item do Estoque.
// GET  ?n=<n_cod_prod> → foto atual (URL assinada), candidatos guardados pela busca automática, termo sugerido, se a busca está pronta.
// POST { n, acao: "buscar", termo }       → busca no provedor (conta na cota do dia) e devolve candidatos (guarda os 5 melhores)
// POST { n, acao: "usar", url, origem }   → baixa a imagem (web = candidato, url = link colado) e guarda no bucket "produtos"
// POST { n, acao: "remover" }             → tira a foto (apaga do bucket)
// POST multipart { n, arquivo }           → envio de arquivo (JPG/PNG/WEBP/GIF até 5 MB)
// Qualquer usuário do ERP pode trocar a foto; tudo fica registrado com o e-mail.

import { NextResponse } from "next/server";
import { orders, platform, quemEstoque } from "@/lib/estoque-server";
import { BUCKET, ErroProvedor, baixarImagem, buscarImagens, configProvedor, guardarFoto, melhores, urlsAssinadas } from "@/lib/estoque-fotos";
import { termoBusca } from "@/lib/estoque";
import { supaAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

async function item(n: number) {
  const r = await orders().from("v_estoque_item").select("empresa, n_cod_prod, descricao").eq("n_cod_prod", n).limit(1).maybeSingle();
  if (r.error) throw new Error(r.error.message);
  if (!r.data) throw new Error("Item não encontrado");
  return r.data as { empresa: string; n_cod_prod: number; descricao: string };
}

async function estado(empresa: string, n: number, descricao: string) {
  const [f, b] = await Promise.all([
    platform().from("estoque_foto").select("*").eq("empresa", empresa).eq("n_cod_prod", n).maybeSingle(),
    platform().from("estoque_foto_busca").select("*").eq("empresa", empresa).eq("n_cod_prod", n).maybeSingle(),
  ]);
  if (f.error || b.error) throw new Error((f.error ?? b.error)!.message);
  const url = f.data ? (await urlsAssinadas([f.data.path])).get(f.data.path) ?? null : null;
  const cfg = configProvedor();
  return {
    foto: f.data ? { url, origem: f.data.origem, source_url: f.data.source_url, provider: f.data.provider, created_at: f.data.created_at, created_by_email: f.data.created_by_email } : null,
    busca: b.data ? { status: b.data.status, termo: b.data.termo, candidatos: b.data.candidatos ?? [], ultimo_erro: b.data.ultimo_erro, buscado_em: b.data.buscado_em } : null,
    termo: termoBusca({ descricao }),
    provedor: { pronto: cfg.pronto, nome: cfg.provedor, faltando: cfg.faltando },
  };
}

export async function GET(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  const n = Number(new URL(req.url).searchParams.get("n"));
  try { const it = await item(n); return NextResponse.json(await estado(it.empresa, it.n_cod_prod, it.descricao)); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

export async function POST(req: Request) {
  const q = await quemEstoque();
  if (q instanceof NextResponse) return q;
  try {
    if ((req.headers.get("content-type") ?? "").includes("multipart/form-data")) {
      const fd = await req.formData();
      const it = await item(Number(fd.get("n")));
      const arq = fd.get("arquivo");
      if (!(arq instanceof File)) return NextResponse.json({ error: "Escolha um arquivo de imagem" }, { status: 400 });
      if (arq.size > 5 * 1024 * 1024) return NextResponse.json({ error: "Imagem maior que 5 MB" }, { status: 400 });
      const bytes = new Uint8Array(await arq.arrayBuffer());
      const mime = ["image/jpeg", "image/png", "image/webp", "image/gif"].includes(arq.type) ? arq.type : "";
      if (!mime) return NextResponse.json({ error: "Use JPG, PNG, WEBP ou GIF" }, { status: 400 });
      await guardarFoto(it.empresa, it.n_cod_prod, { bytes, mime }, { origem: "upload", email: q.email });
      return NextResponse.json({ ok: true, ...(await estado(it.empresa, it.n_cod_prod, it.descricao)) });
    }
    const b = (await req.json().catch(() => ({}))) as { n?: number; acao?: string; termo?: string; url?: string; origem?: string };
    const it = await item(Number(b.n));
    if (b.acao === "buscar") {
      const cfg = configProvedor();
      if (!cfg.pronto) return NextResponse.json({ error: `Busca automática aguardando chave (falta ${cfg.faltando.join(", ")})` }, { status: 409 });
      const termo = String(b.termo ?? "").trim() || termoBusca(it);
      const res = await orders().rpc("estoque_foto_reservar", { p_qtd: 1, p_manual: true });
      if (res.error) throw new Error(res.error.message);
      if (!res.data) return NextResponse.json({ error: "Cota de buscas de hoje atingida — tente amanhã, cole um link ou envie um arquivo" }, { status: 429 });
      try {
        const cands = melhores(await buscarImagens(termo));
        // guarda os candidatos; o item sai da fila do job (já foi buscado à mão)
        const tem = await platform().from("estoque_foto").select("path").eq("empresa", it.empresa).eq("n_cod_prod", it.n_cod_prod).maybeSingle();
        await platform().from("estoque_foto_busca").upsert({ empresa: it.empresa, n_cod_prod: it.n_cod_prod, termo, provider: cfg.provedor,
          candidatos: cands.slice(0, 5), status: tem.data ? "ok" : "sem_resultado", buscado_em: new Date().toISOString() });
        return NextResponse.json({ candidatos: cands.slice(0, 9), termo });
      } catch (e) {
        const er = e as ErroProvedor;
        return NextResponse.json({ error: er.message }, { status: er instanceof ErroProvedor && er.status === 429 ? 429 : 502 });
      }
    }
    if (b.acao === "usar") {
      const url = String(b.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) return NextResponse.json({ error: "Cole um link http(s) de uma imagem" }, { status: 400 });
      const img = await baixarImagem(url).catch((e) => { throw new Error(`Não consegui baixar a imagem: ${(e as Error).message}`); });
      const cfg = configProvedor();
      await guardarFoto(it.empresa, it.n_cod_prod, img, { origem: b.origem === "web" ? "web" : "url", source_url: url, provider: b.origem === "web" ? cfg.provedor : null, termo: null, email: q.email });
      await platform().from("estoque_foto_busca").update({ status: "ok", ultimo_erro: null }).eq("empresa", it.empresa).eq("n_cod_prod", it.n_cod_prod);
      return NextResponse.json({ ok: true, ...(await estado(it.empresa, it.n_cod_prod, it.descricao)) });
    }
    if (b.acao === "remover") {
      const f = await platform().from("estoque_foto").select("path").eq("empresa", it.empresa).eq("n_cod_prod", it.n_cod_prod).maybeSingle();
      if (f.data?.path) await supaAdmin().storage.from(BUCKET).remove([f.data.path]);
      const d = await platform().from("estoque_foto").delete().eq("empresa", it.empresa).eq("n_cod_prod", it.n_cod_prod);
      if (d.error) throw new Error(d.error.message);
      return NextResponse.json({ ok: true, ...(await estado(it.empresa, it.n_cod_prod, it.descricao)) });
    }
    return NextResponse.json({ error: "Ação inválida" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}

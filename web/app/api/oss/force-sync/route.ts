// POST /api/oss/force-sync — dispara workflow sync_specific_oss.yml
// via ConsultarOS. Usado pelo botão inline "🔄 Sync" no painel /avulsos
// quando user vê discrepância Omie vs painel numa OS específica.

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 30;

const GH_REPO = "benny459/omie-supabase-sync";
const WORKFLOW = "sync_specific_oss.yml";

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { os_numeros?: string[]; empresas?: string };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "invalid json" }, { status: 400 }); }

  const osNumeros = Array.isArray(body.os_numeros)
    ? body.os_numeros.map((n) => String(n).trim()).filter(Boolean)
    : [];
  if (osNumeros.length === 0) {
    return NextResponse.json({ error: "os_numeros vazio" }, { status: 400 });
  }
  if (osNumeros.length > 500) {
    return NextResponse.json({ error: "Máximo 500 OSs por batch" }, { status: 400 });
  }
  const empresas = String(body.empresas ?? "SF,CD,WW").trim() || "SF,CD,WW";

  const token = process.env.GITHUB_TOKEN;
  if (!token) return NextResponse.json({ error: "GITHUB_TOKEN não configurado" }, { status: 500 });

  const dispatchRes = await fetch(
    `https://api.github.com/repos/${GH_REPO}/actions/workflows/${WORKFLOW}/dispatches`,
    {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ref: "main",
        inputs: { os_numeros: osNumeros.join(","), empresas },
      }),
    },
  );

  if (!dispatchRes.ok) {
    const text = await dispatchRes.text().catch(() => "");
    return NextResponse.json(
      { error: `GitHub dispatch ${dispatchRes.status}: ${text.slice(0, 300)}` },
      { status: 500 },
    );
  }

  console.log(`[oss/force-sync] user=${user.email} batch=${osNumeros.length}`);

  return NextResponse.json({
    ok: true,
    count: osNumeros.length,
    run_url: `https://github.com/${GH_REPO}/actions/workflows/${WORKFLOW}`,
    message: `Dispatched — refetch de ${osNumeros.length} OS. Rodando em ~30s no GitHub Actions.`,
  });
}

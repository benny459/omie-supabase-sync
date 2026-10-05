// /api/cadastros/sync — cadastro único de clientes (05/10/26, sql/54_cadastro_unico.sql).
// Servidor-a-servidor para a app de Serviços e o CRM Legado: o cadastro-mestre é
// cadastros.pessoas; as apps ligam-se a ele pelo par (empresa, codigo).
//   op "resolver"  liga linhas locais ao mestre (código Omie → CNPJ/CPF → nome único); criar=true cria o que falta
//   op "salvar"    cria/edita o mestre a partir da app (mescla com o atual) — as apps gravam aqui ANTES do local
//   op "mudancas"  o que mudou no mestre desde X, só dos registos ligados à app
//   op "buscar"    pesquisa no mestre (seletor de cliente), todas as empresas, uma linha por pessoa
//   op "candidatos" "já existe?" enquanto se digita (sql/59) — mesmo CNPJ/CPF ou nome parecido
//   op "vincular"  "usar este": liga a linha da app a um cadastro escolhido
// Duplicado (mesmo documento ou nome muito parecido) volta 409 com os candidatos — a app
// mostra "já existe — usar este" em vez de criar.
// Autenticação: passe HMAC (lib/cadastros-passe). Rota pública no middleware; a guarda é o passe.
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { passeValido } from "@/lib/cadastros-passe";
import { ErroCad, candidatosDoErro } from "@/lib/cadastros-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPS = ["servicos", "crm"];

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supaAdmin().schema("orders").rpc(fn, args);
  if (error) throw new ErroCad(error.message, error.code, error.details ?? undefined);
  return data;
}

export async function POST(req: Request) {
  const corpo = await req.text();
  if (!passeValido(req.headers.get("x-cadastros-passe"), corpo)) {
    return NextResponse.json({ error: "não autorizado" }, { status: 401 });
  }
  let b: Record<string, unknown>;
  try { b = JSON.parse(corpo); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const app = String(b.app ?? "");
  if (!APPS.includes(app)) return NextResponse.json({ error: "app inválida" }, { status: 400 });
  const por = typeof b.por === "string" && b.por ? `${app} · ${b.por}`.slice(0, 120) : app;
  try {
    switch (b.op) {
      case "resolver": {
        const itens = Array.isArray(b.itens) ? b.itens.slice(0, 500) : [];
        return NextResponse.json({ itens: await rpc("cadastros_resolver", { p_app: app, p_itens: itens, p_criar: b.criar === true, p_por: por }) });
      }
      case "salvar": {
        if (!b.dados || typeof b.dados !== "object") return NextResponse.json({ error: "dados obrigatórios" }, { status: 400 });
        const pessoa = await rpc("cadastros_salvar_app", { p: b.dados, p_app: app, p_ref: b.ref ? String(b.ref) : null, p_por: por });
        return NextResponse.json({ pessoa });
      }
      case "mudancas":
        return NextResponse.json(await rpc("cadastros_mudancas", { p_app: app, p_desde: b.desde ?? null, p_lim: 2000 }));
      case "buscar": {
        const q = String(b.q ?? "").trim();
        if (q.length < 2) return NextResponse.json({ itens: [] });
        return NextResponse.json({ itens: await rpc("cadastros_buscar_app", { p_q: q, p_empresa: b.empresa ?? "SF", p_lim: 20 }) });
      }
      case "candidatos": {
        const d = (b.dados && typeof b.dados === "object" ? b.dados : {}) as Record<string, unknown>;
        const p = Object.fromEntries(["razao", "fantasia", "doc", "cidade", "telefone", "email", "empresa"]
          .filter((k) => typeof d[k] === "string" && (d[k] as string).trim()).map((k) => [k, String(d[k]).slice(0, 200)]));
        if (!p.razao && !p.fantasia && !p.doc) return NextResponse.json({ candidatos: [] });
        return NextResponse.json({ candidatos: await rpc("cadastros_candidatos", { p }) });
      }
      case "vincular": {
        if (!b.ref || !b.codigo) return NextResponse.json({ error: "ref e codigo obrigatórios" }, { status: 400 });
        const pessoa = await rpc("cadastros_vincular_app", {
          p_app: app, p_ref: String(b.ref), p_empresa: String(b.empresa ?? "SF"), p_codigo: Number(b.codigo), p_por: por,
        });
        return NextResponse.json({ pessoa });
      }
      default:
        return NextResponse.json({ error: "op inválida" }, { status: 400 });
    }
  } catch (e) {
    // Duplicado → 409 com os candidatos; outro erro de regra (CNPJ inválido…) → 400.
    const candidatos = candidatosDoErro(e);
    if (candidatos) return NextResponse.json({ error: e instanceof Error ? e.message : String(e), duplicado: true, candidatos }, { status: 409 });
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

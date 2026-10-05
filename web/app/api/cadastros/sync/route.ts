// /api/cadastros/sync — cadastro único de clientes (05/10/26, sql/54_cadastro_unico.sql).
// Servidor-a-servidor para a app de Serviços e o CRM Legado: o cadastro-mestre é
// cadastros.pessoas; as apps ligam-se a ele pelo par (empresa, codigo).
//   op "resolver"  liga linhas locais ao mestre (código Omie → CNPJ/CPF → nome único); criar=true cria o que falta
//   op "salvar"    cria/edita o mestre a partir da app (mescla com o atual) — as apps gravam aqui ANTES do local
//   op "mudancas"  o que mudou no mestre desde X, só dos registos ligados à app
//   op "buscar"    pesquisa no mestre (seletor de cliente)
// Autenticação: passe HMAC (lib/cadastros-passe). Rota pública no middleware; a guarda é o passe.
import { NextResponse } from "next/server";
import { supaAdmin } from "@/lib/supabase-admin";
import { passeValido } from "@/lib/cadastros-passe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const APPS = ["servicos", "crm"];

async function rpc(fn: string, args: Record<string, unknown>) {
  const { data, error } = await supaAdmin().schema("orders").rpc(fn, args);
  if (error) throw new Error(error.message);
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
      default:
        return NextResponse.json({ error: "op inválida" }, { status: 400 });
    }
  } catch (e) {
    // Erro de regra do banco (CNPJ inválido, duplicado…) volta como 400 com a mensagem.
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}

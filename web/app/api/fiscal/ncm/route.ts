// /api/fiscal/ncm — localizador de NCM (05/10/26).
//   GET ?q=…                      busca na tabela oficial (Siscomex) por código ou palavras
//   GET ?op=sugerir&desc=…&cod=…  sugestões ranqueadas (catálogo, NF de fornecedor, NF-e do Omie)
//   GET ?op=compras&desc=…&cod=…  "Das nossas compras": NCM das NF-e recebidas / PCs do Omie deste item ou parecidos
//   GET ?op=familia&prefixo=…     NCMs mais usados pelos itens nossos da família (08/10/26)
//   GET ?op=validar&ncm=…         existe e é folha de 8 dígitos?
//   GET ?op=pendencias            itens do estoque sem NCM / com NCM inválido
//   POST {codigo, ncm}            grava o NCM no cadastro do item (painel + dados fiscais), com histórico
import { NextResponse, type NextRequest } from "next/server";
import { loadPerms } from "@/lib/require-area";
import { canViewArea } from "@/lib/permissions";
import { permissoesDe } from "@/lib/acessos";
import { supaAdmin } from "@/lib/supabase-admin";
import { supaServer } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function quem() {
  const perms = await loadPerms();
  if (!perms) return NextResponse.json({ error: "Sessão expirada — entre de novo" }, { status: 401 });
  if (!canViewArea(perms, "erp")) return NextResponse.json({ error: "Sem acesso à área ERP" }, { status: 403 });
  const pode = await permissoesDe(perms);
  const { data: { user } } = await (await supaServer()).auth.getUser();
  const gravar = !!perms.is_admin || !!pode["financeiro.editar_titulo"] || !!pode["estoque.codigos"];
  return { email: user?.email ?? "painel", gravar };
}

const rpc = async <T,>(nome: string, args: Record<string, unknown>) => {
  const { data, error } = await supaAdmin().schema("orders").rpc(nome, args);
  if (error) throw new Error(error.message);
  return data as T;
};

export async function GET(req: NextRequest) {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  const sp = req.nextUrl.searchParams;
  const emp = (sp.get("emp") ?? "SF").toUpperCase();
  const op = sp.get("op") ?? "buscar";
  try {
    if (op === "sugerir") {
      const desc = (sp.get("desc") ?? "").trim(), cod = (sp.get("cod") ?? "").trim();
      if (desc.length < 3 && !cod) return NextResponse.json({ sugestoes: [] });
      return NextResponse.json({ sugestoes: await rpc("ncm_sugerir", { p_empresa: emp, p_descricao: desc, p_codigo: cod || null }) ?? [] });
    }
    if (op === "compras") {
      // NCM que veio nas NF-e/PCs dos fornecedores para este item (código, vínculos, códigos antigos) ou parecidos
      const desc = (sp.get("desc") ?? "").trim(), cod = (sp.get("cod") ?? "").trim();
      if (desc.length < 3 && !cod) return NextResponse.json({ compras: [] });
      return NextResponse.json({ compras: await rpc("ncm_das_compras", { p_empresa: emp, p_descricao: desc, p_codigo: cod || null }) ?? [] });
    }
    if (op === "familia") {
      // 08/10/26: NCMs mais usados pelos itens nossos da família (código começa pelo prefixo da família) —
      // o "Criar item nosso" da lista de materiais sugere a partir deles.
      const pre = (sp.get("prefixo") ?? "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 6);
      if (!pre) return NextResponse.json({ familia: [] });
      const { data, error } = await supaAdmin().schema("orders").from("v_item_ncm").select("ncm")
        .eq("empresa", emp).ilike("codigo", `${pre}%`).not("ncm", "is", null).limit(3000);
      if (error) throw new Error(error.message);
      const conta = new Map<string, number>();
      for (const r of (data ?? []) as { ncm: string | null }[]) { const d = String(r.ncm ?? "").replace(/\D/g, ""); if (d.length === 8) conta.set(d, (conta.get(d) ?? 0) + 1); }
      const top = [...conta.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8);
      if (!top.length) return NextResponse.json({ familia: [] });
      const validos = new Set(((await rpc<string[]>("ncm_validos", { p: top.map(([n]) => n) })) ?? []).map(String));
      type Res = { codigo: string; codigo_fmt: string; descricao: string; caminho: string | null };
      const out = await Promise.all(top.filter(([n]) => validos.has(n)).slice(0, 6).map(async ([n, itens]) => {
        const r = ((await rpc<Res[]>("ncm_buscar", { p_q: n, p_lim: 5 }).catch(() => [])) ?? []).find((x) => x.codigo === n);
        return { ncm: n, codigo_fmt: r?.codigo_fmt ?? `${n.slice(0, 4)}.${n.slice(4, 6)}.${n.slice(6)}`, descricao_ncm: r?.descricao ?? "", caminho: r?.caminho ?? null, itens };
      }));
      return NextResponse.json({ familia: out });
    }
    if (op === "validar") return NextResponse.json({ valido: await rpc<boolean>("ncm_valido", { p: sp.get("ncm") ?? "" }) });
    if (op === "pendencias") return NextResponse.json(await rpc("ncm_pendencias", { p_empresa: emp }));
    if (op === "item") {
      // NCM efetivo do item (cadastro do painel > espelho > fiscal > catálogo Omie) + se é válido
      const cod = (sp.get("cod") ?? "").replace(/[^A-Za-z0-9._-]/g, "");
      if (!cod) return NextResponse.json({ item: null, ncm: null, valido: false });
      const { data } = await supaAdmin().schema("orders").from("v_item_ncm").select("codigo,codigo_omie,descricao,ncm")
        .eq("empresa", emp).or(`codigo.eq.${cod},codigo_omie.eq.${cod}`).limit(1).maybeSingle();
      const ncm = (data as { ncm?: string | null } | null)?.ncm ?? null;
      return NextResponse.json({ item: data, ncm, valido: ncm ? await rpc<boolean>("ncm_valido", { p: ncm }) : false });
    }
    if (op === "sem_ncm") {
      // Itens ativos sem NCM válido (para o filtro do Estoque)
      const { data, error } = await supaAdmin().schema("orders").from("v_item_ncm").select("codigo,codigo_omie,descricao,ncm").eq("empresa", emp).limit(5000);
      if (error) throw new Error(error.message);
      const lista = (data ?? []) as { codigo: string; codigo_omie: string | null; descricao: string; ncm: string | null }[];
      const comNcm = [...new Set(lista.map((i) => i.ncm).filter((n): n is string => !!n))];
      const validos = new Set<string>();
      for (let i = 0; i < comNcm.length; i += 300) {
        const { data: v } = await supaAdmin().schema("orders").rpc("ncm_validos", { p: comNcm.slice(i, i + 300) });
        for (const x of (v ?? []) as string[]) validos.add(x);
      }
      const pend = lista.filter((i) => !i.ncm || !validos.has(i.ncm)).map((i) => ({ ...i, problema: i.ncm ? "inválido" : "sem NCM" }));
      return NextResponse.json({ total: lista.length, pendentes: pend.length, itens: pend });
    }
    const termo = (sp.get("q") ?? "").trim();
    if (termo.length < 2) return NextResponse.json({ resultados: [] });
    return NextResponse.json({ resultados: await rpc("ncm_buscar", { p_q: termo, p_lim: 30 }) ?? [] });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

export async function POST(req: NextRequest) {
  const q = await quem();
  if (q instanceof NextResponse) return q;
  if (!q.gravar) return NextResponse.json({ error: "Sem permissão para alterar o cadastro do item" }, { status: 403 });
  const b = await req.json().catch(() => null) as { emp?: string; codigo?: string; ncm?: string; fonte?: string } | null;
  if (!b?.codigo || !b?.ncm) return NextResponse.json({ error: "codigo e ncm obrigatórios" }, { status: 400 });
  try {
    const r = await rpc("ncm_salvar_item", { p_empresa: (b.emp ?? "SF").toUpperCase(), p_codigo: b.codigo, p_ncm: b.ncm, p_por: q.email, p_fonte: b.fonte ?? "painel" });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

import { NextResponse } from "next/server";
import { requireAdmin } from "../_guard";
import { supaAdmin, generateTempPassword } from "@/lib/supabase-admin";
import { permissoesEfetivas } from "@/lib/acessos";
import { CATALOGO, PERFIS, type Chave, type ModuloPerm } from "@/lib/acessos-catalogo";
import type { AreaAccess, ModuleRole, Role, UserPerms } from "@/lib/permissions";

// Usuários e acessos (03/10/26) — tela central do administrador.
// GET: pessoas + acessos por módulo + permissões finas (efetivas e explícitas).
// POST: uma ação por chamada, sempre auditada em platform.acessos_audit.

export const runtime = "nodejs";

const plat = () => supaAdmin().schema("platform");
const pub = () => supaAdmin().schema("public");

type Perfil = { id: string; email: string; nome: string | null; is_admin: boolean; ativo: boolean; role: Role };

async function auditar(por: string, alvoId: string | null, alvoEmail: string | null, acao: string, antes: unknown, depois: unknown) {
  await plat().from("acessos_audit").insert({ por_email: por, alvo_id: alvoId, alvo_email: alvoEmail, acao, antes, depois });
}

async function carregar() {
  const [perfis, areas, mods, explic, crm, audit] = await Promise.all([
    plat().from("user_profiles").select("id, email, nome, is_admin, ativo, role").order("email"),
    plat().from("user_area_access").select("user_id, area, can_view"),
    plat().from("user_module_roles").select("user_id, modulo, can_approve, can_view_values, can_view_margin, approval_ceiling_brl"),
    plat().from("permissoes_usuario").select("user_id, chave, concedida"),
    pub().from("tenant_members").select("user_id, role").eq("tenant_slug", "waterworks"),
    plat().from("acessos_audit").select("*").order("em", { ascending: false }).limit(200),
  ]);
  const perfisRows = (perfis.data ?? []) as Perfil[];
  const crmRows = (crm.data ?? []) as { user_id: string; role: string }[];
  // Membros do portal que não têm perfil no painel também entram na lista.
  const faltam = crmRows.map((c) => c.user_id).filter((id) => !perfisRows.some((p) => p.id === id));
  const extra: Perfil[] = [];
  for (const id of faltam) {
    const u = await supaAdmin().auth.admin.getUserById(id);
    const email = u.data.user?.email;
    if (email) extra.push({ id, email, nome: null, is_admin: false, ativo: true, role: "viewer" });
  }
  const areasPor = new Map<string, AreaAccess[]>();
  for (const a of (areas.data ?? []) as (AreaAccess & { user_id: string })[]) areasPor.set(a.user_id, [...(areasPor.get(a.user_id) ?? []), { area: a.area, can_view: a.can_view }]);
  const modsPor = new Map<string, (ModuleRole & { user_id: string })[]>();
  for (const m of (mods.data ?? []) as (ModuleRole & { user_id: string })[]) modsPor.set(m.user_id, [...(modsPor.get(m.user_id) ?? []), m]);
  const explPor = new Map<string, Record<string, boolean>>();
  for (const e of (explic.data ?? []) as { user_id: string; chave: string; concedida: boolean }[]) explPor.set(e.user_id, { ...(explPor.get(e.user_id) ?? {}), [e.chave]: e.concedida });

  const pessoas = [];
  for (const p of [...perfisRows, ...extra]) {
    const perms: UserPerms = { id: p.id, role: p.role, is_admin: p.is_admin, area_access: areasPor.get(p.id) ?? [], module_roles: modsPor.get(p.id) ?? [] };
    const efetivas = await permissoesEfetivas(perms);
    pessoas.push({
      ...p,
      semPerfilPainel: extra.some((x) => x.id === p.id),
      teste: /@allka\.dev$/i.test(p.email),
      areas: perms.area_access,
      modulos: perms.module_roles,
      crm: crmRows.find((c) => c.user_id === p.id)?.role ?? null,
      explicitas: explPor.get(p.id) ?? {},
      efetivas,
    });
  }
  return { pessoas, catalogo: CATALOGO, perfis: Object.fromEntries(Object.entries(PERFIS).map(([k, v]) => [k, v.rotulo])), auditoria: audit.data ?? [] };
}

export async function GET() {
  const { error } = await requireAdmin();
  if (error) return error;
  try { return NextResponse.json(await carregar()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 500 }); }
}

// Níveis por módulo → permissões finas (o "ver" deixa ver, sem ações).
const NIVEIS: Record<ModuloPerm, Record<"ver" | "usar", Chave[]>> = {
  compras:    { ver: ["compras.acesso", "compras.ver_valores"], usar: ["compras.acesso", "compras.ver_valores", "compras.gerar_pc_nf", "compras.conferir", "compras.enviar_fornecedor"] },
  estoque:    { ver: ["estoque.acesso", "estoque.ver_custos"], usar: ["estoque.acesso", "estoque.ver_custos", "estoque.ajustar"] },
  financeiro: { ver: ["financeiro.ver_pagar", "financeiro.ver_receber"], usar: ["financeiro.ver_pagar", "financeiro.ver_receber", "financeiro.editar_titulo"] },
};

async function fotografia(userId: string) {
  const [a, e, c, p] = await Promise.all([
    plat().from("user_area_access").select("area, can_view").eq("user_id", userId),
    plat().from("permissoes_usuario").select("chave, concedida").eq("user_id", userId),
    pub().from("tenant_members").select("role").eq("tenant_slug", "waterworks").eq("user_id", userId).maybeSingle(),
    plat().from("user_profiles").select("is_admin, ativo, role").eq("id", userId).maybeSingle(),
  ]);
  return { areas: a.data ?? [], permissoes: e.data ?? [], crm: (c.data as { role?: string } | null)?.role ?? null, perfil: p.data ?? null };
}

async function setArea(userId: string, area: string, on: boolean | null) {
  if (on === null) {
    const r = await plat().from("user_area_access").delete().eq("user_id", userId).eq("area", area);
    if (r.error) throw new Error(r.error.message);
    return;
  }
  const r = await plat().from("user_area_access").upsert({ user_id: userId, area, can_view: on, updated_at: new Date().toISOString() }, { onConflict: "user_id,area" });
  if (r.error) throw new Error(r.error.message);
}

async function setPerm(userId: string, chave: Chave, valor: boolean | null, por: string) {
  if (valor === null) {
    const r = await plat().from("permissoes_usuario").delete().eq("user_id", userId).eq("chave", chave);
    if (r.error) throw new Error(r.error.message);
    return;
  }
  const r = await plat().from("permissoes_usuario").upsert({ user_id: userId, chave, concedida: valor, por_email: por, em: new Date().toISOString() }, { onConflict: "user_id,chave" });
  if (r.error) throw new Error(r.error.message);
}

async function garantirErp(userId: string) {
  const { data } = await plat().from("user_area_access").select("can_view").eq("user_id", userId).eq("area", "erp").maybeSingle();
  if (!(data as { can_view?: boolean } | null)?.can_view) await setArea(userId, "erp", true);
}

async function emailDe(userId: string): Promise<string> {
  const { data } = await plat().from("user_profiles").select("email").eq("id", userId).maybeSingle();
  if ((data as { email?: string } | null)?.email) return (data as { email: string }).email;
  const u = await supaAdmin().auth.admin.getUserById(userId);
  return u.data.user?.email ?? "";
}

export async function POST(req: Request) {
  const { error, user } = await requireAdmin();
  if (error) return error;
  const por = user?.email ?? "admin";
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const userId = String(b.user_id ?? "");
  try {
    switch (b.acao) {
      case "adicionar": {
        const email = String(b.email ?? "").trim().toLowerCase();
        const nome = String(b.nome ?? "").trim() || null;
        if (!/\S+@\S+\.\S+/.test(email)) return NextResponse.json({ error: "E-mail inválido" }, { status: 400 });
        // Já existe no login (portal/painel)? Só cria o perfil do painel.
        let id: string | null = null;
        for (let page = 1; page <= 10 && !id; page++) {
          const l = await supaAdmin().auth.admin.listUsers({ page, perPage: 200 });
          id = l.data.users.find((u) => (u.email ?? "").toLowerCase() === email)?.id ?? null;
          if ((l.data.users ?? []).length < 200) break;
        }
        let senha: string | null = null;
        if (!id) {
          if (b.confirmado !== true) return NextResponse.json({ precisaConfirmar: true, email });
          senha = generateTempPassword();
          const c = await supaAdmin().auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome, must_change_password: true } });
          if (c.error || !c.data.user) throw new Error(c.error?.message ?? "Falha ao criar o usuário");
          id = c.data.user.id;
        }
        const r = await plat().from("user_profiles").upsert({ id, email, nome, ativo: true }, { onConflict: "id" });
        if (r.error) throw new Error(r.error.message);
        await auditar(por, id, email, senha ? "criou pessoa" : "adicionou pessoa existente", null, { email, nome });
        return NextResponse.json({ ok: true, user_id: id, senha_provisoria: senha, ...(await carregar()) });
      }
      case "desativar":
      case "reativar": {
        const email = await emailDe(userId);
        const antes = await fotografia(userId);
        const ativo = b.acao === "reativar";
        const r = await plat().from("user_profiles").update({ ativo, ...(ativo ? {} : { is_admin: false }) }).eq("id", userId);
        if (r.error) throw new Error(r.error.message);
        if (!ativo) {
          await plat().from("user_area_access").delete().eq("user_id", userId);
          await pub().from("tenant_members").delete().eq("tenant_slug", "waterworks").eq("user_id", userId);
        }
        await auditar(por, userId, email, b.acao as string, antes, await fotografia(userId));
        break;
      }
      case "area": {
        const area = String(b.area);
        if (!["operacao", "compras", "vendas", "financeiro", "erp", "bi"].includes(area)) throw new Error("área inválida");
        const antes = await fotografia(userId);
        await setArea(userId, area, b.on === null ? null : !!b.on);
        await auditar(por, userId, await emailDe(userId), `área ${area}`, antes, await fotografia(userId));
        break;
      }
      case "admin": {
        if (userId === user?.id && !b.on) throw new Error("Você não pode tirar o seu próprio administrador");
        const antes = await fotografia(userId);
        const r = await plat().from("user_profiles").update({ is_admin: !!b.on, ...(b.on ? { role: "admin" } : {}) }).eq("id", userId);
        if (r.error) throw new Error(r.error.message);
        await auditar(por, userId, await emailDe(userId), b.on ? "virou administrador" : "deixou de ser administrador", antes, await fotografia(userId));
        break;
      }
      case "crm": {
        const role = b.role === null ? null : String(b.role);
        if (role && !["viewer", "member", "admin", "owner"].includes(role)) throw new Error("papel inválido");
        const antes = await fotografia(userId);
        const email = await emailDe(userId);
        if (!role) {
          const r = await pub().from("tenant_members").delete().eq("tenant_slug", "waterworks").eq("user_id", userId);
          if (r.error) throw new Error(r.error.message);
        } else {
          // o portal precisa de um profile para mostrar a pessoa
          const prof = await pub().from("profiles").select("user_id").eq("user_id", userId).maybeSingle();
          if (!prof.data) {
            const pr = await pub().from("profiles").insert({ user_id: userId, email, display_name: email.split("@")[0], current_tenant: "waterworks" });
            if (pr.error) throw new Error(pr.error.message);
          }
          const r = await pub().from("tenant_members").upsert({ tenant_slug: "waterworks", user_id: userId, role }, { onConflict: "tenant_slug,user_id" });
          if (r.error) throw new Error(r.error.message);
        }
        await auditar(por, userId, email, `CRM ${role ?? "sem acesso"}`, antes, await fotografia(userId));
        break;
      }
      case "perm": {
        const chave = String(b.chave) as Chave;
        if (!CATALOGO.some((c) => c.chave === chave)) throw new Error("permissão inválida");
        const antes = await fotografia(userId);
        const valor = b.valor === null ? null : !!b.valor;
        if (valor) await garantirErp(userId);
        await setPerm(userId, chave, valor, por);
        await auditar(por, userId, await emailDe(userId), `${chave} → ${valor === null ? "padrão" : valor ? "sim" : "não"}`, antes, await fotografia(userId));
        break;
      }
      case "modulo": {
        const mod = String(b.modulo) as ModuloPerm;
        const nivel = String(b.nivel);
        if (!NIVEIS[mod] || !["sem", "ver", "usar", "administrar"].includes(nivel)) throw new Error("módulo/nível inválido");
        const antes = await fotografia(userId);
        const chavesMod = CATALOGO.filter((c) => c.modulo === mod).map((c) => c.chave);
        const ligar = new Set<Chave>(nivel === "administrar" ? chavesMod : nivel === "sem" ? [] : NIVEIS[mod][nivel as "ver" | "usar"]);
        if (ligar.size) await garantirErp(userId);
        for (const ch of chavesMod) await setPerm(userId, ch, ligar.has(ch), por);
        await auditar(por, userId, await emailDe(userId), `${mod}: ${nivel}`, antes, await fotografia(userId));
        break;
      }
      case "perfil": {
        const perfil = PERFIS[String(b.perfil)];
        if (!perfil) throw new Error("perfil inválido");
        const antes = await fotografia(userId);
        await garantirErp(userId);
        for (const c of CATALOGO) await setPerm(userId, c.chave, perfil.chaves.includes(c.chave), por);
        await auditar(por, userId, await emailDe(userId), `perfil ${perfil.rotulo}`, antes, await fotografia(userId));
        break;
      }
      case "padrao": {
        const antes = await fotografia(userId);
        const r = await plat().from("permissoes_usuario").delete().eq("user_id", userId);
        if (r.error) throw new Error(r.error.message);
        await auditar(por, userId, await emailDe(userId), "permissões voltaram ao padrão", antes, await fotografia(userId));
        break;
      }
      default:
        return NextResponse.json({ error: "ação inválida" }, { status: 400 });
    }
    return NextResponse.json({ ok: true, ...(await carregar()) });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

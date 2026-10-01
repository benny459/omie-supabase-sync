// Status do material por item (linha da RC) — marcado à mão pelo time
// (pedido do Benny, 01/10/2026). Fica em approval.approvals.custom_fields:
//   mat_status      = { v, qtd?, por, email, em }   ← o atual
//   mat_status_hist = [ ...mesmo formato ]          ← todas as mudanças
// Quem marcou e quando vêm da SESSÃO, nunca do corpo do pedido.
// Os status automáticos (A caminho, Atrasado, Sem previsão, Recebido pela NF
// de entrada) não passam por aqui: são calculados na tela a partir do Omie.
//
// POST { empresa, ncod_ped, modulo, status: "estoque"|"recebido_sem_nf"|"parcial"|"cancelado"|null, qtd? }

import { NextResponse } from "next/server";
import { supaServer } from "@/lib/supabase-server";
import { supaAdmin } from "@/lib/supabase-admin";
import { canEdit, type UserPerms } from "@/lib/permissions";

export const runtime = "nodejs";

const STATUS = new Set(["estoque", "recebido_sem_nf", "parcial", "cancelado"]);
const MODULOS = new Set(["avulsos", "projetos"]);

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { empresa?: string; ncod_ped?: number | string; modulo?: string; status?: string | null; qtd?: number | null };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Bad JSON" }, { status: 400 }); }
  const empresa = String(body.empresa ?? "").trim();
  const ncod = Number(body.ncod_ped);
  const modulo = String(body.modulo ?? "");
  const status = body.status == null || body.status === "" ? null : String(body.status);
  if (!empresa || !Number.isFinite(ncod) || !ncod || !MODULOS.has(modulo)) return NextResponse.json({ error: "linha inválida" }, { status: 400 });
  if (status && !STATUS.has(status)) return NextResponse.json({ error: "status inválido" }, { status: 400 });
  const qtd = status === "parcial" ? Number(body.qtd) : null;
  if (status === "parcial" && !(qtd != null && Number.isFinite(qtd) && qtd > 0)) {
    return NextResponse.json({ error: "Informe quantos chegaram" }, { status: 400 });
  }

  // Mesma regra da tela: quem edita RC ou PC no módulo pode marcar o material.
  const adm = supaAdmin();
  const [{ data: perfil }, { data: papeis }] = await Promise.all([
    adm.schema("platform" as never).from("user_profiles").select("nome, role, is_admin, permissions").eq("id", user.id).maybeSingle(),
    adm.schema("platform" as never).from("user_module_roles").select("*").eq("user_id", user.id),
  ]);
  const p = perfil as { nome?: string | null; role?: string; is_admin?: boolean; permissions?: unknown } | null;
  const perms = { id: user.id, role: (p?.role ?? "viewer"), is_admin: !!p?.is_admin, permissions: p?.permissions ?? null, module_roles: papeis ?? [] } as unknown as UserPerms;
  if (!canEdit(perms, modulo as "avulsos", "rc") && !canEdit(perms, modulo as "avulsos", "pc")) {
    return NextResponse.json({ error: "Sem permissão para marcar o material" }, { status: 403 });
  }

  const approval = adm.schema("approval" as never);
  const { data: atual, error: re } = await approval.from("approvals").select("custom_fields, modulo")
    .eq("empresa", empresa).eq("ncod_ped", ncod).maybeSingle();
  if (re) return NextResponse.json({ error: re.message }, { status: 500 });
  const cf: Record<string, unknown> = { ...(((atual as { custom_fields?: object } | null)?.custom_fields) ?? {}) };
  const marca = status
    ? { v: status, ...(qtd != null ? { qtd } : {}), por: p?.nome?.trim() || user.email || "—", email: user.email ?? null, em: new Date().toISOString() }
    : null;
  const hist = Array.isArray(cf.mat_status_hist) ? (cf.mat_status_hist as unknown[]) : [];
  cf.mat_status_hist = [...hist, marca ?? { v: null, por: p?.nome?.trim() || user.email || "—", email: user.email ?? null, em: new Date().toISOString() }];
  if (marca) cf.mat_status = marca; else delete cf.mat_status;

  const linha: Record<string, unknown> = { empresa, ncod_ped: ncod, modulo: (atual as { modulo?: string } | null)?.modulo ?? modulo, custom_fields: cf };
  if (ncod < 0 && !atual) linha.source = "native";
  const { error } = await approval.from("approvals").upsert(linha, { onConflict: "empresa,ncod_ped" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, mat_status: marca });
}

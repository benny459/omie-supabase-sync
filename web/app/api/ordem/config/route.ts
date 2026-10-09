// /api/ordem/config — configuração da Central de Ordem (só administrador).
//  GET  → { config, sugerido, decisoes, detetores, acoes, donos, pessoas (com os módulos que cada uma vê), log, pedidos }
//  POST { acao: "gravar", config }                    → grava e regista cada diferença em ordem.config_log
//       { acao: "dono", tipo, papel, titular_id, substituto_id?, titular_ausente? } → recusa dono sem acesso ao módulo
//       { acao: "dono_remover", tipo }                 → volta ao dono de hoje (fallback)
//       { acao: "pedido", id, estado: aprovado|recusado, nota? } → só regista a decisão; o acesso é dado em Usuários e acessos
import { NextResponse } from "next/server";
import { CONFIG_VAZIA, DECISOES, SUGERIDO, normalizarConfig, type ConfigOrdem } from "@/lib/ordem/config";
import { ACOES, DETETORES, DETETOR_POR_TIPO } from "@/lib/ordem/catalogo";
import { modulosVisiveis } from "@/lib/ordem/acesso";
import { db, gravarConfig, lerConfig, lerDonos, pessoas, quemOrdem, quemPorId, TENANT } from "@/lib/ordem/servidor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function exigirAdmin() {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  if (!q.admin) return NextResponse.json({ error: "Só o administrador configura a Central de Ordem." }, { status: 403 });
  return q;
}

export async function GET() {
  const q = await exigirAdmin();
  if (q instanceof NextResponse) return q;
  const [config, donos, ps, log, ped] = await Promise.all([
    lerConfig(), lerDonos(), pessoas(),
    db().from("config_log").select("id, email, chave, antes, depois, criado_em").eq("tenant_slug", TENANT).order("criado_em", { ascending: false }).limit(200),
    db().from("pedido_acesso").select("*").eq("tenant_slug", TENANT).order("criado_em", { ascending: false }).limit(100),
  ]);
  const ativos = ps.filter((p) => p.ativo);
  const comAcesso = await Promise.all(ativos.map(async (p) => {
    const qq = await quemPorId(p.id);
    return { ...p, modulos: qq ? modulosVisiveis(qq, config) : [], admin: !!qq?.admin };
  }));
  return NextResponse.json({
    config, sugerido: SUGERIDO, vazia: CONFIG_VAZIA, decisoes: DECISOES, detetores: DETETORES, acoes: ACOES,
    donos, pessoas: comAcesso, log: log.data ?? [], pedidos: ped.data ?? [],
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const q = await exigirAdmin();
  if (q instanceof NextResponse) return q;
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  try {
    if (b.acao === "gravar") {
      return NextResponse.json(await gravarConfig(normalizarConfig(b.config as ConfigOrdem), q));
    }
    if (b.acao === "dono" || b.acao === "dono_remover") {
      const tipo = String(b.tipo ?? "");
      const det = DETETOR_POR_TIPO[tipo];
      if (!det && !tipo.startsWith("enc:")) return NextResponse.json({ error: "Tipo desconhecido" }, { status: 400 });
      const antes = (await lerDonos()).find((d) => d.tipo === tipo) ?? null;
      if (b.acao === "dono_remover") {
        await db().from("dono_config").delete().eq("tenant_slug", TENANT).eq("tipo", tipo);
        await db().from("config_log").insert({ tenant_slug: TENANT, usuario_id: q.uid, email: q.email, chave: `dono.${tipo}`, antes, depois: null });
        return NextResponse.json({ ok: true });
      }
      const titular = String(b.titular_id ?? "");
      const subst = b.substituto_id ? String(b.substituto_id) : null;
      const cfg = await lerConfig();
      // SPEC §4.3: só pode ser dono quem TEM acesso ao módulo do tipo.
      for (const [id, papel] of [[titular, "titular"], [subst, "substituto"]] as [string | null, string][]) {
        if (!id) continue;
        const qq = await quemPorId(id);
        const mod = det?.modulo;
        if (!qq || (mod && !modulosVisiveis(qq, cfg).includes(mod))) {
          return NextResponse.json({ error: `O ${papel} escolhido não tem acesso a ${mod ?? "este módulo"} — dê o acesso em Usuários e acessos primeiro, ou escolha outra pessoa.` }, { status: 400 });
        }
      }
      const linha = { tenant_slug: TENANT, tipo, papel: String(b.papel ?? det?.papel ?? "dono"), titular_id: titular, substituto_id: subst,
        titular_ausente: b.titular_ausente === true, atualizado_por: q.uid, atualizado_em: new Date().toISOString() };
      const { error } = await db().from("dono_config").upsert(linha);
      if (error) throw new Error(error.message);
      await db().from("config_log").insert({ tenant_slug: TENANT, usuario_id: q.uid, email: q.email, chave: `dono.${tipo}`, antes, depois: linha });
      return NextResponse.json({ ok: true });
    }
    if (b.acao === "pedido") {
      const estado = b.estado === "aprovado" ? "aprovado" : "recusado";
      const { data: p } = await db().from("pedido_acesso").update({ estado, decidido_por: q.uid, decidido_em: new Date().toISOString(), nota: b.nota ? String(b.nota) : null })
        .eq("tenant_slug", TENANT).eq("id", String(b.id)).select("usuario_id, modulo").maybeSingle();
      const pp = p as { usuario_id: string; modulo: string } | null;
      if (pp) await db().from("aviso").insert({ tenant_slug: TENANT, destinatario_id: pp.usuario_id, tipo: "acesso",
        texto: estado === "aprovado" ? `O seu pedido de acesso a ${pp.modulo} foi aprovado. O administrador libera em Usuários e acessos.` : `O seu pedido de acesso a ${pp.modulo} foi recusado${b.nota ? `: ${b.nota}` : "."}` });
      await db().from("config_log").insert({ tenant_slug: TENANT, usuario_id: q.uid, email: q.email, chave: `pedido_acesso.${String(b.id)}`, antes: null, depois: { estado, nota: b.nota ?? null } });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "ação inválida" }, { status: 400 });
  } catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 }); }
}

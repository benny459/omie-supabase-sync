// GET  /api/cadastros/duplicidades            → grupos pré-calculados (sql/61) com nível de confiança
// POST /api/cadastros/duplicidades
//   { acao: "mesclar", sobrevivente, absorvido, motivo }   (admin) — mesma empresa: mescla; empresas diferentes: agrupa
//   { acao: "agrupar_lote", grupos: [[idSobrevivente, ...ids]], motivo }  (admin)
//   { acao: "mesclar_provaveis", chaves?: string[], motivo }  (admin) — um lote, desfazível
//   { acao: "desfazer_lote", lote }                        (admin)
//   { acao: "ignorar", ids: [..] }                         "não é duplicado"
//   { acao: "desfazer", id }                               (admin)
//   { acao: "recalcular" }                                 refaz a lista agora (também corre de hora a hora)
// Nada é mesclado sozinho (sql/59, sql/61).
import { NextResponse } from "next/server";
import { exigirCadastros, rpcCad, erroCad } from "@/lib/cadastros-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  if (!q.editar) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const lim = Math.min(5000, Math.max(50, Number(new URL(req.url).searchParams.get("lim")) || 2000));
  try {
    return NextResponse.json({ ...(await rpcCad<object>("cadastros_duplicidades_v2", { p_lim: lim })), admin: q.perms.is_admin });
  } catch (e) { return erroCad(e); }
}

export async function POST(req: Request) {
  const q = await exigirCadastros();
  if (q instanceof NextResponse) return q;
  if (!q.editar) return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const soAdmin = () => NextResponse.json({ error: "Só administrador mescla cadastros" }, { status: 403 });
  const tirar = (ids: number[]) => rpcCad("cadastros_dup_tirar", { p_ids: ids }).catch(() => null);
  try {
    switch (b.acao) {
      case "mesclar": {
        if (!q.perms.is_admin) return soAdmin();
        const r = await rpcCad("cadastros_mesclar", {
          p_sobrevivente: Number(b.sobrevivente), p_absorvido: Number(b.absorvido), p_motivo: String(b.motivo ?? ""), p_por: q.email,
        });
        await tirar([Number(b.sobrevivente), Number(b.absorvido)]);
        return NextResponse.json(r);
      }
      case "agrupar_lote": {
        if (!q.perms.is_admin) return soAdmin();
        const grupos = Array.isArray(b.grupos) ? (b.grupos as unknown[]).slice(0, 2500) : [];
        let ok = 0; const erros: string[] = []; const mexidos: number[] = [];
        for (const g of grupos) {
          const ids = (Array.isArray(g) ? g : []).map(Number).filter(Number.isFinite);
          for (const outro of ids.slice(1)) {
            try {
              await rpcCad("cadastros_mesclar", { p_sobrevivente: ids[0], p_absorvido: outro, p_motivo: String(b.motivo ?? "agrupar em lote"), p_por: q.email });
              ok++;
            } catch (e) { erros.push(`${ids[0]}←${outro}: ${e instanceof Error ? e.message : e}`); }
          }
          mexidos.push(...ids);
        }
        if (mexidos.length) await tirar(mexidos);
        return NextResponse.json({ ok, erros: erros.slice(0, 50) });
      }
      case "mesclar_provaveis": {
        if (!q.perms.is_admin) return soAdmin();
        const chaves = Array.isArray(b.chaves) ? (b.chaves as unknown[]).map(String) : null;
        return NextResponse.json(await rpcCad("cadastros_mesclar_provaveis", {
          p_chaves: chaves, p_motivo: String(b.motivo ?? ""), p_por: q.email,
        }));
      }
      case "desfazer_lote":
        if (!q.perms.is_admin) return soAdmin();
        return NextResponse.json(await rpcCad("cadastros_desfazer_lote", { p_lote: String(b.lote ?? ""), p_por: q.email }));
      case "ignorar": {
        const ids = (Array.isArray(b.ids) ? b.ids : []).map(Number).filter(Number.isFinite);
        if (ids.length < 2) return NextResponse.json({ error: "Escolha pelo menos dois" }, { status: 400 });
        const n = await rpcCad("cadastros_ignorar_dup", { p_ids: ids, p_por: q.email });
        await tirar(ids);
        return NextResponse.json({ ignorados: n });
      }
      case "desfazer": {
        if (!q.perms.is_admin) return soAdmin();
        const r = await rpcCad("cadastros_desfazer_mescla", { p_id: Number(b.id), p_por: q.email });
        await rpcCad("cadastros_dup_refresh").catch(() => null);
        return NextResponse.json(r);
      }
      case "recalcular":
        return NextResponse.json(await rpcCad("cadastros_dup_refresh"));
      default:
        return NextResponse.json({ error: "ação inválida" }, { status: 400 });
    }
  } catch (e) { return erroCad(e); }
}

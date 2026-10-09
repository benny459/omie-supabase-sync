// GET /api/ordem?m=<modulo>&escopo=meus|equipe|todos — a fila da Central de Ordem da pessoa.
// Tudo filtrado NO SERVIDOR pelas camadas de permissão de hoje (lib/ordem/acesso.ts):
// módulo sem acesso → 403 e nenhum dado (nem contagem). Só leitura; sincroniza em segundo
// lê o cache ordem.item (os detetores correm no cron /api/cron/ordem).
import { NextResponse } from "next/server";
import { comercialDe } from "@/lib/ordem/comercial";
import { servicosDe } from "@/lib/ordem/servicos";
import { ehModulo } from "@/lib/ordem/modulos";
import { MODULO_POR_ID } from "@/lib/ordem/modulos";
import { filtrarItens } from "@/lib/ordem/fila";
import { escoposPermitidos, type Escopo } from "@/lib/ordem/acesso";
import { db, itensAbertos, lerConfig, lerDonos, pessoas, quemOrdem, TENANT, ultimaSync } from "@/lib/ordem/servidor";
import { DETETOR_POR_TIPO } from "@/lib/ordem/catalogo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  const q = await quemOrdem();
  if (q instanceof NextResponse) return q;
  const cfg = await lerConfig();
  // Central desligada para quem não é admin: nem a fila nem contagens.
  if (!q.admin && !cfg.ativo) return NextResponse.json({ error: "A Central de Ordem ainda não foi ligada.", desligada: true }, { status: 404 });
  const u = new URL(req.url);
  const m = u.searchParams.get("m");
  const modulo = ehModulo(m) ? m : null;
  const escopo = (u.searchParams.get("escopo") ?? undefined) as Escopo | undefined;

  // CRM e Serviços: só com o interruptor de integração ligado (configuração); cada sistema decide o acesso.
  const desligada = (n: string) => Promise.resolve({ acesso: false, itens: [], motivo: `integração com ${n} desligada na configuração da Central` });
  const [linhas, ps, ult, comercial, servicos, donos] = await Promise.all([
    itensAbertos(), pessoas(), ultimaSync(),
    cfg.integracoes.comercial ? comercialDe(q.email, q.uid) : desligada("o CRM"),
    cfg.integracoes.servicos ? servicosDe(q.email, q.uid) : desligada("Serviços"),
    lerDonos(),
  ]);
  const nomes = new Map(ps.map((p) => [p.id, p.nome]));
  const inicioHoje = new Date(new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" }) + "T00:00:00-03:00").toISOString();
  const { count: feitosHoje } = await db().from("item").select("id", { count: "exact", head: true })
    .eq("tenant_slug", TENANT).eq("dono_id", q.uid).gte("resolvido_em", inicioHoje);

  const fila = filtrarItens(q, cfg, linhas, { modulo, escopo, nomes, feitosHoje: feitosHoje ?? 0, externos: { comercial, servicos } });

  if (fila.bloqueado) {
    // Só os nomes dos donos do módulo (para o diálogo "Sem acesso") — nunca itens nem contagens.
    const tiposMod = Object.values(DETETOR_POR_TIPO).filter((d) => d.modulo === fila.bloqueado).map((d) => d.tipo);
    const donosMod = [...new Set(donos.filter((d) => tiposMod.includes(d.tipo)).map((d) => nomes.get(d.titular_id)).filter(Boolean))];
    return NextResponse.json({
      error: `Sem acesso a ${MODULO_POR_ID[fila.bloqueado].rotulo}`, bloqueado: fila.bloqueado, donos: donosMod,
      motivo: fila.abas.find((a) => a.modulo === fila.bloqueado)?.motivo ?? null, externo: !!MODULO_POR_ID[fila.bloqueado].externo,
      abas: fila.abas, quem: { nome: q.nome, admin: q.admin },
    }, { status: 403 });
  }

  // "A acompanhar": o que esta pessoa encaminhou — só o estado do destino, nunca os dados do outro módulo.
  const { data: enc } = await db().from("item").select("id, modulo, titulo, estado, dono_id, criado_em, resolvido_em, dados")
    .eq("tenant_slug", TENANT).eq("encaminhado_por", q.uid).like("tipo", "enc:%").order("criado_em", { ascending: false }).limit(50);
  const acompanhar = ((enc ?? []) as { id: string; modulo: string; titulo: string; estado: string; dono_id: string | null; criado_em: string; resolvido_em: string | null; dados: { motivo?: string } | null }[])
    .map((e) => ({ id: e.id, modulo: e.modulo, titulo: e.titulo, estado: e.estado, dono: e.dono_id ? nomes.get(e.dono_id) ?? null : null, criado_em: e.criado_em, resolvido_em: e.resolvido_em, motivo: e.dados?.motivo ?? null }));

  // Sem sincronizar aqui (09/10/26): o cron de 15 em 15 min e o "Atualizar agora" do admin tratam — a
  // leitura dos módulos é pesada e não deve correr a cada abertura da tela.
  return NextResponse.json({
    ...fila,
    acompanhar,
    sincronizado_em: ult,
    quem: { uid: q.uid, nome: q.nome, email: q.email, admin: q.admin, escopos: escoposPermitidos(q, cfg) },
    central: {
      ativo: cfg.ativo, comandos: cfg.comandos, encaminhar: cfg.encaminhar, sino: cfg.sino, decisoes: cfg.decisoes,
      dialogo_entrada: cfg.dialogo_entrada, pedido_acesso: cfg.pedido_acesso, livre: cfg.parametros.p4_encaminhar_livre,
      assistente: "Aria",
    },
    comercial_erro: (comercial as { erro?: string }).erro ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}

import "server-only";
// Detetores de Compras — lêem as MESMAS funções que a tela /erp/compras usa (sem os
// passos de escrita que GET /api/compras faz antes de listar) e aplicam as regras de
// lib/compras.ts por meio de lib/ordem/regras-compras.ts. Só leitura.
import { rpc } from "@/lib/compras-server";
import { lerAjustes, devolvidoPorPc } from "@/lib/pc-ajustes";
import type { PedidoLista } from "@/lib/compras";
import type { ConfigOrdem } from "../config";
import type { ItemDetectado } from "../tipos";
import {
  detetarEntregasAtrasadas, detetarNaoEnviados, detetarNfColunaMeio, detetarNfSemPedido,
  detetarPendentesAprovacao, detetarRecebidosNaoConferidos, type NfSemPedido, type NfSugestao,
} from "../regras-compras";

export type Resultado = { itens: ItemDetectado[]; tipos: string[]; erros: Record<string, string> };

/** Lista de pedidos exactamente como GET /api/compras devolve (cancelados no painel fora, devoluções marcadas). */
export async function pedidosCompras(desdeDias = 365): Promise<PedidoLista[]> {
  const desde = new Date(Date.now() - desdeDias * 86_400_000).toISOString().slice(0, 10);
  const [brutos, ajustes] = await Promise.all([rpc<PedidoLista[]>("compras_lista", { p_desde: desde }), lerAjustes({})]);
  const canc = new Set(ajustes.cancelados.map((c) => `${c.empresa}|${c.numero}`));
  const dev = devolvidoPorPc(ajustes.devolucoes);
  return (brutos ?? [])
    .filter((p) => p.tipo !== "PC" || !canc.has(`${p.emp}|${p.num}`))
    .map((p) => { const d = p.tipo === "PC" ? dev.get(`${p.emp}|${p.num}`) : undefined; return d ? { ...p, devolucao: d.tipo, devolvido: d.valor } : p; });
}

async function emParalelo<T, R>(xs: T[], n: number, f: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(xs.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, xs.length) }, async () => {
    while (i < xs.length) { const k = i++; out[k] = await f(xs[k]); }
  }));
  return out;
}

export async function detetarCompras(cfg: ConfigOrdem, hoje: string): Promise<Resultado> {
  const erros: Record<string, string> = {};
  const itens: ItemDetectado[] = [];
  const tipos: string[] = [];
  const corre = (ts: string[], f: () => ItemDetectado[]) => {
    try { itens.push(...f()); tipos.push(...ts); }
    catch (e) { for (const t of ts) erros[t] = e instanceof Error ? e.message : String(e); }
  };

  let pedidos: PedidoLista[] = [];
  try { pedidos = await pedidosCompras(); }
  catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    for (const t of ["pc_pendente_aprovacao", "pc_nao_enviado", "entrega_atrasada", "recebido_nao_conferido", "nf_casar_lote", "nf_divergente"]) erros[t] = m;
  }
  if (pedidos.length) {
    corre(["pc_pendente_aprovacao"], () => detetarPendentesAprovacao(pedidos, hoje));
    corre(["pc_nao_enviado"], () => detetarNaoEnviados(pedidos, hoje));
    corre(["entrega_atrasada"], () => detetarEntregasAtrasadas(pedidos, hoje, cfg));
    corre(["recebido_nao_conferido"], () => detetarRecebidosNaoConferidos(pedidos, hoje, cfg));
    try {
      // "📄 NF chegou (Focus)": {pedido_id: n} → as NFs sugeridas de cada pedido
      const sug = await rpc<Record<string, number>>("compras_nfs_sugeridas");
      const ids = Object.keys(sug ?? {}).map(Number).filter((n) => n > 0);
      const porPedido = new Map<number, NfSugestao[]>();
      await emParalelo(ids, 6, async (id) => { porPedido.set(id, (await rpc<NfSugestao[]>("compras_nfs_do_pedido", { p_id: id })) ?? []); });
      corre(["nf_casar_lote", "nf_divergente"], () => detetarNfColunaMeio(pedidos, porPedido, hoje, cfg));
    } catch (e) { erros.nf_casar_lote = erros.nf_divergente = e instanceof Error ? e.message : String(e); }
  }
  try {
    const nfs = await rpc<NfSemPedido[]>("compras_nfs_sem_pedido", { p_empresa: "SF" });
    corre(["nf_sem_pedido"], () => detetarNfSemPedido(nfs ?? [], hoje));
  } catch (e) { erros.nf_sem_pedido = e instanceof Error ? e.message : String(e); }
  return { itens, tipos, erros };
}

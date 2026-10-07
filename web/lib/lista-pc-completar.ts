// Completa as compras de cada linha da lista (rc_projetos_compras) com o detalhe do PC.
import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { acharLinhaPc, valorLinhaPc, deHtml, type LinhaPc } from "@/lib/lista-pc-linha";

/* 07/10/26 (PJ361): linha ligada só pelo NÚMERO do PC vinha sem valor, quantidade
   nem recebimento — Comprado "—" até em pedido recebido. Aqui cada PC citado
   abre (orders.compras_pedido, que também vê PC de outro projeto) e a linha
   do item é achada dentro dele: código, senão descrição. Junto vêm a data de
   recebimento e o fornecedor sem "&amp;". */
type PcJ = { pc: string; pedido_id: number; fornecedor: string | null; qtd?: number | null; valor_unit?: number | null;
  valor?: number | null; qtd_recebida?: number | null; via: string; dt_rec?: string | null; casado_por?: string | null; etapa?: string | null; aprov?: string | null;
  dt_fat?: string | null; enviado_em?: string | null; aprov_por?: string | null; aprov_em?: string | null; cancelado?: boolean | null };
type ItemJ = { id: string; item: string; modelo: string | null; codigo: string | null; pcs: PcJ[]; valor_pc: number | null; fornecedor: string | null };
export type DadosPcs = { itens: ItemJ[]; fora_da_lista: { fornecedor: string | null }[] } & Record<string, unknown>;
type PedJ = { dtRec?: string | null; etapa?: string | null; aprov?: string | null; dtFat?: string | null; enviadoEm?: string | null;
  aprovPor?: string | null; aprovEm?: string | null; cancelado?: boolean | null;
  itens?: { cod: string | null; desc: string; qtd: number; vu: number; desc0?: number; ipi?: number; st?: number; rec?: number | null }[] };

export async function completarPcs(d: DadosPcs): Promise<DadosPcs> {
  const ids = [...new Set(d.itens.flatMap((l) => l.pcs.map((p) => Number(p.pedido_id))).filter(Boolean))].slice(0, 80);
  const peds = new Map<number, PedJ>();
  await Promise.all(ids.map(async (id) => {
    const { data } = await supaAdmin().schema("orders").rpc("compras_pedido", { p_id: id });
    if (data) peds.set(id, data as PedJ);
  }));
  for (const l of d.itens) {
    l.fornecedor = l.fornecedor ? deHtml(l.fornecedor) : l.fornecedor;
    let soma = 0, temValor = false;
    for (const p of l.pcs) {
      p.fornecedor = p.fornecedor ? deHtml(p.fornecedor) : p.fornecedor;
      const ped = peds.get(Number(p.pedido_id));
      if (!ped) { if (p.valor != null) { soma += Number(p.valor); temValor = true; } continue; }
      p.dt_rec = ped.dtRec ?? null;
      p.dt_fat = ped.dtFat ?? null; p.enviado_em = ped.enviadoEm ?? null; p.cancelado = ped.cancelado ?? null;
      p.aprov_por = ped.aprovPor ?? null; p.aprov_em = ped.aprovEm ?? null;
      if (ped.aprov) p.aprov = ped.aprov; if (ped.etapa) p.etapa = ped.etapa;
      if (p.valor == null) {
        const linhas: LinhaPc[] = (ped.itens ?? []).map((i) => ({ cod: i.cod, desc: deHtml(i.desc), qtd: Number(i.qtd) || 0,
          vu: Number(i.vu) || 0, valor: valorLinhaPc(i), rec: i.rec == null ? null : Number(i.rec) }));
        const a = acharLinhaPc({ codigo: l.codigo, texto: [l.item, l.modelo].filter(Boolean).join(" ") }, linhas);
        if (a) { p.qtd = a.qtd; p.valor_unit = a.vu; p.valor = a.valor; p.qtd_recebida = a.rec; p.casado_por = a.por; }
      } else p.casado_por = "vínculo";
      if (p.valor != null) { soma += Number(p.valor); temValor = true; }
    }
    if (l.valor_pc == null && temValor) l.valor_pc = Math.round(soma * 100) / 100;
  }
  for (const f of d.fora_da_lista) f.fornecedor = f.fornecedor ? deHtml(f.fornecedor) : f.fornecedor;
  return d;
}


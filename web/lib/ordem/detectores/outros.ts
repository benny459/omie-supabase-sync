import "server-only";
// Detetores de Faturamento, Estoque e Cadastros — chamam o que já existe:
// lib/faturamento/enviar.ts pendentes() (lembrete "não enviado"), orders.fat_carteira (pend de cadastro),
// orders.v_estoque_item + lib/estoque.ts alarme() e orders.cadastros_duplicidades_v2.
import { supaAdmin } from "@/lib/supabase-admin";
import { pendentes } from "@/lib/faturamento/enviar";
import { alarme, type ItemEstoque } from "@/lib/estoque";
import type { ConfigOrdem } from "../config";
import type { ItemDetectado } from "../tipos";
import type { Resultado } from "./compras";
import {
  detetarAbaixoMinimo, detetarDuplicados, detetarNaoEnviadosFat, detetarPendenciaCadastroFat,
  type DocCarteira, type ItemAbaixo,
} from "../regras-outros";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function detetarOutros(_cfg: ConfigOrdem, hoje: string): Promise<Resultado> {
  const itens: ItemDetectado[] = [];
  const tipos: string[] = [];
  const erros: Record<string, string> = {};
  const ord = () => supaAdmin().schema("orders");

  try { itens.push(...detetarNaoEnviadosFat((await pendentes(null)).docs, new Date().toISOString())); tipos.push("fat_nao_enviado"); }
  catch (e) { erros.fat_nao_enviado = msg(e); }

  try {
    const desde = new Date(Date.parse(hoje) - 180 * 86_400_000).toISOString().slice(0, 10);
    const docs: DocCarteira[] = [];
    for (const emp of ["SF", "CD", "WW"]) {
      const { data, error } = await ord().rpc("fat_carteira", { p_empresa: emp, p_desde: desde, p_busca: null });
      if (error) throw new Error(error.message);
      docs.push(...(((data as { docs?: DocCarteira[] } | null)?.docs ?? []).map((d) => ({ ...d, rotulo: `${emp} ${d.rotulo}` }))));
    }
    itens.push(...detetarPendenciaCadastroFat(docs));
    tipos.push("fat_pendencia_cadastro");
  } catch (e) { erros.fat_pendencia_cadastro = msg(e); }

  try {
    const xs: ItemAbaixo[] = [];
    for (let de = 0; de < 20000; de += 1000) {
      const { data, error } = await ord().from("v_estoque_item")
        .select("empresa, codigo, descricao, saldo, alarme_minimo, alarme_ponto_pedido, alarme_maximo, ativo")
        .not("alarme_minimo", "is", null).range(de, de + 999);
      if (error) throw new Error(error.message);
      for (const p of (data ?? []) as (ItemEstoque & { ativo?: boolean })[]) {
        if (p.ativo === false) continue;
        const [rot, tom] = alarme(p);
        if (tom === "crit") xs.push({ empresa: p.empresa, codigo: p.codigo, descricao: p.descricao, saldo: Number(p.saldo), minimo: Number(p.alarme_minimo), rotulo: rot });
      }
      if ((data ?? []).length < 1000) break;
    }
    itens.push(...detetarAbaixoMinimo(xs));
    tipos.push("est_abaixo_minimo");
  } catch (e) { erros.est_abaixo_minimo = msg(e); }

  try {
    const { data, error } = await ord().rpc("cadastros_duplicidades_v2", { p_lim: 500, p_aba: "provavel" });
    if (error) throw new Error(error.message);
    const gs = ((data as { grupos?: { membros?: { razao?: string }[] }[] } | null)?.grupos ?? []);
    itens.push(...detetarDuplicados(gs.length, gs.map((g) => g.membros?.[0]?.razao ?? "").filter(Boolean)));
    tipos.push("cad_duplicados");
  } catch (e) { erros.cad_duplicados = msg(e); }

  return { itens, tipos, erros };
}

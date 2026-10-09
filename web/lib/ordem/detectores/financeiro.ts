import "server-only";
// Detetores de Financeiro — os mesmos dados de Títulos a Pagar v3 (carregar(), com a
// sobreposição das regras de Compras), as previsões efetivas, as provisões, Receber v1
// e o resumo da conciliação. Só leitura (nenhuma destas funções escreve).
import { fin } from "@/lib/financeiro-baixas";
import { carregar } from "@/lib/financeiro-pagar-dados";
import type { ConfigOrdem } from "../config";
import type { ItemDetectado } from "../tipos";
import {
  detetarBloqueados, detetarConciliacao, detetarReceberVencido, detetarSemDocumento, detetarVencidosPagar,
  interpretarPagar, interpretarReceber, type ContaConciliacao,
} from "../regras-financeiro";
import type { Resultado } from "./compras";

const msg = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

async function excluidosOmie(): Promise<number> {
  let n = 0;
  for (let de = 0; de < 20000; de += 1000) {
    const { data, error } = await fin().rpc("titulos_excluidos_pendentes", {}).range(de, de + 999);
    if (error) throw error;
    const lote = (data ?? []) as { natureza: string }[];
    n += lote.filter((x) => x.natureza === "P").length;
    if (lote.length < 1000) break;
  }
  return n;
}

export async function detetarFinanceiro(cfg: ConfigOrdem, hoje: string): Promise<Resultado> {
  const erros: Record<string, string> = {};
  const itens: ItemDetectado[] = [];
  const tipos: string[] = [];
  const pagarTipos = ["titulo_bloqueado_sem_nf", "titulo_nf_sem_pedido", "titulo_nao_autorizado", "titulo_sem_documento", "titulo_vencido", "vencido_historico_omie"];
  try {
    const [dados, pv, prov, nExcl] = await Promise.all([
      carregar(),
      fin().rpc("pagar_v3_previsoes", {}),
      fin().rpc("pagar_provisoes", {}),
      excluidosOmie().catch(() => 0),
    ]);
    const ts = interpretarPagar(dados.rows as unknown[][], dados.hoje || hoje,
      (pv.data ?? {}) as Record<string, [string, boolean]>, (prov.data ?? {}) as Record<string, { nat?: string }>);
    itens.push(...detetarBloqueados(ts), ...detetarSemDocumento(ts, cfg),
      ...detetarVencidosPagar(ts, cfg, dados.agg as Record<string, Record<string, { n?: number; v?: number }>> | null, nExcl));
    tipos.push(...pagarTipos);
  } catch (e) { for (const t of pagarTipos) erros[t] = msg(e); }

  try {
    const { data, error } = await fin().rpc("receber_v1_dados", {});
    if (error) throw error;
    const d = data as { hoje: string; rows: unknown[][] };
    itens.push(...detetarReceberVencido(interpretarReceber(d.rows ?? [], d.hoje || hoje)));
    tipos.push("receber_vencido");
  } catch (e) { erros.receber_vencido = msg(e); }

  try {
    const de = new Date(Date.parse(hoje + "T12:00:00Z") - 90 * 86_400_000).toISOString().slice(0, 10);
    const { data, error } = await fin().rpc("conciliacao_resumo", { p_de: de, p_ate: hoje });
    if (error) throw error;
    itens.push(...detetarConciliacao((data ?? []) as ContaConciliacao[], hoje));
    tipos.push("extrato_a_conciliar");
  } catch (e) { erros.extrato_a_conciliar = msg(e); }

  return { itens, tipos, erros };
}

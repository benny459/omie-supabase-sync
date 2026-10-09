import "server-only";
// Detetores de Faturamento, Estoque e Cadastros — fase seguinte (roteiro do allka-em-dia).
import type { ConfigOrdem } from "../config";
import type { Resultado } from "./compras";

export async function detetarOutros(_cfg: ConfigOrdem, _hoje: string): Promise<Resultado> {
  return { itens: [], tipos: [], erros: {} };
}

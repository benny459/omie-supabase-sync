import "server-only";
// Detetores de Operação e Projetos — fase seguinte (roteiro do allka-em-dia).
import type { ConfigOrdem } from "../config";
import type { Resultado } from "./compras";

export async function detetarOperacao(_cfg: ConfigOrdem, _hoje: string): Promise<Resultado> {
  return { itens: [], tipos: [], erros: {} };
}

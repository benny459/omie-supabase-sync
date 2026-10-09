// Atribuição de cliente(s) a PC standalone — regras puras (09/10/26).
//
// Bug relatado pela Cris (PC 7388 e outros PCs do Compras do painel): "atribuí aos clientes mas
// não está salvando". Desde 02/10 nenhuma gravação chegou à tabela platform.pc_cliente_atribuicao
// — o modal engolia os erros: busca de cliente que falhava (sessão expirada, 500) aparecia como
// "Nenhum resultado", o botão Salvar ficava cinza sem dizer porquê, clique fora do modal fechava
// e descartava a escolha sem aviso, e depois de salvar a lista só mudava quando um GET pesado
// (varre approval.v_pc_pcs inteira) voltava — se falhasse, o botão continuava "Atribuir cliente".
// Agora: o POST devolve o que ficou gravado (lido de volta do banco), a tela usa isso na hora, e
// todo erro vira uma frase que diz o que fazer. Testado em scripts/testes/pc-atribuicao.test.ts.

export type AtribEntrada = { codigo_cliente_omie: number; percentual: number };
export type AtribCliente = { codigo_cliente_omie: number; nome: string; percentual: number };
export type AtribInfo = { qtd: number; soma_pct: number; clientes: AtribCliente[] };

/** Chave do mapa usado nas telas: "SF|7388". */
export const chaveAtrib = (empresa: unknown, pc: unknown) => `${String(empresa ?? "").trim() || "SF"}|${String(pc ?? "").trim()}`;

export const somaPct = (a: { percentual: unknown }[]) =>
  Math.round(a.reduce((s, x) => s + (Number(x.percentual) || 0), 0) * 100) / 100;

export const somaFecha = (a: { percentual: unknown }[]) => Math.abs(somaPct(a) - 100) < 0.01;

/** Valida o pedido de gravação; devolve a frase para o usuário ou null quando está tudo certo. */
export function validarAtribuicoes(atribs: unknown): string | null {
  if (!Array.isArray(atribs) || atribs.length === 0) return "Escolha pelo menos 1 cliente na busca antes de salvar.";
  const vistos = new Set<number>();
  for (const a of atribs as Partial<AtribEntrada>[]) {
    const cod = Number(a?.codigo_cliente_omie);
    if (!Number.isFinite(cod) || cod <= 0) return "Cliente inválido na lista — remova-o e escolha de novo na busca.";
    if (vistos.has(cod)) return "O mesmo cliente aparece duas vezes — remova a repetição.";
    vistos.add(cod);
    const p = Number(a?.percentual);
    if (!(p > 0 && p <= 100)) return "Cada cliente precisa de um percentual entre 0,01% e 100%.";
  }
  const soma = somaPct(atribs as AtribEntrada[]);
  if (Math.abs(soma - 100) > 0.01) return `A soma dos percentuais precisa dar 100% (está em ${soma.toFixed(2).replace(".", ",")}%).`;
  return null;
}

/** Por que o botão Salvar está desligado — texto curto mostrado ao lado dele. */
export function motivoSalvarDesligado(rows: { percentual: unknown }[], salvando: boolean): string | null {
  if (salvando) return null;
  if (rows.length === 0) return "Busque e escolha o cliente abaixo para poder salvar.";
  if (!somaFecha(rows)) return `A soma precisa dar 100% (está em ${somaPct(rows).toFixed(2).replace(".", ",")}%) — use "Distribuir igual" ou ajuste os valores.`;
  return null;
}

/** Erro HTTP → frase que guia o usuário (nunca "Unexpected token <" ou "Failed to fetch"). */
export function mensagemErroAtrib(status: number, corpo: unknown, acao: "salvar" | "buscar" | "carregar" | "limpar" = "salvar"): string {
  const err = corpo && typeof corpo === "object" && "error" in corpo ? String((corpo as { error: unknown }).error ?? "") : "";
  const verbo = { salvar: "Não salvou", buscar: "A busca de clientes falhou", carregar: "Não carregou os clientes atribuídos", limpar: "Não limpou" }[acao];
  if (status === 401) return `${verbo}: sua sessão expirou. Recarregue a página (F5), entre de novo e repita.`;
  if (status === 403) return `${verbo}: seu usuário não tem permissão para isso. Peça acesso ao Benny.`;
  if (status === 0) return `${verbo}: sem conexão com o servidor. Confira a internet e tente de novo.`;
  if (status === 400 && err) return `${verbo}: ${err}`;
  if (status >= 500 || status === 504) return `${verbo} (erro ${status} no servidor${err ? `: ${err}` : ""}). Tente de novo; se repetir, avise o suporte com o nº do PC.`;
  return `${verbo}${err ? `: ${err}` : ` (erro ${status})`}.`;
}

/** Lê a resposta sem quebrar quando o servidor devolve HTML (504, página de login…). */
export async function lerJson(r: Response): Promise<unknown> {
  const txt = await r.text();
  try { return txt ? JSON.parse(txt) : {}; } catch { return { error: txt.slice(0, 160) }; }
}

/** Monta o mapa "empresa|pc" → info a partir das linhas cruas de platform.pc_cliente_atribuicao. */
export function montarMapaAtrib(linhas: { empresa: unknown; pc_numero: unknown; codigo_cliente_omie: unknown; percentual: unknown; nome?: unknown }[],
  nomes?: Map<number, string>): Map<string, AtribInfo> {
  const m = new Map<string, AtribInfo>();
  for (const l of linhas) {
    const k = chaveAtrib(l.empresa, l.pc_numero);
    const cod = Number(l.codigo_cliente_omie);
    const cli: AtribCliente = { codigo_cliente_omie: cod, nome: String(l.nome ?? nomes?.get(cod) ?? `Omie #${cod}`), percentual: Number(l.percentual) };
    const cur = m.get(k) ?? { qtd: 0, soma_pct: 0, clientes: [] };
    cur.clientes.push(cli);
    cur.qtd = cur.clientes.length;
    cur.soma_pct = somaPct(cur.clientes);
    m.set(k, cur);
  }
  return m;
}

/** O que o banco devolveu bate com o que foi pedido? (confirmação real depois do POST) */
export function confereGravacao(pedido: AtribEntrada[], gravado: { codigo_cliente_omie: unknown; percentual: unknown }[]): boolean {
  if (pedido.length !== gravado.length) return false;
  const g = new Map(gravado.map((x) => [Number(x.codigo_cliente_omie), Number(x.percentual)]));
  return pedido.every((p) => g.has(Number(p.codigo_cliente_omie)) && Math.abs((g.get(Number(p.codigo_cliente_omie)) ?? -1) - Number(p.percentual)) < 0.01);
}

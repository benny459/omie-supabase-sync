// Central de Ordem — comandos em linguagem natural (PURO). Determinístico de propósito:
// verbo + assunto → tipos de pendência + filtro. Nada executa aqui; a rota mostra a
// pré-visualização (quantos itens, de quem, quantos ficaram de fora por falta de acesso)
// e só executa depois de "Confirmar N".
import type { ModuloOrdem } from "./tipos";

export type Interpretacao = {
  ok: boolean;
  frase: string;                    // o que a Aria entendeu
  tipos: string[];
  filtro?: { texto?: string[]; diasMin?: number };
  modo: "executar" | "encaminhar" | "abrir";
};

const sem = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

export const SUGESTOES: { texto: string; modulo: ModuloOrdem }[] = [
  { texto: "casar as NF da coluna do meio", modulo: "compras" },
  { texto: "enviar os PCs aprovados", modulo: "compras" },
  { texto: "cobrar fornecedores com entrega atrasada > 7 dias", modulo: "compras" },
  { texto: "aprovar os PCs do PJ364 dentro do budget", modulo: "compras" },
  { texto: "conciliar o extrato do Omie.CASH", modulo: "financeiro" },
  { texto: "pedir as NF dos títulos bloqueados", modulo: "financeiro" },
  { texto: "regularizar as NF sem pedido", modulo: "financeiro" },
  { texto: "faturar o que já pode faturar", modulo: "operacao" },
  { texto: "aprovar o que vence esta semana nos projetos", modulo: "projetos" },
];

export function interpretar(texto: string): Interpretacao {
  const t = sem(texto.trim());
  const nada: Interpretacao = { ok: false, frase: "Não entendi. Experimente uma das sugestões.", tipos: [], modo: "abrir" };
  if (t.length < 4) return nada;
  const projs = [...texto.matchAll(/\b(PJ\s?\d+|CT\d+\w*|\d{2}_[A-Z]+)\b/gi)].map((m) => m[1].replace(/\s/g, "").toLowerCase());
  const dias = Number(/(?:>|mais de|acima de)\s*(\d+)\s*dias?/.exec(t)?.[1] ?? 0) || undefined;

  if (/casar|coluna do meio/.test(t)) return { ok: true, frase: "Casar as NF que batem com o PC (lote dentro da tolerância).", tipos: ["nf_casar_lote"], modo: "executar" };
  if (/enviar|mandar/.test(t) && /pc|pedido/.test(t)) return { ok: true, frase: "Enviar ao fornecedor os PCs aprovados e ainda não enviados.", tipos: ["pc_nao_enviado"], modo: "executar" };
  if (/cobrar/.test(t) && /fornecedor|entrega|atras/.test(t)) return { ok: true, frase: `Cobrar fornecedores com entrega atrasada${dias ? ` há mais de ${dias} dias` : ""}.`, tipos: ["entrega_atrasada"], filtro: { diasMin: dias }, modo: "executar" };
  if (/concili/.test(t)) {
    const conta = /extrato d[oa]\s+([\w.\- ]+)/.exec(t)?.[1]?.trim();
    return { ok: true, frase: `Aceitar as sugestões de conciliação${conta ? ` da conta ${conta}` : ""}.`, tipos: ["extrato_a_conciliar"], filtro: conta ? { texto: [conta] } : undefined, modo: "executar" };
  }
  if (/(pedir|cobrar).*(nf|nota).*(bloque)|titulos bloqueados/.test(t)) return { ok: true, frase: "Encaminhar a Compras o pedido das NF dos títulos bloqueados.", tipos: ["titulo_bloqueado_sem_nf"], modo: "encaminhar" };
  if (/sem pedido|retroativ|regulariz/.test(t)) return { ok: true, frase: "Encaminhar a Compras o PC retroativo das NF sem pedido.", tipos: ["titulo_nf_sem_pedido"], modo: "encaminhar" };
  if (/faturar/.test(t)) return { ok: true, frase: "Encaminhar ao Faturamento os pedidos que já podem faturar.", tipos: ["op_pode_faturar"], modo: "encaminhar" };
  if (/aprov/.test(t)) {
    if (/vence|aprovar ate|semana/.test(t)) return { ok: true, frase: "Mostrar os PCs de projeto com “aprovar até” nesta semana.", tipos: ["pj_aprovar_ate"], modo: "abrir" };
    return { ok: true, frase: `Aprovar PCs pendentes${projs.length ? ` de ${projs.join(", ").toUpperCase()}` : ""} — dentro da alçada e do budget (a rota decide cada um).`,
      tipos: ["pc_pendente_aprovacao", "pj_pc_pendente"], filtro: projs.length ? { texto: projs } : undefined, modo: "executar" };
  }
  return nada;
}

/** Aplica o filtro do comando a um item (texto no título/origem; atraso mínimo nos PCs do item). */
export function casaFiltro(it: { titulo: string; origem_ref: string; dados?: Record<string, unknown> | null }, f: Interpretacao["filtro"], hoje: string): boolean {
  if (!f) return true;
  if (f.texto?.length) {
    const alvo = sem(`${it.titulo} ${it.origem_ref}`).replace(/\s/g, "");
    if (!f.texto.some((x) => alvo.includes(sem(x).replace(/\s/g, "")))) return false;
  }
  if (f.diasMin) {
    const pcs = (it.dados?.pcs as { previsao?: string }[] | undefined) ?? [];
    const pior = Math.max(0, ...pcs.map((p) => (p.previsao ? Math.round((Date.parse(hoje) - Date.parse(p.previsao)) / 86_400_000) : 0)));
    if (pior <= f.diasMin) return false;
  }
  return true;
}

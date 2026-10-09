// Central de Ordem — tipos partilhados (cliente e servidor). 09/10/26.
// SPEC-allka-em-dia-central-de-ordem.md §3.3 (modelo do item) e §0.2 (cartão de decisão).

export type ModuloOrdem =
  | "compras" | "financeiro" | "operacao" | "projetos" | "faturamento" | "estoque" | "cadastros" | "comercial" | "servicos";

export type Urgencia = "critica" | "atencao";
export type Confianca = "alta" | "media" | "baixa";
export type EstadoItem = "aberto" | "feito" | "recusado" | "adiado" | "encaminhado";

/** Contrato do cartão de decisão (SPEC de Serviços §0.2). */
export type Recomendacao = {
  acao: string;                 // uma ação concreta, numa frase
  porque: string;               // evidência
  impacto?: string;             // o que muda se aceitar
  alternativas?: { acao: string; nota?: string }[];   // até 2
  confianca: Confianca;
  risco?: string;
  conferir?: string[];          // checklist de pontos a conferir
};

/** Chamada a uma rota EXISTENTE do painel. `lote` = uma chamada por corpo (a rota só aceita um de cada vez). */
export type ChamadaRota = { metodo: "POST" | "PATCH"; caminho: string; corpo: Record<string, unknown>; lote?: Record<string, unknown>[] };

/** Ação executável associada a um item (passa SEMPRE por uma rota existente). */
export type AcaoItem = {
  chave: string;                // ex.: compras.aprovar — interruptor por ação na configuração
  rotulo: string;               // texto do botão "Aceitar"
  /** Só pré-visualização: a Central mostra o que a rota faria, sem executar. */
  irreversivel?: boolean;
  /** Pedido à rota existente: método, caminho e corpo. Sem isto, só "Abrir na tela". */
  rota?: ChamadaRota;
  /** Como desfazer, se a rota existente tiver o caminho inverso. */
  desfazer?: ChamadaRota | null;
};

/** O que um detetor devolve. Textos com valores usam {{R$:123.45}} — o servidor mascara para quem não vê valores. */
export type ItemDetectado = {
  tipo: string;
  modulo: ModuloOrdem;
  origem_ref: string;
  titulo: string;
  resumo?: string;
  etapa?: string;
  valor?: number | null;
  urgencia: Urgencia;
  rotulo_urgencia?: string;
  link?: string;
  recomendacao: Recomendacao;
  dados?: Record<string, unknown>;
  depende_de?: { modulo: ModuloOrdem; papel: string; tipo_destino?: string } | null;
  /** Permissões finas extra (além do módulo) para ver ESTE item — ex.: financeiro.ver_receber. */
  requer?: string[];
  /** Dono sugerido pelo próprio dado (ex.: aprovador do PC, quem emitiu). E-mail. */
  dono_email?: string | null;
  acao?: AcaoItem | null;
};

/** Item como a API o devolve à tela (já filtrado e mascarado para quem pede). */
export type ItemTela = {
  id: string;
  tipo: string;
  modulo: ModuloOrdem;
  origem_ref: string;
  titulo: string;
  resumo: string | null;
  etapa: string | null;
  valor: number | null;
  urgencia: Urgencia | null;
  rotulo_urgencia: string | null;
  link: string | null;
  recomendacao: Recomendacao;
  depende_de: ItemDetectado["depende_de"];
  estado: EstadoItem;
  degrau: number;
  dono_id: string | null;
  dono_nome: string | null;
  meu: boolean;
  criado_em: string;
  adiado_ate: string | null;
  encaminhado_de: string | null;
  encaminhado_por_nome: string | null;
  /** Só para o admin enquanto o detetor/módulo está desligado. */
  previa?: boolean;
  acao?: { chave: string; rotulo: string; ligada: boolean; podeExecutar: boolean; motivo?: string | null; irreversivel?: boolean } | null;
  externo?: boolean;            // item vindo de outro sistema (CRM): só "Abrir ↗"
  /** Estado do item de destino, para quem encaminhou (só o estado, nunca os dados). */
  destino?: { estado: EstadoItem; modulo: ModuloOrdem; dono_nome: string | null; motivo?: string | null } | null;
};

export const ROTULO_ESTADO: Record<EstadoItem, string> = {
  aberto: "Aberto", feito: "Feito", recusado: "Recusado", adiado: "Adiado", encaminhado: "Encaminhado",
};

/** Mascara/formata {{R$:123.45}} num texto. */
export function renderValores(txt: string | null | undefined, podeVer: boolean): string {
  if (!txt) return "";
  return txt.replace(/\{\{R\$:(-?[\d.]+)\}\}/g, (_m, v) => {
    if (!podeVer) return "R$ •••";
    const n = Number(v);
    return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  });
}

/** Marca um valor para o texto de um item: R$ formatado no servidor conforme quem vê. */
export const R = (v: number | null | undefined) => `{{R$:${Number(v ?? 0).toFixed(2)}}}`;

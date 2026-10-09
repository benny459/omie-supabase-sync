// Central de Ordem — os módulos e o mapa módulo → camada de permissão que a tela de hoje usa.
// SPEC §4.2: este mapa vive num só sítio. Confirmado no código em 09/10/26:
//   compras      → /erp/compras            requirePermissao("compras.acesso")      (área ERP + chave)
//   financeiro   → /financeiro/pagar|receber requirePermissao("financeiro.ver_pagar"|"ver_receber")
//   faturamento  → /faturamento            requirePermissao("faturamento.acesso")
//   estoque      → /estoque                requirePermissao("estoque.acesso")
//   cadastros    → /cadastros/*            requireArea("erp")
//   operacao     → /avulsos, /pcs          menu da área "operacao" (canViewArea)
//   projetos     → /projetos               menu da área "operacao" (canViewArea)
//   comercial    → CRM legado (Propostas-WW): o painel não guarda o acesso ao CRM —
//                  quem decide é o próprio CRM (/api/ordem-comercial devolve [] a quem não tem).
//   servicos     → app de Serviços (waterworks-app): decide o próprio app (/api/ciclo/central?email=).
import type { ModuloOrdem } from "./tipos";

export type DefModulo = {
  id: ModuloOrdem;
  rotulo: string;
  sub: string;
  emDia: string;                // "Em dia quando…"
  ciclo: string[];
  quentes: string[];            // etapas onde costuma travar
  tela: string;                 // tela tradicional
  externo?: boolean;
};

export const MODULOS: DefModulo[] = [
  { id: "compras", rotulo: "Compras", sub: "Requisições, pedidos, notas fiscais e fornecedores",
    emDia: "nenhuma NF parada na coluna do meio, nenhum PC aprovado sem envio e nenhuma entrega vencida sem nova data.",
    ciclo: ["Requisição", "Pedido de compra", "Aprovação", "Enviado ao fornecedor", "Faturado pelo fornecedor", "Recebido", "Conferido", "Pago"],
    quentes: ["Aprovação", "Faturado pelo fornecedor"], tela: "/erp/compras" },
  { id: "financeiro", rotulo: "Financeiro", sub: "Títulos a pagar e a receber, documentos e conciliação",
    emDia: "nenhum título vence sem documento nem autorização, nenhum vencido fica sem plano e o extrato está conciliado até ontem.",
    ciclo: ["Título lançado", "Documento (NF)", "Autorizado", "Agendado", "Pago", "Conciliado"],
    quentes: ["Documento (NF)", "Conciliado"], tela: "/financeiro/pagar" },
  { id: "operacao", rotulo: "Operação", sub: "Vendas avulsas, PCs e OS",
    emDia: "todo pedido que pode faturar vira nota no mesmo dia, e nenhum pedido de serviço fica sem OS.",
    ciclo: ["PV / OS", "RC", "PC", "Aprovação", "Materiais", "Serviço", "Pode faturar", "NF de saída"],
    quentes: ["Pode faturar", "Materiais"], tela: "/avulsos" },
  { id: "projetos", rotulo: "Projetos", sub: "Etapas, aprovações no tempo certo e budget",
    emDia: "nenhum item fica sem aprovação depois do “aprovar até”, nenhuma etapa vencida fica sem nova data e nenhuma compra passa do budget sem decisão.",
    ciclo: ["PV", "RC", "PC", "Aprovação", "Materiais", "Serviço", "NF"],
    quentes: ["Aprovação", "Materiais"], tela: "/projetos" },
  { id: "faturamento", rotulo: "Faturamento", sub: "Carteira de PV/OS, emissão e envio ao cliente",
    emDia: "o que pode faturar vira nota no mesmo dia e toda nota emitida é enviada ao cliente.",
    ciclo: ["Carteira", "Pode faturar", "Emitida", "Enviada ao cliente", "Recebida"],
    quentes: ["Pode faturar", "Enviada ao cliente"], tela: "/faturamento" },
  { id: "estoque", rotulo: "Estoque", sub: "Itens, saldo, reposição e separação",
    emDia: "nenhum técnico sai sem material e nenhum item fica abaixo do mínimo sem pedido.",
    ciclo: ["Requisição", "Separação", "Entregue", "Baixa"],
    quentes: ["Separação"], tela: "/estoque" },
  { id: "cadastros", rotulo: "Cadastros", sub: "Clientes, fornecedores e itens",
    emDia: "não há cadastro duplicado nem incompleto que quebre NF, casamento ou faturamento.",
    ciclo: ["Novo cadastro", "Completo", "Validado"],
    quentes: ["Completo"], tela: "/cadastros/clientes" },
  { id: "comercial", rotulo: "Comercial", sub: "Oportunidades e propostas (CRM)",
    emDia: "nenhuma oportunidade sem próxima ação e nenhuma proposta acima do SLA da etapa.",
    ciclo: ["Abertura", "CP", "MC", "Enviada", "Negociação", "Ganha / Perdida"],
    quentes: ["Enviada"], tela: "https://propostas-ww.vercel.app", externo: true },
  { id: "servicos", rotulo: "Serviços", sub: "Chamados, OS e agenda (app de Serviços)",
    emDia: "nenhum chamado fora do SLA sem plano, nenhuma OS por revisar e nenhum vencimento sem pedido.",
    ciclo: ["Ler a OS", "Classificar", "Revisar OS", "Planejar", "Liberar", "Agendar", "Conferir"],
    quentes: ["Revisar OS", "Agendar"], tela: "https://app.waterworks.com.br/chamados", externo: true },
];

export const MODULO_POR_ID: Record<ModuloOrdem, DefModulo> =
  Object.fromEntries(MODULOS.map((m) => [m.id, m])) as Record<ModuloOrdem, DefModulo>;

export const ehModulo = (x: unknown): x is ModuloOrdem => typeof x === "string" && x in MODULO_POR_ID;

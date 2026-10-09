// Central de Ordem — catálogo dos detetores e das ações (para a configuração e o manual).
// Cada detetor tem um interruptor; cada ação também. Tudo nasce desligado.
import type { ModuloOrdem } from "./tipos";

export type DefDetetor = { tipo: string; modulo: ModuloOrdem; rotulo: string; fonte: string; donoPadrao?: string; papel: string; destino?: true };

/** donoPadrao = quem a lógica de hoje já indica (avulsos-report.ts / campo do próprio dado). Só fallback. */
export const DETETORES: DefDetetor[] = [
  // Compras
  { tipo: "nf_casar_lote", modulo: "compras", rotulo: "NF que casam com o PC (lote, dentro da tolerância)", fonte: "orders.compras_nfs_sugeridas + compras_nfs_do_pedido (Focus)", papel: "recebimento" },
  { tipo: "nf_divergente", modulo: "compras", rotulo: "NF com valor diferente do PC (fora da tolerância)", fonte: "orders.compras_nfs_do_pedido", papel: "recebimento" },
  { tipo: "pc_pendente_aprovacao", modulo: "compras", rotulo: "PCs pendentes de aprovação (por projeto)", fonte: "orders.compras_lista — coluna “Pedido de Compra · Pendentes”", papel: "aprovador" },
  { tipo: "pc_nao_enviado", modulo: "compras", rotulo: "PC aprovado e não enviado", fonte: "lib/compras.ts naoEnviado (chip “✉ Não enviados”)", papel: "comprador" },
  { tipo: "entrega_atrasada", modulo: "compras", rotulo: "Entrega atrasada (por fornecedor)", fonte: "lib/compras.ts atrasado (chip “⚠ Entrega atrasada”)", papel: "comprador" },
  { tipo: "recebido_nao_conferido", modulo: "compras", rotulo: "Recebido e não conferido", fonte: "orders.compras_lista etapa 60", papel: "recebimento" },
  { tipo: "nf_sem_pedido", modulo: "compras", rotulo: "NF chegou sem pedido", fonte: "orders.compras_nfs_sem_pedido (alarme ⛔)", papel: "comprador" },
  // Financeiro
  { tipo: "titulo_bloqueado_sem_nf", modulo: "financeiro", rotulo: "Bloqueados à espera de NF", fonte: "finance.pagar_v3_dados + compras_fases_pagar (KPI Bloqueados)", papel: "financeiro" },
  { tipo: "titulo_nf_sem_pedido", modulo: "financeiro", rotulo: "Títulos com NF sem pedido", fonte: "compras_nf_sem_pedido_resumo (KPI Bloqueados)", papel: "financeiro" },
  { tipo: "titulo_nao_autorizado", modulo: "financeiro", rotulo: "Títulos não autorizados (PC sem aprovação)", fonte: "finance.pagar_v3_dados st=bloq", papel: "financeiro" },
  { tipo: "titulo_sem_documento", modulo: "financeiro", rotulo: "Vencem em N dias sem documento", fonte: "finance.pagar_provisoes (KPI Vencendo sem documento)", papel: "financeiro" },
  { tipo: "titulo_vencido", modulo: "financeiro", rotulo: "Vencidos a pagar sem baixa", fonte: "pagar_v3_dados (KPI Vencidos 60d)", papel: "financeiro" },
  { tipo: "vencido_historico_omie", modulo: "financeiro", rotulo: "Separar histórico/lixo do Omie (M4)", fonte: "pagar_v3_dados agg + titulos_excluidos_pendentes", papel: "financeiro" },
  { tipo: "receber_vencido", modulo: "financeiro", rotulo: "A receber vencido (por cliente)", fonte: "finance.receber_v1_dados (KPI Precisa de ação)", papel: "financeiro" },
  { tipo: "extrato_a_conciliar", modulo: "financeiro", rotulo: "Movimentos do extrato a conciliar", fonte: "finance.conciliacao_resumo (90 dias)", papel: "financeiro" },
  // Operação (Avulsos) — os 15 alarmes de lib/alarmes.ts; dono de hoje = ALARM_OWNERS (avulsos-report.ts)
  { tipo: "op_pvos_incompl", modulo: "operacao", rotulo: "PV/OS incompletas", fonte: "lib/alarmes.ts pvos_incompl (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "operacao" },
  { tipo: "op_sem_projeto", modulo: "operacao", rotulo: "Sem projeto", fonte: "lib/alarmes.ts sem_projeto (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "operacao" },
  { tipo: "op_aguarda_liberacao", modulo: "operacao", rotulo: "Aguardando liberação do cliente", fonte: "lib/alarmes.ts aguarda_liberacao (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "operacao" },
  { tipo: "op_venda", modulo: "operacao", rotulo: "Vendas em atraso", fonte: "lib/alarmes.ts venda (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "operacao" },
  { tipo: "op_sem_rc", modulo: "operacao", rotulo: "Faltam RCs", fonte: "lib/alarmes.ts sem_rc (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "comprador" },
  { tipo: "op_aprov_pend", modulo: "operacao", rotulo: "Aprovações pendentes", fonte: "lib/alarmes.ts aprov_pend (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "aprovador" },
  { tipo: "op_aprov_bloq", modulo: "operacao", rotulo: "Aprovações bloqueadas", fonte: "lib/alarmes.ts aprov_bloq (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "aprovador" },
  { tipo: "op_sem_pc", modulo: "operacao", rotulo: "Faltam PCs", fonte: "lib/alarmes.ts sem_pc (relatório de Avulsos)", donoPadrao: "Erick", papel: "comprador" },
  { tipo: "op_compra", modulo: "operacao", rotulo: "Compra com previsão atrasada", fonte: "lib/alarmes.ts compra (relatório de Avulsos)", donoPadrao: "Erick", papel: "comprador" },
  { tipo: "op_defas_omie", modulo: "operacao", rotulo: "Defasagem de aprovação Omie", fonte: "lib/alarmes.ts defas_omie (relatório de Avulsos)", donoPadrao: "Erick", papel: "comprador" },
  { tipo: "op_sem_vinculo", modulo: "operacao", rotulo: "OS não ligada", fonte: "lib/alarmes.ts sem_vinculo (relatório de Avulsos)", donoPadrao: "Cristina", papel: "operacao" },
  { tipo: "op_agend_vazio", modulo: "operacao", rotulo: "Serviço sem previsão", fonte: "lib/alarmes.ts agend_vazio (relatório de Avulsos)", donoPadrao: "Cristina", papel: "operacao" },
  { tipo: "op_agend_venc", modulo: "operacao", rotulo: "Previsão de serviço vencida", fonte: "lib/alarmes.ts agend_venc (relatório de Avulsos)", donoPadrao: "Cristina", papel: "operacao" },
  { tipo: "op_pode_faturar", modulo: "operacao", rotulo: "Pronto para faturar", fonte: "lib/alarmes.ts pode_faturar (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "faturamento" },
  { tipo: "op_retido_cliente", modulo: "operacao", rotulo: "Retido no cliente", fonte: "lib/alarmes.ts retido_cliente (relatório de Avulsos)", donoPadrao: "Fernanda", papel: "faturamento" },
  // Projetos
  { tipo: "pj_pc_pendente", modulo: "projetos", rotulo: "PCs de projeto de obra (PJ) pendentes", fonte: "orders.compras_lista (aprovação pelo caminho Projetos)", papel: "aprovador" },
  { tipo: "pj_etapa_atrasada", modulo: "projetos", rotulo: "Etapas vencidas sem nova data", fonte: "approval.projeto_etapas", papel: "supervisao" },
  { tipo: "pj_aprovar_ate", modulo: "projetos", rotulo: "PCs perto/depois do “aprovar até”", fonte: "approval.v_pc_projetos aprovar_ate_calc", papel: "aprovador" },
  { tipo: "pj_acima_budget", modulo: "projetos", rotulo: "Compras acima do budget", fonte: "lib/aprovacao-projeto.ts contextoProjeto", papel: "aprovador" },
  // Faturamento
  { tipo: "fat_nao_enviado", modulo: "faturamento", rotulo: "Documento emitido e não enviado ao cliente", fonte: "lib/faturamento/enviar.ts pendentes", papel: "faturamento" },
  { tipo: "fat_pendencia_cadastro", modulo: "faturamento", rotulo: "Pode faturar mas falta dado do cliente", fonte: "orders.fat_carteira pend", papel: "faturamento" },
  // Estoque
  { tipo: "est_abaixo_minimo", modulo: "estoque", rotulo: "Itens abaixo do mínimo", fonte: "orders.v_estoque_item + lib/estoque.ts alarme", papel: "estoque" },
  // Cadastros
  { tipo: "cad_duplicados", modulo: "cadastros", rotulo: "Cadastros duplicados prováveis", fonte: "orders.cadastros_duplicidades_v2", papel: "cadastros" },
  // Destinos de encaminhamento (não são detetores: nascem quando alguém encaminha; ligam-se com "Encaminhar")
  { tipo: "enc:pedir_nf_fornecedor", modulo: "compras", rotulo: "↘ Pedir NF ao fornecedor (vem do Financeiro)", fonte: "encaminhamento", papel: "comprador", destino: true },
  { tipo: "enc:pc_retroativo", modulo: "compras", rotulo: "↘ PC retroativo de NF sem pedido (vem do Financeiro)", fonte: "encaminhamento", papel: "comprador", destino: true },
  { tipo: "enc:aprovar_pc_titulo", modulo: "compras", rotulo: "↘ Aprovar PCs de títulos bloqueados (vem do Financeiro)", fonte: "encaminhamento", papel: "aprovador", destino: true },
  { tipo: "enc:livre:compras", modulo: "compras", rotulo: "↘ Pedido livre para Compras", fonte: "encaminhamento", papel: "comprador", destino: true },
  { tipo: "enc:livre:financeiro", modulo: "financeiro", rotulo: "↘ Pedido livre para o Financeiro", fonte: "encaminhamento", papel: "financeiro", destino: true },
  { tipo: "enc:livre:operacao", modulo: "operacao", rotulo: "↘ Pedido livre para a Operação", fonte: "encaminhamento", papel: "operacao", destino: true },
  { tipo: "enc:livre:projetos", modulo: "projetos", rotulo: "↘ Pedido livre para Projetos", fonte: "encaminhamento", papel: "supervisao", destino: true },
  { tipo: "enc:livre:faturamento", modulo: "faturamento", rotulo: "↘ Pedido livre para o Faturamento", fonte: "encaminhamento", papel: "faturamento", destino: true },
  { tipo: "enc:livre:estoque", modulo: "estoque", rotulo: "↘ Pedido livre para o Estoque", fonte: "encaminhamento", papel: "estoque", destino: true },
  { tipo: "enc:livre:cadastros", modulo: "cadastros", rotulo: "↘ Pedido livre para Cadastros", fonte: "encaminhamento", papel: "cadastros", destino: true },
];

/** Recomendação do item de destino, por tipo de encaminhamento. */
export const ACAO_DESTINO: Record<string, string> = {
  pedir_nf_fornecedor: "Pedir a NF a cada fornecedor (com o PC em anexo) e prazo de 3 dias; quando chegar, casar e conferir.",
  pc_retroativo: "Gerar o PC retroativo a partir de cada NF (vai à aprovação de quem tem alçada), ou casar com o PC certo.",
  aprovar_pc_titulo: "Aprovar (ou reprovar com motivo) os PCs destes títulos para o Financeiro poder pagar.",
};

export const DETETOR_POR_TIPO = Object.fromEntries(DETETORES.map((d) => [d.tipo, d])) as Record<string, DefDetetor>;

export type DefAcao = { chave: string; modulo: ModuloOrdem; rotulo: string; rota: string; envia?: string };

export const ACOES: DefAcao[] = [
  { chave: "compras.aprovar", modulo: "compras", rotulo: "Aprovar PCs (alçada e budget pela rota de sempre)", rota: "POST /api/compras/acao {acao:aprovar}" },
  { chave: "compras.casar_nf", modulo: "compras", rotulo: "Casar NF ↔ PC (com desfazer)", rota: "POST /api/compras/acao {acao:nf_casar}" },
  { chave: "compras.enviar_fornecedor", modulo: "compras", rotulo: "Enviar PC ao fornecedor (e-mail com PDF)", rota: "POST /api/compras/email", envia: "e-mail ao fornecedor" },
  { chave: "compras.cobrar_fornecedor", modulo: "compras", rotulo: "Cobrar fornecedor na conversa do PC", rota: "POST /api/compras/email/conversa", envia: "e-mail ao fornecedor" },
  { chave: "financeiro.conciliar", modulo: "financeiro", rotulo: "Aceitar sugestões de conciliação (score ≥ 80)", rota: "POST /api/financeiro/conciliacao {acao:aceitar_lote}" },
  ];

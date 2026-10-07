// Catálogo das permissões finas (03/10/26). Fonte única para a tela
// "Usuários e acessos", para as rotas (lib/acessos.ts) e para a UI esconder
// o que a pessoa não pode ver. O banco (platform.permissoes_catalogo) só
// espelha estas chaves para a FK das escolhas.

export type ModuloPerm = "compras" | "estoque" | "financeiro" | "faturamento";

export type Chave =
  | "compras.acesso" | "compras.ver_valores" | "compras.aprovar" | "compras.gerar_pc_nf"
  | "compras.dispensar_nf" | "compras.conferir" | "compras.enviar_fornecedor"
  | "estoque.acesso" | "estoque.ver_custos" | "estoque.ajustar" | "estoque.mesclar"
  | "estoque.senha_inventario" | "estoque.codigos" | "estoque.config_mov" | "estoque.aprovar_perdas"
  | "estoque.separar_projeto"
  | "faturamento.acesso" | "faturamento.sem_proposta" | "faturamento.homologacao"
  | "financeiro.ver_pagar" | "financeiro.ver_receber" | "financeiro.editar_titulo"
  | "financeiro.baixar" | "financeiro.conciliar";

/** Como o padrão (sem escolha explícita) é calculado — reproduz o que cada um podia fazer até hoje. */
export type Padrao = "erp" | "aprovador" | "admin";

export type ItemCatalogo = { chave: Chave; modulo: ModuloPerm; rotulo: string; descricao: string; padrao: Padrao };

export const CATALOGO: ItemCatalogo[] = [
  { chave: "compras.acesso",            modulo: "compras", rotulo: "Abrir Compras",                 descricao: "Requisições e pedidos de compra",                 padrao: "erp" },
  { chave: "compras.ver_valores",       modulo: "compras", rotulo: "Ver valores e preços",          descricao: "Valores dos pedidos, preços e histórico de preço", padrao: "erp" },
  { chave: "compras.aprovar",           modulo: "compras", rotulo: "Aprovar pedido",                descricao: "Respeita a alçada de cada um",                     padrao: "aprovador" },
  { chave: "compras.gerar_pc_nf",       modulo: "compras", rotulo: "Gerar pedido a partir da NF",   descricao: "Para NF que chegou sem pedido",                    padrao: "erp" },
  { chave: "compras.dispensar_nf",      modulo: "compras", rotulo: "Dispensar NF sem pedido",       descricao: "Libera a NF com motivo",                           padrao: "aprovador" },
  { chave: "compras.conferir",          modulo: "compras", rotulo: "Conferir e liberar pagamento",  descricao: "Conferência do material recebido",                 padrao: "erp" },
  { chave: "compras.enviar_fornecedor", modulo: "compras", rotulo: "Enviar ao fornecedor",          descricao: "PDF / e-mail / marcar como enviado",               padrao: "erp" },
  { chave: "estoque.acesso",            modulo: "estoque", rotulo: "Abrir Estoque",                 descricao: "Itens, movimentação e catálogo",                   padrao: "erp" },
  { chave: "estoque.ver_custos",        modulo: "estoque", rotulo: "Ver custos (CMC e valor)",      descricao: "Custo médio e valor em estoque",                   padrao: "erp" },
  { chave: "estoque.ajustar",           modulo: "estoque", rotulo: "Ajustar saldo",                 descricao: "Ainda exige a senha da janela de inventário",      padrao: "erp" },
  { chave: "estoque.mesclar",           modulo: "estoque", rotulo: "Mesclar duplicidades",          descricao: "Mesclar e desfazer",                               padrao: "admin" },
  { chave: "estoque.senha_inventario",  modulo: "estoque", rotulo: "Gerar senha de inventário",     descricao: "Abrir/revogar janelas e revisar ajustes",          padrao: "admin" },
  { chave: "estoque.codigos",           modulo: "estoque", rotulo: "Famílias, códigos e fotos",     descricao: "Revisão de famílias, códigos novos, busca de fotos", padrao: "admin" },
  { chave: "estoque.config_mov",        modulo: "estoque", rotulo: "Configurar tipos de movimentação", descricao: "Tipos e justificativas",                       padrao: "admin" },
  { chave: "estoque.aprovar_perdas",    modulo: "estoque", rotulo: "Aprovar perdas e cancelar movimentos", descricao: "Perdas, avarias, descartes",                padrao: "admin" },
  { chave: "estoque.separar_projeto",   modulo: "estoque", rotulo: "Separar material para projeto", descricao: "Reservar, devolver e consumir material de projetos (em lote)", padrao: "erp" },
  { chave: "financeiro.ver_pagar",      modulo: "financeiro", rotulo: "Ver contas a pagar",         descricao: "Títulos a Pagar",                                  padrao: "erp" },
  { chave: "financeiro.ver_receber",    modulo: "financeiro", rotulo: "Ver contas a receber",       descricao: "Títulos a Receber",                                padrao: "erp" },
  { chave: "financeiro.editar_titulo",  modulo: "financeiro", rotulo: "Incluir / excluir título",   descricao: "Criar ou excluir títulos",                         padrao: "erp" },
  { chave: "financeiro.baixar",         modulo: "financeiro", rotulo: "Baixar / estornar título",   descricao: "Registar pagamento ou recebimento de título do painel", padrao: "admin" },
  { chave: "financeiro.conciliar",      modulo: "financeiro", rotulo: "Conciliação bancária",       descricao: "Importar extrato OFX e casar com títulos",          padrao: "admin" },
  { chave: "faturamento.acesso",        modulo: "faturamento", rotulo: "Abrir e emitir no Faturamento", descricao: "Carteira de PV/OS, emissão de NF-e, recibo e registro de NFS-e", padrao: "admin" },
  { chave: "faturamento.sem_proposta",  modulo: "faturamento", rotulo: "Emitir venda sem proposta do CRM", descricao: "PV/OS novo sem proposta, com motivo registrado", padrao: "admin" },
  { chave: "faturamento.homologacao",   modulo: "faturamento", rotulo: "Emitir em homologação (teste)", descricao: "Forçar homologação: sai de teste, sem usar a numeração real", padrao: "admin" },
];

export const MODULO_LABEL: Record<ModuloPerm, string> = { compras: "Compras", estoque: "Estoque", financeiro: "Financeiro", faturamento: "Faturamento" };

/** Perfis prontos: aplicar e depois ajustar à mão. */
export const PERFIS: Record<string, { rotulo: string; chaves: Chave[] }> = {
  comprador:  { rotulo: "Comprador", chaves: ["compras.acesso", "compras.ver_valores", "compras.gerar_pc_nf", "compras.conferir", "compras.enviar_fornecedor", "estoque.acesso", "estoque.ver_custos"] },
  almoxarife: { rotulo: "Almoxarife", chaves: ["compras.acesso", "compras.conferir", "estoque.acesso", "estoque.ajustar", "estoque.separar_projeto"] },
  financeiro: { rotulo: "Financeiro", chaves: ["compras.acesso", "compras.ver_valores", "compras.conferir", "financeiro.ver_pagar", "financeiro.ver_receber", "financeiro.editar_titulo", "financeiro.baixar", "financeiro.conciliar", "estoque.acesso", "estoque.ver_custos"] },
  gestor:     { rotulo: "Gestor", chaves: ["compras.acesso", "compras.ver_valores", "compras.aprovar", "compras.gerar_pc_nf", "compras.dispensar_nf", "compras.conferir", "compras.enviar_fornecedor", "estoque.acesso", "estoque.ver_custos", "estoque.ajustar", "estoque.aprovar_perdas", "estoque.separar_projeto", "financeiro.ver_pagar", "financeiro.ver_receber"] },
  administrador: { rotulo: "Administrador", chaves: CATALOGO.map((c) => c.chave) },
};

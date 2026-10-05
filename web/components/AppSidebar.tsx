"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { supaBrowser } from "@/lib/supabase";
import { useUserPerms } from "./UserPermsProvider";
import { AREA_LABELS, AREAS, canViewArea, type Area } from "@/lib/permissions";

export type NavItem = {
  href: string;
  label: string;
  icon: React.ReactNode;
  tone: string;
  // Área funcional — define se o item aparece pra este usuário e sob qual
  // cabeçalho do menu. Ver canViewArea em lib/permissions.ts. Itens de sistema
  // (seção Sistema) não pertencem a área nenhuma.
  area?: Area;
  /** Botão do menu onde o item aparece. Separado de `area` de propósito:
   *  `area` decide QUEM abre (permissão); `grupo` decide ONDE fica. Em 30/09/26
   *  o ERP·Omie foi desmembrado em Compras/Vendas/Estoque/Financeiro sem mudar
   *  quem tem acesso a essas telas. */
  grupo?: Grupo;
  /** Seção dentro do grupo (usado no BI: Geral, Compras, Vendas, Financeiro). */
  secao?: string;
};

export type Grupo = "operacao" | "compras" | "vendas" | "estoque" | "financeiro" | "faturamento" | "cadastros" | "bi";
export const GRUPOS: { id: Grupo; label: string; desc: string }[] = [
  { id: "operacao",   label: "Operação",   desc: "Avulsos, Projetos, PCs — o dia a dia" },
  { id: "compras",    label: "Compras",    desc: "Pedidos e requisições de compra (Omie)" },
  { id: "vendas",     label: "Vendas",     desc: "Pedidos de venda e ordens de serviço (Omie)" },
  { id: "estoque",    label: "Estoque",    desc: "Posição, movimentação e Kardex" },
  { id: "financeiro", label: "Financeiro", desc: "Títulos a pagar e a receber" },
  { id: "cadastros",  label: "Cadastros",  desc: "Clientes, fornecedores e itens — um cadastro só para todas as plataformas, sem duplicados" },
  { id: "bi",         label: "BI",         desc: "Relatórios e dashboards — Geral, Compras, Vendas, Financeiro" },
];
export const SECOES_BI = ["Geral", "Compras", "Vendas", "Financeiro"];
/** Secções do menu Cadastros (05/10/26, sql/63): todos os cadastros que vinham do Omie. */
export const SECOES_CADASTROS = ["Pessoas", "Itens", "Projetos e vendas", "Financeiro", "Geral"];

export const MODULES: NavItem[] = [
  {
    href: "/avulsos",
    area: "operacao",
    grupo: "operacao",
    label: "Avulsos",
    tone: "text-sky-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="4" width="18" height="16" rx="2"/>
        <path d="M3 10h18M9 4v16"/>
      </svg>
    ),
  },
  {
    href: "/projetos",
    area: "operacao",
    grupo: "operacao",
    label: "Projetos",
    tone: "text-violet-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7l9-4 9 4-9 4-9-4z"/><path d="M3 12l9 4 9-4"/><path d="M3 17l9 4 9-4"/>
      </svg>
    ),
  },
  {
    href: "/pcs",
    area: "operacao",
    grupo: "operacao",
    label: "PCs Standalone",
    tone: "text-amber-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
        <path d="M14 2v6h6M8 13h8M8 17h5"/>
      </svg>
    ),
  },
  {
    href: "/relatorios",
    area: "bi",
    grupo: "bi",
    secao: "Vendas",
    label: "Relatórios",
    tone: "text-emerald-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18"/>
        <path d="M7 14l4-4 4 4 5-5"/>
      </svg>
    ),
  },
  {
    href: "/relatorios/faturamento",
    area: "bi",
    grupo: "bi",
    secao: "Vendas",
    label: "Faturamento",
    tone: "text-teal-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 20V10"/>
        <path d="M9 20V4"/>
        <path d="M15 20v-8"/>
        <path d="M21 20V8"/>
      </svg>
    ),
  },
  {
    href: "/bi/faturamento",
    area: "bi",
    grupo: "bi",
    secao: "Vendas",
    label: "Faturamento analítico",
    tone: "text-teal-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18"/><path d="M7 15l3-3 3 3 5-6"/><circle cx="18" cy="9" r="1.5"/>
      </svg>
    ),
  },
  {
    href: "/pcs/atribuir-cliente",
    area: "bi",
    grupo: "bi",
    secao: "Compras",
    label: "Atribuir PC → Cliente",
    tone: "text-rose-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M17 3a2.85 2.85 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
      </svg>
    ),
  },
  {
    href: "/erp/vendas",
    area: "erp",
    grupo: "vendas",
    label: "Pedidos · PV/OS",
    tone: "text-teal-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3h2l2 12h12l2-8H7"/><circle cx="9" cy="19" r="1.5"/><circle cx="17" cy="19" r="1.5"/>
      </svg>
    ),
  },
  {
    href: "/erp/compras",
    area: "erp",
    grupo: "compras",
    label: "Pedidos · PC/RC",
    tone: "text-amber-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M20 7l-8-4-8 4v10l8 4 8-4V7z"/><path d="M4 7l8 4 8-4M12 11v10"/>
      </svg>
    ),
  },
  {
    href: "/estoque",
    area: "erp",
    grupo: "estoque",
    label: "Itens",
    tone: "text-orange-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l9 4.5v9L12 21l-9-4.5v-9L12 3z"/><path d="M3 7.5l9 4.5 9-4.5M12 12v9"/>
      </svg>
    ),
  },
  /* Estoque v2 (02/10/26): as abas da tela viraram a 2ª linha do menu, como na Operação. */
  {
    href: "/estoque/catalogo",
    area: "erp",
    grupo: "estoque",
    label: "Catálogo",
    tone: "text-orange-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h10M4 18h7"/><circle cx="18" cy="16" r="3"/>
      </svg>
    ),
  },
  {
    href: "/estoque/movimentacao",
    area: "erp",
    grupo: "estoque",
    label: "Movimentação",
    tone: "text-orange-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>
      </svg>
    ),
  },
  {
    href: "/estoque/inventario",
    area: "erp",
    grupo: "estoque",
    label: "Inventário",
    tone: "text-orange-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V3h6v1M9 11l2 2 4-4M9 17h6"/>
      </svg>
    ),
  },
  {
    href: "/estoque/duplicidades",
    area: "erp",
    grupo: "estoque",
    label: "Duplicidades",
    tone: "text-orange-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>
      </svg>
    ),
  },
  {
    href: "/relatorios/compras-por-cliente",
    area: "bi",
    grupo: "bi",
    secao: "Compras",
    label: "Compras × Cliente",
    tone: "text-amber-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="21" r="1"/>
        <circle cx="20" cy="21" r="1"/>
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/>
      </svg>
    ),
  },
];

// Área BI — preenchida conforme os dashboards do Metabase são portados.
// Só aparece pra admin ou pra quem tem row em platform.user_area_access.
export const BI: NavItem[] = [
  {
    href: "/bi/visao-geral",
    area: "bi",
    grupo: "bi",
    secao: "Geral",
    label: "Visão Geral",
    tone: "text-indigo-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/>
        <rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>
      </svg>
    ),
  },
  {
    href: "/bi/contratos-ct",
    area: "bi",
    grupo: "bi",
    secao: "Geral",
    label: "Contratos CT",
    tone: "text-cyan-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
        <path d="M14 2v6h6M9 15l2 2 4-4"/>
      </svg>
    ),
  },
  {
    href: "/bi/margem-projeto",
    area: "bi",
    grupo: "bi",
    secao: "Geral",
    label: "Margem por Projeto",
    tone: "text-indigo-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18"/><path d="M7 16v-5M12 16V7M17 16v-8"/>
      </svg>
    ),
  },
];

// Área FINANCEIRO — nasce fechada no AREA_DEFAULT.
export const FINANCEIRO: NavItem[] = [
  {
    // Primeiro da área de propósito: é a tela que responde a pergunta inteira.
    // As três abaixo continuam porque a consolidação ainda está em avaliação —
    // quando forem aposentadas, viram redirect pras abas daqui.
    href: "/bi/financeiro",
    area: "bi",
    grupo: "bi",
    secao: "Financeiro",
    label: "Visão financeira",
    tone: "text-sky-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17l5-6 4 3 5-8"/><path d="M3 21h18"/><circle cx="17" cy="6" r="2"/>
      </svg>
    ),
  },
  {
    // Livro operacional de títulos (clone do Omie) — diferente do /bi/contas-pagar,
    // que é a agenda analítica compra→venda→pagamento.
    href: "/financeiro/pagar",
    area: "erp",
    grupo: "financeiro",
    label: "Títulos a Pagar",
    tone: "text-rose-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
        <path d="M14 2v6h6M8 13h8M8 17h8M12 9v10"/>
      </svg>
    ),
  },
  {
    href: "/financeiro/receber",
    area: "erp",
    grupo: "financeiro",
    label: "Títulos a Receber",
    tone: "text-emerald-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
        <path d="M14 2v6h6M8 14l3 3 5-6"/>
      </svg>
    ),
  },
  // Cadastros próprios (05/10/26): clientes e fornecedores vivem no painel e
  // abastecem todas as plataformas (cadastro único, sem duplicados — sql/57).
  // Desde 05/10/26 são um módulo próprio na barra (Cadastros), não itens do Financeiro.
  {
    href: "/cadastros/clientes",
    area: "erp",
    grupo: "cadastros",
    secao: "Pessoas",
    label: "Clientes",
    tone: "text-sky-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-3-5.5"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/fornecedores",
    area: "erp",
    grupo: "cadastros",
    secao: "Pessoas",
    label: "Fornecedores",
    tone: "text-violet-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 21V9l6-4v4l6-4v4l6-4v16H3z"/><path d="M7 17h2M11 17h2M15 17h2"/>
      </svg>
    ),
  },  {
    // Itens: o catálogo do Estoque (códigos próprios) — o mesmo que o CRM e Compras usam.
    href: "/cadastros/itens",
    area: "erp",
    grupo: "cadastros",
    secao: "Itens",
    label: "Itens (catálogo)",
    tone: "text-amber-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M4 7.5l8 4.5 8-4.5M12 12v9"/>
      </svg>
    ),
  },
  // Todos os cadastros que vinham do Omie (05/10/26, sql/63) — criados e editados no painel.
  {
    href: "/cadastros/transportadoras",
    area: "erp",
    grupo: "cadastros",
    secao: "Pessoas",
    label: "Transportadoras",
    tone: "text-amber-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7z"/><circle cx="7" cy="18" r="1.6"/><circle cx="17" cy="18" r="1.6"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/vendedores",
    area: "erp",
    grupo: "cadastros",
    secao: "Pessoas",
    label: "Vendedores",
    tone: "text-sky-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8" r="3.5"/><path d="M5 20a7 7 0 0 1 14 0"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/unidades",
    area: "erp",
    grupo: "cadastros",
    secao: "Itens",
    label: "Unidades de medida",
    tone: "text-amber-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 17h18M6 17v-3M10 17v-5M14 17v-3M18 17v-5"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/servicos",
    area: "erp",
    grupo: "cadastros",
    secao: "Itens",
    label: "Serviços (LC 116)",
    tone: "text-teal-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/projetos",
    area: "erp",
    grupo: "cadastros",
    secao: "Projetos e vendas",
    label: "Projetos",
    tone: "text-emerald-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h6l2 2h10v10H3z"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/condicoes",
    area: "erp",
    grupo: "cadastros",
    secao: "Projetos e vendas",
    label: "Condições de pagamento",
    tone: "text-indigo-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18M7 15h4"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/contas",
    area: "erp",
    grupo: "cadastros",
    secao: "Financeiro",
    label: "Bancos e contas",
    tone: "text-sky-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10l9-6 9 6M5 10v8M9 10v8M15 10v8M19 10v8M3 20h18"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/categorias",
    area: "erp",
    grupo: "cadastros",
    secao: "Financeiro",
    label: "Categorias",
    tone: "text-violet-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h16M4 12h10M4 18h6"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/centros-custo",
    area: "erp",
    grupo: "cadastros",
    secao: "Financeiro",
    label: "Centros de custo",
    tone: "text-rose-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="8"/><path d="M12 4v8l6 4"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/tipos-documento",
    area: "erp",
    grupo: "cadastros",
    secao: "Financeiro",
    label: "Tipos de documento",
    tone: "text-slate-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2h9l5 5v15H6z"/><path d="M14 2v6h6"/>
      </svg>
    ),
  },
  {
    href: "/cadastros/empresas",
    area: "erp",
    grupo: "cadastros",
    secao: "Geral",
    label: "Empresas do grupo",
    tone: "text-slate-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 21V5l8-3 8 3v16"/><path d="M9 21v-5h6v5M8 9h2M14 9h2M8 13h2M14 13h2"/>
      </svg>
    ),
  },
  {
    // Feriados (sql/73): fim de semana ou feriado ativo → previsão no próximo dia útil.
    href: "/cadastros/feriados",
    area: "erp",
    grupo: "cadastros",
    secao: "Geral",
    label: "Feriados (dias úteis)",
    tone: "text-slate-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4M9 15l2 2 4-4"/>
      </svg>
    ),
  },
  {
    // Duplicados que já existem: mesclar / agrupar / "não é duplicado" (sql/57).
    href: "/cadastros/duplicidades",
    area: "erp",
    grupo: "cadastros",
    secao: "Pessoas",
    label: "Duplicidades",
    tone: "text-rose-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="12" height="12" rx="2"/><rect x="9" y="9" width="12" height="12" rx="2"/>
      </svg>
    ),
  },

  {
    // Emissão de NF-e / NFS-e / recibo pela Focus, sem Omie (P5, 05/10/26).
    // Desde 05/10/26 é aba própria na barra (a seguir a Financeiro), não item do Financeiro.
    href: "/faturamento",
    area: "erp",
    grupo: "faturamento",
    label: "Faturamento",
    tone: "text-sky-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/>
        <path d="M14 2v6h6M8 13h5M8 17h8M15 11l2 2-2 2"/>
      </svg>
    ),
  },
  {
    // Extrato OFX × títulos do painel (05/10/26): casar movimento ↔ título = baixa.
    href: "/financeiro/conciliacao",
    area: "erp",
    grupo: "financeiro",
    label: "Conciliação bancária",
    tone: "text-sky-600",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 10h18M5 10V20M19 10V20M9 10v10M15 10v10M3 20h18M12 3l9 5H3z"/>
      </svg>
    ),
  },
  {
    href: "/bi/simples",
    area: "bi",
    grupo: "bi",
    secao: "Financeiro",
    label: "Simples Nacional",
    tone: "text-amber-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="4" y="2" width="16" height="20" rx="2"/><path d="M8 6h8M8 10h3M13 10h3M8 14h3M13 14h3M8 18h8"/>
      </svg>
    ),
  },
  {
    href: "/bi/contas-pagar",
    area: "bi",
    grupo: "bi",
    secao: "Financeiro",
    label: "Contas a Pagar",
    tone: "text-rose-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2"/><path d="M2 11h20M7 15h4"/>
      </svg>
    ),
  },
  {
    href: "/bi/contas-receber",
    area: "bi",
    grupo: "bi",
    secao: "Financeiro",
    label: "Contas a Receber",
    tone: "text-emerald-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>
      </svg>
    ),
  },
  {
    // Corte financeiro (05/10/26): DRE e saldos do razão nativo × Omie, para validar a troca.
    href: "/bi/conferencia-corte",
    area: "bi",
    grupo: "bi",
    secao: "Financeiro",
    label: "Conferência do corte",
    tone: "text-emerald-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 6h7M4 12h7M4 18h7M14 6h6M14 12h6M14 18h6"/><path d="M12 3v18"/>
      </svg>
    ),
  },
  {
    href: "/bi/conciliacao",
    area: "bi",
    grupo: "bi",
    secao: "Financeiro",
    label: "Conciliação",
    tone: "text-amber-700",
    icon: (
      // Duas metades tentando encaixar — é literalmente o que a tela faz.
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 7h7v10H3zM14 7h7v10h-7"/><path d="M10 12h4"/>
      </svg>
    ),
  },
  {
    href: "/bi/compras-cadeia",
    area: "bi",
    grupo: "bi",
    secao: "Compras",
    label: "Cadeia de Compras",
    tone: "text-sky-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 7h5l2 5-2 5H4M15 7h5v10h-5"/><path d="M11 12h4"/>
      </svg>
    ),
  },
  {
    href: "/bi/margem-venda",
    area: "bi",
    grupo: "bi",
    secao: "Vendas",
    label: "Margem por Venda",
    tone: "text-lime-700",
    icon: (
      // Balança: o que entra contra o que custou.
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3v18M7 7h10M5 11l2-4 2 4a2 2 0 0 1-4 0zM15 11l2-4 2 4a2 2 0 0 1-4 0z"/>
      </svg>
    ),
  },
  {
    href: "/bi/rentabilidade",
    area: "bi",
    grupo: "bi",
    secao: "Vendas",
    label: "Rentabilidade",
    tone: "text-emerald-700",
    icon: (
      // A cadeia: pedido → compra → dinheiro.
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h3M14 12h3M4 19l5-4 4 2 7-6"/>
      </svg>
    ),
  },
  {
    href: "/bi/custo-cliente",
    area: "bi",
    grupo: "bi",
    secao: "Financeiro",
    label: "Custo por Cliente",
    tone: "text-orange-700",
    icon: (
      // Gota + cifrão: o custo de ir até o cliente.
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3s5 5.5 5 9a5 5 0 0 1-10 0c0-3.5 5-9 5-9z"/><path d="M12 9v6M10.5 11h3M10.5 13h3"/>
      </svg>
    ),
  },
  {
    href: "/bi/fluxo-caixa",
    area: "bi",
    grupo: "bi",
    secao: "Financeiro",
    label: "Fluxo de Caixa",
    tone: "text-violet-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 16l4-6 4 3 4-7 6 5"/><path d="M3 20h18"/>
      </svg>
    ),
  },
];

export const ADMIN: NavItem[] = [
  {
    href: "/configuracoes/acessos",
    label: "Usuários e acessos",
    tone: "text-ww-textMuted",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M17 11l2 2 3.5-3.5"/>
      </svg>
    ),
  },
  {
    href: "/configuracoes",
    label: "Configurações",
    tone: "text-ww-textMuted",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 15 4.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9c.14.33.22.69.22 1.06 0 .37-.08.73-.22 1.06z"/>
      </svg>
    ),
  },
];

export default function AppSidebar({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const perms = useUserPerms();
  const [open, setOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const closeTimer = useRef<number | null>(null);
  // Rota pra qual o usuário acabou de clicar — usado pra dar feedback visual
  // imediato no link enquanto o server-render da próxima rota termina.
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  // Quando o pathname muda → terminou a navegação, limpa o pending.
  useEffect(() => { setPendingHref(null); }, [pathname]);

  // Prefetch de todas as rotas de módulo na primeira render — navegação fica instantânea
  useEffect(() => {
    [...MODULES, ...FINANCEIRO, ...BI].forEach((m) => router.prefetch(m.href));
    ADMIN.forEach((m) => router.prefetch(m.href));
  }, [router]);

  function navigate(href: string) {
    if (href === pathname) return;
    setPendingHref(href);
    setOpen(false);
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    startTransition(() => { router.push(href); });
  }

  function openNow() {
    if (closeTimer.current) { window.clearTimeout(closeTimer.current); closeTimer.current = null; }
    setOpen(true);
  }
  function closeSoon() {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), 200);
  }

  useEffect(() => () => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
  }, []);

  async function signOut() {
    const supa = supaBrowser();
    await supa.auth.signOut();
    window.location.href = "/login";
  }

  return (
    <>
      {/* Zona invisível à esquerda — "puxa" a sidebar quando o mouse chega */}
      <div
        className="fixed top-0 left-0 h-screen w-2 z-20"
        onMouseEnter={openNow}
        aria-hidden="true"
      />

      {/* Sidebar */}
      <aside
        onMouseEnter={openNow}
        onMouseLeave={closeSoon}
        className={`fixed top-0 left-0 h-screen bg-ww-panel border-r border-ww-border flex flex-col transition-[width,box-shadow] duration-200 ease-out z-30 ${
          open ? "w-[220px] shadow-xl" : "w-[54px] shadow-none"
        }`}
      >
        {/* Header: logo WaterWorks */}
        <div className="h-14 flex items-center px-2 border-b border-ww-border">
          <Link href="/" className="flex items-center gap-2 flex-1 min-w-0">
            <img
              src="/logo-waterworks.svg"
              alt="WaterWorks"
              className="w-9 h-9 object-contain shrink-0"
              onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
            />
            <span className={`font-semibold text-ww-text tracking-tight text-sm whitespace-nowrap overflow-hidden transition-opacity duration-150 ${
              open ? "opacity-100" : "opacity-0"
            }`}>
              WaterWorks
            </span>
          </Link>
        </div>

        {/* Módulos + Admin */}
        <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto overflow-x-hidden">
          {/* Um grupo por área funcional visível. Área sem item ou sem permissão
              não renderiza cabeçalho — o menu encolhe em vez de mostrar seção
              vazia. É o que permite absorver BI/Metabase sem expor financeiro
              pra todo mundo. */}
          {AREAS.filter((a) => canViewArea(perms, a)).map((area) => {
            const items = [...MODULES, ...FINANCEIRO, ...BI].filter((m) => m.area === area);
            if (items.length === 0) return null;
            return (
              <div key={area}>
                <SectionLabel text={AREA_LABELS[area].label} open={open} />
                {items.map((t) => (
                  <SideLink key={t.href} item={t} active={pathname === t.href} open={open}
                            pending={pendingHref === t.href} onNavigate={navigate} />
                ))}
                <div className="h-3" />
              </div>
            );
          })}

          <SectionLabel text="Sistema" open={open} />
          {ADMIN.map((t) => (
            <SideLink key={t.href} item={t} active={pathname === t.href} open={open}
                      pending={pendingHref === t.href} onNavigate={navigate} />
          ))}
          {(userEmail ?? "").toLowerCase() === "benny@waterworks.com.br" && (
            <SideLink
              item={{
                href: "/owner",
                label: "Owner",
                tone: "text-emerald-700",
                icon: (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 3v18h18" />
                    <path d="M7 14l4-4 4 4 5-5" />
                    <circle cx="20" cy="5" r="2" />
                  </svg>
                ),
              }}
              active={pathname === "/owner"}
              open={open}
              pending={pendingHref === "/owner"}
              onNavigate={navigate}
            />
          )}
        </nav>

        {/* Footer: user + alterar senha + sair */}
        <div className="border-t border-ww-border p-2">
          {userEmail && open && (
            <div className="px-2 py-1 text-[10px] text-ww-textFaint truncate" title={userEmail}>
              {userEmail}
            </div>
          )}
          {open && process.env.NEXT_PUBLIC_APP_VERSION && (
            <div className="px-2 pb-1 text-[9px] text-ww-textFaint tabular-nums">
              v{process.env.NEXT_PUBLIC_APP_VERSION}
            </div>
          )}
          <button
            onClick={() => setPwOpen(true)}
            title="Alterar senha"
            className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-ww-textMuted hover:bg-ww-rowHover hover:text-ww-text transition text-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <span className={`transition-opacity duration-150 ${open ? "opacity-100" : "opacity-0"}`}>Alterar senha</span>
          </button>
          <button
            onClick={signOut}
            title="Sair"
            className="w-full flex items-center gap-3 px-2 py-2 rounded-lg text-ww-textMuted hover:bg-ww-rowHover hover:text-ww-text transition text-sm"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-5 h-5 shrink-0" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
              <path d="M16 17l5-5-5-5"/><path d="M21 12H9"/>
            </svg>
            <span className={`transition-opacity duration-150 ${open ? "opacity-100" : "opacity-0"}`}>Sair</span>
          </button>
        </div>
      </aside>

      {pwOpen && <ChangePasswordModal onClose={() => setPwOpen(false)} />}
    </>
  );
}

function SectionLabel({ text, open }: { text: string; open: boolean }) {
  if (!open) return <div className="h-2" />;
  return (
    <div className="px-2 pt-2 pb-1 text-[10px] font-semibold uppercase tracking-wider text-ww-textFaint">
      {text}
    </div>
  );
}

function SideLink({
  item, active, open, pending, onNavigate,
}: {
  item: NavItem; active: boolean; open: boolean; pending: boolean;
  onNavigate: (href: string) => void;
}) {
  return (
    <Link
      href={item.href}
      title={item.label}
      prefetch={true}
      onClick={(e) => { e.preventDefault(); onNavigate(item.href); }}
      className={`flex items-center gap-3 px-2 py-2 rounded-lg transition text-sm whitespace-nowrap ${
        active
          ? "bg-ww-accentSoft text-ww-accent font-semibold"
          : pending
            ? "bg-ww-rowHover text-ww-text"
            : "text-ww-textMuted hover:bg-ww-rowHover hover:text-ww-text"
      }`}
    >
      <span className={`shrink-0 ${active ? "text-ww-accent" : pending ? "text-ww-text" : "text-ww-textFaint"}`}>
        {pending ? (
          <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5 animate-spin" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
            <path d="M21 12a9 9 0 1 1-6.2-8.55" />
          </svg>
        ) : item.icon}
      </span>
      <span className={`overflow-hidden transition-opacity duration-150 ${open ? "opacity-100" : "opacity-0"}`}>
        {item.label}
      </span>
    </Link>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// ChangePasswordModal — usuário muda a própria senha (Supabase Auth)
// ─────────────────────────────────────────────────────────────────────────

function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (pw1.length < 8) { setErr("Senha precisa ter ao menos 8 caracteres."); return; }
    if (pw1 !== pw2)    { setErr("As duas senhas não conferem."); return; }
    setBusy(true);
    const supa = supaBrowser();
    const { error } = await supa.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) { setErr(error.message); return; }
    setOk(true);
    setTimeout(onClose, 1400);
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()}
        className="bg-ww-panel dark:bg-ww-panel rounded-xl shadow-2xl max-w-sm w-full p-5 space-y-4 border border-ww-border">
        <div className="flex items-start justify-between">
          <div>
            <h3 className="font-semibold text-ww-text">Alterar senha</h3>
            <p className="text-xs text-ww-textMuted mt-0.5">Mínimo 8 caracteres. Use uma senha forte.</p>
          </div>
          <button type="button" onClick={onClose} className="text-ww-textMuted hover:text-ww-text text-lg leading-none">×</button>
        </div>

        <div className="space-y-2">
          <div>
            <label className="block text-[11px] font-medium text-ww-textMuted mb-1">Nova senha</label>
            <input type={show ? "text" : "password"} required autoFocus
              value={pw1} onChange={(e) => setPw1(e.target.value)}
              className="w-full px-3 py-2 border border-ww-border bg-ww-bg rounded-md text-sm text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40" />
          </div>
          <div>
            <label className="block text-[11px] font-medium text-ww-textMuted mb-1">Confirme a nova senha</label>
            <input type={show ? "text" : "password"} required
              value={pw2} onChange={(e) => setPw2(e.target.value)}
              className="w-full px-3 py-2 border border-ww-border bg-ww-bg rounded-md text-sm text-ww-text focus:outline-none focus:ring-2 focus:ring-ww-accent/40" />
          </div>
          <label className="flex items-center gap-2 text-[11px] text-ww-textMuted cursor-pointer select-none">
            <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} />
            Mostrar senhas
          </label>
        </div>

        {err && <div className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-3 py-2">{err}</div>}
        {ok  && <div className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md px-3 py-2">Senha alterada ✓</div>}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-3 py-1.5 text-xs font-medium text-ww-textMuted hover:bg-ww-rowHover rounded-md transition">Cancelar</button>
          <button type="submit" disabled={busy || ok} className="px-4 py-1.5 text-xs font-semibold text-white bg-slate-900 hover:bg-slate-800 rounded-md shadow-sm transition disabled:opacity-40">
            {busy ? "Salvando…" : ok ? "Salvo" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

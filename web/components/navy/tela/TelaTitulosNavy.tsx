"use client";

/**
 * Títulos a Pagar / a Receber — recriação Navy da tela do protótipo
 * "Painel Allka finance" (30/09/26).
 *
 * Esqueleto do modelo: cabeçalho → filtros → KPIs → próximos 30 dias +
 * maiores em aberto → agenda em árvore Vencimento › contraparte › título.
 *
 * O que a tela antiga (TitulosView) fazia e continua aqui, sem exceção:
 *  - os três modos (em aberto / baixados / todos) com período de/até;
 *  - filtro por empresa, por status e texto livre nos mesmos campos;
 *  - os 5 números do resumo (em aberto, vencido, hoje, 7 dias, 8–30 dias) e,
 *    fora do modo aberto, total no período · baixado · vencido;
 *  - os três breakdowns (categoria, contraparte, projeto);
 *  - o registo completo de colunas do Omie (≈50 campos) no controlo
 *    "Colunas", com a escolha gravada no browser por tipo;
 *  - o retrato do fornecedor/cliente (FornecedorDrawer) e o "Nova conta"
 *    com write-back (NovoTituloModal);
 *  - ordenação por vencimento, valor e contraparte (agora em qualquer coluna,
 *    pelo cabeçalho, como no modelo), total filtrado e aviso de truncado.
 *
 * O que é novo e tem fonte: pontualidade 30d (títulos baixados cujo
 * vencimento caiu nos últimos 30 dias, pagos até à data), o gráfico por dia de
 * vencimento e o filtro por horizonte. Nada inventado — "Cobertura do mês"
 * do modelo (comprado × emitido × pago) fica de fora até ter fonte nesta área.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { TituloRow } from "@/app/api/financeiro/titulos/route";
import { useUserPerms } from "../../UserPermsProvider";
import NovoTituloModal from "../../NovoTituloModal";
import FornecedorDrawer from "../../FornecedorDrawer";
import { SegmentedControl, type Tom } from "../primitivos";
import {
  ArvoreNavy, Aviso, BotaoTela, CabecalhoTela, CampoData, Carregando, ChipFiltro, FaixaFiltros,
  GradeKpis, GraficoBarras, MeioTela, PaginaNavy, PainelLateral, brl, cMudo, cPill, cTexto,
  ddmm, ddmmaa, diaSemana, hojeISO, kbrl, somaDias, type ColunaNavy, type Kpi, type NoNavy,
} from "./KitTela";

type Row = TituloRow;
type Tipo = "pagar" | "receber";
type Modo = "aberto" | "baixado" | "todos";

const num = (v: unknown) => { const n = Number(v ?? 0); return Number.isFinite(n) ? n : 0; };
const txt = (v: unknown) => (v == null ? "" : String(v).trim());

const STATUS: Record<string, { label: string; tom: Tom }> = {
  "ATRASADO":   { label: "Vencido",    tom: "crit" },
  "VENCE HOJE": { label: "Vence hoje", tom: "warn" },
  "A VENCER":   { label: "A vencer",   tom: "info" },
  "PAGO":       { label: "Pago",       tom: "ok" },
  "RECEBIDO":   { label: "Recebido",   tom: "ok" },
  "CANCELADO":  { label: "Cancelado",  tom: "off" },
};
const statusDe = (s: string | null) => STATUS[s ?? ""] ?? { label: s || "—", tom: "off" as Tom };

/* Conferência do receber com o Omie (finance.receber, desde 01/10/26): as
   contas nascem no painel e o Omie entra conferido, sem duplicar. */
const CONFERENCIA: Record<string, { label: string; tom: Tom; dica: string }> = {
  ok:         { label: "Conferido",  tom: "ok",   dica: "Painel e Omie batem" },
  divergente: { label: "Divergente", tom: "crit", dica: "Ligado ao Omie, mas valor/vencimento/cliente diferem" },
  pendente:   { label: "Pendente",   tom: "warn", dica: "Nossa, à espera do título que o Omie cria ao faturar" },
  so_painel:  { label: "Só painel",  tom: "info", dica: "Conta manual, existe só no painel" },
  so_omie:    { label: "Só Omie",    tom: "off",  dica: "Criada no Omie, fora do painel" },
};
const conferenciaDe = (c: string | null | undefined) => CONFERENCIA[c ?? ""] ?? { label: c || "—", tom: "off" as Tom, dica: "" };
/** Colunas que só existem no receber. */
const SO_RECEBER = new Set<string>(["conferencia", "origem_registro"]);
const fmtDiverg = (r: TituloRow) => Object.entries(r.divergencias ?? {})
  .map(([k, v]) => `${k}: painel ${String(v.painel)} × Omie ${String(v.omie)}`).join(" · ");

// ── Registo de colunas ─────────────────────────────────────────────────────
// O mesmo registo da tela antiga (todas as colunas que o Omie traz), agora com
// o texto de cada campo — é o texto que o filtro do cabeçalho pesquisa.
type Grupo = "Básico" | "Datas" | "Valores" | "Documento" | "Classificação" | "Origem" | "Fiscal";
type Col = {
  key: keyof Row & string;
  label: string;
  grupo: Grupo;
  align?: "right";
  /** Valor em dinheiro: soma nos níveis de cima. */
  soma?: boolean;
  texto: (r: Row) => string;
  numero?: (r: Row) => number | null;
};

const moeda = (k: keyof Row, soPositivo = true) => (r: Row) => {
  const v = num(r[k]); return soPositivo && v <= 0 ? "—" : brl(v);
};
const COLS: Col[] = [
  { key: "empresa", label: "Emp.", grupo: "Básico", texto: (r) => txt(r.empresa) },
  { key: "status_titulo", label: "Status", grupo: "Básico", texto: (r) => statusDe(r.status_titulo).label },
  { key: "vencimento", label: "Venc.", grupo: "Básico", texto: (r) => ddmmaa(r.vencimento),
    numero: (r) => (r.vencimento ? Date.parse(r.vencimento) : null) },
  { key: "contraparte", label: "__CONTRAPARTE__", grupo: "Básico", texto: (r) => txt(r.contraparte) },

  { key: "numero_documento", label: "Doc / Parc", grupo: "Documento",
    texto: (r) => `${txt(r.numero_documento) || "—"}${r.numero_parcela ? ` · ${r.numero_parcela}` : ""}` },
  { key: "numero_documento_fiscal", label: "NF", grupo: "Documento", texto: (r) => txt(r.numero_documento_fiscal) },
  { key: "chave_nfe", label: "Chave NFe", grupo: "Documento", texto: (r) => txt(r.chave_nfe) },
  { key: "num_boleto", label: "Boleto", grupo: "Documento", texto: (r) => txt(r.num_boleto) },
  { key: "codigo_barras", label: "Cód. barras", grupo: "Documento", texto: (r) => txt(r.codigo_barras) },
  { key: "numero_pedido", label: "Pedido / OS", grupo: "Documento", texto: (r) => txt(r.numero_pedido) },
  { key: "num_contrato", label: "Contrato", grupo: "Documento", texto: (r) => txt(r.num_contrato) },

  { key: "categoria", label: "Categoria", grupo: "Classificação",
    texto: (r) => txt(r.categoria) + (r.tem_rateio ? " · rateio" : "") },
  { key: "categorias_rateio", label: "Rateio", grupo: "Classificação", texto: (r) => txt(r.categorias_rateio) },
  { key: "grupo_despesa", label: "Grupo", grupo: "Classificação", texto: (r) => txt(r.grupo_despesa) },
  { key: "projeto", label: "Projeto", grupo: "Classificação", texto: (r) => txt(r.projeto) },
  { key: "conta_corrente", label: "Conta", grupo: "Classificação", texto: (r) => txt(r.conta_corrente) },

  { key: "emissao", label: "Emissão", grupo: "Datas", texto: (r) => ddmmaa(r.emissao),
    numero: (r) => (r.emissao ? Date.parse(r.emissao) : null) },
  { key: "previsao", label: "Previsão", grupo: "Datas", texto: (r) => ddmmaa(r.previsao),
    numero: (r) => (r.previsao ? Date.parse(r.previsao) : null) },
  { key: "pagamento", label: "Pago em", grupo: "Datas", texto: (r) => ddmmaa(r.pagamento),
    numero: (r) => (r.pagamento ? Date.parse(r.pagamento) : null) },
  { key: "dias_para_vencer", label: "Dias", grupo: "Datas", align: "right",
    texto: (r) => (r.dias_para_vencer == null ? "—" : `${r.dias_para_vencer > 0 ? "+" : ""}${r.dias_para_vencer}`),
    numero: (r) => r.dias_para_vencer },
  { key: "dt_registro", label: "Registro", grupo: "Datas", texto: (r) => txt(r.dt_registro) },

  { key: "val_aberto", label: "Em aberto", grupo: "Valores", align: "right", soma: true, texto: moeda("val_aberto"), numero: (r) => num(r.val_aberto) },
  { key: "valor_pago", label: "Pago", grupo: "Valores", align: "right", soma: true, texto: moeda("valor_pago"), numero: (r) => num(r.valor_pago) },
  { key: "val_liquido", label: "Líquido", grupo: "Valores", align: "right", soma: true, texto: moeda("val_liquido", false), numero: (r) => num(r.val_liquido) },
  { key: "juros", label: "Juros", grupo: "Valores", align: "right", soma: true, texto: moeda("juros"), numero: (r) => num(r.juros) },
  { key: "multa", label: "Multa", grupo: "Valores", align: "right", soma: true, texto: moeda("multa"), numero: (r) => num(r.multa) },
  { key: "desconto", label: "Desconto", grupo: "Valores", align: "right", soma: true, texto: moeda("desconto"), numero: (r) => num(r.desconto) },

  { key: "origem", label: "Origem", grupo: "Origem", texto: (r) => txt(r.origem) },
  { key: "operacao", label: "Operação", grupo: "Origem", texto: (r) => txt(r.operacao) },
  { key: "tipo_documento", label: "Tipo", grupo: "Origem", texto: (r) => txt(r.tipo_documento) },
  { key: "cod_titulo", label: "Cód. Omie", grupo: "Origem", align: "right", texto: (r) => txt(r.cod_titulo) },
  { key: "info_u_inc", label: "Lançado por", grupo: "Origem", texto: (r) => txt(r.info_u_inc) },
  { key: "info_d_inc", label: "Lançado em", grupo: "Origem", texto: (r) => txt(r.info_d_inc) },
  { key: "info_u_alt", label: "Alterado por", grupo: "Origem", texto: (r) => txt(r.info_u_alt) },
  { key: "observacao", label: "Observação", grupo: "Origem", texto: (r) => txt(r.observacao) },

  { key: "valor_ir", label: "IR", grupo: "Fiscal", align: "right", soma: true, texto: moeda("valor_ir"), numero: (r) => num(r.valor_ir) },
  { key: "valor_pis", label: "PIS", grupo: "Fiscal", align: "right", soma: true, texto: moeda("valor_pis"), numero: (r) => num(r.valor_pis) },
  { key: "valor_cofins", label: "COFINS", grupo: "Fiscal", align: "right", soma: true, texto: moeda("valor_cofins"), numero: (r) => num(r.valor_cofins) },
  { key: "valor_csll", label: "CSLL", grupo: "Fiscal", align: "right", soma: true, texto: moeda("valor_csll"), numero: (r) => num(r.valor_csll) },
  { key: "valor_inss", label: "INSS", grupo: "Fiscal", align: "right", soma: true, texto: moeda("valor_inss"), numero: (r) => num(r.valor_inss) },
  { key: "valor_iss", label: "ISS", grupo: "Fiscal", align: "right", soma: true, texto: moeda("valor_iss"), numero: (r) => num(r.valor_iss) },
  { key: "numero_parcela", label: "Parcela", grupo: "Fiscal", texto: (r) => txt(r.numero_parcela) },
  { key: "cnpj_cpf", label: "CNPJ / CPF", grupo: "Fiscal", texto: (r) => txt(r.cnpj_cpf) },
  { key: "contraparte_razao", label: "Razão social", grupo: "Fiscal", texto: (r) => txt(r.contraparte_razao) },
  { key: "codigo_cliente_fornecedor", label: "Cód. contraparte", grupo: "Fiscal", align: "right", texto: (r) => txt(r.codigo_cliente_fornecedor) },
  { key: "cod_nf", label: "Cód. NF", grupo: "Fiscal", align: "right", texto: (r) => txt(r.cod_nf) },
  { key: "num_os", label: "Nº OS", grupo: "Fiscal", texto: (r) => txt(r.num_os) },
  { key: "em_aberto", label: "Está aberto?", grupo: "Fiscal", texto: (r) => (r.em_aberto ? "sim" : "não") },
  { key: "info_d_alt", label: "Alterado em", grupo: "Fiscal", texto: (r) => txt(r.info_d_alt) },

  /* O resto da view finance.v_titulos_omie — trazido em 30/09/26 para nada do
     Omie ficar de fora. Desligado por padrão; serve para bater com o Omie. */
  { key: "conferencia", label: "Conferência", grupo: "Origem", texto: (r) => conferenciaDe(r.conferencia).label },
  { key: "origem_registro", label: "Nasceu em", grupo: "Origem", texto: (r) => (r.origem_registro === "painel" ? "Painel" : r.origem_registro === "omie" ? "Omie" : "") },
  { key: "status", label: "Status Omie", grupo: "Origem", texto: (r) => txt(r.status) },
  { key: "liquidado", label: "Liquidado", grupo: "Origem", texto: (r) => txt(r.liquidado) },
  { key: "status_pago_d", label: "Pago (flag)", grupo: "Origem", texto: (r) => txt(r.status_pago_d) },
  { key: "dt_cancelamento", label: "Cancelado em", grupo: "Datas", texto: (r) => ddmmaa(r.dt_cancelamento) },
  { key: "info_h_inc", label: "Hora lanç.", grupo: "Origem", texto: (r) => txt(r.info_h_inc) },
  { key: "info_h_alt", label: "Hora alter.", grupo: "Origem", texto: (r) => txt(r.info_h_alt) },
  { key: "synced_at", label: "Sincronizado", grupo: "Origem", texto: (r) => txt(r.synced_at).replace("T", " ").slice(0, 16) },
  { key: "boleto_gerado", label: "Boleto gerado", grupo: "Documento", texto: (r) => txt(r.boleto_gerado) },
  { key: "boleto_numero", label: "Nº boleto (Omie)", grupo: "Documento", texto: (r) => txt(r.boleto_numero) },
  { key: "nsu", label: "NSU", grupo: "Documento", texto: (r) => txt(r.nsu) },
  { key: "num_titulo", label: "Nº título", grupo: "Documento", texto: (r) => txt(r.num_titulo) },
  { key: "cod_int_titulo", label: "Cód. integração", grupo: "Fiscal", texto: (r) => txt(r.cod_int_titulo) },
  { key: "codigo_lancamento_omie", label: "Cód. lançamento", grupo: "Fiscal", align: "right", texto: (r) => txt(r.codigo_lancamento_omie) },
  { key: "codigo_categoria", label: "Cód. categoria", grupo: "Classificação", texto: (r) => txt(r.codigo_categoria) },
  { key: "codigo_projeto", label: "Cód. projeto", grupo: "Classificação", texto: (r) => txt(r.codigo_projeto) },
  { key: "cod_cc", label: "Cód. conta", grupo: "Classificação", texto: (r) => txt(r.cod_cc) },
  { key: "cod_contrato", label: "Cód. contrato", grupo: "Fiscal", texto: (r) => txt(r.cod_contrato) },
  { key: "cod_os", label: "Cód. OS", grupo: "Fiscal", texto: (r) => txt(r.cod_os) },
  { key: "cod_comprador", label: "Cód. comprador", grupo: "Fiscal", texto: (r) => txt(r.cod_comprador) },
  { key: "cod_vendedor", label: "Cód. vendedor", grupo: "Fiscal", texto: (r) => txt(r.cod_vendedor) },
  { key: "cod_tit_repet", label: "Cód. repetição", grupo: "Fiscal", texto: (r) => txt(r.cod_tit_repet) },
  { key: "ret_ir", label: "Retém IR", grupo: "Fiscal", texto: (r) => txt(r.ret_ir) },
  { key: "ret_pis", label: "Retém PIS", grupo: "Fiscal", texto: (r) => txt(r.ret_pis) },
  { key: "ret_cofins", label: "Retém COFINS", grupo: "Fiscal", texto: (r) => txt(r.ret_cofins) },
  { key: "ret_csll", label: "Retém CSLL", grupo: "Fiscal", texto: (r) => txt(r.ret_csll) },
  { key: "ret_inss", label: "Retém INSS", grupo: "Fiscal", texto: (r) => txt(r.ret_inss) },
  { key: "ret_iss", label: "Retém ISS", grupo: "Fiscal", texto: (r) => txt(r.ret_iss) },

  // Valor fica sempre por último, como no modelo: é a coluna que se soma a olho.
  { key: "valor_documento", label: "Valor", grupo: "Valores", align: "right", soma: true,
    texto: (r) => brl(num(r.valor_documento)), numero: (r) => num(r.valor_documento) },
];
const GRUPOS: Grupo[] = ["Básico", "Datas", "Valores", "Documento", "Classificação", "Origem", "Fiscal"];

/* Padrão: as colunas do modelo (categoria, projeto, parcela, status, valor)
   somadas às que a tela antiga trazia ligadas (empresa, doc, NF, conta, em
   aberto). Vencimento e contraparte já são os níveis da árvore. */
const PADRAO: Col["key"][] = [
  "empresa", "numero_documento", "numero_documento_fiscal", "categoria", "projeto",
  "conta_corrente", "status_titulo", "val_aberto", "valor_documento",
];
const LARGURA: Partial<Record<Col["key"], string>> = {
  empresa: "88px", status_titulo: "118px", numero_documento: "minmax(110px,1fr)", numero_documento_fiscal: "90px",
  categoria: "minmax(140px,1.1fr)", projeto: "minmax(110px,1fr)", conta_corrente: "minmax(110px,1fr)",
  observacao: "minmax(180px,1.4fr)", contraparte_razao: "minmax(180px,1.3fr)", chave_nfe: "minmax(160px,1.2fr)",
  codigo_barras: "minmax(160px,1.2fr)", valor_documento: "140px", val_aberto: "140px", valor_pago: "130px", val_liquido: "130px",
};

// ── Horizontes da agenda ────────────────────────────────────────────────────
type Horizonte = "vencidos" | "hoje" | "amanha" | "semana" | "d30" | "depois" | "semdata";
const HORIZONTES: { k: Horizonte; rotulo: string }[] = [
  { k: "vencidos", rotulo: "Vencidos" }, { k: "hoje", rotulo: "Hoje" }, { k: "amanha", rotulo: "Amanhã" },
  { k: "semana", rotulo: "Esta semana" }, { k: "d30", rotulo: "30 dias" }, { k: "depois", rotulo: "Depois de 30 dias" },
];

function horizonteDe(r: Row, hoje: string, amanha: string, d7: string, d30: string): Horizonte {
  const st = r.status_titulo ?? "", v = r.vencimento ?? "";
  // Mesma ordem de decisão do resumo da API: status primeiro, data depois.
  if (st === "ATRASADO" || (v && v < hoje)) return "vencidos";
  if (st === "VENCE HOJE" || v === hoje) return "hoje";
  if (!v) return "semdata";
  if (v === amanha) return "amanha";
  if (v <= d7) return "semana";
  if (v <= d30) return "d30";
  return "depois";
}

const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export default function TelaTitulosNavy({ tipo }: { tipo: Tipo }) {
  const perms = useUserPerms();
  const [modo, setModo] = useState<Modo>("aberto");
  const [de, setDe] = useState(() => hojeISO().slice(0, 8) + "01");
  const [ate, setAte] = useState(hojeISO());
  const [rows, setRows] = useState<Row[] | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [baixados30, setBaixados30] = useState<Row[] | null>(null);
  const [refresh, setRefresh] = useState(0);

  const [q, setQ] = useState("");
  const [empresaSel, setEmpresaSel] = useState("");
  const [statusSel, setStatusSel] = useState("");
  const [conferenciaSel, setConferenciaSel] = useState("");
  const [excluindo, setExcluindo] = useState<string | null>(null);
  const [horizSel, setHorizSel] = useState<Horizonte[]>([]);
  const [ladoAba, setLadoAba] = useState<"categoria" | "contraparte" | "projeto">("categoria");
  const [novoAberto, setNovoAberto] = useState(false);
  const [retrato, setRetrato] = useState<{ cod: number; empresa: string } | null>(null);
  const [sync, setSync] = useState<string | null>(null);

  const rotuloContra = tipo === "pagar" ? "Fornecedor" : "Cliente";
  const baixadoLabel = tipo === "pagar" ? "Pago" : "Recebido";

  // ── Colunas escolhidas (gravadas no browser por tipo) ───────────────────
  const chavePrefs = `titulos.navy.colunas.${tipo}`;
  const [colsSel, setColsSel] = useState<Col["key"][]>(PADRAO);
  const [prefsOk, setPrefsOk] = useState(false);
  const [colunasAberto, setColunasAberto] = useState(false);
  useEffect(() => {
    try {
      const g = window.localStorage.getItem(chavePrefs);
      if (g) {
        const l = (JSON.parse(g) as string[]).filter((k) => COLS.some((c) => c.key === k)) as Col["key"][];
        if (l.length) setColsSel(l);
      }
    } catch { /* preferência corrompida: fica o padrão */ }
    setPrefsOk(true);
  }, [chavePrefs]);
  useEffect(() => {
    if (!prefsOk) return;
    try { window.localStorage.setItem(chavePrefs, JSON.stringify(colsSel)); } catch { /* quota */ }
  }, [colsSel, chavePrefs, prefsOk]);
  // Ordem sempre a do registo — a tabela não dança conforme a ordem do clique.
  const colsDoTipo = useMemo(() => COLS.filter((c) => tipo === "receber" || !SO_RECEBER.has(c.key)), [tipo]);
  const colsAtivas = useMemo(() => colsDoTipo.filter((c) => colsSel.includes(c.key)), [colsSel, colsDoTipo]);

  // ── Dados ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const ctrl = new AbortController();
    setRows(null); setErro(null);
    (async () => {
      try {
        const p = new URLSearchParams({ tipo, modo });
        if (modo !== "aberto") { p.set("de", de); p.set("ate", ate); }
        const r = await fetch(`/api/financeiro/titulos?${p}`, { signal: ctrl.signal, cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
        setRows(j.rows as Row[]); setTruncado(!!j.truncated);
      } catch (e) {
        if ((e as Error).name !== "AbortError") { setErro((e as Error).message); setRows([]); }
      }
    })();
    return () => ctrl.abort();
  }, [tipo, modo, de, ate, refresh]);

  // Pontualidade: baixados com vencimento nos últimos 30 dias.
  useEffect(() => {
    const ctrl = new AbortController();
    const h = hojeISO();
    (async () => {
      try {
        const p = new URLSearchParams({ tipo, modo: "baixado", de: somaDias(h, -30), ate: h });
        const r = await fetch(`/api/financeiro/titulos?${p}`, { signal: ctrl.signal, cache: "no-store" });
        const j = await r.json();
        if (r.ok) setBaixados30(j.rows as Row[]);
      } catch { /* KPI some, a tela segue */ }
    })();
    return () => ctrl.abort();
  }, [tipo, refresh]);

  const hoje = hojeISO(), amanha = somaDias(hoje, 1), d7 = somaDias(hoje, 7), d30 = somaDias(hoje, 30);

  const empresas = useMemo(() => [...new Set((rows ?? []).map((r) => r.empresa))].sort(), [rows]);

  // Filtros da faixa (os do cabeçalho de coluna vivem na árvore).
  const base = useMemo(() => {
    let rs = rows ?? [];
    if (empresaSel) rs = rs.filter((r) => r.empresa === empresaSel);
    if (statusSel) rs = rs.filter((r) => (r.status_titulo ?? "") === statusSel);
    if (conferenciaSel) rs = rs.filter((r) => (r.conferencia ?? "") === conferenciaSel);
    if (horizSel.length && modo === "aberto")
      rs = rs.filter((r) => horizSel.includes(horizonteDe(r, hoje, amanha, d7, d30)));
    const n = q.trim().toLowerCase();
    if (n) rs = rs.filter((r) =>
      [r.contraparte, r.numero_documento, r.numero_documento_fiscal, r.numero_pedido, r.categoria, r.projeto, r.observacao]
        .some((v) => (v ?? "").toLowerCase().includes(n)));
    return rs;
  }, [rows, empresaSel, statusSel, conferenciaSel, horizSel, modo, q, hoje, amanha, d7, d30]);

  // ── Resumo (a mesma regra da API, sobre o que está filtrado) ────────────
  const resumo = useMemo(() => {
    const z = () => ({ total: 0, qtd: 0 });
    const o = { total: z(), vencido: z(), vence_hoje: z(), vence_7d: z(), vence_30d: z(), baixado: z() };
    for (const r of base) {
      const v = num(r.valor_documento), st = r.status_titulo ?? "", venc = r.vencimento ?? "";
      if (st === "CANCELADO") continue;
      o.total.total += v; o.total.qtd++;
      if (st === "PAGO" || st === "RECEBIDO") { o.baixado.total += v; o.baixado.qtd++; }
      else if (st === "ATRASADO" || (venc && venc < hoje)) { o.vencido.total += v; o.vencido.qtd++; }
      else if (venc === hoje || st === "VENCE HOJE") { o.vence_hoje.total += v; o.vence_hoje.qtd++; }
      else if (venc && venc <= d7) { o.vence_7d.total += v; o.vence_7d.qtd++; }
      else if (venc && venc <= d30) { o.vence_30d.total += v; o.vence_30d.qtd++; }
    }
    return o;
  }, [base, hoje, d7, d30]);

  const pontualidade = useMemo(() => {
    const rs = (baixados30 ?? []).filter((r) => (!empresaSel || r.empresa === empresaSel) && r.vencimento);
    if (!rs.length) return null;
    const emDia = rs.filter((r) => r.pagamento && r.pagamento <= (r.vencimento as string)).length;
    return { pct: Math.round((emDia / rs.length) * 100), n: rs.length };
  }, [baixados30, empresaSel]);

  const qt = (n: number) => `${n.toLocaleString("pt-BR")} título${n === 1 ? "" : "s"}`;
  const kpis: Kpi[] = modo === "aberto" ? [
    { rotulo: tipo === "pagar" ? "Total em aberto" : "Total a receber", valor: kbrl(resumo.total.total), sub: qt(resumo.total.qtd), hero: true, title: brl(resumo.total.total) },
    { rotulo: "Vencidos", valor: kbrl(resumo.vencido.total), sub: qt(resumo.vencido.qtd), subTom: "crit", title: brl(resumo.vencido.total),
      onClick: () => setHorizSel(["vencidos"]) },
    { rotulo: "Vence hoje", valor: brl(resumo.vence_hoje.total), sub: qt(resumo.vence_hoje.qtd), subTom: "warn",
      onClick: () => setHorizSel(["hoje"]) },
    { rotulo: "Próx. 7 dias", valor: kbrl(resumo.vence_7d.total), sub: qt(resumo.vence_7d.qtd), title: brl(resumo.vence_7d.total) },
    { rotulo: "8–30 dias", valor: kbrl(resumo.vence_30d.total), sub: qt(resumo.vence_30d.qtd), title: brl(resumo.vence_30d.total) },
    ...(pontualidade ? [{
      rotulo: "Pontualidade 30d", valor: `${pontualidade.pct}%`,
      sub: `${tipo === "pagar" ? "pagos" : "recebidos"} até o vencimento · ${qt(pontualidade.n)}`,
      barra: { pct: pontualidade.pct, tom: (pontualidade.pct >= 85 ? "ok" : pontualidade.pct >= 60 ? "warn" : "crit") as Tom },
    }] : []),
  ] : [
    { rotulo: "Total no período", valor: kbrl(resumo.total.total), sub: qt(resumo.total.qtd), hero: true, title: brl(resumo.total.total) },
    { rotulo: baixadoLabel, valor: kbrl(resumo.baixado.total), sub: qt(resumo.baixado.qtd), subTom: "ok", title: brl(resumo.baixado.total) },
    { rotulo: "Vencidos", valor: kbrl(resumo.vencido.total), sub: qt(resumo.vencido.qtd), subTom: "crit", title: brl(resumo.vencido.total) },
    ...(pontualidade ? [{
      rotulo: "Pontualidade 30d", valor: `${pontualidade.pct}%`, sub: `até o vencimento · ${qt(pontualidade.n)}`,
      barra: { pct: pontualidade.pct, tom: (pontualidade.pct >= 85 ? "ok" : pontualidade.pct >= 60 ? "warn" : "crit") as Tom },
    }] : []),
  ];

  // ── Gráfico ─────────────────────────────────────────────────────────────
  const corDia = tipo === "pagar" ? "var(--ww-brand-2)" : "linear-gradient(180deg,var(--ww-brand-3),var(--ww-brand-1))";
  const grafico = useMemo(() => {
    const vivos = base.filter((r) => r.status_titulo !== "CANCELADO");
    if (modo === "aberto") {
      const venc = vivos.filter((r) => horizonteDe(r, hoje, amanha, d7, d30) === "vencidos");
      const porDia = new Map<string, { v: number; n: number }>();
      for (const r of vivos) {
        const v = r.vencimento; if (!v || v < hoje || v > d30) continue;
        if (r.status_titulo === "ATRASADO") continue;
        const a = porDia.get(v) ?? { v: 0, n: 0 }; a.v += num(r.valor_documento); a.n++; porDia.set(v, a);
      }
      const vv = venc.reduce((t, r) => t + num(r.valor_documento), 0);
      const mx = Math.max(1, ...[...porDia.values()].map((a) => a.v));
      const topo = (v: number) => (v >= mx * 0.15 ? kbrl(v).replace(" mil", "k") : "");
      return [
        ...(vv > 0 ? [{ rotulo: "venc.", topo: kbrl(vv).replace(" mil", "k"), topoCor: "var(--ww-crit-text)", foraEscala: vv > mx,
                        title: `Vencidos · ${brl(vv)} · ${qt(venc.length)}${vv > mx ? " · fora da escala" : ""}`,
                        segs: [{ v: vv, cor: "var(--ww-crit)" }], onClick: () => setHorizSel(["vencidos"]) }] : []),
        ...[...porDia.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([d, a]) => ({
          rotulo: ddmm(d), topo: topo(a.v), topoCor: d === hoje ? "var(--ww-warn-text)" : "var(--ww-accent-text)",
          title: `${ddmm(d)} · ${diaSemana(d)} · ${brl(a.v)} · ${qt(a.n)}`,
          segs: [{ v: a.v, cor: d === hoje ? "var(--ww-warn)" : corDia }],
        })),
      ];
    }
    // Fora do modo aberto: por mês de vencimento, baixado × em aberto.
    const porMes = new Map<string, { b: number; a: number; n: number }>();
    for (const r of vivos) {
      const m = (r.vencimento ?? "").slice(0, 7); if (!m) continue;
      const a = porMes.get(m) ?? { b: 0, a: 0, n: 0 };
      if (r.status_titulo === "PAGO" || r.status_titulo === "RECEBIDO") a.b += num(r.valor_documento);
      else a.a += num(r.valor_documento);
      a.n++; porMes.set(m, a);
    }
    return [...porMes.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([m, a]) => ({
      rotulo: `${MESES[Number(m.slice(5, 7)) - 1].slice(0, 3)}/${m.slice(2, 4)}`,
      title: `${m} · ${baixadoLabel}: ${brl(a.b)} · em aberto: ${brl(a.a)} · ${qt(a.n)}`,
      topo: kbrl(a.a + a.b).replace(" mil", "k"),
      segs: [{ v: a.b, cor: "var(--ww-brand-2)" }, { v: a.a, cor: "var(--ww-warn)" }],
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, modo, hoje, amanha, d7, d30, tipo]);

  // ── Maiores em aberto (os três breakdowns da tela antiga) ───────────────
  const breakdown = useMemo(() => {
    const m = new Map<string, { t: number; n: number }>();
    for (const r of base) {
      if (r.status_titulo === "CANCELADO") continue;
      const k = (ladoAba === "categoria" ? r.categoria : ladoAba === "contraparte" ? r.contraparte : r.projeto)
        ?? (ladoAba === "categoria" ? "(Sem categoria)" : ladoAba === "contraparte" ? "(Sem nome)" : "(Sem projeto)");
      const a = m.get(k) ?? { t: 0, n: 0 }; a.t += num(r.valor_documento); a.n++; m.set(k, a);
    }
    const l = [...m.entries()].sort((a, b) => b[1].t - a[1].t).slice(0, 10);
    const mx = Math.max(1, ...l.map(([, a]) => a.t));
    return l.map(([nome, a]) => ({ k: "m" as const, rotulo: nome, valor: kbrl(a.t), pct: (a.t / mx) * 100,
      tom: "info" as Tom, title: `${nome} · ${brl(a.t)} · ${qt(a.n)}` }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, ladoAba]);

  // ── Árvore ──────────────────────────────────────────────────────────────
  const colunas: ColunaNavy<Row>[] = useMemo(() => [
    { label: `Vencimento › ${rotuloContra.toLowerCase()} › título` },
    ...colsAtivas.map((c) => ({
      label: c.key === "contraparte" ? rotuloContra : c.label, align: c.align, texto: c.texto, numero: c.numero,
    })),
  ], [colsAtivas, rotuloContra]);

  const grid = useMemo(() =>
    "minmax(330px,2fr) " + colsAtivas.map((c) => LARGURA[c.key] ?? (c.align === "right" ? "120px" : "minmax(100px,1fr)")).join(" "),
  [colsAtivas]);

  const celsSoma = useCallback((rs: Row[], estado?: { label: string; tom: Tom }) => colsAtivas.map((c) => {
    if (c.key === "status_titulo" && estado) return cPill(estado.label, estado.tom);
    if (c.soma) {
      const t = rs.reduce((s, r) => s + (r.status_titulo === "CANCELADO" ? 0 : num(r[c.key])), 0);
      return t ? cTexto(brl(t), { peso: c.key === "valor_documento" ? 700 : 600 }) : cMudo("");
    }
    return cMudo("");
  }), [colsAtivas]);

  const celsTitulo = useCallback((r: Row) => colsAtivas.map((c) => {
    if (c.key === "status_titulo") { const s = statusDe(r.status_titulo); return cPill(s.label, s.tom); }
    if (c.key === "conferencia") { const k = conferenciaDe(r.conferencia); return cPill(k.label, k.tom); }
    if (c.key === "categoria") return cTexto(r.categoria || "—", { sub: r.tem_rateio ? `rateio: ${r.categorias_rateio ?? ""}` : undefined });
    if (c.key === "contraparte") return cTexto(r.contraparte || "—");
    const t = c.texto(r);
    if (!t || t === "—") return cMudo("—");
    return cTexto(t, { peso: c.key === "valor_documento" ? 600 : 500, cor: c.soma ? undefined : "var(--ww-text-2)" });
  }), [colsAtivas]);

  const montar = useCallback((rs: Row[]): NoNavy[] => {
    // Nível 1: vencimento. No modo aberto é a agenda; fora dele, o mês.
    const grupos = new Map<string, { nome: string; sub?: string; estado?: { label: string; tom: Tom }; ordem: string; rs: Row[] }>();
    for (const r of rs) {
      let k: string, nome: string, estado: { label: string; tom: Tom } | undefined, ordem: string;
      if (modo === "aberto") {
        const h = horizonteDe(r, hoje, amanha, d7, d30);
        k = h; ordem = String(["vencidos", "hoje", "amanha", "semana", "d30", "depois", "semdata"].indexOf(h));
        nome = h === "vencidos" ? "Vencidos" : h === "hoje" ? `Hoje · ${ddmm(hoje)}` : h === "amanha" ? `Amanhã · ${ddmm(amanha)}`
          : h === "semana" ? "Esta semana" : h === "d30" ? "Próximos 30 dias" : h === "depois" ? "Depois de 30 dias" : "Sem vencimento";
        estado = h === "vencidos" ? { label: "Vencido", tom: "crit" } : h === "hoje" ? { label: "Vence hoje", tom: "warn" }
          : h === "amanha" || h === "semana" ? { label: "Aberto", tom: "info" } : { label: "Aberto", tom: "off" };
      } else {
        const m = (r.vencimento ?? "").slice(0, 7);
        k = m || "sem"; ordem = m || "9999";
        nome = m ? `${MESES[Number(m.slice(5, 7)) - 1]} ${m.slice(0, 4)}` : "Sem vencimento";
      }
      const g = grupos.get(k) ?? { nome, estado, ordem, rs: [] };
      g.rs.push(r); grupos.set(k, g);
    }
    return [...grupos.entries()].sort(([, a], [, b]) => a.ordem.localeCompare(b.ordem)).map(([k, g]) => {
      const porContra = new Map<string, Row[]>();
      for (const r of g.rs) {
        const c = r.contraparte || "(Sem nome)";
        const l = porContra.get(c) ?? []; l.push(r); porContra.set(c, l);
      }
      const nContra = porContra.size;
      return {
        id: `g:${k}`, nome: g.nome,
        sub: `${qt(g.rs.length)} · ${nContra} ${nContra === 1 ? rotuloContra.toLowerCase() : tipo === "pagar" ? "fornecedores" : "clientes"}`,
        cels: celsSoma(g.rs, g.estado),
        filhos: [...porContra.entries()].map(([c, lr]) => {
          const cod = Number(lr[0].codigo_cliente_fornecedor) || 0;
          return {
            id: `g:${k}:${c}`, nome: c, sub: qt(lr.length),
            cels: celsSoma(lr),
            acao: cod ? (
              <button type="button" title={`Retrato do ${rotuloContra.toLowerCase()}`}
                onClick={() => setRetrato({ cod, empresa: lr[0].empresa })}
                style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
                         border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-text-muted)" }}>
                retrato
              </button>
            ) : undefined,
            filhos: lr.map((r) => {
              const dias = r.dias_para_vencer;
              const doc = r.numero_documento_fiscal ? `NF ${r.numero_documento_fiscal}` : (r.numero_documento || "Título");
              // Só a conta nascida no painel e ainda sem título do Omie se apaga daqui.
              const apagavel = tipo === "receber" && r.origem_registro === "painel" && !r.codigo_lancamento_omie && r.id;
              const diverg = r.conferencia === "divergente" ? fmtDiverg(r) : "";
              return {
                id: `t:${r.empresa}:${r.id ?? r.codigo_lancamento_omie}`,
                nome: `${doc}${r.tipo_documento ? ` · ${r.tipo_documento.toLowerCase()}` : ""}`,
                sub: `venc. ${ddmm(r.vencimento)}${dias != null && dias !== 0 && r.em_aberto ? ` · ${dias > 0 ? "+" : "−"}${Math.abs(dias)}d` : ""}${r.numero_parcela ? ` · parc. ${r.numero_parcela}` : ""}${diverg ? ` · ${diverg}` : ""}`,
                title: [r.observacao, diverg].filter(Boolean).join("\n") || undefined,
                cels: celsTitulo(r),
                acao: apagavel ? (
                  <button type="button" disabled={excluindo === r.id} title="Excluir esta conta (só existe no painel)"
                    onClick={() => excluir(r)}
                    style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, cursor: "pointer",
                             border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-crit-text)" }}>
                    {excluindo === r.id ? "excluindo…" : "excluir"}
                  </button>
                ) : undefined,
              };
            }),
          };
        }),
      };
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modo, hoje, amanha, d7, d30, rotuloContra, celsSoma, celsTitulo, tipo, excluindo]);

  /* Hoje abre sempre; vencidos só quando cabe no olho — com centenas de
     fornecedores atrasados, abrir por padrão empurrava o resto da agenda
     para fora da tela. */
  const nVencidos = useMemo(() => new Set(base.filter((r) => horizonteDe(r, hoje, amanha, d7, d30) === "vencidos")
    .map((r) => r.contraparte)).size, [base, hoje, amanha, d7, d30]);
  const abertosIniciais = modo === "aberto" ? ["g:hoje", ...(nVencidos <= 8 ? ["g:vencidos"] : [])] : [];

  async function excluir(r: Row) {
    if (!r.id || !window.confirm(`Excluir a conta de ${brl(num(r.valor_documento))} de ${r.contraparte ?? "—"} (venc. ${ddmm(r.vencimento)})?`)) return;
    setExcluindo(r.id);
    try {
      const res = await fetch("/api/financeiro/titulos/excluir", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tipo, id: r.id }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? `HTTP ${res.status}`);
      setRefresh((n) => n + 1);
    } catch (e) { setErro((e as Error).message); }
    finally { setExcluindo(null); }
  }

  /* Contagem por estado de conferência — os chips só aparecem com o que existe. */
  const conferencias = useMemo(() => {
    if (tipo !== "receber") return [];
    const m = new Map<string, number>();
    for (const r of rows ?? []) if (r.conferencia) m.set(r.conferencia, (m.get(r.conferencia) ?? 0) + 1);
    return ["divergente", "pendente", "so_painel", "so_omie", "ok"].filter((k) => m.has(k)).map((k) => ({ k, n: m.get(k)! }));
  }, [rows, tipo]);

  async function sincronizar() {
    if (!window.confirm("Disparar o sync financeiro do Omie agora (master_finance_diaria)?\n\nLeva alguns minutos; a tela atualiza ao recarregar.")) return;
    setSync("disparando…");
    try {
      const r = await fetch("/api/admin/run-workflow", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tool: "finance", kind: "diaria" }) });
      const j = await r.json();
      setSync(r.ok ? "sync disparado · recarregue em alguns minutos" : `erro: ${j.error ?? r.status}`);
    } catch (e) { setSync(`erro: ${(e as Error).message}`); }
  }

  const statusChips = modo === "todos" ? ["ATRASADO", "VENCE HOJE", "A VENCER", tipo === "pagar" ? "PAGO" : "RECEBIDO", "CANCELADO"] : [];
  const totalFiltrado = (rs: Row[]) => rs.reduce((s, r) => s + (r.status_titulo === "CANCELADO" ? 0 : num(r.valor_documento)), 0);

  return (
    <PaginaNavy>
      <CabecalhoTela
        area="Financeiro"
        titulo={tipo === "pagar" ? "Títulos a Pagar" : "Títulos a Receber"}
        sub={<>{tipo === "pagar" ? "finance.v_titulos_omie · natureza P" : "finance.v_receber · contas do painel + Omie conferido"} · todas as empresas · agenda por vencimento
          {sync && <span style={{ marginLeft: 8, color: "var(--ww-accent-text)" }}>· {sync}</span>}</>}
        acoes={<>
          <BotaoTela onClick={() => setNovoAberto(true)}>+ Nova conta</BotaoTela>
          {perms?.is_admin && <BotaoTela primario onClick={sincronizar}>Sincronizar</BotaoTela>}
        </>}
      />

      <FaixaFiltros busca={q} onBusca={setQ} placeholder={`${rotuloContra}, doc, NF, categoria, projeto…`}>
        <SegmentedControl
          options={[{ value: "aberto", label: "Em aberto" }, { value: "baixado", label: `${baixadoLabel}s` }, { value: "todos", label: "Todos" }]}
          value={modo} onChange={(v) => { setModo(v as Modo); setStatusSel(""); setHorizSel([]); }} />
        {modo !== "aberto" && (<>
          <CampoData valor={de} onChange={setDe} title="Vencimento de" />
          <span style={{ color: "var(--ww-text-faint)", fontSize: 12 }}>→</span>
          <CampoData valor={ate} onChange={setAte} title="Vencimento até" />
        </>)}
        {modo === "aberto" && HORIZONTES.map((h) => (
          <ChipFiltro key={h.k} ativo={horizSel.includes(h.k)}
            onClick={() => setHorizSel((s) => (s.includes(h.k) ? s.filter((x) => x !== h.k) : [...s, h.k]))}>{h.rotulo}</ChipFiltro>
        ))}
        {statusChips.map((s) => (
          <ChipFiltro key={s} ativo={statusSel === s} onClick={() => setStatusSel(statusSel === s ? "" : s)}>{statusDe(s).label}</ChipFiltro>
        ))}
        {conferencias.map(({ k, n }) => (
          <ChipFiltro key={k} ativo={conferenciaSel === k} title={conferenciaDe(k).dica}
            onClick={() => setConferenciaSel(conferenciaSel === k ? "" : k)}>{conferenciaDe(k).label} · {n.toLocaleString("pt-BR")}</ChipFiltro>
        ))}
        {empresas.length > 1 && (<>
          <ChipFiltro ativo={!empresaSel} onClick={() => setEmpresaSel("")}>Todas</ChipFiltro>
          {empresas.map((e) => <ChipFiltro key={e} ativo={empresaSel === e} onClick={() => setEmpresaSel(empresaSel === e ? "" : e)}>{e}</ChipFiltro>)}
        </>)}
      </FaixaFiltros>

      {erro && <Aviso>Erro ao carregar: {erro}</Aviso>}

      {rows === null ? <Carregando texto="Carregando títulos…" /> : (<>
        <GradeKpis kpis={kpis} min={175} />

        <MeioTela
          grafico={<GraficoBarras
            titulo={modo === "aberto" ? "Próximos 30 dias por vencimento" : `Por mês de vencimento · ${baixadoLabel.toLowerCase()} × em aberto`}
            legenda={modo === "aberto" ? undefined : [{ nome: baixadoLabel, cor: "var(--ww-brand-2)" }, { nome: "Em aberto", cor: "var(--ww-warn)" }]}
            colunas={grafico} />}
          lado={<PainelLateral
            titulo={modo === "aberto" ? "Maiores em aberto" : "Maiores no período"}
            extra={<SegmentedControl value={ladoAba} onChange={(v) => setLadoAba(v as typeof ladoAba)}
              options={[{ value: "categoria", label: "Categoria" }, { value: "contraparte", label: rotuloContra }, { value: "projeto", label: "Projeto" }]} />}
            blocos={breakdown.length ? breakdown : [{ k: "t", t: "—" }]} />}
        />

        <ArvoreNavy<Row>
          chave={`${tipo}:${modo}`}
          titulo={`Vencimento › ${rotuloContra.toLowerCase()} › título`}
          dica={modo === "aberto" ? "Agenda: vencidos e hoje abertos por padrão · clique no cabeçalho para filtrar e ordenar" : "Agrupado pelo mês de vencimento"}
          colunas={colunas}
          registros={base}
          montar={montar}
          grid={grid}
          minWidth={Math.max(1000, 300 + colsAtivas.length * 115)}
          abertosIniciais={abertosIniciais}
          buscaNome={(r) => `${r.contraparte ?? ""} ${r.numero_documento ?? ""} ${r.numero_documento_fiscal ?? ""}`}
          vazio="Nenhum título com esses filtros"
          toolbar={
            <div style={{ position: "relative" }}>
              <button type="button" onClick={() => setColunasAberto((v) => !v)} style={{
                height: 32, padding: "0 12px", borderRadius: 9, fontSize: 12.5, cursor: "pointer", background: "transparent",
                border: "1px solid var(--ww-border-strong)", color: "var(--ww-text-2)",
              }}>Colunas · {colsAtivas.length}/{colsDoTipo.length}</button>
              {colunasAberto && (<>
                <div style={{ position: "fixed", inset: 0, zIndex: 30 }} onClick={() => setColunasAberto(false)} />
                <div style={{
                  position: "absolute", right: 0, top: "100%", marginTop: 6, zIndex: 40, width: 560, maxWidth: "90vw",
                  maxHeight: 460, overflowY: "auto", padding: 14, borderRadius: 14, background: "var(--ww-panel)",
                  border: "1px solid var(--ww-border-strong)", boxShadow: "var(--shadow-float)",
                }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                    <span style={{ fontSize: 12, fontWeight: 700 }}>Campos do Omie</span>
                    <button type="button" onClick={() => setColsSel(PADRAO)} style={{ fontSize: 11, background: "none", border: 0, color: "var(--ww-text-muted)", textDecoration: "underline", cursor: "pointer" }}>voltar ao padrão</button>
                  </div>
                  {GRUPOS.map((g) => (
                    <div key={g} style={{ marginBottom: 10 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: ".06em", color: "var(--ww-text-faint)", marginBottom: 4 }}>{g}</div>
                      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,minmax(0,1fr))", gap: "2px 12px" }}>
                        {colsDoTipo.filter((c) => c.grupo === g).map((c) => (
                          <label key={c.key} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--ww-text-2)", cursor: "pointer" }}>
                            <input type="checkbox" checked={colsSel.includes(c.key)}
                              onChange={() => setColsSel((cur) => (cur.includes(c.key) ? cur.filter((k) => k !== c.key) : [...cur, c.key]))} />
                            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.key === "contraparte" ? rotuloContra : c.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>)}
            </div>
          }
          rodape={(rs) => (<>
            <span>{qt(rs.length)} · <b style={{ color: "var(--ww-text)" }}>{brl(totalFiltrado(rs))}</b>{truncado ? " · lista truncada em 30 mil linhas" : ""}</span>
            <span>Cancelados não somam · valores do documento</span>
          </>)}
        />
      </>)}

      {retrato && (
        <FornecedorDrawer cod={retrato.cod} empresa={retrato.empresa} tipo={tipo} rotulo={rotuloContra} onClose={() => setRetrato(null)} />
      )}
      {novoAberto && (
        <NovoTituloModal tipo={tipo} onClose={() => setNovoAberto(false)} onCreated={() => setRefresh((n) => n + 1)} />
      )}
    </PaginaNavy>
  );
}

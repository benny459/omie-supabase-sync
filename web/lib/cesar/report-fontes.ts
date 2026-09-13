/**
 * Reports DINÂMICOS do Cesar (13/09/2026): tabelas e gráficos podem carregar
 * uma FONTE — a consulta que os gerou, com placeholders ({{de}}, {{ate}},
 * {{id-de-escolha}}). A tela do report reexecuta ao abrir (dados do MOMENTO,
 * não do dia em que nasceu) e quando os filtros mudam.
 *
 * Execução pela RPC bi.cesar_consulta_livre — a mesma da consulta sob medida:
 * SELECT/WITH-only revalidado dentro do banco, statement_timeout 8s e teto de
 * 200 linhas, executável só pelo service_role. Antes dela, o sql-guard do
 * Node valida de novo; valores de filtro NUNCA entram crus (período só
 * AAAA-MM-DD, escolha só opção declarada — substituídos como literais com
 * aspas escapadas). Quem AUTORA fonte é só admin, validado ao salvar.
 */
import { validarSqlLeitura, limparSql } from "./sql-guard";
import type { ReportPayload, ReportTabela, ReportBarras, ReportFiltroDef } from "./report-pdf";

type Rpc = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{
    data: unknown; error: { message: string } | null;
  }>;
};

export type ValoresFiltro = Record<string, string | { de?: string; ate?: string }>;

const DATA_RE = /^\d{4}-\d{2}-\d{2}$/;
const aspas = (v: string) => `'${v.replace(/'/g, "''")}'`;

function substituir(sql: string, filtros: ReportFiltroDef[], valores: ValoresFiltro): { sql?: string; erro?: string } {
  let out = sql;
  for (const f of filtros) {
    if (f.tipo === "periodo") {
      const v = valores[f.id];
      const de = (typeof v === "object" && v?.de) || f.de || "";
      const ate = (typeof v === "object" && v?.ate) || f.ate || "";
      if (!DATA_RE.test(de) || !DATA_RE.test(ate)) return { erro: "período inválido" };
      out = out.replaceAll("{{de}}", aspas(de)).replaceAll("{{ate}}", aspas(ate));
    } else {
      const opcoes = f.opcoes || [];
      const pedido = valores[f.id];
      const v = (typeof pedido === "string" && pedido) || f.padrao || opcoes[0] || "";
      if (!opcoes.includes(v)) return { erro: `opção inválida para ${f.rotulo || f.id}` };
      out = out.replaceAll(`{{${f.id}}}`, aspas(v));
    }
  }
  if (/\{\{[^}]+\}\}/.test(out)) return { erro: "a consulta tem placeholder sem filtro declarado" };
  return { sql: out };
}

/** Valida um payload com fontes/filtros. `podeFontes` = admin. */
export function validarFontesDoReport(report: ReportPayload, podeFontes: boolean): { ok: boolean; motivo?: string } {
  const fontes: string[] = [];
  for (const t of report.tabelas || []) if (t.fonte?.sql) fontes.push(t.fonte.sql);
  for (const g of report.barras || []) if (g.fonte?.sql) fontes.push(g.fonte.sql);
  if (report.kpis_fonte?.sql) fontes.push(report.kpis_fonte.sql);
  const filtros = (report.filtros || []) as ReportFiltroDef[];
  if (!fontes.length && !filtros.length) return { ok: true };
  if (!podeFontes) return { ok: false, motivo: "só admin pode criar reports dinâmicos (fontes/filtros)" };
  if (!fontes.length) return { ok: false, motivo: "há filtros declarados mas nenhuma tabela/gráfico tem fonte" };
  // KPI congelado num report dinâmico engana (Benny, 13/09): se o report é
  // vivo e tem kpis, o kpis_fonte é OBRIGATÓRIO — a tela filtra e os números
  // de cima têm que acompanhar.
  if ((report.kpis || []).length && !report.kpis_fonte?.sql) {
    return { ok: false, motivo: "os KPIs ficariam congelados quando os filtros mudassem — inclua kpis_fonte (SELECT de UMA linha, um KPI por coluna, mesmos placeholders) ou remova os kpis" };
  }
  for (const f of filtros) {
    if (f.tipo !== "periodo" && f.tipo !== "escolha") return { ok: false, motivo: "tipo de filtro inválido" };
    if (f.tipo === "escolha" && (!Array.isArray(f.opcoes) || !f.opcoes.length)) {
      return { ok: false, motivo: "filtro de escolha sem opções" };
    }
  }
  for (const sql of fontes) {
    // Valida com placeholders neutralizados — {{de}} viraria erro de sintaxe.
    const neutro = sql.replace(/\{\{[^}]+\}\}/g, "'x'");
    const v = validarSqlLeitura(neutro);
    if (!v.ok) return { ok: false, motivo: `fonte recusada: ${v.motivo}` };
  }
  return { ok: true };
}

/* ── formatação: o SQL devolve cru, a tela mostra pt-BR ── */

const ehMoeda = (header: string) => /r\$/i.test(header) || /\b(valor|total|l[ií]quido|saldo|bruto|receita|custo)\b/i.test(header);
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

function celula(v: unknown, header: string): string {
  if (v == null) return "";
  if (typeof v === "number" || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v))) {
    const n = Number(v);
    if (ehMoeda(header)) return brl(n);
    return Number.isInteger(n) ? String(n) : n.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
  }
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}(T|$)/.test(s)) return s.slice(0, 10).split("-").reverse().join("/");
  return s;
}

async function executar(bi: Rpc, sql: string): Promise<Record<string, unknown>[]> {
  const limpo = limparSql(sql);
  const v = validarSqlLeitura(limpo);
  if (!v.ok) throw new Error(v.motivo);
  const { data, error } = await bi.rpc("cesar_consulta_livre", { p_sql: limpo });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

export interface DadosVivos {
  tabelas: Record<number, string[][]>;
  barras: Record<number, { rotulo: string; valor: number; texto?: string }[]>;
  kpis?: { rotulo: string; valor: string }[];
  erros: string[];
}

/** Reexecuta as fontes do report com os valores de filtro da tela. */
export async function executarFontes(bi: Rpc, report: ReportPayload, valores: ValoresFiltro): Promise<DadosVivos> {
  const filtros = (report.filtros || []) as ReportFiltroDef[];
  const out: DadosVivos = { tabelas: {}, barras: {}, erros: [] };

  const tabelas = (report.tabelas || []) as ReportTabela[];
  for (let i = 0; i < tabelas.length; i++) {
    const fonte = tabelas[i].fonte?.sql;
    if (!fonte) continue;
    const sub = substituir(fonte, filtros, valores);
    if (!sub.sql) { out.erros.push(sub.erro || "filtro inválido"); continue; }
    try {
      const rows = await executar(bi, sub.sql);
      const headers = tabelas[i].colunas || [];
      out.tabelas[i] = rows.map((r) => {
        const vals = Object.values(r);
        return headers.map((h, c) => celula(vals[c], h));
      });
    } catch (e) {
      out.erros.push(`tabela ${i + 1}: ${(e instanceof Error ? e.message : "erro").slice(0, 120)}`);
    }
  }

  // KPIs vivos: uma linha; cada coluna vira um KPI (alias = rótulo).
  if (report.kpis_fonte?.sql) {
    const sub = substituir(report.kpis_fonte.sql, filtros, valores);
    if (!sub.sql) out.erros.push(sub.erro || "filtro inválido");
    else {
      try {
        const rows = await executar(bi, sub.sql);
        const linha = rows[0] || {};
        out.kpis = Object.entries(linha).slice(0, 8).map(([k, v]) => ({
          rotulo: k.replace(/_/g, " "),
          valor: celula(v, k),
        }));
      } catch (e) {
        out.erros.push(`kpis: ${(e instanceof Error ? e.message : "erro").slice(0, 120)}`);
      }
    }
  }

  const barras = (report.barras || []) as ReportBarras[];
  for (let i = 0; i < barras.length; i++) {
    const fonte = barras[i].fonte?.sql;
    if (!fonte) continue;
    const sub = substituir(fonte, filtros, valores);
    if (!sub.sql) { out.erros.push(sub.erro || "filtro inválido"); continue; }
    try {
      const rows = await executar(bi, sub.sql);
      out.barras[i] = rows.slice(0, 14).map((r) => {
        const vals = Object.values(r);
        const valor = Number(vals[1]) || 0;
        return {
          rotulo: String(vals[0] ?? ""),
          valor,
          texto: vals[2] != null ? String(vals[2]) : brl(valor),
        };
      });
    } catch (e) {
      out.erros.push(`gráfico ${i + 1}: ${(e instanceof Error ? e.message : "erro").slice(0, 120)}`);
    }
  }
  return out;
}

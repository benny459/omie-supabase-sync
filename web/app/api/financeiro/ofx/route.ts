// /api/financeiro/ofx (05/10/26) — importação de extrato de qualquer banco.
//  GET  → contas correntes ativas (para escolher a conta do extrato)
//  POST multipart { arquivo, modo: "previa" | "importar", extrato?: índice, empresa?, cod_cc?,
//                   mapa?: JSON (CSV/XLSX), lembrar?: "1" }
//    • OFX 1.x/2.x (vários extratos por arquivo, conta corrente e cartão) ou CSV/XLSX com mapa de colunas.
//    • Conta: a lembrada para banco+agência+conta (extrato_contas_map) ou a que casa por
//      banco + agência + número; sem certeza → devolve candidatos para escolher.
//    • previa: período, saldos do arquivo (abertura = saldo final − movimentos), duplicados,
//      lacuna/sobreposição com as importações anteriores e se o saldo emenda com a última.
//    • importar: grava (sem duplicar FITID), regista a importação, aplica as regras de
//      conciliação e a conciliação automática.
import { NextResponse } from "next/server";
import * as XLSX from "xlsx";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";
import {
  acharConta, conferirSaldo, decodificarOfx, lerExtratos, lerLinhasExtrato, partirCsv, sugerirMapa,
  type ContaCorrente, type ExtratoOfx, type MapaColunas,
} from "@/lib/ofx";

export const runtime = "nodejs";
export const maxDuration = 60;

async function contas(): Promise<ContaCorrente[]> {
  const { data } = await fin().from("contas_correntes")
    .select("empresa, cod_cc, descricao, codigo_banco, codigo_agencia, numero_conta_corrente, tipo_conta_corrente, inativo")
    .order("empresa").order("descricao");
  return ((data ?? []) as ContaCorrente[]).filter((c) => c.inativo !== "S");
}

const norm = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^0+/, "");

export async function GET() {
  const a = await exigir("financeiro.conciliar");
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ contas: await contas() });
}

type Lido = { formato: "ofx" | "csv"; extratos: ExtratoOfx[]; cabecalho?: string[]; amostra?: unknown[][]; mapa?: MapaColunas };

function ehPlanilha(nome: string) { return /\.(xlsx|xls|ods)$/i.test(nome); }
function ehCsv(nome: string, texto: string) { return /\.(csv|txt)$/i.test(nome) || (!/<OFX>/i.test(texto) && /[;,\t]/.test(texto.split("\n")[0] ?? "")); }

function lerArquivo(nome: string, buf: ArrayBuffer, mapa: MapaColunas | null): Lido {
  if (ehPlanilha(nome)) {
    const wb = XLSX.read(new Uint8Array(buf), { type: "array", cellDates: true });
    const linhas = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, defval: "" });
    return linhasParaExtrato(linhas, mapa);
  }
  const texto = decodificarOfx(buf);
  if (/<OFX>/i.test(texto)) return { formato: "ofx", extratos: lerExtratos(texto) };
  if (ehCsv(nome, texto)) return linhasParaExtrato(partirCsv(texto), mapa);
  throw new Error("Formato não reconhecido — envie OFX, CSV ou planilha (XLSX).");
}

function linhasParaExtrato(linhas: unknown[][], mapa: MapaColunas | null): Lido {
  // cabeçalho = primeira linha com "data" (bancos põem título/conta antes)
  const iCab = Math.max(0, linhas.findIndex((l) => l.some((c) => /^data/i.test(String(c ?? "").trim()))));
  const cab = (linhas[iCab] ?? []).map((c) => String(c ?? ""));
  const m = mapa ?? { ...sugerirMapa(cab), linha_inicial: iCab + 1 };
  if (m.valor < 0 && (m.credito ?? -1) < 0 && (m.debito ?? -1) < 0) m.valor = -1;
  const ext = m.data >= 0 && m.historico >= 0 && (m.valor >= 0 || (m.credito ?? -1) >= 0 || (m.debito ?? -1) >= 0)
    ? lerLinhasExtrato(linhas, m) : null;
  return { formato: "csv", extratos: ext ? [ext] : [], cabecalho: cab, amostra: linhas.slice(iCab + 1, iCab + 6), mapa: m };
}

async function contaDoExtrato(ext: ExtratoOfx, todas: ContaCorrente[]) {
  if (ext.conta) {
    const { data } = await fin().from("extrato_contas_map").select("empresa, cod_cc")
      .eq("banco", ext.banco ?? "").eq("agencia", norm(ext.agencia)).eq("conta", norm(ext.conta)).eq("cartao", ext.cartao).maybeSingle();
    const lembrada = data && todas.find((c) => c.empresa === data.empresa && Number(c.cod_cc) === Number(data.cod_cc));
    if (lembrada) return { conta: lembrada, candidatos: [lembrada], lembrada: true };
  }
  const cands = acharConta(ext, todas);
  const certa = cands.length === 1 || (cands.length > 1 && cands[0].tipo_conta_corrente === (ext.cartao ? "CR" : "CC")
    && cands[1].tipo_conta_corrente !== cands[0].tipo_conta_corrente);
  return { conta: certa ? cands[0] : undefined, candidatos: cands, lembrada: false };
}

export async function POST(req: Request) {
  const a = await exigir("financeiro.conciliar");
  if (a instanceof NextResponse) return a;

  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o arquivo do extrato (OFX, CSV ou XLSX)" }, { status: 400 });
  if (arq.size > 8_000_000) return NextResponse.json({ error: "Arquivo grande demais (máx. 8 MB)" }, { status: 413 });
  const modo = String(form?.get("modo") ?? "importar");
  const iExt = Number(form?.get("extrato") ?? 0) || 0;
  const empresaSel = String(form?.get("empresa") ?? "").toUpperCase();
  const codSel = Number(form?.get("cod_cc") ?? 0);
  const lembrar = String(form?.get("lembrar") ?? "") === "1";
  let mapa: MapaColunas | null = null;
  try { const m = form?.get("mapa"); if (m) mapa = JSON.parse(String(m)); } catch { return NextResponse.json({ error: "mapa inválido" }, { status: 400 }); }

  const todas = await contas();
  const escolhida = empresaSel && codSel ? todas.find((c) => c.empresa === empresaSel && Number(c.cod_cc) === codSel) : undefined;
  if (empresaSel && codSel && !escolhida) return NextResponse.json({ error: "Conta escolhida não existe ou está inativa" }, { status: 422 });

  // CSV/planilha: usa o mapa guardado para a conta, se houver e nenhum veio
  if (!mapa && escolhida && (ehPlanilha(arq.name) || /\.(csv|txt)$/i.test(arq.name))) {
    const { data } = await fin().from("extrato_csv_mapas").select("mapa").eq("empresa", escolhida.empresa).eq("cod_cc", escolhida.cod_cc).maybeSingle();
    if (data?.mapa) mapa = data.mapa as MapaColunas;
  }

  let lido: Lido;
  try { lido = lerArquivo(arq.name, await arq.arrayBuffer(), mapa); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 422 }); }

  if (lido.formato === "csv" && (!lido.extratos.length || !lido.extratos[0].movimentos.length)) {
    return NextResponse.json({
      precisa_mapa: true, formato: "csv", cabecalho: lido.cabecalho, amostra: lido.amostra, mapa: lido.mapa,
      error: "Diga quais colunas são data, histórico e valor (ou crédito/débito).",
    }, { status: 409 });
  }
  const comMov = lido.extratos.filter((e) => e.movimentos.length);
  if (!comMov.length) return NextResponse.json({ error: "Nenhum lançamento encontrado no arquivo" }, { status: 422 });

  // ── prévia de todos os extratos do arquivo ────────────────────────────────
  if (modo === "previa") {
    const extratos = await Promise.all(comMov.map(async (ext, i) => {
      const det = escolhida && i === iExt ? { conta: escolhida, candidatos: [escolhida], lembrada: false } : await contaDoExtrato(ext, todas);
      const saldo = conferirSaldo(ext);
      let previa: Record<string, unknown> | null = null;
      if (det.conta) {
        const { data } = await fin().rpc("extrato_previa", {
          p_empresa: det.conta.empresa, p_cod_cc: det.conta.cod_cc, p_ini: ext.inicio, p_fim: ext.fim,
          p_fitids: ext.movimentos.map((m) => m.fitid), p_saldo_abertura: saldo.abertura,
        });
        previa = data as Record<string, unknown>;
      }
      return {
        indice: i, banco: ext.banco, agencia: ext.agencia, conta_arquivo: ext.conta, cartao: ext.cartao,
        inicio: ext.inicio, fim: ext.fim, n: ext.movimentos.length,
        entradas: ext.movimentos.filter((m) => m.valor > 0).reduce((s, m) => s + m.valor, 0),
        saidas: ext.movimentos.filter((m) => m.valor < 0).reduce((s, m) => s + m.valor, 0),
        saldo, conta: det.conta ?? null, candidatos: det.candidatos, lembrada: det.lembrada, previa,
        amostra: ext.movimentos.slice(0, 12),
      };
    }));
    return NextResponse.json({ formato: lido.formato, arquivo: arq.name, extratos, mapa: lido.mapa ?? null, contas: todas });
  }

  // ── importar ──────────────────────────────────────────────────────────────
  const ext = comMov[iExt] ?? comMov[0];
  const det = escolhida ? { conta: escolhida, candidatos: [escolhida], lembrada: false } : await contaDoExtrato(ext, todas);
  if (!det.conta) {
    return NextResponse.json({
      precisa_conta: true, banco: ext.banco, conta: ext.conta, candidatos: det.candidatos.length ? det.candidatos : todas,
      error: det.candidatos.length ? "Mais de uma conta combina com o extrato — escolha qual." : "Não achei a conta deste extrato — escolha qual (ou cadastre a conta).",
    }, { status: 409 });
  }
  const conta = det.conta;
  const saldo = conferirSaldo(ext);
  const { data: prev } = await fin().rpc("extrato_previa", {
    p_empresa: conta.empresa, p_cod_cc: conta.cod_cc, p_ini: ext.inicio, p_fim: ext.fim,
    p_fitids: ext.movimentos.map((m) => m.fitid), p_saldo_abertura: saldo.abertura,
  });
  const { data, error } = await fin().rpc("ofx_importar", {
    p_empresa: conta.empresa, p_cod_cc: conta.cod_cc, p_banco: ext.banco, p_conta: ext.conta,
    p_arquivo: arq.name, p_usuario: a.email, p_movs: ext.movimentos,
  });
  if (error) return erroDb(error);
  const r = data as { novos: number; duplicados: number; total: number };

  const avisos: string[] = [];
  const p = (prev ?? {}) as { lacuna_dias?: number | null; sobreposicao?: boolean; saldo_confere?: boolean | null; saldo_anterior?: number | null };
  if (p.lacuna_dias) avisos.push(`Faltam ${p.lacuna_dias} dia(s) entre o último extrato importado e este.`);
  if (p.sobreposicao && r.duplicados) avisos.push(`Período sobrepõe importação anterior — ${r.duplicados} lançamento(s) já existiam e não foram duplicados.`);
  if (p.saldo_confere === false) avisos.push(`Saldo não emenda: o arquivo abre com ${saldo.abertura}, a última importação fechou com ${p.saldo_anterior}.`);

  await fin().from("extrato_importacoes").insert({
    empresa: conta.empresa, cod_cc: conta.cod_cc, arquivo: arq.name, formato: lido.formato,
    dt_ini: ext.inicio, dt_fim: ext.fim, saldo_abertura: saldo.abertura, saldo_final: saldo.fechamento,
    movimento: saldo.movimento, n_total: r.total, n_novos: r.novos, n_duplicados: r.duplicados,
    avisos, importado_por: a.email,
  });
  if (lembrar && ext.conta) {
    await fin().from("extrato_contas_map").upsert({
      banco: ext.banco ?? "", agencia: norm(ext.agencia), conta: norm(ext.conta), cartao: ext.cartao,
      empresa: conta.empresa, cod_cc: conta.cod_cc, criado_por: a.email,
    });
  }
  if (lido.formato === "csv" && lido.mapa) {
    await fin().from("extrato_csv_mapas").upsert({ empresa: conta.empresa, cod_cc: conta.cod_cc, mapa: lido.mapa, atualizado_por: a.email, atualizado_em: new Date().toISOString() });
  }

  // regras ("memo contém X → …") e depois a conciliação automática; falha aqui não desfaz a importação
  const datas = ext.movimentos.map((m) => m.data).sort();
  const de = ext.inicio ?? datas[0] ?? null, ate = ext.fim ?? datas[datas.length - 1] ?? null;
  const regras = await fin().rpc("regras_aplicar", { p_empresa: conta.empresa, p_cod_cc: conta.cod_cc, p_de: de, p_ate: ate });
  const auto = await fin().rpc("conciliacao_auto", { p_empresa: conta.empresa, p_cod_cc: conta.cod_cc, p_de: de, p_ate: ate });

  return NextResponse.json({
    ...r, avisos, saldo, regras: regras.error ? null : regras.data, auto: auto.error ? null : auto.data,
    conta: { empresa: conta.empresa, cod_cc: conta.cod_cc, descricao: conta.descricao }, de, ate,
  });
}

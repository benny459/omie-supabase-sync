import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { HOST, baixar, chamar, empresaFocus, tokenDe, type Ambiente } from "./focus";
import { montarNfe, montarNfse, parcelas, reciboHtml, totalItens, validar, type DocFat, type Emitente } from "./montar";

/**
 * Motor de faturamento do painel (P5, 05/10/2026).
 *
 * emitir() → grava orders.fat_emissoes, chama a Focus (NF-e/NFS-e) ou gera o
 * recibo; atualizar() consulta o status e, ao autorizar, guarda XML/PDF no
 * Storage (bucket fat-documentos), cria as parcelas em finance.receber
 * (origem 'painel') e marca a origem (PV/OS) como faturada.
 *
 * HOMOLOGAÇÃO é o padrão. Produção só com fat_config.producao_liberada.
 */

export type TipoDoc = "nfe" | "nfse" | "recibo";
export type OrigemTipo = "pv" | "os" | "venda" | "manual" | "teste";

export type Config = {
  empresa: string; cnpj: string | null; ativo: boolean; ambiente: Ambiente; producao_liberada: boolean;
  tipo_os: "recibo" | "nfse";
  nfe_serie_homologacao: string; nfe_proximo_homologacao: number | null;
  nfe_serie_producao: string; nfe_proximo_producao: number | null;
  rps_serie_homologacao: string; rps_serie_producao: string;
  recibo_proximo: number | null; natureza_operacao: string; item_lista_servico: string | null;
  codigo_tributario_municipio: string | null; aliquota_iss: number | null;
};

export type Emissao = {
  id: number; empresa: string; ambiente: Ambiente; tipo: TipoDoc; ref: string;
  origem_tipo: OrigemTipo; origem_id: string | null;
  /** PV1962 / OS4885 — preenchido pelo banco (trigger) a partir do documento nativo. */
  origem_rotulo?: string | null;
  cliente: DocFat["cliente"]; itens: DocFat["itens"]; condicao: DocFat["condicao"];
  payload: unknown; status: string; focus_status: string | null; mensagem: string | null; erros: unknown;
  numero: string | null; serie: string | null; chave: string | null; valor_total: number;
  xml_path: string | null; pdf_path: string | null; receber_ids: string[] | null; gerar_receber: boolean;
  autorizada_em: string | null; cancelada_em: string | null; criado_por: string | null; created_at: string;
};

const BUCKET = "fat-documentos";
const db = () => supaAdmin().schema("orders");

export async function configDe(empresa: string): Promise<Config> {
  const { data, error } = await db().from("fat_config").select("*").eq("empresa", empresa).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`Empresa ${empresa} sem configuração de faturamento`);
  return data as Config;
}

function ambienteDe(cfg: Config): Ambiente {
  if (cfg.ambiente === "producao") {
    if (!cfg.producao_liberada) throw new Error("Produção não liberada para esta empresa — só o Benny liga a chave");
    return "producao";
  }
  return "homologacao";
}

async function emitente(cfg: Config): Promise<Emitente> {
  if (!cfg.cnpj) throw new Error(`Empresa ${cfg.empresa} sem CNPJ configurado`);
  const e = await empresaFocus(cfg.cnpj);
  return {
    cnpj: cfg.cnpj, nome: e.nome, uf: e.uf, municipio: e.municipio, codigo_municipio: e.codigo_municipio,
    inscricao_municipal: e.inscricao_municipal, inscricao_estadual: e.inscricao_estadual,
    logradouro: e.logradouro, numero: e.numero, bairro: e.bairro, cep: e.cep, telefone: e.telefone,
  };
}

async function patch(id: number, campos: Record<string, unknown>) {
  const { data, error } = await db().from("fat_emissoes")
    .update({ ...campos, updated_at: new Date().toISOString() }).eq("id", id).select("*").single();
  if (error) throw new Error(error.message);
  return data as Emissao;
}

export async function buscar(id: number): Promise<Emissao> {
  const { data, error } = await db().from("fat_emissoes").select("*").eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Emissão não encontrada");
  return data as Emissao;
}

export type EmitirOpts = {
  tipo?: TipoDoc;
  origem_tipo?: OrigemTipo;
  origem_id?: string | null;
  /** Em homologação, cria as parcelas a receber mesmo assim (testes). */
  gerar_receber_homologacao?: boolean;
  criado_por: string;
};

export async function emitir(doc: DocFat, o: EmitirOpts): Promise<Emissao> {
  const cfg = await configDe(doc.empresa);
  if (!cfg.ativo) throw new Error(`Faturamento pelo painel não habilitado para ${doc.empresa}`);
  const amb = ambienteDe(cfg);
  const origemTipo = o.origem_tipo ?? "manual";
  const tipo: TipoDoc = o.tipo ?? (origemTipo === "os" ? cfg.tipo_os : "nfe");
  const inval = validar(doc);
  if (inval) throw new Error(inval);
  if (tipo === "nfse" && !doc.cliente.email) throw new Error("NFS-e (Barueri) exige e-mail do tomador");

  if (o.origem_id) {
    const { data: ja } = await db().from("fat_emissoes").select("id,status")
      .eq("origem_tipo", origemTipo).eq("origem_id", o.origem_id).eq("ambiente", amb)
      .in("status", ["processando", "autorizada"]).limit(1);
    if (ja?.length) throw new Error(`Já existe documento ${ja[0].status} para esta origem (emissão #${ja[0].id})`);
  }

  const em = await emitente(cfg);
  const ref = `${doc.empresa}-${tipo}-${amb === "producao" ? "p" : "h"}-${Date.now()}`;
  const { data: ins, error } = await db().from("fat_emissoes").insert({
    empresa: doc.empresa, ambiente: amb, tipo, ref, origem_tipo: origemTipo, origem_id: o.origem_id ?? null,
    cliente: doc.cliente, itens: doc.itens, condicao: doc.condicao ?? null,
    valor_total: totalItens(doc.itens), status: "rascunho", criado_por: o.criado_por,
    gerar_receber: amb === "producao" ? true : !!o.gerar_receber_homologacao,
  }).select("*").single();
  if (error) throw new Error(error.message);
  const row = ins as Emissao;

  try {
    if (tipo === "recibo") return await emitirRecibo(row, doc, em, cfg, amb);

    const token = await tokenDe(doc.empresa, cfg.cnpj!, amb);
    let payload: Record<string, unknown>;
    let caminho: string;
    if (tipo === "nfe") {
      const campo = amb === "producao" ? "nfe_proximo_producao" : "nfe_proximo_homologacao";
      const { data: numero } = await supaAdmin().schema("orders").rpc("fat_reservar_numero", { p_empresa: doc.empresa, p_campo: campo });
      payload = montarNfe(doc, em, {
        natureza: cfg.natureza_operacao,
        serie: amb === "producao" ? cfg.nfe_serie_producao : cfg.nfe_serie_homologacao,
        numero: (numero as number | null) ?? null,
      });
      caminho = `/v2/nfe?ref=${encodeURIComponent(ref)}`;
    } else {
      payload = montarNfse(doc, em, {
        itemListaServico: cfg.item_lista_servico,
        codigoTributario: cfg.codigo_tributario_municipio,
        aliquota: cfg.aliquota_iss,
        serie: amb === "producao" ? cfg.rps_serie_producao : cfg.rps_serie_homologacao,
      });
      caminho = `/v2/nfse?ref=${encodeURIComponent(ref)}`;
    }
    const r = await chamar(HOST[amb], token, "POST", caminho, payload);
    const j = (r.json ?? {}) as Record<string, unknown>;
    if (r.status >= 400) {
      return await patch(row.id, {
        payload, status: "rejeitada", focus_status: String(j.codigo ?? r.status),
        mensagem: String(j.mensagem ?? r.texto.slice(0, 500)), erros: j.erros ?? null,
      });
    }
    await patch(row.id, { payload, status: "processando", focus_status: String(j.status ?? "processando_autorizacao") });
    // A SEFAZ costuma responder em segundos: tenta algumas vezes antes de devolver.
    let atual = await buscar(row.id);
    for (let i = 0; i < 6 && atual.status === "processando"; i++) {
      await new Promise((ok) => setTimeout(ok, 2500));
      atual = await atualizar(row.id);
    }
    return atual;
  } catch (e) {
    return await patch(row.id, { status: "erro", mensagem: e instanceof Error ? e.message : String(e) });
  }
}

async function emitirRecibo(row: Emissao, doc: DocFat, em: Emitente, cfg: Config, amb: Ambiente) {
  let numero: number;
  if (amb === "producao") {
    const { data } = await supaAdmin().schema("orders").rpc("fat_reservar_numero", { p_empresa: cfg.empresa, p_campo: "recibo_proximo" });
    if (data == null) throw new Error("Configure recibo_proximo (próximo nº do recibo, seguindo o Omie) antes de emitir");
    numero = data as number;
  } else {
    numero = 900000000 + row.id; // homologação: numeração à parte, nunca colide
  }
  const html = reciboHtml(doc, em, numero, amb === "homologacao");
  const path = `${cfg.empresa}/${amb}/recibo/${row.id}-${numero}.html`;
  const { error } = await supaAdmin().storage.from(BUCKET)
    .upload(path, new Blob([html], { type: "text/html; charset=utf-8" }), { upsert: true, contentType: "text/html; charset=utf-8" });
  if (error) throw new Error(`Storage: ${error.message}`);
  const aut = await patch(row.id, {
    status: "autorizada", focus_status: "interno", numero: String(numero), serie: "RECIBO",
    pdf_path: path, autorizada_em: new Date().toISOString(), mensagem: "Recibo gerado no painel (sem Focus)",
  });
  return await posAutorizacao(aut);
}

const MAPA_STATUS: Record<string, string> = {
  autorizado: "autorizada", cancelado: "cancelada",
  erro_autorizacao: "rejeitada", denegado: "rejeitada", erro_cancelamento: "autorizada",
  processando_autorizacao: "processando",
};

/** Consulta a Focus e, se autorizou agora, faz o pós-autorização. */
export async function atualizar(id: number): Promise<Emissao> {
  const row = await buscar(id);
  if (row.tipo === "recibo" || !["processando", "autorizada"].includes(row.status)) return row;
  if (row.status === "autorizada" && row.xml_path && row.pdf_path) return row;
  const cfg = await configDe(row.empresa);
  const token = await tokenDe(row.empresa, cfg.cnpj!, row.ambiente);
  const host = HOST[row.ambiente];
  const r = await chamar(host, token, "GET", `/v2/${row.tipo}/${encodeURIComponent(row.ref)}`);
  if (r.status >= 400) return await patch(id, { mensagem: `Consulta Focus: HTTP ${r.status}` });
  const j = (r.json ?? {}) as Record<string, string | undefined> & { erros?: unknown };
  const novo = MAPA_STATUS[j.status ?? ""] ?? row.status;
  const campos: Record<string, unknown> = {
    status: novo, focus_status: j.status ?? null,
    mensagem: j.mensagem_sefaz ?? j.mensagem ?? null, erros: j.erros ?? null,
  };
  if (novo === "autorizada") {
    campos.numero = j.numero ?? row.numero;
    campos.serie = j.serie ?? row.serie;
    campos.chave = j.chave_nfe ? j.chave_nfe.replace(/\D/g, "") : (j.codigo_verificacao ?? row.chave); // chave só com os 44 dígitos
    campos.autorizada_em = row.autorizada_em ?? new Date().toISOString();
    const base = `${row.empresa}/${row.ambiente}/${row.tipo}/${row.id}-${j.numero ?? "sn"}`;
    const xml = j.caminho_xml_nota_fiscal;
    const pdf = j.caminho_danfe ?? j.url_danfse ?? j.url;
    if (xml && !row.xml_path) campos.xml_path = await guardar(host, token, xml, `${base}.xml`, "application/xml");
    if (pdf && !row.pdf_path) campos.pdf_path = await guardar(host, token, pdf, `${base}.pdf`, "application/pdf");
  }
  const atual = await patch(id, campos);
  return row.status !== "autorizada" && novo === "autorizada" ? await posAutorizacao(atual) : atual;
}

async function guardar(host: string, token: string, caminho: string, path: string, tipo: string) {
  const arq = await baixar(host, token, caminho);
  if (!arq) return null;
  const { error } = await supaAdmin().storage.from(BUCKET).upload(path, new Blob([arq.bytes], { type: tipo }), { upsert: true, contentType: tipo });
  return error ? null : path;
}

/** Contas a receber + origem faturada. Idempotente (não recria parcelas). */
async function posAutorizacao(row: Emissao): Promise<Emissao> {
  let receber = row.receber_ids;
  if (row.gerar_receber && !receber?.length) {
    const ps = parcelas(Number(row.valor_total), row.condicao);
    const c = row.cliente;
    const doc = row.tipo === "recibo" ? `REC ${row.numero}` : `${row.tipo === "nfe" ? "NF-e" : "NFS-e"} ${row.numero}`;
    const hoje = new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
    const linhas = ps.map((p, i) => ({
      empresa: row.empresa,
      cliente_cnpj: (c.cnpj || c.cpf || "").replace(/\D/g, "") || null,
      cliente_razao: c.nome,
      numero_documento: doc,
      numero_parcela: `${i + 1}/${ps.length}`,
      numero_pedido: row.origem_rotulo ?? row.origem_id,
      numero_documento_fiscal: row.numero,
      chave_nfe: row.tipo === "nfe" ? row.chave : null,
      emissao: hoje,
      vencimento: p.vencimento,
      previsao: p.vencimento,
      valor: p.valor,
      origem: "painel",
      conferencia: "so_painel",
      observacao: row.ambiente === "homologacao" ? "HOMOLOGAÇÃO — documento de teste, sem valor fiscal" : null,
      created_by: row.criado_por,
      extras: { fat_emissao_id: row.id, ambiente: row.ambiente, tipo: row.tipo, origem_tipo: row.origem_tipo },
    }));
    const { data, error } = await supaAdmin().schema("finance").from("receber").insert(linhas).select("id");
    if (error) return await patch(row.id, { mensagem: `Autorizada, mas falhou criar contas a receber: ${error.message}` });
    receber = (data as { id: string }[]).map((d) => d.id);
    row = await patch(row.id, { receber_ids: receber });
  }
  await marcarOrigemFaturada(row);
  return row;
}

/**
 * Marca o PV/OS nativo de origem (P1) como faturado: orders.vendas_marcar_faturado.
 * Em homologação o banco só muda o status de documentos de TESTE; os reais
 * ficam com a anotação no histórico (a NF de homologação não tem valor fiscal).
 */
async function marcarOrigemFaturada(row: Emissao) {
  if (!row.origem_id || !["pv", "os", "venda"].includes(row.origem_tipo) || !/^\d+$/.test(row.origem_id)) return;
  const { error } = await supaAdmin().schema("orders").rpc("vendas_marcar_faturado", {
    p_id: Number(row.origem_id),
    p_doc: { emissao_id: row.id, tipo: row.tipo, numero: row.numero, chave: row.chave, ambiente: row.ambiente },
  });
  if (error) await patch(row.id, { mensagem: `Autorizada; falhou marcar a origem como faturada: ${error.message}` });
  else await supaAdmin().schema("orders").rpc("vendas_refrescar").then(() => null, () => null);
}

/** Desfaz o "faturado" do PV/OS de origem quando a nota é cancelada. */
async function desfazerOrigemFaturada(row: Emissao) {
  if (!row.origem_id || !["pv", "os", "venda"].includes(row.origem_tipo) || !/^\d+$/.test(row.origem_id)) return;
  await supaAdmin().schema("orders").rpc("vendas_desfazer_faturado", {
    p_id: Number(row.origem_id), p_doc: { emissao_id: row.id, tipo: row.tipo, numero: row.numero, ambiente: row.ambiente },
  }).then(() => null, () => null);
  await supaAdmin().schema("orders").rpc("vendas_refrescar").then(() => null, () => null);
}

/** Cancela. Só em homologação (produção: fora do escopo até o Benny decidir). */
export async function cancelar(id: number, justificativa: string): Promise<Emissao> {
  const row = await buscar(id);
  if (row.ambiente !== "homologacao") throw new Error("Cancelamento pelo painel só em homologação por enquanto");
  if (row.status !== "autorizada") throw new Error("Só documentos autorizados podem ser cancelados");
  if (row.tipo !== "recibo") {
    if (justificativa.trim().length < 15) throw new Error("Justificativa precisa de pelo menos 15 caracteres");
    const cfg = await configDe(row.empresa);
    const token = await tokenDe(row.empresa, cfg.cnpj!, row.ambiente);
    const r = await chamar(HOST[row.ambiente], token, "DELETE", `/v2/${row.tipo}/${encodeURIComponent(row.ref)}`, { justificativa: justificativa.trim() });
    const j = (r.json ?? {}) as Record<string, string>;
    if (r.status >= 400 || (j.status && j.status !== "cancelado")) {
      return await patch(id, { mensagem: `Cancelamento recusado: ${j.mensagem_sefaz ?? j.mensagem ?? r.texto.slice(0, 300)}` });
    }
  }
  if (row.receber_ids?.length) {
    await supaAdmin().schema("finance").from("receber").delete().in("id", row.receber_ids).eq("origem", "painel");
  }
  await desfazerOrigemFaturada(row);
  return await patch(id, { status: "cancelada", cancelada_em: new Date().toISOString(), receber_ids: null, mensagem: `Cancelada: ${justificativa.trim()}` });
}

/** URL assinada (1 h) de um arquivo do bucket. */
export async function urlArquivo(path: string | null) {
  if (!path) return null;
  const { data } = await supaAdmin().storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

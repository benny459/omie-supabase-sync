import "server-only";
import { supaAdmin } from "@/lib/supabase-admin";
import { HOST, baixar, chamar, empresaFocus, tokenDe, type Ambiente } from "./focus";
import { NATUREZA_OP, montarNfe, montarNfse, operacaoDe, parcelas, reciboHtml, semCobranca, totalDoc, totalItens, totalRetencoes, validar, type DocFat, type Emitente } from "./montar";
import { codigosSemEstoque, MSG_SEM_ESTOQUE, trocarParaCodigoNosso } from "@/lib/estoque-vinculos";
import { checarDoc, docFatPvOmie, type Checagem, type PvOmieDoc } from "./pv-omie";
import { docFatOsOmie, type OsOmieDoc } from "./os-omie";
import { ieConhecida } from "./ie-cliente";
import { avaliarIe } from "./ie-regra";

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
export type OrigemTipo = "pv" | "os" | "venda" | "manual" | "teste" | "pv_omie" | "os_omie";

export type Config = {
  empresa: string; cnpj: string | null; ativo: boolean; ambiente: Ambiente; producao_liberada: boolean;
  tipo_os: "recibo" | "nfse";
  nfe_serie_homologacao: string; nfe_proximo_homologacao: number | null;
  nfe_serie_producao: string; nfe_proximo_producao: number | null;
  rps_serie_homologacao: string; rps_serie_producao: string;
  recibo_proximo: number | null; natureza_operacao: string; item_lista_servico: string | null;
  codigo_tributario_municipio: string | null; aliquota_iss: number | null;
  omie_nfe_desligado_em: string | null; nfe_serie_omie: string | null; info_complementar_padrao: string | null;
};

export type Emissao = {
  id: number; empresa: string; ambiente: Ambiente; tipo: TipoDoc; ref: string;
  /** PV1962 / OS4885 / PV1890 — nativo: trigger do banco; PV do Omie: o motor. */
  origem_tipo: OrigemTipo; origem_id: string | null; origem_rotulo: string | null; ensaio: boolean;
  cliente: DocFat["cliente"]; itens: DocFat["itens"]; condicao: DocFat["condicao"];
  payload: unknown; status: string; focus_status: string | null; mensagem: string | null; erros: unknown;
  numero: string | null; serie: string | null; chave: string | null; valor_total: number; protocolo?: string | null;
  xml_path: string | null; pdf_path: string | null; receber_ids: string[] | null; gerar_receber: boolean;
  operacao?: DocFat["operacao"];
  autorizada_em: string | null; cancelada_em: string | null; criado_por: string | null; created_at: string;
  venda_parcelas?: number[] | null;
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

export async function emitente(cfg: Config): Promise<Emitente> {
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
  /** Rótulo legível da origem (PV1890) — vai para o receber e para a lista. */
  origem_rotulo?: string | null;
  /** Ensaio: mesmo payload, enviado à HOMOLOGAÇÃO com a própria empresa como
   *  destinatária (a SEFAZ de homologação recusa CNPJ de terceiros). Não gera
   *  receber nem marca a origem. */
  ensaio?: boolean;
  /** Teste (só admin): força HOMOLOGAÇÃO mantendo o destinatário e a seção de
   *  recebimento — usado para validar a Nova emissão sem emitir em produção. */
  forcar_homologacao?: boolean;
  /** PV/OS de projeto: parcelas do fechamento que esta nota fatura (06/10/26).
   *  Permite várias notas para a mesma origem (uma por parcela). */
  venda_parcelas?: number[] | null;
  /** Com forcar_homologacao, mantém a origem (pv/os) para testar a marcação da
   *  parcela — o banco só altera documentos TESTE E2E em homologação. */
  manter_origem?: boolean;
};

/** Devolve a numeração reservada quando o documento não chegou a existir
 *  (rejeitado/erro): só se ninguém reservou outro número depois. */
async function devolverNumero(empresa: string, campo: string, numero: number | null) {
  if (numero == null) return;
  await db().from("fat_config").update({ [campo]: numero }).eq("empresa", empresa).eq(campo, numero + 1);
}

/** Trava da produção de NF-e: Omie desligado + numeração sem conflito. */
async function travaProducaoNfe(cfg: Config) {
  if (!cfg.omie_nfe_desligado_em) {
    throw new Error("Produção bloqueada: confirme antes que a emissão de NF-e da " + cfg.empresa +
      " foi desligada no Omie (Faturamento › Prontidão › \"Omie desligado\"). Duas fontes emitindo a mesma série geram duplicidade na SEFAZ.");
  }
  if (cfg.nfe_proximo_producao == null) throw new Error("Configure o próximo nº de NF-e de produção");
  const { data: msg, error } = await supaAdmin().schema("orders").rpc("fat_guarda_numeracao", { p_empresa: cfg.empresa, p_numero: cfg.nfe_proximo_producao });
  if (error) throw new Error(`Guarda da numeração: ${error.message}`);
  if (msg) throw new Error(String(msg));
}

export async function emitir(doc: DocFat, o: EmitirOpts): Promise<Emissao> {
  let reservado: { campo: string; numero: number | null } | null = null;
  const cfg = await configDe(doc.empresa);
  if (!cfg.ativo) throw new Error(`Faturamento pelo painel não habilitado para ${doc.empresa}`);
  const amb: Ambiente = o.ensaio || o.forcar_homologacao ? "homologacao" : ambienteDe(cfg);
  if (o.ensaio) doc = await comoEnsaio(doc, cfg);
  const origemTipo: OrigemTipo = o.ensaio || (o.forcar_homologacao && !o.manter_origem) ? "teste" : (o.origem_tipo ?? "manual");
  const tipo: TipoDoc = o.tipo ?? (origemTipo === "os" ? cfg.tipo_os : "nfe");
  const inval = validar(doc);
  if (inval) throw new Error(inval);
  // 09/10/26: o recibo nº 4657 (OS4893, contrato CM180321) saiu com R$ 0,00 — documento de venda sem preço não sai.
  if (op0(doc) && !(Math.round(totalDoc(doc.itens) * 100) > 0) && tipo !== "nfe") {
    throw new Error(`${tipo === "recibo" ? "Recibo" : "NFS-e"} com total R$ 0,00 não é emitido. Corrija o valor ${doc.rotulo ? `da ${doc.rotulo}` : "dos itens"} (contrato recorrente: Faturamento › Contratos recorrentes › Editar o contrato e “Atualizar OS com o valor do contrato”) e emita de novo.`);
  }
  if (tipo === "nfse" && !doc.cliente.email) throw new Error("NFS-e (Barueri) exige e-mail do tomador");
  const op = operacaoDe(doc);
  if (op !== "venda" && tipo !== "nfe") throw new Error("Devolução/remessa só existem como NF-e");
  // Devolução/remessa sem a opção de cobrança não criam contas a receber.
  const semCob = op !== "venda" && semCobranca(doc);

  if (amb === "producao" && tipo === "nfe") await travaProducaoNfe(cfg);
  if (o.origem_id && !o.ensaio) {
    const { data: ja } = await db().from("fat_emissoes").select("id,status,venda_parcelas")
      .eq("origem_tipo", origemTipo).eq("origem_id", o.origem_id).eq("ambiente", amb)
      .in("status", ["processando", "autorizada"]);
    // Projeto por parcela: só bloqueia se a MESMA parcela já tem nota.
    const conflito = (ja ?? []).find((e) => !o.venda_parcelas?.length || !(e.venda_parcelas as number[] | null)?.length
      || (e.venda_parcelas as number[]).some((n) => o.venda_parcelas!.includes(n)));
    if (conflito) throw new Error(o.venda_parcelas?.length
      ? `A parcela já tem documento ${conflito.status} (emissão #${conflito.id})`
      : `Já existe documento ${conflito.status} para esta origem (emissão #${conflito.id})`);
  }

  const em = await emitente(cfg);
  const ref = `${doc.empresa}-${tipo}-${amb === "producao" ? "p" : "h"}-${Date.now()}`;
  const { data: ins, error } = await db().from("fat_emissoes").insert({
    empresa: doc.empresa, ambiente: amb, tipo, ref, origem_tipo: origemTipo, origem_id: o.origem_id ?? null,
    origem_rotulo: o.origem_rotulo ?? doc.rotulo ?? null, ensaio: !!o.ensaio,
    cliente: doc.cliente, itens: doc.itens, condicao: doc.condicao ?? null,
    operacao: op === "venda" ? null : doc.operacao ?? null,
    valor_total: totalDoc(doc.itens), status: "rascunho", criado_por: o.criado_por,
    gerar_receber: o.ensaio || semCob ? false : amb === "producao" ? true : !!o.gerar_receber_homologacao,
    venda_parcelas: o.venda_parcelas?.length ? o.venda_parcelas : null,
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
      reservado = { campo, numero: (numero as number | null) ?? null };
      payload = montarNfe(doc, em, {
        natureza: cfg.natureza_operacao,
        serie: amb === "producao" ? cfg.nfe_serie_producao : cfg.nfe_serie_homologacao,
        numero: (numero as number | null) ?? null,
        infoPadrao: cfg.info_complementar_padrao,
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
      if (reservado) await devolverNumero(doc.empresa, reservado.campo, reservado.numero);
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
    const atual = await buscar(row.id).catch(() => null);
    if (reservado && (!atual || !["processando", "autorizada"].includes(atual.status))) await devolverNumero(doc.empresa, reservado.campo, reservado.numero);
    return await patch(row.id, { status: "erro", mensagem: e instanceof Error ? e.message : String(e) });
  }
}

/** Ensaio: troca o destinatário pela própria empresa (homologação só aceita o
 *  CNPJ do emitente) e o e-mail por um interno — nada chega ao cliente. */
async function comoEnsaio(doc: DocFat, cfg: Config): Promise<DocFat> {
  const em = await emitente(cfg);
  return {
    ...doc,
    cliente: {
      ...doc.cliente,
      nome: `ENSAIO ${doc.rotulo ?? ""} — ${doc.cliente.nome}`.slice(0, 60),
      cnpj: em.cnpj, cpf: null, ie: em.inscricao_estadual ?? null, indicador_ie: em.inscricao_estadual ? "1" : "9",
      email: "contasareceber@waterworks.com.br",
      logradouro: em.logradouro || doc.cliente.logradouro, numero: em.numero || "S/N", complemento: null,
      bairro: em.bairro || doc.cliente.bairro, municipio: em.municipio || doc.cliente.municipio,
      codigo_municipio: em.codigo_municipio || null, uf: em.uf || "SP", cep: em.cep || doc.cliente.cep,
    },
    // Destinatário passa a ser a própria empresa (mesma UF): o CFOP é recalculado
    // (5102). O caminho interestadual (6102/idDest 2) não dá para ensaiar.
    itens: doc.itens.map((i) => ({ ...i, cfop: null })),
  };
}

/** PV do Omie → documento (espelho), sem enviar nada. */
export async function documentoPvOmie(empresa: string, codigo: number) {
  const { data, error } = await supaAdmin().schema("orders").rpc("fat_pv_omie_doc", { p_empresa: empresa, p_codigo: codigo });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`PV ${codigo} não encontrado no espelho do Omie`);
  const bruto = data as PvOmieDoc;
  return { bruto, doc: docFatPvOmie(empresa, bruto) };
}

/** Pré-voo: monta o payload exato e roda todas as checagens, sem chamar a Focus. */
export async function prevoo(doc: DocFat, extra: Parameters<typeof checarDoc>[1]) {
  const cfg = await configDe(doc.empresa);
  const checagens: Checagem[] = checarDoc(doc, extra);
  const add = (item: string, ok: boolean, detalhe: string, nivel: "erro" | "aviso" = "erro") => checagens.push({ item, ok, nivel, detalhe });
  const inval = validar(doc);
  add("Documento válido", !inval, inval ?? "ok");
  // IE do destinatário vs. a IE conhecida do cliente (09/10/26, HECI/PV1865): avisa antes da SEFAZ rejeitar.
  const docDest = (doc.cliente.cnpj || doc.cliente.cpf || "").replace(/\D/g, "");
  if (docDest.length === 14) {
    const ieAl = avaliarIe(doc.cliente.ie, await ieConhecida(docDest).catch(() => null));
    if (ieAl) add("Inscrição estadual do destinatário", false, ieAl.texto, ieAl.nivel);
  }
  const op = operacaoDe(doc);
  if (op !== "venda") {
    const o = doc.operacao;
    add("Operação", true, `${{ devolucao: "Devolução de compra", remessa: "Simples remessa", conserto: "Remessa para conserto" }[op]} — natureza "${o?.natureza || NATUREZA_OP[op]}"`, "aviso");
    if (op === "devolucao") add("NF de origem referenciada", (o?.nf_ref?.chave ?? "").replace(/\D/g, "").length === 44,
      o?.nf_ref?.chave ? `nº ${o.nf_ref.numero ?? "?"} · ${o.nf_ref.chave}` : "informe a chave de 44 dígitos");
    if (op !== "devolucao") add("Projeto da remessa", !!o?.projeto_codigo, o?.projeto_codigo ? `${o.projeto_nome ?? ""} (${o.projeto_codigo})` : "escolha o projeto");
    add("Motivo", (o?.motivo ?? "").trim().length >= 3, o?.motivo || "informe o motivo");
    add("Cobrança", true, semCobranca(doc) ? "sem cobrança (pagamento 90) — não cria contas a receber" : "gera contas a receber pelas parcelas", "aviso");
  }
  const prod = cfg.ambiente === "producao" && cfg.producao_liberada;
  add("Ambiente", true, prod ? "PRODUÇÃO" : "homologação (a chave de produção está desligada)", "aviso");
  add("Omie desligado para NF-e", !!cfg.omie_nfe_desligado_em, cfg.omie_nfe_desligado_em ? `desde ${cfg.omie_nfe_desligado_em}` : "ainda não confirmado — produção bloqueada", prod ? "erro" : "aviso");
  const { data: guarda } = await supaAdmin().schema("orders").rpc("fat_guarda_numeracao", { p_empresa: doc.empresa, p_numero: cfg.nfe_proximo_producao ?? 0 });
  add("Numeração sem conflito com o Omie", !guarda, guarda ? String(guarda) : `próxima NF-e de produção: série ${cfg.nfe_serie_producao} nº ${cfg.nfe_proximo_producao}`);
  const em = await emitente(cfg).catch((e) => { add("Emitente na Focus", false, e instanceof Error ? e.message : String(e)); return null; });
  const payload = em ? montarNfe(doc, em, {
    natureza: cfg.natureza_operacao, serie: cfg.nfe_serie_producao, numero: cfg.nfe_proximo_producao, infoPadrao: cfg.info_complementar_padrao,
  }) : null;
  const total = payload ? Number((payload as { valor_total: number }).valor_total) : totalDoc(doc.itens);
  const ret = totalRetencoes(doc.condicao?.retencoes);
  const liquido = Math.round((total - ret) * 100) / 100;
  const ps = parcelas(liquido, doc.condicao);
  const explicitas = doc.condicao?.parcelas ?? [];
  const somaInformada = explicitas.every((p) => p.valor != null) && explicitas.length
    ? Math.round(explicitas.reduce((a, p) => a + Number(p.valor ?? 0), 0) * 100) / 100 : liquido;
  if (!semCobranca(doc)) add(ret ? "Parcelas somam o líquido (total − retenções)" : "Parcelas somam o total", Math.abs(somaInformada - liquido) < 0.005,
    `${ps.map((p) => `${p.vencimento} R$ ${p.valor.toFixed(2)}${p.forma ? ` ${p.forma}` : ""}`).join(" · ")}${Math.abs(somaInformada - liquido) >= 0.005 ? ` — informado R$ ${somaInformada.toFixed(2)}, esperado R$ ${liquido.toFixed(2)}` : ""}`);
  const bloqueia = checagens.some((c) => !c.ok && c.nivel === "erro");
  return { checagens, payload, total, liquido, retencoes: ret, parcelas: ps, pode_emitir: !bloqueia, ambiente: prod ? "producao" : "homologacao" };
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

/** Venda comum (não devolução/remessa). */
const op0 = (doc: DocFat) => operacaoDe(doc) === "venda";

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
    if (j.protocolo) campos.protocolo = j.protocolo;
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
    // Valor a receber = total do documento − retenções que o tomador desconta.
    // As parcelas saem exatamente da seção "Recebimento" (datas, valores, forma).
    const cond = row.condicao;
    const liquido = Math.round((Number(row.valor_total) - totalRetencoes(cond?.retencoes)) * 100) / 100;
    const ps = parcelas(liquido, cond);
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
      codigo_categoria: cond?.categoria ?? null,
      codigo_projeto: cond?.projeto ?? null,
      id_conta_corrente: cond?.conta_corrente ?? null,
      origem: "painel",
      conferencia: "so_painel",
      observacao: row.ambiente === "homologacao" ? "HOMOLOGAÇÃO — documento de teste, sem valor fiscal" : null,
      created_by: row.criado_por,
      extras: {
        fat_emissao_id: row.id, ambiente: row.ambiente, tipo: row.tipo, origem_tipo: row.origem_tipo,
        forma: p.forma ?? cond?.forma_recebimento ?? null, condicao: cond?.codigo ?? cond?.descricao ?? null,
        centro_custo: cond?.centro_custo ?? null, vendedor: cond?.vendedor ?? null, contrato: cond?.contrato ?? null,
        retencoes: cond?.retencoes ?? null, conta: cond?.conta_nome ?? null,
        instrucao: cond?.instrucao_pagamento ?? null,
      },
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
    p_doc: { emissao_id: row.id, tipo: row.tipo, numero: row.numero, chave: row.chave, ambiente: row.ambiente,
             ...(row.venda_parcelas?.length ? { parcelas: row.venda_parcelas } : {}) },
  });
  if (error) await patch(row.id, { mensagem: `Autorizada; falhou marcar a origem como faturada: ${error.message}` });
  else await supaAdmin().schema("orders").rpc("vendas_refrescar").then(() => null, () => null);
}

/** Desfaz o "faturado" do PV/OS de origem quando a nota é cancelada. */
async function desfazerOrigemFaturada(row: Emissao, extra: Record<string, unknown> = {}) {
  if (!row.origem_id || !["pv", "os", "venda"].includes(row.origem_tipo) || !/^\d+$/.test(row.origem_id)) return;
  await supaAdmin().schema("orders").rpc("vendas_desfazer_faturado", {
    p_id: Number(row.origem_id), p_doc: { emissao_id: row.id, tipo: row.tipo, numero: row.numero, ambiente: row.ambiente, ...extra },
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

/** Situação de um recibo de produção antes de cancelar: recebimentos e envios ao cliente. */
export async function situacaoRecibo(id: number) {
  const row = await buscar(id);
  const ids = row.receber_ids ?? [];
  const fin = supaAdmin().schema("finance");
  const [{ data: rec }, { data: bx }, { data: env }] = await Promise.all([
    ids.length ? fin.from("receber").select("id,valor,valor_pago,pago_em,numero_documento").in("id", ids) : Promise.resolve({ data: [] as never[] }),
    ids.length ? fin.from("baixas").select("id,receber_id").in("receber_id", ids).limit(5) : Promise.resolve({ data: [] as never[] }),
    db().from("fat_envios").select("id,para,enviado_em,status").eq("emissao_id", id).order("enviado_em", { ascending: false }).limit(5),
  ]);
  const pagos = ((rec ?? []) as { valor_pago: number | null; pago_em: string | null }[]).filter((r) => Number(r.valor_pago ?? 0) > 0 || r.pago_em);
  return { row, receber: rec ?? [], tem_baixa: (bx ?? []).length > 0 || pagos.length > 0, envios: (env ?? []) as { para: string[] | null; enviado_em: string; status: string }[] };
}

/**
 * Cancela um RECIBO de produção (09/10/26). Recibo é documento interno (não passa
 * pela SEFAZ/prefeitura): o número cancelado não é reaproveitado — o próximo recibo
 * sai com o próximo número —, as parcelas a receber que ele criou saem do Receber
 * e a OS/PV de origem volta a "aberta" para corrigir e emitir de novo.
 * NF-e e NFS-e continuam fora (cancelamento fiscal é outro processo).
 */
export async function cancelarRecibo(id: number, motivo: string, por: string): Promise<Emissao & { envios_cliente: number }> {
  const { row, receber, tem_baixa, envios } = await situacaoRecibo(id);
  if (row.tipo !== "recibo") throw new Error("Só recibos podem ser cancelados por aqui. NF-e/NFS-e de produção: cancele na SEFAZ/prefeitura e fale com o administrador.");
  if (row.status === "cancelada") throw new Error(`O recibo nº ${row.numero ?? "?"} já está cancelado — emita o novo recibo pela OS (${row.origem_rotulo ?? "carteira"}).`);
  if (row.status !== "autorizada") throw new Error(`O recibo #${row.id} está “${row.status}”: não há o que cancelar. Use “Emitir recibo de novo” na OS.`);
  if (motivo.trim().length < 10) throw new Error("Escreva o motivo do cancelamento (pelo menos 10 letras) — ex.: “recibo saiu com valor zerado; reemitido com o valor do contrato”.");
  if (tem_baixa) {
    throw new Error(`O recibo nº ${row.numero} já tem recebimento baixado no Financeiro. Estorne a baixa em Financeiro › Contas a receber (${row.numero ? `REC ${row.numero}` : "título do recibo"}) e tente de novo — assim o caixa não fica com um pagamento sem título.`);
  }
  const ids = (receber as { id: string }[]).map((r) => r.id);
  if (ids.length) {
    const { error } = await supaAdmin().schema("finance").from("receber").delete().in("id", ids).eq("origem", "painel");
    if (error) throw new Error(`Não consegui tirar o título REC ${row.numero} do Contas a receber (${error.message}) — nada foi cancelado; tente de novo.`);
  }
  await desfazerOrigemFaturada(row, { cancelado_por: por, motivo: motivo.trim(), valor: Number(row.valor_total) });
  const quando = new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
  const aut = await patch(id, {
    status: "cancelada", cancelada_em: new Date().toISOString(), receber_ids: null,
    mensagem: `Recibo nº ${row.numero} cancelado por ${por} em ${quando}: ${motivo.trim()}`,
    payload: { ...((row.payload as Record<string, unknown> | null) ?? {}),
      cancelamento: { por, em: new Date().toISOString(), motivo: motivo.trim(), receber_removidos: receber, valor: Number(row.valor_total), envios_cliente: envios.length } },
  });
  // A OS de origem ganha no histórico "faturamento_desfeito" com quem/porquê (p_doc acima).
  return { ...aut, envios_cliente: envios.length };
}

/** URL assinada (1 h) de um arquivo do bucket. */
export async function urlArquivo(path: string | null) {
  if (!path) return null;
  // HTML (recibos, 2ª via) — o Storage serve .html como texto puro; passa pela
  // rota do painel, que devolve text/html; charset=utf-8 com barra de impressão.
  if (/\.html?$/i.test(path)) return `/api/faturamento/arquivo?p=${encodeURIComponent(path)}`;
  const { data } = await supaAdmin().storage.from(BUCKET).createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}


/** Emite a NF-e de um PV do Omie (espelho). Em produção bloqueia se o Omie já
 *  faturou o PV, se o painel já emitiu, ou se alguma checagem do pré-voo falhar.
 *  Não escreve no Omie: o PV fica faturado só no painel (fat_emissoes). */
export async function emitirPvOmie(empresa: string, codigo: number, o: { ensaio?: boolean; criado_por: string; documento?: DocFat | null }) {
  const base = await documentoPvOmie(empresa, codigo);
  const bruto = base.bruto;
  // Folha de emissão (05/10/26): o documento pode vir revisto pelo usuário
  // (recebimento, parcelas, OC, observações); as travas do PV continuam.
  const doc0: DocFat = o.documento ? { ...o.documento, empresa, rotulo: base.doc.rotulo } : base.doc;
  // código antigo (Omie) de item que já é nosso sai com o código nosso (07/10/26)
  const doc: DocFat = { ...doc0, itens: await trocarParaCodigoNosso(empresa, doc0.itens) };
  if (!o.ensaio) {
    const pre = await prevoo(doc, { nf_omie: bruto.nf_omie, emissao_painel: bruto.emissao_painel, etapa: String(bruto.pv.etapa ?? ""), total_pv: Number(bruto.pv.valor_total) });
    const erros = pre.checagens.filter((c) => !c.ok && c.nivel === "erro");
    if (erros.length) throw new Error("Pré-voo com pendências: " + erros.map((c) => `${c.item} (${c.detalhe})`).join("; "));
    // NF-e movimenta estoque: só itens do estoque nosso (05/10/26).
    const sem = await codigosSemEstoque(empresa, doc.itens.map((i) => i.codigo ?? ""));
    if (sem.length) throw new Error(MSG_SEM_ESTOQUE(sem));
  }
  return emitir(doc, {
    tipo: "nfe", origem_tipo: "pv_omie", origem_id: String(codigo), origem_rotulo: doc.rotulo ?? null,
    ensaio: !!o.ensaio, criado_por: o.criado_por,
  });
}

/** OS do Omie → documento do RECIBO (espelho), sem enviar nada (05/10/26). */
export async function documentoOsOmie(empresa: string, codigo: number) {
  const { data, error } = await supaAdmin().schema("orders").rpc("fat_os_omie_doc", { p_empresa: empresa, p_codigo: String(codigo) });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`OS ${codigo} não encontrada no espelho do Omie`);
  const bruto = data as OsOmieDoc;
  return { bruto, doc: docFatOsOmie(empresa, bruto) };
}

/** Por que esta OS do Omie não pode virar recibo (já faturada em algum lugar). */
export function bloqueioOsOmie(b: OsOmieDoc): string | null {
  const os = b.os as Record<string, unknown>;
  if (b.emissao_painel) return `o painel já emitiu ${b.emissao_painel.tipo === "recibo" ? "o recibo" : "documento"} ${b.emissao_painel.numero ?? `#${b.emissao_painel.id}`} (${b.emissao_painel.status})`;
  if (b.nfse_registrada) return "já tem NFS-e registrada no painel";
  if (os.num_recibo) return `o Omie já emitiu o recibo ${os.num_recibo}`;
  if (os.faturada === "S") return "a OS já está faturada no Omie";
  return null;
}

/** Pré-voo do RECIBO: sem NCM/IE/SEFAZ — só cadastro, origem, financeiro e numeração. */
export async function prevooRecibo(doc: DocFat, extra: { bloqueio?: string | null; total_os?: number | null }) {
  const cfg = await configDe(doc.empresa);
  const checagens: Checagem[] = [];
  const add = (item: string, ok: boolean, detalhe: string, nivel: "erro" | "aviso" = "erro") => checagens.push({ item, ok, nivel, detalhe });
  const c = doc.cliente;
  const so = (v: unknown) => String(v ?? "").replace(/\D/g, "");
  add("Sem faturamento anterior", !extra.bloqueio, extra.bloqueio ?? "ok");
  add("Cliente: CNPJ/CPF", !!(so(c.cnpj) || so(c.cpf)), so(c.cnpj) || so(c.cpf) || "faltando");
  add("Cliente: endereço", !!(c.logradouro && c.municipio), [c.logradouro, c.numero, c.bairro, c.municipio].filter(Boolean).join(", ") || "faltando", "aviso");
  add("Itens", doc.itens.length > 0, `${doc.itens.length} item(ns)`);
  for (const i of doc.itens) if (!(i.quantidade > 0 && i.valor_unitario > 0)) add(`Qtd/valor — ${i.codigo}`, false, `${i.quantidade} × ${i.valor_unitario}`);
  if (extra.total_os != null) {
    const t = totalDoc(doc.itens);
    add("Total do recibo = total da OS", Math.abs(t - Number(extra.total_os)) < 0.02, `recibo ${t.toFixed(2)} · OS ${Number(extra.total_os).toFixed(2)}`, "aviso");
  }
  add("Projeto", !!doc.condicao?.projeto, doc.condicao?.projeto ? String(doc.condicao.projeto) : "obrigatório");
  add("Categoria de receita", !!doc.condicao?.categoria, doc.condicao?.categoria ? String(doc.condicao.categoria) : "obrigatória");
  const inval = validar(doc);
  add("Documento válido", !inval, inval ?? "ok");
  const prod = cfg.ambiente === "producao" && cfg.producao_liberada;
  add("Ambiente", true, prod ? `PRODUÇÃO — recibo nº ${cfg.recibo_proximo ?? "?"}` : "homologação (numeração de teste)", "aviso");
  if (prod) add("Numeração do recibo", cfg.recibo_proximo != null, cfg.recibo_proximo != null ? `próximo recibo: ${cfg.recibo_proximo}` : "configure recibo_proximo");
  const total = totalDoc(doc.itens);
  const ret = totalRetencoes(doc.condicao?.retencoes);
  const liquido = Math.round((total - ret) * 100) / 100;
  const ps = parcelas(liquido, doc.condicao);
  const explicitas = doc.condicao?.parcelas ?? [];
  const somaInformada = explicitas.every((p) => p.valor != null) && explicitas.length
    ? Math.round(explicitas.reduce((a, p) => a + Number(p.valor ?? 0), 0) * 100) / 100 : liquido;
  add(ret ? "Parcelas somam o líquido (total − retenções)" : "Parcelas somam o total", Math.abs(somaInformada - liquido) < 0.005,
    `${ps.map((p) => `${p.vencimento} R$ ${p.valor.toFixed(2)}${p.forma ? ` ${p.forma}` : ""}`).join(" · ")}${Math.abs(somaInformada - liquido) >= 0.005 ? ` — informado R$ ${somaInformada.toFixed(2)}, esperado R$ ${liquido.toFixed(2)}` : ""}`);
  const bloqueia = checagens.some((x) => !x.ok && x.nivel === "erro");
  return { checagens, payload: null, total, liquido, retencoes: ret, parcelas: ps, pode_emitir: !bloqueia, ambiente: prod ? "producao" : "homologacao" };
}

/** Emite o RECIBO de uma OS do Omie pelo painel (05/10/26 — a SF não fatura
 *  mais recibo no Omie). Numeração de produção do painel (recibo_proximo),
 *  contas a receber pelas parcelas revistas na folha. Não escreve no Omie: a OS
 *  fica faturada só no painel (fat_emissoes origem os_omie). */
export async function emitirOsOmie(empresa: string, codigo: number, o: { criado_por: string; documento?: DocFat | null; forcar_homologacao?: boolean }) {
  const base = await documentoOsOmie(empresa, codigo);
  const doc: DocFat = o.documento ? { ...o.documento, empresa, rotulo: base.doc.rotulo } : base.doc;
  const pre = await prevooRecibo(doc, { bloqueio: bloqueioOsOmie(base.bruto), total_os: totalDoc(base.doc.itens) });
  const erros = pre.checagens.filter((c) => !c.ok && c.nivel === "erro");
  if (erros.length) throw new Error("Pré-voo com pendências: " + erros.map((c) => `${c.item} (${c.detalhe})`).join("; "));
  return emitir(doc, {
    tipo: "recibo", origem_tipo: "os_omie", origem_id: String(codigo), origem_rotulo: doc.rotulo ?? null,
    criado_por: o.criado_por, forcar_homologacao: !!o.forcar_homologacao, gerar_receber_homologacao: !!o.forcar_homologacao,
  });
}

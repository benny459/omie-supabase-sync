"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import {
  Aviso, BotaoTela, CabecalhoTela, Carregando, ChipFiltro, FaixaFiltros, GradeKpis, PaginaNavy, brl, cartao,
} from "@/components/navy/tela/KitTela";
import type { ClienteFat, DocFat, ItemFat } from "@/lib/faturamento/montar";
import FilaVendasNativas from "@/components/vendas/FilaVendasNativas";

/* Faturamento — emissão de NF-e / NFS-e / recibo pela Focus (P5, 05/10/26).
   Lista as emissões, consulta o status na Focus, abre XML/PDF e, em
   homologação, cancela. O formulário serve para emitir a partir de um PV/OS
   (origem) ou para teste; o PV/OS nativo chama o mesmo endpoint. */

type Emissao = {
  id: number; empresa: string; ambiente: "homologacao" | "producao"; tipo: "nfe" | "nfse" | "recibo";
  origem_tipo: string; origem_id: string | null; cliente: ClienteFat; status: string; focus_status: string | null;
  mensagem: string | null; numero: string | null; serie: string | null; chave: string | null; valor_total: number;
  xml_path: string | null; pdf_path: string | null; receber_ids: string[] | null; autorizada_em: string | null;
  criado_por: string | null; created_at: string;
};
type Config = { empresa: string; ativo: boolean; ambiente: string; producao_liberada: boolean; tipo_os: string };

const TIPO: Record<string, string> = { nfe: "NF-e", nfse: "NFS-e", recibo: "Recibo" };
const STATUS: Record<string, { rot: string; cor: string }> = {
  rascunho: { rot: "Rascunho", cor: "var(--ww-text-faint)" },
  processando: { rot: "Processando", cor: "#E0A93B" },
  autorizada: { rot: "Autorizada", cor: "#3FB68B" },
  rejeitada: { rot: "Rejeitada", cor: "#E5484D" },
  cancelada: { rot: "Cancelada", cor: "var(--ww-text-faint)" },
  erro: { rot: "Erro", cor: "#E5484D" },
};

const input: CSSProperties = {
  height: 32, padding: "0 10px", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", minWidth: 0,
  border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
};
const rotulo: CSSProperties = { fontSize: 11.5, color: "var(--ww-text-faint)", fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 };

const VAZIO: ClienteFat = { nome: "", cnpj: "", ie: "", email: "", logradouro: "", numero: "", bairro: "", municipio: "", uf: "SP", cep: "" };

/** Dados fictícios para validar o fluxo em homologação (nada vai a cliente real). */
/* Destinatário de teste: a própria SF (a SEFAZ de homologação só aceita CNPJ do seu cadastro; CNPJs de terceiros vêm "não cadastrado"). */
const TESTE: { cliente: ClienteFat; itens: ItemFat[]; parcelas: string } = {
  cliente: {
    nome: "TESTE E2E CLIENTE LTDA", cnpj: "15766003000108", ie: "206878808115", email: "contasareceber@waterworks.com.br",
    logradouro: "Avenida Tucunare", numero: "550", bairro: "Tambore", municipio: "Barueri", codigo_municipio: "3505708", uf: "SP", cep: "06460020",
  },
  itens: [{ codigo: "TESTE-E2E-01", descricao: "TESTE E2E - ELEMENTO FILTRANTE", quantidade: 2, valor_unitario: 150, unidade: "UN", ncm: "84212100" }],
  parcelas: "30/60",
};

function parcelasDe(txt: string) {
  const dias = txt.split(/[\/,;\s]+/).map((d) => Number(d)).filter((d) => Number.isFinite(d) && d >= 0);
  return dias.length ? { parcelas: dias.map((d) => ({ dias: d })) } : null;
}

export default function TelaFaturamento() {
  const [lista, setLista] = useState<Emissao[] | null>(null);
  const [config, setConfig] = useState<Config[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<string>("todos");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(false);
  const [ocupado, setOcupado] = useState<number | "nova" | null>(null);
  const [links, setLinks] = useState<Record<number, { xml?: string | null; pdf?: string | null }>>({});

  const carregar = useCallback(async () => {
    try {
      const [a, b] = await Promise.all([
        fetch("/api/faturamento/emissoes", { cache: "no-store" }).then((r) => r.json()),
        fetch("/api/faturamento/config", { cache: "no-store" }).then((r) => r.json()),
      ]);
      if (a.error) throw new Error(a.error);
      setLista(a.emissoes);
      setConfig(b.config ?? []);
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
    }
  }, []);
  useEffect(() => { carregar(); }, [carregar]);

  async function atualizar(id: number) {
    setOcupado(id);
    try {
      const r = await fetch(`/api/faturamento/emissoes/${id}`, { cache: "no-store" }).then((x) => x.json());
      if (r.error) throw new Error(r.error);
      setLinks((l) => ({ ...l, [id]: { xml: r.xml_url, pdf: r.pdf_url } }));
      setLista((ls) => ls?.map((e) => (e.id === id ? { ...e, ...r.emissao } : e)) ?? null);
      return r as { xml_url: string | null; pdf_url: string | null };
    } catch (e) {
      setErro(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setOcupado(null);
    }
  }

  async function abrir(id: number, qual: "xml" | "pdf") {
    const r = links[id]?.[qual] ? { [`${qual}_url`]: links[id][qual] } as Record<string, string> : await atualizar(id);
    const url = r?.[`${qual}_url` as "xml_url"];
    if (url) window.open(url, "_blank", "noopener");
    else setErro("Arquivo ainda não disponível");
  }

  async function cancelar(e: Emissao) {
    const just = window.prompt("Justificativa do cancelamento (mín. 15 caracteres):", "Teste de homologação cancelado pelo painel");
    if (!just) return;
    setOcupado(e.id);
    const r = await fetch(`/api/faturamento/emissoes/${e.id}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "cancelar", justificativa: just }),
    }).then((x) => x.json());
    setOcupado(null);
    if (r.error) setErro(r.error); else carregar();
  }

  const filtradas = useMemo(() => (lista ?? []).filter((e) => {
    if (filtro !== "todos" && e.status !== filtro) return false;
    if (!busca) return true;
    const b = busca.toLowerCase();
    return [e.cliente?.nome, e.numero, e.origem_id, String(e.id)].some((v) => (v ?? "").toLowerCase().includes(b));
  }), [lista, filtro, busca]);

  const kpis = useMemo(() => {
    const l = lista ?? [];
    const aut = l.filter((e) => e.status === "autorizada");
    return [
      { rotulo: "Autorizadas", valor: String(aut.length), sub: brl(aut.reduce((s, e) => s + Number(e.valor_total), 0)), hero: true },
      { rotulo: "Processando", valor: String(l.filter((e) => e.status === "processando").length), sub: "na Focus / SEFAZ" },
      { rotulo: "Rejeitadas / erro", valor: String(l.filter((e) => ["rejeitada", "erro"].includes(e.status)).length), sub: "ver mensagem" },
      { rotulo: "Canceladas", valor: String(l.filter((e) => e.status === "cancelada").length), sub: "só homologação" },
    ];
  }, [lista]);

  const homolog = config.filter((c) => c.ativo && c.ambiente !== "producao").map((c) => c.empresa);

  return (
    <PaginaNavy>
      <CabecalhoTela
        area="Financeiro"
        titulo="Faturamento"
        sub={<>Emissão de NF-e, NFS-e e recibo pela Focus, sem Omie.
          {homolog.length > 0 && <b style={{ color: "#E0A93B" }}> {homolog.join(", ")} em HOMOLOGAÇÃO — sem valor fiscal.</b>}</>}
        acoes={<>
          <BotaoTela onClick={carregar}>Recarregar</BotaoTela>
          <BotaoTela primario onClick={() => setAberto((v) => !v)}>{aberto ? "Fechar" : "Nova emissão"}</BotaoTela>
        </>}
      />
      {erro && <div onClick={() => setErro(null)}><Aviso>{erro}</Aviso></div>}
      {aberto && <NovaEmissao config={config} ocupado={ocupado === "nova"} onEmitir={async (body) => {
        setOcupado("nova");
        const r = await fetch("/api/faturamento/emitir", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
        setOcupado(null);
        if (r.error) { setErro(r.error); return; }
        setLinks((l) => ({ ...l, [r.emissao.id]: { xml: r.xml_url, pdf: r.pdf_url } }));
        if (r.emissao.status !== "autorizada") setErro(`Emissão #${r.emissao.id}: ${STATUS[r.emissao.status]?.rot ?? r.emissao.status} — ${r.emissao.mensagem ?? ""}`);
        setAberto(false);
        carregar();
      }} />}
      <FilaVendasNativas soAbertos titulo="PV / OS do painel a faturar" />
      <GradeKpis kpis={kpis} />
      <FaixaFiltros busca={busca} onBusca={setBusca} placeholder="Cliente, nº, PV/OS…">
        {["todos", "autorizada", "processando", "rejeitada", "erro", "cancelada"].map((s) => (
          <ChipFiltro key={s} ativo={filtro === s} onClick={() => setFiltro(s)}>{s === "todos" ? "Todos" : STATUS[s].rot}</ChipFiltro>
        ))}
      </FaixaFiltros>
      {!lista ? <Carregando /> : (
        <div style={{ ...cartao, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ textAlign: "left", color: "var(--ww-text-faint)" }}>
                {["#", "Data", "Documento", "Origem", "Cliente", "Valor", "Status", "Arquivos", ""].map((h) => (
                  <th key={h} style={{ padding: "14px 12px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--ww-border)" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtradas.length === 0 && (
                <tr><td colSpan={9} style={{ padding: 28, textAlign: "center", color: "var(--ww-text-muted)" }}>Nenhuma emissão.</td></tr>
              )}
              {filtradas.map((e) => {
                const st = STATUS[e.status] ?? { rot: e.status, cor: "var(--ww-text)" };
                return (
                  <tr key={e.id} style={{ borderBottom: "1px solid var(--ww-border)" }}>
                    <td style={td}>{e.id}</td>
                    <td style={td}>{new Date(e.created_at).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</td>
                    <td style={td}>
                      <b>{TIPO[e.tipo]}</b> {e.numero ? `nº ${e.numero}` : ""}{e.serie && e.tipo !== "recibo" ? ` · série ${e.serie}` : ""}
                      <div style={{ fontSize: 11, color: e.ambiente === "producao" ? "#3FB68B" : "#E0A93B", fontWeight: 600 }}>
                        {e.empresa} · {e.ambiente === "producao" ? "PRODUÇÃO" : "HOMOLOGAÇÃO"}
                      </div>
                    </td>
                    <td style={td}>{e.origem_id ? `${e.origem_tipo.toUpperCase()} ${e.origem_id}` : e.origem_tipo}</td>
                    <td style={{ ...td, maxWidth: 240 }}>{e.cliente?.nome}</td>
                    <td style={{ ...td, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(Number(e.valor_total))}</td>
                    <td style={{ ...td, maxWidth: 280 }}>
                      <span style={{ color: st.cor, fontWeight: 600 }}>● {st.rot}</span>
                      {e.receber_ids?.length ? <span style={{ fontSize: 11, color: "var(--ww-text-faint)" }}> · {e.receber_ids.length} parcela(s) a receber</span> : null}
                      {e.mensagem && <div style={{ fontSize: 11, color: "var(--ww-text-muted)" }}>{e.mensagem}</div>}
                    </td>
                    <td style={td}>
                      {e.xml_path && <button style={lk} onClick={() => abrir(e.id, "xml")}>XML</button>}
                      {e.pdf_path && <button style={lk} onClick={() => abrir(e.id, "pdf")}>{e.tipo === "recibo" ? "Recibo" : "PDF"}</button>}
                    </td>
                    <td style={{ ...td, whiteSpace: "nowrap" }}>
                      {["processando", "autorizada"].includes(e.status) && e.tipo !== "recibo" && (
                        <button style={lk} disabled={ocupado === e.id} onClick={() => atualizar(e.id)}>{ocupado === e.id ? "…" : "Atualizar"}</button>
                      )}
                      {e.status === "autorizada" && e.ambiente === "homologacao" && (
                        <button style={{ ...lk, color: "#E5484D" }} disabled={ocupado === e.id} onClick={() => cancelar(e)}>Cancelar</button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <Aviso tone="info">
        Enviar ao cliente por e-mail fica disponível quando o Resend estiver configurado (RESEND_API_KEY). Até lá, abra o PDF/XML e envie o link.
      </Aviso>
    </PaginaNavy>
  );
}

const td: CSSProperties = { padding: "10px 12px", verticalAlign: "top", color: "var(--ww-text)" };
const lk: CSSProperties = { background: "none", border: 0, color: "var(--ww-accent-text)", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "0 6px 0 0" };

function NovaEmissao({ config, ocupado, onEmitir }: {
  config: Config[]; ocupado: boolean; onEmitir: (body: unknown) => void;
}) {
  const ativas = config.filter((c) => c.ativo);
  const [empresa, setEmpresa] = useState(ativas[0]?.empresa ?? "SF");
  const [tipo, setTipo] = useState<"nfe" | "nfse" | "recibo">("nfe");
  const [origemTipo, setOrigemTipo] = useState("manual");
  const [origemId, setOrigemId] = useState("");
  const [cli, setCli] = useState<ClienteFat>(VAZIO);
  const [itens, setItens] = useState<ItemFat[]>([{ codigo: "", descricao: "", quantidade: 1, valor_unitario: 0, unidade: "UN", ncm: "" }]);
  const [parc, setParc] = useState("0");
  const [obs, setObs] = useState("");
  const [pedidoCli, setPedidoCli] = useState("");
  const [gerarRec, setGerarRec] = useState(false);
  const cfg = config.find((c) => c.empresa === empresa);
  const homolog = cfg?.ambiente !== "producao";

  const campo = (k: keyof ClienteFat, rot: string, w = 160) => (
    <label style={{ ...rotulo, width: w }}>{rot}
      <input style={input} value={(cli[k] as string) ?? ""} onChange={(e) => setCli({ ...cli, [k]: e.target.value })} />
    </label>
  );

  function enviar() {
    const documento: DocFat = {
      empresa, cliente: cli, itens: itens.filter((i) => i.descricao),
      condicao: parcelasDe(parc), observacoes: obs || null, pedido_cliente: pedidoCli || null,
    };
    onEmitir({ documento, tipo, origem_tipo: origemTipo, origem_id: origemId || null, gerar_receber_homologacao: gerarRec });
  }

  return (
    <section style={{ ...cartao, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={rotulo}>Empresa
          <select style={input} value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            {ativas.map((c) => <option key={c.empresa} value={c.empresa}>{c.empresa}</option>)}
          </select>
        </label>
        <label style={rotulo}>Documento
          <select style={input} value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="nfe">NF-e (produtos / PV)</option>
            <option value="recibo">Recibo de prestação (OS)</option>
            <option value="nfse">NFS-e (OS)</option>
          </select>
        </label>
        <label style={rotulo}>Origem
          <select style={input} value={origemTipo} onChange={(e) => setOrigemTipo(e.target.value)}>
            <option value="manual">Manual</option><option value="pv">PV</option><option value="os">OS</option><option value="teste">Teste</option>
          </select>
        </label>
        <label style={{ ...rotulo, width: 120 }}>Nº PV/OS<input style={input} value={origemId} onChange={(e) => setOrigemId(e.target.value)} /></label>
        <span style={{ flex: 1 }} />
        <BotaoTela onClick={() => { setCli(TESTE.cliente); setItens(TESTE.itens); setParc(TESTE.parcelas); setOrigemTipo("teste"); setObs("TESTE E2E — homologação"); }}>
          Preencher teste
        </BotaoTela>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ww-text-2)" }}>Cliente</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {campo("nome", "Razão social", 280)}{campo("cnpj", "CNPJ", 150)}{campo("cpf", "CPF", 130)}{campo("ie", "Inscrição estadual", 140)}{campo("email", "E-mail", 220)}
        {campo("logradouro", "Logradouro", 240)}{campo("numero", "Nº", 70)}{campo("complemento", "Compl.", 110)}{campo("bairro", "Bairro", 150)}
        {campo("municipio", "Município", 160)}{campo("codigo_municipio", "Cód. IBGE", 100)}{campo("uf", "UF", 50)}{campo("cep", "CEP", 100)}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ww-text-2)" }}>Itens</div>
      {itens.map((it, n) => (
        <div key={n} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          {([["codigo", "Código", 120], ["descricao", "Descrição", 300], ["ncm", "NCM", 100], ["unidade", "Un", 60]] as const).map(([k, r, w]) => (
            <label key={k} style={{ ...rotulo, width: w }}>{r}
              <input style={input} value={(it[k] as string) ?? ""} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, [k]: e.target.value } : x)))} />
            </label>
          ))}
          {([["quantidade", "Qtd"], ["valor_unitario", "Valor unit."]] as const).map(([k, r]) => (
            <label key={k} style={{ ...rotulo, width: 110 }}>{r}
              <input style={input} type="number" step="0.01" value={it[k]} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, [k]: Number(e.target.value) } : x)))} />
            </label>
          ))}
          <button style={lk} onClick={() => setItens(itens.filter((_, i) => i !== n))}>remover</button>
        </div>
      ))}
      <div><button style={lk} onClick={() => setItens([...itens, { codigo: "", descricao: "", quantidade: 1, valor_unitario: 0, unidade: "UN" }])}>+ item</button></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ ...rotulo, width: 160 }}>Parcelas (dias)<input style={input} value={parc} onChange={(e) => setParc(e.target.value)} placeholder="ex.: 30/60/90" /></label>
        <label style={{ ...rotulo, width: 160 }}>Pedido do cliente (OC)<input style={input} value={pedidoCli} onChange={(e) => setPedidoCli(e.target.value)} /></label>
        <label style={{ ...rotulo, flex: 1, minWidth: 260 }}>Observações<input style={input} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
      </div>
      {homolog && (
        <label style={{ fontSize: 12.5, color: "var(--ww-text-2)", display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={gerarRec} onChange={(e) => setGerarRec(e.target.checked)} />
          Gerar contas a receber mesmo em homologação (só para teste — o cancelamento apaga)
        </label>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <BotaoTela primario disabled={ocupado} onClick={enviar}>{ocupado ? "Emitindo…" : `Emitir ${TIPO[tipo]}${homolog ? " (homologação)" : ""}`}</BotaoTela>
        <span style={{ fontSize: 12, color: homolog ? "#E0A93B" : "#E5484D", fontWeight: 600 }}>
          {homolog ? "Ambiente de HOMOLOGAÇÃO — sem valor fiscal" : "PRODUÇÃO — documento fiscal real"}
        </span>
      </div>
    </section>
  );
}

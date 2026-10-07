"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Aviso, BotaoTela, CabecalhoTela, Carregando, PaginaNavy, brl, cartao } from "@/components/navy/tela/KitTela";
import BotaoEmitirNf from "@/components/faturamento/BotaoEmitirNf";
import type { DocFat } from "@/lib/faturamento/montar";
import { FORMAS_RECEBIMENTO, STATUS_VENDA, type VendaDoc, type VendaItem, type VendaSalvar } from "@/lib/vendas";
import { BuscaPessoa, BuscaProposta } from "@/components/vendas/BuscasCrmCadastro";
import { BotaoNovoProjeto } from "@/components/cadastros/NovoProjetoRapido";
import { OcAnexosPainel } from "@/components/vendas/OcAnexos";

/* PV / OS nativo do painel (P1, 05/10/26): cria, edita, cancela e emite a NF
   (motor da Focus, P5). Os documentos que o CRM cria pelo caminho nativo
   abrem aqui também. Cada gravação reflete na hora em Avulsos, ERP·Vendas e
   no backlog de faturamento (espelho em sales.*). */

type Opcoes = {
  condicoes: { codigo: string; descricao: string }[];
  projetos: { codigo: number; nome: string }[];
  categorias: { codigo: string; descricao: string }[];
  vendedores?: { codigo: string; nome: string }[];
};

const input: CSSProperties = {
  height: 32, padding: "0 10px", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", minWidth: 0, width: "100%",
  border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
};
const rotulo: CSSProperties = { fontSize: 11.5, color: "var(--ww-text-faint)", fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 };
const td: CSSProperties = { padding: "8px 10px", verticalAlign: "top", color: "var(--ww-text)", fontSize: 13 };
const th: CSSProperties = { padding: "12px 10px", fontSize: 13, fontWeight: 600, borderBottom: "1px solid var(--ww-border)", textAlign: "left", color: "var(--ww-text-faint)" };
const lk: CSSProperties = { background: "none", border: 0, color: "var(--ww-accent-text)", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: 0 };

const hoje = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);
const itemVazio = (): VendaItem => ({ codigo: "", descricao: "", unidade: "UN", ncm: "", quantidade: 1, valor_unitario: 0 });
const dataBR = (s?: string | null) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");

function Campo({ rot, children, largura }: { rot: string; children: ReactNode; largura?: number }) {
  return <label style={{ ...rotulo, gridColumn: largura ? `span ${largura}` : undefined }}>{rot}{children}</label>;
}

export default function TelaVendaDoc({ id }: { id: number | null }) {
  const router = useRouter();
  const [doc, setDoc] = useState<VendaDoc | null>(null);
  const [docfat, setDocfat] = useState<DocFat | null>(null);
  const [form, setForm] = useState<VendaSalvar | null>(null);
  const [clienteNome, setClienteNome] = useState("");
  const [op, setOp] = useState<Opcoes>({ condicoes: [], projetos: [], categorias: [] });
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [motivo, setMotivo] = useState<string | null>(null);
  // Vínculo com a proposta do CRM (obrigatório; admin pode lançar "sem proposta" com motivo)
  const [semProposta, setSemProposta] = useState<string | null>(null);
  const [avisoProp, setAvisoProp] = useState<string | null>(null);
  const [puxando, setPuxando] = useState(false);
  // Título da proposta puxada: dá o nome sugerido ao "+ Novo projeto".
  const [propTitulo, setPropTitulo] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    if (id == null) {
      setForm({ empresa: "SF", tipo: "PV", cliente_codigo: "", previsao: hoje(), condicao_codigo: "000",
        projeto_codigo: null, categoria_codigo: null, itens: [itemVazio()] });
      return;
    }
    const r = await fetch(`/api/vendas/${id}`, { cache: "no-store" }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    if (r.error) { setErro(r.error); return; }
    const d = r.documento as VendaDoc;
    setDoc(d); setDocfat(r.docfat);
    setClienteNome(d.cliente ?? "");
    setForm({
      id: d.id, empresa: d.empresa, tipo: d.tipo, cliente_codigo: d.cliente_codigo ?? "", proposta: d.proposta,
      previsao: d.previsao, condicao_codigo: d.condicao_codigo, qtd_parcelas: d.qtd_parcelas,
      projeto_codigo: d.projeto_codigo, categoria_codigo: d.categoria_codigo, vendedor_codigo: d.vendedor_codigo,
      conta_codigo: d.conta_codigo, forma_recebimento: d.forma_recebimento ?? null, observacoes: d.observacoes, obs_nf: d.obs_nf, num_pedido_cliente: d.num_pedido_cliente,
      contato: d.contato, valor_desconto: d.valor_desconto, valor_frete: d.valor_frete,
      itens: d.itens.map((i) => ({ codigo: i.codigo, ncod_prod: i.ncod_prod, descricao: i.descricao, unidade: i.unidade,
        ncm: i.ncm, cfop: i.cfop, quantidade: Number(i.quantidade), valor_unitario: Number(i.valor_unitario),
        valor_desconto: Number(i.valor_desconto ?? 0), fiscal: i.fiscal })),
    });
  }, [id]);

  useEffect(() => { carregar(); }, [carregar]);
  useEffect(() => {
    fetch("/api/vendas/opcoes?emp=SF", { cache: "no-store" }).then((x) => x.json()).then((r) => { if (!r.error) setOp(r); }).catch(() => null);
  }, []);

  const editavel = id == null || doc?.status === "aberto";
  const total = useMemo(() => {
    if (!form) return 0;
    const m = form.itens.reduce((s, i) => s + Math.round(Number(i.quantidade) * Number(i.valor_unitario) * 100) / 100 - Number(i.valor_desconto ?? 0), 0);
    return m - Number(form.valor_desconto ?? 0) + Number(form.valor_frete ?? 0);
  }, [form]);

  function setF<K extends keyof VendaSalvar>(k: K, v: VendaSalvar[K]) { setForm((f) => (f ? { ...f, [k]: v } : f)); }
  function setItem(n: number, campo: keyof VendaItem, v: string) {
    setForm((f) => {
      if (!f) return f;
      const itens = f.itens.map((i, k) => k !== n ? i : {
        ...i, [campo]: ["quantidade", "valor_unitario", "valor_desconto"].includes(campo) ? Number(v.replace(",", ".")) || 0 : v,
      });
      return { ...f, itens };
    });
  }

  /** Puxa a proposta do CRM: cliente (cadastro do painel), itens com código nativo, condição. */
  async function puxarProposta(numero: string) {
    setPuxando(true); setAvisoProp(null);
    const r = await fetch(`/api/vendas/proposta?numero=${encodeURIComponent(numero)}&emp=${form?.empresa ?? "SF"}`, { cache: "no-store" })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setPuxando(false);
    if (r.error) { setAvisoProp(r.error); return; }
    if (r.disponivel === false) { setAvisoProp(`${r.motivo} — o nº fica registado; preencha o resto à mão.`); return; }
    setForm((f) => {
      if (!f) return f;
      const tipo = (id == null ? r.tipo_sugerido : f.tipo) as "PV" | "OS";
      type Ip = { lado: string; codigo: string | null; ncod_prod: number | null; descricao: string; unidade: string; ncm: string | null; quantidade: number; valor_unitario: number };
      const doLado = (r.itens as Ip[]).filter((i) => i.lado === tipo);
      const itens = (doLado.length ? doLado : (r.itens as Ip[])).map((i) => ({ codigo: i.codigo ?? "", ncod_prod: i.ncod_prod, descricao: i.descricao,
        unidade: i.unidade || "UN", ncm: i.ncm ?? "", quantidade: Number(i.quantidade) || 1, valor_unitario: Number(i.valor_unitario) || 0 }));
      const p = r.proposta as { numero: string; titulo: string | null; contato: string | null };
      setPropTitulo(p.titulo ?? null);
      return {
        ...f, tipo, proposta: p.numero,
        cliente_codigo: r.pessoa?.codigo ?? f.cliente_codigo,
        condicao_codigo: r.condicao?.codigo ?? f.condicao_codigo,
        contato: f.contato || p.contato || null,
        observacoes: f.observacoes || `Proposta ${p.numero}${p.titulo ? ` — ${p.titulo}` : ""}`,
        itens: itens.length ? itens : f.itens,
      };
    });
    if (r.pessoa) setClienteNome(String(r.pessoa.fantasia || r.pessoa.razao || ""));
    setSemProposta(null);
    const semCod = (r.itens as { codigo: string | null; lado: string }[]).filter((i) => !i.codigo && i.lado === "PV").length;
    const msgs = [
      !r.pessoa && `cliente “${r.proposta?.cliente_crm?.nome ?? "?"}” não achado no cadastro — escolha ou cadastre`,
      r.misto && "a proposta tem produto e serviço: este documento leva só a parte dele — lance o outro (PV/OS) com a mesma proposta",
      semCod > 0 && `${semCod} item(ns) de produto sem código do catálogo — confira`,
      !r.condicao?.codigo && r.condicao?.texto && `condição “${r.condicao.texto}” sem correspondente — escolha à mão`,
      r.proposta?.ja_lancado && `atenção: a proposta já tem ${r.proposta.ja_lancado}`,
    ].filter(Boolean);
    setAvisoProp(msgs.length ? `Proposta ${numero} carregada · ${msgs.join(" · ")}` : `Proposta ${numero} carregada.`);
  }

  async function salvar() {
    if (!form) return;
    if (!form.projeto_codigo) { setErro("Escolha o projeto (obrigatório) — ou crie com “+ Novo”."); return; }
    if (!form.categoria_codigo) { setErro("Escolha a categoria de receita (obrigatória)."); return; }
    setOcupado(true); setErro(null); setOk(null);
    const r = await fetch("/api/vendas", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, itens: form.itens.filter((i) => i.descricao.trim()),
        sem_proposta: !String(form.proposta ?? "").trim() && semProposta != null ? { motivo: semProposta } : null }) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(false);
    if (r.error) { setErro(r.error); return; }
    if (id == null) { router.push(`/erp/vendas/${r.id}`); return; }
    setOk(`${r.label} gravado — ${brl(Number(r.valor_total))}`);
    carregar();
  }

  async function cancelar() {
    if (!motivo?.trim()) { setErro("Informe o motivo do cancelamento"); return; }
    setOcupado(true);
    const r = await fetch(`/api/vendas/${id}`, { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ acao: "cancelar", motivo }) }).then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcupado(false);
    if (r.error) { setErro(r.error); return; }
    setMotivo(null); carregar();
  }

  if (!form) return <PaginaNavy>{erro ? <Aviso>{erro}</Aviso> : <Carregando />}</PaginaNavy>;
  const st = doc ? STATUS_VENDA[doc.status] : null;
  const ehTeste = /TESTE E2E/i.test(doc?.observacoes ?? "");

  return (
    <PaginaNavy>
      <CabecalhoTela
        area="Operação · Vendas"
        titulo={doc ? `${doc.label} — ${doc.cliente ?? ""}` : `Novo ${form.tipo === "OS" ? "OS" : "PV"}`}
        sub={doc ? <>
          <span style={{ color: st!.cor, fontWeight: 700 }}>● {st!.rot}</span>
          {" · "}emitido {dataBR(doc.emissao)} por {doc.criado_por ?? "—"}{doc.origem === "crm" ? " (CRM)" : ""}
          {doc.proposta ? <> · proposta <b>{doc.proposta}</b></> : null}
          {doc.nf ? <> · NF <b>{doc.nf}</b> em {dataBR(doc.dt_fat)}</> : null}
        </> : "Pedido de venda ou ordem de serviço nascido no painel — aparece na hora em Avulsos e no faturamento."}
        acoes={<>
          <BotaoTela onClick={() => router.push("/erp/vendas")}>Voltar</BotaoTela>
          {doc && doc.status === "aberto" && docfat && (
            <BotaoEmitirNf origemTipo={doc.tipo === "OS" ? "os" : "pv"} origemId={String(doc.id)} documento={docfat}
              rotulo={doc.label} gerarReceberHomologacao={ehTeste} onEmitido={(r) => {
                setOk(`Emissão: ${r.status}${r.numero ? ` nº ${r.numero}` : ""}${r.mensagem ? ` — ${r.mensagem}` : ""}`);
                carregar();
              }} />
          )}
          {doc && doc.status === "aberto" && <BotaoTela onClick={() => setMotivo(motivo == null ? "" : null)}>Cancelar documento</BotaoTela>}
          {editavel && <BotaoTela primario disabled={ocupado} onClick={salvar}>{ocupado ? "Gravando…" : "Gravar"}</BotaoTela>}
        </>}
      />
      {erro && <div onClick={() => setErro(null)}><Aviso>{erro}</Aviso></div>}
      {ok && <div onClick={() => setOk(null)}><Aviso tone="info">{ok}</Aviso></div>}
      {doc?.status === "cancelado" && <Aviso tone="warn">Cancelado: {doc.cancelado_motivo}</Aviso>}
      {avisoProp && <div onClick={() => setAvisoProp(null)}><Aviso tone="info">{avisoProp}</Aviso></div>}
      {doc && !doc.proposta && (doc as unknown as { proposta_dispensa_motivo?: string }).proposta_dispensa_motivo && (
        <Aviso tone="warn">Lançado sem proposta do CRM: {(doc as unknown as { proposta_dispensa_motivo: string }).proposta_dispensa_motivo}</Aviso>
      )}
      {editavel && !String(form.proposta ?? "").trim() && !(doc as unknown as { proposta_dispensa_motivo?: string } | null)?.proposta_dispensa_motivo && (
        <div style={{ ...cartao, display: "flex", gap: 10, alignItems: "end", flexWrap: "wrap" }}>
          <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)", flex: "1 1 260px" }}>
            Todo PV/OS precisa da <b>proposta do CRM</b> — procure-a no campo “Proposta (CRM)” abaixo (puxa cliente, itens e condição).
            Só um administrador pode lançar sem proposta, com o motivo registado.
          </div>
          <label style={{ fontSize: 12.5, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={semProposta != null} onChange={(e) => setSemProposta(e.target.checked ? "" : null)} /> Lançar sem proposta (admin)
          </label>
          {semProposta != null && (
            <Campo rot="Motivo"><input style={{ ...input, minWidth: 280 }} value={semProposta} onChange={(e) => setSemProposta(e.target.value)} placeholder="ex.: venda de balcão sem proposta" /></Campo>
          )}
        </div>
      )}
      {motivo != null && (
        <div style={{ ...cartao, display: "flex", gap: 8, alignItems: "end" }}>
          <Campo rot="Motivo do cancelamento"><input style={input} value={motivo} onChange={(e) => setMotivo(e.target.value)} autoFocus /></Campo>
          <BotaoTela disabled={ocupado} onClick={cancelar}>Confirmar cancelamento</BotaoTela>
        </div>
      )}

      <div style={{ ...cartao, display: "grid", gridTemplateColumns: "repeat(6, minmax(0, 1fr))", gap: 12 }}>
        {id == null && (
          <Campo rot="Tipo">
            <select style={input} value={form.tipo} onChange={(e) => setF("tipo", e.target.value as "PV" | "OS")}>
              <option value="PV">PV — pedido de venda</option><option value="OS">OS — ordem de serviço</option>
            </select>
          </Campo>
        )}
        <Campo rot="Cliente" largura={id == null ? 3 : 4}>
          <BuscaPessoa valor={clienteNome} desativado={!editavel} empresa={form.empresa ?? "SF"} onEscolher={(c) => {
            setF("cliente_codigo", c.codigo); setClienteNome(c.fantasia || c.razao);
          }} />
        </Campo>
        <Campo rot="Previsão"><input type="date" style={input} disabled={!editavel} value={form.previsao ?? ""} onChange={(e) => setF("previsao", e.target.value)} /></Campo>
        <Campo rot={puxando ? "Proposta (CRM) — carregando…" : "Proposta (CRM) *"} largura={2}>
          <BuscaProposta valor={form.proposta ?? ""} desativado={!editavel} onTexto={(v) => setF("proposta", v)}
            onEscolher={(p) => { setF("proposta", p.numero); puxarProposta(p.numero); }} />
        </Campo>
        <Campo rot="Condição de pagamento" largura={2}>
          <select style={input} disabled={!editavel} value={form.condicao_codigo ?? ""} onChange={(e) => setF("condicao_codigo", e.target.value)}>
            <option value="">—</option>
            {op.condicoes.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}
          </select>
        </Campo>
        <Campo rot="Forma de recebimento">
          <select style={input} disabled={!editavel} value={form.forma_recebimento ?? ""} onChange={(e) => setF("forma_recebimento", e.target.value || null)}>
            <option value="">—</option>
            {FORMAS_RECEBIMENTO.map((f) => <option key={f.codigo} value={f.codigo}>{f.nome}</option>)}
          </select>
        </Campo>
        <Campo rot="Nº de parcelas"><input style={input} disabled={!editavel} inputMode="numeric" value={form.qtd_parcelas ?? ""}
          onChange={(e) => setF("qtd_parcelas", Number(e.target.value) || null)} placeholder="pela condição" /></Campo>
        <Campo rot="Projeto *" largura={2}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select style={{ ...input, flex: 1, minWidth: 0 }} disabled={!editavel} value={form.projeto_codigo ?? ""} onChange={(e) => setF("projeto_codigo", e.target.value || null)}>
              <option value="">—</option>
              {op.projetos.map((p) => <option key={p.codigo} value={String(p.codigo)}>{p.nome}</option>)}
            </select>
            {editavel && (
              <BotaoNovoProjeto compacto rotulo="+ Novo" empresa={form.empresa ?? "SF"}
                sugestao={{
                  nome: [clienteNome, propTitulo].filter(Boolean).join(" — ") || null,
                  clienteCodigo: form.cliente_codigo || null, clienteNome: clienteNome || null,
                  orcamento: form.itens?.reduce((t, i) => t + (Number(i.quantidade) || 0) * (Number(i.valor_unitario) || 0), 0) || null,
                  obs: form.proposta ? `Proposta ${form.proposta}` : null,
                }}
                onCriado={(p) => {
                  setOp((o) => o.projetos.some((x) => String(x.codigo) === String(p.codigo)) ? o : { ...o, projetos: [{ codigo: p.codigo, nome: p.nome }, ...o.projetos] });
                  setF("projeto_codigo", String(p.codigo));
                }} />
            )}
          </div>
        </Campo>
        <Campo rot="Categoria de receita *" largura={2}>
          <select style={input} disabled={!editavel} value={form.categoria_codigo ?? ""} onChange={(e) => setF("categoria_codigo", e.target.value || null)}>
            <option value="">—</option>
            {op.categorias.map((c) => <option key={c.codigo} value={c.codigo}>{c.codigo} · {c.descricao}</option>)}
          </select>
        </Campo>
        <Campo rot="Vendedor" largura={2}>
          <select style={input} disabled={!editavel} value={form.vendedor_codigo != null ? String(form.vendedor_codigo) : ""} onChange={(e) => setF("vendedor_codigo", e.target.value || null)}>
            <option value="">—</option>
            {(op.vendedores ?? []).map((v) => <option key={v.codigo} value={v.codigo}>{v.nome}</option>)}
          </select>
        </Campo>
        <Campo rot="Pedido / OC do cliente"><input style={input} disabled={!editavel} value={form.num_pedido_cliente ?? ""} onChange={(e) => setF("num_pedido_cliente", e.target.value)} /></Campo>
        <Campo rot="Contato"><input style={input} disabled={!editavel} value={form.contato ?? ""} onChange={(e) => setF("contato", e.target.value)} /></Campo>
        <Campo rot="Observações" largura={3}><input style={input} disabled={!editavel} value={form.observacoes ?? ""} onChange={(e) => setF("observacoes", e.target.value)} /></Campo>
        <Campo rot="Dados adicionais da NF" largura={3}><input style={input} disabled={!editavel} value={form.obs_nf ?? ""} onChange={(e) => setF("obs_nf", e.target.value)} /></Campo>
      </div>

      <div style={{ ...cartao, overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead><tr>
            {["#", "Código", "Descrição", "Un", "NCM", "Qtd", "Valor unit.", "Total", ""].map((h) => <th key={h} style={th}>{h}</th>)}
          </tr></thead>
          <tbody>
            {form.itens.map((i, n) => (
              <tr key={n} style={{ borderBottom: "1px solid var(--ww-border)" }}>
                <td style={{ ...td, color: "var(--ww-text-faint)" }}>{n + 1}</td>
                <td style={{ ...td, width: 120 }}><input style={input} disabled={!editavel} value={i.codigo ?? ""} onChange={(e) => setItem(n, "codigo", e.target.value)} /></td>
                <td style={td}><input style={input} disabled={!editavel} value={i.descricao} onChange={(e) => setItem(n, "descricao", e.target.value)} /></td>
                <td style={{ ...td, width: 64 }}><input style={input} disabled={!editavel} value={i.unidade ?? ""} onChange={(e) => setItem(n, "unidade", e.target.value)} /></td>
                <td style={{ ...td, width: 110 }}><input style={input} disabled={!editavel} value={i.ncm ?? ""} onChange={(e) => setItem(n, "ncm", e.target.value)} /></td>
                <td style={{ ...td, width: 80 }}><input style={input} disabled={!editavel} inputMode="decimal" value={String(i.quantidade)} onChange={(e) => setItem(n, "quantidade", e.target.value)} /></td>
                <td style={{ ...td, width: 120 }}><input style={input} disabled={!editavel} inputMode="decimal" value={String(i.valor_unitario)} onChange={(e) => setItem(n, "valor_unitario", e.target.value)} /></td>
                <td style={{ ...td, width: 120, textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{brl(Number(i.quantidade) * Number(i.valor_unitario))}</td>
                <td style={{ ...td, width: 40 }}>{editavel && form.itens.length > 1 && (
                  <button style={{ ...lk, color: "#E5484D" }} onClick={() => setF("itens", form.itens.filter((_, k) => k !== n))}>×</button>
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "12px 10px 4px" }}>
          {editavel ? <button style={lk} onClick={() => setF("itens", [...form.itens, itemVazio()])}>+ item</button> : <span />}
          <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>Total {brl(total)}</span>
        </div>
      </div>

      {doc && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12 }}>
          <Bloco titulo={`Parcelas — ${doc.condicao ?? "sem condição"}`}>
            {doc.parcelas.length === 0 ? <Mudo>Sem parcelas</Mudo> : doc.parcelas.map((p) => (
              <Linha key={p.numero} esq={`${p.numero}ª · ${dataBR(p.vencimento)}${p.dias != null ? ` (${p.dias}d)` : ""}`} dir={brl(Number(p.valor))} />
            ))}
            <Mudo>No faturamento os vencimentos contam a partir da data da nota.</Mudo>
          </Bloco>
          <Bloco titulo="Compras ligadas">
            {doc.rcs.length === 0 ? <Mudo>Nenhuma RC / PC ainda.</Mudo> : doc.rcs.map((c) => (
              <Linha key={c.id} esq={<a style={lk} href="/erp/compras">{c.tipo} {c.num}</a>} dir="" />
            ))}
          </Bloco>
          <Bloco titulo="Faturamento">
            {doc.emissoes.length === 0 ? <Mudo>Nenhuma emissão.</Mudo> : doc.emissoes.map((e) => (
              <Linha key={e.id} esq={`${e.tipo.toUpperCase()} ${e.numero ?? ""} · ${e.ambiente === "producao" ? "produção" : "homologação"}`}
                dir={<span title={e.mensagem ?? ""}>{e.status}</span>} />
            ))}
            <Mudo><a style={lk} href="/faturamento">Abrir Faturamento</a></Mudo>
          </Bloco>
          <Bloco titulo="Anexos (OC do cliente e outros)">
            <OcAnexosPainel empresa={doc.empresa} label={doc.label} mostrarOc={false} />
          </Bloco>
          <Bloco titulo="Histórico">
            {doc.historico.map((h) => (
              <Linha key={h.id} esq={`${new Date(h.em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })} · ${h.acao}`} dir={h.por ?? ""} />
            ))}
          </Bloco>
        </div>
      )}
    </PaginaNavy>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div style={{ ...cartao, display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>{titulo}</div>
      {children}
    </div>
  );
}
const Linha = ({ esq, dir }: { esq: ReactNode; dir: ReactNode }) => (
  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 13 }}>
    <span>{esq}</span><span style={{ color: "var(--ww-text-muted)", fontVariantNumeric: "tabular-nums" }}>{dir}</span>
  </div>
);
const Mudo = ({ children }: { children: ReactNode }) => <div style={{ fontSize: 12, color: "var(--ww-text-faint)" }}>{children}</div>;

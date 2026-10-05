"use client";

/**
 * Ficha do cliente / fornecedor (05/10/26): tudo o que existe da pessoa num lugar.
 *  - Cliente: PV/OS, notas fiscais, contas a receber, margem (+ atalho para a ficha no CRM).
 *  - Fornecedor: pedidos de compra, NFs de entrada, contas a pagar, quanto gastei por mês.
 * Lê das vistas unificadas: o histórico do Omie e o que nasce no painel aparecem juntos.
 * O que a pessoa não pode ver (valores, financeiro) já vem cortado do servidor.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Origem, Papeis, Pill, brl, kbrl, ddmmaa, linkCrm, pedir, type Pessoa } from "./comum";

type J = Record<string, unknown>;
type Venda = { tipo: string; numero: string; label: string | null; emissao: string | null; valor: number | null; etapa: string | null; faturado: boolean; cancelado: boolean; dtFat: string | null; nf: string | null; projeto: string | null;
  /* Da cadeia (sales.mv_rentab_pvos) — mesma margem da Avulsos e da Rentabilidade. */
  custo?: number | null; margemPct?: number | null; pagoOk?: boolean | null; recebidoOk?: boolean | null; etapaCadeia?: string | null };
type NfSaida = { tipo: string; numero: string; serie?: string; emissao: string | null; valor: number | null; cancelada: boolean | string | null; pedido: string | null };
type Titulo = { doc: string | null; parcela: string | null; vencimento: string | null; valor: number | null; pago: number | null; aberto?: number | null; status: string | null; origem: string | null; nf?: string | null; pedido?: string | null; pagamento?: string | null };
type Pc = { id: number; numero: number | string; emissao: string | null; etapa: string | null; valor: number | null; aprov: string | null; pvos: string | null; cliente: string | null; nf: string | null; origem: string; cancelado: boolean };
type NfEnt = { chave: string; numero: string; emissao: string | null; valor: number | null; situacao: string | null; pedido: number | string | null };
type Gasto = { mes: string; comprado: number | null; pago: number | null };
type FichaCli = { vendas: Venda[]; nfs: NfSaida[]; receber: { aberto: number; vencido: number; recebido: number; titulos: Titulo[] } | null; margem: J | null };
type FichaForn = { pcs: Pc[]; nfs: NfEnt[]; pagar: { aberto: number; vencido: number; pago: number; previsto: number; titulos: Titulo[] } | null; gasto: Gasto[]; totais: { comprado: number | null; pcs: number; primeiro: string | null; ultimo: string | null } };
type Resp = { pessoa: Pessoa; podeEditar: boolean; cliente: FichaCli | null; fornecedor: FichaForn | null; pode: { receber: boolean; pagar: boolean; valores: boolean } };

const ETAPA_PC: Record<string, string> = { "20": "Requisição", "10": "Pedido", "15": "Aprovação", "35": "Enviado", "40": "Faturado", "60": "Recebido", "80": "Conferido" };
const tomStatus = (s: string | null): "ok" | "warn" | "crit" | "off" | "info" =>
  !s ? "off" : /PAGO|RECEBIDO|LIQUIDADO|liberado/i.test(s) ? "ok" : /ATRASADO/i.test(s) ? "crit" : /HOJE|aguardando/i.test(s) ? "warn" : /CANCEL/i.test(s) ? "off" : "info";

export default function FichaPessoa({ id }: { id: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [d, setD] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aba, setAba] = useState<string>("resumo");

  useEffect(() => {
    (async () => {
      try { setD(await pedir<Resp>(`/api/cadastros/${id}`)); } catch (e) { setErro((e as Error).message); }
    })();
  }, [id]);

  if (erro) return <div className="est"><div className="aviso t-crit">{erro}</div></div>;
  if (!d) return <div className="est"><div className="cartao vazio">Carregando a ficha…</div></div>;
  const p = d.pessoa, c = d.cliente, f = d.fornecedor;
  const voltar = p.cliente && !p.fornecedor ? "clientes" : "fornecedores";

  const abas: { id: string; t: string; n?: number }[] = [{ id: "resumo", t: "Resumo" }];
  if (c) {
    abas.push({ id: "vendas", t: "PV / OS", n: c.vendas.length }, { id: "nfs", t: "Notas fiscais", n: c.nfs.length });
    if (c.receber) abas.push({ id: "receber", t: "A receber", n: c.receber.titulos.length });
  }
  if (f) {
    abas.push({ id: "pcs", t: "Pedidos de compra", n: f.pcs.length }, { id: "nfe", t: "NFs de entrada", n: f.nfs.length });
    if (f.pagar) abas.push({ id: "pagar", t: "A pagar", n: f.pagar.titulos.length });
    abas.push({ id: "gasto", t: "Quanto gastei" });
  }
  abas.push({ id: "cadastro", t: "Cadastro" });

  const vendasValidas = c?.vendas.filter((v) => !v.cancelado) ?? [];
  const faturado = vendasValidas.filter((v) => v.faturado).reduce((a, v) => a + (v.valor ?? 0), 0);
  const emAberto = vendasValidas.filter((v) => !v.faturado).reduce((a, v) => a + (v.valor ?? 0), 0);
  const gasto12 = f?.gasto.reduce((a, g) => ({ comprado: a.comprado + (g.comprado ?? 0), pago: a.pago + (g.pago ?? 0) }), { comprado: 0, pago: 0 });
  const maxGasto = Math.max(1, ...(f?.gasto ?? []).map((g) => Math.max(g.comprado ?? 0, g.pago ?? 0)));
  const m = c?.margem as { faturamento?: number; rentabilidade?: number; margem?: number | null; pvos?: number; pvosMedidos?: number } | null | undefined;

  return (
    <div className="est">
      <div className="crumbs">
        <button className="link" onClick={() => router.push(`/cadastros/${voltar}`)}>‹ {voltar === "clientes" ? "Clientes" : "Fornecedores"}</button>
        <span>/</span><span>{p.fantasia || p.razao}</span>
      </div>
      {sp.get("salvo") && <div className="aviso t-ok">Cadastro salvo no painel.</div>}

      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="area">Cadastros · {p.empresa} · cód. {p.codigo}</div>
          <h1>{p.razao}</h1>
          <div className="sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {p.fantasia && p.fantasia !== p.razao && <span>{p.fantasia}</span>}
            {p.doc && <span className="mono">{p.doc}</span>}
            {p.cidade && <span>{p.cidade}{p.uf ? `/${p.uf}` : ""}</span>}
            <Papeis p={p} /><Origem o={p.origem} />
            {!p.ativo && <Pill t="Inativo" tom="off" />}
          </div>
        </div>
        <div className="filtros">
          {p.cliente && <a className="btn" href={linkCrm(p.fantasia || p.razao)} title="Propostas e oportunidades deste cliente no CRM">Ver no CRM</a>}
          {d.podeEditar && <button className="btn pri" onClick={() => router.push(`/cadastros/${p.id}/editar`)}>Editar cadastro</button>}
        </div>
      </header>

      <div className="kpis">
        {c && <>
          <div className="kpi hero"><div className="r">Faturado (PV/OS)</div><div className="v">{kbrl(faturado)}</div><div className="s">{vendasValidas.filter((v) => v.faturado).length} pedidos faturados</div></div>
          <div className="kpi"><div className="r">Pedidos em aberto</div><div className="v">{kbrl(emAberto)}</div><div className="s">{vendasValidas.filter((v) => !v.faturado).length} PV/OS a faturar</div></div>
          {c.receber && <div className="kpi"><div className="r">A receber</div><div className="v">{kbrl(c.receber.aberto)}</div>
            <div className={`s${c.receber.vencido > 0 ? " crit" : ""}`}>{c.receber.vencido > 0 ? `${kbrl(c.receber.vencido)} vencido` : "nada vencido"}</div></div>}
          {m && <div className="kpi" title="(PV − PCs ligados) / PV, só nos PV/OS com custo lançado — a mesma conta da Avulsos e da Rentabilidade">
            <div className="r">Margem bruta</div><div className="v">{m.margem != null ? `${String(m.margem).replace(".", ",")}%` : "—"}</div>
            <div className="s">{kbrl(m.rentabilidade ?? 0)} sobre {kbrl(m.faturamento ?? 0)}{m.pvos != null ? ` · ${m.pvosMedidos ?? 0} de ${m.pvos} PV/OS com custo` : ""}</div></div>}
        </>}
        {f && <>
          <div className="kpi hero"><div className="r">Comprado (total)</div><div className="v">{kbrl(f.totais.comprado)}</div>
            <div className="s">{f.totais.pcs} PCs{f.totais.primeiro ? ` · desde ${ddmmaa(f.totais.primeiro)}` : ""}</div></div>
          <div className="kpi"><div className="r">Últimos 12 meses</div><div className="v">{gasto12 ? kbrl(gasto12.comprado) : "—"}</div>
            <div className="s">{f.pagar ? `${kbrl(gasto12?.pago ?? 0)} pagos` : "comprado (PCs emitidos)"}</div></div>
          {f.pagar && <div className="kpi"><div className="r">A pagar</div><div className="v">{kbrl(f.pagar.aberto)}</div>
            <div className={`s${f.pagar.vencido > 0 ? " crit" : ""}`}>{f.pagar.vencido > 0 ? `${kbrl(f.pagar.vencido)} vencido` : f.pagar.previsto > 0 ? `${kbrl(f.pagar.previsto)} previsto de PC` : "nada vencido"}</div></div>}
          <div className="kpi"><div className="r">NFs de entrada</div><div className="v">{f.nfs.length}</div>
            <div className="s">{f.nfs.filter((n) => !n.pedido).length} sem pedido vinculado</div></div>
        </>}
      </div>

      <div className="seg">
        {abas.map((a) => <button key={a.id} className={aba === a.id ? "on" : ""} onClick={() => setAba(a.id)}>{a.t}{a.n != null && <span className="b">{a.n}</span>}</button>)}
      </div>

      {aba === "resumo" && <Resumo p={p} c={c} f={f} />}

      {aba === "vendas" && c && (
        <Tabela cab={["Pedido", "Emissão", "Projeto", "Etapa", "NF", "Valor", "M.B.", "Pago / recebido"]} vazio="Nenhum PV/OS deste cliente."
          linhas={c.vendas.map((v) => [
            <a key="n" className="link" href={`/bi/rentabilidade?pedido=${encodeURIComponent(v.label ?? "")}&empresa=${encodeURIComponent(p.empresa)}`} title="Ver a cadeia deste pedido"><b>{v.label ?? `${v.tipo} ${v.numero}`}</b></a>,
            ddmmaa(v.emissao), v.projeto ?? "—",
            v.cancelado ? <Pill t="Cancelado" tom="off" /> : v.faturado ? <Pill t={`Faturado ${ddmmaa(v.dtFat)}`} tom="ok" /> : <Pill t={v.etapa ?? "Em aberto"} tom="info" />,
            v.nf ?? "—", <span key="v" className="num">{brl(v.valor)}</span>,
            <span key="m" className="num">{v.margemPct != null ? `${(v.margemPct * 100).toFixed(1).replace(".", ",")}%` : "—"}</span>,
            <span key="pr" style={{ display: "inline-flex", gap: 4 }}>
              {v.custo ? <Pill t={v.pagoOk ? "Pago" : "A pagar"} tom={v.pagoOk ? "ok" : "info"} /> : null}
              {v.faturado ? <Pill t={v.recebidoOk ? "Recebido" : "A receber"} tom={v.recebidoOk ? "ok" : "info"} /> : null}
            </span>])}
          dir={[5, 6]} />
      )}
      {aba === "nfs" && c && (
        <Tabela cab={["Nota", "Emissão", "Pedido / OS", "Situação", "Valor"]} vazio="Nenhuma nota fiscal emitida para este CNPJ/CPF."
          linhas={c.nfs.map((n) => [<b key="n">{n.tipo} {n.numero}{n.serie ? `/${n.serie}` : ""}</b>, ddmmaa(n.emissao), n.pedido ?? "—",
            n.cancelada === true || n.cancelada === "S" ? <Pill t="Cancelada" tom="off" /> : <Pill t="Emitida" tom="ok" />, <span key="v" className="num">{brl(n.valor)}</span>])}
          dir={[4]} />
      )}
      {aba === "receber" && c?.receber && (
        <Tabela cab={["Documento", "Vencimento", "NF", "Situação", "Valor", "Recebido"]} vazio="Nenhum título a receber."
          linhas={c.receber.titulos.map((t) => [<b key="d">{t.doc ?? "—"}{t.parcela ? ` · ${t.parcela}` : ""}</b>, ddmmaa(t.vencimento), t.nf ?? "—",
            <Pill key="s" t={t.status ?? "—"} tom={tomStatus(t.status)} />, <span key="v" className="num">{brl(t.valor)}</span>, <span key="p" className="num">{brl(t.pago)}</span>])}
          dir={[4, 5]} />
      )}
      {aba === "pcs" && f && (
        <Tabela cab={["Pedido", "Emissão", "Etapa", "PV/OS · cliente", "NF", "Valor"]} vazio="Nenhum pedido de compra deste fornecedor."
          linhas={f.pcs.map((x) => [<b key="n">PC {x.numero}</b>, ddmmaa(x.emissao),
            x.cancelado ? <Pill t="Cancelado" tom="off" /> : <Pill t={ETAPA_PC[x.etapa ?? ""] ?? x.etapa ?? "—"} tom={x.etapa === "80" ? "ok" : ["40", "60"].includes(x.etapa ?? "") ? "info" : "warn"} />,
            [x.pvos, x.cliente].filter(Boolean).join(" · ") || "avulso", x.nf ?? "—", <span key="v" className="num">{brl(x.valor)}</span>])}
          dir={[5]} />
      )}
      {aba === "nfe" && f && (
        <Tabela cab={["NF-e", "Emissão", "Pedido vinculado", "Situação", "Valor"]} vazio="Nenhuma NF-e deste CNPJ chegou pela Focus."
          linhas={f.nfs.map((n) => [<b key="n">{n.numero}</b>, ddmmaa(n.emissao),
            n.pedido ? `PC ${n.pedido}` : <Pill key="p" t="Sem pedido" tom="crit" />, n.situacao ?? "—", <span key="v" className="num">{brl(n.valor)}</span>])}
          dir={[4]} />
      )}
      {aba === "pagar" && f?.pagar && (
        <Tabela cab={["Documento", "Vencimento", "Pedido", "Situação", "Valor", "Pago"]} vazio="Nenhum título a pagar."
          linhas={f.pagar.titulos.map((t) => [<b key="d">{t.doc ?? "—"}{t.parcela ? ` · ${t.parcela}` : ""}</b>, ddmmaa(t.vencimento), t.pedido ?? "—",
            <Pill key="s" t={t.origem === "painel" ? `Previsto · ${t.status ?? ""}` : t.status ?? "—"} tom={tomStatus(t.status)} />,
            <span key="v" className="num">{brl(t.valor)}</span>, <span key="p" className="num">{t.pago ? `${brl(t.pago)}${t.pagamento ? ` em ${ddmmaa(t.pagamento)}` : ""}` : "—"}</span>])}
          dir={[4, 5]} />
      )}
      {aba === "gasto" && f && (
        <div className="cartao" style={{ padding: "14px 18px" }}>
          <div className="mini" style={{ marginBottom: 10 }}>Comprado = pedidos de compra emitidos no mês. {f.pagar ? "Pago = títulos pagos no mês (data do pagamento)." : ""}</div>
          <table className="tabela">
            <thead><tr><th>Mês</th><th style={{ width: "40%" }}></th><th className="r">Comprado</th>{f.pagar && <th className="r">Pago</th>}</tr></thead>
            <tbody>
              {f.gasto.map((g) => (
                <tr key={g.mes}>
                  <td>{g.mes.slice(5)}/{g.mes.slice(2, 4)}</td>
                  <td>
                    <div className="barra" title="Comprado"><i style={{ width: `${((g.comprado ?? 0) / maxGasto) * 100}%`, background: "var(--ww-accent)" }} /></div>
                    {f.pagar && <div className="barra" style={{ marginTop: 3 }} title="Pago"><i style={{ width: `${((g.pago ?? 0) / maxGasto) * 100}%`, background: "var(--ww-ok)" }} /></div>}
                  </td>
                  <td className="r num">{brl(g.comprado)}</td>{f.pagar && <td className="r num">{brl(g.pago)}</td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {aba === "cadastro" && <DadosCadastro p={p} />}
    </div>
  );
}

function Tabela({ cab, linhas, vazio, dir = [], onLinha }: { cab: string[]; linhas: React.ReactNode[][]; vazio: string; dir?: number[]; onLinha?: (i: number) => void }) {
  return (
    <div className="cartao" style={{ overflowX: "auto" }}>
      <table className="tabela">
        <thead><tr>{cab.map((h, i) => <th key={h} className={dir.includes(i) ? "r" : ""}>{h}</th>)}</tr></thead>
        <tbody>
          {linhas.length === 0 && <tr><td colSpan={cab.length} className="vazio">{vazio}</td></tr>}
          {linhas.map((l, i) => (
            <tr key={i} className={onLinha ? "click" : ""} onClick={onLinha ? () => onLinha(i) : undefined}>
              {l.map((cel, j) => <td key={j} className={dir.includes(j) ? "r" : ""}>{cel}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Resumo({ p, c, f }: { p: Pessoa; c: FichaCli | null; f: FichaForn | null }) {
  const eventos: { quando: string; o: string }[] = [];
  c?.vendas.slice(0, 5).forEach((v) => v.emissao && eventos.push({ quando: v.emissao, o: `${v.label ?? `${v.tipo} ${v.numero}`} · ${brl(v.valor)}${v.faturado ? " · faturado" : ""}` }));
  c?.nfs.slice(0, 5).forEach((n) => n.emissao && eventos.push({ quando: n.emissao, o: `${n.tipo} ${n.numero} emitida · ${brl(n.valor)}` }));
  f?.pcs.slice(0, 5).forEach((x) => x.emissao && eventos.push({ quando: x.emissao, o: `PC ${x.numero} · ${brl(x.valor)}${x.pvos ? ` · ${x.pvos}` : ""}` }));
  f?.nfs.slice(0, 5).forEach((n) => n.emissao && eventos.push({ quando: n.emissao, o: `NF-e ${n.numero} recebida · ${brl(n.valor)}${n.pedido ? ` · PC ${n.pedido}` : " · sem pedido"}` }));
  eventos.sort((a, b) => b.quando.localeCompare(a.quando));
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Últimos movimentos</div>
        {eventos.length === 0 ? <div className="mini">Nenhum movimento ainda.</div> : (
          <div style={{ display: "grid", gap: 8 }}>
            {eventos.slice(0, 10).map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
                <span className="mini" style={{ width: 62, flex: "none" }}>{ddmmaa(e.quando)}</span><span>{e.o}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Contato</div>
        <Linhas itens={[["E-mail", p.email], ["Cobrança", p.emailCobranca], ["NF-e", p.emailNfe], ["Telefone", [p.telefone, p.telefone2].filter(Boolean).join(" · ")], ["Contato", p.contato]]} />
        {p.contatos?.length > 0 && <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
          {p.contatos.map((x, i) => <div key={i} className="mini">{[x.nome, x.cargo, x.email, x.telefone].filter(Boolean).join(" · ")}</div>)}</div>}
      </div>
    </div>
  );
}

function Linhas({ itens }: { itens: [string, string | null | undefined][] }) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {itens.map(([k, v]) => (
        <div key={k} style={{ display: "flex", gap: 10, fontSize: 12.5 }}>
          <span className="mini" style={{ width: 110, flex: "none" }}>{k}</span><span>{v || "—"}</span>
        </div>
      ))}
    </div>
  );
}

function DadosCadastro({ p }: { p: Pessoa }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Dados fiscais</div>
        <Linhas itens={[["Razão social", p.razao], ["Fantasia", p.fantasia], ["CNPJ / CPF", p.doc], ["Insc. estadual", p.ie], ["Insc. municipal", p.im],
          ["Simples", p.simples == null ? null : p.simples ? "Sim" : "Não"], ["Empresa", p.empresa], ["Código", String(p.codigo)],
          ["Código no Omie", p.codigoOmie ? String(p.codigoOmie) : null]]} />
      </div>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Endereço</div>
        <Linhas itens={[["Logradouro", [p.logradouro, p.numero, p.complemento].filter(Boolean).join(", ")], ["Bairro", p.bairro],
          ["Cidade", p.cidade ? `${p.cidade}${p.uf ? `/${p.uf}` : ""}` : null], ["CEP", p.cep], ["IBGE", p.ibge]]} />
        {p.obs && <div className="aviso t-info" style={{ marginTop: 12 }}>{p.obs}</div>}
      </div>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Histórico do cadastro</div>
        <Linhas itens={[["Criado", `${ddmmaa(p.criadoEm)}${p.criadoPor ? ` · ${p.criadoPor}` : ""}`], ["Alterado", `${ddmmaa(p.alteradoEm)}${p.alteradoPor ? ` · ${p.alteradoPor}` : ""}`],
          ["Origem", p.origem === "omie" ? `Omie${p.editado ? " (editado no painel — o painel manda)" : " (sincroniza do Omie)"}` : "Painel"]]} />
        {(p.historico ?? []).length > 0 && <div style={{ marginTop: 10, display: "grid", gap: 4 }}>
          {p.historico!.map((h, i) => <div key={i} className="mini">{ddmmaa(h.em)} · {h.acao}{h.por ? ` · ${h.por}` : ""}</div>)}</div>}
      </div>
    </div>
  );
}

"use client";

/**
 * Ficha 360 do cliente / fornecedor (05/10/26).
 * Tudo sobre a pessoa num lugar, juntando SF/CD/WW (a mesma pessoa em várias
 * empresas é uma só — sql/59). O cabeçalho aparece logo; cada secção carrega à
 * parte (lib/cadastros-360) e os números do topo vão chegando.
 * Valores financeiros só para quem pode ver (cortados no servidor).
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ListaCandidatos, Origem, Papeis, Pill, brl, kbrl, ddmmaa, linkCrm, pedir, type Candidato, type Pessoa } from "./comum";

type J = Record<string, unknown>;
type Irmao = { id: number; empresa: string; codigo: number; codigoOmie: number | null; origem: "omie" | "painel" | "servicos" | "crm"; cliente: boolean; fornecedor: boolean; transportadora: boolean; ativo: boolean };
type Base = {
  pessoa: Pessoa; irmaos: Irmao[]; absorvidos: { id: number; empresa: string; codigo: number; razao: string }[];
  mesclas: { id: number; tipo: string; sobrevivente: number; absorvido: number; motivo: string; por: string; em: string; desfeitaEm: string | null }[];
  apps: { app: string; ref: string; como: string; empresa: string; codigo: number }[];
  parecidos: Candidato[]; historico: { acao: string; por: string | null; em: string; empresa: string }[];
  pode: { receber: boolean; pagar: boolean; valores: boolean; editar: boolean; admin: boolean };
};
type Titulo = J & { doc?: string; parcela?: string; vencimento?: string; valor?: number; pago?: number; status?: string; origem?: string; empresa: string; pedido?: string; nf?: string; pagamento?: string };
type Fin = { receber: { aberto: number; vencido: number; recebido: number; titulos: Titulo[] } | null;
  pagar: { aberto: number; vencido: number; pago: number; previsto: number; titulos: Titulo[] } | null;
  extrato: (J & { data: string; empresa: string; natureza: "pagar" | "receber"; valor: number; documento: string | null; origem: string; banco?: string; memo?: string; conciliado: boolean | null; nf?: string; pedido?: string })[] };
type Com = { vendas: (J & { empresa: string })[]; margem: { faturamento: number; rentabilidade: number; margem: number | null; pvos: number; pvosMedidos: number } | null;
  crm: { indisponivel?: boolean; motivo?: string; clientes: { nome: string }[]; propostas: J[]; oportunidades: J[] } };
type Fat = { nfs: (J & { empresa: string })[]; emissoes: J[] };
type Comp = { pcs: (J & { empresa: string })[]; nfs: (J & { empresa: string })[]; totais: { comprado: number | null; pcs: number; primeiro: string | null; ultimo: string | null };
  gasto: { mes: string; comprado: number | null; pago: number | null }[]; itens: J[]; abertos: J[] };
type Serv = { indisponivel?: boolean; motivo?: string; unidades?: J[]; os?: J[]; chamados?: J[]; resumo?: { os: number; osAbertas: number; chamados: number; chamadosAbertos: number } };

const ETAPA_PC: Record<string, string> = { "20": "Requisição", "10": "Pedido", "15": "Aprovação", "35": "Enviado", "40": "Faturado", "60": "Recebido", "80": "Conferido" };
const tom = (s: unknown): "ok" | "warn" | "crit" | "off" | "info" => {
  const t = String(s ?? "");
  return !t ? "off" : /PAGO|RECEBIDO|LIQUIDADO|liberado|autoriz|Conclu|Ganh/i.test(t) ? "ok" : /ATRASADO|rejeit|Perd/i.test(t) ? "crit"
    : /HOJE|aguardando|Aberta|process/i.test(t) ? "warn" : /CANCEL/i.test(t) ? "off" : "info";
};

function useSecao<T>(id: number, s: string, ativo: boolean) {
  const [d, setD] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  useEffect(() => {
    if (!ativo || d) return;
    let vivo = true;
    pedir<T>(`/api/cadastros/${id}/secao?s=${s}`).then((r) => { if (vivo) setD(r); }).catch((e) => { if (vivo) setErro((e as Error).message); });
    return () => { vivo = false; };
  }, [id, s, ativo, d]);
  return { d, erro };
}

export default function Ficha360({ id }: { id: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [aba, setAba] = useState("resumo");
  const base = useSecao<Base>(id, "base", true);
  const b = base.d;
  // Depois do cabeçalho, carrega o resto em paralelo (os números do topo vêm daqui).
  const pronto = !!b;
  const fin = useSecao<Fin>(id, "financeiro", pronto && !!(b?.pode.receber || b?.pode.pagar));
  const com = useSecao<Com>(id, "comercial", pronto && !!b?.irmaos.some((i) => i.cliente));
  const comp = useSecao<Comp>(id, "compras", pronto && !!b?.irmaos.some((i) => i.fornecedor || i.transportadora));
  const fat = useSecao<Fat>(id, "faturamento", pronto && aba === "faturamento");
  const serv = useSecao<Serv>(id, "servicos", pronto && !!b?.irmaos.some((i) => i.cliente));

  if (base.erro) return <div className="est"><div className="aviso t-crit">{base.erro}</div></div>;
  if (!b) return <div className="est"><div className="cartao vazio">Carregando a ficha…</div></div>;
  const p = b.pessoa;
  if (p.id !== id) { /* mesclado: a API devolve o sobrevivente */ }
  const ehCli = b.irmaos.some((i) => i.cliente), ehForn = b.irmaos.some((i) => i.fornecedor || i.transportadora);
  const voltar = ehCli && !ehForn ? "clientes" : "fornecedores";

  const vendas = com.d?.vendas.filter((v) => !v.cancelado) ?? [];
  const faturado = vendas.filter((v) => v.faturado).reduce((a, v) => a + Number(v.valor ?? 0), 0);
  const aFaturar = vendas.filter((v) => !v.faturado).reduce((a, v) => a + Number(v.valor ?? 0), 0);

  const abas: { id: string; t: string; n?: number | null }[] = [{ id: "resumo", t: "Resumo" }];
  if (b.pode.receber || b.pode.pagar) abas.push({ id: "financeiro", t: "Financeiro" });
  if (ehCli) abas.push({ id: "comercial", t: "Comercial", n: com.d ? com.d.vendas.length + com.d.crm.propostas.length : null },
    { id: "faturamento", t: "Faturamento" }, { id: "servicos", t: "Serviços", n: serv.d?.resumo?.os ?? null });
  if (ehForn) abas.push({ id: "compras", t: "Compras", n: comp.d?.pcs.length ?? null });
  abas.push({ id: "cadastro", t: "Cadastro" });

  return (
    <div className="est">
      <div className="crumbs">
        <button className="link" onClick={() => router.push(`/cadastros/${voltar}`)}>‹ {voltar === "clientes" ? "Clientes" : "Fornecedores"}</button>
        <span>/</span><span>{p.fantasia || p.razao}</span>
      </div>
      {sp.get("salvo") && <div className="aviso t-ok">Cadastro salvo no painel.</div>}
      {p.id !== id && <div className="aviso t-info">Este cadastro foi mesclado — a mostrar o que ficou.</div>}

      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 260 }}>
          <div className="area">Cadastros · ficha 360</div>
          <h1>{p.razao}</h1>
          <div className="sub" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            {p.fantasia && p.fantasia !== p.razao && <span>{p.fantasia}</span>}
            {p.doc && <span className="mono">{p.doc}</span>}
            {p.cidade && <span>{p.cidade}{p.uf ? `/${p.uf}` : ""}</span>}
            <Papeis p={{ cliente: ehCli, fornecedor: b.irmaos.some((i) => i.fornecedor), transportadora: b.irmaos.some((i) => i.transportadora) }} />
            {p.preCadastro && <Pill t="Pré-cadastro" tom="warn" title="Sem CNPJ/CPF ainda" />}
            {!p.ativo && <Pill t="Inativo" tom="off" />}
          </div>
          <div className="sub" style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
            {b.irmaos.map((i) => (
              <span key={i.id} className="pill t-off" title={`${i.empresa} · código ${i.codigo}${i.codigoOmie ? ` · Omie ${i.codigoOmie}` : ""}`}>
                {i.empresa} · {i.codigo}
              </span>
            ))}
            {b.apps.length > 0 && <span className="mini">· ligado em {Array.from(new Set(b.apps.map((a) => a.app === "servicos" ? "Serviços" : "CRM"))).join(" e ")} ({b.apps.length})</span>}
          </div>
        </div>
        <div className="filtros">
          {ehCli && <a className="btn" href={linkCrm(p.fantasia || p.razao)} title="Propostas e oportunidades no CRM">Ver no CRM</a>}
          {b.pode.editar && <button className="btn pri" onClick={() => router.push(`/cadastros/${p.id}/editar`)}>Editar cadastro</button>}
        </div>
      </header>

      {b.parecidos.some((c) => c.forte) && (
        <ListaCandidatos itens={b.parecidos.filter((c) => c.forte)} titulo="Pode haver outro cadastro desta mesma pessoa — veja em Cadastros › Duplicidades"
          onAbrir={(c) => router.push(`/cadastros/${c.id}`)} />
      )}

      <div className="kpis">
        {ehCli && <div className="kpi hero"><div className="r">Faturado (PV/OS)</div><div className="v">{com.d ? kbrl(faturado) : "…"}</div>
          <div className="s">{com.d ? `${kbrl(aFaturar)} a faturar` : "carregando"}</div></div>}
        {ehCli && com.d?.margem && <div className="kpi" title="(PV − PCs ligados) / PV, nos PV/OS com custo"><div className="r">Margem bruta</div>
          <div className="v">{com.d.margem.margem != null ? `${String(com.d.margem.margem).replace(".", ",")}%` : "—"}</div>
          <div className="s">{com.d.margem.pvosMedidos} de {com.d.margem.pvos} PV/OS com custo</div></div>}
        {fin.d?.receber && <div className="kpi"><div className="r">A receber</div><div className="v">{kbrl(fin.d.receber.aberto)}</div>
          <div className={`s${fin.d.receber.vencido > 0 ? " crit" : ""}`}>{fin.d.receber.vencido > 0 ? `${kbrl(fin.d.receber.vencido)} vencido` : `${kbrl(fin.d.receber.recebido)} recebido`}</div></div>}
        {ehForn && <div className="kpi hero"><div className="r">Comprado (total)</div><div className="v">{comp.d ? kbrl(comp.d.totais.comprado) : "…"}</div>
          <div className="s">{comp.d ? `${comp.d.totais.pcs} PCs${comp.d.totais.primeiro ? ` · desde ${ddmmaa(comp.d.totais.primeiro)}` : ""}` : "carregando"}</div></div>}
        {fin.d?.pagar && <div className="kpi"><div className="r">A pagar</div><div className="v">{kbrl(fin.d.pagar.aberto)}</div>
          <div className={`s${fin.d.pagar.vencido > 0 ? " crit" : ""}`}>{fin.d.pagar.vencido > 0 ? `${kbrl(fin.d.pagar.vencido)} vencido` : `${kbrl(fin.d.pagar.pago)} pago`}</div></div>}
        {ehCli && serv.d && !serv.d.indisponivel && serv.d.resumo && <div className="kpi"><div className="r">Serviços</div>
          <div className="v">{serv.d.resumo.osAbertas} OS abertas</div><div className="s">{serv.d.resumo.os} OS · {serv.d.resumo.chamadosAbertos} chamados abertos</div></div>}
      </div>

      <div className="seg">
        {abas.map((a) => <button key={a.id} className={aba === a.id ? "on" : ""} onClick={() => setAba(a.id)}>{a.t}{a.n != null && <span className="b">{a.n}</span>}</button>)}
      </div>

      {aba === "resumo" && <Resumo b={b} fin={fin.d} com={com.d} comp={comp.d} serv={serv.d} />}
      {aba === "financeiro" && <Carregando s={fin}>{fin.d && <Financeiro d={fin.d} />}</Carregando>}
      {aba === "comercial" && <Carregando s={com}>{com.d && <Comercial d={com.d} podeMargem={b.pode.receber} />}</Carregando>}
      {aba === "faturamento" && <Carregando s={fat}>{fat.d && <Faturamento d={fat.d} />}</Carregando>}
      {aba === "compras" && <Carregando s={comp}>{comp.d && <Compras d={comp.d} />}</Carregando>}
      {aba === "servicos" && <Carregando s={serv}>{serv.d && <Servicos d={serv.d} />}</Carregando>}
      {aba === "cadastro" && <Cadastro b={b} />}
    </div>
  );
}

function Carregando({ s, children }: { s: { d: unknown; erro: string | null }; children: React.ReactNode }) {
  if (s.erro) return <div className="aviso t-crit">{s.erro}</div>;
  if (!s.d) return <div className="cartao vazio">Carregando…</div>;
  return <>{children}</>;
}

function Tabela({ cab, linhas, vazio, dir = [] }: { cab: string[]; linhas: React.ReactNode[][]; vazio: string; dir?: number[] }) {
  return (
    <div className="cartao" style={{ overflowX: "auto" }}>
      <table className="tabela">
        <thead><tr>{cab.map((h, i) => <th key={h + i} className={dir.includes(i) ? "r" : ""}>{h}</th>)}</tr></thead>
        <tbody>
          {linhas.length === 0 && <tr><td colSpan={cab.length} className="vazio">{vazio}</td></tr>}
          {linhas.map((l, i) => <tr key={i}>{l.map((c, j) => <td key={j} className={dir.includes(j) ? "r" : ""}>{c}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

const Titulo = ({ t, children }: { t: string; children?: React.ReactNode }) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "14px 0 8px" }}><b style={{ fontSize: 15 }}>{t}</b>{children}</div>
);

function Resumo({ b, fin, com, comp, serv }: { b: Base; fin: Fin | null; com: Com | null; comp: Comp | null; serv: Serv | null }) {
  const ev: { quando: string; o: string; tom?: "ok" | "info" | "warn" }[] = [];
  com?.vendas.slice(0, 6).forEach((v) => v.emissao && ev.push({ quando: String(v.emissao), o: `${v.label ?? `${v.tipo} ${v.numero}`} · ${brl(v.valor as number)}${v.faturado ? " · faturado" : ""} · ${v.empresa}` }));
  com?.crm.propostas.slice(0, 5).forEach((x) => x.data && ev.push({ quando: String(x.data), o: `Proposta ${x.numero} · ${x.status ?? ""} · ${brl(x.valor as number)}` }));
  fin?.extrato.slice(0, 8).forEach((x) => ev.push({ quando: x.data, o: `${x.natureza === "pagar" ? "Pago" : "Recebido"} ${brl(x.valor)}${x.documento ? ` · ${x.documento}` : ""}${x.conciliado ? " · conciliado" : ""} · ${x.empresa}`, tom: "ok" }));
  comp?.pcs.slice(0, 5).forEach((x) => x.emissao && ev.push({ quando: String(x.emissao), o: `PC ${x.numero} · ${brl(x.valor as number)} · ${x.empresa}` }));
  serv?.os?.slice(0, 5).forEach((x) => ev.push({ quando: String(x.data_agendamento ?? x.created_at), o: `OS ${x.service_id ?? ""} · ${x.service_type ?? ""} · ${x.status ?? ""}` }));
  ev.sort((a, c) => c.quando.localeCompare(a.quando));
  const p = b.pessoa;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Linha do tempo</div>
        {ev.length === 0 ? <div className="mini">Carregando ou nada ainda.</div> : (
          <div style={{ display: "grid", gap: 8 }}>
            {ev.slice(0, 14).map((e, i) => (
              <div key={i} style={{ display: "flex", gap: 10, fontSize: 12.5 }}><span className="mini" style={{ width: 62, flex: "none" }}>{ddmmaa(e.quando)}</span><span>{e.o}</span></div>
            ))}
          </div>
        )}
      </div>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Contato</div>
        <Linhas itens={[["E-mail", p.email], ["Cobrança", p.emailCobranca], ["NF-e", p.emailNfe], ["Telefone", [p.telefone, p.telefone2].filter(Boolean).join(" · ")], ["Contato", p.contato],
          ["Endereço", [p.logradouro, p.numero, p.bairro, p.cidade && `${p.cidade}${p.uf ? `/${p.uf}` : ""}`].filter(Boolean).join(", ")]]} />
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
        <div key={k} style={{ display: "flex", gap: 10, fontSize: 12.5 }}><span className="mini" style={{ width: 110, flex: "none" }}>{k}</span><span>{v || "—"}</span></div>
      ))}
    </div>
  );
}

function Financeiro({ d }: { d: Fin }) {
  return (
    <>
      {d.receber && <>
        <Titulo t="A receber"><span className="mini">{kbrl(d.receber.aberto)} em aberto · {kbrl(d.receber.vencido)} vencido · {kbrl(d.receber.recebido)} recebido</span></Titulo>
        <Tabela cab={["Empresa", "Documento", "Vencimento", "NF", "Situação", "Valor", "Recebido"]} vazio="Nenhum título a receber." dir={[5, 6]}
          linhas={d.receber.titulos.map((t) => [t.empresa, <b key="d">{t.doc ?? "—"}{t.parcela ? ` · ${t.parcela}` : ""}</b>, ddmmaa(t.vencimento), t.nf ?? "—",
            <Pill key="s" t={t.status ?? "—"} tom={tom(t.status)} />, brl(t.valor), brl(t.pago)])} />
      </>}
      {d.pagar && <>
        <Titulo t="A pagar"><span className="mini">{kbrl(d.pagar.aberto)} em aberto · {kbrl(d.pagar.vencido)} vencido · {kbrl(d.pagar.pago)} pago{d.pagar.previsto ? ` · ${kbrl(d.pagar.previsto)} previsto de PC` : ""}</span></Titulo>
        <Tabela cab={["Empresa", "Documento", "Vencimento", "Pedido", "Situação", "Valor", "Pago"]} vazio="Nenhum título a pagar." dir={[5, 6]}
          linhas={d.pagar.titulos.map((t) => [t.empresa, <b key="d">{t.doc ?? "—"}{t.parcela ? ` · ${t.parcela}` : ""}</b>, ddmmaa(t.vencimento), t.pedido ?? "—",
            <Pill key="s" t={t.origem === "painel" ? `Previsto · ${t.status ?? ""}` : t.status ?? "—"} tom={tom(t.status)} />, brl(t.valor),
            t.pago ? `${brl(t.pago)}${t.pagamento ? ` em ${ddmmaa(t.pagamento)}` : ""}` : "—"])} />
      </>}
      <Titulo t="Extrato (pagamentos e recebimentos)"><span className="mini">baixas do painel com o movimento do banco conciliado + títulos liquidados no Omie</span></Titulo>
      <Tabela cab={["Data", "Empresa", "Tipo", "Documento", "Banco / conciliação", "Origem", "Valor"]} vazio="Nenhum pagamento ou recebimento." dir={[6]}
        linhas={d.extrato.slice(0, 200).map((x) => [ddmmaa(x.data), x.empresa,
          <Pill key="t" t={x.natureza === "pagar" ? "Pagamento" : "Recebimento"} tom={x.natureza === "pagar" ? "warn" : "ok"} />,
          x.documento ?? x.nf ?? "—",
          x.conciliado ? <span key="c">{x.banco ?? "banco"} · conciliado{x.memo ? <span className="mini"> · {String(x.memo).slice(0, 40)}</span> : null}</span> : x.origem === "painel" ? "sem extrato" : "—",
          x.origem === "omie" ? "Omie" : "Painel", brl(x.valor)])} />
    </>
  );
}

function Comercial({ d, podeMargem }: { d: Com; podeMargem: boolean }) {
  return (
    <>
      <Titulo t="Propostas e oportunidades (CRM)">{d.crm.indisponivel ? <span className="mini">CRM indisponível: {d.crm.motivo}</span>
        : <span className="mini">{d.crm.clientes.length ? `cliente no CRM: ${d.crm.clientes.map((c) => c.nome).join(", ")}` : "não encontrado no CRM"}</span>}</Titulo>
      <Tabela cab={["Proposta", "Data", "Descrição", "Situação", "Valor"]} vazio="Nenhuma proposta." dir={[4]}
        linhas={d.crm.propostas.map((x) => [<a key="n" className="link" href={String(x.link)} target="_blank" rel="noreferrer"><b>{String(x.numero)}</b></a>,
          ddmmaa(x.data as string), String(x.descricao ?? "—").slice(0, 70), <Pill key="s" t={String(x.status ?? "—")} tom={tom(x.status)} />, brl(x.valor as number)])} />
      {d.crm.oportunidades.length > 0 && <Tabela cab={["Oportunidade", "Criada", "Descrição", "Fase", "Estimado"]} vazio="" dir={[4]}
        linhas={d.crm.oportunidades.map((x) => [<b key="n">{String(x.numero ?? "—")}</b>, ddmmaa(x.created_at as string), String(x.descricao ?? "—").slice(0, 70),
          <Pill key="f" t={String(x.fase_atual ?? "—")} tom="info" />, brl(x.valor_estimado as number)])} />}
      <Titulo t="PV / OS">{d.margem && podeMargem && <span className="mini">margem {d.margem.margem != null ? `${String(d.margem.margem).replace(".", ",")}%` : "—"} · {kbrl(d.margem.rentabilidade)} sobre {kbrl(d.margem.faturamento)}</span>}</Titulo>
      <Tabela cab={["Pedido", "Empresa", "Emissão", "Etapa", "NF", "Valor", "M.B.", "Pago / recebido"]} vazio="Nenhum PV/OS." dir={[5, 6]}
        linhas={d.vendas.map((v) => [
          <a key="n" className="link" href={`/bi/rentabilidade?pedido=${encodeURIComponent(String(v.label ?? ""))}&empresa=${v.empresa}`}><b>{String(v.label ?? `${v.tipo} ${v.numero}`)}</b></a>,
          v.empresa, ddmmaa(v.emissao as string),
          v.cancelado ? <Pill key="e" t="Cancelado" tom="off" /> : v.faturado ? <Pill key="e" t={`Faturado ${ddmmaa(v.dtFat as string)}`} tom="ok" /> : <Pill key="e" t={String(v.etapa ?? "Em aberto")} tom="info" />,
          String(v.nf ?? "—"), brl(v.valor as number),
          v.margemPct != null ? `${(Number(v.margemPct) * 100).toFixed(1).replace(".", ",")}%` : "—",
          <span key="p" style={{ display: "inline-flex", gap: 4 }}>
            {v.custo ? <Pill t={v.pagoOk ? "Pago" : "A pagar"} tom={v.pagoOk ? "ok" : "info"} /> : null}
            {v.faturado ? <Pill t={v.recebidoOk ? "Recebido" : "A receber"} tom={v.recebidoOk ? "ok" : "info"} /> : null}
          </span>])} />
    </>
  );
}

function Faturamento({ d }: { d: Fat }) {
  return (
    <>
      <Titulo t="Notas emitidas pelo painel (Focus)" />
      <Tabela cab={["Nota", "Empresa", "Ambiente", "Origem", "Situação", "Quando", "Valor"]} vazio="Nenhuma nota emitida pelo painel para este CNPJ/CPF." dir={[6]}
        linhas={d.emissoes.map((e) => [<b key="n">{String(e.tipo).toUpperCase()} {String(e.numero ?? "—")}{e.serie ? `/${e.serie}` : ""}</b>, String(e.empresa),
          e.ambiente === "producao" ? "Produção" : <Pill key="a" t="Homologação" tom="off" />, String(e.origem ?? "—"),
          <Pill key="s" t={String(e.status ?? "—")} tom={tom(e.status)} />, ddmmaa(String(e.autorizadaEm ?? e.criadaEm ?? "")), brl(e.valor as number)])} />
      <Titulo t="Notas fiscais (histórico)" />
      <Tabela cab={["Nota", "Empresa", "Emissão", "Pedido / OS", "Situação", "Valor"]} vazio="Nenhuma nota." dir={[5]}
        linhas={d.nfs.map((n) => [<b key="n">{String(n.tipo)} {String(n.numero)}{n.serie ? `/${n.serie}` : ""}</b>, n.empresa, ddmmaa(n.emissao as string), String(n.pedido ?? "—"),
          n.cancelada === true || n.cancelada === "S" ? <Pill key="s" t="Cancelada" tom="off" /> : <Pill key="s" t="Emitida" tom="ok" />, brl(n.valor as number)])} />
    </>
  );
}

function Compras({ d }: { d: Comp }) {
  const max = Math.max(1, ...d.gasto.map((g) => Math.max(g.comprado ?? 0, g.pago ?? 0)));
  return (
    <>
      {d.abertos.length > 0 && <>
        <Titulo t="RC / PC em andamento" />
        <Tabela cab={["Pedido", "Empresa", "Emissão", "Etapa", "Previsão", "PV/OS", "Valor"]} vazio="" dir={[6]}
          linhas={d.abertos.map((x) => [<b key="n">{String(x.tipo)} {String(x.numero)}</b>, String(x.empresa), ddmmaa(x.emissao as string),
            <Pill key="e" t={ETAPA_PC[String(x.etapa ?? "")] ?? String(x.etapa ?? "—")} tom="info" />, ddmmaa(x.previsao as string), String(x.pvos ?? "avulso"), brl(x.valor as number)])} />
      </>}
      <Titulo t="Quanto gastei (12 meses)" />
      <div className="cartao" style={{ padding: "12px 16px" }}>
        <table className="tabela"><tbody>
          {d.gasto.map((g) => (
            <tr key={g.mes}><td style={{ width: 70 }}>{g.mes.slice(5)}/{g.mes.slice(2, 4)}</td>
              <td><div className="barra" title="Comprado"><i style={{ width: `${((g.comprado ?? 0) / max) * 100}%`, background: "var(--ww-accent)" }} /></div>
                <div className="barra" style={{ marginTop: 3 }} title="Pago"><i style={{ width: `${((g.pago ?? 0) / max) * 100}%`, background: "var(--ww-ok)" }} /></div></td>
              <td className="r num">{brl(g.comprado)}</td><td className="r num">{brl(g.pago)}</td></tr>
          ))}
        </tbody></table>
      </div>
      <Titulo t="Itens comprados" />
      <Tabela cab={["Código", "Descrição", "Qtd.", "Vezes", "Último preço", "Última compra", "Total"]} vazio="Nenhum item." dir={[2, 3, 4, 6]}
        linhas={d.itens.map((i) => [String(i.codigo ?? "—"), String(i.descricao ?? "—"), String(i.qtd ?? "—"), String(i.vezes ?? ""),
          brl(i.ultimoPreco as number), ddmmaa(i.ultimaCompra as string), brl(i.total as number)])} />
      <Titulo t="Pedidos de compra" />
      <Tabela cab={["Pedido", "Empresa", "Emissão", "Etapa", "PV/OS · cliente", "NF", "Valor"]} vazio="Nenhum PC." dir={[6]}
        linhas={d.pcs.map((x) => [<b key="n">PC {String(x.numero)}</b>, x.empresa, ddmmaa(x.emissao as string),
          x.cancelado ? <Pill key="e" t="Cancelado" tom="off" /> : <Pill key="e" t={ETAPA_PC[String(x.etapa ?? "")] ?? String(x.etapa ?? "—")} tom={x.etapa === "80" ? "ok" : "info"} />,
          [x.pvos, x.cliente].filter(Boolean).join(" · ") || "avulso", String(x.nf ?? "—"), brl(x.valor as number)])} />
      <Titulo t="NFs de entrada" />
      <Tabela cab={["NF-e", "Empresa", "Emissão", "Pedido", "Situação", "Valor"]} vazio="Nenhuma NF-e." dir={[5]}
        linhas={d.nfs.map((n) => [<b key="n">{String(n.numero)}</b>, n.empresa, ddmmaa(n.emissao as string),
          n.pedido ? `PC ${n.pedido}` : <Pill key="p" t="Sem pedido" tom="crit" />, String(n.situacao ?? "—"), brl(n.valor as number)])} />
    </>
  );
}

function Servicos({ d }: { d: Serv }) {
  if (d.indisponivel) return <div className="aviso t-info">Serviços: {d.motivo}</div>;
  return (
    <>
      <Titulo t="Unidades ligadas a este cadastro"><span className="mini">várias unidades do mesmo cliente usam o mesmo cadastro</span></Titulo>
      <Tabela cab={["Unidade", "Endereço", "Tipo", "Subsistemas", "Equipamentos", "Contratos"]} vazio="Nenhuma unidade na app de Serviços." dir={[3, 4]}
        linhas={(d.unidades ?? []).map((u) => [<b key="n">{String(u.nome)}</b>, String(u.endereco ?? "—").slice(0, 60), String(u.tipo_cliente ?? "—"),
          String(u.subsistemas ?? 0), String(u.equipamentos ?? 0),
          Array.isArray(u.contratos) && u.contratos.length ? (u.contratos as J[]).map((k) => `${k.status ?? ""}${k.fim ? ` até ${ddmmaa(String(k.fim))}` : ""}`).join(" · ") : "—"])} />
      <Titulo t="Ordens de serviço" />
      <Tabela cab={["OS", "Tipo", "Agendada", "Situação", "Prioridade"]} vazio="Nenhuma OS."
        linhas={(d.os ?? []).map((o) => [<b key="n">{String(o.service_id ?? "—")}</b>, String(o.service_type ?? "—"), ddmmaa(String(o.data_agendamento ?? o.created_at ?? "")),
          <Pill key="s" t={String(o.status ?? "—")} tom={tom(o.status)} />, String(o.prioridade ?? "—")])} />
      <Titulo t="Chamados" />
      <Tabela cab={["Chamado", "Descrição", "Aberto", "Situação", "Gravidade"]} vazio="Nenhum chamado."
        linhas={(d.chamados ?? []).map((c) => [<b key="n">{String(c.chamado ?? "—")}</b>, String(c.descricao ?? "—").slice(0, 80), ddmmaa(String(c.data_abertura ?? "")),
          <Pill key="s" t={String(c.status_geral ?? c.lifecycle_status ?? "—")} tom={c.data_conclusao ? "ok" : "warn"} />, String(c.gravidade ?? "—")])} />
    </>
  );
}

function Cadastro({ b }: { b: Base }) {
  const p = b.pessoa;
  const router = useRouter();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 14 }}>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Dados fiscais</div>
        <Linhas itens={[["Razão social", p.razao], ["Fantasia", p.fantasia], ["CNPJ / CPF", p.doc], ["Insc. estadual", p.ie], ["Insc. municipal", p.im],
          ["Simples", p.simples == null ? null : p.simples ? "Sim" : "Não"]]} />
      </div>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Nas empresas do grupo</div>
        <div style={{ display: "grid", gap: 6 }}>
          {b.irmaos.map((i) => (
            <div key={i.id} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 12.5 }}>
              <b style={{ width: 30 }}>{i.empresa}</b><span className="mono">{i.codigo}</span>{i.codigoOmie && i.codigoOmie !== i.codigo ? <span className="mini">Omie {i.codigoOmie}</span> : null}
              <Origem o={i.origem} /><Papeis p={i} />
            </div>
          ))}
          {b.absorvidos.length > 0 && <div className="mini">Mesclados neste: {b.absorvidos.map((a) => `${a.empresa} ${a.codigo} (${a.razao})`).join(" · ")}</div>}
          {b.apps.length > 0 && <div className="mini">Ligado nas apps: {b.apps.map((a) => `${a.app === "servicos" ? "Serviços" : "CRM"} (${a.como})`).join(" · ")}</div>}
        </div>
      </div>
      <div className="cartao" style={{ padding: "14px 18px" }}>
        <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 10 }}>Histórico do cadastro</div>
        <div style={{ display: "grid", gap: 4 }}>
          {b.historico.length === 0 && <div className="mini">—</div>}
          {b.historico.map((h, i) => <div key={i} className="mini">{ddmmaa(h.em)} · {h.empresa} · {h.acao}{h.por ? ` · ${h.por}` : ""}</div>)}
        </div>
        {b.mesclas.length > 0 && <div style={{ marginTop: 10 }}>
          <div className="mini" style={{ fontWeight: 600 }}>Mesclas</div>
          {b.mesclas.map((m) => <div key={m.id} className="mini">{ddmmaa(m.em)} · {m.tipo === "agrupar" ? "agrupado" : "mesclado"} · {m.motivo}{m.desfeitaEm ? " · desfeita" : ""}</div>)}
          <button className="link" onClick={() => router.push("/cadastros/duplicidades")}>Ver duplicidades</button>
        </div>}
      </div>
    </div>
  );
}

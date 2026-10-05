"use client";

/**
 * Cadastros auxiliares (05/10/26, sql/63): projetos, contas/bancos, categorias,
 * centros de custo, condições de pagamento, tipos de documento, vendedores,
 * serviços (LC116), unidades e empresas — tudo o que vinha do Omie, agora
 * criado e editado no painel. O que nasce aqui aparece na hora nos seletores do
 * PC, do PV/OS, dos títulos, da conciliação e do BI (o banco escreve nos mesmos
 * espelhos que essas telas já liam). Nada vai ao Omie.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EMPRESAS, Origem, Pill, pedir, ddmmaa, brl, ErroPedido } from "./comum";

export type Registro = "projetos" | "contas" | "categorias" | "centros_custo" | "condicoes" | "tipos_documento"
  | "vendedores" | "servicos" | "unidades" | "empresas";

type Dados = Record<string, unknown>;
type Linha = {
  id: number; registro: Registro; empresa: string; codigo: string; omieCodigo: string | null; nome: string;
  dados: Dados; inativo: boolean; origem: "omie" | "painel"; editado: boolean; criadoEm: string; atualizadoEm: string;
};
type Hist = { acao: string; por: string | null; em: string; motivo: string | null };
type Detalhe = Linha & { historico: Hist[]; criadoPor: string | null; atualizadoPor: string | null };
type Cand = { id: number; codigo: string; nome: string; origem: string; motivo: string };

type Campo = {
  k: string;               // "nome" | "codigo" | chave em dados
  rot: string;
  tipo?: "texto" | "num" | "data" | "sel" | "bool" | "cliente" | "banco" | "grupo" | "dias";
  ops?: [string, string][];
  so_novo?: boolean;       // só aparece ao criar
  obrig?: boolean;
  larg?: 1 | 2 | 3 | 4;    // colunas de 4
  dica?: string;
};
type Col = { rot: string; v: (l: Linha) => React.ReactNode; mono?: boolean; dir?: boolean };
type Conf = { titulo: string; um: string; global: boolean; campos: Campo[]; cols: Col[]; sub: string };

const s = (v: unknown) => (v == null || v === "" ? null : String(v));
const TIPOS_CONTA: [string, string][] = [["CC", "Conta corrente"], ["CX", "Caixa"], ["AP", "Aplicação"], ["CA", "Cartão"], ["CI", "Investimento"], ["AD", "Adiantamento"]];

export const CONF: Record<Registro, Conf> = {
  projetos: {
    titulo: "Projetos", um: "projeto", global: false,
    sub: "PJ (projetos) e CT (contratos) — o número segue a sequência única das três empresas",
    campos: [
      { k: "tipo", rot: "Tipo", tipo: "sel", ops: [["PJ", "PJ · Projeto"], ["CT", "CT · Contrato"], ["OUTRO", "Outro (sem prefixo)"]], so_novo: true, larg: 1 },
      { k: "numero", rot: "Número", tipo: "num", so_novo: true, larg: 1, dica: "sugerido: o próximo livre" },
      { k: "nome", rot: "Nome", obrig: true, larg: 2, dica: "ex.: Hospital Santa Isabel — o prefixo PJ366_ entra sozinho" },
      { k: "cliente", rot: "Cliente", tipo: "cliente", larg: 2 },
      { k: "responsavel", rot: "Responsável", larg: 2 },
      { k: "status", rot: "Status", tipo: "sel", ops: [["ativo", "Em andamento"], ["concluido", "Concluído"], ["cancelado", "Cancelado"]], larg: 1 },
      { k: "orcamento", rot: "Orçamento (R$)", tipo: "num", larg: 1 },
      { k: "data_inicio", rot: "Início", tipo: "data", larg: 1 },
      { k: "data_fim", rot: "Fim previsto", tipo: "data", larg: 1 },
      { k: "obs", rot: "Observações", larg: 4 },
    ],
    cols: [
      { rot: "Projeto", v: (l) => <b>{l.nome}</b> },
      { rot: "Cliente", v: (l) => s(l.dados.cliente_nome) ?? <span className="mini">—</span> },
      { rot: "Responsável", v: (l) => s(l.dados.responsavel) ?? <span className="mini">—</span> },
      { rot: "Status", v: (l) => { const st = s(l.dados.status); return st ? <Pill t={st === "concluido" ? "Concluído" : st === "cancelado" ? "Cancelado" : "Em andamento"} tom={st === "ativo" ? "info" : "off"} /> : <span className="mini">—</span>; } },
      { rot: "Orçamento", v: (l) => (l.dados.orcamento != null ? brl(Number(l.dados.orcamento)) : <span className="mini">—</span>), dir: true },
    ],
  },
  contas: {
    titulo: "Bancos e contas", um: "conta", global: false,
    sub: "Contas correntes, caixas e aplicações — as mesmas da conciliação bancária e dos títulos",
    campos: [
      { k: "nome", rot: "Descrição", obrig: true, larg: 2, dica: "ex.: Itaú - SF" },
      { k: "tipo", rot: "Tipo", tipo: "sel", ops: TIPOS_CONTA, larg: 2 },
      { k: "banco", rot: "Banco", tipo: "banco", larg: 2 },
      { k: "agencia", rot: "Agência", larg: 1 },
      { k: "conta", rot: "Conta", larg: 1 },
      { k: "pix_tipo", rot: "Tipo da chave PIX", tipo: "sel", ops: [["", "—"], ["cnpj", "CNPJ"], ["cpf", "CPF"], ["email", "E-mail"], ["telefone", "Telefone"], ["aleatoria", "Aleatória"]], larg: 1 },
      { k: "pix_chave", rot: "Chave PIX", larg: 2, dica: "sai no recibo/NF-e quando a forma de recebimento é PIX" },
      { k: "beneficiario", rot: "Beneficiário", larg: 1, dica: "nome que o pagador vê (opcional)" },
      { k: "saldo_inicial", rot: "Saldo inicial (R$)", tipo: "num", larg: 1 },
      { k: "saldo_data", rot: "Data do saldo", tipo: "data", larg: 1 },
      { k: "limite", rot: "Limite (R$)", tipo: "num", larg: 1 },
      { k: "gerente", rot: "Gerente", larg: 1 },
      { k: "telefone", rot: "Telefone", larg: 2 },
      { k: "email", rot: "E-mail", larg: 2 },
      { k: "obs", rot: "Observações", larg: 4 },
    ],
    cols: [
      { rot: "Conta", v: (l) => <b>{l.nome}</b> },
      { rot: "Banco", v: (l) => s(l.dados.banco) ?? <span className="mini">—</span>, mono: true },
      { rot: "Agência / conta", v: (l) => [s(l.dados.agencia), s(l.dados.conta)].filter(Boolean).join(" / ") || <span className="mini">—</span>, mono: true },
      { rot: "Tipo", v: (l) => TIPOS_CONTA.find((t) => t[0] === l.dados.tipo)?.[1] ?? s(l.dados.tipo) ?? "—" },
      { rot: "Saldo inicial", v: (l) => (l.dados.saldo_inicial != null ? `${brl(Number(l.dados.saldo_inicial))}${l.dados.saldo_data ? ` em ${ddmmaa(String(l.dados.saldo_data))}` : ""}` : "—"), dir: true },
    ],
  },
  categorias: {
    titulo: "Categorias", um: "categoria", global: false,
    sub: "Plano de categorias de receita e despesa — a nova categoria entra debaixo de um grupo e recebe o próximo código",
    campos: [
      { k: "superior", rot: "Grupo", tipo: "grupo", so_novo: true, obrig: true, larg: 2 },
      { k: "nome", rot: "Nome", obrig: true, larg: 2 },
      { k: "obs", rot: "Observações", larg: 4 },
    ],
    cols: [
      { rot: "Código", v: (l) => l.codigo, mono: true },
      { rot: "Categoria", v: (l) => (l.dados.totalizadora ? <b>{l.nome}</b> : <span style={{ paddingLeft: 10 * (l.codigo.split(".").length - 2) }}>{l.nome}</span>) },
      { rot: "Tipo", v: (l) => (l.dados.totalizadora ? <Pill t="Grupo" tom="off" /> : l.dados.receita ? <Pill t="Receita" tom="ok" /> : l.dados.despesa ? <Pill t="Despesa" tom="warn" /> : <span className="mini">—</span>) },
    ],
  },
  centros_custo: {
    titulo: "Centros de custo", um: "centro de custo", global: false, sub: "Departamentos do Omie — usados no rateio do PC e dos títulos",
    campos: [{ k: "nome", rot: "Nome", obrig: true, larg: 4 }],
    cols: [{ rot: "Centro de custo", v: (l) => <b>{l.nome}</b> }],
  },
  condicoes: {
    titulo: "Condições de pagamento", um: "condição", global: false,
    sub: "Parcelas e prazos de venda e compra — a condição nova vale para PV/OS, PC e títulos",
    campos: [
      { k: "nome", rot: "Descrição", obrig: true, larg: 2, dica: "ex.: 30/60/90 dias — os dias saem da descrição" },
      { k: "dias", rot: "Dias das parcelas", tipo: "dias", larg: 1, dica: "separados por /" },
      { k: "n_parcelas", rot: "Nº de parcelas", tipo: "num", larg: 1 },
    ],
    cols: [
      { rot: "Código", v: (l) => l.codigo, mono: true },
      { rot: "Condição", v: (l) => <b>{l.nome}</b> },
      { rot: "Parcelas", v: (l) => s(l.dados.n_parcelas) ?? "—", dir: true },
      { rot: "Dias", v: (l) => (Array.isArray(l.dados.dias) ? (l.dados.dias as number[]).join(" / ") : <span className="mini">—</span>), mono: true },
    ],
  },
  tipos_documento: {
    titulo: "Tipos de documento", um: "tipo de documento", global: true, sub: "Boleto, NF, recibo… — os tipos dos títulos a pagar e receber",
    campos: [
      { k: "codigo", rot: "Sigla", so_novo: true, larg: 1, dica: "opcional" },
      { k: "nome", rot: "Descrição", obrig: true, larg: 3 },
    ],
    cols: [{ rot: "Sigla", v: (l) => l.codigo, mono: true }, { rot: "Descrição", v: (l) => <b>{l.nome}</b> }],
  },
  vendedores: {
    titulo: "Vendedores", um: "vendedor", global: false, sub: "Quem vende — aparece no PV/OS e nos títulos a receber",
    campos: [
      { k: "nome", rot: "Nome", obrig: true, larg: 2 },
      { k: "email", rot: "E-mail", larg: 1 },
      { k: "comissao", rot: "Comissão (%)", tipo: "num", larg: 1 },
    ],
    cols: [
      { rot: "Vendedor", v: (l) => <b>{l.nome}</b> },
      { rot: "E-mail", v: (l) => s(l.dados.email) ?? <span className="mini">—</span> },
      { rot: "Comissão", v: (l) => (l.dados.comissao != null ? `${l.dados.comissao}%` : "—"), dir: true },
    ],
  },
  servicos: {
    titulo: "Serviços", um: "serviço", global: false, sub: "Catálogo de serviços das OS — item da LC 116, código do município e ISS",
    campos: [
      { k: "nome", rot: "Descrição", obrig: true, larg: 4 },
      { k: "lc116", rot: "Item LC 116", larg: 1, dica: "ex.: 7.15" },
      { k: "cod_municipio", rot: "Cód. no município", larg: 2 },
      { k: "aliquota_iss", rot: "ISS (%)", tipo: "num", larg: 1 },
    ],
    cols: [
      { rot: "Serviço", v: (l) => <b>{l.nome}</b> },
      { rot: "LC 116", v: (l) => s(l.dados.lc116) ?? "—", mono: true },
      { rot: "Município", v: (l) => s(l.dados.cod_municipio) ?? "—", mono: true },
      { rot: "ISS", v: (l) => (l.dados.aliquota_iss != null ? `${l.dados.aliquota_iss}%` : "—"), dir: true },
    ],
  },
  unidades: {
    titulo: "Unidades", um: "unidade", global: true, sub: "Unidades de medida dos itens (UN, M, KG, CX…)",
    campos: [
      { k: "codigo", rot: "Sigla", so_novo: true, obrig: true, larg: 1 },
      { k: "nome", rot: "Descrição", larg: 3 },
    ],
    cols: [{ rot: "Sigla", v: (l) => <b>{l.codigo}</b>, mono: true }, { rot: "Descrição", v: (l) => l.nome }],
  },
  empresas: {
    titulo: "Empresas", um: "empresa", global: true, sub: "Dados das empresas do grupo — saem no PDF do pedido e nos documentos",
    campos: [
      { k: "codigo", rot: "Sigla", so_novo: true, obrig: true, larg: 1 },
      { k: "nome", rot: "Razão social", obrig: true, larg: 3 },
      { k: "fantasia", rot: "Nome fantasia", larg: 2 },
      { k: "cnpj", rot: "CNPJ", larg: 2 },
      { k: "ie", rot: "Inscrição estadual", larg: 2 },
      { k: "im", rot: "Inscrição municipal", larg: 2 },
      { k: "endereco", rot: "Endereço", larg: 3 },
      { k: "numero", rot: "Nº", larg: 1 },
      { k: "complemento", rot: "Complemento", larg: 2 },
      { k: "bairro", rot: "Bairro", larg: 2 },
      { k: "cidade", rot: "Cidade", larg: 2 },
      { k: "uf", rot: "UF", larg: 1 },
      { k: "cep", rot: "CEP", larg: 1 },
      { k: "telefone", rot: "Telefone", larg: 2 },
      { k: "email", rot: "E-mail", larg: 2 },
    ],
    cols: [
      { rot: "Sigla", v: (l) => <b>{l.codigo}</b>, mono: true },
      { rot: "Razão social", v: (l) => l.nome },
      { rot: "CNPJ", v: (l) => s(l.dados.cnpj) ?? "—", mono: true },
      { rot: "Cidade", v: (l) => [s(l.dados.cidade), s(l.dados.uf)].filter(Boolean).join("/") || "—" },
    ],
  },
};

type Resp = { total: number; nativos: number; linhas: Linha[]; podeEditar: boolean; admin: boolean };

export default function TelaAuxiliar({ reg }: { reg: Registro }) {
  const c = CONF[reg];
  const [emp, setEmp] = useState("SF");
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState(false);
  const [dados, setDados] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [mais, setMais] = useState(false);
  const [aberto, setAberto] = useState<{ id: number | null } | null>(null);
  const seq = useRef(0);
  const alvo = useRef<string | null>(null);

  useEffect(() => {
    try { const e = localStorage.getItem("cad-emp"); if (e && (EMPRESAS as readonly string[]).includes(e)) setEmp(e); } catch {}
    // Link direto (ex.: Nova emissão › "Cadastrar chave PIX nesta conta"): ?emp=SF&codigo=2252238644 abre a ficha.
    const sp = new URLSearchParams(window.location.search);
    const e2 = (sp.get("emp") ?? "").toUpperCase();
    if (e2 && (EMPRESAS as readonly string[]).includes(e2)) setEmp(e2);
    const cod = sp.get("codigo");
    if (cod) alvo.current = cod;
  }, []);
  useEffect(() => {
    if (!alvo.current || !dados) return;
    const l = dados.linhas.find((x) => String(x.codigo) === alvo.current || String(x.omieCodigo ?? "") === alvo.current);
    if (l) { alvo.current = null; setAberto({ id: l.id }); }
    else if (!busca) setBusca(alvo.current);
    else alvo.current = null;
  }, [dados, busca]);

  const url = useCallback((off = 0) =>
    `/api/cadastros/aux?reg=${reg}&emp=${emp}&q=${encodeURIComponent(busca)}${todos ? "&todos=1" : ""}${off ? `&off=${off}` : ""}`,
  [reg, emp, busca, todos]);

  const carregar = useCallback(async () => {
    const n = ++seq.current;
    try { const r = await pedir<Resp>(url()); if (n === seq.current) { setDados(r); setErro(null); } }
    catch (e) { if (n === seq.current) setErro((e as Error).message); }
  }, [url]);

  useEffect(() => { const t = setTimeout(carregar, busca ? 250 : 0); return () => clearTimeout(t); }, [carregar, busca]);

  const carregarMais = async () => {
    if (!dados) return;
    setMais(true);
    try { const r = await pedir<Resp>(url(dados.linhas.length)); setDados({ ...dados, linhas: [...dados.linhas, ...r.linhas] }); }
    catch (e) { setErro((e as Error).message); } finally { setMais(false); }
  };

  const trocarEmp = (e: string) => { setEmp(e); try { localStorage.setItem("cad-emp", e); } catch {} };
  const nCols = c.cols.length + 3;

  return (
    <div className="est">
      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="area">Cadastros</div>
          <h1>{c.titulo}</h1>
          <div className="sub">
            {dados ? `${dados.total.toLocaleString("pt-BR")} ${dados.total === 1 ? c.um : c.titulo.toLowerCase()} · ${dados.nativos} criados no painel` : "Carregando…"}
            {` · ${c.sub}`}
          </div>
        </div>
        {dados?.podeEditar && <button className="btn pri" onClick={() => setAberto({ id: null })}>+ Novo {c.um}</button>}
      </header>

      <div className="filtros">
        {!c.global && (
          <div className="seg">
            {EMPRESAS.map((e) => <button key={e} className={emp === e ? "on" : ""} onClick={() => trocarEmp(e)}>{e}</button>)}
          </div>
        )}
        <button className={`chip${todos ? " on" : ""}`} onClick={() => setTodos((v) => !v)}>Incluir inativos</button>
        <span className="sp" />
        <input className="inp" style={{ width: 320 }} value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder={`Buscar ${c.titulo.toLowerCase()}…`} autoFocus />
      </div>

      {erro && <div className="aviso t-crit">{erro}</div>}

      <div className="cartao" style={{ overflowX: "auto" }}>
        <table className="tabela">
          <thead><tr>{c.cols.map((k) => <th key={k.rot} className={k.dir ? "num" : undefined}>{k.rot}</th>)}<th>Origem</th><th>Situação</th><th /></tr></thead>
          <tbody>
            {!dados && <tr><td colSpan={nCols} className="vazio">Carregando…</td></tr>}
            {dados && dados.linhas.length === 0 && (
              <tr><td colSpan={nCols} className="vazio">Nada encontrado{busca ? ` para “${busca}”` : ""}.
                {dados.podeEditar && <> <button className="link" onClick={() => setAberto({ id: null })}>Cadastrar</button></>}</td></tr>
            )}
            {dados?.linhas.map((l) => (
              <tr key={l.id} className="click" onClick={() => setAberto({ id: l.id })}>
                {c.cols.map((k) => <td key={k.rot} className={`${k.mono ? "mono" : ""}${k.dir ? " num" : ""}`} style={{ whiteSpace: k.dir || k.mono ? "nowrap" : undefined }}>{k.v(l)}</td>)}
                <td><Origem o={l.origem} />{l.editado && <div className="mini">editado no painel</div>}</td>
                <td>{l.inativo ? <Pill t="Inativo" tom="off" /> : <Pill t="Ativo" tom="ok" />}</td>
                <td className="mini" style={{ whiteSpace: "nowrap" }}>cód. {l.codigo.length > 12 ? `…${l.codigo.slice(-6)}` : l.codigo}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {dados && dados.linhas.length < dados.total && (
          <div className="filtros" style={{ justifyContent: "center", padding: 12 }}>
            <button className="btn sm" disabled={mais} onClick={carregarMais}>
              {mais ? "Carregando…" : `Mostrar mais (${dados.linhas.length} de ${dados.total.toLocaleString("pt-BR")})`}
            </button>
          </div>
        )}
      </div>

      {aberto && (
        <FormAux reg={reg} emp={emp} id={aberto.id} podeEditar={!!dados?.podeEditar} admin={!!dados?.admin}
          onFechar={() => setAberto(null)} onSalvo={() => { setAberto(null); carregar(); }}
          onAbrir={(id) => setAberto({ id })} />
      )}
    </div>
  );
}

function FormAux({ reg, emp, id, podeEditar, admin, onFechar, onSalvo, onAbrir }: {
  reg: Registro; emp: string; id: number | null; podeEditar: boolean; admin: boolean;
  onFechar: () => void; onSalvo: () => void; onAbrir: (id: number) => void;
}) {
  const c = CONF[reg];
  const novo = id == null;
  const [det, setDet] = useState<Detalhe | null>(null);
  const [v, setV] = useState<Record<string, unknown>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [cands, setCands] = useState<Cand[] | null>(null);
  const [motivo, setMotivo] = useState("");
  const [indo, setIndo] = useState(false);
  const [sug, setSug] = useState<Record<string, unknown>>({});
  const [grupos, setGrupos] = useState<{ codigo: string; nome: string }[]>([]);

  useEffect(() => {
    if (novo) {
      setV(reg === "projetos" ? { tipo: "PJ", status: "ativo" } : reg === "contas" ? { tipo: "CC" } : {});
      if (reg === "projetos") pedir<Record<string, unknown>>(`/api/cadastros/aux?reg=projetos&emp=${emp}&sugestao=1`).then(setSug).catch(() => {});
      if (reg === "categorias") pedir<{ opcoes: { codigo: string; nome: string; dados: Dados }[] }>(`/api/cadastros/aux?reg=categorias&emp=${emp}&opcoes=1`)
        .then((r) => setGrupos(r.opcoes.filter((o) => o.dados?.totalizadora))).catch(() => {});
      return;
    }
    pedir<Detalhe>(`/api/cadastros/aux/${id}`).then((d) => {
      setDet(d);
      setV({ ...d.dados, nome: d.nome, codigo: d.codigo, inativo: d.inativo });
    }).catch((e) => setErro((e as Error).message));
  }, [id, novo, reg, emp]);

  const set = (k: string, x: unknown) => { setV((o) => ({ ...o, [k]: x })); setCands(null); };
  const campos = c.campos.filter((f) => novo || !f.so_novo);
  const numSugerido = reg === "projetos" && v.tipo !== "OUTRO" ? sug[String(v.tipo ?? "PJ")] : null;

  const salvar = async (forcar = false) => {
    setErro(null); setIndo(true);
    const dados: Dados = {};
    for (const f of c.campos) {
      if (f.k === "nome" || f.k === "codigo") continue;
      let x = v[f.k];
      if (f.tipo === "num") x = x === "" || x == null ? null : Number(String(x).replace(",", "."));
      if (f.tipo === "dias") x = typeof x === "string" ? x.split(/[\/,;\s]+/).filter(Boolean).map(Number).filter((n) => Number.isFinite(n)) : x;
      if (f.tipo === "cliente") continue;
      dados[f.k] = x === "" ? null : x;
    }
    if (reg === "projetos") { dados.cliente_codigo = v.cliente_codigo ?? null; dados.cliente_nome = v.cliente_nome ?? null; }
    if (reg === "projetos" && novo && v.tipo === "OUTRO") dados.tipo = "OUTRO";
    if (reg === "projetos" && novo && !v.numero && numSugerido) dados.numero = numSugerido;
    const corpo: Record<string, unknown> = { registro: reg, empresa: emp, nome: v.nome ?? null, dados, inativo: !!v.inativo };
    if (novo && v.codigo) corpo.codigo = v.codigo;
    if (forcar) { corpo.forcar = true; corpo.forcarMotivo = motivo; }
    try {
      await pedir(novo ? "/api/cadastros/aux" : `/api/cadastros/aux/${id}`, { method: novo ? "POST" : "PATCH", body: JSON.stringify(corpo) });
      onSalvo();
    } catch (e) {
      if (e instanceof ErroPedido && e.status === 409) { setCands((e.candidatos as unknown as Cand[]) ?? []); setErro(e.message); }
      else setErro((e as Error).message);
    } finally { setIndo(false); }
  };

  return (
    <div className="est-ov mid" onClick={onFechar} role="dialog" aria-modal="true">
      <div className="modal lg" onClick={(e) => e.stopPropagation()}>
        <div className="mh">
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>{novo ? `Novo ${c.um}` : det?.nome ?? "…"}</div>
            {det && <div className="mini">{det.empresa !== "*" ? `${det.empresa} · ` : ""}cód. {det.codigo}{det.omieCodigo ? " · veio do Omie" : " · criado no painel"}{det.editado ? " · editado no painel" : ""}</div>}
          </div>
          <button className="x" onClick={onFechar}>×</button>
        </div>
        <div className="mb">
          {!novo && det?.origem === "omie" && (
            <div className="aviso t-info">Cadastro que veio do Omie. Editar aqui vale para todo o painel; o sync do Omie não desfaz a sua edição.</div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 12 }}>
            {campos.map((f) => (
              <label key={f.k} className="f" style={{ gridColumn: `span ${f.larg ?? 2}`, display: "flex", flexDirection: "column", gap: 6, minWidth: 0 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ww-text-2)" }}>{f.rot}{f.obrig ? " *" : ""}</span>
                <CampoInput f={f} v={v} set={set} disabled={!podeEditar} grupos={grupos} emp={emp}
                  placeholder={f.k === "numero" && numSugerido ? String(numSugerido) : undefined} />
                {f.dica && <span className="mini">{f.dica}</span>}
              </label>
            ))}
            {!novo && (
              <label className="check" style={{ gridColumn: "span 4" }}>
                <input type="checkbox" disabled={!podeEditar} checked={!!v.inativo} onChange={(e) => set("inativo", e.target.checked)} /> Inativo (some dos seletores, continua no histórico)
              </label>
            )}
          </div>
          {reg === "projetos" && novo && v.tipo !== "OUTRO" && v.nome ? (
            <div className="mini">Vai ficar: <b>{String(v.tipo ?? "PJ")}{String(v.numero || numSugerido || "")}_{String(v.nome)}</b></div>
          ) : null}

          {erro && <div className="aviso t-crit">{erro}</div>}
          {cands && cands.length > 0 && (
            <div className="aviso t-warn" style={{ display: "grid", gap: 6 }}>
              <b>Já existe — use o existente:</b>
              {cands.map((k) => (
                <div key={k.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ flex: 1, minWidth: 200 }}><b>{k.nome}</b> <span className="mini">· cód. {k.codigo} · {k.origem === "painel" ? "painel" : "Omie"}</span></span>
                  <Pill t={k.motivo} tom="crit" />
                  <button type="button" className="btn sm" onClick={() => onAbrir(k.id)}>Abrir este</button>
                </div>
              ))}
              {admin && (
                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 4 }}>
                  <input className="inp" style={{ flex: 1, minWidth: 220 }} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Motivo para criar mesmo assim (administrador)" />
                  <button className="btn sm" disabled={indo || !motivo.trim()} onClick={() => salvar(true)}>Criar mesmo assim</button>
                </div>
              )}
            </div>
          )}

          {det && det.historico.length > 0 && (
            <details>
              <summary className="mini" style={{ cursor: "pointer" }}>Histórico ({det.historico.length})</summary>
              <div style={{ display: "grid", gap: 4, marginTop: 6 }}>
                {det.historico.map((h, i) => (
                  <div key={i} className="mini">{ddmmaa(h.em)} {h.em.slice(11, 16)} · {h.acao === "criado" ? "criado" : h.acao === "criado_forcado" ? "criado (forçado)" : "editado"} por {h.por ?? "—"}{h.motivo ? ` · ${h.motivo}` : ""}</div>
                ))}
              </div>
            </details>
          )}
        </div>
        <div className="mf">
          <span className="sp">{novo ? "Aparece na hora nos seletores do PC, PV/OS, títulos e BI. Não vai ao Omie." : ""}</span>
          <button className="btn" onClick={onFechar}>Fechar</button>
          {podeEditar && <button className="btn pri" disabled={indo} onClick={() => salvar(false)}>{indo ? "Salvando…" : novo ? "Cadastrar" : "Salvar"}</button>}
        </div>
      </div>
    </div>
  );
}

function CampoInput({ f, v, set, disabled, grupos, emp, placeholder }: {
  f: Campo; v: Record<string, unknown>; set: (k: string, x: unknown) => void; disabled: boolean;
  grupos: { codigo: string; nome: string }[]; emp: string; placeholder?: string;
}) {
  const val = v[f.k];
  if (f.tipo === "sel") {
    return (
      <select className="inp" disabled={disabled} value={String(val ?? "")} onChange={(e) => set(f.k, e.target.value || null)}>
        <option value="">—</option>
        {f.ops?.map(([k, r]) => <option key={k} value={k}>{r}</option>)}
      </select>
    );
  }
  if (f.tipo === "grupo") {
    return (
      <select className="inp" disabled={disabled} value={String(val ?? "")} onChange={(e) => set(f.k, e.target.value || null)}>
        <option value="">Escolha o grupo…</option>
        {grupos.map((g) => <option key={g.codigo} value={g.codigo}>{g.codigo} · {g.nome}</option>)}
      </select>
    );
  }
  if (f.tipo === "cliente") return <BuscaCliente v={v} set={set} disabled={disabled} emp={emp} />;
  if (f.tipo === "banco") return <BuscaBanco valor={String(val ?? "")} set={(x) => set(f.k, x)} disabled={disabled} />;
  if (f.tipo === "dias") {
    const txt = Array.isArray(val) ? (val as number[]).join("/") : String(val ?? "");
    return <input className="inp" disabled={disabled} value={txt} onChange={(e) => set(f.k, e.target.value)} placeholder="30/60/90" />;
  }
  return (
    <input className="inp" disabled={disabled} type={f.tipo === "data" ? "date" : "text"} inputMode={f.tipo === "num" ? "decimal" : undefined}
      value={val == null ? "" : String(val)} placeholder={placeholder}
      onChange={(e) => set(f.k, f.k === "codigo" ? e.target.value.toUpperCase() : e.target.value)} />
  );
}

function BuscaCliente({ v, set, disabled, emp }: { v: Record<string, unknown>; set: (k: string, x: unknown) => void; disabled: boolean; emp: string }) {
  const [q, setQ] = useState("");
  const [lista, setLista] = useState<{ codigo: number; razao: string; doc: string | null }[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setLista([]); return; }
    const t = setTimeout(() => {
      pedir<{ linhas: { codigo: number; razao: string; doc: string | null }[] }>(`/api/cadastros?papel=cliente&emp=${emp}&q=${encodeURIComponent(q)}`)
        .then((r) => setLista(r.linhas.slice(0, 8))).catch(() => setLista([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, emp]);
  if (v.cliente_nome) {
    return (
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}><b>{String(v.cliente_nome)}</b></span>
        {!disabled && <button type="button" className="link" onClick={() => { set("cliente_codigo", null); set("cliente_nome", null); }}>trocar</button>}
      </div>
    );
  }
  return (
    <div style={{ position: "relative" }}>
      <input className="inp" disabled={disabled} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou CNPJ do cliente" style={{ width: "100%" }} />
      {lista.length > 0 && (
        <div className="cartao" style={{ position: "absolute", zIndex: 5, left: 0, right: 0, top: "100%", marginTop: 4, padding: 4, maxHeight: 240, overflow: "auto" }}>
          {lista.map((c) => (
            <button key={c.codigo} type="button" className="link" style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px" }}
              onClick={() => { set("cliente_codigo", c.codigo); set("cliente_nome", c.razao); setQ(""); setLista([]); }}>
              {c.razao}{c.doc ? <span className="mini"> · {c.doc}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BuscaBanco({ valor, set, disabled }: { valor: string; set: (x: string | null) => void; disabled: boolean }) {
  const [q, setQ] = useState(valor);
  const [lista, setLista] = useState<{ codigo: string; nome: string }[]>([]);
  const [foco, setFoco] = useState(false);
  useEffect(() => { setQ(valor); }, [valor]);
  useEffect(() => {
    if (!foco || q.trim().length < 2) { setLista([]); return; }
    const t = setTimeout(() => {
      pedir<{ bancos: { codigo: string; nome: string }[] }>(`/api/cadastros/aux?bancos=1&q=${encodeURIComponent(q)}`)
        .then((r) => setLista(r.bancos)).catch(() => setLista([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q, foco]);
  const nome = useMemo(() => lista.find((b) => b.codigo === valor)?.nome, [lista, valor]);
  return (
    <div style={{ position: "relative" }}>
      <input className="inp" disabled={disabled} value={q} onFocus={() => setFoco(true)} onBlur={() => setTimeout(() => setFoco(false), 200)}
        onChange={(e) => { setQ(e.target.value); if (/^\d{1,4}$/.test(e.target.value)) set(e.target.value); }}
        placeholder="Código (ex.: 341) ou nome" style={{ width: "100%" }} title={nome} />
      {foco && lista.length > 0 && (
        <div className="cartao" style={{ position: "absolute", zIndex: 5, left: 0, right: 0, top: "100%", marginTop: 4, padding: 4, maxHeight: 240, overflow: "auto" }}>
          {lista.map((b) => (
            <button key={b.codigo} type="button" className="link" style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px" }}
              onMouseDown={() => { set(b.codigo); setQ(b.codigo); setLista([]); }}>
              <span className="mono">{b.codigo}</span> · {b.nome}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

"use client";

/**
 * Criar / editar cliente ou fornecedor (05/10/26). Grava em cadastros.pessoas
 * (nunca no Omie). CNPJ/CPF validado aqui e no banco; um documento por empresa.
 * "Buscar na Receita" e o CEP só pré-preenchem — a pessoa confere e salva.
 */

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { EMPRESAS, ErroPedido, ListaCandidatos, docValido, mascaraDoc, pedir, type Candidato, type Contato, type Papel, type Pessoa } from "./comum";

type Form = {
  empresa: string; cliente: boolean; fornecedor: boolean; transportadora: boolean;
  doc: string; razao: string; fantasia: string; ie: string; im: string; simples: "" | "sim" | "nao";
  cep: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; ibge: string;
  telefone: string; telefone2: string; email: string; emailCobranca: string; emailNfe: string; contato: string;
  contatos: Contato[]; obs: string; ativo: boolean;
};

const VAZIO: Form = {
  empresa: "SF", cliente: false, fornecedor: false, transportadora: false, doc: "", razao: "", fantasia: "", ie: "", im: "", simples: "",
  cep: "", logradouro: "", numero: "", complemento: "", bairro: "", cidade: "", uf: "", ibge: "",
  telefone: "", telefone2: "", email: "", emailCobranca: "", emailNfe: "", contato: "", contatos: [], obs: "", ativo: true,
};
const UFS = ["AC", "AL", "AM", "AP", "BA", "CE", "DF", "ES", "GO", "MA", "MG", "MS", "MT", "PA", "PB", "PE", "PI", "PR", "RJ", "RN", "RO", "RR", "RS", "SC", "SE", "SP", "TO"];
const emailOk = (e: string) => !e.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e.trim());

export default function FormPessoa({ id }: { id?: number }) {
  const router = useRouter();
  const sp = useSearchParams();
  const editando = id != null;
  const [f, setF] = useState<Form | null>(editando ? null : {
    ...VAZIO,
    empresa: (sp.get("emp") ?? "SF").toUpperCase(),
    cliente: sp.get("papel") === "cliente", fornecedor: sp.get("papel") === "fornecedor",
    doc: sp.get("doc") ? mascaraDoc(sp.get("doc")!) : "", razao: sp.get("razao") ?? "",
  });
  const [orig, setOrig] = useState<Pessoa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [indo, setIndo] = useState(false);
  const [consultando, setConsultando] = useState<"" | "cnpj" | "cep">("");
  // "Já existe?" (sql/59): enquanto se digita, procura o mesmo CNPJ/CPF em qualquer
  // empresa do grupo e nomes parecidos — para abrir o existente em vez de duplicar.
  const [cands, setCands] = useState<Candidato[]>([]);
  const [bloqueio, setBloqueio] = useState<Candidato[] | null>(null);
  const [forcar, setForcar] = useState<{ on: boolean; motivo: string }>({ on: false, motivo: "" });
  const chaveBusca = f ? `${f.doc.replace(/\D/g, "")}|${f.razao.trim()}|${f.cidade.trim()}|${f.empresa}` : "";
  useEffect(() => {
    if (!f) return;
    const d = f.doc.replace(/\D/g, ""), r = f.razao.trim();
    if ((d.length !== 11 && d.length !== 14) && r.length < 4) { setCands([]); return; }
    const t = setTimeout(async () => {
      const qs = new URLSearchParams({ razao: r, doc: d.length === 11 || d.length === 14 ? d : "", cidade: f.cidade, telefone: f.telefone, email: f.email, empresa: f.empresa });
      if (editando && id != null) qs.set("excluir", String(id));
      try { setCands((await pedir<{ candidatos: Candidato[] }>(`/api/cadastros/candidatos?${qs}`)).candidatos); } catch { setCands([]); }
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveBusca]);

  useEffect(() => {
    if (!editando) return;
    (async () => {
      try {
        const r = await pedir<{ pessoa: Pessoa }>(`/api/cadastros/${id}`);
        const p = r.pessoa;
        setOrig(p);
        setF({
          empresa: p.empresa, cliente: p.cliente, fornecedor: p.fornecedor, transportadora: p.transportadora,
          doc: p.doc ?? "", razao: p.razao, fantasia: p.fantasia ?? "", ie: p.ie ?? "", im: p.im ?? "",
          simples: p.simples == null ? "" : p.simples ? "sim" : "nao",
          cep: p.cep ?? "", logradouro: p.logradouro ?? "", numero: p.numero ?? "", complemento: p.complemento ?? "",
          bairro: p.bairro ?? "", cidade: p.cidade ?? "", uf: p.uf ?? "", ibge: p.ibge ?? "",
          telefone: p.telefone ?? "", telefone2: p.telefone2 ?? "", email: p.email ?? "", emailCobranca: p.emailCobranca ?? "",
          emailNfe: p.emailNfe ?? "", contato: p.contato ?? "", contatos: Array.isArray(p.contatos) ? p.contatos : [], obs: p.obs ?? "", ativo: p.ativo,
        });
      } catch (e) { setErro((e as Error).message); }
    })();
  }, [editando, id]);

  if (!f) return <div className="est">{erro ? <div className="aviso t-crit">{erro}</div> : <div className="cartao vazio">Carregando…</div>}</div>;

  const set = (p: Partial<Form>) => setF({ ...f, ...p });
  const campo = (k: keyof Form) => ({
    value: String(f[k] ?? ""),
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => set({ [k]: e.target.value } as Partial<Form>),
  });

  const docDig = f.doc.replace(/\D/g, "");
  const erros: string[] = [];
  if (!f.razao.trim()) erros.push(docDig.length === 11 ? "Nome obrigatório" : "Razão social obrigatória");
  if (!(f.cliente || f.fornecedor || f.transportadora)) erros.push("Marque cliente, fornecedor ou transportadora");
  if (docDig && !docValido(docDig)) erros.push(docDig.length === 11 ? "CPF inválido" : docDig.length === 14 ? "CNPJ inválido" : "CNPJ (14) ou CPF (11 dígitos)");
  if (!docDig && !editando) erros.push("Informe o CNPJ ou CPF");
  const mesmoDocAqui = cands.find((c) => c.forte && c.empresa === f.empresa && c.doc && c.doc.replace(/\D/g, "") === docDig);
  if (mesmoDocAqui && (!editando || mesmoDocAqui.id !== id)) erros.push(`Este CNPJ/CPF já está cadastrado em ${f.empresa} (código ${mesmoDocAqui.codigo}) — abra o existente`);
  const mesmoDocOutra = !mesmoDocAqui ? cands.find((c) => c.forte && c.doc && c.doc.replace(/\D/g, "") === docDig && c.empresa !== f.empresa) : undefined;
  for (const [k, l] of [["email", "E-mail"], ["emailCobranca", "E-mail de cobrança"], ["emailNfe", "E-mail para NF-e"]] as const) {
    if (!emailOk(f[k])) erros.push(`${l} inválido`);
  }

  const buscarCnpj = async () => {
    setConsultando("cnpj"); setAviso(null); setErro(null);
    try {
      const d = await pedir<Record<string, string | boolean | null>>(`/api/cadastros/consulta?cnpj=${docDig}`);
      setF((x) => x && ({
        ...x,
        razao: x.razao || String(d.razao ?? ""), fantasia: x.fantasia || String(d.fantasia ?? ""),
        cep: String(d.cep ?? x.cep), logradouro: String(d.logradouro ?? x.logradouro), numero: String(d.numero ?? x.numero),
        complemento: String(d.complemento ?? x.complemento), bairro: String(d.bairro ?? x.bairro), cidade: String(d.cidade ?? x.cidade),
        uf: String(d.uf ?? x.uf), ibge: String(d.ibge ?? x.ibge), telefone: x.telefone || String(d.telefone ?? ""),
        email: x.email || String(d.email ?? ""), simples: d.simples == null ? x.simples : d.simples ? "sim" : "nao",
      }));
      setAviso(`Dados da Receita preenchidos${d.situacao ? ` · situação: ${d.situacao}` : ""}. Confira antes de salvar.`);
    } catch (e) { setErro((e as Error).message); } finally { setConsultando(""); }
  };
  const buscarCep = async () => {
    setConsultando("cep"); setErro(null);
    try {
      const d = await pedir<Record<string, string>>(`/api/cadastros/consulta?cep=${f.cep.replace(/\D/g, "")}`);
      setF((x) => x && ({ ...x, logradouro: d.logradouro || x.logradouro, bairro: d.bairro || x.bairro, cidade: d.cidade || x.cidade, uf: d.uf || x.uf, ibge: d.ibge || x.ibge }));
    } catch (e) { setErro((e as Error).message); } finally { setConsultando(""); }
  };

  const salvar = async () => {
    setIndo(true); setErro(null);
    try {
      const body = { ...f, pf: docDig.length === 11, simples: f.simples === "" ? null : f.simples === "sim",
        contatos: f.contatos.filter((c) => Object.values(c).some((v) => String(v ?? "").trim())),
        ...(forcar.on ? { forcar: true, forcarMotivo: forcar.motivo } : {}) };
      const p = await pedir<Pessoa>(editando ? `/api/cadastros/${id}` : "/api/cadastros", { method: editando ? "PUT" : "POST", body: JSON.stringify(body) });
      router.push(`/cadastros/${p.id}?salvo=1`);
    } catch (e) {
      setErro((e as Error).message); setIndo(false);
      if (e instanceof ErroPedido && e.candidatos) setBloqueio(e.candidatos);
    }
  };

  const papel: Papel = f.cliente && !f.fornecedor ? "cliente" : "fornecedor";
  const setContato = (i: number, p: Partial<Contato>) => set({ contatos: f.contatos.map((c, j) => (j === i ? { ...c, ...p } : c)) });

  return (
    <div className="est">
      <div className="crumbs">
        <button className="link" onClick={() => router.push(editando ? `/cadastros/${id}` : `/cadastros/${papel === "cliente" ? "clientes" : "fornecedores"}`)}>
          ‹ {editando ? "Ficha" : papel === "cliente" ? "Clientes" : "Fornecedores"}</button>
        <span>/</span><span>{editando ? "Editar cadastro" : "Novo cadastro"}</span>
      </div>
      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="area">Cadastros</div>
          <h1>{editando ? orig?.razao ?? "Editar" : `Novo ${f.cliente && !f.fornecedor ? "cliente" : f.fornecedor && !f.cliente ? "fornecedor" : "cadastro"}`}</h1>
          <div className="sub">
            {editando ? `Código ${orig?.codigo} · ${orig?.origem === "omie" ? `veio do Omie (${orig?.codigoOmie}) — editar aqui não altera o Omie e o painel passa a mandar neste cadastro` : "cadastrado no painel"}`
              : "Fica só no painel — não é criado no Omie."}
          </div>
        </div>
      </header>

      <div className="cartao" style={{ padding: "16px 18px", display: "grid", gap: 14 }}>
        <div className="form-grid">
          {!editando && (
            <label className="f s3">Empresa
              <select className="inp" {...campo("empresa")}>{EMPRESAS.map((e) => <option key={e}>{e}</option>)}</select>
            </label>
          )}
          <div className={`f ${editando ? "s12" : "s9"}`} style={{ display: "flex", gap: 16, alignItems: "flex-end", flexWrap: "wrap", gridColumn: editando ? "span 12" : "span 9" }}>
            {(["cliente", "fornecedor", "transportadora"] as const).map((k) => (
              <label key={k} className="check"><input type="checkbox" checked={f[k]} onChange={(e) => set({ [k]: e.target.checked } as Partial<Form>)} />
                {k === "cliente" ? "Cliente" : k === "fornecedor" ? "Fornecedor" : "Transportadora"}</label>
            ))}
            <label className="check" style={{ marginLeft: "auto" }}><input type="checkbox" checked={f.ativo} onChange={(e) => set({ ativo: e.target.checked })} /> Ativo</label>
          </div>

          <label className="f s4">CNPJ / CPF {!editando && <span style={{ color: "var(--ww-crit-text)" }}>*</span>}
            <span style={{ display: "flex", gap: 6 }}>
              <input className="inp mono" value={f.doc} onChange={(e) => set({ doc: mascaraDoc(e.target.value) })} placeholder="00.000.000/0000-00" />
              {docDig.length === 14 && docValido(docDig) && (
                <button type="button" className="btn sm" style={{ height: 36 }} disabled={consultando !== ""} onClick={buscarCnpj}>
                  {consultando === "cnpj" ? "Buscando…" : "Buscar na Receita"}</button>
              )}
            </span>
          </label>
          <label className="f s8">{docDig.length === 11 ? "Nome completo" : "Razão social"} *<input className="inp" {...campo("razao")} maxLength={160} /></label>
          <label className="f s6">Nome fantasia<input className="inp" {...campo("fantasia")} maxLength={120} /></label>
          <label className="f s2">Inscrição estadual<input className="inp mono" {...campo("ie")} placeholder="ISENTO" /></label>
          <label className="f s2">Inscrição municipal<input className="inp mono" {...campo("im")} /></label>
          <label className="f s2">Simples Nacional
            <select className="inp" {...campo("simples")}><option value="">—</option><option value="sim">Sim</option><option value="nao">Não</option></select>
          </label>

          <label className="f s2">CEP
            <span style={{ display: "flex", gap: 6 }}>
              <input className="inp mono" value={f.cep} onChange={(e) => set({ cep: e.target.value.replace(/[^\d-]/g, "").slice(0, 9) })}
                onBlur={() => { if (f.cep.replace(/\D/g, "").length === 8 && !f.logradouro) buscarCep(); }} />
            </span>
          </label>
          <label className="f s6">Logradouro<input className="inp" {...campo("logradouro")} /></label>
          <label className="f s2">Número<input className="inp" {...campo("numero")} /></label>
          <label className="f s2">Complemento<input className="inp" {...campo("complemento")} /></label>
          <label className="f s4">Bairro<input className="inp" {...campo("bairro")} /></label>
          <label className="f s4">Cidade<input className="inp" {...campo("cidade")} /></label>
          <label className="f s2">UF<select className="inp" {...campo("uf")}><option value="" />{UFS.map((u) => <option key={u}>{u}</option>)}</select></label>
          <label className="f s2">Cód. IBGE<input className="inp mono" {...campo("ibge")} /></label>

          <label className="f s3">Telefone<input className="inp" {...campo("telefone")} placeholder="11 99999-0000" /></label>
          <label className="f s3">Telefone 2<input className="inp" {...campo("telefone2")} /></label>
          <label className="f s6">Contato principal<input className="inp" {...campo("contato")} /></label>
          <label className="f s4">E-mail<input className="inp" type="email" {...campo("email")} /></label>
          <label className="f s4">E-mail de cobrança<input className="inp" type="email" {...campo("emailCobranca")} placeholder="Recebe boletos e cobranças" /></label>
          <label className="f s4">E-mail para NF-e<input className="inp" type="email" {...campo("emailNfe")} placeholder="Recebe o XML/DANFE" /></label>

          <div className="f s12" style={{ display: "grid", gap: 8, gridColumn: "span 12" }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ww-text-2)" }}>Outros contatos</span>
            {f.contatos.map((c, i) => (
              <div key={i} className="form-grid">
                <input className="inp s3" placeholder="Nome" value={c.nome ?? ""} onChange={(e) => setContato(i, { nome: e.target.value })} />
                <input className="inp s3" placeholder="Cargo / área" value={c.cargo ?? ""} onChange={(e) => setContato(i, { cargo: e.target.value })} />
                <input className="inp s3" placeholder="E-mail" value={c.email ?? ""} onChange={(e) => setContato(i, { email: e.target.value })} />
                <span className="s3" style={{ display: "flex", gap: 6 }}>
                  <input className="inp" placeholder="Telefone" value={c.telefone ?? ""} onChange={(e) => setContato(i, { telefone: e.target.value })} />
                  <button type="button" className="btn sm" style={{ height: 36 }} onClick={() => set({ contatos: f.contatos.filter((_, j) => j !== i) })} title="Remover">✕</button>
                </span>
              </div>
            ))}
            <div><button type="button" className="link" onClick={() => set({ contatos: [...f.contatos, {}] })}>+ adicionar contato</button></div>
          </div>
          <label className="f s12">Observações<textarea className="inp" {...campo("obs")} /></label>
        </div>

        {bloqueio && bloqueio.length > 0 ? (
          <ListaCandidatos itens={bloqueio} titulo="Já existe — use o cadastro existente em vez de criar outro" onAbrir={(c) => router.push(`/cadastros/${c.id}`)} />
        ) : cands.length > 0 && (
          <ListaCandidatos itens={cands.slice(0, 5)}
            titulo={mesmoDocOutra ? `Esta empresa já existe em ${mesmoDocOutra.empresa} — ao cadastrar em ${f.empresa}, fica ligada à mesma pessoa (dados partilhados)` : "Cadastros parecidos que já existem"}
            onAbrir={(c) => router.push(`/cadastros/${c.id}`)} />
        )}
        {bloqueio && !editando && (
          <div className="aviso t-off" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <label className="check"><input type="checkbox" checked={forcar.on} onChange={(e) => setForcar({ ...forcar, on: e.target.checked })} />
              Não é a mesma pessoa — criar mesmo assim (só administrador)</label>
            {forcar.on && <input className="inp" style={{ flex: 1, minWidth: 220 }} placeholder="Motivo (fica no histórico)" value={forcar.motivo}
              onChange={(e) => setForcar({ ...forcar, motivo: e.target.value })} />}
          </div>
        )}
        {aviso && <div className="aviso t-info">{aviso}</div>}
        {erros.length > 0 && <div className="aviso t-warn">{erros.join(" · ")}</div>}
        {erro && <div className="aviso t-crit">{erro}</div>}

        <div className="filtros" style={{ justifyContent: "flex-end" }}>
          <span className="mini" style={{ marginRight: "auto" }}>Fica só no painel. Nada é enviado ao Omie.</span>
          <button className="btn" onClick={() => router.back()}>Cancelar</button>
          <button className="btn pri" disabled={indo || erros.length > 0 || (forcar.on && !forcar.motivo.trim())} onClick={salvar}>{indo ? "Salvando…" : editando ? "Salvar cadastro" : "Cadastrar"}</button>
        </div>
      </div>
    </div>
  );
}

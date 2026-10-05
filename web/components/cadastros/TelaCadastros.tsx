"use client";

/**
 * Cadastros › Clientes / Fornecedores (05/10/26) — lista com busca.
 * O cadastro vive no painel (cadastros.pessoas). Os registos do Omie entraram
 * como histórico; os novos nascem aqui e não vão ao Omie.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { EMPRESAS, Origem, Papeis, Pill, pedir, ddmmaa, type Linha, type Papel } from "./comum";

type Resp = { total: number; nativos: number; linhas: Linha[]; podeEditar: boolean };

export default function TelaCadastros({ papel }: { papel: Papel }) {
  const router = useRouter();
  const [emp, setEmp] = useState("SF");
  const [busca, setBusca] = useState("");
  const [todos, setTodos] = useState(false);
  const [dados, setDados] = useState<Resp | null>(null);
  const [mais, setMais] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const seq = useRef(0);
  const nome = papel === "cliente" ? "Clientes" : "Fornecedores";

  useEffect(() => {
    try { const e = localStorage.getItem("cad-emp"); if (e && (EMPRESAS as readonly string[]).includes(e)) setEmp(e); } catch {}
  }, []);

  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      try {
        const r = await pedir<Resp>(`/api/cadastros?papel=${papel}&emp=${emp}&q=${encodeURIComponent(busca)}${todos ? "&todos=1" : ""}`);
        if (n === seq.current) { setDados(r); setErro(null); }
      } catch (e) { if (n === seq.current) setErro((e as Error).message); }
    }, busca ? 250 : 0);
    return () => clearTimeout(t);
  }, [papel, emp, busca, todos]);

  const carregarMais = async () => {
    if (!dados) return;
    setMais(true);
    try {
      const r = await pedir<Resp>(`/api/cadastros?papel=${papel}&emp=${emp}&q=${encodeURIComponent(busca)}${todos ? "&todos=1" : ""}&off=${dados.linhas.length}`);
      setDados({ ...dados, linhas: [...dados.linhas, ...r.linhas] });
    } catch (e) { setErro((e as Error).message); } finally { setMais(false); }
  };

  const trocarEmp = (e: string) => { setEmp(e); try { localStorage.setItem("cad-emp", e); } catch {} };

  return (
    <div className="est">
      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="area">Cadastros</div>
          <h1>{nome}</h1>
          <div className="sub">
            {dados ? `${dados.total.toLocaleString("pt-BR")} ${nome.toLowerCase()} · ${dados.nativos} cadastrados no painel` : "Carregando…"}
            {" · o cadastro agora vive no painel; o do Omie ficou como histórico"}
          </div>
        </div>
        {dados?.podeEditar && (
          <button className="btn pri" onClick={() => router.push(`/cadastros/novo?papel=${papel}&emp=${emp}`)}>
            + Novo {papel === "cliente" ? "cliente" : "fornecedor"}
          </button>
        )}
      </header>

      <div className="filtros">
        <div className="seg">
          {EMPRESAS.map((e) => <button key={e} className={emp === e ? "on" : ""} onClick={() => trocarEmp(e)}>{e}</button>)}
        </div>
        <button className={`chip${todos ? " on" : ""}`} onClick={() => setTodos((v) => !v)}>Incluir inativos</button>
        <span className="sp" />
        <input className="inp" style={{ width: 320 }} value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Nome, fantasia, CNPJ/CPF, cidade ou código" autoFocus />
      </div>

      {erro && <div className="aviso t-crit">{erro}</div>}

      <div className="cartao" style={{ overflowX: "auto" }}>
        <table className="tabela">
          <thead>
            <tr><th>Nome</th><th>CNPJ / CPF</th><th>Cidade</th><th>Contato</th><th>Papel</th><th>Origem</th><th>Situação</th></tr>
          </thead>
          <tbody>
            {!dados && <tr><td colSpan={7} className="vazio">Carregando…</td></tr>}
            {dados && dados.linhas.length === 0 && (
              <tr><td colSpan={7} className="vazio">Nada encontrado{busca ? ` para “${busca}”` : ""}.
                {dados.podeEditar && <> <button className="link" onClick={() => router.push(`/cadastros/novo?papel=${papel}&emp=${emp}${/\d{11,}/.test(busca.replace(/\D/g, "")) ? `&doc=${encodeURIComponent(busca)}` : busca ? `&razao=${encodeURIComponent(busca)}` : ""}`)}>Cadastrar</button></>}
              </td></tr>
            )}
            {dados?.linhas.map((l) => (
              <tr key={l.id} className="click" onClick={() => router.push(`/cadastros/${l.id}`)}>
                <td>
                  <div className="prod" style={{ minWidth: 280 }}>
                    <div>
                      <div className="n">{l.razao}</div>
                      <div className="c">{l.fantasia && l.fantasia !== l.razao ? `${l.fantasia} · ` : ""}cód. {l.codigo}</div>
                    </div>
                  </div>
                </td>
                <td className="mono" style={{ whiteSpace: "nowrap" }}>{l.doc ?? <span className="mini">—</span>}</td>
                <td style={{ whiteSpace: "nowrap" }}>{l.cidade ? `${l.cidade}${l.uf ? `/${l.uf}` : ""}` : <span className="mini">—</span>}</td>
                <td><div style={{ fontSize: 12.5 }}>{l.email ?? ""}</div><div className="mini">{l.telefone ?? ""}</div></td>
                <td><Papeis p={l} /></td>
                <td><Origem o={l.origem} />{l.origem === "painel" && <div className="mini">{ddmmaa(l.criadoEm)}</div>}</td>
                <td>{l.ativo ? <Pill t="Ativo" tom="ok" /> : <Pill t="Inativo" tom="off" />}</td>
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
    </div>
  );
}

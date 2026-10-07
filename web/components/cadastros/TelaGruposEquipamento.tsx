"use client";

/**
 * Grupos de equipamento (07/10/26, sql/100). Nomes padrão dos grupos da lista de
 * materiais do projeto ("Filtro Multimeios", "Osmose Reversa", "Geral"…): a lista
 * continua aceitando texto livre, mas sugere o nome daqui e avisa quando o nome
 * livre é quase igual a um padrão ("Filtro Muiltimeios" → "Filtro Multimeios").
 */
import { useEffect, useState } from "react";
import "../navy/estoque/estoque.css";

type G = { id: number; nome: string; descricao: string | null; ativo: boolean };
type Uso = { nome: string; projetos: number };

export default function TelaGruposEquipamento() {
  const [lista, setLista] = useState<G[]>([]);
  const [uso, setUso] = useState<Uso[]>([]);
  const [pode, setPode] = useState(false);
  const [pendente, setPendente] = useState(false);
  const [novo, setNovo] = useState({ nome: "", descricao: "" });
  const [edit, setEdit] = useState<G | null>(null);
  const [erro, setErro] = useState("");
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    const r = await fetch("/api/cadastros/grupos-equipamento", { cache: "no-store" }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setCarregando(false);
    if (!r) { setErro("Não consegui carregar os grupos — tente de novo"); return; }
    if (!r.ok) { setErro(j.error ?? "Erro"); return; }
    setLista(j.grupos ?? []); setUso(j.emUso ?? []); setPode(!!j.podeEditar); setPendente(!!j.pendente);
  }
  useEffect(() => { void carregar(); }, []);

  async function post(b: Record<string, unknown>) {
    setErro("");
    const r = await fetch("/api/cadastros/grupos-equipamento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? "Erro"); return false; }
    await carregar();
    return true;
  }
  const norm = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const cadastrados = new Set(lista.map((g) => norm(g.nome)));
  const soNasListas = uso.filter((u) => !cadastrados.has(norm(u.nome)));

  return (
    <div className="est" style={{ maxWidth: 980 }}>
      <div className="crumbs">Cadastros › Geral</div>
      <h1>Grupos de equipamento</h1>
      <p className="mini" style={{ marginBottom: 14 }}>
        Nomes padrão dos grupos da lista de materiais do projeto (vêm da coluna Equipamento da CP). A lista aceita texto livre,
        mas sugere estes nomes e avisa quando um nome é quase igual a um padrão — assim o mesmo equipamento tem o mesmo nome em todos os projetos.
      </p>
      {pendente && (
        <div className="aviso t-crit" style={{ marginBottom: 12 }}>
          O cadastro ainda não foi criado no banco (migração <b>sql/100_grupos_equipamento.sql</b> pendente). Enquanto isso, a lista de
          materiais sugere os nomes já usados nos projetos, abaixo.
        </div>
      )}
      {erro && <div className="aviso t-crit">{erro}</div>}
      {!pendente && (
        <div className="cartao" style={{ padding: 0, overflow: "hidden" }}>
          <table className="tabela">
            <thead><tr><th>Grupo</th><th>Descrição</th><th>Ativo</th><th /></tr></thead>
            <tbody>
              {lista.map((g) => edit?.id === g.id ? (
                <tr key={g.id}>
                  <td><input className="inp" value={edit.nome} onChange={(e) => setEdit({ ...edit, nome: e.target.value })} /></td>
                  <td><input className="inp" style={{ width: "100%" }} value={edit.descricao ?? ""} onChange={(e) => setEdit({ ...edit, descricao: e.target.value })} /></td>
                  <td><input type="checkbox" checked={edit.ativo} onChange={(e) => setEdit({ ...edit, ativo: e.target.checked })} /></td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="btn sm pri" onClick={() => void post(edit).then((ok) => ok && setEdit(null))}>Salvar</button>{" "}
                    <button className="btn sm" onClick={() => setEdit(null)}>Cancelar</button>
                  </td>
                </tr>
              ) : (
                <tr key={g.id} style={{ opacity: g.ativo ? 1 : 0.55 }}>
                  <td><b>{g.nome}</b></td><td className="mini">{g.descricao ?? "—"}</td><td>{g.ativo ? "sim" : "não"}</td>
                  <td>{pode && <button className="btn sm" onClick={() => setEdit(g)}>Editar</button>}</td>
                </tr>
              ))}
              {!lista.length && <tr><td colSpan={4} className="mini">{carregando ? "Carregando os grupos…" : "Nenhum grupo cadastrado."}</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {pode && !pendente && (
        <div className="filtros" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <input className="inp" placeholder="Nome do grupo (ex.: Osmose Reversa)" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          <input className="inp" placeholder="Descrição (opcional)" value={novo.descricao} onChange={(e) => setNovo({ ...novo, descricao: e.target.value })} />
          <button className="btn pri" disabled={novo.nome.trim().length < 2}
            onClick={() => void post({ nome: novo.nome, descricao: novo.descricao }).then((ok) => ok && setNovo({ nome: "", descricao: "" }))}>Adicionar</button>
        </div>
      )}
      {soNasListas.length > 0 && (
        <>
          <h2 style={{ marginTop: 22, fontSize: 14 }}>Nomes usados nas listas{pendente ? "" : " e ainda fora do cadastro"}</h2>
          <p className="mini" style={{ marginBottom: 8 }}>Quantos projetos usam cada nome. {pode && !pendente ? "“Cadastrar” transforma o nome em padrão." : ""}</p>
          <div className="cartao" style={{ padding: 0, overflow: "hidden" }}>
            <table className="tabela">
              <thead><tr><th>Nome</th><th>Projetos</th><th /></tr></thead>
              <tbody>{soNasListas.slice(0, 60).map((u) => (
                <tr key={u.nome}><td>{u.nome}</td><td className="mono">{u.projetos}</td>
                  <td>{pode && !pendente && <button className="btn sm" onClick={() => void post({ nome: u.nome })}>Cadastrar</button>}</td></tr>))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

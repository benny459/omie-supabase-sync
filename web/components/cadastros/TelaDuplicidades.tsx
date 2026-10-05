"use client";

/**
 * Cadastros › Duplicidades (05/10/26, sql/59).
 * Nada é mesclado sozinho: a lista mostra o que parece duplicado e o
 * administrador decide.
 *  - Mesma empresa  → Mesclar: escolhe o que fica; o outro sai de uso e o que o
 *    painel guardava com o código dele passa ao que fica (desfazível).
 *  - Empresas diferentes → Agrupar: são a mesma pessoa com papel em SF/CD/WW;
 *    os códigos ficam, só passam a ser uma pessoa só.
 *  - "Não é duplicado" tira o par da lista.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pill, ddmmaa, pedir } from "./comum";

type Membro = {
  id: number; empresa: string; codigo: number; origem: string; razao: string; fantasia: string | null; doc: string | null;
  cidade: string | null; uf: string | null; cliente: boolean; fornecedor: boolean; ativo: boolean; criadoEm: string;
};
type Grupo = { tipo: "nome_igual" | "outra_empresa" | "parecido"; chave: string; membros: Membro[] };
type Feita = { id: number; tipo: string; sobrevivente: number; absorvido: number; empresa: string; codigoAntigo: number | null;
  codigoNovo: number | null; razao: string; motivo: string; por: string; em: string; desfeitaEm: string | null };
type Resp = {
  resumo: { nomeIgual: number; outraEmpresa: number; parecido: number; entidadesMultiEmpresa: number; pessoas: number; entidades: number; mesclas: number };
  grupos: Grupo[]; feitas: Feita[]; admin: boolean;
};

const TITULO: Record<Grupo["tipo"], string> = {
  nome_igual: "Mesmo nome na mesma empresa",
  outra_empresa: "Mesmo nome em empresas diferentes",
  parecido: "Nome muito parecido",
};

export default function TelaDuplicidades() {
  const router = useRouter();
  const [d, setD] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<Grupo["tipo"] | "feitas">("nome_igual");
  const [fica, setFica] = useState<Record<string, number>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  const carregar = async () => {
    try { setD(await pedir<Resp>("/api/cadastros/duplicidades?lim=600")); setErro(null); } catch (e) { setErro((e as Error).message); }
  };
  useEffect(() => { carregar(); }, []);

  const grupos = useMemo(() => (d?.grupos ?? []).filter((g) => g.tipo === aba
    && (!busca.trim() || g.membros.some((m) => `${m.razao} ${m.fantasia ?? ""} ${m.doc ?? ""} ${m.codigo}`.toLowerCase().includes(busca.toLowerCase())))), [d, aba, busca]);

  const acao = async (chave: string, body: Record<string, unknown>, ok: string) => {
    setOcupado(chave); setErro(null); setAviso(null);
    try {
      const r = await pedir<{ ok?: number; erros?: string[] }>("/api/cadastros/duplicidades", { method: "POST", body: JSON.stringify(body) });
      setAviso(r.erros?.length ? `${ok} · ${r.erros.length} com erro: ${r.erros.slice(0, 3).join(" | ")}` : ok);
      await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  };

  const mesclar = (g: Grupo) => {
    const s = fica[g.chave] ?? g.membros[0].id;
    const outros = g.membros.filter((m) => m.id !== s);
    const motivo = window.prompt(`${g.tipo === "outra_empresa" ? "Agrupar" : "Mesclar"} ${outros.length} cadastro(s) em "${g.membros.find((m) => m.id === s)?.razao}". Motivo:`, "duplicado");
    if (!motivo?.trim()) return;
    acao(g.chave, { acao: "agrupar_lote", grupos: [[s, ...outros.map((m) => m.id)]], motivo }, g.tipo === "outra_empresa" ? "Agrupado" : "Mesclado");
  };

  const agruparTodos = () => {
    const lote = grupos.filter((g) => g.tipo === "outra_empresa").map((g) => g.membros.map((m) => m.id));
    if (!lote.length) return;
    if (!window.confirm(`Agrupar ${lote.length} grupos de empresas diferentes (mesmo nome, sem CNPJ/CPF diferente)? Os códigos não mudam; cada grupo passa a ser uma pessoa só. Dá para desfazer um a um.`)) return;
    acao("lote", { acao: "agrupar_lote", grupos: lote, motivo: "mesmo nome em empresas diferentes (lote)" }, `${lote.length} grupos agrupados`);
  };

  if (!d) return <div className="est">{erro ? <div className="aviso t-crit">{erro}</div> : <div className="cartao vazio">Procurando duplicados…</div>}</div>;
  const r = d.resumo;

  return (
    <div className="est">
      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="area">Cadastros</div>
          <h1>Duplicidades</h1>
          <div className="sub">
            {r.pessoas.toLocaleString("pt-BR")} cadastros = {r.entidades.toLocaleString("pt-BR")} pessoas · {r.entidadesMultiEmpresa.toLocaleString("pt-BR")} pessoas
            com cadastro em mais de uma empresa (mesmo CNPJ/CPF — já são uma só) · nada é mesclado sozinho
          </div>
        </div>
      </header>

      <div className="filtros">
        {(["nome_igual", "outra_empresa", "parecido"] as const).map((t) => (
          <button key={t} className={`btn sm ${aba === t ? "pri" : ""}`} onClick={() => setAba(t)}>
            {TITULO[t]} · {t === "nome_igual" ? r.nomeIgual : t === "outra_empresa" ? r.outraEmpresa : r.parecido}
          </button>
        ))}
        <button className={`btn sm ${aba === "feitas" ? "pri" : ""}`} onClick={() => setAba("feitas")}>Mesclas feitas · {r.mesclas}</button>
        <input className="inp" style={{ marginLeft: "auto", width: 260 }} placeholder="Filtrar por nome, CNPJ ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {aviso && <div className="aviso t-ok">{aviso}</div>}
      {erro && <div className="aviso t-crit">{erro}</div>}

      {aba === "outra_empresa" && d.admin && grupos.length > 0 && (
        <div className="aviso t-info" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ flex: 1 }}>Mesmo nome em SF/CD/WW, sem CNPJ/CPF diferente a separá-los. Agrupar não muda códigos — só passam a ser uma pessoa só.</span>
          <button className="btn sm pri" disabled={ocupado !== null} onClick={agruparTodos}>{ocupado === "lote" ? "Agrupando…" : `Agrupar todos (${grupos.length})`}</button>
        </div>
      )}

      {aba === "feitas" ? (
        <div className="cartao" style={{ padding: 0 }}>
          <table className="tabela">
            <thead><tr><th>Quando</th><th>Tipo</th><th>Ficou</th><th>Saiu</th><th>Motivo</th><th>Por</th><th /></tr></thead>
            <tbody>
              {d.feitas.length === 0 && <tr><td colSpan={7} className="vazio">Nenhuma mescla ainda.</td></tr>}
              {d.feitas.map((m) => (
                <tr key={m.id} style={m.desfeitaEm ? { opacity: 0.5 } : undefined}>
                  <td>{ddmmaa(m.em)}</td>
                  <td><Pill t={m.tipo === "agrupar" ? "Agrupado" : "Mesclado"} tom={m.tipo === "agrupar" ? "info" : "violet"} /></td>
                  <td><button className="link" onClick={() => router.push(`/cadastros/${m.sobrevivente}`)}>{m.razao}</button>{m.codigoNovo ? <span className="mini"> · {m.codigoNovo}</span> : null}</td>
                  <td><button className="link" onClick={() => router.push(`/cadastros/${m.absorvido}`)}>#{m.absorvido}</button>{m.codigoAntigo ? <span className="mini"> · {m.codigoAntigo}</span> : null}</td>
                  <td>{m.motivo}</td><td className="mini">{m.por}</td>
                  <td>{m.desfeitaEm ? <span className="mini">desfeita {ddmmaa(m.desfeitaEm)}</span>
                    : d.admin && <button className="btn sm" disabled={ocupado !== null} onClick={() => acao(`d${m.id}`, { acao: "desfazer", id: m.id }, "Mescla desfeita")}>Desfazer</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {grupos.length === 0 && <div className="cartao vazio">Nada aqui.</div>}
          {grupos.slice(0, 200).map((g) => {
            const s = fica[g.chave] ?? g.membros[0].id;
            return (
              <div key={g.chave} className="cartao" style={{ padding: "10px 14px", display: "grid", gap: 6 }}>
                {g.membros.map((m) => (
                  <label key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", cursor: "pointer" }}>
                    <input type="radio" name={g.chave} checked={s === m.id} onChange={() => setFica({ ...fica, [g.chave]: m.id })} title="Este fica" />
                    <span style={{ flex: 1, minWidth: 240 }}>
                      <button type="button" className="link" onClick={(e) => { e.preventDefault(); router.push(`/cadastros/${m.id}`); }}><b>{m.razao}</b></button>
                      {m.fantasia && m.fantasia !== m.razao ? <span className="mini"> · {m.fantasia}</span> : null}
                      <span className="mini"> · {m.empresa} · cód. {m.codigo}{m.doc ? ` · ${m.doc}` : " · sem CNPJ/CPF"}{m.cidade ? ` · ${m.cidade}` : ""} · {m.origem}</span>
                    </span>
                    {s === m.id && <Pill t="fica" tom="ok" />}
                    {!m.ativo && <Pill t="inativo" tom="off" />}
                  </label>
                ))}
                <div className="filtros" style={{ justifyContent: "flex-end" }}>
                  <button className="btn sm" disabled={ocupado !== null} onClick={() => acao(g.chave, { acao: "ignorar", ids: g.membros.map((m) => m.id) }, "Marcado como não duplicado")}>Não é duplicado</button>
                  {d.admin && <button className="btn sm pri" disabled={ocupado !== null} onClick={() => mesclar(g)}>
                    {ocupado === g.chave ? "…" : g.tipo === "outra_empresa" ? "Agrupar (mesma pessoa)" : "Mesclar no marcado"}</button>}
                </div>
              </div>
            );
          })}
          {grupos.length > 200 && <div className="mini">Mostrando 200 de {grupos.length} — use o filtro.</div>}
        </div>
      )}
    </div>
  );
}

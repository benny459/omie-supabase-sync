"use client";

/**
 * Cadastros › Duplicidades (05/10/26, sql/59 + sql/61).
 * Os grupos vêm pré-calculados (cron de hora a hora + "Recalcular") com um nível
 * de confiança, para o Benny só conferir os duvidosos:
 *  - Muito provável: nenhuma contra-prova e (contato/endereço em comum ou uma
 *    linha sem uso nenhum). "Mesclar todos os prováveis" corre num lote só,
 *    auditado e desfazível ("Desfazer este lote").
 *  - Duvidoso: o resto — decidir um a um.
 *  - Empresas diferentes → Agrupar (os códigos ficam, passam a ser uma pessoa só).
 *  - "Não é duplicado" tira o par da lista.
 * Nada é mesclado sozinho: quem clica é o administrador.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Pill, ddmmaa, pedir } from "./comum";

type Membro = {
  id: number; empresa: string; codigo: number; origem: string; razao: string; fantasia: string | null; doc: string | null;
  cidade: string | null; uf: string | null; cliente: boolean; fornecedor: boolean; ativo: boolean; criadoEm: string;
  uso: number; email: string | null; telefone: string | null; cep: string | null;
};
type Motivo = { t: string; tom: "ok" | "warn" | "bad" | "info" };
type Grupo = {
  tipo: "nome_igual" | "outra_empresa" | "parecido"; chave: string; nivel: "provavel" | "duvidoso" | null; score: number;
  motivos: Motivo[]; sobrevivente: number | null; membros: Membro[];
};
type Feita = { id: number; tipo: string; sobrevivente: number; absorvido: number; empresa: string; codigoAntigo: number | null;
  codigoNovo: number | null; razao: string; motivo: string; por: string; em: string; desfeitaEm: string | null; lote: string | null };
type Lote = { lote_id: string; motivo: string; por: string; em: string; grupos: number; mesclas: number; erros: unknown[];
  desfeito_em: string | null; desfeito_por: string | null };
type Ignorado = { a: number; b: number; por: string; em: string; razaoA: string; razaoB: string; empresa: string };
type Resp = {
  resumo: { provavel: number; duvidoso: number; nomeIgual: number; outraEmpresa: number; parecido: number; ignorados: number;
    entidadesMultiEmpresa: number; pessoas: number; entidades: number; mesclas: number; atualizadoEm: string | null };
  grupos: Grupo[]; feitas: Feita[]; lotes: Lote[]; ignorados: Ignorado[]; admin: boolean;
};
type Aba = "provavel" | "duvidoso" | "outra_empresa" | "ignorados" | "feitas";

const TOM: Record<Motivo["tom"], "ok" | "warn" | "crit" | "info"> = { ok: "ok", warn: "warn", bad: "crit", info: "info" };
const TIPO: Record<Grupo["tipo"], string> = { nome_igual: "mesmo nome", parecido: "nome parecido", outra_empresa: "empresas diferentes" };

export default function TelaDuplicidades() {
  const router = useRouter();
  const [d, setD] = useState<Resp | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [aba, setAba] = useState<Aba>("duvidoso");
  const [fica, setFica] = useState<Record<string, number>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [previa, setPrevia] = useState(false);
  const [motivoLote, setMotivoLote] = useState("duplicado do Omie (muito provável)");

  const carregar = async () => {
    try { setD(await pedir<Resp>("/api/cadastros/duplicidades")); setErro(null); } catch (e) { setErro((e as Error).message); }
  };
  useEffect(() => { carregar(); }, []);

  const casa = (g: Grupo) => !busca.trim() || g.membros.some((m) =>
    `${m.razao} ${m.fantasia ?? ""} ${m.doc ?? ""} ${m.codigo}`.toLowerCase().includes(busca.toLowerCase()));

  const grupos = useMemo(() => (d?.grupos ?? []).filter((g) =>
    (aba === "outra_empresa" ? g.tipo === "outra_empresa" : g.nivel === aba) && casa(g)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [d, aba, busca]);

  const acao = async (chave: string, body: Record<string, unknown>, ok: string | ((r: Record<string, unknown>) => string)) => {
    setOcupado(chave); setErro(null); setAviso(null);
    try {
      const r = await pedir<Record<string, unknown> & { erros?: unknown[] }>("/api/cadastros/duplicidades", { method: "POST", body: JSON.stringify(body) });
      const txt = typeof ok === "function" ? ok(r) : ok;
      const errs = Array.isArray(r.erros) ? r.erros : [];
      setAviso(errs.length ? `${txt} · ${errs.length} com erro` : txt);
      await carregar();
    } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); }
  };

  const ficaDe = (g: Grupo) => fica[g.chave] ?? g.sobrevivente ?? g.membros[0].id;

  const mesclar = (g: Grupo) => {
    const s = ficaDe(g);
    const outros = g.membros.filter((m) => m.id !== s);
    const motivo = window.prompt(`${g.tipo === "outra_empresa" ? "Agrupar" : "Mesclar"} ${outros.length} cadastro(s) em "${g.membros.find((m) => m.id === s)?.razao}". Motivo:`, "duplicado");
    if (!motivo?.trim()) return;
    acao(g.chave, { acao: "agrupar_lote", grupos: [[s, ...outros.map((m) => m.id)]], motivo }, g.tipo === "outra_empresa" ? "Agrupado" : "Mesclado");
  };

  const agruparTodos = () => {
    const lote = grupos.map((g) => g.membros.map((m) => m.id));
    if (!lote.length) return;
    if (!window.confirm(`Agrupar ${lote.length} grupos de empresas diferentes (mesmo nome, sem CNPJ/CPF diferente)? Os códigos não mudam; cada grupo passa a ser uma pessoa só. Dá para desfazer um a um.`)) return;
    acao("lote-agrupar", { acao: "agrupar_lote", grupos: lote, motivo: "mesmo nome em empresas diferentes (lote)" }, `${lote.length} grupos agrupados`);
  };

  const mesclarProvaveis = () => {
    if (!motivoLote.trim()) { setErro("Informe o motivo do lote"); return; }
    const chaves = busca.trim() ? grupos.map((g) => g.chave) : null;
    acao("lote-provaveis", { acao: "mesclar_provaveis", chaves, motivo: motivoLote },
      (r) => `Lote ${r.lote}: ${r.mesclas} cadastros mesclados em ${r.grupos} grupos — dá para desfazer em "Mesclas feitas"`)
      .then(() => setPrevia(false));
  };

  if (!d) return <div className="est">{erro ? <div className="aviso t-crit">{erro}</div> : <div className="cartao vazio">Carregando duplicidades…</div>}</div>;
  const r = d.resumo;
  const nomeDe = (g: Grupo, id: number) => g.membros.find((m) => m.id === id);

  const ABAS: [Aba, string, number][] = [
    ["provavel", "Muito provável", r.provavel],
    ["duvidoso", "Duvidoso", r.duvidoso],
    ["outra_empresa", "Empresas diferentes", r.outraEmpresa],
    ["ignorados", "Não é duplicado", r.ignorados],
    ["feitas", "Mesclas feitas", r.mesclas],
  ];

  return (
    <div className="est">
      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 240 }}>
          <div className="area">Cadastros</div>
          <h1>Duplicidades</h1>
          <div className="sub">
            {r.pessoas.toLocaleString("pt-BR")} cadastros = {r.entidades.toLocaleString("pt-BR")} pessoas · {r.entidadesMultiEmpresa.toLocaleString("pt-BR")} pessoas
            com cadastro em mais de uma empresa · nada é mesclado sozinho
            {r.atualizadoEm ? <> · lista de {ddmmaa(r.atualizadoEm)} {new Date(r.atualizadoEm).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</> : null}
          </div>
        </div>
        <button className="btn sm" disabled={ocupado !== null} onClick={() => acao("recalc", { acao: "recalcular" }, "Lista recalculada")}>
          {ocupado === "recalc" ? "Recalculando…" : "Recalcular"}
        </button>
      </header>

      <div className="filtros">
        {ABAS.map(([k, t, n]) => (
          <button key={k} className={`btn sm ${aba === k ? "pri" : ""}`} onClick={() => { setAba(k); setPrevia(false); }}>{t} · {n}</button>
        ))}
        <input className="inp" style={{ marginLeft: "auto", width: 260 }} placeholder="Filtrar por nome, CNPJ ou código" value={busca} onChange={(e) => setBusca(e.target.value)} />
      </div>

      {aviso && <div className="aviso t-ok">{aviso}</div>}
      {erro && <div className="aviso t-crit">{erro}</div>}

      {aba === "provavel" && (
        <div className="aviso t-info" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ flex: 1, minWidth: 260 }}>
              Sem contra-prova (CNPJ, cidade, UF ou IE diferentes) e com contato/endereço em comum ou um cadastro sem uso nenhum.
              Fica o mais usado (PCs, títulos, PV/OS); depois o que tem CNPJ/CPF; depois o mais antigo.
            </span>
            {d.admin && grupos.length > 0 && (
              <button className="btn sm pri" disabled={ocupado !== null} onClick={() => setPrevia((v) => !v)}>
                {previa ? "Fechar prévia" : `Mesclar todos os prováveis (${grupos.length})`}
              </button>
            )}
          </div>
          {previa && (
            <div className="cartao" style={{ padding: 10, display: "grid", gap: 8 }}>
              <b>Prévia do lote — {grupos.length} grupos, {grupos.reduce((s, g) => s + g.membros.length - 1, 0)} cadastros saem de uso</b>
              <div style={{ maxHeight: 260, overflow: "auto" }}>
                <table className="tabela">
                  <thead><tr><th>Fica</th><th>Uso</th><th>Sai</th><th>Provas</th></tr></thead>
                  <tbody>
                    {grupos.map((g) => {
                      const s = g.sobrevivente ?? g.membros[0].id;
                      const sm = nomeDe(g, s);
                      return (
                        <tr key={g.chave}>
                          <td>{sm?.razao} <span className="mini">· {sm?.empresa} · {sm?.codigo}{sm?.doc ? ` · ${sm.doc}` : ""}</span></td>
                          <td className="mini">{sm?.uso ?? 0}</td>
                          <td className="mini">{g.membros.filter((m) => m.id !== s).map((m) => `${m.codigo} (uso ${m.uso})`).join(", ")}</td>
                          <td className="mini">{g.motivos.filter((m) => m.tom === "ok").map((m) => m.t).join(", ")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span className="mini">Motivo do lote:</span>
                <input className="inp" style={{ flex: 1, minWidth: 220 }} value={motivoLote} onChange={(e) => setMotivoLote(e.target.value)} />
                <button className="btn sm pri" disabled={ocupado !== null} onClick={() => {
                  if (window.confirm(`Mesclar ${grupos.length} grupos agora? Fica tudo num lote só, que dá para desfazer inteiro em "Mesclas feitas".`)) mesclarProvaveis();
                }}>{ocupado === "lote-provaveis" ? "Mesclando…" : "Confirmar e mesclar"}</button>
              </div>
            </div>
          )}
        </div>
      )}

      {aba === "outra_empresa" && d.admin && grupos.length > 0 && (
        <div className="aviso t-info" style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span style={{ flex: 1 }}>Mesmo nome em SF/CD/WW, sem CNPJ/CPF diferente a separá-los. Agrupar não muda códigos — só passam a ser uma pessoa só.</span>
          <button className="btn sm pri" disabled={ocupado !== null} onClick={agruparTodos}>{ocupado === "lote-agrupar" ? "Agrupando…" : `Agrupar todos (${grupos.length})`}</button>
        </div>
      )}

      {aba === "feitas" ? (
        <div style={{ display: "grid", gap: 10 }}>
          {d.lotes.length > 0 && (
            <div className="cartao" style={{ padding: 0 }}>
              <table className="tabela">
                <thead><tr><th>Lote</th><th>Quando</th><th>Grupos</th><th>Mesclas</th><th>Motivo</th><th>Por</th><th /></tr></thead>
                <tbody>
                  {d.lotes.map((l) => (
                    <tr key={l.lote_id} style={l.desfeito_em ? { opacity: 0.5 } : undefined}>
                      <td className="mini">{l.lote_id}</td><td>{ddmmaa(l.em)}</td><td>{l.grupos}</td><td>{l.mesclas}</td>
                      <td>{l.motivo}</td><td className="mini">{l.por}</td>
                      <td>{l.desfeito_em ? <span className="mini">desfeito {ddmmaa(l.desfeito_em)}</span>
                        : d.admin && <button className="btn sm" disabled={ocupado !== null} onClick={() => {
                          if (window.confirm(`Desfazer o lote ${l.lote_id} inteiro (${l.mesclas} mesclas)?`)) acao(`l${l.lote_id}`, { acao: "desfazer_lote", lote: l.lote_id }, (x) => `Lote desfeito: ${x.desfeitas} mesclas`);
                        }}>{ocupado === `l${l.lote_id}` ? "Desfazendo…" : "Desfazer este lote"}</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="cartao" style={{ padding: 0 }}>
            <table className="tabela">
              <thead><tr><th>Quando</th><th>Tipo</th><th>Ficou</th><th>Saiu</th><th>Motivo</th><th>Por</th><th /></tr></thead>
              <tbody>
                {d.feitas.length === 0 && <tr><td colSpan={7} className="vazio">Nenhuma mescla ainda.</td></tr>}
                {d.feitas.map((m) => (
                  <tr key={m.id} style={m.desfeitaEm ? { opacity: 0.5 } : undefined}>
                    <td>{ddmmaa(m.em)}</td>
                    <td><Pill t={m.tipo === "agrupar" ? "Agrupado" : "Mesclado"} tom={m.tipo === "agrupar" ? "info" : "violet"} />{m.lote ? <span className="mini"> · lote</span> : null}</td>
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
        </div>
      ) : aba === "ignorados" ? (
        <div className="cartao" style={{ padding: 0 }}>
          <table className="tabela">
            <thead><tr><th>Empresa</th><th>Cadastro A</th><th>Cadastro B</th><th>Marcado por</th><th>Quando</th></tr></thead>
            <tbody>
              {d.ignorados.length === 0 && <tr><td colSpan={5} className="vazio">Nenhum par marcado como "não é duplicado".</td></tr>}
              {d.ignorados.map((i) => (
                <tr key={`${i.a}-${i.b}`}>
                  <td>{i.empresa}</td>
                  <td><button className="link" onClick={() => router.push(`/cadastros/${i.a}`)}>{i.razaoA}</button></td>
                  <td><button className="link" onClick={() => router.push(`/cadastros/${i.b}`)}>{i.razaoB}</button></td>
                  <td className="mini">{i.por}</td><td>{ddmmaa(i.em)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {grupos.length === 0 && <div className="cartao vazio">Nada aqui.</div>}
          {grupos.slice(0, 200).map((g) => {
            const s = ficaDe(g);
            return (
              <div key={g.chave} className="cartao" style={{ padding: "10px 14px", display: "grid", gap: 6 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  {g.nivel && <Pill t={g.nivel === "provavel" ? `Muito provável · ${g.score}` : `Duvidoso · ${g.score}`} tom={g.nivel === "provavel" ? "ok" : "warn"} />}
                  <span className="mini">{TIPO[g.tipo]}</span>
                  {g.motivos.filter((m) => !m.t.startsWith("nome ")).map((m) => <Pill key={m.t} t={m.t} tom={TOM[m.tom]} />)}
                </div>
                {g.membros.map((m) => (
                  <label key={m.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", cursor: "pointer" }}>
                    <input type="radio" name={g.chave} checked={s === m.id} onChange={() => setFica({ ...fica, [g.chave]: m.id })} title="Este fica" />
                    <span style={{ flex: 1, minWidth: 240 }}>
                      <button type="button" className="link" onClick={(e) => { e.preventDefault(); router.push(`/cadastros/${m.id}`); }}><b>{m.razao}</b></button>
                      {m.fantasia && m.fantasia !== m.razao ? <span className="mini"> · {m.fantasia}</span> : null}
                      <span className="mini"> · {m.empresa} · cód. {m.codigo}{m.doc ? ` · ${m.doc}` : " · sem CNPJ/CPF"}{m.cidade ? ` · ${m.cidade}` : ""}
                        {m.telefone ? ` · ${m.telefone}` : ""}{m.email ? ` · ${m.email}` : ""} · {m.origem}</span>
                    </span>
                    <span className="mini" title="PCs, títulos e PV/OS com este código">{m.uso > 0 ? `uso ${m.uso}` : "sem uso"}</span>
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

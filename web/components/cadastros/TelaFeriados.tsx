"use client";

/**
 * Feriados (05/10/26, sql/73). Fim de semana e feriado ATIVO não são dia útil:
 * a previsão de pagamento/recebimento de um título que vence num deles vai para
 * o próximo dia útil (como no Omie). Nacionais e o estadual de SP vêm ligados;
 * os municipais (São Paulo, Barueri) vêm desligados — ligue os que valem.
 */
import { useEffect, useState } from "react";
import "../navy/estoque/estoque.css";

type F = { data: string; nome: string; abrangencia: string; ativo: boolean };
const dbr = (iso: string) => new Date(iso + "T00:00:00").toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" });

export default function TelaFeriados() {
  const [ano, setAno] = useState(new Date().getFullYear());
  const [lista, setLista] = useState<F[]>([]);
  const [pode, setPode] = useState(false);
  const [novo, setNovo] = useState<F>({ data: "", nome: "", abrangencia: "nacional", ativo: true });
  const [erro, setErro] = useState("");

  async function carregar() {
    const r = await fetch(`/api/cadastros/feriados?ano=${ano}`, { cache: "no-store" });
    const j = await r.json();
    if (!r.ok) { setErro(j.error ?? "Erro"); return; }
    setLista(j.feriados ?? []); setPode(!!j.pode);
  }
  useEffect(() => { carregar(); }, [ano]); // eslint-disable-line react-hooks/exhaustive-deps

  async function post(b: Record<string, unknown>) {
    setErro("");
    const r = await fetch("/api/cadastros/feriados", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(b) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setErro(j.error ?? "Erro"); else await carregar();
  }

  return (
    <div className="est" style={{ maxWidth: 980 }}>
      <div className="crumbs">Cadastros › Geral</div>
      <h1>Feriados</h1>
      <p className="mini" style={{ marginBottom: 14 }}>Base da regra do dia útil: título que vence em fim de semana ou feriado ativo tem a previsão no próximo dia útil (o vencimento do documento não muda). Previsão reprogramada à mão não é alterada.</p>
      <div className="filtros" style={{ gap: 8, marginBottom: 12 }}>
        <button className="btn sm" onClick={() => setAno(ano - 1)}>‹</button><b>{ano}</b><button className="btn sm" onClick={() => setAno(ano + 1)}>›</button>
      </div>
      {erro && <div className="aviso t-crit">{erro}</div>}
      <div className="cartao" style={{ padding: 0, overflow: "hidden" }}>
      <table className="tabela">
        <thead><tr><th>Data</th><th>Feriado</th><th>Abrangência</th><th>Conta como não útil</th><th /></tr></thead>
        <tbody>
          {lista.map((f) => (
            <tr key={f.data + f.abrangencia} style={{ opacity: f.ativo ? 1 : 0.55 }}>
              <td className="mono">{dbr(f.data)}</td><td>{f.nome}</td><td>{f.abrangencia}</td>
              <td><input type="checkbox" checked={f.ativo} disabled={!pode} onChange={(e) => post({ acao: "salvar", ...f, ativo: e.target.checked })} /></td>
              <td>{pode && <button className="btn sm crit" onClick={() => post({ acao: "excluir", data: f.data, abrangencia: f.abrangencia })}>Excluir</button>}</td>
            </tr>
          ))}
          {!lista.length && <tr><td colSpan={5} className="mini">Nenhum feriado cadastrado em {ano}.</td></tr>}
        </tbody>
      </table>
      </div>
      {pode && (
        <div className="filtros" style={{ gap: 8, marginTop: 14, flexWrap: "wrap" }}>
          <input className="inp" type="date" value={novo.data} onChange={(e) => setNovo({ ...novo, data: e.target.value })} />
          <input className="inp" placeholder="Nome do feriado" value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} />
          <input className="inp" placeholder="Abrangência (nacional, SP, Barueri…)" value={novo.abrangencia} onChange={(e) => setNovo({ ...novo, abrangencia: e.target.value })} />
          <button className="btn pri" disabled={!novo.data || !novo.nome.trim()} onClick={() => post({ acao: "salvar", ...novo }).then(() => setNovo({ data: "", nome: "", abrangencia: "nacional", ativo: true }))}>Adicionar</button>
        </div>
      )}
    </div>
  );
}

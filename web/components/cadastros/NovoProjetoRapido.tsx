"use client";
/**
 * "+ Novo projeto" rápido (05/10/26, pedido do Benny): "fechamos um pedido e ele vai gerar um projeto
 * novo — apertar um botão, cadastrar o projeto e dar sequência".
 *
 * Um só componente para todos os seletores de projeto do fluxo venda → PV/OS → RC/PC → separação:
 * abre uma caixa pequena já preenchida (nome, cliente, responsável, orçamento, início), cria no cadastro
 * nativo (/api/cadastros/aux → orders.cad_aux_salvar, com a trava de duplicados) e devolve o projeto
 * criado — ou o existente, em "já existe — usar este" — para o seletor já ficar escolhido.
 * O espelho finance.projetos é escrito na mesma hora, então o projeto aparece em todos os seletores.
 */
import { useEffect, useState } from "react";
import { pedir, ErroPedido } from "./comum";

export type ProjetoCriado = { codigo: number; nome: string };
type CandAux = { id: number; codigo: number; nome: string; origem?: string; motivo?: string };

export type SugestaoProjeto = {
  nome?: string | null; clienteCodigo?: number | string | null; clienteNome?: string | null;
  responsavel?: string | null; orcamento?: number | null; obs?: string | null;
};

const hoje = () => new Date().toISOString().slice(0, 10);

export function BotaoNovoProjeto({ empresa = "SF", sugestao, onCriado, rotulo = "+ Novo projeto", disabled, compacto }: {
  empresa?: string; sugestao?: SugestaoProjeto; onCriado: (p: ProjetoCriado) => void;
  rotulo?: string; disabled?: boolean; compacto?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setAberto(true)} title="Cadastrar um projeto novo e já usá-lo aqui"
        style={{ fontSize: compacto ? 11.5 : 12.5, fontWeight: 600, padding: compacto ? "3px 8px" : "6px 10px", borderRadius: 8,
          border: "1px dashed var(--ww-border, #2a3858)", background: "transparent", color: "var(--ww-accent, #3b82f6)",
          cursor: disabled ? "not-allowed" : "pointer", whiteSpace: "nowrap" }}>
        {rotulo}
      </button>
      {aberto && <ModalNovoProjeto empresa={empresa} sugestao={sugestao} fechar={() => setAberto(false)}
        onCriado={(p) => { setAberto(false); onCriado(p); }} />}
    </>
  );
}

export function ModalNovoProjeto({ empresa = "SF", sugestao, fechar, onCriado }: {
  empresa?: string; sugestao?: SugestaoProjeto; fechar: () => void; onCriado: (p: ProjetoCriado) => void;
}) {
  const [tipo, setTipo] = useState<"PJ" | "CT">("PJ");
  const [nome, setNome] = useState(String(sugestao?.nome ?? ""));
  const [cliente, setCliente] = useState(String(sugestao?.clienteNome ?? ""));
  const [responsavel, setResponsavel] = useState(String(sugestao?.responsavel ?? ""));
  const [orcamento, setOrcamento] = useState(sugestao?.orcamento != null ? String(sugestao.orcamento) : "");
  const [inicio, setInicio] = useState(hoje());
  const [obs, setObs] = useState(String(sugestao?.obs ?? ""));
  const [sug, setSug] = useState<Record<string, unknown>>({});
  const [erro, setErro] = useState<string | null>(null);
  const [cands, setCands] = useState<CandAux[] | null>(null);
  const [indo, setIndo] = useState(false);

  useEffect(() => {
    pedir<Record<string, unknown>>(`/api/cadastros/aux?reg=projetos&emp=${empresa}&sugestao=1`).then(setSug).catch(() => {});
  }, [empresa]);
  const numero = sug[tipo] != null ? String(sug[tipo]) : "";

  const salvar = async () => {
    if (!nome.trim()) { setErro("Dê um nome ao projeto."); return; }
    setErro(null); setCands(null); setIndo(true);
    const cliCod = sugestao?.clienteCodigo != null && String(sugestao.clienteCodigo) !== "" && cliente === String(sugestao?.clienteNome ?? "")
      ? Number(sugestao.clienteCodigo) : null;
    const dados: Record<string, unknown> = {
      tipo, status: "ativo", responsavel: responsavel.trim() || null,
      orcamento: orcamento.trim() ? Number(orcamento.replace(/\./g, "").replace(",", ".")) || null : null,
      data_inicio: inicio || null, obs: obs.trim() || null,
      cliente_codigo: cliCod, cliente_nome: cliente.trim() || null,
    };
    if (numero) dados.numero = Number(numero);
    try {
      const r = await pedir<{ codigo: number; nome: string }>("/api/cadastros/aux", {
        method: "POST", body: JSON.stringify({ registro: "projetos", empresa, nome: nome.trim(), dados }),
      });
      onCriado({ codigo: Number(r.codigo), nome: r.nome });
    } catch (e) {
      if (e instanceof ErroPedido && e.status === 409) {
        setCands((e.candidatos as unknown as CandAux[]) ?? []);
        setErro("Já existe um projeto parecido — use o existente ou mude o nome.");
      } else setErro((e as Error).message);
    } finally { setIndo(false); }
  };

  const lab: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 5, fontSize: 12, fontWeight: 600, color: "var(--ww-text-2, #9fb0cc)", minWidth: 0 };
  const inp: React.CSSProperties = { padding: "8px 10px", borderRadius: 8, border: "1px solid var(--ww-border, #2a3858)",
    background: "var(--ww-bg, #0f1a2c)", color: "var(--ww-text, #e8eef8)", fontSize: 13, width: "100%" };

  return (
    <div role="dialog" aria-modal="true" onClick={fechar}
      style={{ position: "fixed", inset: 0, zIndex: 400, background: "rgba(3,8,18,.6)", display: "grid", placeItems: "center", padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ width: "min(620px, 100%)", maxHeight: "90vh", overflow: "auto", borderRadius: 14, background: "var(--ww-surface, #111d32)",
          border: "1px solid var(--ww-border, #1e3050)", boxShadow: "0 20px 60px rgba(0,0,0,.45)", padding: 18, display: "grid", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700 }}>Novo projeto</div>
            <div style={{ fontSize: 12, color: "var(--ww-text-3, #6b7d9c)" }}>Cadastra e já usa aqui — aparece na hora em PV/OS, RC/PC, separação e BI.</div>
          </div>
          <button type="button" onClick={fechar} style={{ background: "none", border: 0, color: "inherit", fontSize: 20, cursor: "pointer" }}>×</button>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0,1fr))", gap: 10 }}>
          <label style={{ ...lab, gridColumn: "span 1" }}>Tipo
            <select style={inp} value={tipo} onChange={(e) => setTipo(e.target.value as "PJ" | "CT")}>
              <option value="PJ">PJ · Projeto</option><option value="CT">CT · Contrato</option>
            </select>
          </label>
          <label style={{ ...lab, gridColumn: "span 3" }}>Nome *
            <input style={inp} autoFocus value={nome} onChange={(e) => { setNome(e.target.value); setCands(null); }} placeholder="ex.: Hospital Santa Isabel — osmose" />
          </label>
          <label style={{ ...lab, gridColumn: "span 2" }}>Cliente
            <input style={inp} value={cliente} onChange={(e) => setCliente(e.target.value)} />
          </label>
          <label style={{ ...lab, gridColumn: "span 2" }}>Responsável
            <input style={inp} value={responsavel} onChange={(e) => setResponsavel(e.target.value)} />
          </label>
          <label style={{ ...lab, gridColumn: "span 2" }}>Orçamento (R$)
            <input style={inp} inputMode="decimal" value={orcamento} onChange={(e) => setOrcamento(e.target.value)} />
          </label>
          <label style={{ ...lab, gridColumn: "span 2" }}>Início
            <input style={inp} type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} />
          </label>
          <label style={{ ...lab, gridColumn: "span 4" }}>Observações
            <input style={inp} value={obs} onChange={(e) => setObs(e.target.value)} />
          </label>
        </div>
        {nome.trim() && (
          <div style={{ fontSize: 12, color: "var(--ww-text-2, #9fb0cc)" }}>
            Vai ficar: <b>{tipo}{numero}_{nome.trim()}</b> · {empresa}
          </div>
        )}
        {erro && <div style={{ fontSize: 12.5, color: "#fca5a5" }}>{erro}</div>}
        {cands && cands.length > 0 && (
          <div style={{ display: "grid", gap: 6, padding: 10, borderRadius: 10, border: "1px solid rgba(245,158,11,.4)", background: "rgba(245,158,11,.08)" }}>
            <b style={{ fontSize: 12.5 }}>Já existe — usar este?</b>
            {cands.map((k) => (
              <div key={k.id} style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ flex: 1, minWidth: 180, fontSize: 13 }}><b>{k.nome}</b> <span style={{ fontSize: 11.5, opacity: .7 }}>· cód. {k.codigo}{k.motivo ? ` · ${k.motivo}` : ""}</span></span>
                <button type="button" onClick={() => onCriado({ codigo: Number(k.codigo), nome: k.nome })}
                  style={{ padding: "5px 10px", borderRadius: 8, border: "1px solid var(--ww-border, #2a3858)", background: "transparent", color: "inherit", cursor: "pointer", fontSize: 12 }}>
                  Usar este
                </button>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button type="button" onClick={fechar} style={{ padding: "8px 14px", borderRadius: 10, border: "1px solid var(--ww-border, #2a3858)", background: "transparent", color: "inherit", cursor: "pointer" }}>Cancelar</button>
          <button type="button" disabled={indo} onClick={salvar}
            style={{ padding: "8px 14px", borderRadius: 10, border: 0, background: "#3b82f6", color: "#fff", fontWeight: 600, cursor: indo ? "wait" : "pointer" }}>
            {indo ? "Criando…" : "Criar e usar"}
          </button>
        </div>
      </div>
    </div>
  );
}

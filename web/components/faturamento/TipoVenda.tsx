"use client";

import { useEffect, useState } from "react";

/* Tipo da venda do PV/OS (Mix / Mercantil / Serviços) com troca no Faturamento — 09/10/26 (sql/158).
   Pedido do Benny: "permita mudar o tipo de venda para Mix, Mercantil ou Serviço na parte de faturamento"
   e "se muda para Mix, chama o pessoal em serviço, da mesma forma como PV é criado da venda".
   Fluxo: escolhe o tipo → motivo → "Ver o que muda" (simulação, nada gravado) → confirma.
   Saindo de Mix/Serviços com OS já gerada no app de Serviços, pergunta o que fazer com a OS. */

type Hist = { de: string | null; para: string; por: string; em: string; motivo: string | null; os_decisao: string | null };
type Info = {
  disponivel: boolean; motivo?: string; sem_sql?: boolean;
  doc?: { tipo: "PV" | "OS"; rotulo: string; cancelado?: boolean; faturado?: boolean; projeto?: string | null };
  atual?: string | null; opcoes?: string[]; codigos?: Record<string, string>;
  os_servicos?: string | null; os_status?: string | null; historico?: Hist[];
};
type Sim = { efeitos?: string[]; error?: string; precisa_decisao_os?: boolean; os?: { os?: string; status?: string } | null };

const TIPOS = ["Mix", "Mercantil", "Serviços"] as const;
const DICA: Record<string, string> = {
  Mix: "material + serviço da nossa equipe — a área de Serviços passa a ver o pedido",
  Mercantil: "só material — sem serviço da equipe",
  "Serviços": "só serviço (OS)",
};
/** Regra da sql/145: PV é Mix/Mercantil; OS é Serviços/Mix. O que não vale, explica o caminho. */
function regra(tipoDoc: "PV" | "OS" | undefined, t: string): string | null {
  if (tipoDoc === "PV" && t === "Serviços") return "PV é venda de produto (NF-e). Com serviço da nossa equipe junto, escolha Mix; se é só serviço, ele deveria ser uma OS (Nova emissão › Recibo de serviço).";
  if (tipoDoc === "OS" && t === "Mercantil") return "OS é serviço. Mercantil (só material) sai num PV com NF-e (Nova emissão › NF-e). Para OS escolha Serviços ou Mix.";
  return null;
}
const cor = (t?: string | null) => t === "Mix" ? "#8b5cf6" : t === "Serviços" ? "#0ea5e9" : t === "Mercantil" ? "#f59e0b" : "#94a3b8";

export default function TipoVenda({ empresa, chave, compacto, onMudou, avisar }: {
  empresa: string; chave: string | null | undefined; compacto?: boolean;
  /** depois da troca: código do vendedor novo (o tipo) — a folha atualiza o campo */
  onMudou?: (codigo: string | null, tipo: string) => void;
  avisar?: (m: string) => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [aberto, setAberto] = useState(false);
  const [para, setPara] = useState<string>("");
  const [motivo, setMotivo] = useState("");
  const [sim, setSim] = useState<Sim | null>(null);
  const [manterOs, setManterOs] = useState(false);
  const [ocup, setOcup] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function carregar() {
    if (!chave || !/^(venda|pv_omie|os_omie):\d+$/.test(chave)) { setInfo(null); return; }
    fetch(`/api/faturamento/tipo-venda?empresa=${empresa}&chave=${encodeURIComponent(chave)}`, { cache: "no-store" })
      .then((x) => x.json()).then((j) => setInfo(j.error ? { disponivel: false, motivo: j.error } : j)).catch(() => setInfo(null));
  }
  useEffect(() => { setAberto(false); setSim(null); setPara(""); setMotivo(""); setErro(null); carregar(); }, [chave, empresa]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!info) return null;
  // Empresa sem os três tipos (CD/WW) ou chave fora da carteira: não mostra nada.
  if (!info.disponivel && !info.sem_sql) return null;

  async function chamar(simular: boolean) {
    setErro(null); setOcup(true);
    const r = await fetch("/api/faturamento/tipo-venda", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ empresa, chave, tipo: para, motivo, os_decisao: manterOs ? "manter" : null, simular }) })
      .then((x) => x.json()).catch((e) => ({ error: String(e) }));
    setOcup(false);
    if (simular) { setSim(r); return; }
    if (r.error) { setErro(r.error); if (r.precisa_decisao_os) setSim(r); return; }
    avisar?.(`${r.rotulo}: tipo da venda ${r.de ?? "—"} → ${r.para}. ${(r.efeitos ?? [])[0] ?? ""}`);
    setAberto(false); setSim(null); setMotivo(""); setManterOs(false);
    onMudou?.(info?.codigos?.[para] ?? null, para);
    carregar();
  }

  const atual = info.atual ?? null;
  const tipoDoc = info.doc?.tipo;
  const ult = info.historico?.[0];
  const caixa: React.CSSProperties = { border: "1px solid var(--f-line, var(--ww-border, rgba(148,163,184,.35)))", borderRadius: 10, padding: 10, marginTop: 8, fontSize: 12.5 };
  const chip = (t: string | null) => (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "2px 9px", borderRadius: 999, fontWeight: 650, fontSize: 12,
      background: `color-mix(in srgb, ${cor(t)} 16%, transparent)`, color: cor(t), border: `1px solid color-mix(in srgb, ${cor(t)} 40%, transparent)` }}>
      {t ?? "sem tipo"}</span>);

  return (
    <div className="tv" style={compacto ? undefined : { margin: "10px 0" }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 12, color: "var(--f-tx3, var(--ww-text-muted))" }}>Tipo da venda</span>
        {info.sem_sql ? <span style={{ fontSize: 11.5, color: "var(--f-tx3, var(--ww-text-muted))" }}>(troca aguardando atualização do banco)</span> : chip(atual)}
        {info.os_servicos && <span style={{ fontSize: 11.5, color: "var(--f-tx3, var(--ww-text-muted))" }} title="OS ligada a este pedido no app de Serviços">· OS {info.os_servicos}{info.os_status ? ` (${info.os_status})` : ""}</span>}
        {ult && <span style={{ fontSize: 11.5, color: "var(--f-tx3, var(--ww-text-muted))" }} title={ult.motivo ?? undefined}>· trocado de {ult.de ?? "—"} por {ult.por.split("@")[0]} em {new Date(ult.em).toLocaleDateString("pt-BR")}</span>}
        {!info.doc?.cancelado && <button type="button" className={compacto ? "ne-lk" : "btn ghost sm"} onClick={() => { setAberto((v) => !v); setSim(null); setErro(null); }}>
          {aberto ? "fechar" : "trocar"}</button>}
      </div>
      {aberto && (
        <div style={caixa}>
          {info.sem_sql ? <div>⚠ {info.motivo}</div> : <>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {TIPOS.map((t) => {
                const bloq = regra(tipoDoc, t);
                const on = para === t;
                return (
                  <button key={t} type="button" disabled={t === atual}
                    onClick={() => { setPara(t); setSim(null); setErro(bloq); setManterOs(false); }}
                    title={bloq ?? DICA[t]}
                    style={{ padding: "5px 10px", borderRadius: 8, cursor: t === atual ? "default" : "pointer", fontSize: 12.5,
                      border: `1px solid ${on ? cor(t) : "var(--f-line, rgba(148,163,184,.4))"}`, opacity: t === atual ? 0.45 : bloq ? 0.7 : 1,
                      background: on ? `color-mix(in srgb, ${cor(t)} 14%, transparent)` : "transparent", color: "inherit", fontWeight: on ? 650 : 400 }}>
                    {on ? "◉" : "○"} {t}{t === atual ? " (atual)" : ""}
                  </button>);
              })}
            </div>
            {para && !regra(tipoDoc, para) && <>
              <div style={{ color: "var(--f-tx3, var(--ww-text-muted))", marginBottom: 6 }}>{DICA[para]}</div>
              <input className={compacto ? "ne-in" : "in"} style={{ width: "100%", marginBottom: 8, padding: "6px 8px" }} placeholder="Motivo da troca (obrigatório) — ex.: cliente pediu instalação"
                value={motivo} onChange={(e) => { setMotivo(e.target.value); setSim(null); }} />
              <div style={{ display: "flex", gap: 8 }}>
                <button type="button" className={compacto ? "ne-btn" : "btn ghost sm"} disabled={ocup || motivo.trim().length < 5} onClick={() => chamar(true)}>
                  {ocup && !sim ? "Conferindo…" : "Ver o que muda"}</button>
              </div>
            </>}
            {erro && <div style={{ marginTop: 8, color: "var(--f-bad, #dc2626)" }}>⚠ {erro}</div>}
            {sim && !sim.error && sim.efeitos && (
              <div style={{ marginTop: 8 }}>
                <b>Ao trocar {atual ?? "—"} → {para}:</b>
                <ul style={{ margin: "4px 0 8px 18px", padding: 0 }}>{sim.efeitos.map((e) => <li key={e}>{e}</li>)}</ul>
                <button type="button" className={compacto ? "ne-btn pri" : "btn sm"} disabled={ocup} onClick={() => chamar(false)}>
                  {ocup ? "Gravando…" : `Confirmar: virar ${para}`}</button>
              </div>
            )}
            {sim?.precisa_decisao_os && (
              <div style={{ marginTop: 8, padding: 8, borderRadius: 8, background: "color-mix(in srgb, #f59e0b 12%, transparent)" }}>
                <div>⚠ {sim.error}</div>
                <label style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }}>
                  <input type="checkbox" checked={manterOs} onChange={(e) => setManterOs(e.target.checked)} />
                  Trocar mesmo assim e manter a OS {sim.os?.os ?? ""} no app de Serviços (eu aviso a equipe para cancelar lá se o serviço não vai acontecer)
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button type="button" className={compacto ? "ne-btn" : "btn ghost sm"} disabled={!manterOs || ocup} onClick={() => chamar(true)}>Ver o que muda</button>
                  <button type="button" className={compacto ? "ne-lk" : "btn ghost sm"} onClick={() => { setAberto(false); setSim(null); setPara(""); }}>Não trocar</button>
                </div>
              </div>
            )}
          </>}
        </div>
      )}
    </div>
  );
}

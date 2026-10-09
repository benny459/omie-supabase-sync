"use client";

/**
 * Central de Ordem (09/10/26) — uma aba a mais em cada módulo do painel + "Meu dia".
 * A Aria mostra só o que está fora de ordem, por urgência, com a decisão pronta
 * (SPEC-allka-em-dia-central-de-ordem.md). Não substitui nenhuma tela: cada cartão
 * tem "Abrir na tela tradicional ↗". Tudo o que aparece aqui vem filtrado do servidor
 * (/api/ordem) pelas permissões de hoje.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MODULO_POR_ID, MODULOS } from "@/lib/ordem/modulos";
import { SUGESTOES } from "@/lib/ordem/comandos";
import type { ItemTela, ModuloOrdem } from "@/lib/ordem/tipos";
import { tom, type Tom } from "@/components/navy/primitivos";
import { cartao, kbrl, BotaoTela, Aviso } from "@/components/navy/tela/KitTela";

type Aba = { modulo: ModuloOrdem; rotulo: string; acesso: boolean; ligado: boolean; previa: boolean; n: number | null; criticos: number | null };
type Acomp = { id: string; modulo: string; titulo: string; estado: string; dono: string | null; criado_em: string; resolvido_em: string | null; motivo: string | null };
type Resp = {
  abas: Aba[]; itens: ItemTela[]; escopos: string[]; escopo: string; previa: boolean; emOrdem: { feitos: number; total: number };
  acompanhar: Acomp[]; sincronizado_em: string | null;
  quem: { uid: string; nome: string; email: string; admin: boolean };
  central: { ativo: boolean; comandos: boolean; encaminhar: boolean; sino: boolean; decisoes: boolean; dialogo_entrada: boolean; pedido_acesso: boolean; livre: boolean; assistente: string };
};
type Bloq = { bloqueado: ModuloOrdem; donos: string[]; abas?: Aba[] };

const ROT_ESCOPO: Record<string, string> = { meus: "Só os meus", equipe: "Também os da equipe", todos: "Todos (supervisão)" };
const urgTom = (u: string | null): Tom => (u === "critica" ? "crit" : "warn");

export default function CentralOrdem() {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const m = (sp.get("m") as ModuloOrdem | null) ?? null;
  const itemUrl = sp.get("item");
  const [escopo, setEscopo] = useState<string>(() => { try { return sp.get("escopo") ?? localStorage.getItem("ordem-escopo") ?? ""; } catch { return sp.get("escopo") ?? ""; } });
  const [dados, setDados] = useState<Resp | null>(null);
  const [bloq, setBloq] = useState<Bloq | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [sel, setSel] = useState<string | null>(itemUrl);
  const [busca, setBusca] = useState("");
  const [soCrit, setSoCrit] = useState(false);
  const [etapa, setEtapa] = useState<string | null>(null);
  const [sincronizando, setSincronizando] = useState(false);
  const [toast, setToast] = useState<{ t: string; ruim?: boolean } | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true); setErro(null);
    const qs = new URLSearchParams();
    if (m) qs.set("m", m);
    if (escopo) qs.set("escopo", escopo);
    try {
      const r = await fetch(`/api/ordem?${qs}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (r.status === 403 && j.bloqueado) { setBloq(j as Bloq); setDados(null); return; }
      if (!r.ok) { setErro(j.error ?? `Erro ${r.status}`); return; }
      setBloq(null); setDados(j as Resp);
    } catch (e) { setErro(e instanceof Error ? e.message : String(e)); }
    finally { setCarregando(false); }
  }, [m, escopo]);

  useEffect(() => { void carregar(); }, [carregar]);
  useEffect(() => { setEtapa(null); }, [m]);
  useEffect(() => { if (itemUrl) setSel(itemUrl); }, [itemUrl]);

  const irModulo = (x: ModuloOrdem | null) => {
    const qs = new URLSearchParams(); if (x) qs.set("m", x);
    router.push(`${pathname}${qs.toString() ? `?${qs}` : ""}`);
  };

  const itens = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return (dados?.itens ?? []).filter((i) =>
      (!soCrit || i.urgencia === "critica") && (!etapa || i.etapa === etapa) &&
      (!t || `${i.titulo} ${i.resumo ?? ""} ${i.dono_nome ?? ""} ${i.origem_ref}`.toLowerCase().includes(t)));
  }, [dados, busca, soCrit, etapa]);

  const atual = itens.find((i) => i.id === sel) ?? itens[0] ?? null;
  const def = m ? MODULO_POR_ID[m] : null;

  async function sincronizar() {
    setSincronizando(true);
    const r = await fetch("/api/ordem/sincronizar", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const j = await r.json().catch(() => ({}));
    setSincronizando(false);
    if (!r.ok) { setToast({ t: j.error ?? "Falhou", ruim: true }); return; }
    const errs = Object.keys(j.erros ?? {});
    setToast({ t: `Atualizado: ${j.detetados} pendência(s), ${j.novos} nova(s), ${j.fechados} resolvida(s) na origem${errs.length ? ` · falhou: ${errs.join(", ")}` : ""}`, ruim: errs.length > 0 });
    void carregar();
  }

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), toast.ruim ? 8000 : 4500); return () => clearTimeout(t); }, [toast]);

  if (erro) return <div style={{ padding: 16 }}><Aviso tone="crit">{erro}</Aviso></div>;

  const abas = dados?.abas ?? bloq?.abas ?? [];
  const totalMeu = abas.reduce((s, a) => s + (a.n ?? 0), 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 48, minWidth: 0 }}>
      {/* Cabeçalho: quem, escopo, atualizar */}
      <header style={{ ...cartao, padding: "14px 18px", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12, color: "var(--ww-text-faint)", fontWeight: 600 }}>✦ Central de Ordem · Aria</div>
          <h1 style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 600, letterSpacing: "-.02em", fontFamily: "var(--font-display)", color: "var(--ww-text)" }}>
            {def ? def.rotulo : "Meu dia"}{dados ? ` · ${dados.quem.nome}` : ""}
          </h1>
          <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)", marginTop: 2 }}>
            {def ? def.sub : "Tudo o que é seu, em todos os módulos a que tem acesso."}
          </div>
        </div>
        {dados && dados.escopos.length > 1 && (
          <div role="group" aria-label="Que itens ver" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {dados.escopos.map((e) => (
              <Chip key={e} ativo={dados.escopo === e} onClick={() => { setEscopo(e); try { localStorage.setItem("ordem-escopo", e); } catch { /* ok */ } }}>{ROT_ESCOPO[e] ?? e}</Chip>
            ))}
          </div>
        )}
        {dados?.quem.admin && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BotaoTela onClick={sincronizar} disabled={sincronizando} title="Corre os detetores agora (só lê os módulos)">{sincronizando ? "Atualizando…" : "↻ Atualizar agora"}</BotaoTela>
            <BotaoTela onClick={() => router.push("/ordem/config")}>⚙ Configurar</BotaoTela>
          </div>
        )}
      </header>

      {dados?.previa && (
        <Aviso tone="violet">
          <b>Pré-visualização — só você (administrador) vê.</b> A Central e os detetores estão desligados para o resto da equipa
          e nenhuma ação executa daqui até ligar em <a href="/ordem/config" style={{ color: "inherit", textDecoration: "underline" }}>Configurar</a>.
        </Aviso>
      )}

      {/* Separadores: Meu dia + um por módulo; sem acesso = cadeado sem contagem */}
      <nav aria-label="Módulos" style={{ display: "flex", gap: 6, flexWrap: "wrap", borderBottom: "1px solid var(--ww-border)", paddingBottom: 8 }}>
        <Separador ativo={!m} onClick={() => irModulo(null)} n={dados ? totalMeu : null}>Meu dia</Separador>
        {abas.map((a) => (
          <Separador key={a.modulo} ativo={m === a.modulo} cadeado={!a.acesso} n={a.acesso ? a.n : null} crit={a.criticos ?? 0}
            onClick={() => irModulo(a.modulo)} title={a.acesso ? (a.previa ? "Desligado para a equipa — pré-visualização" : undefined) : "Sem acesso a este módulo"}>
            {a.rotulo}
          </Separador>
        ))}
      </nav>

      {dados && (dados.central.comandos || dados.quem.admin) && (
        <BarraComando ligado={dados.central.comandos} modulos={abas.filter((a) => a.acesso).map((a) => a.modulo)} modulo={m}
          semAcesso={(mod) => setBloq({ bloqueado: mod, donos: [] })} onFeito={(t, ruim) => { setToast({ t, ruim }); void carregar(); }} />
      )}

      {bloq && <SemAcesso b={bloq} onFechar={() => (m ? irModulo(null) : setBloq(null))} central={dados?.central} />}

      {carregando && !dados && !bloq && <div style={{ ...cartao, padding: 32, textAlign: "center", color: "var(--ww-text-muted)" }}>Carregando a sua fila…</div>}

      {dados && !(bloq && m) && (
        <>
          {def && <CicloModulo def={def} itens={dados.itens} etapa={etapa} setEtapa={setEtapa} />}
          {!m && <GradeModulos abas={abas} irModulo={irModulo} />}

          {/* Progresso */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", fontSize: 12.5, color: "var(--ww-text-muted)" }}>
            <span><b style={{ color: "var(--ww-text)" }}>{dados.emOrdem.feitos} de {dados.emOrdem.total}</b> em ordem hoje</span>
            <div style={{ flex: "1 1 160px", maxWidth: 280, height: 6, borderRadius: 99, background: "var(--ww-track)" }}>
              <div style={{ width: `${dados.emOrdem.total ? (dados.emOrdem.feitos / dados.emOrdem.total) * 100 : 100}%`, height: "100%", borderRadius: 99, background: "var(--ww-ok)" }} />
            </div>
            {dados.sincronizado_em && <span>· atualizado {tempoAtras(dados.sincronizado_em)}</span>}
          </div>

          {/* Fila + cartão */}
          <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 14, alignItems: "start" }}>
            <div style={{ ...cartao, overflow: "hidden", display: "flex", flexDirection: "column", minWidth: 0 }}>
              {/* busca à esquerda + filtros numa linha */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", padding: "10px 12px", borderBottom: "1px solid var(--ww-border)" }}>
                <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar na fila…" aria-label="Buscar na fila"
                  style={{ flex: "1 1 180px", minWidth: 0, height: 32, padding: "0 12px", borderRadius: 10, fontSize: 12.5,
                    background: "var(--ww-panel-sunken)", border: "1px solid var(--ww-border-strong)", color: "var(--ww-text)" }} />
                <Chip ativo={soCrit} onClick={() => setSoCrit((v) => !v)}>Só críticos</Chip>
                {etapa && <Chip ativo onClick={() => setEtapa(null)}>{etapa} ✕</Chip>}
              </div>
              <ul role="listbox" aria-label="Pendências" style={{ listStyle: "none", margin: 0, padding: 0, maxHeight: "min(70vh, 760px)", overflowY: "auto" }}>
                {itens.length === 0 && (
                  <li style={{ padding: 28, textAlign: "center", color: "var(--ww-text-muted)", fontSize: 13 }}>
                    {busca || soCrit || etapa ? "Nada com estes filtros." : "✓ Tudo em ordem aqui. A Aria avisa quando entrar algo novo."}
                  </li>
                )}
                {itens.map((i) => (
                  <li key={i.id} role="option" aria-selected={atual?.id === i.id}>
                    <button type="button" onClick={() => setSel(i.id)} style={{
                      width: "100%", textAlign: "left", padding: "11px 14px", border: 0, cursor: "pointer",
                      borderBottom: "1px solid var(--ww-border-subtle)",
                      background: atual?.id === i.id ? "var(--ww-accent-soft)" : "transparent", color: "var(--ww-text)",
                      borderLeft: `3px solid ${atual?.id === i.id ? "var(--ww-accent)" : "transparent"}`,
                    }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis" }}>{i.titulo}</span>
                        {i.rotulo_urgencia && <span style={{ fontSize: 11.5, fontWeight: 700, color: tom(urgTom(i.urgencia)).fg, whiteSpace: "nowrap" }}>{i.rotulo_urgencia}</span>}
                      </div>
                      {i.resumo && <div style={{ fontSize: 12, color: "var(--ww-text-muted)", marginTop: 2 }}>{i.resumo}</div>}
                      <div style={{ display: "flex", gap: 6, marginTop: 5, flexWrap: "wrap" }}>
                        {!m && <Etiqueta>{MODULO_POR_ID[i.modulo]?.rotulo ?? i.modulo}</Etiqueta>}
                        {i.encaminhado_por_nome && <Etiqueta tone="violet">↘ de {i.encaminhado_por_nome}</Etiqueta>}
                        {i.estado === "encaminhado" && <Etiqueta tone="info">a acompanhar</Etiqueta>}
                        {dados.escopo !== "meus" && i.dono_nome && <Etiqueta tone="off">{i.dono_nome}</Etiqueta>}
                        {dados.escopo !== "meus" && !i.dono_id && !i.externo && <Etiqueta tone="off">sem dono</Etiqueta>}
                        {i.previa && <Etiqueta tone="violet">prévia</Etiqueta>}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {atual ? <CartaoDecisao key={atual.id} item={atual} central={dados.central} admin={dados.quem.admin}
              onFeito={(t, ruim) => { setToast({ t, ruim }); void carregar(); }} /> :
              <div style={{ ...cartao, padding: 28, color: "var(--ww-text-muted)", fontSize: 13 }}>Escolha uma pendência na lista.</div>}
          </section>

          {dados.acompanhar.length > 0 && <AAcompanhar xs={dados.acompanhar} />}
        </>
      )}

      {toast && (
        <div role="status" style={{ position: "fixed", bottom: 20, left: "50%", transform: "translateX(-50%)", zIndex: 60, maxWidth: "min(92vw, 560px)",
          padding: "10px 16px", borderRadius: 12, fontSize: 13, background: "var(--ww-panel)", color: "var(--ww-text)",
          border: `1px solid ${toast.ruim ? "var(--ww-crit)" : "var(--ww-border-strong)"}`, boxShadow: "var(--shadow-float)" }}>{toast.t}</div>
      )}
    </div>
  );
}

// ── Peças ────────────────────────────────────────────────────────────────────
function Chip({ ativo, onClick, children, title }: { ativo?: boolean; onClick?: () => void; children: React.ReactNode; title?: string }) {
  return (
    <button type="button" onClick={onClick} title={title} aria-pressed={!!ativo} style={{
      padding: "5px 12px", borderRadius: 999, fontSize: 12.5, cursor: "pointer", whiteSpace: "nowrap", fontWeight: ativo ? 600 : 500,
      border: "1px solid " + (ativo ? "var(--ww-brand-3)" : "var(--ww-border-strong)"),
      color: ativo ? "var(--ww-accent-text)" : "var(--ww-text-2)",
      background: ativo ? "color-mix(in srgb,var(--ww-brand-3) 10%,transparent)" : "transparent",
    }}>{children}</button>
  );
}

function Etiqueta({ children, tone = "info" }: { children: React.ReactNode; tone?: Tom }) {
  const t = tom(tone);
  return <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase", padding: "2px 7px", borderRadius: 6, background: t.bg, color: t.fg }}>{children}</span>;
}

function Separador({ ativo, cadeado, n, crit = 0, onClick, children, title }: {
  ativo?: boolean; cadeado?: boolean; n?: number | null; crit?: number; onClick: () => void; children: React.ReactNode; title?: string;
}) {
  return (
    <button type="button" onClick={onClick} title={title} aria-current={ativo ? "page" : undefined} style={{
      display: "inline-flex", alignItems: "center", gap: 7, padding: "7px 12px", borderRadius: 10, cursor: "pointer",
      fontSize: 13.5, fontWeight: ativo ? 650 : 500, border: 0,
      background: ativo ? "var(--ww-accent-soft)" : "transparent", color: ativo ? "var(--ww-accent-text)" : "var(--ww-text-2)",
      opacity: cadeado ? 0.7 : 1,
    }}>
      {children}
      {cadeado ? <span aria-label="sem acesso">🔒</span>
        : n == null ? null
        : n === 0 ? <span style={{ color: "var(--ww-ok-text)", fontWeight: 700 }}>✓</span>
        : <span style={{ fontSize: 11, fontWeight: 700, padding: "1px 7px", borderRadius: 99, background: crit > 0 ? "var(--ww-crit-soft)" : "var(--ww-warn-soft)", color: crit > 0 ? "var(--ww-crit-text)" : "var(--ww-warn-text)" }}>{n}</span>}
    </button>
  );
}

function GradeModulos({ abas, irModulo }: { abas: Aba[]; irModulo: (m: ModuloOrdem) => void }) {
  const vis = abas.filter((a) => a.acesso);
  if (!vis.length) return null;
  return (
    <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 10 }}>
      {vis.map((a) => (
        <button key={a.modulo} type="button" onClick={() => irModulo(a.modulo)} style={{ ...cartao, padding: "12px 14px", textAlign: "left", cursor: "pointer", color: "var(--ww-text)" }}>
          <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>{a.rotulo}</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: a.n ? (a.criticos ? "var(--ww-crit-text)" : "var(--ww-warn-text)") : "var(--ww-ok-text)" }}>{a.n ? a.n : "✓"}</div>
          <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>{a.criticos ? `${a.criticos} crítico(s) · ` : ""}abrir ↗</div>
        </button>
      ))}
    </section>
  );
}

function CicloModulo({ def, itens, etapa, setEtapa }: { def: (typeof MODULOS)[number]; itens: ItemTela[]; etapa: string | null; setEtapa: (e: string | null) => void }) {
  const porEtapa = new Map<string, number>();
  for (const i of itens) if (i.etapa) porEtapa.set(i.etapa, (porEtapa.get(i.etapa) ?? 0) + 1);
  const valor = itens.reduce((s, i) => s + (i.valor ?? 0), 0);
  const crit = itens.filter((i) => i.urgencia === "critica").length;
  const temValor = itens.some((i) => i.valor != null);
  return (
    <section style={{ ...cartao, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}><b style={{ color: "var(--ww-text)" }}>Em dia quando:</b> {def.emDia}</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        <Indicador rotulo="Pendências" valor={String(itens.length)} tone={itens.length ? "warn" : "ok"} />
        <Indicador rotulo="Críticas" valor={String(crit)} tone={crit ? "crit" : "ok"} />
        {temValor && <Indicador rotulo="Valor envolvido" valor={kbrl(valor)} tone="info" />}
      </div>
      <div role="group" aria-label="Ciclo do módulo — clique numa etapa para filtrar" style={{ display: "flex", gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        {def.ciclo.map((e, k) => {
          const n = porEtapa.get(e) ?? 0;
          const quente = def.quentes.includes(e);
          return (
            <span key={e} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <button type="button" disabled={!n} onClick={() => setEtapa(etapa === e ? null : e)} title={n ? `Filtrar: ${n} pendência(s) em ${e}` : "Nada parado aqui"} style={{
                padding: "5px 10px", borderRadius: 8, fontSize: 12, cursor: n ? "pointer" : "default",
                border: `1px solid ${etapa === e ? "var(--ww-accent)" : quente && n ? "var(--ww-warn)" : "var(--ww-border)"}`,
                background: etapa === e ? "var(--ww-accent-soft)" : n ? "var(--ww-warn-soft)" : "transparent",
                color: n ? "var(--ww-text)" : "var(--ww-text-faint)", fontWeight: n ? 600 : 400,
              }}>{e}{n ? ` · ${n}` : ""}</button>
              {k < def.ciclo.length - 1 && <span aria-hidden style={{ color: "var(--ww-text-faint)" }}>›</span>}
            </span>
          );
        })}
      </div>
      <div style={{ fontSize: 12 }}>
        <a href={def.tela} target={def.externo ? "_blank" : undefined} rel="noreferrer" style={{ color: "var(--ww-accent-text)" }}>Abrir a tela tradicional de {def.rotulo} ↗</a>
      </div>
    </section>
  );
}

function Indicador({ rotulo, valor, tone }: { rotulo: string; valor: string; tone: Tom }) {
  return (
    <div style={{ padding: "8px 12px", borderRadius: 10, background: "var(--ww-panel-sunken)", border: "1px solid var(--ww-border)", minWidth: 120 }}>
      <div style={{ fontSize: 11.5, color: "var(--ww-text-muted)" }}>{rotulo}</div>
      <div style={{ fontSize: 18, fontWeight: 700, color: tom(tone).fg }}>{valor}</div>
    </div>
  );
}

// ── Cartão de decisão ────────────────────────────────────────────────────────
type Previa = { ok: boolean; texto: string; detalhe?: unknown };

function CartaoDecisao({ item, central, admin, onFeito }: {
  item: ItemTela; central: Resp["central"]; admin: boolean; onFeito: (t: string, ruim?: boolean) => void;
}) {
  const r = item.recomendacao;
  const [modo, setModo] = useState<null | "recusar" | "adiar" | "encaminhar" | "confirmar" | "budget">(null);
  const [motivo, setMotivo] = useState("");
  const [ate, setAte] = useState("");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [ultimo, setUltimo] = useState<{ log: number; pode: boolean } | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus({ preventScroll: true }); }, []);

  async function chamar(acao: string, extra: Record<string, unknown> = {}) {
    setOcupado(true);
    try {
      const res = await fetch("/api/ordem/acao", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id, acao, ...extra }) });
      const j = await res.json().catch(() => ({}));
      return { ok: res.ok, j };
    } finally { setOcupado(false); }
  }

  async function pedirPrevia() {
    const { ok, j } = await chamar("previa");
    if (!ok) { onFeito(j.error ?? "Não foi possível preparar", true); return; }
    setPrevia({ ok: true, texto: j.texto, detalhe: j.detalhe }); setModo("confirmar");
  }
  async function executar(motivoBudget?: string) {
    const { ok, j } = await chamar("executar", motivoBudget ? { motivo: motivoBudget } : {});
    if (!ok && j.precisaMotivo) { setModo("budget"); onFeito(j.error, true); return; }
    if (!ok) { onFeito(j.error ?? "A rota recusou", true); setModo(null); return; }
    setUltimo({ log: j.log_id, pode: !!j.desfazer });
    setModo(null);
    onFeito(j.texto ?? "Feito.", !!j.parcial);
  }
  async function decidir(acao: "recusar" | "adiar" | "encaminhar" | "feito" | "budget") {
    if (acao === "budget") {
      if (motivo.trim().length < 5) { onFeito("Escreva o motivo (5+ letras) — vai no aviso ao Benny.", true); return; }
      await executar(motivo.trim()); setMotivo(""); return;
    }
    if ((acao === "recusar" || acao === "encaminhar") && motivo.trim().length < 3) { onFeito("Escreva o motivo (3+ letras).", true); return; }
    const { ok, j } = await chamar(acao, { motivo, ate: ate || null });
    if (!ok) { onFeito(j.error ?? "Não foi possível", true); return; }
    setUltimo({ log: j.log_id, pode: true }); setModo(null); setMotivo("");
    onFeito(j.texto ?? "Registado.");
  }
  async function desfazer() {
    if (!ultimo) return;
    const { ok, j } = await chamar("desfazer", { log_id: ultimo.log });
    onFeito(ok ? (j.texto ?? "Desfeito.") : (j.error ?? "Não foi possível desfazer"), !ok);
    setUltimo(null);
  }

  const a = item.acao;
  const podeAceitar = !!a && a.ligada && a.podeExecutar && !item.previa;
  const motivoAceitar = !a ? null : !a.ligada ? "Ação ainda desligada na configuração." : !a.podeExecutar ? a.motivo : item.previa ? "Pré-visualização: ligue o módulo e o detetor." : null;
  const mostraEncaminhar = !!item.depende_de && central.encaminhar && !item.externo && item.estado !== "encaminhado";

  return (
    <article ref={ref} tabIndex={-1} aria-label={`Decisão: ${item.titulo}`} style={{ ...cartao, padding: "16px 18px", display: "flex", flexDirection: "column", gap: 12, outline: "none", minWidth: 0 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", fontSize: 12 }}>
        <Etiqueta>{MODULO_POR_ID[item.modulo]?.rotulo ?? item.modulo}</Etiqueta>
        {item.rotulo_urgencia && <span style={{ fontWeight: 700, color: tom(urgTom(item.urgencia)).fg }}>{item.rotulo_urgencia}</span>}
        {item.etapa && <span style={{ color: "var(--ww-text-muted)" }}>etapa: {item.etapa}</span>}
        {item.degrau > 0 && <span style={{ color: "var(--ww-crit-text)" }}>escada: {["", "2º aviso", "supervisão", "direção"][item.degrau]}</span>}
      </div>
      <h2 style={{ margin: 0, fontSize: 19, fontWeight: 650, color: "var(--ww-text)", lineHeight: 1.3 }}>{item.titulo}</h2>
      {item.resumo && <div style={{ fontSize: 13, color: "var(--ww-text-muted)" }}>{item.resumo}</div>}
      {item.encaminhado_por_nome && <div style={{ fontSize: 12.5, color: "var(--ww-violet-text)" }}>↘ encaminhado por {item.encaminhado_por_nome}</div>}

      <div style={{ padding: "10px 12px", borderRadius: 10, background: "var(--ww-violet-soft)", color: "var(--ww-text)", fontSize: 13.5 }}>
        <b style={{ color: "var(--ww-violet-text)" }}>✦ Recomendação:</b> {r.acao}
      </div>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(86px, auto) 1fr", gap: "6px 14px", fontSize: 13 }}>
        {r.porque && <><dt style={rotDt}>Porquê</dt><dd style={ddS}>{r.porque}</dd></>}
        {r.impacto && <><dt style={rotDt}>Impacto</dt><dd style={ddS}>{r.impacto}</dd></>}
        <dt style={rotDt}>Dono</dt><dd style={ddS}>{item.dono_nome ?? (item.externo ? "—" : "sem dono definido (fila da equipa)")}</dd>
        <dt style={rotDt}>Confiança</dt><dd style={ddS}><span style={{ color: r.confianca === "alta" ? "var(--ww-ok-text)" : r.confianca === "baixa" ? "var(--ww-crit-text)" : "var(--ww-warn-text)" }}>● {r.confianca === "media" ? "média" : r.confianca}</span>{r.risco ? ` · risco: ${r.risco}` : ""}</dd>
        {item.depende_de && <><dt style={rotDt}>Depende de</dt><dd style={ddS}>{MODULO_POR_ID[item.depende_de.modulo]?.rotulo} · {item.depende_de.papel}</dd></>}
      </dl>
      {r.conferir && r.conferir.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: "var(--ww-text-2)" }}>{r.conferir.map((c) => <li key={c}>Conferir: {c}</li>)}</ul>
      )}
      {r.alternativas && r.alternativas.length > 0 && (
        <div>
          <div style={{ ...rotDt, marginBottom: 6 }}>Alternativas</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {r.alternativas.map((x) => (
              <div key={x.acao} style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap", padding: "8px 10px", borderRadius: 8, border: "1px solid var(--ww-border)", fontSize: 13 }}>
                <span>{x.acao}</span>{x.nota && <span style={{ color: "var(--ww-text-muted)" }}>{x.nota}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ações */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {a && (
          <BotaoTela primario onClick={pedirPrevia} disabled={!podeAceitar || ocupado} title={motivoAceitar ?? "Mostra o que vai acontecer antes de executar"}>
            {mostraEncaminhar ? "Aceitar" : a.rotulo}
          </BotaoTela>
        )}
        {mostraEncaminhar && <BotaoTela primario={!a} onClick={() => setModo("encaminhar")} disabled={ocupado}>Encaminhar a {MODULO_POR_ID[item.depende_de!.modulo]?.rotulo}</BotaoTela>}
        {item.link && (
          <a href={item.link} target={item.externo ? "_blank" : undefined} rel="noreferrer" style={{ textDecoration: "none" }}>
            <BotaoTela title="Ajustar: abre a tela de hoje no item, com tudo o que ela tem">{item.externo ? "Abrir no CRM ↗" : "Abrir na tela tradicional ↗"}</BotaoTela>
          </a>
        )}
        {central.decisoes && !item.externo && (
          <>
            <BotaoTela onClick={() => setModo("recusar")} disabled={ocupado}>Recusar com motivo</BotaoTela>
            <BotaoTela onClick={() => setModo("adiar")} disabled={ocupado}>Adiar</BotaoTela>
          </>
        )}
        {item.tipo.startsWith("enc:") && central.encaminhar && (
          <>
            <BotaoTela primario onClick={() => decidir("feito")} disabled={ocupado}>Marcar como resolvido</BotaoTela>
            {!central.decisoes && <BotaoTela onClick={() => setModo("recusar")} disabled={ocupado}>Recusar com motivo</BotaoTela>}
          </>
        )}
        {ultimo?.pode && <BotaoTela onClick={desfazer} disabled={ocupado}>↶ Desfazer</BotaoTela>}
      </div>
      {!central.decisoes && !item.externo && admin && (
        <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>Recusar/Adiar ficam disponíveis quando ligar “Decisões” na configuração.</div>
      )}
      {a && motivoAceitar && <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>{motivoAceitar}</div>}

      {modo === "confirmar" && previa && (
        <div role="dialog" aria-label="Confirmar" style={{ padding: 12, borderRadius: 10, border: "1px solid var(--ww-warn)", background: "var(--ww-warn-soft)", fontSize: 13, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ whiteSpace: "pre-wrap", color: "var(--ww-text)" }}>{previa.texto}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BotaoTela primario onClick={() => executar()} disabled={ocupado}>{ocupado ? "Executando…" : "Confirmar"}</BotaoTela>
            <BotaoTela onClick={() => setModo(null)}>Cancelar</BotaoTela>
          </div>
        </div>
      )}
      {(modo === "recusar" || modo === "adiar" || modo === "encaminhar" || modo === "budget") && (
        <div style={{ padding: 12, borderRadius: 10, border: "1px solid var(--ww-border-strong)", display: "flex", flexDirection: "column", gap: 8, fontSize: 13 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ color: "var(--ww-text-muted)" }}>{modo === "recusar" ? "Porque recusa? (a Aria aprende com isto)" : modo === "adiar" ? "Motivo do adiamento (conta como resposta)" : modo === "budget" ? "Motivo para aprovar acima do budget (vai no aviso ao Benny)" : "O que pede à outra área?"}</span>
            <textarea value={motivo} onChange={(e) => setMotivo(e.target.value)} rows={2} autoFocus
              style={{ resize: "vertical", padding: 8, borderRadius: 8, border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)", fontFamily: "inherit", fontSize: 13 }} />
          </label>
          {modo === "adiar" && (
            <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ color: "var(--ww-text-muted)" }}>Até</span>
              <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} style={{ height: 30, borderRadius: 8, border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)", padding: "0 8px" }} />
            </label>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BotaoTela primario onClick={() => decidir(modo)} disabled={ocupado}>{modo === "recusar" ? "Recusar" : modo === "adiar" ? "Adiar" : modo === "budget" ? "Aprovar com este motivo" : "Encaminhar"}</BotaoTela>
            <BotaoTela onClick={() => setModo(null)}>Cancelar</BotaoTela>
          </div>
        </div>
      )}
      <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>Origem: {item.origem_ref}{item.previa ? " · pré-visualização (desligado para a equipa)" : ""}</div>
    </article>
  );
}

const rotDt: React.CSSProperties = { fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: "var(--ww-text-faint)", margin: 0 };
const ddS: React.CSSProperties = { margin: 0, color: "var(--ww-text)" };

function AAcompanhar({ xs }: { xs: Acomp[] }) {
  return (
    <section style={{ ...cartao, padding: "14px 16px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
        <b style={{ fontSize: 14 }}>A acompanhar</b><span style={{ fontSize: 12, color: "var(--ww-text-muted)" }}>o que encaminhou a outras áreas — só o estado</span>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        {xs.map((x) => (
          <li key={x.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--ww-border)" }}>
            <span style={{ flex: 1, minWidth: 200 }}>{x.titulo}</span>
            <span style={{ color: "var(--ww-text-muted)" }}>{MODULO_POR_ID[x.modulo as ModuloOrdem]?.rotulo ?? x.modulo}{x.dono ? ` · ${x.dono}` : ""}</span>
            <span style={{ fontWeight: 700, color: x.estado === "feito" ? "var(--ww-ok-text)" : x.estado === "recusado" ? "var(--ww-crit-text)" : "var(--ww-warn-text)" }}>
              {x.estado === "feito" ? "✓ resolvido" : x.estado === "recusado" ? `recusado${x.motivo ? `: ${x.motivo}` : ""}` : "aberto"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function SemAcesso({ b, onFechar, central }: { b: Bloq; onFechar: () => void; central?: Resp["central"] }) {
  const nome = MODULO_POR_ID[b.bloqueado]?.rotulo ?? b.bloqueado;
  const [modo, setModo] = useState<null | "pedido" | "acesso">(null);
  const [texto, setTexto] = useState("");
  const [prazo, setPrazo] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => { btn.current?.focus(); const f = (e: KeyboardEvent) => { if (e.key === "Escape") onFechar(); }; window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onFechar]);
  async function enviar() {
    const r = await fetch("/api/ordem/pedido", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tipo: modo, modulo: b.bloqueado, texto, prazo: prazo || null }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? (j.texto ?? "Pedido registado.") : (j.error ?? "Não foi possível."));
    if (r.ok) setModo(null);
  }
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="sem-acesso-titulo" style={{ ...cartao, padding: "18px 20px", display: "flex", flexDirection: "column", gap: 10, borderColor: "var(--ww-warn)" }}>
      <h2 id="sem-acesso-titulo" style={{ margin: 0, fontSize: 18 }}>🔒 Sem acesso a {nome}</h2>
      <p style={{ margin: 0, fontSize: 13.5, color: "var(--ww-text-2)" }}>
        O seu perfil não inclui este módulo.{" "}
        {central?.encaminhar ? <>Se precisa de algo de {nome}, a Aria pode encaminhar ao responsável{b.donos.length ? ` (${b.donos.join(", ")})` : ""}, e o pedido fica a ser acompanhado aqui.</> : <>Fale com o administrador se precisar deste módulo.</>}
      </p>
      {modo && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} placeholder={modo === "pedido" ? "O que precisa?" : "Para que precisa do acesso?"}
            style={{ padding: 8, borderRadius: 8, border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)", fontFamily: "inherit", fontSize: 13 }} />
          {modo === "pedido" && <label style={{ fontSize: 12.5, display: "flex", gap: 8, alignItems: "center" }}>Prazo <input type="date" value={prazo} onChange={(e) => setPrazo(e.target.value)} /></label>}
          <div style={{ display: "flex", gap: 8 }}><BotaoTela primario onClick={enviar}>Enviar</BotaoTela><BotaoTela onClick={() => setModo(null)}>Cancelar</BotaoTela></div>
        </div>
      )}
      {msg && <div style={{ fontSize: 13, color: "var(--ww-text-muted)" }}>{msg}</div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {central?.encaminhar && central.livre && <BotaoTela onClick={() => setModo("pedido")}>Encaminhar um pedido</BotaoTela>}
        {central?.pedido_acesso && <BotaoTela onClick={() => setModo("acesso")}>Pedir acesso</BotaoTela>}
        <button ref={btn} type="button" onClick={onFechar} style={{ height: 34, padding: "0 14px", borderRadius: 10, border: "1px solid var(--ww-border-strong)", background: "transparent", color: "var(--ww-text-2)", cursor: "pointer", fontWeight: 600 }}>Fechar</button>
      </div>
    </div>
  );
}

function tempoAtras(iso: string) {
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.round(min / 60);
  return h < 24 ? `há ${h} h` : `há ${Math.round(h / 24)} d`;
}

// ── Barra de comandos ────────────────────────────────────────────────────────
type PlanoItem = { id: string; modulo: ModuloOrdem; titulo: string; dono: string | null; modo: "executar" | "encaminhar" | "abrir"; motivo: string | null; link: string | null };
type PreviaCmd = { ok: boolean; frase: string; itens?: PlanoItem[]; fora?: number; executaveis?: number; comandosLigados?: boolean; semAcesso?: ModuloOrdem };

function BarraComando({ ligado, modulos, modulo, semAcesso, onFeito }: {
  ligado: boolean; modulos: ModuloOrdem[]; modulo: ModuloOrdem | null; semAcesso: (m: ModuloOrdem) => void; onFeito: (t: string, ruim?: boolean) => void;
}) {
  const [texto, setTexto] = useState("");
  const [previa, setPrevia] = useState<PreviaCmd | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [lote, setLote] = useState<number[]>([]);
  const sugs = SUGESTOES.filter((x) => modulos.includes(x.modulo) && (!modulo || x.modulo === modulo));

  async function ver(t = texto) {
    if (!t.trim()) return;
    setOcupado(true); setLote([]);
    const r = await fetch("/api/ordem/comando", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto: t }) });
    const j = (await r.json().catch(() => ({}))) as PreviaCmd & { error?: string };
    setOcupado(false);
    if (!r.ok) { onFeito(j.error ?? "Não foi possível", true); return; }
    if (j.semAcesso) { setPrevia(null); semAcesso(j.semAcesso); return; }
    setPrevia(j);
  }
  async function confirmar() {
    if (!previa?.itens) return;
    setOcupado(true);
    const r = await fetch("/api/ordem/comando", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ texto, confirmar: true }) });
    const j = await r.json().catch(() => ({})) as { resultados?: { ok: boolean; texto: string }[]; log_ids?: number[]; error?: string };
    setOcupado(false);
    if (!r.ok) { onFeito(j.error ?? "Não foi possível", true); return; }
    const ok = (j.resultados ?? []).filter((x) => x.ok).length, tot = (j.resultados ?? []).length;
    setLote(j.log_ids ?? []); setPrevia(null);
    onFeito(`Comando: ${ok} de ${tot} feito(s).${tot > ok ? " Os que falharam continuam na fila com o motivo." : ""}`, tot > ok);
  }
  async function desfazerLote() {
    setOcupado(true);
    let ok = 0;
    for (const id of [...lote].reverse()) {
      const r = await fetch("/api/ordem/acao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "desfazer", log_id: id }) });
      if (r.ok) ok++;
    }
    setOcupado(false); setLote([]);
    onFeito(`Desfeito(s) ${ok} de ${lote.length}.`, ok < lote.length);
  }
  const n = previa?.itens?.filter((i) => i.modo !== "abrir").length ?? 0;
  return (
    <section style={{ ...cartao, padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, borderColor: "var(--ww-violet)" }}>
      <form onSubmit={(e) => { e.preventDefault(); void ver(); }} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span aria-hidden style={{ color: "var(--ww-violet-text)", fontWeight: 700 }}>✦</span>
        <input value={texto} onChange={(e) => setTexto(e.target.value)} placeholder="Dê um comando à Aria, ex.: casar as NF da coluna do meio" aria-label="Comando para a Aria"
          style={{ flex: "1 1 240px", minWidth: 0, height: 34, padding: "0 12px", borderRadius: 10, fontSize: 13, background: "var(--ww-panel-sunken)", border: "1px solid var(--ww-border-strong)", color: "var(--ww-text)" }} />
        <BotaoTela primario disabled={ocupado || !texto.trim()} onClick={() => void ver()}>{ocupado ? "…" : "Ver o que faz"}</BotaoTela>
        {lote.length > 0 && <BotaoTela onClick={desfazerLote} disabled={ocupado}>↶ Desfazer o comando ({lote.length})</BotaoTela>}
      </form>
      {sugs.length > 0 && (
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", fontSize: 12 }}>
          <span style={{ color: "var(--ww-text-faint)" }}>Sugestões:</span>
          {sugs.map((x) => <button key={x.texto} type="button" onClick={() => { setTexto(x.texto); void ver(x.texto); }} style={{ padding: "3px 10px", borderRadius: 99, border: "1px dashed var(--ww-violet)", background: "transparent", color: "var(--ww-violet-text)", cursor: "pointer", fontSize: 12 }}>{x.texto}</button>)}
        </div>
      )}
      {!ligado && <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>Comandos desligados para a equipa: só pré-visualização (ligue em Configurar).</div>}
      {previa && (
        <div style={{ padding: 10, borderRadius: 10, background: "var(--ww-violet-soft)", fontSize: 13, display: "flex", flexDirection: "column", gap: 6 }}>
          <div><b>A Aria entendeu:</b> {previa.frase}</div>
          {previa.itens && (previa.itens.length === 0 ? <div>Nada na sua fila corresponde a este comando.</div> : (
            <ul style={{ margin: 0, paddingLeft: 18, maxHeight: 220, overflowY: "auto" }}>
              {previa.itens.map((i) => (
                <li key={i.id}>{i.titulo} <span style={{ color: "var(--ww-text-muted)" }}>· {MODULO_POR_ID[i.modulo]?.rotulo}{i.dono ? ` · ${i.dono}` : ""} · {i.modo === "executar" ? "executa" : i.modo === "encaminhar" ? "encaminha" : `só abrir (${i.motivo})`}</span></li>
              ))}
            </ul>
          ))}
          {!!previa.fora && <div>🔒 {previa.fora} item(ns) de módulos a que não tem acesso ficaram de fora.</div>}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <BotaoTela primario disabled={ocupado || !n || !previa.comandosLigados} onClick={confirmar}>Confirmar {n}</BotaoTela>
            <BotaoTela onClick={() => setPrevia(null)}>Cancelar</BotaoTela>
          </div>
        </div>
      )}
    </section>
  );
}

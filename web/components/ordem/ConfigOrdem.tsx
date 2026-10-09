"use client";

/**
 * Configuração da Central de Ordem (só admin) — 09/10/26.
 * Pedido do Benny: "me deixe configurar tudo para ir habilitando". Tudo nasce desligado;
 * os valores da SPEC aparecem como "sugerido" e só valem depois de gravar. Cada mudança
 * fica no histórico (quem, quando, antes → depois).
 */

import { useEffect, useMemo, useState } from "react";
import type { ConfigOrdem } from "@/lib/ordem/config";
import type { DefAcao, DefDetetor } from "@/lib/ordem/catalogo";
import { MODULOS } from "@/lib/ordem/modulos";
import type { ModuloOrdem } from "@/lib/ordem/tipos";
import { cartao, BotaoTela, Aviso, Carregando } from "@/components/navy/tela/KitTela";

type Pessoa = { id: string; email: string; nome: string; modulos: ModuloOrdem[]; admin: boolean };
type Dono = { tipo: string; papel: string; titular_id: string; substituto_id: string | null; titular_ausente: boolean };
type Decisao = { chave: keyof ConfigOrdem["parametros"]; codigo: string; rotulo: string; ajuda: string };
type Log = { id: number; email: string; chave: string; antes: unknown; depois: unknown; criado_em: string };
type Pedido = { id: string; usuario_id: string; modulo: string; motivo: string | null; estado: string; criado_em: string };
type Dados = {
  config: ConfigOrdem; sugerido: ConfigOrdem; decisoes: Decisao[]; detetores: DefDetetor[]; acoes: DefAcao[];
  donos: Dono[]; pessoas: Pessoa[]; log: Log[]; pedidos: Pedido[];
};

const fmt = (v: unknown) => (v === null || v === undefined ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v));

export default function ConfigOrdemTela() {
  const [d, setD] = useState<Dados | null>(null);
  const [cfg, setCfg] = useState<ConfigOrdem | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [gravando, setGravando] = useState(false);

  async function carregar() {
    const r = await fetch("/api/ordem/config", { cache: "no-store" });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setErro(j.error ?? `Erro ${r.status}`); return; }
    setD(j as Dados); setCfg((j as Dados).config);
  }
  useEffect(() => { void carregar(); }, []);

  const mudou = useMemo(() => !!d && !!cfg && JSON.stringify(d.config) !== JSON.stringify(cfg), [d, cfg]);
  const nome = useMemo(() => new Map((d?.pessoas ?? []).map((p) => [p.id, p.nome])), [d]);

  if (erro) return <Aviso tone="crit">{erro}</Aviso>;
  if (!d || !cfg) return <Carregando texto="Carregando configuração…" />;

  const set = (f: (c: ConfigOrdem) => ConfigOrdem) => setCfg((c) => (c ? f(structuredClone(c)) : c));
  async function gravar() {
    setGravando(true); setMsg(null);
    const r = await fetch("/api/ordem/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "gravar", config: cfg }) });
    const j = await r.json().catch(() => ({}));
    setGravando(false);
    setMsg(r.ok ? `Gravado (${j.mudancas} mudança(s) registadas no histórico).` : (j.error ?? "Falhou"));
    if (r.ok) void carregar();
  }
  async function dono(tipo: string, papel: string, titular: string, subst: string | null, ausente: boolean) {
    setMsg(null);
    const corpo = titular ? { acao: "dono", tipo, papel, titular_id: titular, substituto_id: subst || null, titular_ausente: ausente } : { acao: "dono_remover", tipo };
    const r = await fetch("/api/ordem/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? "Dono gravado." : (j.error ?? "Falhou"));
    void carregar();
  }
  async function decidirPedido(id: string, estado: "aprovado" | "recusado") {
    const nota = estado === "recusado" ? prompt("Motivo (opcional)") ?? "" : "";
    const r = await fetch("/api/ordem/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: "pedido", id, estado, nota }) });
    setMsg(r.ok ? (estado === "aprovado" ? "Aprovado — agora libere o módulo em Usuários e acessos." : "Recusado.") : "Falhou");
    void carregar();
  }

  const t = busca.trim().toLowerCase();
  const dets = d.detetores.filter((x) => !t || `${x.rotulo} ${x.tipo} ${x.modulo}`.toLowerCase().includes(t));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 80, minWidth: 0 }}>
      <header style={{ ...cartao, padding: "14px 18px", display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ flex: 1, minWidth: 240 }}>
          <div style={{ fontSize: 12, color: "var(--ww-text-faint)", fontWeight: 600 }}>✦ Central de Ordem · Sistema</div>
          <h1 style={{ margin: "2px 0 0", fontSize: 24, fontWeight: 600, fontFamily: "var(--font-display)" }}>Configurar a Central de Ordem</h1>
          <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)" }}>Ligue aos poucos: módulo a módulo, detetor a detetor, ação a ação. O que está em “sugerido” não vale até gravar.</div>
        </div>
        <a href="/ordem"><BotaoTela>← Voltar à Central</BotaoTela></a>
      </header>

      {msg && <Aviso tone="info">{msg}</Aviso>}

      <Secao titulo="1. Ligar a Central" sub="Desligada, só o administrador a vê (pré-visualização, sem executar nada).">
        <Interruptor v={cfg.ativo} on={(v) => set((c) => ({ ...c, ativo: v }))} rotulo="Central visível para a equipa (com os módulos ligados abaixo)" />
        <Interruptor v={cfg.decisoes} on={(v) => set((c) => ({ ...c, decisoes: v }))} rotulo="Decisões no cartão: Recusar com motivo, Adiar (só mudam o estado do item, com Desfazer)" />
        <Interruptor v={cfg.encaminhar} on={(v) => set((c) => ({ ...c, encaminhar: v }))} rotulo="Encaminhar a outro módulo (cria o item no destino e “a acompanhar” na origem)" />
        <Interruptor v={cfg.sino} on={(v) => set((c) => ({ ...c, sino: v }))} rotulo="Sino de avisos na barra do topo" />
        <Interruptor v={cfg.dialogo_entrada} on={(v) => set((c) => ({ ...c, dialogo_entrada: v }))} rotulo="Diálogo de entrada (“Bom dia…”, uma vez por dia ou com aviso novo)" />
        <Interruptor v={cfg.pedido_acesso} on={(v) => set((c) => ({ ...c, pedido_acesso: v }))} rotulo="Botão “Pedir acesso” no diálogo Sem acesso" />
        <Interruptor v={cfg.comandos} on={(v) => set((c) => ({ ...c, comandos: v }))} rotulo="Barra de comandos da Aria (pré-visualiza e pede “Confirmar N”)" />
      </Secao>

      <Secao titulo="2. Módulos" sub="A aba “Central de Ordem” do módulo aparece para quem já tem acesso ao módulo hoje.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 8 }}>
          {MODULOS.map((m) => (
            <Interruptor key={m.id} v={cfg.modulos[m.id] === true} on={(v) => set((c) => ({ ...c, modulos: { ...c.modulos, [m.id]: v } }))} rotulo={m.rotulo} />
          ))}
        </div>
      </Secao>

      <Secao titulo="3. Detetores e donos" sub="Cada tipo de pendência tem interruptor e dono (titular + substituto). Sem dono gravado vale o de hoje (o do próprio dado ou o nome fixo do relatório).">
        <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar detetor…" aria-label="Buscar detetor"
          style={{ width: 320, maxWidth: "100%", height: 32, padding: "0 12px", borderRadius: 10, fontSize: 12.5, background: "var(--ww-panel-sunken)", border: "1px solid var(--ww-border-strong)", color: "var(--ww-text)" }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {dets.map((x) => {
            const dn = d.donos.find((y) => y.tipo === x.tipo);
            const elegiveis = d.pessoas.filter((p) => p.modulos.includes(x.modulo));
            return (
              <div key={x.tipo} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", padding: "10px 12px", borderRadius: 10, border: "1px solid var(--ww-border)" }}>
                <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                  {x.destino ? (
                    <div style={{ fontSize: 13.5, marginLeft: 44 }}><b>{MODULOS.find((m) => m.id === x.modulo)?.rotulo}</b> · {x.rotulo} <span style={{ color: "var(--ww-text-faint)" }}>(liga com “Encaminhar”)</span></div>
                  ) : (
                    <Interruptor v={cfg.detetores[x.tipo] === true} on={(v) => set((c) => ({ ...c, detetores: { ...c.detetores, [x.tipo]: v } }))}
                      rotulo={<><b>{MODULOS.find((m) => m.id === x.modulo)?.rotulo}</b> · {x.rotulo}</>} />
                  )}
                  <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)", marginLeft: 44 }}>fonte: {x.fonte}</div>
                </div>
                <label style={lbl}>Titular
                  <select value={dn?.titular_id ?? ""} onChange={(e) => dono(x.tipo, x.papel, e.target.value, dn?.substituto_id ?? null, dn?.titular_ausente ?? false)} style={sel}>
                    <option value="">{x.donoPadrao ? `(hoje: ${x.donoPadrao})` : x.destino ? "(fila da equipa do módulo)" : "(o do próprio dado)"}</option>
                    {elegiveis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </label>
                <label style={lbl}>Substituto
                  <select value={dn?.substituto_id ?? ""} disabled={!dn} onChange={(e) => dn && dono(x.tipo, x.papel, dn.titular_id, e.target.value || null, dn.titular_ausente)} style={sel}>
                    <option value="">—</option>
                    {elegiveis.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
                  </select>
                </label>
                <label style={{ ...lbl, flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <input type="checkbox" disabled={!dn || !dn.substituto_id} checked={!!dn?.titular_ausente} onChange={(e) => dn && dono(x.tipo, x.papel, dn.titular_id, dn.substituto_id, e.target.checked)} />
                  titular ausente
                </label>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>Só aparecem como dono as pessoas que já veem o módulo do tipo; o servidor recusa outras.</div>
      </Secao>

      <Secao titulo="4. Ações a partir do cartão" sub="Cada ação passa pela rota de sempre (mesmas regras, alçada e auditoria) e só executa depois de “Confirmar”. Desligada, o cartão só mostra “Abrir na tela tradicional”.">
        {d.acoes.map((a) => (
          <div key={a.chave}>
            <Interruptor v={cfg.acoes[a.chave] === true} on={(v) => set((c) => ({ ...c, acoes: { ...c.acoes, [a.chave]: v } }))}
              rotulo={<>{a.rotulo} {a.envia && <b style={{ color: "var(--ww-crit-text)" }}>· envia {a.envia}</b>}</>} />
            <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)", marginLeft: 44 }}>{a.rota}</div>
          </div>
        ))}
      </Secao>

      <Secao titulo="5. Decisões em aberto (M1–M6, P1–P4)" sub="Os valores da proposta aparecem como sugerido; clique “usar sugerido” e grave para valerem.">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 10 }}>
          {d.decisoes.map((x) => {
            const v = cfg.parametros[x.chave];
            const s = d.sugerido.parametros[x.chave];
            const igual = JSON.stringify(v) === JSON.stringify(s);
            return (
              <div key={x.chave} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--ww-border)", display: "flex", flexDirection: "column", gap: 6 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}><span style={{ color: "var(--ww-violet-text)" }}>{x.codigo}</span> · {x.rotulo}</div>
                <Campo valor={v} sugerido={s} on={(nv) => set((c) => ({ ...c, parametros: { ...c.parametros, [x.chave]: nv } }))} chave={x.chave} />
                <div style={{ fontSize: 11.5, color: "var(--ww-text-muted)" }}>{x.ajuda}</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11.5 }}>
                  <span style={{ color: "var(--ww-text-faint)" }}>sugerido: <b>{fmt(s)}</b></span>
                  {!igual && <button type="button" onClick={() => set((c) => ({ ...c, parametros: { ...c.parametros, [x.chave]: s } }))} style={linkBtn}>usar sugerido</button>}
                </div>
              </div>
            );
          })}
        </div>
        <div style={{ fontSize: 11.5, color: "var(--ww-text-faint)" }}>M3 (alçadas): continuam as de hoje em Usuários e acessos (teto individual e orçamento semanal); a Central não as muda. M6 (donos): secção 3.</div>
      </Secao>

      <Secao titulo="6. Mensagens e escada da cobrança" sub="Webex por pessoa, filtradas pelo perfil. Ensaio = só regista o que seria enviado; Teste = só para o e-mail de teste com [TESTE].">
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={lbl}>Modo
            <select value={cfg.mensagens.modo} onChange={(e) => set((c) => ({ ...c, mensagens: { ...c.mensagens, modo: e.target.value as ConfigOrdem["mensagens"]["modo"] } }))} style={sel}>
              <option value="desligado">desligado</option><option value="ensaio">ensaio (só regista)</option>
              <option value="teste">teste (só ao e-mail de teste)</option><option value="ligado">ligado (a cada dono)</option>
            </select>
          </label>
          <label style={lbl}>Horários (vírgula)
            <input value={cfg.mensagens.horarios.join(", ")} onChange={(e) => set((c) => ({ ...c, mensagens: { ...c.mensagens, horarios: e.target.value.split(/[,\s]+/).filter(Boolean) } }))} style={inp} placeholder={d.sugerido.mensagens.horarios.join(", ")} />
          </label>
          <label style={lbl}>Limite por dia
            <input type="number" min={0} value={cfg.mensagens.limite_dia} onChange={(e) => set((c) => ({ ...c, mensagens: { ...c.mensagens, limite_dia: Number(e.target.value) } }))} style={{ ...inp, width: 90 }} />
          </label>
          <label style={lbl}>E-mail de teste
            <input value={cfg.mensagens.email_teste} onChange={(e) => set((c) => ({ ...c, mensagens: { ...c.mensagens, email_teste: e.target.value } }))} style={inp} placeholder={d.sugerido.mensagens.email_teste} />
          </label>
          <label style={{ ...lbl, flexDirection: "row", alignItems: "center", gap: 6 }}>
            <input type="checkbox" checked={cfg.mensagens.so_dias_uteis} onChange={(e) => set((c) => ({ ...c, mensagens: { ...c.mensagens, so_dias_uteis: e.target.checked } }))} /> só dias úteis
          </label>
          <button type="button" style={linkBtn} onClick={() => set((c) => ({ ...c, mensagens: { ...d.sugerido.mensagens, modo: c.mensagens.modo } }))}>usar sugerido (horários, limite, e-mail)</button>
        </div>
        <Interruptor v={cfg.escada.ligada} on={(v) => set((c) => ({ ...c, escada: { ...c.escada, ligada: v } }))} rotulo="Escada da cobrança: Lembrete → 2º aviso → Supervisão → Direção" />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {(["dias_segundo_aviso", "dias_supervisao", "dias_direcao"] as const).map((k) => (
            <label key={k} style={lbl}>{k === "dias_segundo_aviso" ? "2º aviso após (dias)" : k === "dias_supervisao" ? "Supervisão após (dias)" : "Direção após (dias)"}
              <input type="number" min={0} value={cfg.escada[k]} onChange={(e) => set((c) => ({ ...c, escada: { ...c.escada, [k]: Number(e.target.value) } }))} style={{ ...inp, width: 100 }} placeholder={String(d.sugerido.escada[k])} />
              <span style={{ fontSize: 11, color: "var(--ww-text-faint)" }}>sugerido: {d.sugerido.escada[k]}</span>
            </label>
          ))}
          <label style={lbl}>Direção (e-mails)
            <input value={cfg.escada.direcao_emails.join(", ")} onChange={(e) => set((c) => ({ ...c, escada: { ...c.escada, direcao_emails: e.target.value.split(/[,\s]+/).filter(Boolean) } }))} style={inp} placeholder={d.sugerido.escada.direcao_emails.join(", ")} />
          </label>
          <label style={lbl}>Supervisão (e-mails)
            <input value={cfg.escada.supervisao_emails.join(", ")} onChange={(e) => set((c) => ({ ...c, escada: { ...c.escada, supervisao_emails: e.target.value.split(/[,\s]+/).filter(Boolean) } }))} style={inp} />
          </label>
        </div>
      </Secao>

      <Secao titulo="7. Diretoria e supervisão" sub="Veem os itens de todos os módulos a que já têm acesso, com o nome do dono (nunca módulos sem acesso).">
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {d.pessoas.map((p) => (
            <label key={p.id} style={{ display: "inline-flex", gap: 6, alignItems: "center", fontSize: 13, padding: "4px 10px", borderRadius: 99, border: "1px solid var(--ww-border)" }}>
              <input type="checkbox" checked={cfg.supervisao_ids.includes(p.id)} onChange={(e) => set((c) => ({ ...c, supervisao_ids: e.target.checked ? [...c.supervisao_ids, p.id] : c.supervisao_ids.filter((x) => x !== p.id) }))} />
              {p.nome}{p.admin ? " (admin)" : ""}
            </label>
          ))}
        </div>
      </Secao>

      <Secao titulo="8. Pedidos de acesso" sub="Aprovar só regista e avisa a pessoa; o acesso é dado em Sistema › Usuários e acessos (a Central não concede nada).">
        {d.pedidos.length === 0 ? <div style={{ fontSize: 13, color: "var(--ww-text-muted)" }}>Nenhum pedido.</div> : d.pedidos.map((p) => (
          <div key={p.id} style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid var(--ww-border)" }}>
            <span style={{ flex: 1, minWidth: 200 }}><b>{nome.get(p.usuario_id) ?? p.usuario_id}</b> pede {p.modulo}{p.motivo ? ` — “${p.motivo}”` : ""}</span>
            <span style={{ color: "var(--ww-text-muted)" }}>{p.estado}</span>
            {p.estado === "pendente" && <><BotaoTela onClick={() => decidirPedido(p.id, "aprovado")}>Aprovar</BotaoTela><BotaoTela onClick={() => decidirPedido(p.id, "recusado")}>Recusar</BotaoTela></>}
          </div>
        ))}
        <a href="/configuracoes/acessos" style={{ fontSize: 12.5, color: "var(--ww-accent-text)" }}>Abrir Usuários e acessos ↗</a>
      </Secao>

      <Secao titulo="9. Histórico de mudanças" sub="Cada interruptor, parâmetro e dono, com quem e quando.">
        {d.log.length === 0 ? <div style={{ fontSize: 13, color: "var(--ww-text-muted)" }}>Ainda nada mudou.</div> : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 4, fontSize: 12.5 }}>
            {d.log.slice(0, 80).map((l) => (
              <li key={l.id} style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <span style={{ color: "var(--ww-text-faint)" }}>{new Date(l.criado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}</span>
                <span>{l.email.split("@")[0]}</span><code style={{ wordBreak: "break-all" }}>{l.chave}</code>
                <span style={{ color: "var(--ww-text-muted)", wordBreak: "break-all" }}>{fmt(l.antes)} → <b style={{ color: "var(--ww-text)" }}>{fmt(l.depois)}</b></span>
              </li>
            ))}
          </ul>
        )}
      </Secao>

      {mudou && (
        <div style={{ position: "sticky", bottom: 12, zIndex: 20, ...cartao, padding: "10px 14px", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", borderColor: "var(--ww-warn)" }}>
          <span style={{ flex: 1, minWidth: 200, fontSize: 13 }}>Há mudanças por gravar. Nada muda para a equipa até gravar.</span>
          <BotaoTela onClick={() => setCfg(d.config)}>Descartar</BotaoTela>
          <BotaoTela primario onClick={gravar} disabled={gravando}>{gravando ? "Gravando…" : "Gravar"}</BotaoTela>
        </div>
      )}
    </div>
  );
}

const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 3, fontSize: 12, color: "var(--ww-text-muted)" };
const sel: React.CSSProperties = { height: 30, borderRadius: 8, border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)", padding: "0 8px", maxWidth: 220 };
const inp: React.CSSProperties = { height: 30, borderRadius: 8, border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)", padding: "0 8px", minWidth: 0, maxWidth: "100%" };
const linkBtn: React.CSSProperties = { border: 0, background: "transparent", color: "var(--ww-accent-text)", cursor: "pointer", textDecoration: "underline", fontSize: 12, padding: 0 };

function Secao({ titulo, sub, children }: { titulo: string; sub?: string; children: React.ReactNode }) {
  return (
    <section style={{ ...cartao, padding: "14px 16px", display: "flex", flexDirection: "column", gap: 10 }}>
      <div><h2 style={{ margin: 0, fontSize: 16, fontWeight: 650 }}>{titulo}</h2>{sub && <div style={{ fontSize: 12.5, color: "var(--ww-text-muted)", marginTop: 2 }}>{sub}</div>}</div>
      {children}
    </section>
  );
}

function Interruptor({ v, on, rotulo }: { v: boolean; on: (v: boolean) => void; rotulo: React.ReactNode }) {
  return (
    <label style={{ display: "flex", gap: 10, alignItems: "center", cursor: "pointer", fontSize: 13.5, minWidth: 0 }}>
      <button type="button" role="switch" aria-checked={v} onClick={() => on(!v)} style={{
        width: 34, height: 20, borderRadius: 99, border: 0, padding: 2, cursor: "pointer", flexShrink: 0,
        background: v ? "var(--ww-ok)" : "var(--ww-track)", display: "flex", justifyContent: v ? "flex-end" : "flex-start",
      }}><span style={{ width: 16, height: 16, borderRadius: 99, background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.3)" }} /></button>
      <span style={{ minWidth: 0 }}>{rotulo}</span>
    </label>
  );
}

function Campo({ valor, sugerido, on, chave }: { valor: unknown; sugerido: unknown; on: (v: unknown) => void; chave: string }) {
  if (typeof sugerido === "boolean") return <Interruptor v={valor === true} on={on} rotulo={valor ? "sim" : "não"} />;
  if (typeof sugerido === "number") return <input type="number" step="any" value={Number(valor ?? 0)} onChange={(e) => on(Number(e.target.value))} style={{ ...inp, width: 120 }} aria-label={chave} />;
  const opcoes: Record<string, string[]> = {
    m5_nome_assistente: ["Cesar", "Aria"], p1_visao_equipe: ["so_supervisao", "mesmo_modulo"],
    p2_financeiro: ["tela", "estrito"], p3_aprova_acesso: ["admin", "admin_e_dono"],
  };
  const ops = opcoes[chave];
  if (ops) return <select value={String(valor ?? "")} onChange={(e) => on(e.target.value)} style={sel} aria-label={chave}>{ops.map((o) => <option key={o} value={o}>{o}</option>)}</select>;
  return <input value={String(valor ?? "")} onChange={(e) => on(e.target.value)} style={inp} aria-label={chave} />;
}

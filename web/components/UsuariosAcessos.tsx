"use client";

// Usuários e acessos (03/10/26): uma tela para o administrador decidir quem
// entra em cada módulo e o que vê dentro dele. Grava pela /api/admin/acessos.

import { useEffect, useMemo, useState } from "react";

type Efetiva = { valor: boolean; explicito: boolean; padrao: boolean };
type ItemCat = { chave: string; modulo: "compras" | "estoque" | "financeiro" | "faturamento" | "projetos"; rotulo: string; descricao: string };
type Pessoa = {
  id: string; email: string; nome: string | null; is_admin: boolean; ativo: boolean; role: string;
  semPerfilPainel: boolean; teste: boolean;
  areas: { area: string; can_view: boolean }[];
  modulos: { modulo: string; can_approve: boolean; approval_ceiling_brl: number | null }[];
  crm: string | null;
  explicitas: Record<string, boolean>;
  efetivas: Record<string, Efetiva>;
};
type Audit = { id: number; alvo_email: string | null; acao: string; por_email: string | null; em: string };
type Dados = { pessoas: Pessoa[]; catalogo: ItemCat[]; perfis: Record<string, string>; auditoria: Audit[] };

const MODS: { id: "compras" | "estoque" | "financeiro"; rotulo: string }[] = [
  { id: "compras", rotulo: "Compras" }, { id: "estoque", rotulo: "Estoque" }, { id: "financeiro", rotulo: "Financeiro" },
];
// Permissões finas: os módulos do ERP + as chaves de Operação › Projetos (fora do ERP).
const MODS_FINOS: { id: ItemCat["modulo"]; rotulo: string }[] = [...MODS, { id: "projetos", rotulo: "Operação › Projetos" }];
// Áreas do painel (platform.user_area_access). Operação/Vendas são abertas por padrão; Financeiro, ERP e BI exigem liberação.
const AREAS: { id: string; rotulo: string; padraoAberta: boolean; ajuda: string }[] = [
  { id: "operacao", rotulo: "Operação", padraoAberta: true, ajuda: "Avulsos, Projetos, PCs" },
  { id: "vendas", rotulo: "Vendas", padraoAberta: true, ajuda: "Vendas e relatórios de vendas" },
  { id: "erp", rotulo: "ERP", padraoAberta: false, ajuda: "Base de Compras, Estoque e Financeiro" },
  { id: "financeiro", rotulo: "Financeiro (BI)", padraoAberta: false, ajuda: "DRE, contas consolidadas, assistente" },
  { id: "bi", rotulo: "BI", padraoAberta: false, ajuda: "Dashboards" },
];
const CRM_ROLES: { v: string | null; l: string }[] = [
  { v: null, l: "Sem acesso" }, { v: "viewer", l: "Ver" }, { v: "member", l: "Usar" }, { v: "admin", l: "Administrar" }, { v: "owner", l: "Dono" },
];

function nivelModulo(p: Pessoa, mod: string, cat: ItemCat[]): string {
  const chaves = cat.filter((c) => c.modulo === mod).map((c) => c.chave);
  const on = chaves.filter((k) => p.efetivas[k]?.valor);
  if (!on.length) return "sem";
  if (on.length === chaves.length) return "administrar";
  const acoes = on.filter((k) => !/\.(acesso|ver_valores|ver_custos|ver_pagar|ver_receber)$/.test(k));
  return acoes.length ? "usar" : "ver";
}

export default function UsuariosAcessos({ meuId }: { meuId: string }) {
  const [d, setD] = useState<Dados | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [selId, setSelId] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [novo, setNovo] = useState({ email: "", nome: "" });
  const [aviso, setAviso] = useState<string | null>(null);
  const [mostrarTeste, setMostrarTeste] = useState(false);

  useEffect(() => {
    fetch("/api/admin/acessos").then(async (r) => {
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falha ao carregar");
      setD(j);
    }).catch((e) => setErro(e.message));
  }, []);

  async function acao(corpo: Record<string, unknown>, msg?: string) {
    setOcupado(true); setErro(null);
    try {
      const r = await fetch("/api/admin/acessos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Falha");
      if (j.precisaConfirmar) {
        if (confirm(`${j.email} ainda não tem login. Criar o acesso com uma senha provisória (mostrada só uma vez, nenhum e-mail é enviado)?`)) {
          return acao({ ...corpo, confirmado: true }, msg);
        }
        return null;
      }
      if (j.pessoas) setD(j);
      if (j.senha_provisoria) setAviso(`Acesso criado. Senha provisória (anote agora, não aparece de novo): ${j.senha_provisoria}`);
      else if (msg) setAviso(msg);
      return j;
    } catch (e) { setErro((e as Error).message); return null; }
    finally { setOcupado(false); }
  }

  const pessoas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return (d?.pessoas ?? [])
      .filter((p) => mostrarTeste || !p.teste)
      .filter((p) => !q || p.email.toLowerCase().includes(q) || (p.nome ?? "").toLowerCase().includes(q))
      .sort((a, b) => Number(b.ativo) - Number(a.ativo) || (a.nome ?? a.email).localeCompare(b.nome ?? b.email));
  }, [d, busca, mostrarTeste]);

  const sel = d?.pessoas.find((p) => p.id === selId) ?? null;
  if (erro && !d) return <div className="p-6 text-rose-600 text-sm">{erro}</div>;
  if (!d) return <div className="p-6 text-sm text-ww-textMuted">Carregando…</div>;

  const areaOn = (p: Pessoa, a: (typeof AREAS)[number]) => {
    if (a.id !== "erp" && a.id !== "financeiro" && a.id !== "bi" && p.is_admin) return true;
    const r = p.areas.find((x) => x.area === a.id);
    return r ? r.can_view : a.padraoAberta;
  };
  const chip = (on: boolean, txt: string) => (
    <span className={`inline-block text-[11px] px-1.5 py-0.5 rounded mr-1 mb-1 ${on ? "bg-emerald-500/15 text-emerald-600" : "bg-ww-rowHover text-ww-textMuted line-through"}`}>{txt}</span>
  );

  return (
    <div className="space-y-5 max-w-[1300px]">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <a href="/configuracoes" className="text-xs text-ww-textMuted hover:underline">← Configurações</a>
          <h1 className="text-[26px] font-semibold text-ww-text tracking-[-0.022em]">Usuários e acessos</h1>
          <p className="text-sm text-ww-textMuted mt-1">Quem entra em cada módulo e o que vê dentro dele. Toda mudança fica registrada no histórico.</p>
        </div>
        <div className="flex gap-2 items-center">
          <input value={novo.email} onChange={(e) => setNovo({ ...novo, email: e.target.value })} placeholder="e-mail da pessoa"
                 className="px-3 py-2 text-sm rounded-lg border border-ww-border bg-ww-panel w-56" />
          <input value={novo.nome} onChange={(e) => setNovo({ ...novo, nome: e.target.value })} placeholder="nome (opcional)"
                 className="px-3 py-2 text-sm rounded-lg border border-ww-border bg-ww-panel w-40" />
          <button disabled={ocupado || !novo.email} onClick={async () => {
            const j = await acao({ acao: "adicionar", email: novo.email, nome: novo.nome });
            if (j?.user_id) { setSelId(j.user_id); setNovo({ email: "", nome: "" }); }
          }} className="px-4 py-2 text-sm font-medium rounded-lg bg-blue-600 text-white disabled:opacity-50">+ Adicionar pessoa</button>
        </div>
      </div>

      {aviso && <div className="text-sm px-4 py-2 rounded-lg bg-emerald-500/10 text-emerald-700 border border-emerald-500/30 flex justify-between gap-3"><span>{aviso}</span><button onClick={() => setAviso(null)}>✕</button></div>}
      {erro && <div className="text-sm px-4 py-2 rounded-lg bg-rose-500/10 text-rose-600 border border-rose-500/30">{erro}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] gap-5">
        {/* Lista */}
        <section className="bg-ww-panel rounded-xl border border-ww-border overflow-hidden">
          <div className="px-4 py-3 border-b border-ww-border flex gap-2 items-center">
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar pessoa…"
                   className="flex-1 px-3 py-1.5 text-sm rounded-lg border border-ww-border bg-ww-bg" />
            <label className="text-xs text-ww-textMuted flex items-center gap-1"><input type="checkbox" checked={mostrarTeste} onChange={(e) => setMostrarTeste(e.target.checked)} /> contas de teste</label>
          </div>
          <div className="divide-y divide-ww-border max-h-[70vh] overflow-y-auto">
            {pessoas.map((p) => (
              <button key={p.id} onClick={() => setSelId(p.id)}
                      className={`w-full text-left px-4 py-3 hover:bg-ww-rowHover ${selId === p.id ? "bg-ww-rowHover" : ""} ${p.ativo ? "" : "opacity-50"}`}>
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm text-ww-text">{p.nome || p.email.split("@")[0]}</span>
                  {p.is_admin && <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-white">Admin</span>}
                  {!p.ativo && <span className="text-[10px] px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-600">Desativado</span>}
                  {p.semPerfilPainel && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700">só no portal</span>}
                </div>
                <div className="text-xs text-ww-textMuted">{p.email}</div>
                <div className="mt-1">
                  {chip(!!p.crm, "CRM")}
                  {chip(areaOn(p, AREAS[0]), "Operação")}
                  {MODS.map((m) => chip(nivelModulo(p, m.id, d.catalogo) !== "sem", m.rotulo))}
                  {chip(areaOn(p, AREAS[4]), "BI")}
                </div>
              </button>
            ))}
          </div>
        </section>

        {/* Detalhe */}
        <section className="bg-ww-panel rounded-xl border border-ww-border p-5 space-y-5">
          {!sel ? (
            <p className="text-sm text-ww-textMuted">Escolha uma pessoa na lista para ver e mudar os acessos.</p>
          ) : (
            <>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div>
                  <h2 className="text-lg font-semibold text-ww-text">{sel.nome || sel.email}</h2>
                  <div className="text-xs text-ww-textMuted">{sel.email}</div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <label className="text-sm flex items-center gap-1.5">
                    <input type="checkbox" checked={sel.is_admin} disabled={ocupado || sel.id === meuId}
                           onChange={(e) => acao({ acao: "admin", user_id: sel.id, on: e.target.checked })} />
                    Administrador (pode tudo)
                  </label>
                  {sel.ativo
                    ? <button disabled={ocupado || sel.id === meuId} onClick={() => confirm(`Desativar ${sel.email}? Tira todos os acessos (painel e CRM). O login não é apagado.`) && acao({ acao: "desativar", user_id: sel.id }, "Pessoa desativada")}
                              className="px-3 py-1.5 text-xs rounded-lg border border-rose-500/40 text-rose-600">Desativar</button>
                    : <button disabled={ocupado} onClick={() => acao({ acao: "reativar", user_id: sel.id }, "Pessoa reativada")}
                              className="px-3 py-1.5 text-xs rounded-lg border border-ww-border">Reativar</button>}
                </div>
              </div>

              {/* Módulos */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ww-textMuted mb-2">Módulos</h3>
                <div className="grid sm:grid-cols-2 gap-2">
                  <div className="rounded-lg border border-ww-border p-3">
                    <div className="text-sm font-medium">CRM <span className="text-xs text-ww-textMuted">(portal allka.ai)</span></div>
                    <select value={sel.crm ?? ""} disabled={ocupado} onChange={(e) => acao({ acao: "crm", user_id: sel.id, role: e.target.value || null })}
                            className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-ww-border bg-ww-bg">
                      {CRM_ROLES.map((r) => <option key={r.l} value={r.v ?? ""}>{r.l}</option>)}
                    </select>
                    <p className="text-[11px] text-ww-textMuted mt-1">Vale no próximo login da pessoa no portal.</p>
                  </div>
                  {AREAS.filter((a) => a.id !== "erp").map((a) => (
                    <div key={a.id} className="rounded-lg border border-ww-border p-3">
                      <div className="text-sm font-medium">{a.rotulo} <span className="text-xs text-ww-textMuted">· {a.ajuda}</span></div>
                      <select value={areaOn(sel, a) ? "sim" : "nao"} disabled={ocupado || (sel.is_admin && a.padraoAberta)}
                              onChange={(e) => acao({ acao: "area", user_id: sel.id, area: a.id, on: e.target.value === "sim" })}
                              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-ww-border bg-ww-bg">
                        <option value="sim">Com acesso</option><option value="nao">Sem acesso</option>
                      </select>
                    </div>
                  ))}
                  {MODS.map((m) => (
                    <div key={m.id} className="rounded-lg border border-ww-border p-3">
                      <div className="text-sm font-medium">{m.rotulo}</div>
                      <select value={nivelModulo(sel, m.id, d.catalogo)} disabled={ocupado || sel.is_admin}
                              onChange={(e) => acao({ acao: "modulo", user_id: sel.id, modulo: m.id, nivel: e.target.value })}
                              className="mt-1 w-full px-2 py-1.5 text-sm rounded border border-ww-border bg-ww-bg">
                        <option value="sem">Sem acesso</option><option value="ver">Ver</option><option value="usar">Usar</option><option value="administrar">Administrar</option>
                      </select>
                    </div>
                  ))}
                  <div className="rounded-lg border border-dashed border-ww-border p-3">
                    <div className="text-sm font-medium">Serviços</div>
                    <p className="text-xs text-ww-textMuted mt-1">Gerenciado no app de serviços (app.waterworks.com.br).</p>
                  </div>
                </div>
                {sel.is_admin && <p className="text-xs text-ww-textMuted mt-2">Administrador tem acesso a todos os módulos e permissões.</p>}
              </div>

              {/* Permissões finas */}
              <div>
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-ww-textMuted">O que vê e faz (ERP e Operação › Projetos)</h3>
                  <div className="flex gap-2 items-center">
                    <select defaultValue="" disabled={ocupado || sel.is_admin}
                            onChange={(e) => { if (e.target.value) { acao({ acao: "perfil", user_id: sel.id, perfil: e.target.value }, "Perfil aplicado — ajuste o que precisar"); e.target.value = ""; } }}
                            className="px-2 py-1 text-xs rounded border border-ww-border bg-ww-bg">
                      <option value="">Aplicar perfil…</option>
                      {Object.entries(d.perfis).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                    <button disabled={ocupado || sel.is_admin} onClick={() => acao({ acao: "padrao", user_id: sel.id }, "Voltou ao padrão")}
                            className="px-2 py-1 text-xs rounded border border-ww-border">Voltar ao padrão</button>
                  </div>
                </div>
                {MODS_FINOS.map((m) => (
                  <div key={m.id} className="mb-3">
                    <div className="text-sm font-medium mb-1">{m.rotulo}</div>
                    <div className="grid sm:grid-cols-2 gap-x-4">
                      {d.catalogo.filter((c) => c.modulo === m.id).map((c) => {
                        const ef = sel.efetivas[c.chave];
                        return (
                          <label key={c.chave} className="flex items-start gap-2 py-1 text-sm">
                            <input type="checkbox" className="mt-0.5" checked={!!ef?.valor} disabled={ocupado || sel.is_admin}
                                   onChange={(e) => acao({ acao: "perm", user_id: sel.id, chave: c.chave, valor: e.target.checked })} />
                            <span>
                              {c.rotulo}
                              {!ef?.explicito && !sel.is_admin && <span className="ml-1 text-[10px] text-ww-textMuted">(padrão)</span>}
                              <span className="block text-[11px] text-ww-textMuted">{c.descricao}</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <p className="text-[11px] text-ww-textMuted">
                  “(padrão)” = o que a pessoa já podia fazer antes desta tela. Marcar ou desmarcar vira escolha sua.
                  A alçada de aprovação (teto em R$) continua em Configurações › Usuários &amp; Perfis.
                </p>
              </div>

              {/* Histórico */}
              <div>
                <h3 className="text-xs font-semibold uppercase tracking-wider text-ww-textMuted mb-2">Histórico desta pessoa</h3>
                <ul className="text-xs space-y-1 max-h-48 overflow-y-auto">
                  {d.auditoria.filter((a) => a.alvo_email === sel.email).map((a) => (
                    <li key={a.id} className="text-ww-textMuted"><span className="text-ww-text">{a.acao}</span> · {a.por_email} · {new Date(a.em).toLocaleString("pt-BR")}</li>
                  ))}
                  {!d.auditoria.some((a) => a.alvo_email === sel.email) && <li className="text-ww-textMuted">Nenhuma mudança ainda.</li>}
                </ul>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

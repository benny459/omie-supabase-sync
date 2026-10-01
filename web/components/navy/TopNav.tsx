"use client";

/**
 * Navegação horizontal do Allka Navy — substitui o AppSidebar de hover-expand.
 *
 * Linha 1: marca · áreas em pills · busca ⌘K · avatar (com versão, senha, sair).
 * Linha 2: abas dos módulos da área activa, com sublinhado no activo.
 *
 * A regra que não pode quebrar: **exactamente os mesmos itens de sempre**.
 * Consome as MESMAS listas do AppSidebar (MODULES, FINANCEIRO, BI, ADMIN) e o
 * MESMO canViewArea. Não há aqui uma segunda definição de menu — se houvesse,
 * as duas divergiriam no primeiro item novo e alguém perderia acesso sem
 * ninguém dar por isso.
 *
 * Mantidos do sidebar: prefetch das rotas e o pendingHref (feedback imediato
 * na aba clicada enquanto o server-render corre).
 */

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { canViewArea } from "@/lib/permissions";
import { useUserPerms } from "../UserPermsProvider";
import { ADMIN, BI, FINANCEIRO, GRUPOS, MODULES, SECOES_BI, type Grupo, type NavItem } from "../AppSidebar";
import GlobalSearch from "../GlobalSearch";
import { supaBrowser } from "@/lib/supabase";

export default function TopNav({ userEmail }: { userEmail?: string | null }) {
  const pathname = usePathname();
  const router = useRouter();
  const perms = useUserPerms();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [menuAberto, setMenuAberto] = useState(false);
  const [, startTransition] = useTransition();
  const escolhaManual = useRef<Grupo | "sistema" | null>(null);

  useEffect(() => { setPendingHref(null); }, [pathname]);

  const todos = useMemo(() => [...MODULES, ...FINANCEIRO, ...BI], []);

  /* Prefetch sob demanda. Herdei do sidebar um prefetch de TODAS as rotas do
     menu à entrada — ~26 páginas renderizadas no servidor a cada carregamento
     de qualquer tela. Medido em produção: uma boa parte devolvia 503, porque
     são páginas dinâmicas pesadas a bater todas na mesma base ao mesmo tempo,
     a competir com o pedido de dados da tela que a pessoa está mesmo a ver.
     Prefetch que devolve 503 não aquece nada — só consome.

     Agora: nada à entrada; a rota é buscada quando o rato passa por cima dela
     (ou pela pill da área). O ganho de velocidade fica onde importa — o rato
     chega ao botão antes do clique — e o custo passa a ser de uma rota, não
     de vinte e seis. `jaPedidas` evita repetir ao passar o rato duas vezes. */
  const jaPedidas = useRef(new Set<string>());
  const aquecer = (href: string) => {
    if (jaPedidas.current.has(href)) return;
    jaPedidas.current.add(href);
    router.prefetch(href);
  };

  /* Áreas visíveis — mesma filtragem do sidebar. Área sem item visível não
     aparece: mostrar um separador vazio seria pior que não o mostrar. */
  /* Grupos visíveis: um item aparece se a pessoa pode abrir a área dele
     (permissão) — o grupo só decide em que botão ele fica. Grupo sem item
     visível não aparece. */
  const visivel = (m: NavItem) => !m.area || canViewArea(perms, m.area);
  const areasVisiveis = useMemo(
    () => GRUPOS.map((g) => g.id)
      .filter((g) => todos.some((m) => (m.grupo ?? m.area) === g && (!m.area || canViewArea(perms, m.area)))),
    [perms, todos],
  );

  /* O sidebar tinha um link Owner visivel so para o benny. Sem isto, mudar de
     menu tirava-lhe uma tela — e em silencio, que e o pior jeito de perder
     uma funcao. Mesma condicao, mesmo destino. */
  const OWNER: NavItem = {
    href: "/owner",
    label: "Owner",
    tone: "text-emerald-700",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}
           style={{ width: 18, height: 18 }} strokeLinecap="round" strokeLinejoin="round">
        <path d="M3 3v18h18" /><path d="M7 14l4-4 4 4 5-5" /><circle cx="20" cy="5" r="2" />
      </svg>
    ),
  };
  const ehOwner = (userEmail ?? "").toLowerCase() === "benny@waterworks.com.br";

  const itensDaArea = (a: Grupo | "sistema"): NavItem[] =>
    a === "sistema" ? (ehOwner ? [...ADMIN, OWNER] : ADMIN)
      : todos.filter((m) => (m.grupo ?? m.area) === a && visivel(m));

  /* Área activa: a do item que está aberto. Se o utilizador tiver clicado numa
     pill, essa manda até navegar — senão clicar numa área e não ver nada
     acontecer parecia um botão partido. */
  /* O item da rota é o de href MAIS LONGO que casa — /pcs/atribuir-cliente é
     do BI, /pcs é da Operação; sem isso o primeiro da lista ganhava. */
  const itemDaRota = useMemo(() => todos
    .filter((m) => pathname === m.href || pathname.startsWith(m.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null, [pathname, todos]);
  const areaDaRota = useMemo<Grupo | "sistema" | null>(() => {
    if (ADMIN.some((m) => pathname.startsWith(m.href))) return "sistema";
    return ((itemDaRota?.grupo ?? itemDaRota?.area) as Grupo) ?? null;
  }, [pathname, itemDaRota]);

  useEffect(() => { escolhaManual.current = null; }, [pathname]);
  const [areaSel, setAreaSel] = useState<Grupo | "sistema" | null>(null);
  const [secaoSel, setSecaoSel] = useState<string | null>(null);
  useEffect(() => { setSecaoSel(null); }, [pathname]);
  const areaActiva = areaSel ?? areaDaRota ?? areasVisiveis[0] ?? "sistema";

  /* Mesmo caminho do sidebar: nao ha rota /api/auth/signout, a sessao fecha
     no cliente. Um link para uma rota inexistente dava 404 e deixava a pessoa
     presa com a sessao aberta. */
  async function sair() {
    await supaBrowser().auth.signOut();
    window.location.href = "/login";
  }

  function navegar(href: string) {
    if (href === pathname) return;
    setPendingHref(href);
    startTransition(() => { router.push(href); });
  }

  /* Clicar numa área abre logo a primeira tela dela (pedido do Benny,
     01/10/2026) — antes só trocava as abas e a pessoa ficava na tela antiga.
     Se a rota atual já é dessa área, fica onde está. */
  function abrirArea(a: Grupo | "sistema") {
    setAreaSel(a);
    if (a === areaDaRota) return;
    const primeiro = itensDaArea(a)[0];
    if (primeiro) navegar(primeiro.href);
  }

  const doGrupo = itensDaArea(areaActiva);
  /* BI: relatórios agrupados em seções (Geral, Compras, Vendas, Financeiro) —
     uma linha de seções e, abaixo, só os relatórios da seção escolhida. */
  const secoes = areaActiva === "bi"
    ? SECOES_BI.filter((sc) => doGrupo.some((m) => (m.secao ?? "Geral") === sc)) : [];
  const secaoActiva = secaoSel ?? (itemDaRota?.grupo === "bi" ? itemDaRota.secao ?? "Geral" : null) ?? secoes[0] ?? null;
  const abas = areaActiva === "bi" ? doGrupo.filter((m) => (m.secao ?? "Geral") === secaoActiva) : doGrupo;
  const labelGrupo = (g: Grupo) => GRUPOS.find((x) => x.id === g)!;

  return (
    <header style={{ position: "sticky", top: 0, zIndex: 30, padding: "14px 28px 0", background: "var(--ww-bg)" }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 18, flexWrap: "wrap",
        padding: "10px 16px", borderRadius: "var(--radius-panel)",
        background: "var(--ww-panel-grad)", border: "1px solid var(--ww-border)",
        boxShadow: "var(--shadow-card)",
      }}>
        <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{
            width: 30, height: 30, borderRadius: 9, background: "var(--ww-brand-grad)",
            display: "grid", placeItems: "center", fontWeight: 700, color: "#fff",
          }}>W</span>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--ww-text)" }}>WaterWorks</span>
        </span>

        {/* Áreas */}
        <nav style={{ display: "flex", gap: 6, flexWrap: "wrap", flex: 1, minWidth: 0 }}>
          {areasVisiveis.map((a) => {
            const activa = a === areaActiva;
            return (
              <button key={a} type="button"
                onClick={() => abrirArea(a)}
                onMouseEnter={() => itensDaArea(a).forEach((m) => aquecer(m.href))}
                title={labelGrupo(a).desc}
                style={{
                  padding: "6px 13px", borderRadius: "var(--radius-pill)",
                  fontSize: "var(--text-body-sm)", fontWeight: activa ? 600 : 500, cursor: "pointer",
                  border: "1px solid " + (activa ? "var(--ww-accent)" : "var(--ww-border-strong)"),
                  color: activa ? "var(--ww-accent-text)" : "var(--ww-text-2)",
                  background: activa ? "var(--ww-accent-soft)" : "transparent",
                  boxShadow: activa ? "var(--ww-glow-chip)" : "none",
                }}>
                {labelGrupo(a).label}
              </button>
            );
          })}
          {ADMIN.length > 0 && (
            <button type="button" onClick={() => abrirArea("sistema")}
              onMouseEnter={() => itensDaArea("sistema").forEach((m) => aquecer(m.href))}
              style={{
                padding: "6px 13px", borderRadius: "var(--radius-pill)",
                fontSize: "var(--text-body-sm)", fontWeight: areaActiva === "sistema" ? 600 : 500,
                cursor: "pointer",
                border: "1px solid " + (areaActiva === "sistema" ? "var(--ww-accent)" : "var(--ww-border-strong)"),
                color: areaActiva === "sistema" ? "var(--ww-accent-text)" : "var(--ww-text-2)",
                background: areaActiva === "sistema" ? "var(--ww-accent-soft)" : "transparent",
              }}>
              Sistema
            </button>
          )}
        </nav>

        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GlobalSearch />
          {/* Avatar: leva o que estava no rodapé do sidebar. */}
          <span style={{ position: "relative" }}>
            <button type="button" onClick={() => setMenuAberto((v) => !v)}
              title={userEmail ?? undefined}
              style={{
                width: 32, height: 32, borderRadius: "50%", cursor: "pointer",
                background: "var(--ww-accent-soft)", color: "var(--ww-accent-text)",
                border: "1px solid var(--ww-border-strong)",
                fontSize: 12, fontWeight: 700,
              }}>
              {(userEmail ?? "?").slice(0, 2).toUpperCase()}
            </button>
            {menuAberto && (
              <>
                <span onClick={() => setMenuAberto(false)}
                      style={{ position: "fixed", inset: 0, zIndex: 40 }} />
                <span style={{
                  position: "absolute", right: 0, top: "calc(100% + 6px)", zIndex: 50,
                  minWidth: 220, display: "flex", flexDirection: "column",
                  borderRadius: "var(--radius-card)", padding: 8,
                  background: "var(--ww-panel)", border: "1px solid var(--ww-border)",
                  boxShadow: "var(--shadow-elevated)",
                }}>
                  <span style={{ padding: "6px 10px", fontSize: "var(--text-micro)", color: "var(--ww-text-faint)" }}>
                    {userEmail ?? "—"}
                    {process.env.NEXT_PUBLIC_APP_VERSION && ` · v${process.env.NEXT_PUBLIC_APP_VERSION}`}
                  </span>
                  <button type="button" onClick={sair} style={{
                    padding: "7px 10px", borderRadius: 8, fontSize: "var(--text-body-sm)",
                    color: "var(--ww-text-2)", background: "transparent", border: 0,
                    textAlign: "left", cursor: "pointer",
                  }}>Sair</button>
                </span>
              </>
            )}
          </span>
        </span>
      </div>

      {secoes.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "10px 8px 0" }}>
          <span style={{ fontSize: "var(--text-micro)", color: "var(--ww-text-faint)", textTransform: "uppercase", letterSpacing: "var(--tracking-label)", marginRight: 4 }}>
            Relatórios
          </span>
          {secoes.map((sc) => {
            const activa = sc === secaoActiva;
            return (
              <button key={sc} type="button" onClick={() => {
                  setSecaoSel(sc);
                  const primeiro = doGrupo.find((m) => (m.secao ?? "Geral") === sc);
                  if (primeiro && itemDaRota?.href !== primeiro.href) navegar(primeiro.href);
                }}
                style={{
                  padding: "4px 11px", borderRadius: "var(--radius-pill)", cursor: "pointer",
                  fontSize: "var(--text-meta)", fontWeight: activa ? 600 : 500,
                  border: "1px solid " + (activa ? "var(--ww-accent)" : "var(--ww-border)"),
                  color: activa ? "var(--ww-accent-text)" : "var(--ww-text-muted)",
                  background: activa ? "var(--ww-accent-soft)" : "transparent",
                }}>
                {sc}
              </button>
            );
          })}
        </div>
      )}

      {/* Abas dos módulos da área activa */}
      <div style={{
        display: "flex", alignItems: "center", gap: 4, padding: "8px 8px 0",
        borderBottom: "1px solid var(--ww-border-subtle)", overflowX: "auto",
      }}>
        {abas.map((m) => {
          const activo = itemDaRota?.href === m.href;
          const pendente = pendingHref === m.href;
          return (
            <button key={m.href} type="button" onClick={() => navegar(m.href)}
              onMouseEnter={() => aquecer(m.href)}
              onFocus={() => aquecer(m.href)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 7,
                padding: "9px 13px", border: 0, background: "transparent",
                cursor: "pointer", whiteSpace: "nowrap",
                fontSize: "var(--text-body-sm)", fontWeight: activo ? 700 : 500,
                color: activo ? "var(--ww-text)" : "var(--ww-text-muted)",
                borderBottom: "2px solid " + (activo ? "var(--ww-accent)" : "transparent"),
                opacity: pendente ? 0.55 : 1,
              }}>
              <span style={{ display: "grid", placeItems: "center", width: 18, height: 18 }}>
                {m.icon}
              </span>
              {m.label}
            </button>
          );
        })}
        {abas.length === 0 && (
          <span style={{ padding: "9px 4px", fontSize: "var(--text-meta)", color: "var(--ww-text-faint)" }}>
            Sem telas nesta área.
          </span>
        )}
      </div>
    </header>
  );
}

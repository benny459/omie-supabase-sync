"use client";

/**
 * A barra do topo ALLKA — conceito "menu superior por módulo" do Benny
 * (allka-portal-menu.html, 04/10/26).
 *
 * Cada módulo tem a sua cor e o seu ícone (os mesmos do cartão no Início do
 * portal); as abas agrupam-se Comercial · Operação · Gestão; o módulo aberto
 * acende na sua cor (fundo, contorno, sublinhado luminoso e a faixa sob a
 * barra). Sistema sai das abas e vira a engrenagem à direita. O símbolo de
 * logo Allka, à esquerda, leva ao Início do portal, com todos os módulos.
 *
 * Só a forma: o que cada botão faz continua a ser do app onde a barra está,
 * que o passa por props.
 *
 * ESTE FICHEIRO EXISTE IGUAL no painel (omie-supabase-sync/web) e no app de
 * serviços (waterworks-app), com o barra-allka.css ao lado. A referência é a
 * TopBar do portal (allka-platform/apps/portal/src/components/TopBar.tsx) e
 * lib/modulos-identidade.ts de lá — mudou lá, muda aqui nos dois.
 */

import { Fragment, useEffect, useRef, useState, type CSSProperties, type MouseEvent as RMouseEvent, type ReactNode } from "react";
import "./barra-allka.css";

export interface ItemModulo {
  label: string;
  href?: string;
  /** Acção em vez de link (ex.: "Ir para item"). */
  onClick?: () => void;
  /** Título de secção antes deste item (BI: Geral, Compras…). */
  secao?: string;
  activo?: boolean;
}

export interface ModuloBarra {
  /** crm · crm-allka · operacao · servicos · compras · estoque · financeiro · faturamento · bi · rh · sistema */
  id: string;
  nome: string;
  href: string;
  /** Sai do app (portal, outro domínio, /api/sso/...): <a> simples, sem prefetch. */
  externo?: boolean;
  /** Selo de texto ao lado do nome, como o "novo" do portal. */
  selo?: string;
  /** Pendências (ex.: NF-e sem pedido em Compras), na cor do módulo. */
  contador?: { n: number; titulo?: string };
  titulo?: string;
  itens?: ItemModulo[];
}

export interface BarraAllkaProps {
  modulos: ModuloBarra[];
  activo?: string | null;
  /** O Início do portal (marca e símbolo do menu levam para lá). */
  hubHref: string;
  /** Navegação interna do app (router.push). Sem ela, links normais. */
  navegar?: (href: string) => void;
  aquecer?: (href: string) => void;
  pendente?: string | null;
  /** Antes do símbolo do menu (o app de serviços põe aqui o botão do seu menu lateral). */
  antesDaMarca?: ReactNode;
  /** À direita: pesquisa, assistente, opções. */
  direita: ReactNode;
  /** Por último, depois da engrenagem do Sistema. */
  avatar?: ReactNode;
}

/* ── Identidade de cada módulo — cópia de lib/modulos-identidade.ts do portal ── */
type Icone = "crm" | "estrela" | "operacao" | "servicos" | "compras" | "estoque" | "financeiro" | "faturamento" | "bi" | "rh" | "sistema" | "modulo";
type Grupo = "comercial" | "operacao" | "gestao" | "outros";
const IDENT: Record<string, { cor: string; icone: Icone; grupo: Grupo | "sistema"; ordem: number }> = {
  crm: { cor: "#9A82FF", icone: "crm", grupo: "comercial", ordem: 1 },
  "crm-allka": { cor: "#C084FC", icone: "estrela", grupo: "comercial", ordem: 2 },
  operacao: { cor: "#3BB8FF", icone: "operacao", grupo: "operacao", ordem: 10 },
  servicos: { cor: "#19C6A6", icone: "servicos", grupo: "operacao", ordem: 11 },
  compras: { cor: "#FF8F73", icone: "compras", grupo: "operacao", ordem: 12 },
  estoque: { cor: "#F5C542", icone: "estoque", grupo: "operacao", ordem: 13 },
  financeiro: { cor: "#5C8BFF", icone: "financeiro", grupo: "gestao", ordem: 20 },
  faturamento: { cor: "#4FD1E8", icone: "faturamento", grupo: "gestao", ordem: 20.5 },
  bi: { cor: "#FF6FB5", icone: "bi", grupo: "gestao", ordem: 21 },
  rh: { cor: "#7DD3A8", icone: "rh", grupo: "gestao", ordem: 22 },
  sistema: { cor: "#8A93A3", icone: "sistema", grupo: "sistema", ordem: 99 },
};
const identidade = (id: string) => IDENT[id] ?? { cor: "#8A93A3", icone: "modulo" as Icone, grupo: "outros" as Grupo, ordem: 50 };
const GRUPOS: Grupo[] = ["comercial", "operacao", "gestao", "outros"];

const TRACOS: Record<Icone, ReactNode> = {
  crm: (<><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.3 3-5.2 6-5.2s5.4 1.9 6 5.2" /><path d="M16 4.5a3 3 0 0 1 0 6M18 14c1.7.6 2.8 2.2 3 5" /></>),
  estrela: <path d="M12 3l2.2 5.3L20 9l-4.4 3.8L17 18.5 12 15.6 7 18.5l1.4-5.7L4 9l5.8-.7z" />,
  operacao: (<><path d="M4 7h16M4 12h10M4 17h7" /><circle cx="18" cy="15.5" r="3" /><path d="M18 14v1.6l1 1" /></>),
  servicos: <path d="M14.5 6.5a4 4 0 0 0-5.3 5.3L4 17l3 3 5.2-5.2a4 4 0 0 0 5.3-5.3l-2.4 2.4-2.6-.6-.6-2.6z" />,
  compras: (<><path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.4-1.1L21 8H6.2" /><circle cx="9.5" cy="19.5" r="1.3" /><circle cx="17" cy="19.5" r="1.3" /></>),
  estoque: (<><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M4 7.5l8 4.5 8-4.5M12 12v9" /></>),
  financeiro: <path d="M4 18V9M10 18V5M16 18v-7M22 18H2" />,
  faturamento: (<><path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.3z" /><path d="M9 8h6M9 11.5h6M9 15h3.5" /></>),
  bi: (<><path d="M4 20V4M4 20h16" /><path d="M7 15l4-4 3 3 5-6" /></>),
  rh: (<><rect x="3.5" y="5" width="17" height="14" rx="2.5" /><circle cx="9" cy="11" r="2.2" /><path d="M5.8 16.2c.5-1.7 1.7-2.6 3.2-2.6s2.7.9 3.2 2.6M14.5 10h3.5M14.5 13.5h2.5" /></>),
  sistema: (<><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1" /></>),
  modulo: (<><rect x="4" y="4" width="7" height="7" rx="2" /><rect x="13" y="4" width="7" height="7" rx="2" /><rect x="4" y="13" width="7" height="7" rx="2" /><rect x="13" y="13" width="7" height="7" rx="2" /></>),
};
function IconeModulo({ nome, className }: { nome: Icone; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {TRACOS[nome]}
    </svg>
  );
}

const Chevron = () => (
  <svg className="ab-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

/** O anel "All" do conceito (o mesmo do portal). */
export function MarcaAllka({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" role="img" aria-label="Allka" style={{ flexShrink: 0 }}>
      <circle cx="20" cy="20" r="16" fill="none" stroke="currentColor" strokeOpacity=".18" strokeWidth="3" />
      <path d="M20 4 A16 16 0 1 1 6 28" fill="none" stroke="#6CCBFF" strokeWidth="3" strokeLinecap="round" />
      <circle cx="20" cy="4" r="2.4" fill="currentColor" />
      <text x="20" y="24.5" textAnchor="middle" fontFamily="var(--font-ak-brand), Outfit, sans-serif" fontSize="11" fontWeight="500" fill="currentColor">All</text>
    </svg>
  );
}

/** Símbolo do menu: nove pontos — leva ao Início com todos os módulos. */
export function IconeLancador() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      {[5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.9" />))}
    </svg>
  );
}

/** Fecha ao clicar fora e no Esc — o mesmo comportamento dos menus do portal. */
export function useFechaFora(aberto: boolean, fechar: () => void) {
  const caixa = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => { if (!caixa.current?.contains(e.target as Node)) fechar(); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") fechar(); };
    document.addEventListener("mousedown", fora);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", fora); document.removeEventListener("keydown", esc); };
  }, [aberto, fechar]);
  return caixa;
}

export default function BarraAllka({ modulos, activo, hubHref, navegar, aquecer, pendente, antesDaMarca, direita, avatar }: BarraAllkaProps) {
  const [tenantAberto, setTenantAberto] = useState(false);
  const [movelAberto, setMovelAberto] = useState(false);
  const caixaTenant = useFechaFora(tenantAberto, () => setTenantAberto(false));
  const caixaMovel = useFechaFora(movelAberto, () => setMovelAberto(false));

  const ir = (href: string, externo?: boolean) => (e: RMouseEvent) => {
    if (externo || !navegar || /^https?:/.test(href) || href.startsWith("/api/")) return;
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
    e.preventDefault();
    navegar(href);
  };

  const sistema = modulos.find((m) => m.id === "sistema");
  const abas = modulos.filter((m) => m.id !== "sistema");
  const grupos = GRUPOS
    .map((g) => abas.filter((m) => identidade(m.id).grupo === g).sort((a, b) => identidade(a.id).ordem - identidade(b.id).ordem))
    .filter((g) => g.length > 0);
  const modActivo = modulos.find((m) => m.id === activo);
  const cor = modActivo ? identidade(modActivo.id).cor : "#6CCBFF";

  return (
    <header className="ab" style={{ "--c": cor } as CSSProperties}>
      <div className="ab-esq">
        {antesDaMarca}
        <a className="ab-marca" href={hubHref} aria-label="Início — todos os módulos" title="Início · todos os módulos">
          <MarcaAllka size={28} />
          <span className="ab-marca-nome">Allka</span>
        </a>
        <span className="ab-barra">/</span>
        <div ref={caixaTenant} style={{ position: "relative" }}>
          <button type="button" className="ab-tenant" data-aberto={tenantAberto ? "1" : undefined}
            onClick={() => setTenantAberto((v) => !v)} aria-label="Tenant WaterWorks">
            <span className="ab-tenant-chip">WW</span>
          </button>
          {tenantAberto && (
            <div className="ab-lista" style={{ width: 240 }}>
              <div className="ab-titulo">Seus tenants</div>
              <a className="ab-item" href={hubHref}>
                <span className="ab-tenant-chip">WW</span>
                <b style={{ flex: 1, minWidth: 0 }}>WaterWorks</b>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
              </a>
            </div>
          )}
        </div>
      </div>

      <nav className="ab-nav" aria-label="Módulos">
        {grupos.map((g, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="ab-gsep" />}
            {g.map((m) => (
              <Modulo key={m.id} m={m} activo={m.id === activo} ir={ir} aquecer={aquecer} pendente={pendente} />
            ))}
          </Fragment>
        ))}
      </nav>

      <div className="ab-movel" ref={caixaMovel}>
        <button type="button" className="ab-tenant" onClick={() => setMovelAberto((v) => !v)}>
          {modActivo?.nome ?? "Módulos"} <Chevron />
        </button>
        {movelAberto && (
          <div className="ab-lista" style={{ left: "50%", transform: "translateX(-50%)", width: 240 }}>
            {modulos.map((m) => (
              <a key={m.id} className="ab-item" href={m.href} data-activo={m.id === activo ? "1" : undefined}
                style={{ "--c": identidade(m.id).cor } as CSSProperties}
                onClick={(e) => { setMovelAberto(false); ir(m.href, m.externo)(e); }}>
                <span className="ab-ponto" />
                <b>{m.nome}</b>
                {m.selo && <em className="ab-selo">{m.selo}</em>}
                {m.contador && m.contador.n > 0 && <em className="ab-contador">{m.contador.n}</em>}
              </a>
            ))}
          </div>
        )}
      </div>

      <div className="ab-dir">
        {direita}
        {sistema && <Modulo m={sistema} activo={sistema.id === activo} ir={ir} aquecer={aquecer} pendente={pendente} soIcone />}
        {avatar}
      </div>
      <span className="ab-faixa" />
    </header>
  );
}

function Modulo({ m, activo, ir, aquecer, pendente, soIcone }: {
  m: ModuloBarra; activo: boolean;
  ir: (href: string, externo?: boolean) => (e: RMouseEvent) => void;
  aquecer?: (href: string) => void; pendente?: string | null; soIcone?: boolean;
}) {
  const [aberto, setAberto] = useState(false);
  const fecho = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ancora = useRef<HTMLDivElement>(null);
  /* A lista sai em position: fixed, ancorada ao botão — a fila dos módulos
     pode ter overflow, e um overflow corta também na vertical. */
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const temLista = (m.itens?.length ?? 0) > 0;
  const id = identidade(m.id);

  const abrir = () => {
    if (fecho.current) clearTimeout(fecho.current);
    const r = ancora.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 10, left: Math.max(8, Math.min(soIcone ? r.right - 300 : r.left - 6, window.innerWidth - 310)) });
    if (temLista) setAberto(true);
    if (!m.externo && aquecer) { aquecer(m.href); m.itens?.forEach((i) => i.href && aquecer(i.href)); }
  };
  const fechar = () => {
    if (fecho.current) clearTimeout(fecho.current);
    fecho.current = setTimeout(() => setAberto(false), 160);
  };
  useEffect(() => () => { if (fecho.current) clearTimeout(fecho.current); }, []);

  return (
    <div className="ab-mod" ref={ancora} onMouseEnter={abrir} onMouseLeave={fechar} style={{ "--c": id.cor } as CSSProperties}>
      {soIcone ? (
        <a className="ab-icone" href={m.href} title={m.titulo ?? m.nome} aria-label={m.nome}
          data-aberto={aberto || activo ? "1" : undefined}
          onClick={(e) => { setAberto(false); ir(m.href, m.externo)(e); }}>
          <IconeModulo nome={id.icone} />
        </a>
      ) : (
        <a className="ab-mod-link" href={m.href} title={m.titulo ?? m.nome}
          data-activo={activo ? "1" : undefined} data-aberto={aberto ? "1" : undefined}
          data-pendente={pendente && pendente === m.href ? "1" : undefined}
          onClick={(e) => { setAberto(false); ir(m.href, m.externo)(e); }}>
          <IconeModulo nome={id.icone} className="ab-i" />
          <span className="ab-nome">{m.nome}</span>
          {m.selo && <em className="ab-selo">{m.selo}</em>}
          {m.contador && m.contador.n > 0 && <em className="ab-contador" title={m.contador.titulo}>{m.contador.n}</em>}
          {temLista && <Chevron />}
        </a>
      )}
      {aberto && temLista && (
        <div className="ab-lista ab-dd" onMouseEnter={abrir} onMouseLeave={fechar}
          style={pos ? { position: "fixed", top: pos.top, left: pos.left, marginTop: 0 } : undefined}>
          <div className="ab-dd-h"><IconeModulo nome={id.icone} /><span>{m.nome}</span></div>
          {m.itens!.map((s, i) => (
            <div key={`${s.label}-${i}`}>
              {s.secao && (<>{i > 0 && <div className="ab-sep" />}<div className="ab-titulo">{s.secao}</div></>)}
              {s.href ? (
                <a className="ab-item" href={s.href} data-activo={s.activo ? "1" : undefined}
                  onClick={(e) => { setAberto(false); if (s.onClick) { e.preventDefault(); s.onClick(); } else ir(s.href!, m.externo)(e); }}>
                  <span className="ab-ponto" /><b>{s.label}</b>
                </a>
              ) : (
                <button type="button" className="ab-item" onClick={() => { setAberto(false); s.onClick?.(); }}>
                  <span className="ab-ponto" /><b>{s.label}</b>
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ── peças da direita, iguais nos dois apps ── */

export function CampoPesquisa({ onAbrir, texto = "Pesquisar…" }: { onAbrir: () => void; texto?: string }) {
  return (
    <>
      <button type="button" className="ab-pesquisa" onClick={onAbrir} title="Pesquisar (⌘K)">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
        <span>{texto}</span>
        <kbd className="ab-kbd">⌘K</kbd>
      </button>
      <button type="button" className="ab-icone ab-pesquisa-icone" onClick={onAbrir} title="Pesquisar (⌘K)" aria-label="Pesquisar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></svg>
      </button>
    </>
  );
}

/** O botão do assistente, no desenho "Pergunte ao…" do conceito. */
export function BotaoAssistente({ nome, onClick, activo }: { nome: string; onClick: () => void; activo?: boolean }) {
  const inicial = nome.replace(/^Pergunte (à|ao|a|o)\s+/i, "").trim()[0] ?? "✦";
  return (
    <button type="button" className="ab-assistente" onClick={onClick} title={nome} aria-label={nome} aria-pressed={activo}>
      <i className="ab-assistente-orb">{inicial}</i>
      <span className="ab-assistente-nome">{nome}</span>
    </button>
  );
}

export const IconeOpcoes = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
  </svg>
);

export const IconeGrelha = IconeLancador;

/** Lançador antigo (lista de apps). Mantido para quem ainda o usa; a barra
 *  nova leva ao Início pelo símbolo do menu, à esquerda. */
export function Lancador({ itens }: { itens: { label: string; href: string; nota?: string }[] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useFechaFora(aberto, () => setAberto(false));
  return (
    <div ref={caixa} style={{ position: "relative" }}>
      <button type="button" className="ab-icone" aria-label="Apps" title="Apps" data-aberto={aberto ? "1" : undefined} onClick={() => setAberto((v) => !v)}>
        <IconeLancador />
      </button>
      {aberto && (
        <div className="ab-lista ab-lista-dir" style={{ width: 240 }}>
          <div className="ab-titulo">Apps WaterWorks</div>
          {itens.map((i) => (
            <a key={i.label} className="ab-item" href={i.href}>
              <span className="ab-ponto" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <b style={{ display: "block" }}>{i.label}</b>
                {i.nota && <span style={{ display: "block", fontSize: 11.5, color: "var(--ab-muted)" }}>{i.nota}</span>}
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

export function Avatar({ iniciais }: { iniciais: string }) {
  return <span className="ab-avatar">{iniciais}</span>;
}

"use client";

/**
 * A barra do topo do portal ALLKA, desenhada aqui (03/10/26).
 *
 * Pedido do Benny: navegar portal ↔ painel ↔ serviços tem de parecer um
 * sistema só. Esta é a TopBar do portal (allka-platform/apps/portal/src/
 * components/TopBar.tsx) medida a medida — altura, marca, chip do tenant,
 * módulos ao centro com a lista ao passar o rato, sublinhado no activo,
 * pesquisa, assistente, opções, lançador e avatar. Só a forma: o que cada
 * botão faz continua a ser do app onde a barra está, que o passa por props.
 *
 * ESTE FICHEIRO EXISTE IGUAL no painel (omie-supabase-sync/web) e no app de
 * serviços (waterworks-app), com o barra-allka.css ao lado. Mudou num, muda
 * no outro — e no portal, que é a referência.
 */

import { useEffect, useRef, useState, type MouseEvent as RMouseEvent, type ReactNode } from "react";
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
  id: string;
  nome: string;
  href: string;
  /** Sai do app (portal, outro domínio, /api/sso/...): <a> simples, sem prefetch. */
  externo?: boolean;
  /** Selo de texto ao lado do nome, como o "novo" do portal. */
  selo?: string;
  /** Contador vermelho (ex.: NF-e sem pedido em Compras). */
  contador?: { n: number; titulo?: string };
  titulo?: string;
  itens?: ItemModulo[];
}

export interface BarraAllkaProps {
  modulos: ModuloBarra[];
  activo?: string | null;
  /** Para onde vai a marca ALLKA (o hub do tenant no portal). */
  hubHref: string;
  /** Navegação interna do app (router.push). Sem ela, links normais. */
  navegar?: (href: string) => void;
  aquecer?: (href: string) => void;
  pendente?: string | null;
  /** Antes da marca (o app de serviços põe aqui o botão do seu menu lateral). */
  antesDaMarca?: ReactNode;
  /** Tudo à direita (pesquisa, assistente, opções, lançador, avatar). */
  direita: ReactNode;
}

const Chevron = () => (
  <svg className="ab-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="m6 9 6 6 6-6" />
  </svg>
);

/** O símbolo da ALLKA — o mesmo SVG do portal (components/design/marca-allka.tsx). */
export function MarcaAllka({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="ALLKA" style={{ flexShrink: 0 }}>
      <path d="M58.32 10.87 A40 40 0 0 1 85.32 31.22" stroke="#243381" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M88.81 40.32 A40 40 0 0 1 71.79 83.55" stroke="#3F6CF1" strokeWidth="7" strokeLinecap="round" fill="none" />
      <path d="M64.33 87.34 A40 40 0 0 1 10.02 48.60" stroke="#63B3F2" strokeWidth="7" strokeLinecap="round" fill="none" />
      <rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="0.8" fill="#C5C9D1" transform="translate(10.30 45.13) rotate(277)" />
      <rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="0.8" fill="#C5C9D1" transform="translate(13.18 34.37) rotate(293)" />
      <rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="0.8" fill="#C5C9D1" transform="translate(18.91 24.83) rotate(309)" />
      <rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="0.8" fill="#C5C9D1" transform="translate(27.06 17.23) rotate(325)" />
      <rect x="-3.2" y="-3.2" width="6.4" height="6.4" rx="0.8" fill="#C5C9D1" transform="translate(36.98 12.18) rotate(341)" />
      <circle cx="48.60" cy="10.02" r="3.3" fill="none" stroke="#63B3F2" strokeWidth="2.4" />
      <text x="50" y="62" textAnchor="middle" fontFamily="inherit" fontSize="34" fontWeight="600" fill="currentColor" letterSpacing="-1">All</text>
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

export default function BarraAllka({ modulos, activo, hubHref, navegar, aquecer, pendente, antesDaMarca, direita }: BarraAllkaProps) {
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

  const modActivo = modulos.find((m) => m.id === activo);

  return (
    <header className="ab">
      <div className="ab-esq">
        {antesDaMarca}
        <a className="ab-marca" href={hubHref} aria-label="Voltar ao hub" title="Portal ALLKA · WaterWorks">
          <MarcaAllka size={30} />
          <span className="ab-marca-nome">ALLKA</span>
        </a>
        <span className="ab-barra">/</span>
        <div ref={caixaTenant} style={{ position: "relative" }}>
          <button type="button" className="ab-tenant" data-aberto={tenantAberto ? "1" : undefined}
            onClick={() => setTenantAberto((v) => !v)} aria-label="Tenant WaterWorks">
            <span className="ab-tenant-chip">WW</span>
            <Chevron />
          </button>
          {tenantAberto && (
            <div className="ab-lista" style={{ width: 240 }}>
              <div className="ab-titulo">Seus tenants</div>
              <a className="ab-item" href={hubHref} style={{ paddingTop: 8, paddingBottom: 8 }}>
                <span className="ab-tenant-chip" style={{ width: 24, height: 24 }}>WW</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 14, fontWeight: 500 }}>WaterWorks</span>
                </span>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M20 6 9 17l-5-5" /></svg>
              </a>
            </div>
          )}
        </div>
      </div>

      <nav className="ab-nav" aria-label="Módulos">
        {modulos.map((m) => (
          <Modulo key={m.id} m={m} activo={m.id === activo} ir={ir} aquecer={aquecer} pendente={pendente} />
        ))}
      </nav>

      <div className="ab-movel" ref={caixaMovel}>
        <button type="button" className="ab-tenant" onClick={() => setMovelAberto((v) => !v)}>
          {modActivo?.nome ?? "Módulos"} <Chevron />
        </button>
        {movelAberto && (
          <div className="ab-lista" style={{ left: "50%", transform: "translateX(-50%)", width: 240 }}>
            {modulos.map((m) => (
              <div key={m.id}>
                <a className="ab-item" href={m.href} data-activo={m.id === activo ? "1" : undefined}
                  onClick={(e) => { setMovelAberto(false); ir(m.href, m.externo)(e); }}>
                  <span style={{ fontWeight: 500 }}>{m.nome}</span>
                  {m.selo && <span className="ab-selo">{m.selo}</span>}
                  {m.contador && m.contador.n > 0 && <span className="ab-contador">{m.contador.n}</span>}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="ab-dir">{direita}</div>
    </header>
  );
}

function Modulo({ m, activo, ir, aquecer, pendente }: {
  m: ModuloBarra; activo: boolean;
  ir: (href: string, externo?: boolean) => (e: RMouseEvent) => void;
  aquecer?: (href: string) => void; pendente?: string | null;
}) {
  const [aberto, setAberto] = useState(false);
  const fecho = useRef<ReturnType<typeof setTimeout> | null>(null);
  const temLista = (m.itens?.length ?? 0) > 0;

  const abrir = () => {
    if (fecho.current) clearTimeout(fecho.current);
    if (temLista) setAberto(true);
    if (!m.externo && aquecer) { aquecer(m.href); m.itens?.forEach((i) => i.href && aquecer(i.href)); }
  };
  const fechar = () => {
    if (fecho.current) clearTimeout(fecho.current);
    fecho.current = setTimeout(() => setAberto(false), 160);
  };
  useEffect(() => () => { if (fecho.current) clearTimeout(fecho.current); }, []);

  return (
    <div className="ab-mod" onMouseEnter={abrir} onMouseLeave={fechar}>
      <a className="ab-mod-link" href={m.href} title={m.titulo}
        data-activo={activo ? "1" : undefined} data-aberto={aberto ? "1" : undefined}
        data-pendente={pendente && pendente === m.href ? "1" : undefined}
        onClick={(e) => { setAberto(false); ir(m.href, m.externo)(e); }}>
        <span>{m.nome}</span>
        {m.selo && <span className="ab-selo">{m.selo}</span>}
        {m.contador && m.contador.n > 0 && <span className="ab-contador" title={m.contador.titulo}>{m.contador.n}</span>}
        {temLista && <Chevron />}
      </a>
      {activo && <span className="ab-sublinhado" />}
      {aberto && temLista && (
        <div className="ab-lista" onMouseEnter={abrir} onMouseLeave={fechar}>
          <div className="ab-titulo">{m.nome}</div>
          {m.itens!.map((s, i) => (
            <div key={`${s.label}-${i}`}>
              {s.secao && (<>{i > 0 && <div className="ab-sep" />}<div className="ab-titulo">{s.secao}</div></>)}
              {s.href ? (
                <a className="ab-item" href={s.href} data-activo={s.activo ? "1" : undefined}
                  onClick={(e) => { setAberto(false); if (s.onClick) { e.preventDefault(); s.onClick(); } else ir(s.href!, m.externo)(e); }}>
                  <span className="ab-ponto" />{s.label}
                </a>
              ) : (
                <button type="button" className="ab-item" onClick={() => { setAberto(false); s.onClick?.(); }}>
                  <span className="ab-ponto" />{s.label}
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
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
        <span>{texto}</span>
        <kbd className="ab-kbd">⌘K</kbd>
      </button>
      <button type="button" className="ab-icone ab-pesquisa-icone" onClick={onAbrir} title="Pesquisar (⌘K)" aria-label="Pesquisar">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="8" /><path d="m21 21-4.3-4.3" /></svg>
      </button>
    </>
  );
}

/** O botão do assistente, no desenho do "Pergunte à Aria" do portal. */
export function BotaoAssistente({ nome, onClick, activo }: { nome: string; onClick: () => void; activo?: boolean }) {
  return (
    <button type="button" className="ab-assistente" onClick={onClick} title={nome} aria-label={nome} aria-pressed={activo}>
      <span className="ab-assistente-orb">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor" aria-hidden><path d="M5.5 0 6.8 4.2 11 5.5 6.8 6.8 5.5 11 4.2 6.8 0 5.5 4.2 4.2z" /></svg>
      </span>
      <span className="ab-assistente-nome">{nome}</span>
    </button>
  );
}

export const IconeOpcoes = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4" />
  </svg>
);

export const IconeGrelha = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <rect width="18" height="18" x="3" y="3" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
  </svg>
);

/** Lançador (a grelha do portal): os três apps da WaterWorks. */
export function Lancador({ itens }: { itens: { label: string; href: string; nota?: string }[] }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useFechaFora(aberto, () => setAberto(false));
  return (
    <div ref={caixa} style={{ position: "relative" }}>
      <button type="button" className="ab-icone" aria-label="Launcher" title="Apps" data-aberto={aberto ? "1" : undefined} onClick={() => setAberto((v) => !v)}>
        <IconeGrelha />
      </button>
      {aberto && (
        <div className="ab-lista ab-lista-dir" style={{ width: 240 }}>
          <div className="ab-titulo">Apps WaterWorks</div>
          {itens.map((i) => (
            <a key={i.label} className="ab-item" href={i.href}>
              <span className="ab-ponto" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ display: "block" }}>{i.label}</span>
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

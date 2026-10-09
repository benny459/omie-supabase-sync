"use client";

/**
 * Barra do topo do painel — a mesma do portal ALLKA (03/10/26; desenho do
 * conceito "menu superior por módulo" desde 04/10/26, ver BarraAllka).
 *
 * Pedido do Benny: portal ↔ painel ↔ serviços têm de parecer um sistema só.
 * A forma vem de BarraAllka (cópia da TopBar do portal); aqui fica o que é do
 * painel: que módulos há, quem os vê, para onde vai cada clique.
 *
 * Mudanças em relação à barra anterior (só de lugar, nada saiu):
 * - Módulos na ordem do portal: CRM · Sistema · Operação · Compras · Estoque ·
 *   Financeiro · BI · Serviços. "Vendas" (Pedidos · PV/OS) passou para dentro
 *   de Operação — o portal não tem Vendas, e assim os dois menus são iguais.
 * - As abas da segunda linha (Avulsos | Projetos | …) viraram a lista de cada
 *   módulo, que abre ao passar o rato, como no portal.
 * - Versão, sincronização, paleta e tema saíram da linha de utilidades para o
 *   botão de opções (os sliders), como no portal; o Cesar ganhou o botão do
 *   assistente no desenho do "Pergunte à Aria".
 *
 * A regra que não pode quebrar continua: **exactamente os mesmos itens de
 * sempre** para cada pessoa. Consome as MESMAS listas do AppSidebar (MODULES,
 * FINANCEIRO, BI, ADMIN) e o MESMO canViewArea/podeAbrirRota.
 */

import PainelAparencia from "@/components/navy/PainelAparencia";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";
import { podeAbrirRota, canViewArea } from "@/lib/permissions";
import { useUserPerms } from "../UserPermsProvider";
import { ADMIN, BI, FINANCEIRO, GRUPOS, MODULES, SECOES_BI, SECOES_CADASTROS, type Grupo, type NavItem } from "../AppSidebar";
import GlobalSearch from "../GlobalSearch";
import SyncStatusBar from "../SyncStatusBar";
import VersionWatcher from "../VersionWatcher";
import SeletorPaleta from "../viz/SeletorPaleta";
import { useCesar } from "../cesar/CesarProvider";
import { supaBrowser } from "@/lib/supabase";
import { slugDaRota } from "@/lib/manual-rotas";
import { DialogoEntrada, EntradasOrdem, useAvisosOrdem, useEstadoOrdem, type EstadoOrdem } from "../ordem/SinoOrdem";
import type { ModuloOrdem } from "@/lib/ordem/tipos";
import BarraAllka, {
  Avatar, BotaoAssistente, IconeOpcoes, useFechaFora,
  type ItemModulo, type ModuloBarra,
} from "./BarraAllka";

const PORTAL_SSO = "/api/sso/portal?next=";
type Area = Grupo | "sistema";

/* Vendas mora em Operação na barra (o portal não tem Vendas). Só o botão muda:
   quem vê cada tela continua a decidir-se pela área do item. */
const grupoNaBarra = (m: NavItem): Grupo | undefined => {
  const g = (m.grupo ?? m.area) as Grupo | undefined;
  return g === "vendas" ? "operacao" : g;
};

type TelaRh = { label: string; next: string };
const RH_CHAVE = "ww-telas-rh";
const RH_TTL_MS = 5 * 60 * 1000;

/* RH na barra (05/10/26): pedido depois de a barra montar e guardado 5 min na
   sessão do navegador — antes vinha do layout com 2,5 s de limite e, com o
   portal frio, o RH simplesmente não aparecia. */
function useTelasRh(): TelaRh[] {
  const [telas, setTelas] = useState<TelaRh[]>([]);
  useEffect(() => {
    let vivo = true;
    try {
      const c = JSON.parse(sessionStorage.getItem(RH_CHAVE) ?? "null") as { em: number; telas: TelaRh[] } | null;
      if (c && Array.isArray(c.telas)) {
        setTelas(c.telas);
        if (Date.now() - c.em < RH_TTL_MS) return;
      }
    } catch { /* sem cache */ }
    fetch("/api/menu/rh", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (!vivo || !j || !Array.isArray(j.telas)) return;
      setTelas(j.telas);
      // vazio não fica guardado: pode ter sido o portal a falhar
      try { if (j.telas.length) sessionStorage.setItem(RH_CHAVE, JSON.stringify({ em: Date.now(), telas: j.telas })); } catch { /* ok */ }
    }).catch(() => null);
    return () => { vivo = false; };
  }, []);
  return telas;
}

export default function TopNav({ userEmail, isPlatformAdmin }: { userEmail?: string | null; isPlatformAdmin?: boolean }) {
  const pathname = usePathname();
  const router = useRouter();
  const perms = useUserPerms();
  const telasRh = useTelasRh();
  /* Central de Ordem (09/10/26): aba a mais nos módulos em que a pessoa já entra
     e que o administrador ligou (admin vê todos, em pré-visualização). Nada sai do menu. */
  const ordem = useEstadoOrdem(pathname ?? "");
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  useEffect(() => { setPendingHref(null); }, [pathname]);

  /* Selo vermelho em Compras: NF-e que chegaram sem pedido (não pagar até casar). */
  const [nfSemPedido, setNfSemPedido] = useState<{ n: number; valor: number; rcNovas: number }>({ n: 0, valor: 0, rcNovas: 0 });
  useEffect(() => {
    if (!canViewArea(perms, "erp")) return;
    let vivo = true;
    fetch("/api/compras/alerta").then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (vivo && j && typeof j.n === "number") setNfSemPedido({ n: j.n, valor: Number(j.valor) || 0, rcNovas: Number(j.rcNovas) || 0 }); }).catch(() => null);
    return () => { vivo = false; };
  }, [pathname, perms]);

  const todos = useMemo(() => [...MODULES, ...FINANCEIRO, ...BI], []);

  /* Prefetch sob demanda — só quando o rato passa pelo módulo (ver histórico:
     o prefetch de todas as rotas à entrada dava 503 em produção). */
  const jaPedidas = useRef(new Set<string>());
  const aquecer = useCallback((href: string) => {
    if (href.startsWith("/api/") || /^https?:/.test(href) || jaPedidas.current.has(href)) return;
    jaPedidas.current.add(href);
    router.prefetch(href);
  }, [router]);

  const visivel = (m: NavItem) => (!m.area || canViewArea(perms, m.area)) && podeAbrirRota(perms, m.href);

  /* O sidebar tinha um link Owner visivel so para o benny. Mesma condicao, mesmo destino. */
  const ehOwner = (userEmail ?? "").toLowerCase() === "benny@waterworks.com.br";
  const OWNER: NavItem = { href: "/owner", label: "Owner", tone: "text-emerald-700", icon: null };

  const itensDaArea = (a: Area): NavItem[] =>
    a === "sistema" ? (ehOwner ? [...ADMIN, OWNER] : ADMIN)
      : todos.filter((m) => grupoNaBarra(m) === a && visivel(m));

  /* O item da rota é o de href MAIS LONGO que casa — /pcs/atribuir-cliente é
     do BI, /pcs é da Operação; sem isso o primeiro da lista ganhava. */
  const itemDaRota = useMemo(() => todos
    .filter((m) => pathname === m.href || pathname.startsWith(m.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? null, [pathname, todos]);
  const areaDaRota: Area | null = ADMIN.some((m) => pathname.startsWith(m.href)) || pathname.startsWith("/owner")
    ? "sistema" : pathname.startsWith("/cadastros") ? "cadastros" : (itemDaRota ? grupoNaBarra(itemDaRota) ?? null : null);

  function navegar(href: string) {
    if (href === pathname) return;
    setPendingHref(href);
    startTransition(() => { router.push(href); });
  }

  const paraItens = (lista: NavItem[]): ItemModulo[] => lista.map((m) => ({
    label: m.label, href: m.href, activo: itemDaRota?.href === m.href || (pathname === m.href),
  }));

  /* Os mesmos módulos do portal; a barra agrupa-os (Comercial · Operação ·
     Gestão) e põe o Sistema na engrenagem. Área sem item visível não aparece. */
  const modulos: ModuloBarra[] = [];
  modulos.push({ id: "crm", nome: "CRM", href: `${PORTAL_SSO}/w/waterworks/crm`, externo: true, titulo: "CRM no portal ALLKA" });
  // CRM ALLKA (novo) saiu da barra a 05/10/26 — abre-se só pelo Início do portal.
  const sistema = itensDaArea("sistema");
  if (sistema.length > 0) {
    modulos.push({ id: "sistema", nome: "Sistema", href: sistema[0].href, itens: paraItens(sistema) });
  }
  for (const g of GRUPOS.map((x) => x.id).filter((x) => x !== "vendas")) {
    const itens = itensDaArea(g);
    if (itens.length === 0) continue;
    const def = GRUPOS.find((x) => x.id === g)!;
    let lista: ItemModulo[] = paraItens(itens);
    if (g === "bi") {
      // BI: os relatórios agrupados nas secções de sempre (Geral, Compras, Vendas, Financeiro).
      lista = SECOES_BI.flatMap((sc) => {
        const daSecao = itens.filter((m) => (m.secao ?? "Geral") === sc);
        return paraItens(daSecao).map((it, i) => (i === 0 ? { ...it, secao: sc } : it));
      });
    }
    if (g === "cadastros") {
      // Cadastros (05/10/26): todos os que vinham do Omie, agrupados (Pessoas, Itens, Projetos e vendas, Financeiro, Geral).
      lista = SECOES_CADASTROS.flatMap((sc) => {
        const daSecao = itens.filter((m) => (m.secao ?? "Geral") === sc);
        return paraItens(daSecao).map((it, i) => (i === 0 ? { ...it, secao: sc } : it));
      });
    }
    if (g === "estoque") {
      // "Ir para item" (⌘K da tela de estoque) vivia ao fim da linha de abas.
      lista = [...lista, {
        label: "Ir para item…", onClick: () => {
          if ((window as unknown as { __paletaEstoque?: number }).__paletaEstoque) window.dispatchEvent(new Event("estoque:paleta"));
          else navegar("/estoque?paleta=1");
        },
      }];
    }
    // Central de Ordem do módulo (aba a mais, no fim da lista).
    const daCentral = itensOrdem(ordem, g);
    if (daCentral.length) lista = [...lista, ...daCentral];
    // Um item só (Compras, BI simples): sem lista, como no portal.
    const semLista = itens.length === 1 && g !== "estoque" && daCentral.length === 0;
    modulos.push({
      id: g, nome: def.label, href: itens[0].href, titulo: def.desc,
      itens: semLista ? undefined : lista,
      // módulo de um item só que ganhou a Central: lista ao passar o rato, sem seta (a barra não alarga)
      semSeta: itens.length === 1 && daCentral.length > 0,
      // + RCs novas desde a última visita a Compras (sql/51)
      contador: g === "compras" && nfSemPedido.n + nfSemPedido.rcNovas > 0 ? {
        n: nfSemPedido.n + nfSemPedido.rcNovas,
        titulo: [
          nfSemPedido.n ? `${nfSemPedido.n} NF-e sem pedido · ${nfSemPedido.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} — não pagar até casar` : "",
          nfSemPedido.rcNovas ? `${nfSemPedido.rcNovas} requisição(ões) nova(s) para atender` : "",
        ].filter(Boolean).join(" · "),
      } : undefined,
    });
  }
  // Faturamento (05/10/26): aba própria, a seguir a Financeiro — emissão de NF pela Focus.
  const fat = FINANCEIRO.find((m) => m.href === "/faturamento");
  if (fat && visivel(fat)) {
    const fatOrdem = itensOrdem(ordem, "faturamento");
    modulos.push({ id: "faturamento", nome: "Faturamento", href: fat.href, titulo: "Emitir NF-e / NFS-e / recibo e acompanhar emissões",
      itens: fatOrdem.length ? [{ label: "Faturamento", href: fat.href, activo: pathname === fat.href }, ...fatOrdem] : undefined, semSeta: true });
  }
  modulos.push({ id: "servicos", nome: "Serviços", href: "https://app.waterworks.com.br", externo: true, titulo: "Plataforma de serviços (login próprio)" });
  // RH (03/10/26): módulo próprio, logo a seguir a Serviços, igual ao portal.
  // Mora na app de Serviços; entra pelo login único do portal, que leva ao
  // destino pedido. Só aparece para quem já abre o RH (lib/rh-menu.ts).
  if (telasRh.length > 0) {
    const rhSso = (next: string) => `https://allka.ai/api/sso/servicos?next=${encodeURIComponent(next)}`;
    modulos.push({
      id: "rh", nome: "RH", href: rhSso(telasRh[0].next), externo: true, titulo: "Recursos humanos (na app de Serviços)",
      itens: telasRh.map((t) => ({ label: t.label, href: rhSso(t.next) })),
    });
  }

  return (
    <BarraAllka
      modulos={modulos}
      activo={areaDaRota}
      hubHref={`${PORTAL_SSO}/w/waterworks`}
      navegar={navegar}
      aquecer={aquecer}
      pendente={pendingHref}
      direita={<Direita ordem={ordem} />}
      avatar={<MenuUtilizador email={userEmail} iniciais={iniciaisDe(userEmail)} ordem={ordem} />}
    />
  );
}

// Mesmas iniciais do portal (nome de exibição = parte local do e-mail).
function iniciaisDe(email?: string | null) {
  const local = (email ?? "").split("@")[0];
  return local.split(" ").map((p) => p[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "?";
}

/* Direita da barra (conceito 04/10/26): pesquisa, Cesar e opções; a
   engrenagem do Sistema e o avatar vêm a seguir, desenhados pela barra. O
   lançador de apps saiu — o símbolo do menu, à esquerda, leva ao Início do
   portal com todos os módulos. */
function Direita({ ordem }: { ordem: EstadoOrdem | null }) {
  const { abrir, aberto } = useCesar();
  return (
    <>
      <GlobalSearch gatilho="campo" />
      <BotaoAssistente nome={ordem?.assistente === "Aria" ? "Pergunte à Aria" : "Pergunte ao Cesar"} onClick={() => abrir()} activo={aberto} />
      <BotaoManual />
      <Opcoes />
    </>
  );
}

/* "?" — abre o manual na página da tela atual (05/10/26). */
function BotaoManual() {
  const pathname = usePathname() ?? "/";
  const slug = pathname.startsWith("/manual") ? null : slugDaRota(pathname);
  const href = slug ? `/manual/${slug}` : "/manual";
  return (
    <a className="ab-icone" href={href} title="Manual desta tela" aria-label="Manual"
      style={{ fontWeight: 700, fontSize: 15, display: "grid", placeItems: "center", textDecoration: "none" }}>
      ?
    </a>
  );
}

/**
 * O botão dos sliders — onde vivem as opções que antes ocupavam a linha de
 * utilidades: tema, paleta dos gráficos, sincronização e versão.
 *
 * Fica sempre montado (só se esconde) porque o VersionWatcher, cá dentro, é
 * quem levanta a faixa "há versão nova" — desmontá-lo calava o aviso.
 */
function Opcoes() {
  const [aberto, setAberto] = useState(false);
  const caixa = useFechaFora(aberto, () => setAberto(false));

  return (
    <div ref={caixa} style={{ position: "relative" }}>
      <button type="button" className="ab-icone" data-aberto={aberto ? "1" : undefined}
        onClick={() => setAberto((v) => !v)} aria-label="Opções de exibição" title="Opções de exibição">
        <IconeOpcoes />
      </button>
      <div className="ab-painel" style={{ display: aberto ? "block" : "none" }}>
        <div className="ab-titulo">Aparência</div>
        <PainelAparencia />
        <div className="ab-sep" />
        <div className="ab-linha">
          <span style={{ flex: 1 }}>Paleta dos gráficos</span>
          <SeletorPaleta />
        </div>
        <div className="ab-sep" />
        <div className="ab-titulo">Sistema</div>
        <div className="ab-linha" style={{ flexWrap: "wrap" }}>
          <SyncStatusBar />
        </div>
        <div className="ab-linha">
          <span style={{ flex: 1 }}>Versão</span>
          <VersionWatcher />
        </div>
      </div>
    </div>
  );
}

function MenuUtilizador({ email, iniciais, ordem }: { email?: string | null; iniciais: string; ordem: EstadoOrdem | null }) {
  const [aberto, setAberto] = useState(false);
  const caixa = useFechaFora(aberto, () => setAberto(false));

  const avisos = useAvisosOrdem(ordem);
  /* Não há rota /api/auth/signout: a sessão fecha no cliente. */
  async function sair() {
    await supaBrowser().auth.signOut();
    window.location.href = "/login";
  }

  return (
    <div ref={caixa} style={{ position: "relative" }}>
      <button type="button" className="ab-avatar-btn" onClick={() => setAberto((v) => !v)} title={email ?? undefined} aria-label="Conta" style={{ position: "relative" }}>
        <Avatar iniciais={iniciais} />
        {!!(ordem?.sino && avisos.av?.n) && <em className="ab-contador" style={{ position: "absolute", top: -4, right: -6 }} title="Avisos da Central de Ordem">{avisos.av!.n}</em>}
      </button>
      {avisos.dialogo && avisos.av && <DialogoEntrada av={avisos.av} onFechar={avisos.fecharDialogo} />}
      {aberto && (
        <div className="ab-lista ab-lista-dir" style={{ width: ordem?.central ? 300 : 224 }}>
          <div style={{ padding: "6px 10px" }}>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{(email ?? "").split("@")[0] || "—"}</div>
            <div style={{ fontSize: 11, color: "var(--ab-muted)" }}>{email ?? "—"}</div>
          </div>
          <div className="ab-sep" />
          {ordem?.central && <><EntradasOrdem estado={ordem} av={avisos.av} marcarLidos={avisos.marcarLidos} abrirDialogo={() => { setAberto(false); avisos.abrirDialogo(); }} /><div className="ab-sep" /></>}
          <a className="ab-item" href={`${PORTAL_SSO}/w/waterworks`}>Portal ALLKA</a>
          {process.env.NEXT_PUBLIC_APP_VERSION && (
            <div className="ab-nota">Painel v{process.env.NEXT_PUBLIC_APP_VERSION}</div>
          )}
          <div className="ab-sep" />
          <button type="button" className="ab-item ab-sair" onClick={sair}>Sair</button>
        </div>
      )}
    </div>
  );
}

/** Barra → módulos da Central de Ordem (Operação leva também Projetos). */
const ORDEM_DA_BARRA: Record<string, ModuloOrdem[]> = {
  operacao: ["operacao", "projetos"], compras: ["compras"], estoque: ["estoque"],
  financeiro: ["financeiro"], cadastros: ["cadastros"], faturamento: ["faturamento"],
};
const ROT_ORDEM: Record<string, string> = { operacao: "Operação", projetos: "Projetos" };

function itensOrdem(ordem: EstadoOrdem | null, g: string): ItemModulo[] {
  if (!ordem?.central) return [];
  const mods = (ORDEM_DA_BARRA[g] ?? []).filter((m) => ordem.modulos.includes(m));
  return mods.map((m, i) => ({
    label: mods.length > 1 ? `✦ Central de Ordem · ${ROT_ORDEM[m] ?? m}` : "✦ Central de Ordem",
    href: `/ordem?m=${m}`, secao: i === 0 ? "Aria" : undefined,
  }));
}

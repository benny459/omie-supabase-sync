"use client";

/**
 * Folha de Incluir/Alterar requisição ou pedido de compra — porte do mockup
 * (painel lateral grande, as abas do Omie + o que o Omie não tem: vínculo
 * requisição ⇄ pedido por item e histórico de preço).
 *
 * Pedido importado do Omie é histórico: abre só para leitura (dá para
 * duplicar, aprovar, receber e imprimir). Pedido do painel grava em compras.*.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import CodigoHoje from "./CodigoHoje";
import GerarPcDaRc from "@/components/operacao/GerarPcDaRc";
import ConversaEmail from "./ConversaEmail";
import CadastroFornecedorOverlay from "./CadastroFornecedorOverlay";
import Autocompletar, { type Opcao } from "./Autocompletar";
import PagamentoAntecipado from "./PagamentoAntecipado";
import { BotaoNovoProjeto } from "@/components/cadastros/NovoProjetoRapido";
import {
  ETAPAS, ETAPA, APROV_LABEL, TIPOS_FRETE, UFS, TIPOS_DOC, DEPTOS_PADRAO,
  money, num2, qtd as fq, parseNum, hoje, dBR, totais, totalItem, gerarParcelas, infoPreco, itemVazio, novaChave, erroVinculo,
  type Pedido, type Item, type Refs, type HistPreco, type Etapa, type Parcela,
  rotuloEnvio,
} from "@/lib/compras";

type RcAberta = {
  id: number; num: string; proj?: string; pv?: string; pvCliente?: string; emissao?: string; comprador?: string;
  itens: { id: number; seq: number; cod?: string; desc: string; un?: string; qtd: number; vu?: number; ncm?: string; cov: number }[];
};
type Forn = { cod: number; nome: string; fantasia?: string; cnpj?: string; transp?: boolean; n?: number;
  ultCatCod?: string; ultCat?: string; ultContato?: string; ultParc?: string };
type ItemCat = { ncod_prod: number; codigo: string | null; descricao: string; unidade: string | null; ultimo_preco: number | null;
  fornecedor: string | null; ultima_compra: string | null; codigo_omie?: string | null; via?: string };

/** PC × máximo da RC (06/10/26): itens da RC com o que os OUTROS pedidos já compraram. */
type RcResumo = { num: string; itens: { id: number; qtd: number; vuMax?: number; covOutros: number; valOutros?: number }[] };
const MARCA_ACIMA = "[acima do máximo da RC]";
type Tab = "itens" | "deptos" | "frete" | "parcelas" | "info" | "obs" | "emails";
type PagarLinha = { n: number; total: number; venc: string | null; valor: number; fase: string; parcial: boolean;
  liberado: number | null; nf: string | null; status: string; omie: string | null; origem: string };
/* Ciclo do pagar (sql/36): só "Liberado para pagar" é pagável. */
const FASE_PAGAR: Record<string, { label: string; dica: string }> = {
  previsto: { label: "Previsto", dica: "Pedido aprovado; a NF ainda não chegou" },
  aguardando_recebimento: { label: "Aguardando recebimento", dica: "NF casada — falta receber. Não pagar." },
  aguardando_conferencia: { label: "Aguardando conferência", dica: "Recebido — falta conferir. Não pagar." },
  liberado: { label: "✓ Liberado para pagar", dica: "Recebido e conferido" },
};

const json = async <T,>(r: Response): Promise<T> => {
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error((j as { error?: string }).error ?? r.statusText);
  return j as T;
};

function vazio(tipo: "RC" | "PC", emp: string): Pedido {
  return {
    id: null, tipo, num: "(novo)", etapa: tipo === "RC" ? "20" : "10", emp, forn: "", fornCod: null, cnpj: "",
    catCod: "", cat: "", comprador: "", compradorCod: null, projCod: null, proj: "", contaCod: null, conta: "",
    parc: "000", emissao: hoje(), previsao: hoje(), contato: "", numForn: "", contrato: "", obs: "", obsInt: "",
    pv: "", pvCliente: "", nf: "", chave: "", aprov: tipo === "RC" ? "na" : "nao_solicitada",
    frete: { tipo: TIPOS_FRETE[5] }, valor: 0, origem: "painel", itens: [], parcelas: [], deptos: [], hist: [],
  };
}

function doServidor(p: Pedido): Pedido {
  return {
    ...p,
    forn: p.forn ?? "", cnpj: p.cnpj ?? "", catCod: p.catCod ?? "", cat: p.cat ?? "", comprador: p.comprador ?? "",
    proj: p.proj ?? "", conta: p.conta ?? "", parc: p.parc ?? "000", previsao: p.previsao ?? "", contato: p.contato ?? "",
    numForn: p.numForn ?? "", contrato: p.contrato ?? "", obs: p.obs ?? "", obsInt: p.obsInt ?? "", pv: p.pv ?? "",
    pvCliente: p.pvCliente ?? "", nf: p.nf ?? "", chave: p.chave ?? "", frete: p.frete ?? {},
    itens: (p.itens ?? []).map((i) => ({ ...i, key: novaChave(), desc: i.desc ?? "", un: i.un ?? "UN",
      qtd: Number(i.qtd) || 0, vu: Number(i.vu) || 0, desc0: Number(i.desc0) || 0, ipi: Number(i.ipi) || 0, st: Number(i.st) || 0 })),
    parcelas: (p.parcelas ?? []).map((x) => ({ ...x, valor: Number(x.valor) || 0, venc: x.venc ?? "" })),
    deptos: (p.deptos ?? []).map((d) => ({ ...d, perc: Number(d.perc) || 0 })),
  };
}

export default function FolhaPedido({
  id, tipoNovo, fromRC, refs, emp, onClose, onSalvo, onReceber, onDuplicar, onImprimir, toast, onAbrir,
}: {
  id: number | null; tipoNovo?: "RC" | "PC"; fromRC?: number | null; refs: Refs | null; emp: string;
  onClose: () => void; onSalvo: (id: number, msg: string, abrirPcDaRc?: number) => void;
  onReceber: (id: number) => void; onDuplicar: (id: number) => void; onImprimir: (id: number) => void;
  toast: (m: string, erro?: boolean) => void;
  /** Abre outro pedido na folha (ex.: o PC recém-gerado a partir desta RC). */
  onAbrir?: (id: number) => void;
}) {
  const [D, setD] = useState<Pedido | null>(null);
  // Cadastro do fornecedor por cima da folha e respostas por e-mail ainda não lidas (06/10/26).
  const [cadForn, setCadForn] = useState(false);
  const [antecipar, setAntecipar] = useState(false); // pagamento antecipado (06/10/26)
  const [naoLidos, setNaoLidos] = useState(0);
  useEffect(() => {
    if (!id) return;
    fetch("/api/compras/email/conversa?naoLidos=1").then((r) => r.json()).then((j) => setNaoLidos(Number(j?.[String(id)] ?? 0))).catch(() => null);
  }, [id]);
  // RC (06/10/26): itens marcados para gerar o pedido de compra, e a folha compacta.
  const [selRc, setSelRc] = useState<Set<number>>(new Set());
  const [gerarPc, setGerarPc] = useState(false);
  const [pagar, setPagar] = useState<PagarLinha[]>([]);
  const [tab, setTab] = useState<Tab>("itens");
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [salvando, setSalvando] = useState(false);
  const [parcEditadas, setParcEditadas] = useState(false);
  const [hist, setHist] = useState<Record<string, HistPreco[]>>({});
  const [rcCache, setRcCache] = useState<Record<string, RcAberta>>({});
  const [rcView, setRcView] = useState<string | null>(null);
  const [rcLigadas, setRcLigadas] = useState<string[]>([]);
  const [marcas, setMarcas] = useState<Record<string, { on: boolean; qtd: number }>>({});
  const [picker, setPicker] = useState(false);
  /** "Puxar itens da Lista de materiais" (07/10/26): PC de projeto (PJ…) puxando as linhas da lista sem PC. */
  const [pickerLista, setPickerLista] = useState(false);
  const [colar, setColar] = useState<string | null>(null);
  const salvosRc = useRef<Record<number, number>>({}); // rcItemId → qtd já gravada por ESTE pedido
  const [pmax, setPmax] = useState<Record<number, number | null>>({}); // n_cod_prod → preço máximo de compra (Estoque)

  // Pedidos vindos do Omie também se editam aqui (06/10/26): nada volta ao Omie;
  // o pedido fica marcado "editado no painel" e a importação deixa de mexer nele.
  const ro = false;
  const isRC = D?.tipo === "RC";

  // ── carregar ──────────────────────────────────────────────────────────────
  useEffect(() => {
    let vivo = true;
    (async () => {
      try {
        if (id) {
          const p = doServidor(await json<Pedido>(await fetch(`/api/compras/pedido?id=${id}`)));
          if (!vivo) return;
          const s: Record<number, number> = {};
          p.itens.forEach((i) => { if (i.rc) s[i.rc.itemId] = (s[i.rc.itemId] ?? 0) + (Number(i.qtd) || 0); });
          salvosRc.current = s;
          setRcLigadas([...new Set(p.itens.filter((i) => i.rc).map((i) => i.rc!.num))]);
          setParcEditadas(p.parcelas.length > 0);
          setPagar((p as Pedido & { pagar?: PagarLinha[] }).pagar ?? []);
          setD(p);
        } else {
          const base = vazio(tipoNovo ?? "PC", emp);
          if (fromRC) {
            const rc = doServidor(await json<Pedido>(await fetch(`/api/compras/pedido?id=${fromRC}`)));
            const linhas = rc.itens
              .map((it) => ({ it, rest: Math.max(0, (Number(it.qtd) || 0) - (Number(it.cov) || 0)) }))
              .filter((x) => x.rest > 0);
            base.itens = linhas.map(({ it, rest }) => ({
              ...itemVazio(), cod: it.cod, ncodProd: it.ncodProd, desc: it.desc, un: it.un, qtd: rest, vu: Number(it.vu) || 0,
              ncm: it.ncm, local: it.local, rc: { itemId: it.id!, num: rc.num, idx: it.seq ?? 0, desc: it.desc, qtd: Number(it.qtd) || 0, vuMax: Number(it.vu) || undefined },
            }));
            base.proj = rc.proj; base.projCod = rc.projCod; base.pv = rc.pv; base.pvCliente = rc.pvCliente;
            base.comprador = rc.comprador; base.compradorCod = rc.compradorCod; base.cat = rc.cat; base.catCod = rc.catCod;
            base.contaCod = rc.contaCod; base.conta = rc.conta;
            if (vivo) setRcLigadas([rc.num]);
          }
          if (!vivo) return;
          setD(base);
        }
      } catch (e) { toast((e as Error).message, true); onClose(); }
    })();
    return () => { vivo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, tipoNovo, fromRC]);

  const t = useMemo(() => (D ? totais(D) : { merc: 0, desc: 0, ipi: 0, st: 0, extra: 0, total: 0 }), [D]);

  // ── PC × máximo da RC (06/10/26, Benny): a RC traz o custo máximo da CP; cada
  // item do pedido compara o valor líquido (unitário − desconto) com ele, e o
  // pedido soma a redução — e, se a RC fica atendida por inteiro, o total também.
  const rcNums = useMemo(() => (D && D.tipo !== "RC" ? [...new Set(D.itens.filter((i) => i.rc).map((i) => i.rc!.num))].sort().join(",") : ""), [D]);
  const [rcRes, setRcRes] = useState<RcResumo[]>([]);
  const [motivoAcima, setMotivoAcima] = useState("");
  useEffect(() => {
    if (!rcNums || !D) { setRcRes([]); return; }
    let vivo = true;
    (async () => {
      try {
        const r = await json<RcResumo[]>(await fetch(`/api/compras/buscar?tipo=rcresumo&emp=${D.emp}&q=${encodeURIComponent(rcNums)}${D.id ? `&excluir=${D.id}` : ""}`));
        if (vivo) setRcRes(Array.isArray(r) ? r : []);
      } catch { if (vivo) setRcRes([]); }
    })();
    return () => { vivo = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rcNums, D?.id, D?.emp]);
  const vuLiq = (i: { qtd: number; vu: number; desc0: number }) =>
    (Number(i.vu) || 0) - ((Number(i.qtd) || 0) > 0 ? (Number(i.desc0) || 0) / Number(i.qtd) : 0);
  const maxDe = (i: Item): number | undefined => {
    if (!i.rc) return undefined;
    if (i.rc.vuMax != null && i.rc.vuMax > 0) return i.rc.vuMax;
    const v = rcRes.flatMap((r) => r.itens).find((x) => x.id === i.rc!.itemId)?.vuMax;
    return v != null && v > 0 ? v : undefined;
  };
  const cmpRc = useMemo(() => {
    if (!D || D.tipo === "RC") return null;
    const lig = D.itens.filter((i) => maxDe(i) != null && Number(i.qtd) > 0);
    if (!lig.length) return null;
    const maxT = lig.reduce((a, i) => a + Number(i.qtd) * maxDe(i)!, 0);
    const este = lig.reduce((a, i) => a + Number(i.qtd) * vuLiq(i), 0);
    const acima = lig.filter((i) => vuLiq(i) > maxDe(i)! + 0.005);
    const excesso = acima.reduce((a, i) => a + Number(i.qtd) * (vuLiq(i) - maxDe(i)!), 0);
    const integral = rcRes.map((r) => {
      const deste = (id: number) => D.itens.filter((i) => i.rc?.itemId === id);
      if (!r.itens.length || r.itens.some((x) => x.vuMax == null)) return null;
      const cheia = r.itens.every((x) => x.covOutros + deste(x.id).reduce((a, i) => a + (Number(i.qtd) || 0), 0) >= x.qtd - 0.0001);
      if (!cheia) return null;
      const maxR = r.itens.reduce((a, x) => a + x.qtd * (x.vuMax ?? 0), 0);
      const pcs = r.itens.reduce((a, x) => a + (x.valOutros ?? 0) + deste(x.id).reduce((s2, i) => s2 + Number(i.qtd) * vuLiq(i), 0), 0);
      return { num: r.num, maxR, pcs };
    }).filter((x): x is { num: string; maxR: number; pcs: number } => !!x);
    return { maxT, este, acima, excesso, integral };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [D, rcRes]);
  const diasDe = useCallback((cod: string) => refs?.parcelas.find((p) => p.cod === cod)?.dias ?? [0], [refs]);

  // Parcelas acompanham total, condição e previsão até alguém mexer nelas à mão.
  useEffect(() => {
    if (!D || isRC || ro || parcEditadas) return;
    const novas = gerarParcelas(t.total, diasDe(D.parc), D.previsao || hoje(), D.parcelas[0]?.doc ?? "Boleto");
    const igual = novas.length === D.parcelas.length && novas.every((p, i) => p.venc === D.parcelas[i].venc && p.valor === D.parcelas[i].valor);
    if (!igual) setD((d) => (d ? { ...d, parcelas: novas } : d));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t.total, D?.parc, D?.previsao, isRC, ro, parcEditadas, refs]);

  // Preço máximo de compra cadastrado no Estoque (P7): só avisa, não bloqueia.
  useEffect(() => {
    if (!D) return;
    const falta = [...new Set(D.itens.map((i) => Number(i.ncodProd)).filter((x) => Number.isFinite(x) && x !== 0 && !(x in pmax)))];
    if (!falta.length) return;
    (async () => {
      try {
        const m = await json<Record<string, number>>(await fetch(`/api/estoque/preco-max?prods=${falta.join(",")}`));
        setPmax((x) => { const n = { ...x }; for (const id of falta) n[id] = m[String(id)] ?? null; return n; });
      } catch { setPmax((x) => { const n = { ...x }; for (const id of falta) n[id] = null; return n; }); }
    })();
  }, [D, pmax]);

  // Histórico de preço por código de produto (carrega o que faltar).
  useEffect(() => {
    if (!D) return;
    const falta = [...new Set(D.itens.map((i) => i.cod).filter((c): c is string => !!c && !(c in hist)))];
    falta.forEach(async (c) => {
      try {
        const h = await json<HistPreco[]>(await fetch(`/api/compras/buscar?tipo=preco&q=${encodeURIComponent(c)}`));
        setHist((x) => ({ ...x, [c]: h.filter((r) => r.id !== D.id) }));
      } catch { setHist((x) => ({ ...x, [c]: [] })); }
    });
  }, [D, hist]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape" && !picker && !cadForn && !document.querySelector(".cmp .aclist")) onClose(); };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [onClose, picker, cadForn]);

  if (!D) {
    return (
      <div className="cmp-scrim"><div className="cmp" style={{ display: "contents" }}>
        <div className="sheet"><div className="sh-head"><h2>Carregando…</h2><span className="sp" />
          <button className="btn ghost" onClick={onClose}>Fechar ✕</button></div></div>
      </div></div>
    );
  }

  const set = (patch: Partial<Pedido>) => setD((d) => (d ? { ...d, ...patch } : d));
  const setItem = (i: number, patch: Partial<Item>) =>
    setD((d) => (d ? { ...d, itens: d.itens.map((it, k) => (k === i ? { ...it, ...patch } : it)) } : d));

  // ── requisição ⇄ pedido ─────────────────────────────────────────────────────
  const covEfetiva = (rcItemId: number, covServidor: number) =>
    Math.max(0, covServidor - (salvosRc.current[rcItemId] ?? 0)) +
    D.itens.filter((i) => i.rc?.itemId === rcItemId).reduce((a, i) => a + (Number(i.qtd) || 0), 0);

  const levarDaRc = (rc: RcAberta, sel: { itemId: number; qtd: number }[]) => {
    const novos: Item[] = sel.map(({ itemId, qtd }) => {
      const it = rc.itens.find((x) => x.id === itemId)!;
      return { ...itemVazio(), cod: it.cod ?? "", desc: it.desc, un: it.un ?? "UN", qtd, vu: Number(it.vu) || 0, ncm: it.ncm,
        rc: { itemId: it.id, num: rc.num, idx: it.seq, desc: it.desc, qtd: Number(it.qtd) || 0, vuMax: Number(it.vu) || undefined } };
    });
    setD((d) => d ? {
      ...d, itens: [...d.itens, ...novos],
      proj: d.proj || rc.proj || "", pv: d.pv || rc.pv || "", pvCliente: d.pvCliente || rc.pvCliente || "",
      comprador: d.comprador || rc.comprador || "",
    } : d);
    setRcLigadas((l) => [...new Set([...l, rc.num])]);
    setTab("itens");
  };

  const buscarRc = async (q: string): Promise<Opcao<RcAberta>[]> => {
    const lista = await json<RcAberta[]>(await fetch(`/api/compras/buscar?tipo=rc&q=${encodeURIComponent(q)}`));
    setRcCache((c) => ({ ...c, ...Object.fromEntries(lista.map((r) => [r.num, r])) }));
    return lista.map((rc) => ({
      label: `RC ${rc.num} · ${rc.proj || "sem projeto"}${rc.pv ? ` · ${rc.pv}${rc.pvCliente ? " " + rc.pvCliente : ""}` : ""}`,
      sub: `${dBR(rc.emissao)} · ${rc.itens.length} item(ns): ${rc.itens.map((i) => i.desc).join(", ").slice(0, 90)}`, v: rc,
    }));
  };

  // ── validação ─────────────────────────────────────────────────────────────
  const validar = () => {
    const e: Record<string, string> = {};
    if (!isRC && !D.forn) e.forn = 'O "Fornecedor" deve ser preenchido.';
    if (!isRC && !D.cat) e.cat = 'A "Categoria da Compra" deve ser preenchida.';
    if (!D.itens.length) e.itens = "Inclua pelo menos 1 item.";
    else if (D.itens.some((i) => !(Number(i.qtd) > 0))) e.itens = "Há item com quantidade zerada.";
    else if (D.itens.some((i) => !i.desc.trim())) e.itens = "Há item sem descrição.";
    const sp = D.deptos.reduce((a, d) => a + (Number(d.perc) || 0), 0);
    if (D.deptos.length && Math.abs(sp - 100) > 0.01) e.deptos = `Distribuição soma ${num2(sp)}% — precisa fechar 100%.`;
    const sv = D.parcelas.reduce((a, x) => a + (Number(x.valor) || 0), 0);
    if (!isRC && D.itens.length && Math.abs(t.total - sv) > 0.05) e.parcelas = `Parcelas somam ${money(sv)}, pedido ${money(t.total)}. Use "Refazer parcelas".`;
    const ev = !e.itens ? erroVinculo(D) : null;
    if (ev) e.vinculo = ev;
    const jaTemMotivo = (D.obsInt ?? "").includes(MARCA_ACIMA);
    if (!isRC && cmpRc?.acima.length && !motivoAcima.trim() && !jaTemMotivo) e.itens = `${cmpRc.acima.length} item(ns) acima do máximo da RC — escreva o motivo em "Pronto para salvar?".`;
    setErrs(e);
    if (Object.keys(e).length) {
      setTab(e.forn || e.cat || e.itens || e.vinculo ? "itens" : e.deptos ? "deptos" : "parcelas");
      toast("Revise os campos destacados para salvar.", true);
      return false;
    }
    return true;
  };

  /** Obs. interna com a marca "[acima do máximo da RC]" (a fila de aprovação mostra) —
   *  refeita a cada gravação: sai quando os itens voltam ao máximo. */
  const obsComMarca = () => {
    const base = (D?.obsInt ?? "").split("\n").filter((l) => !l.startsWith(MARCA_ACIMA)).join("\n").trim();
    if (isRC || !cmpRc?.acima.length) return base;
    const antigo = (D?.obsInt ?? "").split("\n").find((l) => l.startsWith(MARCA_ACIMA));
    const motivo = motivoAcima.trim() || (antigo ? antigo.replace(/^.*?—\s*/, "") : "");
    const linha = `${MARCA_ACIMA} ${cmpRc.acima.length} item(ns), +${money(cmpRc.excesso)} sobre o máximo — ${motivo}`;
    return [linha, base].filter(Boolean).join("\n");
  };

  const salvar = async (o: { novaEtapa?: Etapa; novaAprov?: "aguardando"; aprovar?: boolean; gerarPc?: boolean; msg?: string } = {}) => {
    if (ro || salvando || !validar()) return;
    setSalvando(true);
    try {
      const body = {
        id: D.id, tipo: D.tipo, emp: D.emp, fornCod: D.fornCod, forn: D.forn, cnpj: D.cnpj, catCod: D.catCod, cat: D.cat,
        comprador: D.comprador, compradorCod: D.compradorCod, projCod: D.projCod, proj: D.proj, contaCod: D.contaCod,
        conta: D.conta, parc: D.parc, previsao: D.previsao, contato: D.contato, numForn: D.numForn, contrato: D.contrato,
        obs: D.obs, obsInt: obsComMarca(), pv: D.pv, pvCliente: D.pvCliente, frete: D.frete,
        ...(isRC ? {} : { semRc: !!D.semRc, semRcMotivo: D.semRc ? D.semRcMotivo ?? "" : null,
                          avulsa: !!D.avulsa, avulsaMotivo: D.avulsa ? D.avulsaMotivo ?? "" : null }),
        itens: D.itens.map((i) => ({ id: i.id ?? null, cod: i.cod, ncodProd: i.ncodProd, desc: i.desc, un: i.un, qtd: i.qtd,
          vu: i.vu, desc0: i.desc0, ipi: i.ipi, st: i.st, ncm: i.ncm, local: i.local, obs: i.obs,
          rc: i.rc ? { itemId: i.rc.itemId } : null, listaId: i.listaId ?? null })),
        parcelas: isRC ? [] : D.parcelas, deptos: isRC ? [] : D.deptos,
        novaEtapa: o.novaEtapa, novaAprov: o.novaAprov,
        origemDe: !D.id && rcLigadas.length ? `Gerado a partir da RC ${rcLigadas.join(", ")}` : undefined,
      };
      const r = await json<{ id: number; num: string }>(await fetch("/api/compras/pedido", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
      }));
      let msg = o.msg ?? `${isRC ? "Requisição" : "Pedido"} ${r.num} salvo${rcLigadas.length && !isRC ? ` · atende ${rcLigadas.map((n) => "RC " + n).join(", ")}` : ""}`;
      if (o.aprovar) {
        const a = await json<{ alterados: number; falhas: { erro: string }[] }>(await fetch("/api/compras/acao", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ acao: "aprovar", ids: [r.id], status: "aprovado" }),
        }));
        msg = a.falhas.length ? `Pedido ${r.num} salvo, mas não aprovado: ${a.falhas[0].erro}` : `Pedido ${r.num} aprovado`;
      }
      onSalvo(r.id, msg, o.gerarPc ? r.id : undefined);
    } catch (e) { toast((e as Error).message, true); }
    finally { setSalvando(false); }
  };

  // sem coluna de Aprovação: a etapa 15 aparece como "Pedido de Compra"
  // sem Aprovação (fica no Pedido de Compra) e sem Enviado (aprovado = enviado) desde 01/10/26
  const idxEtapa = ETAPAS.filter((e) => e.cod !== "15" && e.cod !== "35").findIndex((e) => e.cod === (D.etapa === "15" || D.etapa === "35" ? "10" : D.etapa));
  const titulo = !D.id ? (isRC ? "Incluir Requisição de Compra" : "Incluir Pedido de Compra")
    : isRC ? `Requisição Nº ${D.num}` : `Pedido de Compra Nº ${D.num}`;
  const tabs: [Tab, string, string | number, string?][] = isRC
    ? [["itens", "Itens da Compra", D.itens.length, errs.itens], ["info", "Informações Adicionais", ""], ["obs", "Observações", D.obs || D.obsInt ? "•" : ""]]
    : [["itens", "Itens da Compra", D.itens.length, errs.itens || errs.vinculo], ["deptos", "Departamentos", D.deptos.length || "", errs.deptos],
       ["frete", "Frete e Outras Despesas", t.extra ? "R$" : ""], ["parcelas", "Parcelas", D.parcelas.length, errs.parcelas],
       ["info", "Informações Adicionais", ""], ["obs", "Observações", D.obs || D.obsInt ? "•" : ""],
       ...(D.id ? [["emails", "E-mails", naoLidos ? `${naoLidos} nova${naoLidos > 1 ? "s" : ""}` : ""] as [Tab, string, string | number]] : [])];
  const tabAtual: Tab = isRC && !["itens", "info", "obs"].includes(tab) ? "itens" : tab;
  const deptosLista = refs?.departamentos.length ? refs.departamentos.map((d) => d.desc) : DEPTOS_PADRAO;
  const rcAtual = rcView ? rcCache[rcView] : null;

  return (
    <div className="cmp-scrim cheia">
      <div className="cmp" style={{ display: "contents" }}>
        <div className="sheet" role="dialog" aria-modal="true" aria-label={titulo} style={{ ["--c" as string]: ETAPA[D.etapa]?.cor }}>
          <div className="sh-head">
            <h2>{titulo}</h2>
            {D.id && <span className="pill" style={{ background: ETAPA[D.etapa]?.cor, color: "#fff" }}>{ETAPA[D.etapa]?.nome}</span>}
            {D.origem === "omie" ? <span className="tag orig-omie" title="Veio do Omie — pode ser editado aqui; nada é gravado no Omie">Veio do Omie</span>
              : <span className="tag orig-painel">Emitido pela plataforma</span>}
            {D.editadoPainel && <span className="tag orig-painel" title={`Editado no painel${D.editadoPor ? ` por ${D.editadoPor}` : ""}${D.editadoEm ? ` em ${new Date(D.editadoEm).toLocaleString("pt-BR")}` : ""} — a importação do Omie não sobrescreve mais este pedido`}>editado no painel</span>}
            {!isRC && (() => { const e = rotuloEnvio(D); return e
              ? <span className={`pill selo-env${e.teste ? " teste" : ""}`} title={e.dica}>{e.texto}</span>
              : D.id && D.aprov === "aprovado" && D.origem === "painel" ? <span className="pill" title="Aprovado e ainda não enviado ao fornecedor" style={{ opacity: .8 }}>não enviado</span> : null; })()}
            <span className="sp" />
            <div className="stepper" aria-label="Etapas">
              {ETAPAS.filter((e) => e.cod !== "15" && e.cod !== "35").map((e, i, arr) => (
                <span key={e.cod} style={{ display: "contents" }}>
                  <span className={i < idxEtapa ? "done" : i === idxEtapa ? "cur" : ""} style={{ ["--c" as string]: e.cor }}>{e.nome}</span>
                  {i < arr.length - 1 && <i>›</i>}
                </span>
              ))}
            </div>
            <button className="btn ghost" onClick={onClose}>Fechar ✕</button>
          </div>

          <div className="sh-body">
            <div style={{ minWidth: 0 }}>
              {ro && (
                <div className="aviso p-off">
                  Pedido importado do Omie — é histórico e fica só para leitura. Para comprar de novo, use <b>Duplicar</b>: o pedido novo nasce no painel.
                </div>
              )}
              <section className="card2">
                <div className="gridf">
                  <div className="f s6">
                    <label htmlFor="dForn">Fornecedor {isRC ? <span className="faint">(opcional na requisição)</span> : <span className="req">*</span>}</label>
                    <Autocompletar<Forn> id="dForn" value={D.forn} disabled={ro} erro={!!errs.forn}
                      placeholder="Busque por nome, fantasia ou CNPJ"
                      onChange={(v) => set({ forn: v, fornCod: null, cnpj: "" })}
                      fonte={async (q) => (await json<Forn[]>(await fetch(`/api/compras/buscar?tipo=fornecedor&emp=${D.emp}&q=${encodeURIComponent(q)}`)))
                        .map((f) => ({ label: f.nome, sub: `${f.cnpj ?? "sem CNPJ no cadastro"}${f.n ? ` · ${f.n} pedido(s)` : ""}`, v: f }))}
                      onPick={(o) => {
                        const f = o.v;
                        setD((d) => d ? {
                          ...d, forn: f.nome, fornCod: f.cod, cnpj: f.cnpj ?? "",
                          cat: d.cat || f.ultCat || "", catCod: d.catCod || f.ultCatCod || "",
                          contato: d.contato || f.ultContato || "", parc: !d.id && f.ultParc ? f.ultParc : d.parc,
                        } : d);
                        setErrs((e) => { const n = { ...e }; delete n.forn; return n; });
                        toast(f.ultCat ? "Categoria, contato e condição sugeridos pelo último pedido deste fornecedor" : "Fornecedor selecionado");
                      }} />
                    {errs.forn ? <span className="errmsg">{errs.forn}</span>
                      : D.cnpj || D.fornCod ? <span className="hint">{D.cnpj ? `CNPJ ${D.cnpj}` : ""}
                          <button type="button" className="linkbtn" style={{ marginLeft: 8 }} title="Abre o cadastro do fornecedor por cima deste pedido (e-mails, contatos…)"
                            onClick={() => setCadForn(true)}>abrir cadastro ↗</button></span>
                      : !ro && !D.fornCod ? <span className="hint">Não achou? <a href={`/cadastros/novo?papel=fornecedor&emp=${D.emp}${D.forn ? `&razao=${encodeURIComponent(D.forn)}` : ""}`} target="_blank" rel="noreferrer" style={{ textDecoration: "underline" }}>Cadastrar fornecedor</a> (abre em outra aba; depois é só buscar de novo)</span> : null}
                  </div>
                  <div className="f s3"><label htmlFor="dPrev">{isRC ? "Data limite de entrega" : "Previsão de Entrega"}</label>
                    <input className="in" type="date" id="dPrev" value={D.previsao || ""} disabled={ro} onChange={(e) => set({ previsao: e.target.value })} />
                    {(() => { const r = (D as { previsaoRemarcada?: string | null }).previsaoRemarcada; return r && r !== D.previsao
                      ? <span className="hint" title="Remarcada na Operação › Projetos (Prev. material) — é a data que vale para o material deste PC">remarcada para <b>{r.split("-").reverse().join("/")}</b></span> : null; })()}</div>
                  <div className="f s3"><label htmlFor="dEmis">Inclusão</label>
                    <input className="in" type="date" id="dEmis" value={D.emissao || ""} disabled /></div>
                  <div className="f s4"><label htmlFor="dCat">Categoria da Compra {!isRC && <span className="req">*</span>}</label>
                    <select className={`in${errs.cat ? " err" : ""}`} id="dCat" disabled={ro} value={D.catCod || ""}
                      onChange={(e) => { const c = refs?.categorias.find((x) => x.cod === e.target.value); set({ catCod: c?.cod ?? "", cat: c?.desc ?? "" }); }}>
                      <option value="">{D.cat && !refs?.categorias.some((c) => c.cod === D.catCod) ? D.cat : "Selecione…"}</option>
                      {refs?.categorias.map((c) => <option key={c.cod} value={c.cod}>{c.cod} · {c.desc}</option>)}
                    </select>
                    {errs.cat && <span className="errmsg">{errs.cat}</span>}</div>
                  <div className="f s4"><label htmlFor="dComp">Comprador</label>
                    <select className="in" id="dComp" disabled={ro} value={D.comprador || ""}
                      onChange={(e) => { const c = refs?.compradores.find((x) => x.nome === e.target.value); set({ comprador: e.target.value, compradorCod: c?.cod ?? null }); }}>
                      <option value="">—</option>
                      {D.comprador && !refs?.compradores.some((c) => c.nome === D.comprador) && <option>{D.comprador}</option>}
                      {refs?.compradores.map((c) => <option key={c.nome}>{c.nome}</option>)}
                    </select></div>
                  {isRC ? (
                    <div className="f s4"><label htmlFor="dPv">Venda de origem (PV/OS) {ro && <span className="faint">— dá para vincular/trocar</span>}</label>
                      <Autocompletar<{ label: string; cliente: string; projeto?: string }> id="dPv" disabled={false}
                        value={D.pv ? `${D.pv}${D.pvCliente ? " · " + D.pvCliente : ""}` : ""} placeholder="Busque PV/OS ou cliente"
                        onChange={(v) => { if (!v) set({ pv: "", pvCliente: "" }); }}
                        fonte={async (q) => (await json<{ label: string; cliente: string; projeto?: string }[]>(
                          await fetch(`/api/compras/buscar?tipo=venda&emp=${D.emp}&q=${encodeURIComponent(q)}`)))
                          .map((v) => ({ label: `${v.label} · ${v.cliente}`, sub: v.projeto || "sem projeto", v }))}
                        onPick={async (o) => {
                          set({ pv: o.v.label, pvCliente: o.v.cliente, proj: D.proj || o.v.projeto || "" });
                          if (D.id) { // RC existente: grava o vínculo na hora (vale também para as do Omie)
                            try {
                              const r = await fetch("/api/compras/acao", { method: "POST", headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ acao: "venda", id: D.id, pv: o.v.label, cliente: o.v.cliente }) });
                              if (!r.ok) throw new Error((await r.json()).error); toast(`Requisição vinculada a ${o.v.label}`);
                            } catch (e) { toast((e as Error).message, true); }
                          }
                        }} />
                      <span className="hint">A RC nasce da venda fechada — o pedido herda esse vínculo.</span></div>
                  ) : (
                    <div className="f s4"><label htmlFor="dParc">Número de Parcelas</label>
                      <select className="in" id="dParc" disabled={ro} value={D.parc}
                        onChange={(e) => { setParcEditadas(false); set({ parc: e.target.value }); }}>
                        {!refs?.parcelas.some((p) => p.cod === D.parc) && <option value={D.parc}>{D.parc}</option>}
                        {refs?.parcelas.map((p) => <option key={p.cod} value={p.cod}>{p.desc}</option>)}
                      </select></div>
                  )}
                  {!isRC && !ro && (
                    <div className="f s12"><label htmlFor="dRc">Requisição de compra (RC) <span className="faint">— vincule uma ou mais; os itens aparecem logo abaixo</span></label>
                      <Autocompletar<RcAberta> id="dRc" value="" placeholder="Busque a RC por número, projeto, venda (PV/OS), cliente ou produto"
                        fonte={buscarRc}
                        onPick={(o) => {
                          setRcLigadas((l) => [...new Set([...l, o.v.num])]); setRcView(o.v.num);
                          setD((d) => d ? { ...d, proj: d.proj || o.v.proj || "", pv: d.pv || o.v.pv || "", pvCliente: d.pvCliente || o.v.pvCliente || "" } : d);
                        }} />
                      {rcLigadas.length > 0 && (
                        <div className="chips">
                          {rcLigadas.map((n) => {
                            const fixa = D.itens.some((i) => i.rc?.num === n);
                            const rc = rcCache[n];
                            const done = rc ? rc.itens.filter((i) => covEfetiva(i.id, i.cov) >= i.qtd).length : null;
                            return (
                              <span key={n} className={`chip-x${rcView === n ? " on" : ""}`}
                                onClick={async () => {
                                  if (!rcCache[n]) await buscarRc(n);
                                  setRcView((v) => (v === n ? null : n));
                                }}>
                                RC {n}{rc?.pv ? ` · ${rc.pv}` : ""}{done != null ? ` · ${done}/${rc!.itens.length} no pedido` : ""}
                                {!fixa && <button title="Remover" onClick={(e) => { e.stopPropagation(); setRcLigadas((l) => l.filter((x) => x !== n)); if (rcView === n) setRcView(null); }}>✕</button>}
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!isRC && rcAtual && (() => {
                  const linhas = rcAtual.itens.map((it) => {
                    const cov = covEfetiva(it.id, it.cov);
                    const rest = Math.max(0, it.qtd - cov);
                    const k = `${rcAtual.num}|${it.id}`;
                    const m = marcas[k] ?? { on: rest > 0, qtd: rest };
                    return { it, cov, rest, k, m };
                  });
                  const sel = linhas.filter((l) => l.rest > 0 && l.m.on && l.m.qtd > 0);
                  return (
                    <div className="rcbox">
                      <div className="rch">
                        <b>Itens da Requisição {rcAtual.num}</b><span className="tag">{rcAtual.proj || "sem projeto"}</span>
                        {rcAtual.pv && <span className="tag">↔ {rcAtual.pv}{rcAtual.pvCliente ? " · " + rcAtual.pvCliente : ""}</span>}
                        <span className="faint">{dBR(rcAtual.emissao)} · {rcAtual.comprador || "—"}</span><span style={{ flex: 1 }} />
                        <button className="btn sm pri" disabled={!sel.length}
                          onClick={() => { levarDaRc(rcAtual, sel.map((l) => ({ itemId: l.it.id, qtd: l.m.qtd })));
                            setMarcas((mm) => { const n = { ...mm }; sel.forEach((l) => delete n[l.k]); return n; });
                            toast(`${sel.length} item(ns) da RC ${rcAtual.num} levados para o pedido`); }}>
                          ↓ Levar {sel.length || ""} {sel.length === 1 ? "item" : "itens"} para o pedido</button>
                        <button className="btn sm ghost" onClick={() => setRcView(null)}>Ocultar</button>
                      </div>
                      <div style={{ overflowX: "auto" }}>
                        <table className="items">
                          <thead><tr><th style={{ width: 34 }} /><th>Item da requisição</th><th className="r">Pedido na RC</th><th className="r">Já em pedido</th><th className="r">A comprar agora</th></tr></thead>
                          <tbody>{linhas.map(({ it, cov, rest, k, m }) => {
                            const last = hist[it.cod ?? ""]?.find((x) => x.f);
                            return (
                              <tr key={k} className={rest <= 0 ? "done" : ""}>
                                <td>{rest > 0 ? <input type="checkbox" checked={m.on} aria-label="Selecionar"
                                  onChange={(e) => setMarcas((mm) => ({ ...mm, [k]: { ...m, on: e.target.checked } }))} /> : "✓"}</td>
                                <td>{it.desc}<div className="hint mono">{it.cod}{last ? ` · última compra ${money(last.vu)} (${last.f}, ${dBR(last.d)})` : ""}</div></td>
                                <td className="r num">{fq(it.qtd)} {it.un}</td>
                                <td className="r num">{cov ? fq(cov) : "—"}</td>
                                <td style={{ width: 120 }}>{rest > 0
                                  ? <input className="in r" defaultValue={num2(m.qtd)} onBlur={(e) => { const v = parseNum(e.target.value); setMarcas((mm) => ({ ...mm, [k]: { on: v > 0, qtd: v } })); }} />
                                  : <span className="pill p-ok">no pedido</span>}</td>
                              </tr>
                            );
                          })}</tbody>
                        </table>
                      </div>
                    </div>
                  );
                })()}

                <div className="totals">
                  <div><div className="k">Total de Mercadorias</div><div className="v num">{money(t.merc)}</div></div>
                  <div><div className="k">Total do Desconto</div><div className="v num">{money(t.desc)}</div></div>
                  <div><div className="k">Total de IPI</div><div className="v num">{money(t.ipi)}</div></div>
                  <div><div className="k">Total de ICMS ST</div><div className="v num">{money(t.st)}</div></div>
                  {t.extra > 0 && <div><div className="k">Frete e despesas</div><div className="v num">{money(t.extra)}</div></div>}
                  <div className="grand"><div className="k">Valor Total da Compra</div><div className="v num">{money(t.total)}</div></div>
                </div>
                {cmpRc && (
                  <div className="hint" style={{ margin: "-4px 0 10px", display: "flex", gap: 14, flexWrap: "wrap", alignItems: "center" }}>
                    <span><b>vs RC</b> · máximo {money(cmpRc.maxT)} · este pedido {money(cmpRc.este)} ·{" "}
                      {cmpRc.este <= cmpRc.maxT + 0.005
                        ? <b style={{ color: "var(--ww-ok-text, #16a34a)" }}>redução {money(cmpRc.maxT - cmpRc.este)} ({num2(cmpRc.maxT ? ((cmpRc.maxT - cmpRc.este) / cmpRc.maxT) * 100 : 0)}%)</b>
                        : <b style={{ color: "var(--ww-crit-text)" }}>acima {money(cmpRc.este - cmpRc.maxT)} ({num2(cmpRc.maxT ? ((cmpRc.este - cmpRc.maxT) / cmpRc.maxT) * 100 : 0)}%)</b>}
                      {cmpRc.acima.length > 0 && <span style={{ color: "var(--ww-crit-text)" }}> · {cmpRc.acima.length} item(ns) acima do máximo</span>}</span>
                    {cmpRc.integral.map((r) => (
                      <span key={r.num} className="pill p-acc" title="Todos os itens e quantidades da RC estão cobertos por pedidos de compra (este e os anteriores)">
                        RC {r.num} atendida integralmente · máximo {money(r.maxR)} · comprado {money(r.pcs)} ·{" "}
                        {r.pcs <= r.maxR + 0.005 ? `redução ${money(r.maxR - r.pcs)}` : `acima ${money(r.pcs - r.maxR)}`}
                      </span>))}
                  </div>
                )}

                <nav className="tabs" role="tablist">
                  {tabs.map(([k, l, b, e]) => (
                    <button key={k} role="tab" className={tabAtual === k ? "on" : ""} onClick={() => setTab(k)}>
                      {l}{b !== "" && b !== 0 ? <span className={`bdg${e ? " e" : ""}`}>{b}</span> : e ? <span className="bdg e">!</span> : null}
                    </button>
                  ))}
                </nav>

                {tabAtual === "itens" && (
                  <>
                    {!isRC && (
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10, padding: "9px 10px",
                        border: "1px solid var(--line)", borderRadius: 10, background: "var(--accent-soft)" }}>
                        <b style={{ fontSize: 12.5 }}>Requisições atendidas por este pedido</b>
                        {[...new Set(D.itens.filter((i) => i.rc).map((i) => i.rc!.num))].map((n) => <span key={n} className="pill p-acc">RC {n}</span>)}
                        {!D.itens.some((i) => i.rc) && <span className="muted">nenhuma ainda</span>}
                        <span style={{ flex: 1 }} />
                        {!ro && <button className="btn sm pri" onClick={() => setPicker(true)}>⇠ Vincular requisição</button>}
                      </div>
                    )}
                    {!isRC && (D.origem === "painel" || D.origem === "omie") && (
                      <div className="cp-vinculo" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10, padding: "9px 10px",
                        border: `1px solid ${errs.vinculo ? "var(--danger, #EF4444)" : "var(--line)"}`, borderRadius: 10 }}>
                        <div>
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, fontWeight: 600 }}>
                            <input type="checkbox" disabled={ro} checked={!!D.semRc}
                              onChange={(e) => set({ semRc: e.target.checked })} />
                            Pedido sem RC <span className="faint" style={{ fontWeight: 400 }}>— vai a aprovação</span>
                          </label>
                          {D.semRc && <input className="in" disabled={ro} style={{ marginTop: 6 }} value={D.semRcMotivo ?? ""}
                            placeholder="Motivo (obrigatório): ex. reposição urgente de estoque"
                            onChange={(e) => set({ semRcMotivo: e.target.value })} />}
                          {!D.semRc && <span className="hint">Cada item precisa vir de uma requisição (⇠ Vincular requisição).</span>}
                        </div>
                        <div>
                          <div style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 4 }}>Venda (PV/OS)</div>
                          {!D.avulsa && (
                            <Autocompletar<{ label: string; cliente: string; projeto?: string }> value={D.pv ? `${D.pv}${D.pvCliente ? " · " + D.pvCliente : ""}` : ""} disabled={ro}
                              placeholder="Busque o PV/OS da venda" onChange={(v) => { if (!v) set({ pv: "", pvCliente: "" }); }}
                              fonte={async (q) => (await json<{ label: string; cliente: string; projeto?: string }[]>(await fetch(`/api/compras/buscar?tipo=venda&emp=${D.emp}&q=${encodeURIComponent(q)}`)))
                                .map((v) => ({ label: `${v.label} · ${v.cliente}`, sub: v.projeto || "sem projeto", v }))}
                              onPick={(o) => set({ pv: o.v.label, pvCliente: o.v.cliente })} />
                          )}
                          <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12.5, marginTop: 6 }}>
                            <input type="checkbox" disabled={ro} checked={!!D.avulsa}
                              onChange={(e) => set({ avulsa: e.target.checked, ...(e.target.checked ? { pv: "", pvCliente: "" } : {}) })} />
                            Compra avulsa (estoque / uso interno), sem venda
                          </label>
                          {D.avulsa && <input className="in" disabled={ro} style={{ marginTop: 6 }} value={D.avulsaMotivo ?? ""}
                            placeholder="Motivo (obrigatório)" onChange={(e) => set({ avulsaMotivo: e.target.value })} />}
                        </div>
                        {errs.vinculo && <div className="errmsg" style={{ gridColumn: "1 / -1" }}>{errs.vinculo}</div>}
                      </div>
                    )}
                    {errs.itens && <div className="errmsg" style={{ marginBottom: 8 }}>{errs.itens}</div>}
                    <div className="items-wrap">
                      <table className="items fix">
                        <thead><tr>
                          <th style={{ width: 34 }}>{isRC && D.id ? (() => {
                            const livres = D.itens.filter((x) => x.id && Math.max(0, (Number(x.qtd) || 0) - (Number((x as Item & { cov?: number }).cov) || 0)) > 0).map((x) => Number(x.id));
                            const todos = livres.length > 0 && livres.every((x) => selRc.has(x));
                            return <input type="checkbox" title="Marcar todos os itens que ainda faltam comprar" checked={todos} disabled={!livres.length}
                              onChange={() => setSelRc(todos ? new Set() : new Set(livres))} />;
                          })() : "#"}</th><th>Produto</th><th style={{ width: 62 }}>Un</th>
                          <th className="r" style={{ width: 82 }}>Qtde</th><th className="r" style={{ width: 104 }}>Valor unit.</th>
                          <th className="r" style={{ width: 92 }}>Desconto R$</th><th className="r" style={{ width: 84 }}>IPI R$</th>
                          <th className="r" style={{ width: 92 }}>ICMS ST R$</th><th className="r" style={{ width: 112 }}>Total</th><th style={{ width: 64 }} />
                        </tr></thead>
                        <tbody>
                          {D.itens.map((it, i) => {
                            const pi = it.cod ? infoPreco(it, D.forn, hist[it.cod]) : null;
                            const cls = pi ? (Math.abs(pi.dif) < 1 ? "p-off" : pi.dif > 0 ? (pi.dif > 10 ? "p-crit" : "p-warn") : "p-ok") : "";
                            return [
                              <tr key={it.key}>
                                <td className="faint num" style={{ paddingTop: 11 }}>
                                  {isRC && D.id && it.id ? (() => {
                                    const falta = Math.max(0, (Number(it.qtd) || 0) - (Number((it as Item & { cov?: number }).cov) || 0));
                                    return <input type="checkbox" title={falta > 0 ? "Marcar para gerar o pedido de compra" : "Item já todo em pedido de compra"}
                                      disabled={falta <= 0} checked={selRc.has(Number(it.id))}
                                      onChange={() => setSelRc((x) => { const n = new Set(x); if (n.has(Number(it.id))) n.delete(Number(it.id)); else n.add(Number(it.id)); return n; })} />;
                                  })() : i + 1}
                                </td>
                                <td style={{ position: "relative" }}>
                                  <Autocompletar<ItemCat> value={it.desc} disabled={ro} minimo={2} placeholder="Busque o produto (código ou descrição)"
                                    onChange={(v) => setItem(i, { desc: v })}
                                    fonte={async (q) => (await json<ItemCat[]>(await fetch(`/api/compras/buscar?tipo=produto&q=${encodeURIComponent(q)}`)))
                                      .map((p) => ({ label: p.descricao, sub: `${p.codigo ?? "—"}${p.via ? ` (${p.via})` : p.codigo_omie && p.codigo_omie !== p.codigo ? ` (era ${p.codigo_omie})` : ""} · ${p.unidade ?? "UN"}${p.ultimo_preco ? ` · último preço ${money(p.ultimo_preco)}` : ""}${p.fornecedor ? ` · ${p.fornecedor}` : ""}`, v: p }))}
                                    onPick={(o) => setItem(i, { cod: o.v.codigo ?? "", ncodProd: o.v.ncod_prod, desc: o.v.descricao,
                                      un: o.v.unidade ?? "UN", vu: Number(o.v.ultimo_preco) || it.vu })} />
                                  <div className="hint mono">{it.cod || "novo"}{it.ncm ? ` · NCM ${it.ncm}` : ""}</div>
                                  {it.cod ? <CodigoHoje cod={it.cod} /> : null}
                                  {isRC && it.id ? (() => {
                                    const pcs = ((D as Pedido & { pcsPorItem?: Record<string, { id: number; num: string }[]> }).pcsPorItem ?? {})[String(it.id)] ?? [];
                                    return pcs.length
                                      ? <div className="hint" style={{ color: "var(--accent-strong)" }}>em pedido de compra {pcs.map((x, k) => (
                                          <span key={x.id}>{k ? ", " : ""}<button className="linkbtn" title={`Abrir o PC ${x.num}`} onClick={() => (onAbrir ? onAbrir(x.id) : null)}>PC {x.num}</button></span>))}</div>
                                      : <div className="hint faint">sem pedido de compra ainda</div>;
                                  })() : null}
                                  {it.rc && (
                                    <div className="hint" style={{ color: "var(--accent-strong)" }}>
                                      ⇠ RC {it.rc.num} · item {it.rc.idx}{it.desc !== it.rc.desc ? ` · na requisição: “${it.rc.desc}”` : ""}
                                      {!ro && <button className="linkbtn" onClick={() => setItem(i, { rc: null })} title="Desvincular da requisição">desvincular</button>}
                                    </div>
                                  )}
                                  {(() => {
                                    const lim = it.ncodProd ? pmax[Number(it.ncodProd)] : null;
                                    const acimaLim = lim != null && it.vu > lim + 0.005;
                                    const mx = !isRC ? maxDe(it) : undefined;
                                    const liq = vuLiq(it);
                                    const difRc = mx != null ? liq - mx : 0;
                                    const pctRc = mx ? (difRc / mx) * 100 : 0;
                                    if (!acimaLim && mx == null) return null;
                                    return (
                                      <div className="pricecmp">
                                        {mx != null && (Math.abs(difRc) < 0.005
                                          ? <span className="pill p-off" title={`Valor da RC ${it.rc!.num} (custo máximo orçado na CP)`}>= máximo da RC</span>
                                          : difRc > 0
                                            ? <span className="pill p-crit" title={`Valor da RC ${it.rc!.num} (custo máximo orçado na CP)`}>▲ {num2(pctRc)}% acima do máximo da RC (máx {money(mx)})</span>
                                            : <span className="pill p-ok" title={`Valor da RC ${it.rc!.num} (custo máximo orçado na CP)`}>▼ redução de {money(-difRc * (Number(it.qtd) || 0))} ({num2(-pctRc)}%) vs máximo da RC</span>)}
                                        {acimaLim && <span className="pill p-crit">▲ acima do preço máximo do item ({money(lim!)})</span>}
                                      </div>
                                    );
                                  })()}
                                  {it.cod && (pi ? (
                                    <div className="pricecmp">
                                      <span className={`pill ${cls}`}>{Math.abs(pi.dif) < 1 ? "= " : pi.dif > 0 ? "▲ " : "▼ "}{num2(Math.abs(pi.dif))}% vs {pi.sameForn ? "último deste fornecedor" : "última compra"}</span>
                                      <span className="faint">{money(pi.ref.vu)} em {dBR(pi.ref.d)}{pi.ref.f ? " · " + pi.ref.f : ""}</span>
                                      <button className="linkbtn" onClick={() => setItem(i, { _hist: !it._hist })}>{it._hist ? "fechar histórico" : `histórico (${pi.h.length})`}</button>
                                    </div>
                                  ) : hist[it.cod] ? <div className="pricecmp faint">Sem compras anteriores deste item</div> : null)}
                                </td>
                                <td><input className="in" value={it.un} disabled={ro} onChange={(e) => setItem(i, { un: e.target.value })} /></td>
                                {(["qtd", "vu", "desc0", "ipi", "st"] as const).map((k) => (
                                  <td key={k}><input className="in r" disabled={ro} key={`${it.key}-${k}-${it[k]}`} defaultValue={k === "qtd" ? fq(it[k]) : num2(it[k])}
                                    onBlur={(e) => { const v = parseNum(e.target.value); if (v !== it[k]) setItem(i, { [k]: v } as Partial<Item>); }} /></td>
                                ))}
                                <td className="r num" style={{ paddingTop: 11 }}><b>{money(totalItem(it))}</b>
                                  {it.rec != null && ["40", "60", "80"].includes(D.etapa) && <div className="hint">recebido {fq(it.rec)}</div>}</td>
                                <td style={{ whiteSpace: "nowrap" }}>
                                  <button className="x" title="Mais campos (NCM, local de estoque, obs.)" onClick={() => setItem(i, { _open: !it._open })}>⋯</button>
                                  {!ro && <button className="x" title="Excluir item" onClick={() => setD((d) => d ? { ...d, itens: d.itens.filter((_, k) => k !== i) } : d)}>✕</button>}
                                </td>
                              </tr>,
                              it._hist && pi ? (
                                <tr key={it.key + "h"} className="more"><td /><td colSpan={9}>
                                  <div style={{ display: "flex", gap: 14, flexWrap: "wrap", marginBottom: 6, fontSize: 12 }}>
                                    <span>Média ({pi.h.length} últimas): <b className="num">{money(pi.avg)}</b></span>
                                    <span>Menor: <b className="num">{money(pi.min.vu)}</b>{pi.min.f ? ` · ${pi.min.f}` : ""} ({dBR(pi.min.d)})</span>
                                    <span>Você está pagando: <b className="num">{money(it.vu)}</b></span>
                                  </div>
                                  <div style={{ overflowX: "auto" }}>
                                    <table className="hist-t">
                                      <thead><tr><th>Data</th><th>PC</th><th>Fornecedor</th><th className="r">Qtde</th><th className="r">Valor unit.</th><th className="r">Atual vs este</th></tr></thead>
                                      <tbody>{pi.h.map((x, j) => {
                                        const d = x.vu ? (((Number(it.vu) || 0) - x.vu) / x.vu) * 100 : 0;
                                        return (
                                          <tr key={j} className={x.f && x.f === D.forn ? "same" : ""}>
                                            <td>{dBR(x.d)}</td><td>{x.n}{x.cod && it.cod && x.cod.toUpperCase() !== it.cod.toUpperCase() ? <span className="faint mono" title="Comprado com outro código do mesmo item"> · cód. {x.cod}</span> : null}</td><td>{x.f}</td><td className="r num">{fq(x.q)}</td>
                                            <td className="r num">{money(x.vu)}</td>
                                            <td className={`r num${d > 1 ? "" : " faint"}`} style={d > 10 ? { color: "var(--ww-crit-text)" } : undefined}>{d > 0 ? "+" : ""}{num2(d)}%</td>
                                          </tr>
                                        );
                                      })}</tbody>
                                    </table>
                                  </div>
                                  {D.forn && <div className="hint" style={{ marginTop: 4 }}>Linhas destacadas = mesmo fornecedor deste pedido.</div>}
                                </td></tr>
                              ) : null,
                              it._open ? (
                                <tr key={it.key + "m"} className="more"><td /><td colSpan={9}>
                                  <div className="gridf">
                                    <div className="f s3"><label>NCM</label><input className="in" disabled={ro} value={it.ncm ?? ""} onChange={(e) => setItem(i, { ncm: e.target.value })} /></div>
                                    <div className="f s3"><label>Local de estoque</label>
                                      <select className="in" disabled={ro} value={it.local ?? ""} onChange={(e) => setItem(i, { local: e.target.value || null })}>
                                        <option value="">Padrão</option>
                                        {it.local && !refs?.locais.some((l) => l.cod === it.local) && <option value={it.local}>Local {it.local}</option>}
                                        {refs?.locais.map((l, k) => <option key={l.cod} value={l.cod}>Local {l.cod}{k === 0 ? " (o mais usado)" : ""}</option>)}
                                      </select></div>
                                    <div className="f s6"><label>Observação do item</label><input className="in" disabled={ro} value={it.obs ?? ""} onChange={(e) => setItem(i, { obs: e.target.value })} /></div>
                                  </div>
                                </td></tr>
                              ) : null,
                            ];
                          })}
                          {!D.itens.length && <tr><td colSpan={10} className="empty">Nenhum item. Use “Novo Item” ou cole linhas do Excel (código; qtde; valor).</td></tr>}
                        </tbody>
                      </table>
                    </div>
                    {!ro && (
                      <>
                        <div className="addrow">
                          <button className="btn sm pri" onClick={() => setD((d) => d ? { ...d, itens: [...d.itens, itemVazio()] } : d)}>＋ Novo Item</button>
                          <button className="btn sm" onClick={() => setColar((c) => (c == null ? "" : null))}>⎘ Colar do Excel</button>
                          {!isRC && D.projCod && /^\s*PJ\s*\d/i.test(D.proj ?? "") && (
                            <button className="btn sm" title="As linhas da Lista de materiais deste projeto que ainda não têm PC — cada item fica ligado à sua linha"
                              onClick={() => setPickerLista(true)}>📋 Puxar itens da Lista de materiais</button>
                          )}
                          <span className="hint" style={{ alignSelf: "center" }}>O preço sugerido é o do último pedido daquele produto.</span>
                        </div>
                        {colar != null && (
                          <div style={{ marginTop: 8 }}>
                            <textarea className="in" value={colar} onChange={(e) => setColar(e.target.value)} placeholder={"38050023\t10\t24,20\n3043019\t20\t12,10"} />
                            <div className="addrow"><button className="btn sm pri" onClick={async () => {
                              const linhas = colar.split(/\n/).map((l) => l.split(/\t|;/).map((s) => s.trim())).filter((c) => c[0]);
                              const novos: Item[] = [];
                              for (const c of linhas) {
                                let p: ItemCat | undefined;
                                try {
                                  const r = await json<ItemCat[]>(await fetch(`/api/compras/buscar?tipo=produto&q=${encodeURIComponent(c[0])}`));
                                  p = r.find((x) => (x.codigo ?? "").toLowerCase() === c[0].toLowerCase());
                                } catch { /* fica como digitado */ }
                                novos.push({ ...itemVazio(), cod: p?.codigo ?? c[0], ncodProd: p?.ncod_prod ?? null, desc: p?.descricao ?? c[0],
                                  un: p?.unidade ?? "UN", qtd: parseNum(c[1] || 1), vu: c[2] ? parseNum(c[2]) : Number(p?.ultimo_preco) || 0 });
                              }
                              setD((d) => d ? { ...d, itens: [...d.itens, ...novos] } : d);
                              setColar(null); toast(`${novos.length} item(ns) importados`);
                            }}>Importar linhas</button></div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}

                {tabAtual === "deptos" && (() => {
                  const sp = D.deptos.reduce((a, d) => a + (Number(d.perc) || 0), 0);
                  const setDep = (i: number, p: Partial<{ nome: string; perc: number }>) =>
                    set({ deptos: D.deptos.map((d, k) => (k === i ? { ...d, ...p } : d)) });
                  return D.deptos.length ? (
                    <>
                      {errs.deptos && <div className="errmsg" style={{ marginBottom: 8 }}>{errs.deptos}</div>}
                      <div className="items-wrap">
                        <table className="items" style={{ minWidth: 520 }}>
                          <thead><tr><th>Departamento</th><th className="r">%</th><th className="r">Valor</th><th /></tr></thead>
                          <tbody>{D.deptos.map((d, i) => (
                            <tr key={i}>
                              <td><select className="in" disabled={ro} value={d.nome} onChange={(e) => setDep(i, { nome: e.target.value })}>
                                {!deptosLista.includes(d.nome) && <option>{d.nome}</option>}
                                {deptosLista.map((x) => <option key={x}>{x}</option>)}</select></td>
                              <td style={{ width: 110 }}><input className="in r" disabled={ro} key={`${i}-${d.perc}`} defaultValue={num2(d.perc)} onBlur={(e) => setDep(i, { perc: parseNum(e.target.value) })} /></td>
                              <td className="r num" style={{ width: 140, paddingTop: 11 }}>{money((t.total * (Number(d.perc) || 0)) / 100)}</td>
                              <td style={{ width: 40 }}>{!ro && <button className="x" onClick={() => set({ deptos: D.deptos.filter((_, k) => k !== i) })}>✕</button>}</td>
                            </tr>
                          ))}</tbody>
                          <tfoot><tr><td>Total distribuído</td><td className={`r num${Math.abs(sp - 100) > 0.01 ? " p-crit" : ""}`}>{num2(sp)}%</td><td className="r num">{money((t.total * sp) / 100)}</td><td /></tr></tfoot>
                        </table>
                      </div>
                      {!ro && <div className="addrow">
                        <button className="btn sm" onClick={() => set({ deptos: [...D.deptos, { nome: deptosLista.find((x) => !D.deptos.some((d) => d.nome === x)) ?? deptosLista[0], perc: 0 }] })}>＋ Departamento</button>
                        <button className="btn sm ghost" onClick={() => {
                          const n = D.deptos.length, parte = Math.floor((100 / n) * 100) / 100;
                          set({ deptos: D.deptos.map((d, i) => ({ ...d, perc: i === n - 1 ? Math.round((100 - parte * (n - 1)) * 100) / 100 : parte })) });
                        }}>Dividir igualmente</button>
                      </div>}
                    </>
                  ) : (
                    <div className="inline-note">Ainda não foi informada nenhuma distribuição por departamentos para esta compra.
                      {!ro && <button className="btn sm" style={{ marginLeft: 6 }} onClick={() => set({ deptos: [{ nome: deptosLista[0], perc: 100 }] })}>Fazer a distribuição agora</button>}
                      {!refs?.departamentos.length && <div className="hint" style={{ marginTop: 6 }}>Lista de exemplo — o cadastro de departamentos do Omie entra pelo sync de cadastros de compras.</div>}
                    </div>
                  );
                })()}

                {tabAtual === "frete" && (() => {
                  const f = D.frete;
                  const setF = (p: Partial<typeof f>) => set({ frete: { ...f, ...p } });
                  const num = (k: "qtdVol" | "pl" | "pb" | "valor" | "seguro" | "outras", l: string, cls = "s3") => (
                    <div className={`f ${cls}`}><label>{l}</label>
                      <input className="in r" disabled={ro} key={`${k}-${f[k] ?? 0}`} defaultValue={num2(f[k] ?? 0)} onBlur={(e) => setF({ [k]: parseNum(e.target.value) })} /></div>
                  );
                  const txt = (k: "placa" | "esp" | "marca" | "numer" | "lacre", l: string, cls = "s3") => (
                    <div className={`f ${cls}`}><label>{l}</label><input className="in" disabled={ro} value={f[k] ?? ""} onChange={(e) => setF({ [k]: e.target.value })} /></div>
                  );
                  return (
                    <>
                      <div className="gridf">
                        <div className="f s6"><label>Transportadora</label>
                          <Autocompletar<Forn> value={f.transp ?? ""} disabled={ro} placeholder="Busque a transportadora"
                            onChange={(v) => setF({ transp: v, transpCod: null })}
                            fonte={async (q) => (await json<Forn[]>(await fetch(`/api/compras/buscar?tipo=fornecedor&emp=${D.emp}&q=${encodeURIComponent(q)}`)))
                              .sort((a, b) => Number(!!b.transp) - Number(!!a.transp))
                              .map((x) => ({ label: x.nome, sub: `${x.cnpj ?? ""}${x.transp ? " · transportadora" : ""}`, v: x }))}
                            onPick={(o) => setF({ transp: o.v.nome, transpCod: o.v.cod })} /></div>
                        <div className="f s6"><label>Tipo do Frete</label>
                          <select className="in" disabled={ro} value={f.tipo ?? TIPOS_FRETE[5]} onChange={(e) => setF({ tipo: e.target.value })}>
                            {TIPOS_FRETE.map((x) => <option key={x}>{x}</option>)}</select></div>
                        {txt("placa", "Placa do Veículo")}
                        <div className="f s2"><label>UF</label><select className="in" disabled={ro} value={f.uf ?? ""} onChange={(e) => setF({ uf: e.target.value })}>
                          <option />{UFS.map((u) => <option key={u}>{u}</option>)}</select></div>
                        {num("qtdVol", "Quantidade de Volumes", "s2")}{txt("esp", "Espécie dos Volumes", "s5")}
                        {txt("marca", "Marca dos Volumes")}{txt("numer", "Numeração dos Volumes")}{num("pl", "Peso Líquido (Kg)")}{num("pb", "Peso Bruto (Kg)")}
                        {num("valor", "Valor do Frete")}{num("seguro", "Valor do Seguro")}{num("outras", "Outras Despesas Acessórias")}{txt("lacre", "Número do Lacre")}
                      </div>
                      <div className="hint" style={{ marginTop: 8 }}>Frete, seguro e outras despesas entram no Valor Total da Compra e nas parcelas.</div>
                    </>
                  );
                })()}

                {tabAtual === "parcelas" && (
                  <>
                    {errs.parcelas && <div className="errmsg" style={{ marginBottom: 8 }}>{errs.parcelas}</div>}
                    <div className="muted" style={{ marginBottom: 6 }}>Contas a Pagar — condição <b>{refs?.parcelas.find((p) => p.cod === D.parc)?.desc ?? D.parc}</b> a partir da previsão de entrega
                      {parcEditadas && !ro && <span className="pill p-warn" style={{ marginLeft: 8 }}>editadas à mão</span>}</div>
                    {pagar.length > 0 && (
                      <div className="pagar-ciclo">
                        <div className="muted" style={{ marginBottom: 6 }}>No Contas a Pagar{pagar[0].origem === "nf" ? " — parcelas das duplicatas da NF" : ""}
                          <span className="hint"> · só “Liberado para pagar” pode ser pago (recebido e conferido)</span></div>
                        <div className="pagar-linhas">{pagar.map((x) => {
                          const f = FASE_PAGAR[x.fase] ?? FASE_PAGAR.previsto;
                          return (
                            <div key={x.n} className="pagar-linha">
                              <span className="num">{x.n}/{x.total}</span>
                              <span>{x.venc ? dBR(String(x.venc).slice(0, 10), true) : "—"}</span>
                              <b className="num">{money(Number(x.valor))}</b>
                              {x.nf && <span className="faint">NF {x.nf}</span>}
                              <span className={`fase-pill ${x.fase}`} title={f.dica}>{f.label}{x.parcial ? " · parcial" : ""}
                                {x.fase === "liberado" && x.parcial && x.liberado != null ? ` (${money(Number(x.liberado))})` : ""}</span>
                              {x.status === "substituido" && <span className="faint" title={`Título(s) do Omie: ${x.omie ?? ""}`}>título do Omie</span>}
                            </div>
                          );
                        })}</div>
                      </div>
                    )}
                    <div className="items-wrap">
                      <table className="items" style={{ minWidth: 620 }}>
                        <thead><tr><th>Situação</th><th>Parcela</th><th>Vencimento</th><th className="r">Valor</th><th className="r">Percentual</th><th>Tipo de Documento</th></tr></thead>
                        <tbody>{D.parcelas.map((x, i) => {
                          const setP = (p: Partial<Parcela>) => { setParcEditadas(true); set({ parcelas: D.parcelas.map((y, k) => (k === i ? { ...y, ...p } : y)) }); };
                          return (
                            <tr key={i}>
                              <td style={{ paddingTop: 11 }}>{pagar.length && D.aprov === "aprovado"
                                ? <span className={`fase-pill ${pagar[0].fase}`}>{(FASE_PAGAR[pagar[0].fase] ?? FASE_PAGAR.previsto).label}</span>
                                : <span className="pill p-off" title="Só pedido aprovado vira conta a pagar">{D.aprov === "aprovado" ? "A pagar" : "Aguarda aprovação"}</span>}</td>
                              <td style={{ paddingTop: 11 }}>{x.n}/{D.parcelas.length}</td>
                              <td style={{ width: 160 }}><input className="in" type="date" disabled={ro} value={x.venc ?? ""} onChange={(e) => setP({ venc: e.target.value })} /></td>
                              <td style={{ width: 140 }}><input className="in r" disabled={ro} key={`${i}-${x.valor}`} defaultValue={num2(x.valor)} onBlur={(e) => setP({ valor: parseNum(e.target.value) })} /></td>
                              <td className="r num" style={{ paddingTop: 11 }}>{t.total ? num2(((Number(x.valor) || 0) / t.total) * 100) : "0,00"}%</td>
                              <td style={{ width: 170 }}><select className="in" disabled={ro} value={x.doc} onChange={(e) => setP({ doc: e.target.value })}>
                                {TIPOS_DOC.map((d) => <option key={d}>{d}</option>)}</select></td>
                            </tr>
                          );
                        })}
                        {!D.parcelas.length && <tr><td colSpan={6} className="empty">Sem parcelas</td></tr>}</tbody>
                      </table>
                    </div>
                    {!ro && <div className="addrow" style={{ alignItems: "center" }}>
                      <span className="hint">Parcelado direto:</span>
                      <input className="in" style={{ width: 170 }} placeholder="ex.: 3x 15/45/75" onKeyDown={(e) => {
                        if (e.key !== "Enter") return;
                        const v = (e.target as HTMLInputElement).value;
                        const m = v.match(/^\s*(\d+)\s*x?\s*([\d/ ,;]+)?\s*$/i);
                        if (!m) { toast("Use o formato 3x 15/45/75 (ou só 15/45/75)", true); return; }
                        let dias = (m[2] ?? "").split(/[\/ ,;]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0);
                        const n = Number(m[1]);
                        if (!m[2]) dias = [n]; // "30" = uma parcela a 30 dias
                        else if (n && dias.length !== n) { toast(`Informou ${n} parcelas e ${dias.length} prazos`, true); return; }
                        setParcEditadas(true);
                        set({ parcelas: gerarParcelas(t.total, dias, D.previsao || hoje(), D.parcelas[0]?.doc ?? "Boleto") });
                        (e.target as HTMLInputElement).value = ""; toast(`${dias.length} parcela(s) a ${dias.join("/")} dias da previsão de entrega`);
                      }} />
                      <span className="hint">Enter gera; dá para ajustar cada uma depois.</span>
                      <span style={{ flex: 1 }} />
                      <button className="btn sm" onClick={() => {
                      setParcEditadas(false);
                      set({ parcelas: gerarParcelas(t.total, diasDe(D.parc), D.previsao || hoje(), D.parcelas[0]?.doc ?? "Boleto") });
                      setErrs((e) => { const n = { ...e }; delete n.parcelas; return n; });
                    }}>↻ Refazer Parcelas</button></div>}
                  </>
                )}

                {tabAtual === "info" && (
                  <div className="gridf">
                    <div className="f s4"><label>Contato</label><input className="in" disabled={ro} value={D.contato} onChange={(e) => set({ contato: e.target.value })} /></div>
                    <div className="f s4"><label>Projeto</label>
                      <Autocompletar<{ cod: number; nome: string }> value={D.proj} disabled={ro} placeholder="Busque o projeto (PJ…, 41_VP…)"
                        onChange={(v) => set({ proj: v, projCod: null })}
                        fonte={(q) => (refs?.projetos ?? []).filter((p) => !q || p.nome.toLowerCase().includes(q)).slice(0, 14).map((p) => ({ label: p.nome, v: p }))}
                        onPick={(o) => set({ proj: o.v.nome, projCod: o.v.cod })} />
                      {!ro && (
                        <div style={{ marginTop: 6 }}>
                          <BotaoNovoProjeto compacto empresa={D.emp || "SF"}
                            sugestao={{ nome: D.pvCliente || null, clienteNome: D.pvCliente || null, obs: D.pv ? `Venda ${D.pv}` : null }}
                            onCriado={(p) => set({ proj: p.nome, projCod: p.codigo })} />
                        </div>
                      )}</div>
                    <div className="f s4"><label>Conta Corrente</label>
                      <select className="in" disabled={ro} value={D.contaCod ?? ""} onChange={(e) => { const c = refs?.contas.find((x) => String(x.cod) === e.target.value); set({ contaCod: c?.cod ?? null, conta: c?.desc ?? "" }); }}>
                        <option value="">{D.conta && !refs?.contas.some((c) => c.cod === D.contaCod) ? D.conta : "—"}</option>
                        {refs?.contas.map((c) => <option key={c.cod} value={c.cod}>{c.desc}</option>)}</select></div>
                    <div className="f s6"><label>Nº do Pedido do Fornecedor</label><input className="in" disabled={ro} value={D.numForn} onChange={(e) => set({ numForn: e.target.value })} /></div>
                    <div className="f s6"><label>Nº do Contrato</label><input className="in" disabled={ro} value={D.contrato} onChange={(e) => set({ contrato: e.target.value })} /></div>
                    {!isRC && <div className="f s6"><label>Vínculo PV/OS</label>
                      <Autocompletar<{ label: string; cliente: string; projeto?: string }> value={D.pv ? `${D.pv}${D.pvCliente ? " · " + D.pvCliente : ""}` : ""} disabled={ro}
                        placeholder="Ex.: PV 4123" onChange={(v) => { if (!v) set({ pv: "", pvCliente: "" }); }}
                        fonte={async (q) => (await json<{ label: string; cliente: string; projeto?: string }[]>(await fetch(`/api/compras/buscar?tipo=venda&emp=${D.emp}&q=${encodeURIComponent(q)}`)))
                          .map((v) => ({ label: `${v.label} · ${v.cliente}`, sub: v.projeto || "sem projeto", v }))}
                        onPick={(o) => set({ pv: o.v.label, pvCliente: o.v.cliente })} />
                      <span className="hint">Obrigatório, salvo compra avulsa (marque em Itens da Compra).</span></div>}
                  </div>
                )}

                {tabAtual === "emails" && D.id && (
                  <ConversaEmail id={D.id} podeEscrever aoLer={() => setNaoLidos(0)} />
                )}

                {tabAtual === "obs" && (
                  <div className="gridf">
                    <div className="f s12"><label>Observações deste pedido — impressas no pedido enviado ao fornecedor</label>
                      <textarea className="in" disabled={ro} value={D.obs} onChange={(e) => set({ obs: e.target.value })} /></div>
                    <div className="f s12"><label>Observações internas — exibidas apenas aqui</label>
                      <textarea className="in" disabled={ro} value={D.obsInt} onChange={(e) => set({ obsInt: e.target.value })} /></div>
                  </div>
                )}
              </section>
            </div>

            <aside className="side">
              <section className="card2"><h4>Ações</h4><div className="actions">
                {!ro && <button className="btn pri" disabled={salvando} onClick={() => salvar()}>☁ {salvando ? "Salvando…" : "Salvar"}</button>}
                {isRC && !D.id && !ro && <button className="btn" disabled={salvando} onClick={() => salvar({ msg: "Requisição salva", gerarPc: true })}>→ Salvar e gerar Pedido de Compra</button>}
                {isRC && D.id && (() => {
                  const n = selRc.size;
                  return (
                    <button className="btn pri" disabled={salvando}
                      title={n ? "Gera um pedido de compra só com os itens marcados e abre o pedido" : "Gera um pedido de compra com todos os itens que ainda faltam (marque itens para escolher) e abre o pedido"}
                      onClick={() => setGerarPc(true)}>→ Gerar pedido de compra{n ? ` (${n} ite${n === 1 ? "m" : "ns"})` : ""}</button>
                  );
                })()}
                {!isRC && !ro && <button className="btn" onClick={() => setPicker(true)}>⇠ Puxar itens de requisição</button>}
                {!isRC && D.aprov !== "aprovado" && !ro && (
                  <>
                    <button className="btn" disabled={salvando} onClick={() => salvar({ novaEtapa: D.etapa === "10" ? "15" : undefined, novaAprov: "aguardando", msg: "Pedido salvo e enviado para aprovação" })}>⏳ Salvar e solicitar aprovação</button>
                    <button className="btn ok" disabled={salvando} onClick={() => salvar({ aprovar: true })}>✓ Aprovar pedido</button>
                  </>
                )}
                {!isRC && ro && D.aprov !== "aprovado" && D.id && (
                  <button className="btn ok" onClick={async () => {
                    try {
                      const a = await json<{ falhas: { erro: string }[] }>(await fetch("/api/compras/acao", { method: "POST", headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ acao: "aprovar", ids: [D.id], status: "aprovado" }) }));
                      if (a.falhas.length) toast(a.falhas[0].erro, true); else onSalvo(D.id!, `Pedido ${D.num} aprovado`);
                    } catch (e) { toast((e as Error).message, true); }
                  }}>✓ Aprovar pedido</button>
                )}
                {D.id && !isRC && (["15", "40"].includes(D.etapa) || (D.etapa === "10" && D.origem === "omie")) && <button className="btn" onClick={() => onReceber(D.id!)}>📦 Registrar recebimento</button>}
                {D.id && <button className="btn ghost" onClick={() => onDuplicar(D.id!)}>⧉ Duplicar</button>}
                {D.id && !isRC && <button className="btn" style={{ borderColor: "#06B6D4" }} onClick={() => onImprimir(D.id!)}>🖨 Imprimir / PDF / enviar ao fornecedor</button>}
                {D.id && !isRC && D.aprov === "aprovado" && <button className="btn ghost" title="Lança um título a pagar (Pix/depósito) ligado a este PC; as parcelas do PC descontam o adiantado"
                  onClick={() => setAntecipar(true)}>💸 Pagamento antecipado</button>}
                {antecipar && D.id && <PagamentoAntecipado pedidoId={D.id} fechar={() => setAntecipar(false)} />}
              </div></section>
              {!ro && (
                <section className="card2"><h4>Pronto para salvar?</h4><div className="check">
                  {([[isRC || !!D.forn, "Fornecedor"], [isRC || !!D.cat, "Categoria da compra"],
                     [D.itens.length > 0 && D.itens.every((i) => Number(i.qtd) > 0), "Itens com quantidade"],
                     [!D.deptos.length || Math.abs(D.deptos.reduce((a, d) => a + (Number(d.perc) || 0), 0) - 100) <= 0.01, "Departamentos fecham 100%"],
                     [isRC || Math.abs(t.total - D.parcelas.reduce((a, x) => a + (Number(x.valor) || 0), 0)) <= 0.05, "Parcelas batem com o total"]] as [boolean, string][])
                    .map(([ok, l]) => <div key={l}><span className={`dot ${ok ? "ok" : "no"}`} />{l}</div>)}
                  {!isRC && cmpRc && (cmpRc.acima.length > 0
                    ? <div style={{ flexWrap: "wrap" }}><span className="dot" style={{ background: "#f59e0b" }} />{cmpRc.acima.length} item(ns) acima do máximo da RC
                        {!ro && <input className="in" style={{ marginTop: 6, flexBasis: "100%", width: "100%" }} value={motivoAcima} placeholder="Motivo (obrigatório para salvar acima do máximo)"
                          onChange={(e) => setMotivoAcima(e.target.value)} />}</div>
                    : <div><span className="dot ok" />Itens dentro do máximo da RC</div>)}
                </div></section>
              )}
              {!isRC && (
                <section className="card2"><h4>Aprovação</h4><div className="hist">
                  {D.aprov === "aprovado"
                    ? <div><span className="pill p-ok">✓ Aprovado</span><small>{D.aprovEm ? dBR(D.aprovEm.slice(0, 10), true) : ""}{D.aprovPor ? ` por ${D.aprovPor}` : ""}</small></div>
                    : <div>{APROV_LABEL[D.aprov]}</div>}
                </div></section>
              )}
              {D.enviadoEm && (
                <section className="card2"><h4>Enviado ao fornecedor</h4><div className="hist">
                  <div><span className="pill p-env">✉ {new Date(D.enviadoEm).toLocaleString("pt-BR")}</span>
                    <small>{D.enviadoMeio === "email" ? "por e-mail" : D.enviadoMeio === "email_teste" ? "por e-mail (teste)" : D.enviadoMeio === "whatsapp" ? "por WhatsApp" : "marcado à mão"}{D.enviadoPara ? ` · ${D.enviadoPara}` : ""}{D.enviadoPor ? ` · ${D.enviadoPor}` : ""}</small></div>
                </div></section>
              )}
              {isRC && (D.pcsDaRc ?? []).length > 0 && (
                <section className="card2"><h4>Pedidos que atendem esta RC</h4><div className="chips">
                  {(D.pcsDaRc ?? []).map((n) => <span key={n} className="pill p-acc">PC {n}</span>)}</div>
                  <div className="hint" style={{ marginTop: 6 }}>O cartão da requisição mostra só o saldo ainda a comprar.</div></section>
              )}
              {(D.nf || D.dtRec) && (
                <section className="card2"><h4>Nota fiscal</h4><div className="hist">
                  <div>NF-e {D.nf || "—"}<small>{D.dtRec ? `recebido em ${dBR(D.dtRec)}` : D.dtFat ? `faturado em ${dBR(D.dtFat)}` : ""}</small></div>
                  {D.chave && <div className="mono" style={{ fontSize: 11, wordBreak: "break-all" }}>{D.chave}</div>}
                </div></section>
              )}
              {!isRC && (D.semRc || D.avulsa) && (
                <section className="card2"><h4>Vínculo</h4><div className="hist">
                  {D.semRc && <div>Pedido sem RC<small>{D.semRcMotivo || "sem motivo"}</small></div>}
                  {D.avulsa && <div>Compra avulsa (sem venda)<small>{D.avulsaMotivo || "sem motivo"}</small></div>}
                </div></section>
              )}
              {(D.estoque ?? []).length > 0 && (
                <section className="card2"><h4>Entrada no estoque</h4><div className="hist">
                  {(D.estoque ?? []).map((e) => {
                    const it = D.itens.find((i) => i.id === e.itemId);
                    return <div key={e.itemId}>{fq(e.qtd)} × {it?.desc ?? `item ${e.nCodProd}`}
                      <small>{money(e.vu)} · CMC {money(e.cmcAntes)} → {money(e.cmcDepois)}{e.status === "sombra" ? " · modo sombra (saldo ainda vem do Omie)" : ""}</small></div>;
                  })}
                </div></section>
              )}
              {D.hist.length > 0 && (
                <section className="card2"><h4>Histórico</h4><div className="hist">
                  {[...D.hist].reverse().map((h, i) => <div key={i}>{h.t}<small>{dBR(h.em?.slice(0, 10), true)}{h.por ? ` · ${h.por}` : ""}</small></div>)}
                </div></section>
              )}
            </aside>
          </div>
        </div>

        {cadForn && D && (
          <CadastroFornecedorOverlay emp={D.emp} fornCod={D.fornCod} cnpj={D.cnpj} nome={D.forn}
            onFechar={(salvou) => { setCadForn(false); if (salvou) toast("Cadastro do fornecedor salvo — o envio por e-mail já usa os dados novos"); }} />
        )}
        {pickerLista && D.projCod && (
          <PickerLista empresa={D.emp || "SF"} codigo={Number(D.projCod)} projeto={D.proj ?? ""}
            jaNoPedido={new Set(D.itens.map((i) => i.listaId).filter((x): x is string => !!x))}
            onClose={() => setPickerLista(false)}
            onAdd={(linhas) => {
              const novos: Item[] = linhas.map((l) => ({ ...itemVazio(), cod: l.codigo ?? "", ncodProd: l.ncod_prod, desc: [l.item, l.modelo].filter(Boolean).join(" · "),
                un: l.un || "UN", qtd: l.qtd || 1, vu: Math.round((l.valor_unit ?? 0) * 100) / 100,
                obs: l.equipamento ? `Equip.: ${l.equipamento}` : null, rc: l.rc_item_id ? { itemId: l.rc_item_id, num: "", idx: 0, desc: l.item, qtd: l.qtd } : null, listaId: l.id }));
              setD((d) => d ? { ...d, itens: [...d.itens.filter((i) => i.desc.trim() || i.cod), ...novos] } : d);
              setPickerLista(false);
              toast(`${novos.length} item(ns) da Lista de materiais — ao salvar, cada um fica ligado à sua linha`);
            }} />
        )}
        {picker && (
          <PickerRc onClose={() => setPicker(false)} covEfetiva={covEfetiva}
            onAdd={(sel) => {
              Object.values(sel).forEach(({ rc, itens }) => levarDaRc(rc, itens));
              setRcCache((c) => ({ ...c, ...Object.fromEntries(Object.values(sel).map(({ rc }) => [rc.num, rc])) }));
              setPicker(false);
              toast(`Itens vinculados: ${Object.values(sel).map(({ rc }) => "RC " + rc.num).join(", ")}`);
            }} />
        )}
        {gerarPc && isRC && D.id && (
          <GerarPcDaRc rc={D.num} empresa={D.emp} itensRc={[...selRc]}
            onFechar={() => setGerarPc(false)}
            onFeito={(num, novoId) => {
              setGerarPc(false); setSelRc(new Set());
              if (onAbrir) { toast(`Pedido de compra ${num} criado a partir da RC ${D.num} — confira e mande para aprovação`); onAbrir(novoId); }
              else onSalvo(novoId, `Pedido de compra ${num} criado a partir da RC ${D.num}`);
            }} />
        )}
      </div>
    </div>
  );
}

function PickerRc({ onClose, onAdd, covEfetiva }: {
  onClose: () => void; covEfetiva: (rcItemId: number, cov: number) => number;
  onAdd: (sel: Record<string, { rc: RcAberta; itens: { itemId: number; qtd: number }[] }>) => void;
}) {
  const [q, setQ] = useState("");
  const [rcs, setRcs] = useState<RcAberta[] | null>(null);
  const [marcas, setMarcas] = useState<Record<string, { on: boolean; qtd: number }>>({});
  useEffect(() => {
    const t = setTimeout(async () => {
      try { setRcs(await json<RcAberta[]>(await fetch(`/api/compras/buscar?tipo=rc&q=${encodeURIComponent(q)}`))); }
      catch { setRcs([]); }
    }, 200);
    return () => clearTimeout(t);
  }, [q]);
  const n = Object.values(marcas).filter((m) => m.on && m.qtd > 0).length;
  return (
    <div className="cmp-scrim" style={{ zIndex: 70, justifyContent: "center", alignItems: "flex-start", padding: "5vh 16px" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card2" style={{ width: "min(880px,100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", gap: 10, boxShadow: "var(--shadow-float)" }}
        role="dialog" aria-modal="true" aria-label="Vincular requisição">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ fontSize: 16 }}>Puxar itens de requisições</b>
          <span className="hint">O item no pedido pode ter outro nome/código — a requisição guarda o original.</span>
          <span style={{ flex: 1 }} /><button className="btn ghost sm" onClick={onClose}>Fechar ✕</button>
        </div>
        <input className="in" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por nº, projeto, venda (PV/OS), cliente ou produto" />
        <div style={{ overflow: "auto", display: "grid", gap: 10 }}>
          {rcs == null && <div className="empty">Carregando…</div>}
          {rcs?.length === 0 && <div className="empty">Nenhuma requisição em aberto com esse filtro</div>}
          {rcs?.map((rc) => (
            <section key={rc.id} style={{ border: "1px solid var(--line)", borderRadius: 10, overflow: "hidden" }}>
              <div style={{ background: "var(--sunken)", padding: "8px 10px", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <b>Requisição {rc.num}</b><span className="tag">{rc.proj || "sem projeto"}</span>
                {rc.pv ? <span className="tag">↔ {rc.pv}{rc.pvCliente ? " · " + rc.pvCliente : ""}</span> : <span className="faint">sem venda vinculada</span>}
                <span className="faint">{dBR(rc.emissao)} · {rc.comprador || "—"}</span><span style={{ flex: 1 }} />
                <button className="btn sm ghost" onClick={() => setMarcas((m) => {
                  const n2 = { ...m };
                  rc.itens.forEach((it) => { const rest = it.qtd - covEfetiva(it.id, it.cov); if (rest > 0) n2[`${rc.num}|${it.id}`] = { on: true, qtd: rest }; });
                  return n2;
                })}>Marcar todos</button>
              </div>
              <table className="items" style={{ minWidth: 0 }}><tbody>
                {rc.itens.map((it) => {
                  const cov = covEfetiva(it.id, it.cov), rest = Math.max(0, it.qtd - cov), k = `${rc.num}|${it.id}`;
                  const m = marcas[k] ?? { on: false, qtd: rest };
                  return rest <= 0 ? (
                    <tr key={k} className="done"><td /><td>{it.desc}</td><td className="r faint" colSpan={2}>já pedido</td></tr>
                  ) : (
                    <tr key={k}>
                      <td style={{ width: 34, paddingTop: 9 }}><input type="checkbox" checked={m.on} aria-label="Selecionar item"
                        onChange={(e) => setMarcas((mm) => ({ ...mm, [k]: { ...m, on: e.target.checked } }))} /></td>
                      <td style={{ paddingTop: 9 }}>{it.desc}<div className="hint mono">{it.cod} · pedido {fq(it.qtd)} {it.un}{cov ? ` · já em pedido ${fq(cov)}` : ""}</div></td>
                      <td className="r faint" style={{ paddingTop: 9, width: 90 }}>a comprar</td>
                      <td style={{ width: 110 }}><input className="in r" defaultValue={num2(m.qtd)}
                        onBlur={(e) => { const v = parseNum(e.target.value); setMarcas((mm) => ({ ...mm, [k]: { on: v > 0, qtd: v } })); }} /></td>
                    </tr>
                  );
                })}
              </tbody></table>
            </section>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={!n} onClick={() => {
            const sel: Record<string, { rc: RcAberta; itens: { itemId: number; qtd: number }[] }> = {};
            Object.entries(marcas).filter(([, m]) => m.on && m.qtd > 0).forEach(([k, m]) => {
              const [num, idS] = k.split("|");
              const rc = rcs?.find((r) => r.num === num);
              if (!rc) return;
              (sel[num] = sel[num] ?? { rc, itens: [] }).itens.push({ itemId: Number(idS), qtd: m.qtd });
            });
            onAdd(sel);
          }}>Adicionar {n || ""} item(ns) ao pedido</button>
        </div>
      </div>
    </div>
  );
}

type LinhaLista = { id: string; equipamento: string; item: string; modelo: string | null; qtd: number; un: string; codigo: string | null;
  ncod_prod: number | null; valor_unit: number | null; fornecedor: string | null; necessario: string | null; rc_item_id: number | null };
/** Linhas da Lista de materiais do projeto ainda sem PC (07/10/26) — filtro por grupo e fornecedor. */
function PickerLista({ empresa, codigo, projeto, jaNoPedido, onClose, onAdd }: {
  empresa: string; codigo: number; projeto: string; jaNoPedido: Set<string>;
  onClose: () => void; onAdd: (linhas: LinhaLista[]) => void;
}) {
  const [linhas, setLinhas] = useState<LinhaLista[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [grupo, setGrupo] = useState("");
  const [forn, setForn] = useState("");
  const [q, setQ] = useState("");
  const [marc, setMarc] = useState<Set<string>>(new Set());
  useEffect(() => {
    fetch(`/api/rc-projetos/lista-sem-pc?empresa=${encodeURIComponent(empresa)}&codigo=${codigo}`, { cache: "no-store" })
      .then((r) => r.json()).then((j) => { if (j.error) setErro(j.error); else setLinhas((j.linhas ?? []).filter((l: LinhaLista) => !jaNoPedido.has(l.id))); })
      .catch((e) => setErro(String(e)));
  }, [empresa, codigo, jaNoPedido]);
  const grupos = [...new Set((linhas ?? []).map((l) => l.equipamento))].sort();
  const forns = [...new Set((linhas ?? []).map((l) => l.fornecedor ?? "").filter(Boolean))].sort();
  const vis = (linhas ?? []).filter((l) => (!grupo || l.equipamento === grupo) && (!forn || l.fornecedor === forn)
    && (!q || `${l.item} ${l.codigo ?? ""} ${l.modelo ?? ""}`.toLowerCase().includes(q.toLowerCase())));
  const tot = (linhas ?? []).filter((l) => marc.has(l.id)).reduce((a, l) => a + l.qtd * (l.valor_unit ?? 0), 0);
  return (
    <div className="cmp-scrim" style={{ zIndex: 70, justifyContent: "center", alignItems: "flex-start", padding: "5vh 16px" }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="card2" style={{ width: "min(1040px,100%)", maxHeight: "88vh", display: "flex", flexDirection: "column", gap: 10, boxShadow: "var(--shadow-float)" }}
        role="dialog" aria-modal="true" aria-label="Puxar itens da Lista de materiais">
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <b style={{ fontSize: 16 }}>Puxar itens da Lista de materiais</b><span className="tag">{projeto}</span>
          <span className="hint">Só linhas sem PC. Cada item do pedido fica ligado à sua linha (como no “Gerar pedido de compra” da lista).</span>
          <span style={{ flex: 1 }} /><button className="btn ghost sm" onClick={onClose}>Fechar ✕</button>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input className="in" style={{ flex: "1 1 220px" }} autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filtrar por item ou código" />
          <select className="in" style={{ flex: "0 1 220px" }} value={grupo} onChange={(e) => setGrupo(e.target.value)}>
            <option value="">Todos os grupos</option>{grupos.map((g) => <option key={g} value={g}>{g}</option>)}</select>
          <select className="in" style={{ flex: "0 1 240px" }} value={forn} onChange={(e) => setForn(e.target.value)}>
            <option value="">Todos os fornecedores</option>{forns.map((f) => <option key={f} value={f}>{f}</option>)}</select>
        </div>
        <div style={{ overflow: "auto", border: "1px solid var(--line)", borderRadius: 10 }}>
          {erro && <div className="empty">Não consegui ler a lista: {erro}</div>}
          {!erro && linhas == null && <div className="empty">Carregando…</div>}
          {linhas && !vis.length && <div className="empty">Nenhuma linha sem PC com esse filtro</div>}
          {vis.length > 0 && (
            <table className="items" style={{ minWidth: 0 }}>
              <thead><tr>
                <th style={{ width: 34 }}><input type="checkbox" aria-label="Marcar todas" checked={vis.every((l) => marc.has(l.id))}
                  onChange={(e) => setMarc((m) => { const n = new Set(m); vis.forEach((l) => (e.target.checked ? n.add(l.id) : n.delete(l.id))); return n; })} /></th>
                <th>Equipamento</th><th>Código</th><th>Item</th><th className="r">Qtd</th><th>Necessário em</th><th className="r">Valor unit.</th><th>Fornecedor sugerido</th>
              </tr></thead>
              <tbody>{vis.map((l) => (
                <tr key={l.id} onClick={() => setMarc((m) => { const n = new Set(m); if (n.has(l.id)) n.delete(l.id); else n.add(l.id); return n; })} style={{ cursor: "pointer" }}>
                  <td><input type="checkbox" checked={marc.has(l.id)} readOnly aria-label="Selecionar linha" /></td>
                  <td className="faint">{l.equipamento}</td><td className="mono">{l.codigo ?? <span className="faint">sem código</span>}</td>
                  <td>{l.item}{l.modelo ? <span className="faint"> · {l.modelo}</span> : null}</td>
                  <td className="r">{fq(l.qtd)} {l.un}</td><td>{l.necessario ? dBR(l.necessario) : "—"}</td>
                  <td className="r">{l.valor_unit != null ? money(l.valor_unit) : "—"}</td><td className="faint">{l.fornecedor ?? "—"}</td>
                </tr>))}</tbody>
            </table>)}
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center" }}>
          <span className="hint">{marc.size} linha(s) · {money(tot)} pelo valor da lista (dá para mudar no pedido)</span>
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn pri" disabled={!marc.size} onClick={() => onAdd((linhas ?? []).filter((l) => marc.has(l.id)))}>Adicionar {marc.size || ""} item(ns) ao pedido</button>
        </div>
      </div>
    </div>
  );
}

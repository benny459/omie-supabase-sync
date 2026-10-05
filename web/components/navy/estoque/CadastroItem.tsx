"use client";

/**
 * Cadastro de item do Estoque — criar (/estoque/novo) e editar (/estoque/[codigo]/editar).
 * Família define o código sugerido (prefixo + próximo número), mostrado ao vivo; só o admin edita
 * o código. Validações: NCM 8 dígitos, EAN, alarme mín ≤ pedir ≤ máx, aviso de nome parecido.
 * Cópia no Omie (SF): ao criar → IncluirProduto; ao editar campo fiscal → AlterarProduto. O status
 * fica no item ("✓ no Omie" / "erro: …" com "tentar de novo").
 */

import "./estoque.css";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { nomeLocal } from "@/lib/estoque";
import { Pill, Seta, invalidarItens, postar, q } from "./comum";

type Fam = { id: number; nome: string; prefixo: string; proximo: number; ativo: boolean; sistema: boolean; omie_codigo_familia: number | null };
type Parecido = { n_cod_prod: number; codigo: string; codigo_novo: string | null; descricao: string; saldo: number; sim: number; igual: boolean };
type Form = {
  descricao: string; familia_id: string; codigo: string; unidade: string; ncm: string; ean: string; preco_ref: string; local_padrao: string;
  minimo: string; ponto_pedido: string; maximo: string; foto_url: string; obs: string; ativo: boolean;
};
const VAZIO: Form = { descricao: "", familia_id: "", codigo: "", unidade: "UN", ncm: "", ean: "", preco_ref: "", local_padrao: "2264756939",
  minimo: "", ponto_pedido: "", maximo: "", foto_url: "", obs: "", ativo: true };
const LOCAIS = ["2264756939", "12172796544"];
const UNIDADES = ["UN", "PC", "KG", "G", "L", "ML", "M", "M2", "M3", "CX", "SC", "RL", "PCT", "KIT", "PAR", "JG", "GL", "BD", "TB", "FD"];
const num = (s: string) => (s.trim() === "" ? null : Number(s.replace(",", ".")));

export default function CadastroItem({ codigo }: { codigo?: string }) {
  const router = useRouter();
  const editando = !!codigo;
  const [base, setBase] = useState<{ familias: Fam[]; admin: boolean; omie: { ligado: boolean; empresas: string[] }; item: Record<string, unknown> | null } | null>(null);
  const [f, setF] = useState<Form>(VAZIO);
  const [erro, setErro] = useState<string | null>(null);
  const [parecidos, setParecidos] = useState<Parecido[]>([]);
  const [enviarOmie, setEnviarOmie] = useState(true);
  const [indo, setIndo] = useState(false);
  // Preço máximo de compra (P7): opcional; CP, RC e PC avisam quando passam dele.
  const [pmax, setPmax] = useState("");
  const [pmaxAntes, setPmaxAntes] = useState("");
  const [feito, setFeito] = useState<{ codigo: string; n_cod_prod: number; omie: { ok: boolean; erro?: string } | null; cadastro_id: number } | null>(null);

  useEffect(() => {
    (async () => {
      try {
        let nProd: string | null = null;
        if (codigo) {
          const r = await fetch(`/api/estoque/item/${encodeURIComponent(codigo)}`, { cache: "no-store" });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error ?? r.statusText);
          nProd = String(j.item.n_cod_prod);
        }
        const r = await fetch(`/api/estoque/cadastro${nProd ? `?n_cod_prod=${nProd}` : ""}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error ?? r.statusText);
        setBase(j);
        const it = j.item as Record<string, unknown> | null;
        if (it?.n_cod_prod != null) {
          const pm = await fetch(`/api/estoque/preco-max?prods=${it.n_cod_prod}`, { cache: "no-store" }).then((x) => (x.ok ? x.json() : {})).catch(() => ({}));
          const v = (pm as Record<string, number>)[String(it.n_cod_prod)];
          const s0 = v != null ? String(v).replace(".", ",") : "";
          setPmax(s0); setPmaxAntes(s0);
        }
        if (it) setF({
          descricao: String(it.descricao ?? ""), familia_id: it.familia_id != null ? String(it.familia_id) : "", codigo: String(it.codigo_novo ?? ""),
          unidade: String(it.unidade ?? "UN"), ncm: String(it.ncm ?? "").replace(/\D/g, ""), ean: String(it.ean ?? ""),
          preco_ref: it.preco_ref != null ? String(it.preco_ref) : "", local_padrao: it.local_padrao != null ? String(it.local_padrao) : "2264756939",
          minimo: it.alarme_minimo != null ? String(it.alarme_minimo) : "", ponto_pedido: it.alarme_ponto_pedido != null ? String(it.alarme_ponto_pedido) : "",
          maximo: it.alarme_maximo != null ? String(it.alarme_maximo) : "", foto_url: String(it.foto_url ?? ""), obs: String(it.cadastro_obs ?? ""), ativo: it.ativo !== false,
        });
      } catch (e) { setErro((e as Error).message); }
    })();
  }, [codigo]);

  // aviso de duplicidade (debounce)
  useEffect(() => {
    const d = f.descricao.trim();
    if (d.length < 5) { setParecidos([]); return; }
    const t = setTimeout(async () => {
      const ex = base?.item ? `&excluir=${base.item.n_cod_prod}` : "";
      const r = await fetch(`/api/estoque/cadastro?parecidos=${encodeURIComponent(d)}${ex}`);
      const j = await r.json();
      if (r.ok) setParecidos(j.parecidos ?? []);
    }, 450);
    return () => clearTimeout(t);
  }, [f.descricao, base]);

  const fams = useMemo(() => (base?.familias ?? []).filter((x) => x.ativo), [base]);
  // sugestão de família pela descrição (IA); só sugere — a pessoa escolhe
  const [sugFam, setSugFam] = useState<{ familia_id: number; familia: string; confianca: number; motivo: string; nova: string | null } | null | "buscando">(null);
  const sugerirFamilia = async () => {
    setSugFam("buscando");
    try { const r = await postar<{ sugestao: { familia_id: number; familia: string; confianca: number; motivo: string; nova: string | null } | null }>("/api/estoque/familias/sugerir-item", { descricao: f.descricao, ncm: f.ncm }); setSugFam(r.sugestao); }
    catch { setSugFam(null); }
  };
  const fam = fams.find((x) => String(x.id) === f.familia_id) ?? fams.find((x) => x.sistema);
  const temCodigo = editando && !!base?.item?.codigo_novo;
  const sugerido = fam ? `${fam.prefixo}${String(fam.proximo).padStart(4, "0")}` : "";
  const ncm = f.ncm.replace(/\D/g, ""), ean = f.ean.replace(/\D/g, "");
  const errosV: string[] = [];
  if (!f.descricao.trim()) errosV.push("Descrição obrigatória");
  if (ncm && ncm.length !== 8) errosV.push("NCM precisa ter 8 dígitos");
  if (ean && !/^(\d{8}|\d{12,14})$/.test(ean)) errosV.push("EAN: 8, 12, 13 ou 14 dígitos");
  const mn = num(f.minimo), pp = num(f.ponto_pedido), mx = num(f.maximo);
  if (mn != null && pp != null && pp < mn) errosV.push("Ponto de pedido < mínimo");
  if (mx != null && pp != null && mx < pp) errosV.push("Máximo < ponto de pedido");
  const empresa = "SF";
  const omieDisponivel = !!base?.omie.ligado && !!base?.omie.empresas.includes(empresa);
  const iguais = parecidos.filter((p) => p.igual);
  const n_cod_prod = base?.item ? Number(base.item.n_cod_prod) : null;
  const ehDoOmie = n_cod_prod != null && n_cod_prod > 0;

  const salvar = async () => {
    setIndo(true); setErro(null);
    try {
      const body: Record<string, unknown> = {
        empresa, descricao: f.descricao.trim(), familia_id: f.familia_id || null, unidade: f.unidade, ncm, ean,
        preco_ref: f.preco_ref.replace(",", "."), local_padrao: f.local_padrao, minimo: f.minimo.replace(",", "."), ponto_pedido: f.ponto_pedido.replace(",", "."),
        maximo: f.maximo.replace(",", "."), foto_url: f.foto_url, obs: f.obs, ativo: f.ativo, enviar_omie: enviarOmie && omieDisponivel,
      };
      if (!editando && base?.admin && f.codigo.trim()) body.codigo = f.codigo.trim().toUpperCase();
      if (editando) {
        if (base?.item?.cadastro_id && (base.item.cadastro_origem === "painel")) body.cadastro_id = base.item.cadastro_id;
        else body.n_cod_prod = n_cod_prod;
      }
      for (const k of Object.keys(body)) if (body[k] === "") delete body[k];
      const r = await postar<{ codigo: string; n_cod_prod: number; omie: { ok: boolean; erro?: string } | null; cadastro_id: number }>("/api/estoque/cadastro", body);
      invalidarItens();
      if (pmax.trim() !== pmaxAntes.trim() && r.n_cod_prod) {
        try { await postar("/api/estoque/preco-max", { n_cod_prod: r.n_cod_prod, preco_maximo: pmax.trim() ? (pmax.includes(",") ? pmax.replace(/\./g, "").replace(",", ".") : pmax) : null }); setPmaxAntes(pmax); }
        catch (e) { setErro(`Item salvo, mas o preço máximo não: ${(e as Error).message}`); }
      }
      setFeito(r);
    } catch (e) { setErro((e as Error).message); } finally { setIndo(false); }
  };
  const reenviar = async () => {
    if (!feito) return;
    setIndo(true);
    try { const r = await postar<{ omie: { ok: boolean; erro?: string; n_cod_prod?: number } }>("/api/estoque/cadastro", { acao: "omie", cadastro_id: feito.cadastro_id }); setFeito({ ...feito, omie: r.omie, n_cod_prod: r.omie.n_cod_prod ?? feito.n_cod_prod }); }
    catch (e) { setFeito({ ...feito, omie: { ok: false, erro: (e as Error).message } }); } finally { setIndo(false); }
  };
  const campo = (k: keyof Form) => ({ value: String(f[k]), onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value }) });

  if (erro && !base) return <div className="est"><div className="aviso t-crit">{erro}</div></div>;
  if (!base) return <div className="est"><div className="cartao vazio">Carregando…</div></div>;

  if (feito) return (
    <div className="est">
      <div className="cartao" style={{ padding: 20, display: "grid", gap: 12 }}>
        <h3 style={{ margin: 0 }}>{editando ? "Cadastro salvo" : "Item criado"} · <span style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{feito.codigo}</span></h3>
        {feito.omie == null ? <div className="aviso t-info">{editando ? "Nenhum campo fiscal mudou — nada a enviar ao Omie." : omieDisponivel ? "Não enviado ao Omie (desmarcado)." : "Cópia no Omie indisponível para esta empresa."}</div>
          : feito.omie.ok ? <div className="aviso t-ok">✓ {editando ? "Atualizado" : "Criado"} no Omie{!editando && feito.n_cod_prod > 0 ? ` (id ${feito.n_cod_prod})` : ""}.</div>
            : <div className="aviso t-crit"><span>Omie: {feito.omie.erro}</span><span style={{ flex: 1 }} /><button className="btn sm" disabled={indo} onClick={reenviar}>Tentar de novo</button></div>}
        <div className="filtros">
          <button className="btn pri" onClick={() => router.push(`/estoque/${encodeURIComponent(feito.codigo)}`)}>Abrir a ficha</button>
          {!editando && <button className="btn" onClick={() => { setFeito(null); setF(VAZIO); }}>Cadastrar outro</button>}
          <button className="btn" onClick={() => router.push("/estoque")}>Voltar ao estoque</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="est">
      <div className="crumbs"><button className="link" onClick={() => router.push(editando ? `/estoque/${encodeURIComponent(codigo!)}` : "/estoque")}><Seta dir="esq" />{editando ? "Ficha do item" : "Estoque"}</button><span>/</span><span>{editando ? "Editar cadastro" : "Novo item"}</span></div>
      <header className="cartao head">
        <div style={{ flex: 1, minWidth: 220 }}>
          <div className="area">Estoque · Cadastro</div><h1>{editando ? "Editar item" : "Novo item"}</h1>
          <div className="sub">{editando ? `${base.item?.codigo_novo ? `${base.item.codigo_novo} · ` : ""}Omie ${base.item?.codigo_omie ?? "—"}` : "O código sai da família (prefixo + número)."}
            {ehDoOmie && base.item?.omie_status === "erro" ? ` · Omie: erro — ${base.item.omie_erro}` : ""}</div>
        </div>
        {editando && !!base.item?.omie_status && <Pill t={base.item.omie_status === "ok" ? "✓ no Omie" : base.item.omie_status === "erro" ? "erro no Omie" : String(base.item.omie_status)} tom={base.item.omie_status === "ok" ? "ok" : base.item.omie_status === "erro" ? "crit" : "off"} />}
      </header>

      <div className="cartao" style={{ padding: "16px 18px", display: "grid", gap: 14 }}>
        <div className="form-grid">
          <label className="f s8">Descrição *<input className="inp" {...campo("descricao")} maxLength={120} placeholder="Ex.: CARTUCHO PP 10&quot; 5 MICRAS" /></label>
          <label className="f s4">Família
            <select className="inp" {...campo("familia_id")}>
              <option value="">Sem família</option>
              {fams.filter((x) => !x.sistema).map((x) => <option key={x.id} value={x.id}>{x.nome} ({x.prefixo})</option>)}
            </select>
            {!f.familia_id && f.descricao.trim().length >= 3 && sugFam === null && <button type="button" className="link mini" style={{ textAlign: "left" }} onClick={sugerirFamilia}>Sugerir a família pela descrição</button>}
            {sugFam === "buscando" && <span className="mini">Pensando…</span>}
            {sugFam && sugFam !== "buscando" && String(sugFam.familia_id) !== f.familia_id && (
              <span className="mini" style={{ fontWeight: 400 }}>Sugestão: <b>{sugFam.familia}</b> ({Math.round(sugFam.confianca * 100)}%) — {sugFam.motivo}{sugFam.nova ? ` · falta a família “${sugFam.nova}”?` : ""}{" "}
                <button type="button" className="link mini" onClick={() => setF({ ...f, familia_id: String(sugFam.familia_id) })}>usar</button></span>
            )}
          </label>
          <label className="f s4">Código {temCodigo ? "(gerado)" : base.admin ? "(admin pode trocar)" : "(sugerido)"}
            <input className="inp mono" value={temCodigo ? String(base.item?.codigo_novo) : f.codigo || sugerido} disabled={temCodigo || !base.admin || editando}
              onChange={(e) => setF({ ...f, codigo: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })} />
            <span className="mini">{temCodigo ? "Mudar a família não troca o código — use Recodificar na ficha." : editando ? "Gerado ao salvar." : `Próximo de ${fam?.nome ?? "Sem família"}: ${sugerido}`}</span>
          </label>
          <label className="f s2">Unidade<select className="inp" {...campo("unidade")}>{[...new Set([f.unidade, ...UNIDADES])].map((u) => <option key={u}>{u}</option>)}</select></label>
          <label className="f s3">NCM (8 dígitos)<input className="inp mono" value={f.ncm} onChange={(e) => setF({ ...f, ncm: e.target.value.replace(/[^\d.]/g, "") })} placeholder="8421.21.00" /></label>
          <label className="f s3">EAN (opcional)<input className="inp mono" {...campo("ean")} /></label>
          <label className="f s3">CMC / preço de referência<input className="inp" inputMode="decimal" {...campo("preco_ref")} placeholder="0,00" /></label>
          <label className="f s3">Preço máximo de compra<input className="inp" inputMode="decimal" value={pmax} onChange={(e) => setPmax(e.target.value.replace(/[^\d.,]/g, ""))} placeholder="opcional" title="CP do CRM, RC e PC avisam quando o valor passa deste limite" /></label>
          <label className="f s3">Local padrão<select className="inp" {...campo("local_padrao")}>{LOCAIS.map((l) => <option key={l} value={l}>{nomeLocal(l)}</option>)}</select></label>
          <label className="f s2">Mínimo<input className="inp" inputMode="decimal" {...campo("minimo")} /></label>
          <label className="f s2">Pedir em<input className="inp" inputMode="decimal" {...campo("ponto_pedido")} /></label>
          <label className="f s2">Máximo<input className="inp" inputMode="decimal" {...campo("maximo")} /></label>
          <div className="f s6"><span>Foto</span><span className="mini" style={{ paddingTop: 8 }}>Na ficha do item: “Pôr foto” (busca na web, link ou arquivo). A foto fica guardada no painel, não como link externo.</span></div>
          <label className="f s12">Observações<textarea className="inp" value={f.obs} onChange={(e) => setF({ ...f, obs: e.target.value })} /></label>
          <label className="f s12" style={{ flexDirection: "row", alignItems: "center", gap: 8 }}><input type="checkbox" checked={f.ativo} onChange={(e) => setF({ ...f, ativo: e.target.checked })} /> Item ativo</label>
        </div>

        {iguais.length > 0 && <div className="aviso t-crit"><span><b>Já existe item com o mesmo nome:</b> {iguais.map((p) => `${p.codigo_novo ?? p.codigo} (saldo ${q(p.saldo)})`).join(", ")}. Confira antes de criar outro.</span></div>}
        {parecidos.filter((p) => !p.igual).length > 0 && (
          <div className="aviso t-warn"><span><b>Parecidos:</b> {parecidos.filter((p) => !p.igual).map((p) => (
            <a key={p.n_cod_prod} href={`/estoque/${encodeURIComponent(p.codigo_novo ?? p.codigo)}`} target="_blank" rel="noreferrer" style={{ color: "inherit", marginRight: 10 }}>
              {p.codigo_novo ?? p.codigo} · {p.descricao} ({Math.round(p.sim * 100)}%)</a>))}</span></div>
        )}
        {errosV.length > 0 && <div className="aviso t-warn">{errosV.join(" · ")}</div>}
        {erro && <div className="aviso t-crit">{erro}</div>}

        <div className="filtros" style={{ justifyContent: "flex-end" }}>
          {omieDisponivel ? (
            <label className="mini" style={{ display: "flex", gap: 6, alignItems: "center", marginRight: "auto" }}>
              <input type="checkbox" checked={enviarOmie} onChange={(e) => setEnviarOmie(e.target.checked)} />
              {editando ? (ehDoOmie ? "Atualizar no Omie se mudar descrição, unidade, NCM ou EAN" : "Criar no Omie (ainda não existe lá)") : "Criar também no Omie (SF) — o NF ainda sai do Omie"}
              {enviarOmie && !ncm && !editando && <b style={{ color: "var(--ww-warn-text)" }}> · o Omie exige NCM</b>}
            </label>
          ) : <span className="mini" style={{ marginRight: "auto" }}>{base.omie.ligado ? "Sem chave do Omie para esta empresa — o item fica só no painel." : "Cópia no Omie desligada — o item fica só no painel."}</span>}
          <button className="btn" onClick={() => router.back()}>Cancelar</button>
          <button className="btn pri" disabled={indo || errosV.length > 0} onClick={salvar}>{indo ? "Salvando…" : editando ? "Salvar cadastro" : "Criar item"}</button>
        </div>
      </div>
    </div>
  );
}

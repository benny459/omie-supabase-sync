"use client";

// "Alterar em lote ▾" da barra de seleção da lista de materiais (08/10/26, Benny).
// Cada ação com valor abre um campo NO PRÓPRIO menu; o botão "Aplicar a N" é a confirmação.
// Quem chama faz o trabalho e mostra o aviso com Desfazer.

import { useRef, useState } from "react";
import { PopoverFixo } from "./FiltroColuna";

export type AcoesLote = {
  n: number;
  /** quantas marcadas cada ação alcança (0 = desabilitada, com a dica do porquê) */
  alcance: { prazo: number; sug: number; semCod: number; comCod: number; comPc: number; db: number };
  prazoBloqueio?: string;
  fornecedores: string[];
  unidades: string[];
  ocupado: boolean;
  onPrazo: (v: number | null) => void;
  onNecessario: (iso: string | null) => void; // null = usar a data do grupo
  onFornecedor: (nome: string) => void;
  onValor: (v: number | null) => void; // null = último preço / custo RC
  onQtd: (modo: "x" | "=", v: number) => void;
  onUnidade: (un: string) => void;
  onAceitarSug: () => void;
  onNaoNosso: () => void;
  onTirarCodigo: () => void;
  onComentar: (texto: string) => Promise<boolean>;
  onDesvincular: () => void;
  onExportar: () => void;
  onCopiar: () => void;
};

function CampoLote({ tipo = "text", ph, valido, aplicar, lista, rot = "Aplicar", val, setVal, n, ocupado, form }: {
  tipo?: string; ph: string; valido: boolean; aplicar: () => void; lista?: string; rot?: string;
  val: string; setVal: (v: string) => void; n: number; ocupado: boolean; form: string | null;
}) {
  return (
    <div className="flex items-center gap-1.5 px-2 pb-1.5 pt-0.5" data-lote-form={form ?? ""}>
      <input autoFocus type={tipo} value={val} placeholder={ph} list={lista} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && valido) { e.preventDefault(); aplicar(); } }}
        className="min-w-0 flex-1 rounded-md border border-ww-border bg-transparent px-1.5 py-0.5 text-[12px] text-ww-text outline-none focus:ring-1 focus:ring-ww-accent" />
      <button type="button" disabled={!valido || ocupado} onClick={aplicar} data-lote-aplicar
        className="shrink-0 px-2 py-0.5 rounded-md bg-ww-accent text-white text-[11px] font-semibold disabled:opacity-40">{rot} a {n}</button>
    </div>);
}

type Form = "prazo" | "nec" | "forn" | "vu" | "qtdx" | "qtd" | "un" | "coment" | null;

export default function MenuLote(a: AcoesLote) {
  const btn = useRef<HTMLButtonElement>(null);
  const [aberto, setAberto] = useState(false);
  const [form, setForm] = useState<Form>(null);
  const [val, setVal] = useState("");
  const fechar = () => { setAberto(false); setForm(null); setVal(""); };
  const abrirForm = (f: Form, inicial = "") => { setForm(form === f ? null : f); setVal(inicial); };
  const numero = (t: string) => { const n = Number(String(t).trim().replace(/\./g, "").replace(",", ".")); return Number.isFinite(n) ? n : NaN; };

  const Sec = ({ t }: { t: string }) => <div className="px-2 pt-2 pb-0.5 text-[9.5px] font-bold uppercase tracking-wider text-ww-textFaint">{t}</div>;
  const Item = ({ rot, dica, off, onClick, k, ativo }: { rot: React.ReactNode; dica?: string; off?: boolean; onClick: () => void; k: string; ativo?: boolean }) => (
    <button type="button" role="menuitem" disabled={off || a.ocupado} title={dica} data-lote={k} onClick={onClick}
      className={`flex w-full items-center gap-2 text-left px-2 py-1 rounded hover:bg-ww-rowHover disabled:opacity-40 disabled:hover:bg-transparent ${ativo ? "bg-ww-rowHover" : ""}`}>
      {rot}
    </button>);
  const feito = (fn: () => void) => () => { fn(); fechar(); };

  const pz = numero(val);
  return (<>
    <button ref={btn} type="button" data-lote-menu aria-haspopup="menu" aria-expanded={aberto} onClick={() => (aberto ? fechar() : setAberto(true))}
      className="shrink-0 inline-flex items-center gap-1 h-8 px-3 rounded-lg bg-white text-ww-accent text-[13px] font-semibold shadow-sm hover:bg-white/90 transition">
      ✎ Alterar em lote ▾
    </button>
    {aberto && btn.current && (
      <PopoverFixo ancora={btn.current} onFechar={fechar} largura={330} rotulo="Alterar em lote">
        <div className="p-1 pb-1.5" data-lote-pop>
          <div className="px-2 pt-1 text-[11px] text-ww-textMuted">Vale para as <b className="text-ww-text">{a.n}</b> linha(s) marcada(s) — com Desfazer no aviso.</div>

          <Sec t="Planejamento" />
          <Item k="prazo" ativo={form === "prazo"} rot={<>⏱ Prazo (dias)…</>} off={!a.alcance.prazo} dica={a.prazoBloqueio ?? "Prazo de entrega só destes itens — base do Comprar até"} onClick={() => abrirForm("prazo")} />
          {form === "prazo" && <CampoLote val={val} setVal={setVal} n={a.n} ocupado={a.ocupado} form={form} tipo="number" ph="dias (0–365)" valido={Number.isInteger(pz) && pz >= 0 && pz <= 365} aplicar={feito(() => a.onPrazo(pz))} />}
          <Item k="prazo-auto" rot={<>↺ Prazo: voltar ao automático</>} off={!a.alcance.prazo} dica={a.prazoBloqueio ?? "Tira o ajuste — vale o do fornecedor/item/histórico"} onClick={feito(() => a.onPrazo(null))} />
          <Item k="nec" ativo={form === "nec"} rot={<>📅 Necessário em…</>} onClick={() => abrirForm("nec")} />
          {form === "nec" && <CampoLote val={val} setVal={setVal} n={a.n} ocupado={a.ocupado} form={form} tipo="date" ph="data" valido={/^\d{4}-\d{2}-\d{2}$/.test(val)} aplicar={feito(() => a.onNecessario(val))} />}
          <Item k="nec-grupo" rot={<>📅 Usar a data do grupo</>} dica="Cada linha volta para a data do seu equipamento (tira a data própria)" onClick={feito(() => a.onNecessario(null))} />

          <Sec t="Compra" />
          <Item k="forn" ativo={form === "forn"} rot={<>🏭 Fornecedor…</>} dica="Fornecedor sugerido da linha — o mesmo nome junta os itens no mesmo lote/PC" onClick={() => abrirForm("forn")} />
          {form === "forn" && <><CampoLote val={val} setVal={setVal} n={a.n} ocupado={a.ocupado} form={form} ph="nome do fornecedor" lista="lote-fornecedores" valido={val.trim().length >= 2} aplicar={feito(() => a.onFornecedor(val.trim()))} />
            <datalist id="lote-fornecedores">{a.fornecedores.map((f) => <option key={f} value={f} />)}</datalist></>}
          <Item k="vu" ativo={form === "vu"} rot={<>💲 Valor unit.…</>} onClick={() => abrirForm("vu")} />
          {form === "vu" && <CampoLote val={val} setVal={setVal} n={a.n} ocupado={a.ocupado} form={form} ph="ex.: 125,90" valido={Number.isFinite(numero(val)) && numero(val) >= 0 && val.trim() !== ""} aplicar={feito(() => a.onValor(numero(val)))} />}
          <Item k="vu-auto" rot={<>💲 Usar último preço / custo RC</>} dica="Último preço pago (catálogo); sem compra anterior, o custo da RC" onClick={feito(() => a.onValor(null))} />
          <Item k="qtdx" ativo={form === "qtdx"} rot={<>✖ Qtd × N…</>} dica="Multiplica a quantidade de cada linha (ex.: 2 equipamentos iguais)" onClick={() => abrirForm("qtdx", "2")} />
          {form === "qtdx" && <CampoLote val={val} setVal={setVal} n={a.n} ocupado={a.ocupado} form={form} tipo="number" ph="multiplicar por" valido={numero(val) > 0} aplicar={feito(() => a.onQtd("x", numero(val)))} rot="Multiplicar" />}
          <Item k="qtd" ativo={form === "qtd"} rot={<>＝ Qtd = N…</>} onClick={() => abrirForm("qtd", "1")} />
          {form === "qtd" && <CampoLote val={val} setVal={setVal} n={a.n} ocupado={a.ocupado} form={form} tipo="number" ph="quantidade" valido={numero(val) > 0} aplicar={feito(() => a.onQtd("=", numero(val)))} />}
          <Item k="un" ativo={form === "un"} rot={<>📏 Unidade…</>} onClick={() => abrirForm("un", "UN")} />
          {form === "un" && <><CampoLote val={val} setVal={setVal} n={a.n} ocupado={a.ocupado} form={form} ph="UN, M, KG, PC…" lista="lote-unidades" valido={val.trim().length >= 1 && val.trim().length <= 6} aplicar={feito(() => a.onUnidade(val.trim().toUpperCase()))} />
            <datalist id="lote-unidades">{a.unidades.map((u) => <option key={u} value={u} />)}</datalist></>}

          <Sec t="Código" />
          <Item k="aceitar" rot={<>✓ Aceitar sugestões ({a.alcance.sug})</>} off={!a.alcance.sug} dica="A sugestão de código vira código confirmado (e ensina o de-para)" onClick={feito(a.onAceitarSug)} />
          <Item k="nao-nosso" rot={<>✕ Não é item nosso ({a.alcance.semCod})</>} off={!a.alcance.semCod} dica="Fica sem código e o catálogo não volta a sugerir" onClick={feito(a.onNaoNosso)} />
          <Item k="tirar-cod" rot={<>⌫ Tirar o código ({a.alcance.comCod})</>} off={!a.alcance.comCod} dica="A linha volta para a compatibilização com o estoque" onClick={feito(a.onTirarCodigo)} />

          <Sec t="Comentário e PC" />
          <Item k="coment" ativo={form === "coment"} rot={<>💬 Comentar em todos…</>} off={!a.alcance.db} onClick={() => abrirForm("coment")} />
          {form === "coment" && (
            <div className="px-2 pb-1.5 space-y-1">
              <textarea autoFocus rows={2} value={val} onChange={(e) => setVal(e.target.value)} placeholder="o mesmo comentário em cada linha…"
                className="w-full rounded-md border border-ww-border bg-transparent px-1.5 py-1 text-[12px] text-ww-text outline-none focus:ring-1 focus:ring-ww-accent" />
              <div className="flex items-center gap-2"><small className="text-[10px] text-ww-textFaint">sem desfazer — fica na conversa</small>
                <button type="button" disabled={!val.trim() || a.ocupado} data-lote-aplicar
                  onClick={async () => { if (await a.onComentar(val)) fechar(); }}
                  className="ml-auto px-2 py-0.5 rounded-md bg-ww-accent text-white text-[11px] font-semibold disabled:opacity-40">Comentar em {a.alcance.db}</button></div>
            </div>)}
          <Item k="desvincular" rot={<>⛓ Desvincular PC ({a.alcance.comPc})</>} off={!a.alcance.comPc} dica="Tira a ligação com o pedido de compra (o PC não muda)" onClick={feito(a.onDesvincular)} />

          <Sec t="Levar para fora" />
          <Item k="excel" rot={<>⬇ Exportar marcados para Excel</>} onClick={feito(a.onExportar)} />
          <Item k="copiar" rot={<>📋 Copiar (cola no Excel)</>} dica="Copia como tabela (TSV) com cabeçalho" onClick={feito(a.onCopiar)} />
        </div>
      </PopoverFixo>)}
  </>);
}

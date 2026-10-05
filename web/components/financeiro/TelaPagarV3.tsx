"use client";

/**
 * Títulos a Pagar v3 (05/10/26) — implantação do mockup "contas-a-pagar-v3".
 * O esqueleto (ids e classes do mockup) fica aqui; o comportamento vive em
 * pagar-v3-motor.ts, porte do script do mockup ligado a /api/financeiro/pagar.
 * "Nova conta" e o retrato do fornecedor reaproveitam os componentes da tela anterior.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUserPerms } from "../UserPermsProvider";
import NovoTituloModal from "../NovoTituloModal";
import FornecedorDrawer from "../FornecedorDrawer";
import { montarPagarV3 } from "./pagar-v3-motor";
import "./pagar-v3.css";

export default function TelaPagarV3() {
  const perms = useUserPerms();
  const ref = useRef<HTMLDivElement>(null);
  const motor = useRef<{ recarregar: () => Promise<void>; destruir: () => void } | null>(null);
  const [nova, setNova] = useState(false);
  const [forn, setForn] = useState<{ cod: number; emp: string } | null>(null);
  const admin = !!perms?.is_admin;

  useEffect(() => {
    if (!ref.current) return;
    motor.current = montarPagarV3({
      root: ref.current,
      admin,
      onNovaConta: () => setNova(true),
      onFornecedor: (cod, emp) => setForn({ cod, emp }),
    });
    return () => motor.current?.destruir();
  }, [admin]);

  return (
    <>
      <div className="cp3" ref={ref}>
        <div className="wrap">
          <div className="hdr">
            <div>
              <div className="k">Financeiro</div>
              <h1>Títulos a Pagar</h1>
              <div className="sub">Pagar · aprovar · baixar · conciliar — dados de <span id="hoje" /> · Omie + previsões de PC do painel</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Link href="/financeiro/pagar?classica=1" className="classica">tela clássica</Link>
              <button className="btn" id="hdrOfx">Importar OFX</button>
              <button className="btn" id="hdrSync">Sincronizar</button>
              <button className="btn pri" id="hdrNova">+ Nova conta</button>
            </div>
          </div>
          <div id="cpErro" />
          <div className="carregando" id="cpCarregando">Carregando títulos…</div>

          <div id="cpCorpo" className="hidden">
            <div className="bar">
              <div className="seg" id="empSeg">
                <button data-v="ALL" className="on">Todas</button>
                <button data-v="CD"><span className="dot" style={{ background: "var(--cd)" }} />CD</button>
                <button data-v="SF"><span className="dot" style={{ background: "var(--sf)" }} />SF</button>
                <button data-v="WW"><span className="dot" style={{ background: "var(--ww)" }} />WW</button>
              </div>
              <input className="search" id="q" placeholder="Buscar fornecedor, categoria, projeto, PC, NF…" />
            </div>

            <div className="kpis" id="kpis" />
            <div className="horizon" id="horizon" />

            <div className="grid2">
              <div className="panel">
                <div className="ph">
                  <div><h2>Próximos 30 dias · por empresa</h2><div className="d">Clique num dia para ver logo abaixo o que está lançado · ‹ › navega</div></div>
                  <div className="ctl"><div className="legend" id="agLegend" /><div className="seg sm" id="agMode"><button data-v="dia" className="on">Dia</button><button data-v="sem">Semana</button></div></div>
                </div>
                <div id="agChart" />
                <div id="agDay" />
                <div style={{ overflowX: "auto" }}><table className="pivot num" id="pivot" /></div>
              </div>
              <div className="panel">
                <div className="ph">
                  <div><h2>Bancos</h2><div className="d">Saldo Omie · último extrato · conciliação</div></div>
                  <button className="btn sm" id="bkOfx">Importar OFX</button>
                </div>
                <div id="banks" />
                <div className="cov" id="cov" />
              </div>
            </div>

            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="ph">
                <div><h2>Vencidos · onde está o dinheiro</h2><div className="d" id="vcDesc" /></div>
                <div className="ctl">
                  <div className="seg sm" id="vcEmp"><button data-v="ALL">Todas</button><button data-v="CD">CD</button><button data-v="SF" className="on">SF</button><button data-v="WW">WW</button></div>
                  <div className="seg sm" id="vcRange"><button data-v="30">30d</button><button data-v="60" className="on">60d</button><button data-v="90">90d</button><button data-v="180">180d</button></div>
                </div>
              </div>
              <div className="vgrid">
                <div>
                  <div id="vcChart" />
                  <div className="aging" id="aging" />
                  <div id="vcAlert" />
                </div>
                <div>
                  <div className="rkhead"><span id="rkFilter" style={{ color: "var(--tx3)", fontSize: 12 }}>Clique numa barra ou faixa ao lado para recortar</span>
                    <div className="seg sm" id="rkDim"><button data-v="cat" className="on">Categoria</button><button data-v="forn">Fornecedor</button><button data-v="proj">Projeto</button><button data-v="pst">Status pgto</button></div></div>
                  <div className="rank" id="rank" />
                </div>
              </div>
            </div>

            <div className="panel ws" id="ws">
              <div className="tabs" id="wsTabs">
                <button data-v="tit" className="on">Pagamentos<span className="cnt" id="tcTit" /></button>
                <button data-v="conc">Conciliação OFX<span className="cnt" id="tcConc" /></button>
                <button data-v="hist">Baixas de hoje<span className="cnt" id="tcHist">0</span></button>
              </div>
              <div id="pTit">
                <div className="tbar">
                  <div className="seg sm" id="tPer">
                    <button data-v="hoje" className="on">Hoje</button><button data-v="venc">Vencidos 60d</button><button data-v="amanha">Amanhã</button><button data-v="d7">7 dias</button><button data-v="d30">30 dias</button><button data-v="tudo">Venc. + 30d</button>
                  </div>
                  <div className="seg sm" id="tSt" />
                  <span id="fchip" />
                  <span style={{ marginLeft: "auto" }} />
                  <button className="btn sm" id="tCsv">CSV</button>
                </div>
                <div className="bstrip" id="bstrip" />
                <div className="tbl"><table className="num" id="tbl" /></div>
                <div className="abar" id="abar"><b id="abarN" /><span id="abarV" className="num" /><span id="abarE" style={{ fontSize: 12 }} /><span className="w" id="abarW" /><span style={{ marginLeft: "auto" }} /><select id="abarBank" /><button className="btn sm" id="abarClr">Limpar</button><button className="btn ok sm" id="abarGo">Baixar em lote</button></div>
                <div className="foot"><span id="tblFoot" /><span>Status de pagamento = aprovação do pedido de compra + NF recebida · clique numa linha para abrir</span></div>
              </div>
              <div id="pConc" style={{ display: "none" }} />
              <div id="pHist" style={{ display: "none" }} />
            </div>
          </div>
        </div>
        <div className="tip" id="tip" />
        <div className="ov" id="ov" />
        <aside className="drawer" id="drawer" />
        <div className="modal" id="modal" />
        <div className="toast" id="toast" />
        <div className="cfpop" id="cfPop" />
      </div>

      {nova && <NovoTituloModal tipo="pagar" onClose={() => setNova(false)} onCreated={() => motor.current?.recarregar()} />}
      {forn && <FornecedorDrawer cod={forn.cod} empresa={forn.emp} tipo="pagar" rotulo="Fornecedor" onClose={() => setForn(null)} />}
    </>
  );
}

"use client";

/**
 * Títulos a Receber v1 (05/10/26) — implantação do mockup "contas-a-receber-v1".
 * Mesmo desenho do TelaPagarV3: esqueleto aqui (ids/classes do mockup), comportamento
 * em receber-v1-motor.ts ligado a /api/financeiro/receber.
 */
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useUserPerms } from "../UserPermsProvider";
import NovoTituloModal from "../NovoTituloModal";
import { montarReceberV1 } from "./receber-v1-motor";
import "./pagar-v3.css";

export default function TelaReceberV1() {
  const perms = useUserPerms();
  const ref = useRef<HTMLDivElement>(null);
  const motor = useRef<{ recarregar: () => Promise<void>; destruir: () => void } | null>(null);
  const [nova, setNova] = useState(false);
  const admin = !!perms?.is_admin;

  useEffect(() => {
    if (!ref.current) return;
    motor.current = montarReceberV1({ root: ref.current, admin, onNovaConta: () => setNova(true) });
    return () => motor.current?.destruir();
  }, [admin]);

  return (
    <>
      <div className="cp3" ref={ref}>
        <div className="wrap">
          <div className="hdr">
            <div>
              <div className="k">Financeiro</div>
              <h1>Títulos a Receber</h1>
              <div className="sub">Receber · cobrar · baixar · conciliar — dados de <span id="hoje" /> · Omie conferido + contas do painel</div>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <Link href="/financeiro/receber?classica=1" className="classica">tela clássica</Link>
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
              <div className="basesw">Data base
                <div className="seg sm" id="baseSeg"><button data-v="prev" className="on">Previsão</button><button data-v="venc">Vencimento</button></div>
              </div>
              <input className="search" id="q" placeholder="Buscar cliente, CNPJ, categoria, projeto, boleto, NF…" />
            </div>

            <div className="kpis" id="kpis" />

            <div className="grid2">
              <div className="panel">
                <div className="ph">
                  <div><h2>Próximos 30 dias · entradas por empresa</h2><div className="d" id="agDesc" /></div>
                  <div className="ctl"><div className="legend" id="agLegend" /><div className="seg sm" id="agMode"><button data-v="dia" className="on">Dia</button><button data-v="sem">Semana</button></div></div>
                </div>
                <div id="agChart" />
                <div id="agDay" />
                <div style={{ overflowX: "auto" }}><table className="pivot num" id="pivot" /></div>
              </div>
              <div className="panel">
                <div className="ph">
                  <div><h2>Bancos</h2><div className="d">Saldo Omie · entradas previstas · conciliação</div></div>
                  <button className="btn sm" id="bkOfx">Importar OFX</button>
                </div>
                <div id="banks" />
                <div className="cov" id="cov" />
              </div>
            </div>

            <div className="panel" style={{ marginBottom: 14 }}>
              <div className="ph">
                <div><h2>Inadimplência · quem está devendo</h2><div className="d" id="vcDesc" /></div>
                <div className="ctl">
                  <div className="seg sm" id="vcEmp"><button data-v="ALL">Todas</button><button data-v="CD">CD</button><button data-v="SF" className="on">SF</button><button data-v="WW">WW</button></div>
                  <div className="seg sm" id="vcRange"><button data-v="30">30d</button><button data-v="60" className="on">60d</button><button data-v="90">90d</button><button data-v="180">180d</button><button data-v="9999">Tudo</button></div>
                </div>
              </div>
              <div className="vgrid">
                <div>
                  <div id="vcChart" />
                  <div className="aging" id="aging" />
                  <div id="vcAlert" />
                </div>
                <div>
                  <div className="rkhead"><span id="rkFilter" style={{ color: "var(--tx3)", fontSize: 12 }} />
                    <div className="seg sm" id="rkDim"><button data-v="cli" className="on">Cliente</button><button data-v="cat">Categoria</button><button data-v="proj">Projeto</button><button data-v="sit">Situação</button></div></div>
                  <div className="rank" id="rank" />
                </div>
              </div>
            </div>

            <div className="panel ws" id="ws">
              <div className="tabs" id="wsTabs">
                <button data-v="tit" className="on">Recebimentos<span className="cnt" id="tcTit" /></button>
                <button data-v="conc">Conciliação OFX<span className="cnt" id="tcConc" /></button>
                <button data-v="hist">Baixas de hoje<span className="cnt" id="tcHist">0</span></button>
              </div>
              <div id="pTit">
                <div className="tbar">
                  <div className="seg sm" id="tPer">
                    <button data-v="hoje" className="on">Hoje</button><button data-v="venc">Vencidos</button><button data-v="amanha">Amanhã</button><button data-v="d7">7 dias</button><button data-v="d30">30 dias</button><button data-v="tudo">Todos em aberto</button>
                  </div>
                  <div className="seg sm" id="tSt" />
                  <span id="fchip" />
                  <span style={{ marginLeft: "auto" }} />
                  <button className="btn sm" id="tCsv">CSV</button>
                </div>
                <div className="bstrip" id="bstrip" />
                <div className="tbl"><table className="num" id="tbl" /></div>
                <div className="abar" id="abar"><b id="abarN" /><span id="abarV" className="num" /><span id="abarE" style={{ fontSize: 12 }} /><span style={{ marginLeft: "auto" }} /><select id="abarBank" /><button className="btn sm" id="abarPrev">Alterar previsão</button><button className="btn sm" id="abarCob">Cobrar</button><button className="btn sm" id="abarClr">Limpar</button><button className="btn ok sm" id="abarGo">Receber em lote</button></div>
                <div className="foot"><span id="tblFoot" /><span>Situação = vencimento + previsão/promessa + boleto/NF · clique numa linha para abrir</span></div>
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

      {nova && <NovoTituloModal tipo="receber" onClose={() => setNova(false)} onCreated={() => motor.current?.recarregar()} />}
    </>
  );
}

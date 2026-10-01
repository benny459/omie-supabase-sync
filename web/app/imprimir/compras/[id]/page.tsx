// Documento do Pedido de Compra para o fornecedor (imprimir / salvar PDF).
// Fica fora do layout do painel (sem menu): é a folha A4 que vai ao
// fornecedor. Observação interna NÃO aparece aqui — só a "observação do pedido".
import { notFound } from "next/navigation";
import { requireArea } from "@/lib/require-area";
import { supaAdmin } from "@/lib/supabase-admin";
import { totais, totalItem, money, num2, qtd, dBR, type Pedido } from "@/lib/compras";
import BotaoImprimir from "./BotaoImprimir";

export const dynamic = "force-dynamic";

type Empresa = { razao_social?: string; nome_fantasia?: string; cnpj?: string; ie?: string; im?: string; endereco?: string;
  numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string; cep?: string; telefone?: string; email?: string };
type Cliente = { razao_social?: string; nome_fantasia?: string; cnpj_cpf?: string; endereco?: string; endereco_numero?: string;
  complemento?: string; bairro?: string; cidade?: string; estado?: string; cep?: string; telefone1_ddd?: string; telefone1_numero?: string;
  email?: string; inscricao_estadual?: string };

const linha = (...p: (string | null | undefined)[]) => p.filter((x) => x && String(x).trim()).join(" · ");

export default async function ImprimirPedido({ params }: { params: Promise<{ id: string }> }) {
  await requireArea("erp");
  const { id } = await params;
  const admin = supaAdmin();
  const { data: ped } = await admin.schema("orders").rpc("compras_pedido", { p_id: Number(id) });
  const p = ped as Pedido | null;
  if (!p) notFound();
  const [{ data: emp }, { data: forn }, { data: parc }] = await Promise.all([
    admin.schema("orders").rpc("compras_empresa", { p_empresa: p.emp }),
    p.fornCod ? admin.schema("finance").from("clientes").select("*").eq("empresa", p.emp).eq("codigo_cliente_omie", p.fornCod).maybeSingle()
      : Promise.resolve({ data: null }),
    p.parc ? admin.schema("finance").from("parcelas").select("descricao").eq("codigo", p.parc).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const e = (emp ?? {}) as Empresa;
  // O Omie grava a cidade como "BARUERI (SP)" — a UF já vai ao lado.
  if (e.cidade) e.cidade = e.cidade.replace(/\s*\([A-Z]{2}\)\s*$/, "");
  const f = (forn ?? {}) as Cliente;
  const t = totais({ itens: p.itens ?? [], frete: p.frete ?? {} });
  const fr = p.frete ?? {};
  const condicao = (parc as { descricao?: string } | null)?.descricao ?? p.parc ?? "—";
  const aprovado = p.aprov === "aprovado";

  return (
    <div className="doc">
      <style>{CSS}</style>
      <BotaoImprimir numero={p.num} />
      <div className="folha">
        <header className="topo">
          <div className="emp">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-waterworks.svg" alt="" className="logo" />
            <div>
              <div className="razao">{e.razao_social ?? p.emp}</div>
              <div className="sub">CNPJ {e.cnpj ?? "—"}{e.ie ? ` · IE ${e.ie}` : ""}{e.im ? ` · IM ${e.im}` : ""}</div>
              <div className="sub">{linha([e.endereco, e.numero].filter(Boolean).join(", "), e.complemento, e.bairro, [e.cidade, e.uf].filter(Boolean).join("/"), e.cep && `CEP ${e.cep}`)}</div>
              <div className="sub">{linha(e.telefone, e.email)}</div>
            </div>
          </div>
          <div className="caixa">
            <div className="rot">Pedido de Compra</div>
            <div className="numero">Nº {p.num}</div>
            <div className="sub">Emissão {dBR(p.emissao)}</div>
            <div className="sub">Entrega prevista {dBR(p.previsao)}</div>
          </div>
        </header>

        <section className="blocos">
          <div className="bloco">
            <div className="rot">Fornecedor</div>
            <div className="forte">{p.forn || "—"}</div>
            <div>CNPJ/CPF {p.cnpj || f.cnpj_cpf || "—"}{f.inscricao_estadual ? ` · IE ${f.inscricao_estadual}` : ""}</div>
            <div>{linha([f.endereco, f.endereco_numero].filter(Boolean).join(", "), f.complemento, f.bairro, f.cidade?.replace(/\s*\([A-Z]{2}\)\s*$/, "") && `${f.cidade.replace(/\s*\([A-Z]{2}\)\s*$/, "")}/${f.estado ?? ""}`, f.cep && `CEP ${f.cep}`)}</div>
            <div>{linha(f.telefone1_numero && `(${f.telefone1_ddd ?? ""}) ${f.telefone1_numero}`, p.contato && `Contato: ${p.contato}`)}</div>
          </div>
          <div className="bloco">
            <div className="rot">Condições</div>
            <div><b>Pagamento:</b> {condicao}</div>
            <div><b>Frete:</b> {fr.tipo ?? "—"}{fr.transp ? ` · ${fr.transp}` : ""}</div>
            {p.numForn && <div><b>Nº do pedido do fornecedor:</b> {p.numForn}</div>}
            {p.contrato && <div><b>Contrato:</b> {p.contrato}</div>}
            <div><b>Comprador:</b> {p.comprador || "—"}</div>
          </div>
        </section>

        <table className="itens">
          <thead><tr>
            <th>#</th><th>Código</th><th>Descrição</th><th>NCM</th><th>Un</th>
            <th className="r">Qtde</th><th className="r">Valor unit.</th><th className="r">Desc.</th><th className="r">IPI</th><th className="r">ICMS ST</th><th className="r">Total</th>
          </tr></thead>
          <tbody>
            {(p.itens ?? []).map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td><td className="mono">{it.cod ?? ""}</td>
                <td>{it.desc}{it.obs ? <div className="obsi">{it.obs}</div> : null}</td>
                <td className="mono">{it.ncm ?? ""}</td><td>{it.un}</td>
                <td className="r">{qtd(it.qtd)}</td><td className="r">{money(it.vu)}</td>
                <td className="r">{Number(it.desc0) ? money(it.desc0) : "—"}</td><td className="r">{Number(it.ipi) ? money(it.ipi) : "—"}</td>
                <td className="r">{Number(it.st) ? money(it.st) : "—"}</td><td className="r forte">{money(totalItem({ ...it, key: "" }))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <section className="pe">
          <div className="esq">
            {(p.parcelas ?? []).length > 0 && (
              <>
                <div className="rot">Parcelas</div>
                <table className="parc"><tbody>
                  {p.parcelas.map((x) => <tr key={x.n}><td>{x.n}/{p.parcelas.length}</td><td>{dBR(x.venc)}</td><td>{x.doc}</td><td className="r">{money(x.valor)}</td></tr>)}
                </tbody></table>
              </>
            )}
            {(fr.qtdVol || fr.pb || fr.pl) ? (
              <div className="miudo">Volumes: {fr.qtdVol ? num2(fr.qtdVol) : "—"}{fr.esp ? ` ${fr.esp}` : ""} · Peso líq. {num2(fr.pl ?? 0)} kg · Peso bruto {num2(fr.pb ?? 0)} kg</div>
            ) : null}
            {p.obs && (<><div className="rot" style={{ marginTop: 10 }}>Observações</div><div className="obs">{p.obs}</div></>)}
          </div>
          <table className="tot"><tbody>
            <tr><td>Mercadorias</td><td className="r">{money(t.merc)}</td></tr>
            {t.desc ? <tr><td>Desconto</td><td className="r">− {money(t.desc)}</td></tr> : null}
            {t.ipi ? <tr><td>IPI</td><td className="r">{money(t.ipi)}</td></tr> : null}
            {t.st ? <tr><td>ICMS ST</td><td className="r">{money(t.st)}</td></tr> : null}
            {fr.valor ? <tr><td>Frete</td><td className="r">{money(fr.valor)}</td></tr> : null}
            {fr.seguro ? <tr><td>Seguro</td><td className="r">{money(fr.seguro)}</td></tr> : null}
            {fr.outras ? <tr><td>Outras despesas</td><td className="r">{money(fr.outras)}</td></tr> : null}
            <tr className="grand"><td>Total do pedido</td><td className="r">{money(t.total)}</td></tr>
          </tbody></table>
        </section>

        <div className="aviso">
          Informe o número <b>{p.num}</b> deste pedido na NF-e (campo “Pedido de compra” / xPed de cada item) — é por ele que o recebimento é conferido.
        </div>

        <section className="assin">
          <div><div className="linha" />{aprovado ? <>Aprovado por {p.aprovPor ?? "—"}{p.aprovEm ? ` em ${dBR(p.aprovEm.slice(0, 10))}` : ""}</> : "Aprovação"}</div>
          <div><div className="linha" />Comprador{p.comprador ? ` — ${p.comprador}` : ""}</div>
          <div><div className="linha" />De acordo do fornecedor</div>
        </section>
        {!aprovado && <div className="rascunho">Pedido ainda não aprovado</div>}
        <footer className="rod">{e.razao_social ?? ""} · Pedido de Compra {p.num} · emitido pelo painel WaterWorks</footer>
      </div>
    </div>
  );
}

const CSS = `
  @page { size: A4; margin: 12mm; }
  html, body { background: #E9EEF7; }
  .doc { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #0B1220; padding: 24px 0 48px; }
  .folha { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; background: #fff; padding: 14mm 14mm 18mm;
    box-shadow: 0 18px 50px rgba(15,30,70,.18); border-radius: 6px; box-sizing: border-box; font-size: 10.5pt; }
  .topo { display: flex; justify-content: space-between; gap: 16px; padding-bottom: 12px; border-bottom: 3px solid #1B2F7A; }
  .emp { display: flex; gap: 12px; align-items: flex-start; }
  .logo { height: 30px; width: auto; margin-top: 4px; }
  .razao { font-size: 14pt; font-weight: 750; color: #1B2F7A; letter-spacing: -.01em; }
  .sub { font-size: 8.5pt; color: #5D6778; margin-top: 2px; }
  .caixa { min-width: 190px; text-align: right; background: linear-gradient(180deg,#2F6BFF,#1B2F7A); color: #fff; border-radius: 10px; padding: 10px 14px; }
  .caixa .rot { color: rgba(255,255,255,.75); }
  .caixa .numero { font-size: 18pt; font-weight: 800; letter-spacing: -.01em; }
  .caixa .sub { color: rgba(255,255,255,.85); }
  .rot { font-size: 7.5pt; letter-spacing: .08em; text-transform: uppercase; color: #8A93A3; font-weight: 700; margin-bottom: 4px; }
  .blocos { display: grid; grid-template-columns: 1.3fr 1fr; gap: 12px; margin: 14px 0; }
  .bloco { border: 1px solid #E3E7EF; border-radius: 8px; padding: 9px 11px; font-size: 9pt; line-height: 1.5; }
  .forte { font-weight: 700; }
  .mono { font-family: ui-monospace, Menlo, monospace; font-size: 8.5pt; }
  table { border-collapse: collapse; width: 100%; }
  .itens th { background: #EEF2F8; color: #3E4757; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 6px; }
  .itens td { padding: 6px; border-bottom: 1px solid #E3E7EF; font-size: 9pt; vertical-align: top; }
  .itens tr { page-break-inside: avoid; }
  .r { text-align: right; white-space: nowrap; }
  .obsi { font-size: 8pt; color: #5D6778; }
  .pe { display: grid; grid-template-columns: 1fr 230px; gap: 16px; margin-top: 12px; page-break-inside: avoid; }
  .parc td { padding: 3px 6px; font-size: 9pt; border-bottom: 1px dashed #E3E7EF; }
  .miudo { font-size: 8.5pt; color: #5D6778; margin-top: 8px; }
  .obs { white-space: pre-wrap; font-size: 9pt; border: 1px solid #E3E7EF; border-radius: 8px; padding: 8px 10px; }
  .tot td { padding: 4px 6px; font-size: 9.5pt; }
  .tot .grand td { background: #1B2F7A; color: #fff; font-weight: 800; font-size: 11pt; padding: 8px; }
  .aviso { margin-top: 14px; font-size: 8.5pt; background: #EAF0FB; color: #1B2F7A; border-radius: 8px; padding: 8px 10px; }
  .assin { display: grid; grid-template-columns: repeat(3, 1fr); gap: 18px; margin-top: 34px; font-size: 8.5pt; color: #3E4757; text-align: center; page-break-inside: avoid; }
  .assin .linha { border-top: 1px solid #8A93A3; margin-bottom: 4px; height: 24px; }
  .rascunho { position: absolute; top: 46%; left: 0; right: 0; text-align: center; font-size: 34pt; font-weight: 800;
    color: rgba(255,107,74,.13); transform: rotate(-18deg); pointer-events: none; }
  .rod { position: absolute; bottom: 8mm; left: 14mm; right: 14mm; font-size: 7.5pt; color: #8A93A3; text-align: center; }
  @media print {
    body * { visibility: hidden; }
    .doc, .doc * { visibility: visible; }
    .doc { position: absolute; left: 0; top: 0; width: 100%; }
    html, body, .doc { background: #fff; padding: 0; }
    .folha { box-shadow: none; border-radius: 0; width: auto; min-height: 0; padding: 0; }
    .no-print { display: none !important; }
    .rod { position: static; margin-top: 18px; }
    .caixa, .tot .grand td { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .itens th, .aviso { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
`;

"use client";

import { useState, type CSSProperties } from "react";
import { BotaoTela, cartao } from "@/components/navy/tela/KitTela";
import type { ClienteFat, DocFat, ItemFat } from "@/lib/faturamento/montar";

/* Emissão avulsa (manual ou de teste) — o formulário que vivia na tela de
   Faturamento antes do conceito PV & OS (05/10/26). Homologação por padrão. */

export type ConfigFat = { empresa: string; ativo: boolean; ambiente: string; producao_liberada: boolean; tipo_os: string };
const TIPO: Record<string, string> = { nfe: "NF-e", nfse: "NFS-e", recibo: "Recibo" };
const input: CSSProperties = {
  height: 32, padding: "0 10px", borderRadius: 8, fontSize: 12.5, fontFamily: "inherit", minWidth: 0,
  border: "1px solid var(--ww-border-strong)", background: "var(--ww-panel-sunken)", color: "var(--ww-text)",
};
const rotulo: CSSProperties = { fontSize: 11.5, color: "var(--ww-text-faint)", fontWeight: 600, display: "flex", flexDirection: "column", gap: 4 };
const lk: CSSProperties = { background: "none", border: 0, color: "var(--ww-accent-text)", cursor: "pointer", fontSize: 12.5, fontWeight: 600, padding: "0 6px 0 0" };
const VAZIO: ClienteFat = { nome: "", cnpj: "", ie: "", email: "", logradouro: "", numero: "", bairro: "", municipio: "", uf: "SP", cep: "" };
/* Destinatário de teste: a própria SF (a SEFAZ de homologação só aceita CNPJ do seu cadastro). */
const TESTE: { cliente: ClienteFat; itens: ItemFat[]; parcelas: string } = {
  cliente: {
    nome: "TESTE E2E CLIENTE LTDA", cnpj: "15766003000108", ie: "206878808115", email: "contasareceber@waterworks.com.br",
    logradouro: "Avenida Tucunare", numero: "550", bairro: "Tambore", municipio: "Barueri", codigo_municipio: "3505708", uf: "SP", cep: "06460020",
  },
  itens: [{ codigo: "TESTE-E2E-01", descricao: "TESTE E2E - ELEMENTO FILTRANTE", quantidade: 2, valor_unitario: 150, unidade: "UN", ncm: "84212100" }],
  parcelas: "30/60",
};
function parcelasDe(txt: string) {
  const dias = txt.split(/[\/,;\s]+/).map((d) => Number(d)).filter((d) => Number.isFinite(d) && d >= 0);
  return dias.length ? { parcelas: dias.map((d) => ({ dias: d })) } : null;
}

export default function NovaEmissao({ config, ocupado, onEmitir }: {
  config: ConfigFat[]; ocupado: boolean; onEmitir: (body: unknown) => void;
}) {
  const ativas = config.filter((c) => c.ativo);
  const [empresa, setEmpresa] = useState(ativas[0]?.empresa ?? "SF");
  const [tipo, setTipo] = useState<"nfe" | "nfse" | "recibo">("nfe");
  const [origemTipo, setOrigemTipo] = useState("manual");
  const [origemId, setOrigemId] = useState("");
  const [cli, setCli] = useState<ClienteFat>(VAZIO);
  const [itens, setItens] = useState<ItemFat[]>([{ codigo: "", descricao: "", quantidade: 1, valor_unitario: 0, unidade: "UN", ncm: "" }]);
  const [parc, setParc] = useState("0");
  const [obs, setObs] = useState("");
  const [pedidoCli, setPedidoCli] = useState("");
  const [gerarRec, setGerarRec] = useState(false);
  const cfg = config.find((c) => c.empresa === empresa);
  const homolog = cfg?.ambiente !== "producao";

  const campo = (k: keyof ClienteFat, rot: string, w = 160) => (
    <label style={{ ...rotulo, width: w }}>{rot}
      <input style={input} value={(cli[k] as string) ?? ""} onChange={(e) => setCli({ ...cli, [k]: e.target.value })} />
    </label>
  );

  function enviar() {
    const documento: DocFat = {
      empresa, cliente: cli, itens: itens.filter((i) => i.descricao),
      condicao: parcelasDe(parc), observacoes: obs || null, pedido_cliente: pedidoCli || null,
    };
    onEmitir({ documento, tipo, origem_tipo: origemTipo, origem_id: origemId || null, gerar_receber_homologacao: gerarRec });
  }

  return (
    <section style={{ ...cartao, padding: 18, display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={rotulo}>Empresa
          <select style={input} value={empresa} onChange={(e) => setEmpresa(e.target.value)}>
            {ativas.map((c) => <option key={c.empresa} value={c.empresa}>{c.empresa}</option>)}
          </select>
        </label>
        <label style={rotulo}>Documento
          <select style={input} value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
            <option value="nfe">NF-e (produtos / PV)</option>
            <option value="recibo">Recibo de prestação (OS)</option>
            <option value="nfse">NFS-e (OS)</option>
          </select>
        </label>
        <label style={rotulo}>Origem
          <select style={input} value={origemTipo} onChange={(e) => setOrigemTipo(e.target.value)}>
            <option value="manual">Manual</option><option value="pv">PV</option><option value="os">OS</option><option value="teste">Teste</option>
          </select>
        </label>
        <label style={{ ...rotulo, width: 120 }}>Nº PV/OS<input style={input} value={origemId} onChange={(e) => setOrigemId(e.target.value)} /></label>
        <span style={{ flex: 1 }} />
        <BotaoTela onClick={() => { setCli(TESTE.cliente); setItens(TESTE.itens); setParc(TESTE.parcelas); setOrigemTipo("teste"); setObs("TESTE E2E — homologação"); }}>
          Preencher teste
        </BotaoTela>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ww-text-2)" }}>Cliente</div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {campo("nome", "Razão social", 280)}{campo("cnpj", "CNPJ", 150)}{campo("cpf", "CPF", 130)}{campo("ie", "Inscrição estadual", 140)}{campo("email", "E-mail", 220)}
        {campo("logradouro", "Logradouro", 240)}{campo("numero", "Nº", 70)}{campo("complemento", "Compl.", 110)}{campo("bairro", "Bairro", 150)}
        {campo("municipio", "Município", 160)}{campo("codigo_municipio", "Cód. IBGE", 100)}{campo("uf", "UF", 50)}{campo("cep", "CEP", 100)}
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ww-text-2)" }}>Itens</div>
      {itens.map((it, n) => (
        <div key={n} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
          {([["codigo", "Código", 120], ["descricao", "Descrição", 300], ["ncm", "NCM", 100], ["unidade", "Un", 60]] as const).map(([k, r, w]) => (
            <label key={k} style={{ ...rotulo, width: w }}>{r}
              <input style={input} value={(it[k] as string) ?? ""} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, [k]: e.target.value } : x)))} />
            </label>
          ))}
          {([["quantidade", "Qtd"], ["valor_unitario", "Valor unit."]] as const).map(([k, r]) => (
            <label key={k} style={{ ...rotulo, width: 110 }}>{r}
              <input style={input} type="number" step="0.01" value={it[k]} onChange={(e) => setItens(itens.map((x, i) => (i === n ? { ...x, [k]: Number(e.target.value) } : x)))} />
            </label>
          ))}
          <button style={lk} onClick={() => setItens(itens.filter((_, i) => i !== n))}>remover</button>
        </div>
      ))}
      <div><button style={lk} onClick={() => setItens([...itens, { codigo: "", descricao: "", quantidade: 1, valor_unitario: 0, unidade: "UN" }])}>+ item</button></div>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ ...rotulo, width: 160 }}>Parcelas (dias)<input style={input} value={parc} onChange={(e) => setParc(e.target.value)} placeholder="ex.: 30/60/90" /></label>
        <label style={{ ...rotulo, width: 160 }}>Pedido do cliente (OC)<input style={input} value={pedidoCli} onChange={(e) => setPedidoCli(e.target.value)} /></label>
        <label style={{ ...rotulo, flex: 1, minWidth: 260 }}>Observações<input style={input} value={obs} onChange={(e) => setObs(e.target.value)} /></label>
      </div>
      {homolog && (
        <label style={{ fontSize: 12.5, color: "var(--ww-text-2)", display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={gerarRec} onChange={(e) => setGerarRec(e.target.checked)} />
          Gerar contas a receber mesmo em homologação (só para teste — o cancelamento apaga)
        </label>
      )}
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <BotaoTela primario disabled={ocupado} onClick={enviar}>{ocupado ? "Emitindo…" : `Emitir ${TIPO[tipo]}${homolog ? " (homologação)" : ""}`}</BotaoTela>
        <span style={{ fontSize: 12, color: homolog ? "#E0A93B" : "#E5484D", fontWeight: 600 }}>
          {homolog ? "Ambiente de HOMOLOGAÇÃO — sem valor fiscal" : "PRODUÇÃO — documento fiscal real"}
        </span>
      </div>
    </section>
  );
}

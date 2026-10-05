import "server-only";
import { createHash, createHmac, randomBytes } from "node:crypto";
import { rpcCad, filtrarFicha, type QuemCad } from "@/lib/cadastros-server";
import { CRM_ANON, CRM_EMPRESA, CRM_URL } from "@/lib/crm-fechamento";

// Ficha 360 (05/10/26): a pessoa inteira, em todas as empresas do grupo (mesma
// entidade — sql/59), por secções carregadas à vez (a tela pede uma de cada vez).
//   base         pessoa, empresas, mesclas, apps ligadas, parecidos, histórico
//   financeiro   a receber + a pagar (Omie + nativo) e o extrato (baixas + banco conciliado)
//   comercial    PV/OS com margem + propostas e oportunidades do CRM
//   faturamento  notas emitidas (Omie + painel/Focus)
//   compras      PCs, NFs de entrada, quanto gastei, itens comprados, RC/PC abertos
//   servicos     unidades, OS e chamados na app de Serviços
// Valores financeiros saem cortados no servidor para quem não pode ver.

type J = Record<string, unknown>;
type Irmao = { id: number; empresa: string; codigo: number; codigoOmie: number | null; origem: string; cliente: boolean; fornecedor: boolean; transportadora: boolean };

export const SECOES = ["base", "financeiro", "comercial", "faturamento", "compras", "servicos"] as const;
export type Secao = (typeof SECOES)[number];

async function base(id: number) {
  return rpcCad<J & { pessoa: J; irmaos: Irmao[] }>("cadastros_ficha360", { p_id: id, p_secao: "base" });
}

/** Junta as listas das fichas de cada empresa, marcando a empresa em cada linha. */
function juntar(fichas: { empresa: string; f: J | null }[], chave: string): J[] {
  return fichas.flatMap(({ empresa, f }) => (Array.isArray(f?.[chave]) ? (f![chave] as J[]).map((x) => ({ ...x, empresa })) : []));
}

export async function secao360(id: number, s: Secao, q: QuemCad): Promise<J> {
  const b = await base(id);
  const irmaos = (b.irmaos ?? []) as Irmao[];
  const podeRec = !!(q.perms.is_admin || q.pode["financeiro.ver_receber"]);
  const podePag = !!(q.perms.is_admin || q.pode["financeiro.ver_pagar"]);
  const podeVal = !!(q.perms.is_admin || q.pode["compras.ver_valores"]);
  const clientes = irmaos.filter((i) => i.cliente);
  const fornecedores = irmaos.filter((i) => i.fornecedor || i.transportadora);
  const fichaCli = () => Promise.all(clientes.map(async (i) => ({ empresa: i.empresa,
    f: filtrarFicha("cliente", await rpcCad<J>("cadastros_ficha_cliente", { p_id: i.id }), q) })));
  const fichaForn = () => Promise.all(fornecedores.map(async (i) => ({ empresa: i.empresa,
    f: filtrarFicha("fornecedor", await rpcCad<J>("cadastros_ficha_fornecedor", { p_id: i.id }), q) })));

  switch (s) {
    case "base":
      return { ...b, pode: { receber: podeRec, pagar: podePag, valores: podeVal, editar: q.editar, admin: q.perms.is_admin } };

    case "financeiro": {
      const [cli, forn, ext] = await Promise.all([
        podeRec ? fichaCli() : Promise.resolve([]),
        podePag ? fichaForn() : Promise.resolve([]),
        (podeRec || podePag) ? rpcCad<{ itens: J[] }>("cadastros_ficha360", { p_id: id, p_secao: "extrato" }) : Promise.resolve({ itens: [] }),
      ]);
      const soma = (arr: { f: J | null }[], k: string, campo: string) =>
        arr.reduce((a, x) => a + Number((x.f?.[k] as J | null)?.[campo] ?? 0), 0);
      const titulos = (arr: { empresa: string; f: J | null }[], k: string) =>
        arr.flatMap(({ empresa, f }) => (((f?.[k] as J | null)?.titulos ?? []) as J[]).map((t) => ({ ...t, empresa })));
      return {
        receber: podeRec && clientes.length ? { aberto: soma(cli, "receber", "aberto"), vencido: soma(cli, "receber", "vencido"),
          recebido: soma(cli, "receber", "recebido"), titulos: titulos(cli, "receber") } : null,
        pagar: podePag && fornecedores.length ? { aberto: soma(forn, "pagar", "aberto"), vencido: soma(forn, "pagar", "vencido"),
          pago: soma(forn, "pagar", "pago"), previsto: soma(forn, "pagar", "previsto"), titulos: titulos(forn, "pagar") } : null,
        extrato: ((ext.itens ?? []) as J[]).filter((x) => (x.natureza === "receber" ? podeRec : podePag)),
        pode: { receber: podeRec, pagar: podePag },
      };
    }

    case "comercial": {
      const [cli, crm] = await Promise.all([fichaCli(), crmDaPessoa(b.pessoa, irmaos)]);
      const margens = cli.map((x) => x.f?.margem as J | null).filter(Boolean) as J[];
      const fat = margens.reduce((a, m) => a + Number(m.faturamento ?? 0), 0);
      const rent = margens.reduce((a, m) => a + Number(m.rentabilidade ?? 0), 0);
      return {
        vendas: juntar(cli, "vendas"),
        margem: podeRec && margens.length ? { faturamento: fat, rentabilidade: rent, margem: fat > 0 ? Math.round((rent / fat) * 1000) / 10 : null,
          pvos: margens.reduce((a, m) => a + Number(m.pvos ?? 0), 0), pvosMedidos: margens.reduce((a, m) => a + Number(m.pvosMedidos ?? 0), 0) } : null,
        crm,
      };
    }

    case "faturamento": {
      const [cli, fat] = await Promise.all([fichaCli(), rpcCad<{ emissoes: J[] }>("cadastros_ficha360", { p_id: id, p_secao: "fat" })]);
      const emissoes = (fat.emissoes ?? []).map((e) => (podeRec ? e : { ...e, valor: null }));
      return { nfs: juntar(cli, "nfs"), emissoes };
    }

    case "compras": {
      const [forn, extra] = await Promise.all([fichaForn(), rpcCad<{ itens: J[]; abertos: J[] }>("cadastros_ficha360", { p_id: id, p_secao: "compras_extra" })]);
      const totais = forn.reduce((a, x) => {
        const t = (x.f?.totais ?? {}) as J;
        return { comprado: podeVal ? (a.comprado ?? 0) + Number(t.comprado ?? 0) : null, pcs: a.pcs + Number(t.pcs ?? 0),
          primeiro: [a.primeiro, t.primeiro as string | null].filter(Boolean).sort()[0] ?? null,
          ultimo: [a.ultimo, t.ultimo as string | null].filter(Boolean).sort().reverse()[0] ?? null };
      }, { comprado: 0 as number | null, pcs: 0, primeiro: null as string | null, ultimo: null as string | null });
      // Gasto por mês somado entre empresas.
      const meses = new Map<string, { mes: string; comprado: number | null; pago: number | null }>();
      for (const x of forn) for (const g of ((x.f?.gasto ?? []) as J[])) {
        const m = meses.get(g.mes as string) ?? { mes: g.mes as string, comprado: 0, pago: 0 };
        m.comprado = g.comprado == null ? null : (m.comprado ?? 0) + Number(g.comprado);
        m.pago = g.pago == null ? null : (m.pago ?? 0) + Number(g.pago);
        meses.set(m.mes, m);
      }
      const semValor = (arr: J[], campos: string[]) => (podeVal ? arr : arr.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, campos.includes(k) ? null : v]))));
      return {
        pcs: juntar(forn, "pcs"), nfs: juntar(forn, "nfs"), totais,
        gasto: Array.from(meses.values()).sort((a, b) => a.mes.localeCompare(b.mes)),
        itens: semValor(extra.itens ?? [], ["ultimoPreco", "total"]),
        abertos: semValor(extra.abertos ?? [], ["valor"]),
        pode: { valores: podeVal, pagar: podePag },
      };
    }

    case "servicos":
      return servicosDaPessoa(irmaos);
  }
}

// ── CRM: propostas e oportunidades (leitura com a chave pública do CRM, como o fechamento) ──
async function crmGet<T>(path: string): Promise<T> {
  const r = await fetch(`${CRM_URL}/rest/v1/${path}`, {
    headers: { apikey: CRM_ANON, Authorization: `Bearer ${CRM_ANON}` }, cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (!r.ok) throw new Error(`CRM respondeu ${r.status}`);
  return (await r.json()) as T;
}

const mascCnpj = (d: string) => d.length === 14
  ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  : d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d;

async function crmDaPessoa(p: J, irmaos: Irmao[]): Promise<J> {
  try {
    const cods = irmaos.map((i) => i.codigo);
    const omie = irmaos.map((i) => i.codigoOmie ?? (i.origem === "omie" ? i.codigo : null)).filter(Boolean) as number[];
    const doc = String(p.doc ?? "").replace(/\D/g, "");
    const filtros = [`cadastro_codigo.in.(${cods.join(",")})`];
    if (omie.length) filtros.push(`codigo_omie.in.(${omie.map((c) => `"${c}"`).join(",")})`);
    if (doc.length === 11 || doc.length === 14) filtros.push(`cnpj.in.("${doc}","${mascCnpj(doc)}")`);
    const clientes = await crmGet<{ id: string; nome: string; legacy_id: string | null }[]>(
      `clientes?select=id,nome,legacy_id&empresa_id=eq.${CRM_EMPRESA}&or=(${encodeURIComponent(filtros.join(","))})&limit=20`);
    if (!clientes.length) return { clientes: [], propostas: [], oportunidades: [] };
    const ids = clientes.map((c) => c.id);
    const nomes = Array.from(new Set(clientes.map((c) => c.nome).filter(Boolean)));
    const inNomes = nomes.map((n) => `"${n.replace(/"/g, "")}"`).join(",");
    const [propostas, oportunidades] = await Promise.all([
      crmGet<J[]>(`propostas?select=numero,status,valor,data,data_fechamento,descricao,empresa_nome,fase_doc,motivo_perda,omie_codigo_pedido&empresa_id=eq.${CRM_EMPRESA}&deleted_at=is.null&or=(${encodeURIComponent(`cliente_id.in.(${ids.join(",")}),empresa_nome.in.(${inNomes})`)})&order=data.desc.nullslast&limit=100`),
      inNomes ? crmGet<J[]>(`oportunidades?select=numero,fase_atual,valor_estimado,created_at,descricao,proposta_num,empresa_nome&empresa_id=eq.${CRM_EMPRESA}&deleted_at=is.null&empresa_nome=in.(${encodeURIComponent(inNomes)})&order=created_at.desc&limit=100`) : Promise.resolve([]),
    ]);
    // O CRM guarda datas como "dd/mm/aaaa": passa a ISO para ordenar e mostrar como o resto.
    const iso = (v: unknown) => { const m = /^(\d{2})\/(\d{2})\/(\d{4})/.exec(String(v ?? "")); return m ? `${m[3]}-${m[2]}-${m[1]}` : (v ?? null); };
    return {
      clientes: clientes.map((c) => ({ nome: c.nome })),
      propostas: propostas
        .map((x) => ({ ...x, data: iso(x.data), data_fechamento: iso(x.data_fechamento), link: `https://propostas-ww.vercel.app/?num=${encodeURIComponent(String(x.numero ?? ""))}` }))
        .sort((a, b) => String(b.data ?? "").localeCompare(String(a.data ?? ""))),
      oportunidades,
    };
  } catch (e) {
    return { indisponivel: true, motivo: e instanceof Error ? e.message : String(e), clientes: [], propostas: [], oportunidades: [] };
  }
}

// ── Serviços: unidades, OS e chamados (rota só-leitura da app, passe HMAC) ──
const b64url = (b: Buffer) => b.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
async function servicosDaPessoa(irmaos: Irmao[]): Promise<J> {
  const segredo = process.env.CADASTROS_SYNC_SECRET;
  if (!segredo) return { indisponivel: true, motivo: "CADASTROS_SYNC_SECRET não configurado no painel" };
  const corpo = JSON.stringify({
    codigos: irmaos.map((i) => ({ empresa: i.empresa, codigo: i.codigo })),
    omie: irmaos.map((i) => i.codigoOmie ?? (i.origem === "omie" ? i.codigo : null)).filter(Boolean),
  });
  const payload = b64url(Buffer.from(JSON.stringify({ s: "cadastros-ficha", x: Math.floor(Date.now() / 1000) + 60,
    n: randomBytes(12).toString("hex"), h: createHash("sha256").update(corpo).digest("hex") })));
  const passe = `${payload}.${b64url(createHmac("sha256", segredo).update(payload).digest())}`;
  try {
    const r = await fetch(`${process.env.SERVICOS_URL || "https://app.waterworks.com.br"}/api/cadastro-ficha`, {
      method: "POST", headers: { "content-type": "application/json", "x-cadastros-passe": passe }, body: corpo,
      cache: "no-store", signal: AbortSignal.timeout(10000),
    });
    if (r.status === 404 || r.status === 401 || r.status === 307 || r.redirected) {
      return { indisponivel: true, motivo: "a app de Serviços ainda não tem a leitura da ficha (publicar a v4.1.14)" };
    }
    if (!r.ok) return { indisponivel: true, motivo: `Serviços respondeu ${r.status}` };
    return (await r.json()) as J;
  } catch (e) {
    return { indisponivel: true, motivo: e instanceof Error ? e.message : String(e) };
  }
}

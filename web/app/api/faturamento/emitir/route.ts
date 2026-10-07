import { NextResponse, type NextRequest } from "next/server";
import { exigirFaturamento, falha } from "@/lib/faturamento/auth";
import { emitir, urlArquivo, type OrigemTipo, type TipoDoc } from "@/lib/faturamento/server";
import { rpc } from "@/lib/compras-server";
import { salvarVenda } from "@/lib/vendas-server";
import { codigosSemEstoque, MSG_SEM_ESTOQUE } from "@/lib/estoque-vinculos";
import type { DocFat } from "@/lib/faturamento/montar";
import type { VendaSalvar } from "@/lib/vendas";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Documento novo (Nova emissão › "Novo documento", 05/10/26): o número é
 *  automático. Antes de emitir cria o PV (NF-e) ou a OS (recibo/NFS-e) nativo
 *  na sequência (orders.vendas_salvar), para a numeração seguir contínua e o
 *  documento aparecer na carteira/Avulsos. */
type Novo = { cliente_codigo?: number | string | null; proposta?: string | null; sem_proposta_motivo?: string | null };

/**
 * POST /api/faturamento/emitir
 * { documento, tipo?: "nfe"|"nfse"|"recibo", novo?: Novo, gerar_receber_homologacao?, forcar_homologacao? }
 * Emite em HOMOLOGAÇÃO salvo a empresa ter produção liberada (fat_config).
 * NFS-e (prefeitura) com `novo`: só cria a OS — a nota é emitida no portal da
 * prefeitura e registrada depois (Registrar NFS-e).
 */
export async function POST(req: NextRequest) {
  const q = await exigirFaturamento();
  if (q instanceof NextResponse) return q;
  let body: {
    documento?: DocFat; tipo?: TipoDoc; origem_tipo?: OrigemTipo; origem_id?: string | null;
    gerar_receber_homologacao?: boolean;
    /** Só admin: força homologação (teste da Nova emissão sem emitir em produção). */
    forcar_homologacao?: boolean;
    novo?: Novo | null;
  };
  try { body = await req.json(); } catch { return falha("JSON inválido"); }
  if (!body.documento) return falha("documento é obrigatório");
  if (body.forcar_homologacao && !q.homologacao) return falha("Sem permissão para emitir em homologação (Usuários e acessos → Faturamento)", 403);
  const tipo: TipoDoc = body.tipo ?? "nfe";
  let doc = body.documento;
  let origem: { tipo: OrigemTipo; id: string | null; rotulo: string | null } = {
    tipo: body.origem_tipo ?? "manual", id: body.origem_id ?? null, rotulo: null,
  };
  let criado: { id: number; label: string } | null = null;

  try {
    // NF-e movimenta estoque: só itens do estoque nosso (código novo), nunca código de compra solto (05/10/26).
    if (tipo === "nfe") {
      const sem = await codigosSemEstoque(doc.empresa, doc.itens.map((i) => i.codigo ?? ""));
      if (doc.itens.some((i) => !(i.codigo ?? "").trim())) return falha("Há item sem código — escolha o item do estoque pela busca antes de emitir.");
      if (sem.length) return falha(MSG_SEM_ESTOQUE(sem));
    }
    // Teste (homologação forçada): não cria PV/OS — não consome a numeração real.
    if (body.novo && !body.forcar_homologacao) {
      const n = body.novo;
      const cli = String(n.cliente_codigo ?? "").trim();
      if (!cli) return falha("Escolha o cliente no cadastro (a busca por nome/CNPJ) — o PV/OS novo precisa do código do cadastro");
      const proposta = String(n.proposta ?? "").trim();
      const motivo = String(n.sem_proposta_motivo ?? "").trim();
      if (!proposta) {
        if (!q.semProposta) return falha("Escolha a proposta do CRM deste documento (sem permissão para lançar sem proposta)", 403);
        if (motivo.length < 5) return falha("Sem proposta do CRM: informe o motivo (mín. 5 caracteres)");
      }
      const c = doc.condicao ?? null;
      const frete = doc.itens.reduce((a, i) => a + (i.valor_frete ?? 0), 0);
      const p: VendaSalvar = {
        empresa: doc.empresa, tipo: tipo === "nfe" ? "PV" : "OS", cliente_codigo: cli,
        proposta: proposta || null, origem: "painel",
        condicao_codigo: c?.codigo ?? null, projeto_codigo: c?.projeto ?? null, categoria_codigo: c?.categoria ?? null,
        vendedor_codigo: c?.vendedor ?? null, conta_codigo: c?.conta_corrente != null ? String(c.conta_corrente) : null,
        num_pedido_cliente: doc.pedido_cliente ?? null, observacoes: doc.observacoes ?? null,
        valor_frete: Math.round(frete * 100) / 100 || null,
        itens: doc.itens.map((i) => ({
          codigo: i.codigo || null, descricao: i.descricao, unidade: i.unidade || "UN", ncm: i.ncm || null,
          quantidade: i.quantidade, valor_unitario: i.valor_unitario, valor_desconto: i.valor_desconto ?? null,
        })),
        parcelas: (c?.parcelas ?? []).filter((x) => x.vencimento && x.valor != null)
          .map((x, k) => ({ numero: k + 1, vencimento: String(x.vencimento), valor: Number(x.valor), dias: x.dias ?? null })),
      };
      const r = await salvarVenda(p, q.email);
      if (!proposta) await rpc("vendas_dispensa_proposta", { p_id: r.id, p_motivo: motivo, p_por: q.email });
      criado = { id: r.id, label: r.label };
      origem = { tipo: tipo === "nfe" ? "pv" : "os", id: String(r.id), rotulo: r.label };
      doc = { ...doc, rotulo: r.label };
      if (tipo === "nfse") return NextResponse.json({ criado, emissao: null });
    }

    const e = await emitir(doc, {
      tipo, origem_tipo: origem.tipo, origem_id: origem.id, origem_rotulo: origem.rotulo,
      gerar_receber_homologacao: !!body.gerar_receber_homologacao, criado_por: q.email,
      forcar_homologacao: !!body.forcar_homologacao,
    });
    return NextResponse.json({ criado, emissao: e, xml_url: await urlArquivo(e.xml_path), pdf_url: await urlArquivo(e.pdf_path) });
  } catch (e) {
    // O PV/OS já criado continua aberto na carteira (dá para emitir de lá).
    if (criado) return NextResponse.json({ criado, error: `${criado.label} criado, mas a emissão falhou: ${e instanceof Error ? e.message : String(e)}` }, { status: 400 });
    return falha(e);
  }
}

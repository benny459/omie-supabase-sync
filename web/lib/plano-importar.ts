// Grava um plano de fechamento lido da planilha CP-MC — o mesmo caminho para
// o botão "Importar planilha da proposta" e para a importação automática do
// CRM (lib/plano-auto.ts). Uma chamada, uma transação (approval.plano_importar).

import { supaAdmin } from "@/lib/supabase-admin";

type Parcela = {
  parcela: number; evento?: string | null; pct?: number | null;
  dias?: number | null; dt_plano?: string | null; valor: number;
};
type Saida = {
  origem: "material" | "sem_pc"; descricao?: string | null;
  fornecedor?: string | null; etapa?: string | null;
  dias_apos_base?: number | null; dt_prevista?: string | null;
  valor: number; no_fluxo?: boolean;
};

const ehData = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const dt = (v: unknown) => (ehData(v) ? (v as string) : null);
const s = (v: unknown, max = 400) => (v == null ? null : String(v).slice(0, max));
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : null);

export async function importarPlano(
  empresa: string, codigo: number,
  b: Record<string, unknown> & { parcelas?: Parcela[]; saidas?: Saida[] },
  quem: string,
) {
  const parcelas = Array.isArray(b.parcelas) ? b.parcelas : [];
  const saidas = Array.isArray(b.saidas) ? b.saidas : [];
  // Uma chamada, uma transação. Antes eram cinco escritas soltas pelo
  // PostgREST — grava cabeçalho, apaga parcelas, apaga saídas, insere
  // parcelas, insere saídas — cada uma com sua própria transação.
  //
  // Na primeira importação real a quinta falhou (faltava GRANT na sequence) e
  // o projeto ficou com cabeçalho e parcelas mas NENHUMA saída: R$ 91.055,04
  // entrando, R$ 0,00 saindo, margem de 100%. Um erro que apaga tudo é um
  // erro; um que deixa metade e mostra margem inventada é dado falso com cara
  // de verdadeiro, e ninguém tem motivo para desconfiar dele.
  const { data, error } = await supaAdmin().schema("approval").rpc("plano_importar", {
    p_empresa: empresa,
    p_codigo: codigo,
    p_cab: {
      proposta: s(b.proposta, 120), cliente: s(b.cliente, 200),
      data_base: dt(b.data_base),
      valor_venda: n(b.valor_venda),
      // O acordado vence o calculado quando diferem — a planilha declara isso.
      valor_fechado: n(b.valor_fechado),
      confirmado_por: s(b.confirmado_por, 120), confirmado_em: s(b.confirmado_em, 60),
      eixo_pagamento: dt(b.eixo_pagamento),
      prazo_entrega_dias: n(b.prazo_entrega_dias),
      entrega_prevista: dt(b.entrega_prevista),
      frete: s(b.frete, 200), deslocamento: s(b.deslocamento, 200),
      instalacao: s(b.instalacao, 200), impostos: s(b.impostos, 200),
      garantia: s(b.garantia, 200), forma_pagamento: s(b.forma_pagamento, 200),
      faturamento: s(b.faturamento, 200), observacoes: s(b.observacoes, 2000),
      prop_pagamento: s(b.prop_pagamento, 300), prop_faturamento: s(b.prop_faturamento, 300),
      prop_prazo: s(b.prop_prazo, 200), prop_frete: s(b.prop_frete, 200),
      prop_garantia: s(b.prop_garantia, 300), prop_instalacao: s(b.prop_instalacao, 300),
      prop_observacoes: s(b.prop_observacoes, 2000),
      custo_materiais: n(b.custo_materiais), custo_mao_obra: n(b.custo_mao_obra),
      custo_despesas: n(b.custo_despesas),
      margem_pct: n(b.margem_pct), margem_valor: n(b.margem_valor),
      importado_de: s(b.importado_de, 300),
    },
    p_parcelas: parcelas.map((x) => ({
      parcela: Math.trunc(Number(x.parcela)), evento: s(x.evento, 200),
      pct: n(x.pct), dias: n(x.dias), dt_plano: dt(x.dt_plano), valor: n(x.valor) ?? 0,
    })),
    p_saidas: saidas.map((x) => ({
      origem: x.origem === "sem_pc" ? "sem_pc" : "material",
      descricao: s(x.descricao, 300), fornecedor: s(x.fornecedor, 200),
      etapa: s(x.etapa, 120), dias_apos_base: n(x.dias_apos_base),
      dt_prevista: dt(x.dt_prevista), valor: n(x.valor) ?? 0,
      no_fluxo: x.no_fluxo !== false,
    })),
    p_custos: (Array.isArray(b.custos) ? b.custos : []).map((x, i) => {
      const c = x as Record<string, unknown>;
      return {
        grupo: c.grupo === "efetivo" ? "efetivo" : "despesa",
        descricao: s(c.descricao, 200),
        qtd_pessoas: n(c.qtd_pessoas), valor_unit: n(c.valor_unit),
        quantidade: n(c.quantidade), subtotal: n(c.subtotal) ?? 0,
        observacao: s(c.observacao, 300), ordem: i,
      };
    }),
    p_quem: quem,
  });
  /* Fluxo de caixa INICIAL (sql/112): a primeira importação congela o plano como
     foto travada; as seguintes não mexem nela (só "Redefinir", administrador).
     Sem a sql/112 o erro é ignorado — a tela cai no plano vivo. */
  if (!error) {
    await supaAdmin().schema("approval").rpc("fluxo_inicial_congelar",
      { p_empresa: empresa, p_codigo: codigo, p_quem: quem, p_forcar: false }).then(() => null, () => null);
  }
  return { data, error };
}

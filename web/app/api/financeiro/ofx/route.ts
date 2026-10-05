// /api/financeiro/ofx (05/10/26)
//  GET  → contas correntes ativas (para escolher a conta do extrato)
//  POST multipart { arquivo, empresa?, cod_cc? } → lê o OFX, acha a conta pelo
//       banco + número (ou usa a escolhida) e grava em finance.banco_movimentos
//       sem duplicar (empresa, conta, FITID).
import { NextResponse } from "next/server";
import { exigir, fin, erroDb } from "@/lib/financeiro-baixas";
import { acharConta, decodificarOfx, lerOfx, type ContaCorrente } from "@/lib/ofx";

export const runtime = "nodejs";
export const maxDuration = 60;

async function contas(): Promise<ContaCorrente[]> {
  const { data } = await fin().from("contas_correntes")
    .select("empresa, cod_cc, descricao, codigo_banco, numero_conta_corrente, tipo_conta_corrente, inativo")
    .order("empresa").order("descricao");
  return ((data ?? []) as ContaCorrente[]).filter((c) => c.inativo !== "S");
}

export async function GET() {
  const a = await exigir("financeiro.conciliar");
  if (a instanceof NextResponse) return a;
  return NextResponse.json({ contas: await contas() });
}

export async function POST(req: Request) {
  const a = await exigir("financeiro.conciliar");
  if (a instanceof NextResponse) return a;

  const form = await req.formData().catch(() => null);
  const arq = form?.get("arquivo");
  if (!(arq instanceof File)) return NextResponse.json({ error: "Envie o arquivo OFX" }, { status: 400 });
  if (arq.size > 5_000_000) return NextResponse.json({ error: "Arquivo grande demais (máx. 5 MB)" }, { status: 413 });

  let ext;
  try { ext = lerOfx(decodificarOfx(await arq.arrayBuffer())); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 422 }); }
  if (!ext.movimentos.length) return NextResponse.json({ error: "Nenhum lançamento encontrado no arquivo" }, { status: 422 });

  const todas = await contas();
  const empresa = String(form?.get("empresa") ?? "").toUpperCase();
  const codCc = Number(form?.get("cod_cc") ?? 0);
  let conta: ContaCorrente | undefined;
  if (empresa && codCc) {
    conta = todas.find((c) => c.empresa === empresa && Number(c.cod_cc) === codCc);
    if (!conta) return NextResponse.json({ error: "Conta escolhida não existe ou está inativa" }, { status: 422 });
  } else {
    const cands = acharConta(ext, todas);
    if (cands.length !== 1 && !(cands.length > 1 && cands[0].tipo_conta_corrente === "CC" && cands[1].tipo_conta_corrente !== "CC")) {
      return NextResponse.json({
        precisa_conta: true, banco: ext.banco, conta: ext.conta, candidatos: cands,
        error: cands.length ? "Mais de uma conta combina com o extrato — escolha qual." : "Não achei a conta deste extrato — escolha qual.",
      }, { status: 409 });
    }
    conta = cands[0];
  }

  const { data, error } = await fin().rpc("ofx_importar", {
    p_empresa: conta.empresa, p_cod_cc: conta.cod_cc, p_banco: ext.banco, p_conta: ext.conta,
    p_arquivo: arq.name, p_usuario: a.email, p_movs: ext.movimentos,
  });
  if (error) return erroDb(error);
  const datas = ext.movimentos.map((m) => m.data).sort();
  return NextResponse.json({
    ...(data as object), conta: { empresa: conta.empresa, cod_cc: conta.cod_cc, descricao: conta.descricao },
    de: ext.inicio ?? datas[0], ate: ext.fim ?? datas[datas.length - 1],
  });
}

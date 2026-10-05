import { requireArea } from "@/lib/require-area";
import TelaFeriados from "@/components/cadastros/TelaFeriados";

export const dynamic = "force-dynamic";

/* Cadastros › Geral › Feriados (05/10/26, sql/73): base da regra do dia útil
   (vencimento em fim de semana ou feriado → previsão no próximo dia útil). */
export default async function Page() {
  await requireArea("erp");
  return <TelaFeriados />;
}

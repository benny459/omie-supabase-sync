import { requireArea } from "@/lib/require-area";
import EstoqueView from "@/components/EstoqueView";

export const dynamic = "force-dynamic";

export default async function EstoquePage() {
  // Temporário: preso à área "financeiro" (só concessão explícita — hoje só o
  // Benny) enquanto o clone do Omie está em refino. Liberar = voltar pra "compras".
  await requireArea("financeiro");

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">Estoque</h1>
        <p className="text-[12px] text-ww-textMuted mt-0.5">
          Posição e movimentação espelhadas do Omie. Clique num produto pra ver o Kardex.
        </p>
      </div>
      <EstoqueView />
    </div>
  );
}

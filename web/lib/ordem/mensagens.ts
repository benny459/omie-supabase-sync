import "server-only";
// Mensagens e escada da cobrança — Fase 6.
export async function rodarMensagens(_o: { simular: boolean }): Promise<{ modo: string; mensagens: number }> {
  return { modo: "desligado", mensagens: 0 };
}

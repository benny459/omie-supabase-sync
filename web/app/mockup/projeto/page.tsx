// Mockup da tela de projeto, fora do grupo (app) para abrir sem login em dev.
// Não lê nem grava nada — é desenho para aprovação.
import ProjetoMockupView from "@/components/projeto/ProjetoMockupView";

export default function Page() {
  return (
    <div className="min-h-screen bg-ww-bg p-6">
      <div className="max-w-[1500px] mx-auto space-y-4">
        <div>
          <h1 className="text-[18px] font-bold text-ww-text tracking-[-0.3px]">
            Projeto — materiais, orçamento e fluxo{" "}
            <span className="text-ww-textFaint">(mockup)</span>
          </h1>
          <p className="text-[12px] text-ww-textMuted mt-0.5">
            Tela única: o cronograma manda nas entradas, o orçamento manda nas saídas, e o
            gráfico é a consequência. Tudo editável como planilha, com colar do Excel e upload.
          </p>
        </div>
        <ProjetoMockupView />
      </div>
    </div>
  );
}

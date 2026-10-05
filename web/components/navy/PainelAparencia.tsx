"use client";
// Controles de Aparência do botão dos sliders (05/10/26). Cada mudança aplica
// na hora (pré-visualização ao vivo) e fica gravada para portal, painel e Serviços.
import { FUNDOS, PADRAO, PALETAS, type Modo } from "@/lib/aparencia";
import { definirAparencia, useAparencia } from "@/lib/aparencia-store";

export default function PainelAparencia() {
  const a = useAparencia();
  return (
    <div className="apz">
      <div className="ab-seg">
        {([["claro", "Claro"], ["escuro", "Escuro"], ["sistema", "Sistema"]] as [Modo, string][]).map(([id, rotulo]) => (
          <button key={id} type="button" data-activo={a.modo === id ? "1" : undefined} onClick={() => definirAparencia({ modo: id })}>{rotulo}</button>
        ))}
      </div>

      <div className="apz-rot">Tema de cor</div>
      <div className="apz-cores">
        {PALETAS.map((p) => (
          <button key={p.id} type="button" title={p.nome} aria-label={p.nome} aria-pressed={a.paleta === p.id}
            data-activo={a.paleta === p.id ? "1" : undefined} style={{ background: p.cor }}
            onClick={() => definirAparencia({ paleta: p.id })} />
        ))}
      </div>

      <div className="apz-rot">
        <span>Transparência</span><span className="apz-val">{a.vidro}%</span>
      </div>
      <input className="apz-slider" type="range" min={0} max={100} step={5} value={a.vidro}
        aria-label="Transparência dos painéis" onChange={(e) => definirAparencia({ vidro: Number(e.target.value) })} />

      <div className="apz-rot">Fundo</div>
      <div className="apz-fundos">
        {FUNDOS.map((f) => (
          <button key={f.id} type="button" data-fundo-amostra={f.id} data-activo={a.fundo === f.id ? "1" : undefined}
            onClick={() => definirAparencia({ fundo: f.id })}>
            <i style={f.id === "cor" ? { background: a.fundoCor } : undefined} />
            <span>{f.nome}</span>
          </button>
        ))}
      </div>
      {a.fundo === "cor" && (
        <label className="apz-cor">
          <input type="color" value={a.fundoCor} onChange={(e) => definirAparencia({ fundoCor: e.target.value })} />
          <span>{a.fundoCor.toUpperCase()}</span>
        </label>
      )}

      <div className="apz-rot">Densidade</div>
      <div className="ab-seg">
        {([["conforto", "Confortável"], ["compacta", "Compacta"]] as const).map(([id, rotulo]) => (
          <button key={id} type="button" data-activo={a.densidade === id ? "1" : undefined} onClick={() => definirAparencia({ densidade: id })}>{rotulo}</button>
        ))}
      </div>

      <div className="apz-rot">Tamanho da letra</div>
      <div className="ab-seg">
        {([90, 100, 110] as const).map((f) => (
          <button key={f} type="button" data-activo={a.fonte === f ? "1" : undefined} onClick={() => definirAparencia({ fonte: f })}>{f}%</button>
        ))}
      </div>

      <button type="button" className="apz-restaurar" onClick={() => definirAparencia({ ...PADRAO })}>Restaurar padrão</button>
      <div className="ab-nota">Vale também no portal ALLKA e nos Serviços.</div>
    </div>
  );
}

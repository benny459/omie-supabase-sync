"use client";

export default function BotaoImprimir({ numero }: { numero: string }) {
  return (
    <div className="no-print" style={{ position: "fixed", top: 16, right: 16, display: "flex", gap: 8, zIndex: 10 }}>
      <button onClick={() => { document.title = `Pedido de Compra ${numero}`; window.print(); }}
        style={{ height: 36, padding: "0 16px", borderRadius: 10, border: 0, cursor: "pointer", fontWeight: 600, color: "#fff",
          background: "linear-gradient(180deg,#2F6BFF,#1B2F7A)", boxShadow: "0 6px 18px rgba(47,107,255,.35)" }}>
        🖨 Imprimir / Salvar PDF
      </button>
      <button onClick={() => window.close()} style={{ height: 36, padding: "0 14px", borderRadius: 10, border: "1px solid #CBD3E1", background: "#fff", cursor: "pointer" }}>
        Fechar
      </button>
    </div>
  );
}

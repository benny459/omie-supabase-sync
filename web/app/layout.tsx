import type { Metadata } from "next";
import { Instrument_Sans, JetBrains_Mono, Outfit, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import "./aparencia.css";
import { SCRIPT_APARENCIA } from "@/lib/aparencia";
import AparenciaSync from "@/components/navy/AparenciaSync";
import UpdateBanner from "@/components/UpdateBanner";
import CesarProvider from "@/components/cesar/CesarProvider";

// Fonte UI: Plus Jakarta Sans — a mesma do portal ALLKA (03/10/26), para a
// navegação portal ↔ painel parecer um sistema só. JetBrains Mono pra códigos/valores.
const jakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-jakarta",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono",
});

// Barra do topo (conceito do Benny, 04/10/26): Instrument Sans na interface e
// Outfit na marca — as mesmas do portal. O corpo das telas segue em Jakarta.
const instrument = Instrument_Sans({ subsets: ["latin"], display: "swap", weight: ["400", "500", "600"], variable: "--font-ak-ui" });
const outfit = Outfit({ subsets: ["latin"], display: "swap", weight: ["400", "500", "600"], variable: "--font-ak-brand" });

export const metadata: Metadata = {
  title: "Waterworks · Aprovações PC",
  description: "Painel WaterWorks · ALLKA",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  return (
    <html lang="pt-BR" suppressHydrationWarning className={`${jetbrains.variable} ${jakarta.variable} ${instrument.variable} ${outfit.variable}`}>
      <head>
        {version && <meta name="app-version" content={version} />}
        {/* Aparência do usuário (modo, paleta, vidro, fundo…) ANTES da hidratação — evita FOUC */}
        <script dangerouslySetInnerHTML={{ __html: SCRIPT_APARENCIA }} />
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var p=localStorage.getItem('ww-viz-palette');document.documentElement.setAttribute('data-palette',p||'tech');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <UpdateBanner />
        <AparenciaSync />
        {/* Envolve tudo: o Cesar é alcançável do botão de qualquer gráfico e do
            lançador flutuante, e as duas portas têm que cair na MESMA conversa —
            senão "e comparado com julho?" recomeça do zero. */}
        <CesarProvider>{children}</CesarProvider>
      </body>
    </html>
  );
}

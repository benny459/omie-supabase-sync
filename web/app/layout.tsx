import type { Metadata } from "next";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
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

export const metadata: Metadata = {
  title: "Waterworks · Aprovações PC",
  description: "Painel de aprovações de Pedidos de Compra (migração SmartSuite → Supabase)",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const version = process.env.NEXT_PUBLIC_APP_VERSION;
  return (
    <html lang="pt-BR" className={`${jetbrains.variable} ${jakarta.variable}`}>
      <head>
        {version && <meta name="app-version" content={version} />}
        {/* Aplica .dark ANTES da hidratação se o user preferiu — evita FOUC */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ww-theme');var sysDark=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t==='system'&&sysDark)||!t){document.documentElement.classList.add('dark');}var p=localStorage.getItem('ww-viz-palette');document.documentElement.setAttribute('data-palette',p||'tech');}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <UpdateBanner />
        {/* Envolve tudo: o Cesar é alcançável do botão de qualquer gráfico e do
            lançador flutuante, e as duas portas têm que cair na MESMA conversa —
            senão "e comparado com julho?" recomeça do zero. */}
        <CesarProvider>{children}</CesarProvider>
      </body>
    </html>
  );
}

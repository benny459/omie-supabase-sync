import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import "./globals.css";
import UpdateBanner from "@/components/UpdateBanner";

// Fonte UI: San Francisco (sistema, no macOS) via stack — sem fonte web
// pra preservar o feel "nativo" Apple. JetBrains Mono pra códigos/valores.
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
    <html lang="pt-BR" className={jetbrains.variable}>
      <head>
        {version && <meta name="app-version" content={version} />}
        {/* Aplica .dark ANTES da hidratação se o user preferiu — evita FOUC */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('ww-theme');var sysDark=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(t==='system'&&sysDark)||(!t&&sysDark)){document.documentElement.classList.add('dark');}}catch(e){}})();`,
          }}
        />
      </head>
      <body>
        <UpdateBanner />
        {children}
      </body>
    </html>
  );
}

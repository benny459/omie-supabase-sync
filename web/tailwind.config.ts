import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  safelist: [
    // Status pill classes — vivem em lib/columns.ts como strings (legacy + novas)
    "bg-emerald-600", "ring-emerald-700",
    "bg-sky-500", "ring-sky-600",
    "bg-orange-400", "ring-orange-500",
    "bg-slate-200", "ring-slate-300", "text-slate-800",
    "bg-violet-700", "ring-violet-800",
    "bg-violet-200", "ring-violet-300", "text-violet-900",
    "bg-rose-500", "ring-rose-600",
    "bg-slate-300", "ring-slate-400",
    // Variação D — paleta sóbria pras pills
    "bg-ww-accent", "text-ww-text", "bg-ww-bg",
  ],
  theme: {
    extend: {
      colors: {
        // Legacy brand (mantido pra compat)
        brand: {
          50:  "#eff8ff",
          100: "#dbeefe",
          500: "#1e88e5",
          600: "#1976d2",
          700: "#1565c0",
        },
        // Variação D tokens via CSS vars (light/dark switch via .dark class)
        ww: {
          bg:           "rgb(var(--color-ww-bg) / <alpha-value>)",
          panel:        "rgb(var(--color-ww-panel) / <alpha-value>)",
          border:       "rgb(var(--color-ww-border) / <alpha-value>)",
          borderStrong: "rgb(var(--color-ww-borderStrong) / <alpha-value>)",
          text:         "rgb(var(--color-ww-text) / <alpha-value>)",
          textMuted:    "rgb(var(--color-ww-textMuted) / <alpha-value>)",
          textFaint:    "rgb(var(--color-ww-textFaint) / <alpha-value>)",
          accent:       "rgb(var(--color-ww-accent) / <alpha-value>)",
          accentSoft:   "rgb(var(--color-ww-accentSoft) / <alpha-value>)",
          rowHover:     "rgb(var(--color-ww-rowHover) / <alpha-value>)",
          editHi:       "rgb(var(--color-ww-editHi) / <alpha-value>)",
          editLine:     "rgb(var(--color-ww-editLine) / <alpha-value>)",
          drawer:       "rgb(var(--color-ww-drawer) / <alpha-value>)",
          drawerHead:   "rgb(var(--color-ww-drawerHead) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ["var(--font-sans)", "Inter", "-apple-system", "BlinkMacSystemFont", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "JetBrains Mono", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
    },
  },
} satisfies Config;

// HTML → PDF no servidor (05/10/26): recibos baixados direto como arquivo, um por
// recibo, com o mesmo layout do HTML. Na Vercel usa o Chromium do
// @sparticuz/chromium; no Mac, o Chrome instalado. A fonte Arimo (métrica igual
// à Arial/Helvetica) vai embutida para o PDF sair igual em qualquer servidor.
import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";

type Navegador = import("puppeteer-core").Browser;
let aberto: Promise<Navegador> | null = null;

const CHROME_LOCAL = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function navegador(): Promise<Navegador> {
  if (aberto) {
    const b = await aberto.catch(() => null);
    if (b?.connected) return b;
  }
  aberto = (async () => {
    const puppeteer = (await import("puppeteer-core")).default;
    if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
      const chromium = (await import("@sparticuz/chromium")).default;
      return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true, defaultViewport: null });
    }
    return puppeteer.launch({ executablePath: process.env.CHROME_PATH || CHROME_LOCAL, headless: true, args: ["--no-sandbox"] });
  })();
  return aberto;
}

let fontesCss: string | null = null;
function fontes() {
  if (fontesCss != null) return fontesCss;
  const dir = path.join(process.cwd(), "lib/faturamento/fonts");
  const f = (arq: string) => { try { return readFileSync(path.join(dir, arq)).toString("base64"); } catch { return null; } };
  const faces: string[] = [];
  for (const peso of [400, 700]) for (const sub of ["latin", "latin-ext"]) {
    const b = f(`arimo-${sub}-${peso}-normal.woff2`);
    if (b) for (const nome of ["Helvetica", "Arial", "Arimo"]) faces.push(`@font-face{font-family:"${nome}";font-weight:${peso};font-style:normal;src:url(data:font/woff2;base64,${b}) format("woff2")}`);
  }
  fontesCss = faces.length ? `<style>${faces.join("")}</style>` : "";
  return fontesCss;
}

/** A4, fundos impressos, sem cabeçalho/rodapé do navegador. */
export async function htmlParaPdf(html: string): Promise<Uint8Array> {
  const comFontes = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, `${fontes()}</head>`) : fontes() + html;
  const b = await navegador();
  const pg = await b.newPage();
  try {
    await pg.setContent(comFontes, { waitUntil: "load", timeout: 30_000 });
    await pg.evaluate(() => document.fonts.ready.then(() => true));
    const pdf = await pg.pdf({ format: "A4", printBackground: true, displayHeaderFooter: false, preferCSSPageSize: true, margin: { top: 0, right: 0, bottom: 0, left: 0 } });
    return new Uint8Array(pdf);
  } finally {
    await pg.close().catch(() => null);
  }
}

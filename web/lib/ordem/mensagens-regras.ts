// Regras PURAS das mensagens e da escada (testáveis): janela do horário, texto por janela, degrau por idade.
import type { ConfigOrdem } from "./config";
import { MODULO_POR_ID } from "./modulos";

const BASE = "https://painel.waterworks.com.br";
export const min = (hm: string) => { const [h, m] = hm.split(":").map(Number); return h * 60 + (m || 0); };

/** Janela atual: o horário configurado em que estamos (cron de 15 em 15 min). */
export function janelaAtual(horarios: string[], hm: string): string | null {
  const agora = min(hm);
  for (const h of horarios) { const x = min(h); if (agora >= x && agora < x + 15) return h; }
  return null;
}


export function textoJanela(janela: string, nome: string, itens: { titulo: string; modulo: string; urgencia: string | null; degrau: number }[], feitosHoje: number): string {
  const crit = itens.filter((i) => i.urgencia === "critica").length;
  const porMod: Record<string, number> = {};
  for (const i of itens) porMod[i.modulo] = (porMod[i.modulo] ?? 0) + 1;
  const mods = Object.entries(porMod).map(([m, n]) => `${n} em ${MODULO_POR_ID[m as keyof typeof MODULO_POR_ID]?.rotulo ?? m}`).join(", ");
  const top = itens.slice(0, 3).map((i) => `- ${i.titulo}`).join("\n");
  const link = `[Abrir o Meu dia](${BASE}/ordem)`;
  const h = min(janela);
  if (h < 10 * 60) return `**✦ Bom dia, ${nome}.** Seu dia: **${itens.length}** decisão(ões) (${mods})${crit ? `, ${crit} crítica(s)` : ""}.\n\nComece por:\n${top}\n\n${link}`;
  if (h < 14 * 60) return `**✦ Meio do dia, ${nome}:** ${feitosHoje} resolvido(s) hoje, ${itens.length} por resolver (${mods}).\n\n${top}\n\n${link}`;
  if (h < 17 * 60 + 30) return `**✦ Último aviso, ${nome}:** ${itens.length} item(ns) entram no relatório da gestão às 18:00 se ficarem parados.\n\n${top}\n\n${link}`;
  return `**✦ Fechamento, ${nome}:** ${feitosHoje} resolvido(s) hoje; ficam ${itens.length} (${mods}).${itens.some((i) => i.degrau >= 2) ? " Alguns já estão no relatório da supervisão." : ""}\n\n${link}`;
}

/** Sobe o degrau da escada pela idade do item (dias corridos na fila) — só itens com dono. */
export function degrauPorIdade(criadoEm: string, hojeIso: string, esc: ConfigOrdem["escada"]): number {
  const dias = Math.floor((Date.parse(hojeIso) - Date.parse(criadoEm)) / 86_400_000);
  if (esc.dias_direcao > 0 && dias >= esc.dias_direcao) return 3;
  if (esc.dias_supervisao > 0 && dias >= esc.dias_supervisao) return 2;
  if (esc.dias_segundo_aviso > 0 && dias >= esc.dias_segundo_aviso) return 1;
  return 0;
}


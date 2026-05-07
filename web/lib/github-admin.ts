import "server-only";

const GH_API = "https://api.github.com";
const REPO = "benny459/omie-supabase-sync";

function token(): string {
  const t = process.env.GITHUB_TOKEN;
  if (!t) throw new Error("GITHUB_TOKEN não configurado nas env vars do Vercel");
  return t;
}

export async function ghFetch<T = unknown>(endpoint: string, init: RequestInit = {}): Promise<T> {
  const headers = {
    Authorization: `Bearer ${token()}`,
    Accept: "application/vnd.github.v3+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(init.headers ?? {}),
  };
  const res = await fetch(`${GH_API}${endpoint}`, { ...init, headers, cache: "no-store" });
  if (!res.ok && res.status !== 204) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub ${res.status}: ${body.slice(0, 200)}`);
  }
  if (res.status === 204) return {} as T;
  return res.json() as Promise<T>;
}

// Dispara workflow_dispatch
export async function dispatchWorkflow(file: string, inputs: Record<string, string> = {}) {
  return ghFetch(`/repos/${REPO}/actions/workflows/${file}/dispatches`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ref: "main", inputs }),
  });
}

// Lê YAML do workflow
export async function getWorkflowFile(file: string): Promise<{ yaml: string; sha: string }> {
  const d = await ghFetch<{ content: string; sha: string }>(
    `/repos/${REPO}/contents/.github/workflows/${file}`,
  );
  const yaml = Buffer.from(d.content, "base64").toString("utf8");
  return { yaml, sha: d.sha };
}

// Atualiza YAML (commit em main)
export async function updateWorkflowFile(file: string, yaml: string, sha: string, message: string) {
  return ghFetch(`/repos/${REPO}/contents/.github/workflows/${file}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: Buffer.from(yaml, "utf8").toString("base64"),
      sha,
      branch: "main",
    }),
  });
}

// Extrai TODOS os crons ATIVOS (não comentados) do YAML
export function extractCrons(yaml: string): string[] {
  const out: string[] = [];
  for (const line of yaml.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#")) continue;
    const m = line.match(/cron:\s*"([^"]+)"/);
    if (m) out.push(m[1]);
  }
  return out;
}

export type ScheduleStatus = "ativo" | "desativado" | "sem_schedule";

export function scheduleStatus(yaml: string): ScheduleStatus {
  for (const line of yaml.split("\n")) {
    if (/^\s*schedule:\s*$/.test(line)) return "ativo";
    if (/^\s*#\s*schedule\s*DESATIVADO/i.test(line)) return "desativado";
  }
  return "sem_schedule";
}

// Converte cron UTC → hora BRT humanizada
export function cronToBRT(cron: string): { time: string; day: string } {
  const p = cron.split(" ");
  const minute = parseInt(p[0]);
  const hour = parseInt(p[1]);
  const dayOfWeek = p[4];
  const brtHour = ((hour - 3) + 24) % 24;
  const dayLabels: Record<string, string> = {
    "*": "Todo dia", "0": "Dom", "1": "Seg", "2": "Ter", "3": "Qua", "4": "Qui",
    "5": "Sex", "6": "Sáb", "1-5": "Seg a Sex",
  };
  return {
    time: `${String(brtHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
    day: dayLabels[dayOfWeek] ?? dayOfWeek,
  };
}

// Parse cron UTC simples (formatos: "0 H * * *", "0 H * * 1-5", "0 H1,H2,... * * DOW", "0 */N * * *").
// Retorna { hoursUtc: number[], daysUtc: Set<number> (0=Dom...6=Sab) }.
function parseCron(cron: string): { hoursUtc: number[]; daysUtc: Set<number> } {
  const p = cron.split(" ");
  const hourField = p[1];
  const dow = p[4];

  const hoursUtc: number[] = [];
  if (hourField === "*") {
    for (let i = 0; i < 24; i++) hoursUtc.push(i);
  } else if (hourField.startsWith("*/")) {
    const n = parseInt(hourField.slice(2));
    for (let i = 0; i < 24; i += n) hoursUtc.push(i);
  } else if (hourField.includes(",")) {
    for (const h of hourField.split(",")) hoursUtc.push(parseInt(h));
  } else if (hourField.includes("-")) {
    const [a, b] = hourField.split("-").map(Number);
    for (let i = a; i <= b; i++) hoursUtc.push(i);
  } else {
    hoursUtc.push(parseInt(hourField));
  }

  const daysUtc = new Set<number>();
  if (dow === "*") {
    for (let i = 0; i < 7; i++) daysUtc.add(i);
  } else if (dow.includes("-")) {
    const [a, b] = dow.split("-").map(Number);
    for (let i = a; i <= b; i++) daysUtc.add(i);
  } else if (dow.includes(",")) {
    for (const d of dow.split(",")) daysUtc.add(parseInt(d));
  } else {
    daysUtc.add(parseInt(dow));
  }

  return { hoursUtc: [...new Set(hoursUtc)].sort((a,b) => a-b), daysUtc };
}

const BRT_DAY_NAMES = ["Domingo","Segunda","Terça","Quarta","Quinta","Sexta","Sábado"];

// Dado um conjunto de crons UTC, retorna o próximo disparo em BRT (humanizado).
export function nextRunBRT(crons: string[]): { relative: string; absolute: string; iso: string } | null {
  if (!crons.length) return null;
  const now = new Date();
  // Próximas 14 dias de candidatos (limite de segurança)
  for (let addMin = 0; addMin < 60 * 24 * 14; addMin++) {
    const candidate = new Date(now.getTime() + addMin * 60_000);
    candidate.setUTCSeconds(0, 0);
    if (candidate.getUTCMinutes() !== 0) continue;
    for (const cron of crons) {
      const { hoursUtc, daysUtc } = parseCron(cron);
      if (!daysUtc.has(candidate.getUTCDay())) continue;
      if (!hoursUtc.includes(candidate.getUTCHours())) continue;
      // Match! Formata em BRT
      const brtTime = new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
      }).format(candidate);
      // Dia da semana em BRT
      const brtDateStr = new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit",
      }).format(candidate);
      const [m, d, y] = brtDateStr.split("/").map(Number);
      const brtDate = new Date(Date.UTC(y, m - 1, d));
      const dayName = BRT_DAY_NAMES[brtDate.getUTCDay()];
      // Relativo: quantos minutos/horas a partir de agora
      const diffMs = candidate.getTime() - now.getTime();
      const diffMin = Math.round(diffMs / 60_000);
      let relative: string;
      if (diffMin < 2) relative = "agora";
      else if (diffMin < 60) relative = `em ${diffMin} min`;
      else if (diffMin < 60 * 24) relative = `em ${Math.floor(diffMin / 60)}h${diffMin % 60 ? ` ${diffMin % 60}m` : ""}`;
      else relative = `em ${Math.floor(diffMin / (60 * 24))} dia(s)`;
      return {
        relative,
        absolute: `${dayName}, ${brtTime} BRT`,
        iso: candidate.toISOString(),
      };
    }
  }
  return null;
}

// Comenta o bloco `schedule:` + linhas `- cron:` seguintes
export function disableScheduleInYaml(yaml: string): string {
  const lines = yaml.split("\n");
  const out: string[] = [];
  let insideSchedule = false;
  let scheduleIndent = "";
  for (const line of lines) {
    const schedMatch = line.match(/^(\s*)schedule:\s*$/);
    if (schedMatch) {
      insideSchedule = true;
      scheduleIndent = schedMatch[1];
      out.push(`${scheduleIndent}# schedule DESATIVADO — disparar só manualmente`);
      continue;
    }
    if (insideSchedule) {
      if (/^\s*-\s*cron:/.test(line)) {
        out.push("# " + line);
        continue;
      }
      if (/^\s*$/.test(line) || (line.startsWith(scheduleIndent) && line.length > scheduleIndent.length && /^\s/.test(line[scheduleIndent.length]))) {
        out.push(line);
        continue;
      }
      insideSchedule = false;
    }
    out.push(line);
  }
  return out.join("\n");
}

// Descomenta o bloco desativado
export function enableScheduleInYaml(yaml: string): string {
  return yaml
    .split("\n")
    .map((l) => {
      if (/^\s*#\s*schedule\s*DESATIVADO/i.test(l)) {
        return l.replace(/#\s*schedule\s*DESATIVADO.*$/i, "schedule:");
      }
      const cronMatch = l.match(/^(\s*)#\s*(-\s*cron:.*)$/);
      if (cronMatch) return `${cronMatch[1]}${cronMatch[2]}`;
      return l;
    })
    .join("\n");
}

// Modo de janela: 24/7 ou dias úteis (BRT)
export type WindowMode = "24/7" | "weekdays-6-20" | "weekdays-6-18" | "weekdays-7-19";

// Gera lista de crons (UTC) representando "a cada N horas" dentro da janela escolhida (BRT → UTC)
export function buildCrons(intervalHours: number, mode: WindowMode): string[] {
  if (![1,2,3,4,6,8,12].includes(intervalHours)) {
    throw new Error("Intervalo deve ser 1, 2, 3, 4, 6, 8 ou 12 horas");
  }

  let startBrt = 0, endBrt = 23, dow = "*";
  if (mode === "24/7") { startBrt = 0; endBrt = 23; dow = "*"; }
  else if (mode === "weekdays-6-20") { startBrt = 6; endBrt = 20; dow = "1-5"; }
  else if (mode === "weekdays-6-18") { startBrt = 6; endBrt = 18; dow = "1-5"; }
  else if (mode === "weekdays-7-19") { startBrt = 7; endBrt = 19; dow = "1-5"; }

  const brtHours: number[] = [];
  for (let h = startBrt; h <= endBrt; h += intervalHours) brtHours.push(h);
  // BRT → UTC: UTC = BRT + 3
  const utcHours = [...new Set(brtHours.map((h) => (h + 3) % 24))].sort((a,b) => a-b);

  // Caso 24/7 com intervalo divisor de 24 → usa `*/N` (mais limpo)
  if (mode === "24/7" && 24 % intervalHours === 0) {
    return [`0 */${intervalHours} * * *`];
  }
  // Janela de dias úteis pode cruzar meia-noite em UTC — se cruza, divide em 2 crons
  // Ex: BRT 6-20 seg-sex = UTC 9-23 seg-sex (não cruza, OK)
  // Ex: BRT 0-4 seg-sex = UTC 3-7 seg-sex (não cruza, OK)
  return [`0 ${utcHours.join(",")} * * ${dow}`];
}

// Reescreve o bloco `schedule:` do YAML com os novos crons.
// Se o schedule estiver DESATIVADO (comentado), reativa.
export function replaceScheduleInYaml(yaml: string, newCrons: string[]): string {
  const lines = yaml.split("\n");
  const out: string[] = [];
  let insideSchedule = false;
  let foundSchedule = false;
  let scheduleIndent = "";
  for (const line of lines) {
    const reactivate = line.match(/^(\s*)#\s*schedule\s*DESATIVADO/i);
    if (reactivate) {
      insideSchedule = true;
      foundSchedule = true;
      scheduleIndent = reactivate[1];
      out.push(`${scheduleIndent}schedule:`);
      for (const c of newCrons) out.push(`${scheduleIndent}  - cron: "${c}"`);
      continue;
    }
    const schedMatch = line.match(/^(\s*)schedule:\s*$/);
    if (schedMatch) {
      insideSchedule = true;
      foundSchedule = true;
      scheduleIndent = schedMatch[1];
      out.push(line);
      for (const c of newCrons) out.push(`${scheduleIndent}  - cron: "${c}"`);
      continue;
    }
    if (insideSchedule) {
      // Elimina linhas cron antigas (ativas OU comentadas) — nossas substituem
      if (/^\s*-\s*cron:/.test(line)) continue;
      if (/^\s*#\s*-\s*cron:/.test(line)) continue;
      // Fora do bloco (outdented ou vazio indica fim)
      if (/^\s*$/.test(line)) { out.push(line); continue; }
      if (!line.startsWith(scheduleIndent + "  ")) {
        insideSchedule = false;
      }
    }
    out.push(line);
  }
  // Se nem ativo nem desativado (workflow sem bloco schedule), adiciona após `on:`
  if (!foundSchedule) {
    const injected: string[] = [];
    let injected_done = false;
    for (const l of out) {
      injected.push(l);
      if (!injected_done && /^on:\s*$/.test(l)) {
        injected.push(`  schedule:`);
        for (const c of newCrons) injected.push(`    - cron: "${c}"`);
        injected_done = true;
      }
    }
    return injected.join("\n");
  }
  return out.join("\n");
}

export const WORKFLOWS = [
  { file: "master_sales_diaria.yml",   name: "Sales Diária",    kind: "sales"   as const, description: "Pedidos, OS, NFs, etapas" },
  { file: "master_sales_semanal.yml",  name: "Sales Semanal",   kind: "sales"   as const, description: "Produtos, formas de pagamento" },
  { file: "master_orders_diaria.yml",  name: "Orders Diária",   kind: "orders"  as const, description: "Pedidos de compra" },
  { file: "master_orders_semanal.yml", name: "Orders Semanal",  kind: "orders"  as const, description: "Tabelas auxiliares" },
  { file: "master_finance_diaria.yml", name: "Finance Diária",  kind: "finance" as const, description: "Contas a pagar/receber" },
  { file: "master_finance_semanal.yml",name: "Finance Cadastros",kind: "finance" as const, description: "Clientes, projetos, categorias" },
];

// Chat IA do Suporte do painel — 3 caminhos: pergunta livre, bug, feature.
// Cadeia de provedores: Gemini → Groq → Anthropic.

const SYSTEM_PROMPT = `Você é o assistente de suporte do painel WaterWorks (aprovações de PC, painel de vendas avulsas, gestão Omie). Um usuário (admin/aprovador/operacional) abriu chat. Pode ser pra REPORTAR um problema, FAZER UMA PERGUNTA sobre o painel, ou os dois.

Identifique a intenção logo na 1ª mensagem. Há TRÊS caminhos:

==================== CAMINHO 1: PERGUNTA / DÚVIDA ====================
Usuário pergunta como funciona algo:
  - Responde direto, em 2-4 frases.
  - NÃO cria ticket. NÃO usa marker.
  - Use seu conhecimento sobre PCs, PVs, etapas Omie, aprovações, painel de vendas.

==================== CAMINHO 2: REPORTE DE BUG ====================
Algo torto/quebrado/errado/sumido/que-não-funciona:

Etapa 1 — Cumprimente em 1 frase amigável (NÃO se apresente como IA).
Etapa 2 — Pergunte no MÁXIMO 2x (uma por mensagem):
  - Em qual tela aconteceu
  - O que esperava vs o que viu
  - Passo-a-passo curto, se importar
Se a 1ª mensagem já tem detalhe suficiente, pula pra Etapa 3.

Etapa 3 — Encerra com:
  - 1 frase: "Entendi: [resumo]"
  - "Adicionei ao seu conjunto. Pode adicionar mais problemas ou clicar em Enviar conjunto para começar a resolução."
  - Linha separada: [TICKET_FECHADO]

==================== CAMINHO 3: FEATURE / ESTRUTURAL ====================
Pedido de feature nova, refactor, mudança de regra de negócio:
  - Explica em 2-3 frases que o pedido precisa de avaliação manual do Benny.
  - "Vou encaminhar pro Benny."
  - Linha separada: [TICKET_FECHADO_NAO_BUG]

==================== REGRAS ====================
- Na DÚVIDA entre pergunta e bug, peça 1 esclarecimento curto.
- PRESUMA bug se a descrição menciona algo torto/quebrado/sumido/lento.
- NUNCA prometa fix se tiver dúvida.
- NUNCA mencione horários/ciclos/"vou processar às X".
- NUNCA fale de "watcher", "branch", "commit", "Claude Code", "RAG", "vector", "LLM".
- Tom: profissional, direto, brasileiro. Sem markdown. Sem bullets. Sem emojis.
- Mensagens curtas (2-4 frases).`;

type Msg = { role: "user" | "assistant"; content: string };

async function callGemini(systemText: string, messages: Msg[]) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const contents = messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content || "") }] }));
  // gemini-2.5-flash — modelo mais recente + 1500 req/min (chat conversacional).
  // Reserva-se 2.5-pro pro cron bug-analyze (50 req/min, qualidade alta).
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const resp = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ contents, systemInstruction: { parts: [{ text: systemText }] }, generationConfig: { temperature: 0.5, maxOutputTokens: 600 } }) });
  if (!resp.ok) throw new Error(`gemini ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p: { text?: string }) => p.text).filter(Boolean).join("\n").trim();
}

async function callGroq(systemText: string, messages: Msg[]) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  const m = [{ role: "system", content: systemText }, ...messages];
  const resp = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: "llama-3.3-70b-versatile", messages: m, temperature: 0.5, max_tokens: 600 }),
  });
  if (!resp.ok) throw new Error(`groq ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  return data.choices?.[0]?.message?.content?.trim() || "";
}

async function callAnthropic(systemText: string, messages: Msg[]) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return null;
  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 600, system: systemText, messages }),
  });
  if (!resp.ok) throw new Error(`anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
  const data = await resp.json();
  return (data.content || []).map((c: { text?: string }) => c.text).filter(Boolean).join("\n").trim();
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) return Response.json({ ok: false, error: "messages required" }, { status: 400 });
    const trimmed = messages.slice(-30).map((m: Msg) => ({ role: m.role === "assistant" ? "assistant" : "user", content: String(m.content || "").slice(0, 4000) })) as Msg[];
    const providers = [
      { name: "gemini", fn: () => callGemini(SYSTEM_PROMPT, trimmed) },
      { name: "groq", fn: () => callGroq(SYSTEM_PROMPT, trimmed) },
      { name: "anthropic", fn: () => callAnthropic(SYSTEM_PROMPT, trimmed) },
    ];
    let text: string | null = null; let used: string | null = null; const errs: string[] = [];
    for (const p of providers) {
      try { const r = await p.fn(); if (r === null) continue; if (r && r.length > 0) { text = r; used = p.name; break; } }
      catch (e) { errs.push(`${p.name}: ${e instanceof Error ? e.message : "err"}`); }
    }
    // Modo degradado — nenhum provedor disponível (rate limit / network).
    // Mensagem honesta sobre o que se passou, registando o ticket à mesma.
    if (!text) return Response.json({ ok: true, message: "Os meus modelos estão a engasgar agora (rate limit). A sua mensagem fica registada como ticket — o Benny olha pessoalmente.", closed: true, closedKind: "bug", provider: "fallback_offline", diagnostics: errs.join(" | ") });
    const closedNoBug = /\[?TICKET_FECHADO_NAO_BUG\]?/.test(text);
    const closed = !closedNoBug && /\[?TICKET_FECHADO\]?/.test(text);
    const message = text.replace(/\[?TICKET_FECHADO_NAO_BUG\]?/g, "").replace(/\[?TICKET_FECHADO\]?/g, "").trim();
    return Response.json({ ok: true, message, closed: closed || closedNoBug, closedKind: closedNoBug ? "nao_bug" : (closed ? "bug" : null), provider: used });
  } catch (e) {
    return Response.json({ ok: false, error: e instanceof Error ? e.message : "err" }, { status: 500 });
  }
}

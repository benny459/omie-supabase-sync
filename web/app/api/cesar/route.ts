// POST /api/cesar — a conversa com o Cesar.
//
// Streaming por SSE porque o laço de ferramentas leva tempo: uma pergunta como
// "por que setembro apertou" pode custar três ou quatro consultas antes da
// primeira palavra. Sem stream, a tela fica parada e parece travada; com stream,
// o Benny vê "consultando aging a pagar…" e sabe que está andando.
//
// Eventos emitidos:
//   { t: "ferramenta", nome, entrada }   — começou uma consulta
//   { t: "resultado", nome, linhas, truncado } — a consulta voltou
//   { t: "texto", v }                    — pedaço da resposta
//   { t: "fim", uso }                    — acabou
//   { t: "erro", v }

import Anthropic from "@anthropic-ai/sdk";
import { supaServer } from "@/lib/supabase-server";
import { canViewArea } from "@/lib/permissions";
import { loadPerms } from "@/lib/require-area";
import { createClient } from "@supabase/supabase-js";
import { executar, tools } from "@/lib/cesar/ferramentas";
import { sistema } from "@/lib/cesar/prompt";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Teto de rodadas de ferramenta. Não é economia: é trava contra laço — um
 *  modelo que se confunde pode ficar repetindo a mesma consulta. Oito rodadas
 *  cobrem qualquer pergunta que as ferramentas conseguem responder. */
const MAX_RODADAS = 8;

type Msg = { role: "user" | "assistant"; content: string };

export async function POST(req: Request) {
  const supa = await supaServer();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const perms = await loadPerms();
  if (!canViewArea(perms, "financeiro") && !canViewArea(perms, "bi")) {
    return Response.json({ error: "Sem acesso" }, { status: 403 });
  }

  const chave = process.env.ANTHROPIC_API_KEY;
  if (!chave) {
    return Response.json(
      { error: "ANTHROPIC_API_KEY não configurada no ambiente." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const historico = (Array.isArray(body.mensagens) ? body.mensagens : []) as Msg[];
  const contexto = typeof body.contexto === "string" ? body.contexto.slice(0, 12000) : undefined;
  const origem   = typeof body.origem === "string" ? body.origem.slice(0, 120) : null;
  if (!historico.length) return Response.json({ error: "sem mensagem" }, { status: 400 });

  // ── Persistência ──────────────────────────────────────────────────────────
  // Grava pelo cliente do USUÁRIO: a RLS de public.cesar_conversa é quem impede
  // um usuário de escrever na conversa de outro. Com service_role essa garantia
  // viraria um `eq("user_id", …)` repetido em cada consulta.
  //
  // A pergunta é gravada ANTES da resposta. Se o modelo falhar no meio, o
  // histórico mostra o que foi perguntado — uma conversa que some porque a
  // resposta deu erro é a pior hora de perder o rastro.
  const supaUser = await supaServer("public");
  const pergunta = historico[historico.length - 1]?.content ?? "";
  let conversaId: string | null =
    typeof body.conversa_id === "string" ? body.conversa_id : null;

  if (!conversaId) {
    const { data: nova } = await supaUser
      .from("cesar_conversa")
      .insert({
        user_id: user.id,
        // Título = a primeira pergunta, cortada. Pedir um título ao modelo
        // custaria uma chamada inteira antes da resposta aparecer, e a pergunta
        // do próprio Benny é o melhor rótulo que existe para reencontrá-la.
        titulo: pergunta.slice(0, 90) || "Conversa",
        origem,
      })
      .select("id")
      .single();
    conversaId = nova?.id ?? null;
  }
  if (conversaId) {
    await supaUser.from("cesar_mensagem")
      .insert({ conversa_id: conversaId, papel: "user", conteudo: pergunta });
  }

  const anthropic = new Anthropic({ apiKey: chave });
  const adm = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false }, db: { schema: "bi" } },
  );

  // Data local (America/Sao_Paulo). toISOString() é UTC e depois das 21h daria
  // amanhã — o Cesar responderia "hoje" com a data errada.
  const hoje = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo", dateStyle: "full",
  }).format(new Date());

  const modelo = process.env.CESAR_MODEL || "claude-opus-5";

  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(ctrl) {
      const envia = (o: unknown) => ctrl.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));

      // Avisa o id logo de cara: se a aba fechar no meio da resposta, o cliente
      // já sabe em qual conversa reentrar.
      envia({ t: "conversa", id: conversaId });

      try {
        const msgs: Anthropic.MessageParam[] = historico.map((m) => ({
          role: m.role, content: m.content,
        }));

        let rodada = 0;
        let entradaTot = 0, saidaTot = 0;
        /** O que vai pro banco no fim: a resposta e as consultas que a
         *  sustentam. Sem os passos, a conversa relida vira afirmação sem
         *  procedência. */
        let resposta = "";
        const passos: Array<Record<string, unknown>> = [];

        while (rodada++ < MAX_RODADAS) {
          const resp = await anthropic.messages.create({
            model: modelo,
            max_tokens: 12000,
            // Raciocínio ligado de propósito: escolher QUAIS consultas fazer, e
            // depois cruzar o que voltou, é o trabalho — não é formatação.
            //
            // A forma mudou no Opus 5: `{type:"enabled", budget_tokens}` é a API
            // dos modelos 4.x e é recusada com 400 aqui. O modelo agora decide
            // sozinho quanto pensar ("adaptive") e o que se controla é o ESFORÇO.
            thinking: { type: "adaptive" },
            output_config: { effort: "medium" },
            system: sistema(hoje, contexto),
            tools: tools(),
            messages: msgs,
            stream: true,
          });

          const blocos: Anthropic.ContentBlock[] = [];
          /** JSON do tool_use chega fatiado, e por índice de bloco — não dá pra
           *  guardar num acumulador só se dois blocos vierem intercalados. */
          const parciais = new Map<number, string>();

          for await (const ev of resp) {
            if (ev.type === "message_start") {
              entradaTot += ev.message.usage.input_tokens ?? 0;
            } else if (ev.type === "content_block_start") {
              parciais.set(ev.index, "");
              blocos[ev.index] = ev.content_block as Anthropic.ContentBlock;
              if (ev.content_block.type === "tool_use") {
                envia({ t: "ferramenta", nome: ev.content_block.name });
              }
            } else if (ev.type === "content_block_delta") {
              const b = blocos[ev.index];
              if (ev.delta.type === "text_delta") {
                envia({ t: "texto", v: ev.delta.text });
                resposta += ev.delta.text;
                if (b?.type === "text") b.text += ev.delta.text;
              } else if (ev.delta.type === "input_json_delta") {
                parciais.set(ev.index, (parciais.get(ev.index) ?? "") + ev.delta.partial_json);
              }
              // Bloco de raciocínio. Precisa ser remontado E devolvido com a
              // assinatura na rodada seguinte — a API recusa a mensagem se o
              // bloco voltar vazio ("each thinking block must contain
              // thinking"), que foi exatamente o erro 400 em produção. Ele não
              // vai pra tela: é rascunho, não resposta.
              else if (ev.delta.type === "thinking_delta") {
                if (b?.type === "thinking") b.thinking += ev.delta.thinking;
              } else if (ev.delta.type === "signature_delta") {
                if (b?.type === "thinking") b.signature = ev.delta.signature;
              }
            } else if (ev.type === "content_block_stop") {
              const b = blocos[ev.index];
              if (b?.type === "tool_use") {
                // O SDK entrega o JSON em fatias; só no stop ele está completo.
                const p = parciais.get(ev.index) ?? "";
                try { b.input = p ? JSON.parse(p) : {}; }
                catch { b.input = {}; }
              }
            } else if (ev.type === "message_delta") {
              saidaTot += ev.usage.output_tokens ?? 0;
            }
          }

          // filter(Boolean) porque o array é indexado por posição do bloco e
          // pode ficar esparso se algum índice não abrir. O segundo filtro é
          // cinto de segurança: um bloco de raciocínio vazio derruba a rodada
          // seguinte com 400, e é melhor perdê-lo do que perder a conversa.
          const conteudo = blocos
            .filter(Boolean)
            .filter((b) => !(b.type === "thinking" && !b.thinking));
          const usos = conteudo.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
          if (!usos.length) break;   // respondeu em texto: acabou

          msgs.push({ role: "assistant", content: conteudo });

          // Todas as ferramentas da rodada em paralelo — são leituras
          // independentes, e serializar só somaria latência.
          const resultados = await Promise.all(usos.map(async (u) => {
            const out = await executar(adm, u.name, (u.input ?? {}) as Record<string, unknown>);
            const passo = { nome: u.name,
                           linhas: Number(out.total_linhas) || 0,
                           truncado: !!out.truncado, erro: out.erro ?? null };
            passos.push(passo);
            envia({ t: "resultado", ...passo });
            return {
              type: "tool_result" as const,
              tool_use_id: u.id,
              content: JSON.stringify(out),
              is_error: !!out.erro,
            };
          }));

          msgs.push({ role: "user", content: resultados });
        }

        if (rodada > MAX_RODADAS) {
          envia({ t: "texto", v: "\n\n_(parei aqui: bati o limite de consultas para uma pergunta só. Refaça mais específica.)_" });
        }
        // Grava a resposta E carimba a conversa como ativa, para ela subir ao
        // topo da lista. Ordenar por data de criação faria uma conversa retomada
        // hoje continuar enterrada onde nasceu.
        if (conversaId && resposta.trim()) {
          await supaUser.from("cesar_mensagem").insert({
            conversa_id: conversaId, papel: "assistant",
            conteudo: resposta, passos: passos.length ? passos : null,
          });
          await supaUser.from("cesar_conversa")
            .update({ atualizada_em: new Date().toISOString() })
            .eq("id", conversaId);
        }

        envia({ t: "fim", uso: { entrada: entradaTot, saida: saidaTot, modelo } });
      } catch (e) {
        envia({ t: "erro", v: e instanceof Error ? e.message : String(e) });
      } finally {
        ctrl.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}

---
name: tutorial-video
description: Gera um vídeo-tutorial narrado em português (pt-BR) de um fluxo do painel.waterworks.com.br a partir do código e do manual, sem ninguém gravar tela. Use quando o usuário pedir "faz um tutorial em vídeo de X", "grava um vídeo explicando como Y", "tutorial da tela Z".
---

# Tutorial em vídeo — gerado do código

> **Neste painel (ajustado em 08/10/26):** tudo roda dentro de `web/` — script em `web/scripts/tutorial/gravar.mjs`, roteiros em `web/tutoriais/<slug>/roteiro.json`, comando `cd web && PATH="$HOME/Library/Python/3.9/bin:$PATH" node --env-file=.env.local scripts/tutorial/gravar.mjs --roteiro tutoriais/<slug>/roteiro.json [--dry]`.
> **Não existe tenant DEMO** — o painel só tem CD/SF/WW no banco de produção. Os passos com clique que GRAVA (levar para a lista, gerar PC…) mudam dados reais: combine com o Benny qual projeto usar antes de rodar sem `--dry`.
> Login: conta própria de tutorial (`TUTORIAL_LOGIN_EMAIL/SENHA` no `web/.env.local`, criada pelo Benny). `TUTORIAL_BASE_URL=https://painel.waterworks.com.br` (os `data-testid` precisam estar publicados) ou `http://localhost:3000`.
> Campos extras do passo: `"esperar": "<seletor>"` (espera aparecer depois de navegar) e `"opcional": true` (se o elemento não estiver na tela, o passo é pulado e sai do áudio).
> A legenda é desenhada na própria página (o ffmpeg do brew vem sem libass) e também vai como faixa de legenda no mp4.

Você vai produzir um `.mp4` em que a tela do painel é navegada sozinha (Playwright), com o cursor destacando onde clicar, e uma voz em português explicando cada passo. Ninguém grava nada à mão.

## Entradas
- O fluxo pedido pelo usuário (ex.: "levar itens da RC para a lista e gerar o PC").
- O manual da aba em `web/content/manual/*.md` (fonte do passo a passo e dos nomes dos botões).
- O código dos componentes da tela (para achar seletores estáveis: `data-testid`, `aria-label`, texto do botão).
- Ambiente: `TUTORIAL_BASE_URL` e `TUTORIAL_LOGIN_EMAIL/SENHA` da **conta de tutorial** (ver nota no topo — não há tenant DEMO). Se o seletor não existir, **adicione `data-testid`** no componente em vez de usar seletores frágeis.

## Passos
1. **Roteiro.** Escreva `web/tutoriais/<slug>/roteiro.json` com a lista de passos. Cada passo tem:
   ```json
   { "url": "/projetos/9000000000099/materiais?empresa=DEMO",
     "acao": "click" | "fill" | "hover" | "wait" | "none",
     "seletor": "[data-testid=btn-levar-para-lista]",
     "valor": "texto a digitar (só para fill)",
     "fala": "Aqui a gente clica em Levar para a lista. Todos os itens da RC que ainda não estão na lista entram de uma vez.",
     "legenda": "Levar para a lista" }
   ```
   Regras da fala: frases curtas, voz de quem está mostrando para um colega ("a gente clica…", "repara que…"), nunca ler nome de classe ou termo técnico; 1 ideia por passo; 8–20 passos por vídeo; abrir com o objetivo em uma frase e fechar com o resultado ("pronto, o pedido de compra está em rascunho esperando aprovação").
2. **Valide o roteiro em seco**: `node scripts/tutorial/gravar.mjs --roteiro tutoriais/<slug>/roteiro.json --dry` (só navega e confere que todos os seletores existem; corrige antes de gerar áudio).
3. **Gere o vídeo**: `node scripts/tutorial/gravar.mjs --roteiro tutoriais/<slug>/roteiro.json`. O script: sintetiza a narração de cada passo (edge-tts, voz `pt-BR-AntonioNeural` ou `pt-BR-FranciscaNeural`; ou ElevenLabs se `ELEVENLABS_API_KEY` estiver definida), navega gravando a tela em 1440×900, destaca o elemento (anel + zoom suave) durante a fala, executa a ação, espera a fala terminar, e no fim monta `tutoriais/<slug>/<slug>.mp4` com ffmpeg (vídeo + narração + legendas queimadas no rodapé).
4. **Publique no manual**: copie o mp4 para `web/public/manual-video/<slug>.mp4` e inclua no `.md` da aba: `<video src="/manual-video/<slug>.mp4" controls></video>` logo abaixo do título da seção correspondente. Rode `npm run manual` e commite tudo junto (regra do CLAUDE.md).
5. **Mostre ao usuário** o caminho do mp4, a duração e o roteiro em texto para ele ajustar a fala se quiser; se ele mudar o texto, regenere só o áudio (`--so-audio`).

## Quando a tela muda
Toda alteração visível numa tela que tem tutorial deve regenerar o vídeo no mesmo PR (`node scripts/tutorial/gravar.mjs --todos`). Se um seletor sumir, o `--dry` falha no CI e aponta o passo.

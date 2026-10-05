
## Manual do usuário (obrigatório)

O manual do sistema fica em `web/content/manual/*.md` (uma página por aba da barra) e aparece em `/manual` (botão **?** da barra).

- **Toda mudança visível ao usuário deve atualizar a página correspondente em `web/content/manual/` no mesmo commit** (passos, nomes de botões, regras, perguntas frequentes) e ajustar `atualizado:` no cabeçalho.
- A lista "O que mudou recentemente" de cada página é gerada do `git log` dos `caminhos:` do cabeçalho (últimos 30 dias). Escreva mensagens de commit claras para o usuário final, em português.
- Depois de editar um `.md`, rode `npm run manual` em `web/` (gera `web/lib/manual-dados.json` e `manual-rotas.json`) e commite os JSON junto.
- Página nova: crie `NN-slug.md` com `titulo`, `resumo`, `icone`, `area` (operacao/erp/bi, opcional), `rotas` (prefixos de rota do painel) e `caminhos` (pastas do código).
- Prints ficam em `web/public/manual-img/` e entram no markdown como `![legenda](/manual-img/arquivo.jpg)`.

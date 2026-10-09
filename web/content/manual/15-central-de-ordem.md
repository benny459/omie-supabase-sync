---
titulo: Central de Ordem
resumo: A Aria mostra só o que está fora de ordem em cada módulo, com a decisão pronta — e você decide.
icone: ✦
rotas: /ordem
caminhos: web/components/ordem, web/lib/ordem, web/app/api/ordem, web/app/api/cron/ordem, web/app/(app)/ordem
atualizado: 2026-10-09
---

A **Central de Ordem** é uma aba a mais em cada módulo (Compras, Financeiro, Operação, Projetos, Faturamento, Estoque, Cadastros) e um **Meu dia** com tudo o que é seu. A Aria lê os módulos, encontra o que está parado (NF na coluna do meio, PC sem envio, título bloqueado, extrato por conciliar…) e mostra cada pendência como um **cartão de decisão**.

> **Nada saiu das telas de hoje.** A Central só soma: todas as telas, colunas, filtros e botões continuam iguais, e cada cartão tem **Abrir na tela tradicional ↗**.

> **Está a ser ligada aos poucos (09/10/26).** Enquanto o administrador não liga, só ele vê a Central, em **pré-visualização** (sem executar nada). Quando ligar o seu módulo, a aba aparece no menu do módulo como **✦ Central de Ordem**.

## Como abro a Central

1. Passe o rato no módulo da barra (ex.: **Compras**) e clique em **✦ Central de Ordem** — abre a Central já filtrada nesse módulo.
2. Ou clique no **✦** da barra do topo (ao lado da pesquisa): abre o **Meu dia**, com os seus itens de todos os módulos a que tem acesso.
3. Os separadores mostram quantas pendências há em cada módulo. Um módulo com **🔒** é um módulo a que o seu perfil não tem acesso: não mostra quantas nem quais.

## Como leio um cartão de decisão

- **Recomendação** — a ação concreta que a Aria propõe, numa frase.
- **Porquê** — a evidência (números, PCs, NFs, regra).
- **Impacto** — o que muda se aceitar.
- **Dono**, **Confiança** (alta, média, baixa) e o **risco**.
- **Alternativas** — até duas, já pensadas.
- **Origem** — o PC, a NF, o título ou a conta de onde veio.

## Como resolvo um item

1. Escolha o item na lista da esquerda (os **críticos** vêm primeiro; use a **busca** e **Só críticos** para filtrar; clique numa **etapa do ciclo** para ver só o que está parado nela).
2. Clique no botão principal (ex.: **Aprovar 3**, **Casar 6**, **Enviar ao fornecedor**). A Aria mostra **exatamente o que vai acontecer** e só executa depois de **Confirmar**.
3. A ação passa **pela mesma rota da tela de hoje**, com o seu utilizador: valem a sua alçada, a regra do budget do projeto, os avisos no Webex e o histórico do pedido. Se a rota não deixar (ex.: acima da sua alçada), o cartão mostra o motivo, como a tela.
4. Quando a ação tem volta (aprovar, casar NF), aparece **↶ Desfazer**.
5. Prefere fazer à mão? **Abrir na tela tradicional ↗** abre a tela de hoje no item.

> **Aprovar acima do budget:** se algum PC do projeto estoura o budget, a Central pede o **motivo** (como a tela de Compras) e o Benny é avisado.

> **Enviar e cobrar fornecedor** mandam e-mail ao fornecedor pela conversa do pedido — a pré-visualização mostra para quem e o texto antes de confirmar. Não têm desfazer.

## Recusar, adiar e encaminhar

- **Recusar com motivo** — o item sai da sua fila; o motivo fica registado (e ensina a Aria).
- **Adiar** — escolha até quando; volta sozinho na data.
- **Encaminhar a [módulo]** — quando a solução está noutro módulo (ex.: título bloqueado **à espera de NF** → Compras pede a NF ao fornecedor). Não precisa de ter acesso ao outro módulo. O item fica em **A acompanhar**, onde vê só o estado (aberto, resolvido, recusado); quando o outro lado resolve, recebe um aviso.
- Itens **↘ encaminhados** para si: **Marcar como resolvido** ou **Recusar com motivo**.

## Só os meus, equipe e supervisão

- Por omissão vê **só os seus** itens (e os que ainda não têm dono no seu módulo).
- **Também os da equipe** mostra os itens dos colegas **nos mesmos módulos**, com o nome de cada dono.
- Diretoria e supervisão veem **todos** os itens dos módulos a que têm acesso.

## Sino e mensagens

- O **sino** na barra mostra os avisos novos: encaminhamentos recebidos, respostas, pedidos de acesso decididos, itens que subiram na escada da cobrança. **Ir para o item ↗** abre o cartão.
- Uma vez por dia (ou quando chega aviso novo) a Aria abre o **“Bom dia”** com o resumo e o item por onde começar: **Resolver agora** abre o cartão; **Mais tarde** fecha.
- Mensagens às 07:30, 11:30, 16:00 e 18:00 pela Webex, só com os seus módulos, quando o administrador ligar.

## Sem acesso a um módulo

Ao clicar num módulo com 🔒 abre o diálogo **Sem acesso**: pode **Encaminhar um pedido** ao responsável (fica a acompanhar) ou **Pedir acesso** ao administrador. A Central nunca dá acesso sozinha — o administrador libera em **Sistema › Usuários e acessos**.

## Para o administrador: Configurar

Em **⚙ Configurar** (só admin) liga-se tudo aos poucos — **tudo nasce desligado**:

1. **Ligar a Central** para a equipa, e os extras: Decisões (recusar/adiar), Encaminhar, Sino, Diálogo de entrada, Pedido de acesso, Comandos.
2. **Módulos** — um interruptor por módulo.
3. **Detetores e donos** — um interruptor por tipo de pendência e o dono (titular + substituto, e “titular ausente”). Só aparecem como dono pessoas que já veem o módulo. Sem dono gravado vale o de hoje.
4. **Ações** — cada ação (aprovar, casar NF, enviar ao fornecedor, cobrar fornecedor, aceitar conciliação) tem o seu interruptor.
5. **Decisões em aberto** — os valores propostos aparecem como **sugerido**; só valem depois de **usar sugerido** e **Gravar**:
   - **M1** tolerância NF ↔ PC: sugerido até R$ 5 ou 0,5% (o menor); acima vira decisão.
   - **M2** NF casada em até 24 h; conferência até 2 dias úteis depois do recebimento.
   - **M3** alçadas: continuam as de hoje (Usuários e acessos).
   - **M4** vencidos há mais de 60 dias vão primeiro para **Separar histórico do Omie** (o espelho do Omie é só histórico desde 02/10/26), não para a cobrança.
   - **M5** nome do assistente: sugerido **Aria** (o Cesar continua com tudo o que faz).
   - **M6** donos: secção 3; sem configuração, os de hoje (Fernanda, Erick, Cristina no relatório de Avulsos; comprador do PC em Compras).
   - **P1** visão da equipe: sugerido “mesmo módulo”.
   - **P2** Financeiro na Central: “tela” = quem abre Títulos a Pagar/Receber hoje; “estrito” = exige também a área Financeiro.
   - **P3** pedidos de acesso: só o admin aprova.
   - **P4** encaminhamento livre: sugerido sim.
6. **Mensagens** — modo **desligado → ensaio** (só regista o que seria enviado) **→ teste** (só para o e-mail de teste, com [TESTE]) **→ ligado**; horários, limite por dia e escada da cobrança.
7. **Diretoria e supervisão**, **Pedidos de acesso** e o **Histórico de mudanças** (quem mudou o quê e quando).

**↻ Atualizar agora** corre os detetores na hora (o sistema atualiza sozinho a cada 15 minutos). Os detetores só **leem** os módulos.

## Perguntas frequentes

**A Central mudou alguma regra?** Não. Quem vê e quem pode fazer o quê sai das mesmas permissões de hoje (áreas, Usuários e acessos, alçadas).

**Resolvi o item na tela tradicional. Some da Central?** Sim, na próxima atualização (até 15 min): a Aria vê que já está em ordem.

**Porque um item não tem dono?** O tipo ainda não tem dono configurado e o dado não indica ninguém — aparece para a equipa do módulo.

**O Comercial?** Os itens do CRM aparecem quando o CRM os publicar; ali o cartão só tem **Abrir no CRM ↗**.

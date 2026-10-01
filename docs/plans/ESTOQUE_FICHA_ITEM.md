# Estoque v2 — Ficha do item

Branch: `mockup/estoque-v2` · Mockup: `web/docs/mockups/estoque-ficha-item.html` · Data base: omie-data em 01/10/2026

## O que o Benny pediu

Na tela de Estoque (`/estoque`) ele quer:

1. Chegar rápido a qualquer item e abrir a ficha dele.
2. Ver para qual cliente e qual projeto o item foi usado.
3. Ajustar o saldo atual, porque muitos saldos estão errados.
4. Definir um alarme por peça (mínimo, ponto de pedido e máximo).
5. Encontrar possíveis duplicidades.
6. Ter foto do item: buscar na web, trocar ou enviar uma foto própria.
7. Ver toda a movimentação do item.
8. Ver os pedidos de compra ligados ao item.
9. Ver os fornecedores do item com preço mínimo, médio e máximo.
10. Fazer a auditoria de cada peça.

## O mockup

Abra `web/docs/mockups/estoque-ficha-item.html` direto no navegador. É um arquivo único, sem servidor, com os dados reais dos 2.159 itens. Todos os fluxos funcionam:

- **Busca (⌘K ou /):** encontra por código, descrição, número do PC (abre a ficha na aba Compras) ou cliente (filtra a lista pelos itens que o cliente usou).
- **Lista:** filtros com contagem, ordenação por coluna, CSV e paginação de 100 em 100.
- **Ficha do item:**
  - foto, indicadores (saldo, pendente, consumo, cobertura, CMC e valor) e saldo por local;
  - abas Onde foi usado (cliente ou projeto), Movimentação (gráfico de saldo + Kardex + CSV), Pedidos de compra, Fornecedores e preços (mín/méd/máx + dispersão) e Auditoria;
  - ‹ › para navegar entre os itens da lista filtrada.
- **Ações:**
  - Ajustar saldo, por local;
  - Definir alarme, com sugestão calculada pelo consumo;
  - Foto: busca no Wikimedia Commons como prova de conceito, envio de arquivo com redução para 640 px ou URL colada;
  - Pedir compra, com quantidade sugerida;
  - Mesclar duplicidade e marcar "Não é duplicidade".
- **Persistência:** tudo fica no `localStorage` (chave `ww-estoque-mockup-v1`). O botão ↺ limpa. Nada vai ao Omie nem ao Supabase.

Os tokens `--ww-*` foram copiados sem alteração de `web/app/globals.css`, nos temas claro e escuro. Cada classe do mockup corresponde a um componente do KitTela:

| Mockup | KitTela / app |
|---|---|
| `.cartao`, `.head` | `cartao`, `CabecalhoTela` |
| `.kpis .kpi` (`.hero`) | `GradeKpis` (`hero: true`) |
| `.chip` | `ChipFiltro` |
| `.seg` | `SegmentedControl` |
| `.pill.t-*` | `cPill(texto, tom)` |
| `.barra` | `cBarra` |
| `.aviso.t-*` | `Aviso` |
| gráfico de saldo e de preço | `GraficoLinha` / SVG próprio |

**Para regerar os dados do mockup:** rode as 3 consultas da seção "Consultas" no omie-data e salve o resultado como `pos.json`, `mov.json` e `pcs.json`. Depois execute `python3 build_data.py` (gera `data.js`) e `python3 montar.py <pasta>`. Os dois scripts ficam em `web/docs/mockups/estoque-ficha-item/`.

## Achados nos dados (01/10/2026)

| Achado | Número | Consequência |
|---|---|---|
| `estoque_minimo` preenchido | 0 de 2.237 | O filtro "Abaixo do mínimo" da tela atual está sempre vazio. O alarme passa a ser do painel. |
| Itens com saldo negativo | 385 | Ajuste de saldo é prioridade. |
| Em ruptura (tem consumo e saldo ≤ 0) | 74 | |
| Parados há mais de 180 dias | 1.121 itens, R$ 1,52 mi | 44% do valor do estoque. |
| Duplicidades | 43 grupos com nome igual + 68 pares parecidos | Ex.: SAL GROSSO NÃO IODADO (7000123 × 38030001), ambos negativos. |
| Saídas de 12 meses com cliente | 555 de 1.568 (35%) | 973 são **Remessa de Produto** sem vínculo com cliente. É o maior buraco para o item 2. |
| Descrições com entidade HTML | 429 | Hoje a tela mostra `20&quot; X 2,5&quot;`. Decodificar com `html.unescape` no `import_estoque.py` ou na leitura. |
| `pedidos_compra.dinc_data` | texto `dd/mm/aaaa` | Converter antes de ordenar ou filtrar. |
| PCs abertos × pendente do Omie | ex.: carvão com 1.400 a receber pelos PCs e 75 pendentes no Omie | PCs antigos nunca baixados ou cancelados. A auditoria aponta. |
| Saldo negativo só num local | ex.: carvão Local 2 = −175 | O total parece certo, mas um local está errado. A auditoria aponta. |

## Fontes e ligações

- **Posição:** `orders.estoque_posicao`, por `n_cod_prod` e `codigo_local_estoque`.
- **Movimentos:** `orders.estoque_movimentos`, por `id_prod`. `qtde` tem sinal e `saldo` é por local.
- **Cliente e projeto de uma saída:**
  - `estoque_movimentos.id_pedido` → `sales.pedidos_venda.codigo_pedido` (comparar como `::text`);
  - `pedidos_venda.codigo_cliente` → `finance.clientes.codigo_cliente_omie`;
  - `pedidos_venda.codigo_projeto` → `finance.projetos.codigo`.
- **Remessas:** não casam com `pedidos_venda`. Precisa de sync novo das remessas do Omie com o cliente de destino (API de Remessa, `ListarRemessas` — confirmar o campo do cliente na doc) e de uma tabela `orders.remessas`.
- **Pedidos de compra:** `orders.pedidos_compra` com `ncod_prod = n_cod_prod`.
  - fornecedor: `ncod_for` → `finance.clientes.codigo_cliente_omie`;
  - preço unitário: `nval_unit`;
  - projeto: `ncod_proj`.
- **Preço por fornecedor:** agregado de `pedidos_compra` (`min`, `avg`, `max` e última data). `orders.produto_fornecedor` cobre pouca coisa; usar só como complemento.
- **Duplicidades:**
  - nome igual: `regexp_replace(upper(unaccent(descricao)), '[^A-Z0-9]', '', 'g')` igual;
  - parecido: `pg_trgm` (já instalado), `similarity ≥ 0.85`, com os mesmos números na descrição e sem trocar códigos curtos (ver `variante()` em `build_data.py`).

## O que construir

### Banco: `sql/32_estoque_ficha_item.sql`

Só tabelas novas no schema `platform`, todas com RLS. O projeto Supabase é compartilhado com o ALLKA Portal, então **nada de alterar tabela existente**.

```sql
create table platform.estoque_alarme (
  empresa text not null, n_cod_prod bigint not null,
  minimo numeric not null, ponto_pedido numeric not null, maximo numeric,
  avisar text[] not null default '{painel}',          -- painel | email | webex
  gravar_no_omie boolean not null default true,
  updated_by uuid, updated_at timestamptz not null default now(),
  primary key (empresa, n_cod_prod));

create table platform.estoque_foto (
  empresa text not null, n_cod_prod bigint not null,
  storage_path text not null,                          -- bucket "produtos"
  origem text not null,                                -- web | upload | url
  origem_url text, updated_by uuid, updated_at timestamptz default now(),
  primary key (empresa, n_cod_prod));

create table platform.estoque_ajuste (
  id bigserial primary key, empresa text not null, n_cod_prod bigint not null,
  codigo_local_estoque bigint not null, saldo_antes numeric not null, contagem numeric not null,
  motivo text not null, obs text, valor numeric,
  status text not null default 'pendente',             -- pendente | aprovado | enviado | erro
  omie_resposta jsonb, created_by uuid, created_at timestamptz default now(),
  aprovado_by uuid, aprovado_at timestamptz);

create table platform.estoque_duplicidade_decisao (
  empresa text not null, prod_a bigint not null, prod_b bigint not null,
  decisao text not null,                               -- nao_e | mesclado
  principal bigint, created_by uuid, created_at timestamptz default now(),
  primary key (empresa, prod_a, prod_b));

create table platform.estoque_audit (
  id bigserial primary key, empresa text not null, n_cod_prod bigint not null,
  acao text not null, antes jsonb, depois jsonb, user_id uuid, created_at timestamptz default now());
```

Mais duas views:

- `orders.v_estoque_item`: a posição agregada por produto, com consumo de 90 dias e última movimentação;
- `orders.v_estoque_duplicidade`: os pares, já sem os que foram decididos.

### API: `web/app/api/estoque/*`

Seguir o padrão de `web/app/api/estoque/route.ts`: `loadPerms`, área `erp` e service role só no servidor.

| Rota | O que faz |
|---|---|
| `GET /api/estoque/item/[id]` | Ficha: posição por local, Kardex dos últimos 12 meses (com cliente/projeto), PCs, preços por fornecedor, alarme, foto e auditoria. Um único JSON. |
| `GET /api/estoque/busca?q=` | Itens, PCs (`cnumero`) e clientes, para o ⌘K. |
| `POST /api/estoque/ajuste` | Grava em `estoque_ajuste`. Acima de R$ 5.000 vai para aprovação. Aprovado, chama o Omie. |
| `PUT /api/estoque/alarme` | Grava o alarme e, se pedido, o estoque mínimo no Omie. |
| `GET /api/estoque/foto/busca?q=` | Busca de imagens no servidor. |
| `POST /api/estoque/foto` | Baixa a imagem e envia para o Storage. |
| `POST /api/estoque/duplicidade` | `nao_e` ou `mesclar` (ajustes de transferência + inativar no Omie). |

Detalhes por rota:

- **Ajuste no Omie:** usar a API de ajuste de estoque, `IncluirAjusteEstoque`. Confirmar endpoint e campos na doc (`developer.omie.com.br`). O Omie responde HTTP 200 mesmo com erro, então checar `faultstring` como em `web/lib/omie.ts`. Reaproveitar `getCreds(empresa)`.
- **Alarme no Omie:** confirmar na doc o campo de estoque mínimo do produto (API de produtos, `AlterarProduto`).
- **Busca de foto:**
  - provedor: Google Custom Search (`searchType=image`) ou Bing Image Search;
  - chave em env (`IMAGE_SEARCH_KEY`, `IMAGE_SEARCH_CX`);
  - termo: as 6 primeiras palavras da descrição, sem parênteses e sem a marca no fim (`termoBusca()` no mockup).
- **Upload de foto:** bucket `produtos`, privado, servido por signed URL. Nunca guardar link externo.
- **Alarmes:** regras em `web/lib/alarmes.ts` (fonte única, como já é feito para os Avulsos). O aviso por Webex usa `postWebexMessage` de `web/lib/webex.ts`, no daily.

### Tela

- `web/components/navy/tela/TelaEstoqueNavy.tsx`: trocar a árvore "Situação › produto › local" pela lista do mockup (filtros + ordenação). Manter a aba Movimentação.
- Ficha nova: rota `/estoque/[codigo]` (deep link; no mockup é `#item=<codigo>`) com o componente `FichaItemNavy`.
- O modal Kardex de hoje vira a aba Movimentação da ficha.
- O ⌘K pode ficar só na tela de Estoque, ou ir para o cabeçalho global se o Benny quiser.

### Sync: `scripts/`

- `import_estoque.py`: aplicar `html.unescape` na descrição.
- Novo `import_remessas.py`: importar as remessas com o cliente de destino, para fechar os 65% de saídas sem cliente.

## Fases sugeridas

1. **Ficha somente leitura:** busca, ficha, uso por cliente/projeto, Kardex, PCs, preços e auditoria automática. Corrigir as entidades HTML.
2. **Alarme e foto:** tabelas, Storage, busca de imagem e aviso no painel e no Webex.
3. **Ajuste de saldo:** com aprovação acima do limite e envio ao Omie. Testar primeiro com um item, com o Benny.
4. **Duplicidades:** decisão "não é" e mesclagem (ajustes + inativação no Omie).
5. **Remessas com cliente:** sync novo.

## Critérios de aceite

- [ ] O ⌘K abre a ficha de qualquer um dos itens em menos de 1 s, buscando por código, nome, nº do PC ou cliente.
- [ ] A aba "Onde foi usado" agrupa por cliente e por projeto, e mostra as saídas sem cliente em destaque.
- [ ] O ajuste é por local, mostra a prévia (entrada/saída, valor ao CMC e saldo final), grava auditoria e só vai ao Omie depois de aprovado (acima do limite).
- [ ] O alarme sugere valores pelo consumo de 90 dias e valida mínimo ≤ ponto de pedido ≤ máximo.
- [ ] A foto pode ser buscada na web, enviada ou colada por URL, e sempre fica no Storage.
- [ ] Fornecedores e preços mostra mínimo, médio, máximo, número de PCs e última compra por fornecedor.
- [ ] A auditoria aponta:
  - saldo negativo (total e por local);
  - quebra de sequência no Kardex;
  - preço fora da curva (< 60% ou > 150% da mediana de 12 meses);
  - PC aberto há mais de 60 dias;
  - recebido acima do pedido;
  - saída sem cliente;
  - duplicidade, sem alarme, CMC zerado e item parado.
- [ ] Nenhuma tabela existente alterada; tabelas novas com RLS.
- [ ] Mesmo visual do mockup nos temas claro e escuro, e sem rolagem horizontal da página a 390 px.

## Consultas usadas no mockup

```sql
-- pos.json
with c as (select id_prod, sum(abs(qtde::numeric)) q90 from orders.estoque_movimentos
           where tipo='saida' and coalesce(cancelamento,'N')<>'S' and dt_mov>=current_date-90 group by 1),
um as (select id_prod, max(dt_mov) ult, count(*) n from orders.estoque_movimentos where coalesce(cancelamento,'N')<>'S' group by 1),
sp as (select id_omie::text id, unidade, ean, ncm from sales.produtos)
select json_agg(json_build_array(p.n_cod_prod, p.codigo, p.descricao, p.codigo_local_estoque::text, p.saldo::numeric,
  p.pendente::numeric, round(p.cmc::numeric,4), coalesce(c.q90,0), um.ult, coalesce(um.n,0), sp.unidade, sp.ncm,
  p.estoque_minimo::numeric, p.reservado::numeric) order by p.descricao)
from orders.estoque_posicao p left join c on c.id_prod=p.n_cod_prod left join um on um.id_prod=p.n_cod_prod
left join sp on sp.id=p.n_cod_prod::text;

-- mov.json (12 meses, com cliente e projeto)
select json_agg(json_build_array(m.id_prod, m.dt_mov, m.des_origem, m.qtde::numeric, m.saldo::numeric,
  coalesce(m.num_doc,m.num_pedido), round(m.valor::numeric,2), m.cancelamento,
  coalesce(c.nome_fantasia,c.razao_social), pr.nome, m.num_pedido, m.codigo_local_estoque::text)
  order by m.id_prod, m.dt_mov, m.id_mov)
from orders.estoque_movimentos m
left join sales.pedidos_venda pv on pv.codigo_pedido::text=m.id_pedido::text
left join finance.clientes c on c.codigo_cliente_omie::text=pv.codigo_cliente::text
left join finance.projetos pr on pr.codigo::text=pv.codigo_projeto::text
where m.dt_mov>=current_date-365;

-- pcs.json
select json_agg(json_build_array(pc.ncod_prod::text, pc.cnumero, to_char(to_date(pc.dinc_data,'DD/MM/YYYY'),'YYYY-MM-DD'),
  coalesce(f.nome_fantasia,f.razao_social), pc.nqtde::numeric, pc.nqtde_rec::numeric, pc.nval_unit::numeric, pc.cetapa, pr.nome))
from orders.pedidos_compra pc
left join finance.clientes f on f.codigo_cliente_omie::text=pc.ncod_for::text
left join finance.projetos pr on pr.codigo::text=pc.ncod_proj::text
where exists(select 1 from orders.estoque_posicao p where p.n_cod_prod::text=pc.ncod_prod::text);
```

## Fora do escopo, mas visto no caminho

O advisor do Supabase aponta **34 tabelas sem RLS** no omie-data, entre elas `finance.*`, `orders.estoque_*` e `sales.nfe_saida`. Hoje quem tem a anon key lê e altera essas linhas. Antes de ligar o RLS é preciso levantar o que o painel e o ALLKA Portal leem com a anon key. Não mexer nisso sem o Benny.

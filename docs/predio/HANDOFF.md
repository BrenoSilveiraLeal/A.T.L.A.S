# Prédio ATLAS: o que foi feito e o que falta

Atualizado em 01/11/2026. Mudança só visual e de navegação. Agentes, regras, dinheiro real, Genial/MT5, banco e as rotas `/app/*` não mudaram.

## Como funciona

- `/` e o login abrem o **mapa** (`/predio`): a sede ATLAS numa cidade, no estilo de um simulador de vida (pegada The Sims 4, tudo modelado em código, sem assets de terceiros).
- O prédio inteiro é do ATLAS. O painel lista só os escritórios: **8 Escritório de Dividendos** (nome provisório), **9 DASH**, **10 COIN**.
- Clicar num escritório aberto faz a câmera voar até o andar (os de cima somem, as paredes baixam) e **abre a página do escritório** (`/app`), separada do mapa. DASH e COIN só mostram um aviso (em construção / bloqueado).
- Dentro do escritório, **"Trocar de escritório"** volta ao mapa, que destaca o último escritório usado.
- O escritório fica no terraço do andar 8 da mesma torre: janelas nas paredes externas, cidade lá fora, **elevador no lugar da porta** (abre para o elevador panorâmico da fachada). O modo Chefe em primeira pessoa continua igual.

## Arquivos

| Arquivo | O que faz |
| --- | --- |
| `src/core/building.ts` | Medidas da torre (`TOWER`), elevador (`ELEVATOR`), escritórios (`OFFICES`, com nome completo e descrição do DASH e do COIN), janelas (`windowBays`, `wallSegments`). Puro, testado em `tests/building.test.ts` |
| `src/components/building/tower.ts` | A sede ATLAS: pódio com lobby, marquise, logo e bandeiras; jardim no teto do pódio; torre de vidro com colunas brancas e aletas verdes; terraço com floreiras nos andares dos escritórios; topo recuado com deck, logo nos quatro lados e antena; elevador panorâmico. `buildSurroundings` monta a mesma torre em volta do escritório |
| `src/components/building/city.ts` | Cidade compartilhada: ruas, fachadas pastel desenhadas em canvas, árvores, arbustos, postes, carros |
| `src/components/building/building-3d.tsx` | Cena do mapa: câmera orbital, placas dos escritórios, voo até o andar escolhido, cabine do elevador em movimento |
| `src/components/building/building-view.tsx` | Tela `/predio`: lista dos escritórios, entrar, avisos, último usado (`localStorage atlas-last-office`), alterna 3D/2D |
| `src/components/building/elevator-2d.tsx` | Prédio em corte (SVG) para celular ou sem WebGL |
| `src/app/predio/page.tsx`, `building-client.tsx` | Rota com a mesma checagem de proprietário de `/tv`; a view só renderiza no navegador |
| `src/app/building.css` | Visual claro e arredondado do mapa e o botão "Trocar de escritório" |
| `src/components/office-3d.tsx` | Só visual: cidade e torre em volta, janelas, elevador no lugar da porta, botão "Trocar de escritório" |
| `src/app/page.tsx`, `src/components/login.tsx`, `src/components/shell.tsx`, `src/components/agent-floor.tsx` | `/` e o login vão para `/predio`; item "Prédio" no menu; o botão de troca some no `/tv` |

Verificado: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` passaram. O escritório foi conferido sem dados do Supabase (sem agentes reais).

## O que falta

1. **Nome do escritório de dividendos**: trocar `name` do item `dividendos` em `OFFICES`. Não mudar o `id`, rotas, tabelas nem o `clientOrderId` `atlas-…`.
2. **Conferir com dados reais**: abrir `/predio` e `/app` com o Supabase e os agentes; medir FPS com a cidade + 16 agentes num notebook comum.
3. **`AGENTS.md`**: o DASH agora é "Day-trading Analysis & Strategy Hub · Núcleo de Análise e Estratégia de Day Trade" (o arquivo ainda diz "Centro de Análise…"). COIN = "Crypto Operations & Intelligence Network · Rede de Inteligência e Operações com Criptoativos".
4. **DASH**: seguir `docs/daytrade/ARQUITETURA.md` (rotas `/daytrade/*`, tabelas `dt_*`, modo SIMULADO por padrão). Quando houver tela, preencher `href` e `status` do DASH em `OFFICES` e criar o interior próprio na página dele.
5. **COIN**: continua bloqueado; nada implementado.

O `next build` acrescenta um trecho ao `AGENTS.md` e gera `tsconfig.tsbuildinfo`; não fazem parte desta mudança.

# Prédio ATLAS: o que foi feito e o que falta

Atualizado em 01/11/2026. Mudança só visual e de navegação. Agentes, regras, dinheiro real, Genial/MT5, banco e as rotas `/app/*` não mudaram.

## O que foi feito

| Arquivo | O que faz |
| --- | --- |
| `src/core/building.ts` | Medidas da torre (`TOWER`), elevador (`ELEVATOR`), registro dos escritórios (`OFFICES`: dividendos 8, DASH 9, COIN 10), andares decorativos (`TENANTS`), janelas (`windowBays`, `wallSegments`). Puro, testado em `tests/building.test.ts` |
| `src/components/building/city.ts` | Cidade compartilhada (prédio e vista do escritório): fachadas pastel desenhadas em canvas, árvores, arbustos, postes, carros; `buildSurroundings` coloca céu, terraço, torre abaixo e poço do elevador em volta de um andar |
| `src/components/building/building-3d.tsx` | Cena do prédio: câmera orbital, placas HTML dos andares, seleção por nível (andares de cima somem, paredes baixam, teto some) |
| `src/components/building/building-view.tsx` | Tela `/predio`: botões de nível ▲▼, painel "Elevador", cartão do andar, lembra o último escritório (`localStorage atlas-last-office`), alterna 3D/2D |
| `src/components/building/elevator-2d.tsx` | Prédio em corte (SVG) para celular ou sem WebGL |
| `src/app/predio/page.tsx`, `building-client.tsx` | Rota com a mesma checagem de proprietário de `/tv`; a view só renderiza no navegador |
| `src/app/building.css` | Visual claro e arredondado do prédio, e o botão "Trocar de escritório" |
| `src/components/office-3d.tsx` | Só visual: cidade e céu em volta, janelas nas paredes externas (sólido só atrás de quadros/estantes), elevador no lugar da porta, botão "Trocar de escritório". Modo Chefe em primeira pessoa mantido |
| `src/app/page.tsx`, `src/components/login.tsx`, `src/components/shell.tsx`, `src/components/agent-floor.tsx` | `/` e o login vão para `/predio`; item "Prédio" no menu; o botão de troca some no `/tv` |

Verificado: `npm run lint`, `npm run typecheck`, `npm test` e `npm run build` passaram. O escritório foi conferido sem dados do Supabase (sem agentes reais).

## O que falta

1. **Nome do escritório de dividendos**: trocar `name` do item `dividendos` em `OFFICES`. Não mudar o `id`, rotas, tabelas nem o `clientOrderId` `atlas-…`.
2. **Conferir com dados reais**: abrir `/predio` e `/app` com o Supabase e os agentes; verificar FPS com cidade + 16 agentes num notebook comum.
3. **`AGENTS.md`**: o DASH agora é "Day-trading Analysis & Strategy Hub · Núcleo de Análise e Estratégia de Day Trade" (o arquivo ainda diz "Centro de Análise…"). COIN = "Crypto Operations & Intelligence Network · Rede de Inteligência e Operações com Criptoativos".
4. **DASH**: seguir `docs/daytrade/ARQUITETURA.md` (rotas `/daytrade/*`, tabelas `dt_*`, modo SIMULADO por padrão). Quando houver tela, trocar `href: null` e `status` do DASH em `OFFICES` e criar o interior próprio (hoje o andar 9 só aparece no prédio).
5. **COIN**: continua bloqueado; nada implementado.
6. Opcional: placas do prédio às vezes encostam na borda direita em janelas estreitas.

O `next build` acrescenta um trecho ao `AGENTS.md` e gera `tsconfig.tsbuildinfo`; não fazem parte desta mudança.

# Relatório de QA — ATLAS — 08/11/2026

## Ambiente
- URL verificada: `http://127.0.0.1:3002` (build isolado; a instância já aberta na porta 3000 permaneceu intacta).
- Comandos: `ATLAS_LOW_DISK_BUILD=true npm run build` e `ATLAS_LOW_DISK_BUILD=true npm start -- --port 3002`. Build e checagem TypeScript concluídos com sucesso.
- Navegador: Playwright CLI com HeadlessChrome 156.0.0.0.
- A inicialização de `next dev` falhou no Turbopack (`testMode` sem `project`); para testar a versão modificada usei o build webpack de produção em `.next-low-disk`.

## Inventário e cobertura por rota/resolução
Foram verificadas 23 rotas/estados pedidos em 7 resoluções (161 combinações), incluindo uma rota real de detalhe de agente. `/` redireciona para `/predio`. Os links abaixo abrem as capturas de tela por resolução; os arquivos mostram a página depois do carregamento.

| Rota | 375×812 | 430×932 | 768×1024 | 1366×768 | 1536×864 | 1920×1080 | 3840×2160 |
|---|---|---|---|---|---|---|---|
| `/predio` | [PNG](screenshots/predio__375x812.png) | [PNG](screenshots/predio__430x932.png) | [PNG](screenshots/predio__768x1024.png) | [PNG](screenshots/predio__1366x768.png) | [PNG](screenshots/predio__1536x864.png) | [PNG](screenshots/predio__1920x1080.png) | [PNG](screenshots/predio__3840x2160.png) |
| `/daytrade` | [PNG](screenshots/daytrade__375x812.png) | [PNG](screenshots/daytrade__430x932.png) | [PNG](screenshots/daytrade__768x1024.png) | [PNG](screenshots/daytrade__1366x768.png) | [PNG](screenshots/daytrade__1536x864.png) | [PNG](screenshots/daytrade__1920x1080.png) | [PNG](screenshots/daytrade__3840x2160.png) |
| `/login` | [↪ app](screenshots/login__375x812.png) | [↪ app](screenshots/login__430x932.png) | [↪ app](screenshots/login__768x1024.png) | [↪ app](screenshots/login__1366x768.png) | [↪ app](screenshots/login__1536x864.png) | [↪ app](screenshots/login__1920x1080.png) | [↪ app](screenshots/login__3840x2160.png) |
| `/setup` | [PNG](screenshots/setup__375x812.png) | [PNG](screenshots/setup__430x932.png) | [PNG](screenshots/setup__768x1024.png) | [PNG](screenshots/setup__1366x768.png) | [PNG](screenshots/setup__1536x864.png) | [PNG](screenshots/setup__1920x1080.png) | [PNG](screenshots/setup__3840x2160.png) |
| `/app` | [PNG](screenshots/app__375x812.png) | [PNG](screenshots/app__430x932.png) | [PNG](screenshots/app__768x1024.png) | [PNG](screenshots/app__1366x768.png) | [PNG](screenshots/app__1536x864.png) | [PNG](screenshots/app__1920x1080.png) | [PNG](screenshots/after-app__3840x2160.png) |
| `/app/trades` | [PNG](screenshots/app_trades__375x812.png) | [PNG](screenshots/app_trades__430x932.png) | [PNG](screenshots/app_trades__768x1024.png) | [PNG](screenshots/app_trades__1366x768.png) | [PNG](screenshots/app_trades__1536x864.png) | [PNG](screenshots/app_trades__1920x1080.png) | [PNG](screenshots/after-app-trades__3840x2160.png) |
| `/app/dividends` | [PNG](screenshots/app_dividends__375x812.png) | [PNG](screenshots/app_dividends__430x932.png) | [PNG](screenshots/app_dividends__768x1024.png) | [PNG](screenshots/app_dividends__1366x768.png) | [PNG](screenshots/app_dividends__1536x864.png) | [PNG](screenshots/app_dividends__1920x1080.png) | [PNG](screenshots/after-app-dividends__3840x2160.png) |
| `/app/history` | [PNG](screenshots/app_history__375x812.png) | [PNG](screenshots/app_history__430x932.png) | [PNG](screenshots/app_history__768x1024.png) | [PNG](screenshots/app_history__1366x768.png) | [PNG](screenshots/app_history__1536x864.png) | [PNG](screenshots/app_history__1920x1080.png) | [PNG](screenshots/after-app-history__3840x2160.png) |
| `/app/controls` | [PNG](screenshots/app_controls__375x812.png) | [PNG](screenshots/app_controls__430x932.png) | [PNG](screenshots/app_controls__768x1024.png) | [PNG](screenshots/app_controls__1366x768.png) | [PNG](screenshots/app_controls__1536x864.png) | [PNG](screenshots/app_controls__1920x1080.png) | [PNG](screenshots/after-app-controls__3840x2160.png) |
| `/app/agents` | [PNG](screenshots/app_agents__375x812.png) | [PNG](screenshots/app_agents__430x932.png) | [PNG](screenshots/app_agents__768x1024.png) | [PNG](screenshots/app_agents__1366x768.png) | [PNG](screenshots/app_agents__1536x864.png) | [PNG](screenshots/app_agents__1920x1080.png) | [PNG](screenshots/after-app-agents__3840x2160.png) |
| `/app/agents/[id]` | [PNG](screenshots/app-agent-detail__375x812.png) | [PNG](screenshots/app-agent-detail__430x932.png) | [PNG](screenshots/app-agent-detail__768x1024.png) | [PNG](screenshots/app-agent-detail__1366x768.png) | [PNG](screenshots/app-agent-detail__1536x864.png) | [PNG](screenshots/app-agent-detail__1920x1080.png) | [PNG](screenshots/after-app-agent-detail__3840x2160.png) |
| `/app/office` | [PNG](screenshots/app_office__375x812.png) | [PNG](screenshots/app_office__430x932.png) | [PNG](screenshots/app_office__768x1024.png) | [PNG](screenshots/app_office__1366x768.png) | [PNG](screenshots/app_office__1536x864.png) | [PNG](screenshots/app_office__1920x1080.png) | [PNG](screenshots/after-app-office__3840x2160.png) |
| `/app/portfolio` | [PNG](screenshots/app_portfolio__375x812.png) | [PNG](screenshots/app_portfolio__430x932.png) | [PNG](screenshots/app_portfolio__768x1024.png) | [PNG](screenshots/app_portfolio__1366x768.png) | [PNG](screenshots/app_portfolio__1536x864.png) | [PNG](screenshots/app_portfolio__1920x1080.png) | [PNG](screenshots/after-app-portfolio__3840x2160.png) |
| `/app/treasury` | [PNG](screenshots/app_treasury__375x812.png) | [PNG](screenshots/app_treasury__430x932.png) | [PNG](screenshots/app_treasury__768x1024.png) | [PNG](screenshots/app_treasury__1366x768.png) | [PNG](screenshots/app_treasury__1536x864.png) | [PNG](screenshots/app_treasury__1920x1080.png) | [PNG](screenshots/after-app-treasury__3840x2160.png) |
| `/app/orders` | [PNG](screenshots/app_orders__375x812.png) | [PNG](screenshots/app_orders__430x932.png) | [PNG](screenshots/app_orders__768x1024.png) | [PNG](screenshots/app_orders__1366x768.png) | [PNG](screenshots/app_orders__1536x864.png) | [PNG](screenshots/app_orders__1920x1080.png) | [PNG](screenshots/after-app-orders__3840x2160.png) |
| `/app/market` | [PNG](screenshots/app_market__375x812.png) | [PNG](screenshots/app_market__430x932.png) | [PNG](screenshots/app_market__768x1024.png) | [PNG](screenshots/app_market__1366x768.png) | [PNG](screenshots/app_market__1536x864.png) | [PNG](screenshots/app_market__1920x1080.png) | [PNG](screenshots/after-app-market__3840x2160.png) |
| `/app/news` | [PNG](screenshots/app_news__375x812.png) | [PNG](screenshots/app_news__430x932.png) | [PNG](screenshots/app_news__768x1024.png) | [PNG](screenshots/app_news__1366x768.png) | [PNG](screenshots/app_news__1536x864.png) | [PNG](screenshots/app_news__1920x1080.png) | [PNG](screenshots/after-app-news__3840x2160.png) |
| `/app/research` | [PNG](screenshots/app_research__375x812.png) | [PNG](screenshots/app_research__430x932.png) | [PNG](screenshots/app_research__768x1024.png) | [PNG](screenshots/app_research__1366x768.png) | [PNG](screenshots/app_research__1536x864.png) | [PNG](screenshots/app_research__1920x1080.png) | [PNG](screenshots/after-app-research__3840x2160.png) |
| `/app/paper` | [PNG](screenshots/app_paper__375x812.png) | [PNG](screenshots/app_paper__430x932.png) | [PNG](screenshots/app_paper__768x1024.png) | [PNG](screenshots/app_paper__1366x768.png) | [PNG](screenshots/app_paper__1536x864.png) | [PNG](screenshots/app_paper__1920x1080.png) | [PNG](screenshots/after-app-paper__3840x2160.png) |
| `/app/risk` | [PNG](screenshots/app_risk__375x812.png) | [PNG](screenshots/app_risk__430x932.png) | [PNG](screenshots/app_risk__768x1024.png) | [PNG](screenshots/app_risk__1366x768.png) | [PNG](screenshots/app_risk__1536x864.png) | [PNG](screenshots/app_risk__1920x1080.png) | [PNG](screenshots/after-app-risk__3840x2160.png) |
| `/app/audit` | [PNG](screenshots/app_audit__375x812.png) | [PNG](screenshots/app_audit__430x932.png) | [PNG](screenshots/app_audit__768x1024.png) | [PNG](screenshots/app_audit__1366x768.png) | [PNG](screenshots/app_audit__1536x864.png) | [PNG](screenshots/app_audit__1920x1080.png) | [PNG](screenshots/after-app-audit__3840x2160.png) |
| `/app/health` | [PNG](screenshots/app_health__375x812.png) | [PNG](screenshots/app_health__430x932.png) | [PNG](screenshots/app_health__768x1024.png) | [PNG](screenshots/app_health__1366x768.png) | [PNG](screenshots/app_health__1536x864.png) | [PNG](screenshots/app_health__1920x1080.png) | [PNG](screenshots/after-app-health__3840x2160.png) |
| `/tv` | [PNG](screenshots/tv__375x812.png) | [PNG](screenshots/tv__430x932.png) | [PNG](screenshots/tv__768x1024.png) | [PNG](screenshots/tv__1366x768.png) | [PNG](screenshots/tv__1536x864.png) | [PNG](screenshots/tv__1920x1080.png) | [PNG](screenshots/tv__3840x2160.png) |

### Resultado da varredura
- 161 combinações sem overflow horizontal. Os layouts passam de grade para coluna e simplificam navegação nos tamanhos menores, mantendo tipografia, cores e componentes do ATLAS.
- 0 erros de console e 0 respostas HTTP 4xx/5xx observadas durante a recarga do escritório. Houve 11 cancelamentos `ERR_ABORTED` de prefetch do Next durante navegações, sem falha de rota.
- 1 aviso de navegador: o Chrome bloqueia o `AudioContext` antes de uma interação do usuário. É comportamento de autoplay; o teste não acionou o áudio da cidade.
- `/login` redirecionou corretamente para `/app` porque o bypass de autenticação local está ativo. A tela real de login não pôde ser avaliada nesse ambiente. `/setup` foi inspecionada sem enviar o formulário.

## Achado corrigido

**QA-01 — médio — escritório em 4K**

- Antes: o conteúdo do escritório parava em 1.700 px de largura numa viewport de 3.840 px, deixando margens vazias muito grandes e reduzindo a legibilidade na televisão.
- Correção: em viewports a partir de 2.560 px, o escritório usa até `min(3000px, 80vw)`, mais espaçamento e tamanhos maiores para títulos e texto. Em 2.560 px, o conteúdo agora mede 2.048 px; em 3.840 px, mede 3.000 px. A mudança está em [dividendos.css](../../src/app/dividendos.css).
- Regressão: testei 375, 768, 1.920, 2.560 e 3.840 px em `/app`, `/app/dividends` e `/app/controls`; todos sem overflow. Testei também 3.840 px em todas as 17 rotas `/app/*`, inclusive detalhe de agente; todas com 3.000 px de conteúdo e sem overflow.
- Evidência: [antes — escritório 4K](screenshots/app__3840x2160.png) · [depois — escritório 4K](screenshots/after-app__3840x2160.png) · [depois — 375 px](screenshots/final-settled-app__375x812.png).

## Fluxos, estados e limitações

- Interações sem efeito financeiro: entrada do prédio pelo botão DASH → `/daytrade`; abrir “Mais” expôs 14 itens; “Modo TV” → `/tv`. Todos chegaram ao destino esperado.
- Emulação de `prefers-reduced-motion: reduce` ativada; o documento manteve largura dentro da viewport. Não foi auditado quadro a quadro cada animação 3D.
- Não foram enviados formulários de acesso, ordens, cadastro ou parada de operações. Isso preserva a conta e as ações financeiras durante a inspeção; portanto, validações de submissão permanecem não testadas.
- As capturas refletem dados privados do ambiente local. A pasta de evidências está no working tree e não foi commitada.

## Resumo

- Rotas/estados pedidos: 23; combinações de viewport: 161; overflow: 0; erros de console: 0; defeitos visuais confirmados corrigidos: 1.
- Status: **passou com limitações** — login e submissões sensíveis ficaram fora do fluxo seguro de QA.

# DASH - setores, workers e estado da implementacao

## Pronto no codigo (02/11/2026)

| Componente | Evidencia |
|---|---|
| Configuracao e readiness | config/daytrade.json e src/core/daytrade/config.ts |
| Esquema proprio com RLS, persistencia de cotacoes, candles, observacoes e paper fills | supabase/migrations/20261102185514_daytrade_dash.sql e migrations seguintes em supabase/migrations/ |
| Gateway ProfitDLL Windows x64 somente leitura | gateways/profitdll/gateway.py e gateways/profitdll/README.md |
| API autenticada de quote/status, barras, backtest, estado paper e kill switch | src/app/api/daytrade/[resource]/route.ts |
| Analise opening range, VWAP real por turnover e EMA; dois candidatos de backtest walk-forward com custos | src/core/daytrade/analysis.ts |
| Workers deterministas de preco, estrategia, backtest, risco, chefia e supervisao | src/core/daytrade/agents.ts |
| Motor paper transacional, um contrato/posicao, stops, gaps, custos e limites | RPC dt_apply_paper_bar nas migrations daytrade_paper_* |
| Dashboard e setores do escritorio | src/components/daytrade/dash-view.tsx, src/core/daytrade/desks.ts |

## Pendencias externas e configuracao

1. **Banco Supabase:** historico remoto sincronizado ate `20261103025606_daytrade_paper_session_boundary_gap`; as migrations locais correspondem aos IDs remotos. Em 02/11/2026, `dt_market_bars`, `dt_market_quotes`, `dt_paper_fills` e `dt_ledger` estavam sem dados. O feed e a amostra paper ainda dependem da configuracao/execucao do ProfitDLL.
2. **ProfitDLL local:** instalar o pacote oficial Windows x64, confirmar licenca/ativacao e configurar PROFITDLL_RUNTIME_DIR, PROFITDLL_TICKER, PROFITDLL_EXCHANGE=F, DASH_API_URL e PROFITDLL_INGEST_SECRET conforme gateways/profitdll/README.md. O gateway solicita as credenciais da Nelogica no terminal e nao as armazena no repositorio.
3. **Segredos do servidor:** configurar PROFITDLL_INGEST_SECRET e ATLAS_OWNER_ID apenas no ambiente server-side. O segredo de ingestao precisa ser distinto de CRON_SECRET. Nao criar variaveis de conta MT5 para o DASH.
4. **Fatos de mercado/risco:** o proprietário preenche margem, horários, limites e custos na aba Risco do DASH com dados da nota Genial e fontes oficiais; um rascunho salvo no banco não remove gates, e a confirmação fica registrada no diário.
5. **Coleta:** o gateway faz POST autenticado de Market Data para /api/daytrade/quote. O endpoint persiste candles e processa pesquisa/paper. A rota /api/daytrade/cycle e uma ronda de status/guardas, nao o agendador do ProfitDLL.
6. **Setores ainda pendentes:** reconciliação de posição da corretora não tem fonte integrada. A mesa de notícias usa feeds públicos configurados com gate por frescor, mas a cobertura é limitada e não equivale a monitoramento integral de notícias. Supervisão, OMS e envio real não formam um operador live homologado. Não habilitar roteamento real.

## Contratos e responsabilidades dos workers

O código está em:

- `src/core/daytrade/desks.ts`: setores (`SECTORS`) e agentes (`DESKS`), cada um com setor, papel e o que faz.
- `src/core/daytrade/agents.ts`: os contratos. Cada mesa tem um `DeskWorker` com o que recebe e o que entrega
  (`DeskContracts`). As regras que protegem o dinheiro (`POWERS`, `reviewProposal`, `maySend`) já estão
  implementadas e testadas em `tests/daytrade-agents.test.ts`.
- `src/components/daytrade/dash-layout.ts`: a planta da sala, compartilhada pela cena 3D e pelo mapa.

## Caminho implementado no codigo

O caminho de mercado e separado do ciclo generico: POST /api/daytrade/quote valida o snapshot ProfitDLL, persiste M1 e chama setores de preco e estrategia antes de registrar observacoes e enviar candles fechados ao RPC transacional dt_apply_paper_bar. A mesa de noticias/calendario tambem e consultada no caminho paper; sem fonte completa e recente, o RPC recebe `enabled=false` e nao pode abrir posicao. O banco mantem estado e fills paper em dt_paper_state/dt_paper_fills, isolados do ledger de acoes. O backtest usa worker proprio, dois candidatos e custos/slippage; os resultados nao aprovam estrategia.

| Responsabilidade | Estado atual |
|---|---|
| Feed e persistencia | Gateway ProfitDLL somente leitura; feedWorker confere fonte, frescor e latencia, priceWorker valida candles/turnover e continuidade; a API persiste somente apos validacoes de contrato, sequencia e tick. Horario esperado do mercado e frescor dos dados aparecem como estados separados. |
| Preco/estrategia | Workers verificam snapshot, candles, continuidade, VWAP e EMA; o endpoint grava observacoes por candle e usa os sinais aceitos no paper. |
| Pesquisa/backtest | Worker executa candidatos walk-forward em sessoes completas com friccao; pesquisa isolada, sem aprovacao automatica. |
| Risco/paper | RPC Postgres transacional, uma posicao e um contrato; simula fill no candle seguinte, stop, gaps, custos, zeragem e limites configurados. |
| Chefia/supervisao | Regras deterministicas no ciclo generico; a ingestao mantem heartbeats setoriais. Isso nao e aprovacao de execucao real. |
| Noticias/calendario externo | `src/lib/daytrade/news.ts` consulta calendários oficiais do BCB, notícias do BCB e RSS de mercado habilitados. newsWorker exige todas as fontes configuradas recentes; evento HIGH/HALT bloqueia. MEDIUM reduz no worker e bloqueia paper enquanto o tamanho mínimo for um contrato. Fonte ausente/vencida bloqueia; observações de pesquisa continuam disponíveis. |
| Posicoes/ordens/registro | positionsWorker valida snapshots completos; a ingestao reconcilia o state paper interno, sem afirmar conciliacao com corretora. ordersWorker valida historico monotono; cada fill paper tambem e espelhado em dt_ledger por trigger append-only, sem OMS live. |
| Roteamento real ProfitDLL | Desativado: o gateway nao carrega funcoes OMS e nao ha endpoint de envio. |

O paper trading e independente do ciclo generico runCycle. O ciclo nao recebe posicoes/P&L reconciliados, entao a guarda de risco o bloqueia. A rota de cotacao atualiza a simulacao persistida sem criar autoridade para ordens reais.

## Fluxo de uma operação

```
feed → price → news → strategy (backtest valida as versões) → sala de análise
(strategy, risk, execution, chief) → veto do risco → execution → orders → positions → ledger
```

O supervisor recebe o `Heartbeat` de cada mesa nas rondas. A chefia abre e encerra a sessão.

## Setores e agentes

| Setor | Agente | Papel | Recebe → entrega |
|---|---|---|---|
| Chefia | Marta (`chief`) | Última revisão determinística de propostas e votos; não abre a sessão nem envia ordens | propostas e votos → voto |
| Supervisão | Rui (`supervisor`) | Confere heartbeats; pode solicitar pausa e acionar o kill switch sob falha crítica | heartbeats → pausa e achados |
| Dados de mercado | Nina (`feed`) | Feed: origem, horário, atraso e falhas | — → `Provenance[]` |
| Dados de mercado | Caio (`price`) | Candles, volume, livro de ofertas | proveniência → candles e topo do livro |
| Notícias e eventos | Lia (`news`) | Notícias e calendário; só bloqueia ou reduz | eventos → `NewsGate` |
| Estratégia | Theo (`strategy`) | Sinais de estratégia explícita e versionada | candles, livro, gate → `Signal[]` |
| Estratégia | Dani (`backtest`) | Valida cada versão em backtest e simulação | versão → `BacktestReport` |
| Risco | Bia (`risk`) | Limites e veto | proposta, posições, perda do dia → `RiskDecision` |
| Risco | Otto (`positions`) | Valida snapshots completos e recentes; o caminho ativo reconcilia somente o estado paper, sem afirmar conciliação com corretora | snapshot paper/broker → posições validadas |
| Execução | Léo (`execution`) | Formata ordem para simulação somente; `maySend` recusa envio live | proposta paper aprovada → `OrderRequest` ou nada |
| Execução | Duda (`orders`) | Acompanha cada ordem até o fim | `OrderUpdate[]` → `OrderUpdate[]` |
| Registro e tributos | Vera (`ledger`) | Fills paper são gravados em `dt_paper_fills`; `GET /api/daytrade/tax-estimate` mostra referência mensal paper, sem DARF ou dados de corretora | registro e estimativa paper separados; sem lançamento financeiro real |

## Regras já implementadas (não remover)

- **Envio de ordens:** só a execução envia (`POWERS`).
- **Veto:** o risco tem veto, e as posições também, quando há divergência com a corretora.
- **Parada:** a chefia e a supervisão podem pausar e acionar o kill switch.
- **Sala de análise** (`reviewProposal`): a proposta segue só quando todas estas condições valem:
  - o risco e a chefia aprovam e ninguém da sala recusa;
  - há dado confiável e o mercado está confirmado como aberto;
  - os limites estão definidos e a perda máxima fica dentro do limite por operação;
  - a quantidade é válida e o stop está do lado certo.

  Qualquer dúvida é não.
- **`maySend`:** no modo simulado nada sai, a ordem só é registrada. Também nada sai sem corretora conectada.

O worker generico de `ledger` continua `notImplemented` para reconciliacao de ordens da corretora. O registro paper e escrito em `dt_paper_fills` pela RPC transacional e cada fill e copiado em `dt_ledger` por trigger append-only, com chave unica contra duplicacao e campos de P&L. A configuracao tributaria em `config/daytrade.json` e informativa; nao ha calculo fiscal de contratos futuros homologado.

## A sala (planta)

- **Fundo, atrás de vidro:** chefia, sala de análise (mesa do comitê e tela, como os conselhos do escritório de
  dividendos) e registro e tributos.
- **Meio:** uma ilha por setor, de frente para o telão, com placa e tapete na cor do setor. A mesa em pé do
  supervisor fica atrás, e a ronda dele está em `PATROL`.
- **Direita:** a área de descanso, com cozinha, ilha com banquetas, geladeira, café, pebolim, pufes e sofá.
  Uma divisória verde a separa da mesa.
- **Frente esquerda:** a recepção junto ao elevador, com a parede do DASH e uma mesinha de reunião.

Nenhum dado é inventado: as telas mostram "sem dados" ou "aguardando" até cada worker existir.

### Supervisao ativa do ciclo

`POST /api/daytrade/cycle` executa a ronda do supervisor sobre os heartbeats persistidos. Um heartbeat em `ERROR`, ou uma sessao confirmada como aberta sem cotacao ProfitDLL fresca, aciona o kill switch do DASH e exige liberacao manual. Setores em `BLOCKED` e limites de risco pendentes aparecem nos achados, mas nao acionam parada automatica por serem condicoes esperadas durante a configuracao. A ronda registra seu proprio heartbeat e diario; nao envia ordens. Falhas operacionais continuam sem promover paper trading a execucao real.

# DASH — equipe, setores e funções a implementar

## Pronto no código (02/11/2026)

| Peça | Onde |
|---|---|
| Configuração do DASH (instrumentos, sessão, risco, custos, tributos, gateway, estratégia) | `config/daytrade.json`, validada em `src/core/daytrade/config.ts` |
| O que falta para operar, em lista (`readiness`) | `src/core/daytrade/config.ts`, mostrado em Painel → "O que falta para operar" |
| Tabelas próprias `dt_*` com RLS (dono com AAL2 lê; backend grava); ledger e diário só de inclusão | `supabase/migrations/20261101120000_daytrade_dash.sql` |
| Leitura e gravação no banco (estado, parada, sinal de vida, diário) | `src/lib/daytrade/store.ts` |
| API: `GET status, config, journal, ledger, orders`; `POST halt` (dono); `POST cycle, heartbeat` (agendador, `CRON_SECRET`) | `src/app/api/daytrade/[resource]/route.ts` |
| Ciclo da mesa: dados → notícias → estratégia → sala de análise → risco → execução, com diário | `src/core/daytrade/cycle.ts` |
| Contratos de cada mesa, poderes e regras da sala | `src/core/daytrade/agents.ts` |
| Tela com estado real quando há banco, botão "Parar o DASH" | `src/components/daytrade/dash-view.tsx` |
| Testes | `tests/daytrade-*.test.ts`, `tests/database.test.ts` (aplica a migration) |

## Falta fora do código

1. **Banco:** aplicar a migration `20261101120000_daytrade_dash.sql` no Supabase (`supabase db push` ou SQL editor).
2. **`.env`:** preencher `DASH_GATEWAY_URL`, `DASH_GATEWAY_TOKEN` e `DASH_GATEWAY_ACCOUNT_ID`, que é a segunda instância do MT5 (ver `.env.example`).
3. **`config/daytrade.json`:** preencher cada valor `null` só com fonte oficial (B3, Genial, nota de corretagem) e marcar `verified: true`. São eles:
   - símbolo do contrato vigente, tick, valor do ponto e margem;
   - horários da sessão;
   - perdas máximas e exposição;
   - custos;
   - estratégia aprovada.
4. **Agendador:** chamar `POST /api/daytrade/cycle` durante a sessão, com `Authorization: Bearer CRON_SECRET`. Os workers chamam `POST /api/daytrade/heartbeat`.
5. **Workers:** no outro computador, trocar cada `notImplemented(...)` de `WORKERS` pela implementação, respeitando o contrato de `DeskContracts`.
6. **Ponte MT5 Day Trade:** segunda instância, conforme `docs/daytrade/ARQUITETURA.md`. Nenhuma rota envia ordem hoje: o modo `LIVE` é recusado pela configuração e pela tabela, e liberar isso exige uma revisão própria.

Guia para implementar os agentes do DASH em outro computador. O código está em:

- `src/core/daytrade/desks.ts`: setores (`SECTORS`) e agentes (`DESKS`), cada um com setor, papel e o que faz.
- `src/core/daytrade/agents.ts`: os contratos. Cada mesa tem um `DeskWorker` com o que recebe e o que entrega
  (`DeskContracts`). As regras que protegem o dinheiro (`POWERS`, `reviewProposal`, `maySend`) já estão
  implementadas e testadas em `tests/daytrade-agents.test.ts`.
- `src/components/daytrade/dash-layout.ts`: a planta da sala, compartilhada pela cena 3D e pelo mapa.

## Caminho já executado pelo DASH

`WORKERS` e `POST /api/daytrade/cycle` continuam sendo contratos do pipeline genérico e ainda não formam um operador completo. O caminho ativo de pesquisa é separado: `POST /api/daytrade/quote` valida o snapshot ProfitDLL, persiste M1, analisa candles fechados e chama `dt_apply_paper_bar`. O RPC simula entradas no candle seguinte, stop/gap/zeragem, custos e risco, e grava em `dt_paper_state` e `dt_paper_fills`, tudo separado do ledger de ações. A configuração incompleta ou o kill switch deixa o motor sem novas entradas.

| Responsabilidade | Estado atual |
|---|---|
| Feed e validação | ProfitDLL local, somente leitura; valida origem, atraso, contrato, OHLCV, candle e tick antes da persistência. |
| Preço e estratégia | `opening-range-vwap-v1` calcula faixa inicial, VWAP e EMA em candle fechado e grava uma observação idempotente. |
| Pesquisa | Backtest walk-forward em sessões completas, com fills no candle seguinte, fricção por lado e pregão corrente excluído; não aprova a estratégia automaticamente. |
| Risco e execução paper | RPC Postgres transacional, um contrato, uma posição por vez; sinal do fechamento preenche no próximo candle; custo/risk config pendente bloqueia entradas. |
| Notícias, supervisão, chefia e reconciliação com conta | Ainda sem workers ativos; não participam nem autorizam ordens reais. |
| Roteamento real ProfitDLL | Desativado: não há chamadas OMS no gateway nem endpoint de envio. |

Apenas os setores listados na tabela de implementação executam trabalho real (ingestão, análise, pesquisa e paper). Os demais workers ainda respondem `IDLE` com o motivo; não inventam dados nem autorizam ordens.

## Fluxo de uma operação

```
feed → price → news → strategy (backtest valida as versões) → sala de análise
(strategy, risk, execution, chief) → veto do risco → execution → orders → positions → ledger
```

O supervisor recebe o `Heartbeat` de cada mesa nas rondas. A chefia abre e encerra a sessão.

## Setores e agentes

| Setor | Agente | Papel | Recebe → entrega |
|---|---|---|---|
| Chefia | Marta (`chief`) | Chefe do DASH: plano do dia, abre e encerra a sessão, dá a palavra final na sala de análise | propostas e votos → voto |
| Supervisão | Rui (`supervisor`) | Anda pela mesa conferindo cada setor; pode pausar e acionar o kill switch | heartbeats → pausa e achados |
| Dados de mercado | Nina (`feed`) | Feed: origem, horário, atraso e falhas | — → `Provenance[]` |
| Dados de mercado | Caio (`price`) | Candles, volume, livro de ofertas | proveniência → candles e topo do livro |
| Notícias e eventos | Lia (`news`) | Notícias e calendário; só bloqueia ou reduz | eventos → `NewsGate` |
| Estratégia | Theo (`strategy`) | Sinais de estratégia explícita e versionada | candles, livro, gate → `Signal[]` |
| Estratégia | Dani (`backtest`) | Valida cada versão em backtest e simulação | versão → `BacktestReport` |
| Risco | Bia (`risk`) | Limites e veto | proposta, posições, perda do dia → `RiskDecision` |
| Risco | Otto (`positions`) | Posições e reconciliação com a corretora | atualizações de ordens → posições (reconciliado?) |
| Execução | Léo (`execution`) | Envia apenas ordens aprovadas, com stop | proposta e decisão da sala → `OrderRequest` ou nada |
| Execução | Duda (`orders`) | Acompanha cada ordem até o fim | `OrderUpdate[]` → `OrderUpdate[]` |
| Registro e tributos | Vera (`ledger`) | Registra operações, custos e IR de day trade; nada é escondido | atualizações → `LedgerEntry[]` |

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

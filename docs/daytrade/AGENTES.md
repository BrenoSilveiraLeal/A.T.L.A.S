# DASH — equipe, setores e funções a implementar

Guia para implementar os agentes do DASH em outro computador. O código está em:

- `src/core/daytrade/desks.ts`: setores (`SECTORS`) e agentes (`DESKS`), cada um com setor, papel e o que faz.
- `src/core/daytrade/agents.ts`: os contratos. Cada mesa tem um `DeskWorker` com o que recebe e o que entrega
  (`DeskContracts`). As regras que protegem o dinheiro (`POWERS`, `reviewProposal`, `maySend`) já estão
  implementadas e testadas em `tests/daytrade-agents.test.ts`.
- `src/components/daytrade/dash-layout.ts`: a planta da sala, compartilhada pela cena 3D e pelo mapa.

Hoje todo worker é `notImplemented`. Ele responde `IDLE` e diz o motivo, sem nunca inventar dado.

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

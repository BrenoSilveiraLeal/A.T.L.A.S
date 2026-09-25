# Paper Trading do ATLAS

Implementado em 25/09/2026 como **simulação separada**. Não é corretora, conta bancária, dinheiro depositado, ordem B3, nem caminho para desbloquear live. O `paper_*` não possui chave estrangeira para `orders`, `broker_accounts`, `executor_commands` ou o ledger real. Todas as escritas usam RPCs transacionais acessíveis apenas ao backend `service_role`, depois de login do único proprietário com MFA/AAL2 e verificação de origem HTTP. As tabelas têm RLS para leitura do proprietário.

## Como usar, passo a passo

1. Inicie o ATLAS com `npm run local`, entre com sua senha e o código TOTP. Confirme que o Supabase está ativo. Na barra lateral, abra **Simulação**.
2. Crie uma carteira virtual. Os valores sugeridos (R$ 10.000 de caixa, R$ 1.000 por ordem, R$ 5.000 de exposição e R$ 500 de perda diária) são **números de teste**. Isso não movimenta dinheiro.
3. Em **Mercado**, cadastre um ativo que a brapi consiga consultar. Em **Agentes**, crie e ative um agente com orçamento virtual suficiente para a ordem.
4. Volte a **Simulação**. Escolha o agente, BUY ou SELL, a quantidade e um preço limite; clique **Gerar proposta**. A API busca cotação e OHLCV da brapi. SMA3/SMA8 aparecem na justificativa. A direção escolhida é uma decisão do proprietário guiada por essa análise simples; não é uma recomendação validada. A fonte, horário e versão ficam na proposta.
5. Revise a proposta e clique **Aprovar**. O banco verifica limites, caixa e posição em uma transação. Uma compra aprovada reserva caixa virtual; uma venda só passa se houver ações virtuais não reservadas. Propostas rejeitadas guardam os motivos.
6. A ordem fica **OPEN**. Clique **Verificar nova cotação** depois que a fonte publicar uma cotação cujo horário seja posterior à abertura da ordem. Para comprar, preço + slippage hipotético precisa ficar no limite ou abaixo; para vender, preço − slippage precisa ficar no limite ou acima. A mesma cotação anterior nunca cria um fill retroativo. Não há execução instantânea artificial.
7. Quando houver preenchimento, a aba registra o **fill SIMULADO**, caixa, posição, P&L realizado e lançamentos balanceados. Ordem cancelada/expirada não gera fill. O botão **Pausar simulação** cancela ordens abertas e libera reservas; posições e eventos permanecem.

O botão global **PARAR TODAS AS OPERAÇÕES** mantém o bloqueio real e tenta pausar a simulação. A confirmação informa separadamente se a pausa virtual falhou. Retomar a simulação não habilita live.

## Premissas e limites

- Fonte de preço: cotação brapi **DELAYED**, que pode estar atrasada ou indisponível. Proposta e verificação recusam cotação com mais de 72 horas; histórico recuperado há mais de 24 horas também bloqueia proposta. Um feriado prolongado pode impedir propostas: essa é uma recusa segura.
- Referência e fill são arredondados a centavos. O fill virtual usa slippage adverso hipotético de **5 bps (0,05%)** e taxa hipotética de **3 bps (0,03%)**, calculada para cima ao centavo. São hipóteses de simulação, sem comprovação para uma corretora. Não há spread bid/ask real, leilões, prioridade de fila, liquidez, fills parciais, tributação, dividendos, split ou ajuste automático de posição. O resultado pode divergir muito de uma negociação real.
- A ordem limite virtual expira após 7 dias; somente uma verificação de cotação ou pausa/cancelamento processa o estado. A verificação é manual nesta fase. O servidor local e o Supabase precisam estar disponíveis.
- A exposição de risco é medida pelo custo registrado e por reservas de compra, sem marcação a mercado contínua. O limite diário considera P&L realizado da carteira virtual. Não use isso como proteção de capital real.
- O histórico consultável na tela é limitado aos últimos 200 registros por tipo. Os registros persistidos no banco não são truncados pela interface.
- O backtest existente em `src/core/research.ts` é outro modo: decide no fechamento e preenche na abertura seguinte, com custos, partições temporais e disponibilidade point-in-time. Dados comuns da brapi não provam ausência de survivorship bias ou validação econômica.

## Segurança e verificação

`tests/database.test.ts` cobre ciclo BUY/SELL, cotação anterior, idempotência, risco, reservas, ledger balanceado, pausa e isolamento de tabelas reais. `tests/paper.test.ts` cobre identidade, timestamps e indicadores. PGlite executa as migrations em PostgreSQL WASM; isso não é uma homologação da plataforma remota nem prova de concorrência entre conexões. O status remoto e de build está em [VALIDATION.md](VALIDATION.md).

## Projetos públicos avaliados

Nenhuma linha de código, asset, dependência ou estratégia foi copiada. Os conceitos abaixo ajudaram a delimitar o desenho; o código do ATLAS foi escrito para seu stack e seu modelo de acesso.

| Projeto | Licença declarada | Ideia considerada | Decisão |
|---|---|---|---|
| [MT5 Trading Bot Research System](https://github.com/Eazydev-CEO/mt5-trading-bot-research-system) | MIT | Pesquisa sem look-ahead, conta paper, risco, diário | Apenas referência conceitual. Django/Python não se encaixa no livro Supabase/TypeScript. O README declara MT5 somente leitura e live não implementado; os testes anunciados não foram executados aqui. |
| [Botstreet](https://github.com/upstash/botstreet) | MIT no README | Preço real com saldo e trades virtuais | Apenas referência conceitual. Depende de Yahoo/Upstash/LLMs e mantém outro modelo operacional. |
| [TradeFlow](https://github.com/makedirectory/tradeflow) | MIT | Pesquisa separada de promoção para operação; validação fora da amostra | Apenas referência conceitual. O ATLAS já possui núcleo de research. |
| [ai-trading-agent-workspace](https://github.com/S09Z/ai-trading-agent-workspace) | Licença não identificada no repositório consultado | Escritório visual por eventos | Nenhum código copiado; 3D permanece futuro após validação funcional. |
| [OpenAlgo](https://github.com/marketcalls/openalgo) | AGPL-3.0 | Interface de adaptadores | Nenhum código copiado. Conectores são de outro mercado e a licença exige avaliação antes de incorporar. |

O documento não verifica segurança/manutenção desses repositórios nem sua capacidade de executar ordens B3. [Documentação oficial do Supabase sobre funções e privilégios](https://supabase.com/docs/guides/database/functions) embasa as RPCs com `search_path` explícito e `EXECUTE` restrito; o [changelog de exposição da Data API](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically) motivou grants explícitos.

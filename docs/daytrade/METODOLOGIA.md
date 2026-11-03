# DASH: pesquisa e estratégia candidata

## Limites da evidência

Não existe método que garanta “lucro máximo”. A CVM ressalta que promessas de retorno garantido são sinal de alerta e que não há evidência de que robôs de ordens sejam mais lucrativos para pessoas físicas. Um estudo da FGV/CVM sobre futuros brasileiros encontrou perdas persistentes frequentes entre os traders que continuaram por mais de 300 pregões. Esses resultados não provam que todo operador perde; mostram por que alegações individuais de cursos ou influenciadores não substituem uma amostra auditável.

Não escolhi um influenciador para copiar. Não encontrei, nas fontes pesquisadas, histórico independente, completo e verificável que permita concluir que uma pessoa específica mantém lucro líquido depois de custos, slippage, impostos e períodos fora da amostra.

## Hipótese implementada

`opening-range-vwap-v1` é um candidato explicável de pesquisa, não uma recomendação:

- constrói a faixa dos primeiros 15 minutos do pregão regular do WIN (09:00–09:15, horário de São Paulo); considera o horário vigente de negociação até 18:25 a partir de 03/11/2026, conforme o [Ofício Circular B3 055/2026](https://www.b3.com.br/data/files/BE/16/C1/59/2F881A10F75B881AAC094EA8/OC%20055-2026-VNC%20NOVOS%20HORARIOS%20DE%20NEGOCIACAO_PT.pdf); no vencimento, o contrato fecha mais cedo conforme o próprio ofício;
- exige os 15 candles completos e consecutivos;
- aguarda 30 candles completos da sessão antes de observar rompimentos; o primeiro sinal do dia pode ocorrer após o fechamento de 09:29, com entrada simulada somente na abertura seguinte;
- só indica observação compradora se o fechamento romper a máxima da faixa, estiver acima da VWAP e EMA 9 estiver acima da EMA 21; o caso vendedor é simétrico;
- o walk-forward também avalia `opening-range-confirmed-v1`, que exige dois fechamentos consecutivos além da faixa e conserva os filtros VWAP/EMA, e `opening-range-unfiltered-entry-v1`, um baseline comparativo que remove os filtros VWAP/EMA na entrada; os três candidatos usam as mesmas saídas, stops, janela, tamanho e custos, são apenas pesquisa e não alimentam o paper;
- quando falta candle ou volume, informa que não há configuração; a análise de VWAP também aguarda o total de preço×quantidade dos negócios;
- cada candidato é medido em blocos sequenciais de três pregões, após 10 sessões completas iniciais. Essa janela foi dimensionada para caber na retenção histórica de 30 dias da ProfitDLL, mas produz blocos curtos e resultados exploratórios com amostra pequena. O backtest recebe os limites verificados de perda por operação, perda diária e quantidade diária de trades, permite reentradas após saídas até atingir esses limites e bloqueia uma entrada se a perda de stop estimada mais custos puder excedê-los. A tela também mostra uma seleção walk-forward separada: em cada bloco, considera apenas candidatos com pelo menos 10 operações, P&L líquido positivo e nenhuma violação de limite nos blocos OOS anteriores; escolhe o maior quociente entre P&L líquido acumulado e drawdown máximo, e só então mede o escolhido no bloco seguinte. Se nenhum candidato cumprir as condições, não seleciona nem negocia nesse bloco. A seleção nunca consulta o bloco que está avaliando. O pregão corrente é sempre excluído; entrada ocorre na abertura do candle seguinte ao sinal, a entrada é recusada se o slippage modelado colocar o fill além do stop, e o stop é verificado também no candle de entrada, inclusive quando coincide com a zeragem. Saída por stop considera gaps, e saída por filtro usa a próxima abertura. Custos e slippage são cobrados nos dois lados; não há ajuste de parâmetros nem aprovação automática.
- O backtest usa apenas pregões completos de anos cujo calendário B3 está marcado como oficial; feriados e aberturas especiais são excluídos. Cada posição é zerada no horário `flatBy` configurado; nenhuma entrada ocorre em ou após `lastEntry`. Os preenchimentos são aproximados por OHLCV de 1 minuto. O relatório separa resultado bruto, tarifas estimadas, slippage modelado e líquido antes do IR; gaps intrabar podem alterar o preenchimento real. Custos e horários não verificados bloqueiam a avaliação. Resultado não autoriza operação real.

Relatório walk-forward discrimina cada bloco fora da amostra: histórico usado na seleção, datas testadas, operações, custos e P&L líquido. A seleção adaptativa é um experimento de pesquisa com três candidatos predefinidos; não implica que um conjunto de dados, novos custos, mudanças de regra ou resultado futuro tenham sido validados. O resultado agregado não pode ocultar um bloco individual negativo.

No cálculo do backtest, VWAP e EMAs são atualizadas incrementalmente em uma passagem por sessão. O gatilho de entrada começa depois dos mesmos 30 candles completos exigidos pela análise em tempo real.

O motor paper recebe a mesma EMA 9 e VWAP do candle fechado e enfileira a saída por filtro para a abertura do próximo minuto; o stop continua tendo prioridade. Backtest e paper compartilham limite de trades por dia, perda máxima por trade/dia, custos por lado e regra de zeragem.

Artigos sobre ORB encontraram resultados diferentes em mercados e períodos diferentes: há estudos de futuros de petróleo e outros mercados com resultados favoráveis sob determinadas regras, enquanto estudos mais recentes podem não encontrar vantagem depois de custos. Não há evidência suficiente para assumir que o mesmo funciona no WIN/Genial. Por isso o DASH começa coletando dados próprios e apresenta “pesquisa”, sem promover o sinal a ordem.

## Política para lacunas históricas

O coletor importa candles M1 derivados dos negócios e preserva minutos sem execução como lacunas; não cria candles de volume zero. A API só grava a sessão histórica após o callback ProfitDLL concluir e valida a contagem de barras contra o marcador transacional `dt_market_history_sessions`. O backtest pode usar uma sessão esparsa somente quando esse marcador comprova a origem completa; uma sessão ao vivo sem marcador precisa ser minuto-contígua. A faixa de abertura ainda exige os 15 minutos observados. Se surgir uma lacuna depois da abertura e até `flatBy` durante a avaliação, uma posição aberta é encerrada no primeiro candle disponível com slippage adverso, e a avaliação daquele dia para ali, como no gate de dados do paper. Nenhum preço é inferido através da lacuna. O resultado mostra quantas sessões foram elegíveis, quantas eram esparsas, em quantos dias OOS a simulação parou por uma lacuna e quantas posições foram fechadas por esse motivo.

## Especificações e dados

- A página da [B3 sobre o mini-índice WIN](https://www.b3.com.br/pt_br/produtos-e-servicos/negociacao/renda-variavel/futuro-mini-de-ibovespa.htm) informa valor de R$ 0,20 por ponto, tick de 5 pontos e vencimentos em meses pares.
- Para 02/11/2026 o contrato selecionado é WINZ26 (dezembro/2026), derivado da regra oficial de vencimento em meses pares e código de dezembro “Z”. O vencimento continua sujeito à atualização do símbolo antes da rolagem.
- A B3 informa que a margem de day trade é definida pela corretora; corretagem/emolumentos dependem da conta e volume. Estes dados permanecem sem valor configurado até confirmação na Genial/nota de corretagem.
- Candles do DASH vêm de negócios ProfitDLL observados localmente. Não há histórico anterior à instalação do coletor neste projeto.
- O coletor guarda em `turnover` a soma de preço×quantidade por minuto. A análise calcula a VWAP ponderada pelos negócios, e não pelo preço de fechamento dos candles. Candles antigos sem esse campo continuam consultáveis, mas não entram na análise de VWAP nem no backtest candidato.
- O gateway aciona a mesa de estratégia ao receber candles fechados. A tabela `dt_strategy_observations` guarda no máximo um resultado por contrato, versão e minuto, com entrada/stop apenas quando há observação e os motivos atuais de bloqueio; o histórico pode ser lido em `GET /api/daytrade/observations` com sessão de proprietário AAL2. Essa trilha não abre proposta nem ordem.
- Quando a instrumentação, horários, limites e custos verificados estiverem preenchidos, o motor paper grava estado e fills em `dt_paper_state`/`dt_paper_fills`. Ele sinaliza no fechamento de um minuto, simula a entrada na abertura do minuto seguinte, aplica slippage adverso por fill, taxas nos dois lados, stop primeiro quando stop e reversão coincidem, saída por gap e zeragem diária. Estado e fills são atualizados por uma função Postgres transacional e idempotente por contrato/candle; a trava do DASH cancela entradas pendentes. Esse registro é separado das posições da corretora e do livro financeiro do ATLAS.
- `GET /api/daytrade/tax-estimate` (sessão de proprietário AAL2) resume saídas paper por data civil de São Paulo, aplica carry de prejuízos apenas desde o primeiro mês paper disponível e apresenta imposto/IRRF teóricos. `DAY_BOUNDARY_FLAT` fica fora do day trade; o endpoint não produz DARF nem cruza dados com a corretora. IRRF real, prejuízos anteriores à amostra e histórico fiscal completo são desconhecidos; confirme tudo com um contador. O endpoint omite os totais quando atinge o limite de leitura, em vez de apresentar um mês parcial como completo.
- Os parâmetros financeiros ficam sem valor nos defaults públicos de `config/daytrade.json`; o proprietário informa custos da nota Genial, limites, margem e horários na aba Risco. Rascunhos ou falta de fonte confirmada continuam bloqueando paper/backtest. Nenhum valor de risco é inferido para liberar simulação.
- Estudos de trader, cursos e screenshots promocionais não são usados para popular dados, calibrar parâmetro ou afirmar performance.

O or?amento paper ? uma aloca??o fixa informada pelo propriet?rio e persistida em `dt_settings`; n?o representa saldo banc?rio nem patrim?nio da corretora. No limite transacional do banco, o capital paper considerado ? essa aloca??o mais o P&L l?quido realizado nas sa?das paper. Posi??es e entradas pendentes de outros contratos reservam margem; novas entradas param quando o capital remanescente n?o cobre a margem do contrato. A linha de configura??o do propriet?rio serializa tentativas entre contratos. O backtest tamb?m consulta uma linha al?m do teto de 20.000 candles e recusa o relat?rio se houver hist?rico excedente, em vez de calcular sobre uma amostra truncada.

## Referências pesquisadas

- [Receita Federal: renda variável e alíquota de 20% para day trade](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/pagamento/renda-variavel/bolsa-de-valores-1)
- [Receita Federal: retenção de IRRF de 1% sobre resultado líquido diário de day trade](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/pagamento/renda-variavel/bolsa-de-valores-1/retencoes)
- [Receita Federal: compensação de prejuízos](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/pagamento/renda-variavel/bolsa-de-valores-1/compensacoes)
- [Receita Federal: cálculo, pagamento, DARF 6015 e prazo](https://www.gov.br/receitafederal/pt-br/assuntos/meu-imposto-de-renda/pagamento/renda-variavel/bolsa-de-valores-1/calculo-e-pagamento-do-imposto)
- [CVM: robôs de investimentos e riscos de alegações de renda garantida](https://www.gov.br/investidor/pt-br/investir/como-investir/profissionais-do-mercado/robos-de-investimentos)
- [CVM/FGV: Caderno 15, Day Trade](https://www.gov.br/investidor/pt-br/educacional/publicacoes-educacionais/cadernos/caderno-cvm-15-day_trade.pdf)
- [Chague, De-Losso e Giovannetti: Day Trading for a Living?](https://papers.ssrn.com/abstract%3D3423101)
- [Lo, Mamaysky e Wang: Foundations of Technical Analysis](https://www.nber.org/papers/w7613)
- [Bailey et al.: The Probability of Backtest Overfitting](https://escholarship.org/uc/item/4w1110bb)
- [ORB em futuros de petróleo: avaliação empírica](https://www.sciencedirect.com/science/article/pii/S1544612312000438)
- [Nelogica: ProfitDLL e dados de mercado](https://ajuda.nelogica.com.br/hc/pt-br/articles/11168755650459-Fun%C3%A7%C3%B5es-Real-Time-DLL)
- O primeiro uso do gateway solicita, um pregao por requisicao, trades historicos da retencao ProfitDLL de ate 30 dias. O DASH so persiste a sessao depois do callback de progresso chegar a 100; dados ausentes ou incompletos nao sao tratados como pregao validado.
- [Nelogica: requisicao de trades historicos e limite de retencao](https://ajuda.nelogica.com.br/hc/pt-br/articles/11973319153563-Como-requisitar-trades-hist%C3%B3ricos-com-a-ProfitDLL)

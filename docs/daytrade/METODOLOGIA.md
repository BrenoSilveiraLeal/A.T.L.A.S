# DASH: pesquisa e estratégia candidata

## Limites da evidência

Não existe método que garanta “lucro máximo”. A CVM ressalta que promessas de retorno garantido são sinal de alerta e que não há evidência de que robôs de ordens sejam mais lucrativos para pessoas físicas. Um estudo da FGV/CVM sobre futuros brasileiros encontrou perdas persistentes frequentes entre os traders que continuaram por mais de 300 pregões. Esses resultados não provam que todo operador perde; mostram por que alegações individuais de cursos ou influenciadores não substituem uma amostra auditável.

Não escolhi um influenciador para copiar. Não encontrei, nas fontes pesquisadas, histórico independente, completo e verificável que permita concluir que uma pessoa específica mantém lucro líquido depois de custos, slippage, impostos e períodos fora da amostra.

## Hipótese implementada

`opening-range-vwap-v1` é um candidato explicável de pesquisa, não uma recomendação:

- constrói a faixa dos primeiros 15 minutos do pregão regular do WIN (09:00–09:15, horário de São Paulo); considera o horário vigente de negociação até 18:25 a partir de 03/11/2026, conforme o [Ofício Circular B3 055/2026](https://www.b3.com.br/data/files/BE/16/C1/59/2F881A10F75B881AAC094EA8/OC%20055-2026-VNC%20NOVOS%20HORARIOS%20DE%20NEGOCIACAO_PT.pdf); no vencimento, o contrato fecha mais cedo conforme o próprio ofício;
- exige os 15 candles completos e consecutivos;
- só indica observação compradora se o fechamento romper a máxima da faixa, estiver acima da VWAP e EMA 9 estiver acima da EMA 21; o caso vendedor é simétrico;
- quando falta candle ou volume, informa que não há configuração;
- o backtest cronológico avalia blocos sequenciais de seis pregões após ao menos 14 pregões completos de histórico, expandindo a janela histórica a cada bloco (walk-forward ancorado). As regras permanecem congeladas; não há ajuste de parâmetros. Usa fricção de ida e volta e no máximo um trade por dia;
- o backtest fecha no fim da sessão e aproxima fills a partir de OHLCV de 1 minuto. Slippage e gaps intrabar não ficam perfeitamente modelados; resultados não autorizam operação real.

Artigos sobre ORB encontraram resultados diferentes em mercados e períodos diferentes: há estudos de futuros de petróleo e outros mercados com resultados favoráveis sob determinadas regras, enquanto estudos mais recentes podem não encontrar vantagem depois de custos. Não há evidência suficiente para assumir que o mesmo funciona no WIN/Genial. Por isso o DASH começa coletando dados próprios e apresenta “pesquisa”, sem promover o sinal a ordem.

## Especificações e dados

- A página da [B3 sobre o mini-índice WIN](https://www.b3.com.br/pt_br/produtos-e-servicos/negociacao/renda-variavel/futuro-mini-de-ibovespa.htm) informa valor de R$ 0,20 por ponto, tick de 5 pontos e vencimentos em meses pares.
- Para 02/11/2026 o contrato selecionado é WINZ26 (dezembro/2026), derivado da regra oficial de vencimento em meses pares e código de dezembro “Z”. O vencimento continua sujeito à atualização do símbolo antes da rolagem.
- A B3 informa que a margem de day trade é definida pela corretora; corretagem/emolumentos dependem da conta e volume. Estes dados permanecem sem valor configurado até confirmação na Genial/nota de corretagem.
- Candles do DASH vêm de negócios ProfitDLL observados localmente. Não há histórico anterior à instalação do coletor neste projeto.
- O gateway aciona a mesa de estratégia ao receber candles fechados. A tabela `dt_strategy_observations` guarda no máximo um resultado por contrato, versão e minuto, com entrada/stop apenas quando há observação e os motivos atuais de bloqueio; o histórico pode ser lido em `GET /api/daytrade/observations` com sessão de proprietário AAL2. Essa trilha não abre proposta nem ordem.
- Quando a instrumentação, horários, limites e custos verificados estiverem preenchidos, o motor paper grava estado e fills em `dt_paper_state`/`dt_paper_fills`. Ele sinaliza no fechamento de um minuto, simula a entrada na abertura do minuto seguinte, aplica slippage adverso por fill, taxas nos dois lados, stop primeiro quando stop e reversão coincidem, saída por gap e zeragem diária. Estado e fills são atualizados por uma função Postgres transacional e idempotente por contrato/candle; a trava do DASH cancela entradas pendentes. Esse registro é separado das posições da corretora e do livro financeiro do ATLAS.
- Os parâmetros financeiros ainda faltantes em `config/daytrade.json` (custos da nota Genial, limites de perda/exposição, margem, horários confirmados) permanecem como travas. Nenhum valor de risco é preenchido por estimativa para habilitar simulação.
- Estudos de trader, cursos e screenshots promocionais não são usados para popular dados, calibrar parâmetro ou afirmar performance.

## Referências pesquisadas

- [CVM: robôs de investimentos e riscos de alegações de renda garantida](https://www.gov.br/investidor/pt-br/investir/como-investir/profissionais-do-mercado/robos-de-investimentos)
- [CVM/FGV: Caderno 15, Day Trade](https://www.gov.br/investidor/pt-br/educacional/publicacoes-educacionais/cadernos/caderno-cvm-15-day_trade.pdf)
- [Chague, De-Losso e Giovannetti: Day Trading for a Living?](https://papers.ssrn.com/abstract%3D3423101)
- [Lo, Mamaysky e Wang: Foundations of Technical Analysis](https://www.nber.org/papers/w7613)
- [Bailey et al.: The Probability of Backtest Overfitting](https://escholarship.org/uc/item/4w1110bb)
- [ORB em futuros de petróleo: avaliação empírica](https://www.sciencedirect.com/science/article/pii/S1544612312000438)
- [Nelogica: ProfitDLL e dados de mercado](https://ajuda.nelogica.com.br/hc/pt-br/articles/11168755650459-Fun%C3%A7%C3%B5es-Real-Time-DLL)

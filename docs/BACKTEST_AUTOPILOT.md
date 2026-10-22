# Backtest da regra do piloto automático

Gerado em 2026-10-22 por `tests/research-autopilot.test.ts` (execução manual, fora do CI).

**Período:** 2023-01-02 a 2026-10-21. **Dados:** cotações oficiais da B3 (COTAHIST, mercado à vista, lote padrão, preços brutos) e eventos oficiais da B3 (proventos, desdobramentos, grupamentos, bonificações).
**Regra:** a mesma do piloto (compra quando SMA20 > SMA50 e preço > SMA20; vende quando SMA20 < SMA50 ou cai 8% abaixo da entrada), decisão no fechamento e execução na abertura seguinte, lotes de 100 ações, R$ 10.000 por ação.
**Custos hipotéticos:** corretagem zero (a confirmar com a Genial), taxas B3 0,03%, meio spread 0,05% e slippage 0,05% por lado. Sem imposto. O contexto de notícias **não** entra no backtest (não há histórico das notícias disponíveis em cada dia).

## Resumo

- Ações testadas: **14**. Média do retorno total: piloto **24.3%** × comprar e segurar **39.6%**.
- O piloto superou comprar e segurar em **8 de 14** ações e superou o **CDI do período (59.4%)** em **3 de 14**.

## Por ação

| Ação | Retorno piloto | Retorno comprar e segurar | Pior queda piloto | Pior queda segurar | Operações | Acerto | Tempo posicionado | Custos |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| ABEV3 | 22.0% | 19.8% | 16.2% | 26.2% | 7 | 57.1% | 44.9% | R$ 42.74 |
| B3SA3 | 79.6% | 90.4% | 24.1% | 39.1% | 9 | 55.6% | 48.1% | R$ 66.16 |
| BBAS3 | 0.9% | 32.1% | 29.7% | 30.2% | 9 | 44.4% | 45.6% | R$ 55.05 |
| BBDC4 | 62.1% | 43.5% | 19.9% | 32.8% | 8 | 62.5% | 46.9% | R$ 60.19 |
| ITSA4 | 46.7% | 96.1% | 22.3% | 22.7% | 10 | 70.0% | 54.2% | R$ 71.99 |
| ITUB4 | 36.5% | 115.4% | 17.3% | 21.5% | 9 | 66.7% | 53.1% | R$ 57.58 |
| LREN3 | 15.9% | -11.9% | 34.4% | 46.8% | 9 | 44.4% | 35.6% | R$ 59.56 |
| MGLU3 | -6.6% | -45.4% | 63.9% | 88.9% | 15 | 13.3% | 22.6% | R$ 57.42 |
| PETR4 | -4.8% | 152.0% | 46.4% | 30.6% | 12 | 16.7% | 50.3% | R$ 52.23 |
| PRIO3 | 79.6% | 69.5% | 19.0% | 27.9% | 7 | 42.9% | 52.0% | R$ 40.54 |
| RENT3 | 14.1% | 5.0% | 28.0% | 35.9% | 12 | 33.3% | 36.7% | R$ 50.17 |
| SUZB3 | -6.8% | -9.8% | 17.1% | 38.0% | 11 | 36.4% | 49.1% | R$ 39.90 |
| VALE3 | -22.7% | -20.3% | 35.0% | 45.0% | 10 | 10.0% | 36.4% | R$ 39.56 |
| WEGE3 | 24.3% | 18.0% | 15.1% | 32.7% | 8 | 50.0% | 46.2% | R$ 40.39 |

## Por ano (piloto / comprar e segurar)

| Ação | Anos |
| --- | --- |
| ABEV3 | 2023: 5.5% / -2.7% · 2024: -5.3% / -12.3% · 2025: 13.9% / 19.7% · 2026: 7.2% / 17.2% |
| B3SA3 | 2023: 25.4% / 18.8% · 2024: -11.9% / -28.5% · 2025: 14.3% / 33.6% · 2026: 42.1% / 67.8% |
| BBAS3 | 2023: 20.2% / 44.2% · 2024: -0.9% / -9.8% · 2025: -11.4% / -6.6% · 2026: -4.5% / 8.8% |
| BBDC4 | 2023: 28.9% / 13.9% · 2024: -9.2% / -29.1% · 2025: 41.8% / 52.0% · 2026: -2.3% / 17.0% |
| ITSA4 | 2023: 12.5% / 21.9% · 2024: -1.0% / -13.9% · 2025: 19.7% / 40.8% · 2026: 9.9% / 32.7% |
| ITUB4 | 2023: 24.4% / 37.8% · 2024: 0.4% / -9.4% · 2025: 6.2% / 38.1% · 2026: 2.9% / 24.9% |
| LREN3 | 2023: 9.8% / -10.3% · 2024: 14.7% / -22.8% · 2025: -2.9% / 12.1% · 2026: -5.3% / 13.4% |
| MGLU3 | 2023: -11.0% / -16.4% · 2024: -30.3% / -66.8% · 2025: -9.8% / 38.5% · 2026: 66.8% / 42.2% |
| PETR4 | 2023: 15.9% / 57.1% · 2024: -24.1% / -2.7% · 2025: -19.8% / -11.8% · 2026: 34.9% / 87.0% |
| PRIO3 | 2023: 24.6% / 19.0% · 2024: -9.5% / -9.9% · 2025: 1.7% / 2.4% · 2026: 56.6% / 54.5% |
| RENT3 | 2023: 14.0% / 12.3% · 2024: -24.8% / -28.0% · 2025: 21.6% / 16.7% · 2026: 9.5% / 11.3% |
| SUZB3 | 2023: 1.2% / 13.9% · 2024: -1.8% / 10.8% · 2025: -5.2% / -14.6% · 2026: -1.1% / -16.3% |
| VALE3 | 2023: -9.2% / -12.3% · 2024: -20.6% / -25.8% · 2025: 19.1% / 31.9% · 2026: -10.0% / -7.2% |
| WEGE3 | 2023: -2.1% / -2.5% · 2024: 12.6% / 32.5% · 2025: 20.5% / -4.0% · 2026: -6.4% / -4.9% |

CDI por ano: 2023: 13.0% · 2024: 10.9% · 2025: 14.3% · 2026: 11.2% ([fonte BCB SGS 12](https://api.bcb.gov.br/dados/serie/bcdata.sgs.12/dados?formato=json&dataInicial=02/01/2023&dataFinal=21/10/2026)).

## Observações

- B3SA3: eventos da B3 indisponíveis (ProviderError: b3: TIMEOUT); resultado sem proventos/ajustes.
- ELET3: excluída, último pregão em 2025-11-07 (código deixou de ser negociado; comparação seria distorcida).
- EMBR3: excluída, último pregão em 2025-10-31 (código deixou de ser negociado; comparação seria distorcida).

## Como ler

Resultado passado não garante resultado futuro, e poucas ações e poucos anos não provam uma estratégia. O backtest serve para descobrir se a regra **faz sentido** antes de arriscar dinheiro: se ela não supera o CDI nem comprar e segurar com custos baixos, ela precisa mudar antes do dinheiro real.

## Leitura desta rodada (22/10/2026)

*Seção escrita à mão; uma nova execução do teste regenera o restante e apaga este trecho.*

- **A regra atual não se paga.** Em quase quatro anos ela rendeu em média 24,3%, menos que comprar e segurar (39,6%) e bem menos que o CDI (59,4%). Só superou o CDI em 3 de 14 ações.
- **Ponto a favor:** ela reduz as quedas. A pior queda média foi menor que a de comprar e segurar na maioria das ações (ex.: MGLU3 −64% contra −89%; LREN3 −34% contra −47%).
- **Comparação injusta com o CDI:** no backtest e na simulação, o dinheiro parado (cerca de metade do tempo) rende zero. Na vida real ele poderia ficar no Tesouro Selic ou no CDB de liquidez diária. Mesmo somando esse rendimento estimado, a regra ficaria perto do CDI, não acima dele.
- **Conclusão prática:** com essa regra, dinheiro real **não** se justifica. Antes de liberar a promoção de agentes para dinheiro real, a regra precisa melhorar no backtest (por exemplo, rendimento do caixa parado, médias mais longas, filtro de tendência do Ibovespa, ou ranking de força entre ações) e confirmar a melhora na simulação.
- O contexto de notícias não entra aqui (não existe histórico das notícias disponíveis em cada dia). Ele só freia, então pode reduzir perdas, mas não transforma uma regra fraca em lucrativa.

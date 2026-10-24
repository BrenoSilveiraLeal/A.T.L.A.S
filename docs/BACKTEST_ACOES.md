# Quais ações para as IAs

Gerado em 2026-10-24 por `tests/research-stocks.test.ts` (execução manual). 47 ações líquidas da B3 com histórico oficial (COTAHIST) de 2023-01-02 a 2026-10-21.

**Regra testada:** a das IAs (compra ao passar da máxima de 20 pregões, vende após cair 15% do topo) **com a regra do dono: nunca vender abaixo de 1% acima do preço de compra**. R$ 1.000 por ação em fracionário, corretagem Genial R$ 0,99 por ordem, taxas B3 0,03%, spread e slippage. Decisão no fechamento, execução na abertura seguinte. Dividendos e JCP incluídos pelo histórico completo da B3 (JCP com 15% de IR descontado; pagamento aproximado em 30 dias após a data com); sem imposto sobre ganho.

CDI: período todo 59.5% · 2023–2024 25.3% · 2025–2026 27.2%.

| Ação | Preço atual | Regra (todo) | 2023–2024 | 2025–2026 | Comprar e segurar | Pior queda | Operações | Bate o CDI nas duas metades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UGPA3 | R$ 40.03 | 313.8% | 53.7% | 168.2% | 261.1% | 42.2% | 2 | sim |
| CYRE3 | R$ 34.39 | 284.7% | 20.0% | 228.4% | 252.3% | 32.9% | 5 | não |
| PETR4 | R$ 57.75 | 256.0% | 105.2% | 74.5% | 230.6% | 17.3% | 2 | sim |
| PETR3 | R$ 64.75 | 237.5% | 93.2% | 74.7% | 216.4% | 19.4% | 2 | sim |
| VBBR3 | R$ 36.83 | 228.8% | 56.2% | 117.4% | 188.0% | 26.8% | 3 | sim |
| CXSE3 | R$ 21.38 | 201.4% | 91.5% | 56.3% | 211.8% | 17.3% | 2 | sim |
| BPAC11 | R$ 80.56 | 194.5% | 15.4% | 160.7% | 263.4% | 34.0% | 2 | não |
| SBSP3 | R$ 32.03 | 186.9% | 51.7% | 92.3% | 207.7% | 30.8% | 2 | sim |
| ENEV3 | R$ 32.17 | 179.1% | -0.2% | 168.3% | 182.2% | 21.2% | 2 | não |
| B3SA3 | R$ 23.51 | 148.9% | 6.9% | 135.7% | 90.3% | 22.6% | 5 | não |
| PSSA3 | R$ 51.73 | 141.9% | 63.7% | 50.9% | 155.2% | 20.6% | 2 | sim |
| ITSA4 | R$ 15.71 | 129.7% | 21.3% | 98.7% | 125.2% | 20.2% | 2 | não |
| ITUB4 | R$ 48.90 | 128.3% | 41.8% | 70.1% | 137.2% | 25.9% | 2 | sim |
| RDOR3 | R$ 43.71 | 104.1% | 24.9% | 75.8% | 79.7% | 36.5% | 4 | não |
| VIVT3 | R$ 32.64 | 99.0% | 42.0% | 48.0% | 92.9% | 27.3% | 3 | sim |
| PRIO3 | R$ 71.31 | 86.0% | 0.0% | 83.0% | 90.5% | 39.0% | 2 | não |
| EQTL3 | R$ 48.63 | 80.0% | 4.8% | 75.7% | 93.8% | 28.4% | 2 | não |
| CMIG4 | R$ 11.70 | 79.2% | 45.8% | 32.0% | 85.6% | 19.9% | 3 | sim |
| TIMS3 | R$ 19.37 | 75.9% | 32.7% | 33.1% | 98.0% | 34.7% | 2 | sim |
| BBSE3 | R$ 42.46 | 75.7% | 25.9% | 38.4% | 69.8% | 20.1% | 1 | sim |
| TOTS3 | R$ 43.24 | 75.6% | 2.9% | 73.9% | 70.6% | 39.0% | 2 | não |
| BBAS3 | R$ 24.10 | 74.2% | 72.3% | 9.6% | 76.7% | 35.8% | 1 | não |
| CPFE3 | R$ 49.51 | 71.4% | 7.9% | 65.2% | 88.5% | 22.5% | 2 | não |
| MULT3 | R$ 37.25 | 64.2% | 0.2% | 68.2% | 93.4% | 31.7% | 2 | não |
| TAEE11 | R$ 45.24 | 62.9% | 12.6% | 48.9% | 61.0% | 15.0% | 1 | não |
| BBDC4 | R$ 20.65 | 57.2% | -7.3% | 79.1% | 66.9% | 30.4% | 2 | não |
| USIM5 | R$ 6.65 | 45.5% | -10.7% | 68.6% | 2.6% | 58.5% | 3 | não |
| EGIE3 | R$ 31.10 | 43.2% | 18.8% | 22.7% | 39.0% | 31.0% | 3 | não |
| GOAU4 | R$ 11.95 | 41.7% | -6.0% | 41.0% | 41.7% | 32.4% | 0 | não |
| WEGE3 | R$ 45.21 | 24.2% | 39.7% | -8.7% | 27.4% | 38.2% | 1 | não |
| GGBR4 | R$ 26.52 | 20.0% | -17.1% | 35.8% | 20.0% | 40.8% | 0 | não |
| RENT3 | R$ 52.54 | 18.9% | -28.8% | 62.6% | 16.3% | 54.5% | 1 | não |
| SANB11 | R$ 28.13 | 18.1% | -3.8% | 22.6% | 22.1% | 29.8% | 1 | não |
| ABEV3 | R$ 16.69 | 17.2% | -16.9% | 42.2% | 17.2% | 29.8% | 0 | não |
| RAIL3 | R$ 18.96 | 12.3% | 1.1% | 11.4% | 12.8% | 44.0% | 1 | não |
| SUZB3 | R$ 42.64 | 5.6% | 39.7% | -28.3% | -4.5% | 32.5% | 2 | não |
| SLCE3 | R$ 16.97 | -1.7% | -14.3% | 41.6% | -1.7% | 30.8% | 0 | não |
| LREN3 | R$ 14.75 | -3.3% | -25.0% | 29.0% | -3.3% | 45.0% | 0 | não |
| VALE3 | R$ 64.03 | -6.1% | -24.4% | 21.8% | -6.1% | 33.3% | 0 | não |
| KLBN11 | R$ 18.20 | -10.5% | 12.1% | -19.7% | -8.2% | 36.3% | 1 | não |
| RADL3 | R$ 21.12 | -10.6% | -11.2% | 23.3% | -1.7% | 55.6% | 1 | não |
| ASAI3 | R$ 13.84 | -24.9% | -67.7% | 98.5% | -24.9% | 73.2% | 0 | não |
| SMTO3 | R$ 20.85 | -25.8% | -20.4% | -7.1% | 0.9% | 63.1% | 2 | não |
| HYPE3 | R$ 26.81 | -28.7% | -51.6% | 53.2% | -28.7% | 58.0% | 0 | não |
| MGLU3 | R$ 13.04 | -51.0% | -75.8% | 76.6% | -45.7% | 89.7% | 1 | não |
| CSNA3 | R$ 5.71 | -53.6% | -33.7% | -35.4% | -38.4% | 72.7% | 2 | não |
| CSAN3 | R$ 5.09 | -65.4% | -47.9% | -35.9% | -62.0% | 81.7% | 1 | não |

Ações que bateram o CDI nas duas metades: **UGPA3, PETR4, PETR3, VBBR3, CXSE3, SBSP3, PSSA3, ITUB4, VIVT3, CMIG4, TIMS3, BBSE3**.

## Como ler

Resultado passado não garante resultado futuro. Uma ação boa nas duas metades tem menos chance de ter sido sorte, mas pode ir mal daqui para frente. Com a regra de nunca vender no prejuízo, uma ação que cai e não volta fica parada (aparece na pior queda).

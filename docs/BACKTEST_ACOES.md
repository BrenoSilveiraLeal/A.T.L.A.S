# Quais ações para as IAs

Gerado em 2026-10-23 por `tests/research-stocks.test.ts` (execução manual). 47 ações líquidas da B3 com histórico oficial (COTAHIST) de 2023-01-02 a 2026-10-21.

**Regra testada:** a das IAs (compra ao passar da máxima de 20 pregões, vende após cair 15% do topo) **com a regra do dono: nunca vender abaixo de 1% acima do preço de compra**. R$ 1.000 por ação em fracionário, corretagem Genial R$ 0,99 por ordem, taxas B3 0,03%, spread e slippage. Decisão no fechamento, execução na abertura seguinte. Sem imposto e sem dividendos.

CDI: período todo 59.5% · 2023–2024 25.3% · 2025–2026 27.2%.

| Ação | Preço atual | Regra (todo) | 2023–2024 | 2025–2026 | Comprar e segurar | Pior queda | Operações | Bate o CDI nas duas metades |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| UGPA3 | R$ 40.03 | 286.6% | 47.4% | 160.7% | 246.8% | 44.4% | 2 | sim |
| CYRE3 | R$ 34.39 | 267.6% | 18.1% | 218.5% | 233.2% | 33.1% | 5 | não |
| VBBR3 | R$ 36.83 | 199.4% | 46.4% | 111.8% | 168.9% | 27.4% | 3 | sim |
| ENEV3 | R$ 32.17 | 179.1% | -0.2% | 168.3% | 182.2% | 21.2% | 2 | não |
| SBSP3 | R$ 32.03 | 176.2% | 47.5% | 88.0% | 197.6% | 31.1% | 2 | sim |
| BPAC11 | R$ 80.56 | 176.1% | 10.4% | 154.4% | 249.4% | 35.6% | 2 | não |
| CXSE3 | R$ 21.38 | 153.5% | 66.8% | 49.6% | 175.4% | 23.6% | 2 | sim |
| B3SA3 | R$ 23.51 | 148.9% | 6.9% | 135.7% | 90.3% | 22.6% | 5 | não |
| PETR4 | R$ 57.75 | 143.6% | 42.4% | 67.1% | 159.5% | 37.0% | 2 | sim |
| PETR3 | R$ 64.75 | 134.6% | 36.5% | 67.6% | 153.8% | 34.4% | 2 | sim |
| PSSA3 | R$ 51.73 | 122.4% | 54.8% | 45.4% | 136.4% | 21.7% | 2 | sim |
| RDOR3 | R$ 43.71 | 99.7% | 23.2% | 73.6% | 74.7% | 36.5% | 4 | não |
| ITUB4 | R$ 48.90 | 99.1% | 28.7% | 62.5% | 115.0% | 26.3% | 2 | sim |
| ITSA4 | R$ 15.71 | 94.1% | 8.9% | 86.9% | 102.0% | 21.5% | 2 | não |
| PRIO3 | R$ 71.31 | 86.0% | 0.0% | 83.0% | 90.3% | 39.0% | 2 | não |
| VIVT3 | R$ 32.64 | 85.4% | 33.5% | 45.7% | 80.8% | 27.7% | 3 | sim |
| EQTL3 | R$ 48.63 | 71.9% | 2.3% | 72.2% | 88.1% | 28.4% | 2 | não |
| TOTS3 | R$ 43.24 | 69.8% | 0.4% | 71.8% | 66.4% | 39.2% | 2 | não |
| MULT3 | R$ 37.25 | 53.0% | -5.2% | 64.9% | 82.4% | 33.8% | 2 | não |
| TIMS3 | R$ 19.37 | 50.0% | 19.5% | 25.0% | 71.0% | 34.5% | 2 | não |
| BBAS3 | R$ 24.10 | 47.0% | 50.7% | 7.2% | 46.5% | 37.8% | 1 | não |
| CPFE3 | R$ 49.51 | 42.0% | -8.3% | 55.7% | 63.2% | 24.8% | 2 | não |
| CMIG4 | R$ 11.70 | 41.1% | 27.0% | 20.5% | 50.1% | 21.9% | 3 | não |
| USIM5 | R$ 6.65 | 40.6% | -13.9% | 68.6% | -5.9% | 58.9% | 3 | não |
| BBSE3 | R$ 42.46 | 37.0% | 8.1% | 27.3% | 39.7% | 26.2% | 1 | não |
| BBDC4 | R$ 20.65 | 31.8% | -21.3% | 74.2% | 47.7% | 35.6% | 2 | não |
| TAEE11 | R$ 45.24 | 27.3% | -4.5% | 32.3% | 30.2% | 20.6% | 1 | não |
| GOAU4 | R$ 11.95 | 25.1% | -21.0% | 38.5% | 25.1% | 46.0% | 0 | não |
| EGIE3 | R$ 31.10 | 23.6% | 5.2% | 20.3% | 20.2% | 30.8% | 3 | não |
| ABEV3 | R$ 16.69 | 22.7% | -16.9% | 48.9% | 22.7% | 29.8% | 0 | não |
| WEGE3 | R$ 45.21 | 20.1% | 36.4% | -10.0% | 22.4% | 39.7% | 1 | não |
| RENT3 | R$ 52.54 | 12.2% | -33.1% | 58.5% | 8.9% | 57.3% | 1 | não |
| GGBR4 | R$ 26.52 | 10.5% | -25.2% | 33.5% | 10.5% | 48.3% | 0 | não |
| RAIL3 | R$ 18.96 | 7.0% | 0.2% | 6.9% | 7.5% | 47.8% | 1 | não |
| SUZB3 | R$ 42.64 | 1.0% | 34.1% | -28.3% | -9.9% | 34.5% | 2 | não |
| SANB11 | R$ 28.13 | -0.9% | -13.7% | 10.7% | 1.4% | 33.5% | 1 | não |
| KLBN11 | R$ 18.20 | -11.4% | 12.1% | -20.5% | -9.1% | 37.0% | 1 | não |
| LREN3 | R$ 14.75 | -12.0% | -30.8% | 25.0% | -12.0% | 46.9% | 0 | não |
| SLCE3 | R$ 16.97 | -13.1% | -23.5% | 37.6% | -13.1% | 41.0% | 0 | não |
| RADL3 | R$ 21.12 | -13.6% | -13.5% | 21.5% | -4.9% | 57.8% | 1 | não |
| VALE3 | R$ 64.03 | -20.4% | -35.1% | 15.1% | -20.4% | 45.0% | 0 | não |
| ASAI3 | R$ 13.84 | -25.7% | -68.0% | 96.4% | -25.7% | 73.4% | 0 | não |
| SMTO3 | R$ 20.85 | -34.7% | -28.2% | -8.8% | -10.4% | 69.7% | 2 | não |
| HYPE3 | R$ 26.81 | -35.1% | -56.3% | 50.1% | -35.1% | 61.5% | 0 | não |
| MGLU3 | R$ 13.04 | -52.0% | -75.8% | 76.6% | -46.8% | 90.3% | 1 | não |
| CSNA3 | R$ 5.71 | -66.0% | -48.1% | -35.4% | -59.7% | 79.3% | 2 | não |
| CSAN3 | R$ 5.09 | -69.2% | -52.0% | -35.9% | -67.2% | 84.2% | 1 | não |

Ações que bateram o CDI nas duas metades: **UGPA3, VBBR3, SBSP3, CXSE3, PETR4, PETR3, PSSA3, ITUB4, VIVT3**.

## Como ler

Resultado passado não garante resultado futuro. Uma ação boa nas duas metades tem menos chance de ter sido sorte, mas pode ir mal daqui para frente. Com a regra de nunca vender no prejuízo, uma ação que cai e não volta fica parada (aparece na pior queda).

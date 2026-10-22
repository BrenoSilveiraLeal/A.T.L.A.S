# Comparação de regras para as IAs

Gerado em 2026-10-22 por `tests/research-strategies.test.ts` (execução manual). Dados oficiais da B3 (14 ações, lote padrão), eventos oficiais da B3, custos hipotéticos (taxas B3 0,03%, meio spread e slippage 0,05% cada por lado), decisão no fechamento e execução na abertura seguinte. Sem eventos B3 para: B3SA3.

## Período completo (2023-01-02 a 2026-10-21) · CDI 59.5%

| Regra | Retorno médio | Mediana | Bate o CDI | Bate segurar | Pior queda média | Operações por ação |
| --- | --- | --- | --- | --- | --- | --- |
| Atual: médias 20/50 + stop 8% | 24.3% | 22.0% | 3/14 | 8/14 | 27.7% | 9.7 |
| Níveis: piso/teto 20 dias, tendência 100 | -8.4% | -8.5% | 0/14 | 2/14 | 19.4% | 11.2 |
| Níveis: piso/teto 40 dias, tendência 100 | -2.9% | -0.9% | 0/14 | 3/14 | 9.3% | 5.0 |
| Níveis: piso/teto 20 dias, tendência 200 | -7.9% | -6.8% | 0/14 | 3/14 | 21.0% | 9.1 |
| Rompimento: máxima 55 / mínima 20 | 11.1% | 18.8% | 0/14 | 3/14 | 23.2% | 6.6 |
| Rompimento: máxima 20 / mínima 10 | 15.2% | 16.2% | 1/14 | 5/14 | 27.3% | 14.5 |
| Comprar e segurar (referência) | 39.6% | 32.1% | 5/14 | — | 37.0% | 0.0 |

## 2023–2024 (2023-01-02 a 2024-12-30) · CDI 25.3%

| Regra | Retorno médio | Mediana | Bate o CDI | Bate segurar | Pior queda média | Operações por ação |
| --- | --- | --- | --- | --- | --- | --- |
| Atual: médias 20/50 + stop 8% | 2.8% | 10.6% | 1/14 | 9/14 | 19.3% | 4.5 |
| Níveis: piso/teto 20 dias, tendência 100 | -5.4% | -5.2% | 0/14 | 7/14 | 12.0% | 5.9 |
| Níveis: piso/teto 40 dias, tendência 100 | -2.8% | -2.6% | 0/14 | 7/14 | 5.9% | 3.1 |
| Níveis: piso/teto 20 dias, tendência 200 | -4.9% | -5.6% | 0/14 | 7/14 | 10.6% | 3.9 |
| Rompimento: máxima 55 / mínima 20 | -5.5% | -1.4% | 0/14 | 6/14 | 18.1% | 3.6 |
| Rompimento: máxima 20 / mínima 10 | -1.2% | 3.4% | 2/14 | 6/14 | 19.0% | 7.3 |
| Comprar e segurar (referência) | -2.2% | 4.9% | 4/14 | — | 31.7% | 0.0 |

## 2025–2026 (2025-01-02 a 2026-10-21) · CDI 27.2%

| Regra | Retorno médio | Mediana | Bate o CDI | Bate segurar | Pior queda média | Operações por ação |
| --- | --- | --- | --- | --- | --- | --- |
| Atual: médias 20/50 + stop 8% | 18.7% | 19.0% | 5/14 | 3/14 | 24.0% | 4.9 |
| Níveis: piso/teto 20 dias, tendência 100 | -4.4% | -5.2% | 0/14 | 2/14 | 12.6% | 4.9 |
| Níveis: piso/teto 40 dias, tendência 100 | -0.3% | 0.0% | 0/14 | 1/14 | 5.3% | 1.8 |
| Níveis: piso/teto 20 dias, tendência 200 | -0.6% | -2.4% | 0/14 | 1/14 | 12.9% | 3.8 |
| Rompimento: máxima 55 / mínima 20 | 17.0% | 21.0% | 2/14 | 3/14 | 15.3% | 2.7 |
| Rompimento: máxima 20 / mínima 10 | 20.4% | 18.1% | 3/14 | 5/14 | 18.4% | 7.0 |
| Comprar e segurar (referência) | 51.8% | 60.0% | 9/14 | — | 27.8% | 0.0 |

## Como ler

Uma regra só merece dinheiro real se for boa **nas duas metades** do período, não só no total: isso reduz a chance de o resultado ser sorte. Sem imposto. Resultado passado não garante resultado futuro.

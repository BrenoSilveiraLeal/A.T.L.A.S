# Rotação de carteira: as IAs escolhem as ações mais fortes

Gerado em 2026-10-22 por `tests/research-rotation.test.ts` (execução manual). 14 ações, preços oficiais da B3 ajustados por desdobramentos/grupamentos/bonificações; proventos em dinheiro ignorados também na referência. Decisão no fechamento, execução na abertura seguinte, custo de 0,13% por operação. Sem eventos B3 para: B3SA3.

## 2024-01 a 2026-10 (2024-01-02 a 2026-10-21) · CDI 41.1%

| Regra | Retorno | Pior queda | Operações (período todo) |
| --- | --- | --- | --- |
| Top 3 · força 6 meses · tendência 200 · troca mensal | 8.9% | 29.2% | 129 |
| Top 2 · força 6 meses · tendência 200 · troca mensal | 25.7% | 31.8% | 87 |
| Top 5 · força 6 meses · tendência 200 · troca mensal | -4.4% | 32.7% | 188 |
| Top 3 · força 3 meses · tendência 100 · troca mensal | 27.0% | 24.9% | 134 |
| Top 3 · força 12 meses · tendência 200 · troca mensal | 11.9% | 24.5% | 113 |
| Top 3 · força 6 meses · sem filtros · troca mensal | -14.9% | 41.7% | 153 |
| Top 3 · força 6 meses · tendência 200 · troca a cada 2 semanas | -2.1% | 31.8% | 234 |
| Comprar e segurar as 14 ações (referência) | 20.8% | 18.7% | 14 |

## 2024 (2024-01-02 a 2024-12-30) · CDI 10.8%

| Regra | Retorno | Pior queda | Operações (período todo) |
| --- | --- | --- | --- |
| Top 3 · força 6 meses · tendência 200 · troca mensal | 8.3% | 12.8% | 129 |
| Top 2 · força 6 meses · tendência 200 · troca mensal | 6.0% | 13.0% | 87 |
| Top 5 · força 6 meses · tendência 200 · troca mensal | 2.2% | 14.4% | 188 |
| Top 3 · força 3 meses · tendência 100 · troca mensal | -5.5% | 24.9% | 134 |
| Top 3 · força 12 meses · tendência 200 · troca mensal | -6.1% | 16.3% | 113 |
| Top 3 · força 6 meses · sem filtros · troca mensal | -18.7% | 23.5% | 153 |
| Top 3 · força 6 meses · tendência 200 · troca a cada 2 semanas | -13.1% | 18.6% | 234 |
| Comprar e segurar as 14 ações (referência) | -15.2% | 15.5% | 14 |

## 2025–2026 (2025-01-02 a 2026-10-21) · CDI 27.2%

| Regra | Retorno | Pior queda | Operações (período todo) |
| --- | --- | --- | --- |
| Top 3 · força 6 meses · tendência 200 · troca mensal | 0.1% | 23.4% | 129 |
| Top 2 · força 6 meses · tendência 200 · troca mensal | 18.0% | 31.8% | 87 |
| Top 5 · força 6 meses · tendência 200 · troca mensal | -6.9% | 29.1% | 188 |
| Top 3 · força 3 meses · tendência 100 · troca mensal | 33.1% | 22.3% | 134 |
| Top 3 · força 12 meses · tendência 200 · troca mensal | 18.2% | 23.0% | 113 |
| Top 3 · força 6 meses · sem filtros · troca mensal | 4.7% | 28.5% | 153 |
| Top 3 · força 6 meses · tendência 200 · troca a cada 2 semanas | 12.8% | 23.8% | 234 |
| Comprar e segurar as 14 ações (referência) | 42.8% | 18.7% | 14 |

## Leitura (manual, 22/10/2026)

- Nenhuma variante passou no critério: todas perderam para o CDI no período inteiro (41,1%).
- A melhor no total (força 3 meses, 27,0%) perdeu dinheiro em 2024 (-5,5%) e só ganhou em 2025–2026; a melhor em 2024 (top 3 padrão, 8,3%) quase não rendeu em 2025–2026 (0,1%). O resultado muda conforme o período: é sorte, não regra.
- Trocar com mais frequência ou tirar os filtros piora (mais custo, mais quedas).
- Decisão: a rotação **não** foi adotada. As IAs continuam no simulado com a regra de stop móvel de 15%, e dinheiro real continua bloqueado até alguma regra vencer o CDI de forma consistente.

## Como ler

A regra só serve se for melhor que o CDI **e** que comprar e segurar nas duas janelas parciais. Sem imposto. Resultado passado não garante resultado futuro.

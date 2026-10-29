# Escolha do time (29/10/2026)

Gerado por `scratchpad pick16.py` a partir de: a regra das agentes aÃ§Ã£o por aÃ§Ã£o de 2023-01 a 2026-10 (histÃ³rico oficial da B3, taxas da Genial), o comportamento em 8 crises desde 2002 (`docs/HISTORIA_CRISES.md`, mesmo mÃ©todo para 55 aÃ§Ãµes) e os nÃºmeros do Fundamentus de 27/10/2026. Sem units nem ETFs (sem a isenÃ§Ã£o de R$ 20 mil). Fora: JBSS3 (saiu da B3 em 06/2025) e CPLE6 (virou CPLE3 em 11/2025).

Placar = 35% regra + 20% retorno 12 meses depois das crises + 15% vezes em que subiu + 10% vezes em que voltou ao nÃ­vel de antes + 10% menor queda adicional + 10% qualidade (ROE, sem prejuÃ­zo, dÃ­vida).

```
ação     setor            placar regra  crise12m subiu volta piora | P/L   ROE  DY   dívida
B3SA3   bolsa            0.88    +97%   +31%   +83%  +100%   -16% |  14.3  28.5   6.1  -0.1
CMIN3   mineração        0.78    +42%   +35%   +50%  +100%    -7% |  10.9  31.8  23.3   0.1
EQTL3   energia          0.75    +41%   +32%   +86%   +86%    -8% |  45.8   3.7   4.5   2.1
LREN3   varejo           0.71    +69%   +17%   +71%   +86%   -14% |   6.5  14.4   9.5  -0.1
ABEV3   consumo          0.71    +50%    +5%   +88%   +88%   -15% |  14.7  18.4   5.6  -0.2
ITUB4   banco            0.70    +47%   +28%   +57%   +88%   -16% |   9.9  22.4   7.5   0.0
ITSA4   banco            0.68    +48%   +16%   +62%   +88%   -16% |   8.3  19.4   8.4   0.0
CYRE3   construção       0.65    +55%   +12%   +86%   +86%   -33% |   4.4  18.3  11.8   0.4
PETR3   petróleo         0.65    +26%   +26%   +75%   +88%   -31% |   5.9  27.7   6.0   0.7
JBSS3   alimentos        0.63    +30%   +29%   +67%  +100%   -30% |   5.9  14.5   0.0   2.4
TOTS3   tecnologia       0.62    +31%    +8%   +71%  +100%   -19% |  15.4  26.1   1.9   0.6
RDOR3   saúde            0.61    +39%   +15%   +50%  +100%   -21% |  16.3  23.3  12.3   0.4
PETR4   petróleo         0.60    +16%   +32%   +75%   +88%   -29% |   5.2  27.7   6.8   0.7
CXSE3   seguro           0.60    +12%   +14%  +100%  +100%   -15% |  14.0  32.8   6.4  -0.1
CPLE6   energia          0.60    +19%   +12%   +86%  +100%   -14% |  13.6  13.0   0.0   0.8
PSSA3   seguro           0.58    +22%   +12%   +71%   +86%   -10% |   8.5  22.8   6.2  -0.9
AXIA3   energia          0.58    +12%   +20%   +86%  +100%   -14% |  11.8   9.9   3.1   0.4
BBDC4   banco            0.55    +30%   +16%   +62%   +88%   -28% |   7.0  13.6   9.6   0.0
EGIE3   energia          0.55    +14%   +15%   +71%   +88%   -12% |   9.8  26.4   3.3   1.6
UGPA3   combustíveis     0.55     +8%   +26%   +83%   +83%   -14% |  11.4  19.2   5.7   0.6
MULT3   shoppings        0.52    +58%    -3%   +43%   +86%   -16% |  10.4  20.5   4.1   0.7
TAEE4   energia          0.50    +26%    +1%   +50%  +100%   -18% |   8.9  20.1   7.1   1.3
SBSP3   saneamento       0.50    +24%    +6%   +75%   +62%   -18% |  11.1  17.8   2.7   0.8
VIVT3   telecom          0.50    +14%   +14%   +67%  +100%   -13% |  15.0  10.1   8.3   0.2
VALE3   mineração        0.50     +9%   +19%   +75%  +100%   -14% |  27.6   5.3   8.7   0.3
BBAS3   banco            0.48    +18%   +21%   +62%   +88%   -24% |   6.9   8.0   3.9   0.0
KLBN4   papel/celulose   0.48    +17%   +15%   +75%   +88%   -22% |  41.1   5.9   6.3   2.6
PRIO3   petróleo         0.48    +10%   +36%   +60%   +80%   -18% |  16.0  13.7   0.0   0.8
RENT3   locação          0.46     +5%   +45%   +71%  +100%   -30% |  10.4  12.6   6.7   1.3
VBBR3   combustíveis     0.45    +20%   +12%   +67%   +67%   -32% |   7.6  21.5   6.0   0.7
BRAP4   mineração        0.43     +3%   +17%   +75%   +88%   -13% |  12.9   7.3  12.2  -0.0
CPFE3   energia          0.43    +24%    -2%   +43%   +86%   -18% |   8.2  26.4   8.7   1.2
BBSE3   seguro           0.42    +22%    -3%   +33%   +83%   -16% |   9.1  84.4  10.8   0.0
ABCB4   banco            0.42    +35%    -1%   +43%   +86%   -22% |   6.3  14.1  10.5   0.0
SLCE3   agro             0.41    +40%   -15%   +43%   +86%   -18% |  22.4   7.2   4.6   1.3
SMTO3   agro             0.40     -7%   +33%   +71%   +86%   -19% |   8.2  11.0   1.1   0.9
HYPE3   saúde            0.40     -2%   +32%   +57%   +86%   -13% |   8.3  12.1   5.1   0.4
CMIG4   energia          0.40    +19%    +5%   +50%   +75%   -15% |   6.4  15.8   9.9   0.7
ENEV3   energia          0.39    +15%   +30%   +50%   +75%   -20% |  53.9   4.7   0.0   1.0
BRKM5   química          0.39    -39%   +35%   +75%   +88%   -46% |  -0.5  44.0   0.0  -3.5
EMBJ3   indústria        0.39    +19%    +1%   +57%   +88%   -25% |  30.6  13.0   1.2   0.1
ASAI3   varejo           0.38    +18%    -1%   +50%  +100%   -24% |  11.1  15.2   1.3   1.9
RADL3   saúde            0.38     +8%    +9%   +67%   +83%   -15% |  20.5  18.4   2.9   0.4
MGLU3   varejo           0.37     -9%   +88%   +67%  +100%   -42% |  46.5   0.8   1.5   0.3
RAIL3   logística        0.37    +13%    +8%   +75%   +75%   -20% |  23.5   8.5   0.7   1.2
GGBR4   siderurgia       0.32     +8%   +15%   +75%   +75%   -32% |  18.6   5.0   3.1   0.1
TIMS3   telecom          0.31     +5%   +20%   +60%   +80%   -18% | 3153.1   0.1   8.2  -0.1
SUZB3   papel/celulose   0.30    +16%    +4%   +50%   +83%   -32% |   7.3  16.4   0.0   1.3
SAPR4   saneamento       0.30    +20%    +0%   +50%   +75%   -25% |  22.6   3.8   1.6   0.2
WEGE3   indústria        0.26     +6%    +0%   +57%   +71%   -22% |  29.8  31.4   4.5  -0.1
CSNA3   siderurgia       0.21    -19%   +23%   +75%   +75%   -29% |  -2.5 -21.6   0.0   3.2
USIM5   siderurgia       0.14     +7%    +8%   +62%   +62%   -36% |  -3.2 -11.2   0.0  -0.0
GOAU4   siderurgia       0.14     +9%    -4%   +38%   +75%   -34% |  15.7   4.9   3.3   0.4
CSAN3   holding          0.11    -36%   +10%   +71%   +57%   -27% |  -1.2 -179.0   0.0   9.6

```

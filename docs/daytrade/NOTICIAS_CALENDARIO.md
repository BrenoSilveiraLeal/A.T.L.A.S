# DASH: cobertura de notícias e calendário

## Fontes avaliadas

- O Banco Central publica calendários iCalendar separados para reuniões do Copom, atas/comunicados e divulgações estatísticas. A página oficial de assinatura é [Calendário do BC - ICS](https://www.bcb.gov.br/acessoinformacao/calendariobc_ics); os links da tabela usam o endpoint `https://www.bcb.gov.br/api/exportarics/sitebcb/agendaics?lista=...` e o calendário geral usa `https://www.bcb.gov.br/api/exportarics/sitebcb/eventosics`.
- O ATLAS já lê o feed Atom de notícias do BC em `src/providers/bcb-news.ts` e RSS da InfoMoney em `src/providers/rss.ts`. São notícias publicadas, não uma agenda completa de eventos futuros.
- O calendário B3 em `src/core/b3-calendar.ts` confirma pregões, feriados e alguns horários especiais. Ele não substitui calendário macroeconômico.

## Contrato necessário para liberar o setor

1. Armazenar um snapshot por fonte, com URL/origem permitida, hora de coleta, hora do evento, identificador estável e resultado explícito de coleta. Lista vazia só significa “nenhum evento” quando a resposta da fonte foi validada.
2. Combinar agenda oficial de divulgações com feeds de notícias; não declarar cobertura completa quando uma fonte obrigatória falhar, estiver vencida ou não puder ser interpretada.
3. Tratar eventos de impacto alto e interrupções de mercado como veto; eventos médios podem reduzir a exposição. O classificador não pode transformar fonte ausente em sinal favorável.
4. Persistir os payloads por fonte em cache; mostrar cobertura, horário do snapshot e motivo de bloqueio no heartbeat do setor. A mesa de notícias não cria sinais nem ordens.
5. Manter o paper bloqueado até que a coleta esteja ligada ao endpoint, a cobertura configurada esteja fresca e as fontes tenham sido verificadas. A pesquisa de candles e o backtest podem continuar sem esse gate.

## Estado atual

`src/lib/daytrade/news.ts` coleta cinco calendários do BC (reuniões e comunicados do Copom, estatísticas macroeconômicas, Focus e eventos gerais), notícias do BC e os feeds de mercado habilitados no ATLAS. A rota de ciclo do DASH atualiza os caches; a ingestão de cotações só lê o cache para não atrasar os candles. O gate recebe `complete=true` somente quando cada fonte configurada tem resposta íntegra dentro de 15 minutos. O coletor filtra eventos do dia e próximos de 45 minutos; manchetes publicadas na última hora são consideradas. A classificação de manchetes é conservadora: alto impacto veta, negativo reduz; como o paper só usa contratos inteiros, entradas reduzidas também ficam bloqueadas.

Essa cobertura é deliberadamente limitada às fontes configuradas. Não cobre todo o noticiário global e não promete detectar todo evento econômico. Fonte ausente, resposta ICS vazia/malformada ou cache vencido deixa a mesa em `BLOCKED`. A rota de cotação grava o heartbeat de notícias quando processa um candle fechado. Margem, custos e risco continuam sendo gates independentes.


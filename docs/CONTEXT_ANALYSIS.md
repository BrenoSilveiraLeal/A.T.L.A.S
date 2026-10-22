# Analista de contexto (regras gratuitas)

Implementado em 22/10/2026 (`src/core/context.ts`, `src/lib/context.ts`). Custo zero: só fontes públicas sem chave. Não usa IA paga; a versão com LLM fica para quando houver orçamento.

## O que ele faz

O preço (SMA20/SMA50) continua decidindo **quando** entrar. O contexto decide **se é seguro** e **quanto**. Ele só freia:

| Ação | Efeito no piloto automático |
| --- | --- |
| `ALLOW` | Nada muda |
| `REDUCE` | Compras novas com metade do tamanho |
| `BLOCK_BUY` | Nenhuma compra nova; saídas normais continuam |
| `EXIT` | Vende a posição inteira do agente |

Ele nunca inicia uma compra. A ação mais grave prevalece; a pontuação de risco vai de 0 a 100.

## Fontes e regras

| Fonte | Atualização | Regra |
| --- | --- | --- |
| CVM — dados abertos IPE, categoria "Fato Relevante" | semanal (a CVM publica o arquivo do ano) | Fato relevante da empresa nos últimos 3 dias → `BLOCK_BUY`; assunto grave (recuperação judicial, falência, fraude, investigação, inadimplemento, vencimento antecipado, acidente, rompimento) → `EXIT` |
| **Agência Brasil (EBC)** — RSS de economia, internacional, geral e últimas notícias; fonte principal de manchetes (empresa e mercado) | cache de 1 h |  mesmas regras de manchetes abaixo; cada motivo cita "Agência Brasil" |
| GDELT DOC 2.0 — manchetes das últimas 24 h sobre a empresa | cache de 2 h | ≥2 manchetes graves → `BLOCK_BUY`; ≥3 termos negativos e o dobro dos positivos → `BLOCK_BUY` |
| GDELT — manchetes sobre Ibovespa/bolsa brasileira | cache de 2 h | "circuit breaker" → `BLOCK_BUY`; ≥2 manchetes de estresse (guerra, ataque, terremoto, pânico, crash, golpe…) → `REDUCE` |
| Banco Central — dólar PTAX venda (SGS 1) | cache de 3 h | variação diária ≥ 2% → `REDUCE` |

Palavras-chave em português e inglês, sem acentos. A empresa é reconhecida por apelidos específicos (ex.: "mineradora vale" e "vale3", nunca só "vale", que também significa "vale a pena"). Cadastro em `COMPANIES`; ativos fora dele usam o próprio ticker e ficam sem fatos da CVM.

## Limites conhecidos

- **Fatos relevantes têm atraso de até uma semana**: o arquivo aberto da CVM não é tempo real.
- **Licença das notícias:** a EBC autoriza reprodução gratuita para fins não comerciais com citação da fonte. O ATLAS é pessoal, guarda só título, link e data e cita a Agência Brasil. Material de agências internacionais republicado pela EBC tem restrição; ele só é lido como sinal, nunca reproduzido. O RSS do Google Notícias **não** é usado: seus termos restringem o feed a leitores pessoais.
- **GDELT é complementar e pouco confiável na nuvem:** em 22/10/2026 respondeu "limite excedido" mesmo na primeira consulta, a partir de um datacenter (IPs compartilhados). O ATLAS tenta no máximo 1 consulta por ciclo e espera 30 min antes de repetir uma consulta que falhou.
- GDELT pede no máximo uma consulta a cada 5 s; um controle no banco espaça as consultas entre execuções simultâneas, e o último resultado é reaproveitado por até 12 h. Na rede local do proprietário o Node nem conecta ao GDELT (sem IPv6).
- Fonte indisponível vira `unavailable` na avaliação e **não** é tratada como "sem notícia ruim" nem como "notícia ruim".
- Palavras-chave erram: ironia, negação e contexto escapam. Por isso o contexto só freia.
- Não há backtest possível sem um arquivo histórico de notícias disponíveis em cada momento; a validação é ao vivo, na simulação.

## Onde aparece

- Cada análise grava a avaliação em `decisions.inputs.context` (auditável).
- Trading Floor: etiqueta de clima em cada estação.
- Página do agente: "Contexto de mercado", com motivos, links das fontes e fontes indisponíveis.

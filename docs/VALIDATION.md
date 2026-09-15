# Evidências da entrega local

Atualização: 15/09/2026. Ambiente: Windows, Node 24.14.0, Next.js 16.3.5, PostgreSQL via PGlite. Nenhuma credencial real foi adicionada ao repositório, nenhum serviço pago contratado e nenhuma ordem/transferência enviada.

## Verificações executadas

| Verificação | Resultado e limite |
|---|---|
| Instalação | `npm install --ignore-scripts` concluiu, 398 pacotes auditados, zero vulnerabilidades reportadas naquele momento. Lockfile fixado. CLI Supabase oficial disponível. |
| Lint | `npm run lint` passou. |
| Tipagem | `npm run typecheck` passou, incluindo rotas Next. |
| Testes locais | `npm test`: **234 passaram, 3 testes de rede opt-in ignorados**, onze arquivos. |
| Rede pública dos adapters | Smoke opt-in dos cinco adapters passou: brapi cotação/histórico/busca, BCB e IBGE. Não testa broker. |
| CVM pública | Smoke `ATLAS_CVM_PUBLIC_SMOKE=1`, `actual public annual DFP`: passou com ZIP oficial 2025, companhia por código CVM e escopo consolidado. Fonte, versão e rubrica preservadas. [Evidências e limites](CVM_FUNDAMENTALS.md). |
| Fluxo com dados reais | `ATLAS_PUBLIC_DATA_SMOKE=1`, teste `real public data`: fetch público → análise HOLD → job com lease → decisão/memória/auditoria atômicas no PostgreSQL temporário. Passou; zero ordens criadas. |
| Build | `npm run build` passou, com rotas privadas dinâmicas e proxy. |
| UI | Navegador real no build de produção, 1440px e 390px. Visão geral e Mercado/CVM inspecionados; largura mobile e scrollWidth de 390px. Menu abriu, navegou até Risco e fechou. As 12 seções e login retornaram 200; seção desconhecida retornou 404. Sem erros de página nas capturas finais. API de fundamentos retornou 503 sem configuração; totais e ações permaneceram indisponíveis. Não houve login real por falta de projeto ATLAS. |

As capturas anteriores ficam em `.impeccable/review/`; as capturas desta continuação estão em `output/playwright/overview-desktop.png`, `market-desktop.png` e `market-mobile.png`. Os registros do navegador ficam em `.playwright-cli/`. Esses artefatos são ignorados pelo Git. Servidor local não substitui implantação cloud.

## Cobertura

- `tests/core.test.ts`: precisão decimal; limites/identidade do risco; MFA; token/conexão indisponíveis; quote stale/futura; mercado fechado; quantidade/lote/tick inválidos; saldo insuficiente; short/alavancagem/instrumentos proibidos; circuit breaker; corporate action não verificada; ciclo OMS; timeout sem reenvio; rejeição, fills parciais/duplicados e reconciliação divergente.
- `tests/providers.test.ts`: respostas reais documentadas validadas com fixtures de teste; timestamps; HTTP 401/429/5xx; timeout/backoff; payload inválido; OHLCV; notícia duplicada; conteúdo externo tratado como dado; smoke público separado.
- `tests/database.test.ts`: aplicação das migrations completas, RLS de owner+AAL2, privilégios, ledger balanceado/imutável, precisão, idempotência, duplicata de confirmação, overspend/rollback, PIX não confirmado, jobs/leases/fencing, parada global, rate limit, análise atômica e evidências inconsistentes rejeitadas.
- `tests/research.test.ts`: SMA/EMA/RSI/ATR, execução na próxima abertura, custos, holdings/corporate actions, dados futuros, disponibilidade temporal, partições/holdout e walk-forward.
- `tests/security.test.ts`: proprietário, sessão inválida, MFA, CSRF/origin, segredo cron, JSON e limite de corpo, perfil de risco incompleto.
- `tests/fundamentals.test.ts`: identidade, revisão, período e escopo CVM; moeda/escala/precisão; rubricas ausentes ou ambíguas; divisão por zero; restrição point-in-time; CSV real com aspas; CRC, nomes, descompressão e tamanhos de arquivo; smoke oficial separado.
- `tests/health.test.ts`, `tests/data-cache.test.ts` e `tests/cache-database.test.ts`: expiração/futuro/invalidade da evidência; atualização de cache após TTL; retenção restrita por proprietário, papel, idade e lote; preservação de histórico e auditoria.
- `tests/accounting-view.test.ts` e `tests/format.test.ts`: apresentação do snapshot conciliado com horário original, ausência de total quando há divergência, campos desconhecidos preservados e centavos mantidos além da precisão de `Number`.

## Limites da evidência

PGlite executa PostgreSQL real em WASM, mas a instância de testes serializa operações. Não certifica contenção entre conexões remotas, PostgREST/Supabase Auth gerenciado, JWT real, TOTP real, Cron/Edge em nuvem, backup/restore ou RLS sob o gateway de produção. As funções Auth são bindings de teste e não um Auth simulado de produção.

O browser foi verificado **sem credenciais**. Cadastro autenticado, gráficos com token do proprietário e operação com computador desligado dependem de setup externo. Testar dados públicos com ticker de fixture não escolhe o universo de investimentos do usuário.

Os indicadores não foram validados como estratégia economicamente lucrativa. Research exige disponibilidade point-in-time, custos e corporate actions explícitos; o histórico comum da brapi não satisfaz automaticamente todas essas condições.

O teste CVM cobre uma companhia/ano/escopo reais. As datas de referência e recebimento não foram tratadas como horário de publicação. O relatório permanece inelegível para backtest point-in-time e execução; ITR e outros layouts/rubricas continuam pendentes. Falhas TLS iniciais foram superadas e o teste passou após corrigir diferenças encontradas no CSV real.

## Correções obtidas por revisão

Renovação de cookie encaminha o novo header ao SSR; duração do cookie aplicada após o SDK para impedir persistência involuntária de 400 dias; parada global separada do limite normal; rate limit MFA só após autenticar proprietário; cache compartilhado e orçamento conservador dos providers; lock order dos jobs alinhada; retry de análise com payload diferente rejeitado; writes financeiros fora de RPC negados.

Nesta continuação, o cache passou a atualizar sua chave única após expiração; a limpeza é limitada a registros de leitura com mais de sete dias e preserva evidências. A saúde vencida é normalizada como desconhecida e mantém o valor original para auditoria. Totais financeiros usam o snapshot conciliado em strings decimais, com data explícita e sem transformar ausência em zero.

O navegador revelou erro 500 nas rotas dinâmicas: o servidor consumia uma lista exportada por um módulo `use client` como se fosse um array local. A validação de seções foi movida para o módulo de servidor. Novo build e repetição das requisições a todas as seções confirmaram a correção. A evidência do build isolado não havia detectado essa falha de runtime.

## Ações externas ainda necessárias

Um projeto Supabase dedicado, usuário proprietário/TOTP e segredos server-side; hospedagem compatível com termos/custo e deploy; acesso/contrato de corretora, feed oficial e sessão; integração/homologação de execução e confirmação independente de transferências. A organização Supabase conectada é Free e já tem dois projetos ativos de outro produto. Nenhum deles foi reutilizado, pausado ou modificado.

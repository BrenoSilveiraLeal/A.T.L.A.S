# Evidências da entrega local

Atualização: 14/09/2026. Ambiente: Windows, Node 24.14.0, Next.js 16.3.5, PostgreSQL via PGlite. Nenhuma credencial real foi adicionada ao repositório, nenhum serviço pago contratado e nenhuma ordem/transferência enviada.

## Verificações executadas

| Verificação | Resultado e limite |
|---|---|
| Instalação | `npm install --ignore-scripts` concluiu, 398 pacotes auditados, zero vulnerabilidades reportadas naquele momento. Lockfile fixado. CLI Supabase oficial disponível. |
| Lint | `npm run lint` passou. |
| Tipagem | `npm run typecheck` passou, incluindo rotas Next. |
| Testes locais | `npm test`: **163 passaram, 2 testes de rede opt-in ignorados**, cinco arquivos. |
| Rede pública dos adapters | Smoke opt-in dos cinco adapters passou: brapi cotação/histórico/busca, BCB e IBGE. Não testa broker. |
| Fluxo com dados reais | `ATLAS_PUBLIC_DATA_SMOKE=1`, teste `real public data`: fetch público → análise HOLD → job com lease → decisão/memória/auditoria atômicas no PostgreSQL temporário. Passou; zero ordens criadas. |
| Build | `npm run build` passou, com rotas privadas dinâmicas e proxy. |
| UI | Navegador real em 1440px e 390px; estado de configuração observado; largura mobile 390px e scrollWidth 390px. Captura mobile estabilizada com reduced motion. Não houve login real por falta de projeto ATLAS. |

As capturas locais ficam em `.impeccable/review/` e os registros do navegador em `.playwright-cli/`, ambos ignorados pelo Git. Servidor local não substitui implantação cloud.

## Cobertura

- `tests/core.test.ts`: precisão decimal; limites/identidade do risco; MFA; token/conexão indisponíveis; quote stale/futura; mercado fechado; quantidade/lote/tick inválidos; saldo insuficiente; short/alavancagem/instrumentos proibidos; circuit breaker; corporate action não verificada; ciclo OMS; timeout sem reenvio; rejeição, fills parciais/duplicados e reconciliação divergente.
- `tests/providers.test.ts`: respostas reais documentadas validadas com fixtures de teste; timestamps; HTTP 401/429/5xx; timeout/backoff; payload inválido; OHLCV; notícia duplicada; conteúdo externo tratado como dado; smoke público separado.
- `tests/database.test.ts`: aplicação das migrations completas, RLS de owner+AAL2, privilégios, ledger balanceado/imutável, precisão, idempotência, duplicata de confirmação, overspend/rollback, PIX não confirmado, jobs/leases/fencing, parada global, rate limit, análise atômica e evidências inconsistentes rejeitadas.
- `tests/research.test.ts`: SMA/EMA/RSI/ATR, execução na próxima abertura, custos, holdings/corporate actions, dados futuros, disponibilidade temporal, partições/holdout e walk-forward.
- `tests/security.test.ts`: proprietário, sessão inválida, MFA, CSRF/origin, segredo cron, JSON e limite de corpo, perfil de risco incompleto.

## Limites da evidência

PGlite executa PostgreSQL real em WASM, mas a instância de testes serializa operações. Não certifica contenção entre conexões remotas, PostgREST/Supabase Auth gerenciado, JWT real, TOTP real, Cron/Edge em nuvem, backup/restore ou RLS sob o gateway de produção. As funções Auth são bindings de teste e não um Auth simulado de produção.

O browser foi verificado **sem credenciais**. Cadastro autenticado, gráficos com token do proprietário e operação com computador desligado dependem de setup externo. Testar dados públicos com ticker de fixture não escolhe o universo de investimentos do usuário.

Os indicadores não foram validados como estratégia economicamente lucrativa. Research exige disponibilidade point-in-time, custos e corporate actions explícitos; o histórico comum da brapi não satisfaz automaticamente todas essas condições.

## Correções obtidas por revisão

Renovação de cookie encaminha o novo header ao SSR; duração do cookie aplicada após o SDK para impedir persistência involuntária de 400 dias; parada global separada do limite normal; rate limit MFA só após autenticar proprietário; cache compartilhado e orçamento conservador dos providers; lock order dos jobs alinhada; retry de análise com payload diferente rejeitado; writes financeiros fora de RPC negados.

## Ações externas ainda necessárias

Um projeto Supabase dedicado, usuário proprietário/TOTP e segredos server-side; hospedagem compatível com termos/custo e deploy; acesso/contrato de corretora, feed oficial e sessão; integração/homologação de execução e confirmação independente de transferências. A organização Supabase conectada é Free e já tem dois projetos ativos de outro produto. Nenhum deles foi reutilizado, pausado ou modificado.

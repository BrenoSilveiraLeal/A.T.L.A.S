# Evidências da implementação e do Supabase

Atualização: 15/09/2026. Ambiente local: Windows, Node 24.14.0, Next.js 16.3.5, PostgreSQL via PGlite. Banco remoto: projeto ATLAS no Supabase Free. Credenciais reais estão somente nos arquivos locais ignorados pelo Git; nenhum serviço pago foi contratado e nenhuma ordem/transferência foi enviada.

## Verificações executadas

| Verificação | Resultado e limite |
|---|---|
| Instalação | `npm install --ignore-scripts` concluiu, 398 pacotes auditados, zero vulnerabilidades reportadas naquele momento. Lockfile fixado. CLI Supabase oficial disponível. |
| Lint | `npm run lint` passou. |
| Tipagem | `npm run typecheck` passou, incluindo rotas Next. |
| Testes locais | `npm test`: **348 passaram, 3 testes de rede opt-in ignorados**, 20 arquivos. |
| Rede pública dos adapters | Smoke opt-in dos cinco adapters passou: brapi cotação/histórico/busca, BCB e IBGE. Não testa broker. |
| CVM pública | Smoke `ATLAS_CVM_PUBLIC_SMOKE=1`, `actual public annual DFP`: passou com ZIP oficial 2025, companhia por código CVM e escopo consolidado. Fonte, versão e rubrica preservadas. [Evidências e limites](CVM_FUNDAMENTALS.md). |
| Fluxo com dados reais | `ATLAS_PUBLIC_DATA_SMOKE=1`, teste `real public data`: fetch público → análise HOLD → job com lease → decisão/memória/auditoria atômicas no PostgreSQL temporário. Passou; zero ordens criadas. |
| Build | `npm run build` passou, com rotas privadas dinâmicas e proxy. |
| UI antes do provisionamento | Navegador real no build de produção, 1440px e 390px. Visão geral e Mercado/CVM inspecionados; largura mobile e scrollWidth de 390px. Menu abriu, navegou até Risco e fechou. As 12 seções e login retornaram 200; seção desconhecida retornou 404. Sem erros de página nas capturas dessa etapa. API de fundamentos retornou 503 sem configuração; totais e ações permaneceram indisponíveis. Essa evidência antecede o banco remoto e não valida o login atual. |
| Integração da interface | Histórico/posições por conta e publicação/configuração de estratégias ligados às rotas privadas. Métricas e gráfico usam a mesma conta; mudança de consulta não mantém valores da conta anterior na tela. Lint, tipagem e build passaram. |
| UI com Supabase configurado | Login/setup 200; `/app` e carteira redirecionam 307 ao login; APIs de carteira/estratégias retornam 401; POST sem origem em auth/setup retorna 403; cron sem segredo retorna 401. Setup mobile: largura e scrollWidth 390px. Link privado abriu formulário e removeu o fragmento da URL sem enviar senha. |
| Scheduler local | `npm run local` iniciou Next e recebeu `OK` com zero jobs, condizente com ausência de agentes cadastrados. Ctrl+C encerrou o servidor; reinício liberou a porta e retornou `RECENT_TICK`, seguido de `OK`. Não houve sobreposição de chamadas ou ordem enviada. |
| Verificação remota por leitura | `node scripts/verify-supabase.mjs`: projeto/proprietário e bloqueios conferidos; carteira sem conta/snapshot/posição; RPC e 26 tabelas sensíveis negadas à chave publicável sem sessão. |

As capturas anteriores ficam em `.impeccable/review/`; as capturas da etapa sem banco estão em `output/playwright/overview-desktop.png`, `market-desktop.png` e `market-mobile.png`. Os registros do navegador ficam em `.playwright-cli/`. Esses artefatos são ignorados pelo Git. Servidor local não substitui implantação cloud.

## Configuração remota verificada

- Projeto **ATLAS**, referência `bxikkprpvfirjlmnxqhh`, criado na organização **BrenoSilveiraLeal's**, região `sa-east-1`, Supabase Free com custo informado de US$ 0/mês. Nenhum banco de outro produto foi reutilizado ou alterado.
- Seis migrations aplicadas, incluindo `atlas_portfolio_history` e `atlas_agent_configuration`. As **33 tabelas públicas têm RLS habilitado**; `system_state` está vinculado ao único usuário proprietário.
- Histórico de migrations alinhado pelo CLI com as seis versões locais, removendo apenas os carimbos duplicados do conector, sem reaplicar DDL nem remover dados.
- `.env.local` configurado com URL, chaves modernas, proprietário e segredo cron. Chaves usadas somente no servidor, sem inclusão no Git.
- Supabase Auth com cadastros e login anônimo desativados, JWT de 900 segundos, senha mínima de 14 caracteres e TOTP disponível. O usuário ainda precisa definir a senha e verificar seu autenticador.
- Bootstrap administrativo gerou `.supabase/atlas-owner-setup.html` com link temporário pessoal, sem envio de e-mail. O fluxo inicial recusa outro proprietário e não pode ser repetido depois de MFA verificado.
- O Security Advisor remoto apresentou apenas proteção contra senhas vazadas desativada. O recurso exige Pro ou superior; o projeto permaneceu Free. [Documentação oficial](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Essas verificações comprovam provisionamento e configuração. Não substituem login com AAL2 real, testes de concorrência no gateway ou validação do scheduler remoto.

## Cobertura

- `tests/core.test.ts`: precisão decimal; limites/identidade do risco; MFA; token/conexão indisponíveis; quote stale/futura; mercado fechado; quantidade/lote/tick inválidos; saldo insuficiente; short/alavancagem/instrumentos proibidos; circuit breaker; corporate action não verificada; ciclo OMS; timeout sem reenvio; rejeição, fills parciais/duplicados e reconciliação divergente.
- `tests/providers.test.ts`: respostas reais documentadas validadas com fixtures de teste; timestamps; HTTP 401/429/5xx; timeout/backoff; payload inválido; OHLCV; notícia duplicada; conteúdo externo tratado como dado; smoke público separado.
- `tests/database.test.ts`: aplicação das migrations completas, RLS de owner+AAL2, privilégios, ledger balanceado/imutável, precisão, idempotência, duplicata de confirmação, overspend/rollback, PIX não confirmado, jobs/leases/fencing, parada global, rate limit, análise atômica e evidências inconsistentes rejeitadas.
- `tests/research.test.ts`: SMA/EMA/RSI/ATR, execução na próxima abertura, custos, holdings/corporate actions, dados futuros, disponibilidade temporal, partições/holdout e walk-forward.
- `tests/security.test.ts`: proprietário, sessão inválida, MFA, CSRF/origin, segredo cron, JSON e limite de corpo, perfil de risco incompleto.
- `tests/fundamentals.test.ts`: identidade, revisão, período e escopo CVM; moeda/escala/precisão; rubricas ausentes ou ambíguas; divisão por zero; restrição point-in-time; CSV real com aspas; CRC, nomes, descompressão e tamanhos de arquivo; smoke oficial separado.
- `tests/health.test.ts`, `tests/data-cache.test.ts` e `tests/cache-database.test.ts`: expiração/futuro/invalidade da evidência; atualização de cache após TTL; retenção restrita por proprietário, papel, idade e lote; preservação de histórico e auditoria.
- `tests/accounting-view.test.ts` e `tests/format.test.ts`: apresentação do snapshot conciliado com horário original, ausência de total quando há divergência, campos desconhecidos preservados e centavos mantidos além da precisão de `Number`.
- `tests/portfolio.test.ts` e `tests/portfolio-database.test.ts`: isolamento de contas/proprietário, snapshots conciliados, identidade das posições, precisão decimal, truncamento e gráficos sem preencher períodos ausentes.
- `tests/agent-config.test.ts` e `tests/scheduler-configuration.test.ts`: revisões imutáveis, perfis completos, configuração somente com agente pausado e sem lease ativo, vínculos de proprietário e evidências de configuração preservadas na análise.
- `tests/atlas-api-integration.test.ts`: autenticação AAL2, leitura por sessão RLS, limites de alteração e encaminhamento dos contratos de carteira/estratégias para as RPCs.
- `tests/owner-setup.test.ts` e `tests/owner-bootstrap.test.ts`: validação de origem/corpo/senha, token de recuperação, identidade e MFA, saída da sessão de setup e preservação segura da configuração administrativa.

## Limites da evidência

PGlite executa PostgreSQL real em WASM, mas a instância de testes serializa operações. Não certifica contenção entre conexões remotas, PostgREST/Supabase Auth gerenciado, JWT real, TOTP real, Cron/Edge em nuvem, backup/restore ou RLS sob o gateway de produção. As funções Auth são bindings de teste e não um Auth simulado de produção.

O browser foi verificado **sem sessão do proprietário**. O banco dedicado agora existe, mas cadastro autenticado, gráficos com sessão AAL2 e operação com computador desligado ainda precisam de verificação após senha/TOTP e implantação. Testar dados públicos com ticker de fixture não escolhe o universo de investimentos do usuário.

Os indicadores não foram validados como estratégia economicamente lucrativa. Research exige disponibilidade point-in-time, custos e corporate actions explícitos; o histórico comum da brapi não satisfaz automaticamente todas essas condições.

O teste CVM cobre uma companhia/ano/escopo reais. As datas de referência e recebimento não foram tratadas como horário de publicação. O relatório permanece inelegível para backtest point-in-time e execução; ITR e outros layouts/rubricas continuam pendentes. Falhas TLS iniciais foram superadas e o teste passou após corrigir diferenças encontradas no CSV real.

## Correções obtidas por revisão

Correção de acesso em 15/09/2026: o provedor de e-mail estava desativado (`email_provider_disabled`). `auth.email.enable_signup` foi corrigido para `true`, preservando `auth.enable_signup=false` para manter os cadastros públicos fechados. A alteração remota foi isolada, sem substituir redirects ou outras configurações existentes. A senha solicitada pelo proprietário foi aplicada pela API administrativa, sem inclusão em arquivos. Login direto e POST `/api/auth` passaram; o aplicativo retornou HTTP 200 com próximo passo `enroll`, leitura privada permaneceu HTTP 403 sem TOTP e a sessão de verificação foi encerrada. TOTP ainda exige cadastro pelo proprietário.

Renovação de cookie encaminha o novo header ao SSR; duração do cookie aplicada após o SDK para impedir persistência involuntária de 400 dias; parada global separada do limite normal; rate limit MFA só após autenticar proprietário; cache compartilhado e orçamento conservador dos providers; lock order dos jobs alinhada; retry de análise com payload diferente rejeitado; writes financeiros fora de RPC negados.

Nesta continuação, o cache passou a atualizar sua chave única após expiração; a limpeza é limitada a registros de leitura com mais de sete dias e preserva evidências. A saúde vencida é normalizada como desconhecida e mantém o valor original para auditoria. Totais financeiros usam o snapshot conciliado em strings decimais, com data explícita e sem transformar ausência em zero.

O histórico patrimonial passou a usar uma conta por resposta, com posições e snapshots validados. A interface impede que métricas de uma conta apareçam junto do gráfico de outra durante carregamento. Estratégias, perfis e intervalos podem ser vinculados a agentes pausados; o scheduler preserva os parâmetros da revisão utilizada.

O navegador revelou erro 500 nas rotas dinâmicas: o servidor consumia uma lista exportada por um módulo `use client` como se fosse um array local. A validação de seções foi movida para o módulo de servidor. Novo build e repetição das requisições a todas as seções confirmaram a correção. A evidência do build isolado não havia detectado essa falha de runtime.

## Ações externas ainda necessárias

O proprietário precisa definir sua senha e cadastrar/verificar TOTP pelo acesso inicial preparado. Ele escolheu manter aplicação e scheduler locais com Supabase Free; implantação e scheduler remoto foram adiados. O proprietário informou não possuir corretora nem API oficial; ainda são necessários acesso/contrato, feed e sessão elegíveis, integração/homologação de execução e confirmação independente de transferências. O projeto Supabase, o usuário e os segredos locais já estão configurados.

A primeira execução do runner dentro do ambiente restrito não alcançou o Supabase (503). A mesma verificação por leitura passou com rede habilitada e o runner foi reiniciado nesse ambiente, recebendo `OK`. A revisão automática do Codex também bloqueou temporariamente uma chamada ao navegador por limite de uso; após a retomada, a verificação visual acima foi concluída.

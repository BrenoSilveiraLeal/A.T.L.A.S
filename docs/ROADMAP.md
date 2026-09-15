# ATLAS — Roadmap verificável

Baseline: 2026-09-13. Este documento começa com implementação `PENDING`. Atualizar o status somente quando houver evidência concreta; plano, contrato, teste isolado ou interface não significam operação real. A [matriz dos 37 requisitos](REQUIREMENTS.md) é o contrato completo; [FEASIBILITY.md](FEASIBILITY.md) reúne descoberta e blockers.

Estados: `PENDING` = não entregue ou sem validação necessária; `IN_PROGRESS` = trabalho parcial descrito; `DONE` = todos os critérios da linha comprovados. `VERIFIED_LOCAL` identifica somente evidência local, sem certificação de produção. Quando houver bloqueio externo, citar o blocker B01–B08; isso não impede avançar nas demais linhas.

## Fases e critérios de conclusão

| Fase | Entrega exigida | Critério de saída / evidência | Conclusão integral |
| --- | --- | --- | --- |
| 0 · Feasibility | Matriz, broker discovery, dados/notícias, PIX, custos/licenças, cloud, arquitetura e roadmap. | Docs com URLs oficiais, data da consulta, fatos separados de inferências, campos desconhecidos explícitos; alternativa e bloqueio de execução declarados. | DONE — pesquisa documentada; acesso à corretora e contratação continuam bloqueados. |
| 1 · Foundation | Projeto Next.js/TypeScript, Supabase/migrations, Auth, TOTP, proteção single-user, design system, CI e README inicial. | Instalação reproduzível; lint/typecheck/test/build passam; schema aplicado/testado; acesso anônimo/não proprietário negado; sessão AAL2 verificada. | PENDING — B07 para serviços externos. |
| 2 · Data | Market data, histórico, notícias, fundamentos, macro, calendário e corporate actions. | Conectores documentados consumindo dados reais; timestamps/freshness e licença explícitos; amostra armazenada consultável; fonte indisponível não vira dado simulado. | PENDING — B03, B04, B06 conforme provider. |
| 3 · Agents | Cadastro configurável, estados, propostas, estratégias versionadas, memória, supervisor e scheduler. | Job persistido gera decisão estruturada rastreável com dados reais; execução repetida/concurrente não duplica efeito; nenhuma chamada direta ao broker. | PENDING — B07 para runtime cloud. |
| 4 · Research | Indicadores e estratégias testáveis, backtest, períodos separados, walk-forward e métricas com custos. | Resultado reproduzível e dataset point-in-time documentado; controles de leakage/look-ahead/survivorship; estratégia compatível com atraso dos dados. | PENDING — B03 para histórico adequado. |
| 5 · Risk | Limites completos, validação de proposta/carteira, circuit breakers e kill switch persistidos. | Todos os limites testados; stale/closed/mismatch/insufficient balance bloqueiam; reservas de agentes concorrentes entram no cálculo; kill switch cancela quando possível e não liquida sozinho. | PENDING |
| 6 · Broker | Provider real, autenticação, capabilities, conta, caixa, posições, ordens e reconciliação. | Documentação oficial PF/B3/cloud/automação e autorização efetiva; consultas reais com IDs/redaction; sandbox oficial se existir; nenhum adapter fictício. | PENDING — B01, B02. |
| 7 · Execution | OMS, lifecycle, idempotência, reserva, retries seguros, partial fills, alteração/cancelamento. | Rejeição/timeout/duplicação/crash/cancelamento comprovados com contrato real; incerteza de envio nunca produz reenvio cego; evidência externa auditável. | PENDING — B01, B02, B08. |
| 8 · Treasury | Ledger balanceado, alocações, reservas, depósitos, retiradas e confirmação independente. | RPCs e concorrência verificadas em Postgres; soma dos saldos reconciliada; QR/instrução não credita caixa; funding automatizado apenas se oficial. | PENDING — B02, B05, B07. |
| 9 · Visual Office | Identidade ATLAS, trading floor, personagens, reuniões, dashboard, agent detail, gráficos, tooltips e rotas restantes. | Cada estado/valor corresponde a registro real ou ausência explícita; responsividade, teclado, contraste e movimento reduzido verificados; sem animação simulando operação inexistente. | PENDING |
| 10 · Hardening | Segurança, observabilidade, falhas, reconciliação robusta e trilha de auditoria completa. | Casos mínimos de R31 passam; testes de autorização e privilégios, falhas injetadas e recuperação documentados; health expira; logs sem secrets. | PENDING |
| 11 · Deploy | Supabase, Vercel, secrets, scheduler central, monitoramento e runbook. | Serviços reais acessíveis; migrations e cron habilitados; job executa com computador desligado; previews isolados e live permanece bloqueado durante setup. | PENDING — B07. |
| 12 · Live readiness | Evidências completas, limites do proprietário, TOTP, reconciliação, provedor/dados válidos e ativação explícita. | Todos os gates abaixo aprovados; fluxo R37 verificado com broker real; ordens de validação somente após autorização específica apropriada e controles aprovados. | PENDING — B01–B08 aplicáveis. |

Nenhuma fase de implementação foi marcada `DONE`: os critérios incluem validação integrada e serviços externos. O término da fase 0 permite desenvolver componentes independentes mesmo se o broker permanecer bloqueado. Não exige fingir que real trading gratuito foi provado. Contabilidade e idempotência começam cedo como dependências dos módulos posteriores, ainda que Treasury tenha a fase 8 de entrega completa.

## Implementação local já disponível

| Fase | Evidência local | Trabalho ainda PENDING |
| --- | --- | --- |
| 1 · Foundation | Next.js/TypeScript, Auth BFF com owner/AAL2/TOTP, migrations/RLS, CI e guia de setup implementados; lint, tipagem, testes e build verificados. | Auth/TOTP com projeto dedicado, JWT real e gateway gerenciado. |
| 2 · Data | brapi (cotação, histórico, busca), BCB Selic e notícias IBGE; validação, origem, freshness e cache persistido. CVM DFP anual: conector e consulta implementados, verificação de rede separada. | Feed oficial para execução, sessão B3 efetiva, corporate actions, ITR e fundamentos completos. |
| 3 · Agents | Cadastro/ativação, lease com fencing, análise SMA de observação, decisão HOLD, memória e auditoria atômicas. Smoke com dados reais passou. | Estratégias configuráveis completas, propostas BUY/SELL integradas, supervisor/reuniões e runtime cloud. |
| 4 · Research | SMA/EMA/RSI/ATR, backtest com custos, execução na próxima abertura e partições walk-forward testados. | Dataset point-in-time e universo sem survivorship bias, validação econômica e aprovação de estratégia. |
| 5 · Risk | Motor determinístico e kill switch persistente; limites, identidade e condições de bloqueio testados. | Reserva atômica integrada à execução, cancelamento confirmado pelo broker, circuit breaker operacional completo. |
| 7 · Execution | Contrato BrokerProvider e biblioteca OMS: transições, fills parciais, idempotência e timeout incerto testados. | Serviço durável de execução/reconciliação e adapter oficial autorizado. |
| 8 · Treasury | Ledger balanceado e imutável, RPCs e snapshot financeiro em strings decimais testados no PostgreSQL local. | Funding confirmado, alocações/retiradas integradas, concorrência em banco remoto e reconciliação real. |
| 9 · Visual Office | Rotas, cadastro, risco, consulta OHLCV/notícias/CVM, totais ligados ao snapshot contábil, estados vazios e escritório baseado nos registros. Desktop/mobile inspecionados. | Gráficos de carteira ligados à reconciliação, personagens e reuniões completas, teste autenticado. |
| 10 · Hardening | Testes de segurança/autorização, redaction, rate limits, recuperação por leases, expiração de saúde e retenção limitada do cache. | Contenção remota, recuperação de desastre, backup/restore e incidentes de produção. |
| 11 · Deploy | Edge Function e SQL de cron/Vault preparados, sem segredos. | Projeto dedicado, publicação, scheduler remoto e operação com computador desligado. |

As fases com implementação local estão **IN_PROGRESS**; as pendências da tabela principal continuam sendo critérios de saída, não ausência total de código. Consulte [VALIDATION.md](VALIDATION.md) para resultados e limites.

## Próximas entregas que independem de contas externas

1. Finalizar investigação e fontes da fase 0 antes do código; registrar ausência de acesso comprovado a API de execução PF sem afirmar inexistência universal.
2. Criar projeto local com configuração segura e `.env.example` sem valores reais; autenticação, infraestrutura e dados não configurados aparecem como tal.
3. Implementar contratos e invariantes testáveis de decimal, data freshness, sessão, propostas, limites, transições OMS, idempotência e ledger. Fixtures ficam exclusivamente nos testes.
4. Escrever migrations revisáveis com constraints/RLS/RPCs; aplicar/verificar localmente somente se houver banco/Docker disponível e registrar se essa validação ficar pendente.
5. Implementar conectores reais de leitura cujos endpoints/termos foram comprovados; não utilizar amostra de demonstração do fornecedor como se fosse feed operacional.
6. Criar UI operacional para estado de configuração, mercado e risco a partir dos registros reais disponíveis; evoluir visual Office conforme eventos de backend existirem.
7. Executar lint, typecheck, testes e build; documentar comandos/resultados e falhas de ambiente. Preparar deploy/integrações até o ponto em que uma ação exclusiva do proprietário seja necessária.

## Bloqueios que não devem interromper trabalho independente

| Bloqueio | Prova necessária para remover | Consequência enquanto pendente |
| --- | --- | --- |
| B01/B02 · execução oficial | Docs e termos aplicáveis, PF/B3/cloud habilitados, credencial/consentimento e confirmação de capabilities. | Sem provider concreto disponível e sem envio de ordens; todos os componentes independentes podem avançar. |
| B03/B04 · dados e sessão elegíveis | Atraso/licença/timestamps, cotas e calendário/sessão/ativo verificados para a frequência escolhida. | Somente análise compatível com os dados; nenhuma declaração de real-time ou intraday sem prova. |
| B05 · PIX/transferência | Provider documentado, consentimento e confirmação independente do movimento. | Instrução/solicitação manual visível; nenhum sucesso ou crédito fictício. |
| B06 · uso de notícias | Termos permitem ingestão/armazenamento pretendidos e origem é identificável. | Ingerir somente fontes permitidas; nenhum artigo gerado ou scraping indiscriminado. |
| B07 · cloud/Auth | Projetos conectados, variáveis seguras, owner definido, TOTP verificado, migrations e cron instalados. | Artefatos locais e setup revisável; não declarar que funciona com computador desligado. |
| B08 · integração/readiness | Logs redigidos dos testes reais de conta/ordens/reconciliação e critérios técnicos aprovados. | `LIVE_TRADING_ENABLED=false`; interface mostra o gate ausente. |

Somente pedir ao proprietário a ação concreta que faltar: conta/login, autorização OAuth, geração de credencial, aceite de termos, autorização da corretora ou pagamento. Antes disso, concluir código/configuração/documentação revisável que independe da ação. Não pedir escolha rotineira de biblioteca.

## Gate de live

- [ ] Broker oficial comprovado para a conta PF, instrumentos B3, automação e execução cloud.
- [ ] Credenciais server-side, autenticação real, capabilities e health validados.
- [ ] Proprietário único, Auth e TOTP configurados; ativação exige sessão AAL2.
- [ ] Todos os parâmetros R06 definidos e válidos; sem alavancagem/short/derivativos/margem.
- [ ] Feed e estratégia compatíveis em licença, atraso, frequência, histórico e orçamento.
- [ ] Calendário oficial, sessão atual e status do instrumento confiáveis; unknown bloqueia.
- [ ] Conta/caixa/posições/ordens reconciliados; divergência ativa bloqueia.
- [ ] Reservas, ledger e eventos externos idempotentes validados em PostgreSQL real.
- [ ] Testes duplicate order, partial fill, rejection, timeout, cancel, market closed, stale, quantidade, saldo, limites, token, conexão, cron, concorrência, mismatch, news e corporate actions aprovados.
- [ ] Kill switch persistente testado; cancelamento possível e falhas claramente expostos; não liquida automaticamente.
- [ ] Scheduler cloud, limites de duração, recuperação de crash e deploy verificados.
- [ ] CI com lint/typecheck/tests/build; autorização/RLS/CSRF/redaction verificados.
- [ ] Auditoria reconstrói todas as etapas, incluindo fees desconhecidas claramente identificadas.
- [ ] Configuração de live alterada por fluxo autorizado após aprovação técnica; revalidação por submissão.
- [ ] R37 comprovado com confirmação/fill reais, reconciliação, ledger, dashboard e audit log, sem exigir que uma ordem limite seja preenchida para forçar sucesso.

Antes da autorização e execução real, readiness técnica pode ser documentada como parcial; o produto completo continua `PENDING` no requisito R37. Não comprar/vender para gerar uma demonstração de conclusão.

## Cadeia de aceitação R37

| Etapa | Evidência mínima | Status inicial |
| --- | --- | --- |
| REAL DATA | Provider, instrumento, valor e horários verdadeiros armazenados. | VERIFIED_LOCAL — smoke público, banco temporário; persistência remota PENDING. |
| AGENT ANALYSIS | Snapshot/indicadores/versão e justificativa resumida persistidos. | VERIFIED_LOCAL — HOLD com memória/auditoria atômicas; proposta operacional PENDING. |
| TRADE PROPOSAL | Proposta validada e correlation ID. | PENDING |
| RISK CHECK | Resultado determinístico, limites e reserva atômica. | PENDING |
| BROKER ORDER | ID interno/client ID e solicitação real autorizada. | PENDING |
| BROKER CONFIRMATION | Broker order ID e resposta/consulta oficial. | PENDING |
| EXECUTION / FILL | Execution ID, quantidade/preço reais e taxas conhecidas/pendentes. | PENDING |
| PORTFOLIO RECONCILIATION | Conta/posições/caixa conferidos com timestamp e divergências tratadas. | PENDING |
| LEDGER | Partidas balanceadas, imutáveis e idempotentes ligadas ao fill. | PENDING |
| DASHBOARD | Projeção fiel do registro reconciliado, sem números inventados. | PENDING |
| AUDIT LOG | Consulta reproduz a cadeia e as fontes sem expor secrets. | PENDING |

## Registro de validação

| Data | Escopo | Comando/evidência | Resultado |
| --- | --- | --- | --- |
| 2026-09-13 | Planejamento inicial | Leitura integral do pedido; matriz de 37 itens; arquitetura e gates documentados. | Documentação criada; não é validação de código ou serviços. |

Acrescentar resultados executados e limitações reais. Não preencher a tabela com testes planejados como se tivessem passado.

### Registro executado em 14/09/2026

Lint, typecheck e build passaram. Suíte anterior a esta continuação: 163 testes locais passaram; dois smokes de rede são opt-in. Smoke adicional com dados públicos reais confirmou análise → decisão/memória/auditoria atômicas, sem ordem. Detalhes e limites em [VALIDATION.md](VALIDATION.md).

### Registro executado em 15/09/2026

Suíte ampliada: **234 testes passaram, três smokes opt-in ignorados**. O smoke adicional da CVM passou com ZIP oficial anual e rubrica de receita rastreável. Cache com atualização/retenção, expiração de saúde e apresentação contábil receberam testes. Build e lint passaram; navegador confirmou as 12 seções, login, rota inválida e navegação mobile depois da correção de fronteira servidor/cliente. Detalhes em [VALIDATION.md](VALIDATION.md) e [CVM_FUNDAMENTALS.md](CVM_FUNDAMENTALS.md).

Conexões externas continuam pendentes: a organização Supabase consultada permanece Free, com dois projetos ativos de outro produto. Nenhum projeto foi reutilizado ou alterado. Configuração de um projeto dedicado, proprietário/TOTP, publicação e acesso autorizado à corretora são necessários para avançar na validação remota e em R37.

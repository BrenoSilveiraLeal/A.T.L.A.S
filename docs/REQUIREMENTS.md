# ATLAS — Matriz de requisitos

Baseline do pedido do proprietário: 37 tópicos. Data da análise: 2026-09-13.

Esta matriz é o contrato de aceitação, não uma declaração de funcionalidades entregues. `PENDING` significa que falta implementação ou evidência de validação suficiente. Um contrato TypeScript, tela, teste com fixture ou migration isoladamente não comprova integração real. O [roadmap](ROADMAP.md) registra o progresso por fase; a [viabilidade](FEASIBILITY.md) registra as fontes externas.

## Rastreabilidade integral

| ID / tópico original | Requisito e critério verificável de aceitação | Domínio / fase | Status inicial |
| --- | --- | --- | --- |
| R01 · Visão do produto | Criar/editar/desativar agente com ativo configurável, nome, avatar, orçamento, estratégia e limites; todos os estados operacionais têm representação visual; insolvência pausa/aposenta sem aumentar risco. Nenhum ativo de exemplo vira dependência fixa. | Agentes, Office / 3, 9 | PENDING |
| R02 · Carteiras | Conta real única e subcarteiras virtuais; transferências internas não criam caixa; movimentos auditáveis com todos os campos do pedido; saldos derivados de ledger e reconciliados com a corretora. | Treasury / 8 | PENDING |
| R03 · Multiagente | Módulos de mercado, notícias, fundamentos, técnica, macro, agentes, risco, execução, treasury e supervisor separados; agentes só produzem propostas; análise compartilhada por evento/ativo evita uma LLM por personagem. | Core / 2–8 | PENDING |
| R04 · Decisões | Validar schema com ticker, timestamps, ação, confiança, resumo, escores, quantidade, tipo/preço sugeridos, horizonte, invalidações, fontes e versão; preservar entradas; nunca expor raciocínio interno da LLM. | Decisões / 3 | PENDING |
| R05 · Probabilidade | Estratégias expressam hipóteses, custos, volatilidade, risco/retorno e invalidações; nenhuma saída promete identificar fundo/topo ou retorno futuro. | Research / 4 | PENDING |
| R06 · Risk Engine | Todos os limites listados abaixo são configurados antes de live; decisões determinísticas e auditadas; kill switch e circuit breakers impedem novas ordens; sem alavancagem, short, opções, futuros ou margem. | Risco / 5 | PENDING |
| R07 · Broker real | Matriz para XP, Rico, Clear, Genial, Toro, BTG, Inter e alternativas, com documentação oficial e permissões; somente provider comprovado é implementado; home broker automatizado e APIs privadas são proibidos. | Descoberta, broker / 0, 6 | PENDING |
| R08 · OMS | Lifecycle completo, LIMIT/STOP/STOP LIMIT conforme capabilities, chave idempotente, locks, partial fills e reconciliação; timeout ambíguo consulta corretora antes de qualquer novo envio; nunca reenvia às cegas. | OMS / 7 | PENDING |
| R09 · Sessão B3 | Calendário oficial versionado, fuso São Paulo, feriados, leilões, suspensão e circuit breaker; calendário desconhecido ou dado stale bloqueia ordem. | Mercado, risco / 2, 5 | PENDING |
| R10 · Dados reais | Providers com proveniência, licença, timestamps, atraso e limites; investigar brapi, CVM, BCB, IBGE e B3; UI distingue REAL-TIME, DELAYED, EOD e STALE; ausência de dados mostra indisponibilidade. | Data / 0, 2 | PENDING |
| R11 · Notícias | Ingestão → deduplicação/event clustering → entidades → ticker → relevância/sentimento/impacto → memória; URL/origem obrigatórias; republicações do mesmo evento não multiplicam evidência; maior peso a fontes primárias. | News / 2 | PENDING |
| R12 · Quantitativo | Research com train/validation/out-of-sample e walk-forward; dados point-in-time, custos e corporate actions; métricas auditáveis e controles contra leakage, survivorship, look-ahead, overfitting e cherry picking. | Research / 4 | PENDING |
| R13 · Live | Modo final é real; ativação exige broker, limites, sessão do proprietário com TOTP/AAL2, reconciliação e dados válidos, além de testes obrigatórios; `LIVE_TRADING_ENABLED=false` até aprovação técnica. | Live readiness / 12 | PENDING |
| R14 · Treasury e PIX | Mostrar saldos confirmados, alocação, reserva, P&L e movimentos; instrução/QR não confirma dinheiro; só credita depósito por evidência independente; retirada só com provider oficial e confirmação; chave PIX somente em secret. | Treasury / 8 | PENDING |
| R15 · Frontend | Aplicação Next.js/React/TypeScript responsiva com rotas de office, agentes, carteira, mercado, notícias, ordens, treasury, risco, auditoria e ajustes; estados vazios/erro/loading verdadeiros. | App / 1, 9 | PENDING |
| R16 · Office | Trading floor renderiza o estado persistido do backend; transições não inventam análises/ordens; personagens têm alternativa acessível e respeitam movimento reduzido. | Office / 9 | PENDING |
| R17 · Reuniões | Supervisor agrupa evento relevante, agentes afetados e análises existentes; persiste resumo, ativos, mudanças de risco propostas e ações; nenhuma reunião contorna o Risk Engine. | Supervisor, Office / 3, 9 | PENDING |
| R18 · Detalhe agente | Posição, média, caixa, P&L, drawdown, candles/volume/indicadores e marcadores reais; timeline liga proposta, aprovação, ordem e execução; notícias e métricas com proveniência. | App / 3, 9 | PENDING |
| R19 · Dashboard | Equity, P&L total/diário, caixa, investimento, posições, ordens, agentes, exposição, risco e mercado vêm de registros reais; best/worst somente com observações suficientes; não usar zero para dado desconhecido. | App / 9 | PENDING |
| R20 · Linguagem leiga | Termos financeiros importantes têm explicação curta e acessível; tooltips funcionam com teclado/foco e toque, sem depender exclusivamente de hover. | UX / 1, 9 | PENDING |
| R21 · Segurança | Single-user com autorização explícita por owner ID; Supabase Auth, TOTP, cookies seguros, proteção CSRF aplicável, expiração, rate limit e auditoria; segredos exclusivamente server-side; `.env.example` vazio. | Auth / 1, 10 | PENDING |
| R22 · Database | PostgreSQL com migrations, FKs, checks, unicidade, RLS, índices e RPCs atômicas; entidades do pedido cobertas; dinheiro em numeric/decimal, nunca float; migration aplicada e testada antes de concluir. | Persistence / 1, 8 | PENDING |
| R23 · Infraestrutura | Frontend Vercel, Postgres/Auth Supabase e scheduler cloud central; computador desligado não interrompe execução; jobs curtos e persistidos; nenhum loop infinito ou cron por personagem. | Cloud / 3, 11 | PENDING |
| R24 · Frequência | Frequência por estratégia (1/5/15/60 min ou evento) depende de licença, atraso, orçamento e capacidade medidos; dados insuficientes tornam estratégia inelegível. | Scheduler / 2, 3 | PENDING |
| R25 · Resiliência | Cada falha listada no plano abaixo tem ação específica e evidência; recuperação após deploy/crash preserva idempotência; incerteza crítica bloqueia novas ordens. | Runtime / 5–10 | PENDING |
| R26 · Observabilidade | Health de market data, broker, DB, scheduler, news, AI e execução com GREEN/YELLOW/RED e horários; logs estruturados redigidos, correlation ID e alerta crítico persistido. | Ops / 10 | PENDING |
| R27 · Auditoria | Consultar uma operação reconstrói agente/estratégia/versão, dados e horários, notícias, indicadores, proposta, risco, ordem, fill, preço e taxas pelo mesmo correlation ID. | Audit / 3–10 | PENDING |
| R28 · IA sem autoridade final | Nenhum texto/JSON de LLM invoca broker; input externo é dado não confiável; accounting, risco e order validation determinísticos; schema inválido não gera ordem. | Core / 3, 5, 7 | PENDING |
| R29 · Custos | `COST.md` identifica serviço, uso, free tier, limites, consequência de exceder, alternativa e fonte/data; custo desconhecido aparece como desconhecido; nenhum serviço pago contratado implicitamente. | Discovery / 0 | PENDING |
| R30 · Fases | Fases 0–12 registradas com dependências, evidências e pendências; viabilidade documentada antes do código; fase não é concluída só porque houve implementação parcial. | Delivery / 0–12 | PENDING |
| R31 · Testes | Casos mínimos abaixo implementados; sandbox oficial quando disponível; fixtures somente em testes; resultados locais não são apresentados como execução real. | QA / 1–12 | PENDING |
| R32 · README | Guia iniciante do produto ao deploy, programas, clone, instalação, Supabase, Vercel, env, execução, broker, agente e ativação; distingue passos executados de passos que dependem do proprietário. | Docs / 1, 11 | PENDING |
| R33 · GitHub | Código organizado, commits pequenos quando possível, nenhum secret; CI executa lint, typecheck, testes e build; registrar resultados reais e bloqueios de ambiente. | DevEx / 1, 10 | PENDING |
| R34 · Design ATLAS | Identidade própria premium, institucional, escura e futurista, logo provisório; visual financeiro legível, sem estética de cassino; animações não prejudicam compreensão/performance. | Design / 1, 9 | PENDING |
| R35 · Princípio | Plataforma integra dados + research + inteligência + estratégias + risco + accounting + execução + auditoria; personagem apenas apresenta um agente e não detém privilégios financeiros. | Arquitetura / todas | PENDING |
| R36 · Primeira ação | Pedido lido, matriz criada, fontes atuais investigadas, blockers registrados e FEASIBILITY/ARCHITECTURE/ROADMAP escritos antes da aplicação; avançar autonomamente em trabalho não bloqueado. | Discovery / 0 | PENDING |
| R37 · Qualidade final | Fluxo real completo dados → análise → proposta → risco → broker → confirmação → fill → reconciliação → ledger → dashboard → auditoria, comprovado com IDs reais e secrets redigidos; qualquer ausência permanece PENDING. | Acceptance / 12 | PENDING |

## Critérios financeiros detalhados

- **Ledger:** partidas balanceadas por transação; entradas imutáveis com estorno, não edição; idempotência de depósito/fill/evento; reserva de caixa para ordem ativa; liberação só após cancelamento/rejeição confirmados; conciliação considera liquidação, taxas, proventos e saldo indisponível. Soma de subcarteiras e reserva não ultrapassa patrimônio elegível reconciliado. Saldo desconhecido nunca equivale a saldo zero.
- **Campos de auditoria:** `timestamp`, `agentId`, `ticker`, operação, quantidade, preço solicitado/executado, taxas, slippage, saldo anterior/posterior, `orderId`, `brokerOrderId`, origem, motivo, estratégia e versão. Valores ainda desconhecidos usam `null` com estado explícito, não preço/taxa inventados.
- **Risk profile obrigatório:** `maxPositionPerAgent`, `maxPortfolioExposure`, `maxOrderValue`, `maxDailyLoss`, `maxWeeklyLoss`, `maxDrawdown`, `minCashReserve`, `maxOpenPositions`, `maxSectorExposure`, `maxCorrelatedExposure`, `maxOrdersPerMinute`, `maxOrdersPerDay`, `maxSlippage`, `newsEmergencyThreshold`. Configuração ausente/inválida, classificação setorial desconhecida ou correlação indisponível quando necessária bloqueiam a proposta.
- **Risco de carteira:** considerar posições e todas as reservas de ordens pendentes, inclusive outros agentes; revalidar no momento de reservar/submeter; SELL somente da quantidade livre realmente detida, sem short; mudanças de limite invalidam aprovações antigas.
- **Kill switch:** estado persistente e auditado; impede novas submissões, tenta cancelar ordens abertas, apresenta falhas/ordens ambíguas e preserva posições. Não inicia liquidação total sem confirmação explícita do proprietário. Cancelamento pode ser permitido com dados stale para reduzir risco.
- **OMS:** `CREATED`, `RISK_REVIEW`, `APPROVED`, `SUBMITTING`, `SUBMITTED`, `PARTIALLY_FILLED`, `FILLED`, `CANCEL_REQUESTED`, `CANCELLED`, `REJECTED`, `EXPIRED`, `ERROR`. A incerteza pós-timeout é um atributo persistente que exige reconciliação; `ERROR` não afirma ausência de ordem na corretora. Uma ordem pode ser preenchida enquanto cancelamento está em andamento.
- **Dados:** guardar hora do evento no provedor, captura local, fuso, fonte, moeda, tipo de preço, atraso contratado e licença; nunca validar freshness apenas com `retrievedAt`. Dado futuro, fora de sessão, incoerente ou sem timestamp utilizável bloqueia negociação.
- **Agente:** cadastro inclui identidade, ativo/empresa, orçamento, caixa, posição, preço médio, P&L realizado/não realizado, drawdown, estado, estratégia/versão, risco, memória, decisões, operações, notícias e datas de análise. Valores financeiros vêm de projeções do ledger/reconciliação, não de campos livremente editáveis.
- **Notícia:** `source`, `url`, `publishedAt`, `retrievedAt`, `companies`, `tickers`, `category`, `relevance`, `sentiment`, `confidence`, `expectedImpact`, `impactHorizon`, chave de evento e versão de análise. Classificação cobre empresa/setor, macro, juros/inflação/câmbio/commodities, política/regulação/conflito/sanções/desastres, greve/acidente/operação e eventos societários/financeiros.
- **Research:** SMA, EMA, RSI, MACD, ATR, bandas, VWAP, volume, volatilidade, suporte/resistência, tendência e momentum entram por plugins determinísticos apenas quando implementados e validados. Fundamentos incluem receita, EBITDA, lucro, dívida, caixa, margens, ROE, múltiplos, fluxo de caixa, dividendos e variações trimestrais com período e publicação. Macro contempla Selic/expectativas, IPCA, câmbio, emprego, PIB e fontes internacionais relevantes sem assumir disponibilidade de tudo em uma API.

## Matriz mínima de testes e comportamento de falha

| Caso | Evidência necessária / comportamento esperado | Gate |
| --- | --- | --- |
| Ordem duplicada / requisição duplicada | Mesmo pedido idempotente retorna o mesmo ID; provider é chamado no máximo uma vez antes de reconciliação conclusiva. | Live |
| Partial fills | Eventos cumulativos/duplicados/fora de ordem não duplicam caixa/posição; remainder reservado; taxas e média corretas. | Live |
| Rejeição | Registrar motivo do broker; liberar reserva uma vez; não inventar fill. | Live |
| Timeout do broker | Estado ambíguo persistido; consulta por client order ID/ordens/execuções; bloquear reenvio sem prova conclusiva. | Live |
| Mercado fechado / feriado / leilão / ativo suspenso | Sem submissão incompatível; calendário desconhecido bloqueia; UTC e São Paulo testados. | Live |
| Cotação stale / incoerente | Bloqueio determinístico com motivo; captura recente não disfarça timestamp antigo do preço. | Live |
| Quantidade inválida | Zero, negativa, fracionária incompatível ou fora do lote/tick são rejeitados. | Live |
| Saldo insuficiente / limite de risco | Reservas concorrentes de todos os agentes entram no cálculo; transação atômica impede overspend. | Live |
| Token expirado / falha de autenticação | Sem envio; circuit breaker e fluxo oficial de renovação/reautorização. | Live |
| Conexão perdida / DB indisponível | Fail closed; nenhuma chamada de escrita ao broker sem intenção durável e reserva confirmada. | Live |
| Cron duplicado / agentes concorrentes | Claim transacional/lease e unicidade de job; trabalho sem efeitos financeiros duplicados. | Live |
| Deploy durante operação / crash do worker | Retomar por estado durável; leases expirados não autorizam reenvio de ordem incerta. | Live |
| Divergência de reconciliação | Bloquear novas ordens, registrar discrepância e reconciliar usando evidência do broker; sem ajuste silencioso. | Live |
| Notícias duplicadas / prompt injection | Mesmo evento conta uma vez; texto externo não altera policy, segredo, tools ou destino de rede. | Agents |
| Split / dividendos / mudança de ticker | Eventos versionados e idempotentes; ajustar quantidade/custo ou caixa somente após confirmação; preservar identidade/histórico. | Live |
| Kill switch / limite de perda | Persistir bloqueio, negar novas ordens, solicitar cancelamento possível e preservar exposição existente. | Live |
| Rate limit / várias falhas | Backoff com jitter e orçamento; pausar após limiar; retries de leitura separados de escrita. | Live |
| Reconciliação de depósito/retirada | Abrir QR/instrução/manual flag não credita caixa; duplicar confirmação não duplica ledger. | Treasury |
| RLS / owner / CSRF / AAL2 | Anônimo e usuário não proprietário não leem/escrevem dados; sessão AAL1 não habilita live; requisição cruzada não altera capital. | Live |

## Dependências externas

| ID | Dependência / condição de desbloqueio | Trabalho que pode continuar |
| --- | --- | --- |
| B01 | Broker oficial para PF, ações B3, automação em nuvem, permissões contratuais, docs de escrita e reconciliação; não basta uma API de market data. | Contratos, OMS determinístico, risco, ledger, testes isolados e descoberta. |
| B02 | Conta/autorizações/credenciais do proprietário no broker; sandbox se disponível. | Sem provider concreto até disponibilidade provada; não solicitar senha bancária. |
| B03 | Feed com licença, timestamps e atraso compatíveis com a estratégia; credencial quando exigida. | Conectores públicos documentados, cache, validação e research sobre dados adequados. |
| B04 | Calendário/sessão/suspensão/leilão com fonte oficial e cobertura operacional adequada. | Contrato de calendário e comportamento fail closed, importação versionada. |
| B05 | Provider oficial PIX/transferência e consentimento válido, ou confirmação independente de movimento externo. | Ledger e registro de solicitação `PENDING_CONFIRMATION`; instruções manuais honestas. |
| B06 | Licença e termos de ingestão/armazenamento de notícias e dados. | Fontes oficiais, URLs, metadados permitidos e deduplicação. |
| B07 | Projeto Supabase/Vercel, secrets, configuração de Auth/TOTP, deploy e scheduler efetivamente habilitados. | Código, documentação, migrations e verificações locais que o ambiente permitir. |
| B08 | Resultados documentados de testes de integração, reconciliação e readiness com serviços reais. | Nunca marcar sistema como live-ready enquanto faltar evidência. |

Os blockers encontrados e as fontes pertencem a [FEASIBILITY.md](FEASIBILITY.md). A presença desta lista não significa que todos exigem uma ação imediata do proprietário; concluir primeiro o trabalho independente.

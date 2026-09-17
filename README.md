# ATLAS

**Autonomous Trading & Learning Agent System** — plataforma pessoal de análise, agentes por ativo, controles de risco e auditoria para ações à vista B3.

**Estado: aplicação e scheduler locais conectados ao Supabase; execução real bloqueada.** O projeto ATLAS usa Supabase Free em São Paulo e proprietário único com senha/TOTP já configurados. Há fontes reais de leitura, agentes com revisões de estratégia e perfis de risco, histórico patrimonial por conta e decisões de observação **HOLD**. A integração agora tem ATLAS Executor desacoplado e gateway com o SDK Python oficial MT5; nenhuma corretora foi escolhida ou autenticada. A instalação permanece local e ainda depende do PC ligado. Não há PIX automático nem ordem real enviada.

Comece pela [decisão do Executor/gateway](docs/EXECUTION_GATEWAY_DECISION.md), [pesquisa de corretoras](docs/BROKER_RESEARCH.md), [custos](COST.md) e [roadmap](docs/ROADMAP.md). Os 37 tópicos do pedido estão na [matriz de requisitos](docs/REQUIREMENTS.md).

## 1. Como as partes se conectam

```mermaid
flowchart LR
  D[brapi / BCB / IBGE] --> C[Cache e validação de dados]
  C --> A[Análise determinística por agente]
  A --> P[Decisão HOLD e evidências]
  P --> DB[(PostgreSQL: memória e auditoria)]
  DB --> UI[Painel Next.js]
  L[Rotina local a cada minuto] --> J[Scheduler com leases]
  CR[Supabase Cron: futuro] --> E[Edge atlas-tick: futuro]
  E --> J[Scheduler com leases]
  J --> A
  F[Proposta de trade: integração futura] --> R[Risco central]
  R --> O[OMS e reserva]
  O --> Q[(Fila durável Supabase)]
  Q --> X[ATLAS Executor]
  X --> G[Gateway HTTP privado]
  G --> MT[Python MT5 + terminal]
  MT --> B[Corretora PF B3: homologação pendente]
```

Um agente é configuração + memória + jobs; não é um processo LLM permanente. O orçamento é um **limite proposto**, e não dinheiro criado. O ledger usa partidas balanceadas e PostgreSQL calcula valores `numeric`. Dinheiro cruza as interfaces financeiras como strings decimais. Nenhum token de broker, banco ou serviço é enviado ao navegador.

## 2. Programas necessários

- Node.js **22.16 ou mais recente**; a entrega foi verificada com Node 24.14.0.
- npm (incluído no Node) e Git.
- Editor de texto, por exemplo VS Code.
- Conta Supabase para Auth/banco e uma hospedagem Next.js para nuvem.
- Docker é opcional para uma instalação Supabase local completa. Os testes do banco já usam PostgreSQL WASM/PGlite, sem Docker.

No PowerShell, confira `node --version`, `npm --version` e `git --version`. Reinicie o terminal após instalar programas.

## 3. Clonar e instalar

Se já está na pasta ATLAS, não clone outra cópia. Para uma instalação nova:

```powershell
git clone https://github.com/BrenoSilveiraLeal/A.T.L.A.S.git
cd A.T.L.A.S
npm ci
Copy-Item .env.example .env.local
```

Na instalação atual, `.env.local` já está configurado. Preserve esse arquivo; a cópia do exemplo acima é apenas para uma instalação nova.

O repositório remoto pode não conter esta implementação até os commits locais serem enviados. Os comandos e arquivos desta entrega estão na pasta de trabalho atual. Evite executar builds dentro do OneDrive: ele pode transformar arquivos de `.next` em pontos de reanálise e causar `EPERM`. Uma cópia fora de pastas sincronizadas evita esse problema; não mova arquivos de código enquanto houver trabalho em andamento.

## 4. Supabase do ATLAS

O projeto [ATLAS no Supabase](https://supabase.com/dashboard/project/bxikkprpvfirjlmnxqhh) já foi criado na organização **BrenoSilveiraLeal's**, região `sa-east-1`, plano Free, com custo informado de **US$ 0/mês**. O proprietário indicado já está vinculado ao banco e o login com MFA foi validado. Os projetos de outros produtos não foram alterados. Nesta instalação, avance para o login da seção 7; não recrie o banco nem o usuário.

Somente para uma instalação nova:

1. Entre em [Supabase Dashboard](https://supabase.com/dashboard).
2. Clique **New project**, escolha sua organização, nome `atlas` e região próxima ao Brasil. Confira o plano antes de criar. Não reutilize bancos de outros produtos. O Free tem limite de projetos; consulte [COST.md](COST.md).
3. Guarde a senha do banco em um gerenciador de senhas. Ela não entra no frontend nem no Git.
4. Aguarde o projeto ficar saudável. Em **Connect / API Keys**, copie a URL e a chave publishable para `.env.local`. Copie a chave secret/service role somente para a variável server-side `SUPABASE_SERVICE_ROLE_KEY`.
5. Em **Authentication → Users → Add user → Create new user**, crie apenas seu usuário. Não use convite por e-mail se não deseja enviar uma mensagem.
6. Copie o UUID do usuário para `ATLAS_OWNER_ID`. Em **Authentication → Sign In / Providers**, desative novos cadastros e login anônimo; mantenha login por e-mail/senha.
7. Configure Site URL e redirect URLs para sua origem local e, depois, para a URL HTTPS da hospedagem. Configure expiração curta de JWT (por exemplo, 900 segundos) e reveja as opções de sessão disponíveis no seu plano. Cookies do ATLAS têm limite de uma hora e são renovados pela sessão válida; cookies não substituem revogação no Auth.

## 5. Aplicar as migrations e registrar o proprietário

As seis migrations de fundação abaixo já foram aplicadas no projeto atual e o proprietário registrado. A sétima entrega a persistência do Executor; seu estado remoto deve ser conferido no histórico de migrations e no relatório de validação, sem reaplicar scripts às cegas. Para um banco novo, aplique na ordem:

1. `supabase/migrations/20260913235609_atlas_foundation.sql`
2. `supabase/migrations/20260914045633_atlas_analysis_pipeline.sql`
3. `supabase/migrations/20260914135359_atlas_configuration_audit.sql`
4. `supabase/migrations/20260914230025_atlas_cache_retention.sql`
5. `supabase/migrations/20260915044052_atlas_portfolio_history.sql`
6. `supabase/migrations/20260915044150_atlas_agent_configuration.sql`
7. `supabase/migrations/20260916045026_atlas_executor_gateway.sql`

Depois execute, substituindo o UUID pelo seu usuário real:

```sql
insert into public.system_state(owner_id)
values ('UUID-DO-SEU-USUARIO');
```

`system_state` aceita apenas um proprietário. Os defaults são live desligado e kill switch ativo. Sem esse registro, as RPCs recusam operações. As tabelas públicas têm RLS: leitura exige proprietário e AAL2; gravações financeiras são restritas a RPCs server-side. O Security Advisor remoto da fundação registrou apenas proteção contra senhas vazadas desativada, recurso disponível a partir do Pro. Nenhum upgrade foi contratado. [Segurança de senhas no Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

Alternativa para manutenção com histórico do CLI: consulte `npx supabase --help`, `npx supabase login --help`, `npx supabase link --help` e `npx supabase db push --help`, autentique sua conta, vincule o **projeto ATLAS** e aplique as migrations. Não combine aplicação manual com `db push` sem antes alinhar o histórico de migrations; o SQL Editor não registra esse histórico automaticamente.

## 6. Configurar variáveis

Na instalação atual, URL, chaves modernas, proprietário e segredo cron já estão em `.env.local`, ignorado pelo Git. As credenciais são usadas somente no servidor. Em uma instalação nova, preencha:

| Variável | Valor / finalidade |
|---|---|
| `SUPABASE_URL` | URL do projeto ATLAS |
| `SUPABASE_PUBLISHABLE_KEY` | Chave pública Supabase, utilizada pelo backend BFF |
| `SUPABASE_SERVICE_ROLE_KEY` | Chave secret/service role; acesso privilegiado somente no servidor |
| `ATLAS_OWNER_ID` | UUID do proprietário registrado em `system_state` |
| `ATLAS_APP_URL` | Local: `http://127.0.0.1:3000`; produção: origem HTTPS exata |
| `BRAPI_API_TOKEN` | Token obtido no painel oficial brapi; necessário para seu universo de ativos |
| `CRON_SECRET` | Segredo aleatório forte, igual no servidor Next e na Edge Function |
| `SESSION_COOKIE_SECURE` | `false` somente para HTTP local; `true` em produção HTTPS |
| `LIVE_TRADING_ENABLED` | Manter `false`; alterar a variável não substitui os gates de conta, risco e reconciliação |
| `ATLAS_OWNER_PIX_KEY` | Reservada para futura integração; deixe vazia por enquanto |

Não cole secrets no chat, não adicione prefixo `NEXT_PUBLIC_` a credenciais e não publique `.env.local`. Gere `CRON_SECRET` com um gerenciador de senhas. Reinicie o servidor após mudar variáveis.

## 7. Executar e entrar com MFA

```powershell
npm run build
npm run local
```

O build atual já está pronto. `npm run local` inicia o painel e aciona o scheduler a cada 60 segundos, sem chamadas sobrepostas; cada agente segue o intervalo configurado. Mantenha esse terminal aberto e use `Ctrl+C` para encerrar. É necessário acesso à internet para Supabase e fontes públicas. O comando recusa outra instância na porta 3000 e exige live desativado. Para editar o código, `npm run dev` inicia apenas o servidor de desenvolvimento.

**Nesta instalação, senha e TOTP já foram configurados e o painel protegido foi acessado.** Use o login habitual; não regenere acesso inicial nem recrie o autenticador. `.supabase/atlas-owner-setup.html` foi encerrado como link de primeiro acesso. Em uma instalação nova, o script administrativo `scripts/bootstrap-supabase-owner.mjs` pode preparar o acesso sem enviar e-mail; ele é recusado depois de MFA verificado. Arquivos administrativos são privados e ignorados pelo Git.

Abra **http://127.0.0.1:3000**. Com a configuração presente, o acesso redireciona para `/login`. Novos cadastros e login anônimo estão desativados; os JWTs expiram em 900 segundos.

Entre com seu e-mail/senha e o código atual de seis dígitos do autenticador. Somente em uma instalação nova, clique **Cadastrar autenticador** e adicione a conta TOTP usando a chave exibida no cadastro. Guarde a recuperação de acesso conforme o procedimento do Supabase e seu gerenciador; não existe bypass local de MFA.

## 8. Criar ativos, agentes e limites

1. Abra **Mercado**. Consulte um ticker e confira origem, horário e status DELAYED/STALE.
2. Em **Cadastrar ativo**, informe ticker, empresa e setor. O cadastro não certifica lote, tick ou elegibilidade de execução.
3. Em **Agentes**, clique **Criar agente**, escolha o ativo, nome, perfil visual, orçamento proposto e intervalo. Os agentes nascem pausados e com caixa zero no ledger, sem depósito fictício.
4. Em **Risco e limites**, registre um perfil completo. Os valores não vêm preenchidos com recomendações de investimento. O perfil é preservado como uma versão; salvar não aprova trading live nem vincula automaticamente a carteira.
5. Em **Agentes → Estratégias de observação**, publique uma revisão SMA20/SMA50. Em **Configuração do agente**, selecione o agente pausado, a revisão, o perfil de risco e o intervalo. A revisão e os limites utilizados são preservados nas evidências de cada análise.
6. Abra o agente e clique **Ativar análise**. O motor registra HOLD e bloqueios de execução; isso não é uma estratégia de trading homologada. Publicar outra revisão não altera automaticamente agentes já configurados.
7. Com `npm run local` aberto, o scheduler encontra os agentes vencidos, preserva os dados utilizados e grava decisão, memória e auditoria atomicamente. Consulte o detalhe do agente e a auditoria. A execução automática em nuvem foi adiada; a seção 11 descreve essa etapa futura.

Uma falha de fonte coloca o agente em `RISK_BLOCKED`; revise o erro no banco/saúde antes de reativar a análise. O limite brapi é conservador: até 150 consultas lógicas/dia, cada uma com no máximo três tentativas, compartilhadas entre UI e scheduler. Cache: cotação 30min, histórico 12h, notícias 15min e macro 6h. Aumentar polling não remove atraso.

Em **Mercado → Fundamentos · CVM**, informe o código CVM da companhia, o exercício e o escopo consolidado ou individual. O conector lê DFP anual e conserva rubrica, versão, moeda/escala e arquivo de origem. Não deduz código CVM pelo ticker, nem substitui contas ausentes por zero. A consulta não precisa de token CVM; exige o login privado do ATLAS e acesso HTTPS à fonte pública. São permitidas quatro novas consultas à fonte por dia; o resultado normalizado fica em cache por sete dias. O acesso de rede à CVM ainda precisa de validação no ambiente de implantação, conforme [CVM_FUNDAMENTALS.md](docs/CVM_FUNDAMENTALS.md).

A visão geral e a carteira mostram histórico patrimonial da conta selecionada; cada ponto corresponde a um snapshot conciliado, sem preencher períodos ausentes. As métricas da visão geral usam a mesma conta do gráfico. A carteira também exibe posições com ativo, agente e data de reconciliação; a tesouraria consulta o último snapshot contábil. Valores mantêm precisão decimal e não representam saldo disponível para uma nova ordem. Sem corretora conectada e registros válidos, o histórico e os totais permanecem indisponíveis.

## 9. Validar localmente

```powershell
npm run lint
npm run typecheck
npm test
npm run build
```

Testes incluem risco, OMS, providers, autenticação, payload/CSRF, research e migrations PostgreSQL. Fixtures existem somente em `tests/`. O teste de rede pública é opt-in:

Validação local em 15/09/2026: lint, tipagem e build passaram; **348 testes passaram e 3 smokes opt-in foram ignorados, em 20 arquivos**. O scheduler local retornou `OK` e preservou a limitação de chamadas após reinício. Isso não certifica o fluxo de ordens com uma corretora.

`node scripts/verify-supabase.mjs` verifica a instalação remota somente por leitura, sem imprimir credenciais. Confere proprietário, bloqueios de execução, carteira e negação de acesso anônimo. O teste passou no projeto atual para a RPC de carteira e 26 tabelas sensíveis.

```powershell
$env:ATLAS_PUBLIC_DATA_SMOKE = '1'
npm test -- tests/providers.test.ts -t 'public endpoint smoke'
Remove-Item Env:ATLAS_PUBLIC_DATA_SMOKE
```

Esse smoke consulta dados públicos reais, sem enviar ordem. Ele não comprova SLA, licença profissional, autenticação de broker, sessão de mercado ou qualidade point-in-time de dataset.

## 10. Hospedar o frontend/backend

**Etapa futura, ainda não contratada.** A configuração atual é local + Supabase Free. Para eliminar a dependência do PC, a opção prioritária avaliada é VPS Windows com ATLAS/backend, scheduler, gateway Python e terminal MT5 supervisionados; consulte a [decisão](docs/EXECUTION_GATEWAY_DECISION.md) e [custos](COST.md). A contratação depende do orçamento do proprietário e de compatibilidade/dimensionamento verificados.

Vercel continua alternativa para hospedar o backend separado do gateway; não hospeda o terminal MT5. A conta consultada usa **Hobby**, cuja adequação ao uso financeiro não foi presumida e cujo cron diário não atende este scheduler. O procedimento opcional de deploy Next é:

1. Envie os commits ao seu repositório GitHub quando revisados.
2. No Vercel, clique **Add New → Project**, importe o repositório e selecione Next.js, raiz do projeto, `npm run build` e `npm ci`.
3. Adicione as variáveis server-side na configuração de **Environment Variables**. Use `SESSION_COOKIE_SECURE=true`, origem HTTPS correta e `LIVE_TRADING_ENABLED=false`.
4. Implante e atualize a Site URL do Supabase. Separe projetos/segredos de Preview e Production.
5. Verifique login, MFA, leitura de ativos e um job de análise. Não envie segredos como texto em issues, logs ou descrições de deploy.

Também é possível hospedar o Next em um servidor Node compatível, com HTTPS e reverse proxy, usando `npm run build` e `npm start`. O processo precisa ser supervisionado pela hospedagem. A existência dessa alternativa não comprova hospedagem gratuita contínua.

## 11. Scheduler na nuvem

1. Depois do deploy Next, confira no CLI `npx supabase functions deploy --help` e publique a função `atlas-tick` no projeto ATLAS. O `supabase/config.toml` usa autenticação própria por `CRON_SECRET`; nenhuma chamada anônima sem segredo é aceita.
2. Em **Edge Functions → Secrets**, configure `ATLAS_APP_URL` e `CRON_SECRET` idênticos aos do servidor Next. Não grave secrets no SQL do repositório.
3. Ative **Cron (pg_cron)** e **pg_net** nas integrações do Supabase.
4. Em **Vault**, crie `atlas_tick_url` com a URL HTTPS da função publicada e `atlas_cron_secret` com o segredo correspondente.
5. Execute `supabase/setup-scheduler.sql` no SQL Editor. Ele instala um único cron central a cada minuto. O intervalo de cada agente determina quando analisar; nenhum loop infinito roda em Vercel.
6. Consulte os registros Cron/Edge e `/app/health`. O scheduler processa até três agentes por chamada, usa lease de 120s e grava health com validade de três minutos.
7. Faça uma análise, desligue seu computador e confira depois os registros posteriores ao desligamento. Só esse teste valida o requisito cloud; ainda não foi executado nesta entrega.

O Free pode pausar e não tem SLA de disponibilidade. Antes de live, backup/restore, monitoramento externo e alertas fora do painel precisam ser implementados e testados.

O painel converte medições vencidas, futuras ou inválidas para `UNKNOWN`, preservando o estado que foi originalmente registrado. A cada hora, o scheduler também pode remover até 500 registros de cache com mais de sete dias. Essa limpeza é restrita a `READ_CACHE_V1`: decisões, memória, ordens, ledger e auditoria são preservados. Falha na manutenção degrada a saúde e não cria sucesso fictício.

## 12. Conectar o gateway de execução

Leia a [decisão técnica](docs/EXECUTION_GATEWAY_DECISION.md), a [comparação MT5](docs/research/MT5_GATEWAY_RESEARCH.md) e a [pesquisa ProfitDLL/VPS](docs/research/PROFIT_INFRA_RESEARCH.md). A rota principal usa o SDK Python oficial em `gateways/mt5` junto a um terminal autenticado. A API privada de uma corretora não é pré-requisito. ProfitDLL e API oficial direta continuam alternativas futuras no contrato `BrokerProvider`.

`src/core/executor.ts` recebe comandos aprovados, revalida risco, despacha uma vez e recupera resultados incertos por consulta. `src/providers/execution-gateway.ts` implementa o transporte privado; Supabase conserva comandos, claims, reservas, fills, ledger e auditoria. O gateway não escolhe ativo, preço, direção ou quantidade. A ponte inicial limita escrita a LIMIT/DAY, cancelamento e modificação de preço com mesma quantidade.

O runtime `POST /api/executor` exige segredo próprio server-side (`EXECUTOR_SECRET`) e configuração do gateway. Consulte `.env.example` e o README da ponte para as variáveis; nunca exponha essa rota ou o gateway como endpoint anônimo para ordens. As estratégias existentes continuam observação/HOLD e não geram operações BUY/SELL para exercitar a integração.

Sem fonte oficial para caixa liquidado, custódia integral e taxas totais, a reconciliação completa continua indisponível. Margem livre do terminal não será convertida em saldo do Treasury. Credenciais/configuração sozinhas não liberam live.

As próximas ações externas são escolher/abrir conta PF B3 com modalidade adequada e automação Python permitida, autenticar o terminal, autorizar uma VPS e homologar leituras/recuperação. Não houve escolha de corretora nem compra. Uma ordem real de validação exige parâmetros e autorização específicos; consulte [LIVE_READINESS.md](docs/LIVE_READINESS.md).

## 13. Ativar o sistema e operar com segurança

Ativar **análise** está descrito acima. Ativar **trading real** ainda não está disponível: siga [LIVE_READINESS.md](docs/LIVE_READINESS.md). O botão vermelho persiste bloqueio global e informa que cancelamentos não puderam ser confirmados sem broker. Ele não vende posições. Depósitos/retiradas devem ser feitos no canal oficial; abrir instrução ou QR não credita o ledger.

Consulte [VALIDATION.md](docs/VALIDATION.md) para as evidências desta entrega, [ARCHITECTURE.md](docs/ARCHITECTURE.md) para fronteiras e [ROADMAP.md](docs/ROADMAP.md) para pendências. O objetivo continua execução real oficialmente suportada; nenhum componente pendente é substituído por simulação em produção.

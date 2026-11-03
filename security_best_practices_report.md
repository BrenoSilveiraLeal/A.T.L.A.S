# Revisão de segurança e prontidão do escritório DASH

**Data:** 2 de novembro de 2026  
**Escopo:** arquivos rastreados neste repositório, rotas de autenticação e day trade, e advisors do projeto Supabase ATLAS conectado. Não foram lidos nem reproduzidos valores de segredos locais ou de produção. Não foram inspecionados terminais MT5, configurações da conta Genial ou valores de variáveis no Vercel.

## Resumo

- A busca nos arquivos rastreados não encontrou chaves privadas ou credenciais financeiras em código. `.env.local` está ignorado pelo Git. Código fonte não é local secreto: qualquer valor enviado ao navegador pode ser inspecionado, então credenciais bancárias, tokens privados, `SUPABASE_SERVICE_ROLE_KEY`, credenciais de broker e chaves de automação devem ficar em armazenamento de segredos do servidor ou no gateway privado.
- A chave Supabase publishable pode ser usada no cliente por desenho; ela não substitui autorização. O acesso deve continuar protegido por RLS e validação de proprietário/AAL2 no servidor. O módulo que carrega a service role é server-only.
- A autenticação do app exige proprietário e AAL2 nas rotas protegidas. Os endpoints de ciclo usam autenticação cron e proprietário; a rota de parada verifica origem e proprietário.
- O Supabase reporta que proteção contra senhas vazadas está desligada. É uma configuração pendente de Auth, não algo corrigido por código.
- O banco conectado contém as tabelas `dt_*` do DASH com RLS ativo. A lista remota confirma as migrations até `20261102222935_dash_fk_query_indexes`; as tabelas ainda não têm candles ou fills DASH, então a integração com o coletor ainda precisa ser iniciada e observada.
- Não há execução real habilitada. O DASH está em SIMULATED, e o gateway MT5 Day Trade existente recusa `submit`. Mantive o envio real explicitamente bloqueado e não alterei o caminho Swing do ATLAS/Genial.

## Achados

### SEC-MED-001 — Proteção contra senha vazada desativada

- **Severidade:** Média
- **Local:** configuração Supabase Auth do projeto `ATLAS` (fora do código).
- **Evidência:** advisor de segurança Supabase retorna `Leaked Password Protection Disabled`.
- **Impacto:** usuários podem escolher senhas conhecidas por vazamentos. MFA/AAL2 reduz o risco de tomada de conta, mas não substitui essa proteção.
- **Correção:** habilitar proteção contra senhas vazadas nas configurações de autenticação do Supabase e confirmar que o fluxo de cadastro/troca de senha continua funcionando.
- **Estado:** pendente de configuração no painel; não alterado nesta revisão.

### SEC-LOW-001 — Advisor de `search_path` na função marcador

- **Severidade:** Baixa / provável falso positivo sem impacto prático observado.
- **Local:** função `atlas_private.bars_yahoo_marker()` no Supabase.
- **Evidência:** advisor alerta `mutable search_path`. A inspeção da função mostrou SQL vazio (`select`), `SECURITY INVOKER`, sem lógica dinâmica, e ACL restrita a `postgres`.
- **Impacto:** não foi identificado caminho de execução por usuários do app nem alteração de dados. É prudente fixar `search_path` caso a função venha a receber lógica no futuro.
- **Correção:** se mantida, definir `search_path` fixo e mínimo; caso seja apenas marcador legado, removê-la em migração revisada.
- **Estado:** sem alteração, pois o advisor não indica exposição atual.

### SEC-INFO-001 — Tabela marcador fechada por RLS

- **Severidade:** Informativa / fechado por padrão.
- **Local:** `public.boss_pool_marker` no Supabase.
- **Evidência:** RLS ativado sem políticas e sem privilégios de leitura para `anon`, `authenticated` ou `service_role` na inspeção.
- **Impacto:** a tabela não está acessível pelas roles da aplicação; o advisor INFO é compatível com uma tabela intencionalmente inacessível.
- **Ação:** manter fechada ou remover quando não for necessária; não criar política ampla apenas para silenciar o advisor.

## Controles de código verificados

- O cliente Supabase administrativo está em módulo `server-only` (`src/lib/supabase.ts`). Nenhuma chave privilegiada apareceu na busca dos arquivos rastreados; `.env.local` é ignorado pelo Git.
- `requireOwner()` verifica o usuário e o proprietário e exige AAL2 por padrão. O bypass encontrado é limitado ao desenvolvimento local em loopback.
- A API DASH aplica autenticação de proprietário; tarefas de ciclo exigem o mecanismo de cron. Escritas não devem ser expostas por acesso direto ao cliente Supabase.
- A política CSP bloqueia objetos, restringe formulários e frames e usa nonce para scripts. `style-src 'unsafe-inline'` permanece por compatibilidade visual.
- As migrations DASH estão aplicadas no projeto Supabase conectado. `list_tables` confirmou RLS ativo em todas as tabelas `dt_*`; `list_migrations` confirmou a sequência até os índices de consultas/FKs. Os advisors de segurança não mostram exposição nova nas tabelas DASH. A migration mais recente adiciona índices de histórico e relacionamentos; o advisor ainda os classifica como não usados porque as tabelas DASH estão vazias.

## Prontidão para day trade real

### Bloqueios encontrados

1. **Persistência e coleta:** schema, RLS, engine paper e ingestão atômica estão aplicados; o projeto ainda não tem candles/quotes DASH. Instalar e executar o coletor read-only ProfitDLL localmente e confirmar que cotações e candles válidos chegam ao banco.
2. **Gateway e corretora:** `gateways/profitdll/gateway.py` implementa somente Market Data read-only, sem funções OMS. O pacote DLL/licença ProfitDLL, usuário da Nelogica e autorização da conta ainda dependem da instalação e confirmação do titular. O caminho MT5 Swing do ATLAS não deve ser reutilizado nem alterado para futuros.
3. **Instrumentos e risco:** `config/daytrade.json` ainda não contém especificações verificadas de contratos, limites e custos suficientes para dimensionar posição. WIN/WDO exigem configuração de contrato/série, vencimento e regras de negociação atualizadas, margem da conta, custos e limites diários definidos pelo responsável.
4. **Mercado:** o coletor ProfitDLL e o calendário/gates de sessão estão implementados, mas ainda não foram validados em execução com a DLL oficial e um pregão real. A rolagem de vencimentos e a continuidade histórica precisam de rotina operacional.
5. **Execução segura:** falta integração documentada e autorizada com ordens de futuros, confirmação de stop no broker, reconciliação de ordens/posições após timeout ou reinício, idempotência, botão de parada independente, política de zeragem e alertas operacionais.
6. **Validação:** o backtest walk-forward com custos está implementado, mas faltam histórico completo de futuros, simulação intradiária em sombra, replay de falhas e homologação operacional. A Genial informa que MT5 não oferece módulo de simulação e é disponibilizado para operações reais; não se deve usar conta real como substituto de homologação.
7. **Operação:** Vercel não executa a DLL nativa. A arquitetura exige gateway privado em máquina Windows x64 controlada, com credenciais isoladas do app web e supervisão/recuperação operacional.

### Proteções iniciadas nesta implementação

- `src/core/daytrade/agents.ts`: propostas são recusadas quando têm votos duplicados/desconhecidos, valores de risco inválidos, quantidade inválida, instrumento malformado ou preços/stop/target inconsistentes.
- `src/core/daytrade/agents.ts`: `maySend()` agora sempre recusa envio real, inclusive para status `LIVE`, até existir homologação explícita.
- `src/core/daytrade/cycle.ts`: o resultado do executor precisa corresponder exatamente à proposta aprovada (instrumento, lado, quantidade, stop e tipo/preço); divergências são bloqueadas. Status `LIVE` não é contabilizado como operação simulada.
- `gateways/profitdll/gateway.py`: conecta somente ao Market Data; eventos de negócio inválidos, editados, duplicados, fora de ordem ou perdidos invalidam o buffer afetado para não gravar OHLCV potencialmente incorreto.
- `src/app/api/daytrade/[resource]/route.ts`: os preços OHLC de candles de tempo real agora exigem valores finitos e positivos na validação Zod antes da RPC de persistência; isso rejeita `Infinity` gerado por JSON numérico fora do intervalo.
- As migrations `daytrade_*` aplicadas criam persistência própria, políticas RLS de owner, RPCs atômicas para quotes/candles e engine paper com fills/ledger transacionais. A migration `dash_fk_query_indexes` cobre FKs e leituras históricas DASH.
- A ponte MT5 e o fluxo Swing de compras Genial do ATLAS não foram modificados.

## Próximas etapas recomendadas

1. Habilitar proteção contra senha vazada no Supabase Auth.
2. Instalar a ProfitDLL oficial em Windows x64 e validar o coletor somente leitura no próximo pregão; acompanhar heartbeat, atraso, gaps, candles e VWAP.
3. Confirmar com a Genial os custos, margem, horários, contrato vigente e limites para preencher `config/daytrade.json`; enquanto faltarem dados confirmados, manter paper bloqueado.
4. Acumular histórico completo, executar walk-forward e simulação em sombra com custos documentados e replay de falhas. Não interpretar resultado curto como prova de lucratividade.
5. Definir com a Genial autorização de automação e reconciliação da conta antes de qualquer implementação OMS. Manter envio real bloqueado até revisão de risco, segurança e operação.

## Referências primárias consultadas

- [Supabase: API keys](https://supabase.com/docs/guides/api/api-keys) — publishable versus secret/service role.
- [Supabase: MFA](https://supabase.com/docs/guides/auth/auth-mfa) — níveis de autenticação e exigência AAL2.
- [Genial: MT5 possui módulo de simulação?](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/360055399932-O-MetaTrader-5-possui-m%C3%B3dulo-simula%C3%A7%C3%A3o) — MT5 sem simulador na oferta descrita pela corretora.
- [Genial: primeira operação](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/45301098108820-Passo-a-passo-para-realizar-sua-primeira-opera%C3%A7%C3%A3o-na-Genial-Investimentos) — contratação e habilitação de plataformas.
- [Genial: acesso ao MT5](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/360055399332-Como-acessar-a-plataforma-MetaTrader-5) — configuração de conta/servidor.
- [B3: especificação do mini índice (WIN)](https://www.b3.com.br/lumis/portal/file/fileDownload.jsp?fileId=8A828D2951C9C377015221CF257F5253) e [variações mínimas de apregoação, 21/09/2026](https://www.b3.com.br/data/files/C4/53/EF/1B/2D5B0A105BF9020AAC094EA8/Variacoes%20Minimas%20de%20Apregoacao%20-%2021.09.2026.pdf).

## Atualização de estado remoto — 02/11/2026

Consulta ao projeto Supabase ATLAS confirmou migrations remotas sincronizadas com os arquivos locais até `20261103025606_daytrade_paper_session_boundary_gap`. As sete migrations pendentes foram aplicadas em ordem e os arquivos locais receberam os mesmos IDs remotos. As tabelas de mercado e paper continuam sem dados; a ingestão espera a configuração validada do gateway ProfitDLL.

Os advisors atuais mantêm o aviso de proteção contra senhas vazadas desativada. `dt_market_history_sessions` aparece como RLS sem política: a tabela é deliberadamente restrita ao service role, sem acesso direto de usuários. O aviso de `atlas_private.bars_yahoo_marker()` com `search_path` mutável é preexistente e não pertence ao fluxo DASH.


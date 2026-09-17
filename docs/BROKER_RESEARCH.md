# ATLAS — investigação de corretoras e execução real

Verificado em **13/09/2026**, por consulta pública a fontes oficiais. Escopo: pessoa física, conta própria, ações à vista B3, sem margem, sem derivativos e sem venda descoberta. Não houve abertura de conta, contratação, contato com terceiros, uso de credenciais ou envio de ordens.

**Reorientação em 16/09/2026:** a API direta da corretora deixou de ser caminho principal. A implementação segue ATLAS Executor → gateway com SDK Python oficial MT5 → terminal → corretora/B3. Agentes, estratégia, risco, OMS e Treasury permanecem no ATLAS. A conta ainda não foi escolhida; ProfitDLL e API oficial direta são alternativas no mesmo contrato. A pesquisa original abaixo é preservada como histórico; para comparação atual, custos e infraestrutura, prevalecem [MT5_GATEWAY_RESEARCH.md](research/MT5_GATEWAY_RESEARCH.md), [PROFIT_INFRA_RESEARCH.md](research/PROFIT_INFRA_RESEARCH.md) e a [decisão técnica](EXECUTION_GATEWAY_DECISION.md).

MT5/EA próprio é oficial e documentado, mas a ponte Python escolhida precisa de confirmação da plataforma/conta, principalmente para ações à vista, overnight, Netting, caixa liquidado, custódia e taxas. Não é necessário obter uma API institucional para implementar o gateway. Não há requisito de parceria especial presumido; termos de conta e licença aplicáveis continuam necessários antes de homologar.

## Resultado da investigação

**Há caminhos oficiais de automação de ordens B3. Não foi comprovado um caminho completo, gratuito, imediatamente disponível ao proprietário e adequado a todos os requisitos do ATLAS.** A existência de uma plataforma, documentação de SDK ou API comercial não comprova habilitação da conta real, licença para uso dos dados, reconciliação integral ou funcionamento do ATLAS em produção.

Três caminhos merecem continuidade:

1. **Genial MetaTrader Swing Trade:** candidato de menor custo de licença comprovado para robô próprio com posições mantidas entre pregões. A Genial publica licença a R$ 0, permite EAs próprios em MQL5 e informa operação em Netting. Não oferece demo dessa modalidade. A infraestrutura em nuvem e a leitura do saldo/custódia integral precisam de validação específica. Fontes: [custo da licença](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180931823764-Qual-o-custo-do-MetaTrader-na-Genial-Swing-Trade), [robôs e Netting](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180979249940-Que-tipo-de-rob%C3%B4-eu-posso-usar-para-operar-no-MetaTrader-Swing-Trade), [ausência de demo](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180904232852-O-MetaTrader-Swing-Trade-possui-m%C3%B3dulo-simula%C3%A7%C3%A3o).
2. **Cedro API Trading + corretora parceira:** API real de negociação, com acesso para PF declarado oficialmente, REST, criação/alteração/cancelamento/consulta de ordens. Exige contratação e corretora habilitada. Preço, corretora elegível para esta conta, permissões, autenticação compatível e limites ainda pendentes. Fontes: [oferta e funcionalidades](https://cedrotech.com/apis/api-trading/), [uso por PF e REST](https://cedrotech.com/blog/roteamento-de-ordens-via-api-b3-bmf-e-bovespa/).
3. **Nelogica ProfitDLL + corretora habilitada:** SDK comercial com documentação de roteamento B3 e dados de mercado. A licença de dados não habilita ordens; roteamento precisa de permissão adicional. É uma biblioteca nativa Windows; não é uma API REST pública gratuita da corretora. Fontes: [ecossistema](https://ajuda.nelogica.com.br/hc/pt-br/articles/22396517026203-Ecossistema-ProfitDLL-e-primeiros-passos), [contratação e acesso](https://ajuda.nelogica.com.br/hc/pt-br/articles/51583791325211-Como-obter-acesso-%C3%A0-ProfitDLL).

**Decisão para a implementação atual:** definir o contrato `BrokerProvider`, conservar a execução real bloqueada por ausência de provider habilitado e não publicar classes `BrokerProviderXP`/`BrokerProviderGenial` com endpoints hipotéticos. Homologar um desses caminhos somente após satisfazer os critérios deste documento. Isso não transforma produção em simulação: significa que a conexão real está **PENDING**.

## Como ler as matrizes

As três tabelas são visões da mesma matriz, divididas para leitura. Juntas contêm todos os campos solicitados.

- **ND:** não demonstrado pela documentação pública consultada. Não significa prova de inexistência.
- **Plataforma:** o recurso existe na plataforma contratada; não implica API acessível ao backend do ATLAS.
- **MT5:** SDK oficial MQL5 e integração Python por comunicação com o terminal. O conjunto efetivamente disponível depende de servidor, conta, ativo e autorização.
- **Cond.:** depende de contratação, habilitação ou documentação complementar.
- **N/A:** o campo não se aplica ao caminho descrito.

### Recursos técnicos

| Broker / caminho | Official API? | Market Data? | Historical Data? | Order API? | WebSocket? | REST? | OAuth? |
|---|---|---|---|---|---|---|---|---|
| XP | Portal de APIs para parceiros; MT5 oficial [X1][X2] | Portal: dados do negócio; preços no MT5 [M1] | No MT5, conforme servidor [M1] | MT5/MQL5; API REST de ordens para PF: ND | API de ordens para PF: ND | Ordens PF: ND | Ordens PF: ND |
| Rico | MT5 oficial; REST de ordens PF: ND [R1] | MT5 [M1] | MT5, conforme servidor [M1] | MT5/MQL5 [R2] | ND | ND | ND; login de plataforma não é OAuth |
| Clear | MT5/MQL5 oficial; REST de ordens PF: ND [C1] | Plataforma/MT5 [M1] | MT5, conforme servidor [M1] | MT5/MQL5 [C1] | ND | ND | ND |
| Genial | MT5 e modalidade Swing Trade oficiais [G1][G2] | MT5 [M1] | MT5, conforme servidor [M1] | EA MQL5 próprio na modalidade Swing [G2] | ND | ND | Não no caminho MT5 documentado |
| Toro / Santander Corretora | API externa de ordens PF: ND [T1] | Plataformas anunciadas [T1] | Gráficos/replay em plataforma; API ND | Automação por plataforma: cond.; API própria ND | ND | ND | ND |
| BTG Pactual | APIs bancárias oficiais; não comprovam API B3 PF [B1][B2] | Plataforma de negociação [B3] | API B3 PF: ND | SmarttBot contratável [S1]; API própria PF ND | Ordens B3: ND | APIs bancárias sim; ordens B3 PF ND | APIs bancárias possuem autenticação própria; escopo de ordens B3 ND |
| Inter | APIs bancárias PJ oficiais; API de ordens B3 PF ND [I1] | Home Broker/Tryd; acesso API B3 ND [I2][I3] | API B3 PF: ND | Plataforma e SmarttBot [S1]; API própria PF ND | Ordens B3: ND | Serviços bancários sim; ordens B3 PF ND | Não comprova OAuth para ordens B3 |
| Terra / Ativa / Nova Futura, via SmarttBot | Integração oficial listada pelo fornecedor [S1]; API externa ATLAS ND | Plataforma | Backtest na plataforma; exportação API ND | Ordens reais pela plataforma; API externa ND | ND | ND | ND |
| Cedro + corretora parceira | Sim, API Trading comercial [D1][D2] | API Market Data separada [D3] | Serviço histórico separado [D3] | Sim: enviar/editar/cancelar/consultar [D1][D2] | Oferta Cedro inclui WS de ordens; escopo contratado a confirmar [D4] | Sim, API Trading [D2] | Não demonstrado; fluxo publicado usa sessão e credencial OMS [D5] |
| Nelogica + corretora habilitada | Sim, ProfitDLL comercial [N1] | Tick, book, callbacks [N1][N3] | Trades; janela máxima 10 dias por requisição [N4] | Sim, envio/alteração/cancelamento e acompanhamento [N2] | Não é o transporte público documentado | Não, DLL nativa | Não; licença/login e autorização de roteamento |
| MetaQuotes + corretora MT5 | SDK oficial; não é corretora [M1][M2] | Ticks, barras, book [M1] | Barras/ticks disponíveis no terminal [M1] | `order_send` e operações MQL5 [M2] | Não no SDK Python documentado | Não no SDK Python documentado | Não; conexão ao terminal/conta |

### Acesso, testes, custo e limites

| Broker / caminho | Client retail allowed? | Partner-only? | Sandbox? | Real trading? | Cost? | Documentation? | Rate limits? |
|---|---|---|---|---|---|---|---|
| XP | Sim para plataformas [X2] | Portal [X1] é dirigido a parceiros | Portal anuncia sandbox de dados; MT5 tem simulador [X1][X4]; não confundir com sandbox REST de ordens | Sim na plataforma; conexão ATLAS não habilitada | MT5 anunciado grátis sob condições; corretagem/tarifas conforme tabela [X2][X5] | [X1]–[X5], [M1] | API ordens PF ND; obter throttling do canal contratado |
| Rico | Sim para MT5 [R1] | MT5 não exige ser parceiro | Página anuncia conta real e conta de testes [R1] | Sim no MT5; escopo do ativo/modalidade a confirmar | MT5 anunciado sem mensalidade; confirmar taxas do canal [R1] | [R1]–[R3], [M1] | ND |
| Clear | Sim para plataforma [C1] | Não no caminho plataforma | Oferta de plataforma não comprova sandbox API | Sim no canal habilitado | Condições/custos publicados; gratuidade de outras plataformas pode exigir minicontratos/RLP [C1][C2] | [C1][C2], [M1] | ND |
| Genial | Sim [G3] | Não para MT5 contratado pelo cliente | **MT5 Swing não tem demo** [G4] | Sim na modalidade Swing; conta normal MT5 é day trade [G5] | MT5 Swing: **R$ 0 licença** [G6]; Cloud MT5/CodeTrading **R$ 41,40** sem isenção [G7]; associação Swing/bridge pendente | [G1]–[G11], [M1] | ND; Netting obrigatório na modalidade Swing [G2] |
| Toro / Santander | Sim para plataformas [T1] | API ND | Simulador/replay de plataforma [T1]; sandbox API ND | Sim por canais oficiais, sem adapter ATLAS | Profit Toro anunciado grátis; custos de automação/API externa ND [T1] | [T1][T2]; manual antigo [T3] não prova oferta atual | API ND |
| BTG | Sim para plataforma/SmarttBot [B3][S1] | APIs Empresas exigem conta PJ; B2B bancário não equivale a retail trading | Sandbox bancário tem respostas estáticas; não valida ordens B3 [B4] | Sim na plataforma; API B3 PF ND | Preço da plataforma e condições na contratação [B3]; API B3 ND | [B1]–[B4], [S1] | Ordens B3 API ND |
| Inter | PF usa HB; APIs Empresas exigem PJ [I1][I4] | Não para HB; API bancária requer aprovação/credenciais | Sim, sandbox bancário [I1]; ordens B3 API ND | Sim no HB/Tryd/SmarttBot; adapter ATLAS ND | HB sem corretagem/custódia, com custos B3 [I2]; API/robôs: cond. | [I1]–[I4], [S1] | Ordens B3 API ND |
| Terra / Ativa / Nova Futura via SmarttBot | Clientes das corretoras listadas pelo fornecedor [S1] | Plataforma acessível ao cliente; API externa ND | Plataforma tem backtest/ambiente de teste [S2]; sandbox de API ND | Sim na plataforma [S1] | Ver planos SmarttBot [S3]; não assumir licença corretora inclui plano robô | [S1]–[S3] | API externa ND |
| Cedro + corretora | PF é público declarado [D2] | Exige fornecedor e corretora habilitados; não exclusivamente B2B [D1][D2] | Oferta de homologação/simulação declarada, acesso sob contratação [D4] | Sim no produto; conta ATLAS ainda não autorizada | **Sob consulta; valor público de trading não encontrado** | [D1]–[D7]; documentação pública existe | Limites de requisição, sessão, ordem/dia, reconexão e backoff contratados: ND |
| Nelogica ProfitDLL | Aplicações de clientes; aceitação PF/conta específica a confirmar [N1][N5] | Não presumir que qualquer cliente Profit recebe licença DLL | Teste mediante solicitação comercial; sandbox de ordens específico ND [N5] | Sim, se roteamento habilitado [N1][N2] | **Licença comercial; valor público não encontrado** | [N1]–[N6] | Histórico: 10 dias/requisição [N4]; limites gerais/ordens ND |
| MetaQuotes MT5 | Depende da corretora | SDK de cliente não é Manager API da corretora | Contas demo dependem do broker; não universal | Sim, quando conta real autoriza | SDK/plataforma conforme broker; VPS oficial **US$ 15/mês** no plano mensal [M3] | [M1]–[M4] | Não há número universal; servidor/broker impõe limites |

### Adequação a B3, nuvem e automação

| Broker / caminho | B3 equities supported? | Cloud execution possible? | Terms permit automated trading? |
|---|---|---|---|
| XP | Broker negocia ações; confirmar símbolos/modalidade do servidor MT5 escolhido | MT5 exige terminal/EA hospedado; VPS é alternativa técnica, contrato e conta pendentes | Robôs MT5 oferecidos [X2]; sistemas proprietários não são abertos a algoritmos do cliente [X3] |
| Rico | Ações disponíveis na corretora; habilitação específica MT5/swing precisa ser confirmada | Terminal hospedado é caminho técnico; não execução nativa em Vercel | MQL5 automático anunciado [R2]; termos da conta/plataforma ainda precisam de aceite |
| Clear | Ações disponíveis na corretora; validar universo/overnight MT5 | Via terminal ou automação cloud contratada; não REST público comprovado | Robôs MQL5 oferecidos oficialmente [C1]; sujeito a termos da plataforma |
| Genial | Sim no contexto das plataformas; validar inventário, lote padrão/fracionário e permissões da conta [G1][G11] | Genial Cloud existe [G7][G9]; compatibilidade **Swing + ponte ATLAS** ainda não demonstrada | EA próprio MQL5 expressamente descrito para Swing [G2]; Netting obrigatório |
| Toro / Santander | Sim pelos canais corretora; não há prova de API externa para ATLAS | Stops em servidor ou Profit não provam execução da estratégia inteira em cloud | Documentação antiga de SmarttBot não comprova oferta contratável atual; validar plataforma e termos [T1][T3] |
| BTG | Sim pelos canais oficiais [B3] | SmarttBot cloud oficialmente lista BTG [S1]; acesso de backend externo ND | Automação oferecida via SmarttBot; autorização do ATLAS como cliente API ND |
| Inter | Sim [I2] | SmarttBot cloud lista Inter [S1]; Tryd é aplicação instalada [I3] | Autorização oficial SmarttBot não concede autorização genérica a APIs privadas do HB |
| Terra / Ativa / Nova Futura | Guia SmarttBot inclui ações B3 e essas corretoras [S1]; confirmar conta/ativo | Sim na SmarttBot [S1]; endpoint externo de execução ATLAS ND | Robôs dentro da plataforma; contrato específico de API externa ND |
| Cedro + corretora | Sim, Bovespa, conforme habilitação [D2] | REST permite cliente remoto como possibilidade técnica; contrato, IPs, sessão e política de cloud precisam ser confirmados | Automação por robôs é caso de uso expresso [D2]; aceite/licenciamento particular pendentes |
| Nelogica ProfitDLL | Sim, Bovespa [N1][N2] | Worker persistente Windows é candidato; guia Linux/Wine é de **dados**, não homologação de ordens [N6] | Algoritmos externos são finalidade do SDK; contratação e habilitação obrigatórias |
| MetaQuotes MT5 | Depende do servidor/corretora, não da presença do SDK | Sim: EA em VPS ou terminal em VM. Hospedagem MetaQuotes não executa arbitrariamente o backend Node/Python [M3][M4] | EA é função oficial; conta real e termos da corretora prevalecem |

## Descobertas que mudam a arquitetura

### API bancária, API de dados e API de ordens são contratos diferentes

O portal XP apresenta serviços para parceiros, relativos a captação, posição, movimentação, produtos, conta e comissão. Esse catálogo e seu sandbox não são evidência de `placeOrder` para PF. [Portal XP](https://dev.xpinc.com/)

Inter Empresas e BTG Empresas oferecem integrações bancárias reais. O fato de haver Pix, REST ou sandbox nesses produtos não autoriza negociação de ações nem garante acesso a conta PF. Não criar um broker de ações a partir de um conector bancário. [Inter Empresas](https://developers.inter.co/), [BTG Empresas](https://empresas.btgpactual.com/developers)

Na Cedro, **Market Data** e **API Trading** são produtos distintos. A FAQ de Market Data nega explicitamente compra e venda por aquele produto. A API de dados financeiros também é complementar e pode ser necessária para extratos/custódia/nota de corretagem. [Market Data REST](https://cedrotech.com/market-apis/api-rest/), [catálogo técnico](https://docs.cedrotech.com/v3/docs/funcionalidades)

### MT5 é um terminal/SDK, não um endpoint REST da corretora

O SDK Python oficial comunica-se com o terminal MT5. Expõe conta atual, símbolos, preços, ordens, posições e histórico; `order_send` envia uma requisição do terminal ao servidor. Portanto, uma implementação em Python requer processo/terminal persistente em ambiente compatível. Não instalar `MetaTrader5` em uma função Vercel e declarar integração pronta. [SDK Python](https://www.mql5.com/en/docs/python_metatrader5), [envio de ordens](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py)

O saldo de uma conta/plataforma MT5 pode representar limite alocado. O ATLAS só poderá rotulá-lo como saldo total da corretora após comprovar o significado do campo e a reconciliação com custódia, caixa liquidado, compromissos de liquidação e operações realizadas por outros canais. Esta é uma exigência de projeto, não uma garantia das páginas do SDK.

Na Genial, MT5 normal e MT5 Swing são ofertas distintas: a primeira é orientada a encerrar posições no dia; a segunda permite overnight. A versão Swing usa Netting. Por isso, ordens de agentes que compartilham um ticker precisam de atribuição interna por execução; o broker pode mostrar uma posição líquida única. [Modalidades](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/360055813771-Posso-operar-Swing-Trade-no-MetaTrader), [Netting](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180979249940-Que-tipo-de-rob%C3%B4-eu-posso-usar-para-operar-no-MetaTrader-Swing-Trade)

### Cedro: autenticidade do produto confirmada; autenticação ainda é um bloqueio

A documentação de API Trading publica autenticação em duas etapas, com sessão `JSESSIONID` e login de roteamento. Também descreve um identificador contendo credencial OMS, com variações de codificação/proteção. **Base64 é codificação, não criptografia**, apesar da terminologia da página. Não replicar exemplos antigos em HTTP nem persistir identificadores/credenciais em logs. [Autenticação publicada](https://docs.cedrotech.com/reference/trading-introduction)

Esse é um fluxo documentado de API, diferente de capturar sessão do Home Broker. Ainda assim, o pedido proíbe reutilizar cookies de sessão. O ATLAS não implementará automaticamente esse mecanismo: fica **PENDING** obter documentação de um fluxo oficial compatível com a restrição do proprietário, ou esclarecer explicitamente o escopo dessa restrição no momento da escolha. Nenhuma sessão do navegador será capturada ou reutilizada.

### Cloud com plataforma pronta não equivale a controle pelo ATLAS

A SmarttBot documenta execução em nuvem e integração real com corretoras. Isso comprova seu produto. Não foi encontrada documentação pública suficiente para o ATLAS enviar propostas próprias por API externa, consultar todas as execuções e impor seu Risk Engine antes de cada ordem. Ela permanece alternativa oficial de automação, mas **não é provider ATLAS implementável com a evidência atual**. [Integração/cloud](https://ajuda.smarttbot.com/pt-BR/articles/12945889-guia-de-integracao-com-corretoras-xp-clear-btg-e-mais)

O VPS oficial MetaQuotes hospeda EAs e tem restrições de migração: chamadas DLL são proibidas e scripts não são migrados. Não é uma VM de propósito geral para instalar a aplicação Python/Node do ATLAS. Um EA próprio que busca comandos de um backend seria outro componente a especificar, desenvolver e homologar. [Regras de migração](https://www.metatrader5.com/en/terminal/help/virtual_hosting/virtual_hosting_migration)

## Menor custo que a evidência permite afirmar

| Componente | Valor publicado observado | Limitação da comparação |
|---|---|---|
| Genial MetaTrader Swing Trade | **R$ 0** de licença [G6] | Não inclui comprovação da infraestrutura cloud, extratos integrais, taxas operacionais nem conexão autorizada ATLAS |
| Genial Cloud, templates MT5/CodeTrading | **R$ 41,40** quando critérios de isenção não forem cumpridos [G7] | Elegibilidade da versão Swing e instalação/execução da ponte ATLAS ainda não confirmadas |
| Isenção Genial Cloud | Exige RLP e operação real de minicontrato por ciclo [G8] | Incompatível com o escopo ATLAS sem futuros; não operar derivativos só para obter gratuidade |
| MetaQuotes VPS, plano mensal | **US$ 15/mês** [M3] | EA hospedado; não é servidor geral Python/Node. Descontos de longo prazo divergem entre páginas oficiais; conferir checkout antes de contratação |
| SmarttBot | Página de planos mostra plano inicial **R$ 249/mês**, ou **R$ 199/mês** no anual [S3] | Interface/plano focados em robôs; API externa, adequação do plano a ações e integração ATLAS não comprovadas |
| Cedro API Trading | **Sob consulta** [D1] | Preço da API de cotações ou teste de sete dias não determina custo de roteamento |
| Nelogica ProfitDLL com roteamento | **Sob consulta** [N5] | Licença Profit comum não implica licença DLL ou permissão de execução |

**Não é possível declarar honestamente o menor custo total absoluto de real trading cloud para o ATLAS sem confirmação comercial/técnica dos caminhos.** O candidato de licença mais econômica comprovada é Genial MT5 Swing; o componente cloud de menor preço em reais identificado nesta investigação é Genial Cloud a R$ 41,40, condicionado à elegibilidade técnica. Não somar esses números e apresentar R$ 41,40 como orçamento fechado de uma integração já homologada.

O anúncio XP ainda indica SmarttBot a partir de R$ 19,90, mas a página pública atual da SmarttBot exibe outros planos/preços. Tratar como oferta específica ou possivelmente desatualizada até comprovar seu escopo na contratação; **não usar R$ 19,90 para prometer custo do ATLAS**. [Anúncio XP](https://www.xpi.com.br/plataformas/), [planos do fornecedor](https://portal.smarttbot.com/planos)

## Critérios para aprovar um provider

Cada item fica **PENDING** até existir evidência vinculada à conta/contrato escolhido:

1. Conta PF real habilitada para os ativos à vista autorizados, com confirmação de overnight, lote padrão, fracionário, tipos de ordem, leilões e ativos suspensos.
2. Documentação e licença para automação própria, uso em cloud e dados utilizados no backend e na interface pessoal.
3. Credenciais oficiais separadas, armazenadas somente em secret manager; nenhuma senha bancária em texto aberto, cookie do Home Broker ou contorno de MFA.
4. Semântica de conta, caixa disponível, caixa liquidado, garantias, custódia e compromissos de liquidação; API financeira complementar quando necessária.
5. Operações do contrato `BrokerProvider`: conexão, saúde, conta, caixa, posições, ordens, ordem individual, envio, alteração, cancelamento e execuções.
6. Identificação estável de ordem/fill, suporte a `clientOrderId` ou equivalente, deduplicação e busca por correlação após timeout. Um número `magic`/comentário MT5 isolado não comprova idempotência no broker.
7. Confirmação independente do recebimento, aceite, execução parcial, execução final, rejeição e cancelamento. Nunca confundir retorno de envio com fill.
8. Escopo de reconciliação que inclua operações manuais/por outras plataformas e eventos corporativos; divergência bloqueia novas ordens.
9. SLA, quotas de leitura/escrita, política de reconexão, expiração de sessão, manutenção, IPs aceitos, recuperação e canal de contingência documentados.
10. Testes de contrato e falhas; testes em sandbox oficial quando disponível. Não inventar sandbox Genial Swing. Uma futura validação mínima em conta real precisa estar previamente especificada e autorizada pelo proprietário, nunca iniciada durante descoberta.
11. Cotação utilizável para execução com timestamp e frescor comprovados; histórico de backtest não substitui cotação válida de execução.
12. Risk Engine, 2FA ATLAS, kill switch, ledger, circuito de reconciliação e observabilidade aprovados antes de qualquer habilitação de live.

## Fontes primárias

Todas consultadas em **13/09/2026**. Conteúdo público é evidência documental, não teste operacional. Documentos antigos ou páginas comerciais genéricas não foram usados como garantia de habilitação atual. Datas de atualização do site não equivalem necessariamente a mudança de contrato.

| ID | Fonte oficial | Evidência usada |
|---|---|---|
| X1 | [XP Developer Portal](https://dev.xpinc.com/) | APIs de parceiros/dados; sandbox anunciado |
| X2 | [XP plataformas](https://www.xpi.com.br/plataformas/) | MT5/robôs e oferta de plataformas |
| X3 | [XP procedimentos de plataformas](https://www.xpi.com.br/documentos/procedimentos-plataforma-xp/) | Algoritmos próprios exigem plataformas externas; documento antigo, usado como restrição publicada |
| X4 | [XP comparativo de plataformas](https://web.xpi.com.br/xp/documentos/comparativo-de-plataformas/) | Características anunciadas do MT5 |
| X5 | [XP custos operacionais](https://www.xpi.com.br/custos-operacionais/) | Custos dependem do canal/produto; corretagem zero não é universal |
| R1 | [Rico MetaTrader](https://www.rico.com.vc/plataformas/metatrader/) | Oferta PF, mensalidade e conta de testes |
| R2 | [Rico plataformas](https://www.rico.com.vc/plataformas/) | Automação por MQL5 |
| R3 | [Rico central MT5](https://atendimento.rico.com.vc/categoria/plataformas/metatrader) | Guias de EA, ordens e conta demo |
| C1 | [Clear MetaTrader](https://corretora.clear.com.br/plataformas/metatrader/) | Oferta de robôs MQL5 |
| C2 | [Clear custos](https://corretora.clear.com.br/custos/) | Condições de contratação/isenção |
| G1 | [Genial MetaTrader](https://www.genialinvestimentos.com.br/trader/plataformas/meta-trader/) | Oferta de automação e ativos; detalhes técnicos precisam prevalecer sobre marketing genérico |
| G2 | [Genial robôs Swing](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180979249940-Que-tipo-de-rob%C3%B4-eu-posso-usar-para-operar-no-MetaTrader-Swing-Trade) | EA MQL5 próprio, Netting |
| G3 | [Genial contratação Swing](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180761807252-Como-contratar-a-plataforma-MetaTrader-Swing-Trade) | Contratação pelo titular, termos e assinatura |
| G4 | [Genial demo Swing](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180904232852-O-MetaTrader-Swing-Trade-possui-m%C3%B3dulo-simula%C3%A7%C3%A3o) | Ausência de demo dessa modalidade |
| G5 | [Genial modalidades MT5](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/360055813771-Posso-operar-Swing-Trade-no-MetaTrader) | Day trade versus overnight |
| G6 | [Genial custo Swing](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180931823764-Qual-o-custo-do-MetaTrader-na-Genial-Swing-Trade) | Licença R$ 0 |
| G7 | [Genial custo Cloud](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4409684344212-Quais-ser%C3%A3o-os-custos-caso-eu-n%C3%A3o-cumpra-as-condi%C3%A7%C3%B5es-vigentes) | MT5/CodeTrading R$ 41,40 sem isenção |
| G8 | [Genial condições Cloud](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4409692339476-Quais-s%C3%A3o-as-condi%C3%A7%C3%B5es-para-manter-a-plataforma-com-custo-zero) | RLP e minicontratos necessários à isenção |
| G9 | [Genial elegibilidade Cloud](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4409700240404-Quais-s%C3%A3o-as-plataformas-eleg%C3%ADveis-para-este-tipo-de-servi%C3%A7o) | Associação a MetaTrader; Swing/bridge não explicitados |
| G10 | [Genial plataformas](https://www.genialinvestimentos.com.br/trader/plataformas/) | Preços e condições gerais; ler regras específicas |
| G11 | [Genial limites operacionais](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4403328046868-Estrutura-de-limite-operacional) | Segregação de plataformas, conta e limites; não assumir saldo global |
| T1 | [Toro plataformas](https://www.toroinvestimentos.com.br/plataformas) | Oferta atual, marca de trading Santander, plataformas |
| T2 | [Toro história e vínculo Santander](https://www.toroinvestimentos.com.br/quem-somos/) | Conta na Santander Corretora |
| T3 | [Toro manual SmarttBot](https://cdn.toroinvestimentos.com.br/corretora/documents/manual-de-uso-e-funcionalidades-smarttbot.pdf) | Referência legada; não comprova disponibilidade atual |
| B1 | [BTG Developer](https://developer.btgpactual.com/) | Pagamentos e serviços bancários |
| B2 | [BTG Empresas APIs](https://empresas.btgpactual.com/developers) | Integrações para conta PJ |
| B3 | [BTG regras e parâmetros](https://static.btgpactual.com/media/regras-e-parametros-ctvm.pdf) | Plataformas/OMS, contratação e custos |
| B4 | [BTG sandbox](https://developers.empresas.btgpactual.com/docs/sandbox) | Respostas estáticas em sandbox bancário |
| I1 | [Inter Developer](https://developers.inter.co/) | APIs bancárias, credenciais e sandbox |
| I2 | [Inter Home Broker](https://ajuda.inter.co/investimentos/como-contratar-a-plataforma-de-negociacao-home-broker-do-inter) | Ações, acesso PF e custos B3 |
| I3 | [Inter Tryd](https://ajuda.inter.co/investimentos/como-utilizar-a-plataforma-de-negociacao-tryd-trader) | Plataforma instalada, dados e ordens |
| I4 | [Inter cadastro de API](https://ajuda.inter.co/conta-digital-pessoa-juridica/como-cadastrar-uma-api) | Conta PJ, aprovação e certificado |
| D1 | [Cedro API Trading](https://cedrotech.com/apis/api-trading/) | Oferta comercial, funções, corretora necessária |
| D2 | [Cedro API Trading para PF](https://cedrotech.com/blog/roteamento-de-ordens-via-api-b3-bmf-e-bovespa/) | REST, PF e ações Bovespa; artigo 2024 |
| D3 | [Cedro REST Market Data](https://cedrotech.com/market-apis/api-rest/) | Produto de dados não envia ordens |
| D4 | [Cedro roteamento FIX/WS](https://cedrotech.com/blog/api-roteamento-de-ordens-b3-bmf-bovespa/) | Produção, homologação e transportes; atualização indicada julho/2026 |
| D5 | [Cedro autenticação Trading](https://docs.cedrotech.com/reference/trading-introduction) | Sessão API e credencial OMS |
| D6 | [Cedro portal técnico](https://docs.cedrotech.com/) | Documentação pública; acesso específico depende do produto |
| D7 | [Cedro catálogo técnico](https://docs.cedrotech.com/v3/docs/funcionalidades) | Dados financeiros complementam Trading |
| N1 | [Nelogica ecossistema ProfitDLL](https://ajuda.nelogica.com.br/hc/pt-br/articles/22396517026203-Ecossistema-ProfitDLL-e-primeiros-passos) | SDK, Windows, market data versus roteamento |
| N2 | [Nelogica roteamento](https://ajuda.nelogica.com.br/hc/pt-br/articles/13312468554651-Como-rotear-ordens-com-a-ProfitDLL) | Envio, modificação, cancelamento e acompanhamento |
| N3 | [Nelogica tempo real](https://ajuda.nelogica.com.br/hc/pt-br/articles/11168755650459-Fun%C3%A7%C3%B5es-Real-Time-DLL) | Assinaturas e callbacks |
| N4 | [Nelogica histórico](https://ajuda.nelogica.com.br/hc/pt-br/articles/11973319153563-Como-requisitar-trades-hist%C3%B3ricos-com-a-ProfitDLL) | Limite de intervalo histórico |
| N5 | [Nelogica obtenção de licença](https://ajuda.nelogica.com.br/hc/pt-br/articles/51583791325211-Como-obter-acesso-%C3%A0-ProfitDLL) | Contratação, pacote e acesso para teste |
| N6 | [Nelogica Linux/Wine](https://ajuda.nelogica.com.br/hc/pt-br/articles/54973527417243-ProfitDLL-no-Linux-Saiba-como-acessar-e-utilizar) | Exemplo de dados, biblioteca continua Windows; referência conferida 24/08/2026 |
| M1 | [MetaQuotes Python SDK](https://www.mql5.com/en/docs/python_metatrader5) | IPC com terminal e métodos públicos |
| M2 | [MetaQuotes order_send](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py) | Requisição, confirmação e tipos |
| M3 | [MetaQuotes VPS preços](https://www.mql5.com/en/vps/forex-plans) | Plano mensal US$ 15; conferir contratação |
| M4 | [MetaQuotes migração VPS](https://www.metatrader5.com/en/terminal/help/virtual_hosting/virtual_hosting_migration) | Restrições de DLL/scripts e ambiente EA |
| S1 | [SmarttBot integração oficial](https://ajuda.smarttbot.com/pt-BR/articles/12945889-guia-de-integracao-com-corretoras-xp-clear-btg-e-mais) | Guia 12/06/2026: autorização, ações B3, corretoras e cloud |
| S2 | [SmarttBot produto](https://portal.smarttbot.com/) | Robôs, backtesting e plataforma |
| S3 | [SmarttBot planos](https://portal.smarttbot.com/planos) | Preços observados; não prova API externa |

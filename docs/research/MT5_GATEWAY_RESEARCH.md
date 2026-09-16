# MT5 como gateway de execução do ATLAS

Verificação documental: **16/09/2026**. Fontes primárias consultadas pela web. Nenhuma conta foi aberta, contratação realizada ou ordem enviada. Não foi encontrado `AGENTS.md` na raiz/árvore do projeto pesquisada. Complementa [BROKER_RESEARCH.md](../BROKER_RESEARCH.md), preservando a pesquisa anterior.

## Conclusão técnica

**É viável desenvolver um gateway próprio com as interfaces oficiais do MT5, mantendo toda a inteligência no ATLAS.** O EA recebe uma instrução já aprovada pelo Risk Engine/OMS, executa e reporta. A MetaQuotes documenta envio, alteração, cancelamento, ordens, posições, negócios e informações da conta. Isso dispensa depender de uma API privada da corretora, mas ainda exige conta PF, contratação da plataforma e habilitação dos ativos/modalidade na corretora escolhida. Não há conta de corretagem fornecida pela MetaQuotes. [Interfaces oficiais MQL5](https://www.mql5.com/en/docs/trading/ordersend), [operações suportadas](https://www.mql5.com/en/docs/constants/tradingconstants/enum_trade_request_actions), [serviço MetaQuotes](https://www.mql5.com/en/vps/forex-plans).

Entre as fontes consultadas, a **Genial tem a documentação pública mais explícita da combinação ações B3, modalidade Swing separada e EA MQL5 próprio**, com ressalvas abaixo. XP, Rico e Clear oferecem MT5/automação a clientes de varejo; suas páginas comerciais, isoladamente, não comprovam todos os detalhes de ações à vista, overnight e custódia nesse canal. Isso é uma classificação da evidência, **não a escolha de corretora**.

O caminho técnico prioritário pode ser **ATLAS Executor desacoplado → ponte MT5 → corretora → B3**. A seleção final depende de validar a conta e o modo operacional, além de homologar reconciliação e segurança. Não é necessário reescrever agentes, estratégia, risco, OMS ou Treasury como robôs MQL5.

**Direção da implementação desta integração:** ponte externa usando o pacote **Python oficial MetaTrader5**, junto a um terminal autenticado, com journal SQLite durável. A escolha facilita persistência antes do envio e testes automatizados de recuperação. EA MQL5 + WebRequest permanece alternativa documentada, **não implementada nesta etapa**. Logo, o Virtual Hosting restrito da MetaQuotes não hospeda a ponte Python escolhida; ela requer máquina de uso geral compatível, normalmente Windows VPS. [SDK Python oficial](https://www.mql5.com/en/docs/python_metatrader5).

## Corretoras: o que foi confirmado e o que permanece pendente

Valores são os publicados na data da consulta, sujeitos a regras do canal, conta, escritório e contratação. Corretagem zero não elimina taxas da B3, tributos, zeragem compulsória nem infraestrutura.

| Candidata PF | MT5 / EA próprio | Ações à vista B3 e modalidade | Plataforma e volume | Corretagem / custódia | Evidência e pendência |
|---|---|---|---|---|---|
| **Genial** | EA próprio em MQL5 explicitamente permitido na versão Swing; sistema **Netting** | Página MT5 inclui ações; suporte separa MT5 day trade de **MT5 Swing Trade**, este permite overnight. Confirmar lista negociável, fracionário e compra/venda da custódia | MT5 Swing publicado por **R$0**. Não confundir com isenções de outras plataformas/Cloud | Oferta geral de corretagem zero em DMA condicionada a RLP; custódia fixa zero anunciada. Confirmar tabela final do EA/Swing e condições sem RLP | [EA Swing](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180979249940-Que-tipo-de-rob%C3%B4-eu-posso-usar-para-operar-no-MetaTrader-Swing-Trade), [modalidades](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/360055813771-Posso-operar-Swing-Trade-no-MetaTrader-5), [custo Swing](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180931823764-Qual-o-custo-do-MetaTrader-na-Genial-Swing-Trade), [MT5/condições](https://www.genialinvestimentos.com.br/trader/plataformas/meta-trader/), [custódia fixa](https://lp.genialinvestimentos.com.br/bolsafacil/) |
| **XP** | Oferta pública permite criar indicadores e robôs | MT5 oficial confirmado. A consulta pública não fechou matriz de ações à vista, overnight/fracionário e leitura de custódia | MT5 grátis; comparativo publicado indica sem mínimo para isenção da linha MT5 | Autoatendimento com assessoria XP: ações day trade R$0 com RLP, R$2,90 sem; swing R$4,90. Escritórios têm tabela distinta. Custódia de bolsa publicada R$0. Confirmar classificação do canal EA | [plataformas](https://www.xpi.com.br/plataformas/), [comparativo, atualizado 01/08/2025](https://web.xpi.com.br/xp/documentos/comparativo-de-plataformas/), [tarifas](https://www.xpi.com.br/custos-operacionais/) |
| **Rico** | MT5 oficial e programação de estratégias anunciada | Oferta de ações e MT5 confirmadas; coexistência dessas ofertas não certifica todos os ativos/modos pelo servidor MT5 | MT5 sem mensalidade anunciada; conta real e conta de testes. Sem mínimo de volume informado para a licença nessa página | Ações padrão/fracionário day/swing R$0 para ordens do cliente nas plataformas digitais; custódia Rico publicada R$0. Confirmar aplicação ao EA próprio | [MT5](https://www.rico.com.vc/plataformas/metatrader/), [custos](https://www.rico.com.vc/custos/) |
| **Clear** | MT5 e robôs MQL5 anunciados explicitamente | Oferta de ações e MT5 confirmadas, mas a página MT5 é marcada Day Trade. **Overnight via MT5 não comprovado** | MT5 real grátis; demo **R$9,90/mês + impostos**. Exigências de minicontratos de Profit não devem ser transferidas ao MT5 | Corretagem de ações day/swing e custódia publicadas R$0; taxas B3 e compulsórias separadas. Confirmar o canal EA e ativos | [MT5](https://corretora.clear.com.br/plataformas/metatrader/), [custos](https://corretora.clear.com.br/custos/) |

Não foram demonstradas nesta pesquisa ofertas atuais completas de MT5 para ações B3 à vista em Toro/Santander, BTG, Inter, Ativa ou Nova Futura. Isso não prova inexistência; impede incluí-las como conexão MT5 homologada. A mera existência de um servidor de Forex/CFD ou de futuros não atende ao requisito de ações reais na B3.

### Restrições relevantes da Genial

- A versão MT5 comum é day trade e pode zerar posições antes do fechamento; **não usar esse perfil como se fosse uma conta Swing**. [Modalidades MT5](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/360055813771-Posso-operar-Swing-Trade-no-MetaTrader-5).
- O suporte informa que o **MT5 Swing não tem conta demo**. Uma demo de outra modalidade não homologa a conta Swing. [Módulo de simulação](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180904232852-O-MetaTrader-Swing-Trade-possui-m%C3%B3dulo-simula%C3%A7%C3%A3o).
- O limite operacional pode ser segregado por plataforma e modalidade; não pressupor que o saldo MT5 represente toda a conta da corretora. O suporte diferencia limite, garantias e visão day/swing. [Estrutura operacional](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4403328046868-Estrutura-de-limite-operacional).
- Há divergência de granularidade entre marketing genérico e suporte: a página comercial MT5 lista opções, mas o suporte informa que MetaTrader não está habilitado para opções. Portanto, a matriz de capacidades deve vir da conta/símbolo e confirmação contratual, não dos cartões de marketing. [Página MT5](https://www.genialinvestimentos.com.br/trader/plataformas/meta-trader/), [suporte de opções](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/360051071931-Como-investir-em-op%C3%A7%C3%B5es).

## Capacidades oficiais a mapear no adaptador

| Necessidade ATLAS | Interface MT5 oficial | Regra de integração |
|---|---|---|
| Envio / ID real | `OrderCheck`, `OrderSend`, `MqlTradeResult.order`, `deal`, `retcode`, `retcode_external` | `OrderSend=true` não é fill. Preservar ticket real, código de retorno e estado ambíguo. [OrderSend](https://www.mql5.com/en/docs/trading/ordersend) |
| Alterar / cancelar | `TRADE_ACTION_MODIFY`, `TRADE_ACTION_REMOVE`; SL/TP tem ação própria | Apenas quando tipo/estado/símbolo permitirem. Cancelar pedido não é confirmar cancelamento e não desfaz fill. [Tipos de operação](https://www.mql5.com/en/docs/constants/tradingconstants/enum_trade_request_actions) |
| Ordens / status | `OrdersTotal`, `OrderGetTicket`, `OrderSelect`, propriedades e histórico | Ler ordens abertas e históricas; preservar `ORDER_STATE_PARTIAL`, volumes inicial/restante, ID externo quando disponível. [Propriedades de ordens](https://www.mql5.com/en/docs/constants/tradingconstants/orderproperties) |
| Fills / parciais | `OnTradeTransaction`, `HistorySelect`, `HistoryDealGet*` | Cada negócio tem identidade própria e ligação à ordem. Não contabilizar posição líquida como se fosse fill. [Negócios](https://www.mql5.com/en/docs/constants/tradingconstants/dealproperties) |
| Posições | `PositionsTotal`, `PositionSelect`, `PositionGet*` | Reconciliar por conta/símbolo; Netting agrega posições de várias estratégias. O ledger interno mantém atribuição aos agentes. [Funções de negociação](https://www.mql5.com/en/docs/trading/ordersend) |
| Saldo / margem | `AccountInfo*`: balance, equity, margin, free margin, moeda e permissões | **Não mapear margem livre para caixa liquidado sacável**. Modelar origem, escopo e campos desconhecidos. [Propriedades da conta](https://www.mql5.com/en/docs/constants/environment_state/accountinformation) |
| Histórico / recuperação | Ordens e deals históricos + snapshots atuais | Fazer recuperação após reinício e reconexão, respeitando janela que o servidor realmente fornece. [SDK oficial Python](https://www.mql5.com/en/docs/python_metatrader5) |

`OnTradeTransaction` pode produzir vários eventos para uma operação, fora de ordem; sua fila comporta 1024 elementos. Um handler lento pode perder eventos. A proposta é registrar evento curto e reconciliar pelo histórico, sem depender exclusivamente dos callbacks. [Documentação do evento](https://www.mql5.com/en/docs/event_handlers/ontradetransaction).

`WebRequest` é síncrono, exige URL autorizada e não funciona no Strategy Tester. A ponte HTTPS deve ter timeout curto, fila de saída e processamento por timer; não realizar chamadas lentas dentro de `OnTradeTransaction`. Testes puros do protocolo não substituem homologação em terminal com conta habilitada. [WebRequest](https://www.mql5.com/en/docs/network/webrequest).

O pacote Python oficial comunica-se com o terminal MT5, oferecendo conta, ordens, posições e histórico. **Não é uma API REST da corretora nem dispensa o terminal autenticado.** Pode ser alternativa em Windows VPS, preservando o mesmo contrato do Executor. [Integração Python](https://www.mql5.com/en/docs/python_metatrader5).

## Infraestrutura: o PC pessoal pode ficar desligado

O requisito exige hospedar **ATLAS/backend + scheduler + executor/ponte + terminal/gateway** fora do PC, mantendo Supabase acessível. Hospedar apenas o EA deixa o cérebro local desligado e não conclui a migração.

| Opção | O que executa | Custo verificado | Adequação / pendência |
|---|---|---|---|
| **MetaQuotes Virtual Hosting** | Terminal virtual, EAs/indicadores migrados; EA pode usar WebRequest HTTPS | **US$15 por 1 mês**, US$42/3 meses, US$79/6 meses ou US$153/12 meses; câmbio/tributos não incluídos nesta comparação | Pode hospedar EA executor puro; backend ATLAS permanece em hospedagem separada. Não é Windows VPS de uso geral e não acomoda ProfitDLL/Python/backend. Ver restrições abaixo |
| **Genial Cloud template MT5** | Máquina virtual associada à plataforma Genial | **R$41,40** quando não cumprir isenção | Menor mensalidade em reais documentada nesta comparação para template MT5; **não representa custo total ATLAS**. Confirmar Swing, EA próprio, HTTPS externo, acesso/instalação de software e continuidade |
| **Windows VPS de uso geral** | Terminal MT5 + EA ou Python, serviço Executor; eventualmente backend ATLAS | Depende de fornecedor, região, RAM e licença Windows; não contratado neste trabalho | Mais flexível para inspeção, armazenamento durável e supervisão. Ver comparação de infraestrutura no documento específico da integração; precisa provar reinício automático e retorno da sessão do terminal |
| **PC local atual** | ATLAS + scheduler locais, Supabase remoto | Sem nova mensalidade de hospedagem | Não atende continuidade com PC desligado |

Fontes dos preços: [MetaQuotes planos](https://www.mql5.com/en/vps/forex-plans), [Genial Cloud custo](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4409684344212-Quais-ser%C3%A3o-os-custos-caso-eu-n%C3%A3o-cumpra-as-condi%C3%A7%C3%B5es-vigentes).

**Não foi comprovada uma solução completa, permanente e incondicionalmente gratuita para manter ATLAS e gateway em operação com o PC desligado.** A Genial Cloud isenta templates MT5 mediante RLP ativo e ao menos um minicontrato WIN/WDO/BIT/WSP real por ciclo, executado pela plataforma na VM. Essa condição não é satisfeita por uma carteira só de ações. Não acrescentar uma operação de futuro apenas para obter isenção. A documentação pública de elegibilidade cita MetaTrader, sem certificar explicitamente Swing + ponte externa ATLAS. [Regras de isenção](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4409692339476-Quais-s%C3%A3o-as-condi%C3%A7%C3%B5es-para-manter-a-plataforma-com-custo-zero), [elegibilidade](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4409700240404-Quais-s%C3%A3o-as-plataformas-eleg%C3%ADveis-para-este-tipo-de-servi%C3%A7o).

### Limitações decisivas do Virtual Hosting MetaQuotes

O ambiente proíbe DLL e não migra scripts; permite WebRequest com URLs confiáveis configuradas. Não oferece interface gráfica para interações. Contas que exigem OTP a cada conexão não são compatíveis. A migração habilita negociação automática no ambiente virtual mesmo se desativada localmente, e desativa a instância local para evitar duplicidade. Portanto o gateway precisa de bloqueio próprio, comandos com validade, identificação da instância e reconciliação antes de retomar envios. O botão AutoTrading local não pode ser o único mecanismo de parada. [Regras de migração](https://www.metatrader5.com/en/terminal/help/virtual_hosting/virtual_hosting_migration).

## Decisões de projeto derivadas da pesquisa

As regras seguintes são recomendações de engenharia do ATLAS, não garantias oferecidas pelas corretoras:

1. Conservar `BrokerProvider` como fronteira e implementar Executor separado, com caminhos MT5, ProfitDLL e futura API oficial.
2. A ponte não calcula estratégia nem escolhe ativo, direção, quantidade, limite ou horário. Só aceita instrução aprovada, íntegra, identificada, não expirada e vinculada à conta autorizada.
3. Reservar a intenção/ID no armazenamento durável **antes** do envio. `magic`/comentário são correlação; não há garantia documental de chave idempotente imposta pelo servidor. Timeout mantém ordem indeterminada até consulta/reconciliação; jamais repetir cegamente.
4. Serializar escrita por conta e impedir duas instâncias ativas. Após falha, consultar ordens/deals antes de liberar o próximo envio. Não prometer exatamente uma execução em rede distribuída sem evidência do resultado externo.
5. Preservar tickets como strings decimais no contrato JSON, evitando perda de precisão em IDs inteiros grandes; validar lote, step, tick, filling mode e permissões por símbolo.
6. Processar negócio por ID externo e contabilizar apenas delta confirmado. Eventos duplicados, parciais, fora de ordem, cancelamento concorrente e correção de histórico devem ser reconciliados e auditados.
7. Se terminal não oferecer custódia/caixa completo, declarar esse escopo. Nenhum campo desconhecido vira zero nem Treasury infere caixa liquidado de margem livre.
8. A perda do backend/heartbeat bloqueia novos envios; ordens já aceitas continuam existindo externamente até confirmação de cancelamento/execução. Não prometer que queda do EA cancela ordens.

## Etapas externas realmente necessárias

A implementação independente de credenciais pode concluir contratos, persistência, auditoria, validações, protocolo e testes de falhas. Para homologar uma conexão real, o proprietário precisa somente depois:

1. Escolher a corretora, abrir/validar a conta PF e contratar a modalidade MT5 apropriada para ações à vista e overnight desejado.
2. Obter confirmação do escopo: EA próprio/ponte HTTPS, ativos, fracionário, tipos e validade de ordem, permissões de leitura, taxas efetivas, limites, custódia e caixa acessíveis. A confirmação pode ser pelos termos publicados/contratados; não se pressupõe parceria institucional/API privada.
3. Autenticar terminal e fornecer ao ambiente próprio as credenciais oficiais, sem cookies de Home Broker ou contorno de MFA.
4. Selecionar/autorizar a hospedagem e orçamento. MetaQuotes VPS só resolve a ponte; a hospedagem do ATLAS também precisa estar online.
5. Homologar primeiro leitura/reconciliação; usar demo oficial quando existir. Para modalidade sem demo, qualquer teste com ordem real deve ter ativo, quantidade, preço, janela e autorização expressa definidos antes. Live permanece bloqueado até essa etapa.

Nenhum desses passos impede concluir o desacoplamento do código agora. Nenhum provedor deve aparecer como conectado ou homologado apenas porque tem documentação pública.

# ProfitDLL, alternativas e infraestrutura externa

Consulta: **16/09/2026**. Fontes primárias públicas; nenhuma conta aberta, serviço contratado, credencial solicitada ou ordem enviada. Preços precisam de confirmação no checkout, impostos, câmbio e condições da conta. Este documento complementa a pesquisa de corretoras/MT5; não escolhe uma corretora.

## Conclusão técnica

**ProfitDLL é um gateway oficial tecnicamente compatível com o desenho do ATLAS**, incluindo ações Bovespa. A Nelogica inclui traders pessoa física avançados no público-alvo do Data Solution e anuncia integração com Python, C++, C# e Delphi. A página comercial não oferece preço público utilizável para fechar o orçamento. Portanto, é alternativa condicionada a licença de roteamento, disponibilidade na conta e cotação comercial; não pode ser apresentada como gratuita ou automaticamente incluída no Profit da corretora. [Data Solution oficial](https://use.nelogica.com.br/pr-lead-lp-data-solution-aon-enterprise)

A direção prioritária é **gateway MT5 restrito a execução/relato**, sujeito à confirmação da corretora para ações à vista e automação. A implementação desta etapa escolhe o SDK Python oficial com terminal autenticado e journal durável; EA MQL5/WebRequest permanece alternativa pesquisada, ainda não implementada. ProfitDLL permanece adaptador alternativo; API oficial direta permanece possibilidade futura. A decisão e os controles de risco continuam no ATLAS. Consulte a [decisão de integração](../EXECUTION_GATEWAY_DECISION.md).

**Não foi comprovada uma solução Windows permanente, gratuita e apropriada à operação contínua.** É possível tirar o computador pessoal do caminho: ATLAS/scheduler precisam estar em infraestrutura externa, junto com o gateway ou em serviço separado. Hospedar apenas o terminal deixa o cérebro local dependente do computador.

## ProfitDLL: capacidades e limitações verificadas

| Item | Evidência e consequência |
| --- | --- |
| Market data versus execução | `DLLInitializeMarketLogin` fornece dados; `DLLInitializeLogin` também habilita roteamento. Exige licença e conta com permissão de trading. |
| Sistema | DLL nativa Windows, `stdcall`; existem versões Win32/Win64. Preferir processo x64. |
| Aplicação | O consumidor carrega a biblioteca e recebe callbacks. É uma integração programática com a infraestrutura Nelogica, sem automação de interface. |

Fonte: [Ecossistema ProfitDLL e primeiros passos](https://ajuda.nelogica.com.br/hc/pt-br/articles/22396517026203-Ecossistema-ProfitDLL-e-primeiros-passos).

O roteamento documentado cobre B3/Bovespa, inclusive exemplo PETR4. Há envio (`SendOrder`), alteração (`SendChangeOrderV2`), cancelamento (`SendCancelOrderV2`), identificador local de 64 bits, consulta (`GetOrderDetails`) e callbacks de ordem/mensagem de negociação. Os estados incluem execução parcial, execução completa, rejeição e cancelamento após parcial. O retorno imediato não substitui confirmação assíncrona da corretora/mercado. A aplicação precisa validar as conexões e selecionar corretamente conta/corretora; a senha de roteamento é distinta do login Nelogica. [Referência de roteamento](https://ajuda.nelogica.com.br/hc/pt-br/articles/13312468554651-Como-rotear-ordens-com-a-ProfitDLL)

**Lacunas antes de habilitar produção:** assinatura de versão exata do SDK; relação entre identificador local, identificador da corretora e da bolsa; identificador estável de cada execução; cobertura/retenção do histórico de ordens e fills; recuperação após perda de callback; semântica de saldo disponível, garantias e liquidação; posições carregadas/custódia; limites; ambientes de homologação. A publicidade menciona posições/custódia, mas isso não comprova todas as informações de caixa exigidas pelo Treasury. Não substituir saldo ausente por valor estimado.

A Nelogica direciona a contratação/teste ao canal corporativo e entrega o ZIP/manual na área de assinaturas após contratação. Não foi localizado preço público confirmado de ProfitDLL com roteamento para PF. Não baixar binários redistribuídos por terceiros. [Como obter acesso à ProfitDLL](https://ajuda.nelogica.com.br/hc/pt-br/articles/51583791325211-Como-obter-acesso-%C3%A0-ProfitDLL)

## Corretoras e o que ainda deve ser confirmado

A lista oficial de integrações **Profit** inclui, entre outras, XP, Rico, Toro, Genial, Clear, BTG, CM Capital e Terra. Isso demonstra integração da plataforma; **não prova habilitação ProfitDLL de todas essas instituições ou de toda conta PF**. Exigir confirmação específica de roteamento DLL, ações à vista, manutenção de posições entre pregões, consulta de custódia e política de automação. [Corretoras parceiras Nelogica](https://ajuda.nelogica.com.br/hc/pt-br/articles/360045564812-Quais-s%C3%A3o-as-corretoras-parceiras-da-Nelogica)

As ofertas de Profit gratuito têm condições por corretora. Não confundir isenção de Profit Pro/Ultra com licença DLL, market data, módulo de automação ou isenção de corretagem/custódia. Esses valores precisam constar da comparação de corretoras antes da escolha. [Ofertas oficiais](https://www.nelogica.com.br/brokers)

Perguntas objetivas para cotação futura, sem envio automático de mensagem:

1. PF com recursos próprios pode usar ProfitDLL com roteamento de ações à vista e posições carregadas? Quais corretoras/contas estão habilitadas?
2. Qual preço total mensal inclui roteamento, Bovespa, histórico e direitos de uso em VPS Windows? Existe tarifa por conta, conexão, dado ou ordem?
3. A licença requer Profit desktop instalado/aberto? Como ocorre autenticação, expiração, troca de máquina e recuperação após reinício?
4. Quais funções entregam fills identificáveis, posição total/custódia, saldo negociável, valores bloqueados e liquidação? Qual retenção/replay e quais limites?

## Infraestrutura: o que fica online

| Componente | Onde precisa executar |
| --- | --- |
| ATLAS, agentes, Risk, OMS, Treasury, scheduler | Processo/serviço externo disponível durante a operação e reconciliação; banco sozinho não executa a aplicação. |
| MT5 + EA próprio | Terminal externo autenticado. Pode ser Windows completo ou hospedagem virtual MQL5, conforme o transporte escolhido. |
| ProfitDLL + adaptador | Processo Windows x64 externo com SDK/licença, conexões e diário persistente. |
| Banco e auditoria | Supabase existente, com limites do plano e disponibilidade observados. |
| Navegador do proprietário | Somente acesso e administração; pode ser fechado após configurar a infraestrutura externa. |

Estas são conclusões de arquitetura do ATLAS, não garantias de disponibilidade de fornecedor. Desconectar o acesso remoto deve preservar o processo; reinícios, reautenticação e interrupção da rede devem ser ensaiados antes de operações reais. Bloquear novos envios quando gateway, dados ou reconciliação estiverem indisponíveis.

## Custos públicos e planos gratuitos

| Opção | Valor/limite consultado | Adequação |
| --- | --- | --- |
| MQL5 Virtual Hosting | **US$15/mês**, teste de 24h; descontos por prazo existem, mas valores anuais variam entre páginas consultadas e devem ser confirmados no terminal | Hospeda EA/terminal, não o backend Node/Python do ATLAS. Usar apenas se o EA usar recursos permitidos e a conta da corretora aceitar migração. |
| Lightsail Windows + IPv4, 0,5GB | **US$9,50/mês** | Menor preço de catálogo verificado; não recomendado como dimensionamento do ATLAS. |
| Lightsail Windows + IPv4, 2GB | **US$22/mês** | Possível piloto de gateway leve; capacidade não homologada para carga real. |
| Lightsail Windows + IPv4, 4GB | **US$44/mês** | Ponto inicial de avaliação para MT5/bridge e serviços leves; medir memória/CPU e recuperação. |
| Lightsail Windows + IPv4, 8GB | **US$74/mês** | Referência de RAM para avaliar Profit desktop; não comprova compatibilidade completa do SO/CPU. |

Preços AWS incluem o plano Windows, disco e franquia conforme tabela; extras, câmbio e impostos não estão incluídos nos totais acima. São referências verificáveis, não afirmação de menor preço mundial nem orçamento contratado. [Tabela oficial Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), [preços MQL5 VPS](https://www.mql5.com/en/vps).

**MQL5 VPS permite `WebRequest` mediante URLs autorizadas e proíbe DLLs.** Um EA com HTTPS pode se comunicar com ATLAS externo sem DLL. Esse serviço não equivale a Windows/RDP onde instalar livremente o backend ou ProfitDLL. [Migração oficial MT5](https://www.metatrader5.com/en/terminal/help/virtual_hosting/virtual_hosting_migration)

O Profit desktop publica mínimo de **8GB RAM** e Windows 10/11. Não aplicar silenciosamente ao produto DLL isolado, nem vender a VPS 2/4GB como satisfazendo esses requisitos. Confirmar Windows Server para a versão/licença escolhida. [Requisitos Profit](https://www.nelogica.com.br/download)

- **AWS:** novos clientes têm até US$200 de créditos, com plano gratuito encerrando ao esgotar créditos ou completar seis meses. Não é Windows gratuito permanente. [FAQ Free Tier](https://aws.amazon.com/free/free-tier-faqs/)
- **Azure:** benefício anunciado de 750h/mês de determinadas VMs Linux/Windows por 12 meses para elegíveis; não abrange indiscriminadamente discos/IP/tráfego. [Oferta oficial](https://azure.microsoft.com/en-us/pricing/purchase-options/azure-account). Após crédito inicial de 30 dias, é necessário migrar a modalidade da conta para continuar serviços; excedentes podem cobrar. [Condições e cobrança](https://learn.microsoft.com/en-us/azure/cost-management-billing/manage/avoid-charges-free-account)
- **Oracle Always Free:** documentação consultada informa A1 ARM equivalente a **2 OCPUs/12GB**, micro AMD e imagens Linux elegíveis. Não confirma Windows x64 gratuito. Há indisponibilidade de capacidade e possibilidade de recolher instâncias ociosas. Pode ser avaliado para backend Linux, não tratado como garantia de gateway Windows contínuo. [Limites atuais OCI](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm)

O custo completo é **gateway/plataforma + infraestrutura do backend + banco/dados + corretagem/taxas**, descontadas apenas isenções expressamente confirmadas. MQL5 VPS a US$15 não resolve sozinho backend ainda local. Uma VPS Windows completa pode concentrar terminal, bridge e ATLAS para simplificar a implantação inicial, com dimensionamento/monitoramento; é uma opção técnica, ainda sem contratação autorizada.

## Outras alternativas oficiais

**Tryd Scripts:** API oficial com processos Groovy, envio e eventos de alteração de ordem; negociação exige corretora homologada para scripts. É candidato futuro para adaptador, mas não foi comprovado custo/acesso PF completo nem interface externa e dados de reconciliação suficientes para substituir MT5 agora. [Manual de scripts](https://www.tryd.com.br/manual/HTML/scripts.htm?printWindow=&toc=0), [API publicada](https://cdn.tryd.com.br/manual/APISCRIPT/javadoc/stScript/process/api/package-summary.html)

**SmarttBot:** há documento oficial de API/MetaBot de **2022**, voltado a sinais/replicação, com exemplos de WIN/WDO e restrições de sincronização. Não constitui prova atual de API genérica de execução/custódia de ações à vista para qualquer PF. Manter fora do caminho principal enquanto disponibilidade atual, preços, ações e relatórios de execução não forem confirmados. [Documento oficial histórico](https://smarttbot.com/wp-content/uploads/2022/05/Informacoes-API-SmarttBot-1.pdf)

**Automação nativa Profit/NTSL:** a documentação exige plataforma aberta no computador; não elimina hospedagem e não comprova uma entrada genérica de ordens externas já aprovadas. Não mover estratégias/decisão do ATLAS para NTSL só para usar a automação. [Operação da automação Profit](https://ajuda.nelogica.com.br/hc/pt-br/articles/8865257831195-Como-utilizar-a-Automa%C3%A7%C3%A3o-de-Estrat%C3%A9gias)

## Próximo limite externo real

Pode-se implementar contratos, adaptadores, diário de idempotência, reconciliação e testes sem contratar nada. A homologação da rota real exige escolha do proprietário de corretora/conta e hospedagem, contratação/licença quando aplicável e autenticação pessoal. Até isso, não declarar gateway conectado nem liberar operações reais.

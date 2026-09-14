# ATLAS — viabilidade técnica

Verificação: 13/09/2026. Decisão da fase 0: **prosseguir com a plataforma; execução B3 e transferências permanecem BLOCKED** até acesso oficial, autorização e testes. Não existe conexão de corretora configurada neste repositório. Nenhuma cotação, saldo ou execução será fabricada para preencher a interface.

## Conclusões

1. **API para pessoa física existe como possibilidade comercial.** A [Cedro descreve API Trading REST para B3, inclusive pessoa física](https://cedrotech.com/blog/roteamento-de-ordens-via-api-b3-bmf-e-bovespa/). A disponibilidade para a conta do proprietário, corretora parceira, preço, permissões e contrato precisam ser confirmados. Não equivale a uma API gratuita universal de XP/Genial. A autenticação documentada precisa ser confrontada com a proibição do pedido de reaproveitar cookies de home broker.
2. Plataformas como MetaTrader e Profit oferecem automação oficial em determinadas corretoras; um robô dentro dessas plataformas não é automaticamente um adaptador HTTP/cloud para o ATLAS. Modalidade, ações à vista, manutenção de posição, reconciliação e ambiente precisam ser verificados. Comparação detalhada: [BROKER_RESEARCH.md](BROKER_RESEARCH.md).
3. **brapi é dado complementar com atraso**, sem garantia de feed negociável. [A própria fornecedora declara não ser distribuidora licenciada B3](https://brapi.dev/faq/a-brapi-e-distribuidora-licenciada-da-b3). Adaptador de leitura e pesquisa pode ser implementado; ordens exigirão dado oficial elegível, sessão de mercado e validade confirmadas. [DATA_RESEARCH.md](DATA_RESEARCH.md) registra contratos atuais e limites.
4. Banco Central, IBGE e CVM permitem pesquisa de dados públicos. Séries macroeconômicas e balanços têm periodicidade própria; nunca serão tratados como cotação instantânea.
5. PIX/Open Finance não são uma API universal de movimentação para qualquer CPF. Depósitos/retiradas devem permanecer instruções manuais, sem QR falso nem confirmação por clique, até provider oficial permitir confirmação independente.
6. **R$0 e todas as exigências cloud não estão comprovados juntos.** [Vercel Hobby](https://vercel.com/docs/plans/hobby) tem restrições de uso; [Cron Hobby](https://vercel.com/docs/cron-jobs/usage-and-pricing) não atende execução a cada minuto. Scheduler central será preparado com Supabase Cron, limites de tempo e leases persistentes. Não contratar planos nesta entrega. Consulte [COST.md](../COST.md).

## Bloqueios e evidências exigidas

| Gate | Estado | Evidência necessária para liberar |
|---|---|---|
| Corretora B3 / conta PF | BLOCKED | Contrato/documentação que permite automação para esta conta e esta modalidade |
| Credencial de execução | BLOCKED | Credencial oficial server-side, escopos mínimos, expiração e revogação testadas |
| Confirmação e recuperação de ordem | BLOCKED | Consulta por identificador idempotente, fills únicos, cancelamento e timeout certificados |
| Feed elegível e sessão B3 | BLOCKED | Contrato de atualidade/licença, calendário e estados intraday oficiais |
| Supabase ATLAS | PENDING | Projeto isolado e proprietário cadastrado; não reutilizar banco de outro produto |
| Infra cloud | PENDING | Hospedagem compatível com termos e limites; monitoramento/backup testados |
| PIX automatizado | BLOCKED | API que suporta conta e operação; callback/consulta independente e idempotência |
| Live readiness | BLOCKED | Risco, MFA, ledger, reconciliação, certificação provider e testes ponta a ponta aprovados |

## Escopo autorizado agora

Construir Next.js/TypeScript, schema PostgreSQL com RLS, autenticação e TOTP, dados reais de leitura, agentes configuráveis, propostas auditáveis, indicadores determinísticos, pesquisa histórica separada de produção, risco central, contratos OMS, ledger e scheduler. Test doubles exclusivamente em testes. Não implementar providers de corretora presumidos, nem enviar ordens, nem criar serviços pagos.

Ausência de documentação encontrada significa **não comprovado**, e não prova de inexistência. O menor custo para API própria permanece sob consulta; preços publicados de plataformas só serão comparados dentro de suas restrições reais. Estudos e fontes complementares podem ser refinados sem alterar esses bloqueios.

## Escolha de arquitetura

Monólito modular TypeScript para reduzir operação e custo. Next.js fornece painel e API privada. PostgreSQL é a autoridade para saldos, locks, jobs, trilha de auditoria e ordens. Supabase Auth identifica um único proprietário; AAL2 protege dados e mutações. Apenas Execution Engine poderá depender de BrokerProvider. A decisão de interface é posterior a esta investigação. Detalhes em [ARCHITECTURE.md](ARCHITECTURE.md); sequência e pendências em [ROADMAP.md](ROADMAP.md).

## Critério de término

ATLAS só será considerado operacional para trading após demonstrar: dado real → análise → proposta → risco → envio oficial → confirmação → fill → reconciliação → ledger → painel → auditoria. Nesta entrega, trechos sem infraestrutura/credenciais ficam explicitamente PENDING/BLOCKED; passar testes locais não os certifica.

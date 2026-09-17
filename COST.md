# ATLAS — custos e limites

Pesquisa geral de preços: **13/09/2026**; gateway/infraestrutura atualizados em **16/09/2026**. Valores em moeda original; não há conversão cambial estimada nem impostos presumidos. Nenhum plano pago foi contratado. **A instalação atual é aplicação local + Supabase Free.** O projeto ATLAS foi criado por US$ 0/mês na região `sa-east-1`; não houve cobrança de hospedagem Next.js porque ela permanece local. A nova arquitetura prepara execução externa por MT5; o fluxo completo de execução B3 em nuvem a custo zero não foi comprovado. Custos de corretora dependem da habilitação da conta, ainda inexistente.

O Supabase já está configurado; não há bloqueio por falta de projeto ou necessidade de recriar o banco. A conta Vercel consultada é Hobby, mas publicação e scheduler remoto foram adiados por escolha do proprietário. O computador precisa permanecer ligado para executar a aplicação local.

## Serviços e limites comprovados

| Serviço | Uso | Faixa gratuita / limite relevante | Ao exceder / custo conhecido | Alternativa ou decisão |
| --- | --- | --- | --- | --- |
| brapi Gratuito | Consulta e pesquisa com atraso | 15.000 chamadas/ciclo; 1 ticker por chamada; atraso ~30 min | Chamadas podem ser recusadas até renovar/upgrade | Cache central; menor frequência; feed da corretora para validar execução |
| brapi Startup / Pro | Mais histórico e menor atraso | Não gratuito | Página de preços exibia **R$ 1.199,90/ano Startup** e **R$ 1.399,90/ano Pro**, ofertas anuais. Equivalentes exibidos R$ 99,99 e R$ 116,66/mês **não são mensalidade avulsa** | Não contratar automaticamente; tabela no checkout prevalece |
| CVM, BCB, IBGE | Fundamentos, séries macro e notícias IBGE | Dados públicos consultados sem cobrança de assinatura | Não foi confirmado SLA/limite universal; disponibilidade pode falhar | Cache/versionamento, backoff, análise bloqueada quando dados essenciais faltarem |
| Supabase Free | PostgreSQL, Auth, funções, persistência | US$ 0; 500 MB banco; 1 GB storage; 5 GB egress e 5 GB cached egress; 500.000 invocações Edge/mês; 2 projetos ativos | Pode pausar após 1 semana inativo; exceder quotas pode restringir serviço; 500 MB pode acionar banco read-only | Retenção de caches e logs operacionais, exportação de backup. Nunca eliminar ledger para liberar espaço |
| Supabase Pro | Persistência sem pausa por inatividade | Não gratuito | A partir de US$ 25/mês; extras dependem de uso/compute | Somente após necessidade comprovada e autorização do proprietário |
| Vercel Hobby | Frontend de desenvolvimento elegível | US$ 0, uso pessoal não comercial; cron no máximo diário | Restrições de quota/uso; não é plano intraday | Não pressupor elegibilidade do ATLAS com objetivo de ganho financeiro |
| Vercel Pro | Frontend/rotas em uso comercial | Não gratuito | US$ 20/mês, um assento de deploy e US$ 20 de crédito; excedentes sob demanda | Manter alvo Vercel solicitado, mas resolver plano antes de publicar operação live |
| Cloudflare Workers Free | Alternativa de dispatcher / hospedagem a avaliar | 100.000 requisições/dia; CPU de 10 ms/invocação inclusive cron | Excesso de recursos falha; Paid parte de US$ 5/mês mais consumo | Adequado apenas após medir workload; não assumir que Next.js SSR ou análise pesada cabe em 10 ms |
| Efí Pix API | Candidato de recebimento / tesouraria | Integração sem mensalidade não implica operação gratuita | Tabela pública anuncia **1,19% do valor recebido** por QR dinâmico/API; envio e condição ATLAS não confirmados | PIX manual pelo app oficial e reconciliação, sem cobrar a própria conta desnecessariamente |
| Gateway MT5 / conta B3 | Ordem real, posições e reconciliação | Licença MT5 Swing Genial publicada R$0; outras ofertas MT5 gratuitas têm escopo/condições próprios | Plataforma gratuita não elimina VPS, corretagem, emolumentos, dados e conciliação financeira | Nenhuma corretora selecionada; ver comparação atual abaixo |
| LLM | Classificação/resumo de notícias | Nenhum crédito recorrente gratuito foi assumido | Provider/modelo não selecionados; custo **não confirmado** | Análise determinística e estado UNCLASSIFIED, com IA opcional desativada por padrão |

Fontes para a tabela: [brapi comparação](https://brapi.dev/faq/por-que-escolher-o-plano-pro-em-vez-do-gratuito-ou-startup), [brapi preços](https://brapi.dev/pricing), [brapi excedente](https://brapi.dev/faq/tem-algum-limite), [Supabase preços](https://supabase.com/pricing), [Supabase tamanho de banco](https://supabase.com/docs/guides/platform/database-size), [Supabase billing FAQ](https://supabase.com/docs/guides/platform/billing-faq), [Vercel Hobby](https://vercel.com/docs/plans/hobby), [Vercel Pro](https://vercel.com/docs/plans/pro-plan), [Cloudflare preços](https://developers.cloudflare.com/workers/platform/pricing/), [Cloudflare limites](https://developers.cloudflare.com/workers/platform/limits/), [Efí tarifas](https://sejaefi.com.br/tarifas). Fontes governamentais e direitos de uso: [DATA_RESEARCH.md](docs/DATA_RESEARCH.md).

O Security Advisor apontou proteção contra senhas vazadas desativada. Esse recurso exige Supabase Pro ou superior; ele não está incluído no projeto Free atual. Senha e TOTP estão configurados e o acesso com MFA foi validado na instalação atual. [Segurança de senhas Supabase](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Gateway e operação externa sem o computador pessoal

A ponte inicial usa o pacote Python oficial MetaTrader5 junto ao terminal. Uma VPS Windows de uso geral pode manter **ATLAS/backend + scheduler + Executor/ponte + terminal** online, com Supabase remoto. Hospedar apenas a plataforma não elimina a dependência do backend local. Não houve contratação. Decisão completa: [EXECUTION_GATEWAY_DECISION.md](docs/EXECUTION_GATEWAY_DECISION.md).

| Componente / alternativa | Preço publicado consultado em 16/09/2026 | Condição material |
| --- | --- | --- |
| Genial MT5 Swing | Licença **R$0** | EA próprio/Netting/overnight documentados; confirmar Python, ativos, taxas e dados financeiros da conta. Sem demo Swing. |
| Genial Cloud template MT5 | **R$41,40** sem isenção | Não comprova instalação de Python/Node nem elegibilidade Swing. Isenção exige RLP e minicontrato; carteira só de ações não satisfaz essa condição. |
| MetaQuotes Virtual Hosting | **US$15/mês** | Hospeda EA/WebRequest; não é VM geral e não hospeda a ponte Python ou o backend Node. Requer alternativa EA, ainda não implementada. |
| Lightsail Windows + IPv4, 0,5GB | **US$9,50/mês** | Menor linha de catálogo verificada; não é dimensionamento adequado comprovado. |
| Lightsail Windows + IPv4, 2GB / 4GB / 8GB | **US$22 / US$44 / US$74 por mês** | Candidatos a medir. 4GB é referência inicial de avaliação MT5/serviços leves; Profit desktop exige 8GB mínimo, distinto da DLL isolada. |
| ProfitDLL com roteamento | **Sob consulta** | Licença Profit desktop gratuita não comprova licença DLL, dados, roteamento ou habilitação da corretora. |

Fontes: [Genial Swing](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/8180931823764-Qual-o-custo-do-MetaTrader-na-Genial-Swing-Trade), [Genial Cloud](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4409684344212-Quais-ser%C3%A3o-os-custos-caso-eu-n%C3%A3o-cumpra-as-condi%C3%A7%C3%B5es-vigentes), [isenção Cloud](https://suporte.genialinvestimentos.com.br/hc/pt-br/articles/4409692339476-Quais-s%C3%A3o-as-condi%C3%A7%C3%B5es-para-manter-a-plataforma-com-custo-zero), [MetaQuotes preços](https://www.mql5.com/en/vps/forex-plans), [restrições de hospedagem](https://www.metatrader5.com/en/terminal/help/virtual_hosting/virtual_hosting_migration), [planos Lightsail](https://docs.aws.amazon.com/lightsail/latest/userguide/amazon-lightsail-bundles.html), [ProfitDLL contratação](https://ajuda.nelogica.com.br/hc/pt-br/articles/51583791325211-Como-obter-acesso-%C3%A0-ProfitDLL), [requisitos Profit](https://www.nelogica.com.br/download).

Os preços acima não constituem cotação do sistema completo nem escolha de fornecedor. Inclua câmbio, impostos, região, tráfego/armazenamento excedentes, licença aplicável, dados e taxas operacionais. Não foi comprovada solução Windows permanente gratuita: créditos AWS e benefícios Azure são temporários/condicionados; OCI Always Free não comprova Windows x64 gratuito e pode ter restrição de capacidade. Evidências e limites em [PROFIT_INFRA_RESEARCH.md](docs/research/PROFIT_INFRA_RESEARCH.md).

Comparação de conta PF, corretagem, custódia, licença e volume mínimo de Genial, XP, Rico e Clear em [MT5_GATEWAY_RESEARCH.md](docs/research/MT5_GATEWAY_RESEARCH.md). A integração Profit anunciada por uma corretora não comprova automaticamente ProfitDLL. A API direta institucional/privada deixou de ser requisito principal do orçamento do ATLAS.

## Opção de scheduler remoto para uma etapa futura

O código e o SQL estão preparados para **Supabase Cron + Edge Functions**, com um orquestrador e fila persistida por `next_analysis_at`. Essa implantação foi adiada; a aplicação permanece local. Cron é baseado em `pg_cron`, executa SQL ou HTTP e suporta frequências de segundos a anuais. A documentação recomenda até 8 jobs concorrentes e duração de até 10 minutos; isso é orientação do cron, não extensão da duração de uma Edge Function. [Supabase Cron](https://supabase.com/docs/guides/cron).

O padrão oficial usa `pg_cron` + `pg_net` e segredos no Vault para chamar funções. A invocação precisa autenticar o dispatcher; não deixar endpoint público de execução sem autenticação. Transações no banco adquirem lease com expiração, claim único de job e idempotência; horário do banco evita depender do computador pessoal. [Agendamento de Edge Functions](https://supabase.com/docs/guides/functions/schedule-functions).

Edge Functions Free têm 256 MB de memória, 150 s de duração e 2 s de CPU por requisição; espera de rede não conta como CPU. Jobs precisam ser curtos e em lotes. Backtest extenso e descompactação de toda a base histórica CVM não devem ocorrer no mesmo tick. Conexão WebSocket permanente com broker não é garantida por esse desenho e pode exigir worker dedicado. [Limites Edge](https://supabase.com/docs/guides/functions/limits).

Vercel Cron Hobby admite execução no máximo diária e pode disparar em qualquer momento da hora configurada. Portanto, **não atende estratégias de 1, 5, 15 ou 60 minutos**. Não criar loop infinito em função, nem contornar quota por múltiplos projetos. [Gerenciamento e precisão do Cron Vercel](https://vercel.com/docs/cron-jobs/manage-cron-jobs).

Sem SLA no Free e com possibilidade de pausa/restrição, essa arquitetura é candidata de desenvolvimento/ingestão. Live readiness exige medir disponibilidade, reconciliação, orçamento e comportamento de falha; **não prometer trading contínuo garantido a custo zero**. Backups automáticos não estão incluídos no Supabase Free e logs de plataforma não substituem trilha financeira persistente. [Planos Supabase](https://supabase.com/pricing).

## Restrição material do Vercel Hobby

A política limita Hobby a uso pessoal não comercial e define uso comercial por objetivo de ganho financeiro. **Inferência de projeto:** ATLAS operando capital para lucro não deve presumir elegibilidade no Hobby. Manter deploy live pendente até usar plano adequado ou obter esclarecimento da Vercel; não afirmar que o usuário está proibido sem essa avaliação. A alternativa gratuita Cloudflare ainda requer validação de termos, compatibilidade e desempenho antes de substituir o alvo solicitado. [Política oficial Vercel](https://vercel.com/docs/limits/fair-use-guidelines).

## Dimensionamento transparente

Os números abaixo são cálculos de planejamento, **não medições da conta**:

- Um dispatcher por minuto, 24 horas por dia, durante 30 dias: `60 × 24 × 30 = 43.200` invocações. Cabe numericamente em 500.000; invocações adicionais, retries e demais funções também consomem a quota.
- 30 ativos, uma chamada por ativo a cada 30 minutos, durante uma janela hipotética de 7 horas em 22 dias: `30 × 14 × 22 = 9.240` chamadas. Pesquisa, histórico e reprocessamento são adicionais. São hipóteses, não calendário de pregão oficial.
- A mesma hipótese a cada minuto: `30 × 420 × 22 = 277.200` chamadas; excede a cota gratuita e não elimina atraso do feed.

Política de custos ATLAS: limite de chamadas persistido, cache compartilhado entre agentes, filas limitadas, alerta antes do teto, stop de ingestão não essencial e nenhuma criação automática de serviço pago. Para seguir com infraestrutura preferida em planos pagos de entrada, **US$ 20 Vercel + US$ 25 Supabase = US$ 45/mês** é apenas soma dessas duas assinaturas, excluindo impostos, câmbio, market data, broker e IA; não é cotação do sistema live completo.

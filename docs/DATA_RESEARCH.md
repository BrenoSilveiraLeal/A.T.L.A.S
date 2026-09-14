# ATLAS — pesquisa de dados, notícias, macro, calendário e tesouraria

Consulta documental: **13/09/2026**. Escopo: uso pessoal, ações B3 à vista, sem alavancagem. Documentação pública é evidência de uma capacidade oferecida; não comprova habilitação da conta do proprietário, contratação, disponibilidade contínua ou homologação do ATLAS. Preços e quotas estão em [COST.md](../COST.md).

## Decisão de integração

1. Usar **brapi como fonte complementar de consulta e pesquisa**, com atraso explicitamente identificado. Não liberar execução usando apenas esse feed.
2. Usar **BCB e IBGE diretamente para macro** e **CVM para demonstrações financeiras**, preservando proveniência, versão e data em que o dado ficou disponível.
3. Iniciar notícias com **API oficial do IBGE**. Adicionar comunicados CVM, Banco Central e RI apenas por recursos públicos documentados/verificados; não inventar endpoints de RSS.
4. Separar calendário previsto da bolsa e **estado efetivo de negociação**, que depende de fonte operacional autorizada. Calendário sozinho não detecta ativo suspenso, leilão ou circuit breaker.
5. Manter depósito e retirada como **pendentes de confirmação independente** até existir provider bancário/corretora aprovado. PIX não cria capital disponível por renderizar um QR Code.

Essas são decisões de projeto. As evidências e limitações abaixo sustentam sua implementação; integração sem teste e sem credencial permanece PENDING.

## brapi

A documentação atual apresenta API REST v2: cotação `/api/v2/stocks/quote`, histórico `/api/v2/stocks/historical`, cadastro `/api/v2/stocks/profile`, fundamentos e busca `/api/v2/tickers`. A consulta usa `symbols`, e cada resultado contém `requestedSymbol`, `symbol`, `changed` e `data`. PETR4, VALE3, MGLU3 e ITUB4 são exemplos abertos sem token; outros ativos exigem autenticação. Esses quatro ativos **não constituem universo fixo do produto**. O token deve ir no header `Authorization: Bearer`, no backend. [Documentação brapi](https://brapi.dev/docs).

| Plano | Requisições por ciclo mensal | Ativos por chamada | Atraso aproximado ações | Histórico OHLCV anunciado |
| --- | ---: | ---: | --- | --- |
| Gratuito | 15.000 | 1 | 30 minutos | 3 meses |
| Startup | 150.000 | 10 | 15 minutos | 1 ano |
| Pro | 500.000 | 20 | 5 minutos | Mais de 10 anos |

Fonte: [comparação oficial dos planos](https://brapi.dev/faq/por-que-escolher-o-plano-pro-em-vez-do-gratuito-ou-startup). Números de preço devem ser conferidos no checkout: a página de planos destaca cobrança anual e ofertas, enquanto algumas FAQs citam preços mensais.

O Startup anuncia candles diários; o Pro inclui intervalos intraday de 1, 2, 5, 15, 30, 60 e 90 minutos, entre outros. Disponibilidade de um candle de 1 minuto **não implica atualização em tempo real**. A cobertura exata por ativo, período e permissão precisa ser conferida na resposta da API. [Planos e cobertura](https://brapi.dev/pricing).

O histórico documenta OHLCV e `adjustedClose`. Antes de backtests, validar splits/dividendos, histórico de alteração de ticker, diferenças entre preço ajustado e negociável e convenção de ajustes; não inferir que todas as colunas são ajustadas porque existe `adjustedClose`. [Histórico documentado](https://brapi.dev/docs/acoes/historico).

`regularMarketTime` representa o timestamp informado para a cotação; `requestedAt` representa a resposta, não a idade econômica do preço. Polling rápido não remove delay. A execução deve rejeitar timestamp ausente, futuro ou incompatível com sessão e tolerância configurada. [Cotação documentada](https://brapi.dev/docs/acoes/cotacao), [frequência de atualização](https://web-next.brapi.dev/faq/qual-a-frequencia).

Ao atingir a cota, novas chamadas podem ser recusadas até renovação/upgrade; o ciclo não necessariamente começa no primeiro dia do mês. Não foi confirmado limite separado de burst por segundo/minuto. Tratar HTTP 429/5xx, `Retry-After` quando existir, backoff, cache compartilhado e orçamento de consumo sem prometer requisições ilimitadas. [Limites e renovação](https://brapi.dev/faq/tem-algum-limite).

A brapi declara **não ser distribuidora ou redistribuidora licenciada B3**, não fornecer SLA nem feed profissional tick-by-tick/livro. Informa trabalhar com fontes públicas e permitir armazenamento/cache e indicadores dentro do produto, sem fornecer dados brutos a terceiros como feed concorrente. Isso não comprova que a cadeia de dados atende requisitos de uma futura corretora. [Declaração oficial de licenciamento](https://brapi.dev/faq/a-brapi-e-distribuidora-licenciada-da-b3).

Os termos concedem licença limitada e proíbem redistribuição/sublicenciamento de dados, proxy público concorrente e exceder o plano. A documentação comercial avisa que automação de negociação pode demandar licenças adicionais. **Decisão ATLAS:** brapi marcada DELAYED e `executionEligible=false`; feed autorizado da corretora será requisito distinto de live readiness. [Termos](https://brapi.dev/legal/terms-of-use), [uso em aplicações](https://brapi.dev/faq/posso-usar-a-brapi-para-construir-um-app-comercial-ou-para-minha-empresa).

## Fundamentos e macro oficiais

| Fonte | Uso e interface comprovada | Limite / decisão ATLAS |
| --- | --- | --- |
| CVM DFP | Demonstrações anuais; arquivos CSV em ZIP e dicionário de dados | Conjunto atualizado semanalmente, licença ODbL. Ingestão incremental por versão; não usar como feed instantâneo de resultados |
| CVM ITR | Demonstrações trimestrais; arquivos e dicionário públicos | Atualização semanal. Guardar CNPJ/código CVM, exercício, versão e momento de disponibilidade; mapear ativo por cadastro separado |
| BCB SGS | Séries JSON/CSV, por código e datas. Série 432 = meta Selic, percentual anual | Séries diárias exigem filtros e janelas de até 10 anos desde 26/03/2025. Rejeitar observações futuras. Rate limit/SLA específico não confirmado |
| BCB Focus | Serviço oficial OData de expectativas de mercado | Expectativas são estimativas dos respondentes, não fatos futuros conhecidos; guardar data de referência e divulgação |
| IBGE Agregados v3 | API de agregados, metadados, períodos, variáveis e localidades | Selecionar série por metadados, unidade e periodicidade; revisões exigem versionamento. Quota/SLA universal não confirmado |

Fontes: [CVM DFP](https://dados.cvm.gov.br/dataset/cia_aberta-doc-dfp), [CVM ITR](https://dados.cvm.gov.br/dataset/cia_aberta-doc-itr), [BCB SGS 432](https://dadosabertos.bcb.gov.br/dataset/432-taxa-de-juros---meta-selic-definida-pelo-copom), [BCB Expectativas](https://dadosabertos.bcb.gov.br/dataset/expectativas-mercado), [API IBGE Agregados](https://servicodados.ibge.gov.br/api/docs/agregados?versao=3).

A CVM e a série BCB citadas publicam licença ODbL. Preservar atribuição e metadados da licença por conjunto; não assumir a mesma licença para todo conteúdo de qualquer site governamental. A documentação técnica IBGE consultada não resolve todos os direitos sobre imagens/texto jornalístico; armazenar apenas metadados e resumo próprio necessários, preservando link original.

Receita, dívida, caixa e lucro vêm de rubricas contábeis. EBITDA e múltiplos dependem de definições e reconciliação: não converter rubricas por nome aproximado nem tratar valor faltante como zero. Toda análise precisa distinguir individual/consolidado, moeda/escala e reapresentação. Backtests só podem usar a versão publicada até o instante avaliado; a data de fechamento do trimestre não é a data em que o mercado conheceu o resultado.

## Notícias reais

A API oficial IBGE Notícias v3 fornece notícias/releases com paginação e filtros `qtd`, `page`, `de`, `ate` e `busca`. Endpoint documentado: `/api/v3/noticias/`. Usar HTTPS. É a primeira fonte implementável sem contratação, voltada a contexto macro e divulgação estatística; não cobre todas as empresas ou acontecimentos globais. [API Notícias](https://servicodados.ibge.gov.br/api/docs/noticias?versao=3).

Banco Central mantém página de notícias e anunciou distribuição RSS. A página de catálogo RSS exigiu JavaScript nesta consulta; **nenhum URL XML específico foi validado**. CVM mantém página oficial de notícias, mas não foi confirmada API/RSS corrente. RI por emissor deve ter URL e permissão verificados separadamente. Não chamar uma URL construída por convenção de integração pronta. [Notícias BCB](https://bcb.gov.br/noticias), [comunicação BCB sobre RSS](https://www.bcb.gov.br/detalhenoticia/657/noticia), [notícias CVM](https://www.gov.br/cvm/pt-br/assuntos/noticias?b_start%3Aint=0).

Contrato proposto: `source`, `url`, `publishedAt`, `retrievedAt`, `contentHash`, `eventClusterId`, empresas/tickers e análise versionada. URL ausente impede ingestão como notícia. Deduplicar URL canônica, hash de texto normalizado e evento; 30 republicações não são 30 evidências. Guardar pontuações desconhecidas como `null`/UNCLASSIFIED, sem atribuir sentimento inventado. Classificação determinística pode identificar entidades; sentimento/impacto de IA exige implementação e deve mostrar versão, confiança e fontes.

Conteúdo externo será entrada não confiável: nunca instrução de sistema, ferramenta executável ou autorização de ordem. Limitar tamanho/tipo, bloquear DTD/entidades externas em XML, validar destinos de fetch para evitar SSRF, não executar HTML, extrair apenas campos esperados e isolar qualquer LLM das credenciais e do Execution Engine. Esses são requisitos do ATLAS, não garantias das fontes.

## Calendário e estado operacional B3

A B3 publica calendário 2026 e comunicados de alterações. O calendário inclui feriados, ausência de pregão em 24/12 e 31/12, horário especial na quarta-feira de Cinzas e funcionamento normal em 09/07. Existe errata posterior: revalidar a versão oficial antes de importar, em vez de usar apenas um calendário genérico de feriados brasileiros. [Calendário B3 2026](https://www.b3.com.br/pt_br/noticias/calendario-de-negociacao-da-b3-confira-o-funcionamento-da-bolsa-em-2026.htm), [errata 041/2026-VNC](https://www.b3.com.br/data/files/20/57/01/AA/06A1F910ADC36BE9AC094EA8/OC%20041-2026-VNC%20ERRATA%20-%20CALENDARIO%20DE%20FERIADOS%20EM%202026_PT.pdf).

A grade de ações alterada em 09/03/2026 especifica negociação contínua à vista das 10h às 16h55, call até 17h e fases separadas de after-market, com exceções por mercado e vencimento. Não presumir horário eterno nem considerar todas essas fases equivalentes. Usar `America/Sao_Paulo`, períodos com vigência e fonte do comunicado. [Ofício B3 005/2026-PRE, anexo 3](https://www.b3.com.br/data/files/E3/B2/C2/12/BC09C910F37907C9AC094EA8/OC%20005-2026%20PRE%20NOVOS%20HORARIOS%20DE%20NEGOCIACAO_PT.pdf).

**PENDING:** feed autorizado de sessão efetiva, leilão por instrumento, suspensão e circuit breaker. A página de market data B3 não comprova acesso direto gratuito de pessoa física a todos esses eventos. Até validação, `UNKNOWN` bloqueia ordens; calendário indica apenas abertura prevista. [Market Data B3](https://www.b3.com.br/pt_br/market-data-e-indices/servicos-de-dados/market-data/).

## PIX / Open Finance

O Banco Central publica a **especificação** OpenAPI da API Pix; o repositório consultado informa release 2.10.0 e remete segurança aos manuais. Isso não é um servidor de pagamentos público nem uma chave que qualquer PF possa gerar no Banco Central. Integração depende do PSP que mantém a conta, dos endpoints permitidos e da habilitação. [API Pix oficial](https://github.com/bacen/pix-api).

Somente instituições autorizadas pelo BC participam diretamente do Open Finance, com regras para participantes obrigatórios e voluntários. Um aplicativo pessoal não se torna participante por implementar OAuth. O proprietário pode consentir em fluxos de um participante/provedor autorizado, quando o produto o suportar. [FAQ oficial Open Finance](https://bcb.gov.br/meubc/faqs/s/open-finance).

| Caminho | Evidência | Resultado para ATLAS pessoal |
| --- | --- | --- |
| Banco Inter APIs Pix/Banking | Documentação de ajuda informa exclusividade PJ; PF e MEI excluídos | Não selecionar como provider PF. API bancária também não comprova ordem B3 |
| Efí API Pix | Credenciais, certificado e autorização documentados; tarifa pública de recebimento API | Candidato a investigar com conta habilitada, sem afirmar acesso do proprietário ou tarifa de envio |
| Efí Open Finance | API opera por intermédio da iniciadora Efí; termos incluem integrador PF/PJ e certificado | Possível caminho oficial sujeito a termos, escopos, consentimento e aprovação do caso de uso; não integrado |
| Aplicativo oficial banco/corretora | Transferência iniciada pelo próprio proprietário | Fallback inicial: instrução manual e pendência de reconciliação independente |

Fontes: [Inter — disponibilidade de APIs](https://ajuda.inter.co/conta-digital-pessoa-juridica/o-inter-disponibiliza-alguma-api-para-minha-conta-digital-pj), [Efí credenciais Pix](https://dev.efipay.com.br/docs/api-pix/credenciais/), [Efí Open Finance](https://dev.efipay.com.br/docs/api-open-finance/credenciais/), [termos Efí Open Finance](https://dev.efipay.com.br/pdfelement/Termos_e_condicoes_de_uso_API_Open_Finance.pdf).

**Decisão de tesouraria:** não criar conta por agente nem intermediário de cobrança só para gerar QR Code. Entrada na conta bancária do dono não equivale a saldo na corretora. Registrar intenção; reconciliar liquidação, titularidade, identificador e valor líquido na conta real de investimentos antes de disponibilizar capital. Webhook validado sinaliza mudança; consulta ao provider confirma. Extrato manual é evidência importada, com origem e revisão, sem fingir reconciliação automática. `ATLAS_OWNER_PIX_KEY` fica exclusivamente em segredo server-side. Retirada permanece `REQUIRES_MANUAL_CONFIRMATION` sem provider oficial.

## Verificação documental e lacunas

- A leitura pública de [cotação brapi v2](https://brapi.dev/api/v2/stocks/quote?symbols=PETR4) retornou JSON compatível com o envelope documentado e timestamps separados. Isso verifica formato acessível pela ferramenta web, não autenticidade de mercado ou SLA.
- A ferramenta web retornou uma observação datada **16/09/2026** no [SGS últimos/1](https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json), posterior à data desta sessão. Não foi aceita como observação corrente; implementar quarentena de datas futuras e consulta por janela fechada.
- O fetch de notícias IBGE pela ferramenta web falhou por restrição da ferramenta; documentação foi acessada. Teste de ingestão JSON no runtime de implantação continua PENDING.
- Rede direta do terminal não estava disponível nesta pesquisa. Não se realizou teste de carga, sandbox bancário, subscrição paga ou transação financeira.
- Feed confiável para executar, direitos específicos de automação, corporate actions completos, cobertura de notícias empresariais e confirmação de transferência para corretora continuam PENDING.

## Verifica??o posterior de implementa??o ? 14/09/2026

A limita??o inicial de rede acima foi resolvida com execu??o autorizada. Os cinco adaptadores HTTP passaram em smoke p?blico via Node; o IBGE retornou not?cias reais. Um teste separado consumiu quote/history/news/macro, gerou HOLD e persistiu decis?o, mem?ria e auditoria em PostgreSQL tempor?rio. Isso n?o valida feed para ordens, conta do propriet?rio, broker ou SLA.

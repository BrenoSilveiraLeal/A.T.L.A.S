# Configuracao do DASH com ProfitDLL

Este guia descreve como sair do codigo pronto para uma coleta local e paper trading. A DLL roda em Windows x64; a aplicacao web recebe os dados por HTTPS. O gateway do DASH e separado de `gateways/mt5/` e nao envia ordens.

## O que ja esta implementado

- Ingestao ProfitDLL Market Data, validacao de contrato e persistencia de cotacao/candles M1 no esquema isolado `dt_*`.
- Backfill diario do historico disponivel na licenca, com marcacao de sessao completa somente apos callback de conclusao.
- Observacoes de estrategia, graficos e backtest walk-forward com custo por lado e slippage.
- Simulador paper transacional, isolado do ledger e das posicoes reais do ATLAS/DAWN.
- Readiness e kill switch que bloqueiam entradas quando faltam dados, limites, custos, sessao ou confirmacao de configuracao.
- Envio de ordens reais desabilitado: o coletor nao carrega funcoes OMS da ProfitDLL.

## Dependencias e configuracao

1. Obtenha da Nelogica o pacote oficial ProfitDLL para Windows x64 e uma licenca/ativacao que inclua Market Data. Extraia a DLL e arquivos auxiliares em uma pasta privada fora do repositorio.
2. Instale Python para Windows x64.
3. Configure `PROFITDLL_INGEST_SECRET` como segredo server-side no ambiente da aplicacao e use o mesmo valor no gateway local. Gere um segredo aleatorio com ao menos 32 caracteres; nao reutilize `CRON_SECRET`. O segredo nunca deve aparecer no navegador, Git ou logs.
4. Confirme o contrato ativo, simbolo e vencimento em `config/daytrade.json`. Atualize-o somente a partir da especificacao oficial vigente e da corretora. O exemplo atual pode expirar; nao continue coletando com contrato vencido.
5. No DASH, informe margem, corretagem, emolumentos, horarios e limites de risco conforme a nota da conta e fontes oficiais. Escolha de 1 a 20 ticks de slippage adverso por fill como premissa de simulacao; zero nao e aceito e esse numero nao e medicao da corretora. Salvar um rascunho nao libera entradas. A confirmacao AAL2 registra a procedencia e habilita apenas a simulacao. Nao use valores estimados para preencher lacunas.
6. Na raiz do repositorio, rode `./gateways/profitdll/run-gateway.ps1`. Na primeira execucao, ele cria `gateways/profitdll/.env.local` a partir do exemplo e para para preenchimento. Configure a pasta que contem `ProfitDLL.dll`, o simbolo habilitado, `DASH_API_URL` como a URL HTTPS exata terminada em `/api/daytrade/quote` e o segredo dedicado.
7. Execute novamente o script. Ele valida a configuracao do contrato, DLL, endpoints de quote e historico antes de pedir no terminal a chave de ativacao e as credenciais Nelogica. Mantenha o processo ativo para receber o feed; nao passe credenciais como argumentos.
8. No DASH, acompanhe **Graficos**, **Pesquisa**, **Risco** e **Paper**. A primeira coleta pode importar ate 30 dias de pregoes disponiveis. Dias incompletos, especiais, vazios ou com erro nao contam como sessoes confirmadas para walk-forward.

O launcher informa a versao do arquivo `ProfitDLL.dll`. Confirme essa versao com o header/notas do mesmo pacote licenciado antes da primeira conexao: verificacoes de tamanho de estrutura e nomes exportados nao confirmam, sozinhas, a ABI real dos callbacks. Em 02/11/2026, o arquivo local era `4.0.0.42`, com assinatura Authenticode valida da Nelogica e SHA-256 `EF526F14CFCC129BDAFB4FA82D2110C8436A5E24A73E6B997BD074E6BF0BCA81`. O exemplo publico de binding da Nelogica declara validacao com `4.0.0.41` em 24/08/2026; a pasta local nao contem header nem notas de versao que confirmem a ABI do `.42`. A assinatura valida a origem do binario, nao a compatibilidade da ABI. O gateway agora rejeita versoes diferentes de `4.0.0.41` antes de qualquer preflight HTTP, carregamento da ProfitDLL ou solicitacao de credenciais. Nao altere a lista permitida sem confirmar a ABI no pacote licenciado ou em documentacao oficial da Nelogica.

## Banco e publicacao

O repositorio contem migrations de ingestao, historico, configuracao por proprietario, ledger paper e kill switch. Antes de aplica-las, compare o historico do projeto Supabase com `supabase/migrations/`; o lote pendente esta listado em `docs/daytrade/ARQUITETURA.md`. A ordem das migrations deve ser preservada. Nao reexecute SQL manualmente sem reconciliar `supabase_migrations.schema_migrations`.

A API precisa estar publicada com a migration de historico aplicada antes do preflight do coletor poder responder `READY`. A DLL permanece no computador Windows; Vercel hospeda a interface e API, nao a DLL nem o coletor. O envio deste codigo ao Git/Vercel e a aplicacao do lote do banco sao etapas de publicacao separadas.

Verificacao local de 02/11/2026: o projeto Vercel tem `PROFITDLL_INGEST_SECRET` no alvo Production, mas os preflights autenticados de quote e historico responderam `401`. O segredo Production foi alterado depois da implantacao de producao atual; uma nova implantacao e os dois preflights `READY` ainda sao necessarios. Nenhuma chamada de inicializacao da DLL ou autenticacao Nelogica foi feita nesta verificacao.

## Limites

- A aplicacao nao promete lucro e nao aprova estrategia automaticamente. Backtests com historico curto sao exploratorios e sujeitos a vies de execucao intrabar, latencia, fila e liquidez.
- Fills paper nao sao fills de corretora; stop de simulacao nao e stop aceito pela corretora.
- O DASH nao reconcilia posicoes reais nem envia, cancela ou modifica ordens. Configurar a DLL ou a conta nao habilita roteamento live.
- Valores de margem, custos e risco dependem da conta e devem ser verificados pelo proprietario antes da simulacao.

Consulte tambem [a arquitetura](ARQUITETURA.md), [metodologia](METODOLOGIA.md), [setores](AGENTES.md) e o [guia tecnico do gateway](../../gateways/profitdll/README.md).

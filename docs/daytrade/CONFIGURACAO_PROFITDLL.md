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

1. Obtenha da Nelogica o pacote oficial ProfitDLL para Windows x64 e uma licenca/ativacao que inclua Market Data. Para localizar a licença, entre em [nelogica.com.br/login](https://www.nelogica.com.br/login), abra **Assinaturas** e procure **DLL Feed**; a opção **Download** disponibiliza o pacote e as informações necessárias para uso. Se o DLL Feed não aparecer, confirme se foi contratado e contate `corporativo@nelogica.com.br`. Se a licença Profit foi contratada por uma corretora parceira, consulte a corretora para verificar quem administra aquela assinatura. Extraia a DLL e arquivos auxiliares em uma pasta privada fora do repositorio.
2. Instale Python para Windows x64.
3. Configure `PROFITDLL_INGEST_SECRET` como segredo server-side no ambiente da aplicacao e use o mesmo valor no gateway local. Gere um segredo aleatorio com ao menos 32 caracteres; nao reutilize `CRON_SECRET`. O segredo nunca deve aparecer no navegador, Git ou logs.
4. Confirme o contrato ativo, simbolo e vencimento em `config/daytrade.json`. Atualize-o somente a partir da especificacao oficial vigente e da corretora. O exemplo atual pode expirar; nao continue coletando com contrato vencido.
5. No DASH, informe margem, corretagem, emolumentos, horarios e limites de risco conforme a nota da conta e fontes oficiais. Escolha de 1 a 20 ticks de slippage adverso por fill como premissa de simulacao; zero nao e aceito e esse numero nao e medicao da corretora. Salvar um rascunho nao libera entradas. A confirmacao AAL2 registra a procedencia e habilita apenas a simulacao. Nao use valores estimados para preencher lacunas.
6. Na raiz do repositorio, rode `./gateways/profitdll/run-gateway.ps1`. A configuracao privada fica em `%LOCALAPPDATA%\ATLAS\ProfitDLL\gateway.env`, fora do repositorio e de pastas sincronizadas. O launcher move para esse local uma `.env.local` antiga, se houver; caso contrario, cria ali um arquivo a partir do exemplo e para para preenchimento. Configure a pasta que contem `ProfitDLL.dll`, o simbolo habilitado, `DASH_API_URL` como a URL HTTPS exata terminada em `/api/daytrade/quote` e o segredo dedicado.
7. Execute novamente o script em uma janela interativa do PowerShell. Ele valida a configuracao do contrato, DLL, endpoints de quote e historico antes de pedir no terminal a chave de ativacao e as credenciais Nelogica. Digite a chave de ativacao associada ao DLL Feed; a entrada fica oculta. Entrada redirecionada e recusada para impedir que o `getpass` exiba credenciais. A chave nao e a senha da Genial, a senha de login Nelogica nem a senha de roteamento. Mantenha o processo ativo para receber o feed; nao passe credenciais como argumentos.
8. No DASH, acompanhe **Graficos**, **Pesquisa**, **Risco** e **Paper**. A primeira coleta pode importar ate 30 dias de pregoes disponiveis. Dias incompletos, especiais, vazios ou com erro nao contam como sessoes confirmadas para walk-forward.

Se a DLL informar **ativacao invalida**, confirme com a Nelogica se a chave pertence a uma licenca **DLL Feed** ativa com Market Data. Se informar falha de login, verifique separadamente o usuario e a senha da conta Nelogica; nao repita tentativas se a senha aparecer como bloqueada. O gateway agora diferencia esses estados e nao imprime os valores digitados. A documentacao Nelogica descreve os codigos de ativacao e login no [guia de conexao da ProfitDLL](https://ajuda.nelogica.com.br/hc/pt-br/articles/22396517026203-Ecossistema-ProfitDLL-e-primeiros-passos).

O launcher informa a versao do arquivo `ProfitDLL.dll`. Em 03/11/2026, o pacote atual de `https://download-setup.nelogica.com.br/connector/latest/ProfitDLL.zip` (SHA-256 `14104498FB00D34D39D54CEA653E82E87690F72F0F6C718EFC12D9C12CB34B81`) continha a DLL Win64 `4.0.0.42`, SHA-256 `EF526F14CFCC129BDAFB4FA82D2110C8436A5E24A73E6B997BD074E6BF0BCA81`, identica ao binario local. As unidades Delphi do mesmo pacote definem `TConnectorAssetIdentifier`, `TConnectorTrade` e `TConnectorTradeCallback`, e o header define o identificador usado pelo callback historico legado. Os campos, tamanhos, offsets, convencao `stdcall` e ponteiros desses tipos correspondem as estruturas Python e callbacks usados pelo coletor. O exemplo publico da Nelogica valida o codigo do binding ate `4.0.0.41`; nao afirma que esse exemplo foi testado contra `.42`. A comparacao dos tipos no pacote oficial atual e evidencia suficiente para habilitar somente esses callbacks de market data/historico em `.42`; ela nao libera nem inclui OMS/roteamento de ordens. O gateway aceita `4.0.0.41` e `4.0.0.42` e continua rejeitando versoes desconhecidas antes de qualquer preflight HTTP, carregamento da DLL ou solicitacao de credenciais.

## Banco e publicacao

O repositorio contem migrations de ingestao, historico, configuracao por proprietario, ledger paper e kill switch. Antes de aplica-las, compare o historico do projeto Supabase com `supabase/migrations/`; o lote pendente esta listado em `docs/daytrade/ARQUITETURA.md`. A ordem das migrations deve ser preservada. Nao reexecute SQL manualmente sem reconciliar `supabase_migrations.schema_migrations`.

A API precisa estar publicada com a migration de historico aplicada antes do preflight do coletor poder responder `READY`. A DLL permanece no computador Windows; Vercel hospeda a interface e API, nao a DLL nem o coletor. O envio deste codigo ao Git/Vercel e a aplicacao do lote do banco sao etapas de publicacao separadas.

Verificacao de producao registrada em 03/11/2026: o deploy `dpl_F95X8sZ8JixKfP82AxffFTN5CREG` foi promovido para `atlasagent.vercel.app`. Naquele momento, os preflights autenticados responderam `READY` para `WINZ26` em `/api/daytrade/quote` e `/api/daytrade/history`; o endpoint de historico informou zero sessoes persistidas. O coletor ProfitDLL nao foi iniciado, nenhuma credencial Nelogica foi solicitada e nenhuma cotacao foi gravada. Essa verificacao descreve somente aquele deploy: as alteracoes locais posteriores ainda nao foram publicadas e as migrations locais pendentes ainda nao foram aplicadas. A ingestao comeca somente quando o proprietario iniciar o gateway local e a licenca confirmar conexao e assinatura.

O pacote enviado foi conferido com `vercel deploy --dry --json`; `.env*`, estado local Supabase, configuracao pessoal, DLLs, logs e relatorio de seguranca ficaram fora do upload por `.vercelignore`.

## Limites

- A aplicacao nao promete lucro e nao aprova estrategia automaticamente. Backtests com historico curto sao exploratorios e sujeitos a vies de execucao intrabar, latencia, fila e liquidez.
- Fills paper nao sao fills de corretora; stop de simulacao nao e stop aceito pela corretora.
- O DASH nao reconcilia posicoes reais nem envia, cancela ou modifica ordens. Configurar a DLL ou a conta nao habilita roteamento live.
- Valores de margem, custos e risco dependem da conta e devem ser verificados pelo proprietario antes da simulacao.

Consulte tambem [a arquitetura](ARQUITETURA.md), [metodologia](METODOLOGIA.md), [setores](AGENTES.md) e o [guia tecnico do gateway](../../gateways/profitdll/README.md).

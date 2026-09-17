# Ponte MT5 do ATLAS

O código usa exclusivamente o pacote **MetaTrader5 oficial** e o terminal Windows do proprietário. Não contém estratégias nem escolhe operações. LIMIT/DAY, cancelamento e alteração de preço com a mesma quantidade estão implementados; outros tipos são recusados. Os testes usam apenas fixtures em memória e SQLite temporário. Nenhuma conta ou ordem real foi usada na validação.

## O que está e o que não está validado

- Comunicação `/rpc` autenticada, conta/servidor fixados, verificação do instrumento e envio através de `order_check`/`order_send`.
- Journal SQLite em disco, intenção confirmada antes de enviar, conflitos de idempotência, reinício/timeout sem reenvio. Consulta de ticket, ordens/histórico, fills parciais e posições.
- `cash` retorna `SETTLED_CASH_UNAVAILABLE`. `balance` e margem não comprovam caixa liquidado da corretora. A conta retorna `cashOnly=false`; reconciliação completa, overnight e autorização cloud não são declaradas.
- Os negócios reportam taxas observadas com `feesVerified=false`. O ATLAS registra a evidência, mas não contabiliza essas taxas como custo final. É preciso complementar com informação oficial de custos e liquidação específica da conta; nenhuma configuração transforma uma suposição em confirmação.
- As capacidades incompletas bloqueiam novas ordens no ATLAS. Alterar `ATLAS_MT5_ENABLE_EXECUTION` isoladamente não homologa o sistema.
- Compatibilidade com o terminal/servidor contratado, permissões Python, semântica de volume, ações à vista, Netting, acesso a toda custódia e retorno de rejeições ainda exigem validação externa.

## Preparar depois de escolher a corretora

1. Instalar o terminal MT5 oficial fornecido pela corretora em Windows x64. Autenticar pelo próprio terminal e confirmar login/servidor/modo. Não copiar cookies, não automatizar a interface e não fornecer senha ao ATLAS.
2. Usar Python x64 compatível com a wheel fixada em `requirements.txt` e criar ambiente virtual:

```powershell
python -m venv .venv-mt5
.\.venv-mt5\Scripts\python.exe -m pip install -r gateways/mt5/requirements.txt
```

3. Criar uma configuração privada em `.supabase/mt5-instruments.json`, partindo de `instruments.example.json`. Ela começa vazia. Preencher somente símbolos comprovados de ações à vista B3, `terminalExchange` e ISIN reportados pelo terminal, com `contractSize` verificado. Não usar sufixos/nomes de Forex, CFD ou futuros como substitutos de ações.
4. Configurar as variáveis abaixo **no ambiente do processo da ponte**. O script Python não carrega `.env.local` automaticamente. Segredos devem vir do gerenciador de segredos/ambiente privado do serviço, sem constar de comandos salvos, Git ou logs.

| Variável | Conteúdo |
| --- | --- |
| `ATLAS_MT5_TOKEN` | Segredo aleatório de pelo menos 32 caracteres ASCII, sem espaços; idêntico a `ATLAS_GATEWAY_TOKEN` no backend |
| `ATLAS_MT5_EXPECTED_LOGIN` | Login numérico da conta; idêntico a `ATLAS_GATEWAY_ACCOUNT_ID` |
| `ATLAS_MT5_EXPECTED_SERVER` | Servidor exato da corretora |
| `ATLAS_MT5_ACCOUNT_MODE` | `OFFICIAL_SANDBOX` para demo oficial, ou `REAL`; nenhuma ordem real autorizada por este documento |
| `ATLAS_MT5_TERMINAL_PATH` | Caminho absoluto do `terminal64.exe` escolhido |
| `ATLAS_MT5_INSTRUMENTS_FILE` | Caminho absoluto do JSON privado de instrumentos |
| `ATLAS_MT5_JOURNAL_PATH` | Caminho absoluto persistente do SQLite, fora de pasta temporária ou sincronizada pelo OneDrive |
| `ATLAS_MT5_ENABLE_EXECUTION` | `false` inicialmente |
| `ATLAS_MT5_PORT` | `8785` por padrão |
| `ATLAS_MT5_PROVIDER_ID` | `MT5` por padrão; idêntico a `ATLAS_GATEWAY_PROVIDER_ID` |

5. Iniciar explicitamente a ponte:

```powershell
.\.venv-mt5\Scripts\python.exe gateways/mt5/gateway.py
```

O servidor escuta **somente 127.0.0.1**; não abrir a porta do gateway na internet. O backend e a ponte precisam estar no mesmo Windows ou em uma arquitetura privada de transporte adicional previamente validada. Não há implementação de túnel remoto nesta entrega.

6. Configurar as variáveis do Executor em `.env.local`, manter `LIVE_TRADING_ENABLED=false` e iniciar `npm run executor` após o backend. O worker chama `POST /api/executor` com `EXECUTOR_SECRET`; ele não recebe ordens arbitrárias na linha de comando. A primeira conexão válida registra apenas a identidade da conta como `PENDING`, sem habilitar trading. A inicialização do ledger depende de evidência oficial; o repositório não cria saldos/posições para contornar essa etapa.

## Recuperação e operação externa

O journal é parte da identidade operacional da conta. **Não apagar, recriar ou restaurar um journal antigo para tentar reenviar ordens.** Manter uma instância ativa e backups consistentes; a unicidade SQLite não substitui a persistência Supabase. Após falha, o ATLAS consulta a mesma intenção/ticket; se a resposta não puder ser comprovada, conserva UNKNOWN e as reservas. Reiniciar um processo não resolve uma ordem ambígua.

O terminal precisa permanecer iniciado, autenticado e conectado. Na topologia Windows VPS, backend, scheduler de análise, worker Executor e ponte/terminal ficam online na VPS; o PC pessoal pode ser desligado após validação. A hospedagem MQL5 de EAs não executa Python/Node e não é compatível com esta ponte. Procedimentos de autoarranque, sessão Windows do terminal, reinício, patching e recuperação devem ser testados na infraestrutura escolhida antes de operar; não se presume que um terminal gráfico execute corretamente como serviço Windows em sessão 0.

```powershell
python -m unittest discover -s gateways/mt5 -p 'test_*.py'
```

Referências: [SDK Python oficial](https://www.mql5.com/en/docs/python_metatrader5), [envio de ordens](https://www.mql5.com/en/docs/python_metatrader5/mt5ordersend_py), [negócios históricos](https://www.mql5.com/en/docs/python_metatrader5/mt5historydealsget_py), [decisão e custos](../../docs/EXECUTION_GATEWAY_DECISION.md).

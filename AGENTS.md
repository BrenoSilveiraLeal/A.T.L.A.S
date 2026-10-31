# Instruções do repositório ATLAS

## ATLAS Day Trade — escritório DASH

O novo escritório de day trade chama-se **DASH — Day-trading Analysis & Strategy Hub** (*Centro de Análise e Estratégia de Day Trade*). Trate-o como módulo isolado do ATLAS de ações à vista.

### Princípios inegociáveis

1. **Não enviar ordens reais, ativar chaves de execução ou alterar `.env.local` de produção.** Testes de ordem usam exclusivamente um MT5 falso em memória.
2. **Preservar o ATLAS de ações.** Não mudar o comportamento das tabelas existentes (`agents`, `live_*`, `paper_*`, `system_state`, `ledger_*`, `executor_*` etc.), rotas `/app/*` ou perfil de gateway `GENIAL_SWING`. Só tocar em integração global de kill switch se for estritamente necessária, isolada, unidirecional e coberta por testes. Todos os testes atuais devem continuar passando; se um teste antigo exigiria mudança, interrompa e explique o motivo.
3. **O LLM nunca decide nem envia ordens.** Anthropic/Ollama pode apenas reduzir tamanho ou bloquear entradas, com fontes registradas, e escrever relatórios. Não recebe gateway, credenciais nem permissão para gravar ordens. Ordens vêm de regras determinísticas, versionadas e testadas.
4. **Todo trade real futuro precisa de stop confirmado na corretora**, associado à posição ou como ordem stop; proteção apenas na memória do processo não basta.
5. **Sem dado confiável, não operar.** Tick velho conforme limite configurável, terminal desconectado, heartbeat ausente, calendário/sessão desconhecidos ou halt file presente bloqueiam entradas novas. Erros e estados desconhecidos nunca viram estado neutro.
6. **Segredos não entram em código, Git, browser ou log.** A senha da corretora é inserida pelo proprietário no terminal, nunca pelo sistema. Chaves privadas ficam em ambiente/secret manager e nunca recebem prefixo `NEXT_PUBLIC_`.
7. **Não declarar estratégia lucrativa antecipadamente.** O laboratório pode reprovar todas; nesse caso o DASH permanece SIMULADO e relata a reprovação.
8. **Não usar** `pandas-ta`, `mlfinlab`, modelos pré-treinados de trading baixados da internet ou LSTM para prever preço.

### Arquitetura e isolamento

- Use `daytrade/`, `src/app/daytrade/`, `src/app/api/daytrade/`, `src/components/daytrade/`, `src/lib/daytrade/`, migrations próprias `dt_*` e `docs/daytrade/` para o DASH.
- Não modifique tabelas ou rotas de ações para encaixar a lógica de futuros. Mesmo projeto Supabase não significa mesmo ledger, estado, risco ou conta.
- A conta Day Trade usa processo/instância, porta, terminal, journal SQLite, halt file e configuração separados da conta Swing. Reutilize a ponte por extensão cuidadosamente isolada; nunca copie o perfil Swing para outro modo.
- Proteja tabelas expostas com RLS, owner UUID e políticas de menor privilégio. Rotas web verificam proprietário e AAL2. Service role só em processos server-side autorizados e não substitui autorização.
- Use `Decimal`/`numeric` para valores financeiros no Python/SQL e strings decimais nas fronteiras JSON; nunca `float` para dinheiro, preços ou P&L contábil.
- A IA não decide ordens; o motor não importa o SDK MetaTrader5 para enviar ordens. A escrita de ordens, quando vier a ser autorizada, passa pela ponte privada com journal e reconciliação.
- Especificações/custos/horários WIN e WDO são `UNVERIFIED` até confirmação por documentação oficial, probe somente leitura e conferência da conta. Não codifique estimativas como fatos.

Consulte [`docs/daytrade/ARQUITETURA.md`](docs/daytrade/ARQUITETURA.md) para estado atual, linha de base, componentes reutilizáveis e diferenças entre o plano e o repositório.

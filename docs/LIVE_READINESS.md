# Live readiness — BLOCKED

Nenhum provider de corretora foi implementado ou habilitado. Alterar `LIVE_TRADING_ENABLED` não libera ordens nesta versão: a API recusa envio e a estratégia de observação só persiste HOLD. A biblioteca OMS é testada isoladamente; não é um serviço de execução integrado.

Antes de criar um adaptador de execução:

- Contrato oficial permite PF, ativos à vista B3, automação própria e nuvem na conta escolhida.
- Credencial server-side, escopo, revogação, autenticação e renovação oficiais verificados.
- Lote/tick, calendário versionado, sessão efetiva, leilão, suspensão e corporate actions disponíveis.
- Quote negociável tem bid/ask e timestamp atual; brapi não basta.
- Identificador idempotente consultável no broker; timeout permanece incerto até reconciliação.
- Reserva de caixa/quantidade, aprovação de risco e criação de ordem são uma transação com lock.
- Execução parcial, taxas, ledger, posição e liberação de reserva são aplicados atomicamente uma vez por execution ID.
- Saldo, posições e ordens reconciliados, inclusive operações externas ao ATLAS e taxas tardias.
- Kill switch impede envio, tenta cancelar e evidencia falhas; não liquida posições implicitamente.
- Limites, MFA, expiração, monitoramento, backup, alertas e recuperação de deploy aprovados.
- Homologação oficial com rejeição, cancelamento, perda de conexão, timeout, fills fora de ordem e autenticação expirada.
- Ativação deliberada do proprietário após evidências; não executar uma ordem de validação sem parâmetros autorizados.

Sem essas evidências, a versão continua plataforma de análise/configuração com o componente de execução **PENDING**. Não é apresentada como produto de trading operacional.

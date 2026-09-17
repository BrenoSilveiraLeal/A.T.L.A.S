# Live readiness — BLOCKED

Atualizado em **16/09/2026**. O ATLAS tem Executor desacoplado, persistência de comandos/fills e ponte com o SDK Python oficial MT5 em desenvolvimento/validação local. **Não há conta de corretagem conectada nem homologação real.** A estratégia existente continua de observação e só persiste HOLD. Alterar `LIVE_TRADING_ENABLED` não substitui os demais gates nem transforma a ponte em sistema operacional.

A API privada de uma corretora deixou de ser requisito principal. O caminho é ATLAS → Risk/OMS → Executor → gateway MT5 → corretora → B3. ProfitDLL e API oficial direta são alternativas futuras no mesmo contrato. Consulte a [decisão de integração](EXECUTION_GATEWAY_DECISION.md).

## O que a implementação pode comprovar localmente

- Contrato de gateway separado da inteligência, da corretora e dos agentes.
- Comandos persistidos, claim exclusivo, reserva e controle de versão; timeout não volta à fila para reenvio automático.
- Protocolo privado com conta/provider fixados, autenticação, limites de resposta e erros explícitos.
- ACK separado de fill; negócio identificado, deduplicação e commit contábil transacional.
- Ponte MT5 com journal antes do envio; LIMIT/DAY, cancelamento e alteração de preço com mesma quantidade como escopo inicial.
- Bloqueios para campos desconhecidos, reconciliação incompleta, conexão indisponível e falhas de identidade.

Testes com doubles verificam essas regras; não certificam o terminal, uma conta real ou comportamento da B3. O relatório de execução dos testes é mantido em [VALIDATION.md](VALIDATION.md).

## Evidências necessárias antes de live

- [ ] Conta PF com ações à vista B3, plataforma e automação Python própria permitidas; modalidade overnight/Netting confirmada quando necessária. Nenhuma corretora foi escolhida automaticamente.
- [ ] Terminal oficial autenticado no ambiente correto; conta/server/símbolos e versão do pacote conferidos, sem credenciais em logs.
- [ ] Capacidades do gateway comprovadas na conta. Tipos/validade/lote/tick/filling mode desconhecidos impedem envio.
- [ ] Caixa liquidado, reservas, custódia completa e taxas totais conciliáveis por fonte oficial. Margem livre/balance do MT5 não equivalem a caixa sacável. `completeAccountReconciliation` continua falso até prova.
- [ ] Calendário versionado, sessão efetiva, leilão, suspensão e corporate actions disponíveis.
- [ ] Cotação utilizável na execução, bid/ask e timestamp atual; brapi atrasada não basta.
- [ ] Estratégia e propostas BUY/SELL integradas e aprovadas; a estratégia HOLD atual não é liberação de trading.
- [ ] Limites completos do proprietário, Risk Engine, reserva atômica e OMS verificados na cadeia real.
- [ ] Identidade da ordem e histórico suficientes para recuperação após timeout; resultado desconhecido conserva bloqueio e não gera reenvio cego.
- [ ] Fills parciais/finais, rejeição, alteração, cancelamento concorrente, taxas tardias e eventos duplicados/fora de ordem homologados; ledger e reserva atualizados uma única vez por execução confirmada.
- [ ] Reconciliação inclui ordens manuais, posições carregadas e outros canais; divergência bloqueia novos envios.
- [ ] Kill switch persistente, recuperação de crash, conexão expirada e perda de banco testados; falha do terminal não é anunciada como cancelamento das ordens externas.
- [ ] ATLAS/backend, scheduler, Executor e terminal em infraestrutura externa supervisionada; teste com PC desligado, reinício da VPS e recuperação do login concluído.
- [ ] Backup/restore, monitoramento e alertas externos ao painel validados. Supabase Free não oferece garantia de disponibilidade contínua.
- [ ] MFA/AAL2 exigido nas ações sensíveis e ativação deliberada do proprietário após as evidências; nenhuma ordem de validação sem parâmetros autorizados.

Senha, TOTP e acesso ao painel protegido do proprietário já foram concluídos na instalação atual. Uma sessão anterior não dispensa a validação AAL2 em cada ação sensível.

Sem essas evidências, a execução real permanece **BLOCKED**. Isso não impede a análise local, o uso dos módulos existentes ou testes independentes de credenciais. Nenhuma compra de infraestrutura, abertura de conta ou ordem real foi realizada nesta integração.

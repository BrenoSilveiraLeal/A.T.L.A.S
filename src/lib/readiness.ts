import "server-only";
import { configured } from "./env";

export function readiness() {
  return [
    {
      name: "Supabase e proprietário",
      ready: configured(),
      detail: configured()
        ? "Variáveis presentes; conexão validada ao acessar."
        : "Configurar projeto isolado e usuário proprietário.",
    },
    {
      name: "Gateway MT5 e conta B3",
      ready: false,
      detail:
        "Ponte MT5 preparada; conta, terminal e capacidades ainda precisam de homologação.",
    },
    {
      name: "Feed e sessão de mercado",
      ready: false,
      detail:
        "brapi é complementar com atraso. Feed de execução e sessão oficial pendentes.",
    },
    {
      name: "Reconciliação de conta",
      ready: false,
      detail: "Caixa liquidado, custódia e taxas totais aguardam fonte oficial conciliável.",
    },
    {
      name: "Certificação de execução",
      ready: false,
      detail:
        "Timeout, cancelamento e fills precisam ser validados no canal oficial.",
    },
    {
      name: "Operação com PC desligado",
      ready: false,
      detail:
        "ATLAS, scheduler e terminal precisam de hospedagem externa. A instalação atual é local.",
    },
    {
      name: "PIX automático",
      ready: false,
      detail:
        "Sem provider habilitado. Transferências exigem ação manual e reconciliação.",
    },
  ];
}

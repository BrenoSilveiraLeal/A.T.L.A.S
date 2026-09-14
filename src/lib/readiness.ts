import "server-only";
import { configured } from "./env";

export function readiness() {
  return [
    { name: "Supabase e proprietário", ready: configured(), detail: configured() ? "Variáveis presentes; conexão validada ao acessar." : "Configurar projeto isolado e usuário proprietário." },
    { name: "Corretora oficial B3", ready: false, detail: "Provider não contratado nem homologado. Consulte a pesquisa de corretoras." },
    { name: "Feed e sessão de mercado", ready: false, detail: "brapi é complementar com atraso. Feed de execução e sessão oficial pendentes." },
    { name: "Reconciliação de conta", ready: false, detail: "Aguardando consulta independente à corretora." },
    { name: "Certificação de execução", ready: false, detail: "Timeout, cancelamento e fills precisam ser validados no canal oficial." },
    { name: "PIX automático", ready: false, detail: "Sem provider habilitado. Transferências exigem ação manual e reconciliação." },
  ];
}

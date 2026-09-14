"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  LayoutDashboard,
  Building2,
  Users,
  ChartCandlestick,
  Newspaper,
  ListOrdered,
  Wallet,
  ShieldCheck,
  ScrollText,
  Settings2,
  Activity,
  OctagonX,
  Menu,
  ArrowUpRight,
  X,
  LogOut,
} from "lucide-react";

const navigation = [
  { path: "/app", label: "Visão geral", icon: LayoutDashboard },
  { path: "/app/office", label: "Trading floor", icon: Building2 },
  { path: "/app/agents", label: "Agentes", icon: Users },
  { path: "/app/portfolio", label: "Carteira", icon: Wallet },
  { path: "/app/market", label: "Mercado", icon: ChartCandlestick },
  { path: "/app/news", label: "Inteligência", icon: Newspaper },
  { path: "/app/orders", label: "Ordens", icon: ListOrdered },
  { path: "/app/treasury", label: "Tesouraria", icon: Wallet },
  { path: "/app/risk", label: "Risco e limites", icon: ShieldCheck },
  { path: "/app/audit", label: "Auditoria", icon: ScrollText },
  { path: "/app/health", label: "Saúde do sistema", icon: Activity },
  { path: "/app/settings", label: "Configuração", icon: Settings2 },
];
export function Shell({
  children,
  configured,
}: {
  children: React.ReactNode;
  configured: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function logout() {
    setBusy(true);
    try {
      const response = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "logout" }),
      });
      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error);
      }
      router.replace("/login");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Não foi possível encerrar a sessão.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function stop() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/atlas/kill", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: "Parada manual pelo proprietário" }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage(data.message);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Falha ao confirmar a parada. Confira a corretora pelo canal oficial.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div
      className="workspace"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <a className="skip-link" href="#content">
        Ir para o conteúdo
      </a>
      <aside className={`sidebar ${open ? "is-open" : ""}`}>
        <button
          className="icon-button nav-close"
          aria-label="Fechar navegação"
          onClick={() => setOpen(false)}
        >
          <X size={18} />
        </button>
        <Link href="/app" className="brand">
          <span className="brand-mark">A</span>
          <span>
            ATLAS<small>Autonomous Trading System</small>
          </span>
        </Link>
        <div className="workspace-label">
          <span className="status-dot" />
          ESPAÇO PESSOAL
        </div>
        <nav aria-label="Navegação principal">
          {navigation.map(({ path, label, icon: Icon }) => (
            <Link
              key={path}
              href={path}
              onClick={() => setOpen(false)}
              aria-current={pathname === path ? "page" : undefined}
            >
              <Icon size={18} strokeWidth={1.6} />
              <span>{label}</span>
              {pathname === path && <span className="nav-active" />}
            </Link>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <ShieldCheck size={20} />
          <div>
            <strong>Risco tem prioridade</strong>
            <small>Execução real bloqueada</small>
          </div>
        </div>
        <div className="owner-avatar">
          <span>P</span>
          <div>
            Proprietário<small>Conta privada · Brasil</small>
          </div>
          {configured && (
            <button
              className="icon-button secondary"
              aria-label="Sair da conta"
              disabled={busy}
              onClick={() => void logout()}
            >
              <LogOut size={15} />
            </button>
          )}
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            aria-label="Abrir navegação"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
          >
            <Menu size={22} />
          </button>
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {navigation.find((n) => n.path === pathname)?.label ??
                "Detalhe do agente"}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className="mode-badge">
              <span />
              CONFIGURAÇÃO
            </span>
            <Link href="/app/settings" className="text-link">
              Conectar serviços <ArrowUpRight size={14} />
            </Link>
          </div>
        </header>
        <div className="safety-strip">
          <div>
            <ShieldCheck size={16} />
            <span>
              <strong>Execução bloqueada.</strong> Operação real aguarda
              integração e validação.
            </span>
          </div>
          <button
            className="kill-button"
            onClick={() => void stop()}
            disabled={!configured || busy}
            title={
              !configured
                ? "Sem conexão: nenhuma ordem pode ser enviada pelo ATLAS."
                : "Bloqueia novas ordens e solicita cancelamento quando houver provider. Não liquida posições."
            }
          >
            <OctagonX size={15} />
            {busy ? "Parando…" : "Parar todas as operações"}
          </button>
        </div>
        {message && (
          <div className="notice global-message" role="status">
            {message}
          </div>
        )}
        <main id="content" className="main-content">
          {children}
        </main>
        <footer className="footer">
          <span>ATLAS · Autonomous Trading & Learning Agent System</span>
          <span>Dados com origem. Decisões com registro.</span>
        </footer>
      </div>
    </div>
  );
}

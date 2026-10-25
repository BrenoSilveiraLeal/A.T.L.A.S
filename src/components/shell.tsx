"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NotificationBell } from "./notification-bell";
import { useState } from "react";
import {
  Building2,
  Wallet,
  SlidersHorizontal,
  History,
  ShieldCheck,
  OctagonX,
  Menu,
  X,
  LogOut,
} from "lucide-react";

// The owner's four screens; the technical pages are linked from Ajustes.
const navigation = [
  { path: "/app", label: "Escritório", icon: Building2 },
  { path: "/app/trades", label: "Carteira", icon: Wallet },
  { path: "/app/history", label: "Histórico", icon: History },
  { path: "/app/controls", label: "Ajustes", icon: SlidersHorizontal },
];
export function Shell({
  children,
  configured,
  localDev = false,
}: {
  children: React.ReactNode;
  configured: boolean;
  localDev?: boolean;
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
<div className="sidebar-spacer" />
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
              {navigation.find((n) => n.path === pathname)?.label ?? "Avançado"}
            </strong>
          </div>
          <div className="topbar-actions"><NotificationBell connected={configured} /></div>

        </header>
        <div className="safety-strip">
          <div>
            <ShieldCheck size={16} />
            <span>
              Dinheiro real só opera com a sua confirmação. Em emergência, pare tudo:
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
        {localDev && (
          <div className="notice global-message" role="status">
            <strong>Modo desenvolvimento:</strong> login desligado neste computador (127.0.0.1). Na Vercel o login continua obrigatório.
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

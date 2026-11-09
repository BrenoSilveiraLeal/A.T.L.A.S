"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { NotificationBell } from "./notification-bell";
import { useEffect, useRef, useState } from "react";
import {
  Building,
  Building2,
  Wallet,
  Coins,
  SlidersHorizontal,
  History,
  ShieldCheck,
  OctagonX,
  ChevronDown,
  LogOut,
} from "lucide-react";
import { officeById } from "@/core/building";

/**
 * The dividends office's frame, in the ATLAS building style (owner, 01/11/2026: "reformular o
 * visual... combinar com o prédio"): a glass top bar with the office's floor and the way back to
 * the map, the four main screens as tabs, every technical page under "Mais" (some had no link
 * before), the alerts bell, the account and, always visible, the emergency stop. Only the layout
 * changed: logout, stop, alerts and every page work exactly as before.
 */
const OFFICE = officeById("dividendos")!;
const navigation = [
  { path: "/app", label: "Escritório", icon: Building2 },
  { path: "/app/trades", label: "Carteira", icon: Wallet },
  { path: "/app/dividends", label: "Dividendos", icon: Coins },
  { path: "/app/history", label: "Histórico", icon: History },
  { path: "/app/controls", label: "Ajustes", icon: SlidersHorizontal },
];
/** Every other page of the office, grouped; all of them existed before (some were reachable only by address). */
const more = [
  { group: "Equipe", items: [{ path: "/app/agents", label: "Agentes" }, { path: "/app/office", label: "Sala e Reuniões" }, { path: "/tv", label: "Modo TV" }] },
  { group: "Dinheiro", items: [{ path: "/app/portfolio", label: "Conta e patrimônio" }, { path: "/app/treasury", label: "Tesouraria" }, { path: "/app/orders", label: "Livro de ordens" }, { path: "/app/paper", label: "Simulação" }] },
  { group: "Mercado", items: [{ path: "/app/market", label: "Mercado e ativos" }, { path: "/app/news", label: "Notícias" }, { path: "/app/research", label: "Pesquisa" }] },
  { group: "Sistema", items: [{ path: "/app/risk", label: "Risco e limites" }, { path: "/app/audit", label: "Auditoria" }, { path: "/app/health", label: "Saúde do sistema" }, { path: "/app/settings", label: "Configuração" }] },
];
const moreItems = more.flatMap((g) => g.items);

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
  const menu = useRef<HTMLDivElement>(null);
  const inMore = moreItems.find((i) => pathname === i.path || pathname.startsWith(`${i.path}/`));
  useEffect(() => {
    // Prevent the browser from restoring the previous scroll position after reload.
    if ("scrollRestoration" in window.history) {
      window.history.scrollRestoration = "manual";
    }
    window.scrollTo(0, 0);
  }, []);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
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
      className="office-frame"
      onKeyDown={(event) => {
        if (event.key === "Escape") setOpen(false);
      }}
    >
      <a className="skip-link" href="#content">
        Ir para o conteúdo
      </a>
      <header className="office-bar">
        <div className="office-bar-id">
          <Link href="/app" className="office-badge" aria-label={`${OFFICE.name}, andar ${OFFICE.floor} da sede ATLAS`} style={{ "--office": OFFICE.color } as React.CSSProperties}>
            <b>{OFFICE.floor}</b>
            <span><strong>{OFFICE.name}</strong><small>Sede ATLAS · {OFFICE.tagline}</small></span>
          </Link>
          <Link className="office-map-button" href={`/predio?andar=${OFFICE.floor}`} title="Voltar ao mapa do prédio para escolher outro escritório">
            <Building size={15} /> <span>Trocar de escritório</span>
          </Link>
        </div>
        <nav className="office-tabs" aria-label="Navegação principal">
          {navigation.map(({ path, label, icon: Icon }) => (
            <Link key={path} href={path} aria-label={label} title={label} aria-current={pathname === path ? "page" : undefined}>
              <Icon size={16} strokeWidth={1.8} />
              <span>{label}</span>
            </Link>
          ))}
          <div className="office-more" ref={menu}>
            <button type="button" className={inMore ? "current" : ""} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
              <span>{inMore ? inMore.label : "Mais"}</span> <ChevronDown size={14} />
            </button>
            {open && (
              <div className="office-more-menu" role="menu">
                {more.map((g) => (
                  <div key={g.group}>
                    <small>{g.group}</small>
                    {g.items.map((i) => (
                      <Link key={i.path} href={i.path} role="menuitem" aria-current={pathname === i.path ? "page" : undefined} onClick={() => setOpen(false)}>{i.label}</Link>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </nav>
        <div className="office-bar-actions">
          <NotificationBell connected={configured} />
          <div className="office-account" title="Proprietário · Conta privada · Brasil">
            <span className="office-avatar">P</span>
            <span className="office-account-text">Proprietário<small>Conta privada · Brasil</small></span>
            {configured && (
              <button className="icon-button secondary" aria-label="Sair da conta" disabled={busy} onClick={() => void logout()}>
                <LogOut size={15} />
              </button>
            )}
          </div>
        </div>
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
  );
}

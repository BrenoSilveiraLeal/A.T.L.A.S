"use client";
import { useEffect, useRef, useState } from "react";
import { Bell } from "lucide-react";

/**
 * The owner's notifications in the top bar: unread count, the latest events, a pop-up and a beep
 * when a new one arrives (the same events are e-mailed). Polls every 20 s.
 */
type Row = { id: number; level: "info" | "success" | "warning" | "error"; title: string; body: string; read_at: string | null; created_at: string };

function chime() {
  try {
    const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.value = 880; gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.05, ctx.currentTime + 0.02); gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    osc.connect(gain).connect(ctx.destination); osc.start(); osc.stop(ctx.currentTime + 0.4);
  } catch { /* sound blocked until the first click */ }
}

export function NotificationBell({ connected }: { connected: boolean }) {
  const [state, setState] = useState<{ rows: Row[]; unread: number }>({ rows: [], unread: 0 });
  const [open, setOpen] = useState(false);
  const [toast, setToast] = useState<Row | null>(null);
  const newest = useRef<number | null>(null);
  useEffect(() => {
    if (!connected) return;
    let stop = false;
    const read = () => fetch("/api/atlas/notifications").then((r) => (r.ok ? r.json() : null)).then((b: { rows: Row[]; unread: number } | null) => {
      if (stop || !b) return;
      const top = b.rows[0];
      if (top && newest.current !== null && top.id > newest.current && !top.read_at) { setToast(top); chime(); window.setTimeout(() => setToast(null), 8000); }
      if (top) newest.current = Math.max(newest.current ?? 0, top.id);
      setState(b);
    }).catch(() => undefined);
    read();
    const timer = window.setInterval(read, 20000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [connected]);
  if (!connected) return null;
  const markRead = () => {
    void fetch("/api/atlas/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(() => setState((s) => ({ rows: s.rows.map((r) => ({ ...r, read_at: r.read_at ?? new Date().toISOString() })), unread: 0 })));
  };
  const when = (v: string) => new Date(v).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
  return (
    <div className="bell">
      <button type="button" className="icon-button secondary bell-button" aria-label={`Avisos: ${state.unread} novos`} aria-expanded={open}
        onClick={() => { setOpen(!open); if (!open && state.unread) markRead(); }}>
        <Bell size={18} />
        {state.unread > 0 && <span className="bell-count">{state.unread}</span>}
      </button>
      {open && <div className="bell-panel" role="dialog" aria-label="Avisos">
        <strong>Avisos</strong>
        {state.rows.length ? <ul>{state.rows.map((r) => <li key={r.id} className={`level-${r.level} ${r.read_at ? "" : "unread"}`}>
          <small>{when(r.created_at)}</small><b>{r.title}</b>{r.body && <span>{r.body}</span>}
        </li>)}</ul> : <p className="muted">Nenhum aviso ainda.</p>}
        <p className="muted">Os mesmos avisos chegam por e-mail.</p>
      </div>}
      {toast && <div className={`bell-toast level-${toast.level}`} role="status" onClick={() => { setOpen(true); setToast(null); }}>
        <b>{toast.title}</b>{toast.body && <span>{toast.body.split("\n")[0]}</span>}
      </div>}
    </div>
  );
}

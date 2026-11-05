"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AgentFloor } from "./agent-floor";

/** Broadcast view: refreshes the floor every 20 seconds, like a live trading room. */
export function TvMode() {
  const [revision, setRevision] = useState(0);
  const [clock, setClock] = useState("");
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "medium" }));
    tick();
    const clockTimer = setInterval(tick, 1000);
    const floorTimer = setInterval(() => setRevision((n) => n + 1), 20000);
    return () => { clearInterval(clockTimer); clearInterval(floorTimer); };
  }, []);
  return (
    <main className="tv-mode">
      <header className="tv-header">
        <strong>ATLAS · Trading Floor</strong>
        <span>Atualização automática · {clock}</span>
        <Link className="tv-back-link" href="/app"><ArrowLeft size={16} aria-hidden="true" /> Voltar ao escritório</Link>
      </header>
      <AgentFloor connected revision={revision} tv />
      <p className="tv-footer">Dados da mesma equipe e carteira do escritório. A atualização das cotações depende da fonte indicada em cada ativo.</p>
    </main>
  );
}

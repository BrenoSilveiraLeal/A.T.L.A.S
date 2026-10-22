"use client";
import { useEffect, useState } from "react";
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
        <span><span className="live-dot" aria-hidden="true" /> AO VIVO · simulação · {clock}</span>
      </header>
      <AgentFloor connected revision={revision} tv />
      <p className="tv-footer">Resultados de simulação com cotação atrasada. Não é recomendação de investimento.</p>
    </main>
  );
}

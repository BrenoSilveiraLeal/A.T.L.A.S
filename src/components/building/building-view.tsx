"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, LocateFixed, Lock, Map as MapIcon } from "lucide-react";
import { officeOnFloor, OFFICES, parseFloor, STATUS_LABEL } from "@/core/building";
import { Elevator2D } from "./elevator-2d";
import type { BuildingApi } from "./building-3d";

/** The office floor entered last; the map highlights it. */
const LAST_OFFICE = "atlas-last-office";
/** Time for the camera to fly to the floor before the office opens. */
const FLY_MS = 900;

// three.js is loaded only in the browser.
const Building3D = dynamic(() => import("./building-3d").then((m) => m.Building3D), {
  ssr: false, loading: () => <div className="building3d-canvas building3d-loading" role="status">Montando o prédio…</div>,
});

/**
 * The ATLAS map, the first screen (owner, 01/11/2026: like choosing a home in a life sim's city
 * expansion, the owner picks the office to use; "não vai ficar no mapa... vai para outra tela que
 * foque só no escritório"): the ATLAS tower in its city and the list of its offices. Choosing an open
 * office flies the camera to its floor and opens the office on its own page; the office's "Trocar de
 * escritório" button comes back here. Offices that are not open only say so.
 */
export function BuildingView() {
  const router = useRouter();
  // The office used last, or the floor the office page came back from, glows on the map.
  const [last] = useState<number | null>(() => {
    if (typeof window === "undefined") return null;
    const back = parseFloor(new URLSearchParams(window.location.search).get("andar"));
    try { return back ?? parseFloor(localStorage.getItem(LAST_OFFICE)); } catch { return back; }
  });
  const [entering, setEntering] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  // Phones start with the flat section; the choice is remembered.
  const [mode, setMode] = useState<"3d" | "2d">(() => {
    if (typeof window === "undefined") return "3d";
    try { const saved = localStorage.getItem("atlas-building-view"); if (saved === "2d" || saved === "3d") return saved; } catch { /* storage blocked */ }
    return window.matchMedia("(max-width: 768px)").matches ? "2d" : "3d";
  });
  const [failed, setFailed] = useState(false);
  const api = useRef<BuildingApi | null>(null);
  const flat = mode === "2d" || failed;

  const go = useCallback((floor: number | null) => {
    const office = floor !== null ? officeOnFloor(floor) : null;
    if (!office) return;
    if (!office.href) {
      setNotice(office.status === "LOCKED" ? `${office.name} está bloqueado: previsto para uma etapa futura.` : `${office.name} está em construção e ainda não abre.`);
      return;
    }
    setNotice("");
    try { localStorage.setItem(LAST_OFFICE, String(office.floor)); } catch { /* storage blocked */ }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEntering(office.floor);
    window.setTimeout(() => router.push(office.href!), flat || reduced ? 0 : FLY_MS);
  }, [router, flat]);
  const toggle = () => setMode((m) => {
    const next = m === "3d" ? "2d" : "3d";
    try { localStorage.setItem("atlas-building-view", next); } catch { /* storage blocked */ }
    return next;
  });
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const list = [...OFFICES].sort((a, b) => b.floor - a.floor);
  return (
    <div className="building">
      <div className="building-stage">
        {flat ? <div className="building-flat"><Elevator2D selected={entering ?? last} onSelect={go} onEnter={go} /></div>
          : <Building3D selected={entering} highlight={last} onSelect={go} onEnter={go} onFail={() => setFailed(true)} apiRef={api} />}
        <header className="building-brand">
          <span className="brand-mark">A</span>
          <div><strong>ATLAS</strong><small>Escolha o escritório</small></div>
        </header>
        <div className="building-tools">
          {!flat && <button type="button" className="icon-button secondary" onClick={() => api.current?.reset()} aria-label="Centralizar o prédio" title="Centralizar"><LocateFixed size={18} /></button>}
          {!failed && <button type="button" className="icon-button secondary" onClick={toggle} aria-label={flat ? "Ver o prédio em 3D" : "Ver o prédio em corte (2D)"} title={flat ? "Ver em 3D" : "Ver em 2D"}>
            {flat ? <Box size={18} /> : <MapIcon size={18} />}
          </button>}
        </div>
        {notice ? <p className="building-hint notice" role="status">{notice}</p>
          : entering ? <p className="building-hint" role="status">Entrando em {officeOnFloor(entering)?.name}…</p>
          : !flat && <p className="building-hint">Arraste para girar · roda ou pinça para aproximar · clique num escritório para entrar</p>}
        {failed && <p className="building-hint" role="status">O 3D não está disponível neste aparelho; mostrando o prédio em corte.</p>}
      </div>

      <aside className="building-panel" aria-label="Escritórios ATLAS">
        <h1 className="building-panel-title">Escritórios ATLAS</h1>
        <ul className="office-list">
          {list.map((office) => (
            <li key={office.id}>
              <button type="button" className={`office-row status-${office.status.toLowerCase()} ${office.floor === last ? "last" : ""}`}
                style={{ "--office": office.color } as React.CSSProperties} onClick={() => go(office.floor)} disabled={entering !== null}
                aria-label={`${office.name}, andar ${office.floor}, ${STATUS_LABEL[office.status]}${office.href ? ". Entrar" : ""}`}>
                <b>{office.floor}</b>
                <span><strong>{office.name}</strong>{office.tagline && <small>{office.tagline}</small>}</span>
                <em>{office.status === "LOCKED" && <Lock size={11} />} {office.floor === last && office.href ? "Último usado" : STATUS_LABEL[office.status]}</em>
              </button>
            </li>
          ))}
        </ul>
      </aside>
    </div>
  );
}

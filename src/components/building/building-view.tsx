"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Building, ChevronDown, ChevronUp, LocateFixed, Lock, Map as MapIcon } from "lucide-react";
import { officeOnFloor, OFFICES, parseFloor, STATUS_LABEL, TENANTS, TOWER } from "@/core/building";
import { Elevator2D } from "./elevator-2d";
import type { BuildingApi } from "./building-3d";

/** The office floor entered last, so the map opens on it. */
const LAST_OFFICE = "atlas-last-office";

// three.js is loaded only in the browser.
const Building3D = dynamic(() => import("./building-3d").then((m) => m.Building3D), {
  ssr: false, loading: () => <div className="building3d-canvas building3d-loading" role="status">Montando o prédio…</div>,
});

/**
 * The ATLAS building, the first screen (owner, 01/11/2026: like choosing a home floor in a life
 * sim's city expansion, the owner picks the office to use and comes back here to change office):
 * the tower in its city, level buttons, the elevator panel with every floor, and the card of the
 * selected office with the way in. "?andar=8" opens with that floor selected (the office's "Trocar
 * de escritório" button comes back this way); without it, the office used last is selected.
 */
export function BuildingView() {
  const router = useRouter();
  // The floor from the address, else the office used last (back on the map to change office).
  const [last] = useState<number | null>(() => { try { return parseFloor(localStorage.getItem(LAST_OFFICE)); } catch { return null; } });
  const [selected, setSelected] = useState<number | null>(() => (typeof window === "undefined" ? null : parseFloor(new URLSearchParams(window.location.search).get("andar")) ?? last));
  // Phones start with the flat section; the choice is remembered.
  const [mode, setMode] = useState<"3d" | "2d">(() => {
    if (typeof window === "undefined") return "3d";
    try { const saved = localStorage.getItem("atlas-building-view"); if (saved === "2d" || saved === "3d") return saved; } catch { /* storage blocked */ }
    return window.matchMedia("(max-width: 768px)").matches ? "2d" : "3d";
  });
  const [failed, setFailed] = useState(false);
  const api = useRef<BuildingApi | null>(null);
  const office = selected !== null ? officeOnFloor(selected) : null;

  const select = useCallback((floor: number | null) => {
    setSelected(floor);
    const url = floor ? `/predio?andar=${floor}` : "/predio";
    window.history.replaceState(null, "", url);
  }, []);
  const enter = useCallback((floor: number) => {
    const target = officeOnFloor(floor);
    if (!target?.href) { select(floor); return; }
    try { localStorage.setItem(LAST_OFFICE, String(floor)); } catch { /* storage blocked */ }
    router.push(target.href);
  }, [router, select]);
  // Level buttons, like a life sim's: up and down through the office floors; below the lowest, the whole tower.
  const floorsUp = OFFICES.map((o) => o.floor).sort((a, b) => a - b);
  const step = (delta: 1 | -1) => {
    if (selected === null) { if (delta > 0) select(floorsUp[0]); return; }
    const next = floorsUp[floorsUp.indexOf(selected) + delta];
    select(next ?? (delta < 0 ? null : selected));
  };
  const toggle = () => setMode((m) => {
    const next = m === "3d" ? "2d" : "3d";
    try { localStorage.setItem("atlas-building-view", next); } catch { /* storage blocked */ }
    return next;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") select(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select]);

  const flat = mode === "2d" || failed;
  return (
    <div className="building">
      <div className="building-stage">
        {flat ? <div className="building-flat"><Elevator2D selected={selected} onSelect={select} onEnter={enter} /></div>
          : <Building3D selected={selected} onSelect={select} onEnter={enter} onFail={() => setFailed(true)} apiRef={api} />}
        <header className="building-brand">
          <span className="brand-mark">A</span>
          <div><strong>ATLAS</strong><small>Escolha o escritório</small></div>
        </header>
        <div className="level-picker" role="group" aria-label="Nível">
          <button type="button" onClick={() => step(1)} disabled={selected === floorsUp.at(-1)} aria-label="Subir um andar" title="Subir um andar"><ChevronUp size={20} /></button>
          <span aria-live="polite">{selected === null ? "Prédio" : `${selected}º`}</span>
          <button type="button" onClick={() => step(-1)} disabled={selected === null} aria-label="Descer um andar" title={selected === floorsUp[0] ? "Ver o prédio inteiro" : "Descer um andar"}><ChevronDown size={20} /></button>
        </div>
        <div className="building-tools">
          {!flat && <button type="button" className="icon-button secondary" onClick={() => api.current?.reset()} aria-label="Centralizar o prédio" title="Centralizar"><LocateFixed size={18} /></button>}
          {!failed && <button type="button" className="icon-button secondary" onClick={toggle} aria-label={flat ? "Ver o prédio em 3D" : "Ver o prédio em corte (2D)"} title={flat ? "Ver em 3D" : "Ver em 2D"}>
            {flat ? <Box size={18} /> : <MapIcon size={18} />}
          </button>}
        </div>
        {!flat && <p className="building-hint">Arraste para girar · roda ou pinça para aproximar · clique num andar</p>}
        {failed && <p className="building-hint" role="status">O 3D não está disponível neste aparelho; mostrando o prédio em corte.</p>}
      </div>

      <aside className="building-panel" aria-label="Elevador">
        <h1 className="building-panel-title"><Building size={16} /> Elevador</h1>
        <ol className="elevator-list">
          {Array.from({ length: TOWER.floors + 1 }, (_, i) => TOWER.floors - i).map((floor) => {
            const here = officeOnFloor(floor);
            if (!here) return (
              <li key={floor} className="elevator-row tenant"><b>{floor === 0 ? "T" : floor}</b><span>{floor === 0 ? "Térreo · recepção" : TENANTS[floor]}</span></li>
            );
            return (
              <li key={floor}>
                <button type="button" className={`elevator-row office status-${here.status.toLowerCase()} ${selected === floor ? "selected" : ""}`}
                  style={{ "--office": here.color } as React.CSSProperties} aria-pressed={selected === floor}
                  onClick={() => select(selected === floor ? null : floor)} onDoubleClick={() => enter(floor)}>
                  <b>{floor}</b><span>{here.name}</span><small>{here.status === "LOCKED" && <Lock size={11} />} {STATUS_LABEL[here.status]}</small>
                </button>
              </li>
            );
          })}
        </ol>

        <section className={`floor-card ${office ? `status-${office.status.toLowerCase()}` : ""}`} aria-live="polite" style={office ? ({ "--office": office.color } as React.CSSProperties) : undefined}>
          {office ? <>
            <p className="floor-card-eyebrow">Andar {office.floor} · {STATUS_LABEL[office.status]}{office.floor === last ? " · último usado" : ""}</p>
            <h2>{office.name}</h2>
            {office.fullName && <p className="floor-card-full"><b>{office.fullName}</b>{office.tagline && <> · {office.tagline}</>}</p>}
            <p>{office.summary}</p>
            {office.href ? <Link className="button" href={office.href} onClick={() => { try { localStorage.setItem(LAST_OFFICE, String(office.floor)); } catch { /* storage blocked */ } }}>Entrar no escritório</Link>
              : <button type="button" className="button" disabled>{office.status === "LOCKED" ? "Bloqueado" : "Ainda não abre"}</button>}
          </> : <>
            <p className="floor-card-eyebrow">ATLAS</p>
            <h2>Um prédio, {OFFICES.length} escritórios</h2>
            <p>Cada escritório tem agentes, regras, contas e limites próprios. Escolha um andar no prédio ou na lista.</p>
          </>}
        </section>
      </aside>
    </div>
  );
}

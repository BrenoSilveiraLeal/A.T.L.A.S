"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Info, LocateFixed, Lock, Map as MapIcon, Moon, Sun } from "lucide-react";
import { officeOnFloor, OFFICES, parseFloor, STATUS_LABEL } from "@/core/building";
import { Elevator2D } from "./elevator-2d";
import type { BuildingApi } from "./building-3d";

/** The office floor entered last; the map highlights it. */
const LAST_OFFICE = "atlas-last-office";
const NIGHT = "atlas-building-night";
/** Time for the camera to fly to the floor before the office opens. */
const FLY_MS = 1700;

// three.js is loaded only in the browser.
const Building3D = dynamic(() => import("./building-3d").then((m) => m.Building3D), {
  ssr: false, loading: () => <div className="building3d-canvas building3d-loading" role="status">Preparando a cena…</div>,
});

/**
 * The ATLAS map, the first screen (owner, 01/11/2026: like choosing a home in a life sim's city
 * expansion, the owner picks the office to use, and the office opens on its own page; presented like
 * an architectural showcase, with an opening shot through the clouds and day and night). The
 * office's "Trocar de escritório" button comes back here. Offices that are not open only say so.
 */
export function BuildingView() {
  const router = useRouter();
  // The office used last, or the floor the office page came back from, glows on the map.
  const [last] = useState<number | null>(() => {
    const back = parseFloor(new URLSearchParams(window.location.search).get("andar"));
    try { return back ?? parseFloor(localStorage.getItem(LAST_OFFICE)); } catch { return back; }
  });
  // Coming back from an office skips the opening shot.
  const [intro] = useState(() => !new URLSearchParams(window.location.search).has("andar"));
  const [night, setNight] = useState(() => {
    try { const saved = localStorage.getItem(NIGHT); if (saved === "1" || saved === "0") return saved === "1"; } catch { /* storage blocked */ }
    const hour = new Date().getHours();
    return hour >= 18 || hour < 6;
  });
  const [entering, setEntering] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [about, setAbout] = useState(false);
  // Phones start with the flat section; the choice is remembered.
  const [mode, setMode] = useState<"3d" | "2d">(() => {
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
    // The office page continues the move: its camera starts outside the tower and comes in.
    try { sessionStorage.setItem("atlas-entering", String(office.floor)); } catch { /* storage blocked */ }
    window.setTimeout(() => router.push(office.href!), flat || reduced ? 0 : FLY_MS);
  }, [router, flat]);
  const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };
  const toggleMode = () => setMode((m) => { const next = m === "3d" ? "2d" : "3d"; remember("atlas-building-view", next); return next; });
  const toggleNight = () => setNight((n) => { remember(NIGHT, n ? "0" : "1"); return !n; });
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const list = [...OFFICES].sort((a, b) => b.floor - a.floor);
  return (
    <div className={`building ${night ? "is-night" : ""}`}>
      <div className="building-stage">
        {flat ? <div className="building-flat"><Elevator2D selected={entering ?? last} onSelect={go} onEnter={go} /></div>
          : <Building3D selected={entering} highlight={last} night={night} intro={intro} onSelect={go} onEnter={go} onFail={() => setFailed(true)} apiRef={api} />}

        {entering !== null && !flat && <div className="building-fade" aria-hidden="true" />}
        {intro && !flat && <div className="building-intro" aria-hidden="true">
          <small>ATLAS apresenta</small><strong>A sede</strong><span>Escolha o escritório</span>
        </div>}

        <header className="building-brand">
          <span className="brand-mark">A</span>
          <div><strong>Sede ATLAS</strong><small>Escolha o escritório</small></div>
        </header>
        <div className="building-tools">
          {!flat && <button type="button" className="pill" onClick={toggleNight} aria-pressed={night} title={night ? "Mudar para dia" : "Mudar para noite"}>
            {night ? <Moon size={15} /> : <Sun size={15} />} {night ? "Noite" : "Dia"}
          </button>}
          {!flat && <button type="button" className="round" onClick={() => api.current?.reset()} aria-label="Centralizar o prédio" title="Centralizar"><LocateFixed size={17} /></button>}
          {!failed && <button type="button" className="round" onClick={toggleMode} aria-label={flat ? "Ver o prédio em 3D" : "Ver o prédio em corte (2D)"} title={flat ? "Ver em 3D" : "Ver em 2D"}>
            {flat ? <Box size={17} /> : <MapIcon size={17} />}
          </button>}
          <button type="button" className="round" onClick={() => setAbout((a) => !a)} aria-expanded={about} aria-label="Sobre o mapa" title="Sobre"><Info size={17} /></button>
        </div>

        {about && <section className="glass-card building-about" role="dialog" aria-label="Sobre o mapa">
          <h2>Sede ATLAS</h2>
          <p>Cada andar destacado é um escritório da empresa, com agentes, regras, contas e limites próprios. Clique num escritório para entrar; dentro dele, “Trocar de escritório” volta aqui.</p>
        </section>}

        <aside className="glass-card building-offices" aria-label="Escritórios ATLAS">
          <h1>Escritórios</h1>
          <ul>
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

        <footer className="building-foot">
          {notice ? <p className="building-hint notice" role="status">{notice}</p>
            : entering ? <p className="building-hint" role="status">Entrando em {officeOnFloor(entering)?.name}…</p>
            : failed ? <p className="building-hint" role="status">O 3D não está disponível neste aparelho; mostrando o prédio em corte.</p>
            : !flat && <p className="building-hint">Arraste para explorar · roda ou pinça para aproximar · clique num escritório para entrar</p>}
          <div className="building-signature" aria-hidden="true"><span className="brand-mark">A</span><strong>ATLAS</strong></div>
        </footer>
      </div>
    </div>
  );
}

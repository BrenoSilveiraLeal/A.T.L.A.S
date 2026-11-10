"use client";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Hammer, Info, LocateFixed, Moon, Sun, Volume2, VolumeX } from "lucide-react";
import { officeOnFloor, OFFICES, parseFloor, STATUS_LABEL } from "@/core/building";
import type { BuildingApi } from "./building-3d";
import { useCitySound } from "./city-sound";
import { CITY_NIGHT_STORAGE_KEY, setOfficeEntryNightPreference } from "./time-of-day";

/** The office floor entered last; the map highlights it. */
const LAST_OFFICE = "atlas-last-office";
const NIGHT = CITY_NIGHT_STORAGE_KEY;
const SOUND = "atlas-city-sound";
/** Time for the camera to fly to the floor before the office opens. */
const FLY_MS = 1700;

// three.js is loaded only in the browser.
const Building3D = dynamic(() => import("./building-3d").then((m) => m.Building3D), {
  // No text while loading: the opening title is shown over it (owner, 01/11/2026: text showed behind it).
  ssr: false, loading: () => <div className="building3d-canvas building3d-loading" role="status" aria-label="Preparando a cena" />,
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
  // The "?andar=" only says where we came from: once read, drop it from the address, so a reload (F5)
  // is a fresh visit and plays the opening shot down through the clouds (owner, 10/11/2026).
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("andar")) return;
    url.searchParams.delete("andar");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const [night, setNight] = useState(() => {
    try { const saved = localStorage.getItem(NIGHT); if (saved === "1" || saved === "0") return saved === "1"; } catch { /* storage blocked */ }
    const hour = new Date().getHours();
    return hour >= 18 || hour < 6;
  });
  const [entering, setEntering] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [showHelp, setShowHelp] = useState(true);
  const [showList, setShowList] = useState(false);
  const officeListChosen = useRef(false);
  const officeListTimer = useRef<number | null>(null);
  // The flat (2D) section is gone (owner, 01/11/2026: "tira essa tela horrível"): without 3D, the
  // list of offices is the map.
  const [failed, setFailed] = useState(false);
  const api = useRef<BuildingApi | null>(null);
  const flat = failed;
  const onMapReady = useCallback(() => {
    if (officeListTimer.current !== null) window.clearTimeout(officeListTimer.current);
    officeListTimer.current = window.setTimeout(() => {
      if (!officeListChosen.current) setShowList(true);
      officeListTimer.current = null;
    }, 2000);
  }, []);
  const onMapFail = useCallback(() => {
    if (officeListTimer.current !== null) window.clearTimeout(officeListTimer.current);
    officeListTimer.current = null;
    setFailed(true);
    setShowList(true);
  }, []);
  useEffect(() => () => {
    if (officeListTimer.current !== null) window.clearTimeout(officeListTimer.current);
  }, []);
  // While the owner looks at the map, get the offices' pages and the 3D office code ready, so entering
  // one does not wait for them (owner, 10/11/2026: "um delay muito grande para abrir o escritório").
  useEffect(() => {
    if (flat) return;
    const timer = window.setTimeout(() => {
      for (const office of OFFICES) if (office.href && office.status === "ACTIVE") router.prefetch(office.href);
      void import("../office-3d");
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [router, flat]);
  // The city's sound, on unless turned off (remembered in the browser).
  const [sound, setSound] = useState(() => { try { return localStorage.getItem(SOUND) !== "off"; } catch { return true; } });
  useCitySound(sound && !flat, night);

  // Keep the exploration tip visible briefly, then leave the map unobstructed.
  useEffect(() => {
    const timer = window.setTimeout(() => setShowHelp(false), 8000);
    return () => window.clearTimeout(timer);
  }, []);

  const go = useCallback((floor: number | null) => {
    const office = floor !== null ? officeOnFloor(floor) : null;
    if (!office) return;
    if (!office.href) {
      setNotice(office.status === "LOCKED" ? `${office.name} está em desenvolvimento: abre numa etapa futura.` : `${office.name} ainda não abre.`);
      return;
    }
    setNotice("");
    try { localStorage.setItem(LAST_OFFICE, String(office.floor)); } catch { /* storage blocked */ }
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setEntering(office.floor);
    setOfficeEntryNightPreference(night);
    // The office page continues the move: its camera starts outside the tower and comes in.
    try { sessionStorage.setItem("atlas-entering", String(office.floor)); } catch { /* storage blocked */ }
    window.setTimeout(() => router.push(office.href!), flat || reduced ? 0 : FLY_MS);
    // If the office never opens (slow or failed navigation), do not leave the map frozen close to the tower.
    window.setTimeout(() => { if (window.location.pathname.startsWith("/predio")) setEntering(null); }, FLY_MS + 12000);
  }, [router, flat, night]);
  const remember = (key: string, value: string) => { try { localStorage.setItem(key, value); } catch { /* storage blocked */ } };
  const toggleNight = () => setNight((n) => { remember(NIGHT, n ? "0" : "1"); return !n; });
  const toggleSound = () => setSound((s) => { remember(SOUND, s ? "off" : "on"); return !s; });
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(""), 4000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const list = [...OFFICES].sort((a, b) => b.floor - a.floor);
  return (
    <div className={`building ${night ? "is-night" : ""}`}>
      <div className="building-stage">
        {flat ? <div className="building-flat" aria-hidden="true" />
          : <Building3D selected={entering} highlight={last} night={night} intro={intro} tags={showList} onSelect={go} onEnter={go} onReady={onMapReady} onFail={onMapFail} apiRef={api} />}

        {entering !== null && !flat && <div className="building-fade" aria-hidden="true" />}
        {intro && !flat && <div className="building-intro" aria-hidden="true">
          <strong>A.T.L.A.S.</strong><span>Autonomous Trading &amp; Learning Agent System</span>
        </div>}

        <header className="building-brand">
          <span className="brand-mark">A</span>
          <div><strong>Sede ATLAS</strong><small>Escolha o escritório</small></div>
        </header>
        <div className="building-tools">
          {!flat && <button type="button" className="pill" onClick={toggleNight} aria-pressed={night} title={night ? "Mudar para dia" : "Mudar para noite"}>
            {night ? <Moon size={15} /> : <Sun size={15} />} {night ? "Noite" : "Dia"}
          </button>}
          {!flat && <button type="button" className="round" onClick={toggleSound} aria-pressed={sound}
            aria-label={sound ? "Desligar o som da cidade" : "Ligar o som da cidade"} title={sound ? "Som da cidade ligado" : "Som da cidade desligado"}>
            {sound ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>}
          {!flat && <button type="button" className="round" onClick={() => api.current?.reset()} aria-label="Centralizar o prédio" title="Centralizar"><LocateFixed size={17} /></button>}
          {/* Owner, 01/11/2026: the "i" hides and shows the list of offices, to see the city. */}
          <button type="button" className={`round ${showList ? "" : "active"}`} onClick={() => { officeListChosen.current = true; setShowList((s) => !s); }} aria-pressed={!showList}
            aria-controls="building-offices" aria-label={showList ? "Esconder a lista de escritórios" : "Mostrar a lista de escritórios"} title={showList ? "Esconder escritórios" : "Mostrar escritórios"}><Info size={17} /></button>
        </div>

        <aside id="building-offices" className="glass-card building-offices" aria-label="Escritórios ATLAS" hidden={!showList}>
          <h1>Escritórios</h1>
          <ul>
            {list.map((office) => (
              <li key={office.id}>
                <button type="button" className={`office-row status-${office.status.toLowerCase()} ${office.floor === last ? "last" : ""}`}
                  style={{ "--office": office.color } as React.CSSProperties} onClick={() => go(office.floor)} disabled={entering !== null}
                  aria-label={`${office.name}, andar ${office.floor}, ${STATUS_LABEL[office.status]}${office.href ? ". Entrar" : ""}`}>
                  <b>{office.floor}</b>
                  {/* Name and status on one line, so the description gets the full width (two lines at most). */}
                  <span>
                    <span className="office-row-head"><strong>{office.name}</strong>
                      <em>{office.status === "LOCKED" && <Hammer size={11} />} {office.floor === last && office.href ? "Último usado" : STATUS_LABEL[office.status]}</em></span>
                    {/* What the acronym stands for (English), then its Portuguese description. */}
                    {office.fullName && <small className="office-row-en">{office.fullName}</small>}
                    {office.tagline && <small>{office.tagline}</small>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <footer className="building-foot">
          {notice ? <p className="building-hint notice" role="status">{notice}</p>
            : entering ? <p className="building-hint" role="status">Entrando em {officeOnFloor(entering)?.name}…</p>
            : failed ? <p className="building-hint" role="status">O 3D não está disponível neste aparelho; escolha o escritório na lista.</p>
            : !flat && showHelp && <p className="building-hint">Arraste para explorar · roda ou pinça para aproximar · clique num escritório para entrar</p>}
          <div className="building-signature" aria-hidden="true"><span className="brand-mark">A</span><strong>ATLAS</strong></div>
        </footer>
      </div>
    </div>
  );
}

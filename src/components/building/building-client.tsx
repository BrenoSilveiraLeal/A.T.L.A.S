"use client";
import dynamic from "next/dynamic";

// The building view reads the address, the screen size and saved preferences, so it renders only in
// the browser (no server markup to mismatch).
export const BuildingClient = dynamic(() => import("./building-view").then((m) => m.BuildingView), {
  ssr: false, loading: () => <div className="building building-loading" role="status">Abrindo o prédio ATLAS…</div>,
});

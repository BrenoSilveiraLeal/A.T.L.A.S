"use client";
import dynamic from "next/dynamic";

// The DASH page uses the 3D room and browser-only state, so it renders only in the browser.
export const DashClient = dynamic(() => import("./dash-view").then((m) => m.DashView), {
  ssr: false, loading: () => <div className="dash dash-loading" role="status">Abrindo o DASH…</div>,
});

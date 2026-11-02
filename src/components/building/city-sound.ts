"use client";
import { useEffect, useRef } from "react";

/**
 * The city's sound on the ATLAS map (owner, 02/11/2026: "tinha que adicionar um som no mapa também,
 * da cidade, e a opção de tirar"; then "tire o barulho de carro"): no cars, horns or sirens, only a
 * soft far-off hum of the city and a breath of wind; birds by day, crickets at night. Everything is
 * synthesised, as the office ambience (office-3d), so there are no files.
 */
export interface CitySound { night: (on: boolean) => void; stop: () => void }

const HUM = { day: 0.05, night: 0.03 };

export function startCitySound(ctx: AudioContext, startAtNight: boolean): CitySound {
  let night = startAtNight, stopped = false;
  const master = ctx.createGain(); master.connect(ctx.destination);
  // Fades in; the mix stays well clear of distortion.
  master.gain.setValueAtTime(0, ctx.currentTime); master.gain.linearRampToValueAtTime(1.8, ctx.currentTime + 2.5);
  const timers: number[] = [];
  const later = (fn: () => void, ms: number) => { timers.push(window.setTimeout(() => { if (!stopped) fn(); }, ms)); };
  const between = (a: number, b: number) => a + Math.random() * (b - a);

  // Noise to shape: brown (deep, for the hum) and white (for the wind).
  const noise = (seconds: number, brown: boolean) => {
    const data = new Float32Array(Math.round(ctx.sampleRate * seconds));
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * white) / 1.02; data[i] = last * 3.5; } else data[i] = white;
    }
    const buffer = ctx.createBuffer(1, data.length, ctx.sampleRate); buffer.copyToChannel(data, 0);
    return buffer;
  };
  const loop = (buffer: AudioBuffer) => { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; return s; };
  const sources: AudioScheduledSourceNode[] = [];

  // The city far off: a soft, low hum that swells and eases slowly.
  const hum = ctx.createGain(); hum.gain.value = night ? HUM.night : HUM.day;
  const low = ctx.createBiquadFilter(); low.type = "lowpass"; low.frequency.value = 500;
  const humSrc = loop(noise(5, true)); humSrc.connect(low).connect(hum).connect(master);
  const swell = ctx.createOscillator(), swellDepth = ctx.createGain(); swell.frequency.value = 0.06; swellDepth.gain.value = 0.012;
  swell.connect(swellDepth).connect(hum.gain);
  // Wind: a soft hiss rising and falling.
  const wind = ctx.createGain(); wind.gain.value = 0.012;
  const windBand = ctx.createBiquadFilter(); windBand.type = "bandpass"; windBand.frequency.value = 700; windBand.Q.value = 0.5;
  const windSrc = loop(noise(3, false)); windSrc.connect(windBand).connect(wind).connect(master);
  const gust = ctx.createOscillator(), gustDepth = ctx.createGain(); gust.frequency.value = 0.09; gustDepth.gain.value = 0.009;
  gust.connect(gustDepth).connect(wind.gain);
  for (const s of [humSrc, swell, windSrc, gust]) { s.start(); sources.push(s); }

  // Birds by day: a few quick chirps from one spot.
  const birds = () => {
    if (!night) {
      const pan = ctx.createStereoPanner(); pan.pan.value = between(-0.9, 0.9); pan.connect(master);
      let at = ctx.currentTime + 0.05;
      const base = between(2800, 4200);
      for (let k = 0, n = 2 + Math.floor(Math.random() * 4); k < n; k++) {
        const o = ctx.createOscillator(), g = ctx.createGain(), f = base * between(0.9, 1.1);
        o.frequency.setValueAtTime(f, at); o.frequency.exponentialRampToValueAtTime(f * between(1.2, 1.5), at + 0.07);
        g.gain.setValueAtTime(0.0001, at); g.gain.exponentialRampToValueAtTime(0.012, at + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, at + 0.09);
        o.connect(g).connect(pan); o.start(at); o.stop(at + 0.1);
        at += between(0.12, 0.25);
      }
    }
    later(birds, between(3000, 9000));
  };
  // Crickets at night: short trills of a high tone, from both sides.
  const crickets = () => {
    if (night) {
      for (const side of [-0.6, 0.6]) {
        if (Math.random() < 0.3) continue;
        const pan = ctx.createStereoPanner(); pan.pan.value = side; pan.connect(master);
        const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.value = between(4300, 4800); g.gain.value = 0;
        o.connect(g).connect(pan);
        const t0 = ctx.currentTime + between(0.05, 0.4);
        for (let k = 0; k < 3; k++) { g.gain.setValueAtTime(0.006, t0 + k * 0.06); g.gain.setValueAtTime(0, t0 + k * 0.06 + 0.035); }
        o.start(t0); o.stop(t0 + 0.25);
      }
    }
    later(crickets, between(800, 1400));
  };
  later(birds, 1500); later(crickets, 1000);

  return {
    night: (on) => {
      night = on;
      hum.gain.cancelScheduledValues(ctx.currentTime); hum.gain.setValueAtTime(hum.gain.value, ctx.currentTime);
      hum.gain.linearRampToValueAtTime(on ? HUM.night : HUM.day, ctx.currentTime + 2);
    },
    stop: () => {
      stopped = true; timers.forEach((t) => window.clearTimeout(t));
      master.gain.cancelScheduledValues(ctx.currentTime); master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
      window.setTimeout(() => { sources.forEach((s) => s.stop()); master.disconnect(); }, 500);
    },
  };
}

/**
 * Plays the city's sound while `on`. Browsers only allow sound after the page is touched, so it
 * starts at the first click or key (or right away if the page has been touched already); it pauses
 * while the tab is hidden and fades out when the map closes.
 */
export function useCitySound(on: boolean, night: boolean) {
  const nightNow = useRef(night), live = useRef<CitySound | null>(null);
  useEffect(() => { nightNow.current = night; live.current?.night(night); }, [night]);
  useEffect(() => {
    if (!on) return;
    let ctx: AudioContext | null = null, closed = false;
    const begin = () => {
      if (closed || live.current) return;
      try { ctx ??= new AudioContext(); } catch { return; }
      const c = ctx;
      void c.resume().then(() => { if (!closed && !live.current && c.state === "running") live.current = startCitySound(c, nightNow.current); });
    };
    const touched = (navigator as Navigator & { userActivation?: { hasBeenActive: boolean } }).userActivation?.hasBeenActive;
    if (touched) begin();
    window.addEventListener("pointerdown", begin); window.addEventListener("keydown", begin);
    const onVisible = () => { if (ctx) void (document.hidden ? ctx.suspend() : ctx.resume()); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      closed = true;
      window.removeEventListener("pointerdown", begin); window.removeEventListener("keydown", begin);
      document.removeEventListener("visibilitychange", onVisible);
      live.current?.stop(); live.current = null;
      const c = ctx; window.setTimeout(() => void c?.close(), 600);
    };
  }, [on]);
}

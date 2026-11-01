"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { Building, ShieldAlert } from "lucide-react";
import { officeById } from "@/core/building";
import { DATA_LABEL, DESKS, deskState, INITIAL_STATUS, MARKET_LABEL, ORDER_STATES, type DashStatus } from "@/core/daytrade/desks";

const Dash3D = dynamic(() => import("./dash-3d").then((m) => m.Dash3D), {
  ssr: false, loading: () => <div className="dash3d dash3d-loading" role="status">Montando a sala do DASH…</div>,
});

/**
 * The DASH office page (owner, 01/11/2026: "crie o escritório do DASH para eu poder entrar e começar
 * a mexer"): the trading room on its floor of the ATLAS tower and the day-trade dashboard. Nothing
 * is connected yet — no feed, no broker, no orders — so every panel says exactly that, in simulated
 * mode; no number here is invented. The next steps are in docs/daytrade/ARQUITETURA.md.
 */
export function DashView() {
  const office = officeById("dash")!;
  const [status] = useState<DashStatus>(INITIAL_STATUS);
  const idle = deskState(status) === "IDLE";
  return (
    <div className="dash">
      <header className="dash-top">
        <div className="dash-name">
          <span className="dash-mark">D</span>
          <div><strong>{office.name}</strong><small>{office.tagline} · Andar {office.floor}</small></div>
        </div>
        <div className="dash-top-actions">
          <span className={`dash-mode ${status.mode === "SIMULATED" ? "sim" : "live"}`}>{status.mode === "SIMULATED" ? "SIMULADO" : "REAL"}</span>
          <Link className="dash-map-link" href={`/predio?andar=${office.floor}`}><Building size={16} /> Trocar de escritório</Link>
        </div>
      </header>

      <Dash3D status={status} />

      <p className="dash-banner" role="note"><ShieldAlert size={16} /> O DASH ainda não tem feed, corretora nem estratégia aprovada. Ele não envia ordens; tudo aqui é simulado ou vazio até cada parte ser conectada e testada.</p>

      <section className="dash-grid" aria-label="Painel do DASH">
        <article className="dash-card">
          <h2>Sessão</h2>
          <dl>
            <div><dt>Mercado</dt><dd>{MARKET_LABEL[status.market]}</dd></div>
            <div><dt>Modo</dt><dd>{status.mode === "SIMULATED" ? "Simulado" : "Real"}</dd></div>
            <div><dt>Dados</dt><dd>{DATA_LABEL[status.data]}</dd></div>
          </dl>
          <p className="dash-note">Calendário e horários de futuros ainda não confirmados: o mercado aparece como não verificado.</p>
        </article>
        <article className="dash-card">
          <h2>Corretora e instrumento</h2>
          <dl>
            <div><dt>Corretora</dt><dd>{status.broker ?? "Nenhuma conectada"}</dd></div>
            <div><dt>Instrumento</dt><dd>{status.instrument ?? "—"}</dd></div>
            <div><dt>Conta</dt><dd>Separada do escritório de dividendos</dd></div>
          </dl>
        </article>
        <article className="dash-card">
          <h2>Sinais</h2>
          <p className="dash-big">{status.signals}</p>
          <p className="dash-note">Sinais em análise. Um sinal pode ser recusado; a sessão pode terminar sem operar.</p>
        </article>
        <article className="dash-card wide">
          <h2>Ordens</h2>
          <ul className="dash-orders">
            {ORDER_STATES.map((s) => <li key={s.id}><span>{s.label}</span><b>{status.orders[s.id]}</b></li>)}
          </ul>
        </article>
        <article className="dash-card">
          <h2>Posições e saldo</h2>
          <dl>
            <div><dt>Saldo confirmado pela corretora</dt><dd>—</dd></div>
            <div><dt>Bloqueado como garantia</dt><dd>—</dd></div>
            <div><dt>Saldo de simulação</dt><dd>—</dd></div>
            <div><dt>Posições</dt><dd>Nenhuma</dd></div>
          </dl>
        </article>
        <article className="dash-card">
          <h2>Resultado</h2>
          <dl>
            <div><dt>Simulado</dt><dd>—</dd></div>
            <div><dt>Real</dt><dd>—</dd></div>
          </dl>
          <p className="dash-note">Os dois nunca são somados.</p>
        </article>
        <article className="dash-card">
          <h2>Custos e tributos</h2>
          <dl>
            <div><dt>Corretagem e emolumentos</dt><dd>—</dd></div>
            <div><dt>Conversão cambial</dt><dd>—</dd></div>
            <div><dt>Estimativa de IR (day trade)</dt><dd>—</dd></div>
          </dl>
        </article>
        <article className="dash-card">
          <h2>Risco</h2>
          <dl>
            <div><dt>Perda máxima por operação</dt><dd>A definir</dd></div>
            <div><dt>Perda máxima diária</dt><dd>A definir</dd></div>
            <div><dt>Exposição e margem</dt><dd>A definir</dd></div>
            <div><dt>Envio de ordens</dt><dd>Bloqueado</dd></div>
          </dl>
        </article>
        <article className="dash-card wide">
          <h2>Mesas</h2>
          <ul className="dash-desks">
            {DESKS.map((d) => (
              <li key={d.id} style={{ "--desk": d.person.shirt } as React.CSSProperties}>
                <b>{d.person.name}</b><span><strong>{d.role}</strong><small>{d.job}</small></span>
                <em>{idle ? "Parada · sem feed" : "Observando"}</em>
              </li>
            ))}
          </ul>
        </article>
      </section>
    </div>
  );
}

"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useState } from "react";
import { Building, Building2, LayoutGrid, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { officeById } from "@/core/building";
import { DATA_LABEL, DESKS, deskState, INITIAL_STATUS, MARKET_LABEL, ORDER_STATES, type DashStatus } from "@/core/daytrade/desks";

const Dash3D = dynamic(() => import("./dash-3d").then((m) => m.Dash3D), {
  ssr: false, loading: () => <div className="dash3d dash3d-loading" role="status">Montando a sala do DASH…</div>,
});

const TABS = [
  { id: "office", label: "Escritório", icon: Building2, note: "A mesa de day trade e o que cada agente está fazendo." },
  { id: "panel", label: "Painel", icon: LayoutGrid, note: "Sessão, corretora, ordens, saldo, resultado e custos." },
  { id: "desks", label: "Mesas", icon: Users, note: "Quem faz o quê na mesa do DASH." },
  { id: "risk", label: "Risco", icon: ShieldCheck, note: "Os limites e as regras que valem para toda ordem." },
] as const;
type Tab = (typeof TABS)[number]["id"];

/**
 * The DASH office (owner, 01/11/2026: "crie o escritório do DASH para eu poder entrar e começar a
 * mexer"; "tem que criar a tela dele, como no escritório de dividendos"): the same frame as the
 * dividends office — glass top bar with the floor, the way back to the map and the tabs, a safety
 * strip — around the trading room on its floor of the ATLAS tower and the day-trade panels. Nothing is
 * connected yet — no feed, no broker, no orders — so every panel says exactly that, in simulated mode;
 * no number here is invented. The next steps are in docs/daytrade/ARQUITETURA.md.
 */
export function DashView() {
  const office = officeById("dash")!;
  const [status] = useState<DashStatus>(INITIAL_STATUS);
  const [tab, setTab] = useState<Tab>("office");
  const idle = deskState(status) === "IDLE";
  const current = TABS.find((t) => t.id === tab)!;

  const session = (
    <article className="dash-card">
      <h2>Sessão</h2>
      <dl>
        <div><dt>Mercado</dt><dd>{MARKET_LABEL[status.market]}</dd></div>
        <div><dt>Modo</dt><dd>{status.mode === "SIMULATED" ? "Simulado" : "Real"}</dd></div>
        <div><dt>Dados</dt><dd>{DATA_LABEL[status.data]}</dd></div>
      </dl>
      <p className="dash-note">Calendário e horários de futuros ainda não confirmados: o mercado aparece como não verificado.</p>
    </article>
  );
  const signals = (
    <article className="dash-card">
      <h2>Sinais</h2>
      <p className="dash-big">{status.signals}</p>
      <p className="dash-note">Sinais em análise. Um sinal pode ser recusado; a sessão pode terminar sem operar.</p>
    </article>
  );
  const orders = (
    <article className="dash-card wide">
      <h2>Ordens</h2>
      <ul className="dash-orders">
        {ORDER_STATES.map((s) => <li key={s.id}><span>{s.label}</span><b>{status.orders[s.id]}</b></li>)}
      </ul>
    </article>
  );
  const desks = (
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
  );
  const risk = (
    <article className="dash-card">
      <h2>Risco</h2>
      <dl>
        <div><dt>Perda máxima por operação</dt><dd>A definir</dd></div>
        <div><dt>Perda máxima diária</dt><dd>A definir</dd></div>
        <div><dt>Exposição e margem</dt><dd>A definir</dd></div>
        <div><dt>Envio de ordens</dt><dd>Bloqueado</dd></div>
      </dl>
    </article>
  );

  return (
    <div className="office-frame dash-frame">
      <a className="skip-link" href="#content">Ir para o conteúdo</a>
      <header className="office-bar">
        <div className="office-bar-id">
          <button type="button" className="office-badge" onClick={() => setTab("office")} aria-label={`${office.name}, andar ${office.floor} da sede ATLAS`}
            style={{ "--office": office.color } as React.CSSProperties}>
            <b>{office.floor}</b>
            <span><strong>{office.name}</strong><small>Sede ATLAS · {office.tagline}</small></span>
          </button>
          <Link className="office-map-button" href={`/predio?andar=${office.floor}`} title="Voltar ao mapa do prédio para escolher outro escritório">
            <Building size={15} /> <span>Trocar de escritório</span>
          </Link>
        </div>
        <nav className="office-tabs" aria-label="Navegação do DASH">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button key={id} type="button" aria-current={tab === id ? "page" : undefined} onClick={() => setTab(id)}>
              <Icon size={16} strokeWidth={1.8} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="office-bar-actions">
          <span className={`dash-mode ${status.mode === "SIMULATED" ? "sim" : "live"}`}>{status.mode === "SIMULATED" ? "SIMULADO" : "REAL"}</span>
        </div>
      </header>
      <div className="safety-strip">
        <div><ShieldCheck size={16} /><span>Modo simulado: o DASH não envia ordens e não usa dinheiro real. Conta e limites separados do escritório de dividendos.</span></div>
      </div>

      <main id="content" className="main-content dash-main">
        <div className="page-heading"><div><h1>{current.label}</h1><p>{current.note}</p></div></div>

        {tab === "office" && <>
          <Dash3D status={status} />
          <p className="dash-banner" role="note"><ShieldAlert size={16} /> O DASH ainda não tem feed, corretora nem estratégia aprovada. Ele não envia ordens; tudo aqui é simulado ou vazio até cada parte ser conectada e testada.</p>
          <section className="dash-grid" aria-label="Resumo da mesa">{session}{signals}{orders}</section>
        </>}

        {tab === "panel" && <section className="dash-grid" aria-label="Painel do DASH">
          {session}
          <article className="dash-card">
            <h2>Corretora e instrumento</h2>
            <dl>
              <div><dt>Corretora</dt><dd>{status.broker ?? "Nenhuma conectada"}</dd></div>
              <div><dt>Instrumento</dt><dd>{status.instrument ?? "—"}</dd></div>
              <div><dt>Conta</dt><dd>Separada do escritório de dividendos</dd></div>
            </dl>
          </article>
          {signals}
          {orders}
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
        </section>}

        {tab === "desks" && <section className="dash-grid" aria-label="Mesas do DASH">{desks}</section>}

        {tab === "risk" && <section className="dash-grid" aria-label="Risco do DASH">
          {risk}
          <article className="dash-card wide">
            <h2>Regras da mesa</h2>
            <ol className="dash-rules">
              <li>Sem dado confiável, não operar.</li>
              <li>Toda ordem passa pelo risco.</li>
              <li>Stop confirmado na corretora.</li>
              <li>Não operar também é resultado.</li>
              <li>IA não decide ordens.</li>
            </ol>
          </article>
        </section>}
      </main>
      <footer className="footer">
        <span>ATLAS · {office.name} — {office.fullName}</span>
        <span>Simulado até cada parte ser conectada e testada.</span>
      </footer>
    </div>
  );
}

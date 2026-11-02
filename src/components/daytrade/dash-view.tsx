"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Building, Building2, LayoutGrid, OctagonX, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { officeById } from "@/core/building";
import { CandleChart } from "@/components/candle-chart";
import type { MinuteBar, DeskSignal } from "@/core/daytrade/analysis";
import { DATA_LABEL, DESKS, deskState, INITIAL_STATUS, MARKET_LABEL, ORDER_STATES, SECTORS, type DashStatus } from "@/core/daytrade/desks";

const Dash3D = dynamic(() => import("./dash-3d").then((m) => m.Dash3D), {
  ssr: false, loading: () => <div className="dash3d dash3d-loading" role="status">Montando a sala do DASH…</div>,
});

const TABS = [
  { id: "office", label: "Escritório", icon: Building2, note: "A mesa de day trade e o que cada agente está fazendo." },
  { id: "panel", label: "Painel", icon: LayoutGrid, note: "Sessão, corretora, ordens, saldo, resultado e custos." },
  { id: "desks", label: "Equipe", icon: Users, note: "Responsabilidades, atividade atual e integrações que ainda aguardam configuração." },
  { id: "risk", label: "Risco", icon: ShieldCheck, note: "Os limites e as regras que valem para toda ordem." },
  { id: "charts", label: "Gráficos", icon: LayoutGrid, note: "Candles de 1 minuto do ProfitDLL e análise transparente, sem ordens." },
] as const;
type Tab = (typeof TABS)[number]["id"];
type PaperData = {
  state: Array<{ instrument: string; position_side: number; entry_price: string | null; stop_price: string | null; pending_side: number; trades_today: number; realized_pnl_today: string; last_bar_at: string | null }>;
  fills: Array<{ instrument: string; bar_at: string; action: "ENTRY" | "EXIT"; side: "BUY" | "SELL"; price: string; fees: string; net_pnl: string | null; reason: string }>;
};

/**
 * The DASH office (owner, 01/11/2026: "crie o escritório do DASH para eu poder entrar e começar a
 * mexer"; "tem que criar a tela dele, como no escritório de dividendos"): the same frame as the
 * dividends office — glass top bar with the floor, the way back to the map and the tabs, a safety
 * strip — around the trading room on its floor of the ATLAS tower and the day-trade panels. Nothing is
 * connected yet — no feed, no broker, no orders — so every panel says exactly that, in simulated mode;
 * no number here is invented. The next steps are in docs/daytrade/ARQUITETURA.md.
 */
export function DashView({ connected = false }: { connected?: boolean }) {
  const office = officeById("dash")!;
  const [status, setStatus] = useState<DashStatus>(INITIAL_STATUS);
  const [halted, setHalted] = useState(false);
  const [missing, setMissing] = useState<string[] | null>(null);
  const [paperMissing, setPaperMissing] = useState<string[] | null>(null);
  const [paper, setPaper] = useState<PaperData | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [bars, setBars] = useState<MinuteBar[]>([]);
  const [analysis, setAnalysis] = useState<DeskSignal | null>(null);
  const [backtest, setBacktest] = useState<{ status: string; trades?: number; netPnl?: number; winRate?: number | null; profitFactor?: number | null; maxDrawdown?: number; walkForwardFolds?: number; trainingDays?: number; evaluationDays?: number } | null>(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [chartMessage, setChartMessage] = useState("Conecte o coletor ProfitDLL e configure um contrato ativo para receber candles.");
  const [tab, setTab] = useState<Tab>("office");
  // With the database: the office's state from /api/daytrade/status (dt_* tables), every 30 s.
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/daytrade/status", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Falha ao ler o DASH.");
        if (alive) { setStatus(data.status); setHalted(data.halted); setMissing(data.missing); setPaperMissing(data.paperMissing); }
      } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : "Falha ao ler o DASH."); }
    };
    void load();
    const timer = window.setInterval(load, 30000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [connected]);
  useEffect(() => {
    if (!connected || tab !== "panel") return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/daytrade/paper", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Falha ao ler a simulação paper.");
        if (alive) setPaper(data);
      } catch { if (alive) setPaper(null); }
    };
    void load(); const timer = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [connected, tab]);
  useEffect(() => {
    if (!connected || tab !== "charts") return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/daytrade/bars", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar os candles.");
        if (alive) { setBars(data.bars); setAnalysis(data.analysis); setChartMessage(data.bars.length ? "Feed ProfitDLL somente leitura." : "Nenhum candle salvo ainda. O histórico começa quando o gateway for executado durante o pregão."); }
      } catch (error) { if (alive) setChartMessage(error instanceof Error ? error.message : "Falha ao carregar candles."); }
    };
    void load(); const timer = window.setInterval(load, 15000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [connected, tab]);
  async function runBacktest() {
    setBacktestBusy(true);
    try {
      const response = await fetch("/api/daytrade/backtest", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao avaliar o histórico.");
      setBacktest(data);
    } catch (error) {
      setBacktest({ status: error instanceof Error ? error.message : "Falha ao avaliar o histórico." });
    } finally { setBacktestBusy(false); }
  }
  /** The DASH kill switch (only the DASH; the DAWN office is not touched). */
  async function toggleHalt() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/daytrade/halt", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ halted: !halted, reason: halted ? null : "Parada manual pelo proprietário" }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao gravar a parada.");
      setHalted(data.halted);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Falha ao gravar a parada."); }
    finally { setBusy(false); }
  }
  const idle = deskState(status) === "IDLE";
  const current = TABS.find((t) => t.id === tab)!;
  const activity = (id: string) => {
    switch (id) {
      case "chief": return "Aguardando plano de sessão e gates completos";
      case "supervisor": return halted ? "Parada ativa" : "Monitoramento automático ainda não conectado";
      case "feed": return status.data === "REAL" ? "Feed ProfitDLL ativo · somente leitura" : "Aguardando conexão do ProfitDLL";
      case "price": return bars.length ? `Analisando ${bars.length} candles` : "Aguardando candles do pregão";
      case "news": return "Fonte de notícias ainda não conectada";
      case "strategy": return analysis?.state ?? "Aguardando histórico e faixa de abertura";
      case "backtest": return backtest?.status === "RESEARCH_ONLY" ? "Avaliação exploratória concluída" : "Aguardando histórico/custos confirmados";
      case "risk": return missing === null ? "Aguardando leitura da configuração" : missing.length ? "Bloqueio ativo · há requisitos de risco pendentes" : "Limites configurados · ordens seguem bloqueadas";
      case "positions": return "Reconciliação de conta não conectada";
      case "execution": case "orders": return "Bloqueado · roteamento real desativado";
      case "ledger": return "Aguardando operações simuladas";
      default: return idle ? "Parado" : "Observando";
    }
  };

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
  const desks = SECTORS.map((sector) => (
    <article key={sector.id} className="dash-card dash-sector" style={{ "--desk": sector.color } as React.CSSProperties}>
      <h2>{sector.name}</h2>
      <p className="dash-note">{sector.purpose}</p>
      <ul className="dash-desks">
        {DESKS.filter((d) => d.sector === sector.id).map((d) => (
          <li key={d.id}>
            <b>{d.person.name}</b><span><strong>{d.role}</strong><small>{d.job}</small></span>
            <em>{activity(d.id)}</em>
          </li>
        ))}
      </ul>
    </article>
  ));
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
        <div><ShieldCheck size={16} /><span>{halted ? "DASH parado: nenhuma entrada nova." : "Modo simulado: o DASH não envia ordens e não usa dinheiro real. Conta e limites separados do DAWN."}</span></div>
        <button className="kill-button" onClick={() => void toggleHalt()} disabled={!connected || busy}
          title={!connected ? "Sem banco conectado: nada roda no DASH." : halted ? "Liberar o DASH" : "Parar o DASH (só o DASH; o DAWN não é afetado)"}>
          <OctagonX size={15} /> {busy ? "Gravando…" : halted ? "Liberar o DASH" : "Parar o DASH"}
        </button>
      </div>
      {message && <div className="notice global-message" role="status">{message}</div>}

      <main id="content" className="main-content dash-main">
        <div className="page-heading"><div><h1>{current.label}</h1><p>{current.note}</p></div></div>

        {tab === "office" && <>
          <Dash3D status={status} halted={halted} />
          <p className="dash-banner" role="note"><ShieldAlert size={16} /> {status.data === "REAL" ? "Feed ProfitDLL conectado somente para leitura; os candles são analisados e registrados como pesquisa." : "Feed ProfitDLL aguardando conexão para começar a coletar candles e registrar observações de pesquisa."} A estratégia ainda não está aprovada e o DASH não envia ordens nem usa dinheiro real.</p>
          <section className="dash-grid" aria-label="Resumo da mesa">{session}{signals}{orders}</section>
        </>}

        {tab === "panel" && <section className="dash-grid" aria-label="Painel do DASH">
          <article className="dash-card wide">
            <h2>Simulação futura (paper trading)</h2>
            <p className="dash-note">Somente dinheiro fictício. O sinal confirmado no fechamento do candle só pode preencher no próximo candle; stops, custos e gaps seguem regras conservadoras. Nenhuma ordem sai para a Genial.</p>
            {paperMissing === null ? <p className="dash-note">Aguardando configuração do DASH.</p> : paperMissing.length ? <ul className="dash-rules">{paperMissing.map((item) => <li key={item}>{item}</li>)}</ul> : <p className="dash-note">Configuração disponível para simulação futura. A estratégia ainda precisa acumular dados paper; isso não habilita operação real.</p>}
            {(paper?.state ?? []).map((row) => <dl key={row.instrument}>
              <div><dt>Contrato</dt><dd>{row.instrument}</dd></div>
              <div><dt>Posição simulada</dt><dd>{row.position_side === 1 ? "Comprado" : row.position_side === -1 ? "Vendido" : row.pending_side ? "Entrada aguardando próximo candle" : "Zerado"}</dd></div>
              <div><dt>Preço / stop</dt><dd>{row.entry_price ?? "—"} / {row.stop_price ?? "—"}</dd></div>
              <div><dt>Resultado líquido do dia</dt><dd>R$ {Number(row.realized_pnl_today).toFixed(2)}</dd></div>
              <div><dt>Entradas do dia</dt><dd>{row.trades_today}</dd></div>
              <div><dt>Último candle processado</dt><dd>{row.last_bar_at ? new Date(row.last_bar_at).toLocaleString("pt-BR") : "—"}</dd></div>
            </dl>)}
            {(paper?.fills.length ?? 0) > 0 && <ul className="dash-rules">{paper!.fills.slice(0, 8).map((fill, index) => <li key={`${fill.bar_at}-${fill.action}-${index}`}>
              {new Date(fill.bar_at).toLocaleString("pt-BR")} · {fill.action === "ENTRY" ? "Entrada" : "Saída"} {fill.side} · {fill.price} · custos R$ {Number(fill.fees).toFixed(2)}{fill.net_pnl !== null ? ` · líquido R$ ${Number(fill.net_pnl).toFixed(2)}` : ""} · {fill.reason}
            </li>)}</ul>}
          </article>
          <article className="dash-card wide">
            <h2>Travas para operação real</h2>
            {missing === null ? <p className="dash-note">Sem banco conectado: veja config/daytrade.json e docs/daytrade/AGENTES.md.</p>
              : missing.length === 0 ? <p className="dash-note">Configuração completa; o DASH continua em modo simulado.</p>
              : <ul className="dash-rules">{missing.map((m) => <li key={m}>{m}</li>)}</ul>}
          </article>
          {session}
          <article className="dash-card">
            <h2>Corretora e instrumento</h2>
            <dl>
              <div><dt>Corretora</dt><dd>{status.broker ?? "Nenhuma conectada"}</dd></div>
              <div><dt>Instrumento</dt><dd>{status.instrument ?? "—"}</dd></div>
              <div><dt>Conta</dt><dd>Separada do DAWN</dd></div>
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

        {tab === "charts" && <section className="dash-grid" aria-label="Gráficos e análise do DASH">
          <article className="dash-card wide">
            <h2>WIN · candles de 1 minuto</h2>
            {bars.length ? <CandleChart timeframe="minute" ticker="WIN" bars={bars.map((b) => ({ timestamp: b.bucket_at, open: String(b.open), high: String(b.high), low: String(b.low), close: String(b.close), adjustedClose: null, volume: b.volume }))} /> : <p className="dash-note">{chartMessage}</p>}
            <p className="dash-note">{chartMessage} Sem candles históricos: análise e backtest ficam indisponíveis, não se completam com dados inventados.</p>
          </article>
          <article className="dash-card">
            <h2>Hipótese de estratégia · ORB + VWAP + EMA</h2>
            <dl>
              <div><dt>Estado</dt><dd>{analysis?.state ?? "Sem dados"}</dd></div>
              <div><dt>Candles observados</dt><dd>{analysis?.metrics.bars ?? 0}</dd></div>
              <div><dt>VWAP</dt><dd>{analysis?.metrics.vwap?.toFixed(2) ?? "—"}</dd></div>
              <div><dt>Faixa inicial</dt><dd>{analysis?.metrics.openingLow?.toFixed(2) ?? "—"} – {analysis?.metrics.openingHigh?.toFixed(2) ?? "—"}</dd></div>
              <div><dt>EMA 9 / 21</dt><dd>{analysis?.metrics.emaFast?.toFixed(2) ?? "—"} / {analysis?.metrics.emaSlow?.toFixed(2) ?? "—"}</dd></div>
            </dl>
            <p className="dash-note">{analysis?.explanation ?? "Aguardando feed"} Estratégia candidata sem validação; “observar” não significa comprar ou vender.</p>
          </article>
          <article className="dash-card">
            <h2>Validação</h2>
            <button type="button" className="button secondary" onClick={() => void runBacktest()} disabled={!connected || backtestBusy}>
              {backtestBusy ? "Avaliando histórico…" : "Executar avaliação fora da amostra"}
            </button>
            {backtest?.status === "RESEARCH_ONLY" || backtest?.status === "NO_TRADES" ? <dl>
              <div><dt>Estado</dt><dd>{backtest.status}</dd></div>
              <div><dt>Operações fora da amostra</dt><dd>{backtest.trades}</dd></div>
              <div><dt>Pregões avaliados / blocos</dt><dd>{backtest.evaluationDays} / {backtest.walkForwardFolds}</dd></div>
              <div><dt>Histórico anterior acumulado</dt><dd>{backtest.trainingDays} pregões</dd></div>
              <div><dt>Líquido após custos, antes de IR</dt><dd>R$ {backtest.netPnl?.toFixed(2)}</dd></div>
              <div><dt>Acerto</dt><dd>{backtest.winRate === null || backtest.winRate === undefined ? "—" : `${(backtest.winRate * 100).toFixed(1)}%`}</dd></div>
              <div><dt>Fator de lucro</dt><dd>{backtest.profitFactor?.toFixed(2) ?? "—"}</dd></div>
              <div><dt>Drawdown máximo</dt><dd>R$ {backtest.maxDrawdown?.toFixed(2)}</dd></div>
            </dl> : <p className="dash-note">{backtest?.status === "INSUFFICIENT_DATA" ? "Histórico fora da amostra insuficiente; acumule ao menos 20 pregões completos, com 6 no período de avaliação." : backtest?.status === "COSTS_NOT_CONFIGURED" ? "Informe corretagem e emolumentos por contrato com base na sua nota para avaliar resultado líquido." : backtest?.status && backtest.status !== "COSTS_NOT_CONFIGURED" ? backtest.status : "A avaliação usa até 20.000 candles e só é executada quando solicitada. Precisa de custos confirmados da conta."}</p>}
            <p className="dash-note">Resultado hipotético exploratório, não previsão nem validação para dinheiro real. Ordens permanecem bloqueadas.</p>
          </article>
        </section>}

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

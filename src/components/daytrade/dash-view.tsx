"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Building, Building2, LayoutGrid, OctagonX, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { officeById } from "@/core/building";
import { CandleChart } from "@/components/candle-chart";
import { formatInstrumentPrice } from "@/components/daytrade/format";
import { BACKTEST_CANDIDATES, type BacktestSummary, type WalkForwardSelectionSummary, type MinuteBar, type DeskSignal } from "@/core/daytrade/analysis";
import type { DashConfig } from "@/core/daytrade/config";
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
type PaperTaxEstimate = {
  status: "READY" | "NO_CLOSED_TRADES" | "HISTORY_LIMIT";
  carryInUnknown?: boolean;
  months: Array<{ month: string; closedTrades: number; dayTradeResult: string; taxableAfterPaperLosses: string; paperLossCarry: string; estimatedTax: string; estimatedIrrfEquivalent: string; excludedOvernightCloses: number; excludedOvernightResult: string }>;
};
type DeskHeartbeat = { desk: string; at: string; state: "IDLE" | "WORKING" | "BLOCKED" | "ERROR"; detail: string };
type ExecutionForm = Record<"capitalBudget" | "marginPerContract" | "brokeragePerContract" | "exchangeFeesPerContract" | "slippageTicks" | "maxLossPerTrade" | "maxLossPerDay" | "maxExposure" | "lastEntry" | "flatBy" | "sourceNote", string>;
const EMPTY_EXECUTION_FORM: ExecutionForm = { capitalBudget: "", marginPerContract: "", brokeragePerContract: "", exchangeFeesPerContract: "", slippageTicks: "", maxLossPerTrade: "", maxLossPerDay: "", maxExposure: "", lastEntry: "", flatBy: "", sourceNote: "" };
function makeExecutionForm(settings: Record<string, unknown> | null, config: DashConfig): ExecutionForm {
  const value = (key: string, fallback: number | string | null | undefined) => {
    const saved = settings?.[key];
    return saved === null || saved === undefined ? (fallback == null ? "" : String(fallback)) : String(saved);
  };
  return {
    capitalBudget: value("capitalBudget", config.risk.capitalBudget),
    marginPerContract: value("marginPerContract", config.instruments.find((item) => item.id === "WIN")?.marginPerContract),
    brokeragePerContract: value("brokeragePerContract", config.costs.brokeragePerContract),
    exchangeFeesPerContract: value("exchangeFeesPerContract", config.costs.exchangeFeesPerContract),
    slippageTicks: value("slippageTicks", null),
    maxLossPerTrade: value("maxLossPerTrade", config.risk.maxLossPerTrade),
    maxLossPerDay: value("maxLossPerDay", config.risk.maxLossPerDay),
    maxExposure: value("maxExposure", config.risk.maxExposure),
    lastEntry: value("lastEntry", config.session.lastEntry),
    flatBy: value("flatBy", config.session.flatBy),
    sourceNote: value("sourceNote", ""),
  };
}
const parseLocalizedAmount = (input: string) => {
  const value = input.trim().replace(/\s/g, "");
  if (!value) return null;
  const normalized = value.includes(",") ? value.replace(/\./g, "").replace(",", ".") : value;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error("Revise os valores numéricos da configuração.");
  return parsed;
};
const parseSlippageTicks = (input: string) => {
  const value = input.trim();
  if (!value) return null;
  if (!/^\d{1,2}$/.test(value) || Number(value) < 1 || Number(value) > 20) throw new Error("Slippage deve ser um numero inteiro entre 1 e 20 ticks por fill.");
  return Number(value);
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
  const [paperTax, setPaperTax] = useState<PaperTaxEstimate | null>(null);
  const [config, setConfig] = useState<DashConfig | null>(null);
  const [executionForm, setExecutionForm] = useState<ExecutionForm>(EMPTY_EXECUTION_FORM);
  const [configConfirmedAt, setConfigConfirmedAt] = useState<string | null>(null);
  const [confirmExecutionSource, setConfirmExecutionSource] = useState(false);
  const [savingExecutionConfig, setSavingExecutionConfig] = useState(false);
  const [heartbeats, setHeartbeats] = useState<DeskHeartbeat[]>([]);
  const [renderedAt, setRenderedAt] = useState(0);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [bars, setBars] = useState<MinuteBar[]>([]);
  const [analysis, setAnalysis] = useState<DeskSignal | null>(null);
  const [backtests, setBacktests] = useState<BacktestSummary[] | null>(null);
  const [walkForwardSelection, setWalkForwardSelection] = useState<WalkForwardSelectionSummary | null>(null);
  const [backtestStatus, setBacktestStatus] = useState<string | null>(null);
  const [backtestBusy, setBacktestBusy] = useState(false);
  const [chartMessage, setChartMessage] = useState("Conecte o coletor ProfitDLL e configure um contrato ativo para receber candles.");
  const [tab, setTab] = useState<Tab>("office");
  useEffect(() => {
    const update = () => setRenderedAt(Date.now());
    update();
    const timer = window.setInterval(update, 30000);
    return () => window.clearInterval(timer);
  }, []);
  // With the database: the office's state from /api/daytrade/status (dt_* tables), every 30 s.
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/daytrade/status", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Falha ao ler o DASH.");
        if (alive) { setStatus(data.status); setHalted(data.halted); setMissing(data.missing); setPaperMissing(data.paperMissing); setHeartbeats(data.heartbeats ?? []); }
      } catch (error) { if (alive) setMessage(error instanceof Error ? error.message : "Falha ao ler o DASH."); }
    };
    void load();
    const timer = window.setInterval(load, 30000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [connected]);
  useEffect(() => {
    if (!connected) return;
    let alive = true;
    void fetch("/api/daytrade/config", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao ler a configuração do DASH.");
      if (alive) {
        setConfig(data.config);
        setPaperMissing(data.paperMissing ?? null);
        setExecutionForm(makeExecutionForm(data.executionSettings ?? null, data.config));
        setConfigConfirmedAt(data.confirmedAt ?? null);
        setConfirmExecutionSource(false);
      }
    }).catch(() => { if (alive) setConfig(null); });
    return () => { alive = false; };
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
    if (!connected || tab !== "panel") return;
    let alive = true;
    void fetch("/api/daytrade/tax-estimate", { cache: "no-store" }).then(async (response) => {
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao estimar os tributos paper.");
      if (alive) setPaperTax(data as PaperTaxEstimate);
    }).catch(() => { if (alive) setPaperTax(null); });
    return () => { alive = false; };
  }, [connected, tab]);
  useEffect(() => {
    if (!connected || tab !== "charts") return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/daytrade/bars", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Não foi possível carregar os candles.");
        if (alive) {
          setBars(data.bars); setAnalysis(data.analysis);
          setChartMessage(data.bars.length
            ? data.feedFresh ? "Feed ProfitDLL atualizado; somente leitura." : "Feed sem cotação recente; a análise ativa está bloqueada."
            : "Nenhum candle salvo ainda. Ao conectar o gateway ProfitDLL, ele tenta importar pregões completos disponíveis nos últimos 30 dias e continua a coleta ao vivo durante o mercado.");
        }
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
      if (Array.isArray(data.candidates)) {
        setBacktests(data.candidates as BacktestSummary[]);
        setWalkForwardSelection(data.selection as WalkForwardSelectionSummary | null);
        setBacktestStatus(null);
      } else {
        setBacktests(null);
        setWalkForwardSelection(null);
        setBacktestStatus(typeof data.status === "string" ? data.status : "Não foi possível montar a comparação de candidatos.");
      }
    } catch (error) {
      setBacktests(null);
      setBacktestStatus(error instanceof Error ? error.message : "Falha ao avaliar o histórico.");
    } finally { setBacktestBusy(false); }
  }
  async function saveExecutionConfiguration(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSavingExecutionConfig(true); setMessage("");
    try {
      const body = {
        capitalBudget: parseLocalizedAmount(executionForm.capitalBudget),
        marginPerContract: parseLocalizedAmount(executionForm.marginPerContract),
        brokeragePerContract: parseLocalizedAmount(executionForm.brokeragePerContract),
        exchangeFeesPerContract: parseLocalizedAmount(executionForm.exchangeFeesPerContract),
        slippageTicks: parseSlippageTicks(executionForm.slippageTicks),
        maxLossPerTrade: parseLocalizedAmount(executionForm.maxLossPerTrade),
        maxLossPerDay: parseLocalizedAmount(executionForm.maxLossPerDay),
        maxExposure: parseLocalizedAmount(executionForm.maxExposure),
        lastEntry: executionForm.lastEntry || null,
        flatBy: executionForm.flatBy || null,
        sourceNote: executionForm.sourceNote.trim(),
        confirmSource: confirmExecutionSource,
      };
      const response = await fetch("/api/daytrade/config", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Falha ao salvar a configuração paper.");
      setConfig(data.config); setPaperMissing(data.paperMissing);
      setExecutionForm(makeExecutionForm(data.executionSettings, data.config));
      setConfigConfirmedAt(data.confirmedAt ?? null); setConfirmExecutionSource(false);
      setMessage(data.confirmedAt ? "Configuração paper salva e confirmada. O modo real permanece bloqueado." : "Rascunho salvo; as entradas paper continuam bloqueadas até a confirmação da fonte.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar a configuração paper.");
    } finally { setSavingExecutionConfig(false); }
  }
  function updateExecutionField(field: keyof ExecutionForm, value: string) {
    setExecutionForm((previous) => ({ ...previous, [field]: value }));
    setConfirmExecutionSource(false); setConfigConfirmedAt(null);
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
  const activeInstrument = config?.instruments.find((instrument) => instrument.enabled)?.symbol ?? "WIN";
  const heartbeatByDesk = new Map(heartbeats.map((heartbeat) => [heartbeat.desk, heartbeat]));
  const activity = (id: string) => {
    const heartbeat = heartbeatByDesk.get(id);
    if (heartbeat && renderedAt > 0 && renderedAt - Date.parse(heartbeat.at) <= 60000) return `${heartbeat.state} · ${heartbeat.detail}`;
    switch (id) {
      case "chief": return "Sessão automática e aprovação real desativadas";
      case "supervisor": return halted ? "Parada ativa" : "Aguardando ciclo de supervisão";
      case "feed": return status.data === "REAL" ? "Feed ProfitDLL ativo · somente leitura" : "Aguardando conexão do ProfitDLL";
      case "price": return bars.length ? `Analisando ${bars.length} candles` : "Aguardando candles do pregão";
      case "news": return "Aguardando atualização das fontes configuradas";
      case "strategy": return analysis?.state ?? "Aguardando histórico e faixa de abertura";
      case "backtest": return backtests?.some((result) => result.status === "RESEARCH_ONLY") ? "Comparação exploratória concluída" : backtests?.every((result) => result.status === "NO_TRADES") ? "Walk-forward concluído · nenhum setup" : backtestStatus === "DATASET_TOO_LARGE" ? "O histórico disponível ultrapassa o limite de leitura. O sistema não calcula um walk-forward parcial." : backtestStatus ?? "Aguardando histórico/custos confirmados";
      case "risk": return paperMissing === null ? "Aguardando leitura da configuração" : paperMissing.length ? `BLOCKED · ${paperMissing.slice(0, 2).join("; ")}` : "Limites paper carregados · real bloqueado";
      case "positions": return "Reconciliação de posições da corretora não conectada";
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
      <p className="dash-note">{status.signal === "WATCH_LONG" ? "Última observação: candidata compradora." : status.signal === "WATCH_SHORT" ? "Última observação: candidata vendedora." : "Nenhum sinal candidato na última barra fechada."} É pesquisa, não ordem; a configuração e o risco ainda podem bloquear o paper.</p>
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
        <div><dt>Perda máxima por operação</dt><dd>{config?.risk.maxLossPerTrade === null || !config ? "Pendente" : `R$ ${config.risk.maxLossPerTrade.toFixed(2)}`}</dd></div>
        <div><dt>Perda máxima diária</dt><dd>{config?.risk.maxLossPerDay === null || !config ? "Pendente" : `R$ ${config.risk.maxLossPerDay.toFixed(2)}`}</dd></div>
        <div><dt>Exposição máxima</dt><dd>{config?.risk.maxExposure === null || !config ? "Pendente" : `R$ ${config.risk.maxExposure.toFixed(2)}`}</dd></div>
        <div><dt>Margem por contrato</dt><dd>{config?.instruments.find((i) => i.enabled)?.marginPerContract == null ? "Pendente" : `R$ ${config.instruments.find((i) => i.enabled)!.marginPerContract!.toFixed(2)}`}</dd></div>
        <div><dt>Limite diário</dt><dd>{config ? `${config.risk.maxTradesPerDay} entradas · ${config.risk.maxContracts} contrato(s)` : "—"}</dd></div>
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
            <p className="dash-note">Reconciliação da corretora indisponível. Abaixo aparecem apenas posições do simulador.</p>
            {paper?.state.length ? paper.state.map((row) => <dl key={row.instrument}>
              <div><dt>{row.instrument} · posição paper</dt><dd>{row.position_side === 1 ? "Comprado" : row.position_side === -1 ? "Vendido" : row.pending_side ? "Entrada pendente" : "Zerado"}</dd></div>
              <div><dt>Preço / stop</dt><dd>{row.entry_price ?? "—"} / {row.stop_price ?? "—"}</dd></div>
              <div><dt>P&L realizado hoje</dt><dd>R$ {Number(row.realized_pnl_today).toFixed(2)}</dd></div>
            </dl>) : <p className="dash-note">Nenhum estado paper gravado ainda.</p>}
          </article>
          <article className="dash-card">
            <h2>Resultado</h2>
            <dl>
              <div><dt>P&L paper hoje</dt><dd>{paper?.state.length ? `R$ ${paper.state.reduce((sum, row) => sum + Number(row.realized_pnl_today), 0).toFixed(2)}` : "—"}</dd></div>
              <div><dt>Resultado real</dt><dd>Indisponível · sem ordens reais</dd></div>
            </dl>
            <p className="dash-note">Os dois nunca são somados.</p>
          </article>
          <article className="dash-card">
            <h2>Custos e tributos</h2>
            <dl>
              <div><dt>Corretagem / contrato / lado</dt><dd>{!config || config.costs.brokeragePerContract === null ? "Pendente" : `R$ ${config.costs.brokeragePerContract.toFixed(2)}`}</dd></div>
              <div><dt>Emolumentos / contrato / lado</dt><dd>{!config || config.costs.exchangeFeesPerContract === null ? "Pendente" : `R$ ${config.costs.exchangeFeesPerContract.toFixed(2)}`}</dd></div>
              <div><dt>Slippage modelado</dt><dd>{config ? `${config.costs.slippageTicks} tick(s) adversos por fill · estimativa` : "—"}</dd></div>
              <div><dt>Alíquota day trade (referência)</dt><dd>{config ? `${(config.tax.dayTradeRate * 100).toFixed(0)}%` : "—"}</dd></div>
              <div><dt>IRRF day trade (referência)</dt><dd>{config ? `${(config.tax.withholdingRate * 100).toFixed(0)}% do resultado líquido diário` : "—"}</dd></div>
            </dl>
            <h3>Estimativa fiscal paper</h3>
            {paperTax?.status === "READY" ? <>
              <dl>{paperTax.months.slice(0, 3).map((month) => <div key={month.month}>
                <dt>{month.month} · {month.closedTrades} saídas</dt>
                <dd>Resultado R$ {Number(month.dayTradeResult).toFixed(2)} · IR teórico R$ {Number(month.estimatedTax).toFixed(2)}</dd>
              </div>)}</dl>
              {paperTax.months[0]?.excludedOvernightCloses ? <p className="dash-note">{paperTax.months[0].excludedOvernightCloses} zeragem(ns) entre pregões (R$ {Number(paperTax.months[0].excludedOvernightResult).toFixed(2)}) ficaram fora do cálculo day trade.</p> : null}
              <p className="dash-note">Resultado tributável estimado após perdas paper: R$ {Number(paperTax.months[0]?.taxableAfterPaperLosses ?? 0).toFixed(2)} · IRRF teórico: R$ {Number(paperTax.months[0]?.estimatedIrrfEquivalent ?? 0).toFixed(2)}. O saldo de prejuízo considera apenas o histórico paper disponível, desde o primeiro mês registrado.</p>
            </> : <p className="dash-note">{paperTax?.status === "HISTORY_LIMIT" ? "Histórico acima do limite de leitura; totais omitidos para evitar estimativa parcial." : paperTax?.status === "NO_CLOSED_TRADES" ? "Nenhuma saída paper registrada para estimar." : "Estimativa paper indisponível; reabra o painel para carregar."}</p>}
            <p className="dash-note">Estimativa informativa de simulação, não apuração de conta nem DARF. Não inclui notas reais, IRRF retido, saldo de IRRF anterior ou prejuízos anteriores ao histórico; confira com contador. O backtest não desconta IR.</p>
          </article>
        </section>}

        {tab === "desks" && <section className="dash-grid" aria-label="Mesas do DASH">{desks}</section>}

        {tab === "charts" && <section className="dash-grid" aria-label="Gráficos e análise do DASH">
          <article className="dash-card wide">
            {bars.length ? <CandleChart timeframe="minute" ticker="WIN" bars={bars.map((b) => ({ timestamp: b.bucket_at, open: String(b.open), high: String(b.high), low: String(b.low), close: String(b.close), adjustedClose: null, volume: b.volume, turnover: b.turnover }))} /> : <p className="dash-note">{chartMessage}</p>}
            {bars.length > 0 && <p className="dash-note">{chartMessage} Os candles representam dados observados; períodos sem feed não são preenchidos.</p>}
          </article>
          <article className="dash-card">
            <h2>Hipótese de estratégia · ORB + VWAP + EMA</h2>
            <dl>
              <div><dt>Estado</dt><dd>{analysis?.state ?? "Sem dados"}</dd></div>
              <div><dt>Candles observados</dt><dd>{analysis?.metrics.bars ?? 0}</dd></div>
              <div><dt>VWAP</dt><dd>{analysis?.metrics.vwap == null ? "—" : formatInstrumentPrice(activeInstrument, analysis.metrics.vwap)}</dd></div>
              <div><dt>Faixa inicial</dt><dd>{analysis?.metrics.openingLow == null ? "—" : formatInstrumentPrice(activeInstrument, analysis.metrics.openingLow)} – {analysis?.metrics.openingHigh == null ? "—" : formatInstrumentPrice(activeInstrument, analysis.metrics.openingHigh)}</dd></div>
              <div><dt>EMA 9 / 21</dt><dd>{analysis?.metrics.emaFast == null ? "—" : formatInstrumentPrice(activeInstrument, analysis.metrics.emaFast)} / {analysis?.metrics.emaSlow == null ? "—" : formatInstrumentPrice(activeInstrument, analysis.metrics.emaSlow)}</dd></div>
            </dl>
            <p className="dash-note">{analysis?.explanation ?? "Aguardando feed"} Estratégia candidata sem validação; “observar” não significa comprar ou vender.</p>
            <p className="dash-note">O paper mantém a versão fixa <code>opening-range-vwap-v1</code>. A seleção walk-forward compara candidatos apenas para pesquisa e não troca a regra paper nem aprova operação real.</p>
          </article>
          <article className="dash-card">
            <h2>Validação</h2>
            <button type="button" className="button secondary" onClick={() => void runBacktest()} disabled={!connected || backtestBusy}>
              {backtestBusy ? "Avaliando histórico…" : "Executar avaliação fora da amostra"}
            </button>
            {backtests ? <>
              {walkForwardSelection && <section className="dash-backtest-selection" aria-label="Seleção walk-forward sem antecipação">
                <h3>Seleção sequencial fora da amostra</h3>
                <p className="dash-note">Em cada bloco, escolhe o candidato com maior resultado líquido nos blocos anteriores, exigindo ao menos {walkForwardSelection.minimumTrainingTrades} operações e nenhum excesso dos limites de perda nesse histórico. O bloco seguinte mede a escolha sem usar seus dados para selecioná-la.</p>
                {walkForwardSelection.status === "INSUFFICIENT_DATA" ? <p className="dash-note">Ainda não há blocos anteriores com operações suficientes para selecionar um candidato e avaliá-lo no bloco seguinte.</p> : <>
                  <dl>
                    <div><dt>Estado</dt><dd>{walkForwardSelection.status}</dd></div>
                    <div><dt>Operações selecionadas OOS</dt><dd>{walkForwardSelection.trades}</dd></div>
                    <div><dt>Blocos avaliados</dt><dd>{walkForwardSelection.folds.length}</dd></div>
                    <div><dt>Líquido após custos</dt><dd>R$ {walkForwardSelection.netPnl.toFixed(2)}</dd></div>
                    <div><dt>Drawdown máximo</dt><dd>R$ {walkForwardSelection.maxDrawdown.toFixed(2)}</dd></div>
                  </dl>
                  <details className="dash-fold-details">
                    <summary>Ver seleção e resultado por bloco</summary>
                    <div className="dash-fold-list">
                      {walkForwardSelection.folds.map((fold) => {
                        const selected = BACKTEST_CANDIDATES.find((item) => item.id === fold.selectedCandidate);
                        return <div className="dash-fold-row dash-selection-fold" key={fold.fold}>
                          <span>Bloco {fold.fold}: {selected?.label ?? "sem seleção"} · {fold.evaluationFrom} a {fold.evaluationThrough}<small>{fold.trainingTrades} operações anteriores usadas para selecionar · {fold.trades} operações avaliadas</small></span>
                          <strong className={fold.netPnl < 0 ? "negative" : "positive"}>R$ {fold.netPnl.toFixed(2)}</strong>
                          <ul className="dash-selection-scores" aria-label={`Pontuações de treino antes do bloco ${fold.fold}`}>
                            {fold.selectionScores.map((score) => {
                              const candidate = BACKTEST_CANDIDATES.find((item) => item.id === score.candidate);
                              const adjusted = score.netToDrawdown === null
                                ? score.netPnl > 0 && score.maxDrawdown === 0 ? "sem drawdown observado" : "sem retorno líquido positivo"
                                : `${score.netToDrawdown.toFixed(2)}× retorno/drawdown`;
                              return <li key={score.candidate}>{candidate?.label ?? score.candidate}: líquido R$ {score.netPnl.toFixed(2)} · {adjusted} · {score.trades} operações · drawdown R$ {score.maxDrawdown.toFixed(2)} · violações de limite {score.riskLimitBreaches}</li>;
                            })}
                          </ul>
                        </div>;
                      })}
                    </div>
                  </details>
                </>}
              </section>}
              <div className="dash-backtest-grid">
              {backtests.map((result) => {
                const candidate = BACKTEST_CANDIDATES.find((item) => item.id === result.candidate)!;
                return <section className="dash-backtest-result" key={result.candidate} aria-label={`Avaliação: ${candidate.label}`}>
                  <h3>{candidate.label}</h3>
                  <p className="dash-note">{candidate.description}</p>
                  {result.status === "RESEARCH_ONLY" || result.status === "NO_TRADES" ? <dl>
                    <div><dt>Estado</dt><dd>{result.status}</dd></div>
                    <div><dt>Negócios OOS</dt><dd>{result.trades}</dd></div>
                    <div><dt>Pregões / blocos</dt><dd>{result.evaluationDays} / {result.walkForwardFolds}</dd></div>
                    <div><dt>Sessões elegíveis</dt><dd>{result.eligibleSessions}</dd></div>
                    <div><dt>Sessões esparsas válidas</dt><dd>{result.sparseSessions}</dd></div>
                    <div><dt>OOS encerrados por lacuna</dt><dd>{result.gapTerminatedSessions}</dd></div>
                    <div><dt>Posições fechadas por lacuna</dt><dd>{result.gapFlattenedTrades}</dd></div>
                    <div><dt>Treino acumulado</dt><dd>{result.trainingDays}</dd></div>
                    <div><dt>Limite de operações por pregão</dt><dd>{result.maxTradesPerDay}</dd></div>
                    <div><dt>Bruto</dt><dd>R$ {result.grossPnl.toFixed(2)}</dd></div>
                    <div><dt>Tarifas</dt><dd>R$ {result.feesPaid.toFixed(2)}</dd></div>
                    <div><dt>Slippage</dt><dd>R$ {result.slippageCost.toFixed(2)}</dd></div>
                    <div><dt>Líquido antes do IR</dt><dd>R$ {result.netPnl.toFixed(2)}</dd></div>
                    <div><dt>Acerto</dt><dd>{result.winRate === null ? "—" : `${(result.winRate * 100).toFixed(1)}%`}</dd></div>
                    <div><dt>Fator de lucro</dt><dd>{result.profitFactor?.toFixed(2) ?? "—"}</dd></div>
                    <div><dt>Drawdown máximo</dt><dd>R$ {result.maxDrawdown.toFixed(2)}</dd></div>
                    <div><dt>Maior perda por operação</dt><dd>R$ {result.maxSingleTradeLoss.toFixed(2)} · excedeu limite em {result.tradeLossLimitBreaches}</dd></div>
                    <div><dt>Maior perda diária</dt><dd>R$ {result.maxDailyLoss.toFixed(2)} · excedeu limite em {result.dailyLossLimitBreaches} pregões</dd></div>
                  </dl> : <p className="dash-note">{result.status === "INSUFFICIENT_DATA" ? "Histórico OOS insuficiente; precisa de pelo menos 10 pregões completos para o período inicial e um bloco de 3 para avaliação." : result.status}</p>}
                  {result.folds.length > 0 && <details className="dash-fold-details">
                    <summary>Resultado por bloco fora da amostra</summary>
                    <div className="dash-fold-list">
                      {result.folds.map((fold) => <div className="dash-fold-row" key={fold.fold}>
                        <span>Bloco {fold.fold} - {fold.evaluationFrom} a {fold.evaluationThrough}<small>{fold.trainingSessions} pregoes anteriores - {fold.trades} operacoes</small></span>
                        <strong className={fold.netPnl < 0 ? "negative" : "positive"}>R$ {fold.netPnl.toFixed(2)}</strong>
                      </div>)}
                    </div>
                  </details>}
                </section>;
              })}
              </div>
            </> : <p className="dash-note">{backtestStatus === "INSUFFICIENT_DATA" ? "Histórico fora da amostra insuficiente; são necessários ao menos 10 pregões iniciais e blocos de avaliação de 3 pregões. A seleção entre candidatos só aparece quando houver operações anteriores suficientes." : backtestStatus === "COSTS_NOT_CONFIGURED" ? "Confirme corretagem e emolumentos na nota; escolha e registre a premissa de slippage adverso por fill." : backtestStatus === "SESSION_NOT_CONFIGURED" ? "Confirme o horário da sessão, a última entrada e a zeragem na configuração antes de avaliar o histórico." : backtestStatus === "RISK_NOT_CONFIGURED" ? "Informe perda máxima por operação e por dia, limite de operações, posições, margem e exposição usando os valores verificados da Genial." : backtestStatus ?? "A avaliação usa até 20.000 candles e só é executada quando solicitada. Precisa de custos confirmados da conta."}</p>}
            <p className="dash-note">Resultado hipotético exploratório, não previsão nem validação para dinheiro real. Ordens permanecem bloqueadas.</p>
          </article>
        </section>}

        {tab === "risk" && <section className="dash-grid" aria-label="Risco do DASH">
          {risk}
          <article className="dash-card wide">
            <h2>Configuração de risco e custos para paper</h2>
            <p className="dash-note">Preencha usando a nota atual da Genial e as regras vigentes do contrato. Os valores são salvos no banco por proprietário. Não informe senha, número de conta ou dados de cartão.</p>
            <p className="dash-note">Slippage e uma premissa escolhida para simulacao, aplicada contra a operacao em cada fill; nao e uma medicao da corretora.</p>
            <p className="dash-note">{configConfirmedAt ? `Fonte confirmada em ${new Date(configConfirmedAt).toLocaleString("pt-BR")}.` : "Sem confirmação documental; as entradas paper ficam bloqueadas."}</p>
            <form className="dash-config-form" onSubmit={(event) => void saveExecutionConfiguration(event)}>
              <label>Orcamento de capital reservado ao DASH (R$)<input type="text" inputMode="decimal" value={executionForm.capitalBudget} onChange={(event) => updateExecutionField("capitalBudget", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Capital separado para a simulacao do DASH" /></label>
              <label>Margem por contrato (R$)<input type="text" inputMode="decimal" value={executionForm.marginPerContract} onChange={(event) => updateExecutionField("marginPerContract", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Conforme sua conta e regra vigente" /></label>
              <label>Corretagem por contrato e lado (R$)<input type="text" inputMode="decimal" value={executionForm.brokeragePerContract} onChange={(event) => updateExecutionField("brokeragePerContract", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Conforme sua nota" /></label>
              <label>Emolumentos por contrato e lado (R$)<input type="text" inputMode="decimal" value={executionForm.exchangeFeesPerContract} onChange={(event) => updateExecutionField("exchangeFeesPerContract", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Conforme sua nota" /></label>
              <label>Slippage adverso por fill (1-20 ticks)<input type="text" inputMode="numeric" value={executionForm.slippageTicks} onChange={(event) => updateExecutionField("slippageTicks", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Premissa que deseja simular" /></label>
              <label>Perda máxima por operação (R$)<input type="text" inputMode="decimal" value={executionForm.maxLossPerTrade} onChange={(event) => updateExecutionField("maxLossPerTrade", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Limite definido por você" /></label>
              <label>Perda máxima por dia (R$)<input type="text" inputMode="decimal" value={executionForm.maxLossPerDay} onChange={(event) => updateExecutionField("maxLossPerDay", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Limite definido por você" /></label>
              <label>Exposição máxima (R$)<input type="text" inputMode="decimal" value={executionForm.maxExposure} onChange={(event) => updateExecutionField("maxExposure", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Limite definido por você" /></label>
              <label>Última entrada paper<input type="time" value={executionForm.lastEntry} onChange={(event) => updateExecutionField("lastEntry", event.target.value)} disabled={!connected || savingExecutionConfig} /></label>
              <label>Horário de zeragem paper<input type="time" value={executionForm.flatBy} onChange={(event) => updateExecutionField("flatBy", event.target.value)} disabled={!connected || savingExecutionConfig} /></label>
              <label className="dash-config-source">Fonte consultada e premissa do slippage<input type="text" maxLength={240} value={executionForm.sourceNote} onChange={(event) => updateExecutionField("sourceNote", event.target.value)} disabled={!connected || savingExecutionConfig} placeholder="Nota Genial, fonte B3 e premissa de slippage escolhida" /></label>
              <label className="dash-config-confirm"><input type="checkbox" checked={confirmExecutionSource} onChange={(event) => setConfirmExecutionSource(event.target.checked)} disabled={!connected || savingExecutionConfig} />
                Confirmo que conferi os valores na fonte informada e que eles servem para estimativa paper.</label>
              <button className="button secondary dash-config-submit" type="submit" disabled={!connected || savingExecutionConfig}>
                {savingExecutionConfig ? "Salvando…" : confirmExecutionSource ? "Salvar e confirmar configuração" : "Salvar rascunho"}
              </button>
            </form>
            <p className="dash-note">A confirmação habilita somente os gates de simulação. O modo SIMULATED é fixo; o DASH não envia ordens reais.</p>
          </article>
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

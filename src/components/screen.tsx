"use client";
import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { RiskForm } from "./risk-form";
import { CandleChart } from "./candle-chart";
import type { HistoricalBar } from "@/providers/types";
import { formatBrl } from "@/core/format";
import { recordedPortfolio } from "@/core/accounting-view";
import { FundamentalsPanel } from "./fundamentals-panel";
import {
  ArrowRight,
  ArrowUpRight,
  Plus,
  ShieldCheck,
  Database,
  Radio,
  Check,
  Circle,
  Users,
  Activity,
  Building2,
  RefreshCw,
  Search,
  Pause,
  Play,
} from "lucide-react";

type Row = Record<string, unknown>;
type Remote = { rows: Row[]; error: string; loading: boolean };
const s = (v: unknown) =>
  v == null ? "—" : typeof v === "object" ? JSON.stringify(v) : String(v);
const currency = formatBrl;
const date = (v: unknown) =>
  !v
    ? "—"
    : new Date(String(v)).toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
      });

function useRemote(
  resource: string,
  enabled: boolean,
  revision: number,
): Remote {
  const [state, setState] = useState<Remote>({
    rows: [],
    error: "",
    loading: enabled,
  });
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch(`/api/atlas/${resource}`, { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok)
          throw new Error(result.error ?? "Serviço indisponível.");
        if (!controller.signal.aborted)
          setState({
            rows: Array.isArray(result) ? result : result ? [result] : [],
            error: "",
            loading: false,
          });
      })
      .catch((error) => {
        if (!controller.signal.aborted)
          setState({ rows: [], error: error.message, loading: false });
      });
    return () => controller.abort();
  }, [resource, enabled, revision]);
  return state;
}
function Empty({
  title,
  children,
  icon = "data",
}: {
  title: string;
  children: React.ReactNode;
  icon?: string;
}) {
  const Icon =
    icon === "agents" ? Users : icon === "office" ? Building2 : Database;
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon size={26} strokeWidth={1.25} />
      </div>
      <h3>{title}</h3>
      <div className="empty-copy">{children}</div>
    </div>
  );
}
function Status({ value }: { value: unknown }) {
  const text = s(value);
  const tone = /BLOCK|ERROR|REJECT|STALE/.test(text)
    ? "danger"
    : /PENDING|DELAY|PAUSED|UNKNOWN/.test(text)
      ? "warning"
      : /FILLED|IDLE|OPEN|COMPLETE/.test(text)
        ? "success"
        : "neutral";
  return <span className={`status-label ${tone}`}>{text}</span>;
}
function Table({ rows, fields }: { rows: Row[]; fields: [string, string][] }) {
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {fields.map(([key, label]) => (
              <th key={key}>{label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={s(row.id ?? index)}>
              {fields.map(([key]) => (
                <td key={key}>
                  {key === "status" ? (
                    <Status value={row[key]} />
                  ) : key.endsWith("_at") ? (
                    date(row[key])
                  ) : (
                    s(row[key])
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function DataState({
  remote,
  title,
  children,
}: {
  remote: Remote;
  title: string;
  children: React.ReactNode;
}) {
  return remote.loading ? (
    <div className="loading-state" role="status">
      Consultando registros…
    </div>
  ) : remote.error ? (
    <div className="notice error-text" role="alert">
      {remote.error}
    </div>
  ) : !remote.rows.length ? (
    <Empty title={title}>
      <p>
        Os registros aparecerão aqui após a primeira operação confirmada deste
        componente.
      </p>
    </Empty>
  ) : (
    children
  );
}
const names: Record<string, [string, string]> = {
  overview: [
    "Seu centro de operações.",
    "Uma visão clara dos agentes, do capital e das decisões.",
  ],
  office: [
    "ATLAS Trading Floor",
    "Cada estação representa o estado registrado de um agente.",
  ],
  agents: [
    "Especialistas por ativo",
    "Crie agentes com identidade, estratégia e limites próprios.",
  ],
  portfolio: [
    "Sua carteira",
    "Posições e patrimônio confirmados pela corretora.",
  ],
  market: [
    "Observe o mercado",
    "Consulte preços e histórico com origem e horário explícitos.",
  ],
  news: [
    "Inteligência de mercado",
    "Notícias oficiais e contexto econômico. Evidências antes de decisões.",
  ],
  orders: [
    "Controle de ordens",
    "Da proposta ao preenchimento, cada mudança deixa um registro.",
  ],
  treasury: [
    "Tesouraria",
    "Capital real na corretora. Alocações internas por agente.",
  ],
  risk: [
    "O risco define os limites",
    "Regras determinísticas têm prioridade sobre todas as propostas.",
  ],
  audit: [
    "Trilha de auditoria",
    "Investigue a origem, o motivo e a versão de cada decisão.",
  ],
  settings: [
    "Prepare seu ATLAS",
    "Conecte os serviços e complete as verificações de operação.",
  ],
  health: [
    "Saúde do sistema",
    "Conexão, dados e execução precisam concordar antes de operar.",
  ],
  research: [
    "Research e validação",
    "Estratégias precisam sobreviver a custos e dados fora da amostra.",
  ],
  "agent-detail": [
    "Detalhe do agente",
    "Estado, histórico de decisões e orçamento proposto.",
  ],
};

export function Screen({
  section,
  connected,
  agentId,
}: {
  section: string;
  connected: boolean;
  agentId?: string;
}) {
  const [revision, setRevision] = useState(0),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [showForm, setShowForm] = useState(false);
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  const needsAgents = ["overview", "agents", "office", "agent-detail"].includes(
    section,
  );
  const agents = useRemote("agents", connected && needsAgents, revision),
    assets = useRemote("assets", connected && needsAgents, revision);
  const accounting = useRemote(
    "accounting",
    connected && ["overview", "treasury", "portfolio"].includes(section),
    revision,
  );
  const portfolio = recordedPortfolio(
    accounting.rows[0]?.latestPortfolioSnapshot,
  );
  const portfolioNote = portfolio
    ? `Registro de ${date(portfolio.sourceTimestamp)} · São Paulo`
    : "Aguardando reconciliação";
  const resource =
    (
      {
        overview: "decisions",
        "agent-detail": "decisions",
        office: "meetings",
        portfolio: "positions",
        health: "health",
        settings: "system",
        market: "assets",
        research: "decisions",
      } as Record<string, string>
    )[section] ?? section;
  const records = useRemote(
    resource,
    connected && !["news", "market", "settings"].includes(section),
    revision,
  );
  const [heading, subheading] = names[section] ?? names.overview;
  async function mutate(path: string, payload: object) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/atlas/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setMessage("Alteração registrada.");
      setShowForm(false);
      refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha de conexão.");
    } finally {
      setBusy(false);
    }
  }
  const chosen = agents.rows.find((a) => a.id === agentId);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>
            {section === "agent-detail" && chosen ? s(chosen.name) : heading}
          </h1>
          <p>{subheading}</p>
        </div>
        <div className="heading-actions">
          {section === "agents" ? (
            <button
              onClick={() => setShowForm(!showForm)}
              disabled={!connected}
            >
              <Plus size={17} />
              Criar agente
            </button>
          ) : (
            <button
              className="secondary icon-button"
              title="Atualizar registros"
              aria-label="Atualizar registros"
              disabled={!connected}
              onClick={refresh}
            >
              <RefreshCw size={17} />
            </button>
          )}
        </div>
      </div>
      {!connected && (
        <div className="setup-banner">
          <div>
            <Database size={20} />
            <p>
              <strong>Conecte o primeiro serviço.</strong>
              <span>
                O ambiente local está pronto para configuração. Seus dados
                financeiros aparecerão após a conexão.
              </span>
            </p>
          </div>
          <Link href="/app/settings">
            Configurar ATLAS <ArrowRight size={16} />
          </Link>
        </div>
      )}
      {message && (
        <div className="notice" role="status">
          {message}
        </div>
      )}
      {accounting.error && (
        <div className="notice error-text" role="alert">
          Não foi possível consultar a contabilidade: {accounting.error}
        </div>
      )}
      {accounting.rows[0]?.latestPortfolioSnapshot != null && !portfolio && (
        <div className="notice" role="status">
          O último snapshot da conta não tem reconciliação válida. Os totais
          permanecem indisponíveis até a conferência do registro.
        </div>
      )}
      {section === "overview" && (
        <>
          <div className="metrics-row">
            {[
              [
                "Patrimônio registrado",
                currency(portfolio?.equity),
                portfolioNote,
              ],
              ["P&L registrado", currency(portfolio?.totalPnl), portfolioNote],
              ["Caixa registrado", currency(portfolio?.cash), portfolioNote],
              [
                "Agentes cadastrados",
                connected && !agents.error ? String(agents.rows.length) : "—",
                "Especialistas sob supervisão",
              ],
            ].map(([label, value, note]) => (
              <div className="metric" key={label}>
                <span>{label}</span>
                <strong>{value}</strong>
                <small title={note}>{note}</small>
              </div>
            ))}
          </div>
          {portfolio && (
            <p className="muted">
              Último snapshot conciliado da conta {portfolio.brokerAccountId}.
              Valores históricos; a disponibilidade para operar exige nova
              reconciliação.
            </p>
          )}
          <div className="overview-grid">
            <section className="panel capital-panel">
              <div className="section-heading">
                <h2>Patrimônio ao longo do tempo</h2>
                <span className="muted">BRL</span>
              </div>
              <Empty title="O primeiro registro começa com uma conexão real.">
                <p>
                  O gráfico será construído com snapshots reconciliados da sua
                  conta. O histórico de patrimônio ainda não está disponível
                  nesta tela.
                </p>
                <Link href="/app/settings" className="text-link">
                  Ver requisitos de conexão <ArrowUpRight size={15} />
                </Link>
              </Empty>
              <div className="panel-note">
                <ShieldCheck size={15} />O saldo da corretora é a referência
                para a tesouraria.
              </div>
            </section>
            <Readiness connected={connected} compact />
            <section className="panel">
              <div className="section-heading">
                <h2>Seus agentes</h2>
                <Link href="/app/agents" className="text-link">
                  Gerenciar <ArrowUpRight size={14} />
                </Link>
              </div>
              <AgentList agents={agents} assets={assets.rows} />
            </section>
            <section className="panel">
              <div className="section-heading">
                <h2>Últimas decisões</h2>
                <Link href="/app/audit" className="text-link">
                  Auditoria <ArrowUpRight size={14} />
                </Link>
              </div>
              <DataState remote={records} title="Nenhuma decisão registrada">
                <Table
                  rows={records.rows.slice(0, 5)}
                  fields={[
                    ["decision", "Decisão"],
                    ["reasoning_summary", "Justificativa"],
                    ["created_at", "Horário"],
                  ]}
                />
              </DataState>
            </section>
          </div>
        </>
      )}
      {(section === "agents" || section === "office") && (
        <>
          {showForm && (
            <section className="panel form-panel">
              <h2>Novo agente</h2>
              <p>
                O orçamento é um limite proposto. Criar um agente não cria caixa
                nem transfere dinheiro.
              </p>
              <form
                className="form-grid"
                onSubmit={(event) => {
                  event.preventDefault();
                  const f = new FormData(event.currentTarget);
                  void mutate("agents", {
                    assetId: f.get("assetId"),
                    name: f.get("name"),
                    avatar: f.get("avatar"),
                    budget: f.get("budget"),
                    interval: Number(f.get("interval")),
                  });
                }}
              >
                <label>
                  Nome
                  <input name="name" minLength={2} maxLength={60} required />
                </label>
                <label>
                  Ativo
                  <select name="assetId" required>
                    <option value="">Escolha um ativo cadastrado</option>
                    {assets.rows.map((a) => (
                      <option key={s(a.id)} value={s(a.id)}>
                        {s(a.ticker)} · {s(a.company_name)}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Perfil visual
                  <select name="avatar">
                    <option value="analyst">Analista</option>
                    <option value="researcher">Pesquisador</option>
                    <option value="strategist">Estrategista</option>
                  </select>
                </label>
                <label>
                  Orçamento proposto (R$)
                  <input
                    name="budget"
                    inputMode="decimal"
                    pattern="[0-9]+([.][0-9]{1,2})?"
                    placeholder="0.00"
                    required
                  />
                </label>
                <label>
                  Intervalo de análise
                  <select name="interval">
                    <option value="1800">30 minutos · dados com atraso</option>
                    <option value="3600">1 hora</option>
                    <option value="86400">1 dia</option>
                  </select>
                </label>
                <div className="form-actions">
                  <button disabled={busy || !assets.rows.length}>
                    Salvar agente
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => setShowForm(false)}
                  >
                    Cancelar
                  </button>
                </div>
              </form>
              <Link className="text-link" href="/app/market">
                Cadastrar um ativo primeiro <ArrowRight size={14} />
              </Link>
            </section>
          )}
          <section
            className={`panel ${section === "office" ? "office-panel" : ""}`}
          >
            <div className="section-heading">
              <h2>
                {section === "office"
                  ? "Estações de trabalho"
                  : "Equipe de análise"}
              </h2>
              <span className="muted">
                {connected ? `${agents.rows.length} agentes` : "Sem conexão"}
              </span>
            </div>
            <AgentList
              agents={agents}
              assets={assets.rows}
              office={section === "office"}
            />
          </section>
          {section === "office" && (
            <section className="panel">
              <div className="section-heading">
                <h2>Sala de reunião</h2>
                <span className="muted">Supervisor central</span>
              </div>
              <DataState remote={records} title="Nenhuma reunião registrada">
                <Table
                  rows={records.rows}
                  fields={[
                    ["summary", "Resumo"],
                    ["created_at", "Horário"],
                  ]}
                />
              </DataState>
            </section>
          )}
        </>
      )}
      {section === "agent-detail" && (
        <>
          {chosen ? (
            <section className="panel agent-summary">
              <div className="agent-avatar">{s(chosen.name).slice(0, 1)}</div>
              <div>
                <h2>{s(chosen.name)}</h2>
                <Status value={chosen.status} />
                <p>
                  Orçamento proposto: {currency(chosen.budget)} · Caixa:
                  aguardando reconciliação
                </p>
                <small>
                  Estratégia de análise inicial: observação SMA · sem permissão
                  de execução.
                </small>
              </div>
              <button
                disabled={busy}
                className="secondary"
                onClick={() =>
                  void mutate("agent-state", {
                    id: chosen.id,
                    enabled: !chosen.enabled,
                  })
                }
              >
                {chosen.enabled ? <Pause size={15} /> : <Play size={15} />}
                {chosen.enabled ? "Pausar análise" : "Ativar análise"}
              </button>
            </section>
          ) : (
            <Empty title="Agente não encontrado" icon="agents">
              <p>Selecione um agente cadastrado na equipe.</p>
            </Empty>
          )}
          <section className="panel">
            <h2>Histórico de decisões</h2>
            <DataState
              remote={{
                ...records,
                rows: records.rows.filter((r) => r.agent_id === agentId),
              }}
              title="Nenhuma análise deste agente"
            >
              <Table
                rows={records.rows.filter((r) => r.agent_id === agentId)}
                fields={[
                  ["decision", "Decisão"],
                  ["reasoning_summary", "Motivo"],
                  ["strategy_version", "Versão"],
                  ["created_at", "Horário"],
                ]}
              />
            </DataState>
          </section>
        </>
      )}
      {section === "market" && (
        <>
          <Market connected={connected} busy={busy} mutate={mutate} />
          <FundamentalsPanel connected={connected} />
        </>
      )}
      {section === "risk" && (
        <>
          <RiskForm enabled={connected} busy={busy} save={mutate} />
          <section className="panel">
            <h2>Perfis registrados</h2>
            <DataState remote={records} title="Nenhum perfil configurado">
              <Table
                rows={records.rows}
                fields={[
                  ["name", "Perfil"],
                  ["version", "Versão"],
                  ["configured", "Configurado"],
                  ["created_at", "Criado em"],
                ]}
              />
            </DataState>
          </section>
        </>
      )}
      {section === "news" && <News connected={connected} revision={revision} />}
      {(section === "settings" ||
        section === "health" ||
        section === "risk") && (
        <>
          <Readiness connected={connected} />
          {section === "settings" && <SetupGuide connected={connected} />}
          {section === "risk" && (
            <section className="panel">
              <h2>Política atual</h2>
              <div className="policy-list">
                {[
                  "Execução real desabilitada",
                  "Sem alavancagem, margem ou venda descoberta",
                  "Somente ações à vista; opções e futuros bloqueados",
                  "Cotação atrasada ou sessão desconhecida bloqueia envio",
                  "Timeout mantém ordem em reconciliação; não repete o envio",
                  "Parada global preserva as posições e o histórico",
                ].map((item) => (
                  <div key={item}>
                    <ShieldCheck size={17} />
                    {item}
                  </div>
                ))}
              </div>
              <p className="muted">
                Limites financeiros ainda precisam ser configurados e
                homologados. O núcleo de risco possui validação; habilitação
                live está pendente.
              </p>
            </section>
          )}
          {section === "health" && (
            <section className="panel">
              <h2>Últimos registros operacionais</h2>
              <DataState remote={records} title="Sem medições persistidas">
                <Table
                  rows={records.rows}
                  fields={[
                    ["component", "Componente"],
                    ["status", "Estado"],
                    ["freshness", "Validade da medição"],
                    ["checked_at", "Última verificação"],
                    ["message", "Detalhes"],
                  ]}
                />
              </DataState>
            </section>
          )}
        </>
      )}
      {section === "treasury" && (
        <>
          <div className="metrics-row">
            {[
              ["Caixa registrado", portfolio?.cash],
              ["Capital investido registrado", portfolio?.invested],
              ["Patrimônio registrado", portfolio?.equity],
              ["P&L registrado", portfolio?.totalPnl],
            ].map(([label, value]) => (
              <div className="metric" key={label}>
                <span>{label}</span>
                <strong>{currency(value)}</strong>
                <small>{portfolioNote}</small>
              </div>
            ))}
          </div>
          <section className="panel treasury-instructions">
            <WalletIcon />
            <div>
              <h2>O dinheiro permanece na sua corretora.</h2>
              <p>
                Faça depósitos ou retiradas pelo canal oficial da sua
                instituição. O ATLAS só disponibilizará capital após confirmação
                independente do saldo. Ainda não há integração PIX habilitada.
              </p>
              <span className="status-label warning">
                CONFIRMAÇÃO MANUAL NECESSÁRIA
              </span>
            </div>
          </section>
          <section className="panel">
            <h2>Movimentações registradas</h2>
            <DataState remote={records} title="Nenhuma movimentação confirmada">
              <Table
                rows={records.rows}
                fields={[
                  ["kind", "Tipo"],
                  ["amount", "Valor"],
                  ["status", "Estado"],
                  ["created_at", "Horário"],
                ]}
              />
            </DataState>
          </section>
        </>
      )}
      {(section === "orders" ||
        section === "portfolio" ||
        section === "audit") && (
        <section className="panel">
          <div className="section-heading">
            <h2>
              {section === "orders"
                ? "Livro de ordens"
                : section === "portfolio"
                  ? "Posições reconciliadas"
                  : "Eventos do sistema"}
            </h2>
            <span className="muted">Até 200 registros</span>
          </div>
          <DataState
            remote={records}
            title={
              section === "orders"
                ? "Nenhuma ordem enviada"
                : section === "portfolio"
                  ? "Nenhuma posição reconciliada"
                  : "Nenhum evento registrado"
            }
          >
            <Table
              rows={records.rows}
              fields={
                section === "orders"
                  ? [
                      ["id", "Ordem"],
                      ["ticker", "Ativo"],
                      ["side", "Lado"],
                      ["quantity", "Quantidade"],
                      ["status", "Estado"],
                    ]
                  : section === "portfolio"
                    ? [
                        ["ticker", "Ativo"],
                        ["quantity", "Quantidade"],
                        ["average_price", "Preço médio"],
                      ]
                    : [
                        ["action", "Evento"],
                        ["correlation_id", "Correlação"],
                        ["created_at", "Horário"],
                      ]
              }
            />
          </DataState>
        </section>
      )}
      {section === "research" && (
        <section className="panel">
          <h2>Pesquisa separada da execução</h2>
          <p>
            Indicadores e propostas de observação podem ser calculados com dados
            históricos. Validação walk-forward, dados point-in-time, custos e
            certificação de estratégia estão detalhados no roadmap. Nenhuma
            estratégia está autorizada a operar capital real.
          </p>
        </section>
      )}
    </>
  );
}
function WalletIcon() {
  return <Database size={34} strokeWidth={1.2} />;
}
function AgentList({
  agents,
  assets,
  office = false,
}: {
  agents: Remote;
  assets: Row[];
  office?: boolean;
}) {
  if (agents.error)
    return <div className="notice error-text">{agents.error}</div>;
  if (!agents.rows.length)
    return (
      <Empty
        title={
          office
            ? "Seu escritório está pronto para a primeira estação."
            : "Sua equipe começa com o primeiro agente."
        }
        icon={office ? "office" : "agents"}
      >
        <p>
          Cadastre um ativo e defina um especialista. Cada agente seguirá seus
          limites e terá uma trilha de decisões.
        </p>
        <Link href="/app/agents" className="text-link">
          Configurar equipe <ArrowRight size={14} />
        </Link>
      </Empty>
    );
  return (
    <div className={office ? "office-stations" : "agent-list"}>
      {agents.rows.map((agent) => (
        <Link
          className={`agent-row ${office ? "station" : ""}`}
          key={s(agent.id)}
          href={`/app/agents/${s(agent.id)}`}
        >
          <div className={`agent-avatar ${s(agent.status).toLowerCase()}`}>
            {s(agent.name).slice(0, 1)}
          </div>
          <div className="agent-identity">
            <strong>{s(agent.name)}</strong>
            <small>
              {s(assets.find((a) => a.id === agent.asset_id)?.ticker)} ·{" "}
              {currency(agent.budget)} de limite
            </small>
          </div>
          <Status value={agent.status} />
          <ArrowUpRight size={15} />
        </Link>
      ))}
    </div>
  );
}
function Readiness({
  connected,
  compact = false,
}: {
  connected: boolean;
  compact?: boolean;
}) {
  const gates = [
    [
      "Identidade e banco",
      connected ? "Configuração presente" : "Conectar Supabase e proprietário",
      connected,
    ],
    ["Corretora oficial", "Contrato e habilitação pendentes", false],
    ["Feed de execução", "Fonte autorizada e sessão pendentes", false],
    ["Risco e reconciliação", "Homologação ponta a ponta pendente", false],
  ] as const;
  return (
    <section className={`panel readiness-panel ${compact ? "compact" : ""}`}>
      <div className="section-heading">
        <h2>Prontidão operacional</h2>
        <ShieldCheck size={20} />
      </div>
      <p className="readiness-intro">
        Cada etapa protege uma parte da operação.
      </p>
      <div className="readiness-list">
        {gates.map(([name, detail, ready]) => (
          <div className="readiness-item" key={name}>
            <span className={ready ? "gate-icon ready" : "gate-icon"}>
              {ready ? <Check size={15} /> : <Circle size={13} />}
            </span>
            <div>
              <strong>{name}</strong>
              <small>{detail}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="readiness-bottom">
        <Status value="LIVE BLOQUEADO" />
        <Link href="/app/settings" className="text-link">
          Ver etapas <ArrowRight size={14} />
        </Link>
      </div>
    </section>
  );
}
function SetupGuide({ connected }: { connected: boolean }) {
  return (
    <section className="panel setup-guide">
      <h2>Conexões necessárias</h2>
      <ol>
        <li>
          <strong>Crie um projeto Supabase exclusivo para o ATLAS.</strong>
          <p>
            Aplique a migration em <code>supabase/migrations</code>, crie seu
            usuário no Auth e desative novos cadastros públicos.
          </p>
        </li>
        <li>
          <strong>Configure as variáveis no servidor.</strong>
          <p>
            Use <code>.env.example</code> como referência para URL, chave
            pública, chave de serviço e ID do proprietário. Não coloque segredos
            no frontend.
          </p>
        </li>
        <li>
          <strong>Cadastre o autenticador de dois fatores.</strong>
          <p>
            Entre na tela de acesso com seu usuário e conclua o cadastro TOTP.
          </p>
          <Link className="text-link" href="/login">
            {connected ? "Abrir acesso" : "Ver tela de acesso"}{" "}
            <ArrowUpRight size={14} />
          </Link>
        </li>
        <li>
          <strong>Habilite uma fonte de dados.</strong>
          <p>
            Cadastre seu token brapi no servidor. O feed é destinado a análise
            com atraso e não autoriza execução.
          </p>
        </li>
        <li>
          <strong>Valide o canal oficial da corretora.</strong>
          <p>
            A pesquisa identifica Cedro API Trading, Genial MetaTrader Swing e
            ProfitDLL como caminhos condicionais. Contratação, acesso, custos e
            homologação permanecem pendentes.
          </p>
        </li>
        <li>
          <strong>Publique e conecte o scheduler.</strong>
          <p>
            Siga o README para Supabase Cron e hospedagem. Live só pode ser
            ativado após cumprir todos os gates técnicos.
          </p>
        </li>
      </ol>
    </section>
  );
}
function Market({
  connected,
  busy,
  mutate,
}: {
  connected: boolean;
  busy: boolean;
  mutate: (path: string, data: object) => Promise<void>;
}) {
  const [ticker, setTicker] = useState(""),
    [quote, setQuote] = useState<Row | null>(null),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const [bars, setBars] = useState<HistoricalBar[]>([]);
  async function lookup() {
    setLoading(true);
    setError("");
    setQuote(null);
    setBars([]);
    try {
      const query = encodeURIComponent(ticker.toUpperCase());
      const [quoteResponse, historyResponse] = await Promise.all([
        fetch(`/api/atlas/quote?ticker=${query}`),
        fetch(`/api/atlas/history?ticker=${query}`),
      ]);
      const result = await quoteResponse.json();
      if (!quoteResponse.ok) throw new Error(result.error);
      setQuote(result);
      const history = await historyResponse.json();
      if (!historyResponse.ok) throw new Error(history.error);
      setBars(history.bars);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Falha ao consultar.");
    } finally {
      setLoading(false);
    }
  }
  return (
    <div className="two-columns">
      <section className="panel form-panel">
        <h2>Consultar cotação</h2>
        <p>
          Informe um ticker. A resposta preserva o horário econômico do preço.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void lookup();
          }}
        >
          <label>
            Ticker
            <input
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              maxLength={12}
              placeholder="Código do ativo na B3"
              required
            />
          </label>
          <button disabled={!connected || loading}>
            <Search size={16} />
            {loading ? "Consultando…" : "Consultar fonte"}
          </button>
        </form>
        {bars.length > 0 && (
          <CandleChart ticker={String(quote?.ticker ?? ticker)} bars={bars} />
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        {quote && (
          <div className="quote-result">
            <div>
              <h3>{s(quote.ticker)}</h3>
              <Status value={quote.freshness ?? quote.feed} />
            </div>
            <strong>{currency(quote.price)}</strong>
            <p>Dado: {date(quote.dataTimestamp)} · São Paulo</p>
            <p>Recebido: {date(quote.retrievedAt)}</p>
            <a
              href={s(quote.source)}
              target="_blank"
              rel="noopener noreferrer"
              className="text-link"
            >
              Origem do dado <ArrowUpRight size={13} />
            </a>
            <div className="notice">
              Fonte complementar. Não habilitada para execução.
            </div>
          </div>
        )}
      </section>
      <section className="panel form-panel">
        <h2>Cadastrar ativo</h2>
        <p>
          O cadastro define o universo monitorado. Não cria posição financeira.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void mutate("assets", {
              ticker: f.get("ticker"),
              company: f.get("company"),
              sector: f.get("sector"),
            });
          }}
        >
          <label>
            Ticker
            <input name="ticker" maxLength={12} required />
          </label>
          <label>
            Empresa
            <input name="company" maxLength={120} required />
          </label>
          <label>
            Setor
            <input name="sector" maxLength={80} required />
          </label>
          <button disabled={!connected || busy}>
            <Plus size={16} />
            Salvar ativo
          </button>
        </form>
      </section>
    </div>
  );
}
function News({
  connected,
  revision,
}: {
  connected: boolean;
  revision: number;
}) {
  const news = useRemote("news-feed", connected, revision),
    macro = useRemote("macro", connected, revision);
  return (
    <div className="two-columns news-layout">
      <section className="panel">
        <div className="section-heading">
          <h2>Publicações oficiais</h2>
          <span className="muted">IBGE</span>
        </div>
        <DataState remote={news} title="Aguardando consulta à fonte">
          <div className="news-list">
            {news.rows.map((item) => (
              <article key={s(item.id ?? item.url)}>
                <div className="news-meta">
                  <Radio size={13} />
                  {s(item.source)}
                  <span>{date(item.publishedAt)}</span>
                </div>
                <h3>
                  <a
                    href={s(item.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {s(item.title)} <ArrowUpRight size={16} />
                  </a>
                </h3>
                <p>{s(item.summary ?? item.description)}</p>
                <small>
                  Classificação de impacto pendente. Conteúdo externo não
                  autoriza ordens.
                </small>
              </article>
            ))}
          </div>
        </DataState>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>Contexto macro</h2>
          <Activity size={17} />
        </div>
        <DataState remote={macro} title="Sem observação consultada">
          <Table
            rows={macro.rows}
            fields={[
              ["name", "Série"],
              ["value", "Valor"],
              ["date", "Referência"],
            ]}
          />
        </DataState>
        <p className="panel-note">
          Banco Central · periodicidade da série preservada.
        </p>
      </section>
    </div>
  );
}

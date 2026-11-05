"use client";
import { useEffect, useState } from "react";
import { dividendAmounts } from "@/core/dividends";
import type { loadDividendAgenda } from "@/lib/dividend-agenda";

type Agenda = Awaited<ReturnType<typeof loadDividendAgenda>>;
type Row = Record<string, unknown>;
const money = (value: unknown) => Number(value ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const rate = (value: string) => `R$ ${Number(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 11 })}`;
const date = (value: unknown) => value ? String(value).split("-").reverse().join("/") : "A definir";
const kind = (label: unknown) => label === "JRS CAP PROPRIO" ? "JCP" : label === "RENDIMENTO" ? "Rendimento" : "Dividendo";

export function DividendsPanel({ records, onRecorded }: { records: Row[]; onRecorded: () => void }) {
  const [agenda, setAgenda] = useState<Agenda | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [chosen, setChosen] = useState("");
  const [quantity, setQuantity] = useState("1");
  useEffect(() => {
    const controller = new AbortController();
    async function read() {
      try {
        const response = await fetch("/api/atlas/dividends", { signal: controller.signal, cache: "no-store" });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? "Não foi possível consultar os anúncios.");
        if (!controller.signal.aborted) { setAgenda(body); setError(""); }
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Falha ao consultar proventos."); }
    }
    void read();
    const timer = window.setInterval(read, 60000);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, []);
  const events = agenda?.sources.flatMap((source) => source.events.map((event) => ({ ...event, source: source.source }))) ?? [];
  const selected = events.find((event) => event.key === chosen) ?? events[0];
  const simulationQuantity = /^\d{1,7}$/.test(quantity) ? Number(quantity) : null;
  const simulation = selected && simulationQuantity !== null ? dividendAmounts(selected.rate, simulationQuantity, selected.label, selected.paymentDate || null) : null;
  const today = agenda?.today ?? new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const confirmed = records.filter((row) => row.received_on);
  const future = events.filter((event) => event.final && event.quantity > 0 && event.paymentDate > today);
  async function confirm(event: React.FormEvent<HTMLFormElement>, row: Row) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(String(row.id)); setMessage("");
    try {
      const response = await fetch("/api/atlas/dividends", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: String(row.id), receivedOn: data.get("receivedOn"), amount: String(data.get("amount") ?? "").replace(",", ".") }) });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível registrar o crédito.");
      setMessage(`Recebimento de ${String(row.ticker)} registrado.`); onRecorded();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Falha ao registrar o crédito."); }
    finally { setBusy(null); }
  }
  return <section className="panel dividend-history" id="dividendos" aria-labelledby="dividend-title">
    <div className="section-heading"><h2 id="dividend-title">Dividendos e JCP</h2><span className="muted">Calendário B3 e registro dos seus créditos</span></div>
    <div className="genial-main dividend-totals">
      <div><span>Recebido confirmado no extrato</span><strong className={confirmed.length ? "up" : ""}>{money(confirmed.reduce((sum, row) => sum + Number(row.received_net), 0))}</strong></div>
      <div><span>A receber com direito definido</span><strong>{money(future.reduce((sum, event) => sum + Number(event.net), 0))}</strong></div>
      <div><span>Créditos confirmados</span><strong>{confirmed.length}</strong></div>
    </div>
    <p>Cada empresa divulga o valor por ação, a <b>data com</b> e a data de pagamento. Você tem direito se possuía as ações ao fim da data com. Compras posteriores participam dos próximos eventos elegíveis.</p>
    {error && <p className="notice error-text" role="alert">{error}</p>}
    {!agenda && !error && <p className="muted" role="status">Consultando os anúncios das ações da sua carteira…</p>}
    {agenda && <>
      <h3>Calendário das suas ações</h3>
      {events.length ? <div className="table-scroll"><table className="dividend-agenda">
        <thead><tr><th>Ação / provento</th><th>Bruto por ação</th><th>Data com</th><th>Pagamento</th><th>Seu direito neste evento</th><th>Líquido estimado</th></tr></thead>
        <tbody>{events.map((event) => <tr key={event.key}>
          <td><b>{event.ticker}</b><small>{kind(event.label)} · <a href={event.source} target="_blank" rel="noreferrer">B3</a></small></td>
          <td>{rate(event.rate)}</td><td>{date(event.lastDatePrior)}</td><td>{date(event.paymentDate)}</td>
          <td>{event.quantity > 0 ? `${event.quantity} ações${event.final ? " com direito" : " · estimativa até a data com"}` : "Sem direito: posição adquirida após a data com ou já vendida nessa data"}</td>
          <td>{event.quantity > 0 ? money(event.net) : "—"}</td>
        </tr>)}</tbody>
      </table></div> : <p className="muted">{agenda.sources.length ? "Nenhum anúncio disponível na consulta para estas ações." : "Os anúncios aparecem aqui depois da primeira compra registrada."}</p>}
      {agenda.sources.filter((source) => !source.available).map((source) => <p className="notice" key={source.ticker}>A consulta da B3 para {source.ticker} está indisponível. Nenhuma previsão foi criada para esse ativo.</p>)}
      {selected && <div className="dividend-simulator">
        <h3>Quanto esse provento pagaria?</h3>
        <div className="dividend-simulator-fields">
          <label>Provento anunciado<select value={selected.key} onChange={(event) => setChosen(event.target.value)}>{events.map((event) => <option key={event.key} value={event.key}>{event.ticker} · {kind(event.label)} · {rate(event.rate)}/ação · data com {date(event.lastDatePrior)}</option>)}</select></label>
          <label>Quantidade de ações<input inputMode="numeric" type="number" min="0" max="9999999" step="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} /></label>
        </div>
        {simulation ? <p className="dividend-calculation"><b>{quantity} × {rate(selected.rate)} = {money(simulation.gross)} bruto</b><span>IR estimado: {money(simulation.tax)} · líquido: <b>{money(simulation.net)}</b></span></p> : <p role="status">Informe uma quantidade inteira de ações.</p>}
        <p className="muted">Esta conta usa o anúncio escolhido. Um provento passado serve como referência e não garante pagamentos futuros; a quantidade simulada não altera seu direito registrado.</p>
      </div>}
    </>}
    <h3>Histórico de direitos e recebimentos</h3>
    {records.length ? <div className="table-scroll"><table>
      <thead><tr><th>Ativo</th><th>Quantidade</th><th>Pagamento previsto</th><th>Bruto / IR / líquido previsto</th><th>Crédito recebido</th></tr></thead>
      <tbody>{records.map((row) => <tr key={String(row.id)}><td><b>{String(row.ticker)}</b><small>{kind(row.label)}</small></td><td>{Number(row.quantity)}</td><td>{date(row.payment_date)}</td>
        <td>{money(row.gross)} / {money(row.tax)} / <b>{money(row.net)}</b></td>
        <td>{row.received_on ? <><b className="up">{money(row.received_net)}</b><small>Recebido em {date(row.received_on)} · confirmado por você</small></> : String(row.payment_date) > today ? "A receber" : <details>
          <summary>Confirmar crédito no extrato</summary>
          <form className="dividend-receipt" onSubmit={(event) => void confirm(event, row)}>
            <label>Data do crédito<input name="receivedOn" type="date" required min={String(row.payment_date)} max={today} defaultValue={String(row.payment_date)} /></label>
            <label>Valor líquido recebido (R$)<input name="amount" inputMode="decimal" required pattern="[0-9]+([.,][0-9]{1,2})?" defaultValue={Number(row.net).toFixed(2)} /></label>
            <button disabled={busy !== null}>{busy === String(row.id) ? "Registrando…" : "Registrar recebimento"}</button>
          </form></details>}</td>
      </tr>)}</tbody>
    </table></div> : <p className="muted">Ainda não há direitos ou créditos registrados. Os anúncios acima explicam as datas; um evento sem direito não entra no seu total.</p>}
    {message && <p role="status">{message}</p>}
    <p className="muted">A data prevista vem da empresa/B3. “Recebido” exige sua confirmação do crédito no extrato da Genial. Os anúncios usam cache de até 6 horas; pagamentos sem data ficam “A definir”.</p>
  </section>;
}

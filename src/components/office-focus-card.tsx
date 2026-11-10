"use client";
import { forwardRef } from "react";
import { X } from "lucide-react";
import { formatBrl } from "@/core/format";
import { SELLS_NEAR_HIGH } from "@/core/range";
import { companyProfile } from "@/core/context";
import type { OfficeAgent } from "./office-map";

/**
 * The card that flies beside a person in the 3D office when the owner clicks them (owner,
 * 10/11/2026): the stock and its price now, what the agent is thinking of doing (the plan, in its
 * own words) and a small chart of the stock. Office3D moves
 * it on screen every frame so it stays next to the person.
 */
const brl = (v: number) => formatBrl(v.toFixed(2));

/** What the agent wants to do now, in one short sentence (owner, 10/11/2026: "a decisão dela, esperar chegar tanto pra comprar"). */
export function agentThought(agent: OfficeAgent, price: number | null): string {
  const r = agent.range;
  if (agent.holding > 0) {
    const avg = agent.paidTotal / agent.holding;
    return SELLS_NEAR_HIGH && r ? `Segurar. Só vendo acima de ${brl(Math.max(r.sellAbove, avg))}, com lucro.` : "Segurar para os dividendos. Nunca vendo com prejuízo.";
  }
  if (!r || price === null) return "Ainda juntando dados para decidir.";
  if (agent.debate?.verdict === "COMPRAR") return `Comprar agora, até ${brl(r.buyBelow)}.`;
  if (price <= r.buyBelow) return `Esperar a queda virar para comprar (faixa até ${brl(r.buyBelow)}).`;
  return `Esperar cair até ${brl(r.buyBelow)} para comprar.`;
}

function Spark({ agent, price }: { agent: OfficeAgent; price: number | null }) {
  const closes = (agent.bars6m ?? []).map((b) => b.close);
  if (closes.length < 2) return null;
  const r = agent.range, W = 280, H = 92, pad = 6;
  const all = [...closes, ...(price !== null ? [price] : []), ...(r ? [r.buyBelow] : [])];
  const lo = Math.min(...all), hi = Math.max(...all);
  const x = (i: number) => pad + (i / (closes.length - 1)) * (W - 2 * pad);
  const y = (v: number) => H - pad - ((v - lo) / (hi - lo || 1)) * (H - 2 * pad);
  const line = closes.map((c, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join(" ");
  const up = price !== null ? price >= closes[0] : closes.at(-1)! >= closes[0];
  return <svg className="focus-spark" viewBox={`0 0 ${W} ${H}`} role="img"
    aria-label={`${agent.ticker} nos últimos 6 meses${r ? `; compra até ${brl(r.buyBelow)}` : ""}${price !== null ? `; agora ${brl(price)}` : ""}.`}>
    <path d={`${line} L${x(closes.length - 1)} ${H} L${x(0)} ${H} Z`} className={`fill ${up ? "up" : "down"}`} />
    {r && <><line x1={pad} x2={W - pad} y1={y(r.buyBelow)} y2={y(r.buyBelow)} className="buy" />
      <text x={W - pad} y={y(r.buyBelow) - 4} textAnchor="end" className="tag">compra até {brl(r.buyBelow)}</text></>}
    <path d={line} className={`line ${up ? "up" : "down"}`} />
    {price !== null && <circle cx={x(closes.length - 1)} cy={y(price)} r="3.5" className="now" />}
  </svg>;
}

export const FocusCard = forwardRef<HTMLDivElement, { agent: OfficeAgent | null; onClose: () => void }>(function FocusCard({ agent, onClose }, ref) {
  const price = agent ? agent.chart?.last ?? agent.chart?.bars.at(-1)?.close ?? null : null;
  const prev = agent?.chart?.prev ?? null;
  const change = price !== null && prev ? price / prev - 1 : null;
  return <div ref={ref} className="focus-card" hidden={!agent} style={{ visibility: "hidden" }} aria-live="polite">
    {agent && <>
      <header>
        <div>
          <b>{agent.name} · {agent.ticker}</b>
          <small>{companyProfile(agent.ticker).name}</small>
        </div>
        <button type="button" className="focus-close" onClick={onClose} aria-label="Parar de seguir" title="Parar de seguir (Esc)"><X size={16} /></button>
      </header>
      <div className="focus-price">
        <strong>{price !== null ? brl(price) : "—"}</strong>
        {change !== null && <span className={change > 0.0005 ? "up" : change < -0.0005 ? "down" : ""}>{change >= 0 ? "▲" : "▼"} {(Math.abs(change) * 100).toFixed(1)}% hoje</span>}
      </div>
      <Spark agent={agent} price={price} />
      <p className="focus-thought"><span aria-hidden="true">💭</span> {agentThought(agent, price)}</p>
    </>}
  </div>;
});

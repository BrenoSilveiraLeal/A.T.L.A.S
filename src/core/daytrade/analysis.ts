export interface MinuteBar {
  bucket_at: string; open: number; high: number; low: number; close: number; volume: number;
}

export interface DeskSignal {
  strategy: "opening-range-vwap-v1";
  state: "INSUFFICIENT_DATA" | "WAITING_FOR_OPENING_RANGE" | "NO_SETUP" | "WATCH_LONG" | "WATCH_SHORT";
  explanation: string;
  generatedAt: string;
  metrics: { bars: number; vwap: number | null; openingHigh: number | null; openingLow: number | null; emaFast: number | null; emaSlow: number | null };
}

const ema = (values: number[], period: number) => {
  if (values.length < period) return null;
  const alpha = 2 / (period + 1);
  return values.slice(1).reduce((value, price) => value + alpha * (price - value), values[0]);
};
const saoPauloDay = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date(iso));
const saoPauloMinute = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));

/** Explainable research candidate only: opening-range breakout aligned with VWAP and EMA trend. */
export function analyzeOpeningRange(bars: MinuteBar[], generatedAt = new Date().toISOString()): DeskSignal {
  const sorted = [...bars].sort((a, b) => a.bucket_at.localeCompare(b.bucket_at));
  const emptyMetrics = { bars: sorted.length, vwap: null, openingHigh: null, openingLow: null, emaFast: null, emaSlow: null };
  if (sorted.length < 30) return { strategy: "opening-range-vwap-v1", state: "INSUFFICIENT_DATA", explanation: "Aguardando pelo menos 30 candles válidos de 1 minuto; nenhum sinal é emitido.", generatedAt, metrics: emptyMetrics };
  const date = saoPauloDay(sorted.at(-1)!.bucket_at);
  const session = sorted.filter((bar) => saoPauloDay(bar.bucket_at) === date && saoPauloMinute(bar.bucket_at) >= "09:00" && saoPauloMinute(bar.bucket_at) < "18:25");
  if (session.length < 30) return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: "A faixa inicial requer 30 minutos da sessão atual.", generatedAt, metrics: { ...emptyMetrics, bars: session.length } };
  const opening = session.filter((bar) => saoPauloMinute(bar.bucket_at) >= "09:00" && saoPauloMinute(bar.bucket_at) < "09:15");
  if (opening.length !== 15 || opening.some((bar, index) => index > 0 && Date.parse(bar.bucket_at) - Date.parse(opening[index - 1].bucket_at) !== 60_000)) return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: "A abertura 09:00–09:15 está incompleta; candles ausentes impedem a leitura da faixa.", generatedAt, metrics: { ...emptyMetrics, bars: session.length } };
  const closes = session.map((bar) => bar.close);
  const v = session.reduce((sum, bar) => sum + bar.close * bar.volume, 0);
  const volume = session.reduce((sum, bar) => sum + bar.volume, 0);
  const vwap = volume > 0 ? v / volume : null;
  const openingHigh = Math.max(...opening.map((bar) => bar.high));
  const openingLow = Math.min(...opening.map((bar) => bar.low));
  const emaFast = ema(closes, 9), emaSlow = ema(closes, 21), last = session.at(-1)!;
  const metrics = { bars: session.length, vwap, openingHigh, openingLow, emaFast, emaSlow };
  if (vwap !== null && emaFast !== null && emaSlow !== null && last.close > openingHigh && last.close > vwap && emaFast > emaSlow)
    return { strategy: "opening-range-vwap-v1", state: "WATCH_LONG", explanation: "Preço acima da faixa inicial, VWAP e tendência EMA. Observação de pesquisa; não é recomendação nem ordem.", generatedAt, metrics };
  if (vwap !== null && emaFast !== null && emaSlow !== null && last.close < openingLow && last.close < vwap && emaFast < emaSlow)
    return { strategy: "opening-range-vwap-v1", state: "WATCH_SHORT", explanation: "Preço abaixo da faixa inicial, VWAP e tendência EMA. Observação de pesquisa; não é recomendação nem ordem.", generatedAt, metrics };
  return { strategy: "opening-range-vwap-v1", state: "NO_SETUP", explanation: "Os filtros de rompimento, VWAP e tendência ainda não estão alinhados.", generatedAt, metrics };
}

export interface BacktestSummary {
  researchOnly: true; trades: number; netPnl: number; winRate: number | null; profitFactor: number | null;
  maxDrawdown: number; outOfSampleTrades: number; walkForwardFolds: number; trainingDays: number; evaluationDays: number;
  status: "INSUFFICIENT_DATA" | "NO_TRADES" | "RESEARCH_ONLY";
}

/** Anchored walk-forward evaluation of frozen rules; no parameter fitting or forecast. */
export function backtestCandidate(bars: MinuteBar[], pointValue: number, tickSize: number, costPerSide: number, slippageTicks: number): BacktestSummary {
  const sorted = [...bars].sort((a, b) => a.bucket_at.localeCompare(b.bucket_at));
  const allDays = new Map<string, MinuteBar[]>();
  for (const bar of sorted) { const key = saoPauloDay(bar.bucket_at); allDays.set(key, [...(allDays.get(key) ?? []), bar]); }
  const validDays = [...allDays.entries()].filter(([, day]) => day.some((b) => saoPauloMinute(b.bucket_at) >= "09:00" && saoPauloMinute(b.bucket_at) < "18:25"));
  const initialTrainingDays = 14, evaluationBlockDays = 6;
  const foldCount = Math.floor(Math.max(0, validDays.length - initialTrainingDays) / evaluationBlockDays);
  const evaluationStart = initialTrainingDays;
  const evaluationDays = foldCount * evaluationBlockDays;
  if (foldCount < 1) return { researchOnly: true, trades: 0, netPnl: 0, winRate: null, profitFactor: null, maxDrawdown: 0, outOfSampleTrades: 0, walkForwardFolds: 0, trainingDays: Math.min(validDays.length, initialTrainingDays), evaluationDays: 0, status: "INSUFFICIENT_DATA" };
  // Rules remain frozen. Each six-session evaluation block follows an expanding historical window.
  const roundTripFriction = 2 * (costPerSide + tickSize * pointValue * slippageTicks);
  const pnl: number[] = [];
  for (let fold = 0; fold < foldCount; fold++) {
   const blockStart = evaluationStart + fold * evaluationBlockDays;
   const trainingWindow = validDays.slice(0, blockStart);
   if (trainingWindow.length < initialTrainingDays) continue;
   for (const [, rawDay] of validDays.slice(blockStart, blockStart + evaluationBlockDays)) {
    const day = rawDay.filter((b) => saoPauloMinute(b.bucket_at) >= "09:00" && saoPauloMinute(b.bucket_at) < "18:25");
    if (day.length < 30) continue;
    const opening = day.filter((b) => saoPauloMinute(b.bucket_at) >= "09:00" && saoPauloMinute(b.bucket_at) < "09:15");
    if (opening.length !== 15) continue;
    const rangeHigh = Math.max(...opening.map((b) => b.high)), rangeLow = Math.min(...opening.map((b) => b.low));
    const rest = day.filter((b) => saoPauloMinute(b.bucket_at) >= "09:15"); let side: 1 | -1 | 0 = 0, entry = 0, exit = 0;
    for (let i = 5; i < rest.length; i++) {
      const history = [...opening, ...rest.slice(0, i + 1)], last = rest[i];
      const totalVol = history.reduce((sum, b) => sum + b.volume, 0);
      const vwap = totalVol > 0 ? history.reduce((sum, b) => sum + b.close * b.volume, 0) / totalVol : null;
      const closes = history.map((b) => b.close), fast = ema(closes, 9), slow = ema(closes, 21);
      if (vwap === null || fast === null || slow === null) continue;
      if (!side && last.close > rangeHigh && last.close > vwap && fast > slow) { side = 1; entry = last.close; }
      else if (!side && last.close < rangeLow && last.close < vwap && fast < slow) { side = -1; entry = last.close; }
      else if (side === 1 && last.low <= rangeLow) { exit = rangeLow; break; }
      else if (side === -1 && last.high >= rangeHigh) { exit = rangeHigh; break; }
      else if (side && ((side === 1 && (last.close < fast || last.close < vwap)) || (side === -1 && (last.close > fast || last.close > vwap)))) { exit = last.close; break; }
    }
    if (side) { if (!exit) exit = rest.at(-1)!.close; pnl.push(side * (exit - entry) * pointValue - roundTripFriction); }
   }
  }
  const gains = pnl.filter((n) => n > 0).reduce((a, b) => a + b, 0), losses = -pnl.filter((n) => n < 0).reduce((a, b) => a + b, 0);
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const n of pnl) { equity += n; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  return { researchOnly: true, trades: pnl.length, netPnl: pnl.reduce((a, b) => a + b, 0), winRate: pnl.length ? pnl.filter((n) => n > 0).length / pnl.length : null, profitFactor: losses ? gains / losses : gains ? null : 0, maxDrawdown, outOfSampleTrades: pnl.length, walkForwardFolds: foldCount, trainingDays: evaluationStart + (foldCount - 1) * evaluationBlockDays, evaluationDays, status: pnl.length ? "RESEARCH_ONLY" : "NO_TRADES" };
}

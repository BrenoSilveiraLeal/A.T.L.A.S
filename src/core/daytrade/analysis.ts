import { B3_CALENDAR } from "@/core/b3-calendar";
import { winSessionClose } from "@/core/daytrade/market-hours";

export interface MinuteBar {
  bucket_at: string; open: number; high: number; low: number; close: number; volume: number; turnover?: number | null;
}

export interface DeskSignal {
  strategy: "opening-range-vwap-v1";
  state: "INSUFFICIENT_DATA" | "WAITING_FOR_OPENING_RANGE" | "NO_SETUP" | "WATCH_LONG" | "WATCH_SHORT";
  explanation: string;
  generatedAt: string;
  metrics: { bars: number; vwap: number | null; openingHigh: number | null; openingLow: number | null; emaFast: number | null; emaSlow: number | null };
}

const emaSeeded = (values: number[], period: number) => {
  if (!values.length) return null;
  const alpha = 2 / (period + 1);
  return values.slice(1).reduce((value, price) => value + alpha * (price - value), values[0]);
};
const ema = (values: number[], period: number) => values.length < period ? null : emaSeeded(values, period);
const saoPauloDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const saoPauloMinuteFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const saoPauloDay = (iso: string) => saoPauloDayFormatter.format(new Date(iso));
const saoPauloMinute = (iso: string) => saoPauloMinuteFormatter.format(new Date(iso));

/** Reject corrupt persisted rows before they can influence indicators or simulated fills. */
function validMinuteBar(bar: MinuteBar, tickSize?: number | null): boolean {
  const at = Date.parse(bar.bucket_at);
  if (!Number.isFinite(at) || at % 60_000 !== 0) return false;
  const { open, high, low, close, volume, turnover } = bar;
  if (![open, high, low, close].every((price) => Number.isFinite(price) && price > 0) ||
      !Number.isSafeInteger(volume) || volume <= 0 || high < Math.max(open, close, low) || low > Math.min(open, close, high)) return false;
  if (turnover !== null && turnover !== undefined) {
    if (!Number.isFinite(turnover) || turnover <= 0) return false;
    const tolerance = Math.max(0.01, high * volume * 1e-9);
    if (turnover < low * volume - tolerance || turnover > high * volume + tolerance) return false;
  }
  if (tickSize !== null && tickSize !== undefined && (!Number.isFinite(tickSize) || tickSize <= 0 ||
      [open, high, low, close].some((price) => Math.abs(price / tickSize - Math.round(price / tickSize)) > 1e-8))) return false;
  return true;
}

/** Explainable research candidate only: opening-range breakout aligned with VWAP and EMA trend. */
export function analyzeOpeningRange(bars: MinuteBar[], generatedAt = new Date().toISOString(), expiresOn: string | null = null, tickSize?: number | null): DeskSignal {
  const sorted = [...bars].sort((a, b) => a.bucket_at.localeCompare(b.bucket_at));
  const emptyMetrics = { bars: sorted.length, vwap: null, openingHigh: null, openingLow: null, emaFast: null, emaSlow: null };
  if (sorted.some((bar) => !validMinuteBar(bar, tickSize))) return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: "Dados persistidos inválidos ou fora do tick do contrato; análise pausada até a correção do feed.", generatedAt, metrics: emptyMetrics };
  if (sorted.length < 30) return { strategy: "opening-range-vwap-v1", state: "INSUFFICIENT_DATA", explanation: "Aguardando pelo menos 30 candles válidos de 1 minuto; nenhum sinal é emitido.", generatedAt, metrics: emptyMetrics };
  const date = saoPauloDay(sorted.at(-1)!.bucket_at);
  const year = Number(date.slice(0, 4)), calendar = B3_CALENDAR[year];
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" })
    .format(new Date(`${date}T12:00:00-03:00`));
  if (!calendar?.official)
    return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: `Calendário oficial B3 de ${year} não confirmado; leitura e sinais desativados.`, generatedAt, metrics: emptyMetrics };
  if (weekday === "Sat" || weekday === "Sun" || calendar.closed[date])
    return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: `Sem pregão regular B3 em ${date}; nenhum sinal emitido.`, generatedAt, metrics: emptyMetrics };
  if (calendar.lateOpen[date])
    return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: `Pregão especial com abertura às ${calendar.lateOpen[date]}; faixa inicial das 09:00 desativada.`, generatedAt, metrics: emptyMetrics };
  const sessionClose = winSessionClose(date, expiresOn);
  const session = sorted.filter((bar) => saoPauloDay(bar.bucket_at) === date && saoPauloMinute(bar.bucket_at) >= "09:00" && saoPauloMinute(bar.bucket_at) < sessionClose);
  if (session.some((bar, index) => index > 0 && Date.parse(bar.bucket_at) - Date.parse(session[index - 1].bucket_at) !== 60_000))
    return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: "Dados de 1 minuto com lacunas; leitura de VWAP e medias pausada ate o feed ficar continuo.", generatedAt, metrics: { ...emptyMetrics, bars: session.length } };
  if (session.length < 30) return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: "A faixa inicial requer 30 minutos da sessão atual.", generatedAt, metrics: { ...emptyMetrics, bars: session.length } };
  const opening = session.filter((bar) => saoPauloMinute(bar.bucket_at) >= "09:00" && saoPauloMinute(bar.bucket_at) < "09:15");
  if (opening.length !== 15 || opening.some((bar, index) => index > 0 && Date.parse(bar.bucket_at) - Date.parse(opening[index - 1].bucket_at) !== 60_000)) return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: "A abertura 09:00–09:15 está incompleta; candles ausentes impedem a leitura da faixa.", generatedAt, metrics: { ...emptyMetrics, bars: session.length } };
  const closes = session.map((bar) => bar.close);
  if (session.some((bar) => bar.turnover === null || bar.turnover === undefined || !Number.isFinite(bar.turnover)) || session.some((bar) => bar.volume <= 0))
    return { strategy: "opening-range-vwap-v1", state: "WAITING_FOR_OPENING_RANGE", explanation: "VWAP indisponível: aguardando candles completos com preço×quantidade dos negócios do ProfitDLL.", generatedAt, metrics: { ...emptyMetrics, bars: session.length } };
  const v = session.reduce((sum, bar) => sum + bar.turnover!, 0);
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

export interface BacktestFoldSummary {
  fold: number; trainingSessions: number; evaluationFrom: string; evaluationThrough: string;
  trades: number; grossPnl: number; feesPaid: number; slippageCost: number; netPnl: number;
  tradeLossLimitBreaches: number; dailyLossLimitBreaches: number;
  /** Chronological closed-trade net results, retained to calculate drawdown across selected folds. */
  netPnlByTrade: number[];
}

export interface BacktestSummary {
  candidate: BacktestCandidateId;
  maxTradesPerDay: number;
  researchOnly: true; trades: number; grossPnl: number; feesPaid: number; slippageCost: number; netPnl: number; winRate: number | null; profitFactor: number | null;
  maxDrawdown: number; outOfSampleTrades: number; walkForwardFolds: number; trainingDays: number; evaluationDays: number;
  eligibleSessions: number; sparseSessions: number; gapTerminatedSessions: number; gapFlattenedTrades: number;
  tradeLossLimitBreaches: number; dailyLossLimitBreaches: number; maxSingleTradeLoss: number; maxDailyLoss: number;
  folds: BacktestFoldSummary[];
  status: "INSUFFICIENT_DATA" | "NO_TRADES" | "RESEARCH_ONLY";
}

export interface WalkForwardSelectionFold extends BacktestFoldSummary {
  selectedCandidate: BacktestCandidateId | null;
  trainingTrades: number;
  selectionScores: Array<{ candidate: BacktestCandidateId; netPnl: number; trades: number; maxDrawdown: number; netToDrawdown: number | null; riskLimitBreaches: number }>;
}

export interface WalkForwardSelectionSummary {
  researchOnly: true;
  minimumTrainingTrades: number;
  trades: number;
  grossPnl: number;
  feesPaid: number;
  slippageCost: number;
  netPnl: number;
  maxDrawdown: number;
  folds: WalkForwardSelectionFold[];
  status: "INSUFFICIENT_DATA" | "NO_TRADES" | "RESEARCH_ONLY";
}

export const BACKTEST_CANDIDATES = [
  { id: "opening-range-vwap-v1", label: "Rompimento + VWAP + EMA", description: "Exige alinhamento do rompimento da faixa inicial, VWAP e EMA 9/21." },
  { id: "opening-range-confirmed-v1", label: "Rompimento confirmado + VWAP + EMA", description: "Exige dois fechamentos consecutivos além da faixa inicial, além dos filtros VWAP e EMA 9/21." },
  { id: "opening-range-unfiltered-entry-v1", label: "Rompimento sem filtro de entrada", description: "Baseline comparativo: remove os filtros VWAP e EMA da entrada; conserva as mesmas saídas, stops, janela e custos." },
] as const;
export type BacktestCandidateId = typeof BACKTEST_CANDIDATES[number]["id"];

export interface BacktestRiskLimits {
  maxLossPerTrade: number;
  maxLossPerDay: number;
  maxTradesPerDay: number;
}

function emptyBacktest(candidate: BacktestCandidateId, risk: BacktestRiskLimits, trainingDays = 0): BacktestSummary {
  return {
    candidate, maxTradesPerDay: risk.maxTradesPerDay, researchOnly: true, trades: 0, grossPnl: 0,
    feesPaid: 0, slippageCost: 0, netPnl: 0, winRate: null, profitFactor: null, maxDrawdown: 0,
    outOfSampleTrades: 0, walkForwardFolds: 0, trainingDays, evaluationDays: 0,
    eligibleSessions: 0, sparseSessions: 0, gapTerminatedSessions: 0, gapFlattenedTrades: 0,
    tradeLossLimitBreaches: 0, dailyLossLimitBreaches: 0, maxSingleTradeLoss: 0, maxDailyLoss: 0,
    folds: [], status: "INSUFFICIENT_DATA",
  };
}

/**
 * Simulates candidate selection without look-ahead: at each evaluation block, rank candidates
 * using only the already-completed OOS folds, then score the selected candidate on the next fold.
 * A minimum trade count avoids switching candidates on a handful of observations. This remains
 * exploratory and cannot approve or route an order.
 */
export function selectWalkForwardCandidate(
  reports: readonly BacktestSummary[], minimumTrainingTrades = 10,
): WalkForwardSelectionSummary {
  const valid = reports.filter((report) => report.researchOnly && report.folds.length > 0);
  const empty: WalkForwardSelectionSummary = {
    researchOnly: true, minimumTrainingTrades, trades: 0, grossPnl: 0, feesPaid: 0,
    slippageCost: 0, netPnl: 0, maxDrawdown: 0, folds: [], status: "INSUFFICIENT_DATA",
  };
  if (valid.length < 2 || !Number.isInteger(minimumTrainingTrades) || minimumTrainingTrades < 1) return empty;
  const commonFolds = Math.min(...valid.map((report) => report.folds.length));
  if (commonFolds < 2) return empty;

  const selectedFolds: WalkForwardSelectionFold[] = [];
  for (let evaluationIndex = 1; evaluationIndex < commonFolds; evaluationIndex++) {
    const selectionScores = valid.map((report) => {
      const prior = report.folds.slice(0, evaluationIndex);
      return {
        candidate: report.candidate,
        netPnl: prior.reduce((sum, fold) => sum + fold.netPnl, 0),
        trades: prior.reduce((sum, fold) => sum + fold.trades, 0),
        riskLimitBreaches: prior.reduce((sum, fold) => sum + fold.tradeLossLimitBreaches + fold.dailyLossLimitBreaches, 0),
        // Compare candidates using the actual chronological trade path, not only
        // one aggregate return per six-session fold.
        drawdown: maxDrawdownFor(prior.flatMap((fold) => fold.netPnlByTrade)),
      };
    });
    const eligible = selectionScores.filter((score) => score.trades >= minimumTrainingTrades &&
      score.riskLimitBreaches === 0 && score.netPnl > 0);
    if (!eligible.length) continue;
    eligible.sort((a, b) => {
      // A zero-drawdown positive path has an unbounded ratio; handle it explicitly
      // so Infinity - Infinity cannot turn the comparator into NaN and skip tie-breaks.
      if (a.drawdown === 0 && b.drawdown > 0) return -1;
      if (a.drawdown > 0 && b.drawdown === 0) return 1;
      if (a.drawdown > 0 && b.drawdown > 0) {
        const ratioDifference = b.netPnl / b.drawdown - a.netPnl / a.drawdown;
        if (ratioDifference !== 0) return ratioDifference;
      }
      return b.netPnl - a.netPnl || a.candidate.localeCompare(b.candidate);
    });
    const winner = eligible[0];
    const report = valid.find((item) => item.candidate === winner.candidate)!;
    const scoredFold = report.folds[evaluationIndex];
    selectedFolds.push({
      ...scoredFold,
      selectedCandidate: winner.candidate,
      trainingTrades: winner.trades,
      selectionScores: selectionScores.map(({ candidate, netPnl, trades, drawdown, riskLimitBreaches }) => ({
        candidate, netPnl, trades, maxDrawdown: drawdown,
        netToDrawdown: netPnl > 0 && drawdown > 0 ? netPnl / drawdown : null,
        riskLimitBreaches,
      })),
    });
  }

  const net = selectedFolds.flatMap((fold) => fold.netPnlByTrade);
  const result: WalkForwardSelectionSummary = {
    researchOnly: true, minimumTrainingTrades, trades: selectedFolds.reduce((sum, fold) => sum + fold.trades, 0),
    grossPnl: selectedFolds.reduce((sum, fold) => sum + fold.grossPnl, 0),
    feesPaid: selectedFolds.reduce((sum, fold) => sum + fold.feesPaid, 0),
    slippageCost: selectedFolds.reduce((sum, fold) => sum + fold.slippageCost, 0),
    netPnl: selectedFolds.reduce((sum, fold) => sum + fold.netPnl, 0),
    maxDrawdown: maxDrawdownFor(net), folds: selectedFolds,
    status: selectedFolds.length ? (selectedFolds.some((fold) => fold.trades) ? "RESEARCH_ONLY" : "NO_TRADES") : "INSUFFICIENT_DATA",
  };
  return result;
}

function maxDrawdownFor(values: readonly number[]): number {
  let equity = 0, peak = 0, drawdown = 0;
  for (const value of values) { equity += value; peak = Math.max(peak, equity); drawdown = Math.max(drawdown, peak - equity); }
  return drawdown;
}

/** Anchored walk-forward evaluation of frozen rules; no parameter fitting or forecast. */
export function backtestCandidate(
  bars: MinuteBar[], pointValue: number, tickSize: number, costPerSide: number, slippageTicks: number,
  expiresOn: string | null, session: { lastEntry: string; flatBy: string }, candidate: BacktestCandidateId,
  risk: BacktestRiskLimits, completedHistoryBarCounts: Readonly<Record<string, number>> = {},
): BacktestSummary {
  const validClock = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
  const validCandidate = BACKTEST_CANDIDATES.some((item) => item.id === candidate);
  const validNumbers = [pointValue, tickSize, costPerSide, slippageTicks, risk.maxLossPerTrade, risk.maxLossPerDay]
    .every(Number.isFinite);
  if (!validCandidate || !validNumbers || pointValue <= 0 || tickSize <= 0 || costPerSide < 0 || slippageTicks < 0 ||
    risk.maxLossPerTrade <= 0 || risk.maxLossPerDay < risk.maxLossPerTrade ||
    !Number.isSafeInteger(risk.maxTradesPerDay) || risk.maxTradesPerDay < 1 ||
    !validClock(session.lastEntry) || !validClock(session.flatBy) ||
    session.lastEntry <= "09:00" || session.lastEntry >= session.flatBy || session.flatBy >= "18:35")
    return emptyBacktest(candidate, risk);

  const sorted = [...bars].sort((a, b) => a.bucket_at.localeCompare(b.bucket_at));
  const invalidTimestamp = sorted.some((bar) => !Number.isFinite(Date.parse(bar.bucket_at)));
  if (invalidTimestamp) return emptyBacktest(candidate, risk);
  const allDays = new Map<string, MinuteBar[]>();
  for (const bar of sorted) {
    const key = saoPauloDay(bar.bucket_at), day = allDays.get(key);
    if (day) day.push(bar);
    else allDays.set(key, [bar]);
  }
  const invalidDates = new Set(sorted.filter((bar) => !validMinuteBar(bar, tickSize)).map((bar) => saoPauloDay(bar.bucket_at)));
  const today = saoPauloDay(new Date().toISOString());
  const validDays: Array<[string, MinuteBar[]]> = [];
  const sparseDays = new Set<string>();
  for (const [date, rawDay] of allDays) {
    // One corrupt, misaligned, or off-tick row invalidates its whole session, not every other date.
    if (invalidDates.has(date)) continue;
    // Never treat today's still-forming session as an out-of-sample observation.
    if (date >= today) continue;
    const year = Number(date.slice(0, 4)), calendar = B3_CALENDAR[year];
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short" }).format(new Date(`${date}T12:00:00-03:00`));
    // Do not backtest across provisional calendars, exchange holidays, or special late opens.
    if (!calendar?.official || calendar.closed[date] || calendar.lateOpen[date] || weekday === "Sat" || weekday === "Sun") continue;
    const close = winSessionClose(date, expiresOn);
    const day = rawDay.filter((b) => saoPauloMinute(b.bucket_at) >= "09:00" && saoPauloMinute(b.bucket_at) < close);
    const closeMinutes = Number(close.slice(0, 2)) * 60 + Number(close.slice(3));
    const expectedBars = closeMinutes - 9 * 60;
    const lastMinuteOfSession = `${String(Math.floor((closeMinutes - 1) / 60)).padStart(2, "0")}:${String((closeMinutes - 1) % 60).padStart(2, "0")}`;
    const minuteContiguous = day.length === expectedBars && saoPauloMinute(day.at(-1)!.bucket_at) === lastMinuteOfSession &&
      day.every((bar, i) => i === 0 || Date.parse(bar.bucket_at) - Date.parse(day[i - 1].bucket_at) === 60_000);
    // Sparse trade-derived candles are usable only when a completed ProfitDLL history-session
    // marker proves that all source trades arrived. For those sessions, the first gap ends the
    // strategy sample; we never fabricate zero-volume bars or trade through missing intervals.
    if (!minuteContiguous && completedHistoryBarCounts[date] !== day.length) continue;
    if (!minuteContiguous) sparseDays.add(date);
    if (day.some((bar) => bar.turnover === null || bar.turnover === undefined)) continue;
    validDays.push([date, day]);
  }
  // ProfitDLL's historical trade feed retains 30 calendar days. Keep the anchored
  // research window inside the data source's practical reach while retaining multiple
  // out-of-sample blocks; these short blocks remain exploratory, not statistical proof.
  const initialTrainingDays = 10, evaluationBlockDays = 3;
  const foldCount = Math.floor(Math.max(0, validDays.length - initialTrainingDays) / evaluationBlockDays);
  const evaluationStart = initialTrainingDays;
  const evaluationDays = foldCount * evaluationBlockDays;
  if (foldCount < 1) return { ...emptyBacktest(candidate, risk, Math.min(validDays.length, initialTrainingDays)), eligibleSessions: validDays.length, sparseSessions: sparseDays.size };
  // Rules remain frozen. Each evaluation block follows an expanding historical window.
  const feesPerRoundTrip = 2 * costPerSide;
  const slippagePerRoundTrip = 2 * tickSize * pointValue * slippageTicks;
  const results: Array<{ gross: number; net: number; fold: number; day: string }> = [];
  let gapTerminatedSessions = 0, gapFlattenedTrades = 0;
  for (let fold = 0; fold < foldCount; fold++) {
    const blockStart = evaluationStart + fold * evaluationBlockDays;
    const trainingWindow = validDays.slice(0, blockStart);
    if (trainingWindow.length < initialTrainingDays) continue;
    for (const [sessionDay, day] of validDays.slice(blockStart, blockStart + evaluationBlockDays)) {
      if (day.length < 30) continue;
      const opening = day.filter((bar) => saoPauloMinute(bar.bucket_at) >= "09:00" && saoPauloMinute(bar.bucket_at) < "09:15");
      if (opening.length !== 15) continue;
      const rangeHigh = Math.max(...opening.map((bar) => bar.high));
      const rangeLow = Math.min(...opening.map((bar) => bar.low));
      const rest = day.filter((bar) => saoPauloMinute(bar.bucket_at) >= "09:15" && saoPauloMinute(bar.bucket_at) <= session.flatBy);
      if (!rest.some((bar) => saoPauloMinute(bar.bucket_at) === session.flatBy)) continue;

      // Seed both EMAs from the first session close, matching live analysis and the chart.
      let totalVol = opening.reduce((sum, bar) => sum + bar.volume, 0);
      let totalTurnover = opening.reduce((sum, bar) => sum + bar.turnover!, 0);
      const openingCloses = opening.map((bar) => bar.close);
      let fast = emaSeeded(openingCloses, 9)!;
      let slow = emaSeeded(openingCloses, 21)!;
      const fastAlpha = 2 / 10, slowAlpha = 2 / 22;
      let side: 1 | -1 | 0 = 0, entry = 0, exitPending = false;
      let tradesToday = 0, realizedToday = 0, suppressSignalAt = -1;
      let previousMinute = Date.parse(opening.at(-1)!.bucket_at);
      const closeTrade = (exitPrice: number, foldNumber: number) => {
        const gross = side * (exitPrice - entry) * pointValue;
        const net = gross - feesPerRoundTrip - slippagePerRoundTrip;
        results.push({ gross, net, fold: foldNumber, day: sessionDay });
        realizedToday += net;
        side = 0; entry = 0; exitPending = false;
      };

      for (let i = 0; i < rest.length; i++) {
        const last = rest[i], next = rest[i + 1];
        const lastAt = Date.parse(last.bucket_at);
        if (lastAt - previousMinute !== 60_000) {
          gapTerminatedSessions++;
          if (side !== 0) { closeTrade(last.open, fold + 1); gapFlattenedTrades++; }
          break;
        }
        previousMinute = lastAt;
        const lastMinute = saoPauloMinute(last.bucket_at);
        totalVol += last.volume;
        totalTurnover += last.turnover!;
        fast += fastAlpha * (last.close - fast);
        slow += slowAlpha * (last.close - slow);
        const vwap = totalVol > 0 ? totalTurnover / totalVol : null;
        if (vwap === null) continue;

        // Paper priority: stops first, queued signal exits second, then session flattening.
        if (side === 1 && last.low <= rangeLow) {
          closeTrade(last.open <= rangeLow ? last.open : rangeLow, fold + 1);
          suppressSignalAt = i;
          continue;
        }
        if (side === -1 && last.high >= rangeHigh) {
          closeTrade(last.open >= rangeHigh ? last.open : rangeHigh, fold + 1);
          suppressSignalAt = i;
          continue;
        }
        if (side !== 0 && exitPending) {
          closeTrade(last.open, fold + 1);
          suppressSignalAt = i;
          continue;
        }
        if (side !== 0 && lastMinute >= session.flatBy) {
          closeTrade(last.open, fold + 1);
          suppressSignalAt = i;
          continue;
        }
        if (side !== 0 && next && saoPauloMinute(next.bucket_at) >= session.flatBy) {
          const nextIsFlat = saoPauloMinute(next.bucket_at) === session.flatBy;
          const nextStopHit = side === 1 ? next.low <= rangeLow : next.high >= rangeHigh;
          if (nextIsFlat && nextStopHit) {
            const stopExit = side === 1
              ? (next.open <= rangeLow ? next.open : rangeLow)
              : (next.open >= rangeHigh ? next.open : rangeHigh);
            closeTrade(stopExit, fold + 1);
          } else {
            closeTrade(next.open, fold + 1);
          }
          break;
        }
        if (side !== 0) {
          const strategyExit = (side === 1 && (last.close < fast || last.close < vwap)) ||
            (side === -1 && (last.close > fast || last.close > vwap));
          if (strategyExit && next) exitPending = true;
          continue;
        }
        if (i === suppressSignalAt || tradesToday >= risk.maxTradesPerDay ||
          realizedToday <= -risk.maxLossPerDay || opening.length + i + 1 < 30 || !next) continue;

        const nextMinute = saoPauloMinute(next.bucket_at);
        if (Date.parse(next.bucket_at) - lastAt !== 60_000) continue;
        if (nextMinute >= session.lastEntry || nextMinute >= session.flatBy) continue;
        const previous = i > 0 ? rest[i - 1] : null;
        const confirmedBreakout = candidate !== "opening-range-confirmed-v1" || Boolean(previous &&
          (last.close > rangeHigh && previous.close > rangeHigh || last.close < rangeLow && previous.close < rangeLow));
        const longSetup = last.close > rangeHigh && confirmedBreakout &&
          (candidate === "opening-range-unfiltered-entry-v1" || (last.close > vwap && fast > slow));
        const shortSetup = last.close < rangeLow && confirmedBreakout &&
          (candidate === "opening-range-unfiltered-entry-v1" || (last.close < vwap && fast < slow));
        const entrySlippage = slippageTicks * tickSize;
        const candidateSide: 1 | -1 | 0 = longSetup ? 1 : shortSetup ? -1 : 0;
        if (candidateSide === 0) continue;
        const stop = candidateSide === 1 ? rangeLow : rangeHigh;
        if ((candidateSide === 1 && next.open + entrySlippage <= stop) ||
          (candidateSide === -1 && next.open - entrySlippage >= stop)) continue;
        const worstLoss = Math.abs(next.open - stop) * pointValue + feesPerRoundTrip + slippagePerRoundTrip;
        if (worstLoss > risk.maxLossPerTrade || realizedToday - worstLoss < -risk.maxLossPerDay) continue;

        side = candidateSide; entry = next.open; tradesToday++;
      }
    }
  }
  const pnl = results.map((trade) => trade.net);
  const dailyPnl = new Map<string, number>();
  for (const trade of results) dailyPnl.set(trade.day, (dailyPnl.get(trade.day) ?? 0) + trade.net);
  const dailyLosses = [...dailyPnl.values()].map((value) => Math.max(0, -value));
  const singleTradeLosses = results.map((trade) => Math.max(0, -trade.net));
  const gains = pnl.filter((n) => n > 0).reduce((a, b) => a + b, 0), losses = -pnl.filter((n) => n < 0).reduce((a, b) => a + b, 0);
  let equity = 0, peak = 0, maxDrawdown = 0;
  for (const n of pnl) { equity += n; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  const folds: BacktestFoldSummary[] = Array.from({ length: foldCount }, (_, index) => {
    const blockStart = evaluationStart + index * evaluationBlockDays;
    const days = validDays.slice(blockStart, blockStart + evaluationBlockDays);
    const trades = results.filter((trade) => trade.fold === index + 1);
    const foldDailyPnl = new Map<string, number>();
    for (const trade of trades) foldDailyPnl.set(trade.day, (foldDailyPnl.get(trade.day) ?? 0) + trade.net);
    const foldDailyLosses = [...foldDailyPnl.values()].map((value) => Math.max(0, -value));
    const foldTradeLosses = trades.map((trade) => Math.max(0, -trade.net));
    return {
      fold: index + 1,
      trainingSessions: blockStart,
      evaluationFrom: days[0][0],
      evaluationThrough: days.at(-1)![0],
      trades: trades.length,
      grossPnl: trades.reduce((sum, trade) => sum + trade.gross, 0),
      feesPaid: feesPerRoundTrip * trades.length,
      slippageCost: slippagePerRoundTrip * trades.length,
      netPnl: trades.reduce((sum, trade) => sum + trade.net, 0),
      tradeLossLimitBreaches: foldTradeLosses.filter((value) => value > risk.maxLossPerTrade).length,
      dailyLossLimitBreaches: foldDailyLosses.filter((value) => value > risk.maxLossPerDay).length,
      netPnlByTrade: trades.map((trade) => trade.net),
    };
  });
  return {
    candidate, maxTradesPerDay: risk.maxTradesPerDay, researchOnly: true, trades: pnl.length,
    grossPnl: results.reduce((sum, trade) => sum + trade.gross, 0),
    feesPaid: feesPerRoundTrip * results.length,
    slippageCost: slippagePerRoundTrip * results.length,
    netPnl: pnl.reduce((a, b) => a + b, 0),
    winRate: pnl.length ? pnl.filter((n) => n > 0).length / pnl.length : null,
    profitFactor: losses ? gains / losses : gains ? null : 0, maxDrawdown,
    outOfSampleTrades: pnl.length, walkForwardFolds: foldCount,
    trainingDays: evaluationStart + (foldCount - 1) * evaluationBlockDays,
    evaluationDays, eligibleSessions: validDays.length, sparseSessions: sparseDays.size,
    gapTerminatedSessions, gapFlattenedTrades, folds, status: pnl.length ? "RESEARCH_ONLY" : "NO_TRADES",
    tradeLossLimitBreaches: singleTradeLosses.filter((value) => value > risk.maxLossPerTrade).length,
    dailyLossLimitBreaches: dailyLosses.filter((value) => value > risk.maxLossPerDay).length,
    maxSingleTradeLoss: Math.max(0, ...singleTradeLosses), maxDailyLoss: Math.max(0, ...dailyLosses),
  };
}

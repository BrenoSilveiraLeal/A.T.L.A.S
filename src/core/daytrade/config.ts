import { z } from "zod";

/**
 * The DASH settings file (config/daytrade.json; owner, 01/11/2026: "já deixa as configurações no
 * arquivo"). Contract specs, session hours, costs and money limits stay null until they come from
 * official B3/Genial sources or the broker note (docs/daytrade/ARQUITETURA.md: "não codificar valores
 * de suposição como fatos"); `readiness` lists what is missing, and while anything needed is
 * missing the desks stay idle. LIVE mode is not accepted by this version at all. Pure; no I/O.
 */
const money = z.number().positive().nullable();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();

export const instrumentSchema = z.object({
  id: z.enum(["WIN", "WDO"]),
  name: z.string().min(1),
  enabled: z.boolean(),
  /** The tradable contract's symbol at the broker (the current series), not a continuous series. */
  symbol: z.string().regex(/^[A-Z0-9$]{3,12}$/).nullable(),
  tickSize: money,
  pointValue: money,
  marginPerContract: money,
  verified: z.boolean(),
});

export const dashConfigSchema = z.object({
  $comment: z.string().optional(),
  mode: z.literal("SIMULATED"),
  instruments: z.array(instrumentSchema).min(1),
  session: z.object({ timezone: z.literal("America/Sao_Paulo"), open: time, lastEntry: time, flatBy: time, verified: z.boolean() }),
  risk: z.object({
    maxContracts: z.number().int().min(1).max(10),
    maxTradesPerDay: z.number().int().min(0).max(50),
    maxOpenPositions: z.number().int().min(0).max(5),
    maxLossPerTrade: money,
    maxLossPerDay: money,
    maxExposure: money,
    /** Every order needs a stop accepted by the broker; this cannot be switched off. */
    stopRequired: z.literal(true),
  }),
  costs: z.object({ brokeragePerContract: z.number().min(0).nullable(), exchangeFeesPerContract: z.number().min(0).nullable(), slippageTicks: z.number().min(0), verified: z.boolean() }),
  tax: z.object({ dayTradeRate: z.number().min(0).max(1), withholdingRate: z.number().min(0).max(1), darfCode: z.string(), note: z.string() }),
  data: z.object({ maxDelayMs: z.number().int().positive(), staleAfterMs: z.number().int().positive() }),
  gateway: z.object({ providerId: z.string().min(1), note: z.string().optional() }),
  strategy: z.object({ id: z.string().nullable(), version: z.string().nullable(), approved: z.boolean() }),
}).superRefine((c, ctx) => {
  const { maxLossPerTrade, maxLossPerDay } = c.risk;
  if (maxLossPerTrade !== null && maxLossPerDay !== null && maxLossPerTrade > maxLossPerDay)
    ctx.addIssue({ code: "custom", path: ["risk", "maxLossPerTrade"], message: "A perda máxima por operação não pode passar a perda máxima do dia." });
  if (!c.instruments.some((i) => i.enabled)) ctx.addIssue({ code: "custom", path: ["instruments"], message: "Pelo menos um instrumento precisa estar habilitado." });
});
export type DashConfig = z.infer<typeof dashConfigSchema>;

/** What is still missing before the desks may work, in plain words (empty: ready to simulate). */
export function readiness(config: DashConfig): string[] {
  const missing: string[] = [];
  for (const i of config.instruments.filter((x) => x.enabled)) {
    if (!i.symbol) missing.push(`${i.id}: símbolo do contrato vigente`);
    if (i.tickSize === null || i.pointValue === null) missing.push(`${i.id}: tamanho do tick e valor do ponto`);
    if (i.marginPerContract === null) missing.push(`${i.id}: margem por contrato`);
    if (!i.verified) missing.push(`${i.id}: especificação conferida em fonte oficial`);
  }
  if (!config.session.open || !config.session.lastEntry || !config.session.flatBy || !config.session.verified) missing.push("Horários da sessão (abertura, última entrada, zeragem) conferidos");
  if (config.risk.maxLossPerTrade === null) missing.push("Perda máxima por operação");
  if (config.risk.maxLossPerDay === null) missing.push("Perda máxima do dia");
  if (config.risk.maxExposure === null) missing.push("Exposição máxima");
  if (config.costs.brokeragePerContract === null || config.costs.exchangeFeesPerContract === null || !config.costs.verified) missing.push("Custos por contrato (corretagem e emolumentos) conferidos na nota");
  if (!config.strategy.id || !config.strategy.version || !config.strategy.approved) missing.push("Estratégia versionada e aprovada em backtest e simulação");
  return missing;
}

/** The risk limits the analysis room uses (agents.ts RiskLimits), or null while any is missing. */
export function roomLimits(config: DashConfig) {
  const { maxLossPerTrade, maxLossPerDay, maxExposure, maxOpenPositions } = config.risk;
  if (maxLossPerTrade === null || maxLossPerDay === null || maxExposure === null) return null;
  return { maxLossPerTrade, maxLossPerDay, maxOpenPositions, maxExposure };
}

/** Day-trade tax on a month's net result (simulated results never count; a loss carries no tax). */
export function dayTradeTax(config: DashConfig, monthNet: number) {
  const due = monthNet > 0 ? monthNet * config.tax.dayTradeRate : 0;
  return { due: Math.round(due * 100) / 100, darfCode: config.tax.darfCode };
}

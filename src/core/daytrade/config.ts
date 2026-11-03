import { z } from "zod";
import { winSessionClose } from "@/core/daytrade/market-hours";

/**
 * The DASH settings file (config/daytrade.json; owner, 01/11/2026: "já deixa as configurações no
 * arquivo"). Contract specs, session hours, costs and money limits stay null until they come from
 * official B3/Genial sources or the broker note (docs/daytrade/ARQUITETURA.md: "não codificar valores
 * de suposição como fatos"); `readiness` lists what is missing, and while anything needed is
 * missing the desks stay idle. LIVE mode is not accepted by this version at all. Pure; no I/O.
 */
const money = z.number().positive().nullable();
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable();
const officialB3Source = z.string().url().refine((value) => {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "b3.com.br" || hostname.endsWith(".b3.com.br");
}, "A fonte oficial do contrato precisa estar em um domínio da B3.");

/** Account-specific values entered by the owner from current Genial documents. */
export const ownerExecutionSettingsSchema = z.object({
  /** Capital explicitly reserved by the owner for the isolated DASH paper office. */
  capitalBudget: money.default(null),
  marginPerContract: money,
  brokeragePerContract: z.number().min(0).nullable(),
  exchangeFeesPerContract: z.number().min(0).nullable(),
  /** Owner-selected paper assumption; this is not claimed to be measured broker slippage. */
  slippageTicks: z.number().int().min(1).max(20).nullable(),
  maxLossPerTrade: money,
  maxLossPerDay: money,
  maxExposure: money,
  lastEntry: time,
  flatBy: time,
  sourceNote: z.string().trim().max(240),
  confirmSource: z.boolean(),
}).strict().superRefine((settings, ctx) => {
  if (settings.maxLossPerTrade !== null && settings.maxLossPerDay !== null && settings.maxLossPerTrade > settings.maxLossPerDay)
    ctx.addIssue({ code: "custom", path: ["maxLossPerTrade"], message: "A perda por operação não pode exceder a perda diária." });
  if (settings.capitalBudget !== null && settings.maxExposure !== null && settings.maxExposure > settings.capitalBudget)
    ctx.addIssue({ code: "custom", path: ["maxExposure"], message: "Exposicao maxima do DASH maior que o orcamento reservado ao escritorio." });
  if (settings.confirmSource && (
    settings.capitalBudget === null ||
    settings.marginPerContract === null || settings.brokeragePerContract === null || settings.exchangeFeesPerContract === null ||
    settings.slippageTicks === null ||
    settings.maxLossPerTrade === null || settings.maxLossPerDay === null || settings.maxExposure === null ||
    settings.lastEntry === null || settings.flatBy === null || settings.sourceNote.trim().length < 8
  )) ctx.addIssue({ code: "custom", path: ["confirmSource"], message: "Para confirmar, preencha margem, custos, limites, horários e a fonte documental." });
  if (settings.lastEntry && settings.flatBy && settings.lastEntry >= settings.flatBy)
    ctx.addIssue({ code: "custom", path: ["flatBy"], message: "A zeragem precisa ser posterior à última entrada." });
});
export type OwnerExecutionSettings = z.infer<typeof ownerExecutionSettingsSchema>;

export const instrumentSchema = z.object({
  id: z.enum(["WIN", "WDO"]),
  name: z.string().min(1),
  enabled: z.boolean(),
  /** The tradable contract's symbol at the broker (the current series), not a continuous series. */
  symbol: z.string().regex(/^[A-Z0-9$]{3,12}$/).nullable(),
  expiresOn: z.string().date().nullable().optional(),
  /** Official listing calendar for the configured expiry date. */
  expirySource: officialB3Source.optional(),
  tickSize: money,
  pointValue: money,
  marginPerContract: money,
  verified: z.boolean(),
  specificationSource: officialB3Source.optional(),
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
    /** Owner-assigned DASH paper capital; never drawn from the dividends office. */
    capitalBudget: money.default(null),
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
  if (c.data.maxDelayMs > c.data.staleAfterMs)
    ctx.addIssue({ code: "custom", path: ["data", "maxDelayMs"], message: "Maximum accepted feed delay cannot exceed the staleness limit." });
  if (c.risk.capitalBudget !== null && c.risk.maxExposure !== null && c.risk.maxExposure > c.risk.capitalBudget)
    ctx.addIssue({ code: "custom", path: ["risk", "maxExposure"], message: "DASH exposure cannot exceed the office's dedicated capital budget." });
  if (!c.instruments.some((i) => i.enabled)) ctx.addIssue({ code: "custom", path: ["instruments"], message: "Pelo menos um instrumento precisa estar habilitado." });
});
export type DashConfig = z.infer<typeof dashConfigSchema>;

/** What is still missing before the desks may work, in plain words (empty: ready to simulate). */
export function readiness(config: DashConfig, requireApprovedStrategy = true): string[] {
  const missing: string[] = [];
  for (const i of config.instruments.filter((x) => x.enabled)) {
    if (!i.symbol) missing.push(`${i.id}: símbolo do contrato vigente`);
    if (i.tickSize === null || i.pointValue === null) missing.push(`${i.id}: tamanho do tick e valor do ponto`);
    if (i.marginPerContract === null) missing.push(`${i.id}: margem por contrato`);
    if (i.expiresOn && new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()) > i.expiresOn) missing.push(`${i.id}: contract expired; update the active contract symbol`);
    if (i.expiresOn && !i.expirySource) missing.push(`${i.id}: vencimento do contrato sem confirmação no calendário oficial`);
    if (!i.verified) missing.push(`${i.id}: especificação conferida em fonte oficial`);
  }
  if (!config.session.open || !config.session.lastEntry || !config.session.flatBy || !config.session.verified) missing.push("Horários da sessão (abertura, última entrada, zeragem) conferidos");
  if (config.risk.maxLossPerTrade === null) missing.push("Perda máxima por operação");
  if (config.risk.maxLossPerDay === null) missing.push("Perda máxima do dia");
  if (config.risk.maxExposure === null) missing.push("Exposição máxima");
  if (config.risk.capitalBudget === null) missing.push("Orcamento de capital paper reservado exclusivamente ao DASH");
  if (config.risk.capitalBudget !== null && config.risk.maxExposure !== null && config.risk.maxExposure > config.risk.capitalBudget)
    missing.push("Exposicao maxima maior que o orcamento paper do DASH");
  if (config.costs.brokeragePerContract === null || config.costs.exchangeFeesPerContract === null || !config.costs.verified) missing.push("Custos por contrato e slippage modelado confirmados (corretagem, emolumentos e ticks adversos por fill)");
  if (requireApprovedStrategy && (!config.strategy.id || !config.strategy.version || !config.strategy.approved)) missing.push("Estrategia versionada e aprovada em backtest e simulacao");
  return missing;
}

/** Forward simulation needs verified instrument/risk/cost/session facts but not a live-approved strategy. */
export function paperReadiness(config: DashConfig, expiresOn = config.instruments.find((instrument) => instrument.enabled)?.expiresOn ?? null): string[] {
  // Paper tests an unapproved research candidate; strategy approval is a later gate.
  const missing = readiness(config, false);
  if (config.risk.maxTradesPerDay < 1) missing.push("Limite de operações diárias zerado; entradas paper desativadas");
  if (config.risk.maxOpenPositions < 1) missing.push("Limite de posições abertas zerado; entradas paper desativadas");
  if (config.risk.maxExposure !== null) {
    for (const instrument of config.instruments.filter((item) => item.enabled)) {
      if (instrument.marginPerContract !== null && config.risk.maxExposure < instrument.marginPerContract)
        missing.push(`${instrument.id}: exposição máxima inferior à margem de um contrato; entradas paper desativadas`);
    }
  }
  if (config.session.open !== "09:00") missing.push("Horário de abertura compatível com a faixa inicial da estratégia (09:00)");
  if (config.risk.capitalBudget !== null) {
    for (const instrument of config.instruments.filter((item) => item.enabled)) {
      if (instrument.marginPerContract !== null && config.risk.capitalBudget < instrument.marginPerContract)
        missing.push(`${instrument.id}: orcamento DASH inferior a margem de um contrato; entradas paper desativadas`);
    }
  }
  if (config.session.open && config.session.lastEntry && config.session.flatBy &&
    !(config.session.open < config.session.lastEntry && config.session.lastEntry < config.session.flatBy))
    missing.push("Última entrada e zeragem precisam estar em ordem após a abertura");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const officialClose = winSessionClose(today, expiresOn);
  if (config.session.flatBy && config.session.flatBy >= officialClose)
    missing.push(`Zeragem precisa ocorrer antes do encerramento dos futuros WIN as ${officialClose}`);
  return missing;
}

/** The risk limits the analysis room uses (agents.ts RiskLimits), or null while any is missing. */
export function roomLimits(config: DashConfig) {
  const { maxLossPerTrade, maxLossPerDay, maxExposure, maxOpenPositions, capitalBudget } = config.risk;
  const instrument = config.instruments.find((item) => item.enabled);
  const { brokeragePerContract, exchangeFeesPerContract, verified: costsVerified, slippageTicks } = config.costs;
  if (maxLossPerTrade === null || maxLossPerDay === null || maxExposure === null || capitalBudget === null || !instrument?.verified ||
    maxExposure > capitalBudget ||
    instrument.marginPerContract === null || instrument.pointValue === null || instrument.tickSize === null ||
    brokeragePerContract === null || exchangeFeesPerContract === null || !costsVerified) return null;
  return {
    maxLossPerTrade, maxLossPerDay, maxOpenPositions, maxExposure, capitalBudget,
    maxContracts: config.risk.maxContracts, marginPerContract: instrument.marginPerContract,
    pointValue: instrument.pointValue, tickSize: instrument.tickSize,
    costPerSide: brokeragePerContract + exchangeFeesPerContract, slippageTicks,
  };
}

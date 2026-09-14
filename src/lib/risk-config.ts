import { z } from "zod";
const amount = z.string().regex(/^(0|[1-9]\d{0,11})(\.\d{1,2})?$/);
const positive = amount.refine(
  (v) => Number(v) > 0,
  "Informe um limite maior que zero.",
);
const basisPoints = amount.refine(
  (v) => Number(v) <= 10000,
  "Máximo de 10.000 pontos-base.",
);
export const riskConfigSchema = z
  .object({
    name: z.string().trim().min(2).max(80),
    limits: z
      .object({
        maxPositionPerAgent: positive,
        maxPortfolioExposure: positive,
        maxOrderValue: positive,
        maxDailyLoss: positive,
        maxWeeklyLoss: positive,
        maxDrawdownBps: basisPoints.refine((v) => Number(v) > 0),
        minCashReserve: amount,
        maxOpenPositions: z.number().int().positive().max(1000),
        maxSectorExposure: positive,
        maxCorrelatedExposure: positive,
        maxOrdersPerMinute: z.number().int().positive().max(1000),
        maxOrdersPerDay: z.number().int().positive().max(10000),
        maxSlippageBps: basisPoints,
        newsEmergencyThreshold: z
          .string()
          .regex(/^(0\.\d{1,4}|1(\.0{1,4})?)$/)
          .refine((v) => Number(v) > 0),
        maxQuoteAgeMs: z.number().int().positive().max(60000),
        maxBrokerSnapshotAgeMs: z.number().int().positive().max(60000),
        maxClockSkewMs: z.number().int().nonnegative().max(5000),
      })
      .strict(),
  })
  .strict();

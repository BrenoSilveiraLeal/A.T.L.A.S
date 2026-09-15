import { z } from "zod";

// This is an observation engine, never a strategy certified to execute trades.
export const observationDefinitionSchema = z
  .object({
    engine: z.literal("sma-observation/1.0.0"),
    mode: z.literal("OBSERVE_ONLY"),
    fastPeriod: z.literal(20),
    slowPeriod: z.literal(50),
  })
  .strict();

export const OBSERVATION_DEFINITION = observationDefinitionSchema.parse({
  engine: "sma-observation/1.0.0",
  mode: "OBSERVE_ONLY",
  fastPeriod: 20,
  slowPeriod: 50,
});

export const strategyPublishSchema = z
  .object({
    strategyId: z.uuid().nullable().default(null),
    name: z.string().trim().min(2).max(80),
    description: z.string().trim().max(1000),
    definition: observationDefinitionSchema,
  })
  .strict();

export const agentConfigurationSchema = z
  .object({
    agentId: z.uuid(),
    versionId: z.uuid(),
    riskProfileId: z.uuid(),
    interval: z.number().int().min(300).max(86400),
  })
  .strict();

export type ObservationDefinition = z.infer<typeof observationDefinitionSchema>;
export type AgentConfigurationInput = z.infer<typeof agentConfigurationSchema>;

export const observationEvidenceSchema = z
  .object({
    strategyId: z.uuid(),
    versionId: z.uuid(),
    version: z.string().regex(/^[1-9]\d{0,8}$/),
    definition: observationDefinitionSchema,
    riskProfileId: z.uuid(),
    riskProfileVersion: z.number().int().positive(),
    riskLimits: z.record(z.string(), z.unknown()),
  })
  .strict();

export type ObservationConfiguration = z.infer<typeof observationEvidenceSchema>;

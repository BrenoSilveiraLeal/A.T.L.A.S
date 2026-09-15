import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  agentConfigurationSchema,
  observationDefinitionSchema,
  observationEvidenceSchema,
  strategyPublishSchema,
  type ObservationConfiguration,
} from "@/core/strategy-config";
import { ApiError } from "./auth";
import { adminClient } from "./supabase";
import { riskConfigSchema } from "./risk-config";

const configurationErrors: Record<string, [number, string]> = {
  ATLAS_AGENT_BUSY: [409, "A análise está em andamento. Aguarde a conclusão antes de alterar a configuração."],
  ATLAS_PAUSE_AGENT_FIRST: [409, "Pause o agente antes de alterar sua estratégia ou seus limites."],
  ATLAS_AGENT_RETIRED: [409, "Este agente está encerrado e não pode ser reconfigurado."],
  ATLAS_AGENT_NOT_FOUND: [404, "Agente não encontrado."],
  ATLAS_STRATEGY_NOT_FOUND: [404, "Estratégia não encontrada."],
  ATLAS_INVALID_OBSERVATION_VERSION: [400, "Selecione uma versão compatível com a observação SMA20/50."],
  ATLAS_RISK_PROFILE_NOT_CONFIGURED: [400, "Selecione um perfil de risco completo antes de salvar."],
  ATLAS_ASSET_INACTIVE: [409, "O ativo está inativo. Ative seu cadastro antes de configurar o agente."],
};

function throwConfigurationError(error: { message: string }): never {
  for (const [code, [status, message]] of Object.entries(configurationErrors)) {
    if (error.message.includes(code)) throw new ApiError(status, code, message);
  }
  throw error;
}

// Call only after requireOwner() has confirmed the owner's AAL2 session.
export async function publishObservationStrategy(ownerId: string, body: unknown) {
  const input = strategyPublishSchema.parse(body);
  const { data, error } = await adminClient().rpc("publish_observation_strategy", {
    p_owner_id: z.uuid().parse(ownerId),
    p_strategy_id: input.strategyId,
    p_name: input.name,
    p_description: input.description,
    p_definition: input.definition,
  });
  if (error) throwConfigurationError(error);
  return data;
}

// Pausing is enforced again by the database while holding the agent's row lock.
export async function configureAgent(ownerId: string, body: unknown) {
  const input = agentConfigurationSchema.parse(body);
  const db = adminClient();
  const { data: profile, error: profileError } = await db
    .from("risk_profiles")
    .select("name,limits,configured")
    .eq("id", input.riskProfileId)
    .eq("owner_id", z.uuid().parse(ownerId))
    .maybeSingle();
  if (profileError) throw profileError;
  if (!profile?.configured || !riskConfigSchema.safeParse({ name: profile.name, limits: profile.limits }).success) {
    throw new ApiError(400, "ATLAS_RISK_PROFILE_NOT_CONFIGURED", "Selecione um perfil de risco completo antes de salvar.");
  }
  const { data, error } = await db.rpc("configure_agent_observation", {
    p_owner_id: ownerId,
    p_agent_id: input.agentId,
    p_version_id: input.versionId,
    p_risk_profile_id: input.riskProfileId,
    p_interval_seconds: input.interval,
  });
  if (error) throwConfigurationError(error);
  return data;
}

// Null identifies the documented legacy observer. A partial/unknown configuration
// always fails instead of silently reverting to another strategy or risk profile.
export async function loadAgentObservationConfiguration(
  db: SupabaseClient,
  ownerId: string,
  agentId: string,
): Promise<ObservationConfiguration | null> {
  const { data: agent, error } = await db
    .from("agents")
    .select("strategy_id,strategy_version_id,risk_profile_id")
    .eq("id", z.uuid().parse(agentId))
    .eq("owner_id", z.uuid().parse(ownerId))
    .single();
  if (error) throw error;
  if (!agent.strategy_id && !agent.strategy_version_id && !agent.risk_profile_id) return null;
  if (!agent.strategy_id || !agent.strategy_version_id || !agent.risk_profile_id) throw new Error("ATLAS_AGENT_CONFIGURATION_INCOMPLETE");
  const [version, profile] = await Promise.all([
    db.from("strategy_versions").select("id,strategy_id,version,definition")
      .eq("id", agent.strategy_version_id).eq("owner_id", ownerId).eq("strategy_id", agent.strategy_id).single(),
    db.from("risk_profiles").select("id,name,version,limits,configured")
      .eq("id", agent.risk_profile_id).eq("owner_id", ownerId).single(),
  ]);
  if (version.error) throw version.error;
  if (profile.error) throw profile.error;
  observationDefinitionSchema.parse(version.data.definition);
  if (!profile.data.configured) throw new Error("ATLAS_RISK_PROFILE_NOT_CONFIGURED");
  const risk = riskConfigSchema.parse({ name: profile.data.name, limits: profile.data.limits });
  return observationEvidenceSchema.parse({
    strategyId: version.data.strategy_id,
    versionId: version.data.id,
    version: version.data.version,
    definition: version.data.definition,
    riskProfileId: profile.data.id,
    riskProfileVersion: profile.data.version,
    riskLimits: risk.limits,
  });
}

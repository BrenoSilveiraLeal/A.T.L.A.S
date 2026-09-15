"use client";

import { useId, useState } from "react";
import Link from "next/link";
import {
  OBSERVATION_DEFINITION,
  observationDefinitionSchema,
} from "@/core/strategy-config";

type RecordRow = Record<string, unknown>;
const value = (row: RecordRow, key: string) =>
  typeof row[key] === "string" ? row[key] : "";

export function AgentConfigForm({
  agents,
  strategies,
  versions,
  riskProfiles,
  initialAgentId,
  enabled,
  busy,
  save,
}: {
  agents: RecordRow[];
  strategies: RecordRow[];
  versions: RecordRow[];
  riskProfiles: RecordRow[];
  initialAgentId?: string;
  enabled: boolean;
  busy: boolean;
  save: (path: string, body: object) => Promise<void>;
}) {
  const hintId = useId();
  const [selectedAgentId, setSelectedAgentId] = useState(initialAgentId ?? "");
  const selectedAgent = agents.find((agent) => value(agent, "id") === selectedAgentId);
  const availableVersions = versions.filter((version) => observationDefinitionSchema.safeParse(version.definition).success);
  const configuredProfiles = riskProfiles.filter((profile) => profile.configured === true);
  const strategyName = (strategyId: string) =>
    value(strategies.find((strategy) => value(strategy, "id") === strategyId) ?? {}, "name") || "Estratégia de observação";
  const canConfigure = enabled && !busy && selectedAgent?.enabled === false &&
    !["FIRED", "DEAD"].includes(value(selectedAgent, "status")) &&
    availableVersions.length > 0 && configuredProfiles.length > 0;

  return (
    <>
      <section className="panel form-panel">
        <h2>Estratégias de observação</h2>
        <p id={hintId}>
          O motor disponível compara SMA20 e SMA50 e registra decisões HOLD.
          Cada revisão preserva sua definição. A validação para negociação real
          permanece pendente.
        </p>
        <form className="form-grid" aria-describedby={hintId} onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save("strategies", {
            strategyId: form.get("strategyId") || null,
            name: form.get("name"),
            description: form.get("description"),
            definition: OBSERVATION_DEFINITION,
          });
        }}>
          <label>
            Publicar em
            <select name="strategyId" defaultValue="">
              <option value="">Nova estratégia</option>
              {strategies.map((strategy) => <option key={value(strategy, "id")} value={value(strategy, "id")}>{value(strategy, "name")}</option>)}
            </select>
          </label>
          <label>
            Nome da estratégia
            <input name="name" minLength={2} maxLength={80} required />
          </label>
          <label>
            Objetivo desta revisão
            <input name="description" maxLength={1000} required />
          </label>
          <label>
            Motor de observação
            <input value="SMA20 / SMA50 · somente HOLD" readOnly />
          </label>
          <button disabled={!enabled || busy}>{busy ? "Salvando…" : "Publicar revisão de observação"}</button>
        </form>
      </section>

      <section className="panel form-panel">
        <h2>Configuração do agente</h2>
        <p>
          Pause o agente para escolher uma revisão e um perfil de risco.
          O histórico mantém os limites utilizados em cada análise.
        </p>
        {!agents.length && <p>Cadastre um ativo e crie um agente para vinculá-los aqui.</p>}
        {!availableVersions.length && <p>Publique uma revisão de observação no formulário acima.</p>}
        {!configuredProfiles.length && <p>Crie primeiro um perfil completo em <Link href="/app/risk">Risco e limites</Link>.</p>}
        <form className="form-grid" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void save("agent-config", {
            agentId: selectedAgentId,
            versionId: form.get("versionId"),
            riskProfileId: form.get("riskProfileId"),
            interval: Number(form.get("interval")),
          });
        }}>
          <label>
            Agente
            <select value={selectedAgentId} onChange={(event) => setSelectedAgentId(event.target.value)} required>
              <option value="">Selecione um agente</option>
              {agents.map((agent) => <option key={value(agent, "id")} value={value(agent, "id")}>{value(agent, "name")}{agent.enabled === true ? " · pause para configurar" : ""}</option>)}
            </select>
          </label>
          <label>
            Revisão de observação
            <select key={`version:${selectedAgentId}`} name="versionId" defaultValue={selectedAgent ? value(selectedAgent, "strategy_version_id") : ""} required>
              <option value="">Selecione uma revisão</option>
              {availableVersions.map((version) => <option key={value(version, "id")} value={value(version, "id")}>{strategyName(value(version, "strategy_id"))} · revisão {String(version.version ?? "—")}</option>)}
            </select>
          </label>
          <label>
            Perfil de risco
            <select key={`risk:${selectedAgentId}`} name="riskProfileId" defaultValue={selectedAgent ? value(selectedAgent, "risk_profile_id") : ""} required>
              <option value="">Selecione um perfil</option>
              {configuredProfiles.map((profile) => <option key={value(profile, "id")} value={value(profile, "id")}>{value(profile, "name")}</option>)}
            </select>
          </label>
          <label>
            Intervalo entre análises (segundos)
            <input key={`interval:${selectedAgentId}`} name="interval" type="number" min={300} max={86400} step={1} defaultValue={selectedAgent && typeof selectedAgent.analysis_interval_seconds === "number" ? selectedAgent.analysis_interval_seconds : 900} required />
            <small>Mínimo de 300 segundos. O scheduler também respeita a cota de dados.</small>
          </label>
          <button disabled={!canConfigure}>{busy ? "Salvando…" : "Salvar configuração do agente"}</button>
        </form>
      </section>
    </>
  );
}

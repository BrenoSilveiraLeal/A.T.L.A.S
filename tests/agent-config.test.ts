import { PGlite } from "@electric-sql/pglite";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  agentConfigurationSchema,
  observationDefinitionSchema,
  OBSERVATION_DEFINITION,
  strategyPublishSchema,
} from "@/core/strategy-config";
import { analyzeAsset } from "@/core/analysis";
import { riskConfigSchema } from "@/lib/risk-config";
import type { MarketHistory, MarketQuote } from "@/providers/types";

const owner = "11000000-0000-4000-8000-000000000001";
const other = "11000000-0000-4000-8000-000000000002";
const asset = "22000000-0000-4000-8000-000000000001";
const otherAsset = "22000000-0000-4000-8000-000000000002";
const limits = {
  maxPositionPerAgent: "1000", maxPortfolioExposure: "2000", maxOrderValue: "500",
  maxDailyLoss: "100", maxWeeklyLoss: "200", maxDrawdownBps: "500", minCashReserve: "100",
  maxOpenPositions: 2, maxSectorExposure: "1000", maxCorrelatedExposure: "1000",
  maxOrdersPerMinute: 1, maxOrdersPerDay: 4, maxSlippageBps: "5", newsEmergencyThreshold: "0.8",
  maxQuoteAgeMs: 1000, maxBrokerSnapshotAgeMs: 1000, maxClockSkewMs: 100,
};

describe("observation configuration input", () => {
  it("accepts a named observer without certifying or changing its engine", () => {
    expect(strategyPublishSchema.parse({ name: "  Revisão de fechamento  ", description: "Observar tendência", definition: OBSERVATION_DEFINITION }))
      .toMatchObject({ name: "Revisão de fechamento", strategyId: null });
  });
  it.each([
    { ...OBSERVATION_DEFINITION, mode: "LIVE" },
    { ...OBSERVATION_DEFINITION, fastPeriod: 10 },
    { ...OBSERVATION_DEFINITION, engine: "unknown/2.0" },
    { ...OBSERVATION_DEFINITION, approved: true },
  ])("rejects unsupported or trading definitions %#", (definition) => {
    expect(observationDefinitionSchema.safeParse(definition).success).toBe(false);
  });
  it.each([0, 299, 86401, 300.5, "900"])("rejects an invalid analysis interval %s", (interval) => {
    expect(agentConfigurationSchema.safeParse({ agentId: owner, versionId: owner, riskProfileId: owner, interval }).success).toBe(false);
  });
  it("rejects attempted owner and live flags injected into the input", () => {
    expect(agentConfigurationSchema.safeParse({ agentId: owner, versionId: owner, riskProfileId: owner, interval: 900, ownerId: other }).success).toBe(false);
    expect(strategyPublishSchema.safeParse({ name: "Observer", description: "", definition: OBSERVATION_DEFINITION, live: true }).success).toBe(false);
  });
});

describe("PostgreSQL agent configuration", () => {
  let db: PGlite;
  let agentId: string;
  let profileId: string;
  async function publish(strategyId: string | null = null) {
    const result = await db.query<{ id: string; strategy_id: string; version: string; definition: object; research_status: string }>(
      "select * from public.publish_observation_strategy($1,'Observer fixture','Fechamento diário',$2::jsonb,$3)",
      [owner, JSON.stringify(OBSERVATION_DEFINITION), strategyId],
    );
    return result.rows[0];
  }
  async function configure(versionId: string, risk = profileId, agent = agentId) {
    return db.query<{ strategy_version_id: string; enabled: boolean; status: string }>(
      "select * from public.configure_agent_observation($1,$2,$3,$4,900)", [owner, agent, versionId, risk],
    );
  }
  async function rejected(sql: string, params: unknown[], error: string) {
    await db.exec("savepoint expect_failure");
    try { await expect(db.query(sql, params)).rejects.toThrow(error); }
    finally { await db.exec("rollback to savepoint expect_failure; release savepoint expect_failure"); }
  }
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create role service_role nologin bypassrls;
      grant usage on schema public to anon,authenticated,service_role;
      create schema auth;
      create table auth.users(id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable as
        'select coalesce(nullif(current_setting(''request.jwt.claims'',true),''''),''{}'')::jsonb';
      create function auth.uid() returns uuid language sql stable as 'select (auth.jwt()->>''sub'')::uuid';
      grant usage on schema auth to anon,authenticated,service_role;
      grant execute on all functions in schema auth to anon,authenticated,service_role;
    `);
    const directory = resolve("supabase/migrations");
    for (const file of readdirSync(directory).filter((file) => file.endsWith(".sql")).sort()) {
      await db.exec(readFileSync(resolve(directory, file), "utf8"));
    }
  }, 60000);
  beforeEach(async () => {
    await db.exec("begin");
    await db.query("insert into auth.users(id) values ($1),($2)", [owner, other]);
    await db.query("insert into public.system_state(owner_id) values ($1)", [owner]);
    await db.query("insert into public.assets(id,owner_id,ticker,company_name) values ($1,$2,'TEST3','Fixture'),($3,$4,'OTHER3','Other fixture')", [asset, owner, otherAsset, other]);
    await db.exec("set local role service_role");
    agentId = (await db.query<{ id: string }>("select id from public.create_agent($1,$2,'Fixture','atlas','0')", [owner, asset])).rows[0].id;
    profileId = (await db.query<{ id: string }>("insert into public.risk_profiles(owner_id,name,limits,configured) values ($1,'Fixture risk',$2::jsonb,true) returning id", [owner, JSON.stringify(limits)])).rows[0].id;
  });
  afterEach(async () => { await db.exec("rollback"); });
  afterAll(async () => { await db?.close(); });

  it("publishes monotonic immutable revisions and audits every publication", async () => {
    const first = await publish();
    const second = await publish(first.strategy_id);
    expect(first).toMatchObject({ version: "1", research_status: "PENDING" });
    expect(second).toMatchObject({ version: "2", strategy_id: first.strategy_id });
    expect(second.id).not.toBe(first.id);
    const audits = await db.query("select * from public.audit_logs where action='STRATEGY_VERSION_PUBLISHED'");
    expect(audits.rows).toHaveLength(2);
    await db.exec("set local role postgres");
    await rejected("update public.strategy_versions set research_status='VALIDATED' where id=$1", [first.id], "ATLAS_APPEND_ONLY");
  });
  it("pins a version and risk profile without creating cash or enabling live", async () => {
    const version = await publish();
    const result = await configure(version.id);
    expect(result.rows[0]).toMatchObject({ strategy_version_id: version.id, enabled: false, status: "PAUSED" });
    await configure(version.id);
    const audits = await db.query("select details from public.audit_logs where action='AGENT_CONFIGURATION_CHANGED'");
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]).toMatchObject({ details: { riskLimits: limits, versionId: version.id } });
    const state = await db.query("select live_trading_enabled,global_kill_switch from public.system_state");
    expect(state.rows[0]).toEqual({ live_trading_enabled: false, global_kill_switch: true });
    expect((await db.query("select * from public.ledger_entries")).rows).toHaveLength(0);
    expect((await db.query("select * from public.orders")).rows).toHaveLength(0);
  });
  it("does not move agents when a newer strategy revision is published", async () => {
    const version = await publish();
    await configure(version.id);
    await publish(version.strategy_id);
    expect((await db.query("select strategy_version_id from public.agents where id=$1", [agentId])).rows[0])
      .toEqual({ strategy_version_id: version.id });
  });
  it("rejects configuration changes while enabled or holding a worker lease", async () => {
    const version = await publish();
    await db.query("select public.update_agent_enabled($1,$2,true)", [owner, agentId]);
    await rejected("select public.configure_agent_observation($1,$2,$3,$4,900)", [owner, agentId, version.id, profileId], "ATLAS_PAUSE_AGENT_FIRST");
    await db.query("select * from public.claim_due_agents($1)", [owner]);
    await rejected("select public.configure_agent_observation($1,$2,$3,$4,900)", [owner, agentId, version.id, profileId], "ATLAS_AGENT_BUSY");
  });
  it("rejects inactive assets and incomplete risk profiles", async () => {
    const version = await publish();
    const incomplete = (await db.query<{ id: string }>("insert into public.risk_profiles(owner_id,name) values ($1,'Incomplete') returning id", [owner])).rows[0].id;
    await rejected("select public.configure_agent_observation($1,$2,$3,$4,900)", [owner, agentId, version.id, incomplete], "ATLAS_RISK_PROFILE_NOT_CONFIGURED");
    await db.query("update public.assets set active=false where id=$1", [asset]);
    await rejected("select public.configure_agent_observation($1,$2,$3,$4,900)", [owner, agentId, version.id, profileId], "ATLAS_ASSET_INACTIVE");
  });
  it("validates risk limits in SQL and prevents mutation of prior risk versions", async () => {
    expect(riskConfigSchema.safeParse({ name: "Fixture risk", limits }).success).toBe(true);
    for (const bad of [{}, { ...limits, maxOrderValue: "-1" }, { ...limits, maxOrdersPerDay: 0 }, { ...limits, maxQuoteAgeMs: 60001 }, { ...limits, newsEmergencyThreshold: "0" }, { ...limits, maxSlippageBps: "Infinity" }, { ...limits, extra: true }]) {
      await rejected("insert into public.risk_profiles(owner_id,name,limits,configured) values ($1,'Bad limits',$2::jsonb,true)", [owner, JSON.stringify(bad)], "risk_profiles_complete_limits");
    }
    await db.exec("set local role postgres");
    await rejected("update public.risk_profiles set limits='{}'::jsonb where id=$1", [profileId], "ATLAS_APPEND_ONLY");
  });
  it("rejects references owned by another account", async () => {
    const version = await publish();
    await db.exec("set local role postgres");
    const foreignStrategy = (await db.query<{ id: string }>("insert into public.strategies(owner_id,name) values ($1,'Foreign') returning id", [other])).rows[0].id;
    const foreignVersion = (await db.query<{ id: string }>("insert into public.strategy_versions(owner_id,strategy_id,version,definition) values ($1,$2,'1',$3::jsonb) returning id", [other, foreignStrategy, JSON.stringify(OBSERVATION_DEFINITION)])).rows[0].id;
    const foreignProfile = (await db.query<{ id: string }>("insert into public.risk_profiles(owner_id,name,limits,configured) values ($1,'Foreign risk',$2::jsonb,true) returning id", [other, JSON.stringify(limits)])).rows[0].id;
    await db.exec("set local role service_role");
    await rejected("select public.configure_agent_observation($1,$2,$3,$4,900)", [owner, agentId, foreignVersion, profileId], "ATLAS_INVALID_OBSERVATION_VERSION");
    await rejected("select public.configure_agent_observation($1,$2,$3,$4,900)", [owner, agentId, version.id, foreignProfile], "ATLAS_RISK_PROFILE_NOT_CONFIGURED");
    await rejected("select public.publish_observation_strategy($1,'Rename','',$2::jsonb,$3)", [owner, JSON.stringify(OBSERVATION_DEFINITION), foreignStrategy], "ATLAS_STRATEGY_NOT_FOUND");
  });
  it("denies direct publication and configuration RPC access to browser roles", async () => {
    const version = await publish();
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set local role ${role}`);
      await rejected("select public.publish_observation_strategy($1,'Observer','',$2::jsonb)", [owner, JSON.stringify(OBSERVATION_DEFINITION)], "permission denied");
      await rejected("select public.configure_agent_observation($1,$2,$3,$4,900)", [owner, agentId, version.id, profileId], "permission denied");
    }
  });
  it("persists exact configuration with HOLD evidence and rejects missing or altered risk limits", async () => {
    const version = await publish();
    await configure(version.id);
    await db.query("select public.update_agent_enabled($1,$2,true)", [owner, agentId]);
    const job = (await db.query<{ job_id: string; lease_token: string }>("select * from public.claim_due_agents($1)", [owner])).rows[0];
    const now = new Date().toISOString();
    const quote: MarketQuote = { ticker: "TEST3", price: "20", currency: "BRL", dataTimestamp: new Date(Date.now() - 60000).toISOString(), retrievedAt: now, source: "https://example.test/quote", feed: "DELAYED", freshness: "DELAYED", ageSeconds: 60, tradable: false };
    const history: MarketHistory = { ticker: "TEST3", interval: "1d", range: "3mo", retrievedAt: now, source: "https://example.test/history", feed: "EOD", tradable: false, bars: [] };
    const configuration = { strategyId: version.strategy_id, versionId: version.id, version: version.version, definition: OBSERVATION_DEFINITION, riskProfileId: profileId, riskProfileVersion: 1, riskLimits: limits };
    const result = analyzeAsset({ ticker: "TEST3", now, quote, history, news: [], macro: [] });
    const sql = "select public.finish_agent_analysis($1,$2,$3,$4::jsonb,$5::jsonb) as id";
    const prefix = [owner, job.job_id, job.lease_token, JSON.stringify(result)];
    await rejected(sql, [...prefix, JSON.stringify({ quote, history, news: [], macro: [] })], "ATLAS_ANALYSIS_CONFIGURATION_MISMATCH");
    await rejected(sql, [...prefix, JSON.stringify({ quote, history, configuration: { ...configuration, riskLimits: { ...limits, maxOrderValue: "999999" } } })], "ATLAS_ANALYSIS_CONFIGURATION_MISMATCH");
    const inputs = JSON.stringify({ quote, history, news: [], macro: [], configuration });
    const first = await db.query(sql, [...prefix, inputs]);
    const retry = await db.query(sql, [...prefix, inputs]);
    expect(retry.rows).toEqual(first.rows);
    expect((await db.query("select inputs->'configuration' as configuration from public.decisions")).rows[0]).toEqual({ configuration });
    expect((await db.query("select * from public.orders")).rows).toHaveLength(0);
  });
});

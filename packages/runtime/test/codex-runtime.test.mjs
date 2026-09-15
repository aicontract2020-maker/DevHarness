import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentAdapterRegistry } from "../src/agent-adapter.mjs";
import {
  CODEX_ADAPTER_ID,
  CODEX_READONLY_PROFILE_ID,
  DEFAULT_CODEX_MODEL_ID,
  DEFAULT_CODEX_ORIGIN,
  LOCAL_READONLY_ADAPTER_ID,
  defaultCodexProfile,
  prepareCodexExecutionContext,
  resolveAlignAgentSelection,
  resolveCodexExecutable,
  resolveProviderCredential
} from "../src/codex-runtime.mjs";
import { registerBuiltinAgentAdapters } from "../../../adapters/agents/index.mjs";
import { LOCAL_READONLY_ADAPTER_ID as ADAPTER_FILE_ID } from "../../../adapters/agents/local-readonly/index.mjs";

const now = "2026-09-15T16:00:00.000Z";

test("default Codex profile is read-only analysis and documents change/execute limits", () => {
  const profile = defaultCodexProfile({});
  assert.equal(profile.id, CODEX_READONLY_PROFILE_ID);
  assert.equal(profile.modelId, DEFAULT_CODEX_MODEL_ID);
  assert.deepEqual(profile.controlPlaneOrigins, [DEFAULT_CODEX_ORIGIN]);
  assert.equal(profile.template.sandbox, "read-only");
  assert.equal(profile.template.change, false);
  assert.equal(profile.template.execute, false);
  assert.deepEqual(profile.template.modes, ["analysis-plan", "analysis-synthesis", "analysis-validation"]);
});

test("provider credential is read only from env keys and never invented", () => {
  assert.equal(resolveProviderCredential({}), null);
  assert.equal(resolveProviderCredential({ HOME: "/Users/example", PATH: "/usr/bin" }), null);
  const fromPreferred = resolveProviderCredential({
    OPENAI_API_KEY: "sk-openai",
    DEVHARNESS_PROVIDER_CREDENTIAL: "sk-parent"
  });
  assert.equal(fromPreferred.key, "DEVHARNESS_PROVIDER_CREDENTIAL");
  assert.equal(fromPreferred.value, "sk-parent");
  const fromOpenAI = resolveProviderCredential({ OPENAI_API_KEY: " sk-openai " });
  assert.equal(fromOpenAI.key, "OPENAI_API_KEY");
  assert.equal(fromOpenAI.value, "sk-openai");
});

test("align agent selection prefers Codex only when executable and credential exist", async () => {
  const local = await resolveAlignAgentSelection({ environment: { PATH: "/usr/bin:/bin", DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1" } });
  assert.equal(local.agentId, LOCAL_READONLY_ADAPTER_ID);
  assert.equal(local.source, "local-readonly-fallback");

  const forcedLocal = await resolveAlignAgentSelection({
    requestedAgentId: LOCAL_READONLY_ADAPTER_ID,
    environment: { PATH: "/usr/bin:/bin", OPENAI_API_KEY: "sk-test", DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1" }
  });
  assert.equal(forcedLocal.agentId, LOCAL_READONLY_ADAPTER_ID);
  assert.equal(forcedLocal.source, "flag");

  const binRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-select-"));
  const explicit = path.join(binRoot, "codex");
  await (await import("node:fs/promises")).writeFile(explicit, "#!/bin/sh\n", { mode: 0o755 });
  const configured = await resolveAlignAgentSelection({
    environment: { DEVHARNESS_CODEX_PATH: explicit, OPENAI_API_KEY: "sk-test" }
  });
  assert.equal(configured.agentId, CODEX_ADAPTER_ID);
  assert.equal(configured.source, "configured");
  assert.equal(configured.codexReady, true);
  await rm(binRoot, { recursive: true, force: true });

  const flagged = await resolveAlignAgentSelection({
    requestedAgentId: "codex",
    environment: { PATH: "/usr/bin:/bin", DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1" }
  });
  assert.equal(flagged.agentId, CODEX_ADAPTER_ID);
  assert.equal(flagged.codexReady, false);
  assert.deepEqual(flagged.missing, ["executable", "credential"]);
});

test("registerBuiltinAgentAdapters registers Codex and local-readonly", async () => {
  assert.equal(ADAPTER_FILE_ID, LOCAL_READONLY_ADAPTER_ID);
  const registry = registerBuiltinAgentAdapters(new AgentAdapterRegistry(), {
    codex: {
      profile: defaultCodexProfile({}),
      async inspectExecutable() {
        return { path: "/opt/codex", version: "codex-cli 1.0.0", bytes: Buffer.from("codex") };
      },
      async spawnProcess() {
        return {
          completion: Promise.resolve({
            exitCode: 0,
            startedAt: now,
            completedAt: now,
            usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }
          }),
          async kill() {}
        };
      },
      async resultFileExists() { return true; }
    }
  });
  const local = await registry.probe(LOCAL_READONLY_ADAPTER_ID, { profileId: CODEX_READONLY_PROFILE_ID });
  const codex = await registry.probe(CODEX_ADAPTER_ID, { profileId: CODEX_READONLY_PROFILE_ID });
  assert.equal(local.id, LOCAL_READONLY_ADAPTER_ID);
  assert.equal(codex.id, CODEX_ADAPTER_ID);
  assert.deepEqual(local.modes, codex.modes);
  assert.deepEqual(local.features, codex.features);
});

test("prepareCodexExecutionContext starts an injected proxy and writes an output schema", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-context-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const calls = [];
  const prepared = await prepareCodexExecutionContext({
    analysisRoot: root,
    attemptRoot: path.join(root, "attempt"),
    privateHome: path.join(root, "home"),
    supervisorRoot: path.join(root, "supervisor"),
    resultPath: path.join(root, "attempt", "result.json"),
    operationId: "alignment-operation-test1",
    attemptId: "attempt-test1",
    environment: { OPENAI_API_KEY: "sk-test-credential" },
    profile: defaultCodexProfile({}),
    async startProxy(options) {
      calls.push(options);
      return { server: { close(cb) { cb?.(); } }, port: 43199, token: options.childToken, origin: "http://127.0.0.1:43199" };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parentCredential, "sk-test-credential");
  assert.equal(calls[0].exactOrigins[0], DEFAULT_CODEX_ORIGIN);
  assert.equal(prepared.context.proxy.port, 43199);
  assert.equal(prepared.context.proxy.token, calls[0].childToken);
  const schema = JSON.parse(await readFile(prepared.context.outputSchemaPath, "utf8"));
  assert.equal(schema.required.includes("phase"), true);
  assert.deepEqual(schema.properties.phase.enum, ["analysis-plan", "analysis-synthesis", "analysis-validation"]);
});

test("prepareCodexExecutionContext fails closed without a parent credential", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-auth-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(
    prepareCodexExecutionContext({
      analysisRoot: root,
      attemptRoot: path.join(root, "attempt"),
      privateHome: path.join(root, "home"),
      supervisorRoot: path.join(root, "supervisor"),
      resultPath: path.join(root, "result.json"),
      operationId: "alignment-operation-test2",
      attemptId: "attempt-test2",
      environment: { PATH: "/usr/bin:/bin", DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1" },
      async startProxy() { throw new Error("proxy must not start"); }
    }),
    (error) => error.code === "AUTH_UNAVAILABLE" && /OPENAI_API_KEY or DEVHARNESS_PROVIDER_CREDENTIAL/.test(error.message)
  );
});

test("resolveCodexExecutable honors DEVHARNESS_CODEX_PATH without reading auth files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-bin-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bin = path.join(root, "codex");
  await (await import("node:fs/promises")).writeFile(bin, "#!/bin/sh\n");
  assert.equal(await resolveCodexExecutable({ DEVHARNESS_CODEX_PATH: bin, PATH: "/usr/bin:/bin" }), bin);
  assert.equal(await resolveCodexExecutable({ PATH: "/usr/bin:/bin", HOME: root, DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1" }), null);
});

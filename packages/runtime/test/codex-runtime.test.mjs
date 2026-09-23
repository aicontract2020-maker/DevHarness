import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { AgentAdapterRegistry } from "../src/agent-adapter.mjs";
import {
  CODEX_ADAPTER_ID,
  CODEX_READONLY_PROFILE_ID,
  CHATGPT_CODEX_API_PATH_PREFIX,
  DEFAULT_CHATGPT_CODEX_ORIGIN,
  DEFAULT_CODEX_MODEL_ID,
  DEFAULT_CODEX_ORIGIN,
  LOCAL_READONLY_ADAPTER_ID,
  defaultCodexProfile,
  loadProviderCredentialFromCodexAuthFile,
  prepareCodexExecutionContext,
  resolveAlignAgentSelection,
  resolveCodexAuthFilePath,
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

test("provider credential prefers env keys and never invents values", () => {
  assert.equal(resolveProviderCredential({}), null);
  assert.equal(resolveProviderCredential({ HOME: "/Users/example-missing", PATH: "/usr/bin" }), null);
  const fromPreferred = resolveProviderCredential({
    OPENAI_API_KEY: "sk-openai",
    DEVHARNESS_PROVIDER_CREDENTIAL: "sk-parent"
  });
  assert.equal(fromPreferred.key, "DEVHARNESS_PROVIDER_CREDENTIAL");
  assert.equal(fromPreferred.value, "sk-parent");
  assert.equal(fromPreferred.source, "env");
  const fromOpenAI = resolveProviderCredential({ OPENAI_API_KEY: " sk-openai " });
  assert.equal(fromOpenAI.key, "OPENAI_API_KEY");
  assert.equal(fromOpenAI.value, "sk-openai");
  assert.equal(fromOpenAI.source, "env");
});

test("parent loads OPENAI_API_KEY from ~/.codex/auth.json when env unset and auth_mode=apikey", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-auth-home-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const authDir = path.join(home, ".codex");
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  const authPath = path.join(authDir, "auth.json");
  assert.equal(resolveCodexAuthFilePath({ HOME: home }), authPath);

  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "apikey",
    OPENAI_API_KEY: "sk-fake-from-auth-file-for-unit-test"
  }, null, 2)}\n`, { mode: 0o600 });

  const fromFile = loadProviderCredentialFromCodexAuthFile({ HOME: home });
  assert.equal(fromFile.source, "codex-auth.json");
  assert.equal(fromFile.authMode, "apikey");
  assert.equal(fromFile.key, "codex-auth.json:OPENAI_API_KEY");
  assert.equal(fromFile.value, "sk-fake-from-auth-file-for-unit-test");

  const resolved = resolveProviderCredential({ HOME: home, PATH: "/usr/bin" });
  assert.equal(resolved.value, "sk-fake-from-auth-file-for-unit-test");
  assert.equal(resolved.source, "codex-auth.json");

  // Env still wins over auth.json
  const envWins = resolveProviderCredential({
    HOME: home,
    OPENAI_API_KEY: "sk-env-wins"
  });
  assert.equal(envWins.value, "sk-env-wins");
  assert.equal(envWins.source, "env");

  // chatgpt without session tokens is ignored (even if OPENAI_API_KEY present)
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "chatgpt",
    OPENAI_API_KEY: "sk-should-ignore"
  }, null, 2)}\n`, { mode: 0o600 });
  assert.equal(loadProviderCredentialFromCodexAuthFile({ HOME: home }), null);

  // Unknown auth_mode is ignored
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "oauth",
    OPENAI_API_KEY: "sk-should-ignore"
  }, null, 2)}\n`, { mode: 0o600 });
  assert.equal(loadProviderCredentialFromCodexAuthFile({ HOME: home }), null);
  assert.equal(resolveProviderCredential({ HOME: home }), null);

  // Missing key field
  await writeFile(authPath, `${JSON.stringify({ auth_mode: "apikey" }, null, 2)}\n`, { mode: 0o600 });
  assert.equal(loadProviderCredentialFromCodexAuthFile({ HOME: home }), null);
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

test("parent loads chatgpt session tokens from ~/.codex/auth.json", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-chatgpt-auth-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const authDir = path.join(home, ".codex");
  await mkdir(authDir, { recursive: true, mode: 0o700 });
  const authPath = path.join(authDir, "auth.json");
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "fake-chatgpt-access-token-for-unit-test",
      account_id: "acct-unit-test-1234",
      refresh_token: "fake-refresh-ignored-by-loader"
    }
  }, null, 2)}\n`, { mode: 0o600 });

  const fromFile = loadProviderCredentialFromCodexAuthFile({ HOME: home });
  assert.equal(fromFile.source, "codex-auth.json");
  assert.equal(fromFile.authMode, "chatgpt");
  assert.equal(fromFile.key, "codex-auth.json:tokens.access_token");
  assert.equal(fromFile.value, "fake-chatgpt-access-token-for-unit-test");
  assert.equal(fromFile.accountId, "acct-unit-test-1234");

  const resolved = resolveProviderCredential({ HOME: home, PATH: "/usr/bin" });
  assert.equal(resolved.authMode, "chatgpt");
  assert.equal(resolved.key, "codex-auth.json:tokens.access_token");

  const profile = defaultCodexProfile({ HOME: home });
  assert.deepEqual(profile.controlPlaneOrigins, [DEFAULT_CHATGPT_CODEX_ORIGIN]);
  assert.equal(profile.apiPathPrefix, CHATGPT_CODEX_API_PATH_PREFIX);
  assert.equal(profile.authMode, "chatgpt");

  // Explicit origin still wins
  const overridden = defaultCodexProfile({ HOME: home, DEVHARNESS_CODEX_ORIGIN: "https://api.openai.com" });
  assert.deepEqual(overridden.controlPlaneOrigins, ["https://api.openai.com"]);

  // chatgpt without access_token returns null
  await writeFile(authPath, `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: { account_id: "acct-only" }
  }, null, 2)}\n`, { mode: 0o600 });
  assert.equal(loadProviderCredentialFromCodexAuthFile({ HOME: home }), null);
});

test("align agent selection picks Codex when executable and chatgpt tokens exist", async (t) => {
  const home = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-chatgpt-select-"));
  t.after(() => rm(home, { recursive: true, force: true }));
  const binRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-chatgpt-bin-"));
  t.after(() => rm(binRoot, { recursive: true, force: true }));
  const explicit = path.join(binRoot, "codex");
  await writeFile(explicit, "#!/bin/sh\n", { mode: 0o755 });
  await mkdir(path.join(home, ".codex"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(home, ".codex", "auth.json"), `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "fake-chatgpt-access-token-for-selection",
      account_id: "acct-select-1"
    }
  }, null, 2)}\n`, { mode: 0o600 });

  const configured = await resolveAlignAgentSelection({
    environment: { HOME: home, DEVHARNESS_CODEX_PATH: explicit, DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1" }
  });
  assert.equal(configured.agentId, CODEX_ADAPTER_ID);
  assert.equal(configured.source, "configured");
  assert.equal(configured.codexReady, true);
  assert.equal(configured.credentialKey, "codex-auth.json:tokens.access_token");
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
  assert.equal(prepared.context.proxy.apiPathPrefix, "/v1");
  assert.equal(calls[0].chatgptMode, false);
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

test("prepareCodexExecutionContext accepts parent credential from auth.json fallback", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-authfile-ctx-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  await mkdir(path.join(home, ".codex"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(home, ".codex", "auth.json"), `${JSON.stringify({
    auth_mode: "apikey",
    OPENAI_API_KEY: "sk-fake-authjson-parent-only"
  }, null, 2)}\n`, { mode: 0o600 });
  const calls = [];
  const prepared = await prepareCodexExecutionContext({
    analysisRoot: root,
    attemptRoot: path.join(root, "attempt"),
    privateHome: path.join(root, "private-home"),
    supervisorRoot: path.join(root, "supervisor"),
    resultPath: path.join(root, "attempt", "result.json"),
    operationId: "alignment-operation-test-authfile",
    attemptId: "attempt-authfile",
    environment: { HOME: home, PATH: "/usr/bin:/bin", DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1" },
    profile: defaultCodexProfile({}),
    async startProxy(options) {
      calls.push(options);
      return { server: { close(cb) { cb?.(); } }, port: 43201, token: options.childToken, origin: "http://127.0.0.1:43201" };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parentCredential, "sk-fake-authjson-parent-only");
  assert.equal(prepared.context.proxy.port, 43201);
});

test("prepareCodexExecutionContext wires chatgpt account id, origin, and apiPathPrefix", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-codex-chatgpt-ctx-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  await mkdir(path.join(home, ".codex"), { recursive: true, mode: 0o700 });
  await writeFile(path.join(home, ".codex", "auth.json"), `${JSON.stringify({
    auth_mode: "chatgpt",
    tokens: {
      access_token: "fake-chatgpt-access-token-for-context",
      account_id: "acct-context-9"
    }
  }, null, 2)}\n`, { mode: 0o600 });
  const calls = [];
  const prepared = await prepareCodexExecutionContext({
    analysisRoot: root,
    attemptRoot: path.join(root, "attempt"),
    privateHome: path.join(root, "private-home"),
    supervisorRoot: path.join(root, "supervisor"),
    resultPath: path.join(root, "attempt", "result.json"),
    operationId: "alignment-operation-test-chatgpt",
    attemptId: "attempt-chatgpt",
    environment: { HOME: home, PATH: "/usr/bin:/bin", DEVHARNESS_CODEX_DISABLE_WELL_KNOWN: "1" },
    async startProxy(options) {
      calls.push(options);
      return { server: { close(cb) { cb?.(); } }, port: 43211, token: options.childToken, origin: "http://127.0.0.1:43211" };
    }
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].parentCredential, "fake-chatgpt-access-token-for-context");
  assert.equal(calls[0].chatgptAccountId, "acct-context-9");
  assert.equal(calls[0].chatgptMode, true);
  assert.equal(calls[0].exactOrigins[0], DEFAULT_CHATGPT_CODEX_ORIGIN);
  assert.equal(prepared.context.proxy.apiPathPrefix, CHATGPT_CODEX_API_PATH_PREFIX);
  assert.equal(prepared.profile.authMode, "chatgpt");
});

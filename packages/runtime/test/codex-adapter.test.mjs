import assert from "node:assert/strict";
import test from "node:test";

import { createCodexAdapter } from "../../../adapters/agents/codex/index.mjs";
import { AgentAdapterRegistry } from "../src/agent-adapter.mjs";

const now = "2026-09-01T12:00:00.000Z";
const hash = "a".repeat(64);
const profile = { id: "codex-readonly-analysis-v1", modelId: "gpt-approved", controlPlaneOrigins: ["https://api.example.com"], template: { sandbox: "read-only", maxActiveSeconds: 600 } };
const invocation = { id: "invocation-1", operation_id: "operation-1", phase: "analysis-plan", adapter: { model_id: profile.modelId }, input_artifacts: [{ id: "goal-1", kind: "goal", sha256: hash }] };
const context = { analysisRoot: "/snapshot", outputSchemaPath: "/private/schema.json", resultPath: "/private/result.json", attemptTmpPath: "/private/tmp", privateHome: "/private/home", proxy: { port: 43199, token: "ephemeral-proxy-token" } };

function harness(completion = { exitCode: 0, startedAt: now, completedAt: now, usage: { input_tokens: 4, output_tokens: 2, total_tokens: 6 } }, resultExists = true) {
  const calls = { inspect: 0, spawn: [], kills: 0 };
  const handle = { completion: Promise.resolve(completion), async kill() { calls.kills += 1; } };
  const adapter = createCodexAdapter({
    profile,
    implementationBytes: Buffer.from("codex-adapter-v1"),
    async inspectExecutable() { calls.inspect += 1; return { path: "/opt/devharness/bin/codex", version: "codex-cli 1.2.3", bytes: Buffer.from("codex-executable") }; },
    async spawnProcess(request) { calls.spawn.push(request); return handle; },
    async resultFileExists() { return resultExists; }
  });
  return { adapter, calls, handle };
}

test("Codex probe reads local metadata without starting a model and returns stable digests", async () => {
  const { adapter, calls } = harness();
  const descriptor = await adapter.probe({ environment: {}, profileId: profile.id });
  assert.equal(calls.inspect, 1);
  assert.equal(calls.spawn.length, 0);
  assert.equal(descriptor.id, "codex");
  assert.equal(descriptor.profile_id, profile.id);
  assert.equal(descriptor.model_id, profile.modelId);
  assert.match(descriptor.implementation_sha256, /^[0-9a-f]{64}$/);
  assert.match(descriptor.executable_sha256, /^[0-9a-f]{64}$/);
  assert.match(descriptor.profile_template_sha256, /^[0-9a-f]{64}$/);
  assert.match(descriptor.descriptor_sha256, /^[0-9a-f]{64}$/);
});

test("Codex start uses exact argv, stdin policy, empty inheritance, and no built-in tools", async () => {
  const { adapter, calls } = harness();
  const registry = new AgentAdapterRegistry().register("codex", adapter);
  const before = structuredClone(invocation);
  const result = await registry.start("codex", { invocation, executionContext: context });
  assert.equal(result.status, "succeeded");
  assert.deepEqual(invocation, before);
  assert.equal(calls.spawn.length, 1);
  const request = calls.spawn[0];
  assert.equal(request.executable, "/opt/devharness/bin/codex");
  assert.deepEqual(request.argv, [
    "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "--strict-config",
    "--sandbox", "read-only", "--model", "gpt-approved",
    "--disable", "browser_use", "--disable", "browser_use_external", "--disable", "browser_use_full_cdp_access",
    "--disable", "computer_use", "--disable", "apps", "--disable", "multi_agent",
    "--output-schema", "/private/schema.json", "--output-last-message", "/private/result.json",
    "--json", "--cd", "/snapshot",
    "--config", 'model_provider="devharness_proxy"',
    "--config", 'model_providers.devharness_proxy={name="DevHarness Proxy",base_url="http://127.0.0.1:43199/v1",env_key="DEVHARNESS_PROXY_TOKEN",wire_api="responses"}',
    "--config", 'shell_environment_policy.inherit="none"',
    "--config", 'shell_environment_policy.set={PATH="/usr/bin:/bin",LANG="C",TMPDIR="/private/tmp"}', "-"
  ]);
  assert.deepEqual(request.env, { HOME: "/private/home", PATH: "/usr/bin:/bin", LANG: "C", TMPDIR: "/private/tmp", DEVHARNESS_PROXY_TOKEN: "ephemeral-proxy-token" });
  assert.match(request.stdin, /Original developer goal and explicit developer decisions are normative/);
  assert.match(request.stdin, /"operation_id":"operation-1"/);
  assert.equal(request.stdin.includes("ephemeral-proxy-token"), false);
});

test("missing output, abnormal exit, and timeout are normalized without promoting malformed data", async () => {
  const missing = harness(undefined, false);
  assert.deepEqual((await missing.adapter.start({ invocation, executionContext: context })).status, "failed");
  assert.equal((await missing.adapter.start({ invocation, executionContext: context })).termination_reason, "invalid-output");

  const exited = harness({ exitCode: 17, startedAt: now, completedAt: now, usage: { input_tokens: 0, output_tokens: 0, total_tokens: 0 } });
  const exitResult = await exited.adapter.start({ invocation, executionContext: context });
  assert.equal(exitResult.status, "failed");
  assert.equal(exitResult.termination_reason, "process-exit");
  assert.equal(exitResult.result_path, null);

  const timeout = harness({ exitCode: null, timedOut: true, startedAt: now, completedAt: now, usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } });
  const timedOut = await timeout.adapter.start({ invocation, executionContext: context });
  assert.equal(timedOut.status, "timed-out");
  assert.equal(timedOut.termination_reason, "timeout");
});

test("Codex cancellation is idempotent for an owned execution handle", async () => {
  const { adapter, calls, handle } = harness();
  await adapter.cancel({ executionHandle: handle, reason: "developer-cancelled" });
  await adapter.cancel({ executionHandle: handle, reason: "developer-cancelled" });
  assert.equal(calls.kills, 1);
});

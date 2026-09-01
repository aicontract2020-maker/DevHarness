import assert from "node:assert/strict";
import test from "node:test";

import { AgentAdapterError, AgentAdapterRegistry } from "../src/agent-adapter.mjs";
import { canonicalDigest } from "../src/canonical-records.mjs";

const now = "2026-09-01T12:00:00.000Z";
const hash = "a".repeat(64);

function descriptor(id = "scripted") {
  const value = {
    schema_version: 1, id, version: "1.0.0", protocol_version: 1,
    profile_id: `${id}-readonly-analysis-v1`, model_id: "approved-model", executable_version: "1.0.0",
    modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
    features: { structured_output: true, explicit_cancel: true, ephemeral_session: true, read_only_tool_policy: true, built_in_web_disable: true, trusted_usage: true },
    implementation_sha256: hash, executable_sha256: "b".repeat(64), profile_template_sha256: "c".repeat(64),
    control_plane_origins: ["https://api.example.com"], descriptor_sha256: "pending"
  };
  value.descriptor_sha256 = canonicalDigest("agent-descriptor", value, ["descriptor_sha256"]);
  return value;
}

const output = { status: "succeeded", started_at: now, completed_at: now, exit_code: 0, termination_reason: "completed", result_path: "/private/result.json", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, adapter_diagnostics: [] };

test("registry rejects missing, duplicate, and structurally invalid injected adapters", async () => {
  const registry = new AgentAdapterRegistry();
  await assert.rejects(() => registry.probe("missing", {}), (error) => error instanceof AgentAdapterError && error.code === "ADAPTER_NOT_FOUND");
  assert.throws(() => registry.register("broken", { probe() {} }), /start|cancel/);
  const adapter = { async probe() { return descriptor(); }, async start() { return output; }, async cancel() {} };
  registry.register("scripted", adapter);
  assert.throws(() => registry.register("scripted", adapter), /already registered/);
});

test("probe is model-free and verifies the complete descriptor digest", async () => {
  let starts = 0;
  const registry = new AgentAdapterRegistry();
  registry.register("scripted", { async probe() { return descriptor(); }, async start() { starts += 1; return output; }, async cancel() {} });
  const result = await registry.probe("scripted", { environment: {}, profileId: "scripted-readonly-analysis-v1" });
  assert.equal(starts, 0);
  assert.equal(result.id, "scripted");
  assert.equal(Object.isFrozen(result), true);

  const changed = descriptor();
  changed.model_id = "unapproved-drift";
  const bad = new AgentAdapterRegistry().register("scripted", { async probe() { return changed; }, async start() { return output; }, async cancel() {} });
  await assert.rejects(() => bad.probe("scripted", {}), (error) => error.code === "ADAPTER_INCOMPATIBLE" && /digest/.test(error.message));
});

test("start receives an immutable portable invocation and returns only normalized terminal output", async () => {
  const invocation = { id: "invocation-1", operation_id: "operation-1", phase: "analysis-plan", policy: { consumer: { write: false } } };
  let observed;
  const registry = new AgentAdapterRegistry().register("scripted", {
    async probe() { return descriptor(); },
    async start(input) {
      observed = input.invocation;
      assert.throws(() => { input.invocation.phase = "implementation"; }, TypeError);
      return output;
    },
    async cancel() {}
  });
  const result = await registry.start("scripted", { invocation, executionContext: { privateResultPath: "/private/result.json" }, signal: new AbortController().signal, onStatus() {} });
  assert.deepEqual(result, output);
  assert.notEqual(observed, invocation);
  assert.deepEqual(invocation, { id: "invocation-1", operation_id: "operation-1", phase: "analysis-plan", policy: { consumer: { write: false } } });

  const leaking = new AgentAdapterRegistry().register("scripted", { async probe() { return descriptor(); }, async start() { return { ...output, provider_event: "secret" }; }, async cancel() {} });
  await assert.rejects(() => leaking.start("scripted", { invocation }), (error) => error.code === "INVALID_OUTPUT");
});

test("cancel is delegated without granting the adapter Goal Run authority", async () => {
  const calls = [];
  const registry = new AgentAdapterRegistry().register("scripted", {
    async probe() { return descriptor(); }, async start() { return output; },
    async cancel(input) { calls.push(input); }
  });
  const executionHandle = Object.freeze({ id: "process-1" });
  await registry.cancel("scripted", { executionHandle, reason: "developer-cancelled" });
  assert.deepEqual(calls, [{ executionHandle, reason: "developer-cancelled" }]);
  assert.equal(Object.hasOwn(calls[0], "goalRunStore"), false);
});

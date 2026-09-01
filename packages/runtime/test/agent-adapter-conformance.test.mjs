import assert from "node:assert/strict";
import test from "node:test";

import { createCodexAdapter } from "../../../adapters/agents/codex/index.mjs";
import { AgentAdapterRegistry } from "../src/agent-adapter.mjs";
import { createScriptedAgentAdapter } from "./fixtures/scripted-agent-adapter.mjs";

const now = "2026-09-01T12:00:00.000Z";
const usage = { input_tokens: 7, output_tokens: 3, total_tokens: 10 };
const profile = { id: "readonly-analysis-v1", modelId: "gpt-approved", controlPlaneOrigins: ["https://api.example.com"], template: { sandbox: "read-only" } };
const invocation = { id: "invocation-1", operation_id: "operation-1", phase: "analysis-plan", adapter: { model_id: profile.modelId }, policy: { consumer: { write: false } } };
const context = { analysisRoot: "/snapshot", outputSchemaPath: "/private/schema.json", resultPath: "/private/result.json", attemptTmpPath: "/private/tmp", privateHome: "/private/home", proxy: { port: 43199, token: "placeholder" } };

function codex({ resultExists = true, exitCode = 0 } = {}) {
  return createCodexAdapter({
    profile: { ...profile, id: "codex-readonly-analysis-v1" },
    implementationBytes: Buffer.from("codex-adapter"),
    async inspectExecutable() { return { path: "/opt/codex", version: "1.0.0", bytes: Buffer.from("codex") }; },
    async spawnProcess() { return { completion: Promise.resolve({ exitCode, startedAt: now, completedAt: now, usage }), async kill() {} }; },
    async resultFileExists() { return resultExists; }
  });
}

test("Codex and an injected adapter satisfy the same portable descriptor and terminal semantics", async () => {
  const registry = new AgentAdapterRegistry()
    .register("codex", codex())
    .register("scripted", createScriptedAgentAdapter({ profile: { ...profile, id: "scripted-readonly-analysis-v1" }, script: { outcome: "success", now, usage, resultPath: context.resultPath } }));
  const codexDescriptor = await registry.probe("codex", { profileId: "codex-readonly-analysis-v1" });
  const scriptedDescriptor = await registry.probe("scripted", { profileId: "scripted-readonly-analysis-v1" });
  assert.deepEqual(Object.keys(codexDescriptor), Object.keys(scriptedDescriptor));
  assert.deepEqual(codexDescriptor.features, scriptedDescriptor.features);
  assert.deepEqual(codexDescriptor.modes, scriptedDescriptor.modes);
  assert.notEqual(codexDescriptor.id, scriptedDescriptor.id);
  assert.notEqual(codexDescriptor.descriptor_sha256, scriptedDescriptor.descriptor_sha256);

  const [codexOutput, scriptedOutput] = await Promise.all([
    registry.start("codex", { invocation, executionContext: context }),
    registry.start("scripted", { invocation, executionContext: context })
  ]);
  assert.deepEqual(codexOutput, scriptedOutput);
});

test("both adapters normalize missing/invalid results to the same portable failure", async () => {
  const registry = new AgentAdapterRegistry()
    .register("codex", codex({ resultExists: false }))
    .register("scripted", createScriptedAgentAdapter({ profile: { ...profile, id: "scripted-readonly-analysis-v1" }, script: { outcome: "invalid-output", now, usage } }));
  const outputs = await Promise.all([
    registry.start("codex", { invocation, executionContext: context }),
    registry.start("scripted", { invocation, executionContext: context })
  ]);
  assert.deepEqual(outputs[0], outputs[1]);
  assert.equal(outputs[0].status, "failed");
  assert.equal(outputs[0].termination_reason, "invalid-output");
  assert.deepEqual(outputs[0].adapter_diagnostics, [{ code: "INVALID_OUTPUT", summary: "The Agent did not produce its required result file." }]);
});

test("the conformance adapter receives the same immutable invocation without provider-specific additions", async () => {
  let observed;
  const adapter = createScriptedAgentAdapter({ profile: { ...profile, id: "scripted-readonly-analysis-v1" }, script: { outcome: "success", now, usage, resultPath: context.resultPath }, observe(input) { observed = input; } });
  const registry = new AgentAdapterRegistry().register("scripted", adapter);
  await registry.start("scripted", { invocation, executionContext: context });
  assert.deepEqual(observed.invocation, invocation);
  assert.equal(Object.isFrozen(observed.invocation), true);
  assert.equal(Object.hasOwn(observed.invocation, "provider"), false);
  assert.equal(Object.hasOwn(observed.invocation, "authority_to_approve"), false);
});

import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createLocalReadonlyAnalysisAdapter, LOCAL_READONLY_ADAPTER_ID } from "../../../adapters/agents/local-readonly/index.mjs";
import { AgentAdapterRegistry } from "../src/agent-adapter.mjs";

test("local readonly adapter probes and succeeds without Codex credentials", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-local-adapter-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const resultPath = path.join(root, "result.json");
  const adapter = createLocalReadonlyAnalysisAdapter({
    clock: () => new Date("2026-09-15T12:00:00.000Z")
  });
  const registry = new AgentAdapterRegistry().register(LOCAL_READONLY_ADAPTER_ID, adapter);
  const descriptor = await registry.probe(LOCAL_READONLY_ADAPTER_ID, { profileId: "codex-readonly-analysis-v1" });
  assert.equal(descriptor.id, LOCAL_READONLY_ADAPTER_ID);
  assert.equal(descriptor.profile_id, "codex-readonly-analysis-v1");
  assert.equal(descriptor.features.read_only_tool_policy, true);

  const output = await registry.start(LOCAL_READONLY_ADAPTER_ID, {
    invocation: {
      id: "invocation-1",
      operation_id: "operation-1",
      phase: "analysis-plan",
      adapter: { model_id: "local-readonly-analysis" }
    },
    executionContext: {
      analysisRoot: root,
      resultPath,
      attemptTmpPath: path.join(root, "tmp"),
      privateHome: path.join(root, "home"),
      outputSchemaPath: path.join(root, "schema.json"),
      proxy: { port: 43199, token: "placeholder" }
    }
  });
  assert.equal(output.status, "succeeded");
  assert.equal(output.termination_reason, "completed");
  assert.equal(output.result_path, resultPath);
  const body = JSON.parse(await readFile(resultPath, "utf8"));
  assert.equal(body.adapter, LOCAL_READONLY_ADAPTER_ID);
  assert.equal(body.phase, "analysis-plan");
  assert.equal(body.mode, "dogfood-local-stub");
});

test("local readonly adapter emits honest synthesis and validation artifacts", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-local-adapter-val-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const adapter = createLocalReadonlyAnalysisAdapter({
    clock: () => new Date("2026-09-15T12:00:00.000Z")
  });
  const synthesisPath = path.join(root, "synthesis.json");
  const synthesis = await adapter.start({
    invocation: {
      id: "invocation-synthesis",
      operation_id: "alignment-operation-local-1",
      phase: "analysis-synthesis",
      expected_domains: ["repository", "testing", "strategy", "runtime", "frontend", "security"]
    },
    executionContext: { resultPath: synthesisPath }
  });
  assert.equal(synthesis.status, "succeeded");
  const synthesisBody = JSON.parse(await readFile(synthesisPath, "utf8"));
  assert.equal(synthesisBody.mode, "dogfood-local-stub");
  assert.equal(synthesisBody.goal_analysis.questions.length, 0);
  assert.equal(synthesisBody.goal_analysis.acceptance_criteria.length >= 1, true);
  assert.equal(synthesisBody.goal_analysis.affected_areas.length, 9);

  const validationPath = path.join(root, "validation.json");
  const validation = await adapter.start({
    invocation: {
      id: "invocation-validation",
      operation_id: "alignment-operation-local-1",
      phase: "analysis-validation",
      expected_domains: ["repository", "testing", "strategy", "runtime", "frontend", "security"]
    },
    executionContext: { resultPath: validationPath }
  });
  assert.equal(validation.status, "succeeded");
  const validationBody = JSON.parse(await readFile(validationPath, "utf8"));
  assert.equal(validationBody.validation.producer_analysis_id, validationBody.goal_analysis.id);
  assert.notEqual(validationBody.validation.invocation_id, validationBody.goal_analysis.invocation_id);
  assert.equal(validationBody.validation.verdict, "valid");
  assert.equal(validationBody.validation.area_checks.length, 9);
});

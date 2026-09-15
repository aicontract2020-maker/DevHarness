import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { AgentAdapterRegistry } from "../src/agent-adapter.mjs";
import { macosSeatbeltProbeCodes } from "../src/macos-seatbelt.mjs";
import { runBoundedAgentWorker } from "../src/agent-worker.mjs";

const now = "2026-09-01T12:00:00.000Z";

function snapshot(root) {
  return {
    schema_version: 1,
    captured_at: now,
    repository: {
      name: "demo",
      root_uri: pathToFileURL(root).href,
      identity: "example/demo",
      git: {
        is_repository: true,
        head_sha: "a".repeat(40),
        branch: "main",
        dirty: false,
        changed_file_count: 0,
        remote_hosts: []
      }
    },
    inventory: { file_count: 0, manifests: [], lockfiles: [] },
    detected: {
      platforms: ["web"],
      languages: ["JavaScript"],
      frameworks: [],
      package_managers: [],
      services: [],
      test_tools: [],
      ci_files: [],
      deployment_files: [],
      agent_files: []
    },
    commands: [],
    environment: { example_files: [], local_files: [], declared_keys: [], locally_set_keys: [], local_files_ignored: true },
    submodules: []
  };
}

function makeRegistry({ writeConsumerMutation = false } = {}) {
  const registry = new AgentAdapterRegistry();
  registry.register("scripted", {
    async probe() {
      return {
        schema_version: 1,
        id: "scripted",
        version: "1.0.0",
        protocol_version: 1,
        profile_id: "scripted-readonly-analysis-v1",
        model_id: "gpt-approved",
        executable_version: "scripted-1.0.0",
        modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
        features: { structured_output: true, explicit_cancel: true, ephemeral_session: true, read_only_tool_policy: true, built_in_web_disable: true, trusted_usage: true },
        implementation_sha256: "a".repeat(64),
        executable_sha256: "b".repeat(64),
        profile_template_sha256: "c".repeat(64),
        control_plane_origins: ["https://api.example.com"],
        descriptor_sha256: "d".repeat(64)
      };
    },
    async start({ executionContext }) {
      if (writeConsumerMutation) {
        await writeFile(path.join(executionContext.analysisRoot, "mutated.txt"), "mutation\n");
      }
      await writeFile(executionContext.resultPath, `${JSON.stringify({ ok: true, note: "result" })}\n`);
      return {
        started_at: now,
        completed_at: now,
        exit_code: 0,
        status: "succeeded",
        termination_reason: "completed",
        result_path: executionContext.resultPath,
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        adapter_diagnostics: []
      };
    },
    async cancel() {}
  });
  return registry;
}

test("bounded worker probes isolation, preserves consumer inventory, and promotes a sanitized result", async (t) => {
  const analysisRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-worker-root-"));
  const attemptTmpPath = await mkdtemp(path.join(os.tmpdir(), "devharness-worker-attempt-"));
  const privateHome = await mkdtemp(path.join(os.tmpdir(), "devharness-worker-home-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-worker-supervisor-"));
  t.after(() => rm(analysisRoot, { recursive: true, force: true }));
  t.after(() => rm(attemptTmpPath, { recursive: true, force: true }));
  t.after(() => rm(privateHome, { recursive: true, force: true }));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  await writeFile(path.join(analysisRoot, "tracked.txt"), "tracked\n");

  const calls = [];
  const result = await runBoundedAgentWorker({
    snapshot: snapshot(analysisRoot),
    adapterRegistry: makeRegistry(),
    adapterName: "scripted",
    invocation: {
      id: "invocation-1",
      operation_id: "operation-1",
      attempt_no: 1,
      phase: "analysis-plan",
      execution_instance_id: "execution-1"
    },
    workerContext: {
      analysisRoot,
      attemptTmpPath,
      privateHome,
      supervisorRoot,
      proxy: {
        endpoint: "http://127.0.0.1:4317",
        token: "worker-secret-token",
        targetDescriptorSha256: "b".repeat(64),
        policySha256: "c".repeat(64),
        tokenId: "proxy-token-1"
      },
      resultPath: path.join(attemptTmpPath, "result.json")
    },
    probeRunner: async ({ code }) => {
      calls.push(code);
      return { status: "pass", summary: code };
    },
    resultValidator: () => true,
    cleanup: async ({ startedAt, completedAt, proofSeed }) => ({
      status: "complete",
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: 0,
      remaining_processes: 0,
      temporary_paths_remaining: 0,
      proof_sha256: "d".repeat(64)
    }),
    clock: () => new Date(now)
  });

  assert.deepEqual(calls, macosSeatbeltProbeCodes());
  assert.equal(result.attempt.status, "succeeded");
  assert.equal(result.attempt.termination_reason, "completed");
  assert.equal(result.attempt.profile_instance_sha256.length, 64);
  assert.equal(result.attempt.cleanup.status, "complete");
  assert.equal(result.attempt.result_sha256.length, 64);
  assert.equal(result.attempt.limit_observations.wall_ms >= 0, true);
  assert.equal(result.attempt.limit_observations.result_bytes > 0, true);
  assert.equal(result.attempt.limit_observations.total_tokens, 5);
  assert.equal(result.inventory.before.sha256, result.inventory.after.sha256);
  assert.equal(result.isolationProof.backend, "macos-seatbelt-v1");
});

test("bounded worker fails closed when the consumer inventory changes during execution", async (t) => {
  const analysisRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-worker-mutation-"));
  const attemptTmpPath = await mkdtemp(path.join(os.tmpdir(), "devharness-worker-mutation-attempt-"));
  const privateHome = await mkdtemp(path.join(os.tmpdir(), "devharness-worker-mutation-home-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-worker-mutation-supervisor-"));
  t.after(() => rm(analysisRoot, { recursive: true, force: true }));
  t.after(() => rm(attemptTmpPath, { recursive: true, force: true }));
  t.after(() => rm(privateHome, { recursive: true, force: true }));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  await writeFile(path.join(analysisRoot, "tracked.txt"), "tracked\n");

  const result = await runBoundedAgentWorker({
    snapshot: snapshot(analysisRoot),
    adapterRegistry: makeRegistry({ writeConsumerMutation: true }),
    adapterName: "scripted",
    invocation: {
      id: "invocation-1",
      operation_id: "operation-1",
      attempt_no: 1,
      phase: "analysis-plan",
      execution_instance_id: "execution-1"
    },
    workerContext: {
      analysisRoot,
      attemptTmpPath,
      privateHome,
      supervisorRoot,
      proxy: {
        endpoint: "http://127.0.0.1:4317",
        token: "worker-secret-token",
        targetDescriptorSha256: "b".repeat(64),
        policySha256: "c".repeat(64),
        tokenId: "proxy-token-1"
      },
      resultPath: path.join(attemptTmpPath, "result.json")
    },
    probeRunner: async () => ({ status: "pass", summary: "probe" }),
    resultValidator: () => true,
    cleanup: async ({ startedAt, completedAt, proofSeed }) => ({
      status: "complete",
      started_at: startedAt,
      completed_at: completedAt,
      duration_ms: 0,
      remaining_processes: 0,
      temporary_paths_remaining: 0,
      proof_sha256: "d".repeat(64)
    }),
    clock: () => new Date(now)
  });

  assert.equal(result.attempt.status, "failed");
  assert.equal(result.attempt.termination_reason, "integrity");
  assert.notEqual(result.inventory.before.sha256, result.inventory.after.sha256);
});

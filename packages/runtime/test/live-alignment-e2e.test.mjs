import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { runBoundedAgentWorker } from "../src/agent-worker.mjs";
import { macosSeatbeltProbeCodes } from "../src/macos-seatbelt.mjs";
import { makeLiveAlignmentFixture } from "./live-alignment-fixtures.mjs";

function snapshot(root) {
  return {
    schema_version: 1,
    captured_at: "2026-09-03T12:00:00.000Z",
    repository: {
      name: "demo",
      root_uri: pathToFileURL(root).href,
      identity: "example/project",
      git: {
        is_repository: true,
        head_sha: "b".repeat(40),
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
      frameworks: ["Next.js"],
      package_managers: [],
      services: ["PostgreSQL"],
      test_tools: ["Playwright"],
      ci_files: [],
      deployment_files: [],
      agent_files: []
    },
    commands: [],
    environment: { example_files: [], local_files: [], declared_keys: [], locally_set_keys: [], local_files_ignored: true },
    submodules: []
  };
}

function makeRegistry() {
  return {
    async start(name, { executionContext }) {
      assert.equal(name, "scripted");
      await writeFile(executionContext.resultPath, JSON.stringify({
        ok: true,
        trace: "answer -> verify -> ready"
      }));
      return {
        started_at: "2026-09-03T12:00:00.000Z",
        completed_at: "2026-09-03T12:00:05.000Z",
        exit_code: 0,
        status: "succeeded",
        termination_reason: "completed",
        result_path: executionContext.resultPath,
        usage: { input_tokens: 3, output_tokens: 2, total_tokens: 5 },
        adapter_diagnostics: []
      };
    },
    async cancel() {},
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
        features: {
          structured_output: true,
          explicit_cancel: true,
          ephemeral_session: true,
          read_only_tool_policy: true,
          built_in_web_disable: true,
          trusted_usage: true
        },
        implementation_sha256: "c".repeat(64),
        executable_sha256: "d".repeat(64),
        profile_template_sha256: "e".repeat(64),
        control_plane_origins: ["https://api.example.com"],
        descriptor_sha256: "f".repeat(64)
      };
    }
  };
}

test("fake-agent end-to-end acceptance proof preserves consumer filesystem equality", async (t) => {
  const analysisRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-e2e-root-"));
  const attemptTmpPath = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-e2e-attempt-"));
  const privateHome = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-e2e-home-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-e2e-supervisor-"));
  t.after(() => rm(analysisRoot, { recursive: true, force: true }));
  t.after(() => rm(attemptTmpPath, { recursive: true, force: true }));
  t.after(() => rm(privateHome, { recursive: true, force: true }));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  await writeFile(path.join(analysisRoot, "tracked.txt"), "tracked\n");

  const fixture = makeLiveAlignmentFixture({
    adapterId: "scripted",
    authorityId: "authority-scripted",
    answerLabel: "Scripted"
  });

  const result = await runBoundedAgentWorker({
    snapshot: snapshot(analysisRoot),
    adapterRegistry: makeRegistry(),
    adapterName: "scripted",
    invocation: {
      id: "invocation-1",
      operation_id: fixture.operation.id,
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
        targetDescriptorSha256: fixture.operation.agent_descriptor.descriptor_sha256,
        policySha256: "b".repeat(64),
        tokenId: "proxy-token-1"
      },
      resultPath: path.join(attemptTmpPath, "result.json")
    },
    probeRunner: async ({ code }) => ({ status: "pass", summary: code }),
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
    clock: () => new Date("2026-09-03T12:00:00.000Z")
  });

  assert.deepEqual(result.analysisView.policy.profile_instance_sha256.length, 64);
  assert.deepEqual(result.attempt.status, "succeeded");
  assert.deepEqual(result.attempt.cleanup.status, "complete");
  assert.deepEqual(result.inventory.before.sha256, result.inventory.after.sha256);
  assert.deepEqual(result.attempt.limit_observations.total_tokens, 5);
  assert.deepEqual(result.isolationProof.backend, "macos-seatbelt-v1");
  assert.deepEqual(result.output.usage.total_tokens, 5);
  assert.deepEqual(result.output.termination_reason, "completed");
  assert.deepEqual(macosSeatbeltProbeCodes().length > 0, true);
});

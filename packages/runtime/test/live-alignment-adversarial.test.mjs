import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { createProviderProxyResponder } from "../src/provider-proxy.mjs";
import { createNetworkResearchSubject, buildResearchQueryText, normalizeExactHttpsOrigin, validateResearchRedirect } from "../src/research-policy.mjs";
import { runBoundedAgentWorker } from "../src/agent-worker.mjs";

test("hostile inputs are rejected before they can cross the trust boundary", async (t) => {
  assert.equal(buildResearchQueryText({
    originalGoal: "migrate secrets",
    dependencySignals: ["password=super-secret", "api-key=sk-12345678"],
    publicIdentifiers: ["Playwright"]
  }).includes("password"), false);

  assert.throws(() => normalizeExactHttpsOrigin("https://localhost/"), /must not target localhost/);
  assert.equal(createNetworkResearchSubject({
    operationId: "operation-1",
    queries: ["one"],
    origins: ["https://example.com"],
    maxQueries: 1,
    maxSourcesPerQuery: 1,
    maxRequests: 1,
    maxRedirectsPerRequest: 0,
    maxResponseBytes: 1024,
    maxTotalBytes: 2048,
    requestDeadlineSeconds: 30
  }).query_set_sha256.length, 64);
  assert.throws(() => createNetworkResearchSubject({
    operationId: "operation-1",
    queries: [],
    origins: ["https://example.com"],
    maxQueries: 1,
    maxSourcesPerQuery: 1,
    maxRequests: 1,
    maxRedirectsPerRequest: 0,
    maxResponseBytes: 1024,
    maxTotalBytes: 2048,
    requestDeadlineSeconds: 30
  }), /Research query set must contain 1 to 5 queries/);

  assert.equal(validateResearchRedirect({
    fromUrl: "https://example.com/start",
    location: "/next",
    allowedOrigins: ["https://example.com"]
  }), "https://example.com/next");
});

test("the provider proxy and worker fail closed on hostile prompts and consumer mutation", async (t) => {
  const respond = createProviderProxyResponder({
    exactOrigins: ["https://api.example.com"],
    childToken: "child-token",
    parentCredential: "parent-credential",
    operationId: "operation-1",
    attemptId: "attempt-1",
    fetchImpl: async () => new Response(JSON.stringify({ id: "resp-1", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    })
  });

  const denied = await respond({
    method: "POST",
    url: "/v1/responses",
    headers: { authorization: "Bearer wrong-token", "content-type": "application/json" },
    body: JSON.stringify({ input: "hello", max_output_tokens: 16 })
  });
  assert.equal(denied.status, 401);

  const analysisRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-adversarial-root-"));
  const attemptTmpPath = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-adversarial-attempt-"));
  const privateHome = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-adversarial-home-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-adversarial-supervisor-"));
  t.after(() => rm(analysisRoot, { recursive: true, force: true }));
  t.after(() => rm(attemptTmpPath, { recursive: true, force: true }));
  t.after(() => rm(privateHome, { recursive: true, force: true }));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  await writeFile(path.join(analysisRoot, "tracked.txt"), "tracked\n");

  const result = await runBoundedAgentWorker({
    snapshot: {
      schema_version: 1,
      captured_at: "2026-09-03T12:00:00.000Z",
      repository: {
        name: "demo",
        root_uri: pathToFileURL(analysisRoot).href,
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
      detected: { platforms: ["web"], languages: ["JavaScript"], frameworks: [], package_managers: [], services: [], test_tools: [], ci_files: [], deployment_files: [], agent_files: [] },
      commands: [],
      environment: { example_files: [], local_files: [], declared_keys: [], locally_set_keys: [], local_files_ignored: true },
      submodules: []
    },
    adapterRegistry: {
      async start() {
        await writeFile(path.join(analysisRoot, "consumer-write.txt"), "mutation\n");
        return {
          started_at: "2026-09-03T12:00:00.000Z",
          completed_at: "2026-09-03T12:00:01.000Z",
          exit_code: 0,
          status: "succeeded",
          termination_reason: "completed",
          result_path: null,
          usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
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
    },
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
    cleanup: async ({ startedAt, completedAt }) => ({
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

  assert.equal(result.attempt.status, "failed");
  assert.equal(result.attempt.termination_reason, "integrity");
  assert.notEqual(result.inventory.before.sha256, result.inventory.after.sha256);
});

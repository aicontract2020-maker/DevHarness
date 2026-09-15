import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import {
  captureConsumerInventory,
  createMacosSeatbeltAnalysisView,
  macosSeatbeltProbeCodes,
  probeMacosSeatbeltBoundary,
  renderMacosSeatbeltProfile
} from "../src/macos-seatbelt.mjs";

function snapshot(root) {
  return {
    schema_version: 1,
    captured_at: "2026-09-01T12:00:00.000Z",
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

test("consumer inventory captures every entry and changes when the repository changes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-inventory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "nested"), { recursive: true });
  await writeFile(path.join(root, "tracked.txt"), "tracked\n");
  await writeFile(path.join(root, "nested", "child.txt"), "child\n");
  await writeFile(path.join(root, ".ignored"), "ignored\n");
  await symlink("tracked.txt", path.join(root, "linked.txt"));

  const first = await captureConsumerInventory(root);
  assert.deepEqual(first.entries.map((entry) => entry.path), [".ignored", "linked.txt", "nested", "nested/child.txt", "tracked.txt"]);
  assert.equal(first.entries.find((entry) => entry.path === "linked.txt").target, "tracked.txt");

  await writeFile(path.join(root, "tracked.txt"), "changed\n");
  const second = await captureConsumerInventory(root);
  assert.notEqual(first.sha256, second.sha256);
});

test("analysis view builds a closed access policy and stable seatbelt profile", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-view-"));
  const attemptRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-attempt-"));
  const privateHome = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-home-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-supervisor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(attemptRoot, { recursive: true, force: true }));
  t.after(() => rm(privateHome, { recursive: true, force: true }));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  await writeFile(path.join(root, "tracked.txt"), "tracked\n");

  const view = await createMacosSeatbeltAnalysisView({
    snapshot: snapshot(root),
    attemptRoot,
    privateHome,
    supervisorRoot,
    proxyEndpoint: "http://127.0.0.1:4317",
    targetDescriptorSha256: "b".repeat(64),
    proxyPolicySha256: "c".repeat(64),
    tokenId: "token-1"
  });

  assert.equal(view.backend, "macos-seatbelt-v1");
  assert.equal(view.policy.consumer.read, true);
  assert.equal(view.policy.consumer.write, false);
  assert.equal(view.policy.provider_transport.target_descriptor_sha256, "b".repeat(64));
  assert.equal(view.policy.provider_transport.proxy_policy_sha256, "c".repeat(64));
  assert.equal(view.policy.profile_template_sha256.length, 64);
  assert.equal(view.policy.profile_instance_sha256.length, 64);
  assert.equal(renderMacosSeatbeltProfile(view).includes(JSON.stringify(path.resolve(attemptRoot))), true);
  assert.equal(renderMacosSeatbeltProfile(view).includes(JSON.stringify(path.resolve(root))), true);
});

test("probe plan runs the exact Seatbelt codes in order and returns an isolation proof", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-probe-"));
  const attemptRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-probe-attempt-"));
  const privateHome = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-probe-home-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-seatbelt-probe-supervisor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(attemptRoot, { recursive: true, force: true }));
  t.after(() => rm(privateHome, { recursive: true, force: true }));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  await writeFile(path.join(root, "tracked.txt"), "tracked\n");

  const view = await createMacosSeatbeltAnalysisView({
    snapshot: snapshot(root),
    attemptRoot,
    privateHome,
    supervisorRoot,
    proxyEndpoint: "http://127.0.0.1:4317",
    targetDescriptorSha256: "b".repeat(64),
    proxyPolicySha256: "c".repeat(64),
    tokenId: "token-1"
  });

  const calls = [];
  const result = await probeMacosSeatbeltBoundary(view, {
    probeRunner: async ({ code }) => {
      calls.push(code);
      return {
        status: code.endsWith("allowed") || code === "parent-proxy-protocol-bounded" || code === "child-process-owned" || code === "cleanup-observable" ? "pass" : "deny",
        summary: code
      };
    },
    now: () => "2026-09-01T12:34:56.000Z"
  });

  assert.deepEqual(calls, macosSeatbeltProbeCodes());
  assert.deepEqual(result.proof.probe_codes, macosSeatbeltProbeCodes());
  assert.equal(result.proof.backend, "macos-seatbelt-v1");
  assert.equal(result.proof.parent_proxy_probe_status, 200);
  assert.equal(result.proof.nested_tool_network, "denied");
  assert.equal(result.proof.proved_at, "2026-09-01T12:34:56.000Z");
  assert.equal(result.proof.consumer_before_sha256, result.proof.consumer_after_sha256);
});

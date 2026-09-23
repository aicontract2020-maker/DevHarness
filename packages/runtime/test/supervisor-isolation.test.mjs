import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { evaluateReadiness } from "../../project/src/doctor.mjs";
import { discoverRepository } from "../../project/src/discover.mjs";
import {
  createMacosSeatbeltProbeRunner
} from "../src/macos-seatbelt.mjs";
import {
  isolationProofSatisfiesDoctor,
  issueSupervisorIsolationProof
} from "../src/supervisor-isolation.mjs";
import {
  initializeSupervisorIdentity,
  listVerifiedIsolationProofs
} from "../src/supervisor-store.mjs";

async function gitInit(root) {
  const { spawnSync } = await import("node:child_process");
  const run = (args) => {
    const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  };
  run(["init", "-b", "main"]);
  run(["config", "user.email", "devharness@example.invalid"]);
  run(["config", "user.name", "DevHarness Tests"]);
  await writeFile(path.join(root, "README.md"), "fixture\n");
  run(["add", "."]);
  run(["commit", "-m", "fixture"]);
}

test("doctor fails supervisor-isolation without a verified host proof", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-isolation-doctor-fail-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await gitInit(root);
  const previous = process.env.DEVHARNESS_SUPERVISOR_DIR;
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-isolation-sup-fail-"));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  process.env.DEVHARNESS_SUPERVISOR_DIR = supervisorRoot;
  t.after(() => {
    if (previous === undefined) delete process.env.DEVHARNESS_SUPERVISOR_DIR;
    else process.env.DEVHARNESS_SUPERVISOR_DIR = previous;
  });
  await initializeSupervisorIdentity(supervisorRoot);
  const snapshot = await discoverRepository(root);
  const trustContext = await loadTrustedEvaluationContext({ snapshot });
  const report = evaluateReadiness(snapshot, { trustContext });
  const capability = report.capabilities.find((item) => item.id === "supervisor-isolation");
  assert.equal(capability.status, "fail");
  assert.equal(capability.blocking, true);
});

test("Supervisor-owned seatbelt issuance stores a proof doctor accepts", async (t) => {
  if (process.platform !== "darwin") {
    t.skip("macOS Seatbelt required");
    return;
  }
  const previous = process.env.DEVHARNESS_SUPERVISOR_DIR;
  const supervisorRoot = await mkdtemp(path.join(os.homedir(), ".devharness-isolation-test-"));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  process.env.DEVHARNESS_SUPERVISOR_DIR = supervisorRoot;
  t.after(() => {
    if (previous === undefined) delete process.env.DEVHARNESS_SUPERVISOR_DIR;
    else process.env.DEVHARNESS_SUPERVISOR_DIR = previous;
  });

  await initializeSupervisorIdentity(supervisorRoot);
  const issued = await issueSupervisorIsolationProof({
    supervisorRoot,
    probeRunner: createMacosSeatbeltProbeRunner(),
    now: () => new Date("2026-09-23T12:00:00.000Z"),
    ttlMs: 7 * 24 * 60 * 60 * 1000
  });
  assert.equal(issued.proof.outcome.status, "pass");
  assert.equal(issued.proof.scope, "host");
  assert.deepEqual(issued.proof.required_denials, {
    private_key: "deny",
    state: "deny",
    environment: "deny",
    control_channel: "deny"
  });
  const listed = await listVerifiedIsolationProofs(supervisorRoot, { now: new Date("2026-09-23T12:00:00.000Z") });
  assert.equal(listed.some((item) => item.id === issued.proof.id), true);
  assert.equal(
    isolationProofSatisfiesDoctor(issued.proof, {
      identity: { id: issued.proof.supervisor.id, fingerprint: issued.proof.supervisor.fingerprint },
      now: new Date("2026-09-23T12:00:00.000Z")
    }),
    true
  );

  const repo = await mkdtemp(path.join(os.tmpdir(), "devharness-isolation-doctor-pass-"));
  t.after(() => rm(repo, { recursive: true, force: true }));
  await gitInit(repo);
  const snapshot = await discoverRepository(repo);
  const trustContext = await loadTrustedEvaluationContext({ snapshot });
  const report = evaluateReadiness(snapshot, { trustContext });
  const capability = report.capabilities.find((item) => item.id === "supervisor-isolation");
  assert.equal(capability.status, "pass", capability.summary);
  assert.deepEqual(capability.evidence, [issued.proof.id]);
});

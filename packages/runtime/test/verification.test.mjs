import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { readProjectConfig } from "../../project/src/config.mjs";
import { discoverRepository } from "../../project/src/discover.mjs";
import { evaluateReadiness } from "../../project/src/doctor.mjs";
import { compileProjectHarness } from "../../project/src/harness.mjs";
import { initializeProject } from "../../project/src/init.mjs";
import { listValidReceipts, projectHarnessPath, writeProjectHarness } from "../src/data-store.mjs";
import { issueCommandSystemEvidence, issueCommandTestEvidence, registeredEvidenceDrivers } from "../src/supervisor-evidence.mjs";
import { evidenceBlobPath, initializeSupervisorIdentity, listVerifiedEvidenceManifests } from "../src/supervisor-store.mjs";
import { createVerificationPlan, executeVerificationPlan, probeHttpReadiness } from "../src/verify.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function waitForFileMatch(file, pattern, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const content = await readFile(file, "utf8").catch(() => "");
    if (pattern.test(content)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${pattern} in ${file}.`);
}

async function createRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-verify-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-verify-data-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "verification-fixture",
      scripts: {
        build: "node -e \"console.log(process.env.UNDECLARED_SECRET || 'redacted')\"",
        test: "node -e \"process.exit(7)\"",
        "test:dirty": "node -e \"require('node:fs').writeFileSync('touched.txt', 'changed')\"",
        "test:slow": "node -e \"setTimeout(() => {}, 10000)\"",
        verify: "node -e \"require('node:fs').writeFileSync('touched.txt', 'changed')\"",
        "verify:service": "node -e \"console.log('verification-ran')\"",
        "start:service": "node -e \"console.log('service-run:'+process.env.DEVHARNESS_RUN_ID);setInterval(()=>{},1000)\"",
        start: "node -e \"setInterval(() => {}, 1000)\""
      },
      dependencies: { react: "19.0.0" }
    }, null, 2)
  );
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(path.join(root, ".env.example"), "ALLOWED_SECRET=\nSERVICE_PORT=\n");
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "devharness@example.invalid"]);
  git(root, ["config", "user.name", "DevHarness Tests"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);

  let snapshot = await discoverRepository(root);
  await initializeProject(snapshot, { write: true });
  git(root, ["add", "devharness.yaml"]);
  git(root, ["commit", "-m", "configure devharness"]);
  snapshot = await discoverRepository(root);
  const { config } = await readProjectConfig(root);
  return { root, dataRoot, snapshot, config };
}

async function configureLifecycle(fixture, {
  additionalChecks = [],
  warmup = [],
  serviceRun,
  verificationRun,
  cleanupRun,
  cleanupTimeoutMs
} = {}) {
  const config = structuredClone(fixture.config);
  if (serviceRun) config.quality.commands.find((command) => command.id === "root-start-service").run = serviceRun;
  if (verificationRun) config.quality.commands.find((command) => command.id === "root-verify-service").run = verificationRun;
  config.harness.services = [{
    id: "fixture-web",
    command_id: "root-start-service",
    readiness: {
      kind: "http",
      url: "http://127.0.0.1:54321/health",
      expected_statuses: [204],
      timeout_ms: 1200,
      interval_ms: 100,
      ...(additionalChecks.length > 0 ? { additional_checks: additionalChecks } : {})
    },
    shutdown: {
      grace_ms: 1000,
      ...(cleanupRun ? { run: cleanupRun } : {}),
      ...(cleanupTimeoutMs ? { timeout_ms: cleanupTimeoutMs } : {})
    }
  }];
  config.harness.verifications = config.harness.verifications.map((verification) =>
    verification.command_id === "root-verify-service"
      ? { ...verification, service_ids: ["fixture-web"], warmup }
      : verification
  );
  await writeFile(path.join(fixture.root, "devharness.yaml"), `${JSON.stringify(config, null, 2)}\n`);
  git(fixture.root, ["add", "devharness.yaml"]);
  git(fixture.root, ["commit", "-m", "configure service lifecycle"]);
  return {
    ...fixture,
    snapshot: await discoverRepository(fixture.root),
    config: (await readProjectConfig(fixture.root)).config
  };
}

test("project harness compilation is deterministic, external, and honest about blockers", async (t) => {
  const fixture = await createRepository(t);
  const first = await compileProjectHarness(fixture.snapshot, fixture.config);
  const second = await compileProjectHarness(fixture.snapshot, structuredClone(fixture.config));
  assert.deepEqual(second, first);
  assert.ok(first.blockers.some((blocker) => blocker.subject === "root-start-service"));

  const target = projectHarnessPath(fixture.dataRoot, fixture.snapshot.repository.identity, first.id);
  await assert.rejects(stat(target), { code: "ENOENT" });
  const stored = await writeProjectHarness(target, first);
  assert.equal(stored.written, true);
  assert.deepEqual(JSON.parse(await readFile(target, "utf8")), first);
  assert.equal((await writeProjectHarness(target, first)).written, false);
  assert.equal(git(fixture.root, ["status", "--porcelain=v1"]), "");
});

test("invalid harness references and unsafe readiness targets are rejected", async (t) => {
  const fixture = await createRepository(t);
  const legacy = structuredClone(fixture.config);
  delete legacy.harness;
  const legacyHarness = await compileProjectHarness(fixture.snapshot, legacy);
  assert.ok(legacyHarness.blockers.some((blocker) => blocker.code === "service-lifecycle-unconfigured"));

  const unknown = structuredClone(fixture.config);
  unknown.harness.services = [{
    id: "bad-service",
    command_id: "missing-command",
    readiness: { kind: "http", url: "http://127.0.0.1:3000/health", expected_statuses: [200], timeout_ms: 1000, interval_ms: 100 },
    shutdown: { grace_ms: 100 }
  }];
  await assert.rejects(compileProjectHarness(fixture.snapshot, unknown), /unknown command/);

  const wrongServiceKind = structuredClone(unknown);
  wrongServiceKind.harness.services[0].command_id = "root-build";
  await assert.rejects(compileProjectHarness(fixture.snapshot, wrongServiceKind), /must reference a launch command/);

  const wrongVerificationKind = structuredClone(fixture.config);
  wrongVerificationKind.harness.verifications.push({ command_id: "root-build", service_ids: [] });
  await assert.rejects(compileProjectHarness(fixture.snapshot, wrongVerificationKind), /must reference a verify command/);

  const unsafe = structuredClone(unknown);
  unsafe.harness.services[0].command_id = "root-start-service";
  unsafe.harness.services[0].readiness.url = "http://user:secret@example.com/health?token=secret";
  await assert.rejects(compileProjectHarness(fixture.snapshot, unsafe), /Unsafe readiness target/);

  const unsafeWarmup = structuredClone(fixture.config);
  unsafeWarmup.harness.verifications.find((item) => item.command_id === "root-verify-service").warmup = [{
    kind: "http",
    url: "https://example.com/private?token=secret",
    expected_statuses: [200],
    timeout_ms: 1000,
    interval_ms: 100
  }];
  await assert.rejects(compileProjectHarness(fixture.snapshot, unsafeWarmup), /Unsafe readiness target/);
});

test("interactive verification without an owned service lifecycle is blocked before execution", async (t) => {
  const fixture = await createRepository(t);
  const marker = path.join(fixture.root, "touched.txt");
  await assert.rejects(
    createVerificationPlan({
      snapshot: fixture.snapshot,
      config: fixture.config,
      commandId: "root-verify",
      dataRoot: fixture.dataRoot
    }),
    /not bound to an owned service lifecycle/i
  );
  await assert.rejects(stat(marker), { code: "ENOENT" });
});

test("verification owns service readiness, evidence, and teardown", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t));
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    goalRunId: "run-verification-owner",
    dataRoot: fixture.dataRoot,
    environment
  });
  assert.equal(plan.services.length, 1);
  assert.equal(plan.goal_run_id, "run-verification-owner");
  let readinessChecks = 0;
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async () => {
      readinessChecks += 1;
      return { status: 204, summary: "fixture ready" };
    }
  });
  assert.equal(receipt.outcome.status, "pass");
  assert.equal(receipt.goal_run_id, "run-verification-owner");
  assert.equal(receipt.services[0].readiness.status, "pass");
  assert.equal(receipt.services[0].readiness.checks.length, 1);
  assert.equal(receipt.services[0].teardown.status, "pass");
  assert.equal(receipt.teardown.status, "pass");
  assert.equal(readinessChecks, 1);
  assert.match(await readFile(plan.paths.stdout, "utf8"), /verification-ran/);
  assert.equal(receipt.artifacts.filter((artifact) => artifact.type.startsWith("service-")).length, 2);
  assert.ok(receipt.services[0].signal || Number.isInteger(receipt.services[0].exit_code));

  const receipts = await listValidReceipts(fixture.dataRoot, fixture.snapshot.repository.identity);
  const report = evaluateReadiness(fixture.snapshot, { config: fixture.config, receipts });
  assert.equal(report.capabilities.find((item) => item.id === "service-launch").status, "warn");
  assert.equal(report.capabilities.find((item) => item.id === "behavior-verification").status, "warn");

  const attemptedForgery = await loadTrustedEvaluationContext({
    snapshot: fixture.snapshot,
    evidence: [{ id: "browser-proof", type: "browser-snapshot" }],
    evidenceArtifactRoot: plan.paths.artifacts
  });
  assert.deepEqual(attemptedForgery.evidence, []);
  const stillUnproved = evaluateReadiness(fixture.snapshot, { config: fixture.config, receipts, trustContext: attemptedForgery });
  assert.equal(stillUnproved.capabilities.find((item) => item.id === "behavior-verification").status, "warn");

  const changedConfig = structuredClone(fixture.config);
  changedConfig.harness.services[0].shutdown.grace_ms = 1100;
  const changedReport = evaluateReadiness(fixture.snapshot, { config: changedConfig, receipts });
  assert.equal(changedReport.capabilities.find((item) => item.id === "service-launch").status, "warn");

  await writeFile(path.join(plan.paths.artifacts, "service-fixture-web.stdout.log"), "tampered\n");
  assert.deepEqual(await listValidReceipts(fixture.dataRoot, fixture.snapshot.repository.identity), []);
});

test("all full-stack readiness checks must pass and are recorded", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t), {
    additionalChecks: [{
      kind: "http",
      url: "http://127.0.0.1:54322/",
      expected_statuses: [200],
      timeout_ms: 1200,
      interval_ms: 100
    }]
  });
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    dataRoot: fixture.dataRoot,
    environment
  });
  const probed = [];
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async (check) => {
      probed.push(check.url);
      return check.url.endsWith("/")
        ? { status: 200, summary: "frontend ready" }
        : { status: 204, summary: "backend ready" };
    }
  });
  assert.equal(receipt.outcome.status, "pass");
  assert.deepEqual(probed.sort(), [
    "http://127.0.0.1:54321/health",
    "http://127.0.0.1:54322/"
  ]);
  assert.equal(receipt.services[0].readiness.checks.length, 2);
  assert.ok(receipt.services[0].readiness.checks.every((check) => check.status === "pass"));
});

test("one failed full-stack readiness check blocks verification", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t), {
    additionalChecks: [{
      kind: "http",
      url: "http://127.0.0.1:54322/",
      expected_statuses: [200],
      timeout_ms: 1000,
      interval_ms: 100
    }]
  });
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    dataRoot: fixture.dataRoot,
    environment
  });
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async (check) => ({
      status: check.url.endsWith("/") ? 503 : 204,
      summary: "fixture probe"
    })
  });
  assert.equal(receipt.outcome.status, "fail");
  assert.equal(receipt.services[0].readiness.status, "fail");
  assert.equal(receipt.services[0].readiness.checks.find((check) => check.url.endsWith("/")).status, "fail");
  assert.doesNotMatch(await readFile(plan.paths.stdout, "utf8"), /verification-ran/);
  assert.equal(receipt.services[0].teardown.status, "pass");
});

test("revision-pinned submodules are materialized before verification and recorded", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t));
  const moduleRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-verify-module-"));
  t.after(() => rm(moduleRoot, { recursive: true, force: true }));
  await writeFile(path.join(moduleRoot, "module.txt"), "revision-pinned\n");
  git(moduleRoot, ["init", "-b", "main"]);
  git(moduleRoot, ["config", "user.email", "devharness@example.invalid"]);
  git(moduleRoot, ["config", "user.name", "DevHarness Tests"]);
  git(moduleRoot, ["add", "."]);
  git(moduleRoot, ["commit", "-m", "module fixture"]);
  git(fixture.root, ["-c", "protocol.file.allow=always", "submodule", "add", moduleRoot, "vendor/example"]);
  git(fixture.root, ["config", "protocol.file.allow", "always"]);
  git(fixture.root, ["commit", "-am", "add verification submodule"]);

  const snapshot = await discoverRepository(fixture.root);
  const plan = await createVerificationPlan({
    snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    dataRoot: fixture.dataRoot,
    environment: { ...process.env, SERVICE_PORT: "54321" }
  });
  const receipt = await executeVerificationPlan(plan, {
    environment: { ...process.env, SERVICE_PORT: "54321" },
    readinessProbe: async () => ({ status: 204, summary: "ready" })
  });
  assert.equal(receipt.outcome.status, "pass", JSON.stringify({ preparation: receipt.preparation, outcome: receipt.outcome }));
  assert.equal(receipt.preparation.status, "pass", receipt.preparation.summary);
  assert.deepEqual(receipt.preparation.submodules.map(({ path: submodulePath, commit_sha: commitSha, status }) => ({ submodulePath, commitSha, status })), [{
    submodulePath: "vendor/example",
    commitSha: git(moduleRoot, ["rev-parse", "HEAD"]),
    status: "materialized"
  }]);
});

test("declared warmup is bounded, ordered, recorded, and blocks the command on failure", async (t) => {
  const warmup = ["page-a", "page-b"].map((page) => ({
    kind: "http",
    url: `http://127.0.0.1:54321/${page}`,
    expected_statuses: [200],
    timeout_ms: 1000,
    interval_ms: 100
  }));
  const fixture = await configureLifecycle(await createRepository(t), { warmup });
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    dataRoot: fixture.dataRoot,
    environment
  });
  const observed = [];
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async (check) => {
      observed.push(check.url);
      return { status: check.url.endsWith("page-b") ? 500 : check.url.endsWith("health") ? 204 : 200, summary: "fixture response" };
    }
  });
  assert.equal(receipt.outcome.status, "fail");
  assert.equal(receipt.outcome.reason, "warmup-failed");
  assert.equal(receipt.warmup.status, "fail");
  assert.deepEqual(receipt.warmup.checks.map((check) => check.url), warmup.map((check) => check.url));
  assert.ok(observed.indexOf(warmup[0].url) < observed.indexOf(warmup[1].url));
  assert.doesNotMatch(await readFile(plan.paths.stdout, "utf8"), /verification-ran/);
});

test("an owned service exit after readiness is classified instead of hidden by command output", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t), {
    serviceRun: "node -e \"console.log('fixture-ready');setTimeout(()=>process.exit(23),100)\"",
    verificationRun: "node -e \"setTimeout(()=>console.log('verification-ran'),300)\""
  });
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    dataRoot: fixture.dataRoot,
    environment
  });
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async () => ({ status: 204, summary: "ready" })
  });
  assert.equal(receipt.outcome.status, "fail");
  assert.equal(receipt.outcome.reason, "service-exited");
  assert.equal(receipt.services[0].status, "exited");
  assert.equal(receipt.services[0].unexpected_exit, true);
  assert.equal(receipt.services[0].exit_code, 23);
});

test("explicit cleanup is bounded, recorded, and required for teardown", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t), {
    cleanupRun: "node -e \"console.log('cleanup-ran')\"",
    cleanupTimeoutMs: 2000
  });
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    dataRoot: fixture.dataRoot,
    environment
  });
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async () => {
      await waitForFileMatch(
        path.join(plan.paths.artifacts, "service-fixture-web.stdout.log"),
        new RegExp(`service-run:${plan.id}`)
      );
      return { status: 204, summary: "ready" };
    }
  });
  assert.equal(receipt.outcome.status, "pass");
  assert.equal(receipt.services[0].teardown.cleanup.status, "pass");
  assert.equal(receipt.services[0].teardown.cleanup.timeout_ms, 2000);
  const serviceOutput = await readFile(path.join(plan.paths.artifacts, "service-fixture-web.stdout.log"), "utf8");
  assert.match(serviceOutput, new RegExp(`service-run:${plan.id}`));
  assert.match(serviceOutput, /cleanup-ran/);
});

test("failed explicit cleanup fails teardown and the verification outcome", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t), {
    cleanupRun: "node -e \"process.exit(9)\"",
    cleanupTimeoutMs: 2000
  });
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    dataRoot: fixture.dataRoot,
    environment
  });
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async () => ({ status: 204, summary: "ready" })
  });
  assert.equal(receipt.outcome.status, "fail");
  assert.equal(receipt.services[0].teardown.status, "fail");
  assert.equal(receipt.services[0].teardown.cleanup.exit_code, 9);
  assert.equal(receipt.teardown.status, "fail");
});

test("readiness failure never starts verification and still tears the service down", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t));
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    dataRoot: fixture.dataRoot,
    environment
  });
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async () => ({ status: 503, summary: "fixture unavailable" })
  });
  assert.equal(receipt.outcome.status, "fail");
  assert.equal(receipt.services[0].readiness.status, "fail");
  assert.equal(receipt.services[0].teardown.status, "pass");
  assert.doesNotMatch(await readFile(plan.paths.stdout, "utf8"), /verification-ran/);
  await assert.rejects(stat(plan.paths.workspace), { code: "ENOENT" });
});

test("HTTP readiness driver records status without exposing response bodies", async () => {
  let cancelled = false;
  const result = await probeHttpReadiness(
    { url: "http://127.0.0.1:54321/health" },
    1000,
    async () => ({ status: 204, body: { cancel: async () => { cancelled = true; } } })
  );
  assert.deepEqual(result, { status: 204, summary: "HTTP 204" });
  assert.equal(cancelled, true);
});

test("a passing command produces an intact current-revision receipt", async (t) => {
  const fixture = await createRepository(t);
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-build",
    dataRoot: fixture.dataRoot
  });
  const receipt = await executeVerificationPlan(plan, {
    environment: { ...process.env, UNDECLARED_SECRET: "must-not-reach-command" }
  });

  assert.equal(receipt.outcome.status, "pass");
  assert.equal(receipt.teardown.status, "pass");
  assert.equal(receipt.workspace.dirty_after, false);
  await assert.rejects(stat(plan.paths.workspace), { code: "ENOENT" });
  assert.match(await readFile(plan.paths.stdout, "utf8"), /redacted/);
  assert.equal((await readFile(plan.paths.stdout, "utf8")).includes("must-not-reach-command"), false);

  const receipts = await listValidReceipts(fixture.dataRoot, fixture.snapshot.repository.identity);
  assert.equal(receipts.length, 1);
  const report = evaluateReadiness(fixture.snapshot, { config: fixture.config, receipts });
  assert.equal(report.capabilities.find((item) => item.id === "build-command").status, "warn");
});

test("failed and dirty commands produce failed receipts and still clean worktrees", async (t) => {
  const fixture = await createRepository(t);

  const failingPlan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-test",
    dataRoot: fixture.dataRoot
  });
  const failing = await executeVerificationPlan(failingPlan);
  assert.equal(failing.outcome.status, "fail");
  assert.equal(failing.outcome.exit_code, 7);
  assert.equal(failing.teardown.status, "pass");
  await assert.rejects(stat(failingPlan.paths.workspace), { code: "ENOENT" });

  const dirtyPlan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-test-dirty",
    dataRoot: fixture.dataRoot
  });
  const dirty = await executeVerificationPlan(dirtyPlan);
  assert.equal(dirty.outcome.status, "fail");
  assert.equal(dirty.workspace.dirty_after, true);
  assert.match(dirty.outcome.summary, /changed non-ignored files/);
  assert.equal(dirty.teardown.status, "pass");
  await assert.rejects(stat(dirtyPlan.paths.workspace), { code: "ENOENT" });
});

test("receipt trust is lost after artifact tampering or a new commit", async (t) => {
  const fixture = await createRepository(t);
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-build",
    dataRoot: fixture.dataRoot
  });
  await executeVerificationPlan(plan);
  await writeFile(plan.paths.stdout, "tampered\n");
  assert.deepEqual(await listValidReceipts(fixture.dataRoot, fixture.snapshot.repository.identity), []);

  const cleanPlan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-build",
    dataRoot: fixture.dataRoot
  });
  await executeVerificationPlan(cleanPlan);
  await writeFile(path.join(fixture.root, "README.md"), "new revision\n");
  git(fixture.root, ["add", "README.md"]);
  git(fixture.root, ["commit", "-m", "advance head"]);
  const nextSnapshot = await discoverRepository(fixture.root);
  const receipts = await listValidReceipts(fixture.dataRoot, fixture.snapshot.repository.identity);
  const report = evaluateReadiness(nextSnapshot, { config: fixture.config, receipts });
  assert.equal(report.capabilities.find((item) => item.id === "build-command").status, "warn");
});

test("launch commands and dirty source baselines are blocked before execution", async (t) => {
  const fixture = await createRepository(t);
  await assert.rejects(
    createVerificationPlan({
      snapshot: fixture.snapshot,
      config: fixture.config,
      commandId: "root-start",
      dataRoot: fixture.dataRoot
    }),
    /lifecycle driver/
  );

  await writeFile(path.join(fixture.root, "uncommitted.txt"), "local\n");
  const dirtySnapshot = await discoverRepository(fixture.root);
  await assert.rejects(
    createVerificationPlan({
      snapshot: dirtySnapshot,
      config: fixture.config,
      commandId: "root-build",
      dataRoot: fixture.dataRoot
    }),
    /clean committed baseline/
  );

  await assert.rejects(
    createVerificationPlan({
      snapshot: fixture.snapshot,
      config: fixture.config,
      commandId: "root-build",
      dataRoot: path.join(fixture.root, ".devharness-runtime")
    }),
    /outside the consumer repository/
  );
});

test("timed-out commands produce failed receipts and are torn down", async (t) => {
  const fixture = await createRepository(t);
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-test-slow",
    dataRoot: fixture.dataRoot,
    timeoutMs: 1000
  });
  const receipt = await executeVerificationPlan(plan);
  assert.equal(receipt.outcome.status, "fail");
  assert.equal(receipt.outcome.timed_out, true);
  assert.equal(receipt.teardown.status, "pass");
  await assert.rejects(stat(plan.paths.workspace), { code: "ENOENT" });
});

test("sealed command-test driver issues only signed current test-result evidence", async (t) => {
  const fixture = await createRepository(t);
  const packageJson = JSON.parse(await readFile(path.join(fixture.root, "package.json"), "utf8"));
  packageJson.scripts.test = "node -e \"process.exit(0)\"";
  await writeFile(path.join(fixture.root, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`);
  git(fixture.root, ["add", "package.json"]);
  git(fixture.root, ["commit", "-m", "make test pass"]);
  const snapshot = await discoverRepository(fixture.root);
  const { config } = await readProjectConfig(fixture.root);
  const plan = await createVerificationPlan({
    snapshot,
    config,
    commandId: "root-test",
    dataRoot: fixture.dataRoot
  });
  const receipt = await executeVerificationPlan(plan);
  assert.equal(receipt.outcome.status, "pass");

  await initializeSupervisorIdentity(fixture.dataRoot);
  assert.deepEqual((await registeredEvidenceDrivers()).map((driver) => driver.id), ["command-system", "command-test"]);
  const issued = await issueCommandTestEvidence({
    supervisorRoot: fixture.dataRoot,
    receiptRoot: fixture.dataRoot,
    snapshot,
    config,
    receiptId: receipt.id,
    runId: "run-test-proof",
    criterion: { id: "AC-tests-pass", claim: "The configured automated tests pass." }
  });
  assert.equal(issued.written, true);
  assert.equal(issued.manifest.command.kind, "test");
  assert.deepEqual(issued.manifest.evidence_records.map((record) => record.type), ["test-result"]);
  assert.equal((await listVerifiedEvidenceManifests(fixture.dataRoot, snapshot.repository.identity)).length, 1);

  const previousDataRoot = process.env.DEVHARNESS_DATA_DIR;
  process.env.DEVHARNESS_DATA_DIR = fixture.dataRoot;
  let trustContext;
  try {
    trustContext = await loadTrustedEvaluationContext({
      snapshot,
      evidence: [{ id: "caller-forgery", type: "browser-snapshot" }]
    });
  } finally {
    if (previousDataRoot === undefined) delete process.env.DEVHARNESS_DATA_DIR;
    else process.env.DEVHARNESS_DATA_DIR = previousDataRoot;
  }
  assert.deepEqual(trustContext.evidence, []);
  const trustedReport = evaluateReadiness(snapshot, { config, trustContext, receipts: [{ command: { kind: "build" } }] });
  assert.equal(trustedReport.capabilities.find((item) => item.id === "automated-tests").status, "warn");
  assert.equal(trustedReport.capabilities.find((item) => item.id === "behavior-verification").status, "warn");

  const duplicate = await issueCommandTestEvidence({
    supervisorRoot: fixture.dataRoot,
    receiptRoot: fixture.dataRoot,
    snapshot,
    config,
    receiptId: receipt.id,
    runId: "run-test-proof",
    criterion: { id: "AC-tests-pass", claim: "The configured automated tests pass." }
  });
  assert.equal(duplicate.written, false);

  const buildPlan = await createVerificationPlan({ snapshot, config, commandId: "root-build", dataRoot: fixture.dataRoot });
  const buildReceipt = await executeVerificationPlan(buildPlan);
  await assert.rejects(issueCommandTestEvidence({
    supervisorRoot: fixture.dataRoot,
    receiptRoot: fixture.dataRoot,
    snapshot,
    config,
    receiptId: buildReceipt.id,
    runId: "run-build-forgery",
    criterion: { id: "AC-browser", claim: "The browser works." }
  }), /only test receipts/);

  const captured = issued.manifest.evidence_records[0].artifacts[0];
  await writeFile(evidenceBlobPath(fixture.dataRoot, captured.sha256), "tampered\n");
  assert.deepEqual(await listVerifiedEvidenceManifests(fixture.dataRoot, snapshot.repository.identity), []);
});

test("sealed command-system driver issues E2 test-result evidence without inventing E3 observations", async (t) => {
  const fixture = await configureLifecycle(await createRepository(t));
  const environment = { ...process.env, SERVICE_PORT: "54321" };
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: "root-verify-service",
    goalRunId: "run-system-proof",
    dataRoot: fixture.dataRoot,
    environment
  });
  const receipt = await executeVerificationPlan(plan, {
    environment,
    readinessProbe: async () => ({ status: 204, summary: "ready" })
  });
  assert.equal(receipt.outcome.status, "pass");

  await initializeSupervisorIdentity(fixture.dataRoot);
  const issued = await issueCommandSystemEvidence({
    supervisorRoot: fixture.dataRoot,
    receiptRoot: fixture.dataRoot,
    snapshot: fixture.snapshot,
    config: fixture.config,
    receiptId: receipt.id,
    runId: "run-system-proof",
    criterion: { id: "AC-system-command", claim: "The configured system verification command passed." }
  });
  assert.equal(issued.manifest.driver.id, "command-system");
  assert.equal(issued.manifest.run_id, "run-system-proof");
  assert.equal(issued.manifest.command.kind, "verify");
  assert.deepEqual(issued.manifest.evidence_records.map((record) => record.type), ["test-result"]);
  assert.doesNotMatch(issued.manifest.outcome.summary, /browser snapshot|database state|network response/i);

  await assert.rejects(issueCommandTestEvidence({
    supervisorRoot: fixture.dataRoot,
    receiptRoot: fixture.dataRoot,
    snapshot: fixture.snapshot,
    config: fixture.config,
    receiptId: receipt.id,
    runId: "run-system-proof",
    criterion: { id: "AC-no-driver-confusion", claim: "System verification passed." }
  }), /only test receipts/);
});

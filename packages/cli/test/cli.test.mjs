import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { formatVerificationExecutionResult, runCli } from "../src/cli.mjs";
import { hashContract } from "../../project/src/harness.mjs";

function capture() {
  const lines = [];
  return { lines, io: { log: (value) => lines.push(String(value)) } };
}

test("failed verification remains reviewable when passing attestation was requested", () => {
  const receipt = {
    id: "verify-failed",
    outcome: { status: "fail", summary: "The command exited with code 1." }
  };
  const attestation = {
    status: "not-issued",
    reason: "execution-failed",
    summary: "the execution failed; failure receipts remain reviewable but cannot become passing evidence"
  };
  const text = formatVerificationExecutionResult({
    receipt,
    receiptPath: "/external/receipts/verify-failed.json",
    attestation
  });
  assert.match(text, /^FAIL:/);
  assert.match(text, /Receipt: \/external\/receipts\/verify-failed\.json/);
  assert.match(text, /Passing evidence: not issued \(the execution failed/);

  const json = JSON.parse(formatVerificationExecutionResult({
    receipt,
    receiptPath: "/external/receipts/verify-failed.json",
    attestation,
    format: "json"
  }));
  assert.equal(json.receipt.id, "verify-failed");
  assert.equal(json.evidence_manifest, null);
  assert.equal(json.attestation.reason, "execution-failed");
});

test("help documents init's explicit write boundary", async () => {
  const output = capture();
  assert.equal(await runCli(["--help"], output.io), 0);
  assert.match(output.lines.join("\n"), /Does not write unless --write is present/);
  assert.match(output.lines.join("\n"), /approve --request ID \[--repo PATH\] \[--data-dir PATH\]/);
});

test("help presents onboard as a read-only understanding plan", async () => {
  const output = capture();
  assert.equal(await runCli(["--help"], output.io), 0);
  assert.match(output.lines.join("\n"), /onboard/);
  assert.match(output.lines.join("\n"), /read-only/i);
});

test("onboard JSON does not modify an unconfigured consumer repository", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-onboard-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-onboard-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });
  const output = capture();
  assert.equal(await runCli(["onboard", "--repo", root, "--data-dir", dataRoot, "--format", "json"], output.io), 2);
  const parsed = JSON.parse(output.lines[0]);
  assert.equal(parsed.plan.mode, "read-only-plan");
  assert.equal(parsed.plan.verdict, "needs-evidence");
  await assert.rejects(stat(parsed.path), { code: "ENOENT" });
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);

  const storedOutput = capture();
  assert.equal(await runCli(["onboard", "--repo", root, "--data-dir", dataRoot, "--write", "--format", "json"], storedOutput.io), 2);
  const stored = JSON.parse(storedOutput.lines[0]);
  assert.equal(stored.written, true);
  assert.equal((await stat(stored.path)).isFile(), true);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);
});

test("doctor JSON is machine-readable and returns not-ready for an unconfigured repo", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);

  const output = capture();
  const exitCode = await runCli(["doctor", "--repo", root, "--format", "json"], output.io);
  const parsed = JSON.parse(output.lines[0]);
  assert.equal(exitCode, 2);
  assert.equal(parsed.report.overall.verdict, "needs_work");
  assert.equal(parsed.snapshot.repository.git.is_repository, true);
});

test("build previews deterministically and writes only with explicit authority", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-build-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-build-data-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "node -e \"process.exit(0)\"" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  assert.equal(await runCli(["init", "--repo", root, "--write"], capture().io), 0);
  execFileSync("git", ["-C", root, "add", "devharness.yaml"]);
  execFileSync("git", ["-C", root, "commit", "-m", "accept harness config"]);

  const preview = capture();
  assert.equal(await runCli(["build", "--repo", root, "--data-dir", dataRoot, "--format", "json"], preview.io), 0);
  const previewResult = JSON.parse(preview.lines[0]);
  assert.equal(previewResult.written, false);
  await assert.rejects(stat(previewResult.path), { code: "ENOENT" });

  const write = capture();
  assert.equal(await runCli(["build", "--repo", root, "--data-dir", dataRoot, "--write", "--format", "json"], write.io), 0);
  const writeResult = JSON.parse(write.lines[0]);
  assert.equal(writeResult.manifest.id, previewResult.manifest.id);
  assert.equal(writeResult.written, true);
  assert.equal((await stat(writeResult.path)).isFile(), true);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("explicit external config supports local build planning without changing the consumer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-external-repo-"));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-external-config-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-external-data-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(configRoot, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "external-fixture", scripts: { build: "node -e \"process.exit(0)\"" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const externalConfig = path.join(configRoot, "devharness.yaml");
  await writeFile(externalConfig, JSON.stringify({
    version: 1,
    project: { id: "external-fixture" },
    platforms: ["library"],
    quality: { commands: [{ id: "root-build", kind: "build", run: "npm run build", source: "package.json" }] },
    harness: { services: [], verifications: [] },
    autonomy: { required_gates: ["scope", "delivery"] },
    delivery: { provider: "manual", target: "pull-request" }
  }, null, 2));

  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });
  const output = capture();
  assert.equal(await runCli([
    "build", "--repo", root, "--config", externalConfig, "--data-dir", dataRoot, "--format", "json"
  ], output.io), 0);
  assert.equal(JSON.parse(output.lines[0]).manifest.commands[0].id, "root-build");
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);

  const doctor = capture();
  await runCli(["doctor", "--repo", root, "--config", externalConfig, "--data-dir", dataRoot, "--format", "json"], doctor.io);
  const projectConfigCapability = JSON.parse(doctor.lines[0]).report.capabilities.find((item) => item.id === "project-config");
  assert.equal(projectConfigCapability.status, "pass");
  assert.match(projectConfigCapability.summary, /explicit external/i);

  const insideConfig = path.join(root, "devharness.yaml");
  await writeFile(insideConfig, await readFile(externalConfig, "utf8"));
  await assert.rejects(
    runCli(["build", "--repo", root, "--config", insideConfig, "--data-dir", dataRoot], capture().io),
    /must point outside the consumer repository/
  );
});

test("approval refuses JSON and bypass flags", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-approval-repo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "approval-fixture", scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  await assert.rejects(
    runCli(["approve", "--repo", root, "--request", "approval-request-placeholder", "--format", "json"], capture().io),
    /unavailable in JSON mode/
  );
  await assert.rejects(
    runCli(["request-approval", "--repo", root, "--run", "run-1", "--gate", "capability", "--subject", "browser-runtime", "--subject-sha", "a".repeat(64)], capture().io),
    /use request-capability/i
  );
  await assert.rejects(
    runCli(["approve", "--repo", root, "--request", "approval-request-placeholder", "--yes"], capture().io),
    /Unknown argument: --yes/
  );
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("public verification execution requires a Goal Run before consumer configuration or processes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-verify-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "verify-authority", scripts: { test: "node --test" } }));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  await assert.rejects(runCli(["verify", "--repo", root, "--command", "root-test", "--execute"], capture().io), /requires --run ID/i);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("public verification execution cannot start an accepted command without current capability approval", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-verify-denied-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-verify-denied-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-verify-denied-supervisor-"));
  const marker = path.join(os.tmpdir(), `devharness-forbidden-${path.basename(root)}`);
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true }),
    rm(supervisorRoot, { recursive: true, force: true }),
    rm(marker, { force: true })
  ]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "verify-denied", dependencies: { next: "15.0.0" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(path.join(root, "devharness.yaml"), JSON.stringify({
    version: 1,
    project: { id: "verify-denied" },
    platforms: ["web"],
    quality: {
      commands: [
        {
          id: "fixture-launch",
          kind: "launch",
          run: "node -e \"setInterval(() => {}, 1000)\"",
          source: "developer-reviewed-test-fixture"
        },
        {
          id: "forbidden-verify",
          kind: "verify",
          run: `node -e \"require('node:fs').writeFileSync('${marker}', 'executed')\"`,
          source: "developer-reviewed-test-fixture"
        }
      ]
    },
    harness: {
      services: [{
        id: "fixture-service",
        command_id: "fixture-launch",
        readiness: { kind: "http", url: "http://127.0.0.1:54322/health", expected_statuses: [204], timeout_ms: 1000, interval_ms: 100 },
        shutdown: { grace_ms: 100 }
      }],
      verifications: [{ command_id: "forbidden-verify", service_ids: ["fixture-service"] }]
    },
    autonomy: { required_gates: ["scope", "delivery"] },
    delivery: { provider: "manual", target: "pull-request" }
  }, null, 2));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "accepted harness fixture"]);

  await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Prove denied execution", "--format", "json"],
    capture().io,
    { newRunId: () => "run-verify-denied", now: () => "2026-08-31T18:00:00.000Z" }
  );
  await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-verify-denied", "--format", "json"],
    capture().io,
    { now: () => "2026-08-31T18:01:00.000Z", supervisorRoot }
  );

  await assert.rejects(
    runCli(
      ["verify", "--repo", root, "--data-dir", dataRoot, "--run", "run-verify-denied", "--command", "forbidden-verify", "--execute"],
      capture().io,
      { now: () => "2026-08-31T18:02:00.000Z", supervisorRoot }
    ),
    /service-runtime is unrequested/i
  );
  await assert.rejects(stat(marker), { code: "ENOENT" });
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("goal creates external event-backed state and status restores a compact verdict", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-goal-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-goal-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "goal-fixture" }));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });

  const goalOutput = capture();
  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    goalOutput.io,
    { newRunId: () => "run-cli-1", now: () => "2026-08-31T16:00:00.000Z" }
  ), 0);
  const created = JSON.parse(goalOutput.lines[0]);
  assert.equal(created.run.id, "run-cli-1");
  assert.equal(created.run.state, "received");
  assert.equal(created.scorecard.data_source, "runtime");
  assert.equal(created.scorecard.proof_coverage.score, 0);
  assert.equal(created.scorecard.verdict, "blocked");

  const statusOutput = capture();
  assert.equal(await runCli(["status", "--repo", root, "--data-dir", dataRoot, "--run", "run-cli-1", "--format", "json"], statusOutput.io), 2);
  const statusResult = JSON.parse(statusOutput.lines[0]);
  assert.equal(statusResult.run.id, "run-cli-1");
  assert.equal(statusResult.scorecard.exception_counts.blocking > 0, true);
  assert.match(statusResult.next_action, /acceptance criteria/i);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);
});

test("goal refuses a dirty repository before creating state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-goal-dirty-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-goal-dirty-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "dirty-fixture" }));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  await writeFile(path.join(root, "dirty.txt"), "uncommitted\n");
  await assert.rejects(runCli(["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Unsafe goal"], capture().io), /clean committed/i);
});

test("advance publishes an honest Alignment Brief without changing the consumer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-advance-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-advance-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-advance-supervisor-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true }), rm(supervisorRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "advance-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });

  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    capture().io,
    { newRunId: () => "run-advance-1", now: () => "2026-08-31T16:00:00.000Z" }
  ), 0);
  const output = capture();
  assert.equal(await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--format", "json"],
    output.io,
    { now: () => "2026-08-31T17:00:00.000Z" }
  ), 2);
  const result = JSON.parse(output.lines[0]);
  assert.equal(result.run.state, "clarifying");
  assert.equal(result.interaction.kind, "alignment-brief");
  assert.equal(result.interaction.verdict, "action-required");
  assert.equal(result.interaction.actions.some((action) => action.kind === "approve"), false);
  assert.equal(result.scorecard.verdict, "blocked");
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);

  const status = capture();
  assert.equal(await runCli(["status", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--format", "json"], status.io, { supervisorRoot }), 2);
  assert.equal(JSON.parse(status.lines[0]).run.state, "clarifying");
  const capabilityOutput = capture();
  assert.equal(await runCli(
    ["request-capability", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--capability", "browser-runtime", "--format", "json"],
    capabilityOutput.io,
    { supervisorRoot, now: () => "2026-08-31T17:10:00.000Z" }
  ), 0);
  const capabilityResult = JSON.parse(capabilityOutput.lines[0]);
  assert.equal(capabilityResult.capability.id, "browser-runtime");
  assert.equal(capabilityResult.request.subject.id, "browser-runtime");
  const pendingStatus = capture();
  await runCli(["status", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--format", "json"], pendingStatus.io, { supervisorRoot, now: () => "2026-08-31T17:20:00.000Z" });
  assert.equal(JSON.parse(pendingStatus.lines[0]).capabilities.counts.pending, 1);
  const textCapabilityOutput = capture();
  assert.equal(await runCli(
    ["request-capability", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--capability", "network-research"],
    textCapabilityOutput.io,
    { supervisorRoot, now: () => "2026-08-31T17:21:00.000Z" }
  ), 0);
  assert.match(textCapabilityOutput.lines[0], /approve --repo .* --data-dir .*devharness-cli-advance-data-.* --request approval-request-/);
  await assert.rejects(runCli(["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1"], capture().io), /only a received/i);
});

test("review command starts a repository-scoped read service and emits a fragment credential", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-review-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-review-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "review-fixture" }));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  assert.equal(await runCli(["init", "--repo", root, "--write"], capture().io), 0);
  const acceptedConfig = JSON.parse(await readFile(path.join(root, "devharness.yaml"), "utf8"));
  acceptedConfig.project.id = "accepted-review-config";
  await writeFile(path.join(root, "devharness.yaml"), `${JSON.stringify(acceptedConfig, null, 2)}\n`);
  execFileSync("git", ["-C", root, "add", "devharness.yaml"]);
  execFileSync("git", ["-C", root, "commit", "-m", "accept project declaration"]);
  let received;
  const output = capture();
  assert.equal(await runCli(
    ["review", "--repo", root, "--data-dir", dataRoot, "--port", "4318", "--ui-origin", "http://localhost:3001"],
    output.io,
    { startReviewServer: async (options) => {
      received = options;
      return { origin: "http://127.0.0.1:4318", token: "d".repeat(64) };
    } }
  ), 0);
  assert.equal(received.port, 4318);
  assert.equal(received.allowedOrigin, "http://localhost:3001");
  assert.equal(received.declarationReview.repository_identity, path.basename(root));
  assert.equal(received.declarationReview.verdict, "blocked");
  assert.equal(received.declarationReview.proposal_sha256, hashContract(acceptedConfig));
  assert.match(output.lines[0], /#api=http%3A%2F%2F127\.0\.0\.1%3A4318&token=/);
});

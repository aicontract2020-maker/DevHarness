import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { evaluateDeliveryReadiness } from "../../core/src/delivery-readiness.mjs";
import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { readProjectConfig } from "../../project/src/config.mjs";
import { discoverRepository } from "../../project/src/discover.mjs";
import { initializeProject } from "../../project/src/init.mjs";
import {
  INDEPENDENT_REVIEW_REVIEWER_ID,
  issueCommandTestEvidence,
  issueIndependentReviewEvidence,
  registeredEvidenceDrivers
} from "../src/supervisor-evidence.mjs";
import { initializeSupervisorIdentity, listReviewVerdicts } from "../src/supervisor-store.mjs";
import { createVerificationPlan, executeVerificationPlan } from "../src/verify.mjs";

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}

async function createRepository(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-review-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-review-data-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "independent-review-fixture",
      scripts: {
        test: "node -e \"console.log('ok')\"",
        build: "node -e \"console.log('build')\"",
        start: "node -e \"setInterval(()=>{},1000)\""
      }
    }, null, 2)
  );
  await writeFile(path.join(root, ".env.example"), "ALLOWED_SECRET=\n");
  git(root, ["init", "-b", "main"]);
  git(root, ["config", "user.email", "devharness@example.invalid"]);
  git(root, ["config", "user.name", "DevHarness Tests"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-m", "fixture"]);

  let snapshot = await discoverRepository(root);
  await initializeProject(snapshot, { write: true });
  git(root, ["add", "devharness.yaml"]);
  git(root, ["commit", "-m", "configure"]);
  snapshot = await discoverRepository(root);
  const { config } = await readProjectConfig(root);
  const patched = structuredClone(config);
  for (const command of patched.quality.commands) {
    if (command.kind === "test") command.run = "node -e \"console.log('ok')\"";
  }
  return { root, dataRoot, snapshot, config: patched };
}

test("registered drivers include independent-review", async () => {
  const ids = (await registeredEvidenceDrivers()).map((driver) => driver.id);
  assert.ok(ids.includes("independent-review"));
});

test("independent-review fails closed without Supervisor verify/test evidence", async (t) => {
  const fixture = await createRepository(t);
  const previous = process.env.DEVHARNESS_SUPERVISOR_DIR;
  process.env.DEVHARNESS_SUPERVISOR_DIR = fixture.dataRoot;
  t.after(() => {
    if (previous === undefined) delete process.env.DEVHARNESS_SUPERVISOR_DIR;
    else process.env.DEVHARNESS_SUPERVISOR_DIR = previous;
  });
  await initializeSupervisorIdentity(fixture.dataRoot);
  await assert.rejects(issueIndependentReviewEvidence({
    supervisorRoot: fixture.dataRoot,
    snapshot: fixture.snapshot,
    runId: "run-review-missing"
  }), /command-\* evidence|will not invent/);
});

test("independent-review emits review-report bound to stored verdict and enables full delivery readiness", async (t) => {
  const fixture = await createRepository(t);
  const previous = process.env.DEVHARNESS_SUPERVISOR_DIR;
  process.env.DEVHARNESS_SUPERVISOR_DIR = fixture.dataRoot;
  t.after(() => {
    if (previous === undefined) delete process.env.DEVHARNESS_SUPERVISOR_DIR;
    else process.env.DEVHARNESS_SUPERVISOR_DIR = previous;
  });
  await initializeSupervisorIdentity(fixture.dataRoot);

  const testCommand = fixture.config.quality.commands.find((command) => command.kind === "test");
  assert.ok(testCommand, "fixture needs a test command");
  const plan = await createVerificationPlan({
    snapshot: fixture.snapshot,
    config: fixture.config,
    commandId: testCommand.id,
    goalRunId: "run-review-ready",
    dataRoot: fixture.dataRoot
  });
  const receipt = await executeVerificationPlan(plan);
  assert.equal(receipt.outcome.status, "pass");
  const support = await issueCommandTestEvidence({
    supervisorRoot: fixture.dataRoot,
    receiptRoot: fixture.dataRoot,
    snapshot: fixture.snapshot,
    config: fixture.config,
    receiptId: receipt.id,
    runId: "run-review-ready",
    criterion: { id: "AC-fixture-test", claim: "Fixture tests passed." }
  });
  assert.equal(support.manifest.driver.id, "command-test");

  const issued = await issueIndependentReviewEvidence({
    supervisorRoot: fixture.dataRoot,
    snapshot: fixture.snapshot,
    runId: "run-review-ready"
  });
  assert.equal(issued.written, true);
  assert.equal(issued.manifest.driver.id, "independent-review");
  assert.equal(issued.verdict.reviewer.id, INDEPENDENT_REVIEW_REVIEWER_ID);
  assert.equal(issued.verdict.status, "pass");
  assert.deepEqual(issued.manifest.evidence_records.map((record) => record.type), ["review-report"]);
  assert.equal(
    issued.manifest.evidence_records[0].observation.data.review_verdict_id,
    issued.verdict.id
  );
  assert.ok(issued.manifest.evidence_records[0].artifacts.length >= 1);

  const stored = await listReviewVerdicts(fixture.dataRoot, fixture.snapshot.repository.identity, {
    runId: "run-review-ready",
    headSha: fixture.snapshot.repository.git.head_sha
  });
  assert.equal(stored.some((verdict) => verdict.id === issued.verdict.id), true);

  const trustContext = await loadTrustedEvaluationContext({ snapshot: fixture.snapshot });
  assert.ok(trustContext.evidence.some((record) => record.type === "review-report"));

  const ready = evaluateDeliveryReadiness({
    run: {
      id: "run-review-ready",
      current_head_sha: fixture.snapshot.repository.git.head_sha,
      gates: { scope: { status: "approved" }, delivery: { status: "pending" } }
    },
    criteria: [],
    reviewVerdicts: stored,
    findings: [],
    implementationActorIds: ["implementer-agent"],
    trustContext,
    profile: "full"
  });
  assert.equal(ready.ready, true, JSON.stringify(ready.reasons));

  const implementerAsReviewer = evaluateDeliveryReadiness({
    run: {
      id: "run-review-ready",
      current_head_sha: fixture.snapshot.repository.git.head_sha,
      gates: { scope: { status: "approved" }, delivery: { status: "pending" } }
    },
    criteria: [],
    reviewVerdicts: stored.map((verdict) => ({
      ...verdict,
      reviewer: { ...verdict.reviewer, id: "implementer-agent" }
    })),
    findings: [],
    implementationActorIds: ["implementer-agent"],
    trustContext,
    profile: "full"
  });
  assert.equal(implementerAsReviewer.ready, false);
  assert.ok(implementerAsReviewer.reasons.some((reason) => reason.code === "independent_review_missing"));
});

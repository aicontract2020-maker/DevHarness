import assert from "node:assert/strict";
import test from "node:test";

import { createReviewScorecard } from "../src/review-scorecard.mjs";

const sha = "a".repeat(40);
const scopeHash = "b".repeat(64);

function input() {
  return {
    run: {
      id: "run-1",
      current_head_sha: sha,
      repository: { identity: "example/project" },
      gates: { scope: { status: "approved" }, delivery: { status: "pending" } }
    },
    scopeHash,
    harnessVersion: "harness-v1",
    title: "Password reset delivery review",
    requirements: [{ id: "REQ-1", criterion_ids: ["AC-1"] }],
    criticalFlows: [{ id: "FLOW-1", title: "Reset password", status: "confirmed", source_refs: ["system-model"] }],
    criteria: [{
      id: "AC-1",
      claim: "A user can reset a password.",
      blocking: true,
      category: "behavior",
      proof: { pack: "web", driver: "browser", recipe: "Run the browser flow.", evidence_types: ["browser-snapshot"], independent: true, required_level: "E3" },
      verdict: { status: "pass", evidence_refs: ["EV-1"] }
    }],
    evidence: [{ id: "EV-1", run_id: "run-1", criterion_ids: ["AC-1"], type: "browser-snapshot", level: "E3", producer: { id: "reviewer" }, subject: { commit_sha: sha }, observation: { result: "pass" } }],
    traces: [{ criterion_id: "AC-1", requirement_refs: ["REQ-1"], task_refs: ["TASK-1"], change_refs: ["src/reset.ts"], review_refs: ["review-1"] }],
    reviewVerdicts: [{ id: "review-1", head_sha: sha, status: "pass", reviewer: { id: "reviewer" } }],
    reviewChecks: [{ id: "review-current-head", label: "Independent current-head review", status: "pass", source_refs: ["review-1"] }],
    findings: [],
    implementationActorIds: ["implementer"],
    unknowns: [],
    conflicts: [],
    orphanTaskIds: [],
    orphanChangeRefs: [],
    unnecessaryQuestionIds: [],
    lateScopeChangeIds: [],
    generatedAt: "2026-08-31T14:00:00.000Z",
    dataSource: "runtime"
  };
}

test("scorecard is deterministic when unordered inputs are reordered", () => {
  const first = input();
  first.requirements.push({ id: "REQ-2", criterion_ids: ["AC-2"] });
  first.criteria.push({
    id: "AC-2", claim: "Expired tokens fail.", blocking: true, category: "security",
    proof: { pack: "api", driver: "contract", recipe: "Run expiry tests.", evidence_types: ["test-result"], independent: true, required_level: "E2" },
    verdict: { status: "blocked", evidence_refs: [] }
  });
  first.traces.push({ criterion_id: "AC-2", requirement_refs: ["REQ-2"], task_refs: ["TASK-2"], change_refs: ["src/token.ts"], review_refs: [] });

  const second = structuredClone(first);
  second.requirements.reverse();
  second.criteria.reverse();
  second.traces.reverse();

  assert.deepEqual(createReviewScorecard(first), createReviewScorecard(second));
});

test("a failed hard gate dominates a high numeric score", () => {
  const scorecard = createReviewScorecard(input());
  assert.notEqual(scorecard.verdict, "ready");
  assert.ok(scorecard.proof_coverage.score >= 60);
  assert.ok(scorecard.hard_gates.some((gate) => gate.status === "fail"));
});

test("caller evidence cannot satisfy verification without trusted context", () => {
  const scorecard = createReviewScorecard(input());
  const criterion = scorecard.criteria.find((item) => item.id === "AC-1");
  assert.equal(scorecard.integrity.trusted_context, false);
  assert.equal(criterion.achieved_evidence_level, "E0");
  assert.equal(criterion.status, "blocked");
  assert.equal(scorecard.proof_coverage.dimensions.find((item) => item.id === "verification-sufficiency").proved, 0);
});

test("cross-run evidence is rejected by delivery readiness projection", () => {
  const value = input();
  value.evidence[0].run_id = "another-run";
  const scorecard = createReviewScorecard(value);
  assert.equal(scorecard.criteria[0].status, "blocked");
});

test("docs-only profile is ready when scope is approved and unknowns are cleared", () => {
  const value = input();
  value.criteria = [];
  value.requirements = [];
  value.criticalFlows = [];
  value.traces = [];
  value.reviewVerdicts = [];
  value.reviewChecks = [];
  value.evidence = [];
  value.unknowns = [];
  value.profile = "docs-only";
  value.title = "Docs-only verification";
  const scorecard = createReviewScorecard(value);
  assert.equal(scorecard.verdict, "ready");
  assert.equal(scorecard.exception_counts.blocking, 0);
  assert.ok(scorecard.hard_gates.every((gate) => gate.status === "pass"));
});

test("docs-only profile stays not-ready while verify-pending unknown remains", () => {
  const value = input();
  value.criteria = [];
  value.requirements = [];
  value.criticalFlows = [];
  value.traces = [];
  value.reviewVerdicts = [];
  value.reviewChecks = [];
  value.evidence = [];
  value.unknowns = [{
    id: "verify-pending",
    title: "Verification evidence pending",
    summary: "Declared quality verification still needs execute/attest."
  }];
  value.profile = "docs-only";
  value.title = "Post-scope delivery";
  const scorecard = createReviewScorecard(value);
  assert.notEqual(scorecard.verdict, "ready");
  assert.equal(scorecard.exception_counts.blocking, 1);
  assert.equal(scorecard.exception_counts.unknowns, 1);
  assert.equal(scorecard.exceptions.some((item) => item.type === "review"), false);
});

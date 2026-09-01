import assert from "node:assert/strict";
import test from "node:test";

import { evaluateCapabilityRequest } from "../src/authority-policy.mjs";
import { evaluateDesignStrategy } from "../src/strategy-policy.mjs";
import { evaluateSystemModel } from "../src/system-model-policy.mjs";
import { evaluateTaskProgress } from "../src/task-progress-policy.mjs";
import { evaluateTaskContract } from "../src/task-policy.mjs";

test("self-declared human data cannot approve a high-risk capability", () => {
  const request = {
    status: "approved",
    requests: [{ id: "db", capability: "database-runtime", risk: "high", authority: "explicit", decision: "approved", decided_by: { id: "developer", kind: "human" }, decided_at: "2026-08-29T12:00:00Z" }]
  };
  const result = evaluateCapabilityRequest(request);
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => reason.code === "human_authority_required"));
});

test("explicit authority cannot be self-approved and aggregate status follows decisions", () => {
  const result = evaluateCapabilityRequest({
    status: "approved",
    requests: [
      { id: "browser", capability: "browser-runtime", risk: "medium", authority: "explicit", decision: "approved", decided_by: { id: "agent", kind: "agent" }, decided_at: "2026-08-29T12:00:00Z" },
      { id: "install", capability: "dependency-install", risk: "medium", authority: "explicit", decision: "pending" }
    ]
  });
  assert.ok(result.reasons.some((reason) => reason.code === "human_authority_required"));
  assert.ok(result.reasons.some((reason) => reason.code === "authority_status_mismatch"));
});

test("an approved strategy is bound to a human approval and unique decisions", () => {
  const result = evaluateDesignStrategy({ status: "approved", artifact_sha256: "a".repeat(64), decisions: [{ id: "modules" }, { id: "modules" }], exceptions: [] });
  assert.equal(result.valid, false);
  assert.ok(result.reasons.some((reason) => reason.code === "strategy_human_approval_missing"));
  assert.ok(result.reasons.some((reason) => reason.code === "strategy_decision_duplicate"));
});

test("an agent cannot approve a strategy exception", () => {
  const hash = "a".repeat(64);
  const result = evaluateDesignStrategy({
    status: "approved",
    artifact_sha256: hash,
    approved_by: { id: "developer", kind: "human" },
    approved_at: "2026-08-29T12:00:00Z",
    decisions: [{ id: "modules" }],
    exceptions: [{ id: "bypass", decision_id: "modules", status: "approved", approved_by: { id: "agent", kind: "agent" }, approved_at: "2026-08-29T12:01:00Z" }]
  }, { approvedArtifactSha256: hash });
  assert.ok(result.reasons.some((reason) => reason.code === "strategy_exception_human_approval_missing"));
});

test("system model validates references, flow order, unknowns and false-positive evidence", () => {
  const model = {
    verdict: "complete",
    components: [{ id: "api" }],
    stores: [{ id: "db" }],
    entities: [{ id: "user", store_id: "missing", owner_component_id: "api" }],
    trust_boundaries: [],
    flows: [{ id: "flow", steps: [{ sequence: 2, component_id: "ghost", reads: [], writes: ["user"], calls: [], evidence_refs: [] }] }],
    invariants: [],
    risks: [{ id: "risk", classification: "false-positive", evidence_refs: [] }],
    unknowns: ["authorization behavior"]
  };
  const result = evaluateSystemModel(model);
  assert.equal(result.valid, false);
  for (const code of ["entity_store_missing", "flow_sequence_invalid", "flow_component_missing", "false_positive_unproved", "complete_with_unknowns"]) {
    assert.ok(result.reasons.some((reason) => reason.code === code), code);
  }
});

test("task progress cannot report impossible completion", () => {
  const result = evaluateTaskProgress({ status: "completed", completed_count: 99, total_count: 1, blockers: ["still blocked"], updated_at: "2026-08-29T12:00:00Z", next_update_at: "2026-08-29T11:00:00Z" });
  assert.ok(result.reasons.some((reason) => reason.code === "progress_count_invalid"));
  assert.ok(result.reasons.some((reason) => reason.code === "completed_progress_inconsistent"));
});

test("task progress rejects contradictory active and blocker projections", () => {
  const activeDone = evaluateTaskProgress({ status: "in-progress", completed_count: 1, total_count: 1, blockers: [], updated_at: "2026-08-29T12:00:00Z", next_update_at: "2026-08-29T13:00:00Z" });
  assert.ok(activeDone.reasons.some((reason) => reason.code === "active_progress_complete"));
  const activeBlocked = evaluateTaskProgress({ status: "in-progress", completed_count: 0, total_count: 1, blockers: ["waiting"], updated_at: "2026-08-29T12:00:00Z", next_update_at: "2026-08-29T13:00:00Z" });
  assert.ok(activeBlocked.reasons.some((reason) => reason.code === "blockers_status_mismatch"));
});

test("ready tasks cannot hide database or security impact", () => {
  const result = evaluateTaskContract({
    id: "task-1",
    status: "ready",
    impacts: {
      database: { status: "affected", subjects: [], required_proof: [] },
      security: { status: "unknown", subjects: [], required_proof: [] }
    }
  });
  assert.ok(result.reasons.some((reason) => reason.code === "task_impact_proof_missing"));
  assert.ok(result.reasons.some((reason) => reason.code === "task_impact_unknown"));
});

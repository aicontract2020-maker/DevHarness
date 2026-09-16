import assert from "node:assert/strict";
import test from "node:test";

import { evaluateDeliveryReadiness } from "../src/delivery-readiness.mjs";

const sha = "a".repeat(40);

function readyInput() {
  return {
    run: {
      current_head_sha: sha,
      gates: { scope: { status: "approved" }, delivery: { status: "pending" } }
    },
    criteria: [
      {
        id: "AC-1",
        blocking: true,
        proof: {
          evidence_types: ["test-result", "screenshot"],
          independent: true
        },
        verdict: {
          status: "pass",
          evidence_refs: ["evidence-test", "evidence-screenshot"]
        }
      }
    ],
    evidence: [
      {
        id: "evidence-test",
        criterion_ids: ["AC-1"],
        type: "test-result",
        producer: { id: "verifier-1" },
        subject: { commit_sha: sha },
        observation: { result: "pass" }
      },
      {
        id: "evidence-screenshot",
        criterion_ids: ["AC-1"],
        type: "screenshot",
        producer: { id: "verifier-1" },
        subject: { commit_sha: sha },
        observation: { result: "pass" }
      }
    ],
    reviewVerdicts: [
      {
        id: "review-1",
        head_sha: sha,
        status: "pass",
        reviewer: { id: "reviewer-1" }
      }
    ],
    findings: [],
    implementationActorIds: ["implementer-1"]
  };
}

function reasonCodes(result) {
  return result.reasons.map((reason) => reason.code);
}

test("caller-authored evidence and review data can never make delivery ready", () => {
  const result = evaluateDeliveryReadiness(readyInput());
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("trusted_delivery_context_missing"));
  assert.ok(reasonCodes(result).includes("trusted_review_evidence_missing"));
});

test("agent self-verification does not satisfy an independent criterion", () => {
  const input = readyInput();
  input.evidence.forEach((record) => {
    record.producer.id = "implementer-1";
  });
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("evidence_missing"));
});

test("evidence and review verdicts are invalidated by a new head commit", () => {
  const input = readyInput();
  input.run.current_head_sha = "c".repeat(40);
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("no_current_passing_evidence"));
  assert.ok(reasonCodes(result).includes("current_review_missing"));
});

test("every required evidence type must be present", () => {
  const input = readyInput();
  input.evidence = input.evidence.filter((record) => record.type !== "screenshot");
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("evidence_missing"));
  assert.ok(reasonCodes(result).includes("no_current_passing_evidence"));
});

test("blocking findings prevent delivery until resolved", () => {
  const input = readyInput();
  input.findings.push({
    id: "finding-1",
    head_sha: sha,
    severity: "blocking",
    status: "open"
  });
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("blocking_review_finding_open"));
});

test("an agent cannot accept a blocking risk on the developer's behalf", () => {
  const input = readyInput();
  input.findings.push({
    id: "finding-1",
    head_sha: sha,
    severity: "blocking",
    status: "accepted_risk",
    resolution: { resolved_by: { id: "reviewer-1", kind: "agent" } }
  });
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("blocking_risk_not_human_accepted"));

  input.findings[0].resolution.resolved_by = { id: "developer", kind: "human" };
  assert.equal(evaluateDeliveryReadiness(input).ready, false);
});

test("scope approval and an independent current-head review are mandatory", () => {
  const input = readyInput();
  input.run.gates.scope.status = "pending";
  input.reviewVerdicts[0].reviewer.id = "implementer-1";
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("scope_not_approved"));
  assert.ok(reasonCodes(result).includes("independent_review_missing"));
});

test("docs-only profile skips product-delivery review gates when criteria are empty", () => {
  const input = {
    run: {
      id: "run-1",
      current_head_sha: sha,
      gates: { scope: { status: "approved" }, delivery: { status: "pending" } }
    },
    criteria: [],
    reviewVerdicts: [],
    findings: [],
    profile: "docs-only"
  };
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, true);
  assert.deepEqual(reasonCodes(result), []);
});

test("docs-only profile still requires an approved scope gate", () => {
  const input = {
    run: {
      id: "run-1",
      current_head_sha: sha,
      gates: { scope: { status: "pending" }, delivery: { status: "pending" } }
    },
    criteria: [],
    reviewVerdicts: [],
    findings: [],
    profile: "docs-only"
  };
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("scope_not_approved"));
  assert.equal(reasonCodes(result).includes("current_review_missing"), false);
});

test("full profile still blocks on missing review when criteria are empty", () => {
  const input = {
    run: {
      id: "run-1",
      current_head_sha: sha,
      gates: { scope: { status: "approved" }, delivery: { status: "pending" } }
    },
    criteria: [],
    reviewVerdicts: [],
    findings: []
  };
  const result = evaluateDeliveryReadiness(input);
  assert.equal(result.ready, false);
  assert.ok(reasonCodes(result).includes("trusted_delivery_context_missing"));
  assert.ok(reasonCodes(result).includes("current_review_missing"));
});

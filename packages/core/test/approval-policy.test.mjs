import assert from "node:assert/strict";
import test from "node:test";

import {
  approvalRequestHash,
  approvalRequestSigningPayload,
  approvalReceiptHash,
  approvalReceiptSigningPayload,
  evaluateApprovalReceiptBinding,
  evaluateApprovalReceiptSet,
  evaluateApprovalRequestBinding,
  evaluateApprovalRequestSet
} from "../src/approval-policy.mjs";

const head = "a".repeat(40);
const subjectHash = "b".repeat(64);
const issuer = { id: "supervisor-local", fingerprint: "d".repeat(64) };

function attest(value, payloadSha256) {
  value.attestation = {
    issuer_id: issuer.id,
    issuer_fingerprint: issuer.fingerprint,
    payload_sha256: payloadSha256,
    algorithm: "Ed25519",
    signature: "A".repeat(86) + "=="
  };
  return value;
}

function request(overrides = {}) {
  const value = {
    schema_version: 1,
    id: "approval-request-1",
    run_id: "run-1",
    repository_identity: "github.com/example/project",
    commit_sha: head,
    gate: "scope",
    subject: { id: "scope-v1", artifact_sha256: subjectHash },
    nonce: "nonce-0123456789abcdef",
    requested_at: "2026-08-30T12:00:00.000Z",
    expires_at: "2026-08-30T13:00:00.000Z",
    status: "pending",
    ...overrides
  };
  return attest(value, approvalRequestHash(value));
}

function receipt(sourceRequest, overrides = {}) {
  const value = {
    schema_version: 1,
    id: "approval-receipt-1",
    request_id: sourceRequest.id,
    request_sha256: approvalRequestHash(sourceRequest),
    run_id: sourceRequest.run_id,
    repository_identity: sourceRequest.repository_identity,
    commit_sha: sourceRequest.commit_sha,
    gate: sourceRequest.gate,
    subject: structuredClone(sourceRequest.subject),
    nonce: sourceRequest.nonce,
    decision: "approved",
    decided_at: "2026-08-30T12:05:00.000Z",
    decided_by: { id: "developer", kind: "human" },
    source: "interactive-human-gate",
    expires_at: sourceRequest.expires_at,
    ...overrides
  };
  return attest(value, approvalReceiptHash(value));
}

test("approval request hashing is canonical, domain separated and mutation sensitive", () => {
  const original = request();
  const reordered = Object.fromEntries(Object.entries(original).reverse());
  assert.equal(approvalRequestHash(reordered), original.attestation.payload_sha256);
  assert.match(approvalRequestSigningPayload(original).toString("utf8"), /^devharness\.approval-request\.v1\0/);

  const changed = structuredClone(original);
  changed.subject.artifact_sha256 = "c".repeat(64);
  assert.notEqual(approvalRequestHash(changed), original.request_sha256);
  assert.notEqual(
    approvalRequestSigningPayload(original).toString("hex"),
    approvalReceiptSigningPayload(receipt(original)).toString("hex")
  );
});

test("approval request binding rejects stale, replayable or mismatched requests", () => {
  const current = request();
  assert.equal(evaluateApprovalRequestBinding(current, {
    now: new Date("2026-08-30T12:30:00.000Z"),
    repositoryIdentity: current.repository_identity,
    relevantHeadSha: current.relevant_head_sha,
    issuer
  }).valid, true);

  const tampered = structuredClone(current);
  tampered.subject.id = "scope-v2";
  const result = evaluateApprovalRequestBinding(tampered, {
    now: new Date("2026-08-30T14:00:00.000Z"),
    repositoryIdentity: "github.com/other/project",
    relevantHeadSha: "d".repeat(40),
    issuer: { supervisor_id: "other", key_id: "other" }
  });
  for (const code of ["approval_request_hash_invalid", "approval_request_expired", "approval_repository_mismatch", "approval_head_mismatch", "approval_issuer_mismatch"]) {
    assert.ok(result.reasons.some((reason) => reason.code === code), code);
  }
});

test("receipt binding requires the exact request, human decision and bounded expiry", () => {
  const pending = request();
  const approved = receipt(pending);
  assert.equal(evaluateApprovalReceiptBinding(approved, pending, {
    now: new Date("2026-08-30T12:30:00.000Z"),
    issuer
  }).valid, true);

  const forged = receipt(pending, {
    request_sha256: "e".repeat(64),
    relevant_head_sha: "f".repeat(40),
    nonce: "different-nonce-123456",
    subject: { id: "other-scope", artifact_sha256: "0".repeat(64) },
    decided_by: { id: "agent", kind: "agent" },
    expires_at: "2026-08-30T14:00:00.000Z"
  });
  const result = evaluateApprovalReceiptBinding(forged, pending, {
    now: new Date("2026-08-30T12:30:00.000Z"),
    issuer
  });
  for (const code of ["approval_request_hash_mismatch", "approval_head_mismatch", "approval_nonce_mismatch", "approval_subject_mismatch", "approval_human_decision_required", "approval_expiry_exceeds_request"]) {
    assert.ok(result.reasons.some((reason) => reason.code === code), code);
  }
});

test("receipt decision must occur during the request window and remain current", () => {
  const pending = request();
  const result = evaluateApprovalReceiptBinding(receipt(pending, {
    decided_at: "2026-08-30T13:01:00.000Z",
    expires_at: "2026-08-30T13:00:00.000Z"
  }), pending, { now: new Date("2026-08-30T13:30:00.000Z"), issuer });
  assert.ok(result.reasons.some((reason) => reason.code === "approval_decision_outside_request_window"));
  assert.ok(result.reasons.some((reason) => reason.code === "approval_receipt_expired"));

  const future = evaluateApprovalReceiptBinding(receipt(pending, {
    decided_at: "2026-08-30T12:45:00.000Z"
  }), pending, { now: new Date("2026-08-30T12:30:00.000Z"), issuer });
  assert.ok(future.reasons.some((reason) => reason.code === "approval_decision_in_future"));
});

test("request and receipt sets reject duplicate ids, nonces and conflicting decisions", () => {
  const first = request();
  const second = request({ id: "approval-request-2" });
  assert.ok(evaluateApprovalRequestSet([first, second]).reasons.some((reason) => reason.code === "approval_request_nonce_duplicate"));

  const approve = receipt(first);
  const reject = receipt(first, { id: "approval-receipt-2", decision: "rejected" });
  const result = evaluateApprovalReceiptSet([approve, reject]);
  assert.ok(result.reasons.some((reason) => reason.code === "approval_request_decided_multiple_times"));
  assert.ok(result.reasons.some((reason) => reason.code === "approval_decision_conflict"));
});

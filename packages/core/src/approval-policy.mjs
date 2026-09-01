import { createHash } from "node:crypto";

const REQUEST_DOMAIN = "devharness.approval-request.v1\0";
const RECEIPT_DOMAIN = "devharness.approval-receipt.v1\0";

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function unsigned(value) {
  const payload = structuredClone(value);
  delete payload.attestation;
  return payload;
}

function signingPayload(domain, value) {
  return Buffer.from(`${domain}${JSON.stringify(canonical(unsigned(value)))}`, "utf8");
}

function hash(payload) {
  return createHash("sha256").update(payload).digest("hex");
}

function reason(reasons, code, message) {
  reasons.push({ code, message });
}

function issuerMatches(attestation, issuer) {
  return Boolean(
    attestation && issuer &&
    attestation.issuer_id === issuer.id &&
    attestation.issuer_fingerprint === issuer.fingerprint &&
    attestation.algorithm === "Ed25519"
  );
}

function sameSubject(left, right) {
  return left?.id === right?.id && left?.artifact_sha256 === right?.artifact_sha256;
}

export function approvalRequestSigningPayload(request) {
  return signingPayload(REQUEST_DOMAIN, request);
}

export function approvalReceiptSigningPayload(receipt) {
  return signingPayload(RECEIPT_DOMAIN, receipt);
}

export function approvalRequestHash(request) {
  return hash(approvalRequestSigningPayload(request));
}

export function approvalReceiptHash(receipt) {
  return hash(approvalReceiptSigningPayload(receipt));
}

export function evaluateApprovalRequestBinding(request, {
  now = new Date(),
  repositoryIdentity,
  relevantHeadSha,
  issuer
} = {}) {
  const reasons = [];
  const requestedAt = Date.parse(request?.requested_at);
  const expiresAt = Date.parse(request?.expires_at);
  const currentTime = now instanceof Date ? now.getTime() : Date.parse(now);

  if (request?.attestation?.payload_sha256 !== approvalRequestHash(request)) {
    reason(reasons, "approval_request_hash_invalid", "Approval request payload hash is invalid.");
  }
  if (!issuerMatches(request?.attestation, issuer)) {
    reason(reasons, "approval_issuer_mismatch", "Approval request issuer does not match the pinned Supervisor.");
  }
  if (repositoryIdentity !== undefined && request?.repository_identity !== repositoryIdentity) {
    reason(reasons, "approval_repository_mismatch", "Approval request is for a different repository.");
  }
  if (relevantHeadSha !== undefined && request?.relevant_head_sha !== relevantHeadSha) {
    reason(reasons, "approval_head_mismatch", "Approval request is bound to a different revision.");
  }
  if (!Number.isFinite(requestedAt) || !Number.isFinite(expiresAt) || requestedAt >= expiresAt) {
    reason(reasons, "approval_request_window_invalid", "Approval request time window is invalid.");
  } else if (Number.isFinite(currentTime) && currentTime > expiresAt) {
    reason(reasons, "approval_request_expired", "Approval request has expired.");
  }
  if (request?.status !== "pending") {
    reason(reasons, "approval_request_not_pending", "Approval request is not pending.");
  }
  return { valid: reasons.length === 0, reasons };
}

export function evaluateApprovalReceiptBinding(receipt, request, {
  now = new Date(),
  issuer
} = {}) {
  const reasons = [];
  const requestedAt = Date.parse(request?.requested_at);
  const requestExpiry = Date.parse(request?.expires_at);
  const decidedAt = Date.parse(receipt?.decided_at);
  const receiptExpiry = Date.parse(receipt?.expires_at);
  const currentTime = now instanceof Date ? now.getTime() : Date.parse(now);

  if (receipt?.attestation?.payload_sha256 !== approvalReceiptHash(receipt)) {
    reason(reasons, "approval_receipt_hash_invalid", "Approval receipt payload hash is invalid.");
  }
  if (!issuerMatches(receipt?.attestation, issuer)) {
    reason(reasons, "approval_issuer_mismatch", "Approval receipt issuer does not match the pinned Supervisor.");
  }
  if (receipt?.request_id !== request?.id) reason(reasons, "approval_request_id_mismatch", "Receipt references another approval request.");
  if (receipt?.request_sha256 !== approvalRequestHash(request)) reason(reasons, "approval_request_hash_mismatch", "Receipt is not bound to the exact approval request.");
  if (receipt?.run_id !== request?.run_id) reason(reasons, "approval_run_mismatch", "Receipt is bound to another run.");
  if (receipt?.repository_identity !== request?.repository_identity) reason(reasons, "approval_repository_mismatch", "Receipt is bound to another repository.");
  if (receipt?.relevant_head_sha !== request?.relevant_head_sha) reason(reasons, "approval_head_mismatch", "Receipt is bound to another revision.");
  if (receipt?.gate !== request?.gate) reason(reasons, "approval_gate_mismatch", "Receipt is bound to another gate.");
  if (receipt?.nonce !== request?.nonce) reason(reasons, "approval_nonce_mismatch", "Receipt nonce does not match the request.");
  if (!sameSubject(receipt?.subject, request?.subject)) reason(reasons, "approval_subject_mismatch", "Receipt is bound to another subject.");
  if (receipt?.decided_by?.kind !== "human" || receipt?.source !== "interactive-human-gate") {
    reason(reasons, "approval_human_decision_required", "A foreground human decision is required.");
  }
  if (!Number.isFinite(decidedAt) || decidedAt < requestedAt || decidedAt > requestExpiry) {
    reason(reasons, "approval_decision_outside_request_window", "Decision occurred outside the approval request window.");
  }
  if (Number.isFinite(currentTime) && Number.isFinite(decidedAt) && decidedAt > currentTime) {
    reason(reasons, "approval_decision_in_future", "Approval decision time is in the future.");
  }
  if (!Number.isFinite(receiptExpiry) || receiptExpiry > requestExpiry) {
    reason(reasons, "approval_expiry_exceeds_request", "Receipt expiry exceeds the approval request.");
  }
  if (Number.isFinite(currentTime) && Number.isFinite(receiptExpiry) && currentTime > receiptExpiry) {
    reason(reasons, "approval_receipt_expired", "Approval receipt has expired.");
  }
  return { valid: reasons.length === 0, reasons };
}

export function evaluateApprovalRequestSet(requests) {
  const reasons = [];
  const ids = new Set();
  const nonces = new Set();
  for (const request of requests) {
    if (ids.has(request.id)) reason(reasons, "approval_request_id_duplicate", `Approval request id ${request.id} is duplicated.`);
    if (nonces.has(request.nonce)) reason(reasons, "approval_request_nonce_duplicate", `Approval request nonce ${request.nonce} is duplicated.`);
    ids.add(request.id);
    nonces.add(request.nonce);
  }
  return { valid: reasons.length === 0, reasons };
}

export function evaluateApprovalReceiptSet(receipts) {
  const reasons = [];
  const ids = new Set();
  const byRequest = new Map();
  for (const receipt of receipts) {
    if (ids.has(receipt.id)) reason(reasons, "approval_receipt_id_duplicate", `Approval receipt id ${receipt.id} is duplicated.`);
    ids.add(receipt.id);
    const previous = byRequest.get(receipt.request_id);
    if (previous) {
      reason(reasons, "approval_request_decided_multiple_times", `Approval request ${receipt.request_id} has multiple decisions.`);
      if (previous.decision !== receipt.decision) reason(reasons, "approval_decision_conflict", `Approval request ${receipt.request_id} has conflicting decisions.`);
    } else {
      byRequest.set(receipt.request_id, receipt);
    }
  }
  return { valid: reasons.length === 0, reasons };
}

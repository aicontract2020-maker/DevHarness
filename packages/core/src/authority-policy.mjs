import { capabilityArtifactHash, isTrustedEvaluationContext } from "./trusted-context.mjs";

const HUMAN_ONLY = new Set(["credential-reference", "vcs-write", "deployment", "destructive-action"]);

export function evaluateCapabilityRequest(document, { now = new Date(), trustContext } = {}) {
  const reasons = [];
  const trusted = isTrustedEvaluationContext(trustContext);
  const inventory = trusted ? trustContext.inventory : null;
  const approvals = trusted ? trustContext.approvals : [];
  if (!trusted) reasons.push({ code: "trusted_authority_context_missing", summary: "Capability decisions require approvals loaded through the trusted runtime boundary." });
  if (inventory && document?.repository_identity && document.repository_identity !== inventory.repositoryIdentity) reasons.push({ code: "authority_repository_mismatch", summary: "Capability request repository does not match the live repository." });
  const seen = new Set();
  for (const request of document?.requests ?? []) {
    if (seen.has(request.id)) reasons.push({ code: "capability_duplicate", summary: `Capability request ${request.id} is duplicated.`, subject: request.id });
    seen.add(request.id);
    const requiresHuman = HUMAN_ONLY.has(request.capability) || request.risk === "high" || request.authority === "human-only" || request.authority === "explicit";
    const approval = approvals.find((receipt) => receipt.gate === "capability" && receipt.subject?.id === request.id && receipt.subject.artifact_sha256 === capabilityArtifactHash(request) && receipt.repository_identity === document.repository_identity && receipt.relevant_head_sha === inventory?.currentHeadSha && receipt.decision === "approved");
    if (requiresHuman && request.decision === "approved" && !approval) {
      reasons.push({ code: "human_authority_required", summary: `Capability ${request.id} requires an independent current-revision human approval receipt.`, subject: request.id });
    }
    if (request.decision === "approved" && requiresHuman && approval?.expires_at && Date.parse(approval.expires_at) <= now.getTime()) {
      reasons.push({ code: "approval_expired", summary: `Capability approval ${request.id} has expired.`, subject: request.id });
    }
  }
  const decisions = (document?.requests ?? []).map((request) => request.decision);
  const decided = decisions.filter((decision) => decision === "approved" || decision === "not-needed").length;
  const denied = decisions.filter((decision) => decision === "denied").length;
  const pending = decisions.filter((decision) => decision === "pending").length;
  const expectedStatus = pending > 0 || (denied > 0 && decided > 0) ? (decided > 0 ? "partially-approved" : "pending") : denied > 0 ? "denied" : "approved";
  if (document?.status !== expectedStatus) {
    reasons.push({ code: "authority_status_mismatch", summary: `Authority document status must be ${expectedStatus} for its request decisions.` });
  }
  return { valid: reasons.length === 0, reasons };
}

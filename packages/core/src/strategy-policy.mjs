import { artifactHash, isTrustedEvaluationContext, strategyArtifactHash } from "./trusted-context.mjs";

export function evaluateDesignStrategy(strategy, { trustContext } = {}) {
  const reasons = [];
  const trusted = isTrustedEvaluationContext(trustContext);
  const inventory = trusted ? trustContext.inventory : null;
  const approvals = trusted ? trustContext.approvals : [];
  if (!trusted) reasons.push({ code: "strategy_trusted_context_missing", summary: "Strategy approval requires the trusted runtime boundary." });
  const actualHash = strategyArtifactHash(strategy ?? {});
  if (strategy?.artifact_sha256 !== actualHash) reasons.push({ code: "strategy_artifact_hash_invalid", summary: "Strategy content does not match its declared artifact hash." });
  if (inventory && (strategy?.repository_identity !== inventory.repositoryIdentity || strategy?.commit_sha !== inventory.currentHeadSha)) reasons.push({ code: "strategy_revision_mismatch", summary: "Strategy is not bound to the current repository revision." });
  if (strategy?.status === "approved") {
    const approval = approvals.find((receipt) => receipt.gate === "strategy" && receipt.subject?.id === strategy.id && receipt.subject.artifact_sha256 === actualHash && receipt.repository_identity === inventory?.repositoryIdentity && receipt.relevant_head_sha === inventory?.currentHeadSha && receipt.decision === "approved");
    if (!approval) reasons.push({ code: "strategy_human_approval_missing", summary: "An approved design strategy requires an independent current-revision human gate receipt." });
    if (approval?.expires_at && Date.parse(approval.expires_at) <= Date.now()) reasons.push({ code: "strategy_approval_expired", summary: "The strategy approval receipt has expired." });
  }
  const seen = new Set();
  for (const decision of strategy?.decisions ?? []) {
    if (seen.has(decision.id)) reasons.push({ code: "strategy_decision_duplicate", summary: `Strategy decision ${decision.id} is duplicated.`, subject: decision.id });
    seen.add(decision.id);
  }
  for (const exception of strategy?.exceptions ?? []) {
    if (!seen.has(exception.decision_id)) reasons.push({ code: "strategy_exception_orphan", summary: `Strategy exception ${exception.id} references an unknown decision.`, subject: exception.id });
    if (exception.status === "approved") {
      const exceptionHash = artifactHash(exception, ["status", "approved_by", "approved_at"]);
      const approval = approvals.find((receipt) => receipt.gate === "strategy-exception" && receipt.subject?.id === exception.id && receipt.subject.artifact_sha256 === exceptionHash && receipt.repository_identity === inventory?.repositoryIdentity && receipt.relevant_head_sha === inventory?.currentHeadSha && receipt.decision === "approved");
      if (!approval) reasons.push({ code: "strategy_exception_human_approval_missing", summary: `Approved strategy exception ${exception.id} requires an independent human gate receipt.`, subject: exception.id });
    }
  }
  return { valid: reasons.length === 0, reasons };
}

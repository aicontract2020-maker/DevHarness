/**
 * Compress live Alignment friction: conservative infer picks + batch research caps.
 * Mirrors verify-capabilities.mjs for the Alignment / Gate 1 path.
 */

import { unresolvedLiveAlignmentDecisions } from "./live-alignment-continue.mjs";
import {
  loadCapabilityAuthorizationView,
  requestCapabilityAuthorization
} from "./capability-authorization.mjs";

const REQUESTABLE = new Set(["unrequested", "expired", "stale", "pending"]);

/**
 * Prefer "Infer conservatively" for every unresolved decision that offers it.
 * @returns {{ pairs: Array<{decisionId:string,optionId:string}>, skipped: Array<{decisionId:string,reason:string}>, unresolved_before: number }}
 */
export function pickConservativeInferAnswers(packet, developerAnswers = []) {
  const unresolved = unresolvedLiveAlignmentDecisions(packet, developerAnswers);
  const pairs = [];
  const skipped = [];
  for (const decision of unresolved) {
    const options = Array.isArray(decision?.options) ? decision.options : [];
    const infer = options.find((option) => {
      const id = String(option?.id ?? "");
      const label = String(option?.label ?? "");
      return id.endsWith("-infer") || /infer\s+conservatively/i.test(label);
    });
    if (!infer?.id) {
      skipped.push({
        decisionId: decision.id,
        reason: "No Infer conservatively option on this decision."
      });
      continue;
    }
    pairs.push({ decisionId: decision.id, optionId: infer.id });
  }
  return {
    pairs,
    skipped,
    unresolved_before: unresolved.length
  };
}

/**
 * Research / network capabilities still blocking Alignment continue.
 */
export function summarizeAlignCapabilityGap(view) {
  const required = [];
  const seen = new Set();
  const push = (id) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    required.push(id);
  };

  for (const task of view?.research_tasks ?? []) {
    if (task?.status === "pending-approval" || task?.status === "blocked") {
      push(task.id);
    }
  }
  for (const item of view?.capabilities ?? []) {
    const id = item?.request?.id;
    if (!id) continue;
    const isResearch = id.startsWith("research-task-") || id === "network-research";
    if (isResearch && REQUESTABLE.has(item.status)) push(id);
  }

  const byId = new Map((view?.capabilities ?? []).map((item) => [item.request?.id, item]));
  const missing = required.map((id) => {
    const item = byId.get(id);
    return {
      id,
      status: item?.status ?? "unrequested",
      approval_request_id: item?.approval_request_id ?? null
    };
  });
  const pending = missing.filter((item) => item.status === "pending");
  const needRequest = missing.filter((item) => item.status !== "pending" && item.status !== "approved");
  return {
    allowed: missing.every((item) => item.status === "approved") || missing.length === 0,
    required_capability_ids: required,
    missing,
    pending_ids: pending.map((item) => item.id),
    need_request_ids: needRequest.map((item) => item.id)
  };
}

/**
 * Request every research capability still blocking Alignment.
 */
export async function requestMissingAlignCapabilities({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  authorizationView = null,
  expiresInMinutes = null,
  now = () => new Date()
}) {
  const current = typeof now === "function" ? now() : now;
  const view = authorizationView ?? await loadCapabilityAuthorizationView({
    dataRoot,
    supervisorRoot,
    repositoryIdentity,
    runId,
    now: current
  });
  const gap = summarizeAlignCapabilityGap(view);
  const results = [];
  for (const capabilityId of gap.missing.map((item) => item.id)) {
    const result = await requestCapabilityAuthorization({
      dataRoot,
      supervisorRoot,
      repositoryIdentity,
      runId,
      capabilityId,
      expiresInMinutes,
      now: () => current
    });
    results.push({
      capability_id: result.capability?.id ?? capabilityId,
      request_id: result.request?.id ?? null,
      receipt_id: result.receipt?.id ?? null,
      reused: Boolean(result.reused),
      reuse_kind: result.reuse_kind ?? null,
      expires_at: result.receipt?.expires_at ?? result.request?.expires_at ?? null
    });
  }
  const approveRequestIds = [...new Set(
    results
      .filter((item) => item.request_id && !item.receipt_id)
      .map((item) => item.request_id)
  )];
  return {
    schema_version: 1,
    kind: "align-capability-batch",
    run_id: runId,
    gap,
    results,
    approve_request_ids: approveRequestIds,
    already_satisfied: gap.allowed || (gap.missing.length > 0 && approveRequestIds.length === 0 && results.every((item) => item.receipt_id))
  };
}

export function alignCompressionHints({ status, unresolvedCount = 0, researchPending = 0 } = {}) {
  if (status === "question-blocked" || unresolvedCount > 0) {
    return "devharness answer --run ID --infer-conservative";
  }
  if (status === "waiting-research-authority" || researchPending > 0) {
    return "devharness request-capability --run ID --for-align --approve";
  }
  return null;
}

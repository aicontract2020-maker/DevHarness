import { evaluateVerificationExecutionAuthority } from "../../core/src/execution-authority.mjs";
import {
  loadCapabilityAuthorizationView,
  requestCapabilityAuthorization
} from "./capability-authorization.mjs";
import { loadRunSourceArtifact } from "./goal-run-store.mjs";

/**
 * Resolve commit/command defaults from the readiness summary written by advance.
 */
export async function resolveVerifyDefaultsFromReadiness({
  dataRoot,
  repositoryIdentity,
  runId,
  commandId = null,
  commitSha = null
}) {
  let resolvedCommandId = commandId;
  let resolvedCommitSha = commitSha;
  let readiness = null;
  try {
    const loaded = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, "artifact-readiness-summary");
    readiness = loaded.value;
    if (!resolvedCommandId && readiness?.verify_command_id) {
      resolvedCommandId = readiness.verify_command_id;
    }
    if (!resolvedCommitSha && readiness?.delivery_mode === "controlled-change" && readiness?.change_commit_sha) {
      resolvedCommitSha = readiness.change_commit_sha;
    }
  } catch {
    // optional
  }
  return {
    command_id: resolvedCommandId,
    commit_sha: resolvedCommitSha,
    readiness,
    controlled_change: readiness?.delivery_mode === "controlled-change" && readiness?.change_commit_sha && readiness?.head_sha
      ? {
        baseline_head_sha: readiness.head_sha,
        change_commit_sha: readiness.change_commit_sha
      }
      : null
  };
}

export function summarizeVerifyCapabilityGap(authority) {
  const missing = authority?.missing ?? [];
  const pending = missing.filter((item) => item.status === "pending");
  const needRequest = missing.filter((item) => item.status !== "pending" && item.status !== "approved");
  return {
    allowed: authority?.allowed === true,
    required_capability_ids: authority?.required_capability_ids ?? [],
    missing,
    pending_ids: pending.map((item) => item.id),
    need_request_ids: needRequest.map((item) => item.id),
    reasons: authority?.reasons ?? []
  };
}

/**
 * Request every capability still blocking a verification plan.
 * Reuses approved/pending grants; creates one Supervisor request per remaining gap.
 */
export async function requestMissingVerifyCapabilities({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  plan,
  authorizationView = null,
  controlledChange = null,
  expiresInMinutes = null,
  now = () => new Date()
}) {
  if (!plan) throw new Error("requestMissingVerifyCapabilities requires a verification plan.");
  const current = typeof now === "function" ? now() : now;
  const view = authorizationView ?? await loadCapabilityAuthorizationView({
    dataRoot,
    supervisorRoot,
    repositoryIdentity,
    runId,
    now: current
  });
  const authority = evaluateVerificationExecutionAuthority(plan, view, { controlledChange });
  const gap = summarizeVerifyCapabilityGap(authority);
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
    kind: "verify-capability-batch",
    run_id: runId,
    command_id: plan.command?.id ?? null,
    commit_sha: plan.commit_sha ?? null,
    authority,
    gap,
    results,
    approve_request_ids: approveRequestIds,
    already_satisfied: gap.allowed && results.every((item) => item.reuse_kind === "approved-grant")
  };
}

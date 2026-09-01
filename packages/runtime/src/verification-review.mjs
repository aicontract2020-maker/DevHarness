import { assertContract } from "../../project/src/contracts.mjs";
import { listValidReceipts } from "./data-store.mjs";
import { listVerifiedEvidenceManifests } from "./supervisor-store.mjs";

function outcomeReason(receipt) {
  if (receipt.outcome.reason) return receipt.outcome.reason;
  if (receipt.outcome.status === "pass") return "passed";
  if (receipt.outcome.status === "blocked") return "blocked";
  if (receipt.preparation?.status === "fail") return "preparation-failed";
  if (receipt.services?.some((service) => service.readiness?.status === "fail")) return "service-readiness";
  if (receipt.services?.some((service) => service.unexpected_exit)) return "service-exited";
  if (receipt.warmup?.status === "fail") return "warmup-failed";
  if (receipt.outcome.timed_out) return "command-timeout";
  if (receipt.workspace?.dirty_before || receipt.workspace?.dirty_after) return "workspace-dirty";
  if (receipt.teardown?.status === "fail") return "teardown-failed";
  return "command-failed";
}

function readinessSummary(receipt) {
  const checks = (receipt.services ?? []).flatMap((service) =>
    service.readiness?.checks ?? (service.readiness ? [service.readiness] : [])
  );
  const passed = checks.filter((check) => check.status === "pass").length;
  return {
    status: checks.length === 0 ? "not-required" : passed === checks.length ? "pass" : "fail",
    passed,
    total: checks.length
  };
}

function hasCurrentE2Evidence(receipt, manifests, currentHeadSha) {
  return receipt.outcome.status === "pass" && receipt.commit_sha === currentHeadSha && manifests.some((manifest) =>
    manifest.repository_identity === receipt.repository_identity &&
    manifest.commit_sha === receipt.commit_sha &&
    (!receipt.goal_run_id || manifest.run_id === receipt.goal_run_id) &&
    manifest.receipt?.id === receipt.id &&
    manifest.outcome?.status === "pass" &&
    manifest.evidence_records?.some((record) => record.type === "test-result")
  );
}

function summarize(receipt, currentHeadSha, manifests) {
  return {
    id: receipt.id,
    ...(receipt.goal_run_id ? { goal_run_id: receipt.goal_run_id } : {}),
    commit_sha: receipt.commit_sha,
    current_revision: receipt.commit_sha === currentHeadSha,
    command: { id: receipt.command.id, kind: receipt.command.kind },
    started_at: receipt.started_at,
    completed_at: receipt.completed_at,
    duration_ms: receipt.duration_ms,
    outcome: {
      status: receipt.outcome.status,
      reason: outcomeReason(receipt),
      summary: receipt.outcome.summary
    },
    readiness: readinessSummary(receipt),
    workspace_clean: !receipt.workspace.dirty_before && !receipt.workspace.dirty_after,
    teardown_status: receipt.teardown.status,
    artifact_count: receipt.artifacts.length,
    achieved_evidence_level: hasCurrentE2Evidence(receipt, manifests, currentHeadSha) ? "E2" : "E0"
  };
}

export async function createVerificationReview({ repositoryIdentity, currentHeadSha, receipts, evidenceManifests = [] }) {
  if (!repositoryIdentity) throw new Error("Verification review requires a repository identity.");
  if (!/^[0-9a-f]{40,64}$/.test(currentHeadSha ?? "")) throw new Error("Verification review requires a current Git revision.");
  if (receipts.some((receipt) => receipt.repository_identity !== repositoryIdentity)) {
    throw new Error("Verification review received a receipt from another repository.");
  }
  const ordered = [...receipts].sort((left, right) =>
    right.completed_at.localeCompare(left.completed_at) || right.id.localeCompare(left.id)
  );
  const summaries = ordered.slice(0, 20).map((receipt) => summarize(receipt, currentHeadSha, evidenceManifests));
  const body = {
    schema_version: 1,
    repository_identity: repositoryIdentity,
    current_head_sha: currentHeadSha,
    counts: {
      total: ordered.length,
      pass: ordered.filter((receipt) => receipt.outcome.status === "pass").length,
      fail: ordered.filter((receipt) => receipt.outcome.status === "fail").length,
      blocked: ordered.filter((receipt) => receipt.outcome.status === "blocked").length,
      current: ordered.filter((receipt) => receipt.commit_sha === currentHeadSha).length,
      stale: ordered.filter((receipt) => receipt.commit_sha !== currentHeadSha).length
    },
    latest: summaries[0] ?? null,
    verifications: summaries
  };
  await assertContract("verification-review", body);
  return body;
}

export async function loadVerificationReview({ dataRoot, supervisorRoot, repositoryIdentity, currentHeadSha }) {
  const [receipts, evidenceManifests] = await Promise.all([
    listValidReceipts(dataRoot, repositoryIdentity),
    listVerifiedEvidenceManifests(supervisorRoot, repositoryIdentity)
  ]);
  return createVerificationReview({ repositoryIdentity, currentHeadSha, receipts, evidenceManifests });
}

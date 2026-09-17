/**
 * Bind design-strategy drafts to the human strategy approval gate.
 */

import { strategyArtifactHash } from "../../core/src/trusted-context.mjs";
import { assertContract } from "../../project/src/contracts.mjs";
import { loadRunSourceArtifact, loadGoalRun } from "./goal-run-store.mjs";
import {
  defaultSupervisorRoot,
  designStrategyPath,
  understandingBaselinePath,
  overwriteDesignStrategy,
  overwriteUnderstandingBaseline,
  readJsonIfExists
} from "./data-store.mjs";
import { createSupervisorApprovalRequest } from "./supervisor-approval.mjs";
import { listVerifiedEvidenceManifests } from "./supervisor-store.mjs";
import { applyEvidenceToUnderstandingBaseline } from "../../project/src/apply-evidence-to-baseline.mjs";
import { reconcileBaselineClaimsWithModel } from "../../project/src/phase1-reconcile.mjs";

export async function loadDesignStrategyForRun({ dataRoot, repositoryIdentity, runId }) {
  const artifact = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, "artifact-design-strategy");
  const strategy = artifact?.value ?? artifact;
  await assertContract("design-strategy", strategy);
  const actualHash = strategyArtifactHash(strategy);
  if (strategy.artifact_sha256 !== actualHash) {
    throw new Error("Stored design strategy artifact hash does not match its content.");
  }
  return {
    strategy,
    path: designStrategyPath(dataRoot, repositoryIdentity, strategy.id)
  };
}

export async function requestStrategyApprovalForRun({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  expiresInMinutes = 60,
  now = () => new Date()
}) {
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  if (!run?.current_head_sha) throw new Error("Goal Run is missing a bound revision.");
  const { strategy, path } = await loadDesignStrategyForRun({ dataRoot, repositoryIdentity, runId });
  if (strategy.commit_sha !== run.current_head_sha) {
    throw new Error("Design strategy revision does not match the Goal Run head.");
  }
  if (strategy.status === "approved") {
    return { strategy, path, request: null, already_approved: true };
  }
  const request = await createSupervisorApprovalRequest({
    supervisorRoot,
    repositoryIdentity,
    relevantHeadSha: run.current_head_sha,
    runId,
    gate: "strategy",
    subject: { id: strategy.id, artifact_sha256: strategy.artifact_sha256 },
    expiresInMinutes,
    now
  });
  return { strategy, path, request, already_approved: false };
}

export function promoteDesignStrategyToApproved(strategy) {
  if (strategy.status === "approved") return strategy;
  const promoted = {
    ...strategy,
    status: "approved"
  };
  // Hash excludes status, so artifact_sha256 stays stable across promotion.
  const hash = strategyArtifactHash(promoted);
  if (hash !== strategy.artifact_sha256) {
    throw new Error("Strategy promotion changed the canonical artifact hash unexpectedly.");
  }
  return promoted;
}

export async function applyStrategyApprovalReceipt({
  dataRoot,
  repositoryIdentity,
  receipt,
  baselineId = null,
  runId = null
}) {
  if (receipt?.gate !== "strategy" || receipt?.decision !== "approved") {
    return { applied: false, reason: "not-strategy-approved" };
  }
  let resolvedBaselineId = baselineId;
  if (!resolvedBaselineId && runId) {
    try {
      const baselineArtifact = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, "artifact-understanding-baseline");
      resolvedBaselineId = baselineArtifact?.value?.id ?? null;
    } catch {
      resolvedBaselineId = null;
    }
  }
  const strategyPath = designStrategyPath(dataRoot, repositoryIdentity, receipt.subject.id);
  let existing = await readJsonIfExists(strategyPath);
  if (!existing && runId) {
    try {
      const artifact = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, "artifact-design-strategy");
      existing = artifact?.value ?? null;
    } catch {
      existing = null;
    }
  }
  if (!existing) {
    return { applied: false, reason: "strategy-file-missing", path: strategyPath };
  }
  await assertContract("design-strategy", existing);
  if (existing.artifact_sha256 !== receipt.subject.artifact_sha256 || existing.id !== receipt.subject.id) {
    throw new Error("Strategy approval subject does not match the stored design strategy.");
  }
  const promoted = promoteDesignStrategyToApproved(existing);
  const stored = await overwriteDesignStrategy(strategyPath, promoted);

  let baselineStored = null;
  if (resolvedBaselineId) {
    const baselinePath = understandingBaselinePath(dataRoot, repositoryIdentity, resolvedBaselineId);
    const baseline = await readJsonIfExists(baselinePath);
    if (baseline?.strategy?.strategy_id === promoted.id) {
      let next = {
        ...baseline,
        strategy: {
          ...baseline.strategy,
          status: "approved",
          artifact_sha256: promoted.artifact_sha256
        }
      };
      next = reconcileBaselineClaimsWithModel(next, { strategy: promoted });
      try {
        const manifests = await listVerifiedEvidenceManifests(
          defaultSupervisorRoot(),
          repositoryIdentity
        );
        next = applyEvidenceToUnderstandingBaseline(next, {
          manifests,
          commitSha: next.commit_sha
        }).baseline;
      } catch {
        // Evidence binding is best-effort on approve; strategy status still lands.
      }
      baselineStored = await overwriteUnderstandingBaseline(baselinePath, next);
    }
  }

  return {
    applied: true,
    strategy: promoted,
    strategy_path: stored.path,
    baseline: baselineStored
  };
}

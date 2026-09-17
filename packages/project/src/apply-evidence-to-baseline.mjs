/**
 * Bind supervisor test-result evidence into Phase 1 understanding artifacts.
 * Promotes eligible baseline claims and rebinds system-model flow evidence_refs
 * to evidence record ids (not file paths).
 */

import { hashContract } from "./harness.mjs";

const ELIGIBLE = new Set(["detected", "unverified", "documented", "code-confirmed", "test-confirmed"]);

export function looksLikeEvidenceId(ref) {
  return /^evidence-[0-9a-f]{8,}$/i.test(String(ref ?? ""));
}

export function collectPassingTestResults(manifests, { repositoryIdentity, commitSha }) {
  const byId = new Map();
  for (const manifest of manifests ?? []) {
    if (manifest?.commit_sha && manifest.commit_sha !== commitSha) continue;
    if (manifest?.repository_identity && manifest.repository_identity !== repositoryIdentity) continue;
    for (const record of manifest.evidence_records ?? []) {
      if (record?.type !== "test-result") continue;
      if (!["pass", "observed"].includes(record.observation?.result)) continue;
      if (!(record.artifacts ?? []).length) continue;
      const subjectIdentity = record.subject?.repository_identity;
      const subjectSha = record.subject?.commit_sha;
      if (subjectIdentity && subjectIdentity !== repositoryIdentity) continue;
      if (subjectSha && subjectSha !== commitSha) continue;
      if (!record.id) continue;
      byId.set(record.id, record);
    }
  }
  return [...byId.values()];
}

function rehashBaseline(baseline, claims) {
  const { id: _omit, ...rest } = baseline;
  const body = { ...rest, claims };
  return {
    ...body,
    id: `understanding-baseline-${hashContract(body).slice(0, 24)}`
  };
}

function rehashSystemModel(model, patch) {
  const { id: _omit, ...rest } = model;
  const body = { ...rest, ...patch };
  return {
    ...body,
    id: `system-model-draft-${hashContract(body).slice(0, 24)}`
  };
}

/**
 * @returns {{ baseline: object, promotedClaimIds: string[], reboundClaimIds: string[], evidenceIdsUsed: string[] }}
 */
export function applyEvidenceToUnderstandingBaseline(baseline, {
  manifests = [],
  commitSha = null
} = {}) {
  if (!baseline?.repository_identity || !baseline?.commit_sha || !Array.isArray(baseline.claims)) {
    throw new Error("applyEvidenceToUnderstandingBaseline requires a baseline with identity, commit_sha, and claims.");
  }
  const sha = commitSha ?? baseline.commit_sha;
  const records = collectPassingTestResults(manifests, {
    repositoryIdentity: baseline.repository_identity,
    commitSha: sha
  });
  const evidenceIdsUsed = records.map((record) => record.id);
  if (evidenceIdsUsed.length === 0) {
    return { baseline, promotedClaimIds: [], reboundClaimIds: [], evidenceIdsUsed: [] };
  }

  const promotedClaimIds = [];
  const reboundClaimIds = [];
  const claims = baseline.claims.map((claim) => {
    if (!ELIGIBLE.has(claim.status)) return claim;
    const existingIds = (claim.evidence_refs ?? []).filter(looksLikeEvidenceId);
    const alreadyBound = existingIds.some((id) => evidenceIdsUsed.includes(id));
    if (claim.status === "test-confirmed" && alreadyBound) return claim;

    if (claim.status !== "test-confirmed") promotedClaimIds.push(claim.id);
    else reboundClaimIds.push(claim.id);

    return {
      ...claim,
      status: "test-confirmed",
      severity: "info",
      evidence_refs: evidenceIdsUsed.slice(0, 8),
      affected_paths: Array.isArray(claim.affected_paths) ? claim.affected_paths : []
    };
  });

  if (promotedClaimIds.length === 0 && reboundClaimIds.length === 0) {
    return { baseline, promotedClaimIds: [], reboundClaimIds: [], evidenceIdsUsed };
  }

  return {
    baseline: rehashBaseline(baseline, claims),
    promotedClaimIds,
    reboundClaimIds,
    evidenceIdsUsed
  };
}

/**
 * Replace path-like flow evidence_refs with current test-result evidence ids.
 */
export function applyEvidenceToSystemModel(model, {
  manifests = [],
  commitSha = null
} = {}) {
  if (!model?.repository_identity || !model?.commit_sha) {
    throw new Error("applyEvidenceToSystemModel requires a model with identity and commit_sha.");
  }
  const sha = commitSha ?? model.commit_sha;
  const records = collectPassingTestResults(manifests, {
    repositoryIdentity: model.repository_identity,
    commitSha: sha
  });
  const evidenceIdsUsed = records.map((record) => record.id);
  if (evidenceIdsUsed.length === 0) {
    return { model, reboundFlowIds: [], evidenceIdsUsed: [] };
  }

  const nextRefs = evidenceIdsUsed.slice(0, 8);
  const reboundFlowIds = [];
  const flows = (model.flows ?? []).map((flow) => {
    let changed = false;
    const steps = (flow.steps ?? []).map((step) => {
      const refs = step.evidence_refs ?? [];
      const needsRebind = refs.length === 0 || refs.some((ref) => !looksLikeEvidenceId(ref));
      if (!needsRebind && refs.every((ref) => evidenceIdsUsed.includes(ref))) return step;
      changed = true;
      return { ...step, evidence_refs: nextRefs };
    });
    if (changed) reboundFlowIds.push(flow.id);
    return changed ? { ...flow, steps } : flow;
  });

  if (reboundFlowIds.length === 0) {
    return { model, reboundFlowIds: [], evidenceIdsUsed };
  }

  return {
    model: rehashSystemModel(model, { flows }),
    reboundFlowIds,
    evidenceIdsUsed
  };
}

export { rehashBaseline, rehashSystemModel };

/**
 * Bind supervisor test-result evidence into a Phase 1 understanding baseline.
 * Promotes eligible claims to test-confirmed with evidence record ids (not file paths).
 */

import { hashContract } from "./harness.mjs";

const ELIGIBLE = new Set(["detected", "unverified", "documented", "code-confirmed", "test-confirmed"]);

function looksLikeEvidenceId(ref) {
  return /^evidence-[0-9a-f]{8,}$/i.test(String(ref ?? ""));
}

function collectPassingTestResults(manifests, { repositoryIdentity, commitSha }) {
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

    const nextRefs = evidenceIdsUsed.slice(0, 8);
    const wasProved = claim.status === "test-confirmed" || claim.status === "code-confirmed";
    if (wasProved && alreadyBound === false && claim.status === "test-confirmed") {
      reboundClaimIds.push(claim.id);
    } else if (claim.status !== "test-confirmed") {
      promotedClaimIds.push(claim.id);
    } else {
      reboundClaimIds.push(claim.id);
    }

    return {
      ...claim,
      status: "test-confirmed",
      severity: "info",
      evidence_refs: nextRefs,
      affected_paths: Array.isArray(claim.affected_paths) ? claim.affected_paths : []
    };
  });

  if (promotedClaimIds.length === 0 && reboundClaimIds.length === 0) {
    return { baseline, promotedClaimIds: [], reboundClaimIds: [], evidenceIdsUsed };
  }

  const { id: _omit, ...rest } = baseline;
  const body = { ...rest, claims };
  const next = {
    ...body,
    id: `understanding-baseline-${hashContract(body).slice(0, 24)}`
  };
  return { baseline: next, promotedClaimIds, reboundClaimIds, evidenceIdsUsed };
}

import assert from "node:assert/strict";
import test from "node:test";

import { expectedDomainsFromSnapshot } from "../../core/src/trusted-context.mjs";
import { applyEvidenceToUnderstandingBaseline } from "../src/apply-evidence-to-baseline.mjs";
import { buildRepositoryUnderstandingBaselineFromOnboardingPlan } from "../src/understanding-baseline.mjs";

function samplePlan(overrides = {}) {
  return {
    schema_version: 1,
    id: "onboard-test-1",
    generated_at: "2026-09-17T00:00:00.000Z",
    repository_identity: "github.com/example/demo",
    commit_sha: "a".repeat(40),
    workspace: { dirty: false, changed_file_count: 0 },
    mode: "read-only-plan",
    verdict: "needs-evidence",
    claims: [
      {
        id: "repository-inventory",
        domain: "repository",
        status: "code-confirmed",
        summary: "Inventory inspected.",
        evidence_refs: ["package.json"]
      },
      {
        id: "database-surface",
        domain: "database",
        status: "detected",
        summary: "Database signals found.",
        evidence_refs: ["alembic.ini"]
      },
      {
        id: "security-model",
        domain: "security",
        status: "not-covered",
        summary: "Security not modeled.",
        evidence_refs: []
      }
    ],
    coverage: [
      { domain: "repository", status: "code-confirmed", claim_ids: ["repository-inventory"] },
      { domain: "database", status: "detected", claim_ids: ["database-surface"] },
      { domain: "security", status: "not-covered", claim_ids: ["security-model"] },
      { domain: "frontend", status: "not-applicable", claim_ids: [] }
    ],
    capability_requests: [],
    blockers: [],
    limitations: [],
    next_action: { id: "approve-capability-plan", label: "Approve caps", recommended: true },
    summary: {
      total_claims: 3,
      proved_claims: 1,
      unresolved_claims: 2,
      conflict_claims: 0,
      claim_status_counts: {},
      coverage_status_counts: {},
      domain_knownness: {},
      priority_domains: []
    },
    ...overrides
  };
}

function sampleSnapshot(overrides = {}) {
  return {
    repository: {
      identity: "github.com/example/demo",
      root_uri: "file:///tmp/demo",
      git: { head_sha: "a".repeat(40), dirty: false, branch: "main" }
    },
    detected: {
      platforms: ["api", "web"],
      services: ["postgresql"],
      frameworks: ["fastapi", "sqlalchemy"],
      deployment_files: []
    },
    environment: { declared_keys: ["DATABASE_URL"], locally_set_keys: [] },
    ...overrides
  };
}

function passingManifest({ commitSha = "a".repeat(40), evidenceId = "evidence-" + "b".repeat(32) } = {}) {
  return {
    schema_version: 1,
    id: "manifest-" + "c".repeat(32),
    repository_identity: "github.com/example/demo",
    commit_sha: commitSha,
    evidence_records: [{
      schema_version: 1,
      id: evidenceId,
      type: "test-result",
      subject: { repository_identity: "github.com/example/demo", commit_sha: commitSha },
      observation: { result: "pass", summary: "ok" },
      artifacts: [{ id: "blob-1", sha256: "d".repeat(64) }]
    }]
  };
}

test("required_domains follow live inventory when snapshot is provided", () => {
  const snapshot = sampleSnapshot();
  const expected = expectedDomainsFromSnapshot(snapshot);
  const baseline = buildRepositoryUnderstandingBaselineFromOnboardingPlan(samplePlan(), { snapshot });
  assert.deepEqual(baseline.required_domains, expected);
  assert.ok(expected.includes("database"));
  assert.ok(expected.includes("backend"));
});

test("applies current-revision test-result evidence and skips not-covered", () => {
  const baseline = buildRepositoryUnderstandingBaselineFromOnboardingPlan(samplePlan());
  const evidenceId = "evidence-" + "e".repeat(32);
  const { baseline: next, promotedClaimIds, evidenceIdsUsed } = applyEvidenceToUnderstandingBaseline(baseline, {
    manifests: [passingManifest({ evidenceId })]
  });
  assert.deepEqual(evidenceIdsUsed, [evidenceId]);
  assert.ok(promotedClaimIds.includes("database-surface"));
  assert.ok(promotedClaimIds.includes("repository-inventory"));
  assert.ok(!promotedClaimIds.includes("security-model"));
  const db = next.claims.find((c) => c.id === "database-surface");
  const security = next.claims.find((c) => c.id === "security-model");
  assert.equal(db.status, "test-confirmed");
  assert.deepEqual(db.evidence_refs, [evidenceId]);
  assert.equal(security.status, "not-covered");
  assert.notEqual(next.id, baseline.id);
});

test("ignores manifests for a different commit", () => {
  const baseline = buildRepositoryUnderstandingBaselineFromOnboardingPlan(samplePlan());
  const { baseline: next, promotedClaimIds } = applyEvidenceToUnderstandingBaseline(baseline, {
    manifests: [passingManifest({ commitSha: "f".repeat(40) })]
  });
  assert.deepEqual(promotedClaimIds, []);
  assert.equal(next.id, baseline.id);
});

test("rebinds system-model flow evidence_refs to evidence ids", async () => {
  const { applyEvidenceToSystemModel } = await import("../src/apply-evidence-to-baseline.mjs");
  const model = {
    schema_version: 1,
    id: "system-model-draft-test",
    repository_identity: "github.com/example/demo",
    commit_sha: "a".repeat(40),
    components: [{ id: "component-backend", kind: "backend", owner: "backend" }],
    stores: [{ id: "store-primary", kind: "postgresql", disposable_test_available: false }],
    entities: [],
    trust_boundaries: [],
    roles: [],
    flows: [{
      id: "flow-health-ready",
      trigger: "probe",
      outcome: "ready",
      steps: [{
        sequence: 1,
        component_id: "component-backend",
        action: "ready",
        reads: [],
        writes: [],
        calls: [],
        evidence_refs: ["backend/src/main.py"]
      }]
    }],
    invariants: [],
    risks: [],
    unknowns: [],
    verdict: "needs-evidence"
  };
  const evidenceId = "evidence-" + "e".repeat(32);
  const { model: next, reboundFlowIds } = applyEvidenceToSystemModel(model, {
    manifests: [passingManifest({ evidenceId })]
  });
  assert.deepEqual(reboundFlowIds, ["flow-health-ready"]);
  assert.deepEqual(next.flows[0].steps[0].evidence_refs, [evidenceId]);
  assert.notEqual(next.id, model.id);
});

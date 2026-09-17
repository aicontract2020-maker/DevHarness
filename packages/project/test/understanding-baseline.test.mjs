import assert from "node:assert/strict";
import test from "node:test";

import { assertContract } from "../src/contracts.mjs";
import {
  buildRepositoryUnderstandingBaselineFromOnboardingPlan,
  formatAuditableUnderstandingBrief
} from "../src/understanding-baseline.mjs";

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
        evidence_refs: ["backend/pyproject.toml", "7f32844e6"]
      },
      {
        id: "database-surface",
        domain: "database",
        status: "detected",
        summary: "Database signals found.",
        evidence_refs: ["backend/alembic.ini"]
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
    blockers: [{ id: "coverage-security", summary: "Security understanding not yet proved." }],
    limitations: ["No runtime executed."],
    next_action: { id: "approve-capability-plan", label: "Approve caps", recommended: true },
    summary: {
      total_claims: 3,
      proved_claims: 1,
      unresolved_claims: 2,
      conflict_claims: 0,
      claim_status_counts: {
        "code-confirmed": 1, "test-confirmed": 0, "runtime-observed": 0,
        detected: 1, documented: 0, conflict: 0, unverified: 0, "not-covered": 1
      },
      coverage_status_counts: {
        "code-confirmed": 1, "test-confirmed": 0, "runtime-observed": 0,
        detected: 1, documented: 0, conflict: 0, unverified: 0, "not-covered": 1, "not-applicable": 1
      },
      domain_knownness: {},
      priority_domains: ["security=not-covered", "database=detected"]
    },
    ...overrides
  };
}

test("builds a schema-valid understanding baseline that is never ready from static onboard", async () => {
  const baseline = buildRepositoryUnderstandingBaselineFromOnboardingPlan(samplePlan());
  await assertContract("repository-understanding-baseline", baseline);
  assert.equal(baseline.verdict, "needs-evidence");
  assert.ok(baseline.required_domains.includes("database"));
  assert.ok(!baseline.required_domains.includes("frontend"));
  assert.equal(baseline.models.database_covered, false);
  assert.equal(baseline.strategy.status, "proposed");
  const security = baseline.claims.find((claim) => claim.id === "security-model");
  assert.equal(security.severity, "blocking");
  const repo = baseline.claims.find((claim) => claim.id === "repository-inventory");
  assert.ok(repo.affected_paths.includes("backend/pyproject.toml"));
});

test("formatAuditableUnderstandingBrief is human-auditable markdown", () => {
  const plan = samplePlan();
  const baseline = buildRepositoryUnderstandingBaselineFromOnboardingPlan(plan);
  const md = formatAuditableUnderstandingBrief(baseline, { onboardingPlan: plan, runId: "run-1" });
  assert.match(md, /Repository Understanding Brief/);
  assert.match(md, /Verdict: \*\*needs-evidence\*\*/);
  assert.match(md, /### database/);
  assert.match(md, /security-model/);
  assert.match(md, /system-model-pending/);
});

test("blocked plan without commit is rejected", () => {
  assert.throws(() => buildRepositoryUnderstandingBaselineFromOnboardingPlan(samplePlan({ commit_sha: undefined })));
});

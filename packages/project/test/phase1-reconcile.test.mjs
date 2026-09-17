import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  detectDisposableTestStore,
  promoteBaselineVerdictIfOnlyMissingReadyFlag,
  reconcileBaselineClaimsWithModel,
  reconcileSystemModelHonesty
} from "../src/phase1-reconcile.mjs";

test("detectDisposableTestStore finds in-memory sqlite conftest", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dh-disp-"));
  mkdirSync(path.join(root, "backend", "tests"), { recursive: true });
  writeFileSync(path.join(root, "backend", "tests", "conftest.py"), 'TEST_DATABASE_URL = "sqlite:///:memory:"\n');
  assert.equal(detectDisposableTestStore(root), true);
});

test("reconcile upgrades security and ownership claims when modeled", () => {
  const baseline = {
    schema_version: 1,
    id: "understanding-baseline-old",
    repository_identity: "github.com/example/demo",
    commit_sha: "a".repeat(40),
    captured_at: "2026-09-17T00:00:00.000Z",
    required_domains: ["security", "database", "strategy"],
    claims: [
      { id: "security-model", domain: "security", statement: "x", status: "not-covered", severity: "blocking", source_refs: ["claim:security-model"], evidence_refs: [], affected_paths: [] },
      { id: "database-ownership", domain: "database", statement: "y", status: "not-covered", severity: "blocking", source_refs: ["claim:database-ownership"], evidence_refs: [], affected_paths: [] },
      { id: "design-strategy", domain: "strategy", statement: "z", status: "not-covered", severity: "blocking", source_refs: ["claim:design-strategy"], evidence_refs: [], affected_paths: [] }
    ],
    conflicts: [],
    models: { system_model_id: "system-model-draft-x", database_covered: true, security_covered: true, feature_flows_covered: true },
    strategy: { strategy_id: "design-strategy-draft-x", version: 1, status: "proposed", artifact_sha256: "a".repeat(64) },
    verdict: "needs-evidence"
  };
  const model = {
    roles: [{ id: "role-admin", permissions: ["*"] }],
    trust_boundaries: [{ id: "b1", from_component_id: "a", to_component_id: "b", authentication: "token", authorization: "role-gated" }],
    entities: [{ id: "entity-users", store_id: "store-primary", owner_component_id: "component-backend", classifications: [] }],
    stores: [{ id: "store-primary", kind: "postgresql", disposable_test_available: false }],
    flows: [{ id: "flow-1", steps: [{ sequence: 1, component_id: "c", reads: ["entity-users"], writes: [], calls: [], evidence_refs: [] }] }]
  };
  const next = reconcileBaselineClaimsWithModel(baseline, { systemModel: model });
  assert.equal(next.claims.find((c) => c.id === "security-model").status, "detected");
  assert.equal(next.claims.find((c) => c.id === "database-ownership").status, "detected");
  assert.equal(next.claims.find((c) => c.id === "design-strategy").status, "not-covered");
});

test("reconcileSystemModelHonesty marks complete when gates pass", () => {
  const root = mkdtempSync(path.join(tmpdir(), "dh-complete-"));
  mkdirSync(path.join(root, "tests"), { recursive: true });
  writeFileSync(path.join(root, "tests", "conftest.py"), "Uses in-memory SQLite for speed\nTEST_DATABASE_URL = \"sqlite:///:memory:\"\n");
  const model = {
    schema_version: 1,
    id: "system-model-draft-old",
    repository_identity: "github.com/example/demo",
    commit_sha: "a".repeat(40),
    components: [
      { id: "component-backend", kind: "backend", owner: "backend" },
      { id: "component-database", kind: "database", owner: "database" }
    ],
    stores: [{ id: "store-primary", kind: "postgresql", disposable_test_available: false }],
    entities: [{ id: "entity-users", store_id: "store-primary", owner_component_id: "component-backend", classifications: [] }],
    trust_boundaries: [{ id: "b1", from_component_id: "component-backend", to_component_id: "component-database", authentication: "token", authorization: "role-gated" }],
    roles: [{ id: "role-admin", permissions: ["*"] }],
    flows: [{
      id: "flow-health-ready",
      trigger: "probe",
      outcome: "ready",
      steps: [{
        sequence: 1,
        component_id: "component-backend",
        action: "ready",
        reads: ["entity-users"],
        writes: [],
        calls: ["store-primary"],
        evidence_refs: ["evidence-" + "a".repeat(32)]
      }]
    }],
    invariants: [],
    risks: [{ id: "risk-gap-security-model", classification: "unverified", summary: "old", evidence_refs: [] }],
    unknowns: ["stale"],
    verdict: "needs-evidence"
  };
  const next = reconcileSystemModelHonesty(model, { repositoryRoot: root });
  assert.equal(next.stores[0].disposable_test_available, true);
  assert.equal(next.verdict, "complete");
  assert.equal(next.unknowns.length, 0);
  assert.ok(!next.risks.some((r) => r.id === "risk-gap-security-model"));
});

test("promoteBaselineVerdictIfOnlyMissingReadyFlag flips only that blocker", () => {
  const baseline = {
    schema_version: 1,
    id: "understanding-baseline-old",
    repository_identity: "github.com/example/demo",
    commit_sha: "a".repeat(40),
    captured_at: "2026-09-17T00:00:00.000Z",
    required_domains: ["repository"],
    claims: [],
    conflicts: [],
    models: { system_model_id: "m", database_covered: false, security_covered: false, feature_flows_covered: false },
    strategy: { strategy_id: "s", version: 1, status: "proposed", artifact_sha256: "a".repeat(64) },
    verdict: "needs-evidence"
  };
  const promoted = promoteBaselineVerdictIfOnlyMissingReadyFlag(baseline, {
    verdict: { ready: false, reasons: [{ code: "baseline_verdict_not_ready", summary: "x" }] }
  });
  assert.equal(promoted.verdict, "ready");
  const blocked = promoteBaselineVerdictIfOnlyMissingReadyFlag(baseline, {
    verdict: { ready: false, reasons: [
      { code: "baseline_verdict_not_ready", summary: "x" },
      { code: "strategy_not_approved", summary: "y" }
    ] }
  });
  assert.equal(blocked.verdict, "needs-evidence");
});

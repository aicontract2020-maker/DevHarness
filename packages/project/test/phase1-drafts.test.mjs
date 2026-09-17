import assert from "node:assert/strict";
import test from "node:test";

import { assertContract } from "../src/contracts.mjs";
import {
  buildDraftSystemModelFromOnboardingPlan,
  buildProposedDesignStrategyFromOnboardingPlan,
  createValidatedPhase1DraftsFromOnboardingPlan
} from "../src/phase1-drafts.mjs";

function plan() {
  return {
    schema_version: 1,
    id: "onboard-draft-1",
    repository_identity: "github.com/example/demo",
    commit_sha: "b".repeat(40),
    verdict: "needs-evidence",
    claims: [
      { id: "frontend-surface", domain: "frontend", status: "detected", summary: "Web UI detected.", evidence_refs: ["frontend/package.json"] },
      { id: "backend-surface", domain: "backend", status: "detected", summary: "API detected.", evidence_refs: ["backend/pyproject.toml"] },
      { id: "database-surface", domain: "database", status: "detected", summary: "DB signals found.", evidence_refs: ["DATABASE_URL"] },
      { id: "security-model", domain: "security", status: "not-covered", summary: "Security gap.", evidence_refs: [] }
    ]
  };
}

test("draft system model is schema-valid and never complete", async () => {
  const model = buildDraftSystemModelFromOnboardingPlan(plan(), {
    snapshot: {
      detected: { platforms: ["web", "api"], frameworks: ["FastAPI"], services: ["PostgreSQL"], deployment_files: [] },
      environment: { declared_keys: ["DATABASE_URL"] }
    }
  });
  await assertContract("system-model", model);
  assert.equal(model.verdict, "needs-evidence");
  assert.ok(model.components.some((c) => c.kind === "frontend"));
  assert.ok(model.components.some((c) => c.kind === "backend"));
  assert.ok(model.stores.some((s) => s.kind === "PostgreSQL"));
  assert.equal(model.entities.length, 0);
  assert.equal(model.flows.length, 0);
  assert.ok(model.unknowns.length > 0);
});

test("proposed design strategy is schema-valid and never approved here", async () => {
  const strategy = buildProposedDesignStrategyFromOnboardingPlan(plan());
  await assertContract("design-strategy", strategy);
  assert.equal(strategy.status, "proposed");
  assert.equal(strategy.decisions.length >= 1, true);
  assert.match(strategy.id, /^design-strategy-draft-/);
});

test("validated phase1 drafts assert both contracts", async () => {
  const { systemModel, strategy } = await createValidatedPhase1DraftsFromOnboardingPlan(plan());
  assert.equal(systemModel.verdict, "needs-evidence");
  assert.equal(strategy.status, "proposed");
});

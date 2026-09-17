import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assertContract } from "../src/contracts.mjs";
import {
  buildDraftSystemModelFromOnboardingPlan,
  buildProposedDesignStrategyFromOnboardingPlan,
  createValidatedPhase1DraftsFromOnboardingPlan,
  deriveEntitiesFromRepositoryRoot,
  deriveRolesFromRepositoryRoot
} from "../src/phase1-drafts.mjs";

const fixtureRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "phase1-repo");

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

test("deriveEntitiesFromRepositoryRoot reads SQLAlchemy tables and migration refs", () => {
  const derived = deriveEntitiesFromRepositoryRoot(fixtureRoot);
  assert.ok(derived.entities.some((entity) => entity.id === "entity-users"));
  assert.ok(derived.entities.some((entity) => entity.id === "entity-kb_assessments"));
  const users = derived.entities.find((entity) => entity.id === "entity-users");
  assert.ok(users.classifications.includes("personal"));
  assert.ok(users.constraints.some((item) => item.includes("unique")));
  assert.ok(users.migration_refs.some((ref) => ref.includes("001_add_users.py")));
});

test("deriveRolesFromRepositoryRoot reads USER_ROLES and role gates", () => {
  const derived = deriveRolesFromRepositoryRoot(fixtureRoot);
  assert.ok(derived.roles.some((role) => role.id === "role-admin"));
  assert.ok(derived.roles.some((role) => role.id === "role-teacher"));
  const admin = derived.roles.find((role) => role.id === "role-admin");
  assert.ok(admin.permissions.some((perm) => perm.includes("gate:")));
});

test("draft system model includes entities and critical health-ready flow", async () => {
  const model = buildDraftSystemModelFromOnboardingPlan(plan(), {
    snapshot: {
      repository: { root_uri: `file://${fixtureRoot}` },
      detected: { platforms: ["web", "api"], frameworks: ["FastAPI"], services: ["PostgreSQL"], deployment_files: [] },
      environment: { declared_keys: ["DATABASE_URL"] }
    },
    repositoryRoot: fixtureRoot
  });
  await assertContract("system-model", model);
  assert.equal(model.verdict, "needs-evidence");
  assert.ok(model.entities.length >= 2);
  assert.equal(model.flows.length, 1);
  assert.equal(model.flows[0].id, "flow-health-ready");
  assert.ok(model.flows[0].steps.some((step) => step.reads.includes("entity-users")));
  assert.ok(model.roles.some((role) => role.id === "role-admin"));
  assert.equal(model.trust_boundaries[0]?.authorization, "role-gated");
  assert.ok(model.unknowns.some((item) => /static source paths|runtime-observed/i.test(item)));
});

test("proposed design strategy is schema-valid and never approved here", async () => {
  const strategy = buildProposedDesignStrategyFromOnboardingPlan(plan());
  await assertContract("design-strategy", strategy);
  assert.equal(strategy.status, "proposed");
});

test("validated phase1 drafts assert both contracts", async () => {
  const { systemModel, strategy } = await createValidatedPhase1DraftsFromOnboardingPlan(plan(), {
    repositoryRoot: fixtureRoot,
    snapshot: {
      repository: { root_uri: `file://${fixtureRoot}` },
      detected: { platforms: ["web", "api"], frameworks: ["FastAPI"], services: ["PostgreSQL"], deployment_files: [] },
      environment: { declared_keys: ["DATABASE_URL"] }
    }
  });
  assert.equal(systemModel.verdict, "needs-evidence");
  assert.ok(systemModel.entities.length >= 1);
  assert.ok(systemModel.roles.length >= 1);
  assert.equal(strategy.status, "proposed");
});

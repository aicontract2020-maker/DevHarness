import assert from "node:assert/strict";
import test from "node:test";

import { evaluateVerificationExecutionAuthority, requiredCapabilityIdsForVerification } from "../src/execution-authority.mjs";

const plan = {
  repository_identity: "example/project",
  commit_sha: "a".repeat(40),
  command: { id: "web-playwright", kind: "verify", run: "npx playwright test", source: "detected:playwright" },
  services: []
};

function view(statuses = {}) {
  return {
    repository_identity: plan.repository_identity,
    head_sha: plan.commit_sha,
    capabilities: Object.entries(statuses).map(([id, status]) => ({ request: { id }, status }))
  };
}

test("verification requirements add process, browser and container authority deterministically", () => {
  assert.deepEqual(requiredCapabilityIdsForVerification(plan), ["service-runtime", "browser-runtime"]);
  assert.deepEqual(requiredCapabilityIdsForVerification({ ...plan, command: { ...plan.command, run: "docker compose run e2e" } }), ["service-runtime", "browser-runtime", "container-runtime"]);
  assert.deepEqual(requiredCapabilityIdsForVerification({ ...plan, command: { id: "unit", kind: "test", run: "node --test", source: "package.json" } }), ["service-runtime"]);
  assert.deepEqual(requiredCapabilityIdsForVerification({
    ...plan,
    submodules: [{ path: "vendor/example", commit_sha: "c".repeat(40) }]
  }), ["dependency-install", "service-runtime", "browser-runtime"]);
});

test("execution requires every exact current capability and reports all denials", () => {
  const denied = evaluateVerificationExecutionAuthority(plan, view({ "service-runtime": "unrequested", "browser-runtime": "approved" }));
  assert.equal(denied.allowed, false);
  assert.deepEqual(denied.missing, [{ id: "service-runtime", status: "unrequested" }]);

  const allowed = evaluateVerificationExecutionAuthority(plan, view({ "service-runtime": "approved", "browser-runtime": "approved" }));
  assert.deepEqual(allowed, { allowed: true, required_capability_ids: ["service-runtime", "browser-runtime"], missing: [], reasons: [] });

  const stale = evaluateVerificationExecutionAuthority(plan, { ...view({ "service-runtime": "approved", "browser-runtime": "approved" }), head_sha: "b".repeat(40) });
  assert.equal(stale.allowed, false);
  assert.ok(stale.reasons.some((reason) => reason.code === "authorization_revision_mismatch"));
});

test("container verification also requires database authority when onboarding detected a database", () => {
  const containerPlan = {
    ...plan,
    services: [{ command: { run: "docker compose up", source: "docker-compose.yml" } }]
  };
  const denied = evaluateVerificationExecutionAuthority(containerPlan, view({
    "service-runtime": "approved",
    "browser-runtime": "approved",
    "container-runtime": "approved",
    "database-runtime": "unrequested"
  }));
  assert.deepEqual(denied.required_capability_ids, [
    "service-runtime",
    "browser-runtime",
    "container-runtime",
    "database-runtime"
  ]);
  assert.deepEqual(denied.missing, [{ id: "database-runtime", status: "unrequested" }]);
});

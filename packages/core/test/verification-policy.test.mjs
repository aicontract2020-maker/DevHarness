import assert from "node:assert/strict";
import test from "node:test";

import { evaluateVerificationPolicy } from "../src/verification-policy.mjs";

function policy() {
  return {
    work_type: "feature",
    platforms: ["web"],
    impacts: { database: true, security: true, deployment: false, automation: false },
    modules: [{ id: "auth", changed: true, unit_stage_id: "unit" }],
    release_contract: { deployment: false, migration: false, rollback: false, performance: false, canary: false },
    stages: [
      { id: "unit", level: "unit", required: true, drivers: ["node-test"], evidence_types: ["test-result"], real_dependencies: false },
      { id: "integration", level: "integration", required: true, drivers: ["postgres-test"], evidence_types: ["test-result", "database-state"], real_dependencies: true },
      { id: "functional", level: "functional", required: true, drivers: ["browser"], evidence_types: ["test-result", "screenshot"], real_dependencies: true, independent: true },
      { id: "system", level: "system", required: true, drivers: ["browser"], evidence_types: ["test-result", "network", "database-state"], real_dependencies: true, independent: true }
    ]
  };
}

test("feature verification requires the proof ladder and a real platform surface", () => {
  assert.deepEqual(evaluateVerificationPolicy(policy()), { valid: true, reasons: [] });
  const apiOnly = policy();
  apiOnly.stages = apiOnly.stages.filter((stage) => stage.level !== "functional");
  const result = evaluateVerificationPolicy(apiOnly);
  assert.ok(result.reasons.some((reason) => reason.code === "required_stage_missing"));
});

test("performance proof requires a quantitative threshold", () => {
  const release = policy();
  release.work_type = "release";
  release.stages.push(
    { id: "deployment", level: "deployment", required: true, drivers: ["deployment-script"], evidence_types: ["deployment"], real_dependencies: true, independent: true },
    { id: "migration", level: "migration", required: true, drivers: ["migration-script"], evidence_types: ["migration"], real_dependencies: true, independent: true },
    { id: "rollback", level: "rollback", required: true, drivers: ["rollback-script"], evidence_types: ["rollback"], real_dependencies: true, independent: true },
    { id: "performance", level: "performance", required: true, drivers: ["load"], evidence_types: ["metric"], real_dependencies: true, independent: true, thresholds: [] },
    { id: "postdeploy", level: "postdeploy", required: true, drivers: ["canary"], evidence_types: ["canary-result"], real_dependencies: true, independent: true }
  );
  release.release_contract = { deployment: true, migration: true, rollback: true, performance: true, canary: true };
  const result = evaluateVerificationPolicy(release);
  assert.ok(result.reasons.some((reason) => reason.code === "performance_threshold_missing"));
});

test("fake drivers, prose evidence and incomplete release contracts are rejected", () => {
  const release = policy();
  release.work_type = "release";
  release.release_contract = { deployment: false, migration: false, rollback: false, performance: false, canary: false };
  release.stages.find((stage) => stage.level === "functional").drivers = ["fake-browser"];
  release.stages.push(
    { id: "deployment", level: "deployment", required: true, drivers: ["ci"], evidence_types: ["prose"], real_dependencies: false, independent: false },
    { id: "rollback", level: "rollback", required: true, drivers: ["ci"], evidence_types: ["prose"], real_dependencies: false, independent: false },
    { id: "performance", level: "performance", required: true, drivers: ["load"], evidence_types: ["metric"], real_dependencies: true, independent: true, thresholds: [{ metric: "latency", operator: "lte", value: -1, unit: "seconds" }] },
    { id: "postdeploy", level: "postdeploy", required: true, drivers: ["ci"], evidence_types: ["prose"], real_dependencies: false, independent: false }
  );
  const result = evaluateVerificationPolicy(release);
  for (const code of ["driver_unregistered", "release_contract_incomplete", "release_evidence_missing", "performance_threshold_invalid"]) assert.ok(result.reasons.some((reason) => reason.code === code), code);
});

test("web and database features require browser, network and database-state evidence", () => {
  const shallow = policy();
  shallow.stages.find((stage) => stage.level === "functional").evidence_types = ["test-result"];
  shallow.stages.find((stage) => stage.level === "system").evidence_types = ["test-result", "network"];
  const result = evaluateVerificationPolicy(shallow);
  assert.ok(result.reasons.some((reason) => reason.code === "browser_evidence_missing"));
  assert.ok(result.reasons.some((reason) => reason.code === "database_state_missing"));
});

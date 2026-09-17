import assert from "node:assert/strict";
import test from "node:test";

import { strategyArtifactHash } from "../../core/src/trusted-context.mjs";
import { promoteDesignStrategyToApproved } from "../src/strategy-approval.mjs";

test("promoteDesignStrategyToApproved keeps artifact hash stable", () => {
  const draft = {
    schema_version: 1,
    id: "design-strategy-draft-1",
    repository_identity: "example/demo",
    commit_sha: "a".repeat(40),
    strategy_version: 1,
    status: "proposed",
    frontend: { principles: ["a"], enforcement: ["b"] },
    backend: { principles: ["a"], enforcement: ["b"] },
    data: { principles: ["a"], enforcement: ["b"] },
    security: { principles: ["a"], enforcement: ["b"] },
    testing: { principles: ["a"], enforcement: ["b"] },
    decisions: [{
      id: "decision-1",
      rule: "Prove before ready",
      rationale: "Static is not enough",
      applies_to: ["**/*"],
      source_refs: ["onboarding-plan"],
      enforcement: "review"
    }],
    exceptions: []
  };
  const withHash = { ...draft, artifact_sha256: strategyArtifactHash(draft) };
  const promoted = promoteDesignStrategyToApproved(withHash);
  assert.equal(promoted.status, "approved");
  assert.equal(promoted.artifact_sha256, withHash.artifact_sha256);
  assert.equal(strategyArtifactHash(promoted), withHash.artifact_sha256);
});

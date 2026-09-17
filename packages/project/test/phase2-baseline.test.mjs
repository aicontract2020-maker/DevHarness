import assert from "node:assert/strict";
import test from "node:test";

import { hashContract } from "../src/harness.mjs";
import { evaluatePhase2BaselineLadder, formatPhase2BaselineLadder } from "../src/phase2-baseline.mjs";

function freeze(context) {
  // Minimal stand-in for trusted context: doctor checks isTrustedEvaluationContext WeakSet.
  // For unit tests we only need manifests shape when filtered; currentSupervisorManifest
  // returns null without trusted context — so prove path is empty unless we mark trusted.
  return context;
}

test("ranks pytest ahead of docs probes and reports next unproved command", () => {
  const snapshot = {
    repository: {
      identity: "github.com/example/demo",
      git: { head_sha: "a".repeat(40) }
    }
  };
  const config = {
    quality: {
      commands: [
        { id: "docs-readiness-summary", kind: "test", run: "node -e 1", source: "docs" },
        { id: "pytest-health-readiness", kind: "test", run: "pytest", source: "pytest" },
        { id: "frontend-build", kind: "build", run: "npm run build", source: "frontend" }
      ]
    },
    harness: { services: [], verifications: [] }
  };
  const ladder = evaluatePhase2BaselineLadder({
    snapshot,
    config,
    trustContext: freeze({ manifests: [] }),
    understandingReady: true
  });
  // Without a trusted context, nothing is proved; next should be pytest first.
  assert.equal(ladder.next.id, "pytest-health-readiness");
  assert.equal(ladder.proved_count, 0);
  assert.match(formatPhase2BaselineLadder(ladder), /pytest-health-readiness/);
});

test("formatPhase2BaselineLadder marks stable when empty missing list", () => {
  const ladder = {
    understanding_ready: true,
    ready: true,
    commands: [{ id: "pytest-health-readiness", kind: "test", proved: true }],
    next: null,
    proved_count: 1,
    total_count: 1,
    reasons: []
  };
  assert.match(formatPhase2BaselineLadder(ladder), /\*\*stable\*\*/);
});

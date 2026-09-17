import assert from "node:assert/strict";
import test from "node:test";

import { selectVerifyCommandId, verifyHintFromReadiness } from "../src/select-verify-command.mjs";

const COMMANDS = [
  { id: "docs-readiness-summary", kind: "test", run: "node -e readiness", source: "docs-only" },
  { id: "controlled-change-marker", kind: "test", run: "node -e marker", source: "marker" },
  { id: "health-service-field", kind: "test", run: "node -e health main.py", source: "legacy /health service identity" },
  { id: "docker-compose-build", kind: "build", run: "docker compose build", source: "compose" }
];

test("explicit command wins when present", () => {
  const selected = selectVerifyCommandId({
    commands: COMMANDS,
    explicitCommandId: "health-service-field",
    goalText: "anything",
    deliveryMode: "controlled-change"
  });
  assert.equal(selected.command_id, "health-service-field");
  assert.equal(selected.reason, "explicit --command");
});

test("prefers health command when change touches main.py and goal mentions health", () => {
  const selected = selectVerifyCommandId({
    commands: COMMANDS,
    goalText: "Add service identity to legacy /health JSON",
    deliveryMode: "controlled-change",
    changeSpec: {
      changes: [{
        kind: "replace-in-file",
        relative_path: "backend/src/main.py",
        old_string: "a",
        new_string: "b"
      }]
    }
  });
  assert.equal(selected.command_id, "health-service-field");
});

test("docs-only defaults toward docs-readiness-summary", () => {
  const selected = selectVerifyCommandId({
    commands: COMMANDS,
    goalText: "Summarize readiness",
    deliveryMode: "docs-only"
  });
  assert.equal(selected.command_id, "docs-readiness-summary");
});

test("verifyHintFromReadiness builds the exact next command", () => {
  assert.equal(
    verifyHintFromReadiness({
      verify_command_id: "health-service-field",
      change_commit_sha: "abc123"
    }, { runId: "run-1" }),
    "devharness verify --run run-1 --command health-service-field --commit abc123 --execute --attest"
  );
});

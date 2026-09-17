import assert from "node:assert/strict";
import test from "node:test";

import { evaluateVerificationExecutionAuthority } from "../../core/src/execution-authority.mjs";
import { summarizeVerifyCapabilityGap } from "../src/verify-capabilities.mjs";

function view(statuses, head = "a".repeat(40)) {
  return {
    repository_identity: "example.com/acme/demo",
    head_sha: head,
    capabilities: Object.entries(statuses).map(([id, status]) => ({
      status,
      request: { id, capability: id },
      approval_request_id: status === "pending" ? `req-${id}` : null,
      approval_receipt_id: status === "approved" ? `rcpt-${id}` : null
    }))
  };
}

test("summarizeVerifyCapabilityGap splits pending vs need-request", () => {
  const plan = {
    repository_identity: "example.com/acme/demo",
    commit_sha: "a".repeat(40),
    command: { id: "health-service-field", run: "node -e health", source: "probe" },
    services: [{ command: { run: "npm install", source: "pkg" } }],
    submodules: []
  };
  const authority = evaluateVerificationExecutionAuthority(
    plan,
    view({ "service-runtime": "pending", "dependency-install": "unrequested" })
  );
  const gap = summarizeVerifyCapabilityGap(authority);
  assert.equal(gap.allowed, false);
  assert.deepEqual(gap.pending_ids, ["service-runtime"]);
  assert.deepEqual(gap.need_request_ids, ["dependency-install"]);
  assert.ok(gap.required_capability_ids.includes("dependency-install"));
  assert.ok(gap.required_capability_ids.includes("service-runtime"));
});

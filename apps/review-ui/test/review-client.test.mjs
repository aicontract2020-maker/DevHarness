import assert from "node:assert/strict";
import test from "node:test";

import { POLL_INTERVAL_MS, fetchCapabilityAuthorizations, fetchProjectDeclarationReview, fetchReviewInteraction, fetchVerificationReview, mapInteractionPacket, mapReviewIndex, parseReviewConnection, selectRunId } from "../lib/review-client.mjs";

test("review connection accepts only loopback API URLs and 256-bit tokens", () => {
  const token = "a".repeat(64);
  assert.deepEqual(parseReviewConnection(`#api=${encodeURIComponent("http://127.0.0.1:4317")}&token=${token}`), {
    apiOrigin: "http://127.0.0.1:4317",
    token
  });
  assert.equal(parseReviewConnection(`#api=${encodeURIComponent("https://remote.example")}&token=${token}`), null);
  assert.equal(parseReviewConnection(`#api=${encodeURIComponent("http://127.0.0.1:4317")}&token=short`), null);
});

test("run selection preserves a current run or chooses the newest", () => {
  const runs = [{ run_id: "run-new" }, { run_id: "run-old" }];
  assert.equal(selectRunId(runs, "run-old"), "run-old");
  assert.equal(selectRunId(runs, "run-missing"), "run-new");
  assert.equal(selectRunId([], "run-old"), null);
  assert.equal(POLL_INTERVAL_MS, 5000);
});

test("interaction reads accept only the bounded run endpoint", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  let requested;
  globalThis.fetch = async (url) => {
    requested = url;
    return {
      ok: true,
      json: async () => ({
        schema_version: 1,
        id: "packet-1",
        run_id: "run-1",
        kind: "alignment-brief",
        generated_at: "2026-09-01T18:00:00.000Z",
        head_sha: "a".repeat(40),
        title: "Alignment Brief · Deliver trustworthy work",
        verdict: "ready",
        summary: "The bundle is ready for explicit scope approval.",
        attention: { required: true, count: 0, reasons: ["gate-approval"] },
        sections: [{
          id: "alignment-outcome",
          title: "Refined outcome",
          items: [{
            id: "item-1",
            text: "Deliver trustworthy work.",
            confidence: "confirmed",
            severity: "info",
            source_refs: ["goal-1"]
          }]
        }],
        decisions: [],
        actions: [
          { id: "approve-scope", label: "Approve scope", kind: "approve", recommended: true },
          { id: "inspect-brief", label: "Inspect the brief", kind: "inspect", recommended: false }
        ],
        source_artifacts: [{
          id: "alignment-bundle-1",
          kind: "alignment-bundle",
          sha256: "b".repeat(64),
          uri: "file:///private/secret"
        }],
        traceability: [],
        compression: { source_artifact_count: 1, surfaced_item_count: 1, omitted_item_count: 0 }
      })
    };
  };
  const connection = { apiOrigin: "http://127.0.0.1:4317", token: "a".repeat(64) };
  const packet = await fetchReviewInteraction(connection, "/api/review/runs/run-1/interaction");
  assert.equal(packet.kind, "alignment-brief");
  assert.equal(packet.highlights.outcome, "Deliver trustworthy work.");
  assert.equal(packet.highlights.recommended_action, "Approve scope");
  assert.deepEqual(packet.source_artifacts, [{ id: "alignment-bundle-1", kind: "alignment-bundle", sha256: "b".repeat(64) }]);
  assert.equal(requested, "http://127.0.0.1:4317/api/review/runs/run-1/interaction");
  await assert.rejects(fetchReviewInteraction(connection, "https://evil.example/steal"), /invalid interaction path/i);
});

test("review mapping keeps the live brief safe and readable", () => {
  const packet = mapInteractionPacket({
    schema_version: 1,
    id: "packet-1",
    run_id: "run-1",
    kind: "alignment-brief",
    generated_at: "2026-09-01T18:00:00.000Z",
    head_sha: "a".repeat(40),
    title: "Alignment Brief · Deliver trustworthy work",
    verdict: "ready",
    summary: "The bundle is ready for explicit scope approval.",
    attention: { required: true, count: 0, reasons: ["gate-approval"] },
    sections: [
      {
        id: "alignment-outcome",
        title: "Refined outcome",
        items: [
          {
            id: "item-1",
            text: "Deliver trustworthy work.",
            confidence: "confirmed",
            severity: "info",
            source_refs: ["goal-1"]
          }
        ]
      },
      {
        id: "alignment-understanding",
        title: "Confirmed project/system understanding",
        items: [
          { id: "item-2", text: "Area coverage is complete.", confidence: "confirmed", severity: "info", source_refs: ["goal-1"], metrics: { known_claims: 2, total_claims: 2, unknown_claims: 0, conflict_claims: 0 } },
          { id: "item-3", text: "Claims: 2 surfaced.", confidence: "confirmed", severity: "info", source_refs: ["goal-1"] }
        ]
      },
      {
        id: "alignment-boundaries",
        title: "Boundaries/non-goals",
        items: [
          { id: "item-4", text: "Do not edit the consumer repository.", confidence: "confirmed", severity: "warning", source_refs: ["goal-1"] }
        ]
      },
      {
        id: "alignment-criteria",
        title: "Acceptance criteria/proof gaps",
        items: [
          { id: "item-5", text: "No unresolved proof gaps remain.", confidence: "confirmed", severity: "info", source_refs: ["goal-1"] }
        ]
      }
    ],
    decisions: [],
    actions: [
      { id: "approve-scope", label: "Approve scope", kind: "approve", recommended: true },
      { id: "inspect-brief", label: "Inspect the brief", kind: "inspect", recommended: false }
    ],
    source_artifacts: [{
      id: "alignment-bundle-1",
      kind: "alignment-bundle",
      sha256: "b".repeat(64),
      uri: "file:///private/secret"
    }],
    traceability: [{ item_id: "item-1", source_refs: ["goal-1"] }],
    compression: { source_artifact_count: 1, surfaced_item_count: 5, omitted_item_count: 0 }
  });
  assert.equal(packet.highlights.outcome, "Deliver trustworthy work.");
  assert.deepEqual(packet.highlights.understanding, ["Area coverage is complete.", "Claims: 2 surfaced."]);
  assert.deepEqual(packet.highlights.boundaries, ["Do not edit the consumer repository."]);
  assert.deepEqual(packet.highlights.criteria, ["No unresolved proof gaps remain."]);
  assert.equal(packet.highlights.decision_count, 0);
  assert.equal(packet.highlights.recommended_action, "Approve scope");
  assert.equal(packet.source_artifacts[0].id, "alignment-bundle-1");
  assert.equal(Object.hasOwn(packet.source_artifacts[0], "uri"), false);
});

test("capability reads accept only the bounded run endpoint", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  let requested;
  globalThis.fetch = async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ counts: { total: 1 } }) };
  };
  const connection = { apiOrigin: "http://127.0.0.1:4317", token: "a".repeat(64) };
  assert.deepEqual(await fetchCapabilityAuthorizations(connection, "/api/review/runs/run-1/capabilities"), { counts: { total: 1 } });
  assert.equal(requested, "http://127.0.0.1:4317/api/review/runs/run-1/capabilities");
  await assert.rejects(fetchCapabilityAuthorizations(connection, "https://evil.example/steal"), /invalid capabilities path/i);
});

test("project declaration review uses only the fixed local read endpoint", async (t) => {
  const previousFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = previousFetch; });
  let requested;
  globalThis.fetch = async (url) => {
    requested = url;
    return { ok: true, json: async () => ({ verdict: "blocked" }) };
  };
  const connection = { apiOrigin: "http://127.0.0.1:4317", token: "a".repeat(64) };
  assert.deepEqual(await fetchProjectDeclarationReview(connection), { verdict: "blocked" });
  assert.equal(requested, "http://127.0.0.1:4317/api/review/project-declaration");
});

test("verification review uses only the fixed local read endpoint", async (t) => {
  const requested = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    requested.push(String(url));
    return { ok: true, json: async () => ({ schema_version: 1, verifications: [] }) };
  });
  const connection = { apiOrigin: "http://127.0.0.1:4317", token: "a".repeat(64) };
  await fetchVerificationReview(connection);
  assert.deepEqual(requested, ["http://127.0.0.1:4317/api/review/verifications"]);
});

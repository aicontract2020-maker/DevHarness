import assert from "node:assert/strict";
import test from "node:test";

import { POLL_INTERVAL_MS, fetchCapabilityAuthorizations, fetchProjectDeclarationReview, fetchReviewInteraction, fetchVerificationReview, parseReviewConnection, selectRunId } from "../lib/review-client.mjs";

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
    return { ok: true, json: async () => ({ kind: "alignment-brief" }) };
  };
  const connection = { apiOrigin: "http://127.0.0.1:4317", token: "a".repeat(64) };
  assert.deepEqual(await fetchReviewInteraction(connection, "/api/review/runs/run-1/interaction"), { kind: "alignment-brief" });
  assert.equal(requested, "http://127.0.0.1:4317/api/review/runs/run-1/interaction");
  await assert.rejects(fetchReviewInteraction(connection, "https://evil.example/steal"), /invalid interaction path/i);
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

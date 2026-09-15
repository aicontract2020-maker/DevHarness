import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createResearchOriginCandidate, createResearchRequestRecipe, createNetworkResearchSubject } from "../src/research-policy.mjs";
import { runControlledResearchGateway, researchGatewayPaths } from "../src/research-gateway.mjs";

const now = "2026-09-01T12:00:00.000Z";
const repositoryIdentity = "example/project";
const commitSha = "a".repeat(40);
const operationId = "operation-1";
const queryId = "research-query-1";
const origin = "https://docs.example.com";

function buildSubject(queryId = "research-query-1") {
  const originCandidate = createResearchOriginCandidate({ id: "docs", origin, source: "developer-input", sourceSha256: "b".repeat(64) });
  return createNetworkResearchSubject({
    operationId,
    queries: [{ id: queryId, query_sha256: "c".repeat(64), purpose: "best practices" }],
    origins: [originCandidate],
    maxQueries: 1,
    maxSourcesPerQuery: 5,
    maxRequests: 1,
    maxRedirectsPerRequest: 3,
    maxResponseBytes: 2_097_152,
    maxTotalBytes: 10_485_760,
    requestDeadlineSeconds: 30
  });
}

function buildRecipe(url = `${origin}/guide`) {
  return createResearchRequestRecipe({
    id: "request-1",
    originId: "docs",
    url,
    deadlineSeconds: 30,
    maxResponseBytes: 2_097_152,
    allowedOrigins: [origin]
  });
}

async function setup(t) {
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-research-gateway-"));
  t.after(() => rm(dataRoot, { recursive: true, force: true }));
  return dataRoot;
}

test("research gateway reserves before fetch, sanitizes excerpts, and writes a success terminal", async (t) => {
  const dataRoot = await setup(t);
  const subject = buildSubject();
  const recipe = buildRecipe();
  const order = [];
  const fetched = [];
  const result = await runControlledResearchGateway({
    dataRoot,
    repositoryIdentity,
    runId: "run-1",
    commitSha,
    operationId,
    queryId,
    query: "public best practices for browser testing",
    subject,
    authority: {
      capability: "network-research",
      subject_id: subject.id,
      subject_sha256: subject.subject_sha256,
      request_id: "authority-request-1",
      receipt_id: "authority-receipt-1",
      request_sha256: "d".repeat(64),
      receipt_sha256: "e".repeat(64),
      approved_at: now,
      expires_at: "2026-09-01T12:30:00.000Z"
    },
    authorityEpoch: 1,
    requestRecipe: recipe,
    fetchImpl: async (url, init) => {
      order.push("fetch");
      fetched.push({ url, init });
      assert.equal(init.method, "GET");
      assert.equal(init.body, undefined);
      return new Response("<html><title>Best Practices</title><body>Hello\u0000World</body></html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    },
    publishReservation: async () => order.push("reservation"),
    publishReceipt: async () => order.push("receipt"),
    now: () => new Date(now)
  });

  assert.deepEqual(order, ["reservation", "fetch", "receipt"]);
  assert.equal(fetched[0].url, `${origin}/guide`);
  assert.equal(result.manifest.outcome, "success");
  assert.equal(result.source.approved_origin, origin);
  assert.equal(result.receipt.usage, null);
  assert.equal(result.receipt.research_payload_sha256, result.source.research_payload_sha256);
  assert.equal(result.source.excerpt.includes("\u0000"), false);
  assert.match(result.source.excerpt, /HelloWorld/);
  assert.equal(result.source.title, "Best Practices");
  assert.equal(result.receipt.final_url, `${origin}/guide`);

  const paths = researchGatewayPaths(dataRoot, repositoryIdentity, operationId, 1);
  const manifest = JSON.parse(await readFile(path.join(paths.terminal, "manifest.json"), "utf8"));
  const receipt = JSON.parse(await readFile(path.join(paths.terminal, "receipt.json"), "utf8"));
  const source = JSON.parse(await readFile(path.join(paths.terminal, "source.json"), "utf8"));
  assert.equal(manifest.outcome, "success");
  assert.equal(receipt.id, result.receipt.id);
  assert.equal(source.id, result.source.id);
});

test("research gateway writes a gap terminal for denied redirects and does not refetch on replay", async (t) => {
  const dataRoot = await setup(t);
  const subject = buildSubject("research-query-2");
  const recipe = buildRecipe();
  let fetchCount = 0;
  const baseArgs = {
    dataRoot,
    repositoryIdentity,
    runId: "run-1",
    commitSha,
    operationId,
    queryId: "research-query-2",
    query: "public best practices for browser testing",
    subject,
    authority: {
      capability: "network-research",
      subject_id: subject.id,
      subject_sha256: subject.subject_sha256,
      request_id: "authority-request-1",
      receipt_id: "authority-receipt-1",
      request_sha256: "d".repeat(64),
      receipt_sha256: "e".repeat(64),
      approved_at: now,
      expires_at: "2026-09-01T12:30:00.000Z"
    },
    authorityEpoch: 1,
    requestRecipe: recipe,
    now: () => new Date(now)
  };

  const first = await runControlledResearchGateway({
    ...baseArgs,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(null, { status: 302, headers: { location: "https://evil.example/redirect" } });
    }
  });
  assert.equal(first.manifest.outcome, "failure");
  assert.equal(first.gap.reason, "denied");
  assert.equal(first.receipt.status, "failed");
  assert.equal(first.receipt.diagnostic_code, "ORIGIN_NOT_ALLOWED");

  const second = await runControlledResearchGateway({
    ...baseArgs,
    fetchImpl: async () => {
      fetchCount += 1;
      return new Response(null, { status: 200 });
    }
  });
  assert.equal(fetchCount, 1);
  assert.equal(second.manifest.id, first.manifest.id);
  assert.equal(second.gap.id, first.gap.id);
  const paths = researchGatewayPaths(dataRoot, repositoryIdentity, operationId, 1);
  const entries = await readdir(paths.terminal);
  assert.deepEqual(entries.sort(), ["gap.json", "manifest.json", "receipt.json"]);
});

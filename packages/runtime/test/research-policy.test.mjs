import assert from "node:assert/strict";
import test from "node:test";

import {
  buildResearchQueryText,
  createNetworkResearchSubject,
  createResearchOriginCandidate,
  createResearchRequestRecipe,
  nextResearchAuthorityEpoch,
  normalizeExactHttpsOrigin,
  normalizeExactHttpsUrl,
  validateResearchRedirect
} from "../src/research-policy.mjs";

const sourceSha = "a".repeat(64);

test("research queries stay public and the subject hash is stable", () => {
  const query = buildResearchQueryText({
    originalGoal: "Add password reset and email verification",
    dependencySignals: [
      { name: "next", version: "14.2.0" },
      { name: "postgres", version: "16" },
      { secret: "ghp_super_secret" },
      "/Users/me/private/repo"
    ],
    publicIdentifiers: ["Playwright", "Vitest"]
  });

  assert.match(query, /password reset/);
  assert.match(query, /next 14\.2\.0/);
  assert.match(query, /postgres 16/);
  assert.match(query, /Playwright/);
  assert.equal(query.includes("ghp_super_secret"), false);
  assert.equal(query.includes("/Users/me/private/repo"), false);

  const origin = createResearchOriginCandidate({ id: "docs", origin: "https://docs.example.com", source: "developer-input", sourceSha256: sourceSha });
  const subjectA = createNetworkResearchSubject({
    operationId: "operation-1",
    queries: [{ id: "query-1", query_sha256: "b".repeat(64), purpose: "research" }],
    origins: [origin],
    maxQueries: 3,
    maxSourcesPerQuery: 5,
    maxRequests: 10,
    maxRedirectsPerRequest: 2,
    maxResponseBytes: 4096,
    maxTotalBytes: 8192,
    requestDeadlineSeconds: 30
  });
  const subjectB = createNetworkResearchSubject({
    operationId: "operation-1",
    queries: [{ id: "query-1", query_sha256: "b".repeat(64), purpose: "research" }],
    origins: [origin],
    maxQueries: 3,
    maxSourcesPerQuery: 5,
    maxRequests: 10,
    maxRedirectsPerRequest: 2,
    maxResponseBytes: 4096,
    maxTotalBytes: 8192,
    requestDeadlineSeconds: 30
  });
  assert.equal(subjectA.query_set_sha256.length, 64);
  assert.equal(subjectA.subject_sha256.length, 64);
  assert.equal(subjectA.subject_sha256, subjectB.subject_sha256);

  const epoch1 = nextResearchAuthorityEpoch({ subject: subjectA });
  const epoch2 = nextResearchAuthorityEpoch({ subject: subjectB, previous: epoch1 });
  assert.equal(epoch1.epoch, 1);
  assert.equal(epoch2.epoch, 2);
  assert.throws(() => nextResearchAuthorityEpoch({ subject: { ...subjectA, subject_sha256: "d".repeat(64) }, previous: epoch2 }), /authority changed/i);
});

test("research origins and recipes require exact HTTPS destinations", () => {
  assert.equal(normalizeExactHttpsOrigin("https://docs.example.com"), "https://docs.example.com");
  assert.throws(() => normalizeExactHttpsOrigin("http://docs.example.com"), /HTTPS/);
  assert.throws(() => normalizeExactHttpsOrigin("https://localhost"), /must not target localhost/);
  assert.throws(() => normalizeExactHttpsOrigin("https://127.0.0.1"), /must not target localhost/);

  assert.equal(normalizeExactHttpsUrl("https://docs.example.com/path?q=1"), "https://docs.example.com/path?q=1");
  assert.throws(() => normalizeExactHttpsUrl("https://docs.example.com/#frag"), /exact HTTPS/);
  assert.throws(() => normalizeExactHttpsUrl("https://docs.example.com/path", ["https://other.example.com"]), /approved origin/);

  const candidate = createResearchOriginCandidate({ id: "docs", origin: "https://docs.example.com", source: "signed-runtime-registry", sourceSha256: sourceSha });
  const recipe = createResearchRequestRecipe({
    id: "recipe-1",
    originId: candidate.id,
    url: "https://docs.example.com/path?q=1",
    deadlineSeconds: 30,
    maxResponseBytes: 2048
  });
  assert.equal(recipe.url, "https://docs.example.com/path?q=1");
  assert.equal(recipe.method, "GET");
  assert.equal(recipe.adapter, "exact-https-get-v1");
  assert.equal(recipe.recipe_sha256.length, 64);
});

test("redirects are only allowed inside the approved origin set", () => {
  const allowed = ["https://docs.example.com"];
  assert.equal(validateResearchRedirect({ fromUrl: "https://docs.example.com/a", location: "/b", allowedOrigins: allowed }), "https://docs.example.com/b");
  assert.throws(() => validateResearchRedirect({ fromUrl: "https://docs.example.com/a", location: "https://evil.example/b", allowedOrigins: allowed }), /redirect/i);
  assert.throws(() => validateResearchRedirect({ fromUrl: "https://docs.example.com/a", location: "http://docs.example.com/b", allowedOrigins: allowed }), /HTTPS/);
});

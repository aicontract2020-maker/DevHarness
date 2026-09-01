import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SchemaRegistry } from "../src/validator.mjs";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schemas/v1");
const registry = new SchemaRegistry(await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".schema.json")).map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")))));
const id = (name) => `https://devharness.dev/schemas/v1/${name}.schema.json`;
const hash = "a".repeat(64);
const commit = "b".repeat(40);
const now = "2026-09-01T12:00:00.000Z";
const attestation = { issuer_id: "supervisor-local", issuer_fingerprint: hash, payload_sha256: hash, algorithm: "Ed25519", signature: `${"A".repeat(86)}==` };

const legacyCapability = { id: "browser", capability: "browser-runtime", operation: "install-and-run", target: "local-browser", scope: ["localhost"], reason: "Exercise the real UI.", risk: "medium", authority: "explicit", decision: "pending" };
const capabilityDocument = (request) => ({ schema_version: 1, id: "authority-1", repository_identity: "example/project", created_at: now, requests: [request], status: "pending" });
const approvalRequest = (gate = "scope") => ({ schema_version: 1, id: "approval-request-1", run_id: "run-1", repository_identity: "example/project", relevant_head_sha: commit, gate, subject: { id: "subject-1", artifact_sha256: hash }, nonce: "nonce-0123456789abcdef", requested_at: now, expires_at: "2026-09-01T13:00:00.000Z", status: "pending", attestation });
const approvalReceipt = (gate = "scope") => ({ schema_version: 1, id: "approval-receipt-1", request_id: "approval-request-1", request_sha256: hash, run_id: "run-1", repository_identity: "example/project", relevant_head_sha: commit, gate, subject: { id: "subject-1", artifact_sha256: hash }, nonce: "nonce-0123456789abcdef", decision: "approved", decided_at: now, decided_by: { id: "developer", kind: "human" }, source: "interactive-human-gate", expires_at: "2026-09-01T13:00:00.000Z", attestation });

test("legacy capabilities and approval gates retain their original valid shapes", () => {
  assert.equal(registry.validate(id("capability-request"), capabilityDocument(legacyCapability)).valid, true);
  assert.equal(registry.validate(id("approval-request"), approvalRequest()).valid, true);
  assert.equal(registry.validate(id("approval-receipt"), approvalReceipt()).valid, true);
});

test("agent-runtime and network-research capabilities add bounded reversibility without widening legacy fields", () => {
  const request = { ...legacyCapability, id: "agent-runtime", capability: "agent-runtime", operation: "analyze-goal-read-only", target: hash, scope: ["repository:example/project", `revision:${commit}`, "no-consumer-write"], reason: "Produce and independently validate a live Alignment Brief.", risk: "high", authority: "human-only", reversibility: "Revocable before each external attempt; historical outputs remain labeled." };
  assert.equal(registry.validate(id("capability-request"), capabilityDocument(request)).valid, true);
  assert.equal(registry.validate(id("capability-request"), capabilityDocument({ ...request, capability: "network-research", operation: "fetch-public-guidance" })).valid, true);
  assert.equal(registry.validate(id("capability-request"), capabilityDocument({ ...request, reversibility: "x".repeat(501) })).valid, false);
  assert.equal(registry.validate(id("capability-request"), capabilityDocument({ ...request, inherited_authority: true })).valid, false);
});

test("alignment-answer is a signed human gate without changing existing gate meanings", () => {
  assert.equal(registry.validate(id("approval-request"), approvalRequest("alignment-answer")).valid, true);
  assert.equal(registry.validate(id("approval-receipt"), approvalReceipt("alignment-answer")).valid, true);
  assert.equal(registry.validate(id("approval-request"), approvalRequest("agent-self-approval")).valid, false);
  assert.equal(registry.validate(id("approval-receipt"), { ...approvalReceipt("alignment-answer"), decided_by: { id: "codex", kind: "agent" } }).valid, true, "the portable receipt remains generic; runtime policy verifies a human actor");
});

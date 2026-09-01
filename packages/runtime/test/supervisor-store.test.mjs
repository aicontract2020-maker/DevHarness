import assert from "node:assert/strict";
import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { approvalRequestHash } from "../../core/src/approval-policy.mjs";
import { evaluateTransition } from "../../core/src/state-machine.mjs";
import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { assertContract } from "../../project/src/contracts.mjs";
import {
  artifactPayloadHash,
  canonicalArtifactBytes,
  verifySupervisorArtifact
} from "../src/supervisor-crypto.mjs";
import {
  approvalReceiptPath,
  attestApprovalReceipt,
  attestEvidenceManifest,
  evidenceManifestPath,
  initializeSupervisorIdentity,
  listVerifiedApprovalReceipts,
  listVerifiedApprovalRequests,
  listVerifiedEvidenceManifests,
  loadSupervisorIdentity,
  storeEvidenceBlob,
  writeApprovalReceipt,
  writeEvidenceManifest
} from "../src/supervisor-store.mjs";
import { createSupervisorApprovalRequest } from "../src/supervisor-approval.mjs";

const sha = "a".repeat(40);
const hash = "b".repeat(64);
const now = "2026-08-30T12:00:00.000Z";

function manifestPayload(identity, overrides = {}, artifact = { uri: "blob:sha256:bbbb", media_type: "text/plain", sha256: hash, size_bytes: 4 }) {
  return {
    schema_version: 1,
    id: "evidence-run-1",
    repository_identity: "example/project",
    commit_sha: sha,
    run_id: "run-1",
    criterion: { id: "AC-1", sha256: hash },
    command: { id: "root-test", kind: "test", sha256: hash },
    harness: { config_sha256: hash, verification_sha256: hash },
    driver: { id: "command-test", version: 1, implementation_sha256: hash },
    recipe_sha256: hash,
    receipt: { id: "verify-1", sha256: hash },
    issued_at: now,
    outcome: { status: "pass", summary: "The registered test driver verified the receipt." },
    evidence_records: [{
      schema_version: 1,
      id: "test-result-1",
      run_id: "run-1",
      criterion_ids: ["AC-1"],
      type: "test-result",
      producer: { id: "command-test", kind: "tool" },
      captured_at: now,
      subject: { repository_identity: "example/project", commit_sha: sha },
      observation: { result: "pass", summary: "Tests passed." },
      artifacts: [artifact]
    }],
    issuer: { id: identity.id, fingerprint: identity.fingerprint },
    ...overrides
  };
}

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-supervisor-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const initialized = await initializeSupervisorIdentity(root, { now: () => new Date(now) });
  return { root, identity: initialized.identity };
}

test("supervisor identity is pinned, protected and idempotently loadable", async (t) => {
  const { root, identity } = await fixture(t);
  await assertContract("supervisor-identity", identity);
  assert.equal(identity.algorithm, "Ed25519");
  assert.match(identity.fingerprint, /^[0-9a-f]{64}$/);
  assert.deepEqual(await loadSupervisorIdentity(root), identity);
  const second = await initializeSupervisorIdentity(root);
  assert.equal(second.created, false);
  assert.deepEqual(second.identity, identity);

  if (process.platform !== "win32") {
    const keyInfo = await lstat(path.join(root, "private", "supervisor-key.pk8"));
    assert.equal(keyInfo.mode & 0o077, 0);
  }
});

test("canonical bytes are stable, domain separated and reject non-JSON values", () => {
  const first = canonicalArtifactBytes("evidence-manifest", { z: 1, a: { y: 2, x: 3 } });
  const second = canonicalArtifactBytes("evidence-manifest", { a: { x: 3, y: 2 }, z: 1 });
  assert.deepEqual(first, second);
  assert.notDeepEqual(first, canonicalArtifactBytes("approval-request", { a: { x: 3, y: 2 }, z: 1 }));
  assert.throws(() => canonicalArtifactBytes("evidence-manifest", { value: undefined }), /JSON-compatible/);
  assert.throws(() => canonicalArtifactBytes("unknown-kind", {}), /Unsupported supervisor artifact kind/);
});

test("signed evidence manifest binds every payload field and verifies after restart", async (t) => {
  const { root, identity } = await fixture(t);
  const signed = await attestEvidenceManifest(root, manifestPayload(identity));
  await assertContract("evidence-manifest", signed);
  assert.equal(signed.attestation.payload_sha256, artifactPayloadHash("evidence-manifest", signed));
  assert.equal(verifySupervisorArtifact("evidence-manifest", signed, identity), true);

  for (const mutate of [
    (value) => { value.commit_sha = "c".repeat(40); },
    (value) => { value.command.sha256 = "c".repeat(64); },
    (value) => { value.criterion.sha256 = "c".repeat(64); },
    (value) => { value.driver.version = 2; },
    (value) => { value.evidence_records[0].artifacts[0].sha256 = "c".repeat(64); },
    (value) => { value.attestation.signature = `${value.attestation.signature[0] === "A" ? "B" : "A"}${value.attestation.signature.slice(1)}`; }
  ]) {
    const tampered = structuredClone(signed);
    mutate(tampered);
    assert.equal(verifySupervisorArtifact("evidence-manifest", tampered, identity), false);
  }

  const reloadedIdentity = await loadSupervisorIdentity(root);
  assert.equal(verifySupervisorArtifact("evidence-manifest", signed, reloadedIdentity), true);
});

test("immutable evidence store rejects overwrite, truncation, forgery and repository replay", async (t) => {
  const { root, identity } = await fixture(t);
  const source = path.join(root, "source.log");
  await writeFile(source, "test");
  const blob = await storeEvidenceBlob(root, { uri: new URL(`file://${source}`).href, media_type: "text/plain", sha256: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", size_bytes: 4 });
  const signed = await attestEvidenceManifest(root, manifestPayload(identity, {}, blob));
  const stored = await writeEvidenceManifest(root, signed.repository_identity, signed);
  assert.equal(stored.written, true);
  await assert.rejects(writeEvidenceManifest(root, signed.repository_identity, signed), /already exists/);
  assert.equal((await listVerifiedEvidenceManifests(root, signed.repository_identity)).length, 1);
  assert.deepEqual(await listVerifiedEvidenceManifests(root, "other/project"), []);

  const target = evidenceManifestPath(root, signed.repository_identity, signed.id);
  await chmod(target, 0o600);
  await writeFile(target, "{\n", { encoding: "utf8" });
  assert.deepEqual(await listVerifiedEvidenceManifests(root, signed.repository_identity), []);

  const forged = structuredClone(signed);
  forged.id = "evidence-forged";
  forged.repository_identity = "other/project";
  await assert.rejects(writeEvidenceManifest(root, "other/project", forged), /signature|attestation/i);
});

test("identity and manifest loaders reject symlinks and conflicting partial identity", async (t) => {
  const { root, identity } = await fixture(t);
  const signed = await attestEvidenceManifest(root, manifestPayload(identity));
  const manifest = evidenceManifestPath(root, signed.repository_identity, signed.id);
  await mkdir(path.dirname(manifest), { recursive: true });
  await symlink(path.join(root, "identity.json"), manifest);
  assert.deepEqual(await listVerifiedEvidenceManifests(root, signed.repository_identity), []);

  const partial = await mkdtemp(path.join(os.tmpdir(), "devharness-supervisor-partial-"));
  t.after(() => rm(partial, { recursive: true, force: true }));
  await writeFile(path.join(partial, "identity.json"), JSON.stringify(identity));
  await assert.rejects(initializeSupervisorIdentity(partial), /incomplete|conflict/i);

  const redirected = await mkdtemp(path.join(os.tmpdir(), "devharness-supervisor-redirected-"));
  const outside = await mkdtemp(path.join(os.tmpdir(), "devharness-supervisor-outside-"));
  t.after(() => Promise.all([rm(redirected, { recursive: true, force: true }), rm(outside, { recursive: true, force: true })]));
  await symlink(outside, path.join(redirected, "private"));
  await assert.rejects(initializeSupervisorIdentity(redirected), /Unsafe Supervisor state directory/);

  const redirectedProjects = await mkdtemp(path.join(os.tmpdir(), "devharness-supervisor-projects-"));
  t.after(() => rm(redirectedProjects, { recursive: true, force: true }));
  await initializeSupervisorIdentity(redirectedProjects);
  await symlink(outside, path.join(redirectedProjects, "projects"));
  const redirectedIdentity = await loadSupervisorIdentity(redirectedProjects);
  const redirectedManifest = await attestEvidenceManifest(redirectedProjects, manifestPayload(redirectedIdentity));
  await assert.rejects(writeEvidenceManifest(redirectedProjects, redirectedManifest.repository_identity, redirectedManifest), /Unsafe Supervisor state directory/);
});

test("signed approval request and human receipt are exact, immutable and expire closed", async (t) => {
  const { root } = await fixture(t);
  const request = await createSupervisorApprovalRequest({
    supervisorRoot: root,
    repositoryIdentity: "example/project",
    relevantHeadSha: sha,
    runId: "run-approval-1",
    gate: "scope",
    subject: { id: "scope-v1", artifact_sha256: hash },
    expiresInMinutes: 60,
    now: () => new Date(now)
  });
  assert.equal((await listVerifiedApprovalRequests(root, "example/project", { now: new Date("2026-08-30T12:30:00.000Z") })).length, 1);

  const receipt = await attestApprovalReceipt(root, {
    schema_version: 1,
    id: "approval-receipt-1",
    request_id: request.id,
    request_sha256: approvalRequestHash(request),
    run_id: request.run_id,
    repository_identity: request.repository_identity,
    relevant_head_sha: request.relevant_head_sha,
    gate: request.gate,
    subject: structuredClone(request.subject),
    nonce: request.nonce,
    decision: "approved",
    decided_at: "2026-08-30T12:05:00.000Z",
    decided_by: { id: "developer", kind: "human" },
    source: "interactive-human-gate",
    expires_at: request.expires_at
  });
  await writeApprovalReceipt(root, request.repository_identity, receipt);
  assert.equal((await listVerifiedApprovalReceipts(root, request.repository_identity, { now: new Date("2026-08-30T12:30:00.000Z") })).length, 1);
  assert.deepEqual(await listVerifiedApprovalReceipts(root, request.repository_identity, { now: new Date("2026-08-30T14:00:00.000Z") }), []);

  const duplicate = await attestApprovalReceipt(root, { ...receipt, id: "approval-receipt-2", decision: "rejected", attestation: undefined });
  await assert.rejects(writeApprovalReceipt(root, request.repository_identity, duplicate), /already has an immutable decision/);

  const target = approvalReceiptPath(root, request.repository_identity, receipt.id);
  await writeFile(target, `${JSON.stringify({ ...receipt, decision: "rejected" })}\n`);
  assert.deepEqual(await listVerifiedApprovalReceipts(root, request.repository_identity, { now: new Date("2026-08-30T12:30:00.000Z") }), []);
});

test("environment-selected roots cannot inject approval into a state gate", async (t) => {
  const { root } = await fixture(t);
  const current = new Date();
  const request = await createSupervisorApprovalRequest({
    supervisorRoot: root,
    repositoryIdentity: "example/project",
    relevantHeadSha: sha,
    runId: "run-gated-1",
    gate: "scope",
    subject: { id: "scope-current", artifact_sha256: hash },
    expiresInMinutes: 60,
    now: () => current
  });
  const receipt = await attestApprovalReceipt(root, {
    schema_version: 1,
    id: "approval-receipt-current",
    request_id: request.id,
    request_sha256: approvalRequestHash(request),
    run_id: request.run_id,
    repository_identity: request.repository_identity,
    relevant_head_sha: request.relevant_head_sha,
    gate: request.gate,
    subject: structuredClone(request.subject),
    nonce: request.nonce,
    decision: "approved",
    decided_at: current.toISOString(),
    decided_by: { id: "developer", kind: "human" },
    source: "interactive-human-gate",
    expires_at: request.expires_at
  });
  await writeApprovalReceipt(root, request.repository_identity, receipt);

  const snapshot = {
    repository: { identity: "example/project", git: { head_sha: sha, dirty: false } },
    detected: { platforms: [], services: [], frameworks: [], deployment_files: [] },
    environment: { declared_keys: [], locally_set_keys: [] }
  };
  const previousDataRoot = process.env.DEVHARNESS_DATA_DIR;
  process.env.DEVHARNESS_DATA_DIR = root;
  let trustContext;
  try {
    trustContext = await loadTrustedEvaluationContext({ snapshot, approvals: [{ decision: "approved" }] });
  } finally {
    if (previousDataRoot === undefined) delete process.env.DEVHARNESS_DATA_DIR;
    else process.env.DEVHARNESS_DATA_DIR = previousDataRoot;
  }
  const requirement = {
    repositoryIdentity: "example/project",
    relevantHeadSha: sha,
    runId: "run-gated-1",
    subject: { id: "scope-current", artifact_sha256: hash }
  };
  assert.equal(trustContext.approvals.length, 0);
  assert.equal(evaluateTransition("awaiting_scope_approval", "planning", { trustContext, approvalRequirement: requirement }).allowed, false);
  assert.equal(evaluateTransition("awaiting_scope_approval", "planning", { trustContext, approvalRequirement: { ...requirement, relevantHeadSha: "c".repeat(40) } }).allowed, false);
  assert.equal(evaluateTransition("awaiting_scope_approval", "planning", { scopeApproved: true }).allowed, false);
});

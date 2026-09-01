import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalDigest,
  canonicalRecordId,
  operationAccountingHead
} from "../src/canonical-records.mjs";
import { assertAlignmentIntegrity } from "../src/alignment-integrity.mjs";

const now = "2026-09-01T12:00:00.000Z";
const commit = "b".repeat(40);
const hash = "a".repeat(64);

function identified(type, value, excluded = ["id"]) {
  const record = { ...value, id: "pending" };
  record.id = canonicalRecordId(type, record, excluded);
  return record;
}

function fixture() {
  const descriptor = {
    id: "codex", version: "1.0.0", implementation_sha256: hash,
    executable_sha256: "c".repeat(64), profile_template_sha256: "d".repeat(64)
  };
  descriptor.descriptor_sha256 = canonicalDigest("agent-descriptor", descriptor, ["descriptor_sha256"]);

  const operation = identified("alignment-operation", {
    run_id: "run-1", repository_identity: "example/project", commit_sha: commit,
    agent_descriptor: descriptor,
    agent_authority_subject: { id: "agent-subject-1", sha256: "e".repeat(64) }
  });
  const agentAuthority = {
    capability: "agent-runtime", subject_id: operation.agent_authority_subject.id,
    subject_sha256: operation.agent_authority_subject.sha256,
    receipt_sha256: "f".repeat(64)
  };
  const producerInvocation = identified("agent-invocation", {
    operation_id: operation.id, phase: "analysis-synthesis", execution_instance_id: "execution-producer",
    adapter: descriptor, authorities: [agentAuthority], profile_instance_sha256: "1".repeat(64), created_at: now
  }, ["id", "created_at"]);
  const validatorInvocation = identified("agent-invocation", {
    operation_id: operation.id, phase: "analysis-validation", execution_instance_id: "execution-validator",
    adapter: descriptor, authorities: [agentAuthority], profile_instance_sha256: "2".repeat(64), created_at: now
  }, ["id", "created_at"]);
  const attempts = [
    identified("agent-attempt", { operation_id: operation.id, invocation_id: producerInvocation.id, phase: producerInvocation.phase, execution_instance_id: producerInvocation.execution_instance_id, profile_instance_sha256: producerInvocation.profile_instance_sha256, isolation_proof_sha256: "3".repeat(64) }),
    identified("agent-attempt", { operation_id: operation.id, invocation_id: validatorInvocation.id, phase: validatorInvocation.phase, execution_instance_id: validatorInvocation.execution_instance_id, profile_instance_sha256: validatorInvocation.profile_instance_sha256, isolation_proof_sha256: "4".repeat(64) })
  ];

  const recipe = { id: "recipe-1", url: "https://docs.example.com/guide", method: "GET", recipe_sha256: "pending" };
  recipe.recipe_sha256 = canonicalDigest("research-request-recipe", recipe, ["recipe_sha256"]);
  const query = { id: "pending", operation_id: operation.id, requests: [recipe], query_sha256: "pending" };
  query.query_sha256 = canonicalDigest("research-query", query, ["id", "query_sha256"]);
  query.id = canonicalRecordId("research-query", query, ["id", "query_sha256"]);
  const networkAuthority = { capability: "network-research", subject_id: "research-subject-1", subject_sha256: "5".repeat(64), receipt_sha256: "6".repeat(64) };
  const reservation = identified("outbound-request-reservation", {
    operation_id: operation.id, channel: "research", query_id: query.id,
    recipe_sha256: recipe.recipe_sha256, authority_capability: "network-research",
    authority_receipt_sha256: networkAuthority.receipt_sha256, authority_epoch: 1
  });
  const reservationSha = canonicalDigest("outbound-request-reservation", reservation);
  const receipt = identified("outbound-request-receipt", { reservation_id: reservation.id, reservation_sha256: reservationSha, research_payload_sha256: "7".repeat(64) });
  const receiptSha = canonicalDigest("outbound-request-receipt", receipt);
  const source = identified("research-source", {
    operation_id: operation.id, run_id: operation.run_id, repository_identity: operation.repository_identity,
    commit_sha: operation.commit_sha, query_id: query.id, network_authority_ref: networkAuthority,
    authority_epoch: 1, reservation_id: reservation.id, reservation_sha256: reservationSha,
    request_receipt_id: receipt.id, request_receipt_sha256: receiptSha,
    research_payload_sha256: receipt.research_payload_sha256, untrusted: true
  });
  const sourceSha = canonicalDigest("research-source", source);
  const manifest = identified("research-result-manifest", {
    operation_id: operation.id, reservation_id: reservation.id, reservation_sha256: reservationSha,
    outcome: "success", receipt_sha256: receiptSha, source_sha256: sourceSha,
    gap_sha256: null, research_payload_sha256: receipt.research_payload_sha256
  });
  const bundle = identified("alignment-bundle", {
    operation_id: operation.id, run_id: operation.run_id, repository_identity: operation.repository_identity,
    commit_sha: operation.commit_sha, agent_descriptor: descriptor,
    goal_ref: { id: "goal-1", kind: "goal", sha256: hash, storage_key: "artifacts/goal-1.json" },
    research_source_refs: [{ id: source.id, kind: "research-source", sha256: sourceSha, storage_key: `artifacts/${source.id}.json` }]
  });

  return { operation, invocations: [producerInvocation, validatorInvocation], attempts, research: [{ query, authority: networkAuthority, reservation, receipt, source, manifest }], bundle };
}

test("canonical digests are deterministic, domain-separated, exclusion-aware, and strict JSON", () => {
  assert.equal(canonicalDigest("example", { b: 2, a: 1 }), canonicalDigest("example", { a: 1, b: 2 }));
  assert.notEqual(canonicalDigest("example-a", { a: 1 }), canonicalDigest("example-b", { a: 1 }));
  assert.equal(canonicalDigest("example", { id: "one", a: 1 }, ["id"]), canonicalDigest("example", { id: "two", a: 1 }, ["id"]));
  assert.notEqual(canonicalDigest("example", [1, 2]), canonicalDigest("example", [2, 1]));
  assert.throws(() => canonicalDigest("example", { missing: undefined }), /JSON-compatible/);
  assert.throws(() => canonicalDigest("example", { fraction: 1.5 }), /integer/);
});

test("accounting heads use only exact allowed paths and bytewise path order", () => {
  const entries = [
    { storage_key: "outbound/research/1/terminal/source.json", sha256: "1".repeat(64) },
    { storage_key: "attempts/analysis-plan/1/attempt.json", sha256: "2".repeat(64) },
    { storage_key: "outbound/research/1/terminal/receipt.json", sha256: "3".repeat(64) },
    { storage_key: "outbound/research/1/terminal/manifest.json", sha256: "4".repeat(64) },
    { storage_key: "outbound/research/1/reservation.json", sha256: "5".repeat(64) }
  ];
  assert.equal(operationAccountingHead(entries), operationAccountingHead(entries.toReversed()));
  assert.throws(() => operationAccountingHead([...entries, entries[0]]), /duplicate/);
  assert.throws(() => operationAccountingHead([{ storage_key: "../receipt.json", sha256: hash }]), /unsafe|unlisted/);
  assert.throws(() => operationAccountingHead(entries.filter(({ storage_key }) => !storage_key.endsWith("manifest.json"))), /terminal/);
});

test("cross-record integrity accepts a fully bound operation", () => {
  assert.doesNotThrow(() => assertAlignmentIntegrity(fixture()));
});

test("cross-record integrity rejects revision, authority, digest, and Agent identity mismatches", () => {
  const wrongRevision = fixture();
  wrongRevision.bundle.commit_sha = "9".repeat(40);
  assert.throws(() => assertAlignmentIntegrity(wrongRevision), /revision/);

  const wrongAuthority = fixture();
  wrongAuthority.research[0].source.network_authority_ref.receipt_sha256 = "8".repeat(64);
  assert.throws(() => assertAlignmentIntegrity(wrongAuthority), /authority/);

  const wrongDigest = fixture();
  wrongDigest.research[0].manifest.source_sha256 = "0".repeat(64);
  assert.throws(() => assertAlignmentIntegrity(wrongDigest), /digest/);

  const reusedValidator = fixture();
  reusedValidator.invocations[1].execution_instance_id = reusedValidator.invocations[0].execution_instance_id;
  assert.throws(() => assertAlignmentIntegrity(reusedValidator), /validator|execution instance/);
});

test("unsafe artifact storage keys fail before alignment can become ready", () => {
  const records = fixture();
  records.bundle.goal_ref.storage_key = "../consumer/goal.json";
  assert.throws(() => assertAlignmentIntegrity(records), /unsafe storage key/);
});

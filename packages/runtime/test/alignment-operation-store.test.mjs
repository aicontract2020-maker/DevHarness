import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJson } from "../src/canonical-records.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import {
  alignmentOperationPaths,
  alignmentPreparedTransactionPaths,
  ensureAlignmentOperationRoot,
  loadAlignmentDeveloperAnswers,
  loadAlignmentCommitIntent,
  loadAlignmentCommittedReceipt,
  loadAlignmentInteractionPacket,
  loadAlignmentPreparedTransaction,
  loadAlignmentOperation,
  loadAlignmentOperationLease,
  loadAlignmentOperationStatus,
  loadAlignmentTerminalFence,
  writeAlignmentCommitIntent,
  writeAlignmentCommittedReceipt,
  writeAlignmentDeveloperAnswer,
  writeAlignmentInteractionPacket,
  writeAlignmentPreparedTransaction,
  writeAlignmentOperation,
  writeAlignmentOperationLease,
  writeAlignmentOperationStatus,
  writeAlignmentTerminalFence
} from "../src/alignment-operation-store.mjs";

const repositoryIdentity = "example/project";
const operationId = "alignment-operation-1";
const now = "2026-09-01T12:00:00.000Z";
const hash = "a".repeat(64);
const commit = "b".repeat(40);

function operation() {
  return {
    schema_version: 1,
    id: operationId,
    run_id: "run-1",
    repository_identity: repositoryIdentity,
    commit_sha: commit,
    input_checkpoint_sha256: hash,
    original_goal: { id: "goal-1", kind: "goal", sha256: hash, media_type: "application/json", size_bytes: 1, storage_key: "goal.json" },
    developer_answers: [],
    snapshot: { id: "snapshot-1", kind: "snapshot", sha256: hash, media_type: "application/json", size_bytes: 1, storage_key: "snapshot.json" },
    onboarding: { id: "onboarding-1", kind: "onboarding", sha256: hash, media_type: "application/json", size_bytes: 1, storage_key: "onboarding.json" },
    agent_descriptor: {
      schema_version: 1, id: "codex", version: "1.0.0", protocol_version: 1, profile_id: "codex-readonly-analysis-v1",
      model_id: "gpt-approved", executable_version: "codex-1", modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
      features: { structured_output: true, explicit_cancel: true, ephemeral_session: true, read_only_tool_policy: true, built_in_web_disable: true, trusted_usage: true },
      implementation_sha256: hash, executable_sha256: hash, profile_template_sha256: hash, control_plane_origins: ["https://api.example.com"], descriptor_sha256: hash
    },
    agent_authority_subject: { id: "subject-1", sha256: hash },
    result_contract_sha256: hash,
    limits: {
      attempt_deadline_seconds: 600, max_active_execution_seconds: 3600, max_result_bytes: 1048576,
      max_stdout_bytes: 10485760, max_stderr_bytes: 10485760, max_retained_records: 20, max_retained_bytes: 20971520,
      max_temporary_bytes: 268435456, max_processes: 64, max_rss_bytes: 2147483648, cleanup_deadline_seconds: 30,
      max_research_queries: 5, max_sources_per_query: 5, max_research_requests: 25, max_redirects_per_request: 3,
      max_research_response_bytes: 2097152, max_research_bytes: 10485760, research_request_deadline_seconds: 30,
      max_agent_attempts: 6, max_provider_requests: 120, provider_request_deadline_seconds: 120, max_total_tokens: 600000
    }
  };
}

function status() {
  return {
    schema_version: 1,
    operation_id: operationId,
    status: "running",
    active_phase: "analysis-plan",
    current_attempt_id: "attempt-1",
    active_execution_ms: 100,
    agent_attempts: 1,
    provider_requests: 1,
    total_tokens: 10,
    retained_records: 1,
    retained_bytes: 100,
    analysis_plan_ref: null,
    research_subject_ref: null,
    research_authority_epoch: 0,
    result_bundle_ref: null,
    checkpoint_sha256: null,
    terminal_error: null,
    journal_head_sha256: hash,
    accounting_head_sha256: hash
  };
}

function lease() {
  return {
    schema_version: 1,
    operation_id: operationId,
    owner_id: "owner-1",
    boot_id: "boot-1",
    pid: 1234,
    process_birth_id: "birth-1",
    acquired_at: now,
    wall_expires_at: "2026-09-01T12:01:00.000Z",
    heartbeat_sequence: 0,
    heartbeat_at: now
  };
}

function fence(kind) {
  return {
    schema_version: 1,
    id: `${kind}-fence-1`,
    operation_id: operationId,
    kind,
    created_at: now,
    expected_journal_head_sha256: hash,
    prepared_manifest_sha256: kind === "cancel" ? null : hash,
    requested_by: kind === "cancel" ? { id: "developer", kind: "human" } : { id: "runtime", kind: "runtime" }
  };
}

function preparedTransaction() {
  const checkpoint = { schema_version: 1, kind: "checkpoint", id: "checkpoint-1", operation_id: operationId, note: "prepared checkpoint" };
  const checkpointRaw = `${canonicalJson(checkpoint)}\n`;
  const checkpointEntry = {
    storage_key: "checkpoint.json",
    value: checkpoint,
    sha256: createHash("sha256").update(checkpointRaw, "utf8").digest("hex"),
    size_bytes: Buffer.byteLength(checkpointRaw)
  };
  const manifest = {
    schema_version: 1,
    id: "prepared-transaction-1",
    transaction_id: "transaction-1",
    operation_id: operationId,
    expected_current_sequence: 1,
    expected_current_sha256: hash,
    target_sequence: 2,
    target_checkpoint_sha256: hashContract({ checkpoint: checkpointEntry.sha256 }),
    files: [{ storage_key: checkpointEntry.storage_key, sha256: checkpointEntry.sha256, size_bytes: checkpointEntry.size_bytes }],
    total_size_bytes: checkpointEntry.size_bytes,
    created_at: now
  };
  const commitIntent = {
    schema_version: 1,
    id: "commit-intent-1",
    operation_id: operationId,
    transaction_id: manifest.transaction_id,
    prepared_manifest_sha256: hashContract(manifest),
    expected_current_sequence: manifest.expected_current_sequence,
    expected_current_sha256: manifest.expected_current_sha256,
    target_sequence: manifest.target_sequence,
    target_checkpoint_sha256: manifest.target_checkpoint_sha256,
    intent_at: now
  };
  const committedReceipt = {
    schema_version: 1,
    id: "committed-receipt-1",
    operation_id: operationId,
    transaction_id: manifest.transaction_id,
    commit_intent_sha256: hashContract(commitIntent),
    checkpoint_sha256: manifest.target_checkpoint_sha256,
    current_pointer_sha256: hashContract({ sequence: manifest.target_sequence }),
    committed_at: now
  };
  return { checkpointEntry, manifest, commitIntent, committedReceipt };
}

test("alignment operation storage creates bounded root paths and persists create-only operation records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-operation-"));
  const paths = alignmentOperationPaths(root, repositoryIdentity, operationId);
  assert.ok(paths.root.endsWith(path.join("operations", operationId)));

  await ensureAlignmentOperationRoot(root, repositoryIdentity, operationId);
  const created = await writeAlignmentOperation(root, repositoryIdentity, operation());
  assert.equal(created.path, paths.operation);
  assert.deepEqual(await loadAlignmentOperation(root, repositoryIdentity, operationId), operation());
  assert.equal((await readFile(paths.operation, "utf8")).trim(), canonicalJson(operation()));
  await assert.rejects(() => writeAlignmentOperation(root, repositoryIdentity, operation()), /already exists|EEXIST/);
});

test("alignment operation storage persists status, lease, and fence artifacts", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-operation-"));
  await writeAlignmentOperation(root, repositoryIdentity, operation());

  const statusResult = await writeAlignmentOperationStatus(root, repositoryIdentity, status());
  assert.equal(statusResult.path.endsWith("status.json"), true);
  assert.deepEqual(await loadAlignmentOperationStatus(root, repositoryIdentity, operationId), status());

  await writeAlignmentOperationLease(root, repositoryIdentity, lease());
  assert.deepEqual(await loadAlignmentOperationLease(root, repositoryIdentity, operationId), lease());

  const firstFence = await writeAlignmentTerminalFence(root, repositoryIdentity, fence("cancel"));
  assert.equal(firstFence.created, true);
  assert.deepEqual(await loadAlignmentTerminalFence(root, repositoryIdentity, operationId), fence("cancel"));
});

test("alignment operation storage persists interaction packets and developer answers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-operation-"));
  await writeAlignmentOperation(root, repositoryIdentity, operation());

  const packet = {
    schema_version: 1,
    id: "interaction-packet-1",
    run_id: "run-1",
    kind: "decision-queue",
    generated_at: now,
    head_sha: commit,
    title: "Need a choice",
    verdict: "action-required",
    summary: "A blocking question needs a human answer.",
    attention: { required: true, count: 1, reasons: ["goal-ambiguity"] },
    sections: [
      {
        id: "section-1",
        title: "Questions",
        items: [
          {
            id: "item-1",
            text: "Should the agent use option A?",
            confidence: "verify",
            severity: "blocking",
            source_refs: ["goal-1"]
          }
        ]
      }
    ],
    decisions: [
      {
        id: "decision-1",
        question: "Should the agent use option A?",
        why_now: "This choice changes the implementation path.",
        impact: "high",
        reversibility: "costly",
        recommended_option_id: "option-1",
        options: [
          { id: "option-1", label: "Use A", outcome: "Proceed with A", tradeoffs: ["Lower risk"] },
          { id: "option-2", label: "Use B", outcome: "Proceed with B", tradeoffs: ["More effort"] }
        ]
      }
    ],
    actions: [{ id: "answer-question", label: "Answer the blocked question", kind: "answer", recommended: true }],
    source_artifacts: [{ id: "goal-1", kind: "goal", sha256: hash, uri: "goal.json" }],
    traceability: [{ item_id: "item-1", source_refs: ["goal-1"] }],
    compression: { source_artifact_count: 1, surfaced_item_count: 2, omitted_item_count: 0 }
  };

  await writeAlignmentInteractionPacket(root, repositoryIdentity, operationId, packet);
  assert.deepEqual(await loadAlignmentInteractionPacket(root, repositoryIdentity, operationId), packet);

  const answer = {
    schema_version: 1,
    id: "developer-answer-1",
    run_id: "run-1",
    repository_identity: repositoryIdentity,
    commit_sha: commit,
    packet_sha256: hash,
    decision_id: "decision-1",
    option_id: "option-1",
    decision_ref: {
      gate: "alignment-answer",
      subject_sha256: hash,
      request_id: "approval-request-1",
      receipt_id: "approval-receipt-1",
      request_sha256: hash,
      receipt_sha256: hash,
      actor: { id: "developer", kind: "human" },
      decided_at: now
    },
    actor: { id: "developer", kind: "human" },
    answered_at: now
  };

  await writeAlignmentDeveloperAnswer(root, repositoryIdentity, operationId, answer);
  assert.deepEqual(await loadAlignmentDeveloperAnswers(root, repositoryIdentity, operationId), [answer]);
});

test("prepared operation transactions are durable, reusable, and validate checkpoint bytes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-prepared-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeAlignmentOperation(root, repositoryIdentity, operation());
  const prepared = preparedTransaction();

  const first = await writeAlignmentPreparedTransaction(root, repositoryIdentity, {
    manifest: prepared.manifest,
    checkpoint: [prepared.checkpointEntry]
  });
  assert.equal(first.created, true);
  assert.deepEqual(await loadAlignmentPreparedTransaction(root, repositoryIdentity, operationId, prepared.manifest.transaction_id), {
    manifest: prepared.manifest,
    checkpoint: [prepared.checkpointEntry],
    paths: alignmentPreparedTransactionPaths(root, repositoryIdentity, operationId, prepared.manifest.transaction_id)
  });

  const second = await writeAlignmentPreparedTransaction(root, repositoryIdentity, {
    manifest: prepared.manifest,
    checkpoint: [prepared.checkpointEntry]
  });
  assert.equal(second.created, false);
  assert.deepEqual(second.manifest, prepared.manifest);
  assert.deepEqual(second.checkpoint, [prepared.checkpointEntry]);

  await writeFile(path.join(first.paths.checkpoint, prepared.checkpointEntry.storage_key), `${JSON.stringify({ ...prepared.checkpointEntry.value, note: "tampered" })}\n`, { mode: 0o600 });
  await assert.rejects(
    loadAlignmentPreparedTransaction(root, repositoryIdentity, operationId, prepared.manifest.transaction_id),
    /does not match the manifest/i
  );
});

test("commit intent and committed receipt are create-only control records", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-commit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeAlignmentOperation(root, repositoryIdentity, operation());
  const prepared = preparedTransaction();
  await writeAlignmentPreparedTransaction(root, repositoryIdentity, {
    manifest: prepared.manifest,
    checkpoint: [prepared.checkpointEntry]
  });

  const intentResult = await writeAlignmentCommitIntent(root, repositoryIdentity, prepared.commitIntent);
  assert.equal(intentResult.path.endsWith("commit-intent.json"), true);
  assert.deepEqual(await loadAlignmentCommitIntent(root, repositoryIdentity, operationId), prepared.commitIntent);
  await assert.rejects(() => writeAlignmentCommitIntent(root, repositoryIdentity, prepared.commitIntent), /already exists|EEXIST/);

  const receiptResult = await writeAlignmentCommittedReceipt(root, repositoryIdentity, prepared.committedReceipt);
  assert.equal(receiptResult.path.endsWith("committed.json"), true);
  assert.deepEqual(await loadAlignmentCommittedReceipt(root, repositoryIdentity, operationId), prepared.committedReceipt);
  await assert.rejects(() => writeAlignmentCommittedReceipt(root, repositoryIdentity, prepared.committedReceipt), /already exists|EEXIST/);
});

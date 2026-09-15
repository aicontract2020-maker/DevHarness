import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest, canonicalRecordId } from "../src/canonical-records.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import {
  buildLiveAlignmentLease,
  buildLiveAlignmentOperation,
  buildLiveAlignmentStatus,
  cancelLiveAlignmentOperation,
  reconcileLiveAlignmentOperation,
  retryLiveAlignmentOperation,
  startLiveAlignmentOperation,
} from "../src/live-alignment.mjs";
import {
  appendAlignmentOperationJournal,
  loadAlignmentOperationJournal,
  loadAlignmentOperationLease,
  loadAlignmentTerminalFence,
  writeAlignmentOperationLease,
  writeAlignmentTerminalFence
} from "../src/alignment-operation-store.mjs";

const repositoryIdentity = "example/project";
const run = {
  id: "run-1",
  repository: { identity: repositoryIdentity, root_uri: "file:///example/project", base_ref: "main" },
  current_head_sha: "b".repeat(40)
};

const onboardingPlan = {
  schema_version: 1,
  repository_identity: repositoryIdentity,
  commit_sha: run.current_head_sha,
  workspace: { dirty: false, changed_file_count: 0 },
  mode: "read-only-plan",
  verdict: "needs-evidence",
  summary: {
    total_claims: 1,
    proved_claims: 0,
    unresolved_claims: 1,
    conflict_claims: 0,
    claim_status_counts: { detected: 1, documented: 0, "code-confirmed": 0, conflict: 0, unverified: 0, "not-covered": 0 },
    coverage_status_counts: { applicable: 1, "not-applicable": 0, conflict: 0, gap: 0 },
    domain_knownness: {
      database: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} },
      frontend: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} },
      backend: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} }
    },
    priority_domains: ["frontend=detected"]
  },
  claims: [{ id: "repository-inventory", domain: "repository", status: "code-confirmed", summary: "Repository identity was inspected.", evidence_refs: ["package.json"] }],
  coverage: [{ domain: "repository", status: "applicable", claim_ids: ["repository-inventory"] }],
  capability_requests: [{ capability: "network-research", operation: "research", target: "topic", scope: ["repo"], reason: "Check current practices.", risk: "low", authority: "human-only", reversibility: "revocable-before-next-external-action", decision: "pending" }],
  blockers: [{ id: "blocker-1", summary: "Need a product decision.", source_refs: ["package.json"] }],
  preflight: {
    clarification_questions: [{ id: "clarify-1", blocker_id: "blocker-1", question: "What product decision do we need before implementation can proceed?", priority: 1, basis: ["plan-clarify", "goal-clarify", "blocker-1"] }],
    research_topics: [],
    research_tasks: [],
    team_decomposition: []
  },
  next_action: { label: "Review and approve", recommended: true }
};

const baseArtifacts = {
  goal: { id: "goal-1", kind: "goal", sha256: "a".repeat(64), storage_key: "artifacts/goal.json", media_type: "application/json", size_bytes: 1 },
  snapshot: { id: "snapshot-1", kind: "snapshot", sha256: "a".repeat(64), storage_key: "artifacts/snapshot.json", media_type: "application/json", size_bytes: 1 },
  onboarding: { id: "onboarding-1", kind: "onboarding", sha256: "a".repeat(64), storage_key: "artifacts/onboarding.json", media_type: "application/json", size_bytes: 1 }
};

const descriptor = {
  schema_version: 1,
  id: "codex",
  version: "1.0.0",
  protocol_version: 1,
  profile_id: "codex-readonly-analysis-v1",
  model_id: "gpt-approved",
  executable_version: "codex-1",
  modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
  features: { structured_output: true, explicit_cancel: true, ephemeral_session: true, read_only_tool_policy: true, built_in_web_disable: true, trusted_usage: true },
  implementation_sha256: "a".repeat(64),
  executable_sha256: "a".repeat(64),
  profile_template_sha256: "a".repeat(64),
  control_plane_origins: ["https://api.example.com"],
  descriptor_sha256: "a".repeat(64)
};

const limits = {
  attempt_deadline_seconds: 600,
  max_active_execution_seconds: 3600,
  max_result_bytes: 1048576,
  max_stdout_bytes: 10485760,
  max_stderr_bytes: 10485760,
  max_retained_records: 20,
  max_retained_bytes: 20971520,
  max_temporary_bytes: 268435456,
  max_processes: 64,
  max_rss_bytes: 2147483648,
  cleanup_deadline_seconds: 30,
  max_research_queries: 5,
  max_sources_per_query: 5,
  max_research_requests: 25,
  max_redirects_per_request: 3,
  max_research_response_bytes: 2097152,
  max_research_bytes: 10485760,
  research_request_deadline_seconds: 30,
  max_agent_attempts: 6,
  max_provider_requests: 120,
  provider_request_deadline_seconds: 120,
  max_total_tokens: 600000
};

function buildOperation() {
  return buildLiveAlignmentOperation({
    run,
    goalArtifact: baseArtifacts.goal,
    snapshotArtifact: baseArtifacts.snapshot,
    onboardingArtifact: baseArtifacts.onboarding,
    agentDescriptor: descriptor,
    agentAuthoritySubject: { id: "subject-1", sha256: "a".repeat(64) },
    resultContractSha256: "a".repeat(64),
    limits,
    inputCheckpointSha256: hashContract({ run_id: run.id, head_sha: run.current_head_sha })
  });
}

function journalRecord(operationId, sequence, previousSha256, type, data, actor = "runtime", occurredAt = "2026-09-01T12:00:00.000Z") {
  const record = {
    schema_version: 1,
    id: "pending",
    operation_id: operationId,
    sequence,
    previous_sha256: previousSha256,
    type,
    occurred_at: occurredAt,
    data,
    actor
  };
  record.id = canonicalRecordId("operation-journal-record", record);
  return record;
}

async function seedFailedAttempt(root, operation, phase = "analysis-plan") {
  const existing = await loadAlignmentOperationJournal(root, repositoryIdentity, operation.id);
  let sequence = existing.sequence;
  let previousSha256 = existing.head_sha256;
  if (existing.sequence === 0) {
    const created = journalRecord(operation.id, 1, null, "operation-created", { operation_sha256: hashContract(operation) });
    await appendAlignmentOperationJournal(root, repositoryIdentity, created, { expectedSequence: 0, expectedPreviousSha256: null });
    sequence = 1;
    previousSha256 = canonicalDigest("operation-journal-record", created);
  }
  const started = journalRecord(operation.id, sequence + 1, previousSha256, "phase-started", {
    phase,
    attempt_id: "attempt-1",
    attempt_no: 1,
    invocation_sha256: hashContract({ operation_id: operation.id, phase, attempt_no: 1 })
  });
  const finished = journalRecord(operation.id, sequence + 2, canonicalDigest("operation-journal-record", started), "phase-finished", {
    phase,
    attempt_id: "attempt-1",
    attempt_no: 1,
    attempt_sha256: hashContract({ operation_id: operation.id, phase, attempt_no: 1, status: "failed" }),
    status: "failed"
  });
  await appendAlignmentOperationJournal(root, repositoryIdentity, started, {
    expectedSequence: sequence,
    expectedPreviousSha256: previousSha256
  });
  await appendAlignmentOperationJournal(root, repositoryIdentity, finished, {
    expectedSequence: sequence + 1,
    expectedPreviousSha256: canonicalDigest("operation-journal-record", started)
  });
}

test("failed phases retry once, then exhaust the bounded retry budget", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const operation = buildOperation();
  await startLiveAlignmentOperation({
    dataRoot: root,
    repositoryIdentity,
    operation,
    status: buildLiveAlignmentStatus(operation, { status: "failed", terminal_error: "TIMEOUT" })
  });
  await seedFailedAttempt(root, operation);

  const before = await loadAlignmentOperationJournal(root, repositoryIdentity, operation.id);
  assert.equal(before.records.length, 3);
  assert.equal(before.records[2].data.status, "failed");
  assert.equal((await retryLiveAlignmentOperation({ dataRoot: root, repositoryIdentity, operationId: operation.id })).status.status, "running");

  const after = await loadAlignmentOperationJournal(root, repositoryIdentity, operation.id);
  const retries = after.records.filter((record) => record.type === "phase-started" && record.data.phase === "analysis-plan");
  assert.equal(retries.length, 2);
  assert.equal(retries[1].data.attempt_no, 2);
  assert.equal(retries[1].data.invocation_sha256.length, 64);
  await assert.rejects(
    () => retryLiveAlignmentOperation({ dataRoot: root, repositoryIdentity, operationId: operation.id }),
    /RETRY_EXHAUSTED|failed or timed-out/i
  );
});

test("cancellation is idempotent and a commit fence wins the race", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const operation = buildOperation();
  const lease = buildLiveAlignmentLease(operation, {
    owner_id: "owner-1",
    boot_id: "boot-1",
    pid: 1234,
    process_birth_id: "birth-1"
  });
  await startLiveAlignmentOperation({
    dataRoot: root,
    repositoryIdentity,
    operation,
    status: buildLiveAlignmentStatus(operation, { status: "running", active_phase: "analysis-plan", current_attempt_id: "attempt-1" }),
    lease
  });

  const first = await cancelLiveAlignmentOperation({ dataRoot: root, repositoryIdentity, operationId: operation.id });
  assert.equal(first.fence.kind, "cancel");
  assert.equal((await loadAlignmentTerminalFence(root, repositoryIdentity, operation.id)).kind, "cancel");
  assert.deepEqual(await loadAlignmentOperationLease(root, repositoryIdentity, operation.id), lease);

  const second = await cancelLiveAlignmentOperation({ dataRoot: root, repositoryIdentity, operationId: operation.id });
  assert.equal(second.fence.kind, "cancel");
  assert.equal((await loadAlignmentOperationJournal(root, repositoryIdentity, operation.id)).records.filter((record) => record.type === "cancellation-fenced").length, 1);

  const commitRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-recovery-"));
  t.after(() => rm(commitRoot, { recursive: true, force: true }));
  const commitOperation = buildOperation();
  await startLiveAlignmentOperation({
    dataRoot: commitRoot,
    repositoryIdentity,
    operation: commitOperation,
    status: buildLiveAlignmentStatus(commitOperation, { status: "running", active_phase: "analysis-plan", current_attempt_id: "attempt-1" })
  });
  await writeAlignmentTerminalFence(commitRoot, repositoryIdentity, {
    schema_version: 1,
    id: "commit-fence-1",
    operation_id: commitOperation.id,
    kind: "commit",
    created_at: "2026-09-01T12:00:00.000Z",
    expected_journal_head_sha256: "a".repeat(64),
    prepared_manifest_sha256: "a".repeat(64),
    requested_by: { id: "runtime", kind: "runtime" }
  });
  await assert.rejects(
    () => cancelLiveAlignmentOperation({ dataRoot: commitRoot, repositoryIdentity, operationId: commitOperation.id }),
    /ALREADY_COMMITTING/
  );
});

test("restart recovery marks an expired lease as failed and leaves consumer files untouched", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-live-alignment-recovery-"));
  const consumerRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-consumer-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(consumerRoot, { recursive: true, force: true }));

  const sentinel = path.join(consumerRoot, "keep.txt");
  await writeFile(sentinel, "do-not-touch", "utf8");

  const operation = buildOperation();
  const lease = buildLiveAlignmentLease(operation, {
    owner_id: "owner-1",
    boot_id: "boot-1",
    pid: 1234,
    process_birth_id: "birth-1",
    wall_expires_at: "2026-09-01T11:59:00.000Z"
  });
  await startLiveAlignmentOperation({
    dataRoot: root,
    repositoryIdentity,
    operation,
    status: buildLiveAlignmentStatus(operation, { status: "running", active_phase: "analysis-plan", current_attempt_id: "attempt-1" }),
    lease
  });
  await seedFailedAttempt(root, operation);
  await writeAlignmentOperationLease(root, repositoryIdentity, lease);
  const beforeSentinel = await readFile(sentinel, "utf8");

  const recovered = await reconcileLiveAlignmentOperation({
    dataRoot: root,
    repositoryIdentity,
    operationId: operation.id,
    isOwnerAlive: async () => false,
    now: () => new Date("2026-09-01T12:10:00.000Z")
  });
  assert.equal(recovered.status.status, "failed");
  assert.equal(recovered.status.terminal_error, "TIMEOUT");
  assert.equal(recovered.status.active_phase, null);
  assert.equal((await loadAlignmentOperationJournal(root, repositoryIdentity, operation.id)).records.at(-1).type, "operation-failed");
  assert.equal(await readFile(sentinel, "utf8"), beforeSentinel);
});

import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { SchemaRegistry } from "../src/validator.mjs";

const directory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../schemas/v1");
const registry = new SchemaRegistry(await Promise.all((await readdir(directory)).filter((name) => name.endsWith(".schema.json")).map(async (name) => JSON.parse(await readFile(path.join(directory, name), "utf8")))));
const schema = {
  operation: "https://devharness.dev/schemas/v1/alignment-operation.schema.json",
  journal: "https://devharness.dev/schemas/v1/operation-journal-record.schema.json",
  accounting: "https://devharness.dev/schemas/v1/operation-accounting.schema.json"
};
const hash = "a".repeat(64);
const commit = "b".repeat(40);
const now = "2026-09-01T12:00:00.000Z";
const actor = { id: "runtime", kind: "runtime" };
const artifact = (id, kind) => ({ id, kind, sha256: hash, media_type: "application/json", size_bytes: 100, storage_key: `artifacts/${id}.json` });
const descriptor = {
  schema_version: 1, id: "codex", version: "1.0.0", protocol_version: 1,
  profile_id: "codex-readonly-analysis-v1", model_id: "gpt-approved", executable_version: "codex-1",
  modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
  features: { structured_output: true, explicit_cancel: true, ephemeral_session: true, read_only_tool_policy: true, built_in_web_disable: true, trusted_usage: true },
  implementation_sha256: hash, executable_sha256: hash, profile_template_sha256: hash,
  control_plane_origins: ["https://api.example.com"], descriptor_sha256: hash
};
const limits = {
  attempt_deadline_seconds: 600, max_active_execution_seconds: 3600, max_result_bytes: 1048576,
  max_stdout_bytes: 10485760, max_stderr_bytes: 10485760, max_retained_records: 20,
  max_retained_bytes: 20971520, max_temporary_bytes: 268435456, max_processes: 64,
  max_rss_bytes: 2147483648, cleanup_deadline_seconds: 30, max_research_queries: 5,
  max_sources_per_query: 5, max_research_requests: 25, max_redirects_per_request: 3,
  max_research_response_bytes: 2097152, max_research_bytes: 10485760,
  research_request_deadline_seconds: 30, max_agent_attempts: 6, max_provider_requests: 120,
  provider_request_deadline_seconds: 120, max_total_tokens: 600000
};
const operation = {
  schema_version: 1, id: "alignment-operation-1", run_id: "run-1", repository_identity: "example/project",
  commit_sha: commit, input_checkpoint_sha256: hash, original_goal: artifact("goal-1", "goal"),
  developer_answers: [artifact("answer-1", "developer-answer")], snapshot: artifact("snapshot-1", "snapshot"),
  onboarding: artifact("onboarding-1", "onboarding"), agent_descriptor: descriptor,
  agent_authority_subject: { id: "agent-runtime-subject-1", sha256: hash }, result_contract_sha256: hash, limits
};
const status = {
  schema_version: 1, operation_id: "alignment-operation-1", status: "running", active_phase: "analysis-plan",
  current_attempt_id: "attempt-1", active_execution_ms: 100, agent_attempts: 1, provider_requests: 1,
  total_tokens: 10, retained_records: 1, retained_bytes: 100,
  analysis_plan_ref: null, research_subject_ref: null, research_authority_epoch: 0,
  result_bundle_ref: null, checkpoint_sha256: null, terminal_error: null,
  journal_head_sha256: hash, accounting_head_sha256: hash
};
const journal = {
  schema_version: 1, id: "journal-1", operation_id: "alignment-operation-1", sequence: 1,
  previous_sha256: null, type: "operation-created", occurred_at: now,
  data: { operation_sha256: hash }, actor: "runtime"
};
const lease = {
  schema_version: 1, operation_id: "alignment-operation-1", owner_id: "owner-1", boot_id: "boot-1",
  pid: 123, process_birth_id: "birth-1", acquired_at: now, wall_expires_at: "2026-09-01T12:01:00.000Z",
  heartbeat_sequence: 0, heartbeat_at: now
};
const prepared = {
  schema_version: 1, id: "prepared-1", transaction_id: "transaction-1", operation_id: "alignment-operation-1",
  expected_current_sequence: 1, expected_current_sha256: hash, target_sequence: 2, target_checkpoint_sha256: hash,
  files: [{ storage_key: "events/00000002.json", sha256: hash, size_bytes: 100 }], total_size_bytes: 100, created_at: now
};

test("alignment operation and status are closed and bind typed artifacts", () => {
  assert.equal(registry.validate(schema.operation, operation).valid, true);
  assert.equal(registry.validate(`${schema.operation}#/$defs/operationStatus`, status).valid, true);
  assert.equal(registry.validate(schema.operation, { ...operation, snapshot: artifact("snapshot-1", "goal") }).valid, false);
  assert.equal(registry.validate(schema.operation, { ...operation, current_attempt: "mutable" }).valid, false);
  assert.equal(registry.validate(`${schema.operation}#/$defs/operationStatus`, { ...status, provider_requests: 121 }).valid, false);
});

test("journal variants accept only type-matched stable data", () => {
  assert.equal(registry.validate(schema.journal, journal).valid, true);
  assert.equal(registry.validate(schema.journal, { ...journal, data: { phase: "analysis-plan", attempt_id: "attempt-1", attempt_no: 1, invocation_sha256: hash } }).valid, false);
  assert.equal(registry.validate(schema.journal, { ...journal, data: { operation_sha256: hash, summary: "model prose" } }).valid, false);
  const phase = { ...journal, id: "journal-2", sequence: 2, previous_sha256: hash, type: "phase-started", data: { phase: "analysis-plan", attempt_id: "attempt-1", attempt_no: 1, invocation_sha256: hash } };
  assert.equal(registry.validate(schema.journal, phase).valid, true);
});

test("lease and transaction controls enforce closed bounded shapes", () => {
  assert.equal(registry.validate(`${schema.operation}#/$defs/operationLease`, lease).valid, true);
  assert.equal(registry.validate(`${schema.operation}#/$defs/preparedManifest`, prepared).valid, true);
  assert.equal(registry.validate(`${schema.operation}#/$defs/operationLease`, { ...lease, pid: 0 }).valid, false);
  assert.equal(registry.validate(`${schema.operation}#/$defs/preparedManifest`, { ...prepared, files: [{ ...prepared.files[0], storage_key: "../escape" }] }).valid, false);
});

test("commit and cancellation fences have distinct safe terminal shapes", () => {
  const cancel = { schema_version: 1, id: "fence-1", operation_id: "alignment-operation-1", kind: "cancel", created_at: now, expected_journal_head_sha256: hash, prepared_manifest_sha256: null, requested_by: { id: "developer", kind: "human" } };
  const commitFence = { ...cancel, id: "fence-2", kind: "commit", prepared_manifest_sha256: hash, requested_by: actor };
  assert.equal(registry.validate(`${schema.operation}#/$defs/terminalFence`, cancel).valid, true);
  assert.equal(registry.validate(`${schema.operation}#/$defs/terminalFence`, commitFence).valid, true);
  assert.equal(registry.validate(`${schema.operation}#/$defs/terminalFence`, { ...cancel, prepared_manifest_sha256: hash }).valid, false);
  assert.equal(registry.validate(`${schema.operation}#/$defs/terminalFence`, { ...commitFence, requested_by: { id: "developer", kind: "human" } }).valid, false);
});

test("accounting schema exposes only bounded operation projections and reservations", () => {
  assert.equal(registry.validate(schema.accounting, status).valid, true);
  const reservation = { schema_version: 1, id: "attempt-reservation-1", operation_id: "alignment-operation-1", attempt_id: "attempt-1", attempt_no: 1, phase: "analysis-plan", invocation_sha256: hash, reserved_active_ms: 600000, reserved_at: now };
  assert.equal(registry.validate(`${schema.accounting}#/$defs/agentAttemptReservation`, reservation).valid, true);
  assert.equal(registry.validate(`${schema.accounting}#/$defs/agentAttemptReservation`, { ...reservation, reserved_active_ms: 0 }).valid, false);
});

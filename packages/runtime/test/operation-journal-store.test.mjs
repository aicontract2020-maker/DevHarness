import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalDigest, canonicalRecordId } from "../src/canonical-records.mjs";
import { appendOperationJournal, loadOperationJournal, replayOperationJournal } from "../src/operation-journal-store.mjs";

const hash = "a".repeat(64);
const now = "2026-09-01T12:00:00.000Z";
const operationId = "alignment-operation-1";

function record(sequence, previous, type, data) {
  const value = { schema_version: 1, id: "pending", operation_id: operationId, sequence, previous_sha256: previous, type, occurred_at: now, data, actor: "runtime" };
  value.id = canonicalRecordId("operation-journal-record", value);
  return value;
}

const created = () => record(1, null, "operation-created", { operation_sha256: hash });

test("journal append publishes immutable sequential records and replay rebuilds state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-journal-"));
  const first = created();
  const firstResult = await appendOperationJournal(root, first, { expectedSequence: 0, expectedPreviousSha256: null });
  const firstSha = canonicalDigest("operation-journal-record", first);
  assert.equal(firstResult.head_sha256, firstSha);
  const second = record(2, firstSha, "phase-started", { phase: "analysis-plan", attempt_id: "attempt-1", attempt_no: 1, invocation_sha256: hash });
  await appendOperationJournal(root, second, { expectedSequence: 1, expectedPreviousSha256: firstSha });

  const loaded = await loadOperationJournal(root, { operationId });
  assert.deepEqual(loaded.records, [first, second]);
  assert.equal(loaded.head_sha256, canonicalDigest("operation-journal-record", second));
  assert.deepEqual(replayOperationJournal(loaded.records), { status: "running", active_phase: "analysis-plan", current_attempt_id: "attempt-1", sequence: 2, journal_head_sha256: loaded.head_sha256 });
});

test("journal validates type-specific variants before publication", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-journal-"));
  const invalid = record(1, null, "operation-created", { phase: "analysis-plan", attempt_id: "attempt-1", attempt_no: 1, invocation_sha256: hash });
  await assert.rejects(() => appendOperationJournal(root, invalid, { expectedSequence: 0, expectedPreviousSha256: null }), /contract violation/);
  assert.equal((await loadOperationJournal(root, { operationId })).records.length, 0);
});

test("stale compare-and-swap expectations cannot append or replace a journal head", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-journal-"));
  const first = created();
  await appendOperationJournal(root, first, { expectedSequence: 0, expectedPreviousSha256: null });
  const firstSha = canonicalDigest("operation-journal-record", first);
  const second = record(2, firstSha, "phase-started", { phase: "analysis-plan", attempt_id: "attempt-1", attempt_no: 1, invocation_sha256: hash });
  await assert.rejects(() => appendOperationJournal(root, second, { expectedSequence: 0, expectedPreviousSha256: null }), /compare-and-swap/);
  assert.equal((await loadOperationJournal(root, { operationId })).records.length, 1);
});

test("O_EXCL publication permits only one concurrent writer for a sequence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-journal-"));
  const outcomes = await Promise.allSettled([
    appendOperationJournal(root, created(), { expectedSequence: 0, expectedPreviousSha256: null }),
    appendOperationJournal(root, created(), { expectedSequence: 0, expectedPreviousSha256: null })
  ]);
  assert.equal(outcomes.filter(({ status }) => status === "fulfilled").length, 1);
  assert.equal(outcomes.filter(({ status }) => status === "rejected").length, 1);
  assert.equal((await loadOperationJournal(root, { operationId })).records.length, 1);
});

test("truncation, digest corruption, symlinks, and unlisted journal entries fail closed", async () => {
  const truncated = await mkdtemp(path.join(os.tmpdir(), "devharness-journal-"));
  await mkdir(path.join(truncated, "journal"));
  await writeFile(path.join(truncated, "journal", "00000001.json"), "{");
  await assert.rejects(() => loadOperationJournal(truncated, { operationId }), /corrupt|JSON/);

  const changed = await mkdtemp(path.join(os.tmpdir(), "devharness-journal-"));
  await mkdir(path.join(changed, "journal"));
  await writeFile(path.join(changed, "journal", "00000001.json"), JSON.stringify({ ...created(), occurred_at: "2026-09-01T12:01:00.000Z" }));
  await assert.rejects(() => loadOperationJournal(changed, { operationId }), /digest/);

  const unsafe = await mkdtemp(path.join(os.tmpdir(), "devharness-journal-"));
  await mkdir(path.join(unsafe, "journal"));
  await writeFile(path.join(unsafe, "journal", "notes.txt"), "unlisted");
  await assert.rejects(() => loadOperationJournal(unsafe, { operationId }), /unlisted/);

  const linked = await mkdtemp(path.join(os.tmpdir(), "devharness-journal-"));
  await mkdir(path.join(linked, "journal"));
  await symlink("/dev/null", path.join(linked, "journal", "00000001.json"));
  await assert.rejects(() => loadOperationJournal(linked, { operationId }), /unsafe|symlink/);
});

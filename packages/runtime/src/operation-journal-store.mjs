import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";

import { assertContract } from "../../project/src/contracts.mjs";
import { canonicalDigest, canonicalJson, canonicalRecordId } from "./canonical-records.mjs";

const JOURNAL_FILE = /^([0-9]{8})\.json$/;
const MAX_RECORD_BYTES = 1024 * 1024;

async function directoryIsSafe(target, { create = false } = {}) {
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Journal directory is unsafe: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT" || !create) throw error;
    try {
      await mkdir(target, { mode: 0o700 });
    } catch (mkdirError) {
      if (mkdirError.code !== "EEXIST") throw mkdirError;
    }
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Journal directory is unsafe: ${target}`);
  }
}

async function journalDirectory(root, { create = false } = {}) {
  const resolvedRoot = path.resolve(root);
  await directoryIsSafe(resolvedRoot, { create });
  const target = path.join(resolvedRoot, "journal");
  await directoryIsSafe(target, { create });
  return target;
}

function fileName(sequence) {
  return `${String(sequence).padStart(8, "0")}.json`;
}

async function validateRecord(record, { operationId, sequence, previousSha256 }) {
  await assertContract("operation-journal-record", record);
  if (record.operation_id !== operationId) throw new Error("Journal record operation mismatch.");
  if (record.sequence !== sequence) throw new Error("Journal record sequence mismatch.");
  if (record.previous_sha256 !== previousSha256) throw new Error("Journal record previous digest mismatch.");
  if (record.id !== canonicalRecordId("operation-journal-record", record)) throw new Error("Journal record id/digest mismatch.");
}

export async function loadOperationJournal(root, { operationId } = {}) {
  let directory;
  try {
    directory = await journalDirectory(root);
  } catch (error) {
    if (error.code === "ENOENT") return { records: [], sequence: 0, head_sha256: null };
    throw error;
  }
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink()) throw new Error(`Journal contains an unsafe symlink or entry: ${entry.name}`);
    if (!JOURNAL_FILE.test(entry.name)) throw new Error(`Journal contains an unlisted entry: ${entry.name}`);
  }
  entries.sort((left, right) => left.name.localeCompare(right.name));
  const records = [];
  let previousSha256 = null;
  for (let index = 0; index < entries.length; index += 1) {
    const sequence = index + 1;
    if (entries[index].name !== fileName(sequence)) throw new Error("Journal sequence is non-contiguous.");
    const target = path.join(directory, entries[index].name);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_RECORD_BYTES) throw new Error("Journal record file is unsafe or oversized.");
    let record;
    try {
      record = JSON.parse(await readFile(target, "utf8"));
    } catch {
      throw new Error(`Journal record ${sequence} contains corrupt JSON.`);
    }
    await validateRecord(record, { operationId, sequence, previousSha256 });
    const canonical = canonicalJson(record);
    if (Buffer.byteLength(canonical) !== info.size || await readFile(target, "utf8") !== canonical) throw new Error(`Journal record ${sequence} is not stored as canonical bytes.`);
    records.push(record);
    previousSha256 = canonicalDigest("operation-journal-record", record);
  }
  return { records, sequence: records.length, head_sha256: previousSha256 };
}

export async function appendOperationJournal(root, record, { expectedSequence, expectedPreviousSha256 } = {}) {
  await assertContract("operation-journal-record", record);
  if (record.id !== canonicalRecordId("operation-journal-record", record)) throw new Error("Journal record id/digest mismatch.");
  const current = await loadOperationJournal(root, { operationId: record.operation_id });
  if (current.sequence !== expectedSequence || current.head_sha256 !== expectedPreviousSha256) throw new Error("Journal compare-and-swap expectation is stale.");
  const nextSequence = current.sequence + 1;
  if (record.sequence !== nextSequence || record.previous_sha256 !== current.head_sha256) throw new Error("Journal record does not extend the current head.");
  const directory = await journalDirectory(root, { create: true });
  const target = path.join(directory, fileName(nextSequence));
  const temporary = path.join(directory, `.tmp-${randomUUID()}`);
  const bytes = Buffer.from(canonicalJson(record), "utf8");
  if (bytes.length > MAX_RECORD_BYTES) throw new Error("Journal record exceeds the size limit.");
  let handle;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = undefined;
    try {
      await link(temporary, target);
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`Journal sequence ${nextSequence} is already published.`);
      throw error;
    }
    const directoryHandle = await open(directory, "r");
    try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  } finally {
    await handle?.close();
    try { await unlink(temporary); } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  const headSha256 = canonicalDigest("operation-journal-record", record);
  return { sequence: nextSequence, head_sha256: headSha256, record };
}

export function replayOperationJournal(records) {
  let projection = { status: "planned", active_phase: null, current_attempt_id: null, sequence: 0, journal_head_sha256: null };
  for (const record of records) {
    switch (record.type) {
      case "operation-created": projection.status = "planned"; break;
      case "phase-started": projection = { ...projection, status: "running", active_phase: record.data.phase, current_attempt_id: record.data.attempt_id }; break;
      case "phase-finished": projection = { ...projection, status: record.data.status === "succeeded" ? "planned" : record.data.status, active_phase: null, current_attempt_id: null }; break;
      case "agent-authority-paused": projection.status = "waiting-agent-authority"; break;
      case "research-subject-created": projection.status = "waiting-research-authority"; break;
      case "research-authority-attached": projection.status = "running"; break;
      case "cancellation-fenced": projection = { ...projection, status: "cancelled", active_phase: null, current_attempt_id: null }; break;
      case "result-committed": projection = { ...projection, status: "ready", active_phase: null, current_attempt_id: null }; break;
      case "operation-failed": projection = { ...projection, status: "failed", active_phase: null, current_attempt_id: null }; break;
    }
    projection.sequence = record.sequence;
    projection.journal_head_sha256 = canonicalDigest("operation-journal-record", record);
  }
  return projection;
}

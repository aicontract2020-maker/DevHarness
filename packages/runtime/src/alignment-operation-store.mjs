import { createHash, randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, rename, rm, unlink } from "node:fs/promises";
import path from "node:path";

import { assertContract, loadContractRegistry } from "../../project/src/contracts.mjs";
import { canonicalJson } from "./canonical-records.mjs";
import { createTerminalFence, loadOperationLease, loadTerminalFence, operationLeasePaths, writeOperationLease } from "./operation-lease.mjs";
import { appendOperationJournal, loadOperationJournal, replayOperationJournal } from "./operation-journal-store.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { projectDataDirectory } from "./data-store.mjs";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

function requireIdentifier(value, label) {
  if (!IDENTIFIER.test(value ?? "")) throw new Error(`Invalid ${label}.`);
}

function safeRoot(target) {
  return path.resolve(target);
}

async function ensureDirectory(target, { create = false } = {}) {
  try {
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe runtime directory: ${target}`);
  } catch (error) {
    if (error.code !== "ENOENT" || !create) throw error;
    await mkdir(target, { recursive: true, mode: 0o700 });
    const info = await lstat(target);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe runtime directory: ${target}`);
  }
}

async function openSafeRead(target) {
  let handle;
  try {
    handle = await open(target, "r");
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Runtime artifact is not a regular file.");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle?.close();
  }
}

async function openSafeReadText(target) {
  let handle;
  try {
    handle = await open(target, "r");
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Runtime artifact is not a regular file.");
    return await handle.readFile("utf8");
  } finally {
    await handle?.close();
  }
}

function recordPayload(value) {
  const raw = `${canonicalJson(value)}\n`;
  return {
    raw,
    sha256: createHash("sha256").update(raw, "utf8").digest("hex"),
    size_bytes: Buffer.byteLength(raw)
  };
}

function fileSummary(storageKey, value) {
  const payload = recordPayload(value);
  return { storage_key: storageKey, sha256: payload.sha256, size_bytes: payload.size_bytes, value };
}

function sortedFileSummaries(entries) {
  return [...entries].sort((left, right) => left.storage_key.localeCompare(right.storage_key));
}

function sameFileSummaries(left, right) {
  const normalizedLeft = sortedFileSummaries(left).map(({ storage_key: storageKey, sha256, size_bytes: sizeBytes }) => ({ storage_key: storageKey, sha256, size_bytes: sizeBytes }));
  const normalizedRight = sortedFileSummaries(right).map(({ storage_key: storageKey, sha256, size_bytes: sizeBytes }) => ({ storage_key: storageKey, sha256, size_bytes: sizeBytes }));
  return canonicalJson(normalizedLeft) === canonicalJson(normalizedRight);
}

async function syncDirectory(target) {
  const directory = await open(target, "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function assertAnalysisPlanContract(value) {
  const registry = await loadContractRegistry();
  const result = registry.validate("https://devharness.dev/schemas/v1/agent-runtime.schema.json#/$defs/analysisPlan", value);
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new Error(`analysisPlan contract violation: ${details}`);
  }
  return value;
}

async function assertPreparedManifestContract(value) {
  const registry = await loadContractRegistry();
  const result = registry.validate("https://devharness.dev/schemas/v1/alignment-operation.schema.json#/$defs/preparedManifest", value);
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new Error(`prepared-manifest contract violation: ${details}`);
  }
  return value;
}

async function assertCommitIntentContract(value) {
  const registry = await loadContractRegistry();
  const result = registry.validate("https://devharness.dev/schemas/v1/alignment-operation.schema.json#/$defs/commitIntent", value);
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new Error(`commit-intent contract violation: ${details}`);
  }
  return value;
}

async function assertCommittedReceiptContract(value) {
  const registry = await loadContractRegistry();
  const result = registry.validate("https://devharness.dev/schemas/v1/alignment-operation.schema.json#/$defs/committedReceipt", value);
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new Error(`committed-receipt contract violation: ${details}`);
  }
  return value;
}

async function writeAtomicCreateOnly(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await link(temporary, target);
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Runtime artifact already exists: ${target}`);
    throw error;
  } finally {
    try {
      await unlink(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  const directory = await open(path.dirname(target), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

async function writeAtomicReplace(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
  const directory = await open(path.dirname(target), "r");
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
}

function operationSchemaRef() {
  return "https://devharness.dev/schemas/v1/alignment-operation.schema.json";
}

function statusSchemaRef() {
  return "https://devharness.dev/schemas/v1/operation-accounting.schema.json";
}

export function alignmentOperationPaths(dataRoot, repositoryIdentity, operationId) {
  requireIdentifier(operationId, "operation id");
  const root = path.join(alignmentOperationsRoot(dataRoot, repositoryIdentity), operationId);
  return {
    root,
    operation: path.join(root, "operation.json"),
    analysisPlan: path.join(root, "analysis-plan.json"),
    status: path.join(root, "status.json"),
    artifacts: path.join(root, "artifacts"),
    interactionPacket: path.join(root, "artifacts", "interaction-packet.json"),
    developerAnswers: path.join(root, "artifacts", "developer-answers"),
    journal: path.join(root, "journal"),
    attempts: path.join(root, "attempts"),
    outbound: path.join(root, "outbound"),
    staging: path.join(root, "staging"),
    prepared: path.join(root, "prepared"),
    commitIntent: path.join(root, "commit-intent.json"),
    committed: path.join(root, "committed.json"),
    ...operationLeasePaths(dataRoot, repositoryIdentity, operationId)
  };
}

export async function appendAlignmentOperationJournal(dataRoot, repositoryIdentity, record, options = {}) {
  const { root } = alignmentOperationPaths(dataRoot, repositoryIdentity, record.operation_id);
  return appendOperationJournal(root, record, options);
}

export async function loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operationId) {
  const { root } = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  return loadOperationJournal(root, { operationId });
}

export function replayAlignmentOperationJournal(records) {
  return replayOperationJournal(records);
}

export function alignmentPreparedTransactionPaths(dataRoot, repositoryIdentity, operationId, transactionId) {
  requireIdentifier(transactionId, "transaction id");
  const root = path.join(alignmentOperationsRoot(dataRoot, repositoryIdentity), operationId, "prepared", transactionId);
  return {
    root,
    manifest: path.join(root, "manifest.json"),
    checkpoint: path.join(root, "checkpoint")
  };
}

export function alignmentOperationsRoot(dataRoot, repositoryIdentity) {
  return path.join(projectDataDirectory(dataRoot, repositoryIdentity), "operations");
}

export async function ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, operationId) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  await ensureDirectory(safeRoot(paths.root), { create: true });
  await ensureDirectory(path.dirname(paths.root), { create: true });
  for (const directory of [paths.artifacts, paths.developerAnswers, paths.journal, paths.attempts, paths.outbound, paths.staging, paths.prepared]) {
    await ensureDirectory(directory, { create: true });
  }
  return paths;
}

async function readPreparedFile(target) {
  const value = await openSafeRead(target);
  const payload = recordPayload(value);
  return { value, ...payload };
}

async function readPreparedTransaction(dataRoot, repositoryIdentity, operationId, transactionId) {
  const paths = alignmentPreparedTransactionPaths(dataRoot, repositoryIdentity, operationId, transactionId);
  let manifest;
  try {
    manifest = await openSafeRead(paths.manifest);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  await assertPreparedManifestContract(manifest);
  if (manifest.operation_id !== operationId) throw new Error("Prepared manifest does not belong to the requested operation id.");
  if (manifest.transaction_id !== transactionId) throw new Error("Prepared manifest does not belong to the requested transaction id.");
  const checkpointEntries = [];
  for (const entry of sortedFileSummaries(manifest.files ?? [])) {
    const valuePath = path.join(paths.checkpoint, entry.storage_key);
    const loaded = await readPreparedFile(valuePath);
    if (loaded.sha256 !== entry.sha256 || loaded.size_bytes !== entry.size_bytes) {
      throw new Error(`Prepared checkpoint file ${entry.storage_key} does not match the manifest.`);
    }
    checkpointEntries.push({ storage_key: entry.storage_key, value: loaded.value, sha256: loaded.sha256, size_bytes: loaded.size_bytes });
  }
  return { manifest, checkpoint: checkpointEntries, paths };
}

function preparedTransactionMatches(left, right) {
  if (!left || !right) return false;
  return hashContract(left.manifest) === hashContract(right.manifest) && sameFileSummaries(left.checkpoint, right.checkpoint);
}

export async function writeAlignmentPreparedTransaction(dataRoot, repositoryIdentity, transaction) {
  const { manifest, checkpoint } = transaction;
  await assertPreparedManifestContract(manifest);
  const paths = alignmentPreparedTransactionPaths(dataRoot, repositoryIdentity, manifest.operation_id, manifest.transaction_id);
  const normalizedCheckpoint = sortedFileSummaries((checkpoint ?? []).map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new TypeError("Prepared checkpoint entries must be objects.");
    if (typeof entry.storage_key !== "string" || entry.storage_key.length === 0) throw new Error("Prepared checkpoint entries require a storage key.");
    return fileSummary(entry.storage_key, entry.value);
  }));
  if (sameFileSummaries(manifest.files ?? [], normalizedCheckpoint) === false) {
    throw new Error("Prepared manifest file summaries do not match the checkpoint bytes.");
  }
  if (manifest.total_size_bytes !== normalizedCheckpoint.reduce((sum, entry) => sum + entry.size_bytes, 0)) {
    throw new Error("Prepared manifest total size does not match the checkpoint bytes.");
  }

  await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, manifest.operation_id);
  const existing = await readPreparedTransaction(dataRoot, repositoryIdentity, manifest.operation_id, manifest.transaction_id);
  if (existing) {
    if (!preparedTransactionMatches(existing, { manifest, checkpoint: normalizedCheckpoint })) {
      throw new Error(`Prepared transaction already exists at ${paths.root} with different contents.`);
    }
    return { created: false, paths, manifest: existing.manifest, checkpoint: existing.checkpoint };
  }

  const stagingRoot = path.join(path.dirname(paths.root), `.creating-${transaction.manifest.transaction_id}-${process.pid}-${randomUUID()}`);
  const staging = {
    root: stagingRoot,
    manifest: path.join(stagingRoot, "manifest.json"),
    checkpoint: path.join(stagingRoot, "checkpoint")
  };
  try {
    await mkdir(staging.checkpoint, { recursive: true, mode: 0o700 });
    await writeAtomicCreateOnly(staging.manifest, manifest);
    for (const entry of normalizedCheckpoint) {
      await writeAtomicCreateOnly(path.join(staging.checkpoint, entry.storage_key), entry.value);
    }
    await rename(staging.root, paths.root);
    await syncDirectory(path.dirname(paths.root));
  } catch (error) {
    await rm(staging.root, { recursive: true, force: true });
    if (["EEXIST", "ENOTEMPTY"].includes(error.code)) {
      const concurrent = await readPreparedTransaction(dataRoot, repositoryIdentity, manifest.operation_id, manifest.transaction_id);
      if (concurrent && preparedTransactionMatches(concurrent, { manifest, checkpoint: normalizedCheckpoint })) {
        return { created: false, paths, manifest: concurrent.manifest, checkpoint: concurrent.checkpoint };
      }
      throw new Error(`Prepared transaction already exists at ${paths.root} with different contents.`);
    }
    throw error;
  }
  return { created: true, paths, manifest, checkpoint: normalizedCheckpoint };
}

export async function loadAlignmentPreparedTransaction(dataRoot, repositoryIdentity, operationId, transactionId) {
  return readPreparedTransaction(dataRoot, repositoryIdentity, operationId, transactionId);
}

export async function writeAlignmentCommitIntent(dataRoot, repositoryIdentity, intent) {
  await assertCommitIntentContract(intent);
  const prepared = await loadAlignmentPreparedTransaction(dataRoot, repositoryIdentity, intent.operation_id, intent.transaction_id);
  if (!prepared) throw new Error("Commit intent requires a prepared transaction.");
  if (hashContract(prepared.manifest) !== intent.prepared_manifest_sha256) {
    throw new Error("Commit intent does not match the prepared manifest.");
  }
  const paths = await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, intent.operation_id);
  await writeAtomicCreateOnly(paths.commitIntent, intent);
  return { path: paths.commitIntent, intent, paths };
}

export async function loadAlignmentCommitIntent(dataRoot, repositoryIdentity, operationId) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  try {
    const intent = await openSafeRead(paths.commitIntent);
    await assertCommitIntentContract(intent);
    if (intent.operation_id !== operationId) throw new Error("Commit intent does not belong to the requested operation id.");
    return intent;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAlignmentCommittedReceipt(dataRoot, repositoryIdentity, receipt) {
  await assertCommittedReceiptContract(receipt);
  const intent = await loadAlignmentCommitIntent(dataRoot, repositoryIdentity, receipt.operation_id);
  if (!intent || intent.transaction_id !== receipt.transaction_id) {
    throw new Error("Committed receipt requires the matching commit intent.");
  }
  if (hashContract(intent) !== receipt.commit_intent_sha256) {
    throw new Error("Committed receipt does not match the commit intent.");
  }
  const paths = await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, receipt.operation_id);
  await writeAtomicCreateOnly(paths.committed, receipt);
  return { path: paths.committed, receipt, paths };
}

export async function loadAlignmentCommittedReceipt(dataRoot, repositoryIdentity, operationId) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  try {
    const receipt = await openSafeRead(paths.committed);
    await assertCommittedReceiptContract(receipt);
    if (receipt.operation_id !== operationId) throw new Error("Committed receipt does not belong to the requested operation id.");
    return receipt;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAlignmentOperation(dataRoot, repositoryIdentity, operation) {
  await assertContract("alignment-operation", operation);
  const paths = await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, operation.id);
  await writeAtomicCreateOnly(paths.operation, operation);
  return { path: paths.operation, operation, paths };
}

export async function loadAlignmentOperation(dataRoot, repositoryIdentity, operationId) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  try {
    const operation = await openSafeRead(paths.operation);
    await assertContract("alignment-operation", operation);
    if (operation.id !== operationId) throw new Error("Alignment operation does not belong to the requested operation id.");
    return operation;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAlignmentAnalysisPlan(dataRoot, repositoryIdentity, analysisPlan) {
  await assertAnalysisPlanContract(analysisPlan);
  const paths = await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, analysisPlan.operation_id);
  await writeAtomicCreateOnly(paths.analysisPlan, analysisPlan);
  return { path: paths.analysisPlan, analysisPlan, paths };
}

export async function loadAlignmentAnalysisPlan(dataRoot, repositoryIdentity, operationId) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  try {
    const analysisPlan = await openSafeRead(paths.analysisPlan);
    await assertAnalysisPlanContract(analysisPlan);
    if (analysisPlan.operation_id !== operationId) throw new Error("Analysis plan does not belong to the requested operation id.");
    return analysisPlan;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function assertInteractionPacketContract(value) {
  await assertContract("interaction-packet", value);
  return value;
}

async function assertDeveloperAnswerContract(value) {
  await assertContract("developer-answer", value);
  return value;
}

export async function writeAlignmentInteractionPacket(dataRoot, repositoryIdentity, operationId, packet) {
  await assertInteractionPacketContract(packet);
  const operation = await loadAlignmentOperation(dataRoot, repositoryIdentity, operationId);
  if (operation && packet.run_id !== operation.run_id) throw new Error("Interaction packet does not belong to the requested operation id.");
  const paths = await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, operationId);
  await writeAtomicCreateOnly(paths.interactionPacket, packet);
  return { path: paths.interactionPacket, packet, paths };
}

export async function loadAlignmentInteractionPacket(dataRoot, repositoryIdentity, operationId) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  try {
    const packet = await openSafeRead(paths.interactionPacket);
    await assertInteractionPacketContract(packet);
    const operation = await loadAlignmentOperation(dataRoot, repositoryIdentity, operationId);
    if (operation && packet.run_id !== operation.run_id) throw new Error("Interaction packet does not belong to the requested operation id.");
    return packet;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAlignmentDeveloperAnswer(dataRoot, repositoryIdentity, operationId, answer) {
  await assertDeveloperAnswerContract(answer);
  const operation = await loadAlignmentOperation(dataRoot, repositoryIdentity, operationId);
  if (operation && answer.run_id !== operation.run_id) throw new Error("Developer answer does not belong to the requested operation id.");
  const paths = await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, operationId);
  await writeAtomicCreateOnly(path.join(paths.developerAnswers, `${answer.id}.json`), answer);
  return { path: path.join(paths.developerAnswers, `${answer.id}.json`), answer, paths };
}

export async function loadAlignmentDeveloperAnswers(dataRoot, repositoryIdentity, operationId) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  try {
    const entries = await readdir(paths.developerAnswers, { withFileTypes: true });
    const operation = await loadAlignmentOperation(dataRoot, repositoryIdentity, operationId);
    const answers = [];
    for (const entry of entries.filter((candidate) => candidate.isFile() && candidate.name.endsWith(".json")).sort((left, right) => left.name.localeCompare(right.name))) {
      const answer = await openSafeRead(path.join(paths.developerAnswers, entry.name));
      await assertDeveloperAnswerContract(answer);
      if (operation && answer.run_id !== operation.run_id) throw new Error("Developer answer does not belong to the requested operation id.");
      answers.push(answer);
    }
    return answers;
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

export async function writeAlignmentOperationStatus(dataRoot, repositoryIdentity, status) {
  await assertContract("operation-accounting", status);
  const paths = await ensureAlignmentOperationRoot(dataRoot, repositoryIdentity, status.operation_id);
  await writeAtomicReplace(paths.status, status);
  return { path: paths.status, status, paths };
}

export async function loadAlignmentOperationStatus(dataRoot, repositoryIdentity, operationId) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  try {
    const status = await openSafeRead(paths.status);
    await assertContract("operation-accounting", status);
    if (status.operation_id !== operationId) throw new Error("Operation status does not belong to the requested operation id.");
    return status;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeAlignmentOperationLease(dataRoot, repositoryIdentity, lease) {
  return writeOperationLease(dataRoot, repositoryIdentity, lease);
}

export async function loadAlignmentOperationLease(dataRoot, repositoryIdentity, operationId) {
  return loadOperationLease(dataRoot, repositoryIdentity, operationId);
}

export async function writeAlignmentTerminalFence(dataRoot, repositoryIdentity, fence) {
  return createTerminalFence(dataRoot, repositoryIdentity, fence);
}

export async function loadAlignmentTerminalFence(dataRoot, repositoryIdentity, operationId) {
  return loadTerminalFence(dataRoot, repositoryIdentity, operationId);
}

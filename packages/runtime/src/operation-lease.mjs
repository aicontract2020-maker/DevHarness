import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./canonical-records.mjs";
import { loadContractRegistry } from "../../project/src/contracts.mjs";
import { projectDataDirectory } from "./data-store.mjs";

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

function requireIdentifier(value, label) {
  if (!IDENTIFIER.test(value ?? "")) throw new Error(`Invalid ${label}.`);
}

function operationRoot(dataRoot, repositoryIdentity, operationId) {
  requireIdentifier(operationId, "operation id");
  return path.join(projectDataDirectory(dataRoot, repositoryIdentity), "operations", operationId);
}

function paths(dataRoot, repositoryIdentity, operationId) {
  const root = operationRoot(dataRoot, repositoryIdentity, operationId);
  return {
    root,
    lease: path.join(root, "lease.json"),
    terminalFence: path.join(root, "terminal-fence.json")
  };
}

async function safeDirectory(target, { create = false } = {}) {
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

async function ensureOperationDirectories(root) {
  await safeDirectory(root, { create: true });
  await safeDirectory(path.dirname(root), { create: true });
}

async function contractRegistryValidate(schemaRef, value) {
  const registry = await loadContractRegistry();
  const result = registry.validate(schemaRef, value);
  if (!result.valid) {
    const details = result.errors.map((error) => `${error.path} ${error.message}`).join("; ");
    throw new Error(`alignment-operation contract violation: ${details}`);
  }
  return value;
}

async function readPrivateJson(target) {
  let handle;
  try {
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const info = await handle.stat();
    if (!info.isFile()) throw new Error("Runtime lease file is not a regular file.");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle?.close();
  }
}

async function replaceAtomicJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const content = `${canonicalJson(value)}\n`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(content, "utf8");
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

function leaseSchemaRef() {
  return "https://devharness.dev/schemas/v1/alignment-operation.schema.json#/$defs/operationLease";
}

function fenceSchemaRef() {
  return "https://devharness.dev/schemas/v1/alignment-operation.schema.json#/$defs/terminalFence";
}

export function operationLeasePaths(dataRoot, repositoryIdentity, operationId) {
  return paths(dataRoot, repositoryIdentity, operationId);
}

export async function loadOperationLease(dataRoot, repositoryIdentity, operationId) {
  const { lease } = paths(dataRoot, repositoryIdentity, operationId);
  try {
    const value = await readPrivateJson(lease);
    await contractRegistryValidate(leaseSchemaRef(), value);
    if (value.operation_id !== operationId) throw new Error("Operation lease does not belong to the requested operation.");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

export async function writeOperationLease(dataRoot, repositoryIdentity, lease) {
  await contractRegistryValidate(leaseSchemaRef(), lease);
  const { root, lease: leasePath } = paths(dataRoot, repositoryIdentity, lease.operation_id);
  await ensureOperationDirectories(root);
  await replaceAtomicJson(leasePath, lease);
  return { path: leasePath, lease };
}

export async function heartbeatOperationLease(dataRoot, repositoryIdentity, lease, { now = () => new Date(), wallExpiresInSeconds = null } = {}) {
  const current = await loadOperationLease(dataRoot, repositoryIdentity, lease.operation_id);
  if (!current) throw new Error("Operation lease does not exist.");
  if (current.owner_id !== lease.owner_id || current.boot_id !== lease.boot_id || current.pid !== lease.pid || current.process_birth_id !== lease.process_birth_id) {
    throw new Error("Operation lease heartbeat is stale or belongs to another owner.");
  }
  if (current.heartbeat_sequence !== lease.heartbeat_sequence) {
    throw new Error("Operation lease heartbeat sequence is stale.");
  }
  const acquiredAt = new Date(current.acquired_at);
  const heartbeatAt = now();
  const expiresAt = wallExpiresInSeconds == null
    ? new Date(new Date(current.wall_expires_at).getTime())
    : new Date(heartbeatAt.getTime() + wallExpiresInSeconds * 1000);
  const updated = {
    ...current,
    heartbeat_sequence: current.heartbeat_sequence + 1,
    heartbeat_at: heartbeatAt.toISOString(),
    wall_expires_at: expiresAt.toISOString(),
    acquired_at: acquiredAt.toISOString()
  };
  await contractRegistryValidate(leaseSchemaRef(), updated);
  await writeOperationLease(dataRoot, repositoryIdentity, updated);
  return { lease: updated, path: paths(dataRoot, repositoryIdentity, lease.operation_id).lease };
}

export async function acquireOperationLease(dataRoot, repositoryIdentity, lease, { now = () => new Date(), isOwnerAlive = async () => false } = {}) {
  await contractRegistryValidate(leaseSchemaRef(), lease);
  const { root, lease: leasePath } = paths(dataRoot, repositoryIdentity, lease.operation_id);
  await ensureOperationDirectories(root);
  let existing = null;
  try {
    existing = await loadOperationLease(dataRoot, repositoryIdentity, lease.operation_id);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  if (!existing) {
    await replaceAtomicJson(leasePath, lease);
    return { lease, path: leasePath, replaced: false, stale_owner: null };
  }
  const currentTime = now().getTime();
  const expired = Date.parse(existing.wall_expires_at) <= currentTime;
  const live = await isOwnerAlive(existing);
  if (!expired || live) {
    throw new Error("Operation lease is still owned by a live process.");
  }
  await replaceAtomicJson(leasePath, lease);
  return { lease, path: leasePath, replaced: true, stale_owner: existing };
}

export async function createTerminalFence(dataRoot, repositoryIdentity, fence) {
  await contractRegistryValidate(fenceSchemaRef(), fence);
  const { root, terminalFence } = paths(dataRoot, repositoryIdentity, fence.operation_id);
  await ensureOperationDirectories(root);
  try {
    const handle = await open(terminalFence, "wx", 0o600);
    try {
      await handle.writeFile(`${canonicalJson(fence)}\n`, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    const directory = await open(path.dirname(terminalFence), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    return { created: true, fence, path: terminalFence };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = await readPrivateJson(terminalFence);
    await contractRegistryValidate(fenceSchemaRef(), existing);
    if (existing.operation_id !== fence.operation_id) throw new Error("Terminal fence does not belong to the requested operation.");
    return { created: false, fence: existing, path: terminalFence };
  }
}

export async function loadTerminalFence(dataRoot, repositoryIdentity, operationId) {
  const { terminalFence } = paths(dataRoot, repositoryIdentity, operationId);
  try {
    const value = await readPrivateJson(terminalFence);
    await contractRegistryValidate(fenceSchemaRef(), value);
    if (value.operation_id !== operationId) throw new Error("Terminal fence does not belong to the requested operation.");
    return value;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

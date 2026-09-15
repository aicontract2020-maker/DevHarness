import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { canonicalJson } from "../src/canonical-records.mjs";
import {
  acquireOperationLease,
  createTerminalFence,
  heartbeatOperationLease,
  loadOperationLease,
  loadTerminalFence,
  operationLeasePaths,
  writeOperationLease
} from "../src/operation-lease.mjs";

const repositoryIdentity = "example/project";
const operationId = "alignment-operation-1";
const now = "2026-09-01T12:00:00.000Z";

function lease(overrides = {}) {
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
    heartbeat_at: now,
    ...overrides
  };
}

function fence(kind, overrides = {}) {
  return {
    schema_version: 1,
    id: `${kind}-fence-1`,
    operation_id: operationId,
    kind,
    created_at: now,
    expected_journal_head_sha256: "a".repeat(64),
    prepared_manifest_sha256: kind === "cancel" ? null : "b".repeat(64),
    requested_by: kind === "cancel" ? { id: "developer", kind: "human" } : { id: "runtime", kind: "runtime" },
    ...overrides
  };
}

test("operation leases are written, loaded, and heartbeated as bounded owner records", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-lease-"));
  const initial = lease();

  const written = await writeOperationLease(root, repositoryIdentity, initial);
  assert.ok(written.path.endsWith("lease.json"));
  assert.deepEqual(await loadOperationLease(root, repositoryIdentity, operationId), initial);

  const renewed = await heartbeatOperationLease(root, repositoryIdentity, initial, {
    now: () => new Date("2026-09-01T12:00:30.000Z"),
    wallExpiresInSeconds: 120
  });
  assert.equal(renewed.lease.heartbeat_sequence, 1);
  assert.equal(renewed.lease.heartbeat_at, "2026-09-01T12:00:30.000Z");
  assert.equal(renewed.lease.wall_expires_at, "2026-09-01T12:02:30.000Z");
  assert.deepEqual(await loadOperationLease(root, repositoryIdentity, operationId), renewed.lease);
});

test("stale leases can be replaced only after expiry and a dead-owner probe", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-lease-"));
  await writeOperationLease(root, repositoryIdentity, lease({ wall_expires_at: "2026-09-01T11:59:00.000Z" }));
  const replacement = lease({ owner_id: "owner-2", boot_id: "boot-2", pid: 5678, process_birth_id: "birth-2" });

  await assert.rejects(() => acquireOperationLease(root, repositoryIdentity, replacement, {
    now: () => new Date("2026-09-01T12:00:30.000Z"),
    isOwnerAlive: async () => true
  }), /live process/);

  const acquired = await acquireOperationLease(root, repositoryIdentity, replacement, {
    now: () => new Date("2026-09-01T12:00:30.000Z"),
    isOwnerAlive: async () => false
  });
  assert.equal(acquired.replaced, true);
  assert.deepEqual(await loadOperationLease(root, repositoryIdentity, operationId), replacement);
});

test("terminal fences are create-only and preserve the first winner", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-fence-"));
  const cancelFence = fence("cancel");
  const created = await createTerminalFence(root, repositoryIdentity, cancelFence);
  assert.equal(created.created, true);

  const commitFence = fence("commit", { id: "commit-fence-1" });
  const existing = await createTerminalFence(root, repositoryIdentity, commitFence);
  assert.equal(existing.created, false);
  assert.deepEqual(existing.fence, cancelFence);
  assert.deepEqual(await loadTerminalFence(root, repositoryIdentity, operationId), cancelFence);

  const stored = await readFile(operationLeasePaths(root, repositoryIdentity, operationId).terminalFence, "utf8");
  assert.equal(stored, `${canonicalJson(cancelFence)}\n`);
});


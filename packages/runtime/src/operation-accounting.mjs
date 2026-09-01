import { createHash } from "node:crypto";
import { lstat, mkdir, open } from "node:fs/promises";
import path from "node:path";

import { canonicalJson } from "./canonical-records.mjs";

const SHA256 = /^[0-9a-f]{64}$/;
const ACCOUNTING_PATH = /^(?:attempts\/(?:analysis-plan|analysis-synthesis|analysis-validation)\/[12]\/(?:reservation|attempt)\.json|outbound\/provider\/(?:[1-9]|[1-9]\d|1[01]\d|120)\/(?:reservation|receipt)\.json|outbound\/research\/(?:[1-9]|1\d|2[0-5])\/reservation\.json|outbound\/research\/(?:[1-9]|1\d|2[0-5])\/terminal\/(?:manifest|receipt|source|gap)\.json)$/;
const LIMITS = [
  ["active_execution_ms", "max_active_execution_seconds", 1000],
  ["agent_attempts", "max_agent_attempts", 1],
  ["provider_requests", "max_provider_requests", 1],
  ["total_tokens", "max_total_tokens", 1],
  ["research_requests", "max_research_requests", 1],
  ["research_bytes", "max_research_bytes", 1],
  ["retained_records", "max_retained_records", 1],
  ["retained_bytes", "max_retained_bytes", 1]
];

function indexUnique(records, key, label) {
  const result = new Map();
  for (const record of records) {
    const id = record?.[key];
    if (typeof id !== "string" || result.has(id)) throw new Error(`${label} has a missing or duplicate ${key}.`);
    result.set(id, record);
  }
  return result;
}

function trustedUsage(receipt) {
  const usage = receipt?.usage;
  return receipt?.status === "completed" && usage && Number.isSafeInteger(usage.input_tokens)
    && Number.isSafeInteger(usage.output_tokens) && Number.isSafeInteger(usage.total_tokens)
    && usage.input_tokens >= 0 && usage.output_tokens >= 0
    && usage.total_tokens === usage.input_tokens + usage.output_tokens;
}

function violationsFor(summary, limits) {
  const violations = [];
  for (const [field, limit, multiplier] of LIMITS) {
    if (Number.isFinite(limits?.[limit]) && summary[field] > limits[limit] * multiplier) violations.push(limit);
  }
  return violations;
}

function emptySummary() {
  return { active_execution_ms: 0, agent_attempts: 0, provider_requests: 0, total_tokens: 0, research_requests: 0, research_bytes: 0, retained_records: 0, retained_bytes: 0 };
}

export function replayOperationAccounting({ limits = {}, attemptReservations = [], attempts = [], outboundReservations = [], outboundReceipts = [], retainedArtifacts = [] } = {}) {
  const summary = emptySummary();
  const attemptsById = indexUnique(attempts, "id", "Agent attempts");
  const receiptsByReservation = indexUnique(outboundReceipts, "reservation_id", "Outbound receipts");
  const seenAttemptReservations = new Set();
  for (const reservation of attemptReservations) {
    if (seenAttemptReservations.has(reservation.attempt_id)) throw new Error("Agent attempt reservations contain a duplicate attempt_id.");
    seenAttemptReservations.add(reservation.attempt_id);
    summary.agent_attempts += 1;
    const attempt = attemptsById.get(reservation.attempt_id);
    summary.active_execution_ms += attempt ? attempt.duration_ms : reservation.reserved_active_ms;
  }

  const seenOutbound = new Set();
  for (const reservation of outboundReservations) {
    if (seenOutbound.has(reservation.id)) throw new Error("Outbound reservations contain a duplicate id.");
    seenOutbound.add(reservation.id);
    const receipt = receiptsByReservation.get(reservation.id);
    if (reservation.channel === "provider") {
      summary.provider_requests += 1;
      summary.total_tokens += trustedUsage(receipt) ? receipt.usage.total_tokens : reservation.reserved_tokens;
    } else if (reservation.channel === "research") {
      summary.research_requests += 1;
      const releasable = receipt?.status === "completed" || receipt?.status === "failed";
      summary.research_bytes += releasable ? receipt.response_bytes : reservation.reserved_response_bytes;
      summary.active_execution_ms += releasable ? receipt.active_ms : reservation.reserved_active_ms;
    } else {
      throw new Error(`Unknown outbound reservation channel: ${reservation.channel}`);
    }
  }
  for (const receipt of outboundReceipts) {
    if (!seenOutbound.has(receipt.reservation_id)) throw new Error("Outbound receipt has no matching reservation.");
  }
  for (const artifact of retainedArtifacts) {
    if (!Number.isSafeInteger(artifact?.size_bytes) || artifact.size_bytes < 0) throw new Error("Retained artifact size is invalid.");
    summary.retained_records += 1;
    summary.retained_bytes += artifact.size_bytes;
  }
  const violations = violationsFor(summary, limits);
  return { summary: Object.freeze(summary), within_limits: violations.length === 0, violations: Object.freeze(violations) };
}

export function assertReservationFits(currentSummary, reservation, limits) {
  const next = { ...emptySummary(), ...currentSummary };
  if (reservation?.channel === "provider") {
    next.provider_requests += 1;
    next.total_tokens += reservation.reserved_tokens;
  } else if (reservation?.channel === "research") {
    next.research_requests += 1;
    next.research_bytes += reservation.reserved_response_bytes;
    next.active_execution_ms += reservation.reserved_active_ms;
  } else if (reservation && Number.isSafeInteger(reservation.reserved_active_ms)) {
    next.agent_attempts += 1;
    next.active_execution_ms += reservation.reserved_active_ms;
  } else {
    throw new Error("Unknown reservation type.");
  }
  const violations = violationsFor(next, limits);
  if (violations.length > 0) throw new Error(`Operation reservation exceeds ${violations.join(", ")}.`);
  return Object.freeze(next);
}

export async function withPublishedReservation({ reservation, publish, action } = {}) {
  if (typeof publish !== "function" || typeof action !== "function") throw new TypeError("Reservation publication and action callbacks are required.");
  await publish(reservation);
  return action(reservation);
}

async function ensureSafeDirectories(root, relativeDirectory) {
  const resolvedRoot = path.resolve(root);
  const parts = relativeDirectory ? relativeDirectory.split("/") : [];
  let current = resolvedRoot;
  try {
    const rootInfo = await lstat(current);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Accounting root is unsafe.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await mkdir(current, { recursive: false, mode: 0o700 });
  }
  for (const part of parts) {
    current = path.join(current, part);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Accounting directory is unsafe.");
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Accounting directory is unsafe.");
    }
  }
}

export async function publishAccountingEntry(root, { storage_key: storageKey, sha256, record } = {}) {
  if (typeof storageKey !== "string" || !ACCOUNTING_PATH.test(storageKey) || storageKey.includes("..") || storageKey.includes("\\")) throw new Error("Accounting storage key is unsafe or unlisted.");
  if (!SHA256.test(sha256)) throw new Error("Accounting record digest is invalid.");
  const bytes = Buffer.from(canonicalJson(record), "utf8");
  if (createHash("sha256").update(bytes).digest("hex") !== sha256) throw new Error("Accounting record digest does not match its canonical bytes.");
  await ensureSafeDirectories(root, path.posix.dirname(storageKey) === "." ? "" : path.posix.dirname(storageKey));
  const target = path.join(path.resolve(root), ...storageKey.split("/"));
  let handle;
  try {
    handle = await open(target, "wx", 0o600);
    await handle.writeFile(bytes);
    await handle.sync();
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Accounting record already exists: ${storageKey}`);
    throw error;
  } finally {
    await handle?.close();
  }
  const directoryHandle = await open(path.dirname(target), "r");
  try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
  return Object.freeze({ storage_key: storageKey, sha256, size_bytes: bytes.length });
}

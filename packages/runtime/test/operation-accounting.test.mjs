import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertReservationFits,
  publishAccountingEntry,
  replayOperationAccounting,
  withPublishedReservation
} from "../src/operation-accounting.mjs";
import { canonicalJson } from "../src/canonical-records.mjs";

const hash = "a".repeat(64);
const limits = { max_active_execution_seconds: 3600, max_agent_attempts: 6, max_provider_requests: 120, max_total_tokens: 600000, max_research_requests: 25, max_research_bytes: 10485760, max_retained_records: 20, max_retained_bytes: 20971520 };
const attemptReservation = { id: "attempt-reservation-1", attempt_id: "attempt-1", reserved_active_ms: 600000 };
const providerReservation = { id: "provider-reservation-1", channel: "provider", attempt_id: "attempt-1", reserved_input_tokens: 100, reserved_output_tokens: 200, reserved_tokens: 300, reserved_response_bytes: 0, reserved_active_ms: 0 };
const researchReservation = { id: "research-reservation-1", channel: "research", attempt_id: null, reserved_input_tokens: 0, reserved_output_tokens: 0, reserved_tokens: 0, reserved_response_bytes: 2000, reserved_active_ms: 30000 };

test("reservation publication completes before any external action begins", async () => {
  const order = [];
  const result = await withPublishedReservation({
    reservation: providerReservation,
    async publish() { await Promise.resolve(); order.push("published"); },
    async action() { order.push("action"); return "done"; }
  });
  assert.equal(result, "done");
  assert.deepEqual(order, ["published", "action"]);
  await assert.rejects(() => withPublishedReservation({ reservation: providerReservation, async publish() { throw new Error("disk failed"); }, async action() { order.push("unsafe-action"); } }), /disk failed/);
  assert.equal(order.includes("unsafe-action"), false);
});

test("replay charges missing terminals conservatively and releases only from trusted receipts", () => {
  const reserved = replayOperationAccounting({ limits, attemptReservations: [attemptReservation], attempts: [], outboundReservations: [providerReservation, researchReservation], outboundReceipts: [] });
  assert.deepEqual(reserved.summary, { active_execution_ms: 630000, agent_attempts: 1, provider_requests: 1, total_tokens: 300, research_requests: 1, research_bytes: 2000, retained_records: 0, retained_bytes: 0 });

  const settled = replayOperationAccounting({
    limits,
    attemptReservations: [attemptReservation], attempts: [{ id: "attempt-1", duration_ms: 1000 }],
    outboundReservations: [providerReservation, researchReservation],
    outboundReceipts: [
      { reservation_id: providerReservation.id, status: "completed", usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 }, response_bytes: 0, active_ms: 0 },
      { reservation_id: researchReservation.id, status: "completed", usage: null, response_bytes: 250, active_ms: 100 }
    ]
  });
  assert.deepEqual(settled.summary, { active_execution_ms: 1100, agent_attempts: 1, provider_requests: 1, total_tokens: 15, research_requests: 1, research_bytes: 250, retained_records: 0, retained_bytes: 0 });

  const unknown = replayOperationAccounting({ limits, outboundReservations: [researchReservation], outboundReceipts: [{ reservation_id: researchReservation.id, status: "outcome-unknown", usage: null, response_bytes: 0, active_ms: 0 }] });
  assert.equal(unknown.summary.research_bytes, 2000);
  assert.equal(unknown.summary.active_execution_ms, 30000);
});

test("every aggregate ceiling is enforced before accepting another reservation", () => {
  const base = { ...limits, max_agent_attempts: 1, max_provider_requests: 1, max_total_tokens: 300, max_active_execution_seconds: 600, max_research_requests: 1, max_research_bytes: 2000 };
  const replay = replayOperationAccounting({ limits: base, attemptReservations: [attemptReservation], outboundReservations: [providerReservation, researchReservation] });
  assert.equal(replay.within_limits, false, "research active time also contributes to the aggregate ceiling");
  assert.ok(replay.violations.includes("max_active_execution_seconds"));
  assert.throws(() => assertReservationFits({ ...replay.summary, active_execution_ms: 0 }, providerReservation, base), /max_provider_requests/);
  assert.throws(() => assertReservationFits({ ...replay.summary, active_execution_ms: 0, provider_requests: 0 }, { ...providerReservation, id: "provider-2", reserved_tokens: 301 }, base), /max_total_tokens/);
  assert.throws(() => assertReservationFits({ ...replay.summary, active_execution_ms: 0, research_requests: 0 }, { ...researchReservation, id: "research-2", reserved_response_bytes: 2001 }, base), /max_research_bytes/);
});

test("accounting records are create-only and conflicting publication cannot replace durable bytes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-accounting-"));
  const sha256 = createHash("sha256").update(canonicalJson(providerReservation)).digest("hex");
  const entry = { storage_key: "outbound/provider/1/reservation.json", sha256, record: providerReservation };
  await publishAccountingEntry(root, entry);
  await publishAccountingEntry(root, { ...entry, storage_key: "outbound/provider/120/reservation.json" });
  const target = path.join(root, entry.storage_key);
  const before = await readFile(target, "utf8");
  await assert.rejects(() => publishAccountingEntry(root, { ...entry, record: { ...providerReservation, reserved_tokens: 999 } }), /already exists|digest/);
  assert.equal(await readFile(target, "utf8"), before);
  await assert.rejects(() => publishAccountingEntry(root, { ...entry, storage_key: "../escape.json" }), /unsafe|unlisted/);
});

test("retained Agent-derived records are counted independently of attempt scratch", () => {
  const replay = replayOperationAccounting({ limits, retainedArtifacts: [{ id: "one", size_bytes: 100 }, { id: "two", size_bytes: 200 }] });
  assert.equal(replay.summary.retained_records, 2);
  assert.equal(replay.summary.retained_bytes, 300);
  const over = replayOperationAccounting({ limits: { ...limits, max_retained_records: 1 }, retainedArtifacts: [{ id: "one", size_bytes: 1 }, { id: "two", size_bytes: 1 }] });
  assert.deepEqual(over.violations, ["max_retained_records"]);
});

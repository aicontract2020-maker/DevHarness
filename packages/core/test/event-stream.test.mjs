import assert from "node:assert/strict";
import test from "node:test";

import { validateEventStream } from "../src/event-stream.mjs";

const event = (sequence, type, at = `2026-08-28T18:00:0${sequence}.000Z`) => ({
  event_id: `event-${sequence}`,
  run_id: "run-1",
  sequence,
  at,
  type
});

test("an append-only contiguous event stream validates", () => {
  const result = validateEventStream([
    event(1, "run.created"),
    event(2, "state.transitioned"),
    event(3, "artifact.written")
  ]);
  assert.deepEqual(result, { valid: true, errors: [] });
});

test("event streams reject gaps, duplicate ids, mixed runs, and time reversal", () => {
  const events = [
    event(1, "run.created", "2026-08-28T18:00:02.000Z"),
    {
      ...event(3, "artifact.written", "2026-08-28T18:00:01.000Z"),
      event_id: "event-1",
      run_id: "run-2"
    }
  ];
  const result = validateEventStream(events);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some((message) => message.includes("expected 2")));
  assert.ok(result.errors.some((message) => message.includes("different run")));
  assert.ok(result.errors.some((message) => message.includes("duplicated")));
  assert.ok(result.errors.some((message) => message.includes("older")));
});

test("the first event identifies run creation", () => {
  const result = validateEventStream([event(1, "state.transitioned")]);
  assert.equal(result.valid, false);
  assert.ok(result.errors.includes("the first event must be run.created"));
});


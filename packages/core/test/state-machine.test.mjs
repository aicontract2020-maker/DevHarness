import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedTransitions,
  assertTransition,
  evaluateTransition,
  TERMINAL_STATES
} from "../src/state-machine.mjs";

test("the happy path cannot skip engineering phases", () => {
  assert.equal(evaluateTransition("received", "discovering").allowed, true);
  assert.equal(evaluateTransition("received", "executing").allowed, false);
  assert.equal(evaluateTransition("specifying", "planning").allowed, false);
});

test("scope approval gates planning", () => {
  assert.equal(
    evaluateTransition("awaiting_scope_approval", "planning", { scopeApproved: false }).allowed,
    false
  );
  assert.equal(
    evaluateTransition("awaiting_scope_approval", "planning", { scopeApproved: true }).allowed,
    false
  );
  assert.equal(evaluateTransition("awaiting_scope_approval", "specifying").allowed, true);
});

test("delivery readiness and delivery approval are separate gates", () => {
  assert.equal(
    evaluateTransition("preparing_delivery", "awaiting_delivery_approval").allowed,
    false
  );
  assert.equal(
    evaluateTransition("preparing_delivery", "awaiting_delivery_approval", {
      deliveryReady: true
    }).allowed,
    true
  );
  assert.equal(evaluateTransition("awaiting_delivery_approval", "completed").allowed, false);
  assert.equal(
    evaluateTransition("awaiting_delivery_approval", "completed", {
      deliveryApproved: true
    }).allowed,
    false
  );
});

test("verification and review failures enter a bounded repair path", () => {
  assert.equal(evaluateTransition("verifying", "repairing").allowed, true);
  assert.equal(evaluateTransition("reviewing", "repairing").allowed, true);
  assert.equal(evaluateTransition("repairing", "verifying").allowed, true);
});

test("active states can stop honestly and terminal states cannot transition", () => {
  assert.ok(allowedTransitions("executing").includes("blocked"));
  assert.ok(allowedTransitions("executing").includes("cancelled"));

  for (const state of TERMINAL_STATES) {
    assert.deepEqual(allowedTransitions(state), []);
    assert.throws(() => assertTransition(state, "discovering"));
  }
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  allowedAlignmentTransitions,
  assertAlignmentTransition,
  evaluateAlignmentTransition,
  projectAlignmentState
} from "../src/alignment-phase-machine.mjs";

test("alignment operation transitions stay within the approved phase graph", () => {
  assert.deepEqual(allowedAlignmentTransitions("planned"), ["waiting-agent-authority", "waiting-research-authority", "running", "cancelled", "failed"]);
  assert.deepEqual(allowedAlignmentTransitions("waiting-agent-authority"), ["running", "failed", "cancelled", "timed-out"]);
  assert.deepEqual(allowedAlignmentTransitions("waiting-research-authority"), ["running", "failed", "cancelled", "timed-out"]);
  assert.deepEqual(allowedAlignmentTransitions("running"), ["question-blocked", "ready", "failed", "cancelled", "timed-out"]);
  assert.deepEqual(allowedAlignmentTransitions("question-blocked"), ["running", "ready", "failed", "cancelled", "timed-out"]);
  assert.deepEqual(allowedAlignmentTransitions("ready"), []);
  assert.deepEqual(allowedAlignmentTransitions("failed"), []);
  assert.deepEqual(allowedAlignmentTransitions("cancelled"), []);
  assert.deepEqual(allowedAlignmentTransitions("timed-out"), []);
  assert.deepEqual(allowedAlignmentTransitions("unknown"), []);

  assert.equal(evaluateAlignmentTransition("planned", "waiting-agent-authority", { agentAuthorityReady: false }).allowed, true);
  assert.equal(evaluateAlignmentTransition("planned", "waiting-agent-authority", { agentAuthorityReady: true }).allowed, false);
  assert.match(evaluateAlignmentTransition("planned", "waiting-agent-authority", { agentAuthorityReady: true }).reasons[0], /already approved/);

  assert.equal(evaluateAlignmentTransition("planned", "waiting-research-authority", { researchAuthorityReady: false }).allowed, true);
  assert.equal(evaluateAlignmentTransition("planned", "waiting-research-authority", { researchAuthorityReady: true }).allowed, false);
  assert.match(evaluateAlignmentTransition("planned", "waiting-research-authority", { researchAuthorityReady: true }).reasons[0], /already approved/);

  assert.equal(evaluateAlignmentTransition("waiting-agent-authority", "running").allowed, true);
  assert.equal(evaluateAlignmentTransition("waiting-research-authority", "running").allowed, true);

  assert.equal(evaluateAlignmentTransition("running", "question-blocked", { blockingQuestions: 0 }).allowed, false);
  assert.equal(evaluateAlignmentTransition("running", "question-blocked", { blockingQuestions: 1 }).allowed, true);
  assert.equal(evaluateAlignmentTransition("question-blocked", "running", { blockingQuestions: 0 }).allowed, true);

  assert.equal(evaluateAlignmentTransition("running", "ready", { blockingQuestions: 1, acceptanceReady: true }).allowed, false);
  assert.equal(evaluateAlignmentTransition("running", "ready", { blockingQuestions: 0, acceptanceReady: false }).allowed, false);
  assert.equal(evaluateAlignmentTransition("running", "ready", { blockingQuestions: 0, acceptanceReady: true }).allowed, true);

  assert.equal(evaluateAlignmentTransition("running", "failed", {}).allowed, false);
  assert.equal(evaluateAlignmentTransition("running", "failed", { failureReason: "timeout" }).allowed, true);
  assert.equal(evaluateAlignmentTransition("running", "timed-out", {}).allowed, false);
  assert.equal(evaluateAlignmentTransition("running", "timed-out", { timeoutExpired: true }).allowed, true);

  assert.throws(() => assertAlignmentTransition("ready", "running"), /not allowed/);
});

test("alignment operation state projection fails closed without evidence", () => {
  assert.deepEqual(projectAlignmentState({ status: "planned", active_phase: null }, {}), { status: "planned", active_phase: null, reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "planned", active_phase: null }, { agentAuthorityReady: false }), { status: "waiting-agent-authority", active_phase: null, reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "planned", active_phase: null }, { researchAuthorityReady: false }), { status: "waiting-research-authority", active_phase: null, reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "planned", active_phase: null }, { agentAuthorityReady: true, researchAuthorityReady: true }), { status: "running", active_phase: null, reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "running", active_phase: "analysis-plan" }, { blockingQuestions: 2 }), { status: "question-blocked", active_phase: "analysis-plan", reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "question-blocked", active_phase: "analysis-plan" }, { blockingQuestions: 0 }), { status: "running", active_phase: "analysis-plan", reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "running", active_phase: "analysis-plan" }, { acceptanceReady: true }), { status: "ready", active_phase: null, reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "running", active_phase: "analysis-plan" }, { failureReason: "timeout" }), { status: "failed", active_phase: null, reasons: ["timeout"] });
  assert.deepEqual(projectAlignmentState({ status: "running", active_phase: "analysis-plan" }, { cancelled: true }), { status: "cancelled", active_phase: null, reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "running", active_phase: "analysis-plan" }, { timeoutExpired: true }), { status: "timed-out", active_phase: null, reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "waiting-agent-authority", active_phase: null }, { cancelled: true }), { status: "cancelled", active_phase: null, reasons: [] });
  assert.deepEqual(projectAlignmentState({ status: "timed-out", active_phase: null }, {}), { status: "timed-out", active_phase: null, reasons: [] });
  assert.throws(() => projectAlignmentState({ status: "mystery", active_phase: null }, {}), /Unknown alignment operation state/);
});

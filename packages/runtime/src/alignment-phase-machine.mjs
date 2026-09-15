export const ALIGNMENT_OPERATION_STATES = Object.freeze([
  "planned",
  "waiting-agent-authority",
  "waiting-research-authority",
  "running",
  "question-blocked",
  "ready",
  "failed",
  "cancelled",
  "timed-out"
]);

export const TERMINAL_ALIGNMENT_OPERATION_STATES = Object.freeze([
  "ready",
  "failed",
  "cancelled",
  "timed-out"
]);

const TRANSITIONS = Object.freeze({
  planned: ["waiting-agent-authority", "waiting-research-authority", "running", "cancelled", "failed"],
  "waiting-agent-authority": ["running", "failed", "cancelled", "timed-out"],
  "waiting-research-authority": ["running", "failed", "cancelled", "timed-out"],
  running: ["question-blocked", "ready", "failed", "cancelled", "timed-out"],
  "question-blocked": ["running", "ready", "failed", "cancelled", "timed-out"],
  ready: [],
  failed: [],
  cancelled: [],
  "timed-out": []
});

function unique(values) {
  return [...new Set(values)];
}

export function allowedAlignmentTransitions(from) {
  if (!ALIGNMENT_OPERATION_STATES.includes(from)) return [];
  if (TERMINAL_ALIGNMENT_OPERATION_STATES.includes(from)) return [];
  return unique(TRANSITIONS[from]);
}

export function evaluateAlignmentTransition(from, to, context = {}) {
  const reasons = [];
  if (!ALIGNMENT_OPERATION_STATES.includes(from)) reasons.push(`unknown source state: ${from}`);
  if (!ALIGNMENT_OPERATION_STATES.includes(to)) reasons.push(`unknown target state: ${to}`);
  if (reasons.length > 0) return { allowed: false, reasons };
  if (!allowedAlignmentTransitions(from).includes(to)) reasons.push(`transition ${from} -> ${to} is not allowed`);

  if (from === "planned" && to === "waiting-agent-authority" && context.agentAuthorityReady === true) {
    reasons.push("agent authority is already approved; running or another active phase should be used instead of waiting-agent-authority.");
  }
  if (from === "planned" && to === "waiting-research-authority" && context.researchAuthorityReady === true) {
    reasons.push("research authority is already approved; running or another active phase should be used instead of waiting-research-authority.");
  }
  if (to === "question-blocked" && context.blockingQuestions === 0) {
    reasons.push("question-blocked requires at least one unresolved material question.");
  }
  if (to === "ready") {
    if (context.blockingQuestions > 0) reasons.push("ready requires zero unresolved material questions.");
    if (context.acceptanceReady !== true) reasons.push("ready requires validated acceptance criteria and evidence.");
  }
  if (to === "failed" && context.failureReason == null) {
    reasons.push("failed transitions require a failure reason.");
  }
  if (to === "timed-out" && context.timeoutExpired !== true) {
    reasons.push("timed-out transitions require an expired deadline.");
  }

  return { allowed: reasons.length === 0, reasons };
}

export function assertAlignmentTransition(from, to, context = {}) {
  const result = evaluateAlignmentTransition(from, to, context);
  if (!result.allowed) throw new Error(result.reasons.join("; "));
}

export function projectAlignmentState(status, context = {}) {
  const current = status?.status ?? "planned";
  if (!ALIGNMENT_OPERATION_STATES.includes(current)) {
    throw new Error(`Unknown alignment operation state: ${current}`);
  }
  if (current === "ready" || current === "failed" || current === "cancelled" || current === "timed-out") {
    return { status: current, active_phase: null, reasons: [] };
  }

  if (context.cancelled === true) {
    assertAlignmentTransition(current, "cancelled", context);
    return { status: "cancelled", active_phase: null, reasons: [] };
  }
  if (context.timeoutExpired === true) {
    assertAlignmentTransition(current, "timed-out", context);
    return { status: "timed-out", active_phase: null, reasons: [] };
  }
  if (context.failureReason) {
    assertAlignmentTransition(current, "failed", context);
    return { status: "failed", active_phase: null, reasons: [context.failureReason] };
  }
  if (context.agentAuthorityReady === false) {
    assertAlignmentTransition(current, "waiting-agent-authority", context);
    return { status: "waiting-agent-authority", active_phase: null, reasons: [] };
  }
  if (context.researchAuthorityReady === false) {
    assertAlignmentTransition(current, "waiting-research-authority", context);
    return { status: "waiting-research-authority", active_phase: null, reasons: [] };
  }
  if (context.blockingQuestions > 0 && (current === "running" || current === "question-blocked")) {
    assertAlignmentTransition(current, "question-blocked", context);
    return { status: "question-blocked", active_phase: context.active_phase ?? status.active_phase ?? "analysis-plan", reasons: [] };
  }
  if (context.acceptanceReady === true) {
    assertAlignmentTransition(current, "ready", context);
    return { status: "ready", active_phase: null, reasons: [] };
  }
  if (context.agentAuthorityReady === true || context.researchAuthorityReady === true || current === "running" || current === "question-blocked") {
    assertAlignmentTransition(current, "running", context);
    return { status: "running", active_phase: context.active_phase ?? status.active_phase ?? null, reasons: [] };
  }

  return { status: current, active_phase: status.active_phase ?? null, reasons: [] };
}

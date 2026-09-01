import { findTrustedApproval } from "./trusted-context.mjs";

export const RUN_STATES = Object.freeze([
  "received",
  "discovering",
  "clarifying",
  "researching",
  "specifying",
  "awaiting_scope_approval",
  "planning",
  "staffing",
  "executing",
  "verifying",
  "repairing",
  "reviewing",
  "preparing_delivery",
  "awaiting_delivery_approval",
  "completed",
  "blocked",
  "cancelled"
]);

export const TERMINAL_STATES = Object.freeze(["completed", "blocked", "cancelled"]);

const NORMAL_TRANSITIONS = Object.freeze({
  received: ["discovering"],
  discovering: ["clarifying"],
  clarifying: ["researching"],
  researching: ["specifying"],
  specifying: ["awaiting_scope_approval"],
  awaiting_scope_approval: ["specifying", "planning"],
  planning: ["staffing"],
  staffing: ["executing"],
  executing: ["verifying"],
  verifying: ["repairing", "reviewing"],
  repairing: ["verifying"],
  reviewing: ["repairing", "preparing_delivery"],
  preparing_delivery: ["awaiting_delivery_approval"],
  awaiting_delivery_approval: ["repairing", "completed"],
  completed: [],
  blocked: [],
  cancelled: []
});

function unique(values) {
  return [...new Set(values)];
}

export function allowedTransitions(from) {
  if (!RUN_STATES.includes(from)) {
    return [];
  }

  if (TERMINAL_STATES.includes(from)) {
    return [];
  }

  return unique([...NORMAL_TRANSITIONS[from], "blocked", "cancelled"]);
}

export function evaluateTransition(from, to, context = {}) {
  const reasons = [];

  if (!RUN_STATES.includes(from)) {
    reasons.push(`unknown source state: ${from}`);
  }

  if (!RUN_STATES.includes(to)) {
    reasons.push(`unknown target state: ${to}`);
  }

  if (reasons.length > 0) {
    return { allowed: false, reasons };
  }

  if (!allowedTransitions(from).includes(to)) {
    reasons.push(`transition ${from} -> ${to} is not allowed`);
  }

  if (
    from === "awaiting_scope_approval" &&
    to === "planning" &&
    !findTrustedApproval(context.trustContext, { gate: "scope", ...context.approvalRequirement })
  ) {
    reasons.push("a current Supervisor-verified scope approval is required before planning");
  }

  if (
    from === "preparing_delivery" &&
    to === "awaiting_delivery_approval" &&
    context.deliveryReady !== true
  ) {
    reasons.push("delivery-readiness checks must pass before requesting approval");
  }

  if (
    from === "awaiting_delivery_approval" &&
    to === "completed" &&
    !findTrustedApproval(context.trustContext, { gate: "delivery", ...context.approvalRequirement })
  ) {
    reasons.push("a current Supervisor-verified delivery approval is required before completion");
  }

  return { allowed: reasons.length === 0, reasons };
}

export function assertTransition(from, to, context = {}) {
  const result = evaluateTransition(from, to, context);
  if (!result.allowed) {
    throw new Error(result.reasons.join("; "));
  }
}

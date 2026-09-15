import { assertContract } from "../../project/src/contracts.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { loadGoalRun, loadRunSourceArtifact } from "./goal-run-store.mjs";
import { createSupervisorApprovalRequest } from "./supervisor-approval.mjs";
import { listVerifiedApprovalReceipts, listVerifiedApprovalRequests } from "./supervisor-store.mjs";

const CAPABILITY_PRIORITY = new Map([
  "agent-runtime",
  "browser-runtime",
  "simulator-runtime",
  "database-runtime",
  "service-runtime",
  "dependency-install",
  "network-research",
  "container-runtime",
  "credential-references"
].map((id, index) => [id, index]));

const REQUESTABLE_STATUSES = new Set(["unrequested", "expired", "stale"]);

/** Default pending/grant window for ordinary capabilities (minutes). */
export const DEFAULT_CAPABILITY_EXPIRES_IN_MINUTES = 60;

/**
 * Longer defaults for capabilities that stay in play across multi-hour Alignment / goal dogfood.
 * Bound by supervisor-approval boundedExpiry max (1440). Receipt expiry cannot exceed request expiry.
 */
export const LONG_LIVED_CAPABILITY_EXPIRES_IN_MINUTES = Object.freeze({
  "agent-runtime": 12 * 60,
  "network-research": 8 * 60
});

export function resolveCapabilityExpiresInMinutes(capabilityOrId, explicitMinutes = null) {
  if (explicitMinutes !== undefined && explicitMinutes !== null) {
    if (!Number.isInteger(explicitMinutes) || explicitMinutes < 1 || explicitMinutes > 24 * 60) {
      throw new Error("Approval expiry must be between 1 and 1440 minutes.");
    }
    return explicitMinutes;
  }
  const key = typeof capabilityOrId === "string"
    ? capabilityOrId
    : (capabilityOrId?.capability ?? capabilityOrId?.id);
  return LONG_LIVED_CAPABILITY_EXPIRES_IN_MINUTES[key] ?? DEFAULT_CAPABILITY_EXPIRES_IN_MINUTES;
}

function renewCapabilityHint(runId, capabilityId) {
  const minutes = resolveCapabilityExpiresInMinutes(capabilityId);
  const expiresFlag = minutes === DEFAULT_CAPABILITY_EXPIRES_IN_MINUTES ? "" : ` --expires-minutes ${minutes}`;
  return `devharness request-capability --run ${runId} --capability ${capabilityId}${expiresFlag}`;
}

const POST_SCOPE_CAPABILITY_STATES = new Set([
  "clarifying",
  "researching",
  "specifying",
  "awaiting_scope_approval",
  "planning",
  "staffing",
  "executing",
  "verifying"
]);

async function currentPlan(dataRoot, repositoryIdentity, runId) {
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  const scopeApproved = run.gates?.scope?.status === "approved";
  const clarifying = run.state === "clarifying";
  const postScope = scopeApproved && POST_SCOPE_CAPABILITY_STATES.has(run.state);
  if (!clarifying && !postScope) {
    throw new Error("Capability authorization is available while clarifying, or after scope approval through verifying.");
  }
  const { source, value } = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, "artifact-onboarding-plan");
  if (source.kind !== "onboarding-plan" && source.kind !== "onboarding") throw new Error("Current capability source is not an onboarding plan.");
  await assertContract("onboarding-plan", value);
  if (value.repository_identity !== repositoryIdentity || value.commit_sha !== run.current_head_sha) {
    throw new Error("Current capability plan is stale or belongs to a different repository.");
  }
  return { run, plan: value };
}

function projectResearchTask(task, capabilityViewItem) {
  const capabilityStatus = capabilityViewItem?.status ?? "unrequested";
  const status = capabilityStatus === "approved"
    ? "approved"
    : ["pending", "unrequested", "expired"].includes(capabilityStatus)
      ? "pending-approval"
      : "blocked";
  return {
    ...task,
    status,
    approval_request_id: capabilityViewItem?.approval_request_id ?? null,
    approval_receipt_id: capabilityViewItem?.approval_receipt_id ?? null
  };
}

function matchesRun(request, run) {
  return request.run_id === run.id && request.repository_identity === run.repository.identity && request.gate === "capability";
}

function itemStatus(capability, run, requests, receipts, now) {
  const subjectHash = hashContract(capability);
  const related = requests.filter((request) => matchesRun(request, run) && request.subject.id === capability.id);
  const exact = related
    .filter((request) => request.relevant_head_sha === run.current_head_sha && request.subject.artifact_sha256 === subjectHash)
    .sort((left, right) => right.requested_at.localeCompare(left.requested_at))[0];
  if (!exact) return { request: capability, subject_sha256: subjectHash, status: related.length > 0 ? "stale" : "unrequested" };
  const receipt = receipts.find((candidate) => candidate.request_id === exact.id);
  // Decided grants follow the receipt window; pending requests follow the request window.
  // (Receipt expiry is capped at request expiry by approval-policy.)
  const expirySource = receipt?.expires_at ?? exact.expires_at;
  const expired = Date.parse(expirySource) < now.getTime();
  if (receipt) {
    return {
      request: capability,
      subject_sha256: subjectHash,
      status: expired ? "expired" : receipt.decision === "approved" ? "approved" : "rejected",
      approval_request_id: exact.id,
      approval_receipt_id: receipt.id,
      expires_at: receipt.expires_at
    };
  }
  return {
    request: capability,
    subject_sha256: subjectHash,
    status: expired ? "expired" : "pending",
    approval_request_id: exact.id,
    expires_at: exact.expires_at
  };
}

export async function loadCapabilityAuthorizationView({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  now = new Date()
}) {
  const { run, plan } = await currentPlan(dataRoot, repositoryIdentity, runId);
  const requests = await listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity, { now, includeExpired: true });
  const receipts = await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity, { now, includeExpired: true });
  const capabilities = [...plan.capability_requests]
    .sort((left, right) => (CAPABILITY_PRIORITY.get(left.id) ?? 99) - (CAPABILITY_PRIORITY.get(right.id) ?? 99) || left.id.localeCompare(right.id))
    .map((capability) => itemStatus(capability, run, requests, receipts, now));
  const counts = Object.fromEntries(["unrequested", "pending", "approved", "rejected", "expired", "stale"].map((status) => [status, capabilities.filter((item) => item.status === status).length]));
  const capabilityById = new Map(capabilities.map((item) => [item.request.id, item]));
  const researchTasks = (plan.preflight?.research_tasks ?? [])
    .slice(0, 5)
    .map((task) => projectResearchTask(task, capabilityById.get(task.id)));
  const researchTaskCounts = {
    total: researchTasks.length,
    pending_approval: researchTasks.filter((item) => item.status === "pending-approval").length,
    approved: researchTasks.filter((item) => item.status === "approved").length,
    blocked: researchTasks.filter((item) => item.status === "blocked").length
  };
  const pending = capabilities.find((item) => item.status === "pending");
  const firstRequestable = capabilities.find((item) => REQUESTABLE_STATUSES.has(item.status));
  const declarationMissing = plan.next_action.id === "accept-project-declaration";
  const nextAction = pending
    ? `devharness approve --request ${pending.approval_request_id}`
    : declarationMissing
      ? "devharness init"
      : firstRequestable
        ? renewCapabilityHint(run.id, firstRequestable.request.id)
        : "Review rejected, expired or stale capabilities before executable understanding can begin.";
  const view = {
    schema_version: 1,
    run_id: run.id,
    repository_identity: repositoryIdentity,
    head_sha: run.current_head_sha,
    generated_at: now.toISOString(),
    counts: { total: capabilities.length, ...counts },
    capabilities,
    research_tasks: researchTasks,
    research_task_counts: researchTaskCounts,
    next_action: nextAction
  };
  await assertContract("capability-authorization-view", view);
  return view;
}

export async function requestCapabilityAuthorization({
  dataRoot,
  supervisorRoot,
  repositoryIdentity,
  runId,
  capabilityId,
  expiresInMinutes = null,
  now = () => new Date()
}) {
  const current = now();
  const { run, plan } = await currentPlan(dataRoot, repositoryIdentity, runId);
  const view = await loadCapabilityAuthorizationView({ dataRoot, supervisorRoot, repositoryIdentity, runId, now: current });
  const exactCapability = plan.capability_requests.find((candidate) => candidate.id === capabilityId);
  const aliasCapability = exactCapability ?? (["network-research", "agent-runtime"].includes(capabilityId)
    ? plan.capability_requests.find((candidate) => candidate.capability === capabilityId
      && REQUESTABLE_STATUSES.has(view.capabilities.find((item) => item.request.id === candidate.id)?.status ?? "unrequested"))
    : null);
  const capability = aliasCapability;
  if (!capability) throw new Error(`Current Goal Run did not request capability: ${capabilityId}`);
  const existing = view.capabilities.find((item) => item.request.id === capability.id);
  const resolvedExpiresInMinutes = resolveCapabilityExpiresInMinutes(capability, expiresInMinutes);

  // TTL reuse: an unexpired approved grant (or current pending request) for the same
  // repository/run/subject must not force another TTY approve or duplicate pending request.
  // Never silently invent approval for never-approved / rejected / expired / stale subjects.
  if (existing?.status === "approved") {
    const receipts = await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity, { now: current });
    const requests = await listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity, { now: current, includeExpired: true });
    const receipt = receipts.find((candidate) => candidate.id === existing.approval_receipt_id)
      ?? receipts.find((candidate) => candidate.request_id === existing.approval_request_id && candidate.decision === "approved");
    const request = requests.find((candidate) => candidate.id === existing.approval_request_id)
      ?? (receipt ? requests.find((candidate) => candidate.id === receipt.request_id) : null);
    if (!request || !receipt) {
      throw new Error(`Capability ${capability.id} is marked approved but its Supervisor grant could not be loaded.`);
    }
    return {
      request,
      receipt,
      capability,
      expires_in_minutes: resolvedExpiresInMinutes,
      reused: true,
      reuse_kind: "approved-grant"
    };
  }
  if (existing?.status === "pending") {
    const requests = await listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity, { now: current });
    const request = requests.find((candidate) => candidate.id === existing.approval_request_id);
    if (!request) {
      throw new Error(`Capability ${capability.id} is marked pending but its approval request could not be loaded.`);
    }
    return {
      request,
      capability,
      expires_in_minutes: resolvedExpiresInMinutes,
      reused: true,
      reuse_kind: "pending-request"
    };
  }
  if (existing && existing.status !== "unrequested" && existing.status !== "expired" && existing.status !== "stale") {
    throw new Error(`Capability ${capability.id} already has status ${existing.status}.`);
  }
  const request = await createSupervisorApprovalRequest({
    supervisorRoot,
    repositoryIdentity,
    relevantHeadSha: run.current_head_sha,
    runId,
    gate: "capability",
    subject: { id: capability.id, artifact_sha256: hashContract(capability) },
    expiresInMinutes: resolvedExpiresInMinutes,
    now: () => current
  });
  return { request, capability, expires_in_minutes: resolvedExpiresInMinutes, reused: false };
}

export async function resolveCapabilityApprovalContext({ dataRoot, supervisorRoot, repositoryIdentity, requestId, now = new Date() }) {
  const requests = await listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity, { now, includeExpired: true });
  const request = requests.find((candidate) => candidate.id === requestId);
  if (!request || request.gate !== "capability") return null;
  if (Date.parse(request.expires_at) < now.getTime()) {
    throw new Error(
      `Capability approval request has expired. Goal Run state is intact — renew then re-approve: ${renewCapabilityHint(request.run_id, request.subject.id)}`
    );
  }
  const { run, plan } = await currentPlan(dataRoot, repositoryIdentity, request.run_id);
  const capability = plan.capability_requests.find((candidate) => candidate.id === request.subject.id);
  if (!capability || request.relevant_head_sha !== run.current_head_sha || request.subject.artifact_sha256 !== hashContract(capability)) {
    throw new Error("Capability approval request does not match the current Goal Run capability plan.");
  }
  return capability;
}


const SHA256 = /^[0-9a-f]{64}$/;

function isNetworkResearchCapabilityItem(item) {
  const id = item?.request?.id ?? item?.id ?? null;
  const capability = item?.request?.capability ?? item?.capability ?? null;
  return capability === "network-research"
    || id === "network-research"
    || (typeof id === "string" && id.startsWith("research-task-"));
}

/**
 * Map a verified capability approval receipt onto the live network-research authority
 * shape used by continue / the research gateway. subject_sha256 is intentionally omitted:
 * continue stamps the bound network-research-subject digest after recipes bind.
 */
export function buildNetworkResearchAuthorityFromReceipt(receipt, { epoch = 1 } = {}) {
  if (!receipt || receipt.gate !== "capability" || receipt.decision !== "approved") return null;
  if (typeof receipt.request_id !== "string" || typeof receipt.id !== "string") return null;
  if (!SHA256.test(receipt.request_sha256 ?? "")) return null;
  const receiptSha256 = receipt.attestation?.payload_sha256;
  if (!SHA256.test(receiptSha256 ?? "")) return null;
  if (!Number.isInteger(epoch) || epoch < 1 || epoch > 20) {
    throw new Error("Research authority epoch must be between 1 and 20.");
  }
  return Object.freeze({
    capability: "network-research",
    request_id: receipt.request_id,
    receipt_id: receipt.id,
    request_sha256: receipt.request_sha256,
    receipt_sha256: receiptSha256,
    approved_at: receipt.decided_at,
    expires_at: receipt.expires_at,
    epoch
  });
}

/**
 * Prefer reusing current capability-gate approval receipts for network-research /
 * research-task-* grants instead of inventing a parallel authority system.
 */
export async function resolveNetworkResearchAuthorityFromCapabilityGrants({
  supervisorRoot,
  repositoryIdentity,
  capabilityView = null,
  now = new Date(),
  previousEpoch = 0
} = {}) {
  if (!supervisorRoot || !repositoryIdentity) return null;
  const approvedItems = (capabilityView?.capabilities ?? []).filter(
    (item) => item.status === "approved" && isNetworkResearchCapabilityItem(item)
  );
  if (approvedItems.length === 0 && !(capabilityView?.research_tasks ?? []).some((task) => task.status === "approved")) {
    return null;
  }
  const receipts = await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity, { now });
  if (!Array.isArray(receipts) || receipts.length === 0) return null;

  const preferredIds = new Set();
  for (const item of approvedItems) {
    if (item.approval_receipt_id) preferredIds.add(item.approval_receipt_id);
  }
  for (const task of capabilityView?.research_tasks ?? []) {
    if (task.status === "approved" && task.approval_receipt_id) preferredIds.add(task.approval_receipt_id);
  }
  const approvedSubjectIds = new Set(approvedItems.map((item) => item.request?.id).filter(Boolean));
  for (const task of capabilityView?.research_tasks ?? []) {
    if (task.status === "approved" && task.id) approvedSubjectIds.add(task.id);
  }

  const candidates = receipts.filter((receipt) => {
    if (receipt.gate !== "capability" || receipt.decision !== "approved") return false;
    if (preferredIds.has(receipt.id)) return true;
    return approvedSubjectIds.has(receipt.subject?.id)
      || receipt.subject?.id === "network-research"
      || (typeof receipt.subject?.id === "string" && receipt.subject.id.startsWith("research-task-"));
  }).sort((left, right) => String(right.decided_at).localeCompare(String(left.decided_at)));

  const chosen = candidates.find((receipt) => preferredIds.has(receipt.id)) ?? candidates[0] ?? null;
  if (!chosen) return null;
  const epoch = Math.max(1, Number.isInteger(previousEpoch) && previousEpoch > 0 ? previousEpoch : 1);
  return buildNetworkResearchAuthorityFromReceipt(chosen, { epoch });
}

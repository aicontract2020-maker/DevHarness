import { assertContract } from "../../project/src/contracts.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { loadGoalRun, loadRunSourceArtifact } from "./goal-run-store.mjs";
import { createSupervisorApprovalRequest } from "./supervisor-approval.mjs";
import { listVerifiedApprovalReceipts, listVerifiedApprovalRequests } from "./supervisor-store.mjs";

const CAPABILITY_PRIORITY = new Map([
  "browser-runtime",
  "simulator-runtime",
  "database-runtime",
  "service-runtime",
  "dependency-install",
  "network-research",
  "container-runtime",
  "credential-references"
].map((id, index) => [id, index]));

async function currentPlan(dataRoot, repositoryIdentity, runId) {
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  if (run.state !== "clarifying") throw new Error("Capability authorization is available only while the Goal Run is clarifying.");
  const { source, value } = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, "artifact-onboarding-plan");
  if (source.kind !== "onboarding-plan") throw new Error("Current capability source is not an onboarding plan.");
  await assertContract("onboarding-plan", value);
  if (value.repository_identity !== repositoryIdentity || value.commit_sha !== run.current_head_sha) {
    throw new Error("Current capability plan is stale or belongs to a different repository.");
  }
  return { run, plan: value };
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
  const expired = Date.parse(exact.expires_at) < now.getTime();
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
  const pending = capabilities.find((item) => item.status === "pending");
  const first = capabilities.find((item) => item.status === "unrequested");
  const declarationMissing = plan.next_action.id === "accept-project-declaration";
  const nextAction = pending
    ? `devharness approve --request ${pending.approval_request_id}`
    : declarationMissing
      ? "devharness init"
      : first
      ? `devharness request-capability --run ${run.id} --capability ${first.request.id}`
      : "Review rejected, expired or stale capabilities before executable understanding can begin.";
  const view = {
    schema_version: 1,
    run_id: run.id,
    repository_identity: repositoryIdentity,
    head_sha: run.current_head_sha,
    generated_at: now.toISOString(),
    counts: { total: capabilities.length, ...counts },
    capabilities,
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
  expiresInMinutes = 60,
  now = () => new Date()
}) {
  const current = now();
  const { run, plan } = await currentPlan(dataRoot, repositoryIdentity, runId);
  const capability = plan.capability_requests.find((candidate) => candidate.id === capabilityId);
  if (!capability) throw new Error(`Current Goal Run did not request capability: ${capabilityId}`);
  const view = await loadCapabilityAuthorizationView({ dataRoot, supervisorRoot, repositoryIdentity, runId, now: current });
  const existing = view.capabilities.find((item) => item.request.id === capabilityId);
  if (existing.status !== "unrequested" && existing.status !== "expired" && existing.status !== "stale") {
    throw new Error(`Capability ${capabilityId} already has status ${existing.status}.`);
  }
  const request = await createSupervisorApprovalRequest({
    supervisorRoot,
    repositoryIdentity,
    relevantHeadSha: run.current_head_sha,
    runId,
    gate: "capability",
    subject: { id: capability.id, artifact_sha256: hashContract(capability) },
    expiresInMinutes,
    now: () => current
  });
  return { request, capability };
}

export async function resolveCapabilityApprovalContext({ dataRoot, supervisorRoot, repositoryIdentity, requestId, now = new Date() }) {
  const requests = await listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity, { now, includeExpired: true });
  const request = requests.find((candidate) => candidate.id === requestId);
  if (!request || request.gate !== "capability") return null;
  if (Date.parse(request.expires_at) < now.getTime()) throw new Error("Capability approval request has expired.");
  const { run, plan } = await currentPlan(dataRoot, repositoryIdentity, request.run_id);
  const capability = plan.capability_requests.find((candidate) => candidate.id === request.subject.id);
  if (!capability || request.relevant_head_sha !== run.current_head_sha || request.subject.artifact_sha256 !== hashContract(capability)) {
    throw new Error("Capability approval request does not match the current Goal Run capability plan.");
  }
  return capability;
}

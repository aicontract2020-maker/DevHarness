import { createHash } from "node:crypto";
import process from "node:process";
import { createInterface } from "node:readline/promises";

import { approvalRequestHash } from "../../core/src/approval-policy.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import {
  attestApprovalReceipt,
  attestApprovalRequest,
  listVerifiedApprovalReceipts,
  listVerifiedApprovalRequests,
  loadSupervisorIdentity,
  randomSupervisorNonce,
  writeApprovalReceipt,
  writeApprovalRequest
} from "./supervisor-store.mjs";

const GATES = new Set(["capability", "strategy", "strategy-exception", "scope", "delivery", "alignment-answer"]);

function boundedExpiry(now, expiresInMinutes) {
  if (!Number.isInteger(expiresInMinutes) || expiresInMinutes < 1 || expiresInMinutes > 24 * 60) {
    throw new Error("Approval expiry must be between 1 and 1440 minutes.");
  }
  return new Date(now.getTime() + expiresInMinutes * 60_000);
}

export async function createSupervisorApprovalRequest({
  supervisorRoot,
  repositoryIdentity,
  relevantHeadSha,
  runId,
  gate,
  subject,
  expiresInMinutes = 60,
  now = () => new Date()
}) {
  if (!GATES.has(gate)) throw new Error(`Unsupported approval gate: ${gate}`);
  if (!subject?.id || !/^[0-9a-f]{64}$/.test(subject?.artifact_sha256 ?? "")) {
    throw new Error("Approval subject requires a stable id and canonical SHA-256 hash.");
  }
  const current = now();
  const nonce = randomSupervisorNonce();
  const seed = hashContract({ repositoryIdentity, relevantHeadSha, runId, gate, subject, nonce });
  const payload = {
    schema_version: 1,
    id: `approval-request-${seed.slice(0, 32)}`,
    run_id: runId,
    repository_identity: repositoryIdentity,
    relevant_head_sha: relevantHeadSha,
    gate,
    subject: structuredClone(subject),
    nonce,
    requested_at: current.toISOString(),
    expires_at: boundedExpiry(current, expiresInMinutes).toISOString(),
    status: "pending"
  };
  const request = await attestApprovalRequest(supervisorRoot, payload);
  await writeApprovalRequest(supervisorRoot, repositoryIdentity, request);
  return request;
}

function receiptId(request, decidedAt, decision) {
  return `approval-receipt-${createHash("sha256").update(`${request.id}\0${decidedAt}\0${decision}`).digest("hex").slice(0, 32)}`;
}

async function issueDecision({ supervisorRoot, request, decision, humanId, decidedAt }) {
  const payload = {
    schema_version: 1,
    id: receiptId(request, decidedAt, decision),
    request_id: request.id,
    request_sha256: approvalRequestHash(request),
    run_id: request.run_id,
    repository_identity: request.repository_identity,
    relevant_head_sha: request.relevant_head_sha,
    gate: request.gate,
    subject: structuredClone(request.subject),
    nonce: request.nonce,
    decision,
    decided_at: decidedAt,
    decided_by: { id: humanId, kind: "human", role: "developer-approver" },
    source: "interactive-human-gate",
    expires_at: request.expires_at
  };
  const receipt = await attestApprovalReceipt(supervisorRoot, payload);
  await writeApprovalReceipt(supervisorRoot, request.repository_identity, receipt);
  return receipt;
}

export function formatForegroundApproval(request, identity, capability = null, details = null) {
  const capabilityLines = capability ? [
    `Capability: ${capability.capability}\n`,
    `Operation: ${capability.operation}\n`,
    `Target: ${capability.target}\n`,
    `Scope: ${capability.scope.join(", ")}\n`,
    `Reason: ${capability.reason}\n`,
    `Risk: ${capability.risk}\n`,
    `Authority: ${capability.authority}\n`
  ] : [];
  const detailLines = details ? details.map((line) => `${line}\n`) : [];
  return [
    "\nDevHarness foreground approval\n",
    `Gate: ${request.gate}\n`,
    ...capabilityLines,
    ...detailLines,
    `Run: ${request.run_id}\n`,
    `Repository: ${request.repository_identity}\n`,
    `Revision: ${request.relevant_head_sha}\n`,
    `Subject: ${request.subject.id}\n`,
    `Subject hash: ${request.subject.artifact_sha256}\n`,
    `Supervisor: ${identity.fingerprint}\n`,
    `Expires: ${request.expires_at}\n\n`
  ].join("");
}

export function formatForegroundApprovalBatch(entries, identity) {
  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("Batch approval requires at least one pending request.");
  }
  if (entries.length === 1) {
    const only = entries[0];
    return formatForegroundApproval(only.request, identity, only.capability ?? null, only.details ?? null);
  }
  const blocks = entries.map((entry, index) => {
    const { request, capability = null, details = null } = entry;
    const capabilityLines = capability ? [
      `  Capability: ${capability.capability}`,
      `  Operation: ${capability.operation}`,
      `  Target: ${capability.target}`,
      `  Scope: ${capability.scope.join(", ")}`,
      `  Risk: ${capability.risk}`
    ] : [];
    const detailLines = details ? details.map((line) => `  ${line}`) : [];
    return [
      `[${index + 1}/${entries.length}] ${request.id}`,
      `  Gate: ${request.gate}`,
      ...capabilityLines,
      ...detailLines,
      `  Run: ${request.run_id}`,
      `  Subject: ${request.subject.id}`,
      `  Subject hash: ${request.subject.artifact_sha256}`,
      `  Expires: ${request.expires_at}`
    ].join("\n");
  });
  return [
    "\nDevHarness foreground batch approval\n",
    `Supervisor: ${identity.fingerprint}\n`,
    `Pending requests: ${entries.length}\n\n`,
    blocks.join("\n\n"),
    "\n\n"
  ].join("");
}

function uniqueRequestIds(requestIds) {
  if (!Array.isArray(requestIds) || requestIds.length === 0) {
    throw new Error("Approval requires at least one request id.");
  }
  const seen = new Set();
  const ordered = [];
  for (const requestId of requestIds) {
    if (typeof requestId !== "string" || !requestId.trim()) {
      throw new Error("Approval request ids must be non-empty strings.");
    }
    if (seen.has(requestId)) continue;
    seen.add(requestId);
    ordered.push(requestId);
  }
  return ordered;
}

export async function listPendingApprovalRequestsForRun({
  supervisorRoot,
  repositoryIdentity,
  runId,
  now = new Date()
}) {
  if (!runId) throw new Error("Listing pending approvals requires a run id.");
  const current = typeof now === "function" ? now() : now;
  const requests = await listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity, { now: current });
  const receipts = await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity, { now: current });
  const decided = new Set(receipts.map((receipt) => receipt.request_id));
  return requests
    .filter((request) => request.run_id === runId && !decided.has(request.id))
    .sort((left, right) => left.requested_at.localeCompare(right.requested_at) || left.id.localeCompare(right.id));
}

/**
 * Record one or more approval decisions in a single foreground TTY session.
 * Confirmation must name every request id exactly (APPROVE id1 id2 … / REJECT …).
 * Piped / JSON decisions remain refused unless a test responseProvider is supplied.
 */
export async function recordInteractiveApprovalDecisions({
  supervisorRoot,
  repositoryIdentity,
  requestIds,
  humanId = "developer",
  capabilitiesByRequestId = null,
  detailsByRequestId = null,
  responseProvider = null,
  emitPrompt = true,
  now = () => new Date()
}) {
  const interactiveInput = process.stdin;
  const interactiveOutput = process.stdout;
  if (!responseProvider && (!interactiveInput.isTTY || !interactiveOutput.isTTY)) {
    throw new Error("Approval requires the foreground Supervisor TTY; piped and JSON decisions are refused. Independent human authentication is not yet implemented.");
  }
  const orderedIds = uniqueRequestIds(requestIds);
  const current = now();
  const requests = await listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity, { now: current });
  const decisions = await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity, { now: current });
  const decided = new Set(decisions.map((receipt) => receipt.request_id));
  const byId = new Map(requests.map((request) => [request.id, request]));
  const entries = [];
  for (const requestId of orderedIds) {
    const request = byId.get(requestId);
    if (!request) throw new Error(`No current verified pending approval request exists with id ${requestId}.`);
    if (decided.has(request.id)) throw new Error(`Approval request ${request.id} already has an immutable decision.`);
    const capability = capabilitiesByRequestId?.[requestId] ?? null;
    if (request.gate === "capability") {
      if (!capability || capability.id !== request.subject.id || hashContract(capability) !== request.subject.artifact_sha256) {
        throw new Error(`Capability approval for ${request.id} requires the exact current bounded capability context.`);
      }
    }
    entries.push({
      request,
      capability,
      details: detailsByRequestId?.[requestId] ?? null
    });
  }

  const identity = await loadSupervisorIdentity(supervisorRoot);
  if (emitPrompt) interactiveOutput.write(formatForegroundApprovalBatch(entries, identity));
  const idPhrase = orderedIds.join(" ");
  const prompt = orderedIds.length === 1
    ? `Type APPROVE ${idPhrase} or REJECT ${idPhrase}: `
    : `Type APPROVE ${idPhrase} or REJECT ${idPhrase} (all ${orderedIds.length} ids, space-separated): `;
  const terminal = responseProvider
    ? null
    : createInterface({ input: interactiveInput, output: interactiveOutput, terminal: true });
  let answer;
  try {
    if (responseProvider) {
      answer = (await responseProvider(prompt)).trim();
    } else {
      answer = (await terminal.question(prompt)).trim();
    }
  } finally {
    terminal?.close();
  }
  const approve = `APPROVE ${idPhrase}`;
  const reject = `REJECT ${idPhrase}`;
  if (answer !== approve && answer !== reject) {
    throw new Error("Approval was not recorded because the exact confirmation phrase was not entered.");
  }
  const decision = answer === approve ? "approved" : "rejected";
  const decidedAt = current.toISOString();
  const receipts = [];
  for (const entry of entries) {
    receipts.push(await issueDecision({
      supervisorRoot,
      request: entry.request,
      decision,
      humanId,
      decidedAt
    }));
  }
  return { decision, receipts, request_ids: orderedIds };
}

export async function recordInteractiveApprovalDecision({
  supervisorRoot,
  repositoryIdentity,
  requestId,
  humanId = "developer",
  capability = null,
  details = null,
  responseProvider = null,
  emitPrompt = true,
  now = () => new Date()
}) {
  const batch = await recordInteractiveApprovalDecisions({
    supervisorRoot,
    repositoryIdentity,
    requestIds: [requestId],
    humanId,
    capabilitiesByRequestId: capability ? { [requestId]: capability } : null,
    detailsByRequestId: details ? { [requestId]: details } : null,
    responseProvider,
    emitPrompt,
    now
  });
  return batch.receipts[0];
}

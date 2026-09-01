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

const GATES = new Set(["capability", "strategy", "strategy-exception", "scope", "delivery"]);

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

export function formatForegroundApproval(request, identity, capability = null) {
  const capabilityLines = capability ? [
    `Capability: ${capability.capability}\n`,
    `Operation: ${capability.operation}\n`,
    `Target: ${capability.target}\n`,
    `Scope: ${capability.scope.join(", ")}\n`,
    `Reason: ${capability.reason}\n`,
    `Risk: ${capability.risk}\n`,
    `Authority: ${capability.authority}\n`
  ] : [];
  return [
    "\nDevHarness foreground approval\n",
    `Gate: ${request.gate}\n`,
    ...capabilityLines,
    `Run: ${request.run_id}\n`,
    `Repository: ${request.repository_identity}\n`,
    `Revision: ${request.relevant_head_sha}\n`,
    `Subject: ${request.subject.id}\n`,
    `Subject hash: ${request.subject.artifact_sha256}\n`,
    `Supervisor: ${identity.fingerprint}\n`,
    `Expires: ${request.expires_at}\n\n`
  ].join("");
}

export async function recordInteractiveApprovalDecision({
  supervisorRoot,
  repositoryIdentity,
  requestId,
  humanId = "developer",
  capability = null
}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Approval requires the foreground Supervisor TTY; piped and JSON decisions are refused. Independent human authentication is not yet implemented.");
  }
  const requests = await listVerifiedApprovalRequests(supervisorRoot, repositoryIdentity);
  const request = requests.find((candidate) => candidate.id === requestId);
  if (!request) throw new Error("No current verified pending approval request exists with that id.");
  const decisions = await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity);
  if (decisions.some((receipt) => receipt.request_id === request.id)) throw new Error("This approval request already has an immutable decision.");
  if (request.gate === "capability") {
    if (!capability || capability.id !== request.subject.id || hashContract(capability) !== request.subject.artifact_sha256) {
      throw new Error("Capability approval requires the exact current bounded capability context.");
    }
  }

  const identity = await loadSupervisorIdentity(supervisorRoot);
  process.stdout.write(formatForegroundApproval(request, identity, capability));
  const prompt = `Type APPROVE ${request.id} or REJECT ${request.id}: `;
  const terminal = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  let answer;
  try {
    answer = (await terminal.question(prompt)).trim();
  } finally {
    terminal.close();
  }
  const approve = `APPROVE ${request.id}`;
  const reject = `REJECT ${request.id}`;
  if (answer !== approve && answer !== reject) throw new Error("Approval was not recorded because the exact confirmation phrase was not entered.");
  return issueDecision({
    supervisorRoot,
    request,
    decision: answer === approve ? "approved" : "rejected",
    humanId,
    decidedAt: new Date().toISOString()
  });
}

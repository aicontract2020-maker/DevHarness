import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { hashContract } from "../../project/src/harness.mjs";
import {
  createSupervisorApprovalRequest,
  listPendingApprovalRequestsForRun,
  recordInteractiveApprovalDecision,
  recordInteractiveApprovalDecisions
} from "../src/supervisor-approval.mjs";
import { initializeSupervisorIdentity, listVerifiedApprovalReceipts } from "../src/supervisor-store.mjs";

const repositoryIdentity = "example/batch-approve-project";
const sha = "b".repeat(40);
const at = "2026-09-15T16:00:00.000Z";

async function fixture(t) {
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-batch-approve-"));
  t.after(() => rm(supervisorRoot, { recursive: true, force: true }));
  await initializeSupervisorIdentity(supervisorRoot, { now: () => new Date(at) });
  return { supervisorRoot };
}

async function pendingRequest(supervisorRoot, { runId = "run-batch-1", subjectId = "subject-1", gate = "scope" } = {}) {
  return createSupervisorApprovalRequest({
    supervisorRoot,
    repositoryIdentity,
    relevantHeadSha: sha,
    runId,
    gate,
    subject: { id: subjectId, artifact_sha256: hashContract({ id: subjectId }) },
    expiresInMinutes: 60,
    now: () => new Date(at)
  });
}

test("batch approve records one decision per request with a single confirmation phrase", async (t) => {
  const { supervisorRoot } = await fixture(t);
  const first = await pendingRequest(supervisorRoot, { subjectId: "scope-a" });
  const second = await pendingRequest(supervisorRoot, { subjectId: "scope-b" });
  const promptSeen = [];
  const batch = await recordInteractiveApprovalDecisions({
    supervisorRoot,
    repositoryIdentity,
    requestIds: [first.id, second.id],
    responseProvider: async (prompt) => {
      promptSeen.push(prompt);
      return `APPROVE ${first.id} ${second.id}`;
    },
    now: () => new Date(at)
  });
  assert.equal(batch.decision, "approved");
  assert.equal(batch.receipts.length, 2);
  assert.deepEqual(batch.request_ids, [first.id, second.id]);
  assert.match(promptSeen[0], new RegExp(`APPROVE ${first.id} ${second.id}`));
  const receipts = await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity, { now: new Date(at) });
  assert.equal(receipts.length, 2);
  assert.ok(receipts.every((receipt) => receipt.decision === "approved"));
});

test("batch reject refuses partial confirmation phrases", async (t) => {
  const { supervisorRoot } = await fixture(t);
  const first = await pendingRequest(supervisorRoot, { subjectId: "scope-a" });
  const second = await pendingRequest(supervisorRoot, { subjectId: "scope-b" });
  await assert.rejects(
    recordInteractiveApprovalDecisions({
      supervisorRoot,
      repositoryIdentity,
      requestIds: [first.id, second.id],
      responseProvider: async () => `APPROVE ${first.id}`,
      now: () => new Date(at)
    }),
    /exact confirmation phrase/
  );
  assert.equal((await listVerifiedApprovalReceipts(supervisorRoot, repositoryIdentity, { now: new Date(at) })).length, 0);
});

test("single approve remains a one-id confirmation phrase", async (t) => {
  const { supervisorRoot } = await fixture(t);
  const request = await pendingRequest(supervisorRoot, { subjectId: "scope-solo" });
  const receipt = await recordInteractiveApprovalDecision({
    supervisorRoot,
    repositoryIdentity,
    requestId: request.id,
    responseProvider: async (prompt) => {
      assert.match(prompt, new RegExp(`^Type APPROVE ${request.id} or REJECT ${request.id}: `));
      return `APPROVE ${request.id}`;
    },
    now: () => new Date(at)
  });
  assert.equal(receipt.decision, "approved");
  assert.equal(receipt.request_id, request.id);
});

test("listPendingApprovalRequestsForRun returns only undecided requests for that run", async (t) => {
  const { supervisorRoot } = await fixture(t);
  const keep = await pendingRequest(supervisorRoot, { runId: "run-keep", subjectId: "keep" });
  await pendingRequest(supervisorRoot, { runId: "run-other", subjectId: "other" });
  const decided = await pendingRequest(supervisorRoot, { runId: "run-keep", subjectId: "decided" });
  await recordInteractiveApprovalDecision({
    supervisorRoot,
    repositoryIdentity,
    requestId: decided.id,
    responseProvider: async () => `APPROVE ${decided.id}`,
    now: () => new Date(at)
  });
  const pending = await listPendingApprovalRequestsForRun({
    supervisorRoot,
    repositoryIdentity,
    runId: "run-keep",
    now: new Date(at)
  });
  assert.deepEqual(pending.map((request) => request.id), [keep.id]);
});

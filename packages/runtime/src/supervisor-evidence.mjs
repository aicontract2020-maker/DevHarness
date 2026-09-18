import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { receiptMatchesCurrentConfig } from "../../project/src/doctor.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { listValidReceipts } from "./data-store.mjs";
import {
  attestEvidenceManifest,
  listVerifiedEvidenceManifests,
  loadSupervisorIdentity,
  storeEvidenceBlob,
  writeEvidenceManifest
} from "./supervisor-store.mjs";

const COMMAND_TEST_SEMANTICS = Object.freeze({
  id: "command-test",
  version: 1,
  accepts: "current passing verification-receipt with command.kind=test",
  emits: ["test-result"],
  forbids: ["browser-snapshot", "network", "database-state", "api-response", "filesystem-state"]
});

const COMMAND_QUALITY_SEMANTICS = Object.freeze({
  id: "command-quality",
  version: 1,
  accepts: "current passing verification-receipt with command.kind in {lint,build}",
  emits: ["test-result"],
  forbids: ["browser-snapshot", "network", "database-state", "api-response", "filesystem-state"]
});

const COMMAND_SYSTEM_SEMANTICS = Object.freeze({
  id: "command-system",
  version: 1,
  accepts: "current passing verification-receipt with command.kind=verify",
  emits: ["test-result"],
  forbids: ["browser-snapshot", "network", "database-state", "api-response", "filesystem-state"]
});

async function commandDriver(semantics) {
  const implementation = await readFile(fileURLToPath(import.meta.url));
  return Object.freeze({
    id: semantics.id,
    version: semantics.version,
    implementation_sha256: createHash("sha256").update(implementation).digest("hex")
  });
}

export async function registeredEvidenceDrivers() {
  return Promise.all([COMMAND_SYSTEM_SEMANTICS, COMMAND_TEST_SEMANTICS, COMMAND_QUALITY_SEMANTICS].map(async (semantics) => ({ ...(await commandDriver(semantics)) })));
}

async function issueCommandEvidence({
  supervisorRoot,
  receiptRoot,
  snapshot,
  config,
  receiptId,
  runId,
  criterion,
  commitSha = null,
  now = () => new Date()
}, semantics, expectedKind, observationSummary, outcomeSummary) {
  if (!snapshot?.repository?.identity || !snapshot?.repository?.git?.head_sha) {
    throw new Error("A live repository snapshot is required for evidence issuance.");
  }
  if (snapshot.repository.git.dirty) throw new Error("Evidence issuance requires a clean current repository revision.");
  if (!criterion?.id) throw new Error("A criterion with a stable id is required.");
  if (!runId) throw new Error("A run id is required.");

  const receipts = await listValidReceipts(receiptRoot, snapshot.repository.identity);
  const receipt = receipts.find((candidate) => candidate.id === receiptId);
  if (!receipt) throw new Error(`No intact verification receipt exists for ${receiptId}.`);
  const acceptedKinds = Array.isArray(expectedKind) ? expectedKind : [expectedKind];
  if (!acceptedKinds.includes(receipt.command.kind)) {
    throw new Error(`The ${semantics.id} driver accepts only ${acceptedKinds.join("|")} receipts.`);
  }
  const evidenceCommitSha = commitSha ?? receipt.commit_sha ?? snapshot.repository.git.head_sha;
  if (!receiptMatchesCurrentConfig(snapshot, config, receipt, { commitSha: evidenceCommitSha })) {
    throw new Error("The verification receipt is not a passing proof for the current revision and configuration.");
  }

  const driver = await commandDriver(semantics);
  const identity = await loadSupervisorIdentity(supervisorRoot);
  const criterionHash = hashContract(criterion);
  const receiptHash = hashContract(receipt);
  const recipeHash = hashContract({
    driver,
    repository_identity: snapshot.repository.identity,
    commit_sha: evidenceCommitSha,
    criterion: { id: criterion.id, sha256: criterionHash },
    command: { id: receipt.command.id, kind: receipt.command.kind, sha256: receipt.command.sha256 },
    harness: receipt.harness,
    receipt: { id: receipt.id, sha256: receiptHash }
  });
  const issuedAt = now().toISOString();
  const seed = hashContract({ runId, criterionHash, receiptHash, driver });
  const capturedArtifacts = await Promise.all(receipt.artifacts.map((artifact) => storeEvidenceBlob(supervisorRoot, artifact)));
  const evidenceRecord = {
    schema_version: 1,
    id: `evidence-${seed.slice(0, 32)}`,
    run_id: runId,
    criterion_ids: [criterion.id],
    type: "test-result",
    producer: { id: `${driver.id}-v${driver.version}`, kind: "tool" },
    captured_at: issuedAt,
    subject: {
      repository_identity: snapshot.repository.identity,
      commit_sha: evidenceCommitSha
    },
    observation: {
      result: "pass",
      summary: observationSummary
    },
    artifacts: capturedArtifacts
  };
  const payload = {
    schema_version: 1,
    id: `manifest-${seed.slice(0, 32)}`,
    repository_identity: snapshot.repository.identity,
    commit_sha: evidenceCommitSha,
    run_id: runId,
    criterion: { id: criterion.id, sha256: criterionHash },
    command: { id: receipt.command.id, kind: receipt.command.kind, sha256: receipt.command.sha256 },
    harness: {
      config_sha256: receipt.harness.config_sha256,
      verification_sha256: receipt.harness.verification_sha256
    },
    driver,
    recipe_sha256: recipeHash,
    receipt: { id: receipt.id, sha256: receiptHash },
    issued_at: issuedAt,
    outcome: { status: "pass", summary: outcomeSummary },
    evidence_records: [evidenceRecord],
    issuer: { id: identity.id, fingerprint: identity.fingerprint }
  };

  const existing = (await listVerifiedEvidenceManifests(supervisorRoot, snapshot.repository.identity))
    .find((manifest) => manifest.id === payload.id);
  if (existing) return { manifest: existing, written: false };
  const manifest = await attestEvidenceManifest(supervisorRoot, payload);
  await writeEvidenceManifest(supervisorRoot, snapshot.repository.identity, manifest);
  return { manifest, written: true };
}

export async function issueCommandTestEvidence(options) {
  return issueCommandEvidence(
    options,
    COMMAND_TEST_SEMANTICS,
    "test",
    "The sealed command-test driver verified an intact current-revision test receipt.",
    "Current automated tests passed under the sealed command-test driver."
  );
}


export async function issueCommandQualityEvidence(options) {
  return issueCommandEvidence(
    options,
    COMMAND_QUALITY_SEMANTICS,
    ["lint", "build"],
    "The sealed command-quality driver verified an intact current-revision lint or build receipt.",
    "Current lint/build quality command passed under the sealed command-quality driver."
  );
}

export async function issueCommandSystemEvidence(options) {
  return issueCommandEvidence(
    options,
    COMMAND_SYSTEM_SEMANTICS,
    "verify",
    "The sealed command-system driver verified an intact current-revision system command receipt. No direct browser, network, API, database, or filesystem observation is claimed.",
    "The current system verification command passed under the sealed command-system driver at E2 only."
  );
}

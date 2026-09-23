import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes
} from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { assertContract } from "../../project/src/contracts.mjs";
import {
  evaluateApprovalReceiptBinding,
  evaluateApprovalReceiptSet,
  evaluateApprovalRequestBinding,
  evaluateApprovalRequestSet
} from "../../core/src/approval-policy.mjs";
import { repositoryStorageKey } from "./data-store.mjs";
import {
  publicKeyFingerprint,
  signSupervisorArtifact,
  verifySupervisorArtifact
} from "./supervisor-crypto.mjs";

const IDENTITY_FILE = "identity.json";
const PRIVATE_KEY_FILE = path.join("private", "supervisor-key.pk8");
const IDENTIFIER = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;

async function regularFile(file) {
  try {
    const info = await lstat(file);
    return info.isFile() && !info.isSymbolicLink();
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function safeDirectoryTree(root, target, { create = false } = {}) {
  const stateRoot = path.resolve(root);
  const directory = path.resolve(target);
  const relative = path.relative(stateRoot, directory);
  if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Supervisor state path escapes its root.");
  const segments = relative ? relative.split(path.sep) : [];
  let current = stateRoot;
  for (let index = -1; index < segments.length; index += 1) {
    if (index >= 0) current = path.join(current, segments[index]);
    try {
      const info = await lstat(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error(`Unsafe Supervisor state directory: ${current}`);
    } catch (error) {
      if (error.code !== "ENOENT" || !create) throw error;
      try {
        await mkdir(current, { mode: 0o700 });
      } catch (mkdirError) {
        if (mkdirError.code !== "EEXIST") throw mkdirError;
      }
      const created = await lstat(current);
      if (!created.isDirectory() || created.isSymbolicLink()) throw new Error(`Unsafe Supervisor state directory: ${current}`);
    }
  }
  return directory;
}

function identityPath(root) {
  return path.join(path.resolve(root), IDENTITY_FILE);
}

function privateKeyPath(root) {
  return path.join(path.resolve(root), PRIVATE_KEY_FILE);
}

function assertIdentifier(value, label) {
  if (!IDENTIFIER.test(value)) throw new Error(`${label} is not a safe identifier.`);
}

export function evidenceManifestPath(root, repositoryIdentity, manifestId) {
  assertIdentifier(manifestId, "Evidence manifest id");
  return path.join(path.resolve(root), "projects", repositoryStorageKey(repositoryIdentity), "evidence-manifests", `${manifestId}.json`);
}

export function approvalRequestPath(root, repositoryIdentity, requestId) {
  assertIdentifier(requestId, "Approval request id");
  return path.join(path.resolve(root), "projects", repositoryStorageKey(repositoryIdentity), "approval-requests", `${requestId}.json`);
}

export function approvalReceiptPath(root, repositoryIdentity, receiptId) {
  assertIdentifier(receiptId, "Approval receipt id");
  return path.join(path.resolve(root), "projects", repositoryStorageKey(repositoryIdentity), "approval-receipts", `${receiptId}.json`);
}

export function evidenceBlobPath(root, sha256) {
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error("Evidence blob hash is invalid.");
  return path.join(path.resolve(root), "blobs", "sha256", sha256.slice(0, 2), sha256);
}

export function isolationProofPath(root, proofId) {
  assertIdentifier(proofId, "Isolation proof id");
  return path.join(path.resolve(root), "isolation-proofs", `${proofId}.json`);
}

export async function storeEvidenceBlob(root, artifact) {
  if (!artifact.uri.startsWith("file://")) throw new Error("Evidence blobs can be imported only from local execution artifacts.");
  const source = fileURLToPath(artifact.uri);
  if (!(await regularFile(source))) throw new Error("Evidence artifact is missing or unsafe.");
  const bytes = await readFile(source);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== artifact.sha256 || bytes.length !== artifact.size_bytes) throw new Error("Evidence artifact changed before Supervisor capture.");
  const target = evidenceBlobPath(root, digest);
  await safeDirectoryTree(root, path.dirname(target), { create: true });
  try {
    await writeFile(target, bytes, { mode: 0o600, flag: "wx" });
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await regularFile(target))) throw new Error("Evidence blob path is unsafe.");
    const existing = await readFile(target);
    if (createHash("sha256").update(existing).digest("hex") !== digest) throw new Error("Existing evidence blob is corrupt.");
  }
  return { uri: `devharness-blob:sha256:${digest}`, media_type: artifact.media_type, sha256: digest, size_bytes: bytes.length };
}

async function manifestArtifactsAreIntact(root, manifest) {
  for (const record of manifest.evidence_records) {
    for (const artifact of record.artifacts) {
      const prefix = "devharness-blob:sha256:";
      if (!artifact.uri.startsWith(prefix) || artifact.uri.slice(prefix.length) !== artifact.sha256) return false;
      const target = evidenceBlobPath(root, artifact.sha256);
      if (!(await regularFile(target))) return false;
      const bytes = await readFile(target);
      if (bytes.length !== artifact.size_bytes || createHash("sha256").update(bytes).digest("hex") !== artifact.sha256) return false;
    }
  }
  return true;
}

async function readPrivateKey(root) {
  const target = privateKeyPath(root);
  if (!(await regularFile(target))) throw new Error("Supervisor private key is missing or unsafe.");
  return createPrivateKey({ key: await readFile(target), type: "pkcs8", format: "der" });
}

export async function loadSupervisorIdentity(root) {
  const target = identityPath(root);
  if (!(await regularFile(target))) throw new Error("Supervisor identity is missing or unsafe.");
  let identity;
  try {
    identity = JSON.parse(await readFile(target, "utf8"));
  } catch {
    throw new Error("Supervisor identity is corrupt or truncated.");
  }
  await assertContract("supervisor-identity", identity);
  if (publicKeyFingerprint(identity.public_key.value) !== identity.fingerprint) {
    throw new Error("Supervisor identity fingerprint does not match its public key.");
  }
  return identity;
}

export async function initializeSupervisorIdentity(root, { now = () => new Date() } = {}) {
  const stateRoot = path.resolve(root);
  await safeDirectoryTree(stateRoot, path.join(stateRoot, "private"), { create: true });
  const publicPath = identityPath(stateRoot);
  const secretPath = privateKeyPath(stateRoot);
  const hasIdentity = await regularFile(publicPath);
  const hasKey = await regularFile(secretPath);

  if (hasIdentity !== hasKey) throw new Error("Supervisor identity is incomplete or conflicts with existing state.");
  if (hasIdentity) {
    const identity = await loadSupervisorIdentity(stateRoot);
    const privateKey = await readPrivateKey(stateRoot);
    if (publicKeyFingerprint(createPublicKey(privateKey)) !== identity.fingerprint) {
      throw new Error("Supervisor private key conflicts with the pinned public identity.");
    }
    return { identity, created: false };
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const fingerprint = publicKeyFingerprint(publicPem);
  const identity = {
    schema_version: 1,
    id: `supervisor-${fingerprint.slice(0, 16)}`,
    algorithm: "Ed25519",
    fingerprint,
    public_key: { format: "spki-pem", value: publicPem },
    created_at: now().toISOString()
  };
  await assertContract("supervisor-identity", identity);

  try {
    await writeFile(secretPath, privateKey.export({ type: "pkcs8", format: "der" }), { mode: 0o600, flag: "wx" });
    await writeFile(publicPath, `${JSON.stringify(identity, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  } catch (error) {
    throw new Error(`Supervisor identity initialization conflict: ${error.message}`);
  }
  return { identity, created: true };
}

export async function attestEvidenceManifest(root, payload) {
  const identity = await loadSupervisorIdentity(root);
  const privateKey = await readPrivateKey(root);
  const signed = signSupervisorArtifact("evidence-manifest", payload, privateKey, identity);
  await assertContract("evidence-manifest", signed);
  return signed;
}

export async function attestIsolationProof(root, payload) {
  const identity = await loadSupervisorIdentity(root);
  const privateKey = await readPrivateKey(root);
  const signed = signSupervisorArtifact("isolation-proof", payload, privateKey, identity);
  await assertContract("isolation-proof", signed);
  return signed;
}

async function attestArtifact(root, kind, contract, payload) {
  const identity = await loadSupervisorIdentity(root);
  const privateKey = await readPrivateKey(root);
  const signed = signSupervisorArtifact(kind, payload, privateKey, identity);
  await assertContract(contract, signed);
  return signed;
}

export async function attestApprovalRequest(root, payload) {
  return attestArtifact(root, "approval-request", "approval-request", payload);
}

export async function attestApprovalReceipt(root, payload) {
  return attestArtifact(root, "approval-receipt", "approval-receipt", payload);
}

export async function writeEvidenceManifest(root, repositoryIdentity, manifest) {
  if (manifest.repository_identity !== repositoryIdentity) throw new Error("Evidence repository binding does not match the storage namespace.");
  await assertContract("evidence-manifest", manifest);
  const identity = await loadSupervisorIdentity(root);
  if (!verifySupervisorArtifact("evidence-manifest", manifest, identity)) throw new Error("Evidence manifest signature or attestation is invalid.");
  const target = evidenceManifestPath(root, repositoryIdentity, manifest.id);
  await safeDirectoryTree(root, path.dirname(target), { create: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { path: target, written: true };
}

export async function listVerifiedEvidenceManifests(root, repositoryIdentity) {
  let identity;
  try {
    identity = await loadSupervisorIdentity(root);
  } catch {
    return [];
  }
  const directory = path.dirname(evidenceManifestPath(root, repositoryIdentity, "manifest-placeholder"));
  let names;
  try {
    await safeDirectoryTree(root, directory);
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const manifests = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".json")).sort()) {
    const target = path.join(directory, name);
    try {
      if (!(await regularFile(target))) continue;
      const manifest = JSON.parse(await readFile(target, "utf8"));
      await assertContract("evidence-manifest", manifest);
      if (manifest.repository_identity !== repositoryIdentity) continue;
      if (verifySupervisorArtifact("evidence-manifest", manifest, identity) && await manifestArtifactsAreIntact(root, manifest)) manifests.push(manifest);
    } catch {
      // Supervisor state is fail-closed: malformed, truncated, forged and unsafe files are ignored.
    }
  }
  return manifests;
}

async function listSignedArtifacts(root, repositoryIdentity, directoryName, contract, kind) {
  let identity;
  try {
    identity = await loadSupervisorIdentity(root);
  } catch {
    return { identity: null, artifacts: [] };
  }
  const directory = path.join(path.resolve(root), "projects", repositoryStorageKey(repositoryIdentity), directoryName);
  let names;
  try {
    await safeDirectoryTree(root, directory);
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return { identity, artifacts: [] };
    throw error;
  }
  const artifacts = [];
  for (const name of names.filter((candidate) => candidate.endsWith(".json")).sort()) {
    const target = path.join(directory, name);
    try {
      if (!(await regularFile(target))) continue;
      const artifact = JSON.parse(await readFile(target, "utf8"));
      await assertContract(contract, artifact);
      if (artifact.repository_identity !== repositoryIdentity) continue;
      if (verifySupervisorArtifact(kind, artifact, identity)) artifacts.push(artifact);
    } catch {
      // Malformed, truncated, forged and symlinked Supervisor artifacts never become trusted.
    }
  }
  return { identity, artifacts };
}

export async function listVerifiedApprovalRequests(root, repositoryIdentity, { now = new Date(), includeExpired = false } = {}) {
  const { identity, artifacts } = await listSignedArtifacts(root, repositoryIdentity, "approval-requests", "approval-request", "approval-request");
  if (!identity || !evaluateApprovalRequestSet(artifacts).valid) return [];
  const issuer = { id: identity.id, fingerprint: identity.fingerprint };
  return artifacts.filter((request) => {
    const evaluationNow = includeExpired ? new Date(request.requested_at) : now;
    return evaluateApprovalRequestBinding(request, {
      now: evaluationNow,
      repositoryIdentity,
      relevantHeadSha: request.relevant_head_sha,
      issuer
    }).valid;
  });
}

export async function listVerifiedApprovalReceipts(root, repositoryIdentity, { now = new Date(), includeExpired = false } = {}) {
  const { identity, artifacts: receipts } = await listSignedArtifacts(root, repositoryIdentity, "approval-receipts", "approval-receipt", "approval-receipt");
  if (!identity || !evaluateApprovalReceiptSet(receipts).valid) return [];
  const requests = await listVerifiedApprovalRequests(root, repositoryIdentity, { now, includeExpired: true });
  const requestsById = new Map(requests.map((request) => [request.id, request]));
  const issuer = { id: identity.id, fingerprint: identity.fingerprint };
  return receipts.filter((receipt) => {
    const request = requestsById.get(receipt.request_id);
    const evaluationNow = includeExpired ? new Date(receipt.decided_at) : now;
    return request && evaluateApprovalReceiptBinding(receipt, request, { now: evaluationNow, issuer }).valid;
  });
}

export async function writeApprovalRequest(root, repositoryIdentity, request) {
  if (request.repository_identity !== repositoryIdentity) throw new Error("Approval request repository binding does not match its storage namespace.");
  await assertContract("approval-request", request);
  const identity = await loadSupervisorIdentity(root);
  if (!verifySupervisorArtifact("approval-request", request, identity)) throw new Error("Approval request signature or attestation is invalid.");
  const target = approvalRequestPath(root, repositoryIdentity, request.id);
  await safeDirectoryTree(root, path.dirname(target), { create: true });
  await writeFile(target, `${JSON.stringify(request, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { path: target, written: true };
}

export async function writeApprovalReceipt(root, repositoryIdentity, receipt) {
  if (receipt.repository_identity !== repositoryIdentity) throw new Error("Approval receipt repository binding does not match its storage namespace.");
  await assertContract("approval-receipt", receipt);
  const identity = await loadSupervisorIdentity(root);
  if (!verifySupervisorArtifact("approval-receipt", receipt, identity)) throw new Error("Approval receipt signature or attestation is invalid.");
  const requests = await listVerifiedApprovalRequests(root, repositoryIdentity, { now: new Date(receipt.decided_at), includeExpired: true });
  const request = requests.find((candidate) => candidate.id === receipt.request_id);
  if (!request) throw new Error("Approval receipt has no verified request.");
  const issuer = { id: identity.id, fingerprint: identity.fingerprint };
  const binding = evaluateApprovalReceiptBinding(receipt, request, { now: new Date(receipt.decided_at), issuer });
  if (!binding.valid) throw new Error(`Approval receipt binding is invalid: ${binding.reasons.map((item) => item.code).join(", ")}`);
  const existing = await listVerifiedApprovalReceipts(root, repositoryIdentity, { now: new Date(receipt.decided_at) });
  if (existing.some((candidate) => candidate.request_id === receipt.request_id)) {
    throw new Error(`Approval request ${receipt.request_id} already has an immutable decision.`);
  }
  const target = approvalReceiptPath(root, repositoryIdentity, receipt.id);
  await safeDirectoryTree(root, path.dirname(target), { create: true });
  await writeFile(target, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  return { path: target, written: true };
}

export async function writeIsolationProof(root, proof) {
  await assertContract("isolation-proof", proof);
  const identity = await loadSupervisorIdentity(root);
  if (!verifySupervisorArtifact("isolation-proof", proof, identity)) {
    throw new Error("Isolation proof signature or attestation is invalid.");
  }
  if (proof.supervisor.fingerprint !== identity.fingerprint || proof.supervisor.id !== identity.id) {
    throw new Error("Isolation proof supervisor binding does not match the pinned identity.");
  }
  const target = isolationProofPath(root, proof.id);
  await safeDirectoryTree(root, path.dirname(target), { create: true });
  try {
    await writeFile(target, `${JSON.stringify(proof, null, 2)}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    return { path: target, written: true };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    const existing = JSON.parse(await readFile(target, "utf8"));
    if (JSON.stringify(existing) === JSON.stringify(proof)) return { path: target, written: false };
    throw new Error(`A different isolation proof already exists at ${target}`);
  }
}

export async function listVerifiedIsolationProofs(root, { now = new Date(), includeExpired = false } = {}) {
  let identity;
  try {
    identity = await loadSupervisorIdentity(root);
  } catch {
    return [];
  }
  const directory = path.dirname(isolationProofPath(root, "isolation-proof-placeholder"));
  let names;
  try {
    await safeDirectoryTree(root, directory);
    names = await readdir(directory);
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const proofs = [];
  const current = now instanceof Date ? now.getTime() : Date.parse(now);
  for (const name of names.filter((candidate) => candidate.endsWith(".json")).sort()) {
    const target = path.join(directory, name);
    try {
      if (!(await regularFile(target))) continue;
      const proof = JSON.parse(await readFile(target, "utf8"));
      await assertContract("isolation-proof", proof);
      if (!verifySupervisorArtifact("isolation-proof", proof, identity)) continue;
      if (proof.supervisor.fingerprint !== identity.fingerprint || proof.supervisor.id !== identity.id) continue;
      if (!includeExpired && Date.parse(proof.expires_at) < current) continue;
      if (proof.outcome?.status !== "pass") continue;
      proofs.push(proof);
    } catch {
      // Fail closed: malformed, forged, expired or unsafe proofs never become trusted.
    }
  }
  return proofs;
}

export function randomSupervisorNonce() {
  return randomBytes(24).toString("hex");
}

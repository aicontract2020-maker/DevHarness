import { createHash } from "node:crypto";

import { defaultSupervisorRoot } from "../../runtime/src/data-store.mjs";
import { listVerifiedApprovalReceipts, listVerifiedEvidenceManifests, listVerifiedIsolationProofs, loadSupervisorIdentity } from "../../runtime/src/supervisor-store.mjs";

const trustedContexts = new WeakSet();

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function artifactHash(value, omittedKeys = []) {
  const body = structuredClone(value);
  for (const key of omittedKeys) delete body[key];
  return sha256(JSON.stringify(canonical(body)));
}

export function strategyArtifactHash(strategy) {
  return artifactHash(strategy, ["artifact_sha256", "approved_by", "approved_at", "status"]);
}

export function capabilityArtifactHash(request) {
  return artifactHash(request, ["decision", "decided_by", "decided_at"]);
}

function derivedInventory(snapshot, goalImpact = {}) {
  const platforms = new Set(snapshot.detected.platforms ?? []);
  const services = (snapshot.detected.services ?? []).map((service) => service.toLowerCase());
  const frameworks = (snapshot.detected.frameworks ?? []).map((framework) => framework.toLowerCase());
  const environmentKeys = new Set([...(snapshot.environment?.declared_keys ?? []), ...(snapshot.environment?.locally_set_keys ?? [])]);
  const databaseRequired = services.some((service) => ["postgresql", "mysql", "sqlite", "mongodb", "redis"].some((name) => service.includes(name))) || frameworks.some((framework) => ["prisma", "typeorm", "sequelize", "drizzle", "sqlalchemy", "django"].some((name) => framework.includes(name))) || [...environmentKeys].some((key) => /(^|_)(DATABASE|DB|POSTGRES|MYSQL|MONGO|REDIS)(_|$)/.test(key)) || goalImpact.database === true;
  const runtimeRequired = [...platforms].some((platform) => ["web", "api", "cli", "desktop", "mobile"].includes(platform));
  const securityRequired = runtimeRequired || databaseRequired || goalImpact.security === true;
  const requiredDomains = new Set(["repository", "testing", "strategy"]);
  const requiredComponentKinds = new Set();
  if (runtimeRequired) requiredDomains.add("runtime");
  if (platforms.has("web")) { requiredDomains.add("frontend"); requiredComponentKinds.add("frontend"); }
  if (platforms.has("api") || (platforms.has("web") && databaseRequired)) { requiredDomains.add("backend"); requiredComponentKinds.add("backend"); }
  if (databaseRequired) { requiredDomains.add("database"); requiredComponentKinds.add("database"); }
  if (securityRequired) requiredDomains.add("security");
  if ((snapshot.detected.deployment_files ?? []).length > 0 || goalImpact.deployment === true) requiredDomains.add("deployment");
  if (goalImpact.automation === true) requiredDomains.add("automation");
  return {
    repositoryIdentity: snapshot.repository.identity,
    currentHeadSha: snapshot.repository.git.head_sha,
    expectedDomains: [...requiredDomains].sort(),
    requiredComponentKinds: [...requiredComponentKinds].sort(),
    databaseRequired,
    securityRequired,
    dirty: snapshot.repository.git.dirty === true
  };
}

export function expectedDomainsFromSnapshot(snapshot, goalImpact = {}) {
  return derivedInventory(snapshot, goalImpact).expectedDomains;
}

export function inventoryFromSnapshot(snapshot, goalImpact = {}) {
  return derivedInventory(snapshot, goalImpact);
}

export async function loadTrustedEvaluationContext({ snapshot, goalImpact = {} }) {
  if (!snapshot?.repository?.identity || !snapshot?.repository?.git?.head_sha) throw new Error("A live repository snapshot with identity and head is required.");
  const supervisorRoot = defaultSupervisorRoot();
  const manifests = (await listVerifiedEvidenceManifests(supervisorRoot, snapshot.repository.identity))
    .filter((manifest) => manifest.commit_sha === snapshot.repository.git.head_sha);
  const approvals = (await listVerifiedApprovalReceipts(supervisorRoot, snapshot.repository.identity))
    .filter((receipt) => receipt.relevant_head_sha === snapshot.repository.git.head_sha);
  // Isolation proofs are host-scoped (Supervisor boundary), not revision-bound to the consumer tip.
  const isolationProofs = await listVerifiedIsolationProofs(supervisorRoot);
  let supervisorIdentity = null;
  try {
    supervisorIdentity = await loadSupervisorIdentity(supervisorRoot);
  } catch {
    supervisorIdentity = null;
  }
  const context = deepFreeze({
    inventory: derivedInventory(snapshot, goalImpact),
    manifests,
    evidence: manifests.flatMap((manifest) => manifest.evidence_records),
    approvals,
    isolationProofs,
    supervisorIdentity,
    supervisor: manifests.length > 0 || approvals.length > 0 || isolationProofs.length > 0
      ? {
          issuer_id: manifests[0]?.issuer.id ?? approvals[0]?.attestation.issuer_id ?? isolationProofs[0]?.issuer.id,
          issuer_fingerprint: manifests[0]?.issuer.fingerprint ?? approvals[0]?.attestation.issuer_fingerprint ?? isolationProofs[0]?.issuer.fingerprint
        }
      : null
  });
  trustedContexts.add(context);
  return context;
}

export function isTrustedEvaluationContext(context) {
  return Boolean(context && trustedContexts.has(context));
}

export function findTrustedApproval(context, {
  gate,
  repositoryIdentity,
  relevantHeadSha,
  runId,
  subject,
  now = new Date()
}) {
  if (!isTrustedEvaluationContext(context)) return null;
  const currentTime = now instanceof Date ? now.getTime() : Date.parse(now);
  return context.approvals.find((receipt) =>
    receipt.gate === gate &&
    receipt.decision === "approved" &&
    receipt.repository_identity === repositoryIdentity &&
    receipt.relevant_head_sha === relevantHeadSha &&
    receipt.run_id === runId &&
    receipt.subject?.id === subject?.id &&
    receipt.subject?.artifact_sha256 === subject?.artifact_sha256 &&
    Date.parse(receipt.expires_at) >= currentTime
  ) ?? null;
}

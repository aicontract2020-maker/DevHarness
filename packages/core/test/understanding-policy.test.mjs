import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

import { loadTrustedEvaluationContext, strategyArtifactHash } from "../src/trusted-context.mjs";
import { evaluateUnderstandingBaseline } from "../src/understanding-policy.mjs";

const sha = "a".repeat(40);
const repositoryIdentity = "example/project";
const domains = ["backend", "database", "repository", "runtime", "security", "strategy", "testing"];

function hash(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fixtures(t, { head = sha, dirty = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-trust-"));
  const evidenceRoot = path.join(root, "evidence");
  const approvalRoot = path.join(root, "approvals");
  await mkdir(evidenceRoot);
  await mkdir(approvalRoot);
  t.after(() => rm(root, { recursive: true, force: true }));

  const record = async (id, type) => {
    const bytes = Buffer.from(`${id}\n`);
    const target = path.join(evidenceRoot, `${id}.json`);
    await writeFile(target, bytes);
    return {
      id,
      type,
      producer: { id: "verification-driver", kind: "tool" },
      subject: { repository_identity: repositoryIdentity, commit_sha: sha },
      observation: { result: "pass" },
      artifacts: [{ uri: pathToFileURL(target).href, media_type: "application/json", sha256: hash(bytes), size_bytes: bytes.length }]
    };
  };
  const evidence = await Promise.all([
    record("repo-proof", "filesystem-state"),
    record("runtime-proof", "network"),
    record("backend-proof", "network"),
    record("db-proof", "database-state"),
    record("security-proof", "test-result"),
    record("strategy-proof", "review-report"),
    record("testing-proof", "test-result")
  ]);
  const systemModel = {
    id: "system-1",
    repository_identity: repositoryIdentity,
    commit_sha: sha,
    verdict: "complete",
    components: [{ id: "api", kind: "backend" }, { id: "db-component", kind: "database" }],
    stores: [{ id: "db", disposable_test_available: true }],
    entities: [{ id: "user", store_id: "db", owner_component_id: "api", classifications: ["personal"] }],
    trust_boundaries: [{ id: "api-db", from_component_id: "api", to_component_id: "db-component" }],
    roles: [{ id: "member" }],
    flows: [{ id: "flow", steps: [{ sequence: 1, component_id: "api", reads: ["user"], writes: ["user"], calls: ["db"], evidence_refs: ["db-proof"] }] }],
    invariants: [{ id: "authorized", entity_ids: ["user"], test_refs: ["security-proof"] }],
    risks: [],
    unknowns: []
  };
  const strategy = {
    id: "strategy-1",
    repository_identity: repositoryIdentity,
    commit_sha: sha,
    strategy_version: 1,
    status: "approved",
    decisions: [{ id: "modules" }],
    exceptions: []
  };
  strategy.artifact_sha256 = strategyArtifactHash(strategy);
  const approval = {
    schema_version: 1,
    id: "approve-strategy-1",
    repository_identity: repositoryIdentity,
    commit_sha: sha,
    gate: "strategy",
    subject: { id: strategy.id, artifact_sha256: strategy.artifact_sha256 },
    decision: "approved",
    decided_at: "2026-08-29T12:00:00Z",
    decided_by: { id: "developer", kind: "human" },
    source: "interactive-human-gate"
  };
  const approvalPath = path.join(approvalRoot, "strategy.json");
  await writeFile(approvalPath, JSON.stringify(approval));
  const snapshot = {
    repository: { identity: repositoryIdentity, git: { head_sha: head, dirty } },
    detected: { platforms: ["api"], services: ["PostgreSQL"], deployment_files: [] }
  };
  const trustContext = await loadTrustedEvaluationContext({ snapshot, evidence, evidenceArtifactRoot: evidenceRoot, approvalPaths: [approvalPath], approvalRoot });
  return { trustContext, systemModels: [systemModel], strategies: [strategy], snapshot, evidenceRoot, approvalRoot, approvalPath };
}

function baseline() {
  return {
    repository_identity: repositoryIdentity,
    commit_sha: sha,
    verdict: "ready",
    required_domains: domains,
    claims: [
      { id: "repo", domain: "repository", status: "code-confirmed", severity: "info", evidence_refs: ["repo-proof"] },
      { id: "runtime", domain: "runtime", status: "runtime-observed", severity: "info", evidence_refs: ["runtime-proof"] },
      { id: "backend", domain: "backend", status: "runtime-observed", severity: "info", evidence_refs: ["backend-proof"] },
      { id: "db", domain: "database", status: "runtime-observed", severity: "info", evidence_refs: ["db-proof"] },
      { id: "security", domain: "security", status: "test-confirmed", severity: "info", evidence_refs: ["security-proof"] },
      { id: "strategy", domain: "strategy", status: "code-confirmed", severity: "info", evidence_refs: ["strategy-proof"] },
      { id: "testing", domain: "testing", status: "test-confirmed", severity: "info", evidence_refs: ["testing-proof"] }
    ],
    conflicts: [],
    models: { system_model_id: "system-1", database_covered: true, security_covered: true, feature_flows_covered: true },
    strategy: { strategy_id: "strategy-1", version: 1, status: "approved", artifact_sha256: "placeholder" }
  };
}

function bindStrategy(candidate, context) {
  candidate.strategy.artifact_sha256 = context.strategies[0].artifact_sha256;
  return candidate;
}

test("understanding fails closed until supervisor evidence and approval issuers exist", async (t) => {
  const context = await fixtures(t);
  const unavailable = evaluateUnderstandingBaseline(bindStrategy(baseline(), context), context);
  assert.equal(unavailable.ready, false);
  assert.ok(unavailable.reasons.some((reason) => reason.code === "claim_evidence_invalid"));
  assert.ok(unavailable.reasons.some((reason) => reason.code === "strategy_strategy_human_approval_missing"));
  const fake = bindStrategy(baseline(), context);
  fake.claims[3].evidence_refs = ["fake"];
  assert.ok(evaluateUnderstandingBaseline(fake, context).reasons.some((reason) => reason.code === "claim_evidence_invalid"));
  assert.ok(evaluateUnderstandingBaseline(bindStrategy(baseline(), context), { ...context, trustContext: undefined }).reasons.some((reason) => reason.code === "trusted_understanding_context_missing"));

  const alteredStrategy = structuredClone(context.strategies[0]);
  alteredStrategy.decisions.push({ id: "silently-altered" });
  const tampered = evaluateUnderstandingBaseline(bindStrategy(baseline(), context), { ...context, strategies: [alteredStrategy] });
  assert.ok(tampered.reasons.some((reason) => reason.code === "strategy_artifact_missing"));
});

test("trusted context ignores agent-authored or nonexistent artifact evidence", async (t) => {
  const context = await fixtures(t);
  const forged = {
    id: "forged-proof",
    type: "database-state",
    producer: { id: "implementer", kind: "agent" },
    subject: { repository_identity: repositoryIdentity, commit_sha: sha },
    observation: { result: "pass" },
    artifacts: [{ uri: "file:///definitely/nonexistent/db-proof", media_type: "application/json", sha256: "b".repeat(64), size_bytes: 1 }]
  };
  const trustContext = await loadTrustedEvaluationContext({
    snapshot: context.snapshot,
    evidence: [forged],
    evidenceArtifactRoot: context.evidenceRoot,
    approvalPaths: [context.approvalPath],
    approvalRoot: context.approvalRoot
  });
  assert.deepEqual(trustContext.evidence, []);
});

test("understanding rejects weak domains, stale baselines and unresolved conflicts", async (t) => {
  const context = await fixtures(t);
  const weak = bindStrategy(baseline(), context);
  weak.claims[3] = { id: "db", domain: "database", status: "detected", severity: "blocking", evidence_refs: [] };
  assert.ok(evaluateUnderstandingBaseline(weak, context).reasons.some((reason) => reason.code === "live_domain_unproved"));
  const staleContext = await fixtures(t, { head: "c".repeat(40) });
  assert.ok(evaluateUnderstandingBaseline(bindStrategy(baseline(), staleContext), staleContext).reasons.some((reason) => reason.code === "baseline_stale"));
  const dirtyContext = await fixtures(t, { dirty: true });
  assert.ok(evaluateUnderstandingBaseline(bindStrategy(baseline(), dirtyContext), dirtyContext).reasons.some((reason) => reason.code === "dirty_workspace_unbound"));

  const conflicted = bindStrategy(baseline(), context);
  conflicted.claims.push({ id: "db-doc", domain: "database", status: "conflict", severity: "blocking", evidence_refs: [] });
  conflicted.conflicts.push({ id: "conflict-db", domain: "database", claim_ids: ["db", "db-doc"], severity: "blocking", status: "open" });
  const result = evaluateUnderstandingBaseline(conflicted, context);
  assert.ok(result.reasons.some((reason) => reason.code === "blocking_claim"));
  assert.ok(result.reasons.some((reason) => reason.code === "blocking_conflict"));
});

test("blocked verdict, caller-shrunk domains, unapproved strategy and incomplete models cannot pass", async (t) => {
  const context = await fixtures(t);
  const candidate = bindStrategy(baseline(), context);
  candidate.verdict = "blocked";
  candidate.required_domains = ["repository"];
  candidate.strategy.status = "proposed";
  const incomplete = structuredClone(context.systemModels[0]);
  incomplete.components = [{ id: "api", kind: "backend" }];
  incomplete.stores = [];
  incomplete.entities = [];
  incomplete.trust_boundaries = [];
  incomplete.roles = [];
  incomplete.flows = [{ id: "flow", steps: [{ sequence: 1, component_id: "api", reads: [], writes: [], calls: [], evidence_refs: [] }] }];
  incomplete.invariants = [];
  const result = evaluateUnderstandingBaseline(candidate, { ...context, systemModels: [incomplete] });
  for (const code of ["baseline_verdict_not_ready", "required_domains_mismatch", "database_model_missing", "security_model_missing", "feature_flow_missing", "strategy_not_approved"]) assert.ok(result.reasons.some((reason) => reason.code === code), code);

  const ghostRisk = structuredClone(context.systemModels[0]);
  ghostRisk.risks = [{ id: "dismissed", classification: "false-positive", evidence_refs: ["ghost-proof"] }];
  const ghostResult = evaluateUnderstandingBaseline(bindStrategy(baseline(), context), { ...context, systemModels: [ghostRisk] });
  assert.ok(ghostResult.reasons.some((reason) => reason.code === "system_false_positive_unproved"));

  const proposedStrategy = structuredClone(context.strategies[0]);
  proposedStrategy.status = "proposed";
  proposedStrategy.artifact_sha256 = strategyArtifactHash(proposedStrategy);
  const falseApproved = baseline();
  falseApproved.strategy.artifact_sha256 = proposedStrategy.artifact_sha256;
  const falseApprovedResult = evaluateUnderstandingBaseline(falseApproved, { ...context, strategies: [proposedStrategy] });
  assert.equal(falseApprovedResult.ready, false);
  assert.ok(falseApprovedResult.reasons.some((reason) => reason.code === "strategy_not_approved"));
});

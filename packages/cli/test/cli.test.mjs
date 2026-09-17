import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { formatVerificationExecutionResult, runCli } from "../src/cli.mjs";
import { canonicalDigest, canonicalRecordId } from "../../runtime/src/canonical-records.mjs";
import { appendAlignmentOperationJournal, loadAlignmentOperationJournal } from "../../runtime/src/alignment-operation-store.mjs";
import { buildLiveAlignmentAnalysisPlan, buildLiveAlignmentLease, buildLiveAlignmentOperation, buildLiveAlignmentStatus, cancelLiveAlignmentOperation, loadLiveAlignmentOperationBundle, publishValidatedAlignment, retryLiveAlignmentOperation, startLiveAlignmentOperation } from "../../runtime/src/live-alignment.mjs";
import { createRunEvent } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { appendGoalRunCheckpoint, loadGoalRun, loadRunSourceArtifact, runStoragePaths } from "../../runtime/src/goal-run-store.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";

function capture() {
  const lines = [];
  return { lines, io: { log: (value) => lines.push(String(value)) } };
}

const readyHash = "a".repeat(64);
const descriptor = {
  schema_version: 1,
  id: "codex",
  version: "1.0.0",
  protocol_version: 1,
  profile_id: "codex-readonly-analysis-v1",
  model_id: "gpt-approved",
  executable_version: "codex-1",
  modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
  features: {
    structured_output: true,
    explicit_cancel: true,
    ephemeral_session: true,
    read_only_tool_policy: true,
    built_in_web_disable: true,
    trusted_usage: true
  },
  implementation_sha256: readyHash,
  executable_sha256: readyHash,
  profile_template_sha256: readyHash,
  control_plane_origins: ["https://api.example.com"],
  descriptor_sha256: readyHash
};
const limits = {
  attempt_deadline_seconds: 600,
  max_active_execution_seconds: 3600,
  max_result_bytes: 1048576,
  max_stdout_bytes: 10485760,
  max_stderr_bytes: 10485760,
  max_retained_records: 20,
  max_retained_bytes: 20971520,
  max_temporary_bytes: 268435456,
  max_processes: 64,
  max_rss_bytes: 2147483648,
  cleanup_deadline_seconds: 30,
  max_research_queries: 5,
  max_sources_per_query: 5,
  max_research_requests: 25,
  max_redirects_per_request: 3,
  max_research_response_bytes: 2097152,
  max_research_bytes: 10485760,
  research_request_deadline_seconds: 30,
  max_agent_attempts: 6,
  max_provider_requests: 120,
  provider_request_deadline_seconds: 120,
  max_total_tokens: 600000
};

function artifact(id, kind, sha256 = readyHash) {
  return {
    id,
    kind,
    sha256,
    media_type: "application/json",
    size_bytes: 1,
    storage_key: `artifacts/${id}.json`
  };
}

function sourceRef(artifactRef, pointer) {
  return {
    artifact_id: artifactRef.id,
    artifact_sha256: artifactRef.sha256,
    location: { kind: "json", pointer }
  };
}

function question(index, dimensions) {
  return {
    id: `question-${index + 1}`,
    question: `Question ${index + 1}?`,
    options: [
      {
        id: `question-${index + 1}-clarify`,
        label: "Clarify now",
        outcome: "Pause and ask the developer to confirm the missing decision.",
        tradeoffs: ["Prevents a hidden assumption from hardening into the plan.", "Adds a short pause for explicit human guidance."],
        recommended: true
      },
      {
        id: `question-${index + 1}-infer`,
        label: "Infer conservatively",
        outcome: "Continue with the safest conservative assumption and keep the question open.",
        tradeoffs: ["Keeps momentum if the risk is low.", "Can leave an assumption that later needs correction."],
        recommended: false
      }
    ],
    material_dimensions: dimensions,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/questions/${index}`)]
  };
}

function finding(kind, id, summary, dimensions = ["acceptance-criterion"]) {
  return {
    id,
    kind,
    summary,
    material_dimensions: dimensions,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/${kind}s/${id}`)]
  };
}

function claim(id, area, proposedClass, text) {
  return {
    id,
    area,
    text,
    proposed_class: proposedClass,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/claims/${id}`)]
  };
}

function area(areaName, status) {
  return {
    id: `area-${areaName}`,
    area: areaName,
    proposed_status: status,
    summary: `${areaName} is ${status}.`,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/areas/${areaName}`)]
  };
}

function criterion(id, proofSurface, then) {
  return {
    id,
    given: "A clear goal exists.",
    when: "analysis completes.",
    then,
    proof_surface: proofSurface,
    source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), `/criteria/${id}`)]
  };
}

function onboardingPlan(repositoryIdentity, commitSha) {
  return {
    schema_version: 1,
    repository_identity: repositoryIdentity,
    commit_sha: commitSha,
    workspace: { dirty: false, changed_file_count: 0 },
    mode: "read-only-plan",
    verdict: "needs-evidence",
    summary: {
      total_claims: 1,
      proved_claims: 0,
      unresolved_claims: 1,
      conflict_claims: 0,
      claim_status_counts: { detected: 1, documented: 0, "code-confirmed": 0, conflict: 0, unverified: 0, "not-covered": 0 },
      coverage_status_counts: { applicable: 1, "not-applicable": 0, conflict: 0, gap: 0 },
      domain_knownness: {
        database: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} },
        frontend: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} },
        backend: { total_claims: 0, known_claims: 0, unknown_claims: 0, conflict_claims: 0, subdomains: {} }
      },
      priority_domains: ["frontend=detected"]
    },
    claims: [{ id: "repository-inventory", domain: "repository", status: "code-confirmed", summary: "Repository identity was inspected.", evidence_refs: ["package.json"] }],
    coverage: [{ domain: "repository", status: "applicable", claim_ids: ["repository-inventory"] }],
    capability_requests: [{ capability: "network-research", operation: "research", target: "topic", scope: ["repo"], reason: "Check current practices.", risk: "low", authority: "human-only", reversibility: "revocable-before-next-external-action", decision: "pending" }],
    blockers: [{ id: "blocker-1", summary: "Need a product decision.", source_refs: ["package.json"] }],
    preflight: {
      clarification_questions: [{ id: "clarify-1", blocker_id: "blocker-1", question: "What product decision do we need before implementation can proceed?", priority: 1, basis: ["plan-clarify", "goal-clarify", "blocker-1"] }],
      research_topics: [],
      research_tasks: [],
      team_decomposition: []
    },
    next_action: { label: "Review and approve", recommended: true }
  };
}

function goalAnalysis(operationId, questionCount = 0) {
  return {
    schema_version: 1,
    id: "goal-analysis-1",
    invocation_id: "analysis-invocation-1",
    operation_id: operationId,
    refined_outcome: { id: "outcome-1", text: "Deliver a trustworthy agent-ready development flow.", source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/outcome")] },
    affected_areas: [
      area("repository-bootstrap", "applicable"),
      area("frontend", "applicable"),
      area("backend", "applicable"),
      area("data", "applicable"),
      area("security", "applicable"),
      area("integration", "applicable"),
      area("testing", "applicable"),
      area("deployment", "applicable"),
      area("automation", "not-applicable")
    ],
    claims: [
      claim("claim-repository", "repository-bootstrap", "code-confirmed", "The repository structure is understood."),
      claim("claim-frontend", "frontend", "code-confirmed", "The frontend surface is understood."),
      claim("claim-backend", "backend", "code-confirmed", "The backend surface is understood."),
      claim("claim-data", "data", "code-confirmed", "The data model is understood."),
      claim("claim-security", "security", "code-confirmed", "The security model is understood."),
      claim("claim-testing", "testing", "code-confirmed", "The test model is understood.")
    ],
    assumptions: [finding("assumption", "assumption-1", "The repo remains on the current head.")],
    conflicts: [],
    boundaries: [
      { id: "boundary-1", text: "Do not edit the consumer repository.", source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/boundaries/0")] }
    ],
    non_goals: [
      { id: "non-goal-1", text: "Do not auto-merge or auto-deploy.", source_refs: [sourceRef(artifact("goal-analysis-1", "goal-analysis"), "/non_goals/0")] }
    ],
    questions: Array.from({ length: questionCount }, (_, index) =>
      question(index, [[
        "deployment-behavior",
        "security-privacy-credential",
        "data-schema-migration",
        "externally-observable-behavior"
      ][index] ?? "acceptance-criterion"])
    ),
    acceptance_criteria: [
      criterion("criterion-1", "browser", "The feature works in a browser."),
      criterion("criterion-2", "database", "The data flow is verified against a database."),
      criterion("criterion-3", "unit", "The module has focused unit tests.")
    ],
    untrusted_instructions: [],
    research_source_refs: [],
    research_gaps: []
  };
}

function validation(operationId, { questionChecks = [], verdict = "valid" } = {}) {
  const goalAnalysisRef = artifact("goal-analysis-1", "goal-analysis");
  return {
    schema_version: 1,
    id: "goal-analysis-validation-1",
    invocation_id: "validation-invocation-1",
    operation_id: operationId,
    producer_analysis_id: "goal-analysis-1",
    citation_checks: [
      { id: "citation-outcome", proposal_id: "claim-repository", source_ref: sourceRef(goalAnalysisRef, "/claims/0"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-frontend", proposal_id: "claim-frontend", source_ref: sourceRef(goalAnalysisRef, "/claims/1"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-backend", proposal_id: "claim-backend", source_ref: sourceRef(goalAnalysisRef, "/claims/2"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-data", proposal_id: "claim-data", source_ref: sourceRef(goalAnalysisRef, "/claims/3"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-security", proposal_id: "claim-security", source_ref: sourceRef(goalAnalysisRef, "/claims/4"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] },
      { id: "citation-testing", proposal_id: "claim-testing", source_ref: sourceRef(goalAnalysisRef, "/claims/5"), exists: true, supports: true, max_supported_class: "code-confirmed", finding_ids: [] }
    ],
    area_checks: [
      { id: "area-check-repository-bootstrap", area: "repository-bootstrap", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/repository-bootstrap")], finding_ids: [] },
      { id: "area-check-frontend", area: "frontend", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/frontend")], finding_ids: [] },
      { id: "area-check-backend", area: "backend", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/backend")], finding_ids: [] },
      { id: "area-check-data", area: "data", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/data")], finding_ids: [] },
      { id: "area-check-security", area: "security", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/security")], finding_ids: [] },
      { id: "area-check-integration", area: "integration", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/integration")], finding_ids: [] },
      { id: "area-check-testing", area: "testing", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/testing")], finding_ids: [] },
      { id: "area-check-deployment", area: "deployment", applicable: true, covered: true, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/deployment")], finding_ids: [] },
      { id: "area-check-automation", area: "automation", applicable: false, covered: false, conflict: false, source_refs: [sourceRef(goalAnalysisRef, "/areas/automation")], finding_ids: [] }
    ],
    question_checks: questionChecks,
    verdict,
    findings: [],
    untrusted_instructions: [],
    research_source_refs: [],
    research_gaps: []
  };
}

function readyBundleSeed({ operationId, runId, repositoryIdentity, commitSha, analysisPlanRef }) {
  const goalRef = artifact("goal-1", "goal");
  const goalAnalysisRef = artifact("goal-analysis-1", "goal-analysis");
  const validationRef = artifact("goal-analysis-validation-1", "analysis-validation");

  return {
    schema_version: 1,
    id: "alignment-bundle-1",
    operation_id: operationId,
    run_id: runId,
    repository_identity: repositoryIdentity,
    commit_sha: commitSha,
    goal_ref: goalRef,
    developer_answer_refs: [],
    agent_descriptor: {
      schema_version: 1,
      id: "codex",
      version: "1.0.0",
      protocol_version: 1,
      profile_id: "codex-readonly-analysis-v1",
      model_id: "gpt-approved",
      executable_version: "codex-1",
      modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
      features: {
        structured_output: true,
        explicit_cancel: true,
        ephemeral_session: true,
        read_only_tool_policy: true,
        built_in_web_disable: true,
        trusted_usage: true
      },
      implementation_sha256: readyHash,
      executable_sha256: readyHash,
      profile_template_sha256: readyHash,
      control_plane_origins: ["https://api.example.com"],
      descriptor_sha256: readyHash
    },
    analysis_plan_ref: analysisPlanRef,
    research_source_refs: [],
    research_gaps: [],
    goal_analysis_ref: goalAnalysisRef,
    validation_ref: validationRef
  };
}

async function trustedContext(repositoryIdentity, headSha) {
  return loadTrustedEvaluationContext({
    snapshot: {
      repository: {
        identity: repositoryIdentity,
        git: { head_sha: headSha, dirty: false }
      },
      detected: {
        platforms: ["web", "api"],
        services: ["PostgreSQL"],
        deployment_files: ["Dockerfile"],
        frameworks: ["Next.js"]
      }
    },
    goalImpact: {}
  });
}

function journalRecord(operationId, sequence, previousSha256, type, data, actor = "runtime", occurredAt = "2026-09-01T12:00:00.000Z") {
  const record = {
    schema_version: 1,
    id: "pending",
    operation_id: operationId,
    sequence,
    previous_sha256: previousSha256,
    type,
    occurred_at: occurredAt,
    data,
    actor
  };
  record.id = canonicalRecordId("operation-journal-record", record);
  return record;
}

async function seedFailedAttempt(root, repositoryIdentity, operation, phase = "analysis-plan") {
  const existing = await loadAlignmentOperationJournal(root, repositoryIdentity, operation.id);
  let sequence = existing.sequence;
  let previousSha256 = existing.head_sha256;
  if (existing.sequence === 0) {
    const created = journalRecord(operation.id, 1, null, "operation-created", { operation_sha256: hashContract(operation) });
    await appendAlignmentOperationJournal(root, repositoryIdentity, created, { expectedSequence: 0, expectedPreviousSha256: null });
    sequence = 1;
    previousSha256 = canonicalDigest("operation-journal-record", created);
  }
  const started = journalRecord(operation.id, sequence + 1, previousSha256, "phase-started", {
    phase,
    attempt_id: "attempt-1",
    attempt_no: 1,
    invocation_sha256: hashContract({ operation_id: operation.id, phase, attempt_no: 1 })
  });
  const finished = journalRecord(operation.id, sequence + 2, canonicalDigest("operation-journal-record", started), "phase-finished", {
    phase,
    attempt_id: "attempt-1",
    attempt_no: 1,
    attempt_sha256: hashContract({ operation_id: operation.id, phase, attempt_no: 1, status: "failed" }),
    status: "failed"
  });
  await appendAlignmentOperationJournal(root, repositoryIdentity, started, {
    expectedSequence: sequence,
    expectedPreviousSha256: previousSha256
  });
  await appendAlignmentOperationJournal(root, repositoryIdentity, finished, {
    expectedSequence: sequence + 1,
    expectedPreviousSha256: canonicalDigest("operation-journal-record", started)
  });
}

async function seedReadyBundle(dataRoot, run, repositoryIdentity) {
  const goalArtifact = artifact("goal-1", "goal");
  const snapshotArtifact = artifact("snapshot-1", "snapshot");
  const onboardingArtifact = artifact("onboarding-1", "onboarding");
  const onboarding = onboardingPlan(repositoryIdentity, run.current_head_sha);
  const operation = buildLiveAlignmentOperation({
    run,
    goalArtifact,
    snapshotArtifact,
    onboardingArtifact,
    agentDescriptor: descriptor,
    agentAuthoritySubject: { id: "subject-1", sha256: readyHash },
    resultContractSha256: readyHash,
    limits,
    inputCheckpointSha256: hashContract({ run_id: run.id, head_sha: run.current_head_sha })
  });
  const analysisPlan = buildLiveAlignmentAnalysisPlan({
    operation,
    goalArtifact,
    snapshotArtifact,
    onboardingArtifact,
    onboardingPlan: onboarding
  });
  const trustContext = await trustedContext(repositoryIdentity, run.current_head_sha);
  const result = await publishValidatedAlignment({
    dataRoot,
    repositoryIdentity,
    operation,
    analysisPlan: analysisPlan.analysisPlan,
    bundle: readyBundleSeed({
      operationId: operation.id,
      runId: run.id,
      repositoryIdentity,
      commitSha: run.current_head_sha,
      analysisPlanRef: {
        id: analysisPlan.analysisPlan.id,
        kind: "analysis-plan",
        sha256: hashContract(analysisPlan.analysisPlan),
        storage_key: "analysis-plan.json",
        media_type: "application/json",
        size_bytes: Buffer.byteLength(`${JSON.stringify(analysisPlan.analysisPlan, null, 2)}\n`)
      }
    }),
    goalAnalysis: goalAnalysis(operation.id, 0),
    validation: validation(operation.id, { verdict: "valid" }),
    trustContext,
    generatedAt: "2026-09-01T18:00:00.000Z"
  });
  return { operation, analysisPlan: analysisPlan.analysisPlan, bundle: result.bundle, resultBundleRef: result.result_bundle_ref };
}

test("failed verification remains reviewable when passing attestation was requested", () => {
  const receipt = {
    id: "verify-failed",
    outcome: { status: "fail", summary: "The command exited with code 1." }
  };
  const attestation = {
    status: "not-issued",
    reason: "execution-failed",
    summary: "the execution failed; failure receipts remain reviewable but cannot become passing evidence"
  };
  const text = formatVerificationExecutionResult({
    receipt,
    receiptPath: "/external/receipts/verify-failed.json",
    attestation
  });
  assert.match(text, /^FAIL:/);
  assert.match(text, /Receipt: \/external\/receipts\/verify-failed\.json/);
  assert.match(text, /Passing evidence: not issued \(the execution failed/);

  const json = JSON.parse(formatVerificationExecutionResult({
    receipt,
    receiptPath: "/external/receipts/verify-failed.json",
    attestation,
    format: "json"
  }));
  assert.equal(json.receipt.id, "verify-failed");
  assert.equal(json.evidence_manifest, null);
  assert.equal(json.attestation.reason, "execution-failed");
});

test("help documents init's explicit write boundary", async () => {
  const output = capture();
  assert.equal(await runCli(["--help"], output.io), 0);
  assert.match(output.lines.join("\n"), /Does not write unless --write is present/);
  assert.match(output.lines.join("\n"), /approve \(--request ID \[--request ID \.\.\.\] \| --run ID --pending\)/);
  assert.match(output.lines.join("\n"), /request-scope --run ID/);
  assert.match(output.lines.join("\n"), /retry --run ID --operation ID/);
  assert.match(output.lines.join("\n"), /cancel --run ID --operation ID/);
  assert.match(output.lines.join("\n"), /request-delivery/);
  assert.match(output.lines.join("\n"), /agent-propose/);
  assert.match(output.lines.join("\n"), /for-verify/);
});

test("help presents onboard as a read-only understanding plan", async () => {
  const output = capture();
  assert.equal(await runCli(["--help"], output.io), 0);
  assert.match(output.lines.join("\n"), /onboard/);
  assert.match(output.lines.join("\n"), /read-only/i);
});

test("onboard JSON does not modify an unconfigured consumer repository", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-onboard-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-onboard-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });
  const output = capture();
  assert.equal(await runCli(["onboard", "--repo", root, "--data-dir", dataRoot, "--format", "json"], output.io), 2);
  const parsed = JSON.parse(output.lines[0]);
  assert.equal(parsed.plan.mode, "read-only-plan");
  assert.equal(parsed.plan.verdict, "needs-evidence");
  assert.equal(parsed.plan.summary.total_claims, parsed.plan.claims.length);
  assert.ok(parsed.plan.summary.priority_domains.length > 0);
  assert.ok(parsed.plan.execution_graph.node_count >= 0);
  await assert.rejects(stat(parsed.path), { code: "ENOENT" });
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);

  const storedOutput = capture();
  assert.equal(await runCli(["onboard", "--repo", root, "--data-dir", dataRoot, "--write", "--format", "json"], storedOutput.io), 2);
  const stored = JSON.parse(storedOutput.lines[0]);
  assert.equal(stored.written, true);
  assert.equal((await stat(stored.path)).isFile(), true);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);
});

test("doctor JSON is machine-readable and returns not-ready for an unconfigured repo", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);

  const output = capture();
  const exitCode = await runCli(["doctor", "--repo", root, "--format", "json"], output.io);
  const parsed = JSON.parse(output.lines[0]);
  assert.equal(exitCode, 2);
  assert.equal(parsed.report.overall.verdict, "needs_work");
  assert.equal(parsed.snapshot.repository.git.is_repository, true);
});

test("build previews deterministically and writes only with explicit authority", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-build-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-build-data-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { build: "node -e \"process.exit(0)\"" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  assert.equal(await runCli(["init", "--repo", root, "--write"], capture().io), 0);
  execFileSync("git", ["-C", root, "add", "devharness.yaml"]);
  execFileSync("git", ["-C", root, "commit", "-m", "accept harness config"]);

  const preview = capture();
  assert.equal(await runCli(["build", "--repo", root, "--data-dir", dataRoot, "--format", "json"], preview.io), 0);
  const previewResult = JSON.parse(preview.lines[0]);
  assert.equal(previewResult.written, false);
  await assert.rejects(stat(previewResult.path), { code: "ENOENT" });

  const write = capture();
  assert.equal(await runCli(["build", "--repo", root, "--data-dir", dataRoot, "--write", "--format", "json"], write.io), 0);
  const writeResult = JSON.parse(write.lines[0]);
  assert.equal(writeResult.manifest.id, previewResult.manifest.id);
  assert.equal(writeResult.written, true);
  assert.equal((await stat(writeResult.path)).isFile(), true);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("explicit external config supports local build planning without changing the consumer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-external-repo-"));
  const configRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-external-config-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-external-data-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(configRoot, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true })
  ]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "external-fixture", scripts: { build: "node -e \"process.exit(0)\"" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const externalConfig = path.join(configRoot, "devharness.yaml");
  await writeFile(externalConfig, JSON.stringify({
    version: 1,
    project: { id: "external-fixture" },
    platforms: ["library"],
    quality: { commands: [{ id: "root-build", kind: "build", run: "npm run build", source: "package.json" }] },
    harness: { services: [], verifications: [] },
    autonomy: { required_gates: ["scope", "delivery"] },
    delivery: { provider: "manual", target: "pull-request" }
  }, null, 2));

  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });
  const output = capture();
  assert.equal(await runCli([
    "build", "--repo", root, "--config", externalConfig, "--data-dir", dataRoot, "--format", "json"
  ], output.io), 0);
  assert.equal(JSON.parse(output.lines[0]).manifest.commands[0].id, "root-build");
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);

  const doctor = capture();
  await runCli(["doctor", "--repo", root, "--config", externalConfig, "--data-dir", dataRoot, "--format", "json"], doctor.io);
  const projectConfigCapability = JSON.parse(doctor.lines[0]).report.capabilities.find((item) => item.id === "project-config");
  assert.equal(projectConfigCapability.status, "pass");
  assert.match(projectConfigCapability.summary, /explicit external/i);

  const insideConfig = path.join(root, "devharness.yaml");
  await writeFile(insideConfig, await readFile(externalConfig, "utf8"));
  await assert.rejects(
    runCli(["build", "--repo", root, "--config", insideConfig, "--data-dir", dataRoot], capture().io),
    /must point outside the consumer repository/
  );
});

test("approval refuses JSON and bypass flags", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-approval-repo-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "approval-fixture", scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  await assert.rejects(
    runCli(["approve", "--repo", root, "--request", "approval-request-placeholder", "--format", "json"], capture().io),
    /unavailable in JSON mode/
  );
  await assert.rejects(
    runCli(["request-approval", "--repo", root, "--run", "run-1", "--gate", "capability", "--subject", "browser-runtime", "--subject-sha", "a".repeat(64)], capture().io),
    /use request-capability/i
  );
  await assert.rejects(
    runCli(["approve", "--repo", root, "--request", "approval-request-placeholder", "--yes"], capture().io),
    /Unknown argument: --yes/
  );
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("public verification execution requires a Goal Run before consumer configuration or processes", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-verify-authority-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "verify-authority", scripts: { test: "node --test" } }));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  await assert.rejects(runCli(["verify", "--repo", root, "--command", "root-test", "--execute"], capture().io), /requires --run ID/i);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("public verification execution cannot start an accepted command without current capability approval", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-verify-denied-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-verify-denied-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-verify-denied-supervisor-"));
  const marker = path.join(os.tmpdir(), `devharness-forbidden-${path.basename(root)}`);
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true }),
    rm(supervisorRoot, { recursive: true, force: true }),
    rm(marker, { force: true })
  ]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "verify-denied", dependencies: { next: "15.0.0" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  await writeFile(path.join(root, "devharness.yaml"), JSON.stringify({
    version: 1,
    project: { id: "verify-denied" },
    platforms: ["web"],
    quality: {
      commands: [
        {
          id: "fixture-launch",
          kind: "launch",
          run: "node -e \"setInterval(() => {}, 1000)\"",
          source: "developer-reviewed-test-fixture"
        },
        {
          id: "forbidden-verify",
          kind: "verify",
          run: `node -e \"require('node:fs').writeFileSync('${marker}', 'executed')\"`,
          source: "developer-reviewed-test-fixture"
        }
      ]
    },
    harness: {
      services: [{
        id: "fixture-service",
        command_id: "fixture-launch",
        readiness: { kind: "http", url: "http://127.0.0.1:54322/health", expected_statuses: [204], timeout_ms: 1000, interval_ms: 100 },
        shutdown: { grace_ms: 100 }
      }],
      verifications: [{ command_id: "forbidden-verify", service_ids: ["fixture-service"] }]
    },
    autonomy: { required_gates: ["scope", "delivery"] },
    delivery: { provider: "manual", target: "pull-request" }
  }, null, 2));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "accepted harness fixture"]);

  await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Prove denied execution", "--format", "json"],
    capture().io,
    { newRunId: () => "run-verify-denied", now: () => "2026-08-31T18:00:00.000Z" }
  );
  await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-verify-denied", "--format", "json"],
    capture().io,
    { now: () => "2026-08-31T18:01:00.000Z", supervisorRoot }
  );

  await assert.rejects(
    runCli(
      ["verify", "--repo", root, "--data-dir", dataRoot, "--run", "run-verify-denied", "--command", "forbidden-verify", "--execute"],
      capture().io,
      { now: () => "2026-08-31T18:02:00.000Z", supervisorRoot }
    ),
    /service-runtime is unrequested/i
  );
  await assert.rejects(stat(marker), { code: "ENOENT" });
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("goal creates external event-backed state and status restores a compact verdict", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-goal-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-goal-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "goal-fixture" }));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });

  const goalOutput = capture();
  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    goalOutput.io,
    { newRunId: () => "run-cli-1", now: () => "2026-08-31T16:00:00.000Z" }
  ), 0);
  const created = JSON.parse(goalOutput.lines[0]);
  assert.equal(created.run.id, "run-cli-1");
  assert.equal(created.run.state, "received");
  assert.equal(created.scorecard.data_source, "runtime");
  assert.equal(created.scorecard.proof_coverage.score, 0);
  assert.equal(created.scorecard.verdict, "blocked");

  const statusOutput = capture();
  assert.equal(await runCli(["status", "--repo", root, "--data-dir", dataRoot, "--run", "run-cli-1", "--format", "json"], statusOutput.io), 2);
  const statusResult = JSON.parse(statusOutput.lines[0]);
  assert.equal(statusResult.run.id, "run-cli-1");
  assert.equal(statusResult.scorecard.exception_counts.blocking > 0, true);
  assert.match(statusResult.next_action, /acceptance criteria/i);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);
});

test("goal refuses a dirty repository before creating state", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-goal-dirty-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-goal-dirty-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "dirty-fixture" }));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  await writeFile(path.join(root, "dirty.txt"), "uncommitted\n");
  await assert.rejects(runCli(["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Unsafe goal"], capture().io), /clean committed/i);
});

test("advance publishes an honest Alignment Brief without changing the consumer", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-advance-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-advance-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-advance-supervisor-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true }), rm(supervisorRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "advance-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });

  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    capture().io,
    { newRunId: () => "run-advance-1", now: () => "2026-08-31T16:00:00.000Z" }
  ), 0);
  const output = capture();
  assert.equal(await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--format", "json"],
    output.io,
    { now: () => "2026-08-31T17:00:00.000Z" }
  ), 2);
  const result = JSON.parse(output.lines[0]);
  assert.equal(result.run.state, "clarifying");
  assert.equal(result.interaction.kind, "alignment-brief");
  assert.equal(result.interaction.verdict, "action-required");
  assert.equal(result.interaction.actions.some((action) => action.kind === "approve"), false);
  assert.equal(result.interaction.sections.some((section) => section.title === "Execution graph"), true);
  assert.equal(result.scorecard.verdict, "blocked");
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);

  const status = capture();
  assert.equal(await runCli(["status", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--format", "json"], status.io, { supervisorRoot }), 2);
  assert.equal(JSON.parse(status.lines[0]).run.state, "clarifying");
  const capabilityOutput = capture();
  assert.equal(await runCli(
    ["request-capability", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--capability", "browser-runtime", "--format", "json"],
    capabilityOutput.io,
    { supervisorRoot, now: () => "2026-08-31T17:10:00.000Z" }
  ), 0);
  const capabilityResult = JSON.parse(capabilityOutput.lines[0]);
  assert.equal(capabilityResult.capability.id, "browser-runtime");
  assert.equal(capabilityResult.request.subject.id, "browser-runtime");
  const pendingStatus = capture();
  await runCli(["status", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--format", "json"], pendingStatus.io, { supervisorRoot, now: () => "2026-08-31T17:20:00.000Z" });
  assert.equal(JSON.parse(pendingStatus.lines[0]).capabilities.counts.pending, 1);
  const textCapabilityOutput = capture();
  assert.equal(await runCli(
    ["request-capability", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1", "--capability", "network-research"],
    textCapabilityOutput.io,
    { supervisorRoot, now: () => "2026-08-31T17:21:00.000Z" }
  ), 0);
  assert.match(textCapabilityOutput.lines[0], /approve --repo .* --data-dir .*devharness-cli-advance-data-.* --request approval-request-/);
  await assert.rejects(runCli(["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-advance-1"], capture().io), /received \(static understanding\)|scope-approved clarifying/i);
});

test("align bootstraps a live Alignment bundle that status can read back", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-align-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-align-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "align-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  const before = execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" });

  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    capture().io,
    { newRunId: () => "run-align-1", now: () => "2026-08-31T16:00:00.000Z" }
  ), 0);
  assert.equal(await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-align-1", "--format", "json"],
    capture().io,
    { now: () => "2026-08-31T17:00:00.000Z" }
  ), 2);

  const alignOutput = capture();
  assert.equal(await runCli(
    ["align", "--repo", root, "--data-dir", dataRoot, "--run", "run-align-1", "--agent", "cursor", "--agent-profile", "cursor-readonly-v1", "--format", "json"],
    alignOutput.io,
    { now: () => "2026-08-31T17:05:00.000Z" }
  ), 2);
  const aligned = JSON.parse(alignOutput.lines[0]);
  assert.equal(aligned.mode, "live-alignment");
  assert.equal(aligned.run.id, "run-align-1");
  assert.equal(aligned.status.status, "question-blocked");
  assert.equal(aligned.agent.id, "cursor");
  assert.equal(aligned.agent.profile_id, "cursor-readonly-v1");
  assert.equal(aligned.analysis_plan.questions >= 1, true);
  assert.equal(aligned.analysis_plan.research_topics >= 1, true);
  assert.equal(aligned.analysis_summary.execution_graph.node_count >= 1, true);
  assert.equal(aligned.interaction_packet.kind, "decision-queue");
  assert.equal(aligned.interaction_packet.decisions >= 1, true);
  assert.ok(aligned.operation.id.startsWith("alignment-operation-"));

  const statusOutput = capture();
  assert.equal(await runCli(["status", "--repo", root, "--data-dir", dataRoot, "--run", "run-align-1", "--format", "json"], statusOutput.io), 2);
  const status = JSON.parse(statusOutput.lines[0]);
  assert.equal(status.mode, "live-alignment");
  assert.equal(status.operation.id, aligned.operation.id);
  assert.equal(status.status.status, "question-blocked");
  assert.equal(status.agent.id, "cursor");
  assert.equal(status.agent.profile_id, "cursor-readonly-v1");
  assert.equal(status.analysis_plan.id, aligned.analysis_plan.id);
  assert.equal(status.analysis_summary.stage_gates.implement.status, "blocked");
  assert.equal(status.analysis_summary.stage_gate_metrics.ready, 0);
  assert.equal(status.analysis_summary.stage_gate_metrics.blocked, 3);
  assert.equal(status.analysis_summary.execution_graph.node_count >= 1, true);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), before);
});

test("request-scope creates a scope gate for a ready Alignment Brief without touching the repo", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-scope-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-scope-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-scope-supervisor-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true }), rm(supervisorRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "scope-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  const goalOutput = capture();
  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    goalOutput.io,
    { newRunId: () => "run-scope-1", now: () => "2026-08-31T16:00:00.000Z" }
  ), 0);
  const created = JSON.parse(goalOutput.lines[0]);
  const repoIdentity = path.basename(root);
  await seedReadyBundle(dataRoot, created.run, repoIdentity);

  const output = capture();
  assert.equal(await runCli(["request-scope", "--repo", root, "--data-dir", dataRoot, "--run", "run-scope-1", "--format", "json"], output.io, { supervisorRoot }), 0);
  const result = JSON.parse(output.lines[0]);
  assert.equal(result.mode, "live-alignment");
  assert.equal(result.request.gate, "scope");
  assert.equal(result.request.run_id, "run-scope-1");
  assert.equal(result.request.subject.id, result.bundle_ref.id);
  assert.equal(result.request.subject.artifact_sha256, result.bundle_ref.sha256);
  assert.equal(result.next_action.includes("approve --repo"), true);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("request-scope then approve writes gates.scope.status approved on the Goal Run", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-scope-approve-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-scope-approve-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-scope-approve-supervisor-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true }), rm(supervisorRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "scope-approve-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}" + "\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  const goalOutput = capture();
  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    goalOutput.io,
    { newRunId: () => "run-scope-approve-1", now: () => "2026-08-31T16:00:00.000Z" }
  ), 0);
  const created = JSON.parse(goalOutput.lines[0]);
  const repoIdentity = path.basename(root);
  await seedReadyBundle(dataRoot, created.run, repoIdentity);

  const requestOutput = capture();
  assert.equal(await runCli(
    ["request-scope", "--repo", root, "--data-dir", dataRoot, "--run", "run-scope-approve-1", "--format", "json"],
    requestOutput.io,
    { supervisorRoot, now: () => "2026-08-31T18:00:00.000Z" }
  ), 0);
  const requested = JSON.parse(requestOutput.lines[0]);
  assert.equal(requested.request.gate, "scope");

  const before = await loadGoalRun(dataRoot, created.run.repository.identity, "run-scope-approve-1");
  assert.equal(before.gates.scope.status, "pending");

  const approveOutput = capture();
  assert.equal(await runCli(
    ["approve", "--repo", root, "--data-dir", dataRoot, "--request", requested.request.id],
    approveOutput.io,
    {
      supervisorRoot,
      now: () => "2026-08-31T18:05:00.000Z",
      approveResponse: async () => `APPROVE ${requested.request.id}`
    }
  ), 0);
  assert.match(approveOutput.lines.join("\n"), /Goal Run gate: scope=approved/);

  const after = await loadGoalRun(dataRoot, created.run.repository.identity, "run-scope-approve-1");
  assert.equal(after.gates.scope.status, "approved");
  assert.equal(after.gates.scope.artifact_hash, requested.request.subject.artifact_sha256);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("answer records a developer choice and releases the live alignment block", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-answer-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-answer-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-answer-supervisor-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true }), rm(supervisorRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "answer-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    capture().io,
    { newRunId: () => "run-answer-1", now: () => "2026-08-31T16:00:00.000Z" }
  );
  await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-answer-1", "--format", "json"],
    capture().io,
    { now: () => "2026-08-31T17:00:00.000Z" }
  );
  const alignOutput = capture();
  await runCli(
    ["align", "--repo", root, "--data-dir", dataRoot, "--run", "run-answer-1", "--format", "json"],
    alignOutput.io,
    { now: () => "2026-08-31T17:05:00.000Z" }
  );
  const aligned = JSON.parse(alignOutput.lines[0]);

  const liveBefore = await loadLiveAlignmentOperationBundle(dataRoot, path.basename(root), aligned.operation.id);
  assert.equal(liveBefore.interactionPacket.kind, "decision-queue");
  const decision = liveBefore.interactionPacket.decisions[0];
  const option = decision.options.find((candidate) => candidate.recommended) ?? decision.options[0];

  const output = capture();
  assert.equal(await runCli(
    ["answer", "--repo", root, "--data-dir", dataRoot, "--run", "run-answer-1", "--decision", decision.id, "--option", option.id, "--format", "json"],
    output.io,
    {
      supervisorRoot,
      answerResponse: async (prompt) => `APPROVE ${prompt.match(/APPROVE (\S+)/)?.[1] ?? ""}`
    }
  ), 2);

  const answered = JSON.parse(output.lines[0]);
  assert.equal(answered.mode, "live-alignment");
  assert.equal(answered.answer.decision_id, decision.id);
  assert.equal(answered.answer.option_id, option.id);
  assert.equal(answered.status.status, "question-blocked");
  assert.equal(answered.developer_answers, 1);

  const liveAfter = await loadLiveAlignmentOperationBundle(dataRoot, path.basename(root), answered.operation.id);
  assert.equal(liveAfter.developerAnswers.length, 1);
  assert.equal(liveAfter.developerAnswers[0].decision_id, decision.id);
  assert.equal(liveAfter.status.status, "question-blocked");
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("retry and cancel expose the live alignment recovery surface", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-recovery-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-recovery-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "recovery-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  const goalOutput = capture();
  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    goalOutput.io,
    { newRunId: () => "run-recovery-1", now: () => "2026-08-31T16:00:00.000Z" }
  ), 0);
  const created = JSON.parse(goalOutput.lines[0]);
  const run = created.run;
  const operation = buildLiveAlignmentOperation({
    run,
    goalArtifact: artifact("goal-1", "goal"),
    snapshotArtifact: artifact("snapshot-1", "snapshot"),
    onboardingArtifact: artifact("onboarding-1", "onboarding"),
    agentDescriptor: descriptor,
    agentAuthoritySubject: { id: "subject-1", sha256: readyHash },
    resultContractSha256: readyHash,
    limits,
    inputCheckpointSha256: hashContract({ run_id: run.id, head_sha: run.current_head_sha })
  });
  await startLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity: path.basename(root),
    operation,
    status: buildLiveAlignmentStatus(operation, { status: "failed", terminal_error: "TIMEOUT" })
  });
  await seedFailedAttempt(dataRoot, path.basename(root), operation);

  const retryOutput = capture();
  assert.equal(await runCli(
    ["retry", "--repo", root, "--data-dir", dataRoot, "--run", run.id, "--operation", operation.id, "--format", "json"],
    retryOutput.io
  ), 2);
  const retried = JSON.parse(retryOutput.lines[0]);
  assert.equal(retried.status.status, "running");
  assert.equal(retried.next_action.includes("Let the live operation continue"), true);

  const cancelOutput = capture();
  assert.equal(await runCli(
    ["cancel", "--repo", root, "--data-dir", dataRoot, "--run", run.id, "--operation", operation.id, "--format", "json"],
    cancelOutput.io
  ), 0);
  const cancelled = JSON.parse(cancelOutput.lines[0]);
  assert.equal(cancelled.status.status, "cancelled");
  assert.equal(cancelled.fence.kind, "cancel");
  assert.equal(cancelled.next_action.includes("new Goal Run"), true);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("align --continue reacquires a dead lease and ticks without TIMEOUT-failing", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-continue-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-continue-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "continue-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}" + "\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    capture().io,
    { newRunId: () => "run-continue-1", now: () => "2026-08-31T16:00:00.000Z" }
  );
  await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-continue-1", "--format", "json"],
    capture().io,
    { now: () => "2026-08-31T17:00:00.000Z" }
  );
  const alignOutput = capture();
  await runCli(
    ["align", "--repo", root, "--data-dir", dataRoot, "--run", "run-continue-1", "--format", "json"],
    alignOutput.io,
    { now: () => "2026-08-31T17:05:00.000Z" }
  );
  const aligned = JSON.parse(alignOutput.lines[0]);
  const beforeLease = aligned.lease.owner_id;

  const continueOutput = capture();
  assert.equal(await runCli(
    ["align", "--continue", "--repo", root, "--data-dir", dataRoot, "--run", "run-continue-1", "--format", "json"],
    continueOutput.io,
    {
      now: () => "2026-09-01T12:10:00.000Z",
      isOwnerAlive: async () => false,
      leaseOwner: { owner_id: "owner-continue", boot_id: "boot-continue", pid: 4242, process_birth_id: "birth-continue" },
      capabilityView: {
        capabilities: [{ request: { id: "agent-runtime", capability: "agent-runtime" }, status: "approved" }],
        research_tasks: []
      }
    }
  ), 2);
  const continued = JSON.parse(continueOutput.lines[0]);
  assert.equal(continued.action, "continue");
  assert.equal(continued.status.status, "question-blocked");
  assert.equal(continued.status.terminal_error, null);
  assert.equal(continued.lease.owner_id, "owner-continue");
  assert.notEqual(continued.lease.owner_id, beforeLease);
  assert.equal(continued.unresolved_decisions.length >= 1, true);
  assert.equal(continued.worker, null);
  const live = await loadLiveAlignmentOperationBundle(dataRoot, path.basename(root), aligned.operation.id);
  assert.equal(live.status.status, "question-blocked");
  assert.equal(live.lease.pid, 4242);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");
});

test("review command starts a repository-scoped read service and emits a fragment credential", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-review-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-review-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "review-fixture" }));
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  assert.equal(await runCli(["init", "--repo", root, "--write"], capture().io), 0);
  const acceptedConfig = JSON.parse(await readFile(path.join(root, "devharness.yaml"), "utf8"));
  acceptedConfig.project.id = "accepted-review-config";
  await writeFile(path.join(root, "devharness.yaml"), `${JSON.stringify(acceptedConfig, null, 2)}\n`);
  execFileSync("git", ["-C", root, "add", "devharness.yaml"]);
  execFileSync("git", ["-C", root, "commit", "-m", "accept project declaration"]);
  let received;
  const output = capture();
  assert.equal(await runCli(
    ["review", "--repo", root, "--data-dir", dataRoot, "--port", "4318", "--ui-origin", "http://localhost:3001"],
    output.io,
    { startReviewServer: async (options) => {
      received = options;
      return { origin: "http://127.0.0.1:4318", token: "d".repeat(64) };
    } }
  ), 0);
  assert.equal(received.port, 4318);
  assert.equal(received.allowedOrigin, "http://localhost:3001");
  assert.equal(received.declarationReview.repository_identity, path.basename(root));
  assert.equal(received.declarationReview.verdict, "blocked");
  assert.equal(received.declarationReview.proposal_sha256, hashContract(acceptedConfig));
  assert.match(output.lines[0], /#api=http%3A%2F%2F127\.0\.0\.1%3A4318&token=/);
});

test("align --continue help documents research-recipes and parseArguments accepts the flag", async () => {
  const help = capture();
  const helpCode = await runCli(["--help"], help.io);
  assert.equal(helpCode, 0);
  const body = help.lines.join("\n");
  assert.match(body, /research-recipes/);
  assert.match(body, /--agent codex/);
  assert.match(body, /devharness-cli-local-agent/);
});

test("align --agent codex records a probed Codex descriptor from an injected executable", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-codex-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-codex-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "codex-align-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    capture().io,
    { newRunId: () => "run-codex-align-1", now: () => "2026-09-15T16:00:00.000Z" }
  ), 0);
  await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-codex-align-1", "--format", "json"],
    capture().io,
    { now: () => "2026-09-15T17:00:00.000Z" }
  );
  const alignOutput = capture();
  assert.equal(await runCli(
    ["align", "--repo", root, "--data-dir", dataRoot, "--run", "run-codex-align-1", "--agent", "codex", "--format", "json"],
    alignOutput.io,
    {
      now: () => "2026-09-15T17:05:00.000Z",
      environment: { PATH: "/usr/bin:/bin" },
      inspectCodexExecutable: async () => ({
        path: "/opt/codex",
        version: "codex-cli 1.2.3",
        bytes: Buffer.from("codex-executable")
      })
    }
  ), 2);
  const aligned = JSON.parse(alignOutput.lines[0]);
  assert.equal(aligned.agent.id, "codex");
  assert.equal(aligned.agent.profile_id, "codex-readonly-analysis-v1");
  assert.equal(aligned.operation.agent_descriptor.executable_version, "codex-cli 1.2.3");
});

test("align defaults to local-readonly when Codex auth is not configured", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-local-default-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-local-default-data-"));
  t.after(() => Promise.all([rm(root, { recursive: true, force: true }), rm(dataRoot, { recursive: true, force: true })]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "local-default-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);
  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Add password reset", "--format", "json"],
    capture().io,
    { newRunId: () => "run-local-default-1", now: () => "2026-09-15T16:00:00.000Z" }
  ), 0);
  await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-local-default-1", "--format", "json"],
    capture().io,
    { now: () => "2026-09-15T17:00:00.000Z" }
  );
  const alignOutput = capture();
  assert.equal(await runCli(
    ["align", "--repo", root, "--data-dir", dataRoot, "--run", "run-local-default-1", "--format", "json"],
    alignOutput.io,
    { now: () => "2026-09-15T17:05:00.000Z", environment: { PATH: "/usr/bin:/bin" } }
  ), 2);
  const aligned = JSON.parse(alignOutput.lines[0]);
  assert.equal(aligned.agent.id, "devharness-cli-local-agent");
});



test("post-scope advance after scope approval writes external summary and prepares verify", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-post-scope-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-post-scope-data-"));
  const artifactDir = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-post-scope-artifacts-"));
  const configDir = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-post-scope-config-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-post-scope-supervisor-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true }),
    rm(artifactDir, { recursive: true, force: true }),
    rm(configDir, { recursive: true, force: true }),
    rm(supervisorRoot, { recursive: true, force: true })
  ]));

  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "post-scope-cli", scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  const summaryPath = path.join(artifactDir, "readiness-summary.md");
  const configPath = path.join(configDir, "devharness.yaml");
  await writeFile(configPath, `${JSON.stringify({
    version: 1,
    project: { id: "post-scope-cli" },
    platforms: ["web"],
    quality: {
      commands: [{
        id: "docs-readiness-summary",
        kind: "test",
        run: `node -e "require('node:fs').accessSync(process.env.DEVHARNESS_READINESS_SUMMARY); console.log('ok')"`,
        source: "external docs-only probe"
      }]
    },
    harness: { services: [], verifications: [] },
    autonomy: { required_gates: ["scope", "delivery"] },
    delivery: { provider: "manual", target: "pull-request" }
  }, null, 2)}\n`);

  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Summarize repository readiness for a docs-only Alignment pass", "--format", "json"],
    capture().io,
    { newRunId: () => "run-post-scope-cli-1", now: () => "2026-09-15T12:00:00.000Z" }
  ), 0);
  assert.equal(await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-post-scope-cli-1", "--format", "json"],
    capture().io,
    { now: () => "2026-09-15T12:05:00.000Z" }
  ), 2);

  const identity = path.basename(root);
  const current = await loadGoalRun(dataRoot, identity, "run-post-scope-cli-1");
  assert.equal(current.state, "clarifying");
  const onboarding = await loadRunSourceArtifact(dataRoot, identity, "run-post-scope-cli-1", "artifact-onboarding-plan");
  const goalInput = await loadRunSourceArtifact(dataRoot, identity, "run-post-scope-cli-1", "artifact-goal-input");
  const approved = structuredClone(current);
  approved.gates.scope = {
    status: "approved",
    decided_at: "2026-09-15T12:10:00.000Z",
    decided_by: { id: "developer", kind: "human", role: "developer-approver" },
    artifact_hash: "c".repeat(64)
  };
  approved.timestamps.updated_at = "2026-09-15T12:10:00.000Z";
  const packetBody = {
    schema_version: 1,
    run_id: current.id,
    kind: "progress-pulse",
    generated_at: "2026-09-15T12:10:00.000Z",
    head_sha: current.current_head_sha,
    title: "Scope approved",
    verdict: "informational",
    summary: "Scope approved for CLI post-scope fixture.",
    attention: { required: false, count: 0, reasons: [] },
    sections: [{
      id: "scope",
      title: "Scope",
      items: [{
        id: "scope-approved",
        text: "Scope gate approved.",
        confidence: "confirmed",
        severity: "info",
        source_refs: ["artifact-onboarding-plan"]
      }]
    }],
    decisions: [],
    actions: [{ id: "inspect-scope", label: "Inspect scope", kind: "inspect", recommended: true }],
    source_artifacts: [
      { id: onboarding.source.id, kind: onboarding.source.kind, sha256: onboarding.source.sha256, uri: `artifacts/${onboarding.source.id}.json` },
      { id: goalInput.source.id, kind: goalInput.source.kind, sha256: goalInput.source.sha256, uri: `artifacts/${goalInput.source.id}.json` }
    ],
    traceability: [{ item_id: "scope-approved", source_refs: ["artifact-onboarding-plan"] }],
    compression: { source_artifact_count: 2, surfaced_item_count: 1, omitted_item_count: 0 }
  };
  const packet = { ...packetBody, id: `packet-${hashContract(packetBody).slice(0, 32)}` };
  const paths = runStoragePaths(dataRoot, identity, current.id);
  const pointer = JSON.parse(await readFile(paths.current, "utf8"));
  await appendGoalRunCheckpoint({
    dataRoot,
    repositoryIdentity: identity,
    runId: current.id,
    events: [createRunEvent({
      runId: current.id,
      sequence: pointer.sequence + 1,
      at: "2026-09-15T12:10:00.000Z",
      type: "gate.decided",
      data: { gate: "scope", decision: approved.gates.scope, receipt_id: "receipt-scope-cli", request_id: "request-scope-cli" }
    })],
    nextRun: approved,
    scorecard: createReviewScorecard({
      run: approved,
      scopeHash: "a".repeat(64),
      harnessVersion: "unbound",
      title: "scope approved",
      sourceArtifactCount: 2,
      generatedAt: "2026-09-15T12:10:00.000Z",
      dataSource: "runtime"
    }),
    packet,
    artifacts: [
      { id: onboarding.source.id, kind: onboarding.source.kind, value: onboarding.value, sha256: onboarding.source.sha256 },
      { id: goalInput.source.id, kind: goalInput.source.kind, value: goalInput.value, sha256: goalInput.source.sha256 }
    ]
  });

  const advanceOutput = capture();
  assert.equal(await runCli(
    [
      "advance",
      "--repo", root,
      "--data-dir", dataRoot,
      "--config", configPath,
      "--run", "run-post-scope-cli-1",
      "--artifact-dir", artifactDir,
      "--command", "docs-readiness-summary",
      "--format", "json"
    ],
    advanceOutput.io,
    { supervisorRoot, now: () => "2026-09-15T12:15:00.000Z" }
  ), 0);
  const advanced = JSON.parse(advanceOutput.lines[0]);
  assert.equal(advanced.mode, "post-scope");
  assert.equal(advanced.run.state, "verifying");
  assert.match(advanced.delivery.summary_path, /readiness-summary\.md$/);
  assert.match(await readFile(advanced.delivery.summary_path, "utf8"), /Readiness summary/);
  assert.equal(advanced.verify?.authority_allowed, false);
  assert.match(advanced.next_action, /service-runtime|Capability gate|request-capability --run .*--for-verify/i);
  assert.equal(advanced.scorecard.exception_counts.blocking, 1);
  assert.equal(advanced.scorecard.exception_counts.unknowns, 1);
  assert.equal(advanced.scorecard.exceptions.some((item) => item.type === "review"), false);
  assert.equal(advanced.scorecard.exceptions.some((item) => /trusted review/i.test(item.title)), false);
  assert.equal(execFileSync("git", ["-C", root, "status", "--porcelain=v1"], { encoding: "utf8" }), "");

  const verifyOutput = capture();
  await assert.rejects(
    () => runCli(
      [
        "verify",
        "--repo", root,
        "--config", configPath,
        "--data-dir", dataRoot,
        "--run", "run-post-scope-cli-1",
        "--command", "docs-readiness-summary",
        "--execute",
        "--attest"
      ],
      verifyOutput.io,
      { supervisorRoot, now: () => "2026-09-15T12:20:00.000Z" }
    ),
    /capability authority|service-runtime/i
  );
});


test("batch approve --pending records multiple capability receipts with one TTY phrase", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-batch-approve-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-batch-approve-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-cli-batch-approve-supervisor-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true }),
    rm(supervisorRoot, { recursive: true, force: true })
  ]));
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "batch-approve-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  assert.equal(await runCli(
    ["goal", "--repo", root, "--data-dir", dataRoot, "--goal", "Batch approve dogfood", "--format", "json"],
    capture().io,
    { newRunId: () => "run-batch-approve-1", now: () => "2026-08-31T16:00:00.000Z", supervisorRoot }
  ), 0);
  assert.equal(await runCli(
    ["advance", "--repo", root, "--data-dir", dataRoot, "--run", "run-batch-approve-1", "--format", "json"],
    capture().io,
    { supervisorRoot, now: () => "2026-08-31T16:05:00.000Z" }
  ), 2);

  const firstOut = capture();
  assert.equal(await runCli(
    ["request-capability", "--repo", root, "--data-dir", dataRoot, "--run", "run-batch-approve-1", "--capability", "browser-runtime", "--format", "json"],
    firstOut.io,
    { supervisorRoot, now: () => "2026-08-31T16:10:00.000Z" }
  ), 0);
  const first = JSON.parse(firstOut.lines.join("\n"));
  const secondOut = capture();
  assert.equal(await runCli(
    ["request-capability", "--repo", root, "--data-dir", dataRoot, "--run", "run-batch-approve-1", "--capability", "network-research", "--format", "json"],
    secondOut.io,
    { supervisorRoot, now: () => "2026-08-31T16:11:00.000Z" }
  ), 0);
  const second = JSON.parse(secondOut.lines.join("\n"));

  const reuseOut = capture();
  assert.equal(await runCli(
    ["request-capability", "--repo", root, "--data-dir", dataRoot, "--run", "run-batch-approve-1", "--capability", "browser-runtime", "--format", "json"],
    reuseOut.io,
    { supervisorRoot, now: () => "2026-08-31T16:12:00.000Z" }
  ), 0);
  const reused = JSON.parse(reuseOut.lines.join("\n"));
  assert.equal(reused.reused, true);
  assert.equal(reused.reuse_kind, "pending-request");
  assert.equal(reused.request.id, first.request.id);

  const approveOut = capture();
  assert.equal(await runCli(
    ["approve", "--repo", root, "--data-dir", dataRoot, "--run", "run-batch-approve-1", "--pending"],
    approveOut.io,
    {
      supervisorRoot,
      now: () => "2026-08-31T16:15:00.000Z",
      approveResponse: async (prompt) => {
        const match = prompt.match(/Type APPROVE (.+) or REJECT/);
        assert.ok(match, `missing APPROVE clause in prompt: ${prompt}`);
        return `APPROVE ${match[1]}`;
      }
    }
  ), 0);
  assert.match(approveOut.lines.join("\n"), /Decision recorded: approved/);
  assert.match(approveOut.lines.join("\n"), new RegExp(first.request.id));
  assert.match(approveOut.lines.join("\n"), new RegExp(second.request.id));

  const grantOut = capture();
  assert.equal(await runCli(
    ["request-capability", "--repo", root, "--data-dir", dataRoot, "--run", "run-batch-approve-1", "--capability", "browser-runtime", "--format", "json"],
    grantOut.io,
    { supervisorRoot, now: () => "2026-08-31T16:20:00.000Z" }
  ), 0);
  const grant = JSON.parse(grantOut.lines.join("\n"));
  assert.equal(grant.reused, true);
  assert.equal(grant.reuse_kind, "approved-grant");
  assert.equal(grant.request.id, first.request.id);
});

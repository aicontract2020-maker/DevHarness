import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createInitialGoalRun } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { discoverRepository } from "../../project/src/discover.mjs";
import { evaluateReadiness } from "../../project/src/doctor.mjs";
import { createGoalUnderstandingCheckpoint } from "../../project/src/alignment.mjs";
import { createOnboardingPlan } from "../../project/src/onboard.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import {
  buildLiveAlignmentAnalysisPlan,
  buildLiveAlignmentInteractionPacket,
  buildLiveAlignmentLease,
  buildLiveAlignmentOperation,
  buildLiveAlignmentStatus,
  loadLiveAlignmentOperationBundle,
  startLiveAlignmentOperation
} from "../src/live-alignment.mjs";
import { appendGoalRunCheckpoint, createStoredGoalRun } from "../src/goal-run-store.mjs";
import { initializeSupervisorIdentity } from "../src/supervisor-store.mjs";
import { recordAlignmentAnswer, recordAlignmentAnswers } from "../src/alignment-answer.mjs";

const repositoryIdentity = "example/alignment-answer-project";
const originalGoal = "Add password reset";
const commitSha = "c".repeat(40);
const currentTime = "2026-08-31T17:05:00.000Z";

function staticDescriptor() {
  return {
    schema_version: 1,
    id: "devharness-cli-local-agent",
    version: "devharness-cli-local-live-v1",
    protocol_version: 1,
    profile_id: "codex-readonly-analysis-v1",
    model_id: "local-readonly-analysis",
    executable_version: "devharness-cli",
    modes: ["analysis-plan", "analysis-synthesis", "analysis-validation"],
    features: {
      structured_output: true,
      explicit_cancel: true,
      ephemeral_session: true,
      read_only_tool_policy: true,
      built_in_web_disable: true,
      trusted_usage: true
    },
    implementation_sha256: "a".repeat(64),
    executable_sha256: "b".repeat(64),
    profile_template_sha256: "d".repeat(64),
    control_plane_origins: ["https://devharness.local"],
    descriptor_sha256: "f".repeat(64)
  };
}

function authoritySubject(operation, packetSha256, decisionId, optionId) {
  const body = {
    schema_version: 1,
    run_id: operation.run_id,
    repository_identity: operation.repository_identity,
    commit_sha: operation.commit_sha,
    packet_sha256: packetSha256,
    decision_id: decisionId,
    option_id: optionId
  };
  return {
    id: `alignment-answer-subject-${hashContract(body).slice(0, 32)}`,
    sha256: hashContract(body)
  };
}

function artifactRef(artifact, kind, storageKey) {
  return {
    id: artifact.id,
    kind,
    sha256: artifact.sha256,
    media_type: "application/json",
    size_bytes: Buffer.byteLength(`${JSON.stringify(artifact.value, null, 2)}\n`),
    storage_key: storageKey
  };
}

async function createRepoFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-answer-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-answer-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-answer-supervisor-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true }),
    rm(supervisorRoot, { recursive: true, force: true })
  ]));

  await writeFile(
    path.join(root, "package.json"),
    JSON.stringify({
      name: "answer-fixture",
      dependencies: { next: "15.0.0", pg: "8.0.0" },
      scripts: { test: "node --test" }
    })
  );
  await writeFile(path.join(root, "package-lock.json"), "{}\n");
  execFileSync("git", ["-C", root, "init", "-b", "main"]);
  execFileSync("git", ["-C", root, "config", "user.email", "devharness@example.invalid"]);
  execFileSync("git", ["-C", root, "config", "user.name", "DevHarness Tests"]);
  execFileSync("git", ["-C", root, "add", "."]);
  execFileSync("git", ["-C", root, "commit", "-m", "fixture"]);

  const snapshot = await discoverRepository(root);
  const report = evaluateReadiness(snapshot);
  const onboardingPlan = await createOnboardingPlan(snapshot, { report, config: null, configError: "missing" });
  const { run, event } = createInitialGoalRun({
    id: "run-answer-1",
    repository: {
      identity: snapshot.repository.identity,
      root_uri: snapshot.repository.root_uri,
      base_ref: snapshot.repository.git.branch || snapshot.repository.git.head_sha
    },
    originalGoal,
    headSha: snapshot.repository.git.head_sha,
    now: "2026-08-31T16:00:00.000Z"
  });
  const initialScorecard = createReviewScorecard({
    run,
    scopeHash: "b".repeat(64),
    harnessVersion: "unbound",
    title: "Goal",
    reviewVerdicts: [],
    reviewChecks: [],
    findings: [],
    generatedAt: currentTime
  });
  await createStoredGoalRun({ dataRoot, run, event, scorecard: initialScorecard });

  const checkpoint = await createGoalUnderstandingCheckpoint({
    run,
    snapshot,
    onboardingPlan,
    generatedAt: currentTime
  });
  const checkpointScorecard = createReviewScorecard({
    run: checkpoint.run,
    scopeHash: "b".repeat(64),
    harnessVersion: "unbound",
    title: "Understanding",
    reviewVerdicts: [],
    reviewChecks: [],
    findings: [],
    generatedAt: currentTime
  });
  await appendGoalRunCheckpoint({
    dataRoot,
    repositoryIdentity: snapshot.repository.identity,
    runId: checkpoint.run.id,
    events: checkpoint.events,
    nextRun: checkpoint.run,
    scorecard: checkpointScorecard,
    packet: checkpoint.packet,
    artifacts: checkpoint.artifacts
  });

  const operation = buildLiveAlignmentOperation({
    run: checkpoint.run,
    goalArtifact: artifactRef(checkpoint.artifacts[0], "goal", "artifacts/artifact-goal-input.json"),
    snapshotArtifact: artifactRef(checkpoint.artifacts[1], "snapshot", "artifacts/artifact-repository-snapshot.json"),
    onboardingArtifact: artifactRef(checkpoint.artifacts[2], "onboarding", "artifacts/artifact-onboarding-plan.json"),
    agentDescriptor: staticDescriptor(),
    agentAuthoritySubject: authoritySubject(checkpoint.run, "1".repeat(64), "subject", "option"),
    resultContractSha256: "4".repeat(64),
    limits: {
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
    },
    developerAnswerArtifacts: [],
    inputCheckpointSha256: checkpoint.packet.sha256 ?? hashContract({ run_id: checkpoint.run.id, head_sha: checkpoint.run.current_head_sha })
  });
  const analysisPlan = buildLiveAlignmentAnalysisPlan({
    operation,
    goalArtifact: artifactRef(checkpoint.artifacts[0], "goal", "artifacts/artifact-goal-input.json"),
    snapshotArtifact: artifactRef(checkpoint.artifacts[1], "snapshot", "artifacts/artifact-repository-snapshot.json"),
    onboardingArtifact: artifactRef(checkpoint.artifacts[2], "onboarding", "artifacts/artifact-onboarding-plan.json"),
    onboardingPlan
  });
  const interactionPacket = buildLiveAlignmentInteractionPacket({
    operation,
    analysisPlan: analysisPlan.analysisPlan,
    analysisSummary: analysisPlan.summary,
    onboardingSummary: onboardingPlan.summary,
    goalArtifact: artifactRef(checkpoint.artifacts[0], "goal", "artifacts/artifact-goal-input.json"),
    snapshotArtifact: artifactRef(checkpoint.artifacts[1], "snapshot", "artifacts/artifact-repository-snapshot.json"),
    onboardingArtifact: artifactRef(checkpoint.artifacts[2], "onboarding", "artifacts/artifact-onboarding-plan.json")
  });
  assert.equal(interactionPacket.decisions.length > 0, true);

  const lease = buildLiveAlignmentLease(operation, {
    owner_id: "owner-1",
    boot_id: "boot-1",
    pid: 1234,
    process_birth_id: "birth-1"
  });
  const status = buildLiveAlignmentStatus(operation, {
    status: "question-blocked",
    active_phase: "analysis-plan"
  });
  await startLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity: snapshot.repository.identity,
    operation,
    analysisPlan: analysisPlan.analysisPlan,
    interactionPacket: interactionPacket.packet,
    status,
    lease
  });
  await initializeSupervisorIdentity(supervisorRoot, { now: () => new Date(currentTime) });

  const bundle = await loadLiveAlignmentOperationBundle(dataRoot, snapshot.repository.identity, operation.id);
  const decision = bundle.interactionPacket.decisions[0];
  const option = decision.options.find((candidate) => candidate.recommended) ?? decision.options[0];
  const packetSha256 = hashContract(bundle.interactionPacket);

  return {
    dataRoot,
    supervisorRoot,
    repositoryIdentity: snapshot.repository.identity,
    run: checkpoint.run,
    operation,
    bundle,
    packetSha256,
    decision,
    option
  };
}

test("alignment answers require the exact packet, decision, option, and foreground approval", async (t) => {
  const fixture = await createRepoFixture(t);
  const result = await recordAlignmentAnswer({
    dataRoot: fixture.dataRoot,
    supervisorRoot: fixture.supervisorRoot,
    repositoryIdentity: fixture.repositoryIdentity,
    runId: fixture.run.id,
    packetSha256: fixture.packetSha256,
    decisionId: fixture.decision.id,
    optionId: fixture.option.id,
    responseProvider: async (prompt) => `APPROVE ${prompt.match(/APPROVE (\S+)/)?.[1] ?? ""}`,
    now: () => new Date(currentTime)
  });

  assert.equal(result.request.gate, "alignment-answer");
  assert.equal(result.request.subject.artifact_sha256, authoritySubject(fixture.operation, fixture.packetSha256, fixture.decision.id, fixture.option.id).sha256);
  assert.equal(result.answer.decision_id, fixture.decision.id);
  assert.equal(result.answer.option_id, fixture.option.id);
  assert.equal(result.receipt.decision, "approved");

  const stored = await loadLiveAlignmentOperationBundle(fixture.dataRoot, fixture.repositoryIdentity, fixture.operation.id);
  assert.equal(stored.developerAnswers.length, 1);
  assert.equal(stored.developerAnswers[0].decision_id, fixture.decision.id);
  assert.equal(stored.status.status, "question-blocked");

  const replay = await recordAlignmentAnswer({
    dataRoot: fixture.dataRoot,
    supervisorRoot: fixture.supervisorRoot,
    repositoryIdentity: fixture.repositoryIdentity,
    runId: fixture.run.id,
    packetSha256: fixture.packetSha256,
    decisionId: fixture.decision.id,
    optionId: fixture.option.id,
    responseProvider: async (prompt) => `APPROVE ${prompt.match(/APPROVE (\S+)/)?.[1] ?? ""}`,
    now: () => new Date(currentTime)
  });
  assert.equal(replay.answer.id, result.answer.id);
  assert.equal((await loadLiveAlignmentOperationBundle(fixture.dataRoot, fixture.repositoryIdentity, fixture.operation.id)).developerAnswers.length, 1);
});

test("alignment answers reject stale packets, invalid options, and non-interactive calls", async (t) => {
  const fixture = await createRepoFixture(t);
  await assert.rejects(
    () => recordAlignmentAnswer({
      dataRoot: fixture.dataRoot,
      supervisorRoot: fixture.supervisorRoot,
      repositoryIdentity: fixture.repositoryIdentity,
      runId: fixture.run.id,
      packetSha256: "0".repeat(64),
      decisionId: fixture.decision.id,
      optionId: fixture.option.id,
      responseProvider: async (prompt) => `APPROVE ${prompt.match(/APPROVE (\S+)/)?.[1] ?? ""}`,
      now: () => new Date(currentTime)
    }),
    (error) => error.code === "ANSWER_STALE"
  );

  await assert.rejects(
    () => recordAlignmentAnswer({
      dataRoot: fixture.dataRoot,
      supervisorRoot: fixture.supervisorRoot,
      repositoryIdentity: fixture.repositoryIdentity,
      runId: fixture.run.id,
      packetSha256: fixture.packetSha256,
      decisionId: fixture.decision.id,
      optionId: "option-does-not-exist",
      responseProvider: async (prompt) => `APPROVE ${prompt.match(/APPROVE (\S+)/)?.[1] ?? ""}`,
      now: () => new Date(currentTime)
    }),
    (error) => error.code === "ANSWER_INVALID"
  );

  await assert.rejects(
    () => recordAlignmentAnswer({
      dataRoot: fixture.dataRoot,
      supervisorRoot: fixture.supervisorRoot,
      repositoryIdentity: fixture.repositoryIdentity,
      runId: fixture.run.id,
      packetSha256: fixture.packetSha256,
      decisionId: fixture.decision.id,
      optionId: fixture.option.id,
      now: () => new Date(currentTime)
    }),
    /TTY/i
  );
});


test("batch alignment answers use one confirmation phrase for a packet", async (t) => {
  const fixture = await createRepoFixture(t);
  const decisions = fixture.bundle.interactionPacket.decisions;
  assert.ok(decisions.length >= 1);
  // If the fixture packet only has one decision, still exercise the batch API shape.
  const answers = decisions.map((decision) => {
    const option = decision.options.find((candidate) => candidate.recommended) ?? decision.options[0];
    return { decisionId: decision.id, optionId: option.id };
  });
  const prompts = [];
  const result = await recordAlignmentAnswers({
    dataRoot: fixture.dataRoot,
    supervisorRoot: fixture.supervisorRoot,
    repositoryIdentity: fixture.repositoryIdentity,
    runId: fixture.run.id,
    packetSha256: fixture.packetSha256,
    answers,
    responseProvider: async (prompt) => {
      prompts.push(prompt);
      const ids = [...prompt.matchAll(/approval-request-[0-9a-f]+/g)].map((match) => match[0]);
      // Deduplicate while preserving order from the APPROVE clause
      const unique = [...new Set(ids)];
      return `APPROVE ${unique.join(" ")}`;
    },
    now: () => new Date(currentTime)
  });
  assert.equal(prompts.length, 1);
  assert.equal(result.answers.length, answers.length);
  assert.equal(result.receipts.length, answers.length);
  assert.ok(result.receipts.every((receipt) => receipt.decision === "approved"));
  const stored = await loadLiveAlignmentOperationBundle(fixture.dataRoot, fixture.repositoryIdentity, fixture.operation.id);
  assert.equal(stored.developerAnswers.length, answers.length);
});

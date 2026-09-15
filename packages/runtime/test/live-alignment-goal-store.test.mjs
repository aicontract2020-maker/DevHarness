import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
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
import { appendGoalRunCheckpoint, createStoredGoalRun, loadRunInteraction, loadRunSourceArtifact, runStoragePaths } from "../src/goal-run-store.mjs";
import { buildLiveAlignmentAnalysisPlan, buildLiveAlignmentInteractionPacket, buildLiveAlignmentOperation, buildLiveAlignmentStatus, buildLiveAlignmentLease, loadLiveAlignmentOperationBundle, startLiveAlignmentOperation } from "../src/live-alignment.mjs";
import { initializeSupervisorIdentity } from "../src/supervisor-store.mjs";
import { recordAlignmentAnswer } from "../src/alignment-answer.mjs";

const repositoryIdentity = "example/alignment-goal-store-project";
const originalGoal = "Add password reset";
const currentTime = "2026-08-31T17:05:00.000Z";
const commitSha = "c".repeat(40);

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

async function createFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "devharness-goal-store-repo-"));
  const dataRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-goal-store-data-"));
  const supervisorRoot = await mkdtemp(path.join(os.tmpdir(), "devharness-goal-store-supervisor-"));
  t.after(() => Promise.all([
    rm(root, { recursive: true, force: true }),
    rm(dataRoot, { recursive: true, force: true }),
    rm(supervisorRoot, { recursive: true, force: true })
  ]));

  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "goal-store-fixture", dependencies: { next: "15.0.0", pg: "8.0.0" }, scripts: { test: "node --test" } }));
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
    id: "run-goal-store-1",
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

  const checkpoint = await createGoalUnderstandingCheckpoint({ run, snapshot, onboardingPlan, generatedAt: currentTime });
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
    goalArtifact: {
      id: checkpoint.artifacts[0].id,
      kind: "goal",
      sha256: checkpoint.artifacts[0].sha256,
      storage_key: "artifacts/artifact-goal-input.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[0].value, null, 2)}\n`)
    },
    snapshotArtifact: {
      id: checkpoint.artifacts[1].id,
      kind: "snapshot",
      sha256: checkpoint.artifacts[1].sha256,
      storage_key: "artifacts/artifact-repository-snapshot.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[1].value, null, 2)}\n`)
    },
    onboardingArtifact: {
      id: checkpoint.artifacts[2].id,
      kind: "onboarding",
      sha256: checkpoint.artifacts[2].sha256,
      storage_key: "artifacts/artifact-onboarding-plan.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[2].value, null, 2)}\n`)
    },
    agentDescriptor: staticDescriptor(),
    agentAuthoritySubject: { id: "subject-1", sha256: "a".repeat(64) },
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
    goalArtifact: {
      id: checkpoint.artifacts[0].id,
      kind: "goal",
      sha256: checkpoint.artifacts[0].sha256,
      storage_key: "artifacts/artifact-goal-input.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[0].value, null, 2)}\n`)
    },
    snapshotArtifact: {
      id: checkpoint.artifacts[1].id,
      kind: "snapshot",
      sha256: checkpoint.artifacts[1].sha256,
      storage_key: "artifacts/artifact-repository-snapshot.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[1].value, null, 2)}\n`)
    },
    onboardingArtifact: {
      id: checkpoint.artifacts[2].id,
      kind: "onboarding",
      sha256: checkpoint.artifacts[2].sha256,
      storage_key: "artifacts/artifact-onboarding-plan.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[2].value, null, 2)}\n`)
    },
    onboardingPlan
  });
  const interactionPacket = buildLiveAlignmentInteractionPacket({
    operation,
    analysisPlan: analysisPlan.analysisPlan,
    analysisSummary: analysisPlan.summary,
    onboardingSummary: onboardingPlan.summary,
    goalArtifact: {
      id: checkpoint.artifacts[0].id,
      kind: "goal",
      sha256: checkpoint.artifacts[0].sha256,
      storage_key: "artifacts/artifact-goal-input.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[0].value, null, 2)}\n`)
    },
    snapshotArtifact: {
      id: checkpoint.artifacts[1].id,
      kind: "snapshot",
      sha256: checkpoint.artifacts[1].sha256,
      storage_key: "artifacts/artifact-repository-snapshot.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[1].value, null, 2)}\n`)
    },
    onboardingArtifact: {
      id: checkpoint.artifacts[2].id,
      kind: "onboarding",
      sha256: checkpoint.artifacts[2].sha256,
      storage_key: "artifacts/artifact-onboarding-plan.json",
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(checkpoint.artifacts[2].value, null, 2)}\n`)
    }
  });
  await startLiveAlignmentOperation({
    dataRoot,
    repositoryIdentity: snapshot.repository.identity,
    operation,
    analysisPlan: analysisPlan.analysisPlan,
    interactionPacket: interactionPacket.packet,
    status: buildLiveAlignmentStatus(operation, { status: "question-blocked", active_phase: "analysis-plan" }),
    lease: buildLiveAlignmentLease(operation, {
      owner_id: "owner-1",
      boot_id: "boot-1",
      pid: 1234,
      process_birth_id: "birth-1"
    })
  });
  await initializeSupervisorIdentity(supervisorRoot, { now: () => new Date(currentTime) });

  return { dataRoot, supervisorRoot, repositoryIdentity: snapshot.repository.identity, run: checkpoint.run, operation, interactionPacket: interactionPacket.packet };
}

test("answering a blocked question appends a new Goal Run checkpoint and answer artifact", async (t) => {
  const fixture = await createFixture(t);
  const before = JSON.parse(await readFile(runStoragePaths(fixture.dataRoot, fixture.repositoryIdentity, fixture.run.id).current, "utf8"));
  const liveBefore = await loadLiveAlignmentOperationBundle(fixture.dataRoot, fixture.repositoryIdentity, fixture.operation.id);
  const decision = liveBefore.interactionPacket.decisions[0];
  const option = decision.options.find((candidate) => candidate.recommended) ?? decision.options[0];
  const result = await recordAlignmentAnswer({
    dataRoot: fixture.dataRoot,
    supervisorRoot: fixture.supervisorRoot,
    repositoryIdentity: fixture.repositoryIdentity,
    runId: fixture.run.id,
    packetSha256: hashContract(liveBefore.interactionPacket),
    decisionId: decision.id,
    optionId: option.id,
    responseProvider: async (prompt) => `APPROVE ${prompt.match(/APPROVE (\S+)/)?.[1] ?? ""}`,
    now: () => new Date(currentTime)
  });

  const after = JSON.parse(await readFile(runStoragePaths(fixture.dataRoot, fixture.repositoryIdentity, fixture.run.id).current, "utf8"));
  assert.equal(after.sequence, before.sequence + 1);

  const loadAfter = await loadRunInteraction(fixture.dataRoot, fixture.repositoryIdentity, fixture.run.id);
  assert.equal(loadAfter.source_artifacts.some((artifact) => artifact.kind === "developer-answer" && artifact.id === result.answer.id), true);

  const answerSource = await loadRunSourceArtifact(fixture.dataRoot, fixture.repositoryIdentity, fixture.run.id, result.answer.id);
  assert.equal(answerSource.source.kind, "developer-answer");
  assert.equal(answerSource.value.decision_id, decision.id);

  const eventDir = path.join(runStoragePaths(fixture.dataRoot, fixture.repositoryIdentity, fixture.run.id).checkpoints, String(after.sequence).padStart(8, "0"), "events");
  const events = await Promise.all((await readdir(eventDir)).sort().map(async (name) => JSON.parse(await readFile(path.join(eventDir, name), "utf8"))));
  assert.equal(events.some((event) => event.type === "question.answered" && event.data.answer_id === result.answer.id), true);
  assert.equal(result.status.status, "question-blocked");
});

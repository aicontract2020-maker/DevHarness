import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createRunEvent } from "../../core/src/goal-run.mjs";
import { evaluateInteractionPacket } from "../../core/src/interaction-policy.mjs";
import { allowedTransitions } from "../../core/src/state-machine.mjs";
import { assertContract } from "../../project/src/contracts.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { canonicalPath, isWithin } from "../../project/src/path-policy.mjs";
import { projectDataDirectory } from "./data-store.mjs";

const POST_SCOPE_PIPELINE = Object.freeze([
  "clarifying",
  "researching",
  "specifying",
  "awaiting_scope_approval",
  "planning",
  "staffing",
  "executing",
  "verifying"
]);

const ENTRY_STATES = new Set(POST_SCOPE_PIPELINE.slice(0, -1));

function transition(runId, sequence, at, from, to) {
  if (!allowedTransitions(from).includes(to)) {
    throw new Error(`Post-scope advance cannot transition ${from} -> ${to}.`);
  }
  return createRunEvent({ runId, sequence, at, type: "state.transitioned", data: { from, to } });
}

function artifact(id, kind, value) {
  return { id, kind, value, sha256: hashContract(value) };
}

function item(id, text, confidence, severity, sourceRefs) {
  return { id, text, confidence, severity, source_refs: sourceRefs };
}

function requireScopeApproved(run) {
  if (run.gates?.scope?.status !== "approved") {
    throw new Error("Post-scope advance requires gates.scope.status=approved.");
  }
}

function pipelineFrom(state) {
  const index = POST_SCOPE_PIPELINE.indexOf(state);
  if (index < 0 || !ENTRY_STATES.has(state)) {
    throw new Error(`Post-scope advance cannot start from state ${state}.`);
  }
  return POST_SCOPE_PIPELINE.slice(index);
}

function resolveArtifactDirectory({ dataRoot, repositoryIdentity, runId, artifactDir, repositoryRoot }) {
  const defaultDir = path.join(projectDataDirectory(dataRoot, repositoryIdentity), "runs", runId, "delivery");
  const target = canonicalPath(artifactDir ?? defaultDir);
  if (isWithin(repositoryRoot, target)) {
    throw new Error("Post-scope delivery artifacts must be stored outside the consumer repository.");
  }
  return target;
}

function buildReadinessMarkdown({ run, snapshot, plan, summaryPath, verifyCommandId, generatedAt }) {
  const lines = [
    "# Readiness summary",
    "",
    `- Generated at: ${generatedAt}`,
    `- Goal Run: ${run.id}`,
    `- Repository: ${run.repository.identity}`,
    `- Revision: ${run.current_head_sha}`,
    `- Goal: ${run.goal.refined ?? run.goal.original}`,
    `- Scope gate: ${run.gates.scope.status}`,
    "",
    "## Bounded change",
    "",
    "This docs-only delivery writes an external readiness summary. It does not modify consumer product source.",
    "",
    `Summary path: \`${summaryPath}\``,
    "",
    "## Plan",
    "",
    `- Plan id: ${plan.id}`,
    `- Integration owner: ${plan.integration_owner_task_id}`,
    `- Tasks: ${plan.nodes.map((node) => node.task_id).join(", ")}`,
    "",
    "## Repository snapshot",
    "",
    `- Name: ${snapshot.repository.name}`,
    `- Files discovered: ${snapshot.inventory?.file_count ?? "unknown"}`,
    `- Platforms: ${(snapshot.detected?.platforms ?? []).join(", ") || "none"}`,
    "",
    "## Next verify",
    "",
    verifyCommandId
      ? `Run \`devharness verify --run ${run.id} --command ${verifyCommandId} --execute --attest\` with current capability authority.`
      : `Declare a quality command, then run \`devharness verify --run ${run.id} --command <id> --execute --attest\`.`,
    ""
  ];
  return `${lines.join("\n")}\n`;
}

/**
 * After gates.scope is approved, advance a Goal Run through planning → staffing →
 * executing → verifying, write an external docs-only readiness summary, and publish
 * a progress packet that points at verify.
 */
export async function createPostScopeAdvanceCheckpoint({
  run,
  snapshot,
  dataRoot,
  priorArtifacts = [],
  artifactDir = null,
  verifyCommandId = null,
  nextSequence,
  generatedAt = new Date().toISOString()
}) {
  await assertContract("goal-run", run);
  requireScopeApproved(run);
  if (!Number.isInteger(nextSequence) || nextSequence < 2) {
    throw new Error("Post-scope advance requires the next event sequence.");
  }
  if (!snapshot?.repository?.identity || !snapshot?.repository?.root_uri || !snapshot?.repository?.git) {
    throw new Error("Post-scope advance requires a repository snapshot.");
  }
  if (snapshot.repository.identity !== run.repository.identity) {
    throw new Error("Repository identity does not match the Goal Run.");
  }
  if (snapshot.repository.git.dirty || !snapshot.repository.git.head_sha) {
    throw new Error("Post-scope advance requires a clean committed repository snapshot.");
  }
  if (snapshot.repository.git.head_sha !== run.current_head_sha) {
    throw new Error("Repository revision does not match the Goal Run revision.");
  }

  const onboarding = priorArtifacts.find((entry) => entry.id === "artifact-onboarding-plan");
  if (!onboarding) {
    throw new Error("Post-scope advance requires the current onboarding-plan source artifact.");
  }

  const repositoryRoot = canonicalPath(fileURLToPath(snapshot.repository.root_uri));
  const deliveryDir = resolveArtifactDirectory({
    dataRoot,
    repositoryIdentity: run.repository.identity,
    runId: run.id,
    artifactDir,
    repositoryRoot
  });
  await mkdir(deliveryDir, { recursive: true, mode: 0o700 });
  const summaryPath = path.join(deliveryDir, "readiness-summary.md");

  const plan = {
    schema_version: 1,
    id: `plan-post-scope-${run.id.slice(-12)}`,
    run_id: run.id,
    head_sha: run.current_head_sha,
    max_parallelism: 1,
    integration_owner_task_id: "task-write-readiness-summary",
    progress_interval_seconds: 60,
    nodes: [{
      task_id: "task-write-readiness-summary",
      depends_on: [],
      expected_duration_seconds: 30,
      resources: [
        { kind: "path", id: "delivery/readiness-summary.md", mode: "exclusive" },
        { kind: "workspace", id: "workspace-post-scope", mode: "exclusive" },
        { kind: "external", id: "git:integration-branch", mode: "exclusive" }
      ],
      workspace_id: "workspace-post-scope",
      proof_criterion_ids: ["criterion-readiness-summary"],
      long_running: false
    }]
  };
  await assertContract("execution-plan", plan);

  const markdown = buildReadinessMarkdown({
    run,
    snapshot,
    plan,
    summaryPath,
    verifyCommandId,
    generatedAt
  });
  await writeFile(summaryPath, markdown, { encoding: "utf8", mode: 0o600 });

  const readinessRecord = {
    schema_version: 1,
    kind: "readiness-summary",
    run_id: run.id,
    head_sha: run.current_head_sha,
    generated_at: generatedAt,
    path: summaryPath,
    content_sha256: hashContract(markdown),
    consumer_mutation: false,
    verify_command_id: verifyCommandId
  };

  const planArtifact = artifact("artifact-execution-plan", "execution-plan", plan);
  const readinessArtifact = artifact("artifact-readiness-summary", "readiness-summary", readinessRecord);
  const carried = priorArtifacts.filter((entry) =>
    ["artifact-onboarding-plan", "artifact-goal-input", "artifact-repository-snapshot"].includes(entry.id)
  );
  const byId = new Map(carried.map((entry) => [entry.id, entry]));
  byId.set(planArtifact.id, planArtifact);
  byId.set(readinessArtifact.id, readinessArtifact);
  if (!byId.has("artifact-goal-input")) {
    byId.set("artifact-goal-input", artifact("artifact-goal-input", "goal-input", {
      run_id: run.id,
      original_goal: run.goal.original,
      scope_version: run.goal.scope_version
    }));
  }
  if (!byId.has("artifact-repository-snapshot")) {
    byId.set("artifact-repository-snapshot", artifact("artifact-repository-snapshot", "repository-snapshot", snapshot));
  }
  const artifacts = [...byId.values()];

  const pipeline = pipelineFrom(run.state);
  const events = [];
  let sequence = nextSequence;
  let from = run.state;
  for (let index = 1; index < pipeline.length; index += 1) {
    const to = pipeline[index];
    events.push(transition(run.id, sequence, generatedAt, from, to));
    sequence += 1;
    if (to === "planning") {
      events.push(createRunEvent({
        runId: run.id,
        sequence,
        at: generatedAt,
        type: "plan.proposed",
        data: { plan_id: plan.id, plan_sha256: planArtifact.sha256 }
      }));
      sequence += 1;
    }
    if (to === "staffing") {
      events.push(createRunEvent({
        runId: run.id,
        sequence,
        at: generatedAt,
        type: "team.staffed",
        data: { plan_id: plan.id, crew: ["runtime-orchestrator"] }
      }));
      sequence += 1;
    }
    if (to === "executing") {
      events.push(createRunEvent({
        runId: run.id,
        sequence,
        at: generatedAt,
        type: "task.dispatched",
        data: { task_id: "task-write-readiness-summary", plan_id: plan.id }
      }));
      sequence += 1;
      events.push(createRunEvent({
        runId: run.id,
        sequence,
        at: generatedAt,
        type: "artifact.written",
        data: { artifact_id: readinessArtifact.id, sha256: readinessArtifact.sha256, path: summaryPath }
      }));
      sequence += 1;
      events.push(createRunEvent({
        runId: run.id,
        sequence,
        at: generatedAt,
        type: "task.finished",
        data: { task_id: "task-write-readiness-summary", outcome: "pass" }
      }));
      sequence += 1;
    }
    from = to;
  }

  const sections = [
    {
      id: "post-scope-plan",
      title: "Post-scope plan",
      items: [
        item(
          "post-scope-plan-summary",
          `Bounded plan ${plan.id} staffs one docs-only delivery task at revision ${run.current_head_sha.slice(0, 12)}.`,
          "confirmed",
          "info",
          [planArtifact.id]
        )
      ]
    },
    {
      id: "post-scope-change",
      title: "Bounded change",
      items: [
        item(
          "post-scope-readiness-summary",
          `Wrote external readiness summary at ${summaryPath} without modifying the consumer repository.`,
          "confirmed",
          "info",
          [readinessArtifact.id]
        )
      ]
    },
    {
      id: "post-scope-verify",
      title: "Verify next",
      items: [
        item(
          "post-scope-verify-next",
          verifyCommandId
            ? `Next: verify --command ${verifyCommandId} --execute --attest under current capability authority.`
            : "Next: choose a declared quality command and run verify --execute --attest.",
          "confirmed",
          "info",
          [readinessArtifact.id, onboarding.id]
        )
      ]
    }
  ];
  const surfacedItems = sections.flatMap((section) => section.items);
  const packetBody = {
    schema_version: 1,
    run_id: run.id,
    kind: "progress-pulse",
    generated_at: generatedAt,
    head_sha: run.current_head_sha,
    title: `Post-scope delivery · ${run.goal.original}`,
    verdict: "informational",
    summary: "Scope is approved. A bounded external readiness summary was written; verify is the next governed step.",
    attention: { required: false, count: 0, reasons: [] },
    sections,
    decisions: [],
    actions: [{ id: "inspect-post-scope", label: "Inspect post-scope plan and readiness summary", kind: "inspect", recommended: true }],
    source_artifacts: artifacts.map((entry) => ({
      id: entry.id,
      kind: entry.kind,
      sha256: entry.sha256,
      uri: `artifacts/${entry.id}.json`
    })),
    traceability: surfacedItems.map((entry) => ({ item_id: entry.id, source_refs: entry.source_refs })),
    compression: {
      source_artifact_count: artifacts.length,
      surfaced_item_count: surfacedItems.length,
      omitted_item_count: 0
    }
  };
  const packet = { ...packetBody, id: `packet-${hashContract(packetBody).slice(0, 32)}` };
  await assertContract("interaction-packet", packet);
  const packetPolicy = evaluateInteractionPacket(packet);
  if (!packetPolicy.valid) {
    throw new Error(`Interaction packet policy failed: ${packetPolicy.reasons.map((reason) => reason.code).join(", ")}`);
  }

  events.push(createRunEvent({
    runId: run.id,
    sequence,
    at: generatedAt,
    type: "interaction.published",
    data: { packet_id: packet.id, packet_sha256: hashContract(packet) }
  }));

  const nextRun = structuredClone(run);
  nextRun.state = "verifying";
  nextRun.timestamps.updated_at = generatedAt;

  return {
    run: nextRun,
    events,
    packet,
    artifacts,
    delivery: {
      summary_path: summaryPath,
      plan_id: plan.id,
      verify_command_id: verifyCommandId
    }
  };
}

export function postScopeAdvanceSupported(run) {
  return run?.gates?.scope?.status === "approved" && ENTRY_STATES.has(run?.state);
}

export { POST_SCOPE_PIPELINE, ENTRY_STATES as POST_SCOPE_ENTRY_STATES };

#!/usr/bin/env node

import process from "node:process";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createInitialGoalRun, createRunEvent } from "../../core/src/goal-run.mjs";
import { createReviewScorecard } from "../../core/src/review-scorecard.mjs";
import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { evaluateVerificationExecutionAuthority } from "../../core/src/execution-authority.mjs";
import { assertContract } from "../../project/src/contracts.mjs";
import { discoverRepository } from "../../project/src/discover.mjs";
import { readProjectConfig, readProjectConfigFile } from "../../project/src/config.mjs";
import { evaluateReadiness, formatReadinessReport } from "../../project/src/doctor.mjs";
import { initializeProject, proposeProjectConfig } from "../../project/src/init.mjs";
import { createProjectDeclarationReview } from "../../project/src/project-declaration-review.mjs";
import { compileProjectHarness, formatProjectHarness } from "../../project/src/harness.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { createOnboardingPlan, formatRepositoryUnderstandingBrief } from "../../project/src/onboard.mjs";
import { createValidatedPhase1UnderstandingBundleFromOnboardingPlan, formatAuditableUnderstandingBrief } from "../../project/src/understanding-baseline.mjs";
import { createGoalUnderstandingCheckpoint } from "../../project/src/alignment.mjs";
import { resolveExternalDataRoot } from "../../project/src/path-policy.mjs";
import { defaultDataRoot, defaultSupervisorRoot, onboardingPlanPath, understandingBaselinePath, systemModelPath, designStrategyPath, projectHarnessPath, writeOnboardingPlan, writeUnderstandingBaseline, writeSystemModel, writeDesignStrategy, writeProjectHarness } from "../../runtime/src/data-store.mjs";
import { loadRunInteraction, loadRunSourceArtifact, appendGoalRunCheckpoint, createStoredGoalRun, loadGoalRun, loadRunScorecard, runStoragePaths } from "../../runtime/src/goal-run-store.mjs";
import {
  buildLiveAlignmentLease,
  buildLiveAlignmentAnalysisPlan,
  buildLiveAlignmentInteractionPacket,
  buildLiveAlignmentOperation,
  buildLiveAlignmentStatus,
  createLiveAlignmentArtifactRefs,
  findLiveAlignmentOperationBundleByRun,
  loadLiveAlignmentOperationBundle,
  projectLiveAlignmentOperationStatus,
  retryLiveAlignmentOperation,
  cancelLiveAlignmentOperation,
  startLiveAlignmentOperation,
  stableLiveAlignmentExecutionId
} from "../../runtime/src/live-alignment.mjs";
import { continueLiveAlignmentOperation, unresolvedLiveAlignmentDecisions } from "../../runtime/src/live-alignment-continue.mjs";
import { AgentAdapterRegistry } from "../../runtime/src/agent-adapter.mjs";
import { loadResearchRecipesForContinue } from "../../runtime/src/research-recipes.mjs";
import { registerBuiltinAgentAdapters, LOCAL_READONLY_ADAPTER_ID } from "../../../adapters/agents/index.mjs";
import {
  CODEX_ADAPTER_ID,
  CODEX_READONLY_PROFILE_ID,
  defaultCodexProfile,
  resolveAlignAgentSelection,
  resolveProviderCredential
} from "../../runtime/src/codex-runtime.mjs";
import { recordAlignmentAnswer } from "../../runtime/src/alignment-answer.mjs";
import { issueCommandSystemEvidence, issueCommandTestEvidence } from "../../runtime/src/supervisor-evidence.mjs";
import { createSupervisorApprovalRequest, listPendingApprovalRequestsForRun, recordInteractiveApprovalDecisions } from "../../runtime/src/supervisor-approval.mjs";
import { applyRunGateFromApprovalReceipt, reconcileRunGatesFromApprovals } from "../../runtime/src/run-gate-approval.mjs";
import { initializeSupervisorIdentity } from "../../runtime/src/supervisor-store.mjs";
import { findApprovedVcsWrite, loadCapabilityAuthorizationView, requestCapabilityAuthorization, resolveCapabilityApprovalContext } from "../../runtime/src/capability-authorization.mjs";
import { requestMissingVerifyCapabilities, resolveVerifyDefaultsFromReadiness, summarizeVerifyCapabilityGap } from "../../runtime/src/verify-capabilities.mjs";
import {
  pickConservativeInferAnswers,
  requestMissingAlignCapabilities,
  summarizeAlignCapabilityGap,
  alignCompressionHints
} from "../../runtime/src/align-capabilities.mjs";
import { createVerificationPlan, executeVerificationPlan, formatVerificationPlan } from "../../runtime/src/verify.mjs";
import { createPostScopeAdvanceCheckpoint, postScopeAdvanceSupported } from "../../runtime/src/post-scope-advance.mjs";
import { proposeControlledChangeWithAgent } from "../../runtime/src/change-proposal.mjs";
import { selectVerifyCommandId, verifyHintFromReadiness } from "../../runtime/src/select-verify-command.mjs";
import {
  createDeliveryAdvanceCheckpoint,
  deliveryAdvanceSupported
} from "../../runtime/src/delivery-advance.mjs";
import {
  defaultPromoteBranchName,
  promoteControlledChange,
  promoteSupported
} from "../../runtime/src/promote-change.mjs";
import { startReviewServer } from "../../runtime/src/review-server.mjs";

const HELP = `DevHarness

Usage:
  devharness onboard [--repo PATH] [--config PATH] [--write] [--format text|json]
  devharness init [--repo PATH] [--write] [--format text|json]
  devharness doctor [--repo PATH] [--config PATH] [--format text|json]
  devharness build [--repo PATH] [--config PATH] [--write] [--format text|json]
  devharness supervisor-init [--format text|json]
  devharness request-approval --run ID --gate GATE --subject ID --subject-sha SHA [--repo PATH]
  devharness request-capability --run ID (--capability ID | --for-verify [--command ID] [--commit SHA] [--approve] | --for-align [--approve]) [--expires-minutes N] [--repo PATH] [--data-dir PATH]
  devharness approve (--request ID [--request ID ...] | --run ID --pending) [--repo PATH] [--data-dir PATH]
  devharness verify --command ID [--repo PATH] [--config PATH] [--data-dir PATH] [--run ID --execute] [--commit SHA] [--attest] [--timeout-seconds N] [--format text|json]
  devharness goal --goal TEXT [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness advance --run ID [--mode docs-only|controlled-change] [--change-json PATH | --agent-propose [--agent ID]] [--repo PATH] [--data-dir PATH] [--artifact-dir PATH] [--command ID] [--format text|json]
  devharness align --run ID [--continue|--tick] [--agent ID] [--agent-profile ID] [--research-recipes PATH] [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness answer --run ID (--infer-conservative | --decision ID --option ID [...]) [--packet SHA] [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness request-scope --run ID [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness request-delivery --run ID [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness promote --run ID [--branch NAME] [--base BRANCH] [--push] [--pr] [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness retry --run ID --operation ID [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness cancel --run ID --operation ID [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness status --run ID [--repo PATH] [--data-dir PATH] [--format text|json]
  devharness review [--repo PATH] [--config PATH] [--data-dir PATH] [--port N] [--ui-origin URL] [--allow-dirty]

Commands:
  onboard   Produce a read-only understanding and bounded capability plan. --write stores it externally.
  init      Inspect a repository and propose devharness.yaml. Does not write unless --write is present.
  doctor    Produce a read-only deterministic autonomous-development readiness report.
  build     Compile the accepted project declaration. Does not write unless --write is present.
  supervisor-init  Create or load the fixed external signing identity. Never exposes its private key.
  request-approval Create a signed, revision-bound pending request; this does not approve it.
  request-capability Request bounded capability approval from the current Goal Run plan.
             --capability ID requests one. --for-verify requests every capability still blocking the current verify plan (from readiness/--command/--commit), optionally --approve in one TTY batch.
             --for-align requests research/network capabilities still blocking live Alignment, optionally --approve in one TTY batch.
             Defaults: agent-runtime/vcs-write 720m, network-research 480m, others 60m (max 1440). Re-request expired/stale without losing the Goal Run.
             After Gate 1, request vcs-write then TTY-approve before advance --mode controlled-change.
  approve    Record one or more decisions in a single foreground TTY confirmation (--request repeated, or --run + --pending). JSON and pipes are refused; never silently auto-approves.
  verify    Plan an isolated command. Execution requires a Goal Run and its current signed capabilities.
  goal      Create a durable Goal Run at the current committed revision. Does not execute an agent.
  advance   Perform the next safe Goal Run step: static understanding from received, post-scope plan→change→verify prep after Gate 1, or Delivery Brief prep after a ready tip scorecard.
             --mode docs-only (default) writes an external readiness summary. --mode controlled-change requires approved vcs-write and commits a bounded change in an isolated worktree.
             For controlled-change, pass --change-json PATH or --agent-propose (Codex/local agent proposes a validated changeSpec; runtime still applies it).
             If --command is omitted, advance picks a declared quality command from the harness when the goal/change uniquely matches.
  align     Bootstrap a live Alignment bundle, or tick it with --continue after answers/approvals.
             --continue loads exact HTTPS recipes from --research-recipes or <config-dir>/research-recipes.json
             and registers builtin adapters: codex (real Codex CLI + parent provider proxy) and
             devharness-cli-local-agent (local-readonly stub). Default is Codex when the CLI and
             OPENAI_API_KEY/DEVHARNESS_PROVIDER_CREDENTIAL are configured; otherwise local-readonly.
             --agent codex forces Codex; --agent devharness-cli-local-agent forces the stub.
  request-scope Request scope approval for a ready Alignment Brief.
  request-delivery Request Gate 2 delivery approval for a ready Delivery Brief.
  promote   After Gate 2, publish the isolated controlled-change commit onto a branch (optional --push/--pr). Never force-pushes or merges.
  retry     Retry the last failed live Alignment phase once.
  cancel    Cancel the current live Alignment operation through the shared fence.
  status    Restore one Goal Run from its event stream and show a compact current verdict.
  review    Start a token-protected, read-only loopback service for the developer review page.
`;

function parseArguments(argv) {
  if (argv[0] === "--help" || argv[0] === "-h") {
    return { command: "help", repo: process.cwd(), format: "text", write: false, execute: false };
  }
  const options = {
    command: argv[0],
    repo: process.cwd(),
    format: "text",
    write: false,
    execute: false,
    attest: false,
    commandId: null,
  goal: null,
  runId: null,
  agentId: null,
  agentProfileId: null,
  decisionId: null,
  optionId: null,
    packetSha256: null,
    gate: null,
    subjectId: null,
    subjectSha256: null,
    operationId: null,
    requestId: null,
    requestIds: [],
    pending: false,
    answerPairs: [],
    capabilityId: null,
    configPath: null,
    expiresInMinutes: null,
    timeoutMs: 10 * 60 * 1000,
    port: 4317,
    uiOrigin: "http://localhost:3000",
    dataRoot: defaultDataRoot(),
    allowDirty: false,
    continueLive: false,
    researchRecipesPath: null,
    artifactDir: null,
    deliveryMode: "docs-only",
    branchName: null,
    baseRef: null,
    push: false,
    createPr: false,
    changeJsonPath: null,
    commitSha: null
  };

  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--write") {
      options.write = true;
    } else if (argument === "--continue" || argument === "--tick") {
      options.continueLive = true;
    } else if (argument === "--execute") {
      options.execute = true;
    } else if (argument === "--attest") {
      options.attest = true;
    } else if (argument === "--command") {
      options.commandId = argv[++index];
      if (!options.commandId) throw new Error("--command requires a configured command id");
    } else if (argument === "--goal") {
      options.goal = argv[++index];
      if (!options.goal?.trim()) throw new Error("--goal requires a non-empty outcome");
    } else if (argument === "--run") {
      options.runId = argv[++index];
      if (!options.runId) throw new Error("--run requires a run id");
    } else if (argument === "--agent") {
      options.agentId = argv[++index];
      if (!options.agentId) throw new Error("--agent requires an agent id");
    } else if (argument === "--agent-profile") {
      options.agentProfileId = argv[++index];
      if (!options.agentProfileId) throw new Error("--agent-profile requires an agent profile id");
    } else if (argument === "--decision") {
      const decisionId = argv[++index];
      if (!decisionId) throw new Error("--decision requires a decision id");
      options.decisionId = decisionId;
      options.answerPairs.push({ decisionId, optionId: null });
    } else if (argument === "--option") {
      const optionId = argv[++index];
      if (!optionId) throw new Error("--option requires an option id");
      options.optionId = optionId;
      const open = [...options.answerPairs].reverse().find((pair) => pair.optionId == null);
      if (!open) throw new Error("--option requires a preceding --decision");
      open.optionId = optionId;
    } else if (argument === "--packet") {
      options.packetSha256 = argv[++index];
      if (!options.packetSha256) throw new Error("--packet requires a packet digest");
    } else if (argument === "--gate") {
      options.gate = argv[++index];
      if (!options.gate) throw new Error("--gate requires a gate name");
    } else if (argument === "--subject") {
      options.subjectId = argv[++index];
      if (!options.subjectId) throw new Error("--subject requires an artifact id");
    } else if (argument === "--subject-sha") {
      options.subjectSha256 = argv[++index];
      if (!options.subjectSha256) throw new Error("--subject-sha requires a canonical SHA-256 hash");
    } else if (argument === "--request") {
      const requestId = argv[++index];
      if (!requestId) throw new Error("--request requires an approval request id");
      options.requestIds.push(requestId);
      if (!options.requestId) options.requestId = requestId;
    } else if (argument === "--change-json") {
      options.changeJsonPath = argv[++index];
      if (!options.changeJsonPath) throw new Error("--change-json requires a path");
    } else if (argument === "--agent-propose") {
      options.agentPropose = true;
    } else if (argument === "--branch") {
      options.branchName = argv[++index];
      if (!options.branchName) throw new Error("--branch requires a name");
    } else if (argument === "--base") {
      options.baseRef = argv[++index];
      if (!options.baseRef) throw new Error("--base requires a branch name");
    } else if (argument === "--push") {
      options.push = true;
    } else if (argument === "--pr") {
      options.createPr = true;
    } else if (argument === "--pending") {
      options.pending = true;
    } else if (argument === "--operation") {
      options.operationId = argv[++index];
      if (!options.operationId) throw new Error("--operation requires an operation id");
    } else if (argument === "--capability") {
      options.capabilityId = argv[++index];
      if (!options.capabilityId) throw new Error("--capability requires a capability id");
    } else if (argument === "--for-verify") {
      options.forVerify = true;
    } else if (argument === "--for-align") {
      options.forAlign = true;
    } else if (argument === "--infer-conservative") {
      options.inferConservative = true;
    } else if (argument === "--approve") {
      options.approveAfterRequest = true;
    } else if (argument === "--expires-minutes") {
      options.expiresInMinutes = Number(argv[++index]);
      if (!Number.isInteger(options.expiresInMinutes)) throw new Error("--expires-minutes requires an integer");
    } else if (argument === "--timeout-seconds") {
      const seconds = Number(argv[++index]);
      if (!Number.isInteger(seconds)) throw new Error("--timeout-seconds requires an integer");
      options.timeoutMs = seconds * 1000;
    } else if (argument === "--port") {
      options.port = Number(argv[++index]);
      if (!Number.isInteger(options.port) || options.port < 1024 || options.port > 65535) throw new Error("--port requires an integer from 1024 to 65535");
    } else if (argument === "--ui-origin") {
      const value = argv[++index];
      if (!value) throw new Error("--ui-origin requires an HTTP origin");
      const parsed = new URL(value);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== value) throw new Error("--ui-origin must be an exact HTTP origin without a path");
      options.uiOrigin = parsed.origin;
    } else if (argument === "--mode") {
      options.deliveryMode = argv[++index];
      if (!["docs-only", "controlled-change"].includes(options.deliveryMode)) {
        throw new Error("--mode must be docs-only or controlled-change");
      }
    } else if (argument === "--commit") {
      options.commitSha = argv[++index];
      if (!options.commitSha || !/^[0-9a-f]{40}([0-9a-f]{24})?$/.test(options.commitSha)) {
        throw new Error("--commit requires a full Git commit SHA");
      }
    } else if (argument === "--artifact-dir") {
      options.artifactDir = argv[++index];
      if (!options.artifactDir) throw new Error("--artifact-dir requires a path");
    } else if (argument === "--data-dir") {
      options.dataRoot = argv[++index];
      if (!options.dataRoot) throw new Error("--data-dir requires a path");
    } else if (argument === "--research-recipes") {
      options.researchRecipesPath = argv[++index];
      if (!options.researchRecipesPath) throw new Error("--research-recipes requires a path");
    } else if (argument === "--allow-dirty") {
      options.allowDirty = true;
    } else if (argument === "--repo") {
      options.repo = argv[++index];
      if (!options.repo) throw new Error("--repo requires a path");
    } else if (argument === "--config") {
      options.configPath = argv[++index];
      if (!options.configPath) throw new Error("--config requires a path");
    } else if (argument === "--format") {
      options.format = argv[++index];
      if (!options.format) throw new Error("--format requires text or json");
    } else if (argument === "--help" || argument === "-h") {
      options.command = "help";
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  if (!['text', 'json'].includes(options.format)) {
    throw new Error("--format must be text or json");
  }
  return options;
}

async function loadConfiguredProject(snapshot, options) {
  const repositoryRoot = fileURLToPath(snapshot.repository.root_uri);
  if (!options.configPath) {
    return { ...(await readProjectConfig(repositoryRoot)), source: "tracked" };
  }
  const loaded = await readProjectConfigFile(options.configPath);
  const relative = path.relative(repositoryRoot, loaded.path);
  const insideRepository = relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
  if (insideRepository) {
    throw new Error("--config must point outside the consumer repository so local testing cannot modify project files.");
  }
  return { ...loaded, source: "external" };
}

function nextRunAction(run) {
  if (run.state === "received") return "Understand the repository and define falsifiable acceptance criteria.";
  if (run.state === "clarifying" && run.gates?.scope?.status === "approved") {
    return "Scope is approved. Run `devharness advance --run ID` to plan, write the bounded external change, and prepare verify.";
  }
  if (run.state === "clarifying") return "Review the Alignment Brief, then authorize the missing proof capabilities before scope definition.";
  if (run.state === "awaiting_scope_approval") return "Review the Alignment Brief and decide the scope gate.";
  if (run.state === "planning" || run.state === "staffing" || run.state === "executing") {
    return "Continue the governed post-scope step with `devharness advance --run ID`.";
  }
  if (run.state === "verifying") {
    return "If verification already attested and the tip scorecard is ready, run `devharness advance --run ID` to open Gate 2; otherwise verify --execute --attest first.";
  }
  if (run.state === "awaiting_delivery_approval") return "Review the Delivery Brief and decide the delivery gate.";
  if (run.state === "completed") {
    return "Inspect the final verdict, or run `devharness promote --run ID` to publish an isolated controlled-change onto a branch (add --push/--pr as needed).";
  }
  if (["blocked", "cancelled"].includes(run.state)) return "Inspect the final verdict and its evidence.";
  return "Continue the governed Goal Run from its recorded state.";
}

function nextLiveAction(status, { scopeApproved = false } = {}) {
  if (!status) return "Inspect the live Alignment bundle.";
  if (status.status === "waiting-agent-authority") return "Approve the exact agent authority, then continue the live operation.";
  if (status.status === "waiting-research-authority") return "Approve research authority (`devharness request-capability --run ID --for-align --approve`), then continue.";
  if (status.status === "running") return "Let the live operation continue. Run `devharness align --continue --run ID` to tick it.";
  if (status.status === "question-blocked") return "Answer blocked questions (`devharness answer --run ID --infer-conservative`), then continue.";
  if (status.status === "ready") {
    return scopeApproved
      ? "Scope is approved. Run `devharness advance --run ID` for post-scope plan→change→verify prep, or inspect the Alignment Brief."
      : "Review the ready Alignment Brief and decide whether to approve scope.";
  }
  if (status.status === "failed") return "Retry the failed phase or cancel the operation if the goal changed.";
  if (status.status === "timed-out") return "Retry or cancel the timed-out operation.";
  if (status.status === "cancelled") return "Start a new Goal Run if the work is still desired.";
  return "Continue the live operation.";
}

function liveAlignmentLimits() {
  return {
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
}

function liveAlignmentResultContractSha256() {
  return createHash("sha256").update("devharness-live-alignment-result-contract-v1").digest("hex");
}

function liveAlignmentDescriptor({ agentId = "devharness-cli-local-agent", agentProfileId = "codex-readonly-analysis-v1" } = {}) {
  const descriptor = {
    schema_version: 1,
    id: agentId,
    version: "devharness-cli-local-live-v1",
    protocol_version: 1,
    profile_id: agentProfileId,
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
    implementation_sha256: createHash("sha256").update("devharness-cli-live-alignment-implementation").digest("hex"),
    executable_sha256: createHash("sha256").update(process.execPath).digest("hex"),
    profile_template_sha256: createHash("sha256").update("devharness-cli-live-alignment-profile-template").digest("hex"),
    control_plane_origins: ["https://devharness.local"],
    descriptor_sha256: "pending"
  };
  descriptor.descriptor_sha256 = createHash("sha256").update(JSON.stringify({
    ...descriptor,
    descriptor_sha256: null
  })).digest("hex");
  return descriptor;
}

function liveAlignmentAuthoritySubject({ run, descriptor, inputCheckpointSha256 }) {
  return {
    id: "agent-runtime-subject-cli",
    sha256: createHash("sha256").update(JSON.stringify({
      schema_version: 1,
      repository_identity: run.repository.identity,
      commit_sha: run.current_head_sha,
      run_id: run.id,
      descriptor_sha256: descriptor.descriptor_sha256,
      input_checkpoint_sha256: inputCheckpointSha256,
      profile_id: descriptor.profile_id,
      model_id: descriptor.model_id
    })).digest("hex")
  };
}

async function loadCurrentLiveAlignmentBundle(dataRoot, repositoryIdentity, runId, { agentId = "devharness-cli-local-agent", agentProfileId = "codex-readonly-analysis-v1", agentDescriptor = null } = {}) {
  const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
  if (run.state !== "clarifying") return null;
  const existing = await findLiveAlignmentOperationBundleByRun(dataRoot, repositoryIdentity, runId, run.current_head_sha);
  if (existing) {
    const interaction = await loadRunInteraction(dataRoot, repositoryIdentity, runId);
    let summary = null;
    if (interaction) {
      const sources = new Map(interaction.source_artifacts.map((source) => [source.kind, source]));
      const goalSource = sources.get("goal-input") ?? null;
      const snapshotSource = sources.get("repository-snapshot") ?? null;
      const onboardingSource = sources.get("onboarding-plan") ?? null;
      if (goalSource && snapshotSource && onboardingSource) {
        const [{ value: goalValue }, { value: snapshotValue }, { value: onboardingPlanValue }] = await Promise.all([
          loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, goalSource.id),
          loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, snapshotSource.id),
          loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, onboardingSource.id)
        ]);
        const computed = buildLiveAlignmentAnalysisPlan({
          operation: existing.operation,
          goalArtifact: {
            id: goalSource.id,
            kind: "goal",
            sha256: goalSource.sha256,
            storage_key: goalSource.uri,
            media_type: "application/json",
            size_bytes: Buffer.byteLength(`${JSON.stringify(goalValue, null, 2)}\n`)
          },
          snapshotArtifact: {
            id: snapshotSource.id,
            kind: "snapshot",
            sha256: snapshotSource.sha256,
            storage_key: snapshotSource.uri,
            media_type: "application/json",
            size_bytes: Buffer.byteLength(`${JSON.stringify(snapshotValue, null, 2)}\n`)
          },
          onboardingArtifact: {
            id: onboardingSource.id,
            kind: "onboarding",
            sha256: onboardingSource.sha256,
            storage_key: onboardingSource.uri,
            media_type: "application/json",
            size_bytes: Buffer.byteLength(`${JSON.stringify(onboardingPlanValue, null, 2)}\n`)
          },
          onboardingPlan: onboardingPlanValue
        });
        summary = computed.summary;
      }
    }
    return { run, interaction, ...existing, summary: summary ?? existing.summary ?? null };
  }
  const interaction = await loadRunInteraction(dataRoot, repositoryIdentity, runId);
  if (!interaction) return null;
  const sources = new Map(interaction.source_artifacts.map((source) => [source.kind, source]));
  const required = [
    { sourceKind: "goal-input", refKind: "goal" },
    { sourceKind: "repository-snapshot", refKind: "snapshot" },
    { sourceKind: "onboarding-plan", refKind: "onboarding" }
  ];
  const loaded = {};
  let onboardingPlanValue = null;
  for (const { sourceKind, refKind } of required) {
    const source = sources.get(sourceKind);
    if (!source) throw new Error(`Current Alignment packet is missing the ${sourceKind} source artifact.`);
    const { value } = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, source.id);
    if (refKind === "onboarding") onboardingPlanValue = value;
    loaded[refKind] = {
      id: source.id,
      kind: refKind,
      sha256: source.sha256,
      storage_key: source.uri,
      media_type: "application/json",
      size_bytes: Buffer.byteLength(`${JSON.stringify(value, null, 2)}\n`)
    };
  }
  const developerAnswers = interaction.source_artifacts
    .filter((source) => source.kind === "developer-answer")
    .map((source) => ({
      id: source.id,
      kind: "developer-answer",
      sha256: source.sha256,
      storage_key: source.uri,
      media_type: "application/json",
      size_bytes: 0
    }));
  const descriptor = agentDescriptor ?? liveAlignmentDescriptor({ agentId, agentProfileId });
  await assertContract("agent-runtime", descriptor);
  const inputCheckpointSha256 = createHash("sha256").update(JSON.stringify({
    run_id: run.id,
    head_sha: run.current_head_sha,
    packet_sha256: createHash("sha256").update(JSON.stringify(interaction)).digest("hex"),
    source_ids: interaction.source_artifacts.map((source) => source.id)
  })).digest("hex");
  const operation = buildLiveAlignmentOperation({
    run,
    goalArtifact: loaded.goal,
    snapshotArtifact: loaded.snapshot,
    onboardingArtifact: loaded.onboarding,
    agentDescriptor: descriptor,
    agentAuthoritySubject: liveAlignmentAuthoritySubject({ run, descriptor, inputCheckpointSha256 }),
    resultContractSha256: liveAlignmentResultContractSha256(),
    limits: liveAlignmentLimits(),
    developerAnswerArtifacts: developerAnswers,
    inputCheckpointSha256
  });
  const { analysisPlan, summary } = buildLiveAlignmentAnalysisPlan({
    operation,
    goalArtifact: loaded.goal,
    snapshotArtifact: loaded.snapshot,
    onboardingArtifact: loaded.onboarding,
    onboardingPlan: onboardingPlanValue
  });
  const interactionPacket = buildLiveAlignmentInteractionPacket({
    operation,
    analysisPlan,
    analysisSummary: summary,
    onboardingSummary: onboardingPlanValue.summary,
    goalArtifact: loaded.goal,
    snapshotArtifact: loaded.snapshot,
    onboardingArtifact: loaded.onboarding
  });
  return {
    run,
    interaction,
    operation,
    analysisPlan,
    interactionPacket: interactionPacket.packet,
    summary,
    goalArtifact: loaded.goal,
    snapshotArtifact: loaded.snapshot,
    onboardingArtifact: loaded.onboarding,
    developerAnswers,
    descriptor,
    inputCheckpointSha256
  };
}

export function formatVerificationExecutionResult({ receipt, receiptPath, evidence = null, attestation, format = "text" }) {
  const result = {
    receipt,
    evidence_manifest: evidence?.manifest ?? null,
    attestation
  };
  if (format === "json") return JSON.stringify(result, null, 2);
  const lines = [
    `${receipt.outcome.status.toUpperCase()}: ${receipt.outcome.summary}`,
    `Receipt: ${receiptPath}`
  ];
  if (evidence) {
    lines.push(`Supervisor evidence: ${evidence.manifest.id}`);
    lines.push(`Issuer: ${evidence.manifest.issuer.fingerprint}`);
  } else if (attestation?.status === "not-issued") {
    lines.push(`Passing evidence: not issued (${attestation.summary})`);
  }
  return lines.join("\n");
}

function initialScorecard(run, generatedAt) {
  const scopeHash = createHash("sha256").update(JSON.stringify({ goal: run.goal.original, scope_version: 1 })).digest("hex");
  return createReviewScorecard({
    run,
    scopeHash,
    harnessVersion: "unbound",
    title: `Goal received: ${run.goal.original}`,
    reviewVerdicts: [],
    reviewChecks: [],
    findings: [],
    unknowns: [
      { id: "understanding-missing", title: "Repository understanding not proved", summary: "The Goal Run has not completed revision-bound system understanding." },
      { id: "acceptance-missing", title: "Acceptance criteria not defined", summary: "The Goal Run has not defined falsifiable acceptance criteria." },
      { id: "harness-unbound", title: "Project harness not bound", summary: "No accepted project harness is bound to this Goal Run." }
    ],
    sourceArtifactCount: 2,
    generatedAt,
    dataSource: "runtime"
  });
}

function formatStageGateSummary(stageGates) {
  if (!stageGates) return "not recorded";
  const gates = [stageGates.implement, stageGates.verify, stageGates.deliver].filter(Boolean);
  const ready = gates.filter((gate) => gate.status === "ready").length;
  const blocked = gates.length - ready;
  const totalReasons = gates.reduce((sum, gate) => sum + (gate.reasons?.length ?? 0), 0);
  const formatGate = (label, gate) => `${label} ${gate.status}${gate.reasons?.length > 0 ? ` (${gate.reasons.join("; ")})` : ""}`;
  return `${ready}/${gates.length} ready · ${blocked} blocked · ${totalReasons} reason(s) · ${formatGate("implement", stageGates.implement)} · ${formatGate("verify", stageGates.verify)} · ${formatGate("deliver", stageGates.deliver)}`;
}

function formatExecutionGraphSummary(graph) {
  if (!graph) return "not recorded";
  const owner = graph.integration_owner_task_id ?? "unknown";
  const criticalPath = graph.critical_path?.length > 0 ? graph.critical_path.join(" → ") : "not yet derivable";
  const nextWave = graph.schedule_valid
    ? (graph.next_ready_wave?.task_ids?.length > 0
      ? `next ready wave ${graph.next_ready_wave.index}: ${graph.next_ready_wave.task_ids.join(", ")}`
      : "next ready wave: none")
    : `blocked: ${(graph.blocked_reasons ?? []).map((reason) => reason.summary).join("; ") || "schedule invalid"}`;
  return `${graph.node_count} node(s) · max parallelism ${graph.max_parallelism} · integration owner ${owner} · critical path ${criticalPath} · ${nextWave}`;
}


function createDefaultContinueAdapterRegistry(services = {}, environment = process.env) {
  if (services.adapterRegistry) return services.adapterRegistry;
  const registry = new AgentAdapterRegistry();
  const codexOptions = services.codexAdapter === false
    ? false
    : {
        ...(services.codexAdapterOptions ?? {}),
        inspectExecutable: services.inspectCodexExecutable ?? services.codexAdapterOptions?.inspectExecutable,
        spawnProcess: services.spawnCodexProcess ?? services.codexAdapterOptions?.spawnProcess,
        resultFileExists: services.codexResultFileExists ?? services.codexAdapterOptions?.resultFileExists,
        profile: services.codexProfile ?? services.codexAdapterOptions?.profile ?? defaultCodexProfile(environment),
        environment
      };
  return registerBuiltinAgentAdapters(registry, {
    localReadonly: services.localReadonlyAdapter,
    codex: codexOptions
  });
}

async function resolveLiveAlignmentDescriptor({ agentId, agentProfileId, registry, environment }) {
  if (agentId === CODEX_ADAPTER_ID && registry) {
    return registry.probe(CODEX_ADAPTER_ID, {
      environment,
      profileId: agentProfileId ?? CODEX_READONLY_PROFILE_ID
    });
  }
  return liveAlignmentDescriptor({ agentId, agentProfileId });
}

async function resolveContinueResearchRecipes(options, services = {}) {
  if (Array.isArray(services.researchRecipes)) return services.researchRecipes;
  return loadResearchRecipesForContinue({
    researchRecipesPath: options.researchRecipesPath,
    configPath: options.configPath
  });
}



async function loadControlledChangeAuthorityContext({ dataRoot, repositoryIdentity, runId, commitSha }) {
  if (!runId || !commitSha) return null;
  try {
    const loaded = await loadRunSourceArtifact(dataRoot, repositoryIdentity, runId, "artifact-readiness-summary");
    const value = loaded.value;
    if (value?.delivery_mode !== "controlled-change") return null;
    if (value?.change_commit_sha !== commitSha) return null;
    if (!value?.head_sha) return null;
    return {
      baseline_head_sha: value.head_sha,
      change_commit_sha: value.change_commit_sha
    };
  } catch {
    return null;
  }
}

async function maybeRefreshDocsOnlyScorecardAfterVerify({
  snapshot,
  dataRoot,
  runId,
  commandId,
  receipt,
  evidence,
  generatedAt = new Date().toISOString()
}) {
  if (!runId || !evidence) return null;
  const run = await loadGoalRun(dataRoot, snapshot.repository.identity, runId);
  if (!["verifying", "reviewing"].includes(run.state)) return null;

  let deliveryMode = commandId === "docs-readiness-summary" ? "docs-only"
    : commandId === "controlled-change-marker" ? "controlled-change"
    : null;
  if (!deliveryMode) {
    try {
      const loaded = await loadRunSourceArtifact(dataRoot, snapshot.repository.identity, runId, "artifact-readiness-summary");
      deliveryMode = loaded.value?.delivery_mode === "controlled-change" ? "controlled-change" : "docs-only";
    } catch {
      deliveryMode = null;
    }
  }
  if (!deliveryMode) return null;

  const packet = await loadRunInteraction(dataRoot, snapshot.repository.identity, runId);
  if (!packet) throw new Error("Docs-only verify refresh requires a current interaction packet.");
  const artifacts = [];
  for (const source of packet.source_artifacts) {
    const loaded = await loadRunSourceArtifact(dataRoot, snapshot.repository.identity, runId, source.id);
    artifacts.push({ id: loaded.source.id, kind: loaded.source.kind, value: loaded.value, sha256: loaded.source.sha256 });
  }

  const paths = runStoragePaths(dataRoot, snapshot.repository.identity, runId);
  const pointer = JSON.parse(await readFile(paths.current, "utf8"));
  const nextSequence = (Number.isInteger(pointer?.sequence) ? pointer.sequence : 1) + 1;
  let trustContext;
  try {
    trustContext = await loadTrustedEvaluationContext({ snapshot });
  } catch {
    trustContext = undefined;
  }

  const nextRun = structuredClone(run);
  nextRun.timestamps.updated_at = generatedAt;
  const event = createRunEvent({
    runId: run.id,
    sequence: nextSequence,
    at: generatedAt,
    type: "evidence.recorded",
    data: {
      receipt_id: receipt.id,
      evidence_manifest_id: evidence.manifest?.id ?? null,
      command_id: commandId,
      outcome: receipt.outcome?.status ?? null
    }
  });
  const scorecard = createReviewScorecard({
    run: nextRun,
    scopeHash: createHash("sha256").update(JSON.stringify({ goal: run.goal.original, scope_version: run.goal.scope_version })).digest("hex"),
    harnessVersion: "unbound",
    title: `${deliveryMode === "controlled-change" ? "Controlled-change verification" : "Docs-only verification"}: ${run.goal.original}`,
    reviewVerdicts: [],
    reviewChecks: [],
    findings: [],
    unknowns: [],
    sourceArtifactCount: artifacts.length,
    omittedItemCount: packet.compression?.omitted_item_count ?? 0,
    generatedAt,
    dataSource: "runtime",
    profile: deliveryMode === "controlled-change" ? "controlled-change" : "docs-only",
    trustContext
  });
  const stored = await appendGoalRunCheckpoint({
    dataRoot,
    repositoryIdentity: snapshot.repository.identity,
    runId: run.id,
    events: [event],
    nextRun,
    scorecard,
    packet,
    artifacts
  });
  return { scorecard, path: stored.paths.checkpoint, run: nextRun };
}

export async function runCli(argv, io = console, services = {}) {
  const options = parseArguments(argv);
  if (!options.command || options.command === "help") {
    io.log(HELP);
    return 0;
  }

  if (!["onboard", "init", "doctor", "build", "supervisor-init", "request-approval", "request-capability", "approve", "verify", "goal", "advance", "align", "answer", "request-scope", "request-delivery", "promote", "retry", "cancel", "status", "review"].includes(options.command)) {
    throw new Error(`Unknown command: ${options.command}`);
  }

  if (options.command === "supervisor-init") {
    const result = await initializeSupervisorIdentity(defaultSupervisorRoot());
    const summary = {
      created: result.created,
      id: result.identity.id,
      fingerprint: result.identity.fingerprint,
      algorithm: result.identity.algorithm
    };
    io.log(options.format === "json" ? JSON.stringify(summary, null, 2) : `Supervisor ${result.created ? "created" : "loaded"}: ${summary.id}\nFingerprint: ${summary.fingerprint}\nAlgorithm: ${summary.algorithm}`);
    return 0;
  }

  const snapshot = await discoverRepository(options.repo);

  if (options.command === "goal") {
    if (!options.goal?.trim()) throw new Error("goal requires --goal TEXT");
    if (!snapshot.repository.git.is_repository || !snapshot.repository.git.head_sha || snapshot.repository.git.dirty) {
      throw new Error("Goal Runs require a clean committed Git repository baseline.");
    }
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const now = services.now?.() ?? new Date().toISOString();
    const { run, event } = createInitialGoalRun({
      id: services.newRunId?.() ?? `run-${randomUUID()}`,
      repository: {
        identity: snapshot.repository.identity,
        root_uri: snapshot.repository.root_uri,
        base_ref: snapshot.repository.git.branch ?? snapshot.repository.git.head_sha
      },
      originalGoal: options.goal,
      headSha: snapshot.repository.git.head_sha,
      now
    });
    const scorecard = initialScorecard(run, now);
    const stored = await createStoredGoalRun({ dataRoot, run, event, scorecard });
    const result = { run, scorecard, path: stored.paths.runRoot, next_action: nextRunAction(run) };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Goal Run created: ${run.id}\nState: ${run.state}\nRevision: ${run.current_head_sha.slice(0, 12)}\nReview: ${scorecard.verdict} (${scorecard.exception_counts.blocking} blocking)\nNext: ${result.next_action}\nStored externally: ${stored.paths.runRoot}`);
    return 0;
  }

  if (options.command === "align") {
    if (!options.runId) throw new Error("align requires --run ID");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    if (options.continueLive) {
      const environment = services.environment ?? process.env;
      const researchRecipes = await resolveContinueResearchRecipes(options, services);
      const adapterRegistry = createDefaultContinueAdapterRegistry(services, environment);
      const continued = await continueLiveAlignmentOperation({
        dataRoot,
        repositoryIdentity: snapshot.repository.identity,
        runId: options.runId,
        snapshot,
        supervisorRoot: services.supervisorRoot ?? defaultSupervisorRoot(),
        now: () => new Date(services.now?.() ?? Date.now()),
        isOwnerAlive: services.isOwnerAlive,
        owner: services.leaseOwner,
        capabilityView: services.capabilityView,
        researchRecipes,
        researchAuthority: services.researchAuthority,
        fetchImpl: services.fetchImpl ?? globalThis.fetch?.bind(globalThis) ?? null,
        adapterRegistry,
        adapterName: options.agentId ?? services.adapterName ?? null,
        probeRunner: services.probeRunner,
        resultValidator: services.resultValidator,
        workerContext: services.workerContext,
        leaseTtlSeconds: services.leaseTtlSeconds,
        providerCredential: services.providerCredential ?? resolveProviderCredential(environment)?.value ?? null,
        startProviderProxy: services.startProviderProxy ?? null,
        codexProfile: services.codexProfile ?? defaultCodexProfile(environment),
        environment
      });
      const live = continued.bundle;
      const unresolved = continued.unresolved_decisions ?? unresolvedLiveAlignmentDecisions(live.interactionPacket, live.developerAnswers);
      const result = {
        mode: "live-alignment",
        action: "continue",
        run: await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId),
        operation: live.operation,
        status: live.status,
        lease: live.lease,
        fence: live.fence,
        agent: { id: live.operation.agent_descriptor.id, profile_id: live.operation.agent_descriptor.profile_id },
        unresolved_decisions: unresolved.map((decision) => decision.id),
        developer_answers: live.developerAnswers?.length ?? 0,
        research: (continued.research ?? []).map((item) => ({ task_id: item.taskId, outcome: item.manifest?.outcome ?? null })),
        worker: continued.worker ? { phase: continued.worker.phase, attempt_no: continued.worker.attemptNo, status: continued.worker.worker.attempt.status } : null,
        blockers: continued.blockers,
        next_action: continued.next_action
      };
      io.log(options.format === "json"
        ? JSON.stringify(result, null, 2)
        : `Live Alignment continue: ${live.operation.id}\nRun: ${options.runId}\nState: ${live.status.status}\nPhase: ${live.status.active_phase ?? "none"}\nAttempts: ${live.status.agent_attempts}\nUnresolved decisions: ${unresolved.length}\nLease: ${live.lease?.owner_id ?? "none"}\nNext: ${result.next_action}${result.blockers?.length ? `\nBlockers: ${result.blockers.join(" | ")}` : ""}\nStored externally: ${live.paths.root}`);
      return live.status.status === "ready" ? 0 : 2;
    }
    const environment = services.environment ?? process.env;
    const selection = await resolveAlignAgentSelection({
      requestedAgentId: options.agentId,
      requestedProfileId: options.agentProfileId,
      environment
    });
    let agentId = selection.agentId;
    let agentProfileId = selection.agentProfileId;
    const adapterRegistry = createDefaultContinueAdapterRegistry(services, environment);
    let descriptorOverride = null;
    if (agentId === CODEX_ADAPTER_ID) {
      try {
        descriptorOverride = await resolveLiveAlignmentDescriptor({
          agentId,
          agentProfileId,
          registry: adapterRegistry,
          environment
        });
      } catch (error) {
        if (options.agentId === CODEX_ADAPTER_ID) {
          throw new Error(`Codex adapter is not ready: ${error.message}`);
        }
        agentId = LOCAL_READONLY_ADAPTER_ID;
        agentProfileId = options.agentProfileId ?? "codex-readonly-analysis-v1";
      }
    }
    const bundleInput = await loadCurrentLiveAlignmentBundle(dataRoot, snapshot.repository.identity, options.runId, {
      agentId,
      agentProfileId,
      agentDescriptor: descriptorOverride
    });
    if (!bundleInput) throw new Error("Live alignment requires a clarifying Goal Run with a current Alignment Brief.");
    const bundle = await loadLiveAlignmentOperationBundle(dataRoot, snapshot.repository.identity, bundleInput.operation.id);
    let live = bundle;
    if (!live) {
      const lease = buildLiveAlignmentLease(bundleInput.operation, {
        owner_id: `devharness-cli:${process.pid}`,
        boot_id: stableLiveAlignmentExecutionId(),
        pid: process.pid,
        process_birth_id: stableLiveAlignmentExecutionId()
      });
      const initialStatus = buildLiveAlignmentStatus(bundleInput.operation, {
        status: bundleInput.interactionPacket?.decisions?.length > 0 ? "question-blocked" : "planned",
        active_phase: bundleInput.interactionPacket?.decisions?.length > 0 ? "analysis-plan" : null
      });
      await startLiveAlignmentOperation({
        dataRoot,
        repositoryIdentity: snapshot.repository.identity,
        operation: bundleInput.operation,
        analysisPlan: bundleInput.analysisPlan,
        interactionPacket: bundleInput.interactionPacket,
        status: initialStatus,
        lease
      });
      live = await loadLiveAlignmentOperationBundle(dataRoot, snapshot.repository.identity, bundleInput.operation.id);
      if (live.status.status === "planned") {
        live = await projectLiveAlignmentOperationStatus(dataRoot, snapshot.repository.identity, bundleInput.operation.id, { agentAuthorityReady: false });
      }
    } else if (live.status.status === "planned") {
      live = await projectLiveAlignmentOperationStatus(dataRoot, snapshot.repository.identity, bundleInput.operation.id, { agentAuthorityReady: false });
    }
    const result = {
      mode: "live-alignment",
      run: bundleInput.run,
      operation: live.operation,
      status: live.status,
      lease: live.lease,
      fence: live.fence,
      agent: { id: live.operation.agent_descriptor.id, profile_id: live.operation.agent_descriptor.profile_id },
      analysis_plan: live.analysisPlan ? { id: live.analysisPlan.id, questions: live.analysisPlan.questions.length, research_topics: live.analysisPlan.research_topics.length, research_tasks: live.analysisPlan.research_tasks.length } : null,
      analysis_summary: bundleInput.summary ?? null,
      developer_answers: live.developerAnswers?.length ?? 0,
      interaction_packet: live.interactionPacket ? { id: live.interactionPacket.id, kind: live.interactionPacket.kind, decisions: live.interactionPacket.decisions.length, verdict: live.interactionPacket.verdict } : null,
      next_action: nextLiveAction(live.status)
    };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Live Alignment: ${live.operation.id}\nRun: ${bundleInput.run.id}\nAgent: ${live.operation.agent_descriptor.id} / ${live.operation.agent_descriptor.profile_id}\nPlan: ${live.analysisPlan ? `${live.analysisPlan.questions.length} questions · ${live.analysisPlan.research_tasks.length} research tasks` : "not recorded"}${bundleInput.summary?.stage_gates ? `\nStage gates: ${formatStageGateSummary(bundleInput.summary.stage_gates)}` : ""}${bundleInput.summary?.execution_graph ? `\nExecution graph: ${formatExecutionGraphSummary(bundleInput.summary.execution_graph)}` : ""}\nPacket: ${live.interactionPacket ? `${live.interactionPacket.kind} · ${unresolvedLiveAlignmentDecisions(live.interactionPacket, live.developerAnswers).length} unresolved / ${live.developerAnswers?.length ?? 0} answered` : "not recorded"}\nState: ${live.status.status}\nPhase: ${live.status.active_phase ?? "none"}\nRevision: ${bundleInput.run.current_head_sha.slice(0, 12)}\nNext: ${result.next_action}\nStored externally: ${live.paths.root}`);
    return live.status.status === "ready" ? 0 : 2;
  }

  if (options.command === "answer") {
    if (!options.runId) throw new Error("answer requires --run ID");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const bundleInput = await loadCurrentLiveAlignmentBundle(dataRoot, snapshot.repository.identity, options.runId, {
      agentId: options.agentId ?? "devharness-cli-local-agent",
      agentProfileId: options.agentProfileId ?? "codex-readonly-analysis-v1"
    });
    if (!bundleInput) throw new Error("Live alignment requires a current Alignment Brief before answering a question.");
    let answerPairs = options.answerPairs.length > 0
      ? options.answerPairs
      : (options.decisionId && options.optionId ? [{ decisionId: options.decisionId, optionId: options.optionId }] : []);
    if (options.inferConservative) {
      if (answerPairs.length > 0) throw new Error("Pass only one of --infer-conservative or explicit --decision/--option pairs.");
      let live = bundleInput;
      if (!live?.interactionPacket && bundleInput.operation?.id) {
        live = await loadLiveAlignmentOperationBundle(dataRoot, snapshot.repository.identity, bundleInput.operation.id);
      }
      if (!live?.interactionPacket) {
        throw new Error("--infer-conservative needs a current interaction packet on the live Alignment operation.");
      }
      const picked = pickConservativeInferAnswers(live.interactionPacket, live.developerAnswers ?? []);
      if (picked.pairs.length === 0) {
        if (picked.skipped.length) {
          throw new Error(`No Infer conservatively options available (${picked.skipped.map((item) => item.decisionId).join(", ")}).`);
        }
        io.log(options.format === "json"
          ? JSON.stringify({ mode: "live-alignment", run: bundleInput.run, inferred: [], next_action: "devharness align --continue --run " + options.runId }, null, 2)
          : `No unresolved Alignment decisions to infer.\nNext: devharness align --continue --run ${options.runId}`);
        return 0;
      }
      if (picked.skipped.length) {
        io.log(`Skipping decisions without infer options: ${picked.skipped.map((item) => item.decisionId).join(", ")}`);
      }
      answerPairs = picked.pairs;
    }
    if (answerPairs.length === 0) throw new Error("answer requires --infer-conservative or --decision ID --option ID (repeatable as pairs)");
    if (answerPairs.some((pair) => !pair.optionId)) throw new Error("each --decision requires a matching --option");
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    const answerResult = await recordAlignmentAnswer({
      dataRoot,
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      runId: options.runId,
      packetSha256: options.packetSha256 ?? null,
      decisionId: answerPairs[0].decisionId,
      optionId: answerPairs[0].optionId,
      answers: answerPairs,
      responseProvider: services.answerResponse,
      now: () => new Date()
    });
    const refreshed = answerResult.bundle;
    const result = {
      mode: "live-alignment",
      run: bundleInput.run,
      operation: refreshed.operation,
      status: refreshed.status,
      lease: refreshed.lease,
      fence: refreshed.fence,
      agent: { id: refreshed.operation.agent_descriptor.id, profile_id: refreshed.operation.agent_descriptor.profile_id },
      developer_answers: refreshed.developerAnswers?.length ?? 0,
      interaction_packet: refreshed.interactionPacket ? { id: refreshed.interactionPacket.id, kind: refreshed.interactionPacket.kind, decisions: refreshed.interactionPacket.decisions.length, verdict: refreshed.interactionPacket.verdict } : null,
      answer: answerResult.answer,
      receipt: answerResult.receipt,
      next_action: nextLiveAction(refreshed.status)
    };
    const answerSummary = (answerResult.answers ?? [answerResult.answer]).filter(Boolean)
      .map((answer) => `${answer.decision_id} → ${answer.option_id}`).join("; ");
    const receiptSummary = (answerResult.receipts ?? [answerResult.receipt]).filter(Boolean)
      .map((receipt) => receipt.id).join(" ") || "replayed";
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Answered: ${answerSummary}\nReceipt: ${receiptSummary}\nState: ${refreshed.status.status}\nNext: ${result.next_action}`);
    return refreshed.status.status === "ready" ? 0 : 2;
  }

  if (options.command === "request-scope") {
    if (!options.runId) throw new Error("request-scope requires --run ID");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const run = await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId);
    const bundle = await findLiveAlignmentOperationBundleByRun(dataRoot, snapshot.repository.identity, options.runId, run.current_head_sha);
    if (!bundle) throw new Error("request-scope requires a current ready AlignmentBundle.");
    if (bundle.status.status !== "ready") throw new Error("request-scope is available only for a ready AlignmentBundle.");
    const bundleRef = bundle.status.result_bundle_ref;
    if (!bundleRef) throw new Error("Current AlignmentBundle is missing a result bundle reference.");
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    await initializeSupervisorIdentity(supervisorRoot);
    const request = await createSupervisorApprovalRequest({
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      relevantHeadSha: run.current_head_sha,
      runId: options.runId,
      gate: "scope",
      subject: { id: bundleRef.id, artifact_sha256: bundleRef.sha256 },
      now: () => new Date(services.now?.() ?? Date.now())
    });
    const result = {
      mode: "live-alignment",
      run,
      operation: bundle.operation,
      status: bundle.status,
      lease: bundle.lease,
      fence: bundle.fence,
      bundle_ref: bundleRef,
      request,
      next_action: `devharness approve --repo ${fileURLToPath(snapshot.repository.root_uri)} --data-dir ${dataRoot} --request ${request.id}`
    };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Scope approval requested: ${request.id}\nBundle: ${bundleRef.id}\nRevision: ${bundle.operation.commit_sha.slice(0, 12)}\nNext: ${result.next_action}`);
    return 0;
  }

  if (options.command === "request-delivery") {
    if (!options.runId) throw new Error("request-delivery requires --run ID");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const run = await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId);
    if (run.state !== "awaiting_delivery_approval") {
      throw new Error("request-delivery requires state=awaiting_delivery_approval (advance a verifying run with a ready tip scorecard first).");
    }
    const packet = await loadRunInteraction(dataRoot, snapshot.repository.identity, options.runId);
    if (!packet || packet.kind !== "delivery-brief" || packet.verdict !== "ready") {
      throw new Error("request-delivery requires a current ready Delivery Brief.");
    }
    const brief = await loadRunSourceArtifact(dataRoot, snapshot.repository.identity, options.runId, "artifact-delivery-brief");
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    await initializeSupervisorIdentity(supervisorRoot);
    const request = await createSupervisorApprovalRequest({
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      relevantHeadSha: run.current_head_sha,
      runId: options.runId,
      gate: "delivery",
      subject: { id: brief.source.id, artifact_sha256: brief.source.sha256 },
      now: () => new Date(services.now?.() ?? Date.now())
    });
    const result = {
      mode: "delivery",
      run,
      brief: { id: brief.source.id, sha256: brief.source.sha256 },
      request,
      next_action: `devharness approve --repo ${fileURLToPath(snapshot.repository.root_uri)} --data-dir ${dataRoot} --request ${request.id}`
    };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Delivery approval requested: ${request.id}\nBrief: ${brief.source.id}\nRevision: ${run.current_head_sha.slice(0, 12)}\nNext: ${result.next_action}`);
    return 0;
  }

  if (options.command === "promote") {
    if (!options.runId) throw new Error("promote requires --run ID");
    if (options.createPr && !options.push) options.push = true;
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const run = await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId);
    let readiness;
    try {
      readiness = (await loadRunSourceArtifact(dataRoot, snapshot.repository.identity, options.runId, "artifact-readiness-summary")).value;
    } catch {
      throw new Error("promote requires artifact-readiness-summary from a controlled-change delivery.");
    }
    const support = promoteSupported({ run, readiness });
    if (!support.ok) throw new Error(support.reason);
    const record = await promoteControlledChange({
      repositoryRoot: fileURLToPath(snapshot.repository.root_uri),
      dataRoot,
      repositoryIdentity: snapshot.repository.identity,
      run,
      readiness,
      branchName: options.branchName,
      baseRef: options.baseRef,
      push: options.push,
      createPr: options.createPr,
      generatedAt: services.now?.() ?? new Date().toISOString(),
      gitExec: services.gitExec,
      ghExec: services.ghExec
    });
    const result = {
      mode: "promote",
      run_id: run.id,
      record,
      next_action: record.pr_url
        ? `Review PR ${record.pr_url} (DevHarness does not auto-merge).`
        : record.pushed
          ? `Branch ${record.branch} pushed. Open a PR when ready; DevHarness does not auto-merge.`
          : `Local branch ${record.branch} points at ${record.change_commit_sha.slice(0, 12)}. Add --push/--pr to publish.`
    };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Promoted: ${record.branch}\nChange: ${record.change_commit_sha.slice(0, 12)}\nPushed: ${record.pushed ? "yes" : "no"}\nPR: ${record.pr_url ?? "not created"}\nCheckout HEAD unchanged: ${run.current_head_sha.slice(0, 12)}\nNext: ${result.next_action}`);
    return 0;
  }

  if (options.command === "retry") {
    if (!options.runId) throw new Error("retry requires --run ID");
    if (!options.operationId) throw new Error("retry requires --operation ID");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const bundle = await loadLiveAlignmentOperationBundle(dataRoot, snapshot.repository.identity, options.operationId);
    if (!bundle) throw new Error("retry requires an existing live Alignment operation.");
    if (bundle.operation.run_id !== options.runId) throw new Error("retry requires the operation to belong to the requested Goal Run.");
    const updated = await retryLiveAlignmentOperation({
      dataRoot,
      repositoryIdentity: snapshot.repository.identity,
      operationId: options.operationId,
      now: () => new Date(services.now?.() ?? Date.now())
    });
    if (!updated) throw new Error("retry requires an existing live Alignment operation.");
    const result = {
      mode: "live-alignment",
      run: await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId),
      operation: updated.operation,
      status: updated.status,
      lease: updated.lease,
      fence: updated.fence,
      next_action: nextLiveAction(updated.status)
    };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Retried: ${updated.operation.id}\nPhase: ${updated.status.active_phase ?? "none"}\nAttempt: ${updated.status.current_attempt_id ?? "none"}\nState: ${updated.status.status}\nNext: ${result.next_action}`);
    return updated.status.status === "ready" ? 0 : 2;
  }

  if (options.command === "cancel") {
    if (!options.runId) throw new Error("cancel requires --run ID");
    if (!options.operationId) throw new Error("cancel requires --operation ID");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const bundle = await loadLiveAlignmentOperationBundle(dataRoot, snapshot.repository.identity, options.operationId);
    if (!bundle) throw new Error("cancel requires an existing live Alignment operation.");
    if (bundle.operation.run_id !== options.runId) throw new Error("cancel requires the operation to belong to the requested Goal Run.");
    const updated = await cancelLiveAlignmentOperation({
      dataRoot,
      repositoryIdentity: snapshot.repository.identity,
      operationId: options.operationId,
      requestedBy: { id: "developer", kind: "human" },
      now: () => new Date(services.now?.() ?? Date.now())
    });
    if (!updated) throw new Error("cancel requires an existing live Alignment operation.");
    const result = {
      mode: "live-alignment",
      run: await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId),
      operation: updated.operation,
      status: updated.status,
      lease: updated.lease,
      fence: updated.fence,
      next_action: nextLiveAction(updated.status)
    };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Cancelled: ${updated.operation.id}\nState: ${updated.status.status}\nFence: ${updated.fence.kind}\nNext: ${result.next_action}`);
    return 0;
  }

  if (options.command === "status") {
    if (!options.runId) throw new Error("status requires --run ID");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    const statusNow = new Date(services.now?.() ?? Date.now());
    const reconciled = await reconcileRunGatesFromApprovals({
      dataRoot,
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      runId: options.runId,
      now: statusNow
    });
    const liveInput = await loadCurrentLiveAlignmentBundle(dataRoot, snapshot.repository.identity, options.runId);
    if (liveInput) {
      liveInput.run = reconciled.run;
      let live = await loadLiveAlignmentOperationBundle(dataRoot, snapshot.repository.identity, liveInput.operation.id);
      if (live) {
        let capabilitySummary = null;
        if (liveInput.run.state === "clarifying") {
          try {
            capabilitySummary = await loadCapabilityAuthorizationView({ dataRoot, supervisorRoot, repositoryIdentity: snapshot.repository.identity, runId: options.runId, now: statusNow });
          } catch (error) {
            capabilitySummary = null;
            if (options.format === "json") {
              // keep going; live alignment status is still useful
            }
          }
        }
        if (live.status?.status === "waiting-agent-authority") {
          const agentRuntimeApproved = Boolean(capabilitySummary?.capabilities?.some((item) =>
            (item.request?.id === "agent-runtime" || item.request?.capability === "agent-runtime")
            && item.status === "approved"
          ));
          if (agentRuntimeApproved) {
            live = await projectLiveAlignmentOperationStatus(dataRoot, snapshot.repository.identity, live.operation.id, {
              agentAuthorityReady: true,
              researchAuthorityReady: true,
              active_phase: live.status.active_phase ?? "analysis-plan"
            });
          }
        }
        const scopeApproved = liveInput.run.gates?.scope?.status === "approved";
        const result = {
          mode: "live-alignment",
          run: liveInput.run,
          operation: live.operation,
          status: live.status,
          lease: live.lease,
          fence: live.fence,
          agent: { id: live.operation.agent_descriptor.id, profile_id: live.operation.agent_descriptor.profile_id },
          analysis_plan: live.analysisPlan ? { id: live.analysisPlan.id, questions: live.analysisPlan.questions.length, clarification_questions: live.analysisPlan.clarification_questions?.length ?? 0, research_topics: live.analysisPlan.research_topics.length, research_tasks: live.analysisPlan.research_tasks.length, team_decomposition: live.analysisPlan.team_decomposition.length } : null,
          analysis_summary: liveInput.summary ?? null,
          capability_authorization: capabilitySummary ? { counts: capabilitySummary.counts, research_task_counts: capabilitySummary.research_task_counts } : null,
          developer_answers: live.developerAnswers?.length ?? 0,
          unresolved_decisions: unresolvedLiveAlignmentDecisions(live.interactionPacket, live.developerAnswers).map((decision) => decision.id),
          interaction_packet: live.interactionPacket ? { id: live.interactionPacket.id, kind: live.interactionPacket.kind, decisions: live.interactionPacket.decisions.length, unresolved: unresolvedLiveAlignmentDecisions(live.interactionPacket, live.developerAnswers).length, verdict: live.interactionPacket.verdict } : null,
          next_action: nextLiveAction(live.status, { scopeApproved })
        };
        io.log(options.format === "json"
          ? JSON.stringify(result, null, 2)
          : `Live Alignment: ${live.operation.id}\nRun: ${liveInput.run.id}\nAgent: ${live.operation.agent_descriptor.id} / ${live.operation.agent_descriptor.profile_id}\nPlan: ${live.analysisPlan ? `${live.analysisPlan.clarification_questions?.length ?? 0} clarifications · ${live.analysisPlan.questions.length} questions · ${live.analysisPlan.research_tasks.length} research tasks · ${live.analysisPlan.team_decomposition.length} crew groups` : "not recorded"}${liveInput.summary?.stage_gates ? `\nStage gates: ${formatStageGateSummary(liveInput.summary.stage_gates)}` : ""}${liveInput.summary?.execution_graph ? `\nExecution graph: ${formatExecutionGraphSummary(liveInput.summary.execution_graph)}` : ""}${capabilitySummary ? `\nResearch approvals: ${capabilitySummary.counts.approved} approved · ${capabilitySummary.counts.pending} pending · ${capabilitySummary.counts.unrequested} unrequested` : ""}${capabilitySummary ? `\nResearch queue: ${capabilitySummary.research_task_counts.approved} approved · ${capabilitySummary.research_task_counts.pending_approval} waiting · ${capabilitySummary.research_task_counts.blocked} blocked` : ""}\nPacket: ${live.interactionPacket ? `${live.interactionPacket.kind} · ${unresolvedLiveAlignmentDecisions(live.interactionPacket, live.developerAnswers).length} unresolved / ${live.developerAnswers?.length ?? 0} answered` : "not recorded"}\nState: ${live.status.status}\nPhase: ${live.status.active_phase ?? "none"}\nScope gate: ${liveInput.run.gates.scope.status}\nRevision: ${liveInput.run.current_head_sha.slice(0, 12)}\nNext: ${result.next_action}\nStored externally: ${live.paths.root}`);
        return live.status.status === "ready" && !scopeApproved ? 0 : (live.status.status === "ready" && scopeApproved ? 0 : 2);
      }
    }
    const run = reconciled.run;
    const scorecard = await loadRunScorecard(dataRoot, snapshot.repository.identity, options.runId);
    const capabilities = run.state === "clarifying"
      ? await loadCapabilityAuthorizationView({ dataRoot, supervisorRoot, repositoryIdentity: snapshot.repository.identity, runId: options.runId, now: statusNow })
      : null;
    let statusNext = capabilities?.next_action ?? nextRunAction(run);
    if (run.state === "verifying" && !capabilities?.next_action) {
      try {
        const readiness = await loadRunSourceArtifact(dataRoot, snapshot.repository.identity, options.runId, "artifact-readiness-summary");
        const hint = verifyHintFromReadiness(readiness.value, { runId: options.runId });
        if (hint && scorecard?.verdict !== "ready") statusNext = `Run \`${hint}\`.`;
        else if (hint && scorecard?.verdict === "ready") statusNext = `Tip scorecard is ready. Run \`devharness advance --run ${options.runId}\` to open Gate 2, or re-run \`${hint}\` if evidence went stale.`;
      } catch {}
    }
    const result = { run, scorecard, ...(capabilities ? { capabilities } : {}), next_action: statusNext };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Goal Run: ${run.id}\nGoal: ${run.goal.refined ?? run.goal.original}\nState: ${run.state}\nRevision: ${run.current_head_sha.slice(0, 12)}\nReview: ${scorecard.verdict} · proof ${scorecard.proof_coverage.score}/100 · ${scorecard.exception_counts.blocking} blocking${capabilities ? `\nCapabilities: ${capabilities.counts.approved} approved · ${capabilities.counts.pending} pending · ${capabilities.counts.unrequested} unrequested · ${capabilities.counts.rejected + capabilities.counts.expired + capabilities.counts.stale} blocked` : ""}\nNext: ${result.next_action}`);
    return scorecard.verdict === "ready" ? 0 : 2;
  }

  if (options.command === "advance") {
    if (!options.runId) throw new Error("advance requires --run ID");
    if (!snapshot.repository.git.is_repository || !snapshot.repository.git.head_sha || snapshot.repository.git.dirty) {
      throw new Error("Goal Run advance requires a clean committed Git repository baseline.");
    }
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const currentRun = await loadGoalRun(dataRoot, snapshot.repository.identity, options.runId);
    if (currentRun.repository.identity !== snapshot.repository.identity) throw new Error("Goal Run belongs to a different repository.");
    if (currentRun.current_head_sha !== snapshot.repository.git.head_sha) throw new Error("Repository revision changed after Goal Run intake.");
    const generatedAt = services.now?.() ?? new Date().toISOString();

    if (postScopeAdvanceSupported(currentRun)) {
      const deliveryMode = options.deliveryMode ?? "docs-only";
      let vcsWriteAuthorized = false;
      if (deliveryMode === "controlled-change") {
        const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
        const authorizationView = await loadCapabilityAuthorizationView({
          dataRoot,
          supervisorRoot,
          repositoryIdentity: snapshot.repository.identity,
          runId: options.runId,
          now: new Date(services.now?.() ?? Date.now())
        });
        const vcs = findApprovedVcsWrite(authorizationView);
        if (!vcs.allowed) {
          throw new Error(`Controlled-change requires approved vcs-write: ${vcs.reasons.join(" ")} Request with \`devharness request-capability --run ${options.runId} --capability vcs-write\` then TTY approve.`);
        }
        vcsWriteAuthorized = true;
      }
      const priorArtifacts = [];
      for (const artifactId of ["artifact-onboarding-plan", "artifact-goal-input", "artifact-repository-snapshot"]) {
        try {
          const loaded = await loadRunSourceArtifact(dataRoot, snapshot.repository.identity, options.runId, artifactId);
          priorArtifacts.push({ id: loaded.source.id, kind: loaded.source.kind, value: loaded.value, sha256: loaded.source.sha256 });
        } catch (error) {
          if (artifactId === "artifact-onboarding-plan") throw error;
        }
      }
      const paths = runStoragePaths(dataRoot, snapshot.repository.identity, options.runId);
      const currentPointer = JSON.parse(await readFile(paths.current, "utf8"));
      const nextSequence = (Number.isInteger(currentPointer?.sequence) ? currentPointer.sequence : 1) + 1;
      let changeSpec = null;
      let agentProposal = null;
      if (options.changeJsonPath && options.agentPropose) {
        throw new Error("Pass only one of --change-json or --agent-propose.");
      }
      if (options.changeJsonPath) {
        changeSpec = JSON.parse(await readFile(options.changeJsonPath, "utf8"));
      } else if (options.agentPropose) {
        if (deliveryMode !== "controlled-change") {
          throw new Error("--agent-propose requires --mode controlled-change.");
        }
        const registry = createDefaultContinueAdapterRegistry(services);
        agentProposal = await proposeControlledChangeWithAgent({
          snapshot,
          run: currentRun,
          dataRoot,
          adapterRegistry: registry,
          adapterName: options.agentId ?? null,
          agentProfileId: options.agentProfileId ?? null,
          environment: process.env,
          clock: () => new Date(services.now?.() ?? Date.now())
        });
        changeSpec = agentProposal.change_spec;
      }
      let verifyCommandId = options.commandId ?? null;
      let verifyCommandSelection = null;
      if (!verifyCommandId) {
        try {
          const { config } = await loadConfiguredProject(snapshot, options);
          verifyCommandSelection = selectVerifyCommandId({
            commands: config?.quality?.commands ?? [],
            goalText: currentRun.goal.refined ?? currentRun.goal.original,
            changeSpec,
            deliveryMode,
            explicitCommandId: null
          });
          verifyCommandId = verifyCommandSelection.command_id;
        } catch (error) {
          verifyCommandSelection = {
            command_id: null,
            reason: error.message,
            candidates: []
          };
        }
      } else {
        verifyCommandSelection = { command_id: verifyCommandId, reason: "explicit --command", candidates: [] };
      }
      const checkpoint = await createPostScopeAdvanceCheckpoint({
        run: currentRun,
        snapshot,
        dataRoot,
        priorArtifacts,
        artifactDir: options.artifactDir,
        verifyCommandId,
        deliveryMode,
        vcsWriteAuthorized,
        changeSpec,
        nextSequence,
        generatedAt
      });
      const scorecard = createReviewScorecard({
        run: checkpoint.run,
        scopeHash: createHash("sha256").update(JSON.stringify({ goal: currentRun.goal.original, scope_version: currentRun.goal.scope_version })).digest("hex"),
        harnessVersion: "unbound",
        title: `${deliveryMode === "controlled-change" ? "Controlled-change delivery" : "Post-scope delivery"}: ${currentRun.goal.original}`,
        reviewVerdicts: [],
        reviewChecks: [],
        findings: [],
        unknowns: deliveryMode === "controlled-change"
          ? [
            { id: "verify-pending", title: "Verification evidence pending", summary: "Bounded consumer change is committed in an isolated worktree; verify the change revision with --commit <sha> --execute --attest.", source_refs: ["artifact-readiness-summary"] },
            { id: "review-pending", title: "Independent review pending", summary: "Controlled consumer changes still require independent review before Gate 2 delivery approval.", source_refs: ["artifact-readiness-summary"] }
          ]
          : [
            { id: "verify-pending", title: "Verification evidence pending", summary: "Bounded change is recorded; declared quality verification still needs capability-backed execute/attest.", source_refs: ["artifact-readiness-summary"] }
          ],
        sourceArtifactCount: checkpoint.artifacts.length,
        omittedItemCount: checkpoint.packet.compression.omitted_item_count,
        generatedAt,
        dataSource: "runtime",
        profile: deliveryMode === "controlled-change" ? "full" : "docs-only"
      });
      const stored = await appendGoalRunCheckpoint({
        dataRoot,
        repositoryIdentity: snapshot.repository.identity,
        runId: currentRun.id,
        events: checkpoint.events,
        nextRun: checkpoint.run,
        scorecard,
        packet: checkpoint.packet,
        artifacts: checkpoint.artifacts
      });
      let verifyProbe = null;
      if (verifyCommandId) {
        try {
          const { config } = await loadConfiguredProject(snapshot, options);
          const changeCommit = checkpoint.delivery.change_commit_sha ?? null;
          const plan = await createVerificationPlan({
            snapshot,
            config,
            commandId: verifyCommandId,
            goalRunId: options.runId,
            dataRoot,
            timeoutMs: options.timeoutMs,
            commitSha: changeCommit
          });
          const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
          const authorizationView = await loadCapabilityAuthorizationView({
            dataRoot,
            supervisorRoot,
            repositoryIdentity: snapshot.repository.identity,
            runId: options.runId,
            now: new Date(services.now?.() ?? Date.now())
          });
          const controlledChange = await loadControlledChangeAuthorityContext({
            dataRoot,
            repositoryIdentity: snapshot.repository.identity,
            runId: options.runId,
            commitSha: plan.commit_sha
          });
          const authority = evaluateVerificationExecutionAuthority(plan, authorizationView, { controlledChange });
          const commitFlag = changeCommit ? ` --commit ${changeCommit}` : "";
          verifyProbe = {
            command_id: verifyCommandId,
            selection_reason: verifyCommandSelection?.reason ?? null,
            commit_sha: changeCommit ?? plan.commit_sha,
            authority_allowed: authority.allowed,
            required_capability_ids: authority.required_capability_ids,
            missing: authority.missing,
            reasons: authority.reasons,
            next_action: authority.allowed
              ? `devharness verify --run ${options.runId} --command ${verifyCommandId}${commitFlag} --execute --attest`
              : `devharness request-capability --run ${options.runId} --for-verify --command ${verifyCommandId}${changeCommit ? ` --commit ${changeCommit}` : ""} --approve`
          };
        } catch (error) {
          verifyProbe = {
            command_id: verifyCommandId,
            selection_reason: verifyCommandSelection?.reason ?? null,
            authority_allowed: false,
            reasons: [{ code: "verify_probe_failed", message: error.message }],
            next_action: error.message
          };
        }
      } else if (verifyCommandSelection) {
        verifyProbe = {
          command_id: null,
          selection_reason: verifyCommandSelection.reason,
          candidates: verifyCommandSelection.candidates,
          authority_allowed: false,
          next_action: "Pass --command ID explicitly; no harness quality command matched this change."
        };
      }
      const result = {
        mode: "post-scope",
        run: checkpoint.run,
        interaction: checkpoint.packet,
        scorecard,
        delivery: checkpoint.delivery,
        verify: verifyProbe,
        path: stored.paths.checkpoint,
        next_action: verifyProbe?.next_action ?? nextRunAction(checkpoint.run)
      };
      io.log(options.format === "json"
        ? JSON.stringify(result, null, 2)
        : `Goal Run advanced (post-scope): ${checkpoint.run.id}\nState: ${checkpoint.run.state}\nSummary: ${checkpoint.delivery.summary_path}\nScope gate: approved\nNext: ${result.next_action}\nStored externally: ${stored.paths.checkpoint}`);
      return 0;
    }

    {
      const tipScorecard = await loadRunScorecard(dataRoot, snapshot.repository.identity, options.runId);
      if (deliveryAdvanceSupported(currentRun, tipScorecard)) {
        const priorArtifacts = [];
        for (const artifactId of ["artifact-onboarding-plan", "artifact-goal-input", "artifact-repository-snapshot", "artifact-readiness-summary", "artifact-execution-plan"]) {
          try {
            const loaded = await loadRunSourceArtifact(dataRoot, snapshot.repository.identity, options.runId, artifactId);
            priorArtifacts.push({ id: loaded.source.id, kind: loaded.source.kind, value: loaded.value, sha256: loaded.source.sha256 });
          } catch (error) {
            if (artifactId === "artifact-onboarding-plan") throw error;
          }
        }
        const paths = runStoragePaths(dataRoot, snapshot.repository.identity, options.runId);
        const currentPointer = JSON.parse(await readFile(paths.current, "utf8"));
        const nextSequence = (Number.isInteger(currentPointer?.sequence) ? currentPointer.sequence : 1) + 1;
        const checkpoint = await createDeliveryAdvanceCheckpoint({
          run: currentRun,
          scorecard: tipScorecard,
          priorArtifacts,
          nextSequence,
          generatedAt
        });
        const scorecard = createReviewScorecard({
          run: checkpoint.run,
          scopeHash: createHash("sha256").update(JSON.stringify({ goal: currentRun.goal.original, scope_version: currentRun.goal.scope_version })).digest("hex"),
          harnessVersion: "unbound",
          title: `Delivery Brief: ${currentRun.goal.original}`,
          reviewVerdicts: [],
          reviewChecks: [],
          findings: [],
          unknowns: [],
          sourceArtifactCount: checkpoint.artifacts.length,
          omittedItemCount: checkpoint.packet.compression.omitted_item_count,
          generatedAt,
          dataSource: "runtime",
          profile: checkpoint.delivery.mode === "controlled-change" ? "controlled-change" : "docs-only"
        });
        const stored = await appendGoalRunCheckpoint({
          dataRoot,
          repositoryIdentity: snapshot.repository.identity,
          runId: currentRun.id,
          events: checkpoint.events,
          nextRun: checkpoint.run,
          scorecard,
          packet: checkpoint.packet,
          artifacts: checkpoint.artifacts
        });
        const result = {
          mode: "delivery",
          run: checkpoint.run,
          interaction: checkpoint.packet,
          scorecard,
          delivery: checkpoint.delivery,
          path: stored.paths.checkpoint,
          next_action: `devharness request-delivery --run ${currentRun.id}`
        };
        io.log(options.format === "json"
          ? JSON.stringify(result, null, 2)
          : `Goal Run advanced (delivery): ${checkpoint.run.id}\nState: ${checkpoint.run.state}\nDelivery Brief: ${checkpoint.delivery.brief_id}\nNext: ${result.next_action}\nStored externally: ${stored.paths.checkpoint}`);
        return 0;
      }
    }

    if (currentRun.state !== "received") {
      throw new Error("advance supports received (static understanding), scope-approved clarifying/planning/staffing/executing runs, or verifying runs with a ready tip scorecard.");
    }
    let config = null;
    let configError = null;
    let configSource = options.configPath ? "external" : "tracked";
    try {
      ({ config, source: configSource } = await loadConfiguredProject(snapshot, options));
    } catch (error) {
      configError = error.message;
    }
    const trustContext = await loadTrustedEvaluationContext({ snapshot });
    const report = evaluateReadiness(snapshot, { trustContext, config, configError, configSource });
    const onboardingPlan = await createOnboardingPlan(snapshot, { report, config, configError, configSource, generatedAt });
    const checkpoint = await createGoalUnderstandingCheckpoint({ run: currentRun, snapshot, onboardingPlan, generatedAt });
    const scorecard = createReviewScorecard({
      run: checkpoint.run,
      scopeHash: createHash("sha256").update(JSON.stringify({ goal: currentRun.goal.original, scope_version: currentRun.goal.scope_version })).digest("hex"),
      harnessVersion: "unbound",
      title: `Understanding checkpoint: ${currentRun.goal.original}`,
      reviewVerdicts: [],
      reviewChecks: [],
      findings: [],
      unknowns: [
        ...onboardingPlan.blockers.slice(0, 5).map((blocker) => ({ id: blocker.id, title: "Understanding proof missing", summary: blocker.summary, source_refs: ["artifact-onboarding-plan"] })),
        { id: "acceptance-missing", title: "Acceptance criteria not defined", summary: "Falsifiable acceptance criteria and non-goals are not yet defined.", source_refs: ["artifact-goal-input"] }
      ],
      sourceArtifactCount: checkpoint.artifacts.length,
      omittedItemCount: checkpoint.packet.compression.omitted_item_count,
      generatedAt,
      dataSource: "runtime"
    });
    const stored = await appendGoalRunCheckpoint({
      dataRoot,
      repositoryIdentity: snapshot.repository.identity,
      runId: currentRun.id,
      events: checkpoint.events,
      nextRun: checkpoint.run,
      scorecard,
      packet: checkpoint.packet,
      artifacts: checkpoint.artifacts
    });
    const understandingArtifact = checkpoint.artifacts.find((entry) => entry.id === "artifact-understanding-baseline") ?? null;
    const systemModelArtifact = checkpoint.artifacts.find((entry) => entry.id === "artifact-system-model") ?? null;
    const strategyArtifact = checkpoint.artifacts.find((entry) => entry.id === "artifact-design-strategy") ?? null;
    const result = {
      run: checkpoint.run,
      interaction: checkpoint.packet,
      scorecard,
      path: stored.paths.checkpoint,
      understanding_baseline_id: understandingArtifact?.value?.id ?? null,
      system_model_id: systemModelArtifact?.value?.id ?? null,
      design_strategy_id: strategyArtifact?.value?.id ?? null,
      next_action: nextRunAction(checkpoint.run)
    };
    io.log(options.format === "json"
      ? JSON.stringify(result, null, 2)
      : `Goal Run advanced: ${checkpoint.run.id}\nState: ${checkpoint.run.state}\nAlignment: ${checkpoint.packet.verdict}\nUnderstanding baseline: ${understandingArtifact?.value?.id ?? "n/a"} (${understandingArtifact?.value?.verdict ?? "n/a"})\nSystem model: ${systemModelArtifact?.value?.id ?? "n/a"} (${systemModelArtifact?.value?.verdict ?? "n/a"})\nDesign strategy: ${strategyArtifact?.value?.id ?? "n/a"} (${strategyArtifact?.value?.status ?? "n/a"})\nScope approval: unavailable\nMissing proof: ${onboardingPlan.blockers.length}\nNext: ${result.next_action}\nStored externally: ${stored.paths.checkpoint}`);
    return checkpoint.packet.verdict === "ready" ? 0 : 2;
  }

  if (options.command === "review") {
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const start = services.startReviewServer ?? startReviewServer;
    let declarationConfig;
    if (options.configPath) {
      declarationConfig = (await loadConfiguredProject(snapshot, options)).config;
    } else {
      declarationConfig = proposeProjectConfig(snapshot);
    }
    if (!options.configPath && !snapshot.repository.git.dirty) {
      try {
        declarationConfig = (await readProjectConfig(fileURLToPath(snapshot.repository.root_uri))).config;
      } catch (error) {
        if (!error.message.startsWith("No devharness.yaml exists.")) throw error;
      }
    }
    const declarationReview = await createProjectDeclarationReview(snapshot, declarationConfig, { allowDirtyBaseline: options.allowDirty });
    const live = await start({ dataRoot, repositoryIdentity: snapshot.repository.identity, declarationReview, port: options.port, allowedOrigin: options.uiOrigin });
    const reviewUrl = `${options.uiOrigin}/#api=${encodeURIComponent(live.origin)}&token=${live.token}`;
    io.log(options.format === "json"
      ? JSON.stringify({ api_origin: live.origin, review_url: reviewUrl, repository_identity: snapshot.repository.identity }, null, 2)
      : `Review service: ${live.origin}\nRepository: ${snapshot.repository.identity}\nOpen: ${reviewUrl}\nRead-only. Keep this process running while reviewing.`);
    return 0;
  }

  if (options.command === "request-approval") {
    if (!options.runId || !options.gate || !options.subjectId || !options.subjectSha256) {
      throw new Error("request-approval requires --run, --gate, --subject and --subject-sha");
    }
    if (!snapshot.repository.git.head_sha || snapshot.repository.git.dirty) {
      throw new Error("Approval requests require a clean committed repository revision.");
    }
    if (options.gate === "capability") throw new Error("Capability subjects must be derived from the current Goal Run; use request-capability.");
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    await initializeSupervisorIdentity(supervisorRoot);
    const request = await createSupervisorApprovalRequest({
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      relevantHeadSha: snapshot.repository.git.head_sha,
      runId: options.runId,
      gate: options.gate,
      subject: { id: options.subjectId, artifact_sha256: options.subjectSha256 },
      expiresInMinutes: options.expiresInMinutes ?? 60
    });
    io.log(options.format === "json" ? JSON.stringify({ request }, null, 2) : `Approval requested: ${request.id}\nGate: ${request.gate}\nSubject: ${request.subject.id}\nRevision: ${request.relevant_head_sha}\nIssuer: ${request.attestation.issuer_fingerprint}\nExpires: ${request.expires_at}`);
    return 0;
  }

  if (options.command === "request-capability") {
    if (!options.runId) throw new Error("request-capability requires --run");
    const modeCount = [options.forVerify, options.forAlign, Boolean(options.capabilityId)].filter(Boolean).length;
    if (modeCount > 1) {
      throw new Error("Pass only one of --capability, --for-verify, or --for-align.");
    }
    if (modeCount === 0) {
      throw new Error("request-capability requires --capability ID, --for-verify, or --for-align");
    }
    if (options.approveAfterRequest && !options.forVerify && !options.forAlign) {
      throw new Error("--approve is only valid with --for-verify or --for-align");
    }
    if (!snapshot.repository.git.head_sha || snapshot.repository.git.dirty) throw new Error("Capability requests require a clean committed repository revision.");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    await initializeSupervisorIdentity(supervisorRoot);
    const now = () => new Date(services.now?.() ?? Date.now());

    if (options.forVerify) {
      const defaults = await resolveVerifyDefaultsFromReadiness({
        dataRoot,
        repositoryIdentity: snapshot.repository.identity,
        runId: options.runId,
        commandId: options.commandId,
        commitSha: options.commitSha
      });
      if (!defaults.command_id) {
        throw new Error("request-capability --for-verify needs --command ID or a readiness summary with verify_command_id from advance.");
      }
      const { config } = await loadConfiguredProject(snapshot, options);
      const plan = await createVerificationPlan({
        snapshot,
        config,
        commandId: defaults.command_id,
        goalRunId: options.runId,
        dataRoot,
        timeoutMs: options.timeoutMs,
        commitSha: defaults.commit_sha
      });
      const authorizationView = await loadCapabilityAuthorizationView({
        dataRoot,
        supervisorRoot,
        repositoryIdentity: snapshot.repository.identity,
        runId: options.runId,
        now: now()
      });
      const batch = await requestMissingVerifyCapabilities({
        dataRoot,
        supervisorRoot,
        repositoryIdentity: snapshot.repository.identity,
        runId: options.runId,
        plan,
        authorizationView,
        controlledChange: defaults.controlled_change,
        expiresInMinutes: options.expiresInMinutes,
        now
      });

      let approval = null;
      if (options.approveAfterRequest) {
        if (options.format === "json") {
          throw new Error("Approval is unavailable in JSON mode; omit --approve or use the foreground TTY without --format json.");
        }
        if (batch.approve_request_ids.length === 0) {
          approval = { decision: "not-needed", request_ids: [], receipts: [] };
        } else {
          const capabilitiesByRequestId = {};
          for (const requestId of batch.approve_request_ids) {
            const capability = await resolveCapabilityApprovalContext({
              dataRoot,
              supervisorRoot,
              repositoryIdentity: snapshot.repository.identity,
              requestId,
              now: now()
            });
            if (capability) capabilitiesByRequestId[requestId] = capability;
          }
          const recorded = await recordInteractiveApprovalDecisions({
            supervisorRoot,
            repositoryIdentity: snapshot.repository.identity,
            requestIds: batch.approve_request_ids,
            capabilitiesByRequestId,
            responseProvider: services.approveResponse ?? null,
            now
          });
          approval = {
            decision: recorded.decision,
            request_ids: recorded.request_ids,
            receipts: recorded.receipts.map((receipt) => ({ id: receipt.id, request_id: receipt.request_id }))
          };
        }
      }

      const payload = { ...batch, approval };
      if (options.format === "json") {
        io.log(JSON.stringify(payload, null, 2));
      } else if (batch.already_satisfied || (batch.gap.allowed && batch.approve_request_ids.length === 0)) {
        io.log(`Verify capabilities already approved for ${defaults.command_id}.\nRequired: ${batch.gap.required_capability_ids.join(", ") || "none"}\nNext: devharness verify --run ${options.runId} --command ${defaults.command_id}${defaults.commit_sha ? ` --commit ${defaults.commit_sha}` : ""} --execute --attest`);
      } else if (approval?.decision === "approved") {
        io.log(`Verify capabilities approved (${approval.request_ids.length}).\nCommand: ${defaults.command_id}\nRequired: ${batch.gap.required_capability_ids.join(", ")}\nRequests: ${approval.request_ids.join(" ")}\nNext: devharness verify --run ${options.runId} --command ${defaults.command_id}${defaults.commit_sha ? ` --commit ${defaults.commit_sha}` : ""} --execute --attest`);
      } else if (approval && approval.decision !== "not-needed") {
        io.log(`Verify capability batch decision: ${approval.decision}\nRequests: ${(approval.request_ids ?? []).join(" ") || "none"}`);
      } else {
        const reqList = batch.results.map((item) => `${item.capability_id}=${item.request_id}${item.reused ? ` (${item.reuse_kind})` : ""}`).join("\n");
        const approveHint = batch.approve_request_ids.length
          ? `devharness approve --repo ${fileURLToPath(snapshot.repository.root_uri)} --data-dir ${dataRoot} --run ${options.runId} --pending`
          : `devharness verify --run ${options.runId} --command ${defaults.command_id}${defaults.commit_sha ? ` --commit ${defaults.commit_sha}` : ""} --execute --attest`;
        io.log(`Verify capabilities requested for ${defaults.command_id}\nRequired: ${batch.gap.required_capability_ids.join(", ")}\n${reqList}\nNext: ${approveHint}`);
      }
      return (approval?.decision === "rejected") ? 2 : 0;
    }

    if (options.forAlign) {
      const authorizationView = await loadCapabilityAuthorizationView({
        dataRoot,
        supervisorRoot,
        repositoryIdentity: snapshot.repository.identity,
        runId: options.runId,
        now: now()
      });
      const batch = await requestMissingAlignCapabilities({
        dataRoot,
        supervisorRoot,
        repositoryIdentity: snapshot.repository.identity,
        runId: options.runId,
        authorizationView,
        expiresInMinutes: options.expiresInMinutes,
        now
      });

      let approval = null;
      if (options.approveAfterRequest) {
        if (options.format === "json") {
          throw new Error("Approval is unavailable in JSON mode; omit --approve or use the foreground TTY without --format json.");
        }
        if (batch.approve_request_ids.length === 0) {
          approval = { decision: "not-needed", request_ids: [], receipts: [] };
        } else {
          const capabilitiesByRequestId = {};
          for (const requestId of batch.approve_request_ids) {
            const capability = await resolveCapabilityApprovalContext({
              dataRoot,
              supervisorRoot,
              repositoryIdentity: snapshot.repository.identity,
              requestId,
              now: now()
            });
            if (capability) capabilitiesByRequestId[requestId] = capability;
          }
          const recorded = await recordInteractiveApprovalDecisions({
            supervisorRoot,
            repositoryIdentity: snapshot.repository.identity,
            requestIds: batch.approve_request_ids,
            capabilitiesByRequestId,
            responseProvider: services.approveResponse ?? null,
            now
          });
          approval = {
            decision: recorded.decision,
            request_ids: recorded.request_ids,
            receipts: recorded.receipts.map((receipt) => ({ id: receipt.id, request_id: receipt.request_id }))
          };
        }
      }

      const payload = { ...batch, approval };
      if (options.format === "json") {
        io.log(JSON.stringify(payload, null, 2));
      } else if (batch.already_satisfied || (batch.gap.allowed && batch.approve_request_ids.length === 0)) {
        io.log(`Align capabilities already approved.\nRequired: ${batch.gap.required_capability_ids.join(", ") || "none"}\nNext: devharness align --continue --run ${options.runId}`);
      } else if (approval?.decision === "approved") {
        io.log(`Align capabilities approved (${approval.request_ids.length}).\nRequired: ${batch.gap.required_capability_ids.join(", ")}\nRequests: ${approval.request_ids.join(" ")}\nNext: devharness align --continue --run ${options.runId}`);
      } else if (approval && approval.decision !== "not-needed") {
        io.log(`Align capability batch decision: ${approval.decision}\nRequests: ${(approval.request_ids ?? []).join(" ") || "none"}`);
      } else {
        const reqList = batch.results.map((item) => `${item.capability_id}=${item.request_id}${item.reused ? ` (${item.reuse_kind})` : ""}`).join("\n");
        const approveHint = batch.approve_request_ids.length
          ? `devharness approve --repo ${fileURLToPath(snapshot.repository.root_uri)} --data-dir ${dataRoot} --run ${options.runId} --pending`
          : `devharness align --continue --run ${options.runId}`;
        io.log(`Align capabilities requested\nRequired: ${batch.gap.required_capability_ids.join(", ")}\n${reqList}\nNext: ${approveHint}`);
      }
      return (approval?.decision === "rejected") ? 2 : 0;
    }

    const result = await requestCapabilityAuthorization({
      dataRoot,
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      runId: options.runId,
      capabilityId: options.capabilityId,
      expiresInMinutes: options.expiresInMinutes,
      now
    });
    if (options.format === "json") {
      io.log(JSON.stringify(result, null, 2));
    } else if (result.reused && result.reuse_kind === "approved-grant") {
      io.log(`Capability already approved within TTL: ${result.capability.id}\nOperation: ${result.capability.operation}\nTarget: ${result.capability.target}\nRequest: ${result.request.id}\nReceipt: ${result.receipt.id}\nExpires: ${result.receipt.expires_at}\nNext: no new TTY approve required for this grant`);
    } else if (result.reused && result.reuse_kind === "pending-request") {
      io.log(`Capability already pending: ${result.capability.id}\nOperation: ${result.capability.operation}\nTarget: ${result.capability.target}\nRequest: ${result.request.id}\nExpires: ${result.request.expires_at} (${result.expires_in_minutes} minutes)\nNext: devharness approve --repo ${fileURLToPath(snapshot.repository.root_uri)} --data-dir ${dataRoot} --request ${result.request.id}`);
    } else {
      io.log(`Capability approval requested: ${result.capability.id}\nOperation: ${result.capability.operation}\nTarget: ${result.capability.target}\nScope: ${result.capability.scope.join(", ")}\nRisk: ${result.capability.risk}\nRequest: ${result.request.id}\nExpires: ${result.request.expires_at} (${result.expires_in_minutes} minutes)\nNext: devharness approve --repo ${fileURLToPath(snapshot.repository.root_uri)} --data-dir ${dataRoot} --request ${result.request.id}`);
    }
    return 0;
  }

  if (options.command === "approve") {
    if (options.format === "json") throw new Error("Approval is unavailable in JSON mode; use the authenticated foreground TTY.");
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const supervisorRoot = services.supervisorRoot ?? defaultSupervisorRoot();
    const now = () => new Date(services.now?.() ?? Date.now());
    let requestIds = [...options.requestIds];
    if (options.pending) {
      if (!options.runId) throw new Error("approve --pending requires --run ID");
      const pending = await listPendingApprovalRequestsForRun({
        supervisorRoot,
        repositoryIdentity: snapshot.repository.identity,
        runId: options.runId,
        now: now()
      });
      if (pending.length === 0) throw new Error(`No pending approval requests for run ${options.runId}.`);
      const pendingIds = pending.map((request) => request.id);
      requestIds = requestIds.length > 0
        ? requestIds.filter((id) => pendingIds.includes(id))
        : pendingIds;
      if (requestIds.length === 0) throw new Error("None of the supplied --request ids are pending for that run.");
    }
    if (requestIds.length === 0) {
      throw new Error("approve requires --request ID (repeatable) or --run ID --pending");
    }
    const capabilitiesByRequestId = {};
    for (const requestId of requestIds) {
      const capability = await resolveCapabilityApprovalContext({
        dataRoot,
        supervisorRoot,
        repositoryIdentity: snapshot.repository.identity,
        requestId,
        now: now()
      });
      if (capability) capabilitiesByRequestId[requestId] = capability;
    }
    const batch = await recordInteractiveApprovalDecisions({
      supervisorRoot,
      repositoryIdentity: snapshot.repository.identity,
      requestIds,
      capabilitiesByRequestId,
      responseProvider: services.approveResponse ?? null,
      now
    });
    const gateLines = [];
    for (const receipt of batch.receipts) {
      if (!["scope", "delivery"].includes(receipt.gate)) continue;
      const gateApplication = await applyRunGateFromApprovalReceipt({
        dataRoot,
        repositoryIdentity: snapshot.repository.identity,
        receipt,
        now
      });
      if (gateApplication?.applied) {
        gateLines.push(`Goal Run gate: ${receipt.gate}=${gateApplication.run.gates[receipt.gate].status}`);
      } else if (gateApplication?.reason === "already-applied") {
        gateLines.push(`Goal Run gate: ${receipt.gate} already ${gateApplication.run.gates[receipt.gate].status}`);
      }
    }
    const receiptLines = batch.receipts.map((receipt) => `Receipt: ${receipt.id} (${receipt.request_id})`).join("\n");
    const gateBlock = gateLines.length ? `\n${gateLines.join("\n")}` : "";
    io.log(`Decision recorded: ${batch.decision}\nRequests: ${batch.request_ids.join(" ")}\n${receiptLines}\nIssuer: ${batch.receipts[0].attestation.issuer_fingerprint}${gateBlock}`);
    return batch.decision === "approved" ? 0 : 2;
  }

  if (options.command === "onboard") {
    if (options.execute) throw new Error("onboard never executes project actions; review its capability plan instead");
    let config = null;
    let configError = null;
    let configSource = options.configPath ? "external" : "tracked";
    try {
      ({ config, source: configSource } = await loadConfiguredProject(snapshot, options));
    } catch (error) {
      configError = error.message;
    }
    const trustContext = snapshot.repository.git.head_sha ? await loadTrustedEvaluationContext({ snapshot }) : undefined;
    const report = evaluateReadiness(snapshot, { trustContext, config, configError, configSource });
    const plan = await createOnboardingPlan(snapshot, { report, config, configError, configSource });
    const phase1 = plan.commit_sha
      ? await createValidatedPhase1UnderstandingBundleFromOnboardingPlan(plan, { snapshot })
      : null;
    const understandingBaseline = phase1?.baseline ?? null;
    const systemModel = phase1?.systemModel ?? null;
    const designStrategy = phase1?.strategy ?? null;
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const targetPath = onboardingPlanPath(dataRoot, snapshot.repository.identity, plan.id);
    const stored = options.write ? await writeOnboardingPlan(targetPath, plan) : { path: targetPath, written: false };
    let baselineStored = { path: null, written: false };
    let modelStored = { path: null, written: false };
    let strategyStored = { path: null, written: false };
    if (options.write && understandingBaseline) {
      const baselinePath = understandingBaselinePath(dataRoot, snapshot.repository.identity, understandingBaseline.id);
      baselineStored = await writeUnderstandingBaseline(baselinePath, understandingBaseline);
    }
    if (options.write && systemModel) {
      const modelPath = systemModelPath(dataRoot, snapshot.repository.identity, systemModel.id);
      modelStored = await writeSystemModel(modelPath, systemModel);
    }
    if (options.write && designStrategy) {
      const strategyPath = designStrategyPath(dataRoot, snapshot.repository.identity, designStrategy.id);
      strategyStored = await writeDesignStrategy(strategyPath, designStrategy);
    }
    const brief = understandingBaseline
      ? formatAuditableUnderstandingBrief(understandingBaseline, { onboardingPlan: plan })
      : formatRepositoryUnderstandingBrief(plan);
    if (options.format === "json") {
      io.log(JSON.stringify({
        snapshot,
        report,
        plan,
        understanding_baseline: understandingBaseline,
        system_model: systemModel,
        design_strategy: designStrategy,
        path: stored.path,
        written: stored.written,
        baseline_path: baselineStored.path,
        baseline_written: baselineStored.written,
        system_model_path: modelStored.path,
        system_model_written: modelStored.written,
        design_strategy_path: strategyStored.path,
        design_strategy_written: strategyStored.written
      }, null, 2));
    } else {
      const storeLines = [];
      if (stored.written) storeLines.push(`Stored onboarding plan: ${stored.path}`);
      if (baselineStored.written) storeLines.push(`Stored understanding baseline: ${baselineStored.path}`);
      if (modelStored.written) storeLines.push(`Stored system model draft: ${modelStored.path}`);
      if (strategyStored.written) storeLines.push(`Stored design strategy draft: ${strategyStored.path}`);
      if (!stored.written && !baselineStored.written && !modelStored.written && !strategyStored.written) {
        storeLines.push("Dry run only. Add --write to store the onboarding plan, understanding baseline, system model, and design strategy outside the consumer repository.");
      }
      io.log([brief, "", ...storeLines].join("\n"));
    }
    return plan.verdict === "ready" ? 0 : 2;
  }

  if (options.command === "doctor") {
    let config = null;
    let configError = null;
    let configSource = options.configPath ? "external" : "tracked";
    try {
      ({ config, source: configSource } = await loadConfiguredProject(snapshot, options));
    } catch (error) {
      configError = error.message;
    }
    const trustContext = snapshot.repository.git.head_sha ? await loadTrustedEvaluationContext({ snapshot }) : undefined;
    const report = evaluateReadiness(snapshot, { trustContext, config, configError, configSource });
    io.log(options.format === "json" ? JSON.stringify({ snapshot, report }, null, 2) : formatReadinessReport(report));
    return report.overall.verdict === "ready" ? 0 : 2;
  }

  if (options.command === "verify") {
    if (options.attest && !options.execute) throw new Error("--attest requires --execute; planned commands cannot become evidence");
    if (options.execute && !options.runId) throw new Error("Public execution requires --run ID so signed capability authority can be verified.");
    const { dataRoot: verifyDataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    if (!options.commandId && options.runId) {
      try {
        const readiness = await loadRunSourceArtifact(verifyDataRoot, snapshot.repository.identity, options.runId, "artifact-readiness-summary");
        if (readiness.value?.verify_command_id) options.commandId = readiness.value.verify_command_id;
      } catch {}
    }
    if (!options.commandId) {
      throw new Error("verify requires --command ID (or a readiness summary that already selected one during advance)");
    }
    const { config } = await loadConfiguredProject(snapshot, options);
    const plan = await createVerificationPlan({
      snapshot,
      config,
      commandId: options.commandId,
      goalRunId: options.runId,
      dataRoot: options.dataRoot,
      timeoutMs: options.timeoutMs,
      commitSha: options.commitSha
    });
    if (!options.execute) {
      io.log(options.format === "json" ? JSON.stringify({ plan, execute: false }, null, 2) : `${formatVerificationPlan(plan)}\nDry run only. Add --execute to run this approved command.`);
      return 0;
    }
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const authorizationView = await loadCapabilityAuthorizationView({
      dataRoot,
      supervisorRoot: services.supervisorRoot ?? defaultSupervisorRoot(),
      repositoryIdentity: snapshot.repository.identity,
      runId: options.runId,
      now: new Date(services.now?.() ?? Date.now())
    });
    const controlledChange = await loadControlledChangeAuthorityContext({
      dataRoot,
      repositoryIdentity: snapshot.repository.identity,
      runId: options.runId,
      commitSha: plan.commit_sha
    });
    const authority = evaluateVerificationExecutionAuthority(plan, authorizationView, { controlledChange });
    if (!authority.allowed) throw new Error(`Verification execution lacks current capability authority: ${authority.reasons.map((reason) => reason.message).join(" ")}`);
    const receipt = await executeVerificationPlan(plan);
    let evidence = null;
    let attestation = { status: "not-requested", reason: null, summary: "No passing evidence was requested." };
    if (options.attest) {
      if (receipt.outcome.status !== "pass") {
        attestation = {
          status: "not-issued",
          reason: "execution-failed",
          summary: "the execution failed; failure receipts remain reviewable but cannot become passing evidence"
        };
      } else if (!["test", "verify"].includes(receipt.command.kind)) {
        attestation = {
          status: "not-issued",
          reason: "sealed-driver-unavailable",
          summary: `no sealed evidence driver is registered for ${receipt.command.kind} receipts`
        };
      } else {
        const supervisorRoot = defaultSupervisorRoot();
        await initializeSupervisorIdentity(supervisorRoot);
        const issueEvidence = receipt.command.kind === "verify" ? issueCommandSystemEvidence : issueCommandTestEvidence;
        evidence = await issueEvidence({
          supervisorRoot,
          receiptRoot: options.dataRoot,
          snapshot,
          config,
          receiptId: receipt.id,
          runId: receipt.goal_run_id ?? options.runId,
          commitSha: receipt.commit_sha,
          criterion: {
            id: `configured-tests-${receipt.command.id}`,
            claim: `The configured ${receipt.command.id} ${receipt.command.kind === "verify" ? "system verification" : "automated tests"} pass at the attested revision.`
          }
        });
        attestation = { status: "issued", reason: null, summary: "Supervisor passing evidence was issued." };
      }
    }
    let scorecardRefresh = null;
    if (options.attest && evidence && receipt.outcome.status === "pass") {
      try {
        scorecardRefresh = await maybeRefreshDocsOnlyScorecardAfterVerify({
          snapshot,
          dataRoot,
          runId: options.runId,
          commandId: options.commandId,
          receipt,
          evidence,
          generatedAt: services.now?.() ?? new Date().toISOString()
        });
      } catch (error) {
        scorecardRefresh = { error: error.message };
      }
    }
    if (options.format === "json") {
      const payload = {
        receipt,
        evidence_manifest: evidence?.manifest ?? null,
        attestation
      };
      if (scorecardRefresh?.error) payload.scorecard_refresh = { error: scorecardRefresh.error };
      else if (scorecardRefresh?.scorecard) {
        payload.scorecard_refresh = {
          verdict: scorecardRefresh.scorecard.verdict,
          title: scorecardRefresh.scorecard.title,
          blocking: scorecardRefresh.scorecard.exception_counts.blocking,
          path: scorecardRefresh.path
        };
      }
      io.log(JSON.stringify(payload, null, 2));
    } else {
      io.log(formatVerificationExecutionResult({ receipt, receiptPath: plan.paths.receipt, evidence, attestation, format: options.format }));
      if (scorecardRefresh?.scorecard) {
        io.log(`Docs-only scorecard: ${scorecardRefresh.scorecard.verdict} (${scorecardRefresh.scorecard.exception_counts.blocking} blocking)\nStored: ${scorecardRefresh.path}`);
      } else if (scorecardRefresh?.error) {
        io.log(`Docs-only scorecard refresh failed: ${scorecardRefresh.error}`);
      }
    }
    if (receipt.outcome.status !== "pass") return 3;
    return options.attest && !evidence ? 4 : 0;
  }

  if (options.command === "build") {
    const { config } = await loadConfiguredProject(snapshot, options);
    const { dataRoot } = resolveExternalDataRoot(snapshot.repository.root_uri, options.dataRoot);
    const manifest = await compileProjectHarness(snapshot, config);
    const targetPath = projectHarnessPath(dataRoot, snapshot.repository.identity, manifest.id);
    const stored = options.write ? await writeProjectHarness(targetPath, manifest) : { path: targetPath, written: false };
    if (options.format === "json") {
      io.log(JSON.stringify({ manifest, path: stored.path, written: stored.written }, null, 2));
    } else {
      io.log(formatProjectHarness(manifest, stored.path));
      io.log(stored.written ? "Project harness written." : "Dry run only. Review blockers, then add --write to store this external harness.");
    }
    return manifest.blockers.length === 0 ? 0 : 2;
  }

  const result = await initializeProject(snapshot, { write: options.write });
  if (options.format === "json") {
    io.log(JSON.stringify({ config: result.config, path: result.path, written: result.written }, null, 2));
  } else if (result.written) {
    io.log(`Created ${result.path}`);
  } else {
    io.log(result.content);
    io.log("Dry run only. Review this proposal, then add --write to create devharness.yaml.");
  }
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    process.exitCode = await runCli(process.argv.slice(2));
  } catch (error) {
    console.error(`DevHarness error: ${error.message}`);
    process.exitCode = 1;
  }
}

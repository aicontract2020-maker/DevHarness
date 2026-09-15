import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadTrustedEvaluationContext } from "../../core/src/trusted-context.mjs";
import { hashContract } from "../../project/src/harness.mjs";
import { projectValidatedAlignment } from "../../project/src/live-alignment.mjs";
import { canonicalDigest, canonicalJson, canonicalRecordId } from "./canonical-records.mjs";
import { runBoundedAgentWorker } from "./agent-worker.mjs";
import {
  appendAlignmentOperationJournal,
  alignmentOperationPaths,
  loadAlignmentOperationJournal,
  writeAlignmentOperationLease,
  writeAlignmentOperationStatus
} from "./alignment-operation-store.mjs";
import {
  loadCapabilityAuthorizationView,
  resolveNetworkResearchAuthorityFromCapabilityGrants
} from "./capability-authorization.mjs";
import { defaultSupervisorRoot } from "./data-store.mjs";
import { loadGoalRun } from "./goal-run-store.mjs";
import { acquireOperationLease, heartbeatOperationLease } from "./operation-lease.mjs";
import {
  buildLiveAlignmentLease,
  buildLiveAlignmentStatus,
  loadLiveAlignmentOperationBundle,
  findLiveAlignmentOperationBundleByRun,
  projectLiveAlignmentOperationStatus,
  stableLiveAlignmentExecutionId
} from "./live-alignment.mjs";
import { createNetworkResearchSubject, createResearchOriginCandidate, createResearchRequestRecipe, isOutboundResearchQuerySafe } from "./research-policy.mjs";
import { runControlledResearchGateway } from "./research-gateway.mjs";
import {
  buildLocalReadonlyGoalAnalysis,
  buildLocalReadonlyValidation,
  expectedDomainsFromSnapshot
} from "./local-readonly-artifacts.mjs";
import {
  CODEX_ADAPTER_ID,
  closeProviderProxy,
  defaultCodexProfile,
  prepareCodexExecutionContext,
  resolveProviderCredential
} from "./codex-runtime.mjs";

const DEFAULT_LEASE_TTL_SECONDS = 120;

function continueError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

export function unresolvedLiveAlignmentDecisions(packet, answers = []) {
  const answered = new Set((answers ?? []).map((answer) => answer.decision_id));
  return (packet?.decisions ?? []).filter((decision) => !answered.has(decision.id));
}

export async function defaultLiveAlignmentOwnerAlive(lease) {
  if (!Number.isInteger(lease?.pid) || lease.pid <= 0) return false;
  try {
    process.kill(lease.pid, 0);
    return true;
  } catch (error) {
    if (error.code === "ESRCH") return false;
    return error.code === "EPERM";
  }
}

function sameLeaseOwner(left, right) {
  return left?.owner_id === right?.owner_id
    && left?.boot_id === right?.boot_id
    && left?.pid === right?.pid
    && left?.process_birth_id === right?.process_birth_id;
}

function buildJournalRecord(operationId, sequence, previousSha256, type, data, occurredAt, actor = "runtime") {
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

async function appendJournal(dataRoot, repositoryIdentity, operationId, type, data, now, actor = "runtime") {
  const journal = await loadAlignmentOperationJournal(dataRoot, repositoryIdentity, operationId);
  const record = buildJournalRecord(operationId, journal.sequence + 1, journal.head_sha256, type, data, now().toISOString(), actor);
  await appendAlignmentOperationJournal(dataRoot, repositoryIdentity, record, {
    expectedSequence: journal.sequence,
    expectedPreviousSha256: journal.head_sha256
  });
  return record;
}

async function writeJsonReplace(target, value) {
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const temporary = `${target}.${process.pid}.${randomUUID()}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.writeFile(`${canonicalJson(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, target);
}

function liveOwner({ pid = process.pid, ownerId = `devharness-cli:${pid}`, bootId = stableLiveAlignmentExecutionId(), processBirthId = stableLiveAlignmentExecutionId() } = {}) {
  return {
    owner_id: ownerId,
    boot_id: bootId,
    pid,
    process_birth_id: processBirthId
  };
}

export async function claimLiveAlignmentLease({
  dataRoot,
  repositoryIdentity,
  operation,
  existingLease = null,
  owner = liveOwner(),
  now = () => new Date(),
  isOwnerAlive = defaultLiveAlignmentOwnerAlive,
  ttlSeconds = DEFAULT_LEASE_TTL_SECONDS
}) {
  const acquiredAt = now();
  const nextLease = buildLiveAlignmentLease(operation, {
    ...owner,
    acquired_at: acquiredAt.toISOString(),
    wall_expires_at: new Date(acquiredAt.getTime() + ttlSeconds * 1000).toISOString(),
    heartbeat_sequence: 0,
    heartbeat_at: acquiredAt.toISOString()
  });
  if (!existingLease) {
    await writeAlignmentOperationLease(dataRoot, repositoryIdentity, nextLease);
    return { lease: nextLease, replaced: false, refreshed: false };
  }
  if (sameLeaseOwner(existingLease, nextLease)) {
    const heartbeated = await heartbeatOperationLease(dataRoot, repositoryIdentity, existingLease, {
      now,
      wallExpiresInSeconds: ttlSeconds
    });
    return { lease: heartbeated.lease, replaced: false, refreshed: true };
  }
  const ownerAlive = await isOwnerAlive(existingLease);
  if (ownerAlive) {
    throw continueError("ATTEMPT_IN_PROGRESS", "Operation lease is still owned by a live process.");
  }
  const expired = Date.parse(existingLease.wall_expires_at) <= now().getTime();
  if (expired) {
    const acquired = await acquireOperationLease(dataRoot, repositoryIdentity, nextLease, { now, isOwnerAlive });
    return { lease: acquired.lease, replaced: true, refreshed: false, stale_owner: acquired.stale_owner };
  }
  // Dead owner, wall clock not yet expired: CLI resume, not reconcile-timeout.
  await writeAlignmentOperationLease(dataRoot, repositoryIdentity, nextLease);
  return { lease: nextLease, replaced: true, refreshed: false, stale_owner: existingLease };
}

function agentRuntimeApproved(capabilityView) {
  return Boolean(capabilityView?.capabilities?.some((item) => (
    item.request?.id === "agent-runtime" || item.request?.capability === "agent-runtime"
  ) && item.status === "approved"));
}

function approvedResearchTasks(capabilityView, analysisPlan) {
  const planById = new Map((analysisPlan?.research_tasks ?? []).map((task) => [task.id, task]));
  const fromView = (capabilityView?.research_tasks ?? []).filter((task) => task.status === "approved");
  if (fromView.length > 0) return fromView.map((task) => ({ ...planById.get(task.id), ...task }));
  const approvedIds = new Set((capabilityView?.capabilities ?? [])
    .filter((item) => item.status === "approved")
    .map((item) => item.request?.id));
  return (analysisPlan?.research_tasks ?? []).filter((task) => approvedIds.has(task.id));
}

function pendingResearchTasks(capabilityView, analysisPlan) {
  const fromView = (capabilityView?.research_tasks ?? []).filter((task) => task.status === "pending-approval");
  if (fromView.length > 0) return fromView;
  const approvedOrBlocked = new Set((capabilityView?.capabilities ?? [])
    .filter((item) => ["approved", "rejected", "expired", "stale"].includes(item.status))
    .map((item) => item.request?.id));
  return (analysisPlan?.research_tasks ?? []).filter((task) => !approvedOrBlocked.has(task.id));
}

function artifactRef(id, kind, sha256, storageKey, sizeBytes) {
  return {
    id,
    kind,
    sha256,
    media_type: "application/json",
    size_bytes: sizeBytes,
    storage_key: storageKey
  };
}

function nextPhase(phase) {
  if (phase === "analysis-plan") return "analysis-synthesis";
  if (phase === "analysis-synthesis") return "analysis-validation";
  return null;
}

async function readAdapterResult(workerResult) {
  const resultPath = workerResult?.worker?.output?.result_path;
  if (!resultPath) return null;
  try {
    return JSON.parse(await readFile(resultPath, "utf8"));
  } catch {
    return null;
  }
}

function developerAnswerRefs(answers = []) {
  return (answers ?? []).slice(0, 20).map((answer) => artifactRef(
    answer.id,
    "developer-answer",
    hashContract(answer),
    answer.storage_key ?? `artifacts/developer-answers/${answer.id}.json`,
    Buffer.byteLength(`${canonicalJson(answer)}\n`)
  ));
}

async function persistOperationArtifact(dataRoot, repositoryIdentity, operationId, storageKey, id, kind, value) {
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operationId);
  const target = path.join(paths.root, storageKey);
  await writeJsonReplace(target, value);
  const raw = `${canonicalJson(value)}\n`;
  return artifactRef(id, kind, hashContract(value), storageKey, Buffer.byteLength(raw));
}

async function publishLocalReadonlyValidation({
  dataRoot,
  repositoryIdentity,
  bundle,
  snapshot,
  workerResult,
  now
}) {
  const adapterResult = await readAdapterResult(workerResult);
  const expectedDomains = expectedDomainsFromSnapshot(snapshot);
  const operation = bundle.operation;
  const goalAnalysis = adapterResult?.goal_analysis?.id
    ? adapterResult.goal_analysis
    : buildLocalReadonlyGoalAnalysis({
      operationId: operation.id,
      expectedDomains
    });
  const validation = adapterResult?.validation?.producer_analysis_id === goalAnalysis.id
    ? adapterResult.validation
    : buildLocalReadonlyValidation({
      operationId: operation.id,
      invocationId: workerResult.invocation?.id,
      goalAnalysis,
      expectedDomains
    });
  const goalAnalysisRef = await persistOperationArtifact(
    dataRoot,
    repositoryIdentity,
    operation.id,
    "artifacts/goal-analysis.json",
    goalAnalysis.id,
    "goal-analysis",
    goalAnalysis
  );
  const validationRef = await persistOperationArtifact(
    dataRoot,
    repositoryIdentity,
    operation.id,
    "artifacts/analysis-validation.json",
    validation.id,
    "analysis-validation",
    validation
  );
  const seed = {
    schema_version: 1,
    id: `alignment-bundle-local-${hashContract({ operation_id: operation.id, analysis_id: goalAnalysis.id }).slice(0, 24)}`,
    operation_id: operation.id,
    run_id: operation.run_id,
    repository_identity: operation.repository_identity,
    commit_sha: operation.commit_sha,
    goal_ref: operation.original_goal,
    developer_answer_refs: developerAnswerRefs(bundle.developerAnswers),
    agent_descriptor: operation.agent_descriptor,
    analysis_plan_ref: bundle.status.analysis_plan_ref,
    research_source_refs: [],
    research_gaps: [],
    goal_analysis_ref: goalAnalysisRef,
    validation_ref: validationRef
  };
  const trustContext = await loadTrustedEvaluationContext({ snapshot });
  const published = await projectValidatedAlignment({
    bundle: seed,
    goalAnalysis,
    validation,
    trustContext,
    generatedAt: now().toISOString()
  });
  const resultBundleRef = await persistOperationArtifact(
    dataRoot,
    repositoryIdentity,
    operation.id,
    "artifacts/alignment-bundle.json",
    published.bundle.id,
    "alignment-bundle",
    published.bundle
  );
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, operation.id);
  await writeJsonReplace(paths.interactionPacket, published.packet);
  return { ...published, result_bundle_ref: resultBundleRef };
}


function statusFrom(operation, status, overrides = {}) {
  return buildLiveAlignmentStatus(operation, {
    status: status.status,
    active_phase: status.active_phase,
    current_attempt_id: status.current_attempt_id,
    active_execution_ms: status.active_execution_ms,
    agent_attempts: status.agent_attempts,
    provider_requests: status.provider_requests,
    total_tokens: status.total_tokens,
    retained_records: status.retained_records,
    retained_bytes: status.retained_bytes,
    analysis_plan_ref: status.analysis_plan_ref,
    research_subject_ref: status.research_subject_ref,
    research_authority_epoch: status.research_authority_epoch,
    result_bundle_ref: status.result_bundle_ref,
    checkpoint_sha256: status.checkpoint_sha256,
    terminal_error: status.terminal_error,
    ...overrides
  });
}

async function persistStatus(dataRoot, repositoryIdentity, operation, status, overrides) {
  const next = statusFrom(operation, status, overrides);
  await writeAlignmentOperationStatus(dataRoot, repositoryIdentity, next);
  return next;
}

function researchRecipeForTask(task, recipes = []) {
  return (recipes ?? []).find((recipe) => recipe.taskId === task.id || recipe.queryId === task.id) ?? null;
}

/** Clip and scrub the outbound research query; subject binding keeps its own query digests. */
function outboundResearchQuery(task, recipe = null) {
  const raw = String(task?.query ?? recipe?.query ?? task?.id ?? "");
  const clipped = raw.length <= 512 ? raw : raw.slice(0, 512).trimEnd();
  if (!isOutboundResearchQuerySafe(clipped) || clipped.length < 1) {
    throw continueError("RESEARCH_QUERY_UNSAFE", "Research query contains secret or invalid content.");
  }
  return clipped;
}

async function bindResearchSubject({
  dataRoot,
  repositoryIdentity,
  bundle,
  tasks,
  recipes,
  now
}) {
  const usable = tasks
    .map((task) => ({ task, recipe: researchRecipeForTask(task, recipes) }))
    .filter((item) => item.recipe?.origin && item.recipe?.url);
  if (usable.length === 0) {
    return { subject: null, subjectRef: bundle.status.research_subject_ref, bound: false };
  }
  const origins = [];
  const seenOrigins = new Set();
  const queries = [];
  for (const item of usable) {
    if (!seenOrigins.has(item.recipe.origin)) {
      origins.push(createResearchOriginCandidate({
        id: item.recipe.originId ?? `origin-${origins.length + 1}`,
        origin: item.recipe.origin,
        source: item.recipe.originSource ?? "developer-input",
        sourceSha256: item.recipe.originSourceSha256 ?? hashContract({ origin: item.recipe.origin, task: item.task.id })
      }));
      seenOrigins.add(item.recipe.origin);
    }
    const queryText = item.task.query ?? item.recipe.query ?? item.task.id;
    queries.push({
      id: item.task.id,
      query_sha256: hashContract({ query: queryText }),
      purpose: item.task.expected_outcome ?? item.task.purpose ?? "public research"
    });
  }
  const subject = createNetworkResearchSubject({
    operationId: bundle.operation.id,
    queries,
    origins,
    maxQueries: Math.min(5, Math.max(1, queries.length)),
    maxSourcesPerQuery: bundle.operation.limits?.max_sources_per_query ?? 5,
    maxRequests: Math.min(25, Math.max(1, bundle.operation.limits?.max_research_requests ?? queries.length)),
    maxRedirectsPerRequest: bundle.operation.limits?.max_redirects_per_request ?? 3,
    maxResponseBytes: bundle.operation.limits?.max_research_response_bytes ?? 2_097_152,
    maxTotalBytes: bundle.operation.limits?.max_research_bytes ?? 10_485_760,
    requestDeadlineSeconds: bundle.operation.limits?.research_request_deadline_seconds ?? 30
  });
  const storageKey = "artifacts/network-research-subject.json";
  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, bundle.operation.id);
  const target = path.join(paths.root, storageKey);
  await writeJsonReplace(target, subject);
  const raw = `${canonicalJson(subject)}\n`;
  const subjectRef = artifactRef(subject.id, "network-research-subject", subject.subject_sha256, storageKey, Buffer.byteLength(raw));
  if (!bundle.status.research_subject_ref) {
    await appendJournal(dataRoot, repositoryIdentity, bundle.operation.id, "research-subject-created", {
      subject_id: subject.id,
      subject_sha256: subject.subject_sha256,
      query_set_sha256: subject.query_set_sha256
    }, now);
  }
  return { subject, subjectRef, bound: true, queries: usable };
}

async function attachResearchAuthority({
  dataRoot,
  repositoryIdentity,
  bundle,
  subject,
  researchAuthority,
  now
}) {
  if (!subject || !researchAuthority) return { epoch: bundle.status.research_authority_epoch ?? 0, attached: false };
  if (researchAuthority.subject_sha256 !== subject.subject_sha256) {
    throw continueError("RESEARCH_NOT_AUTHORIZED", "Research authority subject is not current.");
  }
  const epoch = Math.max(1, Number(researchAuthority.epoch ?? 1));
  if ((bundle.status.research_authority_epoch ?? 0) < epoch) {
    await appendJournal(dataRoot, repositoryIdentity, bundle.operation.id, "research-authority-attached", {
      subject_sha256: subject.subject_sha256,
      epoch,
      request_id: researchAuthority.request_id,
      request_sha256: researchAuthority.request_sha256,
      receipt_id: researchAuthority.receipt_id,
      receipt_sha256: researchAuthority.receipt_sha256,
      expires_at: researchAuthority.expires_at
    }, now);
  }
  return { epoch, attached: true };
}

async function runApprovedResearch({
  dataRoot,
  repositoryIdentity,
  bundle,
  subject,
  usable,
  researchAuthority,
  epoch,
  fetchImpl,
  now
}) {
  const results = [];
  if (!subject || !researchAuthority || !fetchImpl) return results;
  let ordinal = 1;
  for (const item of usable) {
    const originCandidate = subject.origins.find((origin) => origin.origin === item.recipe.origin) ?? subject.origins[0];
    const requestRecipe = createResearchRequestRecipe({
      id: item.recipe.recipeId ?? `request-${item.task.id}`,
      originId: originCandidate.id,
      url: item.recipe.url,
      deadlineSeconds: item.recipe.deadlineSeconds ?? 30,
      maxResponseBytes: item.recipe.maxResponseBytes ?? 2_097_152,
      allowedOrigins: [item.recipe.origin]
    });
    let query;
    try {
      query = outboundResearchQuery(item.task, item.recipe);
    } catch (error) {
      results.push({ taskId: item.task.id, created: false, error: error.message, gap: { reason: "denied", summary: error.message } });
      ordinal += 1;
      continue;
    }
    try {
      const result = await runControlledResearchGateway({
        dataRoot,
        repositoryIdentity,
        runId: bundle.operation.run_id,
        commitSha: bundle.operation.commit_sha,
        operationId: bundle.operation.id,
        queryId: item.task.id,
        query,
        subject,
        authority: {
          capability: "network-research",
          subject_id: subject.id,
          subject_sha256: subject.subject_sha256,
          request_id: researchAuthority.request_id,
          receipt_id: researchAuthority.receipt_id,
          request_sha256: researchAuthority.request_sha256,
          receipt_sha256: researchAuthority.receipt_sha256,
          approved_at: researchAuthority.approved_at,
          expires_at: researchAuthority.expires_at
        },
        authorityEpoch: epoch,
        requestRecipe,
        ordinal,
        fetchImpl,
        now
      });
      if (result.gap) {
        await appendJournal(dataRoot, repositoryIdentity, bundle.operation.id, "research-gap-recorded", {
          gap_id: result.gap.id,
          gap_sha256: canonicalDigest("research-gap", result.gap),
          query_id: item.task.id,
          reason: result.gap.reason
        }, now);
      }
      results.push({ taskId: item.task.id, ...result });
    } catch (error) {
      results.push({ taskId: item.task.id, created: false, error: error.message });
    }
    ordinal += 1;
  }
  return results;
}

async function tickAgentPhase({
  dataRoot,
  repositoryIdentity,
  bundle,
  snapshot,
  adapterRegistry,
  adapterName,
  probeRunner,
  resultValidator,
  workerContext,
  now,
  providerCredential = null,
  startProviderProxy = null,
  codexProfile = null,
  environment = process.env
}) {
  const phase = bundle.status.active_phase ?? "analysis-plan";
  const attemptNo = Math.min(2, Math.max(1, (bundle.status.agent_attempts ?? 0) + 1));
  const attemptId = `attempt-${randomUUID().replace(/-/g, "").slice(0, 24)}`;
  const resolvedProfile = codexProfile ?? defaultCodexProfile(environment);
  const modelId = adapterName === CODEX_ADAPTER_ID
    ? resolvedProfile.modelId
    : (bundle.operation.agent_descriptor?.model_id ?? "local-readonly-analysis");
  const invocation = {
    id: `invocation-${attemptId.slice(8)}`,
    operation_id: bundle.operation.id,
    attempt_no: attemptNo,
    phase,
    execution_instance_id: workerContext?.executionInstanceId ?? stableLiveAlignmentExecutionId(),
    expected_domains: expectedDomainsFromSnapshot(snapshot),
    adapter: { model_id: modelId }
  };
  await appendJournal(dataRoot, repositoryIdentity, bundle.operation.id, "phase-started", {
    phase,
    attempt_id: attemptId,
    attempt_no: attemptNo,
    invocation_sha256: hashContract(invocation)
  }, now);

  const paths = alignmentOperationPaths(dataRoot, repositoryIdentity, bundle.operation.id);
  const attemptRoot = path.join(paths.attempts, phase, String(attemptNo));
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });
  let context = workerContext ?? {
    analysisRoot: fileURLToPath(snapshot.repository.root_uri),
    attemptTmpPath: path.join(attemptRoot, "tmp"),
    privateHome: path.join(attemptRoot, "home"),
    supervisorRoot: path.join(attemptRoot, "supervisor"),
    resultPath: path.join(attemptRoot, "result.json")
  };
  let proxyServer = null;
  try {
    if (!workerContext && adapterName === CODEX_ADAPTER_ID) {
      const prepared = await prepareCodexExecutionContext({
        analysisRoot: context.analysisRoot,
        attemptRoot,
        privateHome: context.privateHome,
        supervisorRoot: context.supervisorRoot,
        resultPath: context.resultPath,
        operationId: bundle.operation.id,
        attemptId,
        environment,
        profile: resolvedProfile,
        providerCredential: providerCredential ?? resolveProviderCredential(environment)?.value ?? null,
        startProxy: startProviderProxy ?? undefined
      });
      context = prepared.context;
      proxyServer = prepared.proxyServer;
    }
    await mkdir(context.attemptTmpPath, { recursive: true, mode: 0o700 });
    await mkdir(context.privateHome, { recursive: true, mode: 0o700 });
    await mkdir(context.supervisorRoot, { recursive: true, mode: 0o700 });

    const worker = await runBoundedAgentWorker({
      snapshot,
      adapterRegistry,
      adapterName,
      invocation,
      workerContext: context,
      probeRunner: probeRunner ?? (async ({ code }) => ({ status: "pass", summary: code })),
      resultValidator: resultValidator ?? (() => true),
      clock: now
    });
    await writeJsonReplace(path.join(attemptRoot, "attempt.json"), worker.attempt);
    await appendJournal(dataRoot, repositoryIdentity, bundle.operation.id, "phase-finished", {
      phase,
      attempt_id: attemptId,
      attempt_no: attemptNo,
      attempt_sha256: hashContract(worker.attempt),
      status: worker.attempt.status
    }, now);
    return { worker, attemptId, attemptNo, phase, invocation };
  } finally {
    await closeProviderProxy(proxyServer);
  }
}

function nextActionFor(status, blockers = [], { scopeApproved = false } = {}) {
  if (blockers.length > 0) return blockers[0];
  if (status.status === "waiting-agent-authority") return "Approve the exact agent authority, then continue the live operation.";
  if (status.status === "waiting-research-authority") return "Approve the research authority, then continue the live operation.";
  if (status.status === "running") return "Let the live operation continue. Run `devharness align --continue --run ID` to tick it.";
  if (status.status === "question-blocked") return "Answer the blocked question before resuming the live operation.";
  if (status.status === "ready") {
    return scopeApproved
      ? "Scope is approved. Continue with the next governed planning step or inspect the Alignment Brief."
      : "Review the ready Alignment Brief and decide whether to approve scope.";
  }
  if (status.status === "failed") return "Retry the failed phase or cancel the operation if the goal changed.";
  if (status.status === "timed-out") return "Retry or cancel the timed-out operation.";
  if (status.status === "cancelled") return "Start a new Goal Run if the work is still desired.";
  return "Continue the live operation.";
}

export async function continueLiveAlignmentOperation({
  dataRoot,
  repositoryIdentity,
  runId,
  snapshot,
  supervisorRoot = defaultSupervisorRoot(),
  now = () => new Date(),
  isOwnerAlive = defaultLiveAlignmentOwnerAlive,
  owner = liveOwner(),
  capabilityView = null,
  researchRecipes = [],
  researchAuthority = null,
  fetchImpl = null,
  adapterRegistry = null,
  adapterName = null,
  probeRunner = null,
  resultValidator = null,
  workerContext = null,
  leaseTtlSeconds = DEFAULT_LEASE_TTL_SECONDS,
  providerCredential = null,
  startProviderProxy = null,
  codexProfile = null,
  environment = process.env
} = {}) {
  if (!snapshot?.repository?.root_uri) throw new Error("A live snapshot is required.");
  const bundle = await findLiveAlignmentOperationBundleByRun(dataRoot, repositoryIdentity, runId, snapshot.repository.git?.head_sha)
    ?? await findLiveAlignmentOperationBundleByRun(dataRoot, repositoryIdentity, runId);
  if (!bundle) throw continueError("SCOPE_NOT_READY", "align --continue requires an existing live Alignment operation.");
  if (bundle.fence?.kind === "cancel") throw continueError("CANCELLED", "The live Alignment operation is cancelled.");
  if (bundle.fence?.kind === "commit") throw continueError("ALREADY_COMMITTING", "The live Alignment operation is already committing.");
  if (["ready", "failed", "cancelled", "timed-out"].includes(bundle.status.status)) {
    let scopeApproved = false;
    try {
      const run = await loadGoalRun(dataRoot, repositoryIdentity, runId);
      scopeApproved = run.gates?.scope?.status === "approved";
    } catch {
      scopeApproved = false;
    }
    return {
      bundle,
      status: bundle.status,
      lease: bundle.lease,
      blockers: [],
      unresolved_decisions: unresolvedLiveAlignmentDecisions(bundle.interactionPacket, bundle.developerAnswers),
      research: [],
      worker: null,
      next_action: nextActionFor(bundle.status, [], { scopeApproved })
    };
  }

  const claimed = await claimLiveAlignmentLease({
    dataRoot,
    repositoryIdentity,
    operation: bundle.operation,
    existingLease: bundle.lease,
    owner,
    now,
    isOwnerAlive,
    ttlSeconds: leaseTtlSeconds
  });

  let current = { ...bundle, lease: claimed.lease };
  const unresolved = unresolvedLiveAlignmentDecisions(current.interactionPacket, current.developerAnswers);
  const blockers = [];
  const capabilities = capabilityView ?? await loadCapabilityAuthorizationView({
    dataRoot,
    supervisorRoot,
    repositoryIdentity,
    runId,
    now: now()
  }).catch(() => null);

  if (unresolved.length > 0) {
    if (current.status.status !== "question-blocked") {
      current = await projectLiveAlignmentOperationStatus(dataRoot, repositoryIdentity, current.operation.id, {
        blockingQuestions: unresolved.length,
        active_phase: current.status.active_phase ?? "analysis-plan"
      }) ?? current;
    }
    return {
      bundle: { ...current, lease: claimed.lease },
      status: current.status,
      lease: claimed.lease,
      lease_claim: claimed,
      unresolved_decisions: unresolved,
      research: [],
      worker: null,
      blockers,
      next_action: nextActionFor(current.status)
    };
  }

  if (!agentRuntimeApproved(capabilities)) {
    blockers.push("Approve agent-runtime, then run `devharness align --continue --run ID`.");
    if (["planned", "waiting-agent-authority", "waiting-research-authority"].includes(current.status.status)) {
      current = await projectLiveAlignmentOperationStatus(dataRoot, repositoryIdentity, current.operation.id, {
        agentAuthorityReady: false
      }) ?? current;
    }
    current = { ...current, status: await persistStatus(dataRoot, repositoryIdentity, current.operation, current.status, {
      status: current.status.status,
      active_phase: current.status.active_phase ?? "analysis-plan"
    }) };
    return {
      bundle: { ...current, lease: claimed.lease },
      status: current.status,
      lease: claimed.lease,
      lease_claim: claimed,
      unresolved_decisions: unresolved,
      research: [],
      worker: null,
      blockers,
      next_action: nextActionFor(current.status, blockers)
    };
  }

  if (["planned", "waiting-agent-authority", "waiting-research-authority", "question-blocked"].includes(current.status.status)) {
    current = await projectLiveAlignmentOperationStatus(dataRoot, repositoryIdentity, current.operation.id, {
      agentAuthorityReady: true,
      researchAuthorityReady: true,
      active_phase: current.status.active_phase ?? "analysis-plan"
    }) ?? current;
  }

  const pendingResearch = pendingResearchTasks(capabilities, current.analysisPlan);
  const approvedResearch = approvedResearchTasks(capabilities, current.analysisPlan);
  let researchResults = [];
  let subjectInfo = { subject: null, subjectRef: current.status.research_subject_ref, bound: false };

  if (pendingResearch.length > 0 && approvedResearch.length === 0) {
    blockers.push("Approve the remaining research tasks, then run `devharness align --continue --run ID`.");
  } else if (approvedResearch.length > 0) {
    subjectInfo = await bindResearchSubject({
      dataRoot,
      repositoryIdentity,
      bundle: current,
      tasks: approvedResearch,
      recipes: researchRecipes,
      now
    });
    if (subjectInfo.bound) {
      let effectiveAuthority = researchAuthority;
      if (!effectiveAuthority) {
        effectiveAuthority = await resolveNetworkResearchAuthorityFromCapabilityGrants({
          supervisorRoot,
          repositoryIdentity,
          capabilityView: capabilities,
          now: now(),
          previousEpoch: current.status.research_authority_epoch ?? 0
        });
      }
      const boundAuthority = effectiveAuthority
        ? {
            ...effectiveAuthority,
            capability: "network-research",
            subject_id: effectiveAuthority.subject_id ?? subjectInfo.subject.id,
            // Stamp the bound network-research-subject digest; capability receipts
            // authorize the grant, continue binds that grant onto the exact subject.
            subject_sha256: effectiveAuthority.subject_sha256 ?? subjectInfo.subject.subject_sha256
          }
        : null;
      const attached = await attachResearchAuthority({
        dataRoot,
        repositoryIdentity,
        bundle: current,
        subject: subjectInfo.subject,
        researchAuthority: boundAuthority,
        now
      });
      current = {
        ...current,
        status: await persistStatus(dataRoot, repositoryIdentity, current.operation, current.status, {
          status: "running",
          active_phase: current.status.active_phase ?? "analysis-plan",
          research_subject_ref: subjectInfo.subjectRef,
          research_authority_epoch: attached.epoch
        })
      };
      if (attached.attached && fetchImpl) {
        researchResults = await runApprovedResearch({
          dataRoot,
          repositoryIdentity,
          bundle: current,
          subject: subjectInfo.subject,
          usable: subjectInfo.queries,
          researchAuthority: boundAuthority,
          epoch: attached.epoch,
          fetchImpl,
          now
        });
      } else if (!boundAuthority) {
        blockers.push("Research subject is bound. Attach a matching network-research authority receipt before the gateway can fetch.");
      } else if (!fetchImpl) {
        blockers.push("Research recipes are bound. A fetch implementation is required before the gateway can run.");
      }
    } else {
      blockers.push("Research tasks are approved, but exact HTTPS origins/recipes are not bound. Pass recipes or continue local analysis.");
    }
  }

  const resolvedAdapterName = adapterName ?? current.operation.agent_descriptor?.id;
  let workerResult = null;
  if (!adapterRegistry) {
    blockers.push(`Agent adapter '${resolvedAdapterName}' is not registered. Provide a matching adapter (or Codex) before the next worker tick.`);
  } else {
    try {
      workerResult = await tickAgentPhase({
        dataRoot,
        repositoryIdentity,
        bundle: current,
        snapshot,
        adapterRegistry,
        adapterName: resolvedAdapterName,
        probeRunner,
        resultValidator,
        workerContext,
        now,
        providerCredential,
        startProviderProxy,
        codexProfile,
        environment
      });
      const succeeded = workerResult.worker.attempt.status === "succeeded";
      let published = null;
      if (succeeded && workerResult.phase === "analysis-validation") {
        try {
          published = await publishLocalReadonlyValidation({
            dataRoot,
            repositoryIdentity,
            bundle: current,
            snapshot,
            workerResult,
            now
          });
        } catch (error) {
          blockers.push(`analysis-validation did not produce a publishable Alignment bundle: ${error.message}`);
        }
      }
      const activePhase = published
        ? null
        : (succeeded ? (nextPhase(workerResult.phase) ?? workerResult.phase) : workerResult.phase);
      const nextStatus = published
        ? (published.bundle.verdict === "ready" ? "ready" : "question-blocked")
        : (succeeded ? "running" : "failed");
      current = {
        ...current,
        status: await persistStatus(dataRoot, repositoryIdentity, current.operation, current.status, {
          status: nextStatus,
          active_phase: nextStatus === "running" ? activePhase : null,
          current_attempt_id: succeeded ? null : workerResult.attemptId,
          agent_attempts: (current.status.agent_attempts ?? 0) + 1,
          total_tokens: (current.status.total_tokens ?? 0) + (workerResult.worker.attempt.limit_observations?.total_tokens ?? 0),
          terminal_error: succeeded ? null : (workerResult.worker.attempt.termination_reason ?? "ANALYSIS_FAILED"),
          research_subject_ref: subjectInfo.subjectRef ?? current.status.research_subject_ref,
          result_bundle_ref: published?.result_bundle_ref ?? current.status.result_bundle_ref
        })
      };
      if (!succeeded) blockers.push(`Agent ${workerResult.phase} attempt ${workerResult.attemptNo} ${workerResult.worker.attempt.status}.`);
    } catch (error) {
      blockers.push(error.message);
    }
  }

  if (!workerResult) {
    current = {
      ...current,
      status: await persistStatus(dataRoot, repositoryIdentity, current.operation, current.status, {
        status: current.status.status === "running" ? "running" : current.status.status,
        active_phase: current.status.active_phase ?? "analysis-plan",
        research_subject_ref: subjectInfo.subjectRef ?? current.status.research_subject_ref,
        research_authority_epoch: current.status.research_authority_epoch
      })
    };
  }

  const refreshed = await loadLiveAlignmentOperationBundle(dataRoot, repositoryIdentity, current.operation.id);
  return {
    bundle: refreshed,
    status: refreshed.status,
    lease: refreshed.lease,
    lease_claim: claimed,
    unresolved_decisions: unresolvedLiveAlignmentDecisions(refreshed.interactionPacket, refreshed.developerAnswers),
    research: researchResults,
    worker: workerResult,
    blockers,
    next_action: nextActionFor(refreshed.status, blockers)
  };
}

export { DEFAULT_LEASE_TTL_SECONDS };
